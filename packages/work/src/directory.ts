/**
 * @fleetos/work — WorkRepositoryPort + WorkItemDirectory (kernel grade).
 *
 * The directory is the application-service surface over the repository
 * port. The port is a STRUCTURAL seam (law A20 — no cross-boundary
 * implementation imports); the in-memory reference repository is a
 * deterministic, replayable adapter for tests and wiring fallbacks.
 *
 * Every consequential directory operation:
 *   - validates tenant scope first (fail-closed, law A8);
 *   - refuses cross-tenant reads/writes (law A8);
 *   - returns machine-stable reason codes on refusal (law A4);
 *   - emits an AuditEvent contract (law A19) — structural refs only.
 *
 * Laws: A1 (the repository port does not own business truth; the
 * authoritative store is composed by the TL at F211), A4, A8, A19, A20.
 */

import type { TenantScope } from "./tenant.js";
import { validateTenantScope } from "./tenant.js";
import type {
  WorkItem,
  WorkItemId,
  WorkItemStatus,
  WorkItemTransitionCommand,
} from "./contracts.js";
import { WORK_ITEM_TERMINAL_STATUSES } from "./contracts.js";
import { advanceWorkItem, assignTo, reassignTo } from "./lifecycle.js";
import {
  type AuditEvent,
  type GuardianDecisionRefLike,
  makeAuditEvent,
} from "./audit.js";
import {
  type ProgressEvent,
  progressEventForAssignment,
  progressEventForTransition,
} from "./progress.js";

// ---------------------------------------------------------------------------
// WorkRepositoryPort — structural seam. Implementations may be backed by
// PostgreSQL (TL at F211), an in-memory store (reference), or a
// replayable fixture (tests). The port does NOT own business truth — it
// is a persistence seam only.
// ---------------------------------------------------------------------------

export interface WorkRepositoryPort {
  /** Load a work item by id, scoped to the given tenant. Returns null when not found OR when the tenant does not match — fail-closed. */
  load(tenant: TenantScope, id: WorkItemId): Promise<WorkItem | null>;
  /** Persist a work item. Refuses cross-tenant writes. */
  store(tenant: TenantScope, item: WorkItem): Promise<void>;
  /** List work items for a tenant, optionally filtered by status. */
  list(
    tenant: TenantScope,
    filter?: { readonly statuses?: readonly WorkItemStatus[] },
  ): Promise<readonly WorkItem[]>;
}

// ---------------------------------------------------------------------------
// Directory results — every consequential operation returns either a
// success with the new state and emitted events, or a refusal with a
// machine-stable reason code.
// ---------------------------------------------------------------------------

export type DirectoryReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "TENANT_MISMATCH"
  | "WORK_ITEM_NOT_FOUND"
  | "ILLEGAL_TRANSITION"
  | "BLOCK_REASON_REQUIRED"
  | "CANCEL_REASON_REQUIRED"
  | "ASSIGNEE_REQUIRED_FOR_COMPLETION"
  | "ASSIGNMENT_ID_EMPTY"
  | "ASSIGNEE_ID_EMPTY"
  | "ALREADY_ASSIGNED"
  | "REPOSITORY_ERROR";

export interface DirectorySuccess {
  readonly ok: true;
  readonly workItem: WorkItem;
  readonly auditEvents: readonly AuditEvent[];
  readonly progressEvents: readonly ProgressEvent[];
}

export interface DirectoryRefusal {
  readonly ok: false;
  readonly reasonCode: DirectoryReasonCode;
}

export type DirectoryResult = DirectorySuccess | DirectoryRefusal;

// ---------------------------------------------------------------------------
// WorkItemDirectory — the application-service surface.
// ---------------------------------------------------------------------------

export interface WorkItemDirectory {
  /**
   * Apply a transition to a work item. Loads the item, validates tenant,
   * applies the transition, persists, and emits audit + progress events.
   */
  transition(
    tenant: TenantScope,
    id: WorkItemId,
    command: WorkItemTransitionCommand,
    options: TransitionOptions,
  ): Promise<DirectoryResult>;

  /**
   * Assign a work item to an assignee (first assignment). Refuses if
   * the work item already has a live assignee — use reassign.
   */
  assign(
    tenant: TenantScope,
    id: WorkItemId,
    assignmentId: string,
    assigneeId: string,
    assignedAt: string,
    options: AssignmentOptions,
  ): Promise<DirectoryResult>;

