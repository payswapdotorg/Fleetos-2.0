/**
 * @fleetos/connectivity — Wave 3 posture-machine + durability tests (F230A).
 *
 * Covers:
 *   - Posture state machine: legal transitions, illegal transitions, missing-reason
 *   - Posture history: append + eviction at bound
 *   - Message durability queue: enqueue, idempotent re-enqueue, ack, redeliver
 *   - Overflow honesty: refuse-and-retry (NEVER silent drop)
 *   - Dedup on arrival: first delivery = not-duplicate; re-delivery = duplicate
 *   - Back-pressure: level thresholds + propagation signal (accept/shed/reject)
 *   - Tenant isolation: outbox is tenant-scoped (constructor-bound)
 */

import { describe, it, expect } from "vitest";
import {
  ackMessage,
  appendPostureHistory,
  defaultBackpressureThresholds,
  dedupOnArrival,
  emptyDedupRegistry,
  emptyMessageQueue,
  emptyPostureHistory,
  enqueueMessage,
  evaluateBackpressure,
  propagateBackpressure,
  redeliverPending,
  transitionPosture,
  type BackpressureLevel,
  type PostureEvent,
} from "./posture-machine.js";

const NOW = 1_727_000_000_000;
const TENANT_A = "tnt_acme";
const DEVICE_1 = "dev_truck-001";

// ---------------------------------------------------------------------------
// Posture state machine
// ---------------------------------------------------------------------------

describe("connectivity posture-machine: transitions", () => {
  it("offline + heartbeat-fresh -> connected (fast path)", () => {
    const r = transitionPosture("offline", { kind: "heartbeat-fresh", at: NOW }, TENANT_A, DEVICE_1);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.from).toBe("offline");
      expect(r.to).toBe("connected");
      expect(r.audit.intent).toBe("connectivity:posture:offline->connected");
      expect(r.audit.tenant).toBe(TENANT_A);
    }
  });

  it("offline + transport-up -> degraded (transport alone doesn't confirm connected)", () => {
    const r = transitionPosture("offline", { kind: "transport-up", at: NOW }, TENANT_A, DEVICE_1);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.to).toBe("degraded");
  });

  it("degraded + heartbeat-fresh -> connected", () => {
    const r = transitionPosture("degraded", { kind: "heartbeat-fresh", at: NOW }, TENANT_A, DEVICE_1);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.to).toBe("connected");
  });

  it("connected + heartbeat-stale -> degraded", () => {
    const r = transitionPosture("connected", { kind: "heartbeat-stale", at: NOW }, TENANT_A, DEVICE_1);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.to).toBe("degraded");
  });

  it("connected + transport-down -> offline", () => {
    const r = transitionPosture("connected", { kind: "transport-down", at: NOW }, TENANT_A, DEVICE_1);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.to).toBe("offline");
  });

  it("degraded + heartbeat-dead -> offline", () => {
    const r = transitionPosture("degraded", { kind: "heartbeat-dead", at: NOW }, TENANT_A, DEVICE_1);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.to).toBe("offline");
  });

  it("illegal transition: offline + transport-down is undefined (already offline)", () => {
    const r = transitionPosture("offline", { kind: "transport-down", at: NOW }, TENANT_A, DEVICE_1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("illegal-transition");
  });

  it("illegal transition: connected + manual-recover is undefined (no upgrade path)", () => {
    const r = transitionPosture("connected", { kind: "manual-recover", at: NOW, reason: "ops" }, TENANT_A, DEVICE_1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("illegal-transition");
  });

  it("already-in-state: degraded + heartbeat-stale is a self-loop", () => {
    const r = transitionPosture("degraded", { kind: "heartbeat-stale", at: NOW }, TENANT_A, DEVICE_1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("already-in-state");
  });

  it("manual-degrade requires a reason (audit trail)", () => {
    const r = transitionPosture("connected", { kind: "manual-degrade", at: NOW }, TENANT_A, DEVICE_1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing-reason");
  });

  it("manual-degrade with reason succeeds: connected -> degraded", () => {
    const r = transitionPosture("connected", { kind: "manual-degrade", at: NOW, reason: "ops-intervention" }, TENANT_A, DEVICE_1);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.to).toBe("degraded");
  });

  it("manual-recover with reason succeeds: offline -> degraded", () => {
    const r = transitionPosture("offline", { kind: "manual-recover", at: NOW, reason: "ops-clear" }, TENANT_A, DEVICE_1);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.to).toBe("degraded");
  });

  it("audit digest is stable for identical inputs (deterministic)", () => {
    const ev: PostureEvent = { kind: "heartbeat-fresh", at: NOW };
    const r1 = transitionPosture("offline", ev, TENANT_A, DEVICE_1);
    const r2 = transitionPosture("offline", ev, TENANT_A, DEVICE_1);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (r1.ok && r2.ok) {
      expect(r1.audit.digest).toBe(r2.audit.digest);
    }
  });
});

