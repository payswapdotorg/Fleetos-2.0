/**
 * @fleetos/acceptance-field — F351B operation executors: the work-order
 * shift discipline (work package; census §1 rows W1–W6, zero corpus
 * coverage at base `4f59ffe`).
 *
 * Every executor drives a REAL public API of @fleetos/work
 * (advanceWorkItem, assignTo, reassignTo, progressEventForTransition,
 * progressEventForAssignment, computeProgressDigest) and records
 * readings from the REAL outputs — never re-derived. A refused
 * transition/assignment is the REAL machine-stable reason code: the
 * executor surfaces it as an op refusal so `expectRefusal` steps prove
 * the shift discipline fails closed (illegal transitions, assignment
 * supersession, terminal statuses).
 */

import {
  advanceWorkItem,
  assignTo,
  computeProgressDigest,
  progressEventForAssignment,
  progressEventForTransition,
  reassignTo,
  type WorkItem,
  type WorkItemTransitionCommand,
} from "@fleetos/work";
import type { JourneyOperation } from "../journey-contracts.js";
import type { JourneyContext } from "../context.js";
import { opOk, opRefused, type OpExecution } from "./common.js";

function itemOf(ctx: JourneyContext, itemId: string): WorkItem | undefined {
  return ctx.f351bWorkItems.get(itemId);
}

function commandOf(op: Extract<JourneyOperation, { kind: "wo.transition" }>): WorkItemTransitionCommand {
  switch (op.command) {
    case "start":
      return { type: "start" };
    case "block":
      return { type: "block", reason: op.reason ?? "" };
    case "unblock":
      return { type: "unblock" };
    case "complete":
      return { type: "complete" };
    case "cancel":
      return { type: "cancel", reason: op.reason ?? "" };
  }
}

function emitProgress(
  ctx: JourneyContext,
  event: ReturnType<typeof progressEventForTransition> | ReturnType<typeof progressEventForAssignment>,
) {
  ctx.f351bProgressEvents.push(event);
}

