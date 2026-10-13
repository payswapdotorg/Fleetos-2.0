/**
 * @fleetos/acceptance-field — F341A operation executors: A1 the observations
 * backpressure discipline (Wave 14 lane A; the F340 §1 census candidate A1 —
 * `packages/observations/src/backpressure.ts`, zero prior corpus coverage).
 *
 * Every executor drives a REAL public API of @fleetos/observations
 * (defaultBackpressurePolicy, enqueue, dequeue, evaluateBackpressureLevel —
 * the surface re-exported through ingestion.ts) and records readings from the
 * REAL EnqueueDecision/QueueState outputs — never re-derived. A refused
 * enqueue is the REAL `overflow-refused` decision: the executor surfaces it
 * as an op refusal so `expectRefusal` steps prove the never-silently-drop
 * law (depth unchanged, refused counter incremented).
 */

import {
  defaultBackpressurePolicy,
  dequeue,
  enqueue,
  evaluateBackpressureLevel,
  type BackpressurePolicy,
  type QueueState,
} from "@fleetos/observations";
import type { JourneyOperation } from "../journey-contracts.js";
import type { JourneyContext } from "../context.js";
import { opOk, opRefused, type OpExecution } from "./common.js";

/** The signal values the REAL evaluateBackpressureLevel emits (ok/warn/critical). */
type BpSignal = ReturnType<typeof evaluateBackpressureLevel>;

function queueOf(ctx: JourneyContext, queueId: string): { state: QueueState; policy: BackpressurePolicy } | undefined {
  return ctx.backpressureQueues.get(queueId);
}

function stateReadings(state: QueueState): Record<string, number> {
  return { "bp.depth": state.depth, "bp.refused": state.refused, "bp.shed": state.shed };
}

export function executeF341ABackpressureOperation(op: JourneyOperation, ctx: JourneyContext): OpExecution {
  switch (op.kind) {
    case "bp.queue-open": {
      const policy: BackpressurePolicy = { ...op.policy };
      const entry = { state: { depth: 0, refused: 0, shed: 0 } satisfies QueueState, policy };
      ctx.backpressureQueues.set(op.queueId, entry);
      return opOk({
        ...stateReadings(entry.state),
        "bp.overflowPolicy": policy.overflow,
        "bp.maxQueueDepth": policy.maxQueueDepth,
      });
    }
    case "bp.enqueue-batch": {
      const queue = queueOf(ctx, op.queueId);
      if (!queue) return opRefused("unknown-queue", { "bp.refused": "unknown-queue" });
      const signals: BpSignal[] = [];
      let state = queue.state;
      for (let i = 0; i < op.count; i++) {
        const decision = enqueue(state, queue.policy);
        state = decision.queue;
        if (decision.ok) {
          signals.push(decision.signal);
          continue;
        }
        // The REAL overflow-refused decision: honest refusal, NEVER a silent
        // drop — the depth is unchanged and the refused counter is carried.
        queue.state = state;
        return opRefused(decision.reason, {
          ...stateReadings(state),
          "bp.reason": decision.reason,
          "bp.signal": evaluateBackpressureLevel(state.depth, queue.policy),
          "bp.admitted": signals.length,
          "bp.signals": signals,
        });
      }
      queue.state = state;
      return opOk({
        ...stateReadings(state),
        "bp.admitted": signals.length,
        "bp.signals": signals,
        "bp.signal": signals.length > 0 ? signals[signals.length - 1]! : evaluateBackpressureLevel(state.depth, queue.policy),
      });
    }
    case "bp.dequeue-batch": {
      const queue = queueOf(ctx, op.queueId);
      if (!queue) return opRefused("unknown-queue", { "bp.refused": "unknown-queue" });
      let state = queue.state;
      for (let i = 0; i < op.count; i++) state = dequeue(state);
      queue.state = state;
      return opOk({
        ...stateReadings(state),
        "bp.signal": evaluateBackpressureLevel(state.depth, queue.policy),
      });
    }
    case "bp.level-probe": {
      const queue = queueOf(ctx, op.queueId);
      if (!queue) return opRefused("unknown-queue", { "bp.refused": "unknown-queue" });
      const levels = op.depths.map((d) => evaluateBackpressureLevel(d, queue.policy));
      return opOk({ "bp.depths": [...op.depths], "bp.levels": levels });
    }
    case "bp.policy-defaults": {
      const policy = defaultBackpressurePolicy();
      return opOk({
        "bp.default.maxQueueDepth": policy.maxQueueDepth,
        "bp.default.warnDepth": policy.warnDepth,
        "bp.default.criticalDepth": policy.criticalDepth,
        "bp.default.overflow": policy.overflow,
      });
    }
    default:
      return opRefused("unknown-operation");
  }
}
