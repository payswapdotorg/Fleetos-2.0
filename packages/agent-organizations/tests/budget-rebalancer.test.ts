/**
 * @fleetos/agent-organizations — F260C budget-rebalancer tests: utilization
 * bands, bounded proposals, hard-wall refusals with exact overshoots,
 * revocation awareness, idempotency keys, determinism.
 */
import { describe, expect, it } from "vitest";
import {
  classifyBudgetUtilizationBand,
  rebalanceBudgets,
  type CapabilityBudgetRecord,
} from "../src/index.js";
import { buildProblem } from "./optimize-fixtures.js";

function agentBudget(overrides: Partial<CapabilityBudgetRecord>): CapabilityBudgetRecord {
  return {
    id: "bud-x",
    tenant: { tenantId: "acme" },
    scope: { kind: "agent", refId: "agent-3" },
    capability: "legacy_scan",
    allocatedUnits: 1000,
    allocatedSpendMinor: 50000,
    consumedUnits: 0,
    consumedSpendMinor: 0,
    generation: 1,
    ...overrides,
  } as CapabilityBudgetRecord;
}

describe("utilization bands (integer bps)", () => {
  it("classifies the fixed band boundaries", () => {
    expect(classifyBudgetUtilizationBand(0)).toBe("under-utilized");
    expect(classifyBudgetUtilizationBand(2499)).toBe("under-utilized");
    expect(classifyBudgetUtilizationBand(2500)).toBe("healthy");
    expect(classifyBudgetUtilizationBand(7499)).toBe("healthy");
    expect(classifyBudgetUtilizationBand(7500)).toBe("over-utilized");
    expect(classifyBudgetUtilizationBand(9999)).toBe("over-utilized");
    expect(classifyBudgetUtilizationBand(10000)).toBe("exhausted");
  });
});

describe("rebalancer — in-bounds proposals", () => {
  it("expands an over-utilized budget toward the 6000 bps target band", () => {
    // Role-scoped model_invoke usage across the excerpt: 300 units / 12000.
    const problem = buildProblem({
      budgets: [
        {
          id: "bud-over",
          tenant: { tenantId: "acme" },
          scope: { kind: "role", refId: "role-ops" },
          capability: "model_invoke",
          allocatedUnits: 350,
          allocatedSpendMinor: 14000,
          consumedUnits: 0,
          consumedSpendMinor: 0,
          generation: 1,
        },
      ],
    });
    const result = rebalanceBudgets(problem);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const adjustment = result.proposal.adjustments[0];
    // utilization 8571 bps on both axes → target ceil(300*10000/6000)=500 units.
    expect(adjustment).toMatchObject({
      budgetId: "bud-over",
      utilizationUnitsBps: 8571,
      utilizationSpendBps: 8571,
      band: "over-utilized",
      reasonCode: "over-utilized-expand",
      targetAllocatedUnits: 500,
      targetAllocatedSpendMinor: 20000,
      deltaUnits: 150,
      deltaSpendMinor: 6000,
      revoked: false,
    });
    expect(adjustment?.idempotencyKey).toMatch(/^rebal_[0-9a-f]{8}$/);
    expect(result.proposal.refusals).toEqual([]);
    expect(result.proposal.kind).toBe("budget-rebalance-proposal");
    expect(result.proposal.note).toBe("proposal-only-guardian-path");
    expect(result.proposal.digest).toMatch(/^rebalp_[0-9a-f]{8}$/);
  });

  it("expands an exhausted budget with the exhausted-expand reason", () => {
    const problem = buildProblem({
      budgets: [
        {
          id: "bud-ex",
          tenant: { tenantId: "acme" },
          scope: { kind: "role", refId: "role-ops" },
          capability: "model_invoke",
          allocatedUnits: 300,
          allocatedSpendMinor: 12000,
          consumedUnits: 0,
          consumedSpendMinor: 0,
          generation: 1,
        },
      ],
    });
    const result = rebalanceBudgets(problem);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.adjustments[0]).toMatchObject({
      band: "exhausted",
      reasonCode: "exhausted-expand",
      deltaUnits: 200,
    });
  });

  it("reclaims an under-utilized budget toward the 6000 bps target band", () => {
    // agent-3 legacy_scan usage: 10 units / 500 spend; allocated 1000/50000.
    const problem = buildProblem({ budgets: [agentBudget({})] });
    const result = rebalanceBudgets(problem);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.adjustments[0]).toMatchObject({
      budgetId: "bud-x",
      band: "under-utilized",
      reasonCode: "under-utilized-reclaim",
      targetAllocatedUnits: 17, // ceil(10 * 10000 / 6000).
      targetAllocatedSpendMinor: 834, // ceil(500 * 10000 / 6000).
      deltaUnits: -983,
      deltaSpendMinor: -49166,
    });
  });

  it("skips healthy budgets with an honest no-change record", () => {
    // agent-1 model_invoke usage 300/12000 vs allocated 600/24000 → 5000 bps.
    const result = rebalanceBudgets(buildProblem());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.adjustments).toEqual([]);
    expect(result.proposal.skipped).toEqual([{ budgetId: "bud-a", reason: "healthy-no-change" }]);
  });
});

