/**
 * @fleetos/projects — ProjectDirectory + ProjectRepositoryPort +
 * portfolio read models (kernel grade).
 *
 * Laws: A1 (the in-memory store is NOT authoritative; the composing
 * application attaches PostgreSQL at F211), A4 (machine-stable reason
 * codes; refusal on illegal transitions or unverified milestones),
 * A8 (tenant isolation, fail-closed), A19 (audit events on every
 * consequential operation), A20 (no cross-boundary imports).
 */

import type { TenantScope } from "./contracts.js";
import { validateTenantScope } from "./contracts.js";
import type {
  Project,
  ProjectId,
  Milestone,
  MilestoneId,
  ProjectStatus,
  ProjectTransitionCommand,
} from "./contracts.js";
import { transitionProject, checkMilestoneGate, milestoneIsCloseable } from "./contracts.js";
import { makeAuditEvent, type AuditEvent } from "./audit.js";
import type { WorkItemStatusRefLike } from "./contracts.js";

// ---------------------------------------------------------------------------
// Repository ports.
// ---------------------------------------------------------------------------

export interface ProjectRepositoryPort {
  loadProject(tenant: TenantScope, id: ProjectId): Promise<Project | null>;
  storeProject(tenant: TenantScope, project: Project): Promise<void>;
  listProjects(
    tenant: TenantScope,
    filter?: { readonly statuses?: readonly ProjectStatus[] },
  ): Promise<readonly Project[]>;
  loadMilestone(tenant: TenantScope, id: MilestoneId): Promise<Milestone | null>;
  storeMilestone(tenant: TenantScope, milestone: Milestone): Promise<void>;
  listMilestonesForProject(tenant: TenantScope, projectId: string): Promise<readonly Milestone[]>;
  listAllMilestones(tenant: TenantScope): Promise<readonly Milestone[]>;
}

// ---------------------------------------------------------------------------
// Directory results.
// ---------------------------------------------------------------------------

export type DirectoryReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "TENANT_MISMATCH"
  | "PROJECT_NOT_FOUND"
  | "MILESTONE_NOT_FOUND"
  | "ILLEGAL_TRANSITION"
  | "HOLD_REASON_REQUIRED"
  | "CANCEL_REASON_REQUIRED"
  | "MILESTONES_NOT_ACHIEVED"
  | "EMPTY_MILESTONE"
  | "WORK_ITEMS_NOT_TERMINAL";

export interface DirectorySuccess {
  readonly ok: true;
  readonly project?: Project;
  readonly milestone?: Milestone;
  readonly auditEvents: readonly AuditEvent[];
  readonly blockingItems?: readonly {
    readonly workItemId: string;
    readonly currentStatus: string;
    readonly reasonCode: string;
  }[];
}

export interface DirectoryRefusal {
  readonly ok: false;
  readonly reasonCode: DirectoryReasonCode;
  readonly blockingItems?: readonly {
    readonly workItemId: string;
    readonly currentStatus: string;
    readonly reasonCode: string;
  }[];
  /**
   * Audit events emitted even on refusal (law A19: every consequential
   * operation, including refusals, is audited). The composing application
   * persists these to the append-only audit log.
   */
  readonly auditEvents?: readonly AuditEvent[];
}

export type DirectoryResult = DirectorySuccess | DirectoryRefusal;

// ---------------------------------------------------------------------------
// Portfolio read models (tenant-scoped).
// ---------------------------------------------------------------------------

export interface ProjectPortfolioEntry {
  readonly projectId: string;
  readonly name: string;
  readonly status: ProjectStatus;
  readonly milestoneCount: number;
  readonly achievedMilestoneCount: number;
}

export interface PortfolioReadModel {
  readonly tenant: TenantScope;
  readonly totalProjects: number;
  readonly activeProjects: number;
  readonly completedProjects: number;
  readonly totalMilestones: number;
  readonly achievedMilestones: number;
  readonly entries: readonly ProjectPortfolioEntry[];
}

// ---------------------------------------------------------------------------
// ProjectDirectory.
// ---------------------------------------------------------------------------

export interface ProjectDirectory {
  transitionProject(
    tenant: TenantScope,
    id: ProjectId,
    command: ProjectTransitionCommand,
    options: { readonly occurredAt: string },
  ): Promise<DirectoryResult>;

  /**
   * Verify a milestone's gate against the provided work-item statuses.
   * The directory refuses to mark a milestone achieved if any work item
   * is non-terminal — honest blocking-item reports.
   */
  verifyMilestoneGate(
    tenant: TenantScope,
    milestoneId: MilestoneId,
    workItems: readonly WorkItemStatusRefLike[],
    options: { readonly occurredAt: string },
  ): Promise<DirectoryResult>;

