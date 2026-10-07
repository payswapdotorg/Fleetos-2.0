/**
 * @fleetos/agent-organizations — Agent Organizations bounded context.
 *
 * Wave 0 lane C (F200C). Pure TypeScript domain package.
 *
 * Laws:
 *   A4  — consequential action protocol; budget exceedance REFUSED with
 *         machine-stable reason code, never silently overflowed.
 *   A6  — agent trust boundary. Agent organizations are UNTRUSTED actors.
 *         They PROPOSE, never AUTHORIZE. This is encoded in the types:
 *         every output of this package is a Proposal, not an Authorization.
 *   A8  — tenant isolation; fail-closed.
 *   A20 — no cross-boundary imports.
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
// Agent organization configuration, roles, capability budgets.
// ---------------------------------------------------------------------------

export interface OrganizationId {
  readonly kind: "organization";
  readonly value: string;
}

export interface AgentRole {
  readonly id: string;
  readonly name: string;
  readonly capabilityBudgets: readonly CapabilityBudget[];
}

export interface CapabilityBudget {
  readonly capability: string;
  readonly maxTokens: number;
  readonly maxInvocationsPerHour: number;
}

export interface OrganizationConfiguration {
  readonly id: OrganizationId;
  readonly tenant: TenantScope;
  readonly roles: readonly AgentRole[];
}

/**
 * A read of the organization's current capability usage. Provided by the
 * caller (observability side); the pure function does not consult any
 * external state.
 */
export interface OrganizationUsage {
  readonly organizationId: OrganizationId;
  readonly tenant: TenantScope;
  readonly perRoleUsage: readonly RoleUsageSnapshot[];
}

export interface RoleUsageSnapshot {
  readonly roleId: string;
  readonly perCapabilityUsage: readonly CapabilityUsage[];
}

export interface CapabilityUsage {
  readonly capability: string;
  readonly tokensUsed: number;
  readonly invocationsThisHour: number;
}

// ---------------------------------------------------------------------------
// UNTRUSTED ACTORS — the output of an agent organization is always a
// Proposal, never an Authorization. The Guardian (worker B) is the sole
// authority (law A5). Types encode this: there is no `Authorization` shape
// exported from this package; only `Proposal`-shaped outputs.
// ---------------------------------------------------------------------------

export interface CapabilityProposal {
  readonly kind: "capability-proposal";
  readonly organizationId: OrganizationId;
  readonly tenant: TenantScope;
  readonly roleId: string;
  readonly capability: string;
  readonly proposedAt: string;
}

// ---------------------------------------------------------------------------
// Pure budget enforcement — an organization exceeding a capability budget
// is REFUSED with a machine-stable reason code, never silently overflowed.
// ---------------------------------------------------------------------------

export type BudgetEnforcementResult =
  | { ok: true; proposal: CapabilityProposal }
  | { ok: false; reasonCode: BudgetReasonCode; exceededCapability: string | null };

export type BudgetReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "TENANT_MISMATCH"
  | "UNKNOWN_ROLE"
  | "UNKNOWN_CAPABILITY"
  | "BUDGET_EXCEEDED_TOKENS"
  | "BUDGET_EXCEEDED_INVOCATIONS";

export function enforceBudget(
  config: OrganizationConfiguration,
  usage: OrganizationUsage,
  roleId: string,
  capability: string,
  proposedAt: string,
): BudgetEnforcementResult {
  const tenantCfg = validateTenantScope(config.tenant);
  if (!tenantCfg.ok) return fail("TENANT_SCOPE_MISSING", null);
  const tenantUse = validateTenantScope(usage.tenant);
  if (!tenantUse.ok) return fail("TENANT_SCOPE_MISSING", null);

  if (tenantCfg.scope.tenantId !== tenantUse.scope.tenantId) {
    return fail("TENANT_MISMATCH", null);
  }

  if (
    config.id.kind !== usage.organizationId.kind ||
    config.id.value !== usage.organizationId.value
  ) {
    return fail("TENANT_MISMATCH", null);
  }

  const role = config.roles.find((r) => r.id === roleId);
  if (!role) return fail("UNKNOWN_ROLE", null);

  const budget = role.capabilityBudgets.find((b) => b.capability === capability);
  if (!budget) return fail("UNKNOWN_CAPABILITY", null);

  const roleUsage = usage.perRoleUsage.find((u) => u.roleId === roleId);
  const capUsage = roleUsage?.perCapabilityUsage.find(
    (u) => u.capability === capability,
  );

  const tokensUsed = capUsage?.tokensUsed ?? 0;
  const invocationsThisHour = capUsage?.invocationsThisHour ?? 0;

  if (tokensUsed > budget.maxTokens) {
    return fail("BUDGET_EXCEEDED_TOKENS", capability);
  }
  if (invocationsThisHour > budget.maxInvocationsPerHour) {
    return fail("BUDGET_EXCEEDED_INVOCATIONS", capability);
  }

  return {
    ok: true,
    proposal: {
      kind: "capability-proposal",
      organizationId: config.id,
      tenant: config.tenant,
      roleId,
      capability,
      proposedAt,
    },
  };
}

function fail(
  reasonCode: BudgetReasonCode,
  exceededCapability: string | null,
): BudgetEnforcementResult {
  return { ok: false, reasonCode, exceededCapability };
}
