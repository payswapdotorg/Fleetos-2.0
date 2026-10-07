/**
 * @fleetos/observations — Wave 2 ingestion pipeline tests (F220A).
 *
 * Covers:
 *   - pipeline stage failures (per-stage reason codes)
 *   - back-pressure honesty (refuse-and-retry, no silent drop)
 *   - batch admission with per-item acks
 *   - sha-256 raw payload digesting at receive time
 *   - retention/read-model projection contracts
 *   - immutable store + disposable projections
 */

import { describe, it, expect } from "vitest";
import {
  admitBatch,
  buildDeviceSummary,
  createInMemoryImmutableStore,
  defaultBackpressurePolicy,
  defaultRetentionPolicy,
  dequeue,
  enqueue,
  evaluateBackpressureLevel,
  emptyStageMetrics,
  incrementStageMetrics,
  projectionStale,
  runPipeline,
  stageAdmit,
  stageDedup,
  stageNormalize,
  stageReceive,
  stageValidate,
  type BackpressurePolicy,
  type RawObservationInput,
} from "./ingestion.js";
import { emptyAdmissionStore } from "./observations.js";

const NOW = 1_727_000_000_000;
const TENANT_A = "tnt_acme";
const TENANT_B = "tnt_other";
const DEV1 = "dev_truck-001";
const DEV2 = "dev_truck-002";

function raw(seq: number, opts: Partial<RawObservationInput> = {}): RawObservationInput {
  const payload = opts.payload ?? new TextEncoder().encode(`{"temp":${90 + seq}}`);
  return {
    tenantId: opts.tenantId ?? TENANT_A,
    deviceId: opts.deviceId ?? DEV1,
    seq: opts.seq ?? seq,
    observedAt: opts.observedAt ?? NOW + seq * 1000,
    kind: opts.kind ?? "telemetry.temp",
    payload,
    receivedAt: opts.receivedAt ?? NOW + seq,
  };
}

// ---------------------------------------------------------------------------
// Stage 1: receive
// ---------------------------------------------------------------------------

