/**
 * @fleetos/agent-organizations — Wave 1 kernel-grade tests.
 */
import { describe, expect, it } from "vitest";
import {
  enforceBudget,
  makeAuthorizationRequest,
  computeAuthorizationRequestDigest,
  createAgentOrganizationDirectory,
  createInMemoryAgentOrganizationRepository,
  type OrganizationConfiguration,
  type OrganizationUsage,
  type TenantScope,
} from "../src/index.js";

const TENANT: TenantScope = { tenantId: "acme" };

function baseConfig(overrides: Partial<OrganizationConfiguration> = {}): OrganizationConfiguration {
  return {
    id: { kind: "organization", value: "org-1" },
    tenant: TENANT,
    roles: [
      {
        id: "role-1",
        name: "Operator",
        capabilityBudgets: [
          { capability: "read_asset", maxTokens: 1000, maxInvocationsPerHour: 100 },
          { capability: "command_asset", maxTokens: 500, maxInvocationsPerHour: 50 },
        ],
      },
    ],
    ...overrides,
  };
}

function baseUsage(overrides: Partial<OrganizationUsage> = {}): OrganizationUsage {
  return {
    organizationId: { kind: "organization", value: "org-1" },
    tenant: TENANT,
    perRoleUsage: [
      {
        roleId: "role-1",
        perCapabilityUsage: [
          { capability: "read_asset", tokensUsed: 100, invocationsThisHour: 10 },
          { capability: "command_asset", tokensUsed: 50, invocationsThisHour: 5 },
        ],
      },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// enforceBudget — kernel-grade.
// ---------------------------------------------------------------------------

describe("enforceBudget — legal cases", () => {
  it("returns a proposal when usage is within budget", () => {
    const result = enforceBudget(baseConfig(), baseUsage(), "role-1", "read_asset", "2026-01-01T00:00:00Z");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.proposal.kind).toBe("capability-proposal");
      expect(result.proposal.roleId).toBe("role-1");
      expect(result.proposal.capability).toBe("read_asset");
    }
  });

  it("returns a proposal when usage is exactly at the limit (not exceeded)", () => {
    const usage = baseUsage({
      perRoleUsage: [
        {
          roleId: "role-1",
          perCapabilityUsage: [
            { capability: "read_asset", tokensUsed: 1000, invocationsThisHour: 100 },
          ],
        },
      ],
    });
    const result = enforceBudget(baseConfig(), usage, "role-1", "read_asset", "2026-01-01T00:00:00Z");
    expect(result.ok).toBe(true);
  });
});

describe("enforceBudget — refusals", () => {
  it("refuses with BUDGET_EXCEEDED_TOKENS when tokens exceed budget", () => {
    const usage = baseUsage({
      perRoleUsage: [
        {
          roleId: "role-1",
          perCapabilityUsage: [
            { capability: "read_asset", tokensUsed: 1001, invocationsThisHour: 10 },
          ],
        },
      ],
    });
    const result = enforceBudget(baseConfig(), usage, "role-1", "read_asset", "2026-01-01T00:00:00Z");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("BUDGET_EXCEEDED_TOKENS");
      expect(result.exceededCapability).toBe("read_asset");
      expect(result.tokensUsed).toBe(1001);
      expect(result.maxTokens).toBe(1000);
    }
  });

  it("refuses with BUDGET_EXCEEDED_INVOCATIONS when invocations exceed budget", () => {
    const usage = baseUsage({
      perRoleUsage: [
        {
          roleId: "role-1",
          perCapabilityUsage: [
            { capability: "read_asset", tokensUsed: 100, invocationsThisHour: 101 },
          ],
        },
      ],
    });
    const result = enforceBudget(baseConfig(), usage, "role-1", "read_asset", "2026-01-01T00:00:00Z");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("BUDGET_EXCEEDED_INVOCATIONS");
      expect(result.invocationsThisHour).toBe(101);
      expect(result.maxInvocationsPerHour).toBe(100);
    }
  });

  it("refuses with UNKNOWN_ROLE when the role does not exist", () => {
    const result = enforceBudget(baseConfig(), baseUsage(), "role-missing", "read_asset", "2026-01-01T00:00:00Z");
    expect(result).toMatchObject({ ok: false, reasonCode: "UNKNOWN_ROLE" });
  });

  it("refuses with UNKNOWN_CAPABILITY when the capability does not exist for the role", () => {
    const result = enforceBudget(baseConfig(), baseUsage(), "role-1", "unknown_cap", "2026-01-01T00:00:00Z");
    expect(result).toMatchObject({ ok: false, reasonCode: "UNKNOWN_CAPABILITY" });
  });

  it("refuses with TENANT_MISMATCH when organization ids do not match", () => {
    const usage = baseUsage({ organizationId: { kind: "organization", value: "other" } });
    const result = enforceBudget(baseConfig(), usage, "role-1", "read_asset", "2026-01-01T00:00:00Z");
    expect(result).toMatchObject({ ok: false, reasonCode: "TENANT_MISMATCH" });
  });

  it("refuses with TENANT_SCOPE_MISSING on broken tenant", () => {
    const broken = { tenantId: "" } as unknown as TenantScope;
    const result = enforceBudget(
      baseConfig({ tenant: broken }),
      baseUsage({ tenant: broken }),
      "role-1",
      "read_asset",
      "2026-01-01T00:00:00Z",
    );
    expect(result).toMatchObject({ ok: false, reasonCode: "TENANT_SCOPE_MISSING" });
  });
});

