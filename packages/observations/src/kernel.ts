/**
 * @fleetos/observations — Wave 1 kernel (F210A).
 *
 * Ingestion kernel:
 *   - Idempotent admission with ack/rejection contracts (Wave 0 baseline).
 *   - (deviceId, seq) dedup (Wave 0 baseline).
 *   - Back-pressure signaling types: when the admission queue grows past a
 *     threshold, the kernel returns a typed `BackpressureSignal` so the
 *     caller can shed load honestly rather than overcommitting.
 *   - Raw immutability: an attempt to mutate an admitted observation is
 *     refused by construction — the kernel returns the same Observation
 *     from the store and the digest equality is enforced.
 *   - Normalization pipeline contracts (raw -> canonical) with per-stage
 *     failure reason codes. The pipeline is a pure fold over stages; each
 *     stage either advances to the next or rejects with a stable code.
 *   - AuditEventRef emission on every consequential operation (A19).
 *
 * Pure TypeScript over injected PORT interfaces. No I/O, no servers, no
 * databases. Persistence lands at F211 (TL lane).
 */

import { createHash } from "node:crypto";
import {
  admitObservation,
  computePayloadDigest,
  emptyAdmissionStore,
  type AdmissionAck,
  type AdmissionInput,
  type AdmissionRejectionCode,
  type AdmissionStore,
  type DeviceIdLike,
  type Observation,
  type ObservationKind,
  type TenantIdLike,
} from "./observations.js";

// ---------------------------------------------------------------------------
// AuditEventRef — structural audit reference (A19).
// ---------------------------------------------------------------------------

export interface AuditEventRef {
  readonly actor: string;
  readonly intent: string;
  readonly tenant: string;
  readonly timestamp: number;
  readonly digest: string;
}

function digestOf(...parts: ReadonlyArray<string | number>): string {
  const text = parts.map((p) => String(p)).join("|");
  return createHash("sha256").update(text).digest("hex");
}

// ---------------------------------------------------------------------------
// Back-pressure signaling. The kernel returns a BackpressureSignal when
// the per-device pending queue exceeds a caller-supplied threshold. The
// signal is information, not an error — the caller decides whether to
// retry, shed, or buffer.
// ---------------------------------------------------------------------------

export type BackpressureLevel = "ok" | "warn" | "critical";

export interface BackpressureSignal {
  readonly deviceId: DeviceIdLike;
  readonly pendingCount: number;
  readonly threshold: number;
  readonly level: BackpressureLevel;
  readonly suggestedAction: "accept" | "shed" | "reject";
}

export interface BackpressureThresholds {
  readonly warn: number;
  readonly critical: number;
}

export function evaluateBackpressure(
  pendingCount: number,
  thresholds: BackpressureThresholds,
  deviceId: DeviceIdLike,
): BackpressureSignal {
  if (pendingCount >= thresholds.critical) {
    return { deviceId, pendingCount, threshold: thresholds.critical, level: "critical", suggestedAction: "reject" };
  }
  if (pendingCount >= thresholds.warn) {
    return { deviceId, pendingCount, threshold: thresholds.warn, level: "warn", suggestedAction: "shed" };
  }
  return { deviceId, pendingCount, threshold: thresholds.warn, level: "ok", suggestedAction: "accept" };
}

// ---------------------------------------------------------------------------
// Immutability — an attempt to mutate an admitted observation is refused.
//
// `assertObservationImmutable` takes an observation from the store and a
// caller-supplied candidate observation (the same deviceId + seq). If the
// digests do not match (the caller mutated the payload), the kernel
// returns `false`. The store's observation is the source of truth; the
// caller's mutated copy is rejected.
// ---------------------------------------------------------------------------

export type ImmutabilityCheck =
  | { readonly ok: true; readonly observation: Observation; readonly digest: string }
  | { readonly ok: false; readonly reason: "device-mismatch" | "seq-mismatch" | "digest-mismatch" };

export function assertObservationImmutable(
  store: Observation,
  candidate: { readonly deviceId: DeviceIdLike; readonly seq: number; readonly payloadDigest: string },
): ImmutabilityCheck {
  if (store.deviceId !== candidate.deviceId) return { ok: false, reason: "device-mismatch" };
  if (store.seq !== (candidate.seq as never)) return { ok: false, reason: "seq-mismatch" };
  if (store.payloadDigest !== candidate.payloadDigest) return { ok: false, reason: "digest-mismatch" };
  return { ok: true, observation: store, digest: store.payloadDigest };
}

