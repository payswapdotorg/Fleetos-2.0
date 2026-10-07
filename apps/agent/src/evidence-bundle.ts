/**
 * @fleetos/agent — Wave 3 local evidence bundles (F230A).
 *
 * Store-and-forward across outages: the agent accumulates observations
 * into signed bundles pending upload. The bundles persist across outages
 * (in production: to local disk; here: an in-memory list that the caller
 * controls). Each bundle carries an integrity digest; the receiving side
 * (the F230A store-and-forward surface in @fleetos/observations) verifies
 * the digest BEFORE admitting.
 *
 *   - **EvidenceBundleStore** — append-only local store of pending bundles.
 *     Bounded; oldest bundles evicted when bound exceeded (the caller is
 *     expected to flush before this happens; eviction is a last-resort
 *     safety, NOT a normal operating mode).
 *   - **bundle integrity digest** — sha-256 over the sorted observation
 *     payload digests (deterministic; same set of observations -> same
 *     digest, regardless of insertion order).
 *   - **bundle signature** — sha-256 over (digest, agentKey). Real
 *     production would use an asymmetric signature; the kernel exposes
 *     the contract, not the crypto primitive.
 *   - **replay protection on the receiving side** — the receiving side
 *     tracks bundle IDs in a bounded cache; a re-delivered bundle returns
 *     `duplicate` and is NOT re-admitted.
 *
 * Pure TypeScript. No I/O, no servers, no databases. Persistence lands at
 * F211 (TL lane).
 */

import { createHash } from "node:crypto";
import type { AgentIdLike, TenantIdLike } from "./agent.js";
import type { AuditEventRef } from "./kernel.js";

export type { AuditEventRef };

function digestOf(...parts: ReadonlyArray<string | number>): string {
  const text = parts.map((p) => String(p)).join("|");
  return createHash("sha256").update(text).digest("hex");
}

// ---------------------------------------------------------------------------
// BundleObservation — structural seam. The agent constructs these from
// its local observation buffer; the receiving side consumes them via the
// @fleetos/observations store-forward surface (typed identically).
// ---------------------------------------------------------------------------

export interface BundleObservation {
  readonly deviceId: string;
  readonly seq: number;
  readonly observedAt: number;
  readonly kind: string;
  readonly payloadDigest: string; // sha-256 of the raw payload
}

// ---------------------------------------------------------------------------
// EvidenceBundle — the signed bundle pending upload.
// ---------------------------------------------------------------------------

export interface EvidenceBundle {
  readonly id: string; // bundle id (caller-assigned, content-addressed)
  readonly tenantId: TenantIdLike;
  readonly deviceId: string;
  readonly seq: number; // bundle sequence per (tenantId, deviceId)
  readonly observations: ReadonlyArray<BundleObservation>;
  readonly digest: string; // sha-256 over sorted observation payload digests
  readonly agentSignature: string; // sha-256 over (digest, agentKey)
  readonly createdAt: number;
  readonly uploadedAt: number | null; // null = pending upload
}

export function computeBundleDigest(observations: ReadonlyArray<BundleObservation>): string {
  const sorted = [...observations].sort((a, b) => {
    if (a.deviceId !== b.deviceId) return a.deviceId < b.deviceId ? -1 : 1;
    if (a.seq !== b.seq) return a.seq - b.seq;
    return a.observedAt - b.observedAt;
  });
  const text = sorted.map((o) => `${o.deviceId}:${o.seq}:${o.observedAt}:${o.kind}:${o.payloadDigest}`).join("|");
  return createHash("sha256").update(text).digest("hex");
}

export function buildBundle(input: {
  readonly id: string;
  readonly tenantId: TenantIdLike;
  readonly deviceId: string;
  readonly seq: number;
  readonly observations: ReadonlyArray<BundleObservation>;
  readonly createdAt: number;
  readonly agentKey: string;
}): EvidenceBundle {
  const digest = computeBundleDigest(input.observations);
  const agentSignature = createHash("sha256").update(`${digest}|${input.agentKey}`).digest("hex");
  return {
    id: input.id,
    tenantId: input.tenantId,
    deviceId: input.deviceId,
    seq: input.seq,
    observations: input.observations,
    digest,
    agentSignature,
    createdAt: input.createdAt,
    uploadedAt: null,
  };
}

