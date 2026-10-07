/**
 * @fleetos/observations — Wave 2 ingestion pipeline (F220A).
 *
 * Operational-truth-grade admission: a staged pipeline
 * (receive -> validate -> normalize -> dedup -> admit) with per-stage
 * failure reason codes and metrics contracts. Each stage is pure and
 * returns a typed `StageOutcome`; the orchestrator threads state through
 * immutably. Bounded queues with explicit overflow behavior — refuse and
 * signal retry, NEVER silent drop. Batch admission with per-item acks.
 * Raw payload digesting (sha-256) at receive time. Retention/read-model
 * projection contracts (immutable store + disposable projections per the
 * storage-authority table in DEPENDENCY-GRAPH.md).
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

// Re-export for downstream callers.
export { admitObservation, computePayloadDigest, emptyAdmissionStore };
export {
  buildDeviceSummary,
  createInMemoryImmutableStore,
  defaultRetentionPolicy,
  projectionStale,
  type DeviceSummaryProjection,
  type ImmutableObservationStore,
  type InMemoryImmutableStore,
  type ProjectionMetadata,
  type RetentionPolicy,
} from "./retention.js";
export {
  defaultBackpressurePolicy,
  dequeue,
  enqueue,
  evaluateBackpressureLevel,
  type BackpressurePolicy,
  type EnqueueDecision,
  type OverflowPolicy,
  type QueueState,
} from "./backpressure.js";

// ---------------------------------------------------------------------------
// AuditEventRef — structural audit reference (A19). Same shape as the one in
// observations/kernel.ts (Wave 1). Re-exported here for callers of the
// ingestion pipeline; the canonical definition lives in kernel.ts.
// ---------------------------------------------------------------------------

import type { AuditEventRef } from "./kernel.js";
export type { AuditEventRef };

function digestOf(...parts: ReadonlyArray<string | number>): string {
  const text = parts.map((p) => String(p)).join("|");
  return createHash("sha256").update(text).digest("hex");
}

// ---------------------------------------------------------------------------
// Staged pipeline — receive -> validate -> normalize -> dedup -> admit.
//
// Each stage carries:
//   - a typed `PipelineStage` discriminator (machine-stable)
//   - a typed `StageFailureCode` per-stage reason vocabulary
//   - a typed `StageMetrics` slot per stage
//
// The pipeline is a pure fold: same inputs -> same outputs (deterministic).
// ---------------------------------------------------------------------------

export type PipelineStage =
  | "receive"
  | "validate"
  | "normalize"
  | "dedup"
  | "admit";

export type ReceiveFailureCode =
  | "missing-tenant-id"
  | "missing-device-id"
  | "missing-payload"
  | "invalid-observed-at"
  | "invalid-received-at";

export type ValidateFailureCode =
  | "missing-kind"
  | "unknown-kind"
  | "invalid-seq";

export type NormalizeFailureCode =
  | "payload-empty"
  | "payload-not-json"
  | "payload-not-object";

export type DedupFailureCode =
  | "duplicate-seq"
  | "non-monotonic-seq";

export type AdmitFailureCode =
  | "store-error";

export type StageFailureCode =
  | ReceiveFailureCode
  | ValidateFailureCode
  | NormalizeFailureCode
  | DedupFailureCode
  | AdmitFailureCode;

// ---------------------------------------------------------------------------
// Pipeline context — the carrier that flows through the stages.
// ---------------------------------------------------------------------------

/** A raw item presented at the receive stage. */
export interface RawObservationInput {
  readonly tenantId: TenantIdLike;
  readonly deviceId: DeviceIdLike;
  readonly seq: number;
  readonly observedAt: number;
  readonly kind: ObservationKind;
  readonly payload: Readonly<Uint8Array>;
  readonly receivedAt: number;
}

/** The pipeline carrier — accumulates state and is immutable per stage. */
export interface PipelineCarrier {
  readonly stage: PipelineStage;
  readonly raw: RawObservationInput;
  readonly payloadDigest: string | null; // computed at receive time
  readonly normalizedFields: Readonly<Record<string, unknown>> | null;
  readonly canonicalDigest: string | null;
  readonly receivedAt: number;
}

