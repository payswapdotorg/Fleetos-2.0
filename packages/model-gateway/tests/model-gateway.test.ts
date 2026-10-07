import { describe, expect, it } from "vitest";
import {
  route,
  checkBudgetPolicy,
  validateTenantScope,
  type TenantScope,
  type ModelRequest,
  type RoutingPolicy,
  type ModelProviderPort,
} from "../src/index.js";

const TENANT: TenantScope = { tenantId: "acme" };

function request(overrides: Partial<ModelRequest> = {}): ModelRequest {
  return {
    tenant: TENANT,
    promptTokenEstimate: 500,
    capability: "diagnose-fault",
    ...overrides,
  };
}

function policy(overrides: Partial<RoutingPolicy> = {}): RoutingPolicy {
  return {
    tenant: TENANT,
    fallbackOrder: ["provider-a", "provider-b"],
    maxTokensPerRequest: 10_000,
    budgetTokensPerHour: 1_000_000,
    ...overrides,
  };
}

function provider(
  providerId: string,
  available: boolean,
  cost = 1,
): ModelProviderPort {
  return {
    providerId,
    isAvailable: () => available,
    estimateCost: () => cost,
  };
}

describe("validateTenantScope", () => {
  it("accepts a valid tenant id", () => {
    expect(validateTenantScope({ tenantId: "acme" })).toEqual({
      ok: true,
      scope: { tenantId: "acme" },
    });
  });

  it("refuses a null scope with TENANT_SCOPE_MISSING", () => {
    expect(validateTenantScope(null)).toEqual({
      ok: false,
      reasonCode: "TENANT_SCOPE_MISSING",
    });
  });
});

describe("route — ordered fallback", () => {
  it("selects the first available provider in fallback order", () => {
    const r = route(request(), policy(), [
      provider("provider-a", true, 100),
      provider("provider-b", true, 200),
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.providerId).toBe("provider-a");
      expect(r.estimatedCost).toBe(100);
      expect(r.fallbackTried).toEqual([]);
    }
  });

  it("falls through to the next provider when the first is unavailable", () => {
    const r = route(request(), policy(), [
      provider("provider-a", false),
      provider("provider-b", true, 150),
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.providerId).toBe("provider-b");
      expect(r.fallbackTried).toEqual(["provider-a"]);
    }
  });

  it("falls through when a provider id is unknown", () => {
    const r = route(request(), policy(), [provider("provider-b", true)]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.providerId).toBe("provider-b");
      expect(r.fallbackTried).toEqual(["provider-a"]);
    }
  });
});

describe("route — honest no-provider-available degradation", () => {
  it("refuses with NO_PROVIDER_AVAILABLE when all providers are unavailable", () => {
    const r = route(request(), policy(), [
      provider("provider-a", false),
      provider("provider-b", false),
    ]);
    expect(r).toEqual({
      ok: false,
      reasonCode: "NO_PROVIDER_AVAILABLE",
      fallbackTried: ["provider-a", "provider-b"],
    });
  });

  it("refuses with EMPTY_FALLBACK_ORDER when policy has no providers", () => {
    const r = route(request(), policy({ fallbackOrder: [] }), []);
    expect(r).toEqual({
      ok: false,
      reasonCode: "EMPTY_FALLBACK_ORDER",
      fallbackTried: [],
    });
  });

  it("refuses with REQUEST_EXCEEDS_MAX_TOKENS when the prompt is too large", () => {
    const r = route(
      request({ promptTokenEstimate: 20_000 }),
      policy({ maxTokensPerRequest: 10_000 }),
      [provider("provider-a", true)],
    );
    expect(r).toEqual({
      ok: false,
      reasonCode: "REQUEST_EXCEEDS_MAX_TOKENS",
      fallbackTried: [],
    });
  });

  it("never silently falls back to a default provider outside the policy", () => {
    // provider-c is available but NOT in the fallback order — must not be
    // selected.
    const r = route(
      request(),
      policy({ fallbackOrder: ["provider-a", "provider-b"] }),
      [provider("provider-a", false), provider("provider-b", false), provider("provider-c", true)],
    );
    expect(r).toEqual({
      ok: false,
      reasonCode: "NO_PROVIDER_AVAILABLE",
      fallbackTried: ["provider-a", "provider-b"],
    });
  });
});

describe("route — tenant fail-closed", () => {
  it("refuses with TENANT_SCOPE_MISSING when request tenant is broken", () => {
    const r = route(
      request({ tenant: { tenantId: "" } as unknown as TenantScope }),
      policy(),
      [provider("provider-a", true)],
    );
    expect(r).toEqual({
      ok: false,
      reasonCode: "TENANT_SCOPE_MISSING",
      fallbackTried: [],
    });
  });

  it("refuses with TENANT_MISMATCH when request and policy tenants differ", () => {
    const r = route(
      request({ tenant: { tenantId: "acme" } }),
      policy({ tenant: { tenantId: "globex" } as unknown as TenantScope }),
      [provider("provider-a", true)],
    );
    expect(r).toEqual({
      ok: false,
      reasonCode: "TENANT_MISMATCH",
      fallbackTried: [],
    });
  });
});

describe("checkBudgetPolicy", () => {
  it("accepts usage within budget and reports remaining tokens", () => {
    const r = checkBudgetPolicy(policy({ budgetTokensPerHour: 1_000 }), {
      tenant: TENANT,
      tokensUsedThisHour: 800,
    });
    expect(r).toEqual({ ok: true, remainingTokens: 200 });
  });

  it("refuses with BUDGET_EXCEEDED and the exact overshoot, never clamped", () => {
    const r = checkBudgetPolicy(policy({ budgetTokensPerHour: 1_000 }), {
      tenant: TENANT,
      tokensUsedThisHour: 1_500,
    });
    expect(r).toEqual({
      ok: false,
      reasonCode: "BUDGET_EXCEEDED",
      overshootTokens: 500,
    });
  });

  it("refuses negative usage with NEGATIVE_USAGE", () => {
    const r = checkBudgetPolicy(policy(), {
      tenant: TENANT,
      tokensUsedThisHour: -1,
    });
    expect(r).toEqual({
      ok: false,
      reasonCode: "NEGATIVE_USAGE",
      overshootTokens: 0,
    });
  });
});
