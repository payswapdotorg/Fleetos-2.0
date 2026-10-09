/**
 * Cost controls: ceiling enforcement (over-ceiling = refusal with REAL
 * numbers), allocation-derived ceilings, burn-rate rollups over REAL
 * projections, the verbatim-by-reference posture view, tenant fail-closed,
 * digest + tamper, determinism.
 */

import { describe, expect, it } from "vitest";
import {
  buildCostPosture,
  deriveCeilingFromAllocation,
  enforceBudgetCeiling,
  rollUpBudgetBurns,
  verifyCostPosture,
  type CeilingCheck,
  type CostPosture,
} from "../src/cost.js";
import { byteIdentical } from "../src/digest.js";
import {
  TENANT,
  actualsOf,
  allocationOk,
  allocationRefused,
  breachBurnProjection,
  buildUsageLedger,
  healthyBurnProjection,
  overCeilingCheck,
  warningBurnProjection,
  withinCeilingCheck,
} from "./fixtures.js";

describe("cost — budget-ceiling enforcement (over-ceiling = refusal, never silent)", () => {
  it("within ceiling: ok with honest remaining and zero over-by", () => {
    const projection = healthyBurnProjection(TENANT);
    const result = enforceBudgetCeiling({
      tenantId: TENANT,
      actuals: projection.actuals,
      ceiling: { ceilingMinor: 10_000, source: "caller-declared", sourceRef: "fixture" },
    });
    if (!result.ok) throw new Error(`refused: ${result.reasonCode}`);
    expect(result.check.status).toBe("within-ceiling");
    expect(result.check.actualCostMinor).toBe(800);
    expect(result.check.remainingMinor).toBe(9_200);
    expect(result.check.overByMinor).toBe(0);
  });

  it("boundary: actual == ceiling is WITHIN (the last minor unit is spendable)", () => {
    const result = enforceBudgetCeiling({
      tenantId: TENANT,
      actuals: { totalUnits: 1, totalCostMinor: 10_000, entrySeqs: [1], source: "usage-ledger" },
      ceiling: { ceilingMinor: 10_000, source: "caller-declared", sourceRef: null },
    });
    if (!result.ok) throw new Error(`refused: ${result.reasonCode}`);
    expect(result.check.status).toBe("within-ceiling");
    expect(result.check.remainingMinor).toBe(0);
  });

  it("over ceiling REFUSES with the REAL numbers (over-by, negative remaining, entry seqs)", () => {
    const check = overCeilingCheck(TENANT);
    expect(check.status).toBe("over-ceiling");
    expect(check.actualCostMinor).toBe(10_000);
    expect(check.ceiling.ceilingMinor).toBe(9_000);
    expect(check.overByMinor).toBe(1_000);
    expect(check.remainingMinor).toBe(-1_000);
    expect(check.actualEntrySeqCount).toBe(1);
    expect(check.actualUnits).toBe(5);
  });

  it("the enforcement refusal form carries reasonCode OVER_CEILING + the check record", () => {
    const projection = healthyBurnProjection(TENANT);
    const result = enforceBudgetCeiling({
      tenantId: TENANT,
      actuals: { ...projection.actuals, totalCostMinor: 1_001 },
      ceiling: { ceilingMinor: 1_000, source: "caller-declared", sourceRef: null },
    });
    expect(result.ok).toBe(false);
    if (!result.ok && result.reasonCode === "OVER_CEILING") {
      expect(result.check.overByMinor).toBe(1);
    } else {
      throw new Error("expected OVER_CEILING refusal");
    }
  });

  it("empty tenant refuses TENANT_ID_EMPTY", () => {
    const projection = healthyBurnProjection(TENANT);
    const result = enforceBudgetCeiling({
      tenantId: "",
      actuals: projection.actuals,
      ceiling: { ceilingMinor: 10_000, source: "caller-declared", sourceRef: null },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe("TENANT_ID_EMPTY");
  });

  it("negative / non-integer ceilings and amounts refuse with their codes", () => {
    const actuals = actualsOf(healthyBurnProjection(TENANT));
    const negative = enforceBudgetCeiling({
      tenantId: TENANT,
      actuals,
      ceiling: { ceilingMinor: -1, source: "caller-declared", sourceRef: null },
    });
    const fractional = enforceBudgetCeiling({
      tenantId: TENANT,
      actuals,
      ceiling: { ceilingMinor: 10.5, source: "caller-declared", sourceRef: null },
    });
    const negativeAmount = enforceBudgetCeiling({
      tenantId: TENANT,
      actuals: { ...actuals, totalCostMinor: -5 },
      ceiling: { ceilingMinor: 10_000, source: "caller-declared", sourceRef: null },
    });
    expect(negative.ok).toBe(false);
    if (!negative.ok) expect(negative.reasonCode).toBe("CEILING_NEGATIVE");
    expect(fractional.ok).toBe(false);
    if (!fractional.ok) expect(fractional.reasonCode).toBe("CEILING_NON_INTEGER");
    expect(negativeAmount.ok).toBe(false);
    if (!negativeAmount.ok) expect(negativeAmount.reasonCode).toBe("AMOUNT_NEGATIVE");
  });
});

describe("cost — ceilings derived from the REAL F280C allocation outputs", () => {
  it("derives the ceiling from the allocation's exact-sum total (REAL number)", () => {
    const allocation = allocationOk(TENANT, 9_000);
    if (!allocation.ok) throw new Error("allocation refused");
    expect(allocation.totalAllocatedMinorUnits).toBe(9_000);
    const derived = deriveCeilingFromAllocation(allocation);
    if (!derived.ok) throw new Error("derivation refused");
    expect(derived.ceiling.ceilingMinor).toBe(9_000);
    expect(derived.ceiling.source).toBe("cost-allocation");
    expect(derived.ceiling.sourceRef).toContain("totalAllocatedMinorUnits");
  });

  it("a REFUSED allocation refuses the derivation with the REAL procurement code verbatim", () => {
    const refused = allocationRefused(TENANT);
    const derived = deriveCeilingFromAllocation(refused);
    expect(derived.ok).toBe(false);
    if (!derived.ok) {
      expect(derived.reasonCode).toBe("ALLOCATION_REFUSED");
      expect(derived.allocationReasonCode).toBe("SHARES_MUST_SUM_TO_10000");
    }
  });

  it("the REAL allocation law: Σ allocations == total EXACTLY (awkward thirds)", () => {
    const allocation = allocationOk(TENANT, 10_001);
    if (!allocation.ok) throw new Error("allocation refused");
    const sum = allocation.allocations.reduce((acc, a) => acc + a.amountMinorUnits, 0);
    expect(sum).toBe(10_001);
    expect(allocation.law).toBe("largest-remainder-bps-tie-break-work-order-id-lexical");
  });
});

describe("cost — burn-rate rollups over REAL projections", () => {
  it("every rollup number is the Σ/count of REAL projection fields (exact)", () => {
    const a = healthyBurnProjection(TENANT); // actual 1000 + projected 200
    const b = warningBurnProjection(TENANT); // actual 5000 + projected 4000
    const result = rollUpBudgetBurns(TENANT, [a, b]);
    if (!result.ok) throw new Error("rollup refused");
    expect(result.rollup.budgetCount).toBe(2);
    expect(result.rollup.totalActualCostMinor).toBe(a.actuals.totalCostMinor + b.actuals.totalCostMinor);
    expect(result.rollup.totalActualUnits).toBe(a.actuals.totalUnits + b.actuals.totalUnits);
    expect(result.rollup.totalProjectedCostMinor).toBe(
      a.projectedTotalCostMinor + b.projectedTotalCostMinor,
    );
    expect(result.rollup.totalProjectedRemainingMinor).toBe(
      a.projectedRemainingMinor + b.projectedRemainingMinor,
    );
    expect(result.rollup.warningCount).toBe(1);
    expect(result.rollup.breachCount).toBe(0);
    expect(result.rollup.worstSeverity).toBe("warning");
    expect(result.rollup.assumptionCount).toBe(2);
  });

  it("worst severity escalates to breach when a REAL projection severity is breach", () => {
    const result = rollUpBudgetBurns(TENANT, [healthyBurnProjection(TENANT), breachBurnProjection(TENANT)]);
    if (!result.ok) throw new Error("rollup refused");
    expect(result.rollup.worstSeverity).toBe("breach");
    expect(result.rollup.breachCount).toBe(1);
  });

  it("a foreign-tenant projection refuses BUDGET_TENANT_MISMATCH naming the offender index", () => {
    const foreign = healthyBurnProjection("tnt_other-firm");
    const result = rollUpBudgetBurns(TENANT, [healthyBurnProjection(TENANT), foreign]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("BUDGET_TENANT_MISMATCH");
      expect(result.offenderIndex).toBe(1);
    }
  });

  it("empty tenant / zero budgets refuse", () => {
    const emptyTenant = rollUpBudgetBurns("", [healthyBurnProjection(TENANT)]);
    const noBudgets = rollUpBudgetBurns(TENANT, []);
    expect(emptyTenant.ok).toBe(false);
    if (!emptyTenant.ok) expect(emptyTenant.reasonCode).toBe("TENANT_ID_EMPTY");
    expect(noBudgets.ok).toBe(false);
    if (!noBudgets.ok) expect(noBudgets.reasonCode).toBe("NO_BUDGETS");
  });
});

describe("cost — the posture view (verbatim by reference, never recomputed)", () => {
  it("presents the REAL projections BY REFERENCE (identity, not copies)", () => {
    const budgets = [healthyBurnProjection(TENANT), warningBurnProjection(TENANT)];
    const checks = [withinCeilingCheck(TENANT)];
    const result = buildCostPosture({ tenantId: TENANT, budgets, checks });
    if (!result.ok) throw new Error(`posture refused: ${result.reasonCode}`);
    expect(result.posture.budgets[0]).toBe(budgets[0]);
    expect(result.posture.budgets[1]).toBe(budgets[1]);
    expect(result.posture.budgets.length).toBe(2);
  });

  it("health transitions: within → warning → ceiling-breached", () => {
    const within = buildCostPosture({
      tenantId: TENANT,
      budgets: [healthyBurnProjection(TENANT)],
      checks: [withinCeilingCheck(TENANT)],
    });
    const warning = buildCostPosture({
      tenantId: TENANT,
      budgets: [warningBurnProjection(TENANT)],
      checks: [withinCeilingCheck(TENANT)],
    });
    const breachedByProjection = buildCostPosture({
      tenantId: TENANT,
      budgets: [breachBurnProjection(TENANT)],
      checks: [withinCeilingCheck(TENANT)],
    });
    const breachedByCheck = buildCostPosture({
      tenantId: TENANT,
      budgets: [healthyBurnProjection(TENANT)],
      checks: [overCeilingCheck(TENANT)],
    });
    if (!within.ok || !warning.ok || !breachedByProjection.ok || !breachedByCheck.ok) {
      throw new Error("posture refused");
    }
    expect(within.posture.health).toBe("within-budget");
    expect(warning.posture.health).toBe("warning");
    expect(breachedByProjection.posture.health).toBe("ceiling-breached");
    expect(breachedByCheck.posture.health).toBe("ceiling-breached");
  });

  it("the posture carries the rollup of its own budgets (Σ REAL fields)", () => {
    const budgets = [healthyBurnProjection(TENANT), breachBurnProjection(TENANT)];
    const result = buildCostPosture({ tenantId: TENANT, budgets, checks: [withinCeilingCheck(TENANT)] });
    if (!result.ok) throw new Error("posture refused");
    expect(result.posture.rollup.totalActualCostMinor).toBe(
      budgets[0]!.actuals.totalCostMinor + budgets[1]!.actuals.totalCostMinor,
    );
    expect(result.posture.rollup.breachCount).toBe(1);
  });

  it("fail-closed: empty tenant, no budgets, no checks, foreign budget, foreign check", () => {
    const emptyTenant = buildCostPosture({ tenantId: "", budgets: [healthyBurnProjection(TENANT)], checks: [withinCeilingCheck(TENANT)] });
    const noBudgets = buildCostPosture({ tenantId: TENANT, budgets: [], checks: [withinCeilingCheck(TENANT)] });
    const noChecks = buildCostPosture({ tenantId: TENANT, budgets: [healthyBurnProjection(TENANT)], checks: [] });
    const foreignBudget = buildCostPosture({
      tenantId: TENANT,
      budgets: [healthyBurnProjection("tnt_other-firm")],
      checks: [withinCeilingCheck(TENANT)],
    });
    const foreignCheck: CeilingCheck = { ...withinCeilingCheck(TENANT), tenantId: "tnt_other-firm" };
    const foreignCheckResult = buildCostPosture({
      tenantId: TENANT,
      budgets: [healthyBurnProjection(TENANT)],
      checks: [foreignCheck],
    });
    expect(emptyTenant.ok).toBe(false);
    if (!emptyTenant.ok) expect(emptyTenant.reasonCode).toBe("TENANT_ID_EMPTY");
    expect(noBudgets.ok).toBe(false);
    if (!noBudgets.ok) expect(noBudgets.reasonCode).toBe("NO_BUDGETS");
    expect(noChecks.ok).toBe(false);
    if (!noChecks.ok) expect(noChecks.reasonCode).toBe("NO_CHECKS");
    expect(foreignBudget.ok).toBe(false);
    if (!foreignBudget.ok) {
      expect(foreignBudget.reasonCode).toBe("BUDGET_TENANT_MISMATCH");
      expect(foreignBudget.offenderIndex).toBe(0);
    }
    expect(foreignCheckResult.ok).toBe(false);
    if (!foreignCheckResult.ok) {
      expect(foreignCheckResult.reasonCode).toBe("CHECK_TENANT_MISMATCH");
      expect(foreignCheckResult.offenderIndex).toBe(0);
    }
  });

  it("verifyCostPosture detects a tampered posture (digest recompute)", () => {
    const result = buildCostPosture({
      tenantId: TENANT,
      budgets: [healthyBurnProjection(TENANT)],
      checks: [withinCeilingCheck(TENANT)],
    });
    if (!result.ok) throw new Error("posture refused");
    expect(verifyCostPosture(result.posture)).toBe(true);
    const tampered: CostPosture = {
      ...result.posture,
      health: "within-budget",
    };
    // health is already within-budget; tamper a REAL number instead
    const tampered2: CostPosture = {
      ...result.posture,
      rollup: { ...result.posture.rollup, totalActualCostMinor: 99 },
    };
    const originalHealth = result.posture.health;
    expect(originalHealth).toBe("within-budget");
    expect(tampered.health).toBe(originalHealth); // same value — not a real tamper
    expect(verifyCostPosture(tampered2)).toBe(false);
  });

  it("tampering a referenced REAL budget record is detected (the digest covers the content)", () => {
    const budgets = [healthyBurnProjection(TENANT)];
    const result = buildCostPosture({ tenantId: TENANT, budgets, checks: [withinCeilingCheck(TENANT)] });
    if (!result.ok) throw new Error("posture refused");
    // Mutate the referenced budget AFTER assembly (post-hoc tamper).
    const mutated = budgets[0]!;
    (mutated as { projectedTotalCostMinor: number }).projectedTotalCostMinor = 123_456;
    expect(verifyCostPosture(result.posture)).toBe(false);
  });

  it("byte-identical re-runs (determinism law)", () => {
    const budgets = [healthyBurnProjection(TENANT), warningBurnProjection(TENANT)];
    const a = buildCostPosture({ tenantId: TENANT, budgets, checks: [withinCeilingCheck(TENANT)] });
    const b = buildCostPosture({ tenantId: TENANT, budgets, checks: [withinCeilingCheck(TENANT)] });
    if (!a.ok || !b.ok) throw new Error("posture refused");
    expect(byteIdentical(a.posture, b.posture)).toBe(true);
  });
});

describe("cost — REAL usage-ledger provenance", () => {
  it("the burn actuals trace to REAL ledger entry seqs (traceable to source)", () => {
    const ledger = buildUsageLedger(TENANT, [
      { units: 5, costMinor: 500 },
      { units: 3, costMinor: 300 },
    ]);
    const projection = healthyBurnProjection(TENANT);
    expect(projection.actuals.source).toBe("usage-ledger");
    expect(projection.actuals.entrySeqs).toEqual(ledger.map((e) => e.seq));
    expect(projection.actuals.totalCostMinor).toBe(800);
    expect(projection.actuals.totalUnits).toBe(8);
    expect(projection.projection).toBe(true);
  });
});
