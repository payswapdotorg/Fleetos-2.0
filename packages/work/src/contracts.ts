/**
 * @fleetos/work — WorkItem contracts and the assignment record.
 *
 * Laws: A1 (no in-memory fake store), A4 (explicit transitions with
 * machine-stable reason codes), A6 (agents cannot write work truth),
 * A8 (tenant isolation), A20 (no cross-boundary imports).
 */

import type { TenantScope } from "./tenant.js";
import type { MissionRefLike, WorkflowRefLike } from "./audit.js";

// ---------------------------------------------------------------------------
// WorkItem contracts
// ---------------------------------------------------------------------------

export type WorkItemStatus =
  | "todo"
  | "in_progress"
  | "blocked"
  | "done"
  | "cancelled";

export const WORK_ITEM_STATUSES: readonly WorkItemStatus[] = [
  "todo",
  "in_progress",
  "blocked",
  "done",
  "cancelled",
];

export const WORK_ITEM_TERMINAL_STATUSES: readonly WorkItemStatus[] = [
  "done",
  "cancelled",
];

export interface WorkItemId {
  readonly kind: "work-item";
  readonly value: string;
}

/**
 * The WorkItem record. The `assignment` field carries the CURRENT
 * assignment record (one assignee per assignment record — invariant).
 * Reassignment is a SUPERSESSION: the old assignment is closed with a
 * `supersededBy` ref pointing at the new assignment, NEVER mutated.
 * The historical assignments are kept on `assignmentHistory` (append-
 * only) so the integrity invariant is observable.
 */
export interface WorkItem {
  readonly id: WorkItemId;
  readonly tenant: TenantScope;
  readonly title: string;
  readonly assignee: Assignment | null;
  readonly assignmentHistory: readonly AssignmentRecord[];
  readonly deadline: string | null;
  readonly status: WorkItemStatus;
  readonly blockedReason: string | null;
  /** Optional mission reference (frozen structural seam). */
  readonly missionRef: MissionRefLike | null;
  /** Optional workflow run reference (frozen structural seam). */
  readonly workflowRef: WorkflowRefLike | null;
  /** Optional project reference (structural; @fleetos/projects is sibling-lane). */
  readonly projectId: string | null;
}

/**
 * Assignment — the live assignment pointer. The invariant is: at most
 * one Assignment is "live" per WorkItem at a time.
 */
export interface Assignment {
  readonly assigneeId: string;
  readonly assignedAt: string;
}

/**
 * AssignmentRecord — the append-only assignment history. A reassignment
 * writes a new record and marks the previous one as superseded.
 */
export interface AssignmentRecord {
  readonly assignmentId: string;
  readonly assigneeId: string;
  readonly assignedAt: string;
  readonly closedAt: string | null;
  /** The assignment record that superseded this one, or null if live. */
  readonly supersededBy: string | null;
  /** Reason for closing (reassignment, completion, cancellation). */
  readonly closeReason: AssignmentCloseReason | null;
}

export type AssignmentCloseReason =
  | "reassigned"
  | "work_completed"
  | "work_cancelled"
  | "assignee_removed";

/**
 * WorkItemTransitionCommand — the commands accepted by advanceWorkItem.
 * Each command is a typed discriminator; never a stringly-typed API.
 */
export type WorkItemTransitionCommand =
  | { type: "start" }
  | { type: "block"; reason: string }
  | { type: "unblock" }
  | { type: "complete" }
  | { type: "cancel"; reason: string };

export type WorkItemTransition =
  | { ok: true; next: WorkItem }
  | { ok: false; reasonCode: WorkItemReasonCode };

export type WorkItemReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "TENANT_MISMATCH"
  | "ILLEGAL_TRANSITION"
  | "BLOCK_REASON_REQUIRED"
  | "CANCEL_REASON_REQUIRED"
  | "ASSIGNEE_REQUIRED_FOR_COMPLETION";

/**
 * The allowed transition matrix. `done` and `cancelled` are terminal —
 * no transitions out. This is the single source of truth for transition
 * legality; tests assert it directly.
 */
export const WORK_ITEM_ALLOWED_TRANSITIONS: Readonly<
  Record<WorkItemStatus, readonly WorkItemTransitionCommand["type"][]>
> = {
  todo: ["start", "block", "cancel"],
  in_progress: ["block", "complete", "cancel"],
  blocked: ["unblock", "cancel"],
  done: [],
  cancelled: [],
};

/**
 * isTerminalWorkItemStatus — predicate used by sibling-lane structural
 * seams (e.g. @fleetos/projects milestone gating) without a runtime
 * import. Returns true for done/cancelled.
 */
export function isTerminalWorkItemStatus(status: string): boolean {
  return status === "done" || status === "cancelled";
}