describe("rebalancer — hard walls (refused with exact overshoots, never softened)", () => {
  it("refuses an expansion that would cross the policy UNITS ceiling", () => {
    // Target 500 units > ceiling 400 → refusal with the exact overshoot.
    const problem = buildProblem({
      budgets: [
        agentBudget({
          scope: { kind: "agent", refId: "agent-1" },
          capability: "model_invoke",
          allocatedUnits: 300,
          allocatedSpendMinor: 12000,
        }),
      ],
      constraints: {
        policyCeilings: {
          maxConcurrentRolesPerAgent: 2,
          maxRoleBudgetUnits: 400,
          maxRoleBudgetSpendMinor: 50000,
          maxAgentsPerTeam: 5,
        },
        budgetFloors: [],
        revokedCapabilities: [],
      },
    });
    const result = rebalanceBudgets(problem);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.adjustments).toEqual([]);
    expect(result.proposal.refusals).toEqual([
      {
        budgetId: "bud-x",
        capability: "model_invoke",
        axis: "units",
        reasonCode: "ROLE_BUDGET_UNITS_CEILING_EXCEEDED",
        overshoot: 100,
        detail: "ideal-500-ceiling-400",
      },
    ]);
  });

  it("refuses an expansion that would cross the policy SPEND ceiling", () => {
    const problem = buildProblem({
      budgets: [
        agentBudget({
          scope: { kind: "agent", refId: "agent-1" },
          capability: "model_invoke",
          allocatedUnits: 300,
          allocatedSpendMinor: 12000,
        }),
      ],
      constraints: {
        policyCeilings: {
          maxConcurrentRolesPerAgent: 2,
          maxRoleBudgetUnits: 1000,
          maxRoleBudgetSpendMinor: 15000,
          maxAgentsPerTeam: 5,
        },
        budgetFloors: [],
        revokedCapabilities: [],
      },
    });
    const result = rebalanceBudgets(problem);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.refusals[0]).toMatchObject({
      axis: "spend",
      reasonCode: "ROLE_BUDGET_SPEND_CEILING_EXCEEDED",
      overshoot: 5000, // ideal 20000 − ceiling 15000.
    });
  });

  it("refuses a reclaim that would cross a budget floor", () => {
    const problem = buildProblem({
      budgets: [agentBudget({})],
      constraints: {
        policyCeilings: {
          maxConcurrentRolesPerAgent: 2,
          maxRoleBudgetUnits: 1000,
          maxRoleBudgetSpendMinor: 50000,
          maxAgentsPerTeam: 5,
        },
        budgetFloors: [{ capability: "legacy_scan", minUnits: 500, minSpendMinor: 1000 }],
        revokedCapabilities: [],
      },
    });
    const result = rebalanceBudgets(problem);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.adjustments).toEqual([]);
    expect(result.proposal.refusals).toEqual([
      {
        budgetId: "bud-x",
        capability: "legacy_scan",
        axis: "units",
        reasonCode: "BUDGET_FLOOR_UNITS",
        overshoot: 483, // floor 500 − ideal 17.
        detail: "ideal-17-floor-500",
      },
      {
        budgetId: "bud-x",
        capability: "legacy_scan",
        axis: "spend",
        reasonCode: "BUDGET_FLOOR_SPEND",
        overshoot: 166, // floor 1000 − ideal 834.
        detail: "ideal-834-floor-1000",
      },
    ]);
  });

  it("refuses a reclaim that would allocate below live consumption", () => {
    // consumed 900 > ideal 17 → consumption is a hard wall, never a reset.
    const problem = buildProblem({
      budgets: [agentBudget({ consumedUnits: 900, consumedSpendMinor: 0 })],
    });
    const result = rebalanceBudgets(problem);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.refusals[0]).toMatchObject({
      axis: "units",
      reasonCode: "CONSUMPTION_EXCEEDS_ALLOCATION",
      overshoot: 883,
    });
  });
});

