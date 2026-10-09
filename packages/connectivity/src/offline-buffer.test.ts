/**
 * @fleetos/connectivity — Wave 8 offline tolerance hardening tests (F280A).
 *
 * Covers:
 *   - Replay-in-order semantics: strict FIFO capture order, replay digest
 *     machine-checks the ordering.
 *   - Divergence accounting: entries captured under one posture and replayed
 *     under another get typed divergence records (recorded, NOT hidden);
 *     posture transitions while pending are attached; truncation counted.
 *   - Expiry sweep: stale entries evicted with reason `offline-entry-expired`
 *     and SURFACED; boundary at exactly capturedAt + ttlMs; idempotent sweep.
 *   - Overflow policies actually hit: reject-newest refuses with
 *     offline-buffer-full; drop-oldest evicts + surfaces.
 *   - Tenant isolation: fail-closed tenant-mismatch / device-mismatch on
 *     foreign capture inputs; duplicate entry ids refused.
 *   - Determinism: identical capture/stamp/replay sequence -> identical
 *     replay digest.
 */

import { describe, it, expect } from "vitest";
import {
  captureOfflineEntry,
  defaultOfflineBufferPolicy,
  emptyOfflineBuffer,
  replayOfflineBuffer,
  stampPostureTransition,
  sweepExpiredOfflineEntries,
  type OfflineBuffer,
  type OfflineBufferPolicy,
} from "./offline-buffer.js";
import type { PostureState } from "./posture-machine.js";

const NOW = 1_727_000_000_000;
const TENANT_A = "tnt_acme";
const TENANT_B = "tnt_globex";
const DEVICE_1 = "dev_truck-001";
const DEVICE_2 = "dev_pump-002";

function tinyPolicy(overrides: Partial<OfflineBufferPolicy> = {}): OfflineBufferPolicy {
  return { maxEntries: 4, ttlMs: 1000, overflow: "reject-newest", maxPostureTransitions: 3, ...overrides };
}

function capture(
  buf: OfflineBuffer,
  entryId: string,
  at: number,
  posture: PostureState,
  extra: { tenantId?: string; deviceId?: string } = {},
): OfflineBuffer {
  const r = captureOfflineEntry(buf, {
    entryId,
    kind: "telemetry.temp",
    payload: { v: entryId },
    at,
    posture,
    ...extra,
  });
  expect(r.ok).toBe(true);
  if (r.ok) return r.buffer;
  return buf;
}

// ---------------------------------------------------------------------------
// Replay-in-order semantics
// ---------------------------------------------------------------------------

describe("connectivity offline-buffer: replay-in-order", () => {
  it("replays entries strictly in capture (FIFO) order with monotonic sequences", () => {
    let buf = emptyOfflineBuffer(TENANT_A, DEVICE_1, tinyPolicy());
    for (let i = 1; i <= 4; i++) {
      buf = capture(buf, `e-${i}`, NOW + i * 10, "offline");
    }
    const report = replayOfflineBuffer(buf, "connected", NOW + 500);
    expect(report.entries.map((e) => e.entryId)).toEqual(["e-1", "e-2", "e-3", "e-4"]);
    expect(report.entries.map((e) => e.sequence)).toEqual([1, 2, 3, 4]);
  });

  it("replay order is unaffected by interleaved posture stamping", () => {
    let buf = emptyOfflineBuffer(TENANT_A, DEVICE_1, tinyPolicy());
    buf = capture(buf, "e-1", NOW + 10, "offline");
    buf = stampPostureTransition(buf, { from: "offline", to: "degraded", at: NOW + 20 });
    buf = capture(buf, "e-2", NOW + 30, "degraded");
    buf = stampPostureTransition(buf, { from: "degraded", to: "offline", at: NOW + 40 });
    buf = capture(buf, "e-3", NOW + 50, "offline");
    const report = replayOfflineBuffer(buf, "connected", NOW + 500);
    expect(report.entries.map((e) => e.entryId)).toEqual(["e-1", "e-2", "e-3"]);
  });

  it("the replayed batch lands against the CURRENT posture (stamped on the report)", () => {
    let buf = emptyOfflineBuffer(TENANT_A, DEVICE_1, tinyPolicy());
    buf = capture(buf, "e-1", NOW + 10, "offline");
    const report = replayOfflineBuffer(buf, "connected", NOW + 500);
    expect(report.replayedPosture).toBe("connected");
    expect(report.replayedAt).toBe(NOW + 500);
    expect(report.tenantId).toBe(TENANT_A);
    expect(report.deviceId).toBe(DEVICE_1);
  });

  it("determinism: identical sequence produces the identical replay digest", () => {
    const run = (): string => {
      let buf = emptyOfflineBuffer(TENANT_A, DEVICE_1, tinyPolicy());
      buf = capture(buf, "e-1", NOW + 10, "offline");
      buf = stampPostureTransition(buf, { from: "offline", to: "degraded", at: NOW + 20 });
      buf = capture(buf, "e-2", NOW + 30, "degraded");
      return replayOfflineBuffer(buf, "connected", NOW + 500).replayDigest;
    };
    expect(run()).toBe(run());
  });
});