  /**
   * Complete a project. Refuses if any milestone is not achieved (gate
   * enforcement at the directory boundary).
   */
  completeProject(
    tenant: TenantScope,
    id: ProjectId,
    workItems: readonly WorkItemStatusRefLike[],
    options: { readonly occurredAt: string },
  ): Promise<DirectoryResult>;

  getProject(tenant: TenantScope, id: ProjectId): Promise<Project | null>;
  getMilestone(tenant: TenantScope, id: MilestoneId): Promise<Milestone | null>;
  listProjects(
    tenant: TenantScope,
    filter?: { readonly statuses?: readonly ProjectStatus[] },
  ): Promise<readonly Project[]>;
  listMilestonesForProject(tenant: TenantScope, projectId: string): Promise<readonly Milestone[]>;

  /**
   * Read the tenant-scoped portfolio read model. Pure projection of the
   * repository state — no caching, no eventual consistency.
   */
  readPortfolio(tenant: TenantScope): Promise<PortfolioReadModel>;
}

export function createProjectDirectory(
  repository: ProjectRepositoryPort,
): ProjectDirectory {
  return new DirectoryImpl(repository);
}

class DirectoryImpl implements ProjectDirectory {
  constructor(private readonly repo: ProjectRepositoryPort) {}

  async transitionProject(
    tenant: TenantScope,
    id: ProjectId,
    command: ProjectTransitionCommand,
    options: { readonly occurredAt: string },
  ): Promise<DirectoryResult> {
    const tenantCheck = validateTenantScope(tenant);
    if (!tenantCheck.ok) return refuse("TENANT_SCOPE_MISSING");
    const current = await this.repo.loadProject(tenant, id);
    if (current === null) return refuse("PROJECT_NOT_FOUND");
    if (current.tenant.tenantId !== tenantCheck.scope.tenantId) {
      return refuse("TENANT_MISMATCH");
    }
    const result = transitionProject(current, command);
    if (!result.ok) return refuse(result.reasonCode);
    await this.repo.storeProject(tenant, result.next);
    const audit = makeAuditEvent({
      kind: "project.transitioned",
      tenant,
      projectId: id.value,
      occurredAt: options.occurredAt,
      fromStatus: current.status,
      toStatus: result.next.status,
    });
    return { ok: true, project: result.next, auditEvents: [audit] };
  }

  async verifyMilestoneGate(
    tenant: TenantScope,
    milestoneId: MilestoneId,
    workItems: readonly WorkItemStatusRefLike[],
    options: { readonly occurredAt: string },
  ): Promise<DirectoryResult> {
    const tenantCheck = validateTenantScope(tenant);
    if (!tenantCheck.ok) return refuse("TENANT_SCOPE_MISSING");
    const milestone = await this.repo.loadMilestone(tenant, milestoneId);
    if (milestone === null) return refuse("MILESTONE_NOT_FOUND");
    if (milestone.tenant.tenantId !== tenantCheck.scope.tenantId) {
      return refuse("TENANT_MISMATCH");
    }
    const gate = checkMilestoneGate(milestone, workItems);
    if (!gate.ok) {
      const audit = makeAuditEvent({
        kind: "milestone.blocking-reported",
        tenant,
        projectId: milestone.projectId,
        milestoneId: milestone.id.value,
        occurredAt: options.occurredAt,
        fromStatus: milestone.status,
        toStatus: milestone.status,
        blockingItemCount: gate.blockingItems.length,
        reasonCode: gate.reasonCode,
      });
      return {
        ok: false,
        reasonCode: gate.reasonCode as DirectoryReasonCode,
        blockingItems: gate.blockingItems,
        auditEvents: [audit],
      };
    }
    const updated: Milestone = { ...milestone, status: "achieved" };
    await this.repo.storeMilestone(tenant, updated);
    const audit = makeAuditEvent({
      kind: "milestone.achieved",
      tenant,
      projectId: milestone.projectId,
      milestoneId: milestone.id.value,
      occurredAt: options.occurredAt,
      fromStatus: milestone.status,
      toStatus: "achieved",
    });
    return { ok: true, milestone: updated, auditEvents: [audit] };
  }