describe("ingestion stage: receive", () => {
  it("computes sha-256 digest at receive time (64-char hex)", () => {
    const r = stageReceive(raw(1, { payload: new TextEncoder().encode('{"temp":90}') }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // The boundary digest is computed at receive time — before any later stage
    // touches the payload. It is a 64-char sha-256 hex string.
    expect(r.carrier.payloadDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses missing tenantId", () => {
    const r = stageReceive(raw(1, { tenantId: "" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.stage).toBe("receive");
    expect(r.reason).toBe("missing-tenant-id");
  });

  it("refuses missing deviceId", () => {
    const r = stageReceive(raw(1, { deviceId: "" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("missing-device-id");
  });

  it("refuses empty payload", () => {
    const r = stageReceive(raw(1, { payload: new Uint8Array(0) }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("missing-payload");
  });

  it("refuses invalid observedAt (zero or negative)", () => {
    const r = stageReceive(raw(1, { observedAt: 0 }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("invalid-observed-at");
  });

  it("refuses invalid receivedAt", () => {
    const r = stageReceive(raw(1, { receivedAt: -1 }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("invalid-received-at");
  });

  it("digest is deterministic — same payload produces same digest", () => {
    const p = new TextEncoder().encode('{"temp":90}');
    const r1 = stageReceive(raw(1, { payload: p }));
    const r2 = stageReceive(raw(2, { payload: p }));
    if (!r1.ok || !r2.ok) throw new Error("stageReceive failed");
    expect(r1.carrier.payloadDigest).toBe(r2.carrier.payloadDigest);
  });

  it("digest changes when payload changes", () => {
    const r1 = stageReceive(raw(1, { payload: new TextEncoder().encode('{"temp":90}') }));
    const r2 = stageReceive(raw(1, { payload: new TextEncoder().encode('{"temp":91}') }));
    if (!r1.ok || !r2.ok) throw new Error("stageReceive failed");
    expect(r1.carrier.payloadDigest).not.toBe(r2.carrier.payloadDigest);
  });
});

// ---------------------------------------------------------------------------
// Stage 2: validate
// ---------------------------------------------------------------------------

describe("ingestion stage: validate", () => {
  it("accepts a known kind prefix", () => {
    const r1 = stageReceive(raw(1));
    if (!r1.ok) throw new Error();
    const r2 = stageValidate(r1.carrier);
    expect(r2.ok).toBe(true);
  });

  it("refuses missing kind", () => {
    const r1 = stageReceive(raw(1));
    if (!r1.ok) throw new Error();
    const r2 = stageValidate({ ...r1.carrier, raw: { ...r1.carrier.raw, kind: "" } });
    expect(r2.ok).toBe(false);
    if (r2.ok) return;
    expect(r2.reason).toBe("missing-kind");
  });

  it("refuses unknown kind prefix", () => {
    const r1 = stageReceive(raw(1));
    if (!r1.ok) throw new Error();
    const r2 = stageValidate({ ...r1.carrier, raw: { ...r1.carrier.raw, kind: "unknown.thing" } });
    expect(r2.ok).toBe(false);
    if (r2.ok) return;
    expect(r2.reason).toBe("unknown-kind");
  });

  it("refuses invalid seq (zero or negative)", () => {
    const r1 = stageReceive(raw(0));
    if (!r1.ok) throw new Error();
    const r2 = stageValidate({ ...r1.carrier, raw: { ...r1.carrier.raw, seq: 0 } });
    expect(r2.ok).toBe(false);
    if (r2.ok) return;
    expect(r2.reason).toBe("invalid-seq");
  });
});

// ---------------------------------------------------------------------------
// Stage 3: normalize
// ---------------------------------------------------------------------------

describe("ingestion stage: normalize", () => {
  it("decodes JSON payload into canonical fields", () => {
    const r1 = stageReceive(raw(1, { payload: new TextEncoder().encode('{"b":1,"a":2}') }));
    if (!r1.ok) throw new Error();
    const r2 = stageValidate(r1.carrier);
    if (!r2.ok) throw new Error();
    const r3 = stageNormalize(r2.carrier);
    expect(r3.ok).toBe(true);
    if (!r3.ok) return;
    expect(r3.carrier.normalizedFields).toEqual({ a: 2, b: 1 });
    expect(r3.carrier.canonicalDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses payload-not-json", () => {
    const r1 = stageReceive(raw(1, { payload: new TextEncoder().encode("not-json") }));
    if (!r1.ok) throw new Error();
    const r2 = stageValidate(r1.carrier);
    if (!r2.ok) throw new Error();
    const r3 = stageNormalize(r2.carrier);
    expect(r3.ok).toBe(false);
    if (r3.ok) return;
    expect(r3.reason).toBe("payload-not-json");
  });

  it("refuses payload-not-object (array)", () => {
    const r1 = stageReceive(raw(1, { payload: new TextEncoder().encode("[1,2,3]") }));
    if (!r1.ok) throw new Error();
    const r2 = stageValidate(r1.carrier);
    if (!r2.ok) throw new Error();
    const r3 = stageNormalize(r2.carrier);
    expect(r3.ok).toBe(false);
    if (r3.ok) return;
    expect(r3.reason).toBe("payload-not-object");
  });

  it("canonical digest is deterministic — identical inputs produce same digest", () => {
    const p = new TextEncoder().encode('{"a":1,"b":2}');
    // Same payload + same seq + same observedAt -> same canonical digest.
    const r1 = stageReceive(raw(1, { payload: p, observedAt: NOW }));
    const r2 = stageReceive(raw(1, { payload: p, observedAt: NOW }));
    if (!r1.ok || !r2.ok) throw new Error();
    const v1 = stageValidate(r1.carrier);
    const v2 = stageValidate(r2.carrier);
    if (!v1.ok || !v2.ok) throw new Error();
    const n1 = stageNormalize(v1.carrier);
    const n2 = stageNormalize(v2.carrier);
    if (!n1.ok || !n2.ok) throw new Error();
    expect(n1.carrier.canonicalDigest).toBe(n2.carrier.canonicalDigest);
  });

  it("canonical digest changes when seq changes (seq is part of the digest input)", () => {
    const p = new TextEncoder().encode('{"a":1,"b":2}');
    const r1 = stageReceive(raw(1, { payload: p }));
    const r2 = stageReceive(raw(2, { payload: p }));
    if (!r1.ok || !r2.ok) throw new Error();
    const v1 = stageValidate(r1.carrier);
    const v2 = stageValidate(r2.carrier);
    if (!v1.ok || !v2.ok) throw new Error();
    const n1 = stageNormalize(v1.carrier);
    const n2 = stageNormalize(v2.carrier);
    if (!n1.ok || !n2.ok) throw new Error();
    expect(n1.carrier.canonicalDigest).not.toBe(n2.carrier.canonicalDigest);
  });
});

// ---------------------------------------------------------------------------
// Stage 4: dedup
// ---------------------------------------------------------------------------

describe("ingestion stage: dedup", () => {
  it("passes a fresh (deviceId, seq) through", () => {
    const r1 = stageReceive(raw(1));
    if (!r1.ok) throw new Error();
    const r2 = stageValidate(r1.carrier);
    if (!r2.ok) throw new Error();
    const r3 = stageNormalize(r2.carrier);
    if (!r3.ok) throw new Error();
    const store = emptyAdmissionStore();
    const r4 = stageDedup(r3.carrier, store);
    expect(r4.ok).toBe(true);
  });

  it("passes a duplicate (deviceId, seq) through to admit (idempotent ack handled there)", () => {
    const r1 = stageReceive(raw(1));
    if (!r1.ok) throw new Error();
    const r2 = stageValidate(r1.carrier);
    if (!r2.ok) throw new Error();
    const r3 = stageNormalize(r2.carrier);
    if (!r3.ok) throw new Error();
    const store = emptyAdmissionStore();
    // Pre-populate the store with this seq.
    const r4a = stageDedup(r3.carrier, store);
    if (!r4a.ok) throw new Error();
    const r5a = stageAdmit(r4a.carrier, store);
    if (!r5a.ok) throw new Error();
    // Now dedup a second carrier with the same seq — should pass through.
    const r4b = stageDedup(r3.carrier, r5a.observation.id ? withStore(r5a.observation.deviceId, r5a.observation.seq as number, r5a.observation.id) : store);
    expect(r4b.ok).toBe(true);
  });

  it("refuses non-monotonic seq for the device", () => {
    const r1 = stageReceive(raw(1));
    if (!r1.ok) throw new Error();
    const r2 = stageValidate(r1.carrier);
    if (!r2.ok) throw new Error();
    const r3 = stageNormalize(r2.carrier);
    if (!r3.ok) throw new Error();
    // A store that has already seen seq=5 for this device.
    const store = emptyAdmissionStore();
    const known = new Map(store.known);
    known.set(`${DEV1}:5`, "obs_xxx" as never);
    const lastSeq = new Map(store.lastSeq);
    lastSeq.set(DEV1, 5);
    const r4 = stageDedup(r3.carrier, { known, lastSeq });
    expect(r4.ok).toBe(false);
    if (r4.ok) return;
    expect(r4.reason).toBe("non-monotonic-seq");
  });
});

function withStore(deviceId: string, seq: number, id: string): import("./observations.js").AdmissionStore {
  const known = new Map<string, import("./observations.js").ObservationId>();
  known.set(`${deviceId}:${seq}`, id as never);
  const lastSeq = new Map<string, number>();
  lastSeq.set(deviceId, seq);
  return { known, lastSeq };
}

// ---------------------------------------------------------------------------
// runPipeline — end-to-end
// ---------------------------------------------------------------------------

describe("ingestion pipeline: end-to-end", () => {
  it("admits a fresh observation, returns ack + audit + updated store", () => {
    const store = emptyAdmissionStore();
    const metrics = emptyStageMetrics();
    const r = runPipeline(store, metrics, raw(1));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.observation.id).toMatch(/^obs_/);
    expect(r.ack.duplicate).toBe(false);
    expect(r.audit.intent).toBe("pipeline:admit");
    expect(r.audit.tenant).toBe(TENANT_A);
    expect(r.metrics.received).toBe(1);
    expect(r.metrics.validated).toBe(1);
    expect(r.metrics.normalized).toBe(1);
    expect(r.metrics.deduped).toBe(1);
    expect(r.metrics.admitted).toBe(1);
  });

  it("second admission of the same (deviceId, seq) is idempotent (ack duplicate)", () => {
    const store = emptyAdmissionStore();
    const metrics = emptyStageMetrics();
    const r1 = runPipeline(store, metrics, raw(1));
    if (!r1.ok) throw new Error();
    const r2 = runPipeline(r1.store, r1.metrics, raw(1));
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.ack.duplicate).toBe(true);
    expect(r2.ack.id).toBe(r1.ack.id);
    expect(r2.audit.intent).toBe("pipeline:admit:idempotent");
    // The store is unchanged on idempotent acks.
    expect(r2.store).toBe(r1.store);
  });

  it("failure at receive increments failedByStage.receive and returns the store unchanged", () => {
    const store = emptyAdmissionStore();
    const metrics = emptyStageMetrics();
    const r = runPipeline(store, metrics, raw(1, { tenantId: "" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.stage).toBe("receive");
    expect(r.reason).toBe("missing-tenant-id");
    expect(r.store).toBe(store);
    expect(r.metrics.failedByStage.receive).toBe(1);
  });

  it("failure at validate increments failedByStage.validate", () => {
    const store = emptyAdmissionStore();
    const r = runPipeline(store, emptyStageMetrics(), raw(1, { kind: "unknown.thing" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.stage).toBe("validate");
    expect(r.reason).toBe("unknown-kind");
    expect(r.metrics.received).toBe(1); // received incremented before validate failed
    expect(r.metrics.failedByStage.validate).toBe(1);
  });

  it("failure at normalize increments failedByStage.normalize", () => {
    const store = emptyAdmissionStore();
    const r = runPipeline(store, emptyStageMetrics(), raw(1, { payload: new TextEncoder().encode("not-json") }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.stage).toBe("normalize");
    expect(r.metrics.failedByStage.normalize).toBe(1);
  });

  it("failure at dedup (non-monotonic) increments failedByStage.dedup", () => {
    const known = new Map<string, import("./observations.js").ObservationId>();
    known.set(`${DEV1}:5`, "obs_xxx" as never);
    const lastSeq = new Map<string, number>([[DEV1, 5]]);
    const r = runPipeline({ known, lastSeq }, emptyStageMetrics(), raw(1));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.stage).toBe("dedup");
    expect(r.reason).toBe("non-monotonic-seq");
    expect(r.metrics.failedByStage.dedup).toBe(1);
  });

  it("metrics are deterministic for identical input sequences", () => {
    const store1 = emptyAdmissionStore();
    const store2 = emptyAdmissionStore();
    const r1 = runPipeline(store1, emptyStageMetrics(), raw(1));
    const r2 = runPipeline(store2, emptyStageMetrics(), raw(1));
    if (!r1.ok || !r2.ok) throw new Error();
    expect(r1.metrics).toEqual(r2.metrics);
  });
});

// ---------------------------------------------------------------------------
// Back-pressure policy — bounded queues with explicit overflow behavior.
// NEVER silent drop. refuse-and-retry is the default policy.
// ---------------------------------------------------------------------------

describe("ingestion back-pressure policy", () => {
  const policy: BackpressurePolicy = {
    maxQueueDepth: 5,
    warnDepth: 2,
    criticalDepth: 4,
    overflow: "refuse",
  };

  it("enqueues items below warn depth with signal=ok", () => {
    const r = enqueue({ depth: 0, refused: 0, shed: 0 }, policy);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.signal).toBe("ok");
    expect(r.queue.depth).toBe(1);
  });

  it("enqueues items at warn depth with signal=warn", () => {
    const r = enqueue({ depth: 1, refused: 0, shed: 0 }, policy);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.signal).toBe("warn");
  });

  it("enqueues items at critical depth with signal=critical", () => {
    const r = enqueue({ depth: 3, refused: 0, shed: 0 }, policy);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.signal).toBe("critical");
  });

  it("refuses when queue is full (refuse-and-retry, NO silent drop)", () => {
    const r = enqueue({ depth: 5, refused: 0, shed: 0 }, policy);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("overflow-refused");
    expect(r.queue.refused).toBe(1);
  });

  it("shed-oldest policy evicts the oldest item to make room (recorded as shed, not silent)", () => {
    const shedPolicy: BackpressurePolicy = { ...policy, overflow: "shed-oldest" };
    const r = enqueue({ depth: 5, refused: 0, shed: 0 }, shedPolicy);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.queue.shed).toBe(1); // shed is recorded — never silent
  });

  it("dequeue decrements depth", () => {
    const s = dequeue({ depth: 3, refused: 0, shed: 0 });
    expect(s.depth).toBe(2);
  });

  it("dequeue does not underflow (depth clamped at 0)", () => {
    const s = dequeue({ depth: 0, refused: 0, shed: 0 });
    expect(s.depth).toBe(0);
  });

  it("evaluateBackpressureLevel returns ok/warn/critical at the right depths", () => {
    expect(evaluateBackpressureLevel(0, policy)).toBe("ok");
    expect(evaluateBackpressureLevel(2, policy)).toBe("warn");
    expect(evaluateBackpressureLevel(4, policy)).toBe("critical");
  });

  it("default policy has sensible thresholds", () => {
    const p = defaultBackpressurePolicy();
    expect(p.maxQueueDepth).toBeGreaterThan(0);
    expect(p.warnDepth).toBeLessThan(p.criticalDepth);
    expect(p.criticalDepth).toBeLessThanOrEqual(p.maxQueueDepth);
    expect(p.overflow).toBe("refuse");
  });

  it("refuse-and-retry does not silently drop — the caller receives a typed decision", () => {
    const full = { depth: policy.maxQueueDepth, refused: 0, shed: 0 };
    const r = enqueue(full, policy);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    // The decision explicitly tells the caller to retry. The item is NOT
    // silently dropped — the caller knows it was refused.
    expect(r.reason).toBe("overflow-refused");
    expect(r.queue.refused).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Batch admission with per-item acks.
// ---------------------------------------------------------------------------

describe("ingestion batch admission", () => {
  it("admits a batch with per-item acks (all succeed)", () => {
    const store = emptyAdmissionStore();
    const r = admitBatch(store, emptyStageMetrics(), [raw(1), raw(2), raw(3)]);
    expect(r.acks).toHaveLength(3);
    expect(r.acks.every((a) => a.ok)).toBe(true);
    expect(r.acks[0]!.observationId).not.toBe(r.acks[1]!.observationId);
    expect(r.metrics.admitted).toBe(3);
  });

  it("per-item acks are independent — failed items do not abort the batch", () => {
    const store = emptyAdmissionStore();
    const r = admitBatch(store, emptyStageMetrics(), [
      raw(1),
      raw(1, { tenantId: "" }), // missing-tenant-id -> receive failure
      raw(2),
    ]);
    expect(r.acks[0]!.ok).toBe(true);
    expect(r.acks[1]!.ok).toBe(false);
    if (r.acks[1]!.ok) return;
    expect(r.acks[1]!.stage).toBe("receive");
    expect(r.acks[1]!.reason).toBe("missing-tenant-id");
    expect(r.acks[2]!.ok).toBe(true);
  });

  it("duplicate items in the batch produce per-item duplicate acks", () => {
    const store = emptyAdmissionStore();
    const r = admitBatch(store, emptyStageMetrics(), [raw(1), raw(1), raw(2)]);
    expect(r.acks[0]!.duplicate).toBe(false);
    expect(r.acks[1]!.duplicate).toBe(true);
    expect(r.acks[2]!.duplicate).toBe(false);
  });

  it("acks carry the index of the input", () => {
    const store = emptyAdmissionStore();
    const r = admitBatch(store, emptyStageMetrics(), [raw(1), raw(2)]);
    expect(r.acks[0]!.index).toBe(0);
    expect(r.acks[1]!.index).toBe(1);
  });

  it("batch over multiple devices is processed in order with per-device monotonic enforcement", () => {
    const store = emptyAdmissionStore();
    const r = admitBatch(store, emptyStageMetrics(), [
      raw(1, { deviceId: DEV1 }),
      raw(1, { deviceId: DEV2 }),
      raw(2, { deviceId: DEV1 }),
      raw(2, { deviceId: DEV2 }),
    ]);
    expect(r.acks.every((a) => a.ok)).toBe(true);
  });

  it("batch with non-monotonic seq for a device is rejected at dedup for that item only", () => {
    const store = emptyAdmissionStore();
    const r = admitBatch(store, emptyStageMetrics(), [
      raw(5, { deviceId: DEV1 }),
      raw(3, { deviceId: DEV1 }), // non-monotonic — fails at dedup
      raw(6, { deviceId: DEV1 }),
    ]);
    expect(r.acks[0]!.ok).toBe(true);
    expect(r.acks[1]!.ok).toBe(false);
    if (r.acks[1]!.ok) return;
    expect(r.acks[1]!.stage).toBe("dedup");
    expect(r.acks[1]!.reason).toBe("non-monotonic-seq");
    expect(r.acks[2]!.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Retention / read-model projection contracts.
// ---------------------------------------------------------------------------

describe("ingestion retention + projections", () => {
  it("createInMemoryImmutableStore is initially empty", () => {
    const s = createInMemoryImmutableStore();
    expect(s.size).toBe(0);
    expect(s.lastSeqForDevice(DEV1)).toBe(0);
    expect(s.listByDevice(TENANT_A, DEV1)).toHaveLength(0);
  });

  it("append + findByKey returns the observation by tenant+device+seq", () => {
    const s = createInMemoryImmutableStore();
    const store = emptyAdmissionStore();
    const r = runPipeline(store, emptyStageMetrics(), raw(1));
    if (!r.ok) throw new Error();
    s.append(r.observation);
    expect(s.size).toBe(1);
    const found = s.findByKey(TENANT_A, DEV1, 1);
    expect(found).not.toBeNull();
    expect(found?.id).toBe(r.observation.id);
  });

  it("append is idempotent — re-appending the same observation does not duplicate", () => {
    const s = createInMemoryImmutableStore();
    const store = emptyAdmissionStore();
    const r = runPipeline(store, emptyStageMetrics(), raw(1));
    if (!r.ok) throw new Error();
    s.append(r.observation);
    s.append(r.observation);
    expect(s.size).toBe(1);
  });

  it("findByKey is tenant fail-closed — cross-tenant returns null", () => {
    const s = createInMemoryImmutableStore();
    const store = emptyAdmissionStore();
    const r = runPipeline(store, emptyStageMetrics(), raw(1, { tenantId: TENANT_A }));
    if (!r.ok) throw new Error();
    s.append(r.observation);
    expect(s.findByKey(TENANT_B, DEV1, 1)).toBeNull();
  });

  it("listByDevice is tenant fail-closed — cross-tenant returns empty", () => {
    const s = createInMemoryImmutableStore();
    const store = emptyAdmissionStore();
    const r = runPipeline(store, emptyStageMetrics(), raw(1, { tenantId: TENANT_A }));
    if (!r.ok) throw new Error();
    s.append(r.observation);
    expect(s.listByDevice(TENANT_B, DEV1)).toHaveLength(0);
  });

  it("buildDeviceSummary produces a projection with deterministic sourceHash", () => {
    const s = createInMemoryImmutableStore();
    const store = emptyAdmissionStore();
    const r1 = runPipeline(store, emptyStageMetrics(), raw(1, { kind: "telemetry.temp" }));
    if (!r1.ok) throw new Error();
    s.append(r1.observation);
    const r2 = runPipeline(r1.store, r1.metrics, raw(2, { kind: "telemetry.humid" }));
    if (!r2.ok) throw new Error();
    s.append(r2.observation);

    const p1 = buildDeviceSummary(s, TENANT_A, DEV1, NOW);
    const p2 = buildDeviceSummary(s, TENANT_A, DEV1, NOW);
    expect(p1.count).toBe(2);
    expect(p1.lastSeq).toBe(2);
    expect(p1.kinds).toEqual(["telemetry.humid", "telemetry.temp"]);
    // Same source -> same sourceHash (deterministic).
    expect(p1.meta.sourceHash).toBe(p2.meta.sourceHash);
  });

  it("projection sourceHash changes when the source changes", () => {
    const s = createInMemoryImmutableStore();
    const r1 = runPipeline(emptyAdmissionStore(), emptyStageMetrics(), raw(1));
    if (!r1.ok) throw new Error();
    s.append(r1.observation);
    const p1 = buildDeviceSummary(s, TENANT_A, DEV1, NOW);

    const r2 = runPipeline(r1.store, r1.metrics, raw(2));
    if (!r2.ok) throw new Error();
    s.append(r2.observation);
    const p2 = buildDeviceSummary(s, TENANT_A, DEV1, NOW + 1000);

    expect(p1.meta.sourceHash).not.toBe(p2.meta.sourceHash);
    expect(p2.count).toBe(2);
  });

  it("projectionStale returns true after the projection TTL elapses", () => {
    const policy = defaultRetentionPolicy();
    const builtAt = NOW;
    const stale = projectionStale(
      { id: "x", kind: "device-summary", tenantId: TENANT_A, builtAt, sourceHash: "h" },
      builtAt + policy.projectionTtlMs + 1,
      policy,
    );
    expect(stale).toBe(true);
  });

  it("projectionStale returns false within the TTL", () => {
    const policy = defaultRetentionPolicy();
    const builtAt = NOW;
    const stale = projectionStale(
      { id: "x", kind: "device-summary", tenantId: TENANT_A, builtAt, sourceHash: "h" },
      builtAt + policy.projectionTtlMs - 1,
      policy,
    );
    expect(stale).toBe(false);
  });

  it("retention policy default keeps the immutable store forever (TTL null)", () => {
    expect(defaultRetentionPolicy().immutableStoreTtl).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// StageMetrics helper tests
// ---------------------------------------------------------------------------

describe("ingestion stage metrics helpers", () => {
  it("emptyStageMetrics starts at zero for every stage", () => {
    const m = emptyStageMetrics();
    expect(m.received).toBe(0);
    expect(m.admitted).toBe(0);
    expect(m.failedByStage.receive).toBe(0);
    expect(m.failedByStage.validate).toBe(0);
    expect(m.failedByStage.normalize).toBe(0);
    expect(m.failedByStage.dedup).toBe(0);
    expect(m.failedByStage.admit).toBe(0);
  });

  it("incrementStageMetrics adds to the named stage only", () => {
    const m1 = emptyStageMetrics();
    const m2 = incrementStageMetrics(m1, "validate", 3);
    expect(m2.failedByStage.validate).toBe(3);
    expect(m2.failedByStage.receive).toBe(0);
    expect(m1.failedByStage.validate).toBe(0); // immutable — original unchanged
  });
});
