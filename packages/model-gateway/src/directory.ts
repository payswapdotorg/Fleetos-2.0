/**
 * @fleetos/model-gateway — Audit events + directory + repository port +
 * in-memory reference.
 */

import type { TenantScope } from "./contracts.js";
import { validateTenantScope } from "./contracts.js";
import type {
  ModelRequest,
  RoutingPolicy,
  ModelProviderPort,
  RoutingDecision,
  QuotaAccount,
  QuotaProjection,
  BudgetCheckResult,
} from "./contracts.js";
import { route, checkBudgetPolicy, computeQuotaProjection } from "./contracts.js";

// ---------------------------------------------------------------------------
// Audit events.
// ---------------------------------------------------------------------------

export type AuditEventKind =
  | "model-gateway.route-decided"
  | "model-gateway.route-refused"
  | "model-gateway.budget-checked"
  | "model-gateway.quota-projected";

export interface AuditEvent {
  readonly kind: AuditEventKind;
  readonly tenant: TenantScope;
  readonly occurredAt: string;
  readonly digest: string;
  readonly providerId: string | null;
  readonly reasonCode: string | null;
  readonly estimatedCost: number | null;
  readonly fallbackTriedCount: number | null;
}

export function computeAuditDigest(inputs: {
  readonly kind: AuditEventKind;
  readonly tenantId: string;
  readonly occurredAt: string;
  readonly providerId: string | null;
  readonly reasonCode: string | null;
}): string {
  const parts = [
    inputs.kind,
    inputs.tenantId,
    inputs.occurredAt,
    inputs.providerId ?? "",
    inputs.reasonCode ?? "",
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
  readonly occurredAt: string;
  readonly providerId?: string | null;
  readonly reasonCode?: string | null;
  readonly estimatedCost?: number | null;
  readonly fallbackTriedCount?: number | null;
}): AuditEvent {
  const digest = computeAuditDigest({
    kind: inputs.kind,
    tenantId: inputs.tenant.tenantId,
    occurredAt: inputs.occurredAt,
    providerId: inputs.providerId ?? null,
    reasonCode: inputs.reasonCode ?? null,
  });
  return {
    kind: inputs.kind,
    tenant: inputs.tenant,
    occurredAt: inputs.occurredAt,
    digest,
    providerId: inputs.providerId ?? null,
    reasonCode: inputs.reasonCode ?? null,
    estimatedCost: inputs.estimatedCost ?? null,
    fallbackTriedCount: inputs.fallbackTriedCount ?? null,
  };
}

// ---------------------------------------------------------------------------
// Repository port + in-memory reference.
// ---------------------------------------------------------------------------

export interface ModelGatewayRepositoryPort {
  loadPolicy(tenant: TenantScope): Promise<RoutingPolicy | null>;
  storePolicy(tenant: TenantScope, policy: RoutingPolicy): Promise<void>;
  loadQuotaAccount(tenant: TenantScope): Promise<QuotaAccount | null>;
  storeQuotaAccount(tenant: TenantScope, account: QuotaAccount): Promise<void>;
}

export function createInMemoryModelGatewayRepository(
  initialPolicy?: RoutingPolicy,
  initialAccount?: QuotaAccount,
): ModelGatewayRepositoryPort {
  let policy: RoutingPolicy | null = initialPolicy ?? null;
  let account: QuotaAccount | null = initialAccount ?? null;
  return {
    async loadPolicy(tenant) {
      const tc = validateTenantScope(tenant);
      if (!tc.ok) return null;
      if (policy && policy.tenant.tenantId !== tc.scope.tenantId) return null;
      return policy;
    },
    async storePolicy(tenant, p) {
      const tc = validateTenantScope(tenant);
      if (!tc.ok) return;
      if (p.tenant.tenantId !== tc.scope.tenantId) return;
      policy = p;
    },
    async loadQuotaAccount(tenant) {
      const tc = validateTenantScope(tenant);
      if (!tc.ok) return null;
      if (account && account.tenant.tenantId !== tc.scope.tenantId) return null;
      return account;
    },
    async storeQuotaAccount(tenant, a) {
      const tc = validateTenantScope(tenant);
      if (!tc.ok) return;
      if (a.tenant.tenantId !== tc.scope.tenantId) return;
      account = a;
    },
  };
}

// ---------------------------------------------------------------------------
// ModelGatewayDirectory.
// ---------------------------------------------------------------------------

export type DirectoryReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "TENANT_MISMATCH"
  | "POLICY_NOT_FOUND"
  | "QUOTA_ACCOUNT_NOT_FOUND"
  | "EMPTY_FALLBACK_ORDER"
  | "NO_PROVIDER_AVAILABLE"
  | "REQUEST_EXCEEDS_MAX_TOKENS"
  | "NEGATIVE_USAGE"
  | "BUDGET_EXCEEDED";

