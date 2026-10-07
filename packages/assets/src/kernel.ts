/**
 * @fleetos/assets — Wave 1 kernel (F210A).
 *
 * DeviceTwin kernel:
 *   - Append-only revision log with REAL admission: digest verification of
 *     the source observation ref, monotonic sequence enforcement, conflict
 *     refusal (an attempt to revise over a digested head with a non-matching
 *     prior-digest is refused).
 *   - Twin projection engine: `projectTwin(revisions)` folds to current state
 *     with honest `unknown` / `pending` projection states.
 *
 * The AssetDirectory + AssetRepositoryPort live in `kernel-directory.ts`.
 * AuditEventRef + digestOf live in `kernel-audit.ts`.
 *
 * Pure TypeScript over injected PORT interfaces. No I/O, no servers, no
 * databases. Persistence lands at F211 (TL lane).
 */

import { createHash } from "node:crypto";
import type {
  DeviceId,
  DeviceTwin,
  ObservationRefLike,
  TenantIdLike,
  TwinRevision,
} from "./assets.js";

// Re-export the audit + directory primitives so consumers have a single entry.
export * from "./kernel-audit.js";
export * from "./kernel-directory.js";
import type { AuditEventRef } from "./kernel-audit.js";
import { digestOf } from "./kernel-audit.js";

// ---------------------------------------------------------------------------
// Twin admission — REAL admission with digest verification + conflict refusal.
// ---------------------------------------------------------------------------

export type TwinAdmissionRejectionCode =
  | "unknown-device"
  | "non-monotonic-seq"
  | "stale-observed-at"
  | "malformed-attributes"
  | "invalid-observation-digest"
  | "conflict-parent-digest-mismatch";

export interface TwinAdmissionInput {
  readonly deviceId: DeviceId;
  readonly tenantId: TenantIdLike;
  readonly seq: number;
  readonly observedAt: number;
  readonly appliedAt: number;
  readonly source: "observation" | "manual";
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly observationRef?: ObservationRefLike;
  readonly parentDigest?: string;
  readonly actor: string;
}

export type TwinAdmissionResult =
  | {
      readonly ok: true;
      readonly twin: DeviceTwin;
      readonly revision: TwinRevision & { readonly revisionDigest: string };
      readonly audit: AuditEventRef;
    }
  | { readonly ok: false; readonly reason: TwinAdmissionRejectionCode };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const HEX64_RE = /^[0-9a-f]{64}$/;

function computeRevisionDigest(input: {
  readonly deviceId: string;
  readonly seq: number;
  readonly observedAt: number;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly parentDigest: string;
  readonly observationDigest: string;
}): string {
  const attributesJson = JSON.stringify(sortKeys(input.attributes));
  return createHash("sha256")
    .update(`${input.deviceId}|${input.seq}|${input.observedAt}|${attributesJson}|${input.parentDigest}|${input.observationDigest}`)
    .digest("hex");
}

function sortKeys(obj: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) out[k] = obj[k];
  return out;
}

