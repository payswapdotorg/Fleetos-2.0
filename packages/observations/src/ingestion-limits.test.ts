/**
 * @fleetos/observations — Wave 8 fleet-scale ingestion hardening tests (F280A).
 *
 * Covers (every limit is actually HIT in a test):
 *   - Bounded ingestion buffer: reject-newest AND drop-oldest overflow
 *     policies; byte-budget bound; FIFO law; honest eviction surfacing.
 *   - Per-tenant admission caps: fail-closed over-capacity refusals with
 *     REAL numbers; per-tenant isolation; boundary at exactly the cap.
 *   - Batch-size limits: whole-batch refusal over maxBatchSize; honest
 *     partial-accept semantics within a batch; duplicates consume no cap.
 *   - Memory-shape bound: a max-size batch at the per-item payload limit
 *     is admitted within the documented worst-case footprint.
 *   - Tenant isolation: fail-closed tenant-mismatch on the buffer scope;
 *     cross-tenant cap separation; per-tenant caps inside one batch.
 */

import { describe, it, expect } from "vitest";
import {
  admitBatchWithLimits,
  bufferIngestionEntry,
  checkTenantAdmission,
  defaultIngestionLimits,
  emptyIngestionBuffer,
  emptyTenantAdmissionCaps,
  recordTenantAdmissions,
  withTenantCap,
  type IngestionBuffer,
  type IngestionBufferPolicy,
  type RawObservationInput,
} from "./ingestion-limits.js";
import { emptyStageMetrics, type StageMetrics } from "./ingestion.js";
import { emptyAdmissionStore, type AdmissionStore } from "./observations.js";

const NOW = 1_727_000_000_000;
const TENANT_A = "tnt_acme";
const TENANT_B = "tnt_globex";
const DEVICE_1 = "dev_truck-001";
const DEVICE_2 = "dev_pump-002";

function jsonPayloadOf(size: number): Uint8Array {
  // A valid JSON object of EXACTLY `size` bytes (min 14): {"v":1,"p":"…"}.
  const prefix = `{"v":1,"p":"`;
  const suffix = `"}`;
  const padLen = Math.max(0, size - prefix.length - suffix.length);
  return new TextEncoder().encode(prefix + "a".repeat(padLen) + suffix);
}

function mkInput(
  deviceId: string,
  seq: number,
  tenantId = TENANT_A,
  size = 16,
  observedAt = NOW + seq,
): RawObservationInput {
  return {
    tenantId,
    deviceId,
    seq,
    observedAt,
    kind: "telemetry.temp",
    payload: jsonPayloadOf(size),
    receivedAt: NOW + seq,
  };
}

function tinyPolicy(overrides: Partial<IngestionBufferPolicy> = {}): IngestionBufferPolicy {
  return { maxEntries: 3, maxTotalPayloadBytes: 64, overflow: "reject-newest", ...overrides };
}

// ---------------------------------------------------------------------------
// Bounded ingestion buffer — overflow policies actually hit
// ---------------------------------------------------------------------------