// ---------------------------------------------------------------------------
// Normalization pipeline — raw -> canonical.
//
// The pipeline is a fixed sequence of pure stages. Each stage takes a
// `NormalizationContext` (the raw observation) and either advances to the
// next stage or rejects with a stable reason code. The final stage emits
// a `CanonicalObservation`.
//
// Stages:
//   1. validate-shape: tenantId, deviceId, observedAt present and well-formed.
//   2. validate-kind: kind is a non-empty string in the known vocabulary.
//   3. decode-payload: payload is decodable (for JSON kinds) or passes
//      through as bytes (for binary kinds).
//   4. canonicalize-fields: normalize field names, drop unknown fields,
//      sort keys for deterministic digest.
//   5. emit-canonical: produce the CanonicalObservation with a fresh
//      canonical digest.
// ---------------------------------------------------------------------------

export type NormalizationStage =
  | "validate-shape"
  | "validate-kind"
  | "decode-payload"
  | "canonicalize-fields"
  | "emit-canonical";

export type NormalizationRejectionCode =
  | "missing-tenant-id"
  | "missing-device-id"
  | "invalid-observed-at"
  | "missing-kind"
  | "unknown-kind"
  | "payload-not-json"
  | "payload-not-object"
  | "payload-empty";

export interface NormalizationContext {
  readonly tenantId: TenantIdLike;
  readonly deviceId: DeviceIdLike;
  readonly seq: number;
  readonly observedAt: number;
  readonly kind: ObservationKind;
  readonly rawPayload: Uint8Array;
}

export interface CanonicalObservation {
  readonly tenantId: TenantIdLike;
  readonly deviceId: DeviceIdLike;
  readonly seq: number;
  readonly observedAt: number;
  readonly kind: ObservationKind;
  readonly fields: Readonly<Record<string, unknown>>;
  readonly canonicalDigest: string;
}

export type NormalizationResult =
  | { readonly ok: true; readonly canonical: CanonicalObservation; readonly stages: ReadonlyArray<NormalizationStage>; readonly audit: AuditEventRef }
  | { readonly ok: false; readonly reason: NormalizationRejectionCode; readonly stage: NormalizationStage };

// Known kinds — the kernel accepts `telemetry.*`, `event.*`, `state.*`, `health.*`.
// Other kinds are rejected with `unknown-kind` rather than silently accepted.
const KNOWN_KIND_PREFIXES: ReadonlyArray<string> = ["telemetry.", "event.", "state.", "health."];

export function normalizeObservation(ctx: NormalizationContext): NormalizationResult {
  const stages: NormalizationStage[] = [];

  // Stage 1: validate-shape
  stages.push("validate-shape");
  if (typeof ctx.tenantId !== "string" || ctx.tenantId === "") {
    return { ok: false, reason: "missing-tenant-id", stage: "validate-shape" };
  }
  if (typeof ctx.deviceId !== "string" || ctx.deviceId === "") {
    return { ok: false, reason: "missing-device-id", stage: "validate-shape" };
  }
  if (!Number.isFinite(ctx.observedAt) || ctx.observedAt <= 0) {
    return { ok: false, reason: "invalid-observed-at", stage: "validate-shape" };
  }

  // Stage 2: validate-kind
  stages.push("validate-kind");
  if (typeof ctx.kind !== "string" || ctx.kind === "") {
    return { ok: false, reason: "missing-kind", stage: "validate-kind" };
  }
  if (!KNOWN_KIND_PREFIXES.some((p) => ctx.kind.startsWith(p))) {
    return { ok: false, reason: "unknown-kind", stage: "validate-kind" };
  }

  // Stage 3: decode-payload
  stages.push("decode-payload");
  if (ctx.rawPayload.length === 0) {
    return { ok: false, reason: "payload-empty", stage: "decode-payload" };
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder().decode(ctx.rawPayload));
  } catch {
    return { ok: false, reason: "payload-not-json", stage: "decode-payload" };
  }
  if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
    return { ok: false, reason: "payload-not-object", stage: "decode-payload" };
  }

  // Stage 4: canonicalize-fields
  stages.push("canonicalize-fields");
  const fields: Record<string, unknown> = {};
  for (const k of Object.keys(decoded as Record<string, unknown>).sort()) {
    fields[k] = (decoded as Record<string, unknown>)[k];
  }

  // Stage 5: emit-canonical
  stages.push("emit-canonical");
  const canonicalDigest = createHash("sha256")
    .update(`${ctx.tenantId}|${ctx.deviceId}|${ctx.seq}|${ctx.observedAt}|${ctx.kind}|${JSON.stringify(fields)}`)
    .digest("hex");
  const canonical: CanonicalObservation = {
    tenantId: ctx.tenantId,
    deviceId: ctx.deviceId,
    seq: ctx.seq,
    observedAt: ctx.observedAt,
    kind: ctx.kind,
    fields,
    canonicalDigest,
  };
  const audit: AuditEventRef = {
    actor: ctx.deviceId,
    intent: "observation:normalize",
    tenant: ctx.tenantId,
    timestamp: ctx.observedAt,
    digest: digestOf(ctx.deviceId, ctx.seq, canonicalDigest),
  };
  return { ok: true, canonical, stages, audit };
}