// ---------------------------------------------------------------------------
// Divergence accounting across posture changes
// ---------------------------------------------------------------------------

describe("connectivity offline-buffer: divergence accounting", () => {
  it("entries captured under the replay posture produce ZERO divergence (no change while offline)", () => {
    let buf = emptyOfflineBuffer(TENANT_A, DEVICE_1, tinyPolicy());
    buf = capture(buf, "e-1", NOW + 10, "connected");
    buf = capture(buf, "e-2", NOW + 20, "connected");
    const report = replayOfflineBuffer(buf, "connected", NOW + 500);
    expect(report.divergences).toEqual([]);
    expect(report.audit.intent).toBe("connectivity:offline:replay");
  });

  it("divergence is RECORDED not hidden: captured posture differs from replay posture", () => {
    let buf = emptyOfflineBuffer(TENANT_A, DEVICE_1, tinyPolicy());
    buf = capture(buf, "e-1", NOW + 10, "degraded"); // captured while degraded
    buf = capture(buf, "e-2", NOW + 20, "offline"); // captured while offline
    const report = replayOfflineBuffer(buf, "connected", NOW + 500); // replayed after reconnect
    expect(report.divergences.length).toBe(2);
    expect(report.divergences[0]?.capturedPosture).toBe("degraded");
    expect(report.divergences[0]?.replayedPosture).toBe("connected");
    expect(report.divergences[0]?.reason).toBe("posture-changed-while-offline");
    expect(report.divergences[1]?.capturedPosture).toBe("offline");
    expect(report.divergences.map((d) => d.entryId)).toEqual(["e-1", "e-2"]);
    expect(report.audit.intent).toBe("connectivity:offline:replay:with-divergence");
  });

  it("posture transitions observed while an entry was pending are attached to its divergence", () => {
    let buf = emptyOfflineBuffer(TENANT_A, DEVICE_1, tinyPolicy());
    buf = capture(buf, "e-1", NOW + 10, "offline");
    buf = stampPostureTransition(buf, { from: "offline", to: "degraded", at: NOW + 100 });
    buf = stampPostureTransition(buf, { from: "degraded", to: "connected", at: NOW + 200 });
    buf = capture(buf, "e-2", NOW + 300, "connected"); // after the transitions — no divergence
    const report = replayOfflineBuffer(buf, "connected", NOW + 400);
    expect(report.divergences.length).toBe(1);
    const d = report.divergences[0]!;
    expect(d.transitionsWhilePending.map((t) => `${t.from}->${t.to}`)).toEqual([
      "offline->degraded",
      "degraded->connected",
    ]);
    expect(report.entries.map((e) => e.entryId)).toEqual(["e-1", "e-2"]);
  });

  it("posture log overflow is COUNTED in every divergence record (never silent)", () => {
    // maxPostureTransitions: 3 — stamp 5 transitions; 2 evictions counted.
    let buf = emptyOfflineBuffer(TENANT_A, DEVICE_1, tinyPolicy({ maxPostureTransitions: 3 }));
    buf = capture(buf, "e-1", NOW + 10, "offline");
    buf = stampPostureTransition(buf, { from: "offline", to: "degraded", at: NOW + 20 });
    buf = stampPostureTransition(buf, { from: "degraded", to: "offline", at: NOW + 30 });
    buf = stampPostureTransition(buf, { from: "offline", to: "degraded", at: NOW + 40 });
    buf = stampPostureTransition(buf, { from: "degraded", to: "offline", at: NOW + 50 });
    buf = stampPostureTransition(buf, { from: "offline", to: "degraded", at: NOW + 60 });
    expect(buf.postureLog.length).toBe(3);
    expect(buf.postureLogTruncated).toBe(2);
    const report = replayOfflineBuffer(buf, "connected", NOW + 500);
    expect(report.divergences.length).toBe(1);
    expect(report.divergences[0]?.transitionsTruncated).toBe(2);
    expect(report.divergences[0]?.transitionsWhilePending.length).toBe(3); // the bounded tail
  });
});

