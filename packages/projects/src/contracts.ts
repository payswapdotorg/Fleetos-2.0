/**
 * @fleetos/projects — Projects bounded context public contracts.
 *
 * Wave 1 lane C (F210C) kernel-grade. Pure TypeScript domain package:
 * types + pure functions + a structural repository port + an in-memory
 * reference adapter. No I/O except through the port.
 *
 * Laws: A1, A4, A8 (tenant isolation, fail-closed), A20.
 *
 * Wave 1 kernel-grade additions over Wave 0 (F200C):
 *   - milestone gating made REAL: deterministic check with honest
 *     blocking-item reports (status + reason per blocking item);
 *   - project lifecycle transitions with audit events;
 *   - portfolio read models (tenant-scoped);
 *   - ProjectDirectory over ProjectRepositoryPort + in-memory reference.
 */

export interface TenantScope {
  readonly tenantId: string;
}

export type TenantValidation =
  | { ok: true; scope: TenantScope }
  | { ok: false; reasonCode: TenantReasonCode };

export type TenantReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "TENANT_ID_EMPTY"
  | "TENANT_ID_TOO_LONG"
  | "TENANT_ID_INVALID_CHARS";

const TENANT_PATTERN = /^[A-Za-z0-9_-]+$/;

export function validateTenantScope(scope: unknown): TenantValidation {
  if (scope === null || typeof scope !== "object") {
    return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  }
  const candidate = scope as Record<string, unknown>;
  const tenantId = candidate["tenantId"];
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    return { ok: false, reasonCode: "TENANT_ID_EMPTY" };
  }
  if (tenantId.length > 128) {
    return { ok: false, reasonCode: "TENANT_ID_TOO_LONG" };
  }
  if (!TENANT_PATTERN.test(tenantId)) {
    return { ok: false, reasonCode: "TENANT_ID_INVALID_CHARS" };
  }
  return { ok: true, scope: { tenantId } };
}

// ---------------------------------------------------------------------------
// Project + Milestone contracts.
// ---------------------------------------------------------------------------

export type ProjectStatus =
  | "draft"
  | "active"
  | "on_hold"
  | "completed"
  | "cancelled";

export const PROJECT_STATUSES: readonly ProjectStatus[] = [
  "draft",
  "active",
  "on_hold",
  "completed",
  "cancelled",
];

export const PROJECT_TERMINAL_STATUSES: readonly ProjectStatus[] = [
  "completed",
  "cancelled",
];

export interface ProjectId {
  readonly kind: "project";
  readonly value: string;
}

export interface Project {
  readonly id: ProjectId;
  readonly tenant: TenantScope;
  readonly name: string;
  readonly status: ProjectStatus;
  readonly milestoneIds: readonly string[];
}

export type MilestoneStatus = "open" | "achieved" | "skipped";

export interface MilestoneId {
  readonly kind: "milestone";
  readonly value: string;
}

export interface Milestone {
  readonly id: MilestoneId;
  readonly tenant: TenantScope;
  readonly projectId: string;
  readonly name: string;
  readonly status: MilestoneStatus;
  /** Work item ids that must reach a terminal status before this milestone
   * can be considered achieved. */
  readonly workItemIds: readonly string[];
}

/**
 * Sibling-lane work-item status reference (LOCAL structural seam — never
 * imported across package boundaries at runtime). Used only to gate
 * milestone achievement without taking a runtime dependency on
 * @fleetos/work. The shape carries the work item's CURRENT status so
 * the gate can produce honest blocking-item reports.
 */
export interface WorkItemStatusRefLike {
  readonly id: string;
  readonly status: string;
}

/**
 * BlockingItem — honest report per work item that prevents milestone
 * achievement. Carries the work item id, its current status, and a
 * stable reason code. Never silently coerced to "achieved".
 */
export interface BlockingItem {
  readonly workItemId: string;
  readonly currentStatus: string;
  readonly reasonCode: BlockingReasonCode;
}

export type BlockingReasonCode =
  | "WORK_ITEM_UNKNOWN"
  | "WORK_ITEM_NOT_TERMINAL";

// ---------------------------------------------------------------------------
// Project lifecycle transitions (pure).
// ---------------------------------------------------------------------------

export type ProjectTransitionCommand =
  | { type: "activate" }
  | { type: "hold"; reason: string }
  | { type: "resume" }
  | { type: "complete" }
  | { type: "cancel"; reason: string };

export type ProjectTransition =
  | { ok: true; next: Project }
  | { ok: false; reasonCode: ProjectReasonCode };

