/**
 * @fleetos/projects — In-memory reference ProjectRepository.
 *
 * Deterministic, replayable. NOT authoritative business truth (law A1).
 * Tenant isolation enforced at the repository boundary.
 */

import type { TenantScope } from "./contracts.js";
import { validateTenantScope } from "./contracts.js";
import type {
  Project,
  ProjectId,
  Milestone,
  MilestoneId,
  ProjectStatus,
} from "./contracts.js";
import type { ProjectRepositoryPort } from "./directory.js";

export function createInMemoryProjectRepository(
  initialProjects?: readonly Project[],
  initialMilestones?: readonly Milestone[],
): ProjectRepositoryPort {
  const projects = new Map<string, Project>();
  const milestones = new Map<string, Milestone>();
  for (const p of initialProjects ?? []) {
    projects.set(`${p.tenant.tenantId}::${p.id.value}`, p);
  }
  for (const m of initialMilestones ?? []) {
    milestones.set(`${m.tenant.tenantId}::${m.id.value}`, m);
  }
  return {
    async loadProject(tenant: TenantScope, id: ProjectId): Promise<Project | null> {
      const tc = validateTenantScope(tenant);
      if (!tc.ok) return null;
      return projects.get(`${tc.scope.tenantId}::${id.value}`) ?? null;
    },
    async storeProject(tenant: TenantScope, project: Project): Promise<void> {
      const tc = validateTenantScope(tenant);
      if (!tc.ok) return;
      if (project.tenant.tenantId !== tc.scope.tenantId) return;
      projects.set(`${tc.scope.tenantId}::${project.id.value}`, project);
    },
    async listProjects(
      tenant: TenantScope,
      filter?: { readonly statuses?: readonly ProjectStatus[] },
    ): Promise<readonly Project[]> {
      const tc = validateTenantScope(tenant);
      if (!tc.ok) return [];
      const prefix = `${tc.scope.tenantId}::`;
      const out: Project[] = [];
      for (const [key, p] of projects.entries()) {
        if (!key.startsWith(prefix)) continue;
        if (filter?.statuses && !filter.statuses.includes(p.status)) continue;
        out.push(p);
      }
      out.sort((a, b) => a.id.value.localeCompare(b.id.value));
      return out;
    },
    async loadMilestone(tenant: TenantScope, id: MilestoneId): Promise<Milestone | null> {
      const tc = validateTenantScope(tenant);
      if (!tc.ok) return null;
      return milestones.get(`${tc.scope.tenantId}::${id.value}`) ?? null;
    },
    async storeMilestone(tenant: TenantScope, milestone: Milestone): Promise<void> {
      const tc = validateTenantScope(tenant);
      if (!tc.ok) return;
      if (milestone.tenant.tenantId !== tc.scope.tenantId) return;
      milestones.set(`${tc.scope.tenantId}::${milestone.id.value}`, milestone);
    },
    async listMilestonesForProject(
      tenant: TenantScope,
      projectId: string,
    ): Promise<readonly Milestone[]> {
      const tc = validateTenantScope(tenant);
      if (!tc.ok) return [];
      const prefix = `${tc.scope.tenantId}::`;
      const out: Milestone[] = [];
      for (const [key, m] of milestones.entries()) {
        if (!key.startsWith(prefix)) continue;
        if (m.projectId !== projectId) continue;
        out.push(m);
      }
      out.sort((a, b) => a.id.value.localeCompare(b.id.value));
      return out;
    },
    async listAllMilestones(tenant: TenantScope): Promise<readonly Milestone[]> {
      const tc = validateTenantScope(tenant);
      if (!tc.ok) return [];
      const prefix = `${tc.scope.tenantId}::`;
      const out: Milestone[] = [];
      for (const [key, m] of milestones.entries()) {
        if (!key.startsWith(prefix)) continue;
        out.push(m);
      }
      out.sort((a, b) => a.id.value.localeCompare(b.id.value));
      return out;
    },
  };
}