export type StageOutcome =
  | { readonly ok: true; readonly carrier: PipelineCarrier }
  | { readonly ok: false; readonly stage: PipelineStage; readonly reason: StageFailureCode };

// ---------------------------------------------------------------------------
// Stage metrics — typed counters per stage. The metrics are pure values;
// emission into a metrics sink is the application's responsibility.
// ---------------------------------------------------------------------------

export interface StageMetrics {
  readonly received: number;
  readonly validated: number;
  readonly normalized: number;
  readonly deduped: number;
  readonly admitted: number;
  readonly failedByStage: Readonly<Record<PipelineStage, number>>;
}

export function emptyStageMetrics(): StageMetrics {
  return {
    received: 0,
    validated: 0,
    normalized: 0,
    deduped: 0,
    admitted: 0,
    failedByStage: { receive: 0, validate: 0, normalize: 0, dedup: 0, admit: 0 },
  };
}

export function incrementStageMetrics(metrics: StageMetrics, stage: PipelineStage, delta: number): StageMetrics {
  const failedByStage = { ...metrics.failedByStage, [stage]: (metrics.failedByStage[stage] ?? 0) + delta };
  return { ...metrics, failedByStage };
}

// ---------------------------------------------------------------------------
// Known kind prefixes — same set as the Wave 1 normalizeObservation kernel.
// ---------------------------------------------------------------------------

const KNOWN_KIND_PREFIXES: ReadonlyArray<string> = ["telemetry.", "event.", "state.", "health."];

// ---------------------------------------------------------------------------
// Stage 1: receive — compute the sha-256 digest of the raw payload at the
// boundary. Refuses missing tenant/device/payload/observed-at/received-at.
// ---------------------------------------------------------------------------

export function stageReceive(input: RawObservationInput): StageOutcome {
  if (typeof input.tenantId !== "string" || input.tenantId === "") {
    return { ok: false, stage: "receive", reason: "missing-tenant-id" };
  }
  if (typeof input.deviceId !== "string" || input.deviceId === "") {
    return { ok: false, stage: "receive", reason: "missing-device-id" };
  }
  if (!(input.payload instanceof Uint8Array) || input.payload.length === 0) {
    return { ok: false, stage: "receive", reason: "missing-payload" };
  }
  if (!Number.isFinite(input.observedAt) || input.observedAt <= 0) {
    return { ok: false, stage: "receive", reason: "invalid-observed-at" };
  }
  if (!Number.isFinite(input.receivedAt) || input.receivedAt <= 0) {
    return { ok: false, stage: "receive", reason: "invalid-received-at" };
  }
  const payloadDigest = computePayloadDigest(input.payload);
  const carrier: PipelineCarrier = {
    stage: "validate",
    raw: input,
    payloadDigest,
    normalizedFields: null,
    canonicalDigest: null,
    receivedAt: input.receivedAt,
  };
  return { ok: true, carrier };
}

// ---------------------------------------------------------------------------
// Stage 2: validate — kind vocabulary + seq sanity.
// ---------------------------------------------------------------------------

export function stageValidate(carrier: PipelineCarrier): StageOutcome {
  const { raw } = carrier;
  if (typeof raw.kind !== "string" || raw.kind === "") {
    return { ok: false, stage: "validate", reason: "missing-kind" };
  }
  if (!KNOWN_KIND_PREFIXES.some((p) => raw.kind.startsWith(p))) {
    return { ok: false, stage: "validate", reason: "unknown-kind" };
  }
  if (!Number.isFinite(raw.seq) || raw.seq < 1) {
    return { ok: false, stage: "validate", reason: "invalid-seq" };
  }
  return { ok: true, carrier: { ...carrier, stage: "normalize" } };
}

// ---------------------------------------------------------------------------
// Stage 3: normalize — decode JSON, canonicalize field order.
// ---------------------------------------------------------------------------