// ---------------------------------------------------------------------------
// Posture history
// ---------------------------------------------------------------------------

describe("connectivity posture-machine: history", () => {
  it("appends entries in order", () => {
    let h = emptyPostureHistory(DEVICE_1, 4);
    h = appendPostureHistory(h, { at: NOW, from: "offline", to: "connected", eventKind: "heartbeat-fresh", reason: null });
    h = appendPostureHistory(h, { at: NOW + 1, from: "connected", to: "degraded", eventKind: "heartbeat-stale", reason: null });
    expect(h.entries).toHaveLength(2);
    expect(h.entries[0]!.to).toBe("connected");
    expect(h.entries[1]!.to).toBe("degraded");
  });

  it("evicts oldest entries when bound exceeded", () => {
    let h = emptyPostureHistory(DEVICE_1, 2);
    h = appendPostureHistory(h, { at: NOW, from: "offline", to: "connected", eventKind: "heartbeat-fresh", reason: null });
    h = appendPostureHistory(h, { at: NOW + 1, from: "connected", to: "degraded", eventKind: "heartbeat-stale", reason: null });
    h = appendPostureHistory(h, { at: NOW + 2, from: "degraded", to: "offline", eventKind: "transport-down", reason: null });
    expect(h.entries).toHaveLength(2);
    // First entry evicted; the two newest remain.
    expect(h.entries[0]!.from).toBe("connected");
    expect(h.entries[1]!.from).toBe("degraded");
  });
});

// ---------------------------------------------------------------------------
// Message durability queue
// ---------------------------------------------------------------------------