export interface DirectorySuccess {
  readonly ok: true;
  readonly routing?: RoutingDecision;
  readonly budget?: BudgetCheckResult;
  readonly quotaProjection?: QuotaProjection;
  readonly auditEvents: readonly AuditEvent[];
}

export interface DirectoryRefusal {
  readonly ok: false;
  readonly reasonCode: DirectoryReasonCode;
  readonly auditEvents?: readonly AuditEvent[];
}

export type DirectoryResult = DirectorySuccess | DirectoryRefusal;

export interface ModelGatewayDirectory {
  route(
    tenant: TenantScope,
    request: Omit<ModelRequest, "tenant">,
    providers: readonly ModelProviderPort[],
    options: { readonly occurredAt: string },
  ): Promise<DirectoryResult>;

  checkBudget(tenant: TenantScope): Promise<DirectoryResult>;

  projectQuota(tenant: TenantScope): Promise<DirectoryResult>;
}

export function createModelGatewayDirectory(
  repository: ModelGatewayRepositoryPort,
): ModelGatewayDirectory {
  return new DirectoryImpl(repository);
}

class DirectoryImpl implements ModelGatewayDirectory {
  constructor(private readonly repo: ModelGatewayRepositoryPort) {}

  async route(
    tenant: TenantScope,
    request: Omit<ModelRequest, "tenant">,
    providers: readonly ModelProviderPort[],
    options: { readonly occurredAt: string },
  ): Promise<DirectoryResult> {
    const tenantCheck = validateTenantScope(tenant);
    if (!tenantCheck.ok) return refuse("TENANT_SCOPE_MISSING");
    const policy = await this.repo.loadPolicy(tenant);
    if (policy === null) return refuse("POLICY_NOT_FOUND");
    if (policy.tenant.tenantId !== tenantCheck.scope.tenantId) {
      return refuse("TENANT_MISMATCH");
    }
    const fullRequest: ModelRequest = { ...request, tenant };
    const decision = route(fullRequest, policy, providers);
    if (!decision.ok) {
      const audit = makeAuditEvent({
        kind: "model-gateway.route-refused",
        tenant,
        occurredAt: options.occurredAt,
        reasonCode: decision.reasonCode,
        fallbackTriedCount: decision.fallbackTried.length,
      });
      return {
        ok: false,
        reasonCode: decision.reasonCode as DirectoryReasonCode,
        auditEvents: [audit],
      };
    }
    const audit = makeAuditEvent({
      kind: "model-gateway.route-decided",
      tenant,
      occurredAt: options.occurredAt,
      providerId: decision.providerId,
      estimatedCost: decision.estimatedCost,
      fallbackTriedCount: decision.fallbackTried.length,
    });
    return { ok: true, routing: decision, auditEvents: [audit] };
  }

  async checkBudget(tenant: TenantScope): Promise<DirectoryResult> {
    const tenantCheck = validateTenantScope(tenant);
    if (!tenantCheck.ok) return refuse("TENANT_SCOPE_MISSING");
    const policy = await this.repo.loadPolicy(tenant);
    if (policy === null) return refuse("POLICY_NOT_FOUND");
    const account = await this.repo.loadQuotaAccount(tenant);
    if (account === null) return refuse("QUOTA_ACCOUNT_NOT_FOUND");
    const usage = { tenant, tokensUsedThisHour: account.tokensUsedThisHour };
    const result = checkBudgetPolicy(policy, usage);
    const audit = makeAuditEvent({
      kind: "model-gateway.budget-checked",
      tenant,
      occurredAt: new Date(0).toISOString(),
      reasonCode: result.ok ? null : result.reasonCode,
    });
    return { ok: true, budget: result, auditEvents: [audit] };
  }

  async projectQuota(tenant: TenantScope): Promise<DirectoryResult> {
    const tenantCheck = validateTenantScope(tenant);
    if (!tenantCheck.ok) return refuse("TENANT_SCOPE_MISSING");
    const policy = await this.repo.loadPolicy(tenant);
    if (policy === null) return refuse("POLICY_NOT_FOUND");
    const account = await this.repo.loadQuotaAccount(tenant);
    if (account === null) return refuse("QUOTA_ACCOUNT_NOT_FOUND");
    const projection = computeQuotaProjection(policy, account);
    const audit = makeAuditEvent({
      kind: "model-gateway.quota-projected",
      tenant,
      occurredAt: new Date(0).toISOString(),
    });
    return { ok: true, quotaProjection: projection, auditEvents: [audit] };
  }
}

function refuse(reasonCode: DirectoryReasonCode): DirectoryRefusal {
  return { ok: false, reasonCode };
}

// Re-export kernel functions.
export { route, checkBudgetPolicy, computeQuotaProjection };