export function stageNormalize(carrier: PipelineCarrier): StageOutcome {
  const { raw, payloadDigest } = carrier;
  if (payloadDigest === null) {
    return { ok: false, stage: "normalize", reason: "payload-empty" };
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder().decode(raw.payload));
  } catch {
    return { ok: false, stage: "normalize", reason: "payload-not-json" };
  }
  if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
    return { ok: false, stage: "normalize", reason: "payload-not-object" };
  }
  const fields: Record<string, unknown> = {};
  for (const k of Object.keys(decoded as Record<string, unknown>).sort()) {
    fields[k] = (decoded as Record<string, unknown>)[k];
  }
  const canonicalDigest = createHash("sha256")
    .update(`${raw.tenantId}|${raw.deviceId}|${raw.seq}|${raw.observedAt}|${raw.kind}|${JSON.stringify(fields)}`)
    .digest("hex");
  return {
    ok: true,
    carrier: { ...carrier, stage: "dedup", normalizedFields: fields, canonicalDigest },
  };
}

// ---------------------------------------------------------------------------
// Stage 4: dedup — check the AdmissionStore view for prior (deviceId, seq).
// The carrier is unchanged when the item is a duplicate (the dedup signal is
// reflected in the final admission result via `ack.duplicate`).
// ---------------------------------------------------------------------------

export function stageDedup(carrier: PipelineCarrier, store: AdmissionStore): StageOutcome {
  const key = `${carrier.raw.deviceId}:${carrier.raw.seq}`;
  const existing = store.known.get(key);
  if (existing !== undefined) {
    // Duplicate (deviceId, seq) — pass through with `duplicate=true` so the
    // admit stage returns an idempotent ack.
    return { ok: true, carrier: { ...carrier, stage: "admit" } };
  }
  const last = store.lastSeq.get(carrier.raw.deviceId) ?? 0;
  if (carrier.raw.seq <= last) {
    // Non-monotonic for THIS device's seq timeline — refuse. (Caller may have
    // already acked a higher seq; this item is rejected, NOT silently dropped.)
    return { ok: false, stage: "dedup", reason: "non-monotonic-seq" };
  }
  return { ok: true, carrier: { ...carrier, stage: "admit" } };
}

// ---------------------------------------------------------------------------
// Stage 5: admit — the final stage. Delegates to the Wave 0 admitObservation
// which performs the idempotent (deviceId, seq) dedup + monotonic enforcement
// + duplicate ack semantics.
// ---------------------------------------------------------------------------

export type AdmitStageResult =
  | {
      readonly ok: true;
      readonly observation: Observation;
      readonly ack: AdmissionAck;
      readonly carrier: PipelineCarrier;
      readonly audit: AuditEventRef;
    }
  | { readonly ok: false; readonly stage: PipelineStage; readonly reason: StageFailureCode };

export function stageAdmit(carrier: PipelineCarrier, store: AdmissionStore): AdmitStageResult {
  const input: AdmissionInput = {
    tenantId: carrier.raw.tenantId,
    deviceId: carrier.raw.deviceId,
    seq: carrier.raw.seq,
    observedAt: carrier.raw.observedAt,
    kind: carrier.raw.kind,
    payload: carrier.raw.payload,
    admittedAt: carrier.receivedAt,
  };
  const r = admitObservation(store, input);
  if (!r.result.ok) {
    // Map the AdmissionRejectionCode to a stage failure code.
    const reason = mapAdmissionRejection(r.result.reason);
    return { ok: false, stage: "admit", reason };
  }
  const obs = r.result.observation;
  const ack = r.result.ack;
  const audit: AuditEventRef = {
    actor: carrier.raw.deviceId,
    intent: ack.duplicate ? "pipeline:admit:idempotent" : "pipeline:admit",
    tenant: carrier.raw.tenantId,
    timestamp: carrier.receivedAt,
    digest: digestOf(carrier.raw.deviceId, carrier.raw.seq, ack.payloadDigest, carrier.receivedAt),
  };
  return { ok: true, observation: obs, ack, carrier: { ...carrier, stage: "admit" }, audit };
}

function mapAdmissionRejection(code: AdmissionRejectionCode): StageFailureCode {
  switch (code) {
    case "missing-tenant-id": return "missing-tenant-id";
    case "missing-device-id": return "missing-device-id";
    case "non-monotonic-seq": return "non-monotonic-seq";
    case "duplicate-seq": return "duplicate-seq";
    case "invalid-observed-at": return "invalid-observed-at";
    case "malformed-payload": return "payload-empty";
    default: return "store-error";
  }
}

// ---------------------------------------------------------------------------
// runPipeline — runs all 5 stages over a single input. Returns the final
// outcome + the updated store + the metrics delta. The store is only updated
// on success (idempotent acks leave the store unchanged).
// ---------------------------------------------------------------------------

