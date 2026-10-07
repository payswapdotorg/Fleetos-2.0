/**
 * @fleetos/agent — Wave 3 telemetry queue with priority lanes + refuse-and-retry (F230A).
 *
 * The F220A `edge-path.ts` shipped a basic batcher with size/time triggers.
 * F230A advances to a PRIORITY queue with safety-lane preemption + bounded
 * local queue with refuse-and-retry overflow (NEVER silent drop).
 *
 *   - **two priority lanes** — `safety` (preempts routine) and `routine`.
 *     Safety telemetry (e.g., anomaly-triggered, fault signals) is emitted
 *     ahead of routine telemetry (e.g., periodic samples) on flush.
 *   - **size/time triggers** — the queue flushes when EITHER the total
 *     queue depth crosses `maxBatchSize` OR the oldest event is older
 *     than `maxBatchAgeMs`. Per-lane size thresholds also trigger: if
 *     the safety lane alone crosses `safetyLaneFlushAt`, the queue
 *     flushes immediately (safety preemption).
 *   - **refuse-and-retry overflow** — when the queue is full, `enqueue`
 *     returns a typed `overflow-refused` decision; the caller is expected
 *     to retry. The queue NEVER silent-drops. The caller can consult
 *     `evaluateQueueLevel` to throttle BEFORE overflow.
 *   - **flush ordering** — safety events first (in arrival order), then
 *     routine events (in arrival order).
 *
 * Pure TypeScript. No I/O, no servers, no databases. Persistence lands at
 * F211 (TL lane).
 */

import { createHash } from "node:crypto";
import type { AgentIdLike, TenantIdLike } from "./agent.js";
import type { AuditEventRef } from "./kernel.js";

export type { AuditEventRef };

function digestOf(...parts: ReadonlyArray<string | number>): string {
  const text = parts.map((p) => String(p)).join("|");
  return createHash("sha256").update(text).digest("hex");
}

// ---------------------------------------------------------------------------
// Priority lanes — safety preempts routine.
// ---------------------------------------------------------------------------

export type TelemetryPriority = "safety" | "routine";