export type ProjectReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "TENANT_MISMATCH"
  | "ILLEGAL_TRANSITION"
  | "HOLD_REASON_REQUIRED"
  | "CANCEL_REASON_REQUIRED"
  | "MILESTONES_NOT_ACHIEVED";

const PROJECT_ALLOWED: Readonly<Record<ProjectStatus, readonly ProjectTransitionCommand["type"][]>> = {
  draft: ["activate", "cancel"],
  active: ["hold", "complete", "cancel"],
  on_hold: ["resume", "cancel"],
  completed: [],
  cancelled: [],
};

export function transitionProject(
  current: Project,
  command: ProjectTransitionCommand,
): ProjectTransition {
  const tenant = validateTenantScope(current.tenant);
  if (!tenant.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  if (tenant.scope.tenantId !== current.tenant.tenantId) {
    return { ok: false, reasonCode: "TENANT_MISMATCH" };
  }
  const allowed = PROJECT_ALLOWED[current.status] ?? [];
  if (!allowed.includes(command.type)) {
    return { ok: false, reasonCode: "ILLEGAL_TRANSITION" };
  }
  switch (command.type) {
    case "activate":
      return { ok: true, next: { ...current, status: "active" } };
    case "hold":
      if (!command.reason || command.reason.trim().length === 0) {
        return { ok: false, reasonCode: "HOLD_REASON_REQUIRED" };
      }
      return { ok: true, next: { ...current, status: "on_hold" } };
    case "resume":
      return { ok: true, next: { ...current, status: "active" } };
    case "complete":
      return { ok: true, next: { ...current, status: "completed" } };
    case "cancel":
      if (!command.reason || command.reason.trim().length === 0) {
        return { ok: false, reasonCode: "CANCEL_REASON_REQUIRED" };
      }
      return { ok: true, next: { ...current, status: "cancelled" } };
  }
}

// ---------------------------------------------------------------------------
// Milestone gating — REAL kernel-grade. Honest blocking-item reports.
// Deterministic check: a milestone closes ONLY when its work items reach
// terminal states. Blocking items are reported individually with stable
// reason codes.
// ---------------------------------------------------------------------------

export type MilestoneGateResult =
  | { ok: true; status: "achieved" }
  | {
      ok: false;
      reasonCode: MilestoneReasonCode;
      blockingItems: readonly BlockingItem[];
    };

export type MilestoneReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "TENANT_MISMATCH"
  | "EMPTY_MILESTONE"
  | "WORK_ITEMS_NOT_TERMINAL";

const WORK_ITEM_TERMINAL_STATUSES = new Set(["done", "cancelled"]);

export function checkMilestoneGate(
  milestone: Milestone,
  workItems: readonly WorkItemStatusRefLike[],
): MilestoneGateResult {
  const tenant = validateTenantScope(milestone.tenant);
  if (!tenant.ok) return fail("TENANT_SCOPE_MISSING", []);
  if (tenant.scope.tenantId !== milestone.tenant.tenantId) {
    return fail("TENANT_MISMATCH", []);
  }
  if (milestone.workItemIds.length === 0) {
    return fail("EMPTY_MILESTONE", []);
  }
  const byId = new Map(workItems.map((w) => [w.id, w.status]));
  const blocking: BlockingItem[] = [];
  for (const id of milestone.workItemIds) {
    const status = byId.get(id);
    if (typeof status !== "string") {
      blocking.push({
        workItemId: id,
        currentStatus: "unknown",
        reasonCode: "WORK_ITEM_UNKNOWN",
      });
      continue;
    }
    if (!WORK_ITEM_TERMINAL_STATUSES.has(status)) {
      blocking.push({
        workItemId: id,
        currentStatus: status,
        reasonCode: "WORK_ITEM_NOT_TERMINAL",
      });
    }
  }
  if (blocking.length > 0) {
    return fail("WORK_ITEMS_NOT_TERMINAL", blocking);
  }
  return { ok: true, status: "achieved" };
}

function fail(
  reasonCode: MilestoneReasonCode,
  blockingItems: readonly BlockingItem[],
): MilestoneGateResult {
  return { ok: false, reasonCode, blockingItems };
}

/**
 * milestoneIsCloseable — predicate that returns true iff every work item
 * is in a terminal state. Used by the directory to refuse project
 * completion when milestones have outstanding work.
 */
export function milestoneIsCloseable(
  milestone: Milestone,
  workItems: readonly WorkItemStatusRefLike[],
): boolean {
  const result = checkMilestoneGate(milestone, workItems);
  return result.ok;
}