export function executeF351BWorkOperation(op: JourneyOperation, ctx: JourneyContext): OpExecution {
  switch (op.kind) {
    case "wo.open": {
      const item: WorkItem = {
        id: { kind: "work-item", value: op.itemId },
        tenant: { tenantId: ctx.tenantId },
        title: op.title,
        assignee: null,
        assignmentHistory: [],
        deadline: op.deadline,
        status: "todo",
        blockedReason: null,
        missionRef: null,
        workflowRef: null,
        projectId: null,
      };
      ctx.f351bWorkItems.set(op.itemId, item);
      return opOk({
        "wo.status": item.status,
        "wo.assignee": null,
        "wo.historyCount": 0,
        "wo.blockedReason": null,
      });
    }
    case "wo.transition": {
      const current = itemOf(ctx, op.itemId);
      if (current === undefined) return opRefused("unknown-work-item", { "wo.reasonCode": "UNKNOWN_WORK_ITEM" });
      const fromStatus = current.status;
      const result = advanceWorkItem(current, commandOf(op));
      if (!result.ok) {
        return opRefused(result.reasonCode, {
          "wo.reasonCode": result.reasonCode,
          "wo.status": fromStatus,
          "wo.blockedReason": current.blockedReason,
        });
      }
      ctx.f351bWorkItems.set(op.itemId, result.next);
      const event = progressEventForTransition({
        tenant: result.next.tenant,
        workItem: result.next,
        fromStatus,
        toStatus: result.next.status,
        emittedAt: op.emittedAt,
        reason: op.command === "block" || op.command === "cancel" ? (op.reason ?? null) : null,
      });
      emitProgress(ctx, event);
      return opOk({
        "wo.status": result.next.status,
        "wo.blockedReason": result.next.blockedReason,
        "wo.assignee": result.next.assignee ? result.next.assignee.assigneeId : null,
        "wo.historyCount": result.next.assignmentHistory.length,
        "wo.progressKind": event.kind,
        "wo.progressDigest": event.digest,
        "wo.progressCount": ctx.f351bProgressEvents.length,
      });
    }
    case "wo.assign": {
      const current = itemOf(ctx, op.itemId);
      if (current === undefined) return opRefused("unknown-work-item", { "wo.reasonCode": "UNKNOWN_WORK_ITEM" });
      const result = assignTo(current, op.assignmentId, op.assigneeId, op.assignedAt);
      if (!result.ok) {
        return opRefused(result.reasonCode, {
          "wo.reasonCode": result.reasonCode,
          "wo.assignee": current.assignee ? current.assignee.assigneeId : null,
          "wo.historyCount": current.assignmentHistory.length,
        });
      }
      ctx.f351bWorkItems.set(op.itemId, result.next);
      // The REAL kernel's idempotency signal: an idempotent no-op returns
      // `next: current` (same reference) — no state change, no progress event.
      if (result.next !== current) {
        const event = progressEventForAssignment({
          tenant: result.next.tenant,
          workItem: result.next,
          kind: "work.assigned",
          assigneeId: op.assigneeId,
          emittedAt: op.assignedAt,
        });
        emitProgress(ctx, event);
      }
      return opOk({
        "wo.assignee": result.next.assignee ? result.next.assignee.assigneeId : null,
        "wo.historyCount": result.next.assignmentHistory.length,
        "wo.supersededRecordId": result.supersededRecordId,
        "wo.reasonCode": null,
        "wo.progressKind": result.next !== current ? "work.assigned" : null,
        "wo.progressCount": ctx.f351bProgressEvents.length,
      });
    }
    case "wo.reassign": {
      const current = itemOf(ctx, op.itemId);
      if (current === undefined) return opRefused("unknown-work-item", { "wo.reasonCode": "UNKNOWN_WORK_ITEM" });
      const result = reassignTo(current, op.assignmentId, op.assigneeId, op.reassignedAt);
      if (!result.ok) {
        return opRefused(result.reasonCode, {
          "wo.reasonCode": result.reasonCode,
          "wo.historyCount": current.assignmentHistory.length,
        });
      }
      ctx.f351bWorkItems.set(op.itemId, result.next);
      if (result.next !== current) {
        const event = progressEventForAssignment({
          tenant: result.next.tenant,
          workItem: result.next,
          kind: "work.reassigned",
          assigneeId: op.assigneeId,
          emittedAt: op.reassignedAt,
        });
        emitProgress(ctx, event);
      }
      const liveRecord = result.next.assignmentHistory.find((r) => r.supersededBy === null && r.closedAt === null);
      const closedRecord = result.next.assignmentHistory.find((r) => r.assignmentId === result.supersededRecordId);
      return opOk({
        "wo.assignee": result.next.assignee ? result.next.assignee.assigneeId : null,
        "wo.historyCount": result.next.assignmentHistory.length,
        "wo.supersededRecordId": result.supersededRecordId,
        "wo.supersededCloseReason": closedRecord ? closedRecord.closeReason : null,
        "wo.liveRecordId": liveRecord ? liveRecord.assignmentId : null,
        "wo.reasonCode": null,
        "wo.progressKind": result.next !== current ? "work.reassigned" : null,
        "wo.progressCount": ctx.f351bProgressEvents.length,
      });
    }
    case "wo.progress-digest": {
      const digest = computeProgressDigest({
        kind: op.kindOf,
        workItemId: op.itemId,
        tenantId: ctx.tenantId,
        emittedAt: op.emittedAt,
        fromStatus: op.fromStatus,
        toStatus: op.toStatus,
      });
      return opOk({
        "wo.recomputedDigest": digest,
        "wo.lastEventDigest": ctx.f351bProgressEvents.length > 0 ? ctx.f351bProgressEvents[ctx.f351bProgressEvents.length - 1]!.digest : null,
      });
    }
    default:
      return opRefused("unknown-operation");
  }
}
