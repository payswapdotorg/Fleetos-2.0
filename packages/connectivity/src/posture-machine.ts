/**
 * @fleetos/connectivity — Wave 3 honest posture model + message durability (F230A).
 *
 * The F220A `posture.ts` shipped a deterministic sweep over recorded status
 * (online/offline/degraded/unknown). F230A advances to a RUNTIME posture
 * state machine — the typed transitions the edge agent emits as it crosses
 * outage boundaries — and a durable message queue that survives reconnects.
 *
 *   - `PostureState` is `offline | degraded | connected` per the F230A spec.
 *     (The F220A sweep-level `unknown` is folded into `offline` here: the
 *     runtime's invariant is "we have a posture"; the sweep's `unknown` is
 *     the sweep's posture, not the agent's.)
 *   - `transitionPosture` is pure: same (current, event, now) -> same result.
 *     Illegal transitions are refused with typed reason codes; the runtime
 *     never silently accepts an undefined transition (e.g. `connected` ->
 *     `connected` with no event is refused as `already-in-state`).
 *   - `MessageDurabilityQueue` — a bounded at-least-once queue with explicit
 *     dedup on arrival. A message accepted locally is delivered exactly-once
 *     up to the adapter's typed at-least-once contract + dedup on the
 *     receiving side. Overflow is refuse-and-retry (NEVER silent drop) —
 *     matches the F220A `backpressure.ts` policy.
 *   - `propagateBackpressure` — when the queue depth crosses a threshold,
 *     the signal is propagated to the batching engine so the caller can
 *     shed load BEFORE the queue overflows.
 *
 * Pure TypeScript. No I/O, no servers, no databases. Persistence lands at
 * F211 (TL lane).
 */

import { createHash } from "node:crypto";
import type { DeviceIdLike, TenantIdLike } from "./connectivity.js";
import type { AuditEventRef } from "./kernel.js";

export type { AuditEventRef };

function digestOf(...parts: ReadonlyArray<string | number>): string {
  const text = parts.map((p) => String(p)).join("|");
  return createHash("sha256").update(text).digest("hex");
}

// ---------------------------------------------------------------------------
// Runtime posture state machine — offline / degraded / connected.
//
// The agent's runtime posture is one of these three states. The sweep's
// `unknown` is the sweep's posture (a sweep over recorded status records);
// the runtime's invariant is "we know our posture" (default `offline` until
// the first heartbeat confirms otherwise).
// ---------------------------------------------------------------------------

export type PostureState = "offline" | "degraded" | "connected";

export type PostureEventKind =
  | "heartbeat-fresh" // a fresh heartbeat arrived -> move toward connected
  | "heartbeat-stale" // heartbeat is stale -> move toward degraded
  | "heartbeat-dead" // heartbeat is dead -> move toward offline
  | "transport-up" // transport channel is up
  | "transport-down" // transport channel is down
  | "manual-degrade" // operator-initiated degrade
  | "manual-recover"; // operator-initiated recover

export interface PostureEvent {
  readonly kind: PostureEventKind;
  readonly at: number;
  readonly reason?: string;
}

export type PostureTransitionRejectionCode =
  | "illegal-transition"
  | "already-in-state"
  | "missing-reason";

export type PostureTransitionResult =
  | {
      readonly ok: true;
      readonly from: PostureState;
      readonly to: PostureState;
      readonly audit: AuditEventRef;
    }
  | { readonly ok: false; readonly reason: PostureTransitionRejectionCode };

// Legal transitions: (current, event) -> next.
const POSTURE_TRANSITIONS: Readonly<Record<
  PostureState,
  Partial<Record<PostureEventKind, PostureState>>
>> = {
  offline: {
    "transport-up": "degraded", // transport up doesn't mean connected — wait for heartbeat
    "heartbeat-fresh": "connected",
    "manual-recover": "degraded",
  },
  degraded: {
    "heartbeat-fresh": "connected",
    "heartbeat-stale": "degraded", // self-loop refused by `already-in-state`
    "heartbeat-dead": "offline",
    "transport-down": "offline",
    "manual-degrade": "offline",
    "manual-recover": "connected",
  },
  connected: {
    "heartbeat-stale": "degraded",
    "heartbeat-dead": "offline",
    "transport-down": "offline",
    "manual-degrade": "degraded",
  },
};

export function transitionPosture(
  current: PostureState,
  event: PostureEvent,
  tenantId: TenantIdLike,
  deviceId: DeviceIdLike,
): PostureTransitionResult {
  // Manual degrade/recover require a reason (audit trail).
  if (
    (event.kind === "manual-degrade" || event.kind === "manual-recover") &&
    (event.reason === undefined || event.reason === "")
  ) {
    return { ok: false, reason: "missing-reason" };
  }

  const next = POSTURE_TRANSITIONS[current]?.[event.kind];
  if (next === undefined) {
    return { ok: false, reason: "illegal-transition" };
  }
  if (next === current) {
    return { ok: false, reason: "already-in-state" };
  }
  const audit: AuditEventRef = {
    actor: `system:posture:${deviceId}`,
    intent: `connectivity:posture:${current}->${next}`,
    tenant: tenantId,
    timestamp: event.at,
    digest: digestOf(deviceId, "posture", current, next, event.kind, event.at),
  };
  return { ok: true, from: current, to: next, audit };
}

