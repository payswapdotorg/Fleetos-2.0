/**
 * @fleetos/observations — Wave 2 back-pressure policy types (F220A).
 *
 * Bounded queues with explicit overflow behavior. NEVER silent drop.
 * The policy is refuse-and-retry: when the queue is full, the caller
 * receives `overflow-refused` and is expected to retry.
 */

import type { DeviceIdLike } from "./observations.js";

// ---------------------------------------------------------------------------
// OverflowPolicy — refuse-and-retry (default) or shed-oldest.
// ---------------------------------------------------------------------------

export type OverflowPolicy = "refuse" | "shed-oldest";

export interface BackpressurePolicy {
  readonly maxQueueDepth: number;
  readonly warnDepth: number;
  readonly criticalDepth: number;
  readonly overflow: OverflowPolicy;
}

export function defaultBackpressurePolicy(): BackpressurePolicy {
  return {
    maxQueueDepth: 1000,
    warnDepth: 100,
    criticalDepth: 500,
    overflow: "refuse",
  };
}

// ---------------------------------------------------------------------------
// QueueState — the live state of a back-pressured queue.
// ---------------------------------------------------------------------------

export interface QueueState {
  readonly depth: number;
  readonly refused: number;
  readonly shed: number;
}

export type EnqueueDecision =
  | { readonly ok: true; readonly signal: BackpressureLevel; readonly queue: QueueState }
  | { readonly ok: false; readonly reason: "overflow-refused"; readonly queue: QueueState };

export type BackpressureLevel = "ok" | "warn" | "critical";

export function evaluateBackpressureLevel(depth: number, policy: BackpressurePolicy): BackpressureLevel {
  if (depth >= policy.criticalDepth) return "critical";
  if (depth >= policy.warnDepth) return "warn";
  return "ok";
}

export function enqueue(state: QueueState, policy: BackpressurePolicy): EnqueueDecision {
  if (state.depth >= policy.maxQueueDepth) {
    if (policy.overflow === "shed-oldest") {
      // Shed the oldest item to make room; record the shed count.
      const queue: QueueState = { depth: state.depth, refused: state.refused, shed: state.shed + 1 };
      return { ok: true, signal: evaluateBackpressureLevel(state.depth, policy), queue };
    }
    // refuse-and-retry: the caller receives `overflow-refused` and is
    // expected to retry (with a small backoff). NEVER silent drop.
    return { ok: false, reason: "overflow-refused", queue: { ...state, refused: state.refused + 1 } };
  }
  const nextDepth = state.depth + 1;
  const queue: QueueState = { depth: nextDepth, refused: state.refused, shed: state.shed };
  return { ok: true, signal: evaluateBackpressureLevel(nextDepth, policy), queue };
}

export function dequeue(state: QueueState): QueueState {
  return { ...state, depth: Math.max(0, state.depth - 1) };
}

// Re-export DeviceIdLike for callers who want it from this module.
export type { DeviceIdLike };