// ---------------------------------------------------------------------------
// Expiry sweep — reason-coded eviction of stale entries
// ---------------------------------------------------------------------------

describe("connectivity offline-buffer: expiry sweep", () => {
  it("evicts stale entries with reason offline-entry-expired and SURFACES every one", () => {
    let buf = emptyOfflineBuffer(TENANT_A, DEVICE_1, tinyPolicy({ ttlMs: 1000 }));
    buf = capture(buf, "e-1", NOW, "offline"); // expires at NOW+1000
    buf = capture(buf, "e-2", NOW + 500, "offline"); // expires at NOW+1500
    buf = capture(buf, "e-3", NOW + 900, "offline"); // expires at NOW+1900
    const sweep = sweepExpiredOfflineEntries(buf, NOW + 1600);
    expect(sweep.evicted.map((e) => e.entry.entryId)).toEqual(["e-1", "e-2"]);
    expect(sweep.evicted.every((e) => e.reason === "offline-entry-expired")).toBe(true);
    expect(sweep.evicted[0]?.evictedAt).toBe(NOW + 1600);
    expect(sweep.buffer.entries.map((e) => e.entryId)).toEqual(["e-3"]);
  });

  it("boundary: an entry at exactly capturedAt + ttlMs IS expired (inclusive)", () => {
    let buf = emptyOfflineBuffer(TENANT_A, DEVICE_1, tinyPolicy({ ttlMs: 1000 }));
    buf = capture(buf, "e-1", NOW, "offline");
    const atEdge = sweepExpiredOfflineEntries(buf, NOW + 1000);
    expect(atEdge.evicted.length).toBe(1);
    const justBefore = sweepExpiredOfflineEntries(buf, NOW + 999);
    expect(justBefore.evicted.length).toBe(0);
    expect(justBefore.buffer.entries.length).toBe(1);
  });

  it("the sweep is deterministic and idempotent — a second sweep evicts nothing", () => {
    let buf = emptyOfflineBuffer(TENANT_A, DEVICE_1, tinyPolicy({ ttlMs: 1000 }));
    buf = capture(buf, "e-1", NOW, "offline");
    buf = capture(buf, "e-2", NOW + 2000, "offline");
    const first = sweepExpiredOfflineEntries(buf, NOW + 2500);
    expect(first.evicted.map((e) => e.entry.entryId)).toEqual(["e-1"]);
    const second = sweepExpiredOfflineEntries(first.buffer, NOW + 2500);
    expect(second.evicted).toEqual([]);
    expect(second.buffer.entries.map((e) => e.entryId)).toEqual(["e-2"]);
  });
});

// ---------------------------------------------------------------------------
// Overflow policies actually hit + tenant isolation fail-closed
// ---------------------------------------------------------------------------