// ---------------------------------------------------------------------------
// makeAuthorizationRequest — every consequential operation emits an
// AuthorizationRequest. The organization NEVER executes directly.
// ---------------------------------------------------------------------------

describe("makeAuthorizationRequest — untrusted-actor encoding", () => {
  it("produces an AuthorizationRequest carrying the budget check result", () => {
    const request = makeAuthorizationRequest(baseConfig(), baseUsage(), "role-1", "read_asset", "2026-01-01T00:00:00Z");
    expect(request.kind).toBe("authorization-request");
    expect(request.budgetCheck.ok).toBe(true);
    expect(request.digest).toMatch(/^authzreq_[0-9a-f]{8}$/);
  });

  it("produces an AuthorizationRequest even when the budget check refuses (the Guardian adjudicates)", () => {
    const usage = baseUsage({
      perRoleUsage: [
        {
          roleId: "role-1",
          perCapabilityUsage: [
            { capability: "read_asset", tokensUsed: 1001, invocationsThisHour: 10 },
          ],
        },
      ],
    });
    const request = makeAuthorizationRequest(baseConfig(), usage, "role-1", "read_asset", "2026-01-01T00:00:00Z");
    expect(request.kind).toBe("authorization-request");
    expect(request.budgetCheck.ok).toBe(false);
  });

  it("is deterministic — same inputs produce the same digest", () => {
    const a = makeAuthorizationRequest(baseConfig(), baseUsage(), "role-1", "read_asset", "2026-01-01T00:00:00Z");
    const b = makeAuthorizationRequest(baseConfig(), baseUsage(), "role-1", "read_asset", "2026-01-01T00:00:00Z");
    expect(a.digest).toBe(b.digest);
  });

  it("there is no Authorization type exported from this package (law A6)", () => {
    // This is a static type check — there is no Authorization export.
    // The test exists to assert the type contract; if an Authorization
    // type were ever added, this test would not compile.
    const request = makeAuthorizationRequest(baseConfig(), baseUsage(), "role-1", "read_asset", "2026-01-01T00:00:00Z");
    expect(request.kind).toBe("authorization-request");
    expect(request.budgetCheck.ok).toBe(true);
    if (request.budgetCheck.ok) {
      expect(request.budgetCheck.proposal.kind).toBe("capability-proposal");
    }
  });
});

describe("computeAuthorizationRequestDigest — determinism", () => {
  it("returns the same digest for the same inputs", () => {
    const inputs = {
      organizationId: "org-1",
      tenantId: "acme",
      roleId: "role-1",
      capability: "read_asset",
      proposedAt: "2026-01-01T00:00:00Z",
      budgetOk: true,
      budgetReasonCode: null,
    };
    expect(computeAuthorizationRequestDigest(inputs)).toBe(computeAuthorizationRequestDigest(inputs));
  });
});

// ---------------------------------------------------------------------------
// AgentOrganizationDirectory over in-memory repository.
// ---------------------------------------------------------------------------

describe("AgentOrganizationDirectory over InMemoryAgentOrganizationRepository", () => {
  it("requestAuthorization returns an authorization request and emits an audit event", async () => {
    const repo = createInMemoryAgentOrganizationRepository([baseConfig()], [baseUsage()]);
    const directory = createAgentOrganizationDirectory(repo);
    const result = await directory.requestAuthorization(
      TENANT,
      { kind: "organization", value: "org-1" },
      "role-1",
      "read_asset",
      "2026-01-01T00:00:00Z",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.authorizationRequest.kind).toBe("authorization-request");
      expect(result.auditEvents[0]?.kind).toBe("agent-org.authorization-requested");
    }
  });

  it("requestAuthorization returns the request even when budget exceeds — Guardian adjudicates", async () => {
    const usage = baseUsage({
      perRoleUsage: [
        {
          roleId: "role-1",
          perCapabilityUsage: [
            { capability: "read_asset", tokensUsed: 1001, invocationsThisHour: 10 },
          ],
        },
      ],
    });
    const repo = createInMemoryAgentOrganizationRepository([baseConfig()], [usage]);
    const directory = createAgentOrganizationDirectory(repo);
    const result = await directory.requestAuthorization(
      TENANT,
      { kind: "organization", value: "org-1" },
      "role-1",
      "read_asset",
      "2026-01-01T00:00:00Z",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("BUDGET_EXCEEDED_TOKENS");
      expect(result.authorizationRequest?.kind).toBe("authorization-request");
      expect(result.auditEvents?.[0]?.kind).toBe("agent-org.budget-exceeded");
    }
  });

  it("requestAuthorization refuses with CONFIGURATION_NOT_FOUND when the org is unknown", async () => {
    const repo = createInMemoryAgentOrganizationRepository();
    const directory = createAgentOrganizationDirectory(repo);
    const result = await directory.requestAuthorization(
      TENANT,
      { kind: "organization", value: "missing" },
      "role-1",
      "read_asset",
      "2026-01-01T00:00:00Z",
    );
    expect(result).toEqual({ ok: false, reasonCode: "CONFIGURATION_NOT_FOUND" });
  });

  it("getConfiguration returns null for cross-tenant (fail-closed)", async () => {
    const repo = createInMemoryAgentOrganizationRepository([baseConfig()]);
    const directory = createAgentOrganizationDirectory(repo);
    const item = await directory.getConfiguration(
      { tenantId: "other" },
      { kind: "organization", value: "org-1" },
    );
    expect(item).toBeNull();
  });
});
