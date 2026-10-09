/**
 * @fleetos/policy — Capability-store disaster recovery (F280B, Wave 8 lane B).
 *
 * The DR protocol over the capability store (see `capability-store.ts` for
 * the store, grants, tombstones and decisions):
 *
 *  - SNAPSHOT EQUIVALENCE: a restored store behaves IDENTICALLY to the
 *    original for every decision in a corpus — same Guardian verdict, same
 *    reason code, same effective outcome (allow / deny / escalate), same
 *    grant id — byte-identical decision records.
 *  - REVOCATION PERMANENCE: revocations survive DR. Every revocation is an
 *    immutable TOMBSTONE in an append-only log; restore replays the
 *    tombstone log OVER the snapshot state, so a capability revoked before
 *    OR after the snapshot is still revoked after restore — an agent can
 *    never act on a pre-restore capability.
 *
 * Laws:
 *  - A8: tenant fail-closed — a cross-tenant tombstone log or tombstone
 *    REFUSES with machine-stable reason codes.
 *  - A19: the snapshot is content-addressed (digest over canonical state);
 *    a tampered snapshot REFUSES at restore (`store.snapshot-digest-mismatch`).
 *  - Determinism: no clock, no randomness; `sealedAt` is an explicit input.
 */

import type { Policy, GuardianContext } from "./policy.ts";
import type { Capability } from "./capability.ts";
import type { GrantRecord } from "./grant-chain.ts";
import type {
  CapabilityStore,
  RevocationLog,
  RevocationTombstone,
  StoreRefusalCode,
} from "./capability-store.ts";
import { decideCapability } from "./capability-store.ts";

// ---------------------------------------------------------------------------
// Snapshot + restore — the DR protocol
// ---------------------------------------------------------------------------