// ---------------------------------------------------------------------------
// Posture history — append-only log of transitions for diagnostics. The
// history is bounded; oldest entries are evicted when the bound is exceeded.
// ---------------------------------------------------------------------------

export interface PostureHistoryEntry {
  readonly at: number;
  readonly from: PostureState;
  readonly to: PostureState;
  readonly eventKind: PostureEventKind;
  readonly reason: string | null;
}

export interface PostureHistory {
  readonly deviceId: DeviceIdLike;
  readonly entries: ReadonlyArray<PostureHistoryEntry>;
  readonly maxSize: number;
}

export function emptyPostureHistory(deviceId: DeviceIdLike, maxSize = 64): PostureHistory {
  return { deviceId, entries: [], maxSize };
}

export function appendPostureHistory(
  history: PostureHistory,
  entry: PostureHistoryEntry,
): PostureHistory {
  const entries = [...history.entries, entry];
  if (entries.length <= history.maxSize) {
    return { ...history, entries };
  }
  return { ...history, entries: entries.slice(entries.length - history.maxSize) };
}

// ---------------------------------------------------------------------------
// Message durability queue — at-least-once with dedup on arrival.
//
// The queue is the agent's OUTBOX: messages accepted locally pending upload.
// On reconnect, the queue's `pending` set is re-emitted (at-least-once). The
// RECEIVER (the upstream service) is expected to dedup using the messageId —
// `dedupOnArrival` is the receiver-side helper.
//
// Overflow policy: refuse-and-retry (matches F220A backpressure.ts). The
// caller receives a typed `overflow-refused` decision and is expected to
// retry. NEVER silent drop.
// ---------------------------------------------------------------------------

export interface DurableMessage {
  readonly id: string; // unique messageId (caller-assigned, content-addressed)
  readonly tenantId: TenantIdLike;
  readonly deviceId: DeviceIdLike;
  readonly kind: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly enqueuedAt: number;
  readonly digest: string; // sha-256 over (id, kind, payload) — integrity
}

export interface MessageDurabilityQueue {
  readonly tenantId: TenantIdLike;
  readonly deviceId: DeviceIdLike;
  readonly pending: ReadonlyMap<string, DurableMessage>; // messageId -> message
  readonly delivered: ReadonlySet<string>; // messageIds confirmed delivered (for dedup signal)
  readonly maxSize: number;
}

export function emptyMessageQueue(
  tenantId: TenantIdLike,
  deviceId: DeviceIdLike,
  maxSize = 256,
): MessageDurabilityQueue {
  return { tenantId, deviceId, pending: new Map(), delivered: new Set(), maxSize };
}

export type EnqueueRejectionCode = "overflow-refused" | "missing-message-id" | "missing-kind" | "tenant-mismatch";

export type EnqueueResult =
  | {
      readonly ok: true;
      readonly message: DurableMessage;
      readonly queue: MessageDurabilityQueue;
      readonly audit: AuditEventRef;
    }
  | { readonly ok: false; readonly reason: EnqueueRejectionCode };

export function enqueueMessage(
  queue: MessageDurabilityQueue,
  input: {
    readonly id: string;
    readonly kind: string;
    readonly payload: Readonly<Record<string, unknown>>;
    readonly at: number;
  },
): EnqueueResult {
  if (input.id === "") return { ok: false, reason: "missing-message-id" };
  if (input.kind === "") return { ok: false, reason: "missing-kind" };
  // Already pending — idempotent re-enqueue returns the existing message.
  const existing = queue.pending.get(input.id);
  if (existing) {
    return { ok: true, message: existing, queue, audit: makeAudit(existing, "duplicate-enqueue") };
  }
  if (queue.pending.size >= queue.maxSize) {
    return { ok: false, reason: "overflow-refused" };
  }
  const digest = digestOf(input.id, input.kind, JSON.stringify(input.payload));
  const message: DurableMessage = {
    id: input.id,
    tenantId: queue.tenantId,
    deviceId: queue.deviceId,
    kind: input.kind,
    payload: input.payload,
    enqueuedAt: input.at,
    digest,
  };
  const pending = new Map(queue.pending);
  pending.set(input.id, message);
  const audit = makeAudit(message, "enqueue");
  return { ok: true, message, queue: { ...queue, pending }, audit };
}