describe("rebalancer — revocation awareness", () => {
  it("never grants more to a revoked capability", () => {
    const problem = buildProblem({
      budgets: [
        agentBudget({
          scope: { kind: "agent", refId: "agent-1" },
          capability: "model_invoke",
          allocatedUnits: 300,
          allocatedSpendMinor: 12000,
        }),
      ],
      constraints: {
        policyCeilings: {
          maxConcurrentRolesPerAgent: 2,
          maxRoleBudgetUnits: 1000,
          maxRoleBudgetSpendMinor: 50000,
          maxAgentsPerTeam: 5,
        },
        budgetFloors: [],
        revokedCapabilities: ["model_invoke"],
      },
    });
    const result = rebalanceBudgets(problem);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.adjustments).toEqual([]);
    expect(result.proposal.refusals).toEqual([
      {
        budgetId: "bud-x",
        capability: "model_invoke",
        axis: "units",
        reasonCode: "CAPABILITY_REVOKED",
        overshoot: 200,
        detail: "revoked-capability-never-granted-more",
      },
      {
        budgetId: "bud-x",
        capability: "model_invoke",
        axis: "spend",
        reasonCode: "CAPABILITY_REVOKED",
        overshoot: 8000,
        detail: "revoked-capability-never-granted-more",
      },
    ]);
  });

  it("still allows reclaiming a revoked capability (marked revoked)", () => {
    const problem = buildProblem({
      budgets: [agentBudget({})],
      constraints: {
        policyCeilings: {
          maxConcurrentRolesPerAgent: 2,
          maxRoleBudgetUnits: 1000,
          maxRoleBudgetSpendMinor: 50000,
          maxAgentsPerTeam: 5,
        },
        budgetFloors: [],
        revokedCapabilities: ["legacy_scan"],
      },
    });
    const result = rebalanceBudgets(problem);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.adjustments[0]).toMatchObject({
      reasonCode: "under-utilized-reclaim",
      deltaUnits: -983,
      revoked: true,
    });
  });
});

describe("rebalancer — idempotency + determinism", () => {
  it("is deterministic — identical inputs → byte-identical proposals + keys", () => {
    const problem = buildProblem({
      budgets: [
        agentBudget({
          scope: { kind: "agent", refId: "agent-1" },
          capability: "model_invoke",
          allocatedUnits: 300,
          allocatedSpendMinor: 12000,
        }),
      ],
    });
    const a = rebalanceBudgets(problem);
    const b = rebalanceBudgets(problem);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.ok && b.ok && a.proposal.adjustments[0]?.idempotencyKey).toBe(
      a.ok && b.ok && b.proposal.adjustments[0]?.idempotencyKey,
    );
  });

  it("keys are sensitive to the proposal content", () => {
    const base = {
      scope: { kind: "agent" as const, refId: "agent-1" },
      capability: "model_invoke" as const,
      allocatedUnits: 300,
      allocatedSpendMinor: 12000,
    };
    const first = rebalanceBudgets(buildProblem({ budgets: [agentBudget({ ...base, generation: 1 })] }));
    const second = rebalanceBudgets(buildProblem({ budgets: [agentBudget({ ...base, generation: 2 })] }));
    const keyA = first.ok ? first.proposal.adjustments[0]?.idempotencyKey : null;
    const keyB = second.ok ? second.proposal.adjustments[0]?.idempotencyKey : null;
    expect(keyA).toMatch(/^rebal_/);
    expect(keyB).toMatch(/^rebal_/);
    expect(keyA).not.toBe(keyB);
  });

  it("refuses a tampered problem (digest mismatch)", () => {
    const problem = buildProblem();
    const tampered = { ...problem, constraints: { ...problem.constraints, revokedCapabilities: ["x"] } };
    expect(rebalanceBudgets(tampered)).toMatchObject({
      ok: false,
      reasonCode: "PROBLEM_DIGEST_MISMATCH",
    });
  });
});