export interface PrioritizedTelemetryEvent {
  readonly agentId: AgentIdLike;
  readonly tenantId: TenantIdLike;
  readonly at: number;
  readonly kind: string;
  readonly priority: TelemetryPriority;
  readonly payload: Readonly<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Queue config + state
// ---------------------------------------------------------------------------

export interface PriorityTelemetryQueueConfig {
  readonly maxBatchSize: number; // total queue depth threshold for size-trigger flush
  readonly maxBatchAgeMs: number; // age threshold for time-trigger flush
  readonly safetyLaneFlushAt: number; // safety-lane-only threshold for safety-preemption flush
  readonly maxQueueDepth: number; // hard cap; enqueue above this is refuse-and-retry
}

export function defaultQueueConfig(): PriorityTelemetryQueueConfig {
  return {
    maxBatchSize: 50,
    maxBatchAgeMs: 5_000,
    safetyLaneFlushAt: 5,
    maxQueueDepth: 256,
  };
}

export interface PriorityTelemetryQueue {
  readonly agentId: AgentIdLike;
  readonly tenantId: TenantIdLike;
  readonly safety: ReadonlyArray<PrioritizedTelemetryEvent>;
  readonly routine: ReadonlyArray<PrioritizedTelemetryEvent>;
  readonly firstEnqueuedAt: number | null;
}

export function emptyQueue(agentId: AgentIdLike, tenantId: TenantIdLike): PriorityTelemetryQueue {
  return { agentId, tenantId, safety: [], routine: [], firstEnqueuedAt: null };
}

export function queueDepth(queue: PriorityTelemetryQueue): number {
  return queue.safety.length + queue.routine.length;
}

// ---------------------------------------------------------------------------
// Enqueue — refuse-and-retry on overflow (NEVER silent drop).
// ---------------------------------------------------------------------------

export type EnqueueRejectionCode = "overflow-refused" | "missing-kind" | "agent-mismatch" | "tenant-mismatch";

export type EnqueueResult =
  | {
      readonly ok: true;
      readonly queue: PriorityTelemetryQueue;
      readonly flush: TelemetryFlush | null; // non-null if the enqueue triggered a flush
      readonly audit: AuditEventRef;
    }
  | { readonly ok: false; readonly reason: EnqueueRejectionCode };

export function enqueue(
  queue: PriorityTelemetryQueue,
  event: PrioritizedTelemetryEvent,
  config: PriorityTelemetryQueueConfig,
): EnqueueResult {
  if (event.kind === "") return { ok: false, reason: "missing-kind" };
  if (event.agentId !== queue.agentId) return { ok: false, reason: "agent-mismatch" };
  if (event.tenantId !== queue.tenantId) return { ok: false, reason: "tenant-mismatch" };

  // Hard cap — refuse-and-retry.
  if (queueDepth(queue) >= config.maxQueueDepth) {
    return { ok: false, reason: "overflow-refused" };
  }

  const nextQueue: PriorityTelemetryQueue = {
    ...queue,
    safety: event.priority === "safety" ? [...queue.safety, event] : queue.safety,
    routine: event.priority === "routine" ? [...queue.routine, event] : queue.routine,
    firstEnqueuedAt: queue.firstEnqueuedAt ?? event.at,
  };

  // Check triggers — safety preemption, size, time.
  const flush = maybeFlush(nextQueue, config, event.at);
  const audit: AuditEventRef = {
    actor: event.agentId,
    intent: `agent:telemetry:enqueue:${event.priority}`,
    tenant: event.tenantId,
    timestamp: event.at,
    digest: digestOf(event.agentId, event.kind, event.priority, event.at),
  };
  return {
    ok: true,
    queue: flush ? emptyQueue(queue.agentId, queue.tenantId) : nextQueue,
    flush,
    audit,
  };
}

// ---------------------------------------------------------------------------
// Flush — emits the queue as a typed TelemetryFlush. Safety events first.
// ---------------------------------------------------------------------------

export interface TelemetryFlush {
  readonly agentId: AgentIdLike;
  readonly tenantId: TenantIdLike;
  readonly events: ReadonlyArray<PrioritizedTelemetryEvent>; // safety first, then routine
  readonly safetyCount: number;
  readonly routineCount: number;
  readonly firstAt: number;
  readonly lastAt: number;
  readonly triggeredBy: "safety-preemption" | "size" | "time" | "manual";
  readonly audit: AuditEventRef;
}

export function maybeFlush(
  queue: PriorityTelemetryQueue,
  config: PriorityTelemetryQueueConfig,
  now: number,
): TelemetryFlush | null {
  if (queueDepth(queue) === 0) return null;

  // Safety preemption: safety lane alone crosses its threshold.
  if (queue.safety.length >= config.safetyLaneFlushAt) {
    return buildFlush(queue, "safety-preemption");
  }
  // Size trigger: total depth crosses maxBatchSize.
  if (queueDepth(queue) >= config.maxBatchSize) {
    return buildFlush(queue, "size");
  }
  // Time trigger: oldest event older than maxBatchAgeMs.
  if (queue.firstEnqueuedAt !== null && now - queue.firstEnqueuedAt >= config.maxBatchAgeMs) {
    return buildFlush(queue, "time");
  }
  return null;
}

export function forceFlushQueue(queue: PriorityTelemetryQueue): TelemetryFlush | null {
  if (queueDepth(queue) === 0) return null;
  return buildFlush(queue, "manual");
}

function buildFlush(
  queue: PriorityTelemetryQueue,
  triggeredBy: TelemetryFlush["triggeredBy"],
): TelemetryFlush {
  const events = [...queue.safety, ...queue.routine];
  const firstAt = events[0]!.at;
  const lastAt = events[events.length - 1]!.at;
  return {
    agentId: queue.agentId,
    tenantId: queue.tenantId,
    events,
    safetyCount: queue.safety.length,
    routineCount: queue.routine.length,
    firstAt,
    lastAt,
    triggeredBy,
    audit: {
      actor: queue.agentId,
      intent: `agent:telemetry:flush:${triggeredBy}`,
      tenant: queue.tenantId,
      timestamp: lastAt,
      digest: digestOf(queue.agentId, "flush", triggeredBy, queue.safety.length, queue.routine.length, lastAt),
    },
  };
}

// ---------------------------------------------------------------------------
// Queue-level evaluation — the caller consults this to throttle BEFORE
// overflow. Three levels: ok, warn, critical (matches the F220A backpressure
// vocabulary; we re-derive here to keep the agent package self-contained).
// ---------------------------------------------------------------------------

export type QueueLevel = "ok" | "warn" | "critical";

export function evaluateQueueLevel(
  queue: PriorityTelemetryQueue,
  config: PriorityTelemetryQueueConfig,
): QueueLevel {
  const ratio = queueDepth(queue) / config.maxQueueDepth;
  if (ratio >= 0.9) return "critical";
  if (ratio >= 0.75) return "warn";
  return "ok";
}

// ---------------------------------------------------------------------------
// shouldFlushOnTime — pure time-trigger check (for polling loops).
// ---------------------------------------------------------------------------

export function shouldFlushQueueOnTime(
  queue: PriorityTelemetryQueue,
  now: number,
  config: PriorityTelemetryQueueConfig,
): boolean {
  if (queueDepth(queue) === 0) return false;
  if (queue.firstEnqueuedAt === null) return false;
  return now - queue.firstEnqueuedAt >= config.maxBatchAgeMs;
}