  async completeProject(
    tenant: TenantScope,
    id: ProjectId,
    workItems: readonly WorkItemStatusRefLike[],
    options: { readonly occurredAt: string },
  ): Promise<DirectoryResult> {
    const tenantCheck = validateTenantScope(tenant);
    if (!tenantCheck.ok) return refuse("TENANT_SCOPE_MISSING");
    const project = await this.repo.loadProject(tenant, id);
    if (project === null) return refuse("PROJECT_NOT_FOUND");
    if (project.tenant.tenantId !== tenantCheck.scope.tenantId) {
      return refuse("TENANT_MISMATCH");
    }
    const milestones = await this.repo.listMilestonesForProject(tenant, id.value);
    const blocking: {
      readonly workItemId: string;
      readonly currentStatus: string;
      readonly reasonCode: string;
    }[] = [];
    for (const m of milestones) {
      if (m.status === "achieved" || m.status === "skipped") continue;
      const gate = checkMilestoneGate(m, workItems);
      if (!gate.ok) {
        for (const b of gate.blockingItems) blocking.push(b);
      }
    }
    if (blocking.length > 0) {
      const audit = makeAuditEvent({
        kind: "milestone.blocking-reported",
        tenant,
        projectId: id.value,
        milestoneId: null,
        occurredAt: options.occurredAt,
        fromStatus: project.status,
        toStatus: project.status,
        blockingItemCount: blocking.length,
        reasonCode: "MILESTONES_NOT_ACHIEVED",
      });
      return {
        ok: false,
        reasonCode: "MILESTONES_NOT_ACHIEVED",
        blockingItems: blocking,
        auditEvents: [audit],
      };
    }
    const result = transitionProject(project, { type: "complete" });
    if (!result.ok) return refuse(result.reasonCode);
    await this.repo.storeProject(tenant, result.next);
    const audit = makeAuditEvent({
      kind: "project.transitioned",
      tenant,
      projectId: id.value,
      occurredAt: options.occurredAt,
      fromStatus: project.status,
      toStatus: result.next.status,
    });
    return { ok: true, project: result.next, auditEvents: [audit] };
  }

  async getProject(tenant: TenantScope, id: ProjectId): Promise<Project | null> {
    const tenantCheck = validateTenantScope(tenant);
    if (!tenantCheck.ok) return null;
    const item = await this.repo.loadProject(tenant, id);
    if (item === null) return null;
    if (item.tenant.tenantId !== tenantCheck.scope.tenantId) return null;
    return item;
  }

  async getMilestone(tenant: TenantScope, id: MilestoneId): Promise<Milestone | null> {
    const tenantCheck = validateTenantScope(tenant);
    if (!tenantCheck.ok) return null;
    const item = await this.repo.loadMilestone(tenant, id);
    if (item === null) return null;
    if (item.tenant.tenantId !== tenantCheck.scope.tenantId) return null;
    return item;
  }

  async listProjects(
    tenant: TenantScope,
    filter?: { readonly statuses?: readonly ProjectStatus[] },
  ): Promise<readonly Project[]> {
    const tenantCheck = validateTenantScope(tenant);
    if (!tenantCheck.ok) return [];
    return this.repo.listProjects(tenant, filter);
  }

  async listMilestonesForProject(
    tenant: TenantScope,
    projectId: string,
  ): Promise<readonly Milestone[]> {
    const tenantCheck = validateTenantScope(tenant);
    if (!tenantCheck.ok) return [];
    return this.repo.listMilestonesForProject(tenant, projectId);
  }

  async readPortfolio(tenant: TenantScope): Promise<PortfolioReadModel> {
    const tenantCheck = validateTenantScope(tenant);
    if (!tenantCheck.ok) {
      return {
        tenant: { tenantId: "" },
        totalProjects: 0,
        activeProjects: 0,
        completedProjects: 0,
        totalMilestones: 0,
        achievedMilestones: 0,
        entries: [],
      };
    }
    const projects = await this.repo.listProjects(tenant);
    const milestones = await this.repo.listAllMilestones(tenant);
    const entries: ProjectPortfolioEntry[] = [];
    for (const p of projects) {
      const ms = milestones.filter((m) => m.projectId === p.id.value);
      entries.push({
        projectId: p.id.value,
        name: p.name,
        status: p.status,
        milestoneCount: ms.length,
        achievedMilestoneCount: ms.filter((m) => m.status === "achieved").length,
      });
    }
    entries.sort((a, b) => a.projectId.localeCompare(b.projectId));
    return {
      tenant: tenantCheck.scope,
      totalProjects: projects.length,
      activeProjects: projects.filter((p) => p.status === "active").length,
      completedProjects: projects.filter((p) => p.status === "completed").length,
      totalMilestones: milestones.length,
      achievedMilestones: milestones.filter((m) => m.status === "achieved").length,
      entries,
    };
  }
}

function refuse(reasonCode: DirectoryReasonCode): DirectoryRefusal {
  return { ok: false, reasonCode };
}

// Re-export key kernel functions for callers that want direct access.
export { transitionProject, checkMilestoneGate, milestoneIsCloseable };
