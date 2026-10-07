/**
 * @fleetos/agent — Wave 3 telemetry queue tests (F230A).
 *
 * Covers:
 *   - Two priority lanes: safety preempts routine
 *   - Size/time triggers + safety-lane preemption trigger
 *   - Refuse-and-retry overflow (NEVER silent drop)
 *   - Flush ordering: safety first, then routine
 *   - Queue-level evaluation (ok/warn/critical)
 *   - shouldFlushQueueOnTime polling helper
 *   - Tenant/agent isolation: mismatched events are refused
 *   - Audit determinism
 */

import { describe, it, expect } from "vitest";
import {
  defaultQueueConfig,
  emptyQueue,
  enqueue,
  evaluateQueueLevel,
  forceFlushQueue,
  maybeFlush,
  queueDepth,
  shouldFlushQueueOnTime,
  type PrioritizedTelemetryEvent,
  type PriorityTelemetryQueueConfig,
} from "./telemetry-queue.js";

const NOW = 1_727_000_000_000;
const AGENT = "agent-001";
const TENANT = "tnt_acme";

function ev(kind: string, priority: "safety" | "routine", at = NOW, payload: Record<string, unknown> = {}): PrioritizedTelemetryEvent {
  return { agentId: AGENT, tenantId: TENANT, at, kind, priority, payload };
}

// ---------------------------------------------------------------------------
// Two priority lanes
// ---------------------------------------------------------------------------

