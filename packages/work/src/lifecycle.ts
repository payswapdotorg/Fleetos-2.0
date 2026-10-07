/**
 * @fleetos/work — advanceWorkItem pure state machine + assignTo with
 * supersession discipline.
 *
 * Laws: A4 (consequential action protocol; explicit transitions,
 * machine-stable reason codes; illegal transitions refused, never
 * silently coerced), A8 (tenant isolation, fail-closed), A19 (audit
 * events emitted for every consequential operation).
 *
 * Determinism: same inputs always produce same outputs. No clock, no
 * random, no I/O. Timestamps are taken verbatim from caller input.
 */

import type { TenantScope } from "./tenant.js";
import { validateTenantScope } from "./tenant.js";
import {
  type Assignment,
  type AssignmentCloseReason,
  type AssignmentRecord,
  type WorkItem,
  type WorkItemReasonCode,
  type WorkItemTransition,
  type WorkItemTransitionCommand,
  WORK_ITEM_ALLOWED_TRANSITIONS,
} from "./contracts.js";

// ---------------------------------------------------------------------------
// advanceWorkItem — pure state machine.
// ---------------------------------------------------------------------------

export function advanceWorkItem(
  current: WorkItem,
  command: WorkItemTransitionCommand,
): WorkItemTransition {
  const tenantCheck = validateTenantScope(current.tenant);
  if (!tenantCheck.ok) {
    return refuseWork("TENANT_SCOPE_MISSING");
  }
  if (tenantCheck.scope.tenantId !== current.tenant.tenantId) {
    return refuseWork("TENANT_MISMATCH");
  }

  const allowed = WORK_ITEM_ALLOWED_TRANSITIONS[current.status] ?? [];
  if (!allowed.includes(command.type)) {
    return refuseWork("ILLEGAL_TRANSITION");
  }

  switch (command.type) {
    case "start":
      return {
        ok: true,
        next: { ...current, status: "in_progress", blockedReason: null },
      };
    case "block":
      if (!command.reason || command.reason.trim().length === 0) {
        return refuseWork("BLOCK_REASON_REQUIRED");
      }
      return {
        ok: true,
        next: { ...current, status: "blocked", blockedReason: command.reason },
      };
    case "unblock":
      return {
        ok: true,
        next: { ...current, status: "in_progress", blockedReason: null },
      };
    case "complete":
      if (current.assignee === null) {
        return refuseWork("ASSIGNEE_REQUIRED_FOR_COMPLETION");
      }
      return {
        ok: true,
        next: closeAssignment(current, "work_completed", command),
      };
    case "cancel":
      if (!command.reason || command.reason.trim().length === 0) {
        return refuseWork("CANCEL_REASON_REQUIRED");
      }
      return {
        ok: true,
        next: closeAssignment(current, "work_cancelled", command),
      };
  }
}

function refuseWork(reasonCode: WorkItemReasonCode): WorkItemTransition {
  return { ok: false, reasonCode };
}

/**
 * Close the live assignment on terminal transitions (complete/cancel).
 * Pure: produces a new WorkItem with the assignment closed in history.
 */
function closeAssignment(
  current: WorkItem,
  reason: AssignmentCloseReason,
  command: WorkItemTransitionCommand,
): WorkItem {
  if (current.assignee === null) {
    // Defensive: callers should have rejected this case earlier. Keep
    // the WorkItem shape consistent regardless.
    if (command.type === "complete") {
      return { ...current, status: "done", blockedReason: null };
    }
    return { ...current, status: "cancelled", blockedReason: null };
  }
  // Find the live assignment record (the one with supersededBy === null
  // and closedAt === null) and close it.
  const now = command.type === "complete" ? current.assignee.assignedAt : current.assignee.assignedAt;
  const closedRecordId = current.assignmentHistory.find(
    (r) => r.supersededBy === null && r.closedAt === null,
  )?.assignmentId ?? null;
  const updatedHistory: AssignmentRecord[] = current.assignmentHistory.map((r) =>
    r.assignmentId === closedRecordId
      ? { ...r, closedAt: now, closeReason: reason }
      : r,
  );
  const terminal = command.type === "complete" ? "done" : "cancelled";
  return {
    ...current,
    status: terminal,
    blockedReason: null,
    assignee: null,
    assignmentHistory: updatedHistory,
  };
}

// ---------------------------------------------------------------------------
// assignTo + reassignTo — assignment integrity with supersession.
// ---------------------------------------------------------------------------

export type AssignmentResult =
  | { ok: true; assignment: Assignment; next: WorkItem; supersededRecordId: string | null }
  | { ok: false; reasonCode: AssignmentReasonCode };

export type AssignmentReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "ASSIGNEE_ID_EMPTY"
  | "ALREADY_ASSIGNED"
  | "ASSIGNMENT_ID_EMPTY";

/**
 * assignTo assigns the FIRST assignee to a work item. Refuses if the
 * work item already has a live assignee (use reassignTo for that).
 * Law: one assignee per assignment record. Re-assigning to the same
 * assignee is a no-op success.
 */