  /**
   * Reassign a work item (supersession — old assignment closes with
   * supersededBy ref). Refuses if there is no live assignee.
   */
  reassign(
    tenant: TenantScope,
    id: WorkItemId,
    newAssignmentId: string,
    newAssigneeId: string,
    reassignedAt: string,
    options: AssignmentOptions,
  ): Promise<DirectoryResult>;

  /**
   * Read a work item. Returns null when not found OR cross-tenant.
   * Fail-closed (law A8).
   */
  get(tenant: TenantScope, id: WorkItemId): Promise<WorkItem | null>;

  /**
   * List work items for the tenant, optionally filtered by status.
   */
  list(
    tenant: TenantScope,
    filter?: { readonly statuses?: readonly WorkItemStatus[] },
  ): Promise<readonly WorkItem[]>;

  /**
   * List terminal work items (done/cancelled) — used by sibling-lane
   * milestone gating (projects package) at the structural seam.
   */
  listTerminal(tenant: TenantScope): Promise<readonly WorkItem[]>;
}

export interface TransitionOptions {
  readonly occurredAt: string;
  readonly actorRef?: { readonly actorId: string; readonly tenantId: string } | null;
  readonly missionRef?: { readonly missionId: string; readonly runId?: string; readonly workItemId?: string } | null;
  readonly authorizationRef?: GuardianDecisionRefLike | null;
  readonly evidenceRef?: { readonly evidenceId: string; readonly tenantId: string } | null;
}

export interface AssignmentOptions {
  readonly occurredAt: string;
  readonly actorRef?: { readonly actorId: string; readonly tenantId: string } | null;
  readonly missionRef?: { readonly missionId: string; readonly runId?: string; readonly workItemId?: string } | null;
  readonly authorizationRef?: GuardianDecisionRefLike | null;
  readonly evidenceRef?: { readonly evidenceId: string; readonly tenantId: string } | null;
}

// ---------------------------------------------------------------------------
// createWorkItemDirectory — factory. Pure construction; the directory
// closes over the repository port.
// ---------------------------------------------------------------------------

export function createWorkItemDirectory(
  repository: WorkRepositoryPort,
): WorkItemDirectory {
  return new DirectoryImpl(repository);
}

class DirectoryImpl implements WorkItemDirectory {
  constructor(private readonly repo: WorkRepositoryPort) {}

  async transition(
    tenant: TenantScope,
    id: WorkItemId,
    command: WorkItemTransitionCommand,
    options: TransitionOptions,
  ): Promise<DirectoryResult> {
    const tenantCheck = validateTenantScope(tenant);
    if (!tenantCheck.ok) return refuse("TENANT_SCOPE_MISSING");
    const current = await this.repo.load(tenant, id);
    if (current === null) return refuse("WORK_ITEM_NOT_FOUND");
    if (current.tenant.tenantId !== tenantCheck.scope.tenantId) {
      return refuse("TENANT_MISMATCH");
    }
    const result = advanceWorkItem(current, command);
    if (!result.ok) return refuse(result.reasonCode);
    await this.repo.store(tenant, result.next);
    const audit = makeAuditEvent({
      kind: auditKindForTransition(),
      tenant,
      workItemId: id.value,
      occurredAt: options.occurredAt,
      fromStatus: current.status,
      toStatus: result.next.status,
      actorRef: options.actorRef ?? null,
      missionRef: options.missionRef ?? null,
      authorizationRef: options.authorizationRef ?? null,
      evidenceRef: options.evidenceRef ?? null,
    });
    const progress = progressEventForTransition({
      tenant,
      workItem: result.next,
      fromStatus: current.status,
      toStatus: result.next.status,
      emittedAt: options.occurredAt,
      reason: transitionReason(command),
    });
    return {
      ok: true,
      workItem: result.next,
      auditEvents: [audit],
      progressEvents: [progress],
    };
  }

