/**
 * @fleetos/model-gateway — Wave 1 kernel-grade tests.
 */
import { describe, expect, it } from "vitest";
import {
  route,
  checkBudgetPolicy,
  computeQuotaProjection,
  computeRoutingDigest,
  createModelGatewayDirectory,
  createInMemoryModelGatewayRepository,
  type ModelRequest,
  type RoutingPolicy,
  type ModelProviderPort,
  type QuotaAccount,
  type TenantScope,
} from "../src/index.js";

const TENANT: TenantScope = { tenantId: "acme" };

function basePolicy(overrides: Partial<RoutingPolicy> = {}): RoutingPolicy {
  return {
    tenant: TENANT,
    fallbackOrder: ["p-1", "p-2"],
    maxTokensPerRequest: 1000,
    budgetTokensPerHour: 10000,
    ...overrides,
  };
}

function baseRequest(overrides: Partial<ModelRequest> = {}): ModelRequest {
  return {
    tenant: TENANT,
    promptTokenEstimate: 100,
    capability: "chat",
    ...overrides,
  };
}

function makeProvider(
  providerId: string,
  available: boolean,
  cost: number,
): ModelProviderPort {
  return {
    providerId,
    isAvailable: () => available,
    estimateCost: () => cost,
  };
}

// ---------------------------------------------------------------------------
// route — deterministic routing with recorded digest.
// ---------------------------------------------------------------------------

describe("route — deterministic routing", () => {
  it("selects the first available provider in the fallback order", () => {
    const decision = route(
      baseRequest(),
      basePolicy(),
      [makeProvider("p-1", true, 10), makeProvider("p-2", true, 5)],
    );
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.providerId).toBe("p-1");
      expect(decision.estimatedCost).toBe(10);
      expect(decision.fallbackTried).toEqual([]);
      expect(decision.digest).toMatch(/^route_[0-9a-f]{8}$/);
    }
  });

  it("falls through to the next provider when the first is unavailable", () => {
    const decision = route(
      baseRequest(),
      basePolicy(),
      [makeProvider("p-1", false, 10), makeProvider("p-2", true, 5)],
    );
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.providerId).toBe("p-2");
      expect(decision.fallbackTried).toEqual(["p-1"]);
    }
  });

  it("refuses with NO_PROVIDER_AVAILABLE when all providers are unavailable", () => {
    const decision = route(
      baseRequest(),
      basePolicy(),
      [makeProvider("p-1", false, 10), makeProvider("p-2", false, 5)],
    );
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.reasonCode).toBe("NO_PROVIDER_AVAILABLE");
      expect(decision.fallbackTried).toEqual(["p-1", "p-2"]);
    }
  });

  it("refuses with EMPTY_FALLBACK_ORDER when policy has no fallbacks", () => {
    const decision = route(
      baseRequest(),
      basePolicy({ fallbackOrder: [] }),
      [makeProvider("p-1", true, 10)],
    );
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reasonCode).toBe("EMPTY_FALLBACK_ORDER");
  });

  it("refuses with REQUEST_EXCEEDS_MAX_TOKENS when the request is too large", () => {
    const decision = route(
      baseRequest({ promptTokenEstimate: 2000 }),
      basePolicy({ maxTokensPerRequest: 1000 }),
      [makeProvider("p-1", true, 10)],
    );
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reasonCode).toBe("REQUEST_EXCEEDS_MAX_TOKENS");
  });

  it("refuses with TENANT_MISMATCH when request and policy tenants differ", () => {
    const other: TenantScope = { tenantId: "other" };
    const decision = route(
      baseRequest({ tenant: TENANT }),
      basePolicy({ tenant: other }),
      [makeProvider("p-1", true, 10)],
    );
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reasonCode).toBe("TENANT_MISMATCH");
  });

  it("refuses with TENANT_SCOPE_MISSING on broken tenant", () => {
    const broken = { tenantId: "" } as unknown as TenantScope;
    const decision = route(
      baseRequest({ tenant: broken }),
      basePolicy({ tenant: broken }),
      [],
    );
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reasonCode).toBe("TENANT_SCOPE_MISSING");
  });

  it("is deterministic — same inputs produce the same digest", () => {
    const a = route(baseRequest(), basePolicy(), [makeProvider("p-1", true, 10)]);
    const b = route(baseRequest(), basePolicy(), [makeProvider("p-1", true, 10)]);
    expect(a).toEqual(b);
  });
});

describe("computeRoutingDigest — determinism", () => {
  it("returns the same digest for the same inputs", () => {
    const inputs = {
      tenantId: "acme",
      requestCapability: "chat",
      promptTokenEstimate: 100,
      fallbackOrder: ["p-1", "p-2"],
      result: "p-1",
    };
    expect(computeRoutingDigest(inputs)).toBe(computeRoutingDigest(inputs));
  });
});

// ---------------------------------------------------------------------------
// checkBudgetPolicy.
// ---------------------------------------------------------------------------