describe("connectivity posture-machine: durable outbox", () => {
  it("enqueues a new message and computes its integrity digest", () => {
    const q = emptyMessageQueue(TENANT_A, DEVICE_1);
    const r = enqueueMessage(q, { id: "msg-1", kind: "telemetry.batch", payload: { v: 1 }, at: NOW });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.message.id).toBe("msg-1");
      expect(r.message.digest).toMatch(/^[0-9a-f]{64}$/);
      expect(r.message.tenantId).toBe(TENANT_A);
      expect(r.message.deviceId).toBe(DEVICE_1);
      expect(r.queue.pending.size).toBe(1);
    }
  });

  it("idempotent re-enqueue returns the existing message and leaves queue untouched", () => {
    const q = emptyMessageQueue(TENANT_A, DEVICE_1);
    const r1 = enqueueMessage(q, { id: "msg-1", kind: "k", payload: { v: 1 }, at: NOW });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const r2 = enqueueMessage(r1.queue, { id: "msg-1", kind: "k", payload: { v: 1 }, at: NOW + 999 });
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      // Same message — enqueuedAt preserved (NOT bumped to NOW+999).
      expect(r2.message.enqueuedAt).toBe(NOW);
      expect(r2.queue.pending.size).toBe(1);
    }
  });

  it("refuses missing message id and missing kind", () => {
    const q = emptyMessageQueue(TENANT_A, DEVICE_1);
    const r1 = enqueueMessage(q, { id: "", kind: "k", payload: {}, at: NOW });
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.reason).toBe("missing-message-id");
    const r2 = enqueueMessage(q, { id: "msg-1", kind: "", payload: {}, at: NOW });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toBe("missing-kind");
  });

  it("overflow is refuse-and-retry (NEVER silent drop)", () => {
    const q = emptyMessageQueue(TENANT_A, DEVICE_1, 2);
    const r1 = enqueueMessage(q, { id: "msg-1", kind: "k", payload: {}, at: NOW });
    const r2 = enqueueMessage(r1.ok ? r1.queue : q, { id: "msg-2", kind: "k", payload: {}, at: NOW + 1 });
    const r3 = enqueueMessage(r2.ok ? r2.queue : q, { id: "msg-3", kind: "k", payload: {}, at: NOW + 2 });
    expect(r3.ok).toBe(false);
    if (!r3.ok) expect(r3.reason).toBe("overflow-refused");
    // The first two are still in the queue — not dropped.
    if (r2.ok) expect(r2.queue.pending.size).toBe(2);
  });

  it("ack removes from pending; redeliverPending returns remaining", () => {
    const q0 = emptyMessageQueue(TENANT_A, DEVICE_1);
    const r1 = enqueueMessage(q0, { id: "msg-1", kind: "k", payload: {}, at: NOW });
    const r2 = enqueueMessage(r1.ok ? r1.queue : q0, { id: "msg-2", kind: "k", payload: {}, at: NOW + 1 });
    if (!r2.ok) return;
    expect(redeliverPending(r2.queue)).toHaveLength(2);
    const acked = ackMessage(r2.queue, "msg-1", NOW + 2);
    expect(acked.queue.pending.size).toBe(1);
    expect(acked.audit).not.toBeNull();
    expect(redeliverPending(acked.queue)).toHaveLength(1);
    expect(redeliverPending(acked.queue)[0]!.id).toBe("msg-2");
  });

  it("ack on an unknown messageId is a no-op (no audit)", () => {
    const q = emptyMessageQueue(TENANT_A, DEVICE_1);
    const acked = ackMessage(q, "no-such-msg", NOW);
    expect(acked.queue.pending.size).toBe(0);
    expect(acked.audit).toBeNull();
  });

  it("redeliverPending returns insertion order (FIFO)", () => {
    const q0 = emptyMessageQueue(TENANT_A, DEVICE_1);
    let q = q0;
    for (let i = 0; i < 5; i++) {
      const r = enqueueMessage(q, { id: `msg-${i}`, kind: "k", payload: { i }, at: NOW + i });
      if (r.ok) q = r.queue;
    }
    const pending = redeliverPending(q);
    expect(pending.map((m) => m.id)).toEqual(["msg-0", "msg-1", "msg-2", "msg-3", "msg-4"]);
  });

  it("outbox is tenant-bound (constructor-scoped, not cross-tenant)", () => {
    const q = emptyMessageQueue(TENANT_A, DEVICE_1);
    expect(q.tenantId).toBe(TENANT_A);
    // A second queue for tenant B is fully isolated.
    const qB = emptyMessageQueue("tnt_other", DEVICE_1);
    expect(qB.tenantId).toBe("tnt_other");
    expect(q.pending).not.toBe(qB.pending);
  });
});

// ---------------------------------------------------------------------------
// Dedup on arrival
// ---------------------------------------------------------------------------

