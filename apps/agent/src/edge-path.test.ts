/**
 * @fleetos/agent — Wave 2 edge-path tests (F220A).
 *
 * Covers:
 *   - Telemetry batching contracts (size/time triggers)
 *   - Command-inbox durability types
 *   - Reconciliation diff application (deterministic convergence)
 *   - Honest connectivity posture
 */

import { describe, it, expect } from "vitest";
import {
  ackDurableCommand,
  applyReconciliationPlan,
  defaultBatcherConfig,
  emptyBatcher,
  emptyDurableAckLog,
  forceFlush,
  planReconciliation,
  pushEvent,
  reportConnectivity,
  shouldFlushOnTime,
  verifyConvergence,
} from "./edge-path.js";

const NOW = 1_727_000_000_000;
const AGENT1 = "agent-001";
const TENANT_A = "tnt_acme";

// ---------------------------------------------------------------------------
// Telemetry batching — size/time triggers.
// ---------------------------------------------------------------------------

describe("agent edge-path: telemetry batching", () => {
  it("empty batcher has no events", () => {
    const b = emptyBatcher(AGENT1, TENANT_A);
    expect(b.events).toHaveLength(0);
    expect(b.firstEventAt).toBeNull();
  });

  it("pushEvent adds an event without flushing when below triggers", () => {
    const cfg = defaultBatcherConfig();
    let b = emptyBatcher(AGENT1, TENANT_A);
    const r = pushEvent(b, { agentId: AGENT1, tenantId: TENANT_A, at: NOW, kind: "telemetry.temp", payload: { v: 1 } }, cfg);
    expect(r.flush).toBeNull();
    expect(r.batcher.events).toHaveLength(1);
  });

  it("flushes when batch reaches maxBatchSize (size trigger)", () => {
    const cfg = { maxBatchSize: 3, maxBatchAgeMs: 10000 };
    let b = emptyBatcher(AGENT1, TENANT_A);
    let r1 = pushEvent(b, { agentId: AGENT1, tenantId: TENANT_A, at: NOW, kind: "k1", payload: {} }, cfg);
    expect(r1.flush).toBeNull();
    let r2 = pushEvent(r1.batcher, { agentId: AGENT1, tenantId: TENANT_A, at: NOW + 1, kind: "k2", payload: {} }, cfg);
    expect(r2.flush).toBeNull();
    let r3 = pushEvent(r2.batcher, { agentId: AGENT1, tenantId: TENANT_A, at: NOW + 2, kind: "k3", payload: {} }, cfg);
    expect(r3.flush).not.toBeNull();
    expect(r3.flush!.events).toHaveLength(3);
    // After flush, the batcher is empty.
    expect(r3.batcher.events).toHaveLength(0);
  });

  it("flushes when batch age exceeds maxBatchAgeMs (time trigger)", () => {
    const cfg = { maxBatchSize: 100, maxBatchAgeMs: 5000 };
    let b = emptyBatcher(AGENT1, TENANT_A);
    let r1 = pushEvent(b, { agentId: AGENT1, tenantId: TENANT_A, at: NOW, kind: "k1", payload: {} }, cfg);
    expect(r1.flush).toBeNull();
    // 4000ms later — still within the window.
    let r2 = pushEvent(r1.batcher, { agentId: AGENT1, tenantId: TENANT_A, at: NOW + 4000, kind: "k2", payload: {} }, cfg);
    expect(r2.flush).toBeNull();
    // 5001ms after the first event — exceeds maxBatchAgeMs (5000).
    let r3 = pushEvent(r2.batcher, { agentId: AGENT1, tenantId: TENANT_A, at: NOW + 5001, kind: "k3", payload: {} }, cfg);
    expect(r3.flush).not.toBeNull();
    expect(r3.flush!.events).toHaveLength(3);
  });

  it("pushEvent ignores events from a different agent/tenant (defensive)", () => {
    const cfg = defaultBatcherConfig();
    let b = emptyBatcher(AGENT1, TENANT_A);
    const r = pushEvent(b, { agentId: "agent-other", tenantId: TENANT_A, at: NOW, kind: "k", payload: {} }, cfg);
    expect(r.flush).toBeNull();
    expect(r.batcher.events).toHaveLength(0);
  });

  it("forceFlush emits whatever is in the batcher regardless of triggers", () => {
    let b = emptyBatcher(AGENT1, TENANT_A);
    b = pushEvent(b, { agentId: AGENT1, tenantId: TENANT_A, at: NOW, kind: "k1", payload: {} }, defaultBatcherConfig()).batcher;
    b = pushEvent(b, { agentId: AGENT1, tenantId: TENANT_A, at: NOW + 1, kind: "k2", payload: {} }, defaultBatcherConfig()).batcher;
    const r = forceFlush(b);
    expect(r.flush).not.toBeNull();
    expect(r.flush!.events).toHaveLength(2);
    expect(r.batcher.events).toHaveLength(0);
  });

  it("forceFlush on an empty batcher returns flush=null", () => {
    const b = emptyBatcher(AGENT1, TENANT_A);
    const r = forceFlush(b);
    expect(r.flush).toBeNull();
  });

  it("shouldFlushOnTime returns true when age exceeds maxBatchAgeMs", () => {
    const cfg = { maxBatchSize: 100, maxBatchAgeMs: 5000 };
    let b = emptyBatcher(AGENT1, TENANT_A);
    b = pushEvent(b, { agentId: AGENT1, tenantId: TENANT_A, at: NOW, kind: "k1", payload: {} }, cfg).batcher;
    expect(shouldFlushOnTime(b, NOW + 5001, cfg)).toBe(true);
    expect(shouldFlushOnTime(b, NOW + 4999, cfg)).toBe(false);
  });

  it("shouldFlushOnTime returns false for an empty batcher", () => {
    const b = emptyBatcher(AGENT1, TENANT_A);
    expect(shouldFlushOnTime(b, NOW, defaultBatcherConfig())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Command-inbox durability.
// ---------------------------------------------------------------------------

describe("agent edge-path: durable command inbox", () => {
  it("acks a new command with state=received", () => {
    const log = emptyDurableAckLog();
    const r = ackDurableCommand(log, { commandId: "cmd_001", agentId: AGENT1, tenantId: TENANT_A, at: NOW });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ack.state).toBe("received");
    expect(r.ack.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(r.audit.intent).toBe("agent:inbox:durable:ack:received");
  });

  it("re-acking the same command returns state=duplicate (idempotent)", () => {
    const log = emptyDurableAckLog();
    const r1 = ackDurableCommand(log, { commandId: "cmd_001", agentId: AGENT1, tenantId: TENANT_A, at: NOW });
    if (!r1.ok) throw new Error();
    const r2 = ackDurableCommand(r1.log, { commandId: "cmd_001", agentId: AGENT1, tenantId: TENANT_A, at: NOW + 1 });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.ack.state).toBe("duplicate");
    // The log is unchanged (idempotent — no new entry).
    expect(r2.log.acked.size).toBe(1);
    expect(r2.audit.intent).toBe("agent:inbox:durable:ack:duplicate");
  });

  it("refuses missing command id", () => {
    const r = ackDurableCommand(emptyDurableAckLog(), { commandId: "", agentId: AGENT1, tenantId: TENANT_A, at: NOW });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("missing-command-id");
  });

  it("refuses missing agent id", () => {
    const r = ackDurableCommand(emptyDurableAckLog(), { commandId: "cmd_001", agentId: "", tenantId: TENANT_A, at: NOW });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("missing-agent-id");
  });

  it("refuses missing tenant id", () => {
    const r = ackDurableCommand(emptyDurableAckLog(), { commandId: "cmd_001", agentId: AGENT1, tenantId: "", at: NOW });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("missing-tenant-id");
  });

  it("digest is deterministic for identical inputs", () => {
    const log = emptyDurableAckLog();
    const r1 = ackDurableCommand(log, { commandId: "cmd_001", agentId: AGENT1, tenantId: TENANT_A, at: NOW });
    const r2 = ackDurableCommand(log, { commandId: "cmd_001", agentId: AGENT1, tenantId: TENANT_A, at: NOW });
    if (!r1.ok || !r2.ok) throw new Error();
    expect(r1.ack.digest).toBe(r2.ack.digest);
  });
});

// ---------------------------------------------------------------------------
// Reconciliation diff application — deterministic convergence.
// ---------------------------------------------------------------------------

describe("agent edge-path: reconciliation", () => {
  it("planReconciliation returns no-op when heads match", () => {
    const p = planReconciliation(10, 10);
    expect(p.kind).toBe("no-op");
  });

  it("planReconciliation returns catch-up when remote is ahead", () => {
    const p = planReconciliation(5, 10);
    expect(p.kind).toBe("catch-up");
    expect(p.catchUpFrom).toBe(6);
    expect(p.catchUpTo).toBe(10);
  });

  it("planReconciliation returns replay-from when local is ahead", () => {
    const p = planReconciliation(15, 10);
    expect(p.kind).toBe("replay-from");
    expect(p.replayFrom).toBe(10);
  });

  it("applyReconciliationPlan converges localHead to remoteHead for catch-up", () => {
    const p = planReconciliation(5, 10);
    const newHead = applyReconciliationPlan(p, 5);
    expect(newHead).toBe(10);
    expect(verifyConvergence(p, newHead)).toBe(true);
  });

  it("applyReconciliationPlan converges localHead to remoteHead for replay-from", () => {
    const p = planReconciliation(15, 10);
    const newHead = applyReconciliationPlan(p, 15);
    expect(newHead).toBe(10);
    expect(verifyConvergence(p, newHead)).toBe(true);
  });

  it("applyReconciliationPlan leaves localHead unchanged for no-op", () => {
    const p = planReconciliation(10, 10);
    const newHead = applyReconciliationPlan(p, 10);
    expect(newHead).toBe(10);
    expect(verifyConvergence(p, newHead)).toBe(true);
  });

  it("verifyConvergence returns false when heads differ", () => {
    const p = planReconciliation(5, 10);
    expect(verifyConvergence(p, 7)).toBe(false); // 7 != 10
  });
});

// ---------------------------------------------------------------------------
// Honest connectivity posture.
// ---------------------------------------------------------------------------

describe("agent edge-path: honest connectivity posture", () => {
  it("reports 'online' when heartbeat is fresh and posture is online", () => {
    const r = reportConnectivity({
      agentId: AGENT1,
      tenantId: TENANT_A,
      posture: "online",
      reportedAt: NOW,
      lastHeartbeatAt: NOW - 1000,
    });
    expect(r.posture).toBe("online");
    expect(r.audit.intent).toBe("agent:connectivity:online");
  });

  it("forces posture to 'unknown' when heartbeat is null but caller claimed online (honest)", () => {
    const r = reportConnectivity({
      agentId: AGENT1,
      tenantId: TENANT_A,
      posture: "online",
      reportedAt: NOW,
      lastHeartbeatAt: null,
    });
    expect(r.posture).toBe("unknown"); // honest — never exaggerate
    expect(r.audit.intent).toBe("agent:connectivity:unknown");
  });

  it("reports 'offline' posture when heartbeat is null but caller said offline", () => {
    const r = reportConnectivity({
      agentId: AGENT1,
      tenantId: TENANT_A,
      posture: "offline",
      reportedAt: NOW,
      lastHeartbeatAt: null,
    });
    expect(r.posture).toBe("offline");
  });

  it("reports 'degraded' posture without exaggeration", () => {
    const r = reportConnectivity({
      agentId: AGENT1,
      tenantId: TENANT_A,
      posture: "degraded",
      reportedAt: NOW,
      lastHeartbeatAt: NOW - 1000,
    });
    expect(r.posture).toBe("degraded");
  });

  it("emits an audit event with the honest posture", () => {
    const r = reportConnectivity({
      agentId: AGENT1,
      tenantId: TENANT_A,
      posture: "online",
      reportedAt: NOW,
      lastHeartbeatAt: NOW - 1000,
    });
    expect(r.audit.tenant).toBe(TENANT_A);
    expect(r.audit.timestamp).toBe(NOW);
    expect(r.audit.digest).toMatch(/^[0-9a-f]{64}$/);
  });
});