describe("checkBudgetPolicy", () => {
  it("returns ok with remaining tokens when usage is within budget", () => {
    const result = checkBudgetPolicy(
      basePolicy({ budgetTokensPerHour: 1000 }),
      { tenant: TENANT, tokensUsedThisHour: 200 },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.remainingTokens).toBe(800);
  });

  it("refuses with BUDGET_EXCEEDED and the exact overshoot", () => {
    const result = checkBudgetPolicy(
      basePolicy({ budgetTokensPerHour: 1000 }),
      { tenant: TENANT, tokensUsedThisHour: 1500 },
    );
    expect(result).toEqual({ ok: false, reasonCode: "BUDGET_EXCEEDED", overshootTokens: 500 });
  });

  it("refuses with NEGATIVE_USAGE for negative tokens used", () => {
    const result = checkBudgetPolicy(
      basePolicy(),
      { tenant: TENANT, tokensUsedThisHour: -1 },
    );
    expect(result).toEqual({ ok: false, reasonCode: "NEGATIVE_USAGE", overshootTokens: 0 });
  });

  it("refuses with TENANT_MISMATCH when tenants differ", () => {
    const other: TenantScope = { tenantId: "other" };
    const result = checkBudgetPolicy(
      basePolicy({ tenant: TENANT }),
      { tenant: other, tokensUsedThisHour: 100 },
    );
    expect(result).toEqual({ ok: false, reasonCode: "TENANT_MISMATCH", overshootTokens: 0 });
  });
});

// ---------------------------------------------------------------------------
// computeQuotaProjection.
// ---------------------------------------------------------------------------

describe("computeQuotaProjection — honest projection", () => {
  it("returns the utilization ratio and remaining tokens", () => {
    const account: QuotaAccount = {
      tenant: TENANT,
      tokensUsedThisHour: 200,
      invocationsThisHour: 10,
      hourStartedAt: "2026-01-01T00:00:00Z",
    };
    const projection = computeQuotaProjection(basePolicy({ budgetTokensPerHour: 1000 }), account);
    expect(projection.tokensUsedThisHour).toBe(200);
    expect(projection.budgetTokensPerHour).toBe(1000);
    expect(projection.remainingTokens).toBe(800);
    expect(projection.utilizationRatio).toBe(0.2);
    expect(projection.overBudget).toBe(false);
  });

  it("reports overBudget true when used > budget (no clamping)", () => {
    const account: QuotaAccount = {
      tenant: TENANT,
      tokensUsedThisHour: 1500,
      invocationsThisHour: 10,
      hourStartedAt: "2026-01-01T00:00:00Z",
    };
    const projection = computeQuotaProjection(basePolicy({ budgetTokensPerHour: 1000 }), account);
    expect(projection.overBudget).toBe(true);
    expect(projection.utilizationRatio).toBe(1.5);
    expect(projection.remainingTokens).toBe(0); // honest floor at zero, but overBudget flag is true
  });
});

// ---------------------------------------------------------------------------
// ModelGatewayDirectory over in-memory repository.
// ---------------------------------------------------------------------------

describe("ModelGatewayDirectory over InMemoryModelGatewayRepository", () => {
  it("route returns the routing decision and emits an audit event", async () => {
    const repo = createInMemoryModelGatewayRepository(basePolicy());
    const directory = createModelGatewayDirectory(repo);
    const result = await directory.route(
      TENANT,
      { promptTokenEstimate: 100, capability: "chat" },
      [makeProvider("p-1", true, 10)],
      { occurredAt: "2026-01-01T00:00:00Z" },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.routing?.ok).toBe(true);
      expect(result.auditEvents[0]?.kind).toBe("model-gateway.route-decided");
    }
  });

  it("route refuses with POLICY_NOT_FOUND when no policy is configured", async () => {
    const repo = createInMemoryModelGatewayRepository();
    const directory = createModelGatewayDirectory(repo);
    const result = await directory.route(
      TENANT,
      { promptTokenEstimate: 100, capability: "chat" },
      [makeProvider("p-1", true, 10)],
      { occurredAt: "2026-01-01T00:00:00Z" },
    );
    expect(result).toEqual({ ok: false, reasonCode: "POLICY_NOT_FOUND" });
  });

  it("route refuses with NO_PROVIDER_AVAILABLE and emits an audit event", async () => {
    const repo = createInMemoryModelGatewayRepository(basePolicy());
    const directory = createModelGatewayDirectory(repo);
    const result = await directory.route(
      TENANT,
      { promptTokenEstimate: 100, capability: "chat" },
      [makeProvider("p-1", false, 10), makeProvider("p-2", false, 5)],
      { occurredAt: "2026-01-01T00:00:00Z" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("NO_PROVIDER_AVAILABLE");
      expect(result.auditEvents?.[0]?.kind).toBe("model-gateway.route-refused");
    }
  });

  it("checkBudget returns the budget check result and emits an audit event", async () => {
    const account: QuotaAccount = {
      tenant: TENANT,
      tokensUsedThisHour: 200,
      invocationsThisHour: 10,
      hourStartedAt: "2026-01-01T00:00:00Z",
    };
    const repo = createInMemoryModelGatewayRepository(basePolicy(), account);
    const directory = createModelGatewayDirectory(repo);
    const result = await directory.checkBudget(TENANT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.budget?.ok).toBe(true);
      expect(result.auditEvents[0]?.kind).toBe("model-gateway.budget-checked");
    }
  });

  it("projectQuota returns the projection and emits an audit event", async () => {
    const account: QuotaAccount = {
      tenant: TENANT,
      tokensUsedThisHour: 200,
      invocationsThisHour: 10,
      hourStartedAt: "2026-01-01T00:00:00Z",
    };
    const repo = createInMemoryModelGatewayRepository(basePolicy(), account);
    const directory = createModelGatewayDirectory(repo);
    const result = await directory.projectQuota(TENANT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.quotaProjection?.utilizationRatio).toBe(0.02);
      expect(result.auditEvents[0]?.kind).toBe("model-gateway.quota-projected");
    }
  });
});
