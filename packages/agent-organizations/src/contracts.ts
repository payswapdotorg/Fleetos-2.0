/**
 * @fleetos/agent-organizations — Agent Organizations bounded context.
 *
 * Wave 1 lane C (F210C) kernel-grade.
 *
 * Laws:
 *   A4  — consequential action protocol; budget exceedance REFUSED with
 *         machine-stable reason code, never silently overflowed.
 *   A5  — Guardian is the sole policy authority.
 *   A6  — agent trust boundary. Agent organizations are UNTRUSTED actors.
 *         They PROPOSE, never AUTHORIZE. Every consequential operation
 *         emits an AuthorizationRequest contract — never executes directly.
 *   A8  — tenant isolation; fail-closed.
 *   A19 — audit.
 *   A20 — no cross-boundary imports.
 *
 * Wave 1 kernel-grade additions over Wave 0 (F200C):
 *   - role/budget enforcement at kernel grade;
 *   - organizations stay UNTRUSTED — every consequential operation emits
 *     an AuthorizationRequest contract (the Guardian path out-of-lane
 *     consumes these via the structural seam);
 *   - AgentOrganizationDirectory over AgentOrganizationRepositoryPort +
 *     in-memory reference.
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
// Organization configuration, roles, capability budgets.
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
// Proposal + an AuthorizationRequest, never an Authorization. The
// Guardian (worker B) is the sole authority (law A5). Types encode this:
// there is no `Authorization` shape exported from this package; only
// `Proposal` and `AuthorizationRequest` shapes.
// ---------------------------------------------------------------------------

export interface CapabilityProposal {
  readonly kind: "capability-proposal";
  readonly organizationId: OrganizationId;
  readonly tenant: TenantScope;
  readonly roleId: string;
  readonly capability: string;
  readonly proposedAt: string;
}

/**
 * AuthorizationRequest — emitted by every consequential operation. The
 * organization NEVER executes; it requests authorization from the
 * Guardian (out-of-lane). The request carries the proposed action and
 * the organization's reasoning (budget check, role check).
 */
export interface AuthorizationRequest {
  readonly kind: "authorization-request";
  readonly organizationId: OrganizationId;
  readonly tenant: TenantScope;
  readonly roleId: string;
  readonly capability: string;
  readonly proposedAt: string;
  readonly budgetCheck: BudgetEnforcementResult;
  /** Stable digest of the request inputs — byte-identical for byte-identical inputs. */
  readonly digest: string;
}

// ---------------------------------------------------------------------------
// Pure budget enforcement — REFUSED with machine-stable reason code,
// never silently overflowed.
// ---------------------------------------------------------------------------

export type BudgetEnforcementResult =
  | { readonly ok: true; readonly proposal: CapabilityProposal }
  | {
      readonly ok: false;
      readonly reasonCode: BudgetReasonCode;
      readonly exceededCapability: string | null;
      readonly tokensUsed: number | null;
      readonly maxTokens: number | null;
      readonly invocationsThisHour: number | null;
      readonly maxInvocationsPerHour: number | null;
    };

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
  if (!tenantCfg.ok) return fail("TENANT_SCOPE_MISSING", null, null, null, null, null);
  const tenantUse = validateTenantScope(usage.tenant);
  if (!tenantUse.ok) return fail("TENANT_SCOPE_MISSING", null, null, null, null, null);
  if (tenantCfg.scope.tenantId !== tenantUse.scope.tenantId) {
    return fail("TENANT_MISMATCH", null, null, null, null, null);
  }
  if (
    config.id.kind !== usage.organizationId.kind ||
    config.id.value !== usage.organizationId.value
  ) {
    return fail("TENANT_MISMATCH", null, null, null, null, null);
  }
  const role = config.roles.find((r) => r.id === roleId);
  if (!role) return fail("UNKNOWN_ROLE", null, null, null, null, null);
  const budget = role.capabilityBudgets.find((b) => b.capability === capability);
  if (!budget) return fail("UNKNOWN_CAPABILITY", null, null, null, null, null);
  const roleUsage = usage.perRoleUsage.find((u) => u.roleId === roleId);
  const capUsage = roleUsage?.perCapabilityUsage.find(
    (u) => u.capability === capability,
  );
  const tokensUsed = capUsage?.tokensUsed ?? 0;
  const invocationsThisHour = capUsage?.invocationsThisHour ?? 0;
  if (tokensUsed > budget.maxTokens) {
    return fail(
      "BUDGET_EXCEEDED_TOKENS",
      capability,
      tokensUsed,
      budget.maxTokens,
      null,
      null,
    );
  }
  if (invocationsThisHour > budget.maxInvocationsPerHour) {
    return fail(
      "BUDGET_EXCEEDED_INVOCATIONS",
      capability,
      null,
      null,
      invocationsThisHour,
      budget.maxInvocationsPerHour,
    );
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
  tokensUsed: number | null,
  maxTokens: number | null,
  invocationsThisHour: number | null,
  maxInvocationsPerHour: number | null,
): BudgetEnforcementResult {
  return {
    ok: false,
    reasonCode,
    exceededCapability,
    tokensUsed,
    maxTokens,
    invocationsThisHour,
    maxInvocationsPerHour,
  };
}

// ---------------------------------------------------------------------------
// AuthorizationRequest factory — produces an AuthorizationRequest from
// a budget check. The request ALWAYS carries the budget check result
// (success or refusal) so the Guardian can adjudicate with full context.
// Determinism: identical inputs produce identical digests.
// ---------------------------------------------------------------------------

export function makeAuthorizationRequest(
  config: OrganizationConfiguration,
  usage: OrganizationUsage,
  roleId: string,
  capability: string,
  proposedAt: string,
): AuthorizationRequest {
  const budgetCheck = enforceBudget(config, usage, roleId, capability, proposedAt);
  const digest = computeAuthorizationRequestDigest({
    organizationId: config.id.value,
    tenantId: config.tenant.tenantId,
    roleId,
    capability,
    proposedAt,
    budgetOk: budgetCheck.ok,
    budgetReasonCode: budgetCheck.ok ? null : budgetCheck.reasonCode,
  });
  return {
    kind: "authorization-request",
    organizationId: config.id,
    tenant: config.tenant,
    roleId,
    capability,
    proposedAt,
    budgetCheck,
    digest,
  };
}

export function computeAuthorizationRequestDigest(inputs: {
  readonly organizationId: string;
  readonly tenantId: string;
  readonly roleId: string;
  readonly capability: string;
  readonly proposedAt: string;
  readonly budgetOk: boolean;
  readonly budgetReasonCode: string | null;
}): string {
  const parts = [
    inputs.organizationId,
    inputs.tenantId,
    inputs.roleId,
    inputs.capability,
    inputs.proposedAt,
    String(inputs.budgetOk),
    inputs.budgetReasonCode ?? "",
  ];
  let hash = 0x811c9dc5;
  const joined = parts.join("\u241f");
  for (let i = 0; i < joined.length; i++) {
    hash ^= joined.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return `authzreq_${hash.toString(16).padStart(8, "0")}`;
}