export type PipelineResult =
  | {
      readonly ok: true;
      readonly observation: Observation;
      readonly ack: AdmissionAck;
      readonly audit: AuditEventRef;
      readonly store: AdmissionStore;
      readonly metrics: StageMetrics;
    }
  | {
      readonly ok: false;
      readonly stage: PipelineStage;
      readonly reason: StageFailureCode;
      readonly store: AdmissionStore;
      readonly metrics: StageMetrics;
    };

export function runPipeline(
  store: AdmissionStore,
  metrics: StageMetrics,
  input: RawObservationInput,
): PipelineResult {
  const r1 = stageReceive(input);
  if (!r1.ok) {
    return { ok: false, stage: r1.stage, reason: r1.reason, store, metrics: incrementStageMetrics(metrics, "receive", 1) };
  }
  const m1 = { ...metrics, received: metrics.received + 1 };

  const r2 = stageValidate(r1.carrier);
  if (!r2.ok) {
    return { ok: false, stage: r2.stage, reason: r2.reason, store, metrics: incrementStageMetrics(m1, "validate", 1) };
  }
  const m2 = { ...m1, validated: m1.validated + 1 };

  const r3 = stageNormalize(r2.carrier);
  if (!r3.ok) {
    return { ok: false, stage: r3.stage, reason: r3.reason, store, metrics: incrementStageMetrics(m2, "normalize", 1) };
  }
  const m3 = { ...m2, normalized: m2.normalized + 1 };

  const r4 = stageDedup(r3.carrier, store);
  if (!r4.ok) {
    return { ok: false, stage: r4.stage, reason: r4.reason, store, metrics: incrementStageMetrics(m3, "dedup", 1) };
  }
  const m4 = { ...m3, deduped: m3.deduped + 1 };

  const r5 = stageAdmit(r4.carrier, store);
  if (!r5.ok) {
    return { ok: false, stage: r5.stage, reason: r5.reason, store, metrics: incrementStageMetrics(m4, "admit", 1) };
  }
  const m5 = { ...m4, admitted: m4.admitted + 1 };
  // admitObservation returns the next store (with the new entry) for fresh
  // admissions and the same store (untouched) for idempotent acks. Use it
  // directly so we never accidentally drop the new entry.
  return { ok: true, observation: r5.observation, ack: r5.ack, audit: r5.audit, store: r5.ack.duplicate ? store : rebuildStoreWith(store, r5.observation), metrics: m5 };
}

function rebuildStoreWith(store: AdmissionStore, obs: Observation): AdmissionStore {
  const key = `${obs.deviceId}:${obs.seq}`;
  const known = new Map(store.known);
  known.set(key, obs.id);
  const lastSeq = new Map(store.lastSeq);
  lastSeq.set(obs.deviceId, obs.seq as number);
  return { known, lastSeq };
}

// Batch admission — admit a batch of items, returning per-item acks. The
// batch is processed in order; each item's ack is independent. Failed items
// do not abort the batch — the per-item ack captures the failure.
// ---------------------------------------------------------------------------

export interface BatchAck {
  readonly index: number;
  readonly ok: boolean;
  readonly observationId?: string;
  readonly duplicate?: boolean;
  readonly stage?: PipelineStage;
  readonly reason?: StageFailureCode;
}

export interface BatchAdmitResult {
  readonly acks: ReadonlyArray<BatchAck>;
  readonly store: AdmissionStore;
  readonly metrics: StageMetrics;
}

export function admitBatch(
  store: AdmissionStore,
  metrics: StageMetrics,
  inputs: ReadonlyArray<RawObservationInput>,
): BatchAdmitResult {
  let s = store;
  let m = metrics;
  const acks: BatchAck[] = [];
  for (let i = 0; i < inputs.length; i++) {
    const r = runPipeline(s, m, inputs[i]!);
    m = r.metrics;
    if (r.ok) {
      s = r.store;
      acks.push({
        index: i,
        ok: true,
        observationId: r.observation.id,
        duplicate: r.ack.duplicate,
      });
    } else {
      acks.push({ index: i, ok: false, stage: r.stage, reason: r.reason });
    }
  }
  return { acks, store: s, metrics: m };
}
