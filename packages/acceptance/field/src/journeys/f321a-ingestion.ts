/**
 * @fleetos/acceptance-field — F321A journeys: the edge-ingestion family
 * (Wave 12 lane A). Slots 14 (store-and-forward redelivery), 15 (offline
 * buffer capture/replay) and 21-SUBSTITUTE (ingestion admission discipline —
 * the F310C §3.6-named mining area's public surface; ADCOS is
 * CONTRACT_ONLY / provider-not-ready and is NOT driven anywhere).
 *
 * Pure DATA journeys over the F321A typed operations; the deterministic
 * runner executes them against the REAL public APIs. All expected values are
 * pre-declared REAL domain outcomes (never recorded observations).
 */

import type { AcceptanceJourney } from "../journey-contracts.js";
import { FOREIGN_TENANT, T0 } from "../fixtures.js";

const AGENT_KEY = "agent-key-field-01";
const SF_DEVICE = "dev_gate-3003";

export const storeAndForwardRedeliveryJourney: AcceptanceJourney = {
  id: "store-and-forward-redelivery",
  persona: "field-technician",
  capability: "connectivity",
  goal: "Redeliver the edge agent's signed observation bundles: the first reception admits, a re-delivery is an idempotent duplicate, a missing bundle surfaces an honest gap, and forged/tampered bundles are refused.",
  steps: [
    { id: "t1", summary: "admit the conveyor asset", op: { kind: "asset.admit", assetId: "ast_conveyor-delta-04", assetKind: "fixed", displayName: "Conveyor Delta 04" } },
    { id: "t2", summary: "enroll the edge gateway", op: { kind: "device.enroll", deviceId: SF_DEVICE, assetId: "ast_conveyor-delta-04", serial: "SN-3003" } },
    {
      id: "t3",
      summary: "the agent signs bundle 1 (two telemetry observations)",
      op: {
        kind: "storeforward.sign", bundleId: "bnd_shift-0001", deviceId: SF_DEVICE, seq: 1, agentKey: AGENT_KEY,
        entries: [
          { seq: 1, observedAt: T0 + 1_000, observationKind: "telemetry.temp", payload: { temp: 41 } },
          { seq: 2, observedAt: T0 + 2_000, observationKind: "telemetry.temp", payload: { temp: 42 } },
        ],
      },
    },
    { id: "t4", summary: "first reception admits both observations through the real pipeline", op: { kind: "storeforward.receive", bundleId: "bnd_shift-0001", agentKey: AGENT_KEY } },
    { id: "t5", summary: "re-delivery of the same bundle is an idempotent duplicate (nothing re-admitted)", op: { kind: "storeforward.receive", bundleId: "bnd_shift-0001", agentKey: AGENT_KEY } },
    {
      id: "t6",
      summary: "the agent signs bundle 3 (bundle 2 was lost in transit)",
      op: {
        kind: "storeforward.sign", bundleId: "bnd_shift-0003", deviceId: SF_DEVICE, seq: 3, agentKey: AGENT_KEY,
        entries: [
          { seq: 3, observedAt: T0 + 3_000, observationKind: "telemetry.temp", payload: { temp: 43 } },
          { seq: 4, observedAt: T0 + 4_000, observationKind: "telemetry.temp", payload: { temp: 44 } },
        ],
      },
    },
    { id: "t7", summary: "receiving bundle 3 surfaces the missing bundle 2 as an honest gap", op: { kind: "storeforward.receive", bundleId: "bnd_shift-0003", agentKey: AGENT_KEY } },
    { id: "t8", summary: "the sequence report names the known gap and the next expected bundle", op: { kind: "storeforward.sequence-report", deviceId: SF_DEVICE } },
    {
      id: "t9",
      summary: "the agent signs bundle 4 (its signature is internally consistent — the forgery probe is the KEY at reception)",
      op: {
        kind: "storeforward.sign", bundleId: "bnd_shift-0004", deviceId: SF_DEVICE, seq: 4, agentKey: AGENT_KEY,
        entries: [{ seq: 5, observedAt: T0 + 5_000, observationKind: "telemetry.temp", payload: { temp: 45 } }],
      },
    },
    { id: "t10", summary: "receive bundle 4 with a forged key (signature-invalid)", expectRefusal: true, op: { kind: "storeforward.receive-forged", bundleId: "bnd_shift-0004" } },
    {
      id: "t11",
      summary: "the agent signs bundle 5",
      op: {
        kind: "storeforward.sign", bundleId: "bnd_shift-0005", deviceId: SF_DEVICE, seq: 5, agentKey: AGENT_KEY,
        entries: [
          { seq: 6, observedAt: T0 + 6_000, observationKind: "telemetry.temp", payload: { temp: 46 } },
          { seq: 7, observedAt: T0 + 7_000, observationKind: "telemetry.temp", payload: { temp: 47 } },
        ],
      },
    },
    { id: "t12", summary: "a tampered observation payload digest must be refused (integrity-invalid)", expectRefusal: true, op: { kind: "storeforward.receive-tampered", bundleId: "bnd_shift-0005", observationIndex: 0 } },
  ],
  assertions: [
    { id: "s1", description: "the signed bundle's signature verifies against the agent key", reading: "t3.sf.signatureVerified", op: "deep-equals", expected: true },
    { id: "s2", description: "the signed bundle's integrity digest verifies", reading: "t3.sf.integrityVerified", op: "deep-equals", expected: true },
    { id: "s3", description: "the forged bundle was also signed consistently (the forgery is the KEY, not the digest)", reading: "t9.sf.signatureVerified", op: "deep-equals", expected: true },
    { id: "s4", description: "first reception is not a duplicate", reading: "t4.sf.ack.duplicate", op: "deep-equals", expected: false },
    { id: "s5", description: "first reception admitted both observations", reading: "t4.sf.ack.admittedCount", op: "deep-equals", expected: 2 },
    { id: "s6", description: "the real pipeline admitted both observations", reading: "t4.sf.pipelineAdmitted", op: "deep-equals", expected: 2 },
    { id: "s7", description: "first reception had no gaps", reading: "t4.sf.ack.gapSeqs", op: "deep-equals", expected: [] },
    { id: "s8", description: "re-delivery is flagged duplicate", reading: "t5.sf.ack.duplicate", op: "deep-equals", expected: true },
    { id: "s9", description: "re-delivery admits nothing", reading: "t5.sf.ack.admittedCount", op: "deep-equals", expected: 0 },
    { id: "s10", description: "re-delivery counts both as duplicates", reading: "t5.sf.ack.duplicateCount", op: "deep-equals", expected: 2 },
    { id: "s11", description: "re-delivery re-runs no pipeline admission", reading: "t5.sf.pipelineAdmitted", op: "deep-equals", expected: 0 },
    { id: "s12", description: "the missing bundle 2 surfaces as a gap marker", reading: "t7.sf.ack.gapSeqs", op: "deep-equals", expected: [2] },
    { id: "s13", description: "the gap audit intent is the with-gaps one", reading: "t7.sf.auditIntent", op: "deep-equals", expected: "observations:bundle:receive:with-gaps" },
    { id: "s14", description: "bundle 3's fresh observations still admitted through the pipeline", reading: "t7.sf.pipelineAdmitted", op: "deep-equals", expected: 2 },
    { id: "s15", description: "the sequence report sees bundle 3 as last received", reading: "t8.seq.lastReceived", op: "deep-equals", expected: 3 },
    { id: "s16", description: "the sequence report expects bundle 4 next", reading: "t8.seq.expectedNext", op: "deep-equals", expected: 4 },
    { id: "s17", description: "the sequence report names the known gap", reading: "t8.seq.knownGaps", op: "deep-equals", expected: [2] },
    { id: "s18", description: "the forged-key reception is refused signature-invalid", reading: "t10.sf.refused", op: "deep-equals", expected: "signature-invalid" },
    { id: "s19", description: "the tampered-payload reception is refused integrity-invalid", reading: "t12.sf.refused", op: "deep-equals", expected: "integrity-invalid" },
  ],
};

