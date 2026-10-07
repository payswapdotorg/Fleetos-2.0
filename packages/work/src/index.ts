/**
 * @fleetos/work — Work bounded context public contracts.
 *
 * Wave 0 lane C (F200C). Pure TypeScript domain package: types + pure
 * functions only. No I/O, no servers, no databases, no network, no providers.
 *
 * Laws satisfied here (see spec/ARCHITECTURE-LOCK.md):
 *   A1  — one source of business truth (no in-memory fake store here).
 *   A4  — consequential action protocol (state transitions are explicit,
 *         machine-stable reason codes, never silent clamping).
 *   A6  — agent trust boundary (no agent can write work truth here).
 *   A8  — tenant isolation (TenantScope is fail-closed; missing/empty
 *         tenant = refusal).
 *   A20 — no cross-boundary implementation imports; only structural local
 *         seams reference sibling-lane concepts.
 *
 * Cross-worker seam rule: this lane never imports @fleetos/* packages owned
 * by worker A or B. Sibling-lane concepts are referenced through LOCAL
 * structural interfaces (TenantScopeLike, GuardianDecisionRefLike,
 * EvidenceRefLike) plus structural-compatibility tests in tests/.
 */

// ---------------------------------------------------------------------------
// Tenant scope — structural local type (cross-worker seam, see seam rule)
// ---------------------------------------------------------------------------

/**
 * TenantScope is the lane's structural local type for the tenant context
 * established at the application/server boundary (law A8).
 *
 * This is a LOCAL structural type. It is intentionally NOT imported from a
 * sibling lane (worker A's identity/tenancy packages). Sibling lanes may
 * define the same shape; structural-compatibility tests in tests/ prove the
 * shapes align without import-time coupling.
 *
 * Fail-closed: any command or read contract carrying business data MUST
 * validate TenantScope before any further check. Missing/empty tenant =
 * refusal with a machine-stable reason code.
 */
export interface TenantScope {
  readonly tenantId: string;
}

/**
 * Sibling-lane compatibility shape (law A8). Used by structural-compatibility
 * tests only; never imported across package boundaries at runtime.
 */
export interface TenantScopeLike {
  readonly tenantId: string;
}

const TENANT_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * validateTenantScope — fail-closed tenant validation.
 *
 * Returns `ok` for a non-empty, syntactically valid tenant id; otherwise
 * returns a refusal with a machine-stable reason code. NEVER silently
 * coerces an invalid scope to a default tenant.
 */
export function validateTenantScope(scope: unknown): TenantValidation {
  if (scope === null || typeof scope !== "object") {
    return refuse("TENANT_SCOPE_MISSING");
  }
  const candidate = scope as Record<string, unknown>;
  const tenantId = candidate["tenantId"];
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    return refuse("TENANT_ID_EMPTY");
  }
  if (tenantId.length > 128) {
    return refuse("TENANT_ID_TOO_LONG");
  }
  if (!TENANT_PATTERN.test(tenantId)) {
    return refuse("TENANT_ID_INVALID_CHARS");
  }
  return { ok: true, scope: { tenantId } };
}

export type TenantValidation =
  | { ok: true; scope: TenantScope }
  | { ok: false; reasonCode: TenantReasonCode };

export type TenantReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "TENANT_ID_EMPTY"
  | "TENANT_ID_TOO_LONG"
  | "TENANT_ID_INVALID_CHARS";

function refuse(reasonCode: TenantReasonCode): TenantValidation {
  return { ok: false, reasonCode };
}

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

export interface WorkItem {
  readonly id: WorkItemId;
  readonly tenant: TenantScope;
  readonly title: string;
  readonly assignee: Assignment | null;
  readonly deadline: string | null;
  readonly status: WorkItemStatus;
  readonly blockedReason: string | null;
}

export interface WorkItemId {
  readonly kind: "work-item";
  readonly value: string;
}

export interface Assignment {
  readonly assigneeId: string;
  readonly assignedAt: string;
}