// Acknowledge a message as delivered (the upstream service confirmed receipt).
// Removes from pending; adds to delivered (bounded ring).
export function ackMessage(queue: MessageDurabilityQueue, messageId: string, at: number): {
  readonly queue: MessageDurabilityQueue;
  readonly audit: AuditEventRef | null;
} {
  if (!queue.pending.has(messageId)) {
    return { queue, audit: null };
  }
  const pending = new Map(queue.pending);
  pending.delete(messageId);
  // Delivered set is bounded by maxSize (drop oldest when exceeded — the
  // delivered set is a dedup signal, not an audit log; bounded loss is
  // acceptable because the upstream service has its own dedup).
  const delivered = new Set(queue.delivered);
  if (delivered.size >= queue.maxSize) {
    // Drop ~25% of the oldest entries (Set iteration order = insertion order).
    const keep = Math.floor(queue.maxSize * 0.75);
    let i = 0;
    for (const id of delivered) {
      if (i >= keep) delivered.delete(id);
      i++;
    }
  }
  delivered.add(messageId);
  const audit: AuditEventRef = {
    actor: `system:outbox:${queue.deviceId}`,
    intent: "connectivity:outbox:ack",
    tenant: queue.tenantId,
    timestamp: at,
    digest: digestOf(queue.deviceId, "outbox-ack", messageId, at),
  };
  return { queue: { ...queue, pending, delivered }, audit };
}

// On reconnect, re-emit all pending messages (at-least-once). The order is
// the enqueue order (Map iteration order = insertion order). The caller is
// expected to walk this list and re-transmit each message.
export function redeliverPending(queue: MessageDurabilityQueue): ReadonlyArray<DurableMessage> {
  return [...queue.pending.values()];
}

// ---------------------------------------------------------------------------
// Dedup on arrival — the receiver-side helper. Tracks delivered messageIds
// in a bounded set; a re-delivered messageId returns `duplicate`. The
// receiver consults this BEFORE applying the message.
// ---------------------------------------------------------------------------

export interface DedupRegistry {
  readonly seen: ReadonlySet<string>;
  readonly maxSize: number;
}

export function emptyDedupRegistry(maxSize = 1024): DedupRegistry {
  return { seen: new Set(), maxSize };
}

export type DedupDecision =
  | { readonly ok: true; readonly registry: DedupRegistry; readonly duplicate: false }
  | { readonly ok: true; readonly registry: DedupRegistry; readonly duplicate: true }
  | { readonly ok: false; readonly reason: "registry-full" };

export function dedupOnArrival(
  registry: DedupRegistry,
  messageId: string,
): DedupDecision {
  if (registry.seen.has(messageId)) {
    return { ok: true, registry, duplicate: true };
  }
  let seen = registry.seen;
  if (seen.size >= registry.maxSize) {
    // Drop oldest ~25% (Set iteration order = insertion order).
    const keep = Math.floor(registry.maxSize * 0.75);
    const arr = [...seen];
    seen = new Set(arr.slice(arr.length - keep));
  }
  const next = new Set(seen);
  next.add(messageId);
  return { ok: true, registry: { seen: next, maxSize: registry.maxSize }, duplicate: false };
}

// ---------------------------------------------------------------------------
// Back-pressure propagation — when the queue depth crosses a threshold, the
// signal is propagated to the batching engine so the caller can shed load
// BEFORE the queue overflows. Three levels: ok (green), warn (yellow),
// critical (red). The caller consults the level and decides whether to
// throttle.
// ---------------------------------------------------------------------------

export type BackpressureLevel = "ok" | "warn" | "critical";

export interface BackpressureThresholds {
  readonly warnAt: number; // fraction of maxSize (e.g., 0.75)
  readonly criticalAt: number; // fraction of maxSize (e.g., 0.9)
}

export function defaultBackpressureThresholds(): BackpressureThresholds {
  return { warnAt: 0.75, criticalAt: 0.9 };
}

export function evaluateBackpressure(
  queue: MessageDurabilityQueue,
  thresholds: BackpressureThresholds = defaultBackpressureThresholds(),
): BackpressureLevel {
  const ratio = queue.pending.size / queue.maxSize;
  if (ratio >= thresholds.criticalAt) return "critical";
  if (ratio >= thresholds.warnAt) return "warn";
  return "ok";
}

// Propagation contract — the typed signal the batching engine consumes.
// `accept` = caller may keep enqueuing; `shed` = caller should shed routine
// load (keep only safety); `reject` = caller must refuse all new enqueues.
export type BackpressureSignal = "accept" | "shed" | "reject";

export function propagateBackpressure(level: BackpressureLevel): BackpressureSignal {
  switch (level) {
    case "ok": return "accept";
    case "warn": return "shed";
    case "critical": return "reject";
  }
}

// ---------------------------------------------------------------------------
// Audit helper — produces a typed AuditEventRef for an outbox operation.
// ---------------------------------------------------------------------------

function makeAudit(message: DurableMessage, intent: string): AuditEventRef {
  return {
    actor: `system:outbox:${message.deviceId}`,
    intent: `connectivity:outbox:${intent}`,
    tenant: message.tenantId,
    timestamp: message.enqueuedAt,
    digest: digestOf(message.deviceId, intent, message.id, message.enqueuedAt),
  };
}