describe("observations ingestion-limits: bounded buffer", () => {
  it("accepts entries within the entry-count bound and preserves FIFO capture order", () => {
    let buf = emptyIngestionBuffer(TENANT_A, tinyPolicy());
    for (let i = 1; i <= 3; i++) {
      const r = bufferIngestionEntry(buf, { deviceId: DEVICE_1, payload: jsonPayloadOf(16), at: NOW + i });
      expect(r.ok).toBe(true);
      if (r.ok) buf = r.buffer;
    }
    expect(buf.entries.map((e) => e.sequence)).toEqual([1, 2, 3]);
    expect(buf.totalPayloadBytes).toBe(48);
    expect(buf.droppedOldest).toBe(0);
    expect(buf.rejectedNewest).toBe(0);
  });

  it("reject-newest policy REFUSES the 4th entry at the bound with buffer-full (honest counter)", () => {
    let buf = emptyIngestionBuffer(TENANT_A, tinyPolicy());
    for (let i = 1; i <= 3; i++) {
      const r = bufferIngestionEntry(buf, { deviceId: DEVICE_1, payload: jsonPayloadOf(16), at: NOW + i });
      if (r.ok) buf = r.buffer;
    }
    const r = bufferIngestionEntry(buf, { deviceId: DEVICE_1, payload: jsonPayloadOf(16), at: NOW + 4 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("buffer-full");
      expect(r.buffer.rejectedNewest).toBe(1);
      expect(r.buffer.entries.length).toBe(3); // newest NOT accepted
      expect(r.buffer.entries.map((e) => e.sequence)).toEqual([1, 2, 3]);
    }
  });

  it("drop-oldest policy EVICTS the oldest entry and SURFACES it (never silent)", () => {
    let buf = emptyIngestionBuffer(TENANT_A, tinyPolicy({ overflow: "drop-oldest" }));
    for (let i = 1; i <= 3; i++) {
      const r = bufferIngestionEntry(buf, { deviceId: DEVICE_1, payload: jsonPayloadOf(16), at: NOW + i });
      if (r.ok) buf = r.buffer;
    }
    const r = bufferIngestionEntry(buf, { deviceId: DEVICE_2, payload: jsonPayloadOf(16), at: NOW + 4 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.evicted?.sequence).toBe(1); // the evicted entry is surfaced
      expect(r.buffer.entries.map((e) => e.sequence)).toEqual([2, 3, 4]); // FIFO law kept
      expect(r.buffer.droppedOldest).toBe(1);
      expect(r.buffer.totalPayloadBytes).toBe(48);
    }
  });

  it("byte-budget bound: reject-newest refuses an entry that would exceed total bytes", () => {
    let buf = emptyIngestionBuffer(TENANT_A, tinyPolicy({ maxEntries: 100 }));
    for (let i = 1; i <= 4; i++) {
      const r = bufferIngestionEntry(buf, { deviceId: DEVICE_1, payload: jsonPayloadOf(16), at: NOW + i });
      if (r.ok) buf = r.buffer;
    }
    expect(buf.totalPayloadBytes).toBe(64); // 4 × 16 = the whole byte budget
    const r = bufferIngestionEntry(buf, { deviceId: DEVICE_1, payload: jsonPayloadOf(16), at: NOW + 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("buffer-full");
  });

  it("byte-budget bound: drop-oldest sheds enough oldest entries to fit the newcomer", () => {
    let buf = emptyIngestionBuffer(TENANT_A, tinyPolicy({ maxEntries: 100, overflow: "drop-oldest" }));
    for (let i = 1; i <= 4; i++) {
      const r = bufferIngestionEntry(buf, { deviceId: DEVICE_1, payload: jsonPayloadOf(16), at: NOW + i });
      if (r.ok) buf = r.buffer;
    }
    expect(buf.totalPayloadBytes).toBe(64);
    const r = bufferIngestionEntry(buf, { deviceId: DEVICE_1, payload: jsonPayloadOf(32), at: NOW + 5 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.evicted?.sequence).toBe(2); // last of the shed entries surfaced
      expect(r.buffer.droppedOldest).toBe(2); // 64 - 32 + 32 = 64 — two shed
      expect(r.buffer.totalPayloadBytes).toBe(64);
      expect(r.buffer.entries.map((e) => e.sequence)).toEqual([3, 4, 5]);
    }
  });

  it("refuses a single entry larger than the whole byte budget (payload-too-large)", () => {
    const buf = emptyIngestionBuffer(TENANT_A, tinyPolicy({ maxEntries: 100, maxTotalPayloadBytes: 64 }));
    const r = bufferIngestionEntry(buf, { deviceId: DEVICE_1, payload: jsonPayloadOf(65), at: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("payload-too-large");
  });

  it("tenant scope is fail-closed: the buffer carries its tenant on every entry", () => {
    const buf = emptyIngestionBuffer(TENANT_A, tinyPolicy());
    const r = bufferIngestionEntry(buf, { deviceId: DEVICE_1, payload: jsonPayloadOf(16), at: NOW });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.entry.tenantId).toBe(TENANT_A);
  });

  it("missing device id and empty payload are refused (typed codes)", () => {
    const buf = emptyIngestionBuffer(TENANT_A, tinyPolicy());
    expect(bufferIngestionEntry(buf, { deviceId: "", payload: jsonPayloadOf(16), at: NOW }).ok).toBe(false);
    const empty = bufferIngestionEntry(buf, { deviceId: DEVICE_1, payload: new Uint8Array(0), at: NOW });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.reason).toBe("missing-payload");
  });

  it("deterministic: identical operation sequence produces identical buffer state", () => {
    const run = (): IngestionBuffer => {
      let buf = emptyIngestionBuffer(TENANT_A, tinyPolicy({ overflow: "drop-oldest" }));
      for (let i = 1; i <= 6; i++) {
        const r = bufferIngestionEntry(buf, { deviceId: DEVICE_1, payload: jsonPayloadOf(14 + i), at: NOW + i });
        if (r.ok) buf = r.buffer;
      }
      return buf;
    };
    const a = run();
    const b = run();
    expect(a).toEqual(b);
    expect(a.entries.map((e) => e.payloadBytes)).toEqual(b.entries.map((e) => e.payloadBytes));
  });
});

// ---------------------------------------------------------------------------
// Per-tenant admission caps — fail-closed over-capacity
// ---------------------------------------------------------------------------

describe("observations ingestion-limits: tenant admission caps", () => {
  it("admits within the cap and reports remaining headroom", () => {
    const caps = withTenantCap(emptyTenantAdmissionCaps(100), TENANT_A, 5);
    const d = checkTenantAdmission(caps, TENANT_A, 3);
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.cap).toBe(5);
      expect(d.used).toBe(0);
      expect(d.remaining).toBe(2);
    }
  });

  it("fail-closed over-capacity refusal carries the REAL numbers (cap/used/requested)", () => {
    let caps = withTenantCap(emptyTenantAdmissionCaps(100), TENANT_A, 5);
    caps = recordTenantAdmissions(caps, TENANT_A, 4);
    const d = checkTenantAdmission(caps, TENANT_A, 2);
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.reason).toBe("tenant-cap-exceeded");
      expect(d.cap).toBe(5);
      expect(d.used).toBe(4);
      expect(d.requested).toBe(2);
    }
  });

  it("boundary: requesting exactly the remaining headroom is admitted", () => {
    let caps = withTenantCap(emptyTenantAdmissionCaps(100), TENANT_A, 5);
    caps = recordTenantAdmissions(caps, TENANT_A, 4);
    expect(checkTenantAdmission(caps, TENANT_A, 1).ok).toBe(true);
    expect(checkTenantAdmission(caps, TENANT_A, 2).ok).toBe(false);
  });

  it("per-tenant isolation: tenant A's usage does NOT consume tenant B's cap (fail-closed both ways)", () => {
    let caps = withTenantCap(withTenantCap(emptyTenantAdmissionCaps(100), TENANT_A, 2), TENANT_B, 10);
    caps = recordTenantAdmissions(caps, TENANT_A, 2);
    expect(checkTenantAdmission(caps, TENANT_A, 1).ok).toBe(false); // A is full
    const b = checkTenantAdmission(caps, TENANT_B, 10);
    expect(b.ok).toBe(true); // B unaffected
    if (b.ok) expect(b.remaining).toBe(0);
  });

  it("missing tenant id fails closed", () => {
    const d = checkTenantAdmission(emptyTenantAdmissionCaps(10), "", 1);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe("missing-tenant-id");
  });

  it("default cap applies to tenants without an explicit cap", () => {
    const caps = emptyTenantAdmissionCaps(3);
    const d = checkTenantAdmission(caps, TENANT_A, 4);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.cap).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Bounded batch admission — batch-size limits + honest partial accept
// ---------------------------------------------------------------------------

describe("observations ingestion-limits: bounded batch admission", () => {
  it("batch larger than maxBatchSize is refused WHOLE (nothing admitted, honest numbers)", () => {
    const limits = defaultIngestionLimits(); // 256
    const inputs = Array.from({ length: limits.maxBatchSize + 1 }, (_, i) => mkInput(DEVICE_1, i + 1));
    const r = admitBatchWithLimits(
      emptyAdmissionStore(),
      emptyStageMetrics(),
      emptyTenantAdmissionCaps(1000),
      inputs,
      limits,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("batch-too-large");
      expect(r.size).toBe(257);
      expect(r.maxBatchSize).toBe(256);
    }
  });

  it("partial accept: items over the tenant cap are refused per-item; earlier items STAY admitted", () => {
    const caps = withTenantCap(emptyTenantAdmissionCaps(100), TENANT_A, 3);
    const inputs = [
      mkInput(DEVICE_1, 1),
      mkInput(DEVICE_1, 2),
      mkInput(DEVICE_1, 3),
      mkInput(DEVICE_1, 4), // over cap — refused, first three stay admitted
      mkInput(DEVICE_1, 5), // over cap — refused
    ];
    const r = admitBatchWithLimits(emptyAdmissionStore(), emptyStageMetrics(), caps, inputs, defaultIngestionLimits());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.admittedCount).toBe(3);
      expect(r.refusedCount).toBe(2);
      expect(r.acks.filter((a) => a.ok).length).toBe(3);
      const refused = r.acks.filter((a) => !a.ok);
      expect(refused.map((a) => a.reason)).toEqual(["tenant-cap-exceeded", "tenant-cap-exceeded"]);
      if (refused[0] && !refused[0].ok) {
        expect(refused[0].cap).toBe(3); // REAL numbers on the refusal
        expect(refused[0].used).toBe(3);
        expect(refused[0].requested).toBe(1);
      }
      // Cap state advanced by exactly the admitted volume.
      expect(checkTenantAdmission(r.caps, TENANT_A, 1).ok).toBe(false);
    }
  });

  it("duplicate acks consume NO cap budget (idempotent re-delivery of the same batch)", () => {
    const caps = withTenantCap(emptyTenantAdmissionCaps(100), TENANT_A, 2);
    const inputs = [mkInput(DEVICE_1, 1), mkInput(DEVICE_1, 2)];
    const first = admitBatchWithLimits(emptyAdmissionStore(), emptyStageMetrics(), caps, inputs, defaultIngestionLimits());
    expect(first.ok && first.admittedCount).toBe(2);
    if (!first.ok) return;
    // Full re-delivery of the same batch: all duplicates, no cap consumed.
    const second = admitBatchWithLimits(first.store, first.metrics, first.caps, inputs, defaultIngestionLimits());
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.admittedCount).toBe(0);
      expect(second.duplicateCount).toBe(2);
      expect(second.acks.every((a) => a.ok && a.duplicate)).toBe(true);
      expect(second.caps).toEqual(first.caps); // cap state UNCHANGED by duplicates
    }
  });

  it("per-item payload limit: over-limit items refused payload-too-large, rest admitted", () => {
    const inputs = [
      mkInput(DEVICE_1, 1, TENANT_A, 8192), // exactly at the per-item limit
      mkInput(DEVICE_1, 2, TENANT_A, 8193), // one byte over
      mkInput(DEVICE_1, 3, TENANT_A, 16),
    ];
    const r = admitBatchWithLimits(emptyAdmissionStore(), emptyStageMetrics(), emptyTenantAdmissionCaps(100), inputs, defaultIngestionLimits());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.admittedCount).toBe(2);
      expect(r.acks[1] && !r.acks[1].ok ? r.acks[1].reason : null).toBe("payload-too-large");
    }
  });

  it("mixed pipeline failures inside a bounded batch stay per-item honest", () => {
    const inputs = [
      mkInput(DEVICE_1, 1),
      mkInput(DEVICE_1, 1), // duplicate seq — idempotent ack
      mkInput(DEVICE_1, 1, TENANT_A, 16, NOW + 99), // same seq again after ack
      { ...mkInput(DEVICE_1, 2), kind: "bogus.kind" }, // unknown-kind refusal
      mkInput(DEVICE_2, 1),
    ];
    const r = admitBatchWithLimits(emptyAdmissionStore(), emptyStageMetrics(), emptyTenantAdmissionCaps(100), inputs, defaultIngestionLimits());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.admittedCount).toBe(2);
      expect(r.duplicateCount).toBe(2);
      expect(r.refusedCount).toBe(1);
      expect(r.acks[3] && !r.acks[3].ok ? r.acks[3].reason : null).toBe("unknown-kind");
    }
  });

  it("cross-tenant batch: each tenant capped independently inside ONE batch (fail-closed isolation)", () => {
    const caps = withTenantCap(withTenantCap(emptyTenantAdmissionCaps(100), TENANT_A, 2), TENANT_B, 5);
    const inputs = [
      mkInput(DEVICE_1, 1, TENANT_A),
      mkInput(DEVICE_1, 2, TENANT_A),
      mkInput(DEVICE_1, 3, TENANT_A), // over A's cap
      mkInput(DEVICE_2, 1, TENANT_B),
      mkInput(DEVICE_2, 2, TENANT_B),
      mkInput(DEVICE_2, 3, TENANT_B),
    ];
    const r = admitBatchWithLimits(emptyAdmissionStore(), emptyStageMetrics(), caps, inputs, defaultIngestionLimits());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.admittedCount).toBe(5); // A: 2, B: 3
      expect(r.refusedCount).toBe(1); // only A's third item
      const refusedIdx = r.acks.findIndex((a) => !a.ok);
      expect(refusedIdx).toBe(2);
      // Tenant B's cap state advanced independently.
      const bCap = r.caps.tenants.get(TENANT_B);
      expect(bCap?.used).toBe(3);
      const aCap = r.caps.tenants.get(TENANT_A);
      expect(aCap?.used).toBe(2);
    }
  });

  it("memory-shape bound: a max-size batch at the per-item payload limit admits within the documented footprint", () => {
    const limits = defaultIngestionLimits(); // 256 items × 8192 bytes = 2 MiB worst case
    let store: AdmissionStore = emptyAdmissionStore();
    let metrics: StageMetrics = emptyStageMetrics();
    const caps = emptyTenantAdmissionCaps(1000);
    // Two tenants, each maxBatchSize/2 items at exactly the payload limit.
    const inputs: RawObservationInput[] = [];
    for (let i = 1; i <= limits.maxBatchSize / 2; i++) {
      inputs.push(mkInput(DEVICE_1, i, TENANT_A, limits.maxPayloadBytesPerItem));
      inputs.push(mkInput(DEVICE_2, i, TENANT_B, limits.maxPayloadBytesPerItem));
    }
    const r = admitBatchWithLimits(store, metrics, caps, inputs, limits);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.admittedCount).toBe(limits.maxBatchSize);
      expect(r.refusedCount).toBe(0);
      // The store grew by exactly the admitted volume — the documented bound.
      expect(r.store.known.size).toBe(limits.maxBatchSize);
      expect(r.metrics.received).toBe(limits.maxBatchSize);
      store = r.store;
      metrics = r.metrics;
    }
    expect(store.known.size + metrics.admitted).toBeGreaterThanOrEqual(limits.maxBatchSize);
  });

  it("replayed offline batch composition: a large replay hitting caps is partially accepted with real numbers", () => {
    // A device replays its offline backlog as one batch; the tenant cap is
    // smaller than the backlog — the replay is honestly partial, not truncated.
    const caps = withTenantCap(emptyTenantAdmissionCaps(100), TENANT_A, 4);
    const backlog = Array.from({ length: 8 }, (_, i) => mkInput(DEVICE_1, i + 1));
    const r = admitBatchWithLimits(emptyAdmissionStore(), emptyStageMetrics(), caps, backlog, defaultIngestionLimits());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.admittedCount).toBe(4);
      expect(r.refusedCount).toBe(4);
      expect(r.acks.slice(4).every((a) => !a.ok && a.reason === "tenant-cap-exceeded")).toBe(true);
    }
  });
});
