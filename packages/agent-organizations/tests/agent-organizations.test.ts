import { describe, expect, it } from "vitest";
import {
  enforceBudget,
  validateTenantScope,
  type TenantScope,
  type OrganizationConfiguration,
  type OrganizationUsage,
  type RoleUsageSnapshot,
} from "../src/index.js";

const TENANT: TenantScope = { tenantId: "acme" };
const ORG_ID = { kind: "organization" as const, value: "o-1" };

function baseConfig(overrides: Partial<OrganizationConfiguration> = {}): OrganizationConfiguration {
  return {
    id: ORG_ID,
    tenant: TENANT,
    roles: [
      {
        id: "role-engineer",
        name: "Engineer",
        capabilityBudgets: [
          {
            capability: "diagnose-fault",
            maxTokens: 100_000,
            maxInvocationsPerHour: 60,
          },
        ],
      },
    ],
    ...overrides,
  };
}

function snapshot(
  roleId: string,
  capability: string,
  tokensUsed: number,
  invocationsThisHour: number,
): RoleUsageSnapshot {
  return {
    roleId,
    perCapabilityUsage: [{ capability, tokensUsed, invocationsThisHour }],
  };
}

function usage(
  snapshots: readonly RoleUsageSnapshot[],
  overrides: Partial<OrganizationUsage> = {},
): OrganizationUsage {
  return {
    organizationId: ORG_ID,
    tenant: TENANT,
    perRoleUsage: snapshots,
    ...overrides,
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

describe("enforceBudget — organizations propose, never authorize", () => {
  it("emits a CapabilityProposal when usage fits within budget", () => {
    const cfg = baseConfig();
    const u = usage([snapshot("role-engineer", "diagnose-fault", 10_000, 10)]);
    const r = enforceBudget(cfg, u, "role-engineer", "diagnose-fault", "2026-01-01T00:00:00Z");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.proposal.kind).toBe("capability-proposal");
      expect(r.proposal.roleId).toBe("role-engineer");
    }
  });

  it("refuses with BUDGET_EXCEEDED_TOKENS when token budget exceeded, never overflow", () => {
    const cfg = baseConfig();
    const u = usage([snapshot("role-engineer", "diagnose-fault", 200_000, 10)]);
    const r = enforceBudget(cfg, u, "role-engineer", "diagnose-fault", "2026-01-01T00:00:00Z");
    expect(r).toEqual({
      ok: false,
      reasonCode: "BUDGET_EXCEEDED_TOKENS",
      exceededCapability: "diagnose-fault",
    });
  });

  it("refuses with BUDGET_EXCEEDED_INVOCATIONS when invocation budget exceeded", () => {
    const cfg = baseConfig();
    const u = usage([snapshot("role-engineer", "diagnose-fault", 10, 100)]);
    const r = enforceBudget(cfg, u, "role-engineer", "diagnose-fault", "2026-01-01T00:00:00Z");
    expect(r).toEqual({
      ok: false,
      reasonCode: "BUDGET_EXCEEDED_INVOCATIONS",
      exceededCapability: "diagnose-fault",
    });
  });

  it("refuses with UNKNOWN_ROLE when role does not exist", () => {
    const r = enforceBudget(baseConfig(), usage([]), "ghost-role", "diagnose-fault", "");
    expect(r).toEqual({
      ok: false,
      reasonCode: "UNKNOWN_ROLE",
      exceededCapability: null,
    });
  });

  it("refuses with UNKNOWN_CAPABILITY when capability is not budgeted for the role", () => {
    const cfg = baseConfig();
    const r = enforceBudget(cfg, usage([]), "role-engineer", "ghost-cap", "");
    expect(r).toEqual({
      ok: false,
      reasonCode: "UNKNOWN_CAPABILITY",
      exceededCapability: null,
    });
  });

  it("the result is always a Proposal, never an Authorization (type-level assertion)", () => {
    const cfg = baseConfig();
    const u = usage([snapshot("role-engineer", "diagnose-fault", 1, 1)]);
    const r = enforceBudget(cfg, u, "role-engineer", "diagnose-fault", "2026-01-01T00:00:00Z");
    if (r.ok) {
      // The success branch only exposes a Proposal-shaped object. There is no
      // `authorized: true` field anywhere on the result, by design.
      expect((r.proposal as { authorized?: unknown }).authorized).toBeUndefined();
      expect(r.proposal.kind).toBe("capability-proposal");
    }
  });
});

describe("enforceBudget — tenant fail-closed", () => {
  it("refuses with TENANT_SCOPE_MISSING when config tenant is broken", () => {
    const cfg = baseConfig({ tenant: { tenantId: "" } as unknown as TenantScope });
    const r = enforceBudget(cfg, usage([]), "role-engineer", "diagnose-fault", "");
    expect(r).toEqual({
      ok: false,
      reasonCode: "TENANT_SCOPE_MISSING",
      exceededCapability: null,
    });
  });

  it("refuses with TENANT_MISMATCH when tenants differ across config and usage", () => {
    const cfg = baseConfig({ tenant: { tenantId: "acme" } });
    const u = usage([], {
      tenant: { tenantId: "globex" } as unknown as TenantScope,
    });
    const r = enforceBudget(cfg, u, "role-engineer", "diagnose-fault", "");
    expect(r).toEqual({
      ok: false,
      reasonCode: "TENANT_MISMATCH",
      exceededCapability: null,
    });
  });
});

describe("enforceBudget — determinism", () => {
  it("returns the same result for the same inputs across calls", () => {
    const cfg = baseConfig();
    const u = usage([snapshot("role-engineer", "diagnose-fault", 50_000, 30)]);
    const a = enforceBudget(cfg, u, "role-engineer", "diagnose-fault", "2026-01-01T00:00:00Z");
    const b = enforceBudget(cfg, u, "role-engineer", "diagnose-fault", "2026-01-01T00:00:00Z");
    expect(a).toEqual(b);
  });
});