describe("agent telemetry-queue: priority lanes", () => {
  it("safety event is enqueued into the safety lane", () => {
    const cfg = defaultQueueConfig();
    const r = enqueue(emptyQueue(AGENT, TENANT), ev("anomaly.temp", "safety"), cfg);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.queue.safety).toHaveLength(1);
      expect(r.queue.routine).toHaveLength(0);
    }
  });

  it("routine event is enqueued into the routine lane", () => {
    const cfg = defaultQueueConfig();
    const r = enqueue(emptyQueue(AGENT, TENANT), ev("sample.temp", "routine"), cfg);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.queue.safety).toHaveLength(0);
      expect(r.queue.routine).toHaveLength(1);
    }
  });

  it("queueDepth sums both lanes", () => {
    const cfg = defaultQueueConfig();
    let q = emptyQueue(AGENT, TENANT);
    { const _r = enqueue(q, ev("a", "safety"), cfg); if (_r.ok) q = _r.queue; }
    { const _r = enqueue(q, ev("b", "routine"), cfg); if (_r.ok) q = _r.queue; }
    expect(queueDepth(q)).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Flush triggers
// ---------------------------------------------------------------------------

describe("agent telemetry-queue: flush triggers", () => {
  it("safety-preemption: flushes when safety lane crosses safetyLaneFlushAt", () => {
    const cfg: PriorityTelemetryQueueConfig = { maxBatchSize: 100, maxBatchAgeMs: 10000, safetyLaneFlushAt: 3, maxQueueDepth: 256 };
    let q = emptyQueue(AGENT, TENANT);
    let r = enqueue(q, ev("s1", "safety", NOW), cfg);
    expect(r.ok && r.flush).toBeNull();
    if (r.ok) q = r.queue;
    r = enqueue(q, ev("s2", "safety", NOW + 1), cfg);
    expect(r.ok && r.flush).toBeNull();
    if (r.ok) q = r.queue;
    r = enqueue(q, ev("s3", "safety", NOW + 2), cfg);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.flush).not.toBeNull();
      expect(r.flush!.triggeredBy).toBe("safety-preemption");
      expect(r.flush!.safetyCount).toBe(3);
      expect(r.flush!.routineCount).toBe(0);
    }
  });

  it("size trigger: flushes when total depth crosses maxBatchSize", () => {
    const cfg: PriorityTelemetryQueueConfig = { maxBatchSize: 3, maxBatchAgeMs: 10000, safetyLaneFlushAt: 100, maxQueueDepth: 256 };
    let q = emptyQueue(AGENT, TENANT);
    for (let i = 0; i < 3; i++) {
      const r = enqueue(q, ev(`r${i}`, "routine", NOW + i), cfg);
      if (r.ok) {
        q = r.queue;
        if (r.flush) {
          expect(r.flush.triggeredBy).toBe("size");
          expect(r.flush.routineCount).toBe(3);
          return;
        }
      }
    }
    // If we reach here, the size trigger didn't fire — fail.
    expect.fail("size trigger should have fired at depth 3");
  });

  it("time trigger: flushes when oldest event exceeds maxBatchAgeMs", () => {
    const cfg: PriorityTelemetryQueueConfig = { maxBatchSize: 100, maxBatchAgeMs: 5000, safetyLaneFlushAt: 100, maxQueueDepth: 256 };
    let q = emptyQueue(AGENT, TENANT);
    const r1 = enqueue(q, ev("r1", "routine", NOW), cfg);
    if (r1.ok) q = r1.queue;
    expect(r1.ok && r1.flush).toBeNull();
    // 5001ms later — exceeds maxBatchAgeMs.
    const r2 = enqueue(q, ev("r2", "routine", NOW + 5001), cfg);
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      expect(r2.flush).not.toBeNull();
      expect(r2.flush!.triggeredBy).toBe("time");
    }
  });

  it("no flush when below all triggers", () => {
    const cfg = defaultQueueConfig();
    const r = enqueue(emptyQueue(AGENT, TENANT), ev("r1", "routine", NOW), cfg);
    expect(r.ok && r.flush).toBeNull();
  });

  it("forceFlushQueue emits whatever is queued (manual trigger)", () => {
    const cfg = defaultQueueConfig();
    let q = emptyQueue(AGENT, TENANT);
    { const _r = enqueue(q, ev("r1", "routine", NOW), cfg); if (_r.ok) q = _r.queue; }
    { const _r = enqueue(q, ev("s1", "safety", NOW + 1), cfg); if (_r.ok) q = _r.queue; }
    const flush = forceFlushQueue(q);
    expect(flush).not.toBeNull();
    expect(flush!.triggeredBy).toBe("manual");
  });

  it("forceFlushQueue on empty queue returns null", () => {
    expect(forceFlushQueue(emptyQueue(AGENT, TENANT))).toBeNull();
  });

  it("flush ordering: safety events first, then routine (regardless of arrival)", () => {
    const cfg: PriorityTelemetryQueueConfig = { maxBatchSize: 100, maxBatchAgeMs: 10000, safetyLaneFlushAt: 100, maxQueueDepth: 256 };
    let q = emptyQueue(AGENT, TENANT);
    { const _r = enqueue(q, ev("r1", "routine", NOW), cfg); if (_r.ok) q = _r.queue; }
    { const _r = enqueue(q, ev("s1", "safety", NOW + 1), cfg); if (_r.ok) q = _r.queue; }
    { const _r = enqueue(q, ev("r2", "routine", NOW + 2), cfg); if (_r.ok) q = _r.queue; }
    { const _r = enqueue(q, ev("s2", "safety", NOW + 3), cfg); if (_r.ok) q = _r.queue; }
    const flush = maybeFlush(q, { ...cfg, maxBatchSize: 1 }, NOW + 4);
    expect(flush).not.toBeNull();
    if (flush) {
      // safety events first (s1, s2), then routine (r1, r2)
      expect(flush.events.map((e) => e.kind)).toEqual(["s1", "s2", "r1", "r2"]);
    }
  });
});

// ---------------------------------------------------------------------------
// Refuse-and-retry overflow (NEVER silent drop)
// ---------------------------------------------------------------------------

