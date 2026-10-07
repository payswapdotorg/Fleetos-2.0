/**
 * @fleetos/projects — Projects bounded context public contracts.
 *
 * Wave 0 lane C (F200C). Pure TypeScript domain package: types + pure
 * functions only. No I/O, no servers, no databases, no network, no providers.
 *
 * Laws satisfied here (see spec/ARCHITECTURE-LOCK.md):
 *   A1  — one source of business truth (no in-memory fake store here).
 *   A4  — consequential action protocol (lifecycle transitions are explicit
 *         with machine-stable reason codes).
 *   A8  — tenant isolation (TenantScope is fail-closed).
 *   A20 — no cross-boundary implementation imports.
 *
 * Cross-worker seam rule: TenantScope is a LOCAL structural type defined
 * here. Sibling lanes may define the same shape; structural compatibility
 * is proven by tests, never by runtime imports.
 */

// ---------------------------------------------------------------------------
// Tenant scope — structural local type (seam rule).
// ---------------------------------------------------------------------------

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
// Project contracts
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

export interface Project {
  readonly id: ProjectId;
  readonly tenant: TenantScope;
  readonly name: string;
  readonly status: ProjectStatus;
  readonly milestoneIds: readonly string[];
}

export interface ProjectId {
  readonly kind: "project";
  readonly value: string;
}

// ---------------------------------------------------------------------------
// Milestone contracts
// ---------------------------------------------------------------------------

export type MilestoneStatus = "open" | "achieved" | "skipped";

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

export interface MilestoneId {
  readonly kind: "milestone";
  readonly value: string;
}

/**
 * Sibling-lane work-item status reference (LOCAL structural seam — never
 * imported across package boundaries at runtime). Used only to gate
 * milestone achievement without taking a runtime dependency on
 * @fleetos/work.
 */
export interface WorkItemStatusRefLike {
  readonly id: string;
  readonly status: string;
}

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

const PROJECT_ALLOWED: Readonly<Record<ProjectStatus, readonly string[]>> = {
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
// Milestone gating — a milestone requires its work items' terminal states
// (deterministic check function). Pure, no I/O.
// ---------------------------------------------------------------------------

export type MilestoneGateResult =
  | { ok: true; status: "achieved" }
  | { ok: false; reasonCode: MilestoneReasonCode; blockingWorkItemIds: string[] };

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
  const blocking: string[] = [];
  for (const id of milestone.workItemIds) {
    const status = byId.get(id);
    if (typeof status !== "string" || !WORK_ITEM_TERMINAL_STATUSES.has(status)) {
      blocking.push(id);
    }
  }
  if (blocking.length > 0) {
    return fail("WORK_ITEMS_NOT_TERMINAL", blocking);
  }
  return { ok: true, status: "achieved" };
}

function fail(
  reasonCode: MilestoneReasonCode,
  blockingWorkItemIds: string[],
): MilestoneGateResult {
  return { ok: false, reasonCode, blockingWorkItemIds };
}