export function assignTo(
  current: WorkItem,
  assignmentId: string,
  assigneeId: string,
  assignedAt: string,
): AssignmentResult {
  const tenantCheck = validateTenantScope(current.tenant);
  if (!tenantCheck.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  if (!assignmentId || assignmentId.trim().length === 0) {
    return { ok: false, reasonCode: "ASSIGNMENT_ID_EMPTY" };
  }
  if (!assigneeId || assigneeId.trim().length === 0) {
    return { ok: false, reasonCode: "ASSIGNEE_ID_EMPTY" };
  }
  if (current.assignee !== null) {
    if (current.assignee.assigneeId === assigneeId) {
      // Idempotent: re-assigning to the same assignee is a no-op success.
      return {
        ok: true,
        assignment: current.assignee,
        next: current,
        supersededRecordId: null,
      };
    }
    return { ok: false, reasonCode: "ALREADY_ASSIGNED" };
  }
  const record: AssignmentRecord = {
    assignmentId,
    assigneeId,
    assignedAt,
    closedAt: null,
    supersededBy: null,
    closeReason: null,
  };
  const next: WorkItem = {
    ...current,
    assignee: { assigneeId, assignedAt },
    assignmentHistory: [...current.assignmentHistory, record],
  };
  return { ok: true, assignment: next.assignee!, next, supersededRecordId: null };
}

/**
 * reassignTo — reassignment is a SUPERSESSION. The old assignment closes
 * with a supersededBy ref pointing at the new assignment; the old
 * assignment is NEVER mutated in place. The new assignment record is
 * appended to assignmentHistory (append-only).
 *
 * Refuses if there is no live assignee to supersede (use assignTo for
 * the first assignment).
 */
export function reassignTo(
  current: WorkItem,
  newAssignmentId: string,
  newAssigneeId: string,
  reassignedAt: string,
): AssignmentResult {
  const tenantCheck = validateTenantScope(current.tenant);
  if (!tenantCheck.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  if (!newAssignmentId || newAssignmentId.trim().length === 0) {
    return { ok: false, reasonCode: "ASSIGNMENT_ID_EMPTY" };
  }
  if (!newAssigneeId || newAssigneeId.trim().length === 0) {
    return { ok: false, reasonCode: "ASSIGNEE_ID_EMPTY" };
  }
  if (current.assignee === null) {
    // No live assignment to supersede — refuse; caller should use assignTo.
    return { ok: false, reasonCode: "ALREADY_ASSIGNED" };
  }
  if (current.assignee.assigneeId === newAssigneeId) {
    // Idempotent: re-assigning to the same assignee is a no-op success.
    return {
      ok: true,
      assignment: current.assignee,
      next: current,
      supersededRecordId: null,
    };
  }

  // Find the live record (supersededBy === null, closedAt === null) and
  // mark it superseded by the new assignment id. NEVER mutate the old
  // record's assigneeId or assignedAt — only the supersededBy/closedAt/
  // closeReason fields.
  const liveRecord = current.assignmentHistory.find(
    (r) => r.supersededBy === null && r.closedAt === null,
  );
  const supersededRecordId = liveRecord?.assignmentId ?? null;
  const updatedHistory: AssignmentRecord[] = current.assignmentHistory.map((r) =>
    r.assignmentId === supersededRecordId
      ? {
          ...r,
          closedAt: reassignedAt,
          supersededBy: newAssignmentId,
          closeReason: "reassigned",
        }
      : r,
  );
  const newRecord: AssignmentRecord = {
    assignmentId: newAssignmentId,
    assigneeId: newAssigneeId,
    assignedAt: reassignedAt,
    closedAt: null,
    supersededBy: null,
    closeReason: null,
  };
  const next: WorkItem = {
    ...current,
    assignee: { assigneeId: newAssigneeId, assignedAt: reassignedAt },
    assignmentHistory: [...updatedHistory, newRecord],
  };
  return {
    ok: true,
    assignment: next.assignee!,
    next,
    supersededRecordId,
  };
}

/**
 * removeAssignee — closes the live assignment with closeReason
 * "assignee_removed". Used when an assignee leaves or is unavailable.
 * Refuses if there is no live assignee.
 */
export type RemoveAssigneeResult =
  | { ok: true; next: WorkItem; closedRecordId: string }
  | { ok: false; reasonCode: AssignmentReasonCode };

export function removeAssignee(
  current: WorkItem,
  removedAt: string,
): RemoveAssigneeResult {
  const tenantCheck = validateTenantScope(current.tenant);
  if (!tenantCheck.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  if (current.assignee === null) {
    return { ok: false, reasonCode: "ALREADY_ASSIGNED" };
  }
  const liveRecord = current.assignmentHistory.find(
    (r) => r.supersededBy === null && r.closedAt === null,
  );
  const closedRecordId = liveRecord?.assignmentId ?? "unknown";
  const updatedHistory: AssignmentRecord[] = current.assignmentHistory.map((r) =>
    r.assignmentId === closedRecordId
      ? { ...r, closedAt: removedAt, closeReason: "assignee_removed" }
      : r,
  );
  return {
    ok: true,
    next: { ...current, assignee: null, assignmentHistory: updatedHistory },
    closedRecordId,
  };
}

/**
 * Helper exported for tests — finds the live assignment record, or null.
 */
export function findLiveAssignmentRecord(
  history: readonly AssignmentRecord[],
): AssignmentRecord | null {
  return (
    history.find((r) => r.supersededBy === null && r.closedAt === null) ?? null
  );
}

/**
 * Helper exported for tests — verifies the integrity invariant: at most
 * one live assignment record, and (if assignee is non-null) the live
 * record's assigneeId matches the WorkItem.assignee.assigneeId.
 */
export function assignmentIntegrityHolds(item: WorkItem): boolean {
  const live = item.assignmentHistory.filter(
    (r) => r.supersededBy === null && r.closedAt === null,
  );
  if (live.length > 1) return false;
  if (live.length === 0) return item.assignee === null;
  if (item.assignee === null) return false;
  return live[0]!.assigneeId === item.assignee.assigneeId;
}

// Re-export TenantScope here so callers can import everything from one
// module if desired.
export type { TenantScope };