const OB_DEVICE = "dev_gate-4004";

export const offlineBufferCaptureReplayJourney: AcceptanceJourney = {
  id: "offline-buffer-capture-replay",
  persona: "edge-operator",
  capability: "field-mode",
  goal: "Capture work entries while the gateway is offline, replay them strictly in capture order after reconnection (divergence recorded, never hidden), and sweep expired entries with reason-coded eviction.",
  steps: [
    { id: "t1", summary: "open the device's offline buffer (bounded: 3 entries, 10-minute TTL, drop-oldest)", op: { kind: "offline.open-buffer", deviceId: OB_DEVICE, maxEntries: 3, ttlMs: 600_000, overflow: "drop-oldest" } },
    { id: "t2", summary: "capture entry 1 while offline", op: { kind: "offline.capture", deviceId: OB_DEVICE, entryId: "oe_gate-0001", entryKind: "work-order.checklist", payload: { step: 1 }, posture: "offline", at: T0 + 1_000 } },
    { id: "t3", summary: "capture entry 2 while offline", op: { kind: "offline.capture", deviceId: OB_DEVICE, entryId: "oe_gate-0002", entryKind: "work-order.checklist", payload: { step: 2 }, posture: "offline", at: T0 + 2_000 } },
    { id: "t4", summary: "capture entry 3 while degraded (divergence seed)", op: { kind: "offline.capture", deviceId: OB_DEVICE, entryId: "oe_gate-0003", entryKind: "sensor.reading", payload: { pressure: 6.1 }, posture: "degraded", at: T0 + 3_000 } },
    { id: "t5", summary: "capture entry 4 under pressure: the oldest is evicted and SURFACED", op: { kind: "offline.capture", deviceId: OB_DEVICE, entryId: "oe_gate-0004", entryKind: "work-order.checklist", payload: { step: 4 }, posture: "offline", at: T0 + 4_000 } },
    {
      id: "t6",
      summary: "a duplicate entry id must be refused",
      expectRefusal: true,
      op: { kind: "offline.capture", deviceId: OB_DEVICE, entryId: "oe_gate-0002", entryKind: "work-order.checklist", payload: { step: 2 }, posture: "offline", at: T0 + 5_000 },
    },
    {
      id: "t7",
      summary: "a capture scoped to a FOREIGN tenant must be refused (fail-closed)",
      expectRefusal: true,
      op: { kind: "offline.capture", deviceId: OB_DEVICE, entryId: "oe_gate-0009", entryKind: "work-order.checklist", payload: { step: 9 }, posture: "offline", at: T0 + 5_000, tenantId: FOREIGN_TENANT },
    },
    { id: "t8", summary: "the posture transitions observed while entries waited are stamped", op: { kind: "offline.stamp-posture", deviceId: OB_DEVICE, from: "offline", to: "degraded", at: T0 + 6_000 } },
    { id: "t9", summary: "the gateway reconnects (stamped transition)", op: { kind: "offline.stamp-posture", deviceId: OB_DEVICE, from: "degraded", to: "connected", at: T0 + 7_000 } },
    { id: "t10", summary: "an expiry sweep BEFORE the TTL holds every entry", op: { kind: "offline.sweep", deviceId: OB_DEVICE, now: T0 + 100_000 } },
    { id: "t11", summary: "replay after reconnection: strict capture order, divergences recorded", op: { kind: "offline.replay", deviceId: OB_DEVICE, posture: "connected", now: T0 + 110_000 } },
    { id: "t12", summary: "the expiry sweep at T0+603500 evicts the two oldest entries (boundary-inclusive law)", op: { kind: "offline.sweep", deviceId: OB_DEVICE, now: T0 + 603_500 } },
  ],
  assertions: [
    { id: "o1", description: "the buffer opens empty with the declared bound", reading: "t1.buffer.maxEntries", op: "deep-equals", expected: 3 },
    { id: "o2", description: "entry 1 captures at sequence 1", reading: "t2.entry.sequence", op: "deep-equals", expected: 1 },
    { id: "o3", description: "entry 3 fills the buffer to its bound", reading: "t4.buffer.count", op: "deep-equals", expected: 3 },
    { id: "o4", description: "the pressured capture evicts the OLDEST entry (oe_gate-0001) and surfaces it", reading: "t5.buffer.evictedId", op: "deep-equals", expected: "oe_gate-0001" },
    { id: "o5", description: "the drop-oldest counter is honest", reading: "t5.buffer.droppedOldest", op: "deep-equals", expected: 1 },
    { id: "o6", description: "the buffer stays at its bound after the pressured capture", reading: "t5.buffer.count", op: "deep-equals", expected: 3 },
    { id: "o7", description: "a duplicate entry id is refused", reading: "t6.offline.refused", op: "deep-equals", expected: "duplicate-entry-id" },
    { id: "o8", description: "a foreign-tenant capture is refused", reading: "t7.offline.refused", op: "deep-equals", expected: "tenant-mismatch" },
    { id: "o9", description: "the entry captured degraded carries its capture posture", reading: "t4.entry.capturedPosture", op: "deep-equals", expected: "degraded" },
    { id: "o10", description: "both posture transitions are stamped in the log", reading: "t9.posture.transitions", op: "deep-equals", expected: 2 },
    { id: "o11", description: "the pre-TTL sweep evicts nothing", reading: "t10.sweep.evictedIds", op: "deep-equals", expected: [] },
    { id: "o12", description: "the pre-TTL sweep keeps every entry", reading: "t10.sweep.remaining", op: "deep-equals", expected: 3 },
    { id: "o13", description: "replay emits strictly in capture (FIFO) order", reading: "t11.replay.order", op: "deep-equals", expected: ["oe_gate-0002", "oe_gate-0003", "oe_gate-0004"] },
    { id: "o14", description: "every entry was captured under a different posture than the replay posture", reading: "t11.replay.divergenceIds", op: "deep-equals", expected: ["oe_gate-0002", "oe_gate-0003", "oe_gate-0004"] },
    { id: "o15", description: "divergence is reason-coded, never hidden", reading: "t11.replay.divergenceReason", op: "deep-equals", expected: "posture-changed-while-offline" },
    { id: "o16", description: "the replay lands against the CURRENT (connected) posture", reading: "t11.replay.replayedPosture", op: "deep-equals", expected: "connected" },
    { id: "o17", description: "the replay carries a machine-checkable digest", reading: "t11.replay.digest", op: "not-null" },
    { id: "o18", description: "the with-divergence replay audit intent is honest", reading: "t11.replay.auditIntent", op: "deep-equals", expected: "connectivity:offline:replay:with-divergence" },
    { id: "o19", description: "the boundary sweep evicts the two oldest entries", reading: "t12.sweep.evictedIds", op: "deep-equals", expected: ["oe_gate-0002", "oe_gate-0003"] },
    { id: "o20", description: "every eviction carries the expiry reason", reading: "t12.sweep.evictedReasons", op: "deep-equals", expected: ["offline-entry-expired", "offline-entry-expired"] },
    { id: "o21", description: "the newest entry survives the sweep (its TTL not yet reached)", reading: "t12.sweep.remaining", op: "deep-equals", expected: 1 },
  ],
};

