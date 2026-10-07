/**
 * @fleetos/agent — Wave 2 edge-path kernel (F220A).
 *
 *   - Agent telemetry batching contracts (size/time triggers): the agent
 *     accumulates telemetry events into a batch and flushes when EITHER
 *     `maxBatchSize` items are queued OR `maxBatchAgeMs` has elapsed.
 *   - Command-inbox durability types: typed contract for durable inbox
 *     acks (the agent persists the ack log locally so a crash doesn't
 *     re-execute a command on restart).
 *   - Reconciliation diff application (deterministic convergence): given
 *     a local and remote head, the kernel computes the diff and produces
 *     a typed plan (catch-up, replay, or no-op) that deterministically
 *     converges to the remote head.
 *   - Honest connectivity posture: the agent reports its true connectivity
 *     state (online/offline/degraded) without exaggeration.
 *
 * Pure TypeScript. No I/O, no servers, no databases. Persistence lands at
 * F211 (TL lane).
 */

import { createHash } from "node:crypto";
import type { AgentIdLike, TenantIdLike } from "./agent.js";
import type { AuditEventRef } from "./kernel.js";

// Re-export AuditEventRef so callers of edge-path have it in scope without
// a separate import. The canonical definition lives in kernel.ts.
export type { AuditEventRef };

function digestOf(...parts: ReadonlyArray<string | number>): string {
  const text = parts.map((p) => String(p)).join("|");
  return createHash("sha256").update(text).digest("hex");
}

// ---------------------------------------------------------------------------
// Telemetry batching — size/time triggers.
//
// The agent accumulates telemetry events into a batch. The batch is flushed
// when EITHER:
//   - `events.length >= maxBatchSize` (size trigger); OR
//   - `now - firstEventAt >= maxBatchAgeMs` (time trigger).
//
// The batcher is pure: same inputs -> same flush decision.
// ---------------------------------------------------------------------------