export function admitTwinRevision(
  current: DeviceTwin | null,
  input: TwinAdmissionInput,
): TwinAdmissionResult {
  if (typeof input.deviceId !== "string" || input.deviceId === "") {
    return { ok: false, reason: "unknown-device" };
  }
  if (!isPlainObject(input.attributes)) {
    return { ok: false, reason: "malformed-attributes" };
  }

  // Validate observation ref digest if present.
  let observationDigest = "manual";
  if (input.observationRef) {
    const d = input.observationRef.payloadDigest;
    if (typeof d !== "string" || !HEX64_RE.test(d)) {
      return { ok: false, reason: "invalid-observation-digest" };
    }
    observationDigest = d;
  }

  // Genesis revision (current === null).
  if (current === null) {
    if (!Number.isFinite(input.seq) || input.seq < 1) {
      return { ok: false, reason: "non-monotonic-seq" };
    }
    if (!Number.isFinite(input.observedAt) || input.observedAt <= 0) {
      return { ok: false, reason: "stale-observed-at" };
    }
    const parentDigest = input.parentDigest ?? "genesis";
    if (input.parentDigest !== undefined && input.parentDigest !== "genesis") {
      return { ok: false, reason: "conflict-parent-digest-mismatch" };
    }
    const revisionDigest = computeRevisionDigest({
      deviceId: input.deviceId,
      seq: input.seq,
      observedAt: input.observedAt,
      attributes: input.attributes,
      parentDigest,
      observationDigest,
    });
    const seq = input.seq as TwinRevision["seq"];
    const revision: TwinRevision & { readonly revisionDigest: string } = {
      seq,
      observedAt: input.observedAt,
      appliedAt: input.appliedAt,
      source: input.source,
      attributes: input.attributes,
      observationRef: input.observationRef,
      revisionDigest,
    };
    const twin: DeviceTwin = {
      deviceId: input.deviceId,
      tenantId: input.tenantId,
      revisions: [revision],
      lastSeq: seq,
      lastObservedAt: input.observedAt,
    };
    const audit: AuditEventRef = {
      actor: input.actor,
      intent: "twin:admit:genesis",
      tenant: input.tenantId,
      timestamp: input.appliedAt,
      digest: digestOf(input.deviceId, "genesis", input.seq, input.appliedAt),
    };
    return { ok: true, twin, revision, audit };
  }

  // Append: seq MUST strictly exceed current.lastSeq.
  if (!Number.isFinite(input.seq) || input.seq <= current.lastSeq) {
    return { ok: false, reason: "non-monotonic-seq" };
  }
  if (!Number.isFinite(input.observedAt) || input.observedAt < current.lastObservedAt) {
    return { ok: false, reason: "stale-observed-at" };
  }
  // Conflict check: parentDigest MUST equal the prior revision's revisionDigest.
  const priorHead = current.revisions[current.revisions.length - 1];
  if (!priorHead) {
    return { ok: false, reason: "conflict-parent-digest-mismatch" };
  }
  const headDigest = (priorHead as TwinRevision & { readonly revisionDigest?: string }).revisionDigest;
  const expectedParent = headDigest ?? "genesis";
  if ((input.parentDigest ?? expectedParent) !== expectedParent) {
    return { ok: false, reason: "conflict-parent-digest-mismatch" };
  }

  const revisionDigest = computeRevisionDigest({
    deviceId: input.deviceId,
    seq: input.seq,
    observedAt: input.observedAt,
    attributes: input.attributes,
    parentDigest: expectedParent,
    observationDigest,
  });
  const seq = input.seq as TwinRevision["seq"];
  const revision: TwinRevision & { readonly revisionDigest: string } = {
    seq,
    observedAt: input.observedAt,
    appliedAt: input.appliedAt,
    source: input.source,
    attributes: input.attributes,
    observationRef: input.observationRef,
    revisionDigest,
  };
  const twin: DeviceTwin = {
    deviceId: current.deviceId,
    tenantId: current.tenantId,
    revisions: [...current.revisions, revision],
    lastSeq: seq,
    lastObservedAt: input.observedAt,
  };
  const audit: AuditEventRef = {
    actor: input.actor,
    intent: "twin:admit",
    tenant: current.tenantId,
    timestamp: input.appliedAt,
    digest: digestOf(input.deviceId, "admit", input.seq, input.appliedAt),
  };
  return { ok: true, twin, revision, audit };
}

// ---------------------------------------------------------------------------
// projectTwin — fold revisions to current state with honest degradation.
// ---------------------------------------------------------------------------

export type TwinProjectionState = "unknown" | "pending" | "current";

export interface TwinProjection {
  readonly deviceId: DeviceId;
  readonly tenantId: TenantIdLike;
  readonly state: TwinProjectionState;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly lastSeq: TwinRevision["seq"] | null;
  readonly lastObservedAt: number | null;
  readonly headDigest: string | null;
}

export function projectTwin(
  revisions: ReadonlyArray<TwinRevision>,
  deviceId: DeviceId,
  tenantId: TenantIdLike,
): TwinProjection {
  if (revisions.length === 0) {
    return {
      deviceId,
      tenantId,
      state: "unknown",
      attributes: {},
      lastSeq: null,
      lastObservedAt: null,
      headDigest: null,
    };
  }
  const hasObservation = revisions.some((r) => r.source === "observation");
  const state: TwinProjectionState = hasObservation ? "current" : "pending";
  const merged: Record<string, unknown> = {};
  for (const r of revisions) {
    for (const [k, v] of Object.entries(r.attributes)) merged[k] = v;
  }
  const head = revisions[revisions.length - 1]!;
  return {
    deviceId,
    tenantId,
    state,
    attributes: merged,
    lastSeq: head.seq,
    lastObservedAt: head.observedAt,
    headDigest: (head as TwinRevision & { readonly revisionDigest?: string }).revisionDigest ?? null,
  };
}
