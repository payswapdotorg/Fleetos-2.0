/**
 * @fleetos/model-gateway — Model Gateway bounded context.
 *
 * Wave 0 lane C (F200C). Pure TypeScript domain package.
 *
 * Laws:
 *   A7  — provider neutrality. Provider names stay behind a structural
 *         ModelProviderPort seam. NO provider SDK types in domain contracts.
 *   A8  — tenant isolation, fail-closed.
 *   A12 — deterministic reference path. The reference router has zero
 *         network and zero GPU dependencies; pure functions only.
 *   A20 — no cross-boundary implementation imports.
 *
 * Cross-worker seam rule: ModelProviderPort is a LOCAL structural type.
 * Worker B's adapter implementations are not imported here.
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
// Model request and routing policy.
// ---------------------------------------------------------------------------

export interface ModelRequest {
  readonly tenant: TenantScope;
  readonly promptTokenEstimate: number;
  readonly capability: string;
}

export interface RoutingPolicy {
  readonly tenant: TenantScope;
  /** Ordered list of provider ids to attempt; first available wins. */
  readonly fallbackOrder: readonly string[];
  readonly maxTokensPerRequest: number;
  readonly budgetTokensPerHour: number;
}

// ---------------------------------------------------------------------------
// Structural port — ModelProviderPort (law A7). Adapters implement this
// shape; provider SDK types never leak into domain contracts.
// ---------------------------------------------------------------------------

export interface ModelProviderPort {
  readonly providerId: string;
  isAvailable(): boolean;
  estimateCost(request: ModelRequest): number;
}

// ---------------------------------------------------------------------------
// Deterministic reference router — pure. Ordered fallback with honest
// no-provider-available degradation. Never silently falls through to a
// default provider; absence of providers is an honest refusal.
// ---------------------------------------------------------------------------

export type RoutingDecision =
  | {
      ok: true;
      providerId: string;
      estimatedCost: number;
      fallbackTried: readonly string[];
    }
  | { ok: false; reasonCode: RoutingReasonCode; fallbackTried: readonly string[] };

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
    };
  }

  return refuse("NO_PROVIDER_AVAILABLE", tried);
}

function refuse(
  reasonCode: RoutingReasonCode,
  fallbackTried: readonly string[],
): RoutingDecision {
  return { ok: false, reasonCode, fallbackTried };
}

// ---------------------------------------------------------------------------
// Pure budget policy check — over-budget is REFUSED, never silently
// clamped (law A4).
// ---------------------------------------------------------------------------

export type BudgetCheckResult =
  | { ok: true; remainingTokens: number }
  | { ok: false; reasonCode: BudgetReasonCode; overshootTokens: number };

export type BudgetReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "TENANT_MISMATCH"
  | "NEGATIVE_USAGE"
  | "BUDGET_EXCEEDED";

export function checkBudgetPolicy(
  policy: RoutingPolicy,
  usage: { tenant: TenantScope; tokensUsedThisHour: number },
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