export interface TelemetryEvent {
  readonly agentId: AgentIdLike;
  readonly tenantId: TenantIdLike;
  readonly at: number;
  readonly kind: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface TelemetryBatch {
  readonly agentId: AgentIdLike;
  readonly tenantId: TenantIdLike;
  readonly events: ReadonlyArray<TelemetryEvent>;
  readonly firstEventAt: number;
  readonly lastEventAt: number;
}

export interface TelemetryBatcherConfig {
  readonly maxBatchSize: number;
  readonly maxBatchAgeMs: number;
}

export function defaultBatcherConfig(): TelemetryBatcherConfig {
  return { maxBatchSize: 50, maxBatchAgeMs: 5000 };
}

export interface TelemetryBatcher {
  readonly agentId: AgentIdLike;
  readonly tenantId: TenantIdLike;
  readonly events: ReadonlyArray<TelemetryEvent>;
  readonly firstEventAt: number | null;
  readonly lastEventAt: number | null;
}

export function emptyBatcher(agentId: AgentIdLike, tenantId: TenantIdLike): TelemetryBatcher {
  return { agentId, tenantId, events: [], firstEventAt: null, lastEventAt: null };
}

export function pushEvent(
  batcher: TelemetryBatcher,
  event: TelemetryEvent,
  config: TelemetryBatcherConfig,
): { readonly batcher: TelemetryBatcher; readonly flush: TelemetryBatch | null } {
  if (event.agentId !== batcher.agentId || event.tenantId !== batcher.tenantId) {
    // Mismatched agent/tenant — refuse silently (defensive).
    return { batcher, flush: null };
  }
  const events = [...batcher.events, event];
  const firstEventAt = batcher.firstEventAt ?? event.at;
  const lastEventAt = event.at;
  const next: TelemetryBatcher = { ...batcher, events, firstEventAt, lastEventAt };

  // Size trigger.
  if (events.length >= config.maxBatchSize) {
    const batch: TelemetryBatch = {
      agentId: next.agentId,
      tenantId: next.tenantId,
      events,
      firstEventAt,
      lastEventAt,
    };
    return { batcher: emptyBatcher(batcher.agentId, batcher.tenantId), flush: batch };
  }
  // Time trigger.
  if (lastEventAt - firstEventAt >= config.maxBatchAgeMs) {
    const batch: TelemetryBatch = {
      agentId: next.agentId,
      tenantId: next.tenantId,
      events,
      firstEventAt,
      lastEventAt,
    };
    return { batcher: emptyBatcher(batcher.agentId, batcher.tenantId), flush: batch };
  }
  return { batcher: next, flush: null };
}

// Force-flush: emit whatever is in the batcher regardless of triggers.
export function forceFlush(batcher: TelemetryBatcher): { readonly batcher: TelemetryBatcher; readonly flush: TelemetryBatch | null } {
  if (batcher.events.length === 0) {
    return { batcher, flush: null };
  }
  const batch: TelemetryBatch = {
    agentId: batcher.agentId,
    tenantId: batcher.tenantId,
    events: batcher.events,
    firstEventAt: batcher.firstEventAt!,
    lastEventAt: batcher.lastEventAt!,
  };
  return { batcher: emptyBatcher(batcher.agentId, batcher.tenantId), flush: batch };
}

// Check whether the batcher SHOULD flush at the given `now` (time trigger only).
export function shouldFlushOnTime(batcher: TelemetryBatcher, now: number, config: TelemetryBatcherConfig): boolean {
  if (batcher.events.length === 0) return false;
  if (batcher.firstEventAt === null) return false;
  return now - batcher.firstEventAt >= config.maxBatchAgeMs;
}

// ---------------------------------------------------------------------------
// Command-inbox durability types.
//
// The agent persists a local ack log so a crash doesn't re-execute a
// command on restart. The ack log is keyed by command id; re-acking the
// same command id returns the prior ack (idempotent).
// ---------------------------------------------------------------------------

export type DurableAckState = "received" | "duplicate" | "rejected";

export interface DurableCommandAck {
  readonly commandId: string;
  readonly agentId: AgentIdLike;
  readonly tenantId: TenantIdLike;
  readonly state: DurableAckState;
  readonly ackedAt: number;
  readonly reason?: string;
  readonly digest: string;
}

export interface DurableAckLog {
  readonly acked: ReadonlyMap<string, DurableCommandAck>;
}

export function emptyDurableAckLog(): DurableAckLog {
  return { acked: new Map() };
}

export type DurableAckRejectionCode = "missing-command-id" | "missing-agent-id" | "missing-tenant-id";

export function ackDurableCommand(
  log: DurableAckLog,
  input: {
    readonly commandId: string;
    readonly agentId: AgentIdLike;
    readonly tenantId: TenantIdLike;
    readonly at: number;
    readonly reason?: string;
  },
):
  | { readonly ok: true; readonly ack: DurableCommandAck; readonly log: DurableAckLog; readonly audit: AuditEventRef }
  | { readonly ok: false; readonly reason: DurableAckRejectionCode } {
  if (input.commandId === "") return { ok: false, reason: "missing-command-id" };
  if (input.agentId === "") return { ok: false, reason: "missing-agent-id" };
  if (input.tenantId === "") return { ok: false, reason: "missing-tenant-id" };

  const existing = log.acked.get(input.commandId);
  if (existing) {
    // Idempotent: re-acking returns "duplicate" with the prior digest.
    const dup: DurableCommandAck = { ...existing, state: "duplicate", ackedAt: input.at };
    const audit: AuditEventRef = {
      actor: input.agentId,
      intent: "agent:inbox:durable:ack:duplicate",
      tenant: input.tenantId,
      timestamp: input.at,
      digest: digestOf(input.commandId, "durable-ack-duplicate", input.at),
    };
    return { ok: true, ack: dup, log, audit };
  }
  const ack: DurableCommandAck = {
    commandId: input.commandId,
    agentId: input.agentId,
    tenantId: input.tenantId,
    state: "received",
    ackedAt: input.at,
    reason: input.reason,
    digest: digestOf(input.commandId, input.agentId, input.tenantId, input.at),
  };
  const acked = new Map(log.acked);
  acked.set(input.commandId, ack);
  const audit: AuditEventRef = {
    actor: input.agentId,
    intent: "agent:inbox:durable:ack:received",
    tenant: input.tenantId,
    timestamp: input.at,
    digest: digestOf(input.commandId, "durable-ack-received", input.at),
  };
  return { ok: true, ack, log: { acked }, audit };
}

// ---------------------------------------------------------------------------
// Reconciliation diff application — deterministic convergence.
//
// Given a local head and a remote head, the kernel computes a typed plan
// that, when applied, brings the local head to match the remote head.
// The plan is one of:
//   - "no-op": heads match.
//   - "catch-up": remote is ahead; apply entries [localHead+1, remoteHead].
//   - "replay-from": remote is behind or forked; replay from a known
//     shared ancestor.
// ---------------------------------------------------------------------------

export type ReconciliationPlanKind = "no-op" | "catch-up" | "replay-from";

export interface ReconciliationPlan {
  readonly kind: ReconciliationPlanKind;
  readonly localHead: number;
  readonly remoteHead: number;
  readonly catchUpFrom?: number; // for "catch-up": localHead + 1
  readonly catchUpTo?: number; // for "catch-up": remoteHead
  readonly replayFrom?: number; // for "replay-from": known shared ancestor
}

export function planReconciliation(localHead: number, remoteHead: number): ReconciliationPlan {
  if (localHead === remoteHead) {
    return { kind: "no-op", localHead, remoteHead };
  }
  if (localHead < remoteHead) {
    // Remote is ahead — catch up by applying [localHead+1, remoteHead].
    return {
      kind: "catch-up",
      localHead,
      remoteHead,
      catchUpFrom: localHead + 1,
      catchUpTo: remoteHead,
    };
  }
  // localHead > remoteHead — local is ahead, possibly forked. Replay from
  // a known shared ancestor (we assume the ancestor is remoteHead for
  // simplicity; a real impl would consult a shared log).
  return {
    kind: "replay-from",
    localHead,
    remoteHead,
    replayFrom: remoteHead,
  };
}

// Apply a reconciliation plan to a local head. Returns the new head.
// For "no-op": head unchanged.
// For "catch-up": head = remoteHead (deterministic convergence).
// For "replay-from": head = remoteHead (replay from ancestor).
export function applyReconciliationPlan(plan: ReconciliationPlan, localHead: number): number {
  switch (plan.kind) {
    case "no-op": return localHead;
    case "catch-up": return plan.remoteHead;
    case "replay-from": return plan.remoteHead;
  }
}

// Verify convergence: after applying the plan, localHead must equal remoteHead.
export function verifyConvergence(plan: ReconciliationPlan, newLocalHead: number): boolean {
  return newLocalHead === plan.remoteHead;
}

// ---------------------------------------------------------------------------
// Honest connectivity posture — the agent reports its true connectivity
// state. No exaggeration: an unknown state is reported as "unknown", not
// "online".
// ---------------------------------------------------------------------------

export type ConnectivityPosture = "online" | "offline" | "degraded" | "unknown";

export interface ConnectivityReport {
  readonly agentId: AgentIdLike;
  readonly tenantId: TenantIdLike;
  readonly posture: ConnectivityPosture;
  readonly reportedAt: number;
  readonly lastHeartbeatAt: number | null;
  readonly reason: string | null;
  readonly audit: AuditEventRef;
}

export function reportConnectivity(input: {
  readonly agentId: AgentIdLike;
  readonly tenantId: TenantIdLike;
  readonly posture: ConnectivityPosture;
  readonly reportedAt: number;
  readonly lastHeartbeatAt: number | null;
  readonly reason?: string;
}): ConnectivityReport {
  // Honest posture: if no heartbeat has been received, the posture is
  // forced to "unknown" regardless of what the caller passed.
  const honestPosture: ConnectivityPosture =
    input.lastHeartbeatAt === null && input.posture === "online" ? "unknown" : input.posture;
  return {
    agentId: input.agentId,
    tenantId: input.tenantId,
    posture: honestPosture,
    reportedAt: input.reportedAt,
    lastHeartbeatAt: input.lastHeartbeatAt,
    reason: input.reason ?? null,
    audit: {
      actor: input.agentId,
      intent: `agent:connectivity:${honestPosture}`,
      tenant: input.tenantId,
      timestamp: input.reportedAt,
      digest: digestOf(input.agentId, "connectivity", honestPosture, input.reportedAt),
    },
  };
}