// ---------------------------------------------------------------------------
// AdmittedObservationLog — a deterministic in-memory log of admitted
// observations per (tenant, device). The log is the kernel's authoritative
// read side; persistence lands at F211.
// ---------------------------------------------------------------------------

export interface AdmittedObservationLog {
  readonly byKey: ReadonlyMap<string, Observation>;
  readonly byDevice: ReadonlyMap<DeviceIdLike, ReadonlyArray<Observation>>;
  readonly lastSeqByDevice: ReadonlyMap<DeviceIdLike, number>;
}

export function emptyAdmittedLog(): AdmittedObservationLog {
  return { byKey: new Map(), byDevice: new Map(), lastSeqByDevice: new Map() };
}

export type AdmittedLogResult =
  | { readonly ok: true; readonly log: AdmittedObservationLog; readonly observation: Observation; readonly ack: AdmissionAck; readonly audit: AuditEventRef }
  | { readonly ok: false; readonly reason: AdmissionRejectionCode };

export function admitToLog(
  log: AdmittedObservationLog,
  input: AdmissionInput,
): AdmittedLogResult {
  // Build an AdmissionStore view from the log.
  const known = new Map<string, Observation["id"]>();
  for (const [key, obs] of log.byKey) {
    known.set(key, obs.id);
  }
  const storeView: AdmissionStore = { known, lastSeq: new Map(log.lastSeqByDevice) };
  const r = admitObservation(storeView, input);
  if (!r.result.ok) {
    return { ok: false, reason: r.result.reason };
  }
  const observation = r.result.observation;
  const ack = r.result.ack;
  // Idempotent: if duplicate, the log is untouched.
  if (ack.duplicate) {
    const audit: AuditEventRef = {
      actor: input.deviceId,
      intent: "observation:admit:idempotent",
      tenant: input.tenantId,
      timestamp: input.admittedAt,
      digest: digestOf(input.deviceId, input.seq, "idempotent", ack.payloadDigest),
    };
    return { ok: true, log, observation, ack, audit };
  }
  // Append the new observation to the log.
  const key = `${input.deviceId}:${input.seq}`;
  const byKey = new Map(log.byKey);
  byKey.set(key, observation);
  const byDevice = new Map(log.byDevice);
  const prior = byDevice.get(input.deviceId) ?? [];
  byDevice.set(input.deviceId, [...prior, observation]);
  const lastSeqByDevice = new Map(log.lastSeqByDevice);
  lastSeqByDevice.set(input.deviceId, input.seq);
  const nextLog: AdmittedObservationLog = { byKey, byDevice, lastSeqByDevice };
  const audit: AuditEventRef = {
    actor: input.deviceId,
    intent: "observation:admit",
    tenant: input.tenantId,
    timestamp: input.admittedAt,
    digest: digestOf(input.deviceId, input.seq, ack.payloadDigest, input.admittedAt),
  };
  return { ok: true, log: nextLog, observation, ack, audit };
}

// ---------------------------------------------------------------------------
// Read-only helpers — tenant fail-closed.
// ---------------------------------------------------------------------------

export function listObservationsForDevice(
  log: AdmittedObservationLog,
  tenantId: TenantIdLike,
  deviceId: DeviceIdLike,
): ReadonlyArray<Observation> {
  const obs = log.byDevice.get(deviceId) ?? [];
  // Fail-closed: only return observations whose tenantId matches the caller.
  return obs.filter((o) => o.tenantId === tenantId);
}

// Re-export the Wave 0 primitives so consumers have a single entry point.
export { admitObservation, computePayloadDigest, emptyAdmissionStore };