/** A content-addressed snapshot of the store + the tombstone log. */
export interface CapabilityStoreSnapshot {
  readonly kind: "CAPABILITY_STORE_SNAPSHOT";
  readonly tenantId: string;
  readonly policies: readonly Policy[];
  readonly capabilities: readonly Capability[];
  readonly grants: readonly GrantRecord[];
  readonly tombstones: readonly RevocationTombstone[];
  /** FNV-1a over the canonical snapshot content. */
  readonly snapshotDigest: string;
  /** Logical epoch ms — explicit input, never wall-clock. */
  readonly sealedAt: number;
}

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return value === undefined ? "null" : (JSON.stringify(value) ?? "null");
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(",")}]`;
  }
  const rec = value as Record<string, unknown>;
  const keys = Object.keys(rec).filter((k) => rec[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(rec[k])}`).join(",")}}`;
}

function snapshotDigestOf(s: Omit<CapabilityStoreSnapshot, "snapshotDigest">): string {
  return fnv1a(
    `capstore|v1|${canonicalJson({
      tenantId: s.tenantId,
      policies: s.policies,
      capabilities: s.capabilities,
      grants: s.grants,
      tombstones: s.tombstones,
      sealedAt: s.sealedAt,
    })}`,
  );
}

/** Snapshot the store + revocation log — content-addressed, tamper-evident. */
export function snapshotCapabilityStore(
  store: CapabilityStore,
  log: RevocationLog,
  sealedAt: number,
): CapabilityStoreSnapshot | null {
  if (store.tenantId === "" || log.tenantId !== store.tenantId) return null;
  if (!Number.isInteger(sealedAt) || sealedAt < 0) return null;
  const base: Omit<CapabilityStoreSnapshot, "snapshotDigest"> = {
    kind: "CAPABILITY_STORE_SNAPSHOT",
    tenantId: store.tenantId,
    policies: [...store.policies].sort((a, b) => (a.id < b.id ? -1 : 1)),
    capabilities: [...store.capabilities].sort((a, b) => (a.id < b.id ? -1 : 1)),
    grants: [...store.grants].sort((a, b) => (a.grantId < b.grantId ? -1 : 1)),
    tombstones: [...log.tombstones],
    sealedAt,
  };
  return { ...base, snapshotDigest: snapshotDigestOf(base) };
}

export type RestoreResult =
  | {
      readonly ok: true;
      readonly store: CapabilityStore;
      readonly log: RevocationLog;
      /** Tombstones replayed over the snapshot (post-snapshot revocations). */
      readonly replayedTombstones: number;
    }
  | { readonly ok: false; readonly reason: StoreRefusalCode; readonly detail: string };

/**
 * Restore a store from a snapshot — the DR protocol.
 *
 * 1. The snapshot digest MUST recompute (tamper-evidence, law A19).
 * 2. The tombstone log is replayed OVER the snapshot: every grant named by
 *    any tombstone is forced `revoked` — a revocation recorded before OR
 *    after the snapshot survives restore (REVOCATION PERMANENCE).
 */
export function restoreCapabilityStore(
  snapshot: CapabilityStoreSnapshot,
  log: RevocationLog,
): RestoreResult {
  if (snapshotDigestOf(snapshot) !== snapshot.snapshotDigest) {
    return { ok: false, reason: "store.snapshot-digest-mismatch", detail: "snapshot content does not match its digest" };
  }
  if (log.tenantId !== snapshot.tenantId) {
    return { ok: false, reason: "store.tenant-mismatch", detail: `tombstone log tenant ${log.tenantId} != snapshot tenant ${snapshot.tenantId}` };
  }
  for (const t of log.tombstones) {
    if (t.tenantId !== snapshot.tenantId) {
      return { ok: false, reason: "store.tenant-mismatch", detail: `tombstone ${t.rootGrantId} belongs to tenant ${t.tenantId}` };
    }
  }
  const revokedIds = new Set<string>();
  for (const t of log.tombstones) {
    for (const id of t.revokedGrantIds) revokedIds.add(id);
  }
  // The snapshot's own tombstones are part of the snapshot state — union them.
  for (const t of snapshot.tombstones) {
    for (const id of t.revokedGrantIds) revokedIds.add(id);
  }
  const snapshotRevoked = new Set(snapshot.tombstones.flatMap((t) => [...t.revokedGrantIds]));
  const grants = snapshot.grants.map((g) => {
    if (!revokedIds.has(g.grantId) || g.status === "revoked") return g;
    const tombstone = log.tombstones.find((t) => t.revokedGrantIds.includes(g.grantId));
    return {
      ...g,
      status: "revoked" as const,
      revokedAt: tombstone?.revokedAt ?? g.grantedAt,
      revokedBy: tombstone?.revokedBy ?? "dr-restore",
      revocationReason: tombstone ? `dr-replayed:${tombstone.rootGrantId}` : "dr-snapshot-tombstone",
    };
  });
  const replayedTombstones = log.tombstones.filter(
    (t) => !snapshotRevoked.has(t.rootGrantId),
  ).length;
  return {
    ok: true,
    store: {
      tenantId: snapshot.tenantId,
      policies: snapshot.policies,
      capabilities: snapshot.capabilities,
      grants,
    },
    log: { tenantId: log.tenantId, tombstones: [...snapshot.tombstones, ...log.tombstones] },
    replayedTombstones,
  };
}

// ---------------------------------------------------------------------------
// The snapshot equivalence law — machine-checkable over a decision corpus
// ---------------------------------------------------------------------------

/** One corpus case: a decision input evaluated against a store. */
export interface DecisionCorpusCase {
  readonly policyId: string;
  readonly capabilityId: string;
  readonly ctx: GuardianContext;
  readonly at: number;
}

export interface CorpusEquivalenceResult {
  readonly equivalent: boolean;
  readonly casesChecked: number;
  /** Index of the first divergent case (null when equivalent). */
  readonly divergedAt: number | null;
  readonly divergenceDetail: string | null;
}

/**
 * THE SNAPSHOT EQUIVALENCE LAW: for every case in the corpus, the original
 * and the restored store produce IDENTICAL decisions — verdict, reason,
 * effective outcome, grant id — compared canonically (byte-identical).
 */
export function verifySnapshotEquivalence(
  original: CapabilityStore,
  restored: CapabilityStore,
  corpus: readonly DecisionCorpusCase[],
): CorpusEquivalenceResult {
  for (let i = 0; i < corpus.length; i += 1) {
    const c = corpus[i]!;
    const a = decideCapability(original, c);
    const b = decideCapability(restored, c);
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      return {
        equivalent: false,
        casesChecked: i,
        divergedAt: i,
        divergenceDetail: `case ${i} (${c.capabilityId}) diverged: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`,
      };
    }
  }
  return { equivalent: true, casesChecked: corpus.length, divergedAt: null, divergenceDetail: null };
}
