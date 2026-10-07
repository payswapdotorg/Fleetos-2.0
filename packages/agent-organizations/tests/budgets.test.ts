/**
 * @fleetos/agent-organizations — F230C capability-budget tests: lifecycle,
 * invariants, the gateway seam, digests.
 */
import { describe, expect, it } from "vitest";
import {
  budgetUtilizationBps,
  checkAgentBudget,
  classifyBudget,
  computeBudgetDigest,
  consumeFromBudget,
  replenishBudget,
  validateBudgetRecord,
  type CapabilityBudgetRecord,
  type TenantScope,
} from "../src/index.js";

const TENANT: TenantScope = { tenantId: "acme" };

function baseBudget(overrides: Partial<CapabilityBudgetRecord> = {}): CapabilityBudgetRecord {
  return {
    id: "bud-1",
    tenant: TENANT,
    scope: { kind: "agent", refId: "agent-1" },
    capability: "model_invoke",
    allocatedUnits: 1000,
    allocatedSpendMinor: 50000,
    consumedUnits: 0,
    consumedSpendMinor: 0,
    generation: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Lifecycle classification + record invariants.
// ---------------------------------------------------------------------------

describe("budget lifecycle classification", () => {
  it("classifies an untouched budget as allocated", () => {
    expect(classifyBudget(baseBudget())).toBe("allocated");
  });

  it("classifies partial consumption as consumed", () => {
    expect(classifyBudget(baseBudget({ consumedUnits: 10 }))).toBe("consumed");
    expect(classifyBudget(baseBudget({ consumedSpendMinor: 1 }))).toBe("consumed");
  });

  it("classifies either axis at its ceiling as exhausted (deterministic)", () => {
    expect(classifyBudget(baseBudget({ consumedUnits: 1000 }))).toBe("exhausted");
    expect(classifyBudget(baseBudget({ consumedSpendMinor: 50000 }))).toBe("exhausted");
  });
});

describe("validateBudgetRecord — invariants", () => {
  it("accepts a well-formed budget", () => {
    expect(validateBudgetRecord(baseBudget()).ok).toBe(true);
  });

  it("refuses negative allocation on either axis (budgets are never negative-allocated)", () => {
    expect(validateBudgetRecord(baseBudget({ allocatedUnits: -1 }))).toMatchObject({
      ok: false,
      reasonCode: "NEGATIVE_ALLOCATION_UNITS",
    });
    expect(validateBudgetRecord(baseBudget({ allocatedSpendMinor: -1 }))).toMatchObject({
      ok: false,
      reasonCode: "NEGATIVE_ALLOCATION_SPEND",
    });
  });

  it("refuses consumption exceeding allocation (the core invariant)", () => {
    expect(validateBudgetRecord(baseBudget({ consumedUnits: 1001 }))).toMatchObject({
      ok: false,
      reasonCode: "CONSUMPTION_EXCEEDS_ALLOCATION",
    });
    expect(validateBudgetRecord(baseBudget({ consumedSpendMinor: 50001 }))).toMatchObject({
      ok: false,
      reasonCode: "CONSUMPTION_EXCEEDS_ALLOCATION",
    });
  });

  it("refuses non-integer amounts (integer minor units / units only)", () => {
    expect(validateBudgetRecord(baseBudget({ allocatedUnits: 10.5 }))).toMatchObject({
      ok: false,
      reasonCode: "NON_INTEGER_AMOUNT",
    });
    expect(validateBudgetRecord(baseBudget({ allocatedSpendMinor: 0.5 }))).toMatchObject({
      ok: false,
      reasonCode: "NON_INTEGER_AMOUNT",
    });
  });

  it("refuses negative consumption", () => {
    expect(validateBudgetRecord(baseBudget({ consumedUnits: -1 }))).toMatchObject({
      ok: false,
      reasonCode: "NEGATIVE_CONSUMPTION",
    });
  });
});

// ---------------------------------------------------------------------------
// Consumption — refused with the exact overshoot, never clamped.
// ---------------------------------------------------------------------------

describe("consumeFromBudget", () => {
  it("consumes within the ceiling and reports exact remainders", () => {
    const result = consumeFromBudget(baseBudget(), { units: 400, spendMinor: 15000 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.budget.consumedUnits).toBe(400);
      expect(result.budget.consumedSpendMinor).toBe(15000);
      expect(result.remainingUnits).toBe(600);
      expect(result.remainingSpendMinor).toBe(35000);
    }
  });

  it("consumption exactly to the ceiling succeeds and classifies exhausted", () => {
    const result = consumeFromBudget(baseBudget(), { units: 1000, spendMinor: 50000 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(classifyBudget(result.budget)).toBe("exhausted");
  });

  it("refuses unit overshoot with the exact overshoot (never clamped)", () => {
    const result = consumeFromBudget(baseBudget({ consumedUnits: 900 }), { units: 200, spendMinor: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("BUDGET_EXHAUSTED_UNITS");
      expect(result.overshootUnits).toBe(100);
    }
  });

  it("refuses spend overshoot with the exact overshoot in minor units", () => {
    const result = consumeFromBudget(baseBudget({ consumedSpendMinor: 40000 }), { units: 0, spendMinor: 20000 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("BUDGET_EXHAUSTED_SPEND");
      expect(result.overshootSpendMinor).toBe(10000);
    }
  });

  it("refuses negative and non-integer requests", () => {
    expect(consumeFromBudget(baseBudget(), { units: -1, spendMinor: 0 })).toMatchObject({
      ok: false,
      reasonCode: "NEGATIVE_UNITS",
    });
    expect(consumeFromBudget(baseBudget(), { units: 0, spendMinor: -1 })).toMatchObject({
      ok: false,
      reasonCode: "NEGATIVE_SPEND",
    });
    expect(consumeFromBudget(baseBudget(), { units: 1.5, spendMinor: 0 })).toMatchObject({
      ok: false,
      reasonCode: "NON_INTEGER_AMOUNT",
    });
  });

  it("never mutates the input budget (pure)", () => {
    const budget = baseBudget();
    consumeFromBudget(budget, { units: 100, spendMinor: 100 });
    expect(budget.consumedUnits).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Replenishment — ceiling raise, consumption preserved.
// ---------------------------------------------------------------------------

describe("replenishBudget", () => {
  it("raises the ceiling and bumps the generation while preserving consumption", () => {
    const consumed = baseBudget({ consumedUnits: 700, consumedSpendMinor: 30000 });
    const result = replenishBudget(consumed, { units: 1000, spendMinor: 50000 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.budget.allocatedUnits).toBe(2000);
      expect(result.budget.allocatedSpendMinor).toBe(100000);
      expect(result.budget.consumedUnits).toBe(700);
      expect(result.budget.generation).toBe(2);
      expect(classifyBudget(result.budget)).toBe("consumed");
    }
  });

  it("a replenished exhausted budget becomes consumable again (lifecycle recovers)", () => {
    const exhausted = baseBudget({ consumedUnits: 1000, consumedSpendMinor: 50000 });
    const replenished = replenishBudget(exhausted, { units: 500, spendMinor: 1000 });
    expect(replenished.ok).toBe(true);
    if (replenished.ok) {
      const again = consumeFromBudget(replenished.budget, { units: 10, spendMinor: 10 });
      expect(again.ok).toBe(true);
    }
  });

  it("refuses negative replenishment (never a stealth reset)", () => {
    expect(replenishBudget(baseBudget(), { units: -100, spendMinor: 0 })).toMatchObject({
      ok: false,
      reasonCode: "NEGATIVE_REPLENISHMENT",
    });
    expect(replenishBudget(baseBudget(), { units: 0, spendMinor: -1 })).toMatchObject({
      ok: false,
      reasonCode: "NEGATIVE_REPLENISHMENT",
    });
  });

  it("refuses non-integer replenishment", () => {
    expect(replenishBudget(baseBudget(), { units: 0.5, spendMinor: 0 })).toMatchObject({
      ok: false,
      reasonCode: "NON_INTEGER_AMOUNT",
    });
  });
});

// ---------------------------------------------------------------------------
// The gateway budget-check seam (structural — no runtime cross-import).
// ---------------------------------------------------------------------------

describe("checkAgentBudget — the BudgetCheckPort-compatible seam", () => {
  it("answers ok with exact remainders for an in-ceiling request", () => {
    const records = [baseBudget({ consumedUnits: 100, consumedSpendMinor: 5000 })];
    const decision = checkAgentBudget(records, {
      tenantId: "acme",
      agentId: "agent-1",
      capability: "model_invoke",
      unitsRequested: 300,
      spendRequestedMinor: 10000,
    });
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.remainingUnits).toBe(600);
      expect(decision.remainingSpendMinor).toBe(35000);
    }
  });

  it("refuses unit exhaustion with the exact overshoot", () => {
    const records = [baseBudget({ consumedUnits: 900 })];
    const decision = checkAgentBudget(records, {
      tenantId: "acme",
      agentId: "agent-1",
      capability: "model_invoke",
      unitsRequested: 200,
      spendRequestedMinor: 0,
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.reasonCode).toBe("UNITS_EXHAUSTED");
      expect(decision.overshootUnits).toBe(100);
    }
  });

  it("refuses spend exhaustion with the exact overshoot", () => {
    const records = [baseBudget({ consumedSpendMinor: 45000 })];
    const decision = checkAgentBudget(records, {
      tenantId: "acme",
      agentId: "agent-1",
      capability: "model_invoke",
      unitsRequested: 0,
      spendRequestedMinor: 10000,
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.reasonCode).toBe("SPEND_EXHAUSTED");
      expect(decision.overshootSpendMinor).toBe(5000);
    }
  });

  it("refuses closed when no agent-scoped budget matches (tenant/agent/capability)", () => {
    const records = [baseBudget()];
    expect(
      checkAgentBudget(records, { tenantId: "other", agentId: "agent-1", capability: "model_invoke", unitsRequested: 1, spendRequestedMinor: 1 }),
    ).toMatchObject({ ok: false, reasonCode: "BUDGET_NOT_FOUND" });
    expect(
      checkAgentBudget(records, { tenantId: "acme", agentId: "agent-2", capability: "model_invoke", unitsRequested: 1, spendRequestedMinor: 1 }),
    ).toMatchObject({ ok: false, reasonCode: "BUDGET_NOT_FOUND" });
    expect(
      checkAgentBudget(records, { tenantId: "acme", agentId: "agent-1", capability: "other_cap", unitsRequested: 1, spendRequestedMinor: 1 }),
    ).toMatchObject({ ok: false, reasonCode: "BUDGET_NOT_FOUND" });
  });

  it("refuses closed on ambiguous duplicate budgets — never a silent merge", () => {
    const records = [baseBudget({ id: "bud-a" }), baseBudget({ id: "bud-b" })];
    expect(
      checkAgentBudget(records, { tenantId: "acme", agentId: "agent-1", capability: "model_invoke", unitsRequested: 1, spendRequestedMinor: 1 }),
    ).toMatchObject({ ok: false, reasonCode: "BUDGET_NOT_FOUND" });
  });

  it("refuses negative requests", () => {
    expect(
      checkAgentBudget([baseBudget()], { tenantId: "acme", agentId: "agent-1", capability: "model_invoke", unitsRequested: -1, spendRequestedMinor: 0 }),
    ).toMatchObject({ ok: false, reasonCode: "NEGATIVE_REQUEST" });
  });
});

// ---------------------------------------------------------------------------
// Digest + utilization.
// ---------------------------------------------------------------------------

describe("budget digest + utilization", () => {
  it("the budget digest is deterministic and consumption-sensitive", () => {
    const a = baseBudget();
    const b = baseBudget();
    expect(computeBudgetDigest(a)).toBe(computeBudgetDigest(b));
    expect(computeBudgetDigest(baseBudget({ consumedUnits: 1 }))).not.toBe(computeBudgetDigest(a));
  });

  it("utilization is integer bps, floored", () => {
    expect(budgetUtilizationBps(baseBudget({ consumedUnits: 250, allocatedUnits: 1000 }))).toBe(2500);
    // 1/3 floored:
    expect(budgetUtilizationBps(baseBudget({ consumedUnits: 1, allocatedUnits: 3 }))).toBe(3333);
    expect(budgetUtilizationBps(baseBudget({ consumedUnits: 2, allocatedUnits: 3 }))).toBe(6666);
    expect(budgetUtilizationBps(baseBudget({ allocatedUnits: 0 }))).toBe(0);
  });
});