describe("agent telemetry-queue: overflow honesty", () => {
  it("enqueue above maxQueueDepth is refuse-and-retry (NOT silent drop)", () => {
    const cfg: PriorityTelemetryQueueConfig = { maxBatchSize: 1000, maxBatchAgeMs: 100000, safetyLaneFlushAt: 1000, maxQueueDepth: 3 };
    let q = emptyQueue(AGENT, TENANT);
    for (let i = 0; i < 3; i++) {
      const r = enqueue(q, ev(`r${i}`, "routine", NOW + i), cfg);
      if (r.ok) q = r.queue;
    }
    // Queue is full — 4th enqueue must be refused.
    const r = enqueue(q, ev("r3", "routine", NOW + 3), cfg);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("overflow-refused");
    // The first 3 are still in the queue — not dropped.
    expect(queueDepth(q)).toBe(3);
  });

  it("missing kind is refused", () => {
    const cfg = defaultQueueConfig();
    const r = enqueue(emptyQueue(AGENT, TENANT), ev("", "routine"), cfg);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing-kind");
  });

  it("agent mismatch is refused", () => {
    const cfg = defaultQueueConfig();
    const r = enqueue(emptyQueue(AGENT, TENANT), { ...ev("k", "routine"), agentId: "other-agent" }, cfg);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("agent-mismatch");
  });

  it("tenant mismatch is refused", () => {
    const cfg = defaultQueueConfig();
    const r = enqueue(emptyQueue(AGENT, TENANT), { ...ev("k", "routine"), tenantId: "other-tenant" }, cfg);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("tenant-mismatch");
  });
});

// ---------------------------------------------------------------------------
// Queue-level evaluation + shouldFlushQueueOnTime
// ---------------------------------------------------------------------------

describe("agent telemetry-queue: queue level + polling helper", () => {
  it("evaluateQueueLevel: ok when queue is empty", () => {
    const cfg = defaultQueueConfig();
    expect(evaluateQueueLevel(emptyQueue(AGENT, TENANT), cfg)).toBe("ok");
  });

  it("evaluateQueueLevel: warn at 75% depth, critical at 90%", () => {
    const cfg: PriorityTelemetryQueueConfig = { maxBatchSize: 1000, maxBatchAgeMs: 100000, safetyLaneFlushAt: 1000, maxQueueDepth: 100 };
    let qWarn = emptyQueue(AGENT, TENANT);
    for (let i = 0; i < 76; i++) {
      const r = enqueue(qWarn, ev(`r${i}`, "routine", NOW + i), cfg);
      if (r.ok) qWarn = r.queue;
    }
    expect(evaluateQueueLevel(qWarn, cfg)).toBe("warn");
    let qCrit = emptyQueue(AGENT, TENANT);
    for (let i = 0; i < 91; i++) {
      const r = enqueue(qCrit, ev(`r${i}`, "routine", NOW + i), cfg);
      if (r.ok) qCrit = r.queue;
    }
    expect(evaluateQueueLevel(qCrit, cfg)).toBe("critical");
  });

  it("shouldFlushQueueOnTime: true when age exceeds maxBatchAgeMs", () => {
    const cfg: PriorityTelemetryQueueConfig = { maxBatchSize: 1000, maxBatchAgeMs: 5000, safetyLaneFlushAt: 1000, maxQueueDepth: 256 };
    let q = emptyQueue(AGENT, TENANT);
    { const _r = enqueue(q, ev("r1", "routine", NOW), cfg); if (_r.ok) q = _r.queue; }
    expect(shouldFlushQueueOnTime(q, NOW + 5001, cfg)).toBe(true);
    expect(shouldFlushQueueOnTime(q, NOW + 4999, cfg)).toBe(false);
  });

  it("shouldFlushQueueOnTime: false for empty queue", () => {
    expect(shouldFlushQueueOnTime(emptyQueue(AGENT, TENANT), NOW, defaultQueueConfig())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Audit determinism
// ---------------------------------------------------------------------------

describe("agent telemetry-queue: audit determinism", () => {
  it("identical enqueue produces identical audit digest", () => {
    const cfg = defaultQueueConfig();
    const r1 = enqueue(emptyQueue(AGENT, TENANT), ev("k1", "safety", NOW), cfg);
    const r2 = enqueue(emptyQueue(AGENT, TENANT), ev("k1", "safety", NOW), cfg);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (r1.ok && r2.ok) expect(r1.audit.digest).toBe(r2.audit.digest);
  });

  it("audit intent reflects the priority lane", () => {
    const cfg = defaultQueueConfig();
    const r1 = enqueue(emptyQueue(AGENT, TENANT), ev("k1", "safety", NOW), cfg);
    const r2 = enqueue(emptyQueue(AGENT, TENANT), ev("k2", "routine", NOW), cfg);
    if (r1.ok) expect(r1.audit.intent).toContain("safety");
    if (r2.ok) expect(r2.audit.intent).toContain("routine");
  });
});