const IL_DEVICE = "dev_gate-5005";

export const ingestionLimitsAdmissionDisciplineJourney: AcceptanceJourney = {
  id: "ingestion-limits-admission-discipline",
  persona: "edge-operator",
  capability: "connectivity",
  goal: "Ride the fleet-scale ingestion guardrails: per-tenant admission caps refuse over-capacity items with the real numbers, duplicates consume no cap, an over-limit batch is refused whole, and the bounded buffer sheds or refuses honestly.",
  steps: [
    { id: "t1", summary: "admit the relay asset", op: { kind: "asset.admit", assetId: "ast_relay-echo-05", assetKind: "sensor", displayName: "Relay Echo 05" } },
    { id: "t2", summary: "enroll the burst gateway", op: { kind: "device.enroll", deviceId: IL_DEVICE, assetId: "ast_relay-echo-05", serial: "SN-5005" } },
    { id: "t3", summary: "set the tenant's admission cap to 5", op: { kind: "limits.admission-cap", cap: 5 } },
    { id: "t4", summary: "check: 3 of 5 fits", op: { kind: "limits.check-admission", requested: 3 } },
    { id: "t5", summary: "check: 6 of 5 refuses with the real numbers", expectRefusal: true, op: { kind: "limits.check-admission", requested: 6 } },
    { id: "t6", summary: "burst batch 1: four fresh observations under the cap", op: { kind: "limits.batch", deviceId: IL_DEVICE, fromSeq: 1, count: 4, observationKind: "telemetry.temp", firstObservedAt: T0 + 1_000, stepMs: 1_000, maxBatchSize: 8, maxPayloadBytesPerItem: 128 } },
    { id: "t7", summary: "the cap now shows 4 used of 5", expectRefusal: true, op: { kind: "limits.check-admission", requested: 2 } },
    { id: "t8", summary: "burst batch 2: the first item fits, the rest are refused tenant-cap-exceeded (honest partial accept)", op: { kind: "limits.batch", deviceId: IL_DEVICE, fromSeq: 5, count: 3, observationKind: "telemetry.temp", firstObservedAt: T0 + 10_000, stepMs: 1_000, maxBatchSize: 8, maxPayloadBytesPerItem: 128 } },
    { id: "t9", summary: "burst batch 2 re-delivered: the admitted item is now a duplicate that consumes NO cap", op: { kind: "limits.batch", deviceId: IL_DEVICE, fromSeq: 5, count: 3, observationKind: "telemetry.temp", firstObservedAt: T0 + 10_000, stepMs: 1_000, maxBatchSize: 8, maxPayloadBytesPerItem: 128 } },
    {
      id: "t10",
      summary: "a batch larger than maxBatchSize is refused WHOLE (nothing admitted)",
      expectRefusal: true,
      op: { kind: "limits.batch", deviceId: IL_DEVICE, fromSeq: 20, count: 5, observationKind: "telemetry.temp", firstObservedAt: T0 + 30_000, stepMs: 1_000, maxBatchSize: 4, maxPayloadBytesPerItem: 128 },
    },
    { id: "t11", summary: "open a bounded ingestion buffer (3 entries, 90 bytes, reject-newest)", op: { kind: "limits.open-buffer", maxEntries: 3, maxTotalPayloadBytes: 90, overflow: "reject-newest" } },
    { id: "t12", summary: "buffer 30 bytes", op: { kind: "limits.buffer", deviceId: IL_DEVICE, payloadBytes: 30, at: T0 + 1_000 } },
    { id: "t13", summary: "buffer 30 more bytes", op: { kind: "limits.buffer", deviceId: IL_DEVICE, payloadBytes: 30, at: T0 + 2_000 } },
    { id: "t14", summary: "buffer 30 more bytes (at both bounds: 3 entries, 90 bytes)", op: { kind: "limits.buffer", deviceId: IL_DEVICE, payloadBytes: 30, at: T0 + 3_000 } },
    { id: "t15", summary: "the byte budget is exactly full", expectRefusal: true, op: { kind: "limits.buffer", deviceId: IL_DEVICE, payloadBytes: 10, at: T0 + 4_000 } },
    { id: "t16", summary: "open a drop-oldest buffer (2 entries)", op: { kind: "limits.open-buffer", maxEntries: 2, maxTotalPayloadBytes: 1_000, overflow: "drop-oldest" } },
    { id: "t17", summary: "buffer entry A", op: { kind: "limits.buffer", deviceId: IL_DEVICE, payloadBytes: 40, at: T0 + 5_000 } },
    { id: "t18", summary: "buffer entry B", op: { kind: "limits.buffer", deviceId: IL_DEVICE, payloadBytes: 40, at: T0 + 6_000 } },
    { id: "t19", summary: "buffer entry C: the oldest (A) is shed and surfaced", op: { kind: "limits.buffer", deviceId: IL_DEVICE, payloadBytes: 40, at: T0 + 7_000 } },
    { id: "t20", summary: "a single entry larger than the whole byte budget is refused payload-too-large", expectRefusal: true, op: { kind: "limits.buffer", deviceId: IL_DEVICE, payloadBytes: 2_000, at: T0 + 8_000 } },
  ],
  assertions: [
    { id: "l1", description: "the cap is set for this tenant", reading: "t3.caps.cap", op: "deep-equals", expected: 5 },
    { id: "l2", description: "3 of 5 fits with 2 remaining", reading: "t4.admission.remaining", op: "deep-equals", expected: 2 },
    { id: "l3", description: "6 of 5 is refused tenant-cap-exceeded", reading: "t5.admission.refused", op: "deep-equals", expected: "tenant-cap-exceeded" },
    { id: "l4", description: "the refusal carries the real cap", reading: "t5.admission.cap", op: "deep-equals", expected: 5 },
    { id: "l5", description: "burst batch 1 admits all four", reading: "t6.batch.admitted", op: "deep-equals", expected: 4 },
    { id: "l6", description: "burst batch 1 refuses nothing", reading: "t6.batch.refusedCount", op: "deep-equals", expected: 0 },
    { id: "l7", description: "the cap now shows 4 used", reading: "t7.admission.used", op: "deep-equals", expected: 4 },
    { id: "l8", description: "2 more of 5-with-4-used is refused", reading: "t7.admission.refused", op: "deep-equals", expected: "tenant-cap-exceeded" },
    { id: "l9", description: "burst batch 2 admits exactly the one item that fits", reading: "t8.batch.admitted", op: "deep-equals", expected: 1 },
    { id: "l10", description: "burst batch 2 refuses the two over-cap items (partial accept)", reading: "t8.batch.refusedCount", op: "deep-equals", expected: 2 },
    { id: "l11", description: "the per-item refusal reason is tenant-cap-exceeded", reading: "t8.batch.firstRefusalReason", op: "deep-equals", expected: "tenant-cap-exceeded" },
    { id: "l12", description: "the per-item refusal carries the real in-flight usage (5 of 5)", reading: "t8.batch.capExceededUsed", op: "deep-equals", expected: 5 },
    { id: "l13", description: "the re-delivered batch duplicates the admitted item (no cap consumed)", reading: "t9.batch.duplicates", op: "deep-equals", expected: 1 },
    { id: "l14", description: "the re-delivered batch admits nothing new", reading: "t9.batch.admitted", op: "deep-equals", expected: 0 },
    { id: "l15", description: "the over-limit batch is refused whole", reading: "t10.batch.refused", op: "deep-equals", expected: "batch-too-large" },
    { id: "l16", description: "the whole-batch refusal names the size", reading: "t10.batch.size", op: "deep-equals", expected: 5 },
    { id: "l17", description: "the whole-batch refusal names the max", reading: "t10.batch.maxBatchSize", op: "deep-equals", expected: 4 },
    { id: "l18", description: "the third 30-byte buffer entry lands exactly at both bounds", reading: "t14.ibuf.totalPayloadBytes", op: "deep-equals", expected: 90 },
    { id: "l19", description: "the byte-budget-full capture is refused", reading: "t15.ibuf.refused", op: "deep-equals", expected: "buffer-full" },
    { id: "l20", description: "the reject-newest counter is honest", reading: "t15.ibuf.rejectedNewest", op: "deep-equals", expected: 1 },
    { id: "l21", description: "the drop-oldest buffer sheds entry A (sequence 1) and surfaces it", reading: "t19.ibuf.evictedSequence", op: "deep-equals", expected: 1 },
    { id: "l22", description: "the oversized single entry is refused payload-too-large", reading: "t20.ibuf.refused", op: "deep-equals", expected: "payload-too-large" },
  ],
};