// ---------------------------------------------------------------------------
// advanceWorkItem — pure state machine (law A4: explicit transitions,
// machine-stable reason codes; illegal transitions refused, never silently
// coerced).
// ---------------------------------------------------------------------------

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

const ALLOWED_TRANSITIONS: Readonly<Record<WorkItemStatus, readonly string[]>> = {
  todo: ["start", "block", "cancel"],
  in_progress: ["block", "complete", "cancel"],
  blocked: ["unblock", "cancel"],
  done: [],
  cancelled: [],
};

/**
 * advanceWorkItem applies a transition to a WorkItem and returns either a
 * new WorkItem (with the next status) or a refusal with a machine-stable
 * reason code.
 *
 * Determinism: the same input always produces the same output. The function
 * does not consult any external state, time source, or random generator.
 * Timestamps on the produced WorkItem are taken verbatim from the input —
 * callers are responsible for sourcing monotonic clocks.
 */
export function advanceWorkItem(
  current: WorkItem,
  command: WorkItemTransitionCommand,
): WorkItemTransition {
  const tenantCheck = validateTenantScope(current.tenant);
  if (!tenantCheck.ok) {
    return refuseWork("TENANT_SCOPE_MISSING");
  }

  // Re-attach the validated scope to assert structural identity with current.
  if (tenantCheck.scope.tenantId !== current.tenant.tenantId) {
    return refuseWork("TENANT_MISMATCH");
  }

  const allowed = ALLOWED_TRANSITIONS[current.status] ?? [];
  if (!allowed.includes(command.type)) {
    return refuseWork("ILLEGAL_TRANSITION");
  }

  switch (command.type) {
    case "start":
      return { ok: true, next: { ...current, status: "in_progress", blockedReason: null } };
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
        next: { ...current, status: "done", blockedReason: null },
      };
    case "cancel":
      if (!command.reason || command.reason.trim().length === 0) {
        return refuseWork("CANCEL_REASON_REQUIRED");
      }
      return {
        ok: true,
        next: { ...current, status: "cancelled", blockedReason: null },
      };
  }
}

function refuseWork(reasonCode: WorkItemReasonCode): WorkItemTransition {
  return { ok: false, reasonCode };
}

// ---------------------------------------------------------------------------
// Assignment integrity — one assignee per assignment record.
// ---------------------------------------------------------------------------

export type AssignmentResult =
  | { ok: true; assignment: Assignment }
  | { ok: false; reasonCode: AssignmentReasonCode };

export type AssignmentReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "ASSIGNEE_ID_EMPTY"
  | "ALREADY_ASSIGNED";

/**
 * assignTo assigns a single assignee to a work item, refusing if the work
 * item already has a different assignee (law: one assignee per assignment
 * record). Re-assigning to the same assignee is a no-op success.
 */
export function assignTo(
  current: WorkItem,
  assigneeId: string,
  assignedAt: string,
): AssignmentResult {
  const tenantCheck = validateTenantScope(current.tenant);
  if (!tenantCheck.ok) {
    return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  }
  if (!assigneeId || assigneeId.trim().length === 0) {
    return { ok: false, reasonCode: "ASSIGNEE_ID_EMPTY" };
  }
  if (current.assignee !== null && current.assignee.assigneeId !== assigneeId) {
    return { ok: false, reasonCode: "ALREADY_ASSIGNED" };
  }
  return { ok: true, assignment: { assigneeId, assignedAt } };
}

// ---------------------------------------------------------------------------
// Structural seam types for sibling-lane references (never imported across
// package boundaries at runtime; structural-compatibility tests only).
// ---------------------------------------------------------------------------

export interface GuardianDecisionRefLike {
  readonly decisionId: string;
  readonly authorized: boolean;
  readonly reasonCode: string;
}

export interface EvidenceRefLike {
  readonly evidenceId: string;
  readonly tenant: TenantScopeLike;
}
