/**
 * @fleetos/agent-organizations — Audit events + directory + repository
 * port + in-memory reference.
 */

import type { TenantScope } from "./contracts.js";
import { validateTenantScope } from "./contracts.js";
import type {
  OrganizationConfiguration,
  OrganizationUsage,
  AuthorizationRequest,
  BudgetEnforcementResult,
} from "./contracts.js";
import { enforceBudget, makeAuthorizationRequest } from "./contracts.js";

// ---------------------------------------------------------------------------
// Audit events.
// ---------------------------------------------------------------------------

export type AuditEventKind =
  | "agent-org.budget-checked"
  | "agent-org.authorization-requested"
  | "agent-org.budget-exceeded";

export interface AuditEvent {
  readonly kind: AuditEventKind;
  readonly tenant: TenantScope;
  readonly organizationId: string;
  readonly roleId: string;
  readonly capability: string;
  readonly occurredAt: string;
  readonly digest: string;
  readonly reasonCode: string | null;
}

export function computeAuditDigest(inputs: {
  readonly kind: AuditEventKind;
  readonly tenantId: string;
  readonly organizationId: string;
  readonly roleId: string;
  readonly capability: string;
  readonly occurredAt: string;
}): string {
  const parts = [
    inputs.kind,
    inputs.tenantId,
    inputs.organizationId,
    inputs.roleId,
    inputs.capability,
    inputs.occurredAt,
  ];
  let hash = 0x811c9dc5;
  const joined = parts.join("\u241f");
  for (let i = 0; i < joined.length; i++) {
    hash ^= joined.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return `audit_${hash.toString(16).padStart(8, "0")}`;
}

export function makeAuditEvent(inputs: {
  readonly kind: AuditEventKind;
  readonly tenant: TenantScope;
  readonly organizationId: string;
  readonly roleId: string;
  readonly capability: string;
  readonly occurredAt: string;
  readonly reasonCode?: string | null;
}): AuditEvent {
  const digest = computeAuditDigest({
    kind: inputs.kind,
    tenantId: inputs.tenant.tenantId,
    organizationId: inputs.organizationId,
    roleId: inputs.roleId,
    capability: inputs.capability,
    occurredAt: inputs.occurredAt,
  });
  return {
    kind: inputs.kind,
    tenant: inputs.tenant,
    organizationId: inputs.organizationId,
    roleId: inputs.roleId,
    capability: inputs.capability,
    occurredAt: inputs.occurredAt,
    digest,
    reasonCode: inputs.reasonCode ?? null,
  };
}

// ---------------------------------------------------------------------------
// Repository port + in-memory reference.
// ---------------------------------------------------------------------------

export interface AgentOrganizationRepositoryPort {
  loadConfiguration(tenant: TenantScope, id: { readonly kind: "organization"; readonly value: string }): Promise<OrganizationConfiguration | null>;
  storeConfiguration(tenant: TenantScope, config: OrganizationConfiguration): Promise<void>;
  loadUsage(tenant: TenantScope, id: { readonly kind: "organization"; readonly value: string }): Promise<OrganizationUsage | null>;
  storeUsage(tenant: TenantScope, usage: OrganizationUsage): Promise<void>;
}

export function createInMemoryAgentOrganizationRepository(
  initialConfigs?: readonly OrganizationConfiguration[],
  initialUsages?: readonly OrganizationUsage[],
): AgentOrganizationRepositoryPort {
  const configs = new Map<string, OrganizationConfiguration>();
  const usages = new Map<string, OrganizationUsage>();
  for (const c of initialConfigs ?? []) {
    configs.set(`${c.tenant.tenantId}::${c.id.value}`, c);
  }
  for (const u of initialUsages ?? []) {
    usages.set(`${u.tenant.tenantId}::${u.organizationId.value}`, u);
  }
  return {
    async loadConfiguration(tenant, id) {
      const tc = validateTenantScope(tenant);
      if (!tc.ok) return null;
      return configs.get(`${tc.scope.tenantId}::${id.value}`) ?? null;
    },
    async storeConfiguration(tenant, config) {
      const tc = validateTenantScope(tenant);
      if (!tc.ok) return;
      if (config.tenant.tenantId !== tc.scope.tenantId) return;
      configs.set(`${tc.scope.tenantId}::${config.id.value}`, config);
    },
    async loadUsage(tenant, id) {
      const tc = validateTenantScope(tenant);
      if (!tc.ok) return null;
      return usages.get(`${tc.scope.tenantId}::${id.value}`) ?? null;
    },
    async storeUsage(tenant, usage) {
      const tc = validateTenantScope(tenant);
      if (!tc.ok) return;
      if (usage.tenant.tenantId !== tc.scope.tenantId) return;
      usages.set(`${tc.scope.tenantId}::${usage.organizationId.value}`, usage);
    },
  };
}

// ---------------------------------------------------------------------------
// AgentOrganizationDirectory.
// ---------------------------------------------------------------------------

export type DirectoryReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "TENANT_MISMATCH"
  | "CONFIGURATION_NOT_FOUND"
  | "USAGE_NOT_FOUND"
  | "UNKNOWN_ROLE"
  | "UNKNOWN_CAPABILITY"
  | "BUDGET_EXCEEDED_TOKENS"
  | "BUDGET_EXCEEDED_INVOCATIONS";

export interface DirectorySuccess {
  readonly ok: true;
  readonly authorizationRequest: AuthorizationRequest;
  readonly auditEvents: readonly AuditEvent[];
}

export interface DirectoryRefusal {
  readonly ok: false;
  readonly reasonCode: DirectoryReasonCode;
  readonly authorizationRequest?: AuthorizationRequest;
  readonly auditEvents?: readonly AuditEvent[];
}

export type DirectoryResult = DirectorySuccess | DirectoryRefusal;

/**
 * AgentOrganizationDirectory — every consequential operation produces
 * an AuthorizationRequest. The directory NEVER executes; it requests
 * authorization from the Guardian (out-of-lane). The directory returns
 * the request even when the budget check refuses — the Guardian
 * adjudicates with full context.
 */
export interface AgentOrganizationDirectory {
  requestAuthorization(
    tenant: TenantScope,
    organizationId: { readonly kind: "organization"; readonly value: string },
    roleId: string,
    capability: string,
    proposedAt: string,
  ): Promise<DirectoryResult>;

  getConfiguration(
    tenant: TenantScope,
    id: { readonly kind: "organization"; readonly value: string },
  ): Promise<OrganizationConfiguration | null>;
}

export function createAgentOrganizationDirectory(
  repository: AgentOrganizationRepositoryPort,
): AgentOrganizationDirectory {
  return new DirectoryImpl(repository);
}

class DirectoryImpl implements AgentOrganizationDirectory {
  constructor(private readonly repo: AgentOrganizationRepositoryPort) {}

  async requestAuthorization(
    tenant: TenantScope,
    organizationId: { readonly kind: "organization"; readonly value: string },
    roleId: string,
    capability: string,
    proposedAt: string,
  ): Promise<DirectoryResult> {
    const tenantCheck = validateTenantScope(tenant);
    if (!tenantCheck.ok) return refuse("TENANT_SCOPE_MISSING");
    const config = await this.repo.loadConfiguration(tenant, organizationId);
    if (config === null) return refuse("CONFIGURATION_NOT_FOUND");
    if (config.tenant.tenantId !== tenantCheck.scope.tenantId) {
      return refuse("TENANT_MISMATCH");
    }
    const usage = await this.repo.loadUsage(tenant, organizationId)
      ?? fallbackUsage(organizationId, tenant);
    const request = makeAuthorizationRequest(config, usage, roleId, capability, proposedAt);
    if (!request.budgetCheck.ok) {
      const audit = makeAuditEvent({
        kind: "agent-org.budget-exceeded",
        tenant,
        organizationId: organizationId.value,
        roleId,
        capability,
        occurredAt: proposedAt,
        reasonCode: request.budgetCheck.reasonCode,
      });
      return {
        ok: false,
        reasonCode: request.budgetCheck.reasonCode as DirectoryReasonCode,
        authorizationRequest: request,
        auditEvents: [audit],
      };
    }
    const audit = makeAuditEvent({
      kind: "agent-org.authorization-requested",
      tenant,
      organizationId: organizationId.value,
      roleId,
      capability,
      occurredAt: proposedAt,
    });
    return {
      ok: true,
      authorizationRequest: request,
      auditEvents: [audit],
    };
  }

  async getConfiguration(
    tenant: TenantScope,
    id: { readonly kind: "organization"; readonly value: string },
  ): Promise<OrganizationConfiguration | null> {
    const tenantCheck = validateTenantScope(tenant);
    if (!tenantCheck.ok) return null;
    const item = await this.repo.loadConfiguration(tenant, id);
    if (item === null) return null;
    if (item.tenant.tenantId !== tenantCheck.scope.tenantId) return null;
    return item;
  }
}

function fallbackUsage(
  organizationId: { readonly kind: "organization"; readonly value: string },
  tenant: TenantScope,
): OrganizationUsage {
  return {
    organizationId,
    tenant,
    perRoleUsage: [],
  };
}

function refuse(reasonCode: DirectoryReasonCode): DirectoryRefusal {
  return { ok: false, reasonCode };
}

// Re-export the kernel function for callers.
export { enforceBudget, makeAuthorizationRequest };
export type { BudgetEnforcementResult };