describe("connectivity offline-buffer: bounds and fail-closed scope", () => {
  it("reject-newest REFUSES capture at the entry bound with offline-buffer-full", () => {
    let buf = emptyOfflineBuffer(TENANT_A, DEVICE_1, tinyPolicy({ maxEntries: 2 }));
    buf = capture(buf, "e-1", NOW + 10, "offline");
    buf = capture(buf, "e-2", NOW + 20, "offline");
    const r = captureOfflineEntry(buf, {
      entryId: "e-3",
      kind: "telemetry.temp",
      payload: { v: 3 },
      at: NOW + 30,
      posture: "offline",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("offline-buffer-full");
      expect(r.buffer.rejectedNewest).toBe(1);
      expect(r.buffer.entries.map((e) => e.entryId)).toEqual(["e-1", "e-2"]); // newest NOT accepted
    }
  });

  it("drop-oldest EVICTS the oldest entry and SURFACES it under pressure", () => {
    let buf = emptyOfflineBuffer(TENANT_A, DEVICE_1, tinyPolicy({ maxEntries: 2, overflow: "drop-oldest" }));
    buf = capture(buf, "e-1", NOW + 10, "offline");
    buf = capture(buf, "e-2", NOW + 20, "offline");
    const r = captureOfflineEntry(buf, {
      entryId: "e-3",
      kind: "telemetry.temp",
      payload: { v: 3 },
      at: NOW + 30,
      posture: "offline",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.evicted?.entryId).toBe("e-1"); // surfaced, never silent
      expect(r.buffer.entries.map((e) => e.entryId)).toEqual(["e-2", "e-3"]); // FIFO law kept
      expect(r.buffer.droppedOldest).toBe(1);
    }
  });

  it("duplicate entry id is refused (idempotent capture, no double-buffering)", () => {
    let buf = emptyOfflineBuffer(TENANT_A, DEVICE_1, tinyPolicy());
    buf = capture(buf, "e-1", NOW + 10, "offline");
    const r = captureOfflineEntry(buf, {
      entryId: "e-1",
      kind: "telemetry.temp",
      payload: { v: 1 },
      at: NOW + 20,
      posture: "offline",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("duplicate-entry-id");
  });

  it("tenant isolation is FAIL-CLOSED: foreign tenant input refused with tenant-mismatch", () => {
    let buf = emptyOfflineBuffer(TENANT_A, DEVICE_1, tinyPolicy());
    buf = capture(buf, "e-1", NOW + 10, "offline");
    const r = captureOfflineEntry(buf, {
      entryId: "e-2",
      kind: "telemetry.temp",
      payload: { v: 2 },
      at: NOW + 20,
      posture: "offline",
      tenantId: TENANT_B, // foreign tenant
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("tenant-mismatch");
    expect(r.buffer.entries.map((e) => e.tenantId)).toEqual([TENANT_A]); // scope intact
  });

  it("device scope is FAIL-CLOSED: foreign device input refused with device-mismatch", () => {
    const buf = emptyOfflineBuffer(TENANT_A, DEVICE_1, tinyPolicy());
    const r = captureOfflineEntry(buf, {
      entryId: "e-2",
      kind: "telemetry.temp",
      payload: { v: 2 },
      at: NOW + 20,
      posture: "offline",
      deviceId: DEVICE_2, // foreign device
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("device-mismatch");
  });

  it("missing entry id and missing kind are refused (typed codes)", () => {
    const buf = emptyOfflineBuffer(TENANT_A, DEVICE_1, tinyPolicy());
    const noId = captureOfflineEntry(buf, {
      entryId: "",
      kind: "telemetry.temp",
      payload: {},
      at: NOW,
      posture: "offline",
    });
    expect(noId.ok).toBe(false);
    if (!noId.ok) expect(noId.reason).toBe("missing-entry-id");
    const noKind = captureOfflineEntry(buf, {
      entryId: "e-1",
      kind: "",
      payload: {},
      at: NOW,
      posture: "offline",
    });
    expect(noKind.ok).toBe(false);
    if (!noKind.ok) expect(noKind.reason).toBe("missing-kind");
  });

  it("default policy bounds are documented and sane", () => {
    const p = defaultOfflineBufferPolicy();
    expect(p.maxEntries).toBe(512);
    expect(p.ttlMs).toBe(30 * 60 * 1000);
    expect(p.overflow).toBe("reject-newest");
    expect(p.maxPostureTransitions).toBe(64);
  });
});
