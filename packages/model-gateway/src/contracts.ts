/**
 * @fleetos/model-gateway — Model Gateway bounded context.
 *
 * Wave 1 lane C (F210C) kernel-grade.
 *
 * Laws:
 *   A7  — provider neutrality. Provider SDK types never leak.
 *   A8  — tenant isolation, fail-closed.
 *   A12 — deterministic reference path.
 *   A19 — audit; routing decisions are recorded (deterministic given
 *         the same request+policy+state).
 *   A20 — no cross-boundary imports.
 *
 * Wave 1 kernel-grade additions over Wave 0 (F200C):
 *   - provider selection with ordered fallback + budget policies;
 *   - rate/quota accounting contracts;
 *   - honest no-provider degradation;
 *   - routing decisions RECORDED with deterministic digest;
 *   - ModelGatewayDirectory over ModelGatewayRepositoryPort + in-memory
 *     reference.
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
// Model request + routing policy.
// ---------------------------------------------------------------------------

export interface ModelRequest {
  readonly tenant: TenantScope;
  readonly promptTokenEstimate: number;
  readonly capability: string;
}

export interface RoutingPolicy {
  readonly tenant: TenantScope;
  readonly fallbackOrder: readonly string[];
  readonly maxTokensPerRequest: number;
  readonly budgetTokensPerHour: number;
}

// ---------------------------------------------------------------------------
// ModelProviderPort — structural seam (law A7).
// ---------------------------------------------------------------------------

export interface ModelProviderPort {
  readonly providerId: string;
  isAvailable(): boolean;
  estimateCost(request: ModelRequest): number;
}

// ---------------------------------------------------------------------------
// Routing decision — RECORDED with deterministic digest. The digest is
// byte-identical for byte-identical inputs (request+policy+state).
// ---------------------------------------------------------------------------

export type RoutingDecision =
  | {
      readonly ok: true;
      readonly providerId: string;
      readonly estimatedCost: number;
      readonly fallbackTried: readonly string[];
      readonly digest: string;
    }
  | {
      readonly ok: false;
      readonly reasonCode: RoutingReasonCode;
      readonly fallbackTried: readonly string[];
      readonly digest: string;
    };

export type RoutingReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "TENANT_MISMATCH"
  | "EMPTY_FALLBACK_ORDER"
  | "NO_PROVIDER_AVAILABLE"
  | "REQUEST_EXCEEDS_MAX_TOKENS";

export function route(
  request: ModelRequest,
  policy: RoutingPolicy,
  providers: readonly ModelProviderPort[],
): RoutingDecision {
  const tenantReq = validateTenantScope(request.tenant);
  if (!tenantReq.ok) return refuse("TENANT_SCOPE_MISSING", []);
  const tenantPol = validateTenantScope(policy.tenant);
  if (!tenantPol.ok) return refuse("TENANT_SCOPE_MISSING", []);
  if (tenantReq.scope.tenantId !== tenantPol.scope.tenantId) {
    return refuse("TENANT_MISMATCH", []);
  }
  if (policy.fallbackOrder.length === 0) {
    return refuse("EMPTY_FALLBACK_ORDER", []);
  }
  if (request.promptTokenEstimate > policy.maxTokensPerRequest) {
    return refuse("REQUEST_EXCEEDS_MAX_TOKENS", []);
  }
  const byId = new Map(providers.map((p) => [p.providerId, p]));
  const tried: string[] = [];
  for (const providerId of policy.fallbackOrder) {
    const provider = byId.get(providerId);
    if (!provider) {
      tried.push(providerId);
      continue;
    }
    if (!provider.isAvailable()) {
      tried.push(providerId);
      continue;
    }
    const cost = provider.estimateCost(request);
    return {
      ok: true,
      providerId,
      estimatedCost: cost,
      fallbackTried: tried,
      digest: computeRoutingDigest({
        tenantId: tenantReq.scope.tenantId,
        requestCapability: request.capability,
        promptTokenEstimate: request.promptTokenEstimate,
        fallbackOrder: policy.fallbackOrder,
        result: providerId,
      }),
    };
  }
  return refuse("NO_PROVIDER_AVAILABLE", tried);
}

function refuse(
  reasonCode: RoutingReasonCode,
  fallbackTried: readonly string[],
): RoutingDecision {
  return {
    ok: false,
    reasonCode,
    fallbackTried,
    digest: computeRoutingDigest({
      tenantId: "",
      requestCapability: "",
      promptTokenEstimate: 0,
      fallbackOrder: [],
      result: reasonCode,
    }),
  };
}

/**
 * computeRoutingDigest — stable deterministic digest. Pure.
 */