  async assign(
    tenant: TenantScope,
    id: WorkItemId,
    assignmentId: string,
    assigneeId: string,
    assignedAt: string,
    options: AssignmentOptions,
  ): Promise<DirectoryResult> {
    const tenantCheck = validateTenantScope(tenant);
    if (!tenantCheck.ok) return refuse("TENANT_SCOPE_MISSING");
    const current = await this.repo.load(tenant, id);
    if (current === null) return refuse("WORK_ITEM_NOT_FOUND");
    if (current.tenant.tenantId !== tenantCheck.scope.tenantId) {
      return refuse("TENANT_MISMATCH");
    }
    const result = assignTo(current, assignmentId, assigneeId, assignedAt);
    if (!result.ok) return refuse(result.reasonCode);
    await this.repo.store(tenant, result.next);
    const audit = makeAuditEvent({
      kind: "work-item.assigned",
      tenant,
      workItemId: id.value,
      occurredAt: options.occurredAt,
      fromStatus: current.status,
      toStatus: result.next.status,
      actorRef: options.actorRef ?? null,
      missionRef: options.missionRef ?? null,
      authorizationRef: options.authorizationRef ?? null,
      evidenceRef: options.evidenceRef ?? null,
    });
    const progress = progressEventForAssignment({
      tenant,
      workItem: result.next,
      kind: "work.assigned",
      assigneeId,
      emittedAt: options.occurredAt,
    });
    return {
      ok: true,
      workItem: result.next,
      auditEvents: [audit],
      progressEvents: [progress],
    };
  }

  async reassign(
    tenant: TenantScope,
    id: WorkItemId,
    newAssignmentId: string,
    newAssigneeId: string,
    reassignedAt: string,
    options: AssignmentOptions,
  ): Promise<DirectoryResult> {
    const tenantCheck = validateTenantScope(tenant);
    if (!tenantCheck.ok) return refuse("TENANT_SCOPE_MISSING");
    const current = await this.repo.load(tenant, id);
    if (current === null) return refuse("WORK_ITEM_NOT_FOUND");
    if (current.tenant.tenantId !== tenantCheck.scope.tenantId) {
      return refuse("TENANT_MISMATCH");
    }
    const result = reassignTo(current, newAssignmentId, newAssigneeId, reassignedAt);
    if (!result.ok) return refuse(result.reasonCode);
    await this.repo.store(tenant, result.next);
    const audit = makeAuditEvent({
      kind: "work-item.reassigned",
      tenant,
      workItemId: id.value,
      occurredAt: options.occurredAt,
      fromStatus: current.status,
      toStatus: result.next.status,
      actorRef: options.actorRef ?? null,
      missionRef: options.missionRef ?? null,
      authorizationRef: options.authorizationRef ?? null,
      evidenceRef: options.evidenceRef ?? null,
    });
    const progress = progressEventForAssignment({
      tenant,
      workItem: result.next,
      kind: "work.reassigned",
      assigneeId: newAssigneeId,
      emittedAt: options.occurredAt,
    });
    return {
      ok: true,
      workItem: result.next,
      auditEvents: [audit],
      progressEvents: [progress],
    };
  }

  async get(tenant: TenantScope, id: WorkItemId): Promise<WorkItem | null> {
    const tenantCheck = validateTenantScope(tenant);
    if (!tenantCheck.ok) return null;
    const item = await this.repo.load(tenant, id);
    if (item === null) return null;
    if (item.tenant.tenantId !== tenantCheck.scope.tenantId) return null;
    return item;
  }

  async list(
    tenant: TenantScope,
    filter?: { readonly statuses?: readonly WorkItemStatus[] },
  ): Promise<readonly WorkItem[]> {
    const tenantCheck = validateTenantScope(tenant);
    if (!tenantCheck.ok) return [];
    return this.repo.list(tenant, filter);
  }

  async listTerminal(tenant: TenantScope): Promise<readonly WorkItem[]> {
    const tenantCheck = validateTenantScope(tenant);
    if (!tenantCheck.ok) return [];
    return this.repo.list(tenant, { statuses: WORK_ITEM_TERMINAL_STATUSES });
  }
}

function refuse(reasonCode: DirectoryReasonCode): DirectoryRefusal {
  return { ok: false, reasonCode };
}

function auditKindForTransition(): "work-item.transitioned" {
  return "work-item.transitioned";
}

function transitionReason(
  command: WorkItemTransitionCommand,
): string | null {
  if (command.type === "block") return command.reason;
  if (command.type === "cancel") return command.reason;
  return null;
}

export { WORK_ITEM_TERMINAL_STATUSES };
