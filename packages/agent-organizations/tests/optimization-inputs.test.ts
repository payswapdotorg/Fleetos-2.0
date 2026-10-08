/**
 * @fleetos/agent-organizations — F260C optimization-inputs tests: problem
 * definition, validation reason codes, digest tamper detection, derived
 * usage facts.
 */
import { describe, expect, it } from "vitest";
import {
  computeOptimizationProblemDigest,
  deriveUsageFacts,
  goalWeightSumBps,
  prepareOptimizationInputs,
  verifyOptimizationProblemDigest,
  type OptimizationInputs,
} from "../src/index.js";
import {
  JOURNAL_EVENTS,
  OTHER_TENANT,
  TENANT,
  baseInputs,
  buildExcerpt,
  buildJournal,
  buildProblem,
} from "./optimize-fixtures.js";

describe("optimization problem preparation", () => {
  it("prepares a valid problem carrying the folded snapshot", () => {
    const validation = prepareOptimizationInputs(baseInputs());
    expect(validation.ok).toBe(true);
    if (!validation.ok) return;
    const problem = validation.problem;
    expect(problem.kind).toBe("optimization-problem");
    expect(problem.note).toBe("ceilings-are-constraints-not-authorizations");
    expect(problem.snapshot.tenantId).toBe("acme");
    // The package's OWN journal fold produced the snapshot.
    expect(problem.snapshot.concurrentRolesByAgent).toEqual({ "agent-3": 1 });
    expect(problem.snapshot.budgetTotals).toEqual({
      allocatedUnits: 1500,
      consumedUnits: 400,
      allocatedSpendMinor: 75000,
      consumedSpendMinor: 15000,
    });
    expect(problem.digest).toMatch(/^optin_[0-9a-f]{8}$/);
  });

  it("is deterministic — identical inputs → byte-identical problem", () => {
    const a = prepareOptimizationInputs(baseInputs());
    const b = prepareOptimizationInputs(baseInputs());
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("verifies its digest and detects tampering", () => {
    const problem = buildProblem();
    expect(verifyOptimizationProblemDigest(problem)).toBe(true);
    const tampered = { ...problem, goals: { ...problem.goals, costWeightBps: 9999 } };
    expect(verifyOptimizationProblemDigest(tampered)).toBe(false);
    const { digest: _d, ...rest } = problem;
    expect(problem.digest).toBe(computeOptimizationProblemDigest(rest));
  });

  it("detects tampering of budget consumption and role responsibilities", () => {
    const problem = buildProblem();
    const tamperedBudget = {
      ...problem,
      budgets: problem.budgets.map((b, i) =>
        i === 0 ? { ...b, consumedUnits: b.consumedUnits + 1 } : b,
      ),
    };
    expect(verifyOptimizationProblemDigest(tamperedBudget)).toBe(false);
    const tamperedRole = {
      ...problem,
      roles: problem.roles.map((r) =>
        r.id === "role-ops" ? { ...r, responsibilities: ["smuggled-duty"] } : r,
      ),
    };
    expect(verifyOptimizationProblemDigest(tamperedRole)).toBe(false);
  });

  it("fails closed on a missing tenant scope", () => {
    const validation = prepareOptimizationInputs({
      ...baseInputs(),
      tenant: { tenantId: "" },
    });
    expect(validation).toMatchObject({ ok: false, reasonCode: "TENANT_SCOPE_MISSING" });
  });

  it("refuses an empty organization id", () => {
    const validation = prepareOptimizationInputs({ ...baseInputs(), organizationId: "" });
    expect(validation).toMatchObject({ ok: false, reasonCode: "ORGANIZATION_ID_EMPTY" });
  });

  it("refuses a journal belonging to another tenant", () => {
    const validation = prepareOptimizationInputs({
      ...baseInputs(),
      journal: buildJournal(JOURNAL_EVENTS, OTHER_TENANT),
    });
    expect(validation).toMatchObject({ ok: false, reasonCode: "JOURNAL_TENANT_MISMATCH" });
  });

  it("refuses a tampered journal chain at the earliest broken seq", () => {
    const journal = buildJournal();
    const tampered = journal.map((e) =>
      e.seq === 3 ? { ...e, event: { kind: "policy-updated" as const } } : e,
    );
    const validation = prepareOptimizationInputs({ ...baseInputs(), journal: tampered });
    expect(validation).toMatchObject({
      ok: false,
      reasonCode: "JOURNAL_CHAIN_BROKEN",
      brokenAtSeq: 3,
    });
  });

  it("refuses a usage excerpt from another tenant", () => {
    const validation = prepareOptimizationInputs({
      ...baseInputs(),
      usageExcerpt: buildExcerpt("globex"),
    });
    expect(validation).toMatchObject({ ok: false, reasonCode: "USAGE_TENANT_MISMATCH" });
  });

  it("refuses a tampered usage ledger chain", () => {
    const excerpt = buildExcerpt();
    const tampered = excerpt.map((e, i) => (i === 1 ? { ...e, units: 999 } : e));
    const validation = prepareOptimizationInputs({ ...baseInputs(), usageExcerpt: tampered });
    expect(validation).toMatchObject({
      ok: false,
      reasonCode: "USAGE_LEDGER_CHAIN_BROKEN",
      brokenAtSeq: 2,
    });
  });
});

describe("goal weight validation (fixed vocabulary)", () => {
  const weightCases: readonly [string, number, string][] = [
    ["costWeightBps", -1, "WEIGHT_NEGATIVE"],
    ["capabilityFitWeightBps", 2.5, "WEIGHT_NON_INTEGER"],
    ["latencyWeightBps", -100, "WEIGHT_NEGATIVE"],
  ];
  for (const [field, value, reasonCode] of weightCases) {
    it(`refuses ${field}=${value} with ${reasonCode}`, () => {
      const validation = prepareOptimizationInputs({
        ...baseInputs(),
        goals: { ...baseInputs().goals, [field]: value } as OptimizationInputs["goals"],
      });
      expect(validation).toMatchObject({ ok: false, reasonCode, detail: field });
    });
  }

  it("refuses an all-zero weight sum", () => {
    const validation = prepareOptimizationInputs({
      ...baseInputs(),
      goals: { costWeightBps: 0, capabilityFitWeightBps: 0, latencyWeightBps: 0 },
    });
    expect(validation).toMatchObject({ ok: false, reasonCode: "WEIGHT_SUM_ZERO" });
  });

  it("refuses a weight sum above 10000 bps", () => {
    const validation = prepareOptimizationInputs({
      ...baseInputs(),
      goals: { costWeightBps: 6000, capabilityFitWeightBps: 3000, latencyWeightBps: 1001 },
    });
    expect(validation).toMatchObject({
      ok: false,
      reasonCode: "WEIGHT_SUM_EXCEEDS_TOTAL",
      detail: "10001",
    });
    expect(goalWeightSumBps({ costWeightBps: 6000, capabilityFitWeightBps: 3000, latencyWeightBps: 1001 })).toBe(10001);
  });
});

describe("constraint validation", () => {
  it("refuses negative budget floors", () => {
    const validation = prepareOptimizationInputs({
      ...baseInputs(),
      constraints: {
        ...baseInputs().constraints,
        budgetFloors: [{ capability: "model_invoke", minUnits: -1, minSpendMinor: 0 }],
      },
    });
    expect(validation).toMatchObject({ ok: false, reasonCode: "BUDGET_FLOOR_NEGATIVE" });
  });

  it("refuses non-integer and duplicated floors", () => {
    const nonInteger = prepareOptimizationInputs({
      ...baseInputs(),
      constraints: {
        ...baseInputs().constraints,
        budgetFloors: [{ capability: "model_invoke", minUnits: 1.5, minSpendMinor: 0 }],
      },
    });
    expect(nonInteger).toMatchObject({ ok: false, reasonCode: "BUDGET_FLOOR_NON_INTEGER" });
    const duplicated = prepareOptimizationInputs({
      ...baseInputs(),
      constraints: {
        ...baseInputs().constraints,
        budgetFloors: [
          { capability: "model_invoke", minUnits: 1, minSpendMinor: 0 },
          { capability: "model_invoke", minUnits: 2, minSpendMinor: 0 },
        ],
      },
    });
    expect(duplicated).toMatchObject({ ok: false, reasonCode: "BUDGET_FLOOR_DUPLICATED" });
  });

  it("refuses duplicated revoked capabilities", () => {
    const validation = prepareOptimizationInputs({
      ...baseInputs(),
      constraints: {
        ...baseInputs().constraints,
        revokedCapabilities: ["model_invoke", "model_invoke"],
      },
    });
    expect(validation).toMatchObject({ ok: false, reasonCode: "REVOKED_CAPABILITY_DUPLICATED" });
  });

  it("refuses invalid policy ceilings", () => {
    const belowOne = prepareOptimizationInputs({
      ...baseInputs(),
      constraints: {
        ...baseInputs().constraints,
        policyCeilings: { ...baseInputs().constraints.policyCeilings, maxConcurrentRolesPerAgent: 0 },
      },
    });
    expect(belowOne).toMatchObject({ ok: false, reasonCode: "POLICY_MAX_CONCURRENT_ROLES_BELOW_ONE" });
    const negative = prepareOptimizationInputs({
      ...baseInputs(),
      constraints: {
        ...baseInputs().constraints,
        policyCeilings: { ...baseInputs().constraints.policyCeilings, maxRoleBudgetUnits: -5 },
      },
    });
    expect(negative).toMatchObject({ ok: false, reasonCode: "POLICY_NEGATIVE_CEILING" });
    const nonInteger = prepareOptimizationInputs({
      ...baseInputs(),
      constraints: {
        ...baseInputs().constraints,
        policyCeilings: { ...baseInputs().constraints.policyCeilings, maxAgentsPerTeam: 2.5 },
      },
    });
    expect(nonInteger).toMatchObject({ ok: false, reasonCode: "NON_INTEGER_CEILING" });
  });
});

describe("role + budget record validation", () => {
  it("refuses invalid and duplicated role definitions", () => {
    const invalid = prepareOptimizationInputs({
      ...baseInputs(),
      roles: [
        ...baseInputs().roles,
        { id: "bad", name: "Bad", capabilities: [], responsibilities: [] },
      ],
    });
    expect(invalid).toMatchObject({ ok: false, reasonCode: "ROLE_DEFINITION_INVALID" });
    const duplicated = prepareOptimizationInputs({
      ...baseInputs(),
      roles: [...baseInputs().roles, baseInputs().roles[0] as never],
    });
    expect(duplicated).toMatchObject({ ok: false, reasonCode: "ROLE_ID_DUPLICATED" });
  });

  it("refuses invalid, cross-tenant and duplicated budget records", () => {
    const invalid = prepareOptimizationInputs({
      ...baseInputs(),
      budgets: [
        ...baseInputs().budgets,
        { ...baseInputs().budgets[0], id: "bud-b", consumedUnits: 9999 } as never,
      ],
    });
    expect(invalid).toMatchObject({ ok: false, reasonCode: "BUDGET_RECORD_INVALID" });
    const crossTenant = prepareOptimizationInputs({
      ...baseInputs(),
      budgets: [...baseInputs().budgets, { ...baseInputs().budgets[0], id: "bud-b", tenant: OTHER_TENANT } as never],
    });
    expect(crossTenant).toMatchObject({ ok: false, reasonCode: "BUDGET_TENANT_MISMATCH" });
    const duplicated = prepareOptimizationInputs({
      ...baseInputs(),
      budgets: [...baseInputs().budgets, baseInputs().budgets[0] as never],
    });
    expect(duplicated).toMatchObject({ ok: false, reasonCode: "BUDGET_ID_DUPLICATED" });
  });
});

describe("derived usage facts (real ledger fold)", () => {
  it("computes floored per-capability means and demonstrated capabilities", () => {
    const facts = deriveUsageFacts(buildExcerpt());
    expect(facts.capabilityAverages["model_invoke"]).toEqual({
      entries: 2,
      totalUnits: 300,
      totalSpendMinor: 12000,
      meanUnitsPerEntry: 150,
      meanSpendMinorPerEntry: 6000,
    });
    expect(facts.capabilityAverages["summarize"]?.meanUnitsPerEntry).toBe(50);
    expect(facts.agentDemonstratedCapabilities).toEqual({
      "agent-1": ["model_invoke"],
      "agent-2": ["summarize"],
      "agent-3": ["legacy_scan"],
    });
  });

  it("never mutates the input excerpt", () => {
    const excerpt = buildExcerpt();
    const before = structuredClone(excerpt);
    deriveUsageFacts(excerpt);
    expect(excerpt).toEqual(before);
  });

  it("tenant scope of the problem matches the folded journal tenant", () => {
    const problem = buildProblem();
    expect(problem.tenant).toEqual(TENANT);
    expect(problem.snapshot.tenantId).toBe("acme");
  });
});