describe("connectivity posture-machine: dedup on arrival", () => {
  it("first delivery: not duplicate; second: duplicate", () => {
    let reg = emptyDedupRegistry(64);
    const r1 = dedupOnArrival(reg, "msg-1");
    expect(r1.ok).toBe(true);
    if (r1.ok) {
      expect(r1.duplicate).toBe(false);
      reg = r1.registry;
    }
    const r2 = dedupOnArrival(reg, "msg-1");
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.duplicate).toBe(true);
  });

  it("registry bounded: oldest entries evicted when full", () => {
    let reg = emptyDedupRegistry(4);
    for (let i = 0; i < 4; i++) {
      const r = dedupOnArrival(reg, `msg-${i}`);
      if (r.ok) reg = r.registry;
    }
    expect(reg.seen.size).toBe(4);
    // Adding a 5th should evict ~25% (1 entry); the registry stays bounded.
    const r = dedupOnArrival(reg, "msg-4");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.registry.seen.size).toBeLessThanOrEqual(4);
    }
  });

  it("different messageIds are not duplicates of each other", () => {
    let reg = emptyDedupRegistry(64);
    const r1 = dedupOnArrival(reg, "msg-1");
    if (r1.ok) reg = r1.registry;
    const r2 = dedupOnArrival(reg, "msg-2");
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.duplicate).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Back-pressure propagation
// ---------------------------------------------------------------------------

describe("connectivity posture-machine: back-pressure", () => {
  it("ok level when queue is empty", () => {
    const q = emptyMessageQueue(TENANT_A, DEVICE_1, 100);
    expect(evaluateBackpressure(q)).toBe("ok");
    expect(propagateBackpressure("ok")).toBe("accept");
  });

  it("warn level when queue crosses warnAt threshold", () => {
    const q0 = emptyMessageQueue(TENANT_A, DEVICE_1, 100);
    let q = q0;
    for (let i = 0; i < 76; i++) {
      const r = enqueueMessage(q, { id: `msg-${i}`, kind: "k", payload: {}, at: NOW + i });
      if (r.ok) q = r.queue;
    }
    expect(evaluateBackpressure(q)).toBe("warn");
    expect(propagateBackpressure("warn")).toBe("shed");
  });

  it("critical level when queue crosses criticalAt threshold", () => {
    const q0 = emptyMessageQueue(TENANT_A, DEVICE_1, 100);
    let q = q0;
    for (let i = 0; i < 91; i++) {
      const r = enqueueMessage(q, { id: `msg-${i}`, kind: "k", payload: {}, at: NOW + i });
      if (r.ok) q = r.queue;
    }
    expect(evaluateBackpressure(q)).toBe("critical");
    expect(propagateBackpressure("critical")).toBe("reject");
  });

  it("default thresholds are warnAt=0.75, criticalAt=0.9", () => {
    const t = defaultBackpressureThresholds();
    expect(t.warnAt).toBe(0.75);
    expect(t.criticalAt).toBe(0.9);
  });

  it("propagation contract: each level maps to exactly one signal", () => {
    const levels: BackpressureLevel[] = ["ok", "warn", "critical"];
    const signals = levels.map(propagateBackpressure);
    expect(new Set(signals).size).toBe(3); // all distinct
  });
});

// ---------------------------------------------------------------------------
// Tenant isolation: cross-tenant queues are fully isolated
// ---------------------------------------------------------------------------

describe("connectivity posture-machine: tenant isolation", () => {
  it("two tenants' outboxes are disjoint", () => {
    const qA = emptyMessageQueue(TENANT_A, DEVICE_1);
    const qB = emptyMessageQueue("tnt_other", DEVICE_1);
    const rA = enqueueMessage(qA, { id: "msg-A", kind: "k", payload: {}, at: NOW });
    const rB = enqueueMessage(qB, { id: "msg-B", kind: "k", payload: {}, at: NOW });
    if (!rA.ok || !rB.ok) return;
    expect(rA.queue.pending.has("msg-B")).toBe(false);
    expect(rB.queue.pending.has("msg-A")).toBe(false);
  });

  it("dedup registry is per-tenant (caller constructs one per tenant)", () => {
    const regA = emptyDedupRegistry(64);
    const regB = emptyDedupRegistry(64);
    // Tenant A's "msg-1" is not a duplicate from tenant B's perspective.
    let a = regA;
    let b = regB;
    const rA = dedupOnArrival(a, "msg-1");
    if (rA.ok) a = rA.registry;
    const rB = dedupOnArrival(b, "msg-1");
    expect(rB.ok).toBe(true);
    if (rB.ok) expect(rB.duplicate).toBe(false);
  });
});