export function computeRoutingDigest(inputs: {
  readonly tenantId: string;
  readonly requestCapability: string;
  readonly promptTokenEstimate: number;
  readonly fallbackOrder: readonly string[];
  readonly result: string;
}): string {
  const parts = [
    inputs.tenantId,
    inputs.requestCapability,
    String(inputs.promptTokenEstimate),
    inputs.fallbackOrder.join(","),
    inputs.result,
  ];
  let hash = 0x811c9dc5;
  const joined = parts.join("\u241f");
  for (let i = 0; i < joined.length; i++) {
    hash ^= joined.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return `route_${hash.toString(16).padStart(8, "0")}`;
}

// ---------------------------------------------------------------------------
// Pure budget policy check — over-budget is REFUSED, never silently
// clamped (law A4).
// ---------------------------------------------------------------------------

export type BudgetCheckResult =
  | { readonly ok: true; readonly remainingTokens: number }
  | { readonly ok: false; readonly reasonCode: BudgetReasonCode; readonly overshootTokens: number };

export type BudgetReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "TENANT_MISMATCH"
  | "NEGATIVE_USAGE"
  | "BUDGET_EXCEEDED";

export function checkBudgetPolicy(
  policy: RoutingPolicy,
  usage: { readonly tenant: TenantScope; readonly tokensUsedThisHour: number },
): BudgetCheckResult {
  const tenantPol = validateTenantScope(policy.tenant);
  if (!tenantPol.ok) return refuseBudget("TENANT_SCOPE_MISSING", 0);
  const tenantUse = validateTenantScope(usage.tenant);
  if (!tenantUse.ok) return refuseBudget("TENANT_SCOPE_MISSING", 0);
  if (tenantPol.scope.tenantId !== tenantUse.scope.tenantId) {
    return refuseBudget("TENANT_MISMATCH", 0);
  }
  if (usage.tokensUsedThisHour < 0) {
    return refuseBudget("NEGATIVE_USAGE", 0);
  }
  if (usage.tokensUsedThisHour > policy.budgetTokensPerHour) {
    return refuseBudget(
      "BUDGET_EXCEEDED",
      usage.tokensUsedThisHour - policy.budgetTokensPerHour,
    );
  }
  return {
    ok: true,
    remainingTokens: policy.budgetTokensPerHour - usage.tokensUsedThisHour,
  };
}

function refuseBudget(
  reasonCode: BudgetReasonCode,
  overshootTokens: number,
): BudgetCheckResult {
  return { ok: false, reasonCode, overshootTokens };
}

// ---------------------------------------------------------------------------
// Rate/quota accounting contract — pure projection. The composing
// application persists the actual usage state.
// ---------------------------------------------------------------------------

export interface QuotaAccount {
  readonly tenant: TenantScope;
  readonly tokensUsedThisHour: number;
  readonly invocationsThisHour: number;
  readonly hourStartedAt: string;
}

export interface QuotaProjection {
  readonly tenant: TenantScope;
  readonly tokensUsedThisHour: number;
  readonly budgetTokensPerHour: number;
  readonly remainingTokens: number;
  readonly utilizationRatio: number;
  readonly overBudget: boolean;
}

export function computeQuotaProjection(
  policy: RoutingPolicy,
  account: QuotaAccount,
): QuotaProjection {
  const tenantPol = validateTenantScope(policy.tenant);
  const tenantAcc = validateTenantScope(account.tenant);
  if (
    !tenantPol.ok ||
    !tenantAcc.ok ||
    tenantPol.scope.tenantId !== tenantAcc.scope.tenantId
  ) {
    return {
      tenant: account.tenant,
      tokensUsedThisHour: 0,
      budgetTokensPerHour: 0,
      remainingTokens: 0,
      utilizationRatio: 0,
      overBudget: false,
    };
  }
  const used = account.tokensUsedThisHour;
  const budget = policy.budgetTokensPerHour;
  return {
    tenant: tenantAcc.scope,
    tokensUsedThisHour: used,
    budgetTokensPerHour: budget,
    remainingTokens: Math.max(0, budget - used),
    utilizationRatio: budget === 0 ? 0 : used / budget,
    overBudget: used > budget,
  };
}