export function verifyBundleSignature(bundle: EvidenceBundle, agentKey: string): boolean {
  const expected = createHash("sha256").update(`${bundle.digest}|${agentKey}`).digest("hex");
  if (expected.length !== bundle.agentSignature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ bundle.agentSignature.charCodeAt(i);
  }
  return diff === 0;
}

// ---------------------------------------------------------------------------
// EvidenceBundleStore — bounded append-only local store.
// ---------------------------------------------------------------------------

export interface EvidenceBundleStore {
  readonly agentId: AgentIdLike;
  readonly tenantId: TenantIdLike;
  readonly pending: ReadonlyArray<EvidenceBundle>;
  readonly uploaded: ReadonlySet<string>; // bundle IDs confirmed uploaded
  readonly maxSize: number;
}

export function emptyBundleStore(
  agentId: AgentIdLike,
  tenantId: TenantIdLike,
  maxSize = 64,
): EvidenceBundleStore {
  return { agentId, tenantId, pending: [], uploaded: new Set(), maxSize };
}

export type AppendBundleRejectionCode = "overflow-refused" | "missing-bundle-id" | "tenant-mismatch" | "duplicate-bundle-id";

export type AppendBundleResult =
  | {
      readonly ok: true;
      readonly store: EvidenceBundleStore;
      readonly audit: AuditEventRef;
    }
  | { readonly ok: false; readonly reason: AppendBundleRejectionCode };

export function appendBundle(store: EvidenceBundleStore, bundle: EvidenceBundle): AppendBundleResult {
  if (bundle.id === "") return { ok: false, reason: "missing-bundle-id" };
  if (bundle.tenantId !== store.tenantId) return { ok: false, reason: "tenant-mismatch" };
  if (store.pending.some((b) => b.id === bundle.id)) {
    return { ok: false, reason: "duplicate-bundle-id" };
  }
  if (store.pending.length >= store.maxSize) {
    return { ok: false, reason: "overflow-refused" };
  }
  const pending = [...store.pending, bundle];
  const audit: AuditEventRef = {
    actor: store.agentId,
    intent: "agent:evidence:bundle:append",
    tenant: store.tenantId,
    timestamp: bundle.createdAt,
    digest: digestOf(store.agentId, bundle.id, bundle.digest, bundle.createdAt),
  };
  return { ok: true, store: { ...store, pending }, audit };
}

// ---------------------------------------------------------------------------
// Mark a bundle as uploaded (the upstream service confirmed receipt).
// Removes from pending; adds to uploaded (bounded).
// ---------------------------------------------------------------------------

export function markUploaded(
  store: EvidenceBundleStore,
  bundleId: string,
  at: number,
): { readonly store: EvidenceBundleStore; readonly audit: AuditEventRef | null } {
  const bundle = store.pending.find((b) => b.id === bundleId);
  if (!bundle) return { store, audit: null };
  const pending = store.pending.filter((b) => b.id !== bundleId);
  let uploaded = store.uploaded;
  if (uploaded.size >= store.maxSize) {
    // Drop oldest ~25%.
    const keep = Math.floor(store.maxSize * 0.75);
    const arr = [...uploaded];
    uploaded = new Set(arr.slice(arr.length - keep));
  }
  const nextUploaded = new Set(uploaded);
  nextUploaded.add(bundleId);
  const audit: AuditEventRef = {
    actor: store.agentId,
    intent: "agent:evidence:bundle:uploaded",
    tenant: store.tenantId,
    timestamp: at,
    digest: digestOf(store.agentId, bundleId, "uploaded", at),
  };
  return {
    store: { ...store, pending, uploaded: nextUploaded },
    audit,
  };
}

// ---------------------------------------------------------------------------
// Pending bundle iteration — the caller walks this on reconnect and re-
// uploads each bundle (at-least-once). The receiving side dedups.
// ---------------------------------------------------------------------------

export function pendingBundles(store: EvidenceBundleStore): ReadonlyArray<EvidenceBundle> {
  return store.pending;
}

// ---------------------------------------------------------------------------
// Replay-protection on the agent side: a bundle whose ID is in the uploaded
// set is a candidate for skip on retransmit (the receiving side has
// confirmed receipt). The caller MAY still re-transmit it (the receiver
// will dedup); the agent-side `uploaded` set is an optimization.
// ---------------------------------------------------------------------------

export function isUploaded(store: EvidenceBundleStore, bundleId: string): boolean {
  return store.uploaded.has(bundleId);
}
