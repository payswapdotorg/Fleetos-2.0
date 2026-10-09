/**
 * @fleetos/acceptance-release — cost controls over the REAL usage ledgers.
 *
 * Wave 8 TL lane (F281). Three deterministic controls over REAL F280C
 * production-economics outputs (public entry points only):
 *
 *   1. **Budget ceilings** — a ceiling is either caller-declared or DERIVED
 *      from a REAL `CostAllocationResult` (`allocateCostAcrossWorkOrders`
 *      → `totalAllocatedMinorUnits`, @fleetos/procurement F280C 3.3 — the
 *      exact-sum allocation total is the budget the work-order dimension
 *      was actually allocated). Enforcement compares the REAL usage
 *      actuals (`BurnActuals` — the usage ledger's own sums with entry-seq
 *      refs, produced by `projectBudgetBurn`, @fleetos/model-gateway F280C
 *      3.3) against the ceiling: OVER-CEILING IS A REFUSAL carrying the
 *      REAL numbers (ceiling, actual, over-by) — never silent, never
 *      clamped. `remainingMinor` is NEGATIVE when over — honest.
 *   2. **Burn-rate rollups** — sums and counts over the REAL
 *      `BudgetBurnProjection` outputs (`projectBudgetBurn`, F280C 3.3).
 *      Every rollup number is a Σ or count of REAL projection fields
 *      (documented per field); nothing is re-projected or recomputed.
 *   3. **Cost posture view** — presents the REAL projections VERBATIM BY
 *      REFERENCE (never recomputed, never copied — machine-tested with
 *      reference identity), alongside the enforcement checks and the
 *      rollup, with a tamper-evident digest.
 *
 * HONESTY LAW (F281): every number equals a REAL package output field, a
 * Σ/count of REAL output fields, or is a recorded refusal.
 *
 * Tenant law (A8, fail-closed): the posture is tenant-scoped; every
 * projection (REAL `tenantId` field) and every check must match the view
 * tenant or the WHOLE posture refuses naming the offender.
 *
 * Health law (documented): `ceiling-breached` iff any enforcement check is
 * over-ceiling OR any REAL projection severity is "breach"; else `warning`
 * iff any REAL projection severity is "warning"; else `within-budget`.
 * Warnings do NOT breach (a warning is under-ceiling by the projection's
 * own documented severity law).
 *
 * Pure deterministic TS: no clock, no randomness, no network, no timers.
 */

import type { BurnActuals, BudgetBurnProjection } from "@fleetos/model-gateway";
import type { CostAllocationResult } from "@fleetos/procurement";
import { digestOf } from "./digest.js";

export const COST_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Budget ceilings — provenance is part of the record.
// ---------------------------------------------------------------------------

export type CeilingSource = "caller-declared" | "cost-allocation";

export interface BudgetCeiling {
  /** Integer minor units. */
  readonly ceilingMinor: number;
  /** Where the ceiling number came from — recorded, never implied. */
  readonly source: CeilingSource;
  /** The REAL output field / record the number traces to (cost-allocation source), or a caller ref. */
  readonly sourceRef: string | null;
}

export type CeilingDerivationResult =
  | { readonly ok: true; readonly ceiling: BudgetCeiling }
  | {
    readonly ok: false;
    readonly reasonCode: "ALLOCATION_REFUSED";
    /** The REAL procurement refusal reason code, verbatim. */
    readonly allocationReasonCode: string;
  };

/**
 * Derive a budget ceiling from a REAL cost-allocation output: the
 * allocation's `totalAllocatedMinorUnits` (the exact-sum total the order's
 * cost was allocated across work orders — F280C 3.3). A REFUSED allocation
 * refuses the derivation with the REAL procurement reason code verbatim —
 * a ceiling is never invented from a failed allocation.
 */
export function deriveCeilingFromAllocation(
  allocation: CostAllocationResult,
  sourceRef?: string,
): CeilingDerivationResult {
  if (!allocation.ok) {
    return { ok: false, reasonCode: "ALLOCATION_REFUSED", allocationReasonCode: allocation.reasonCode };
  }
  return {
    ok: true,
    ceiling: {
      ceilingMinor: allocation.totalAllocatedMinorUnits,
      source: "cost-allocation",
      sourceRef: sourceRef ?? "CostAllocationResult.totalAllocatedMinorUnits",
    },
  };
}

// ---------------------------------------------------------------------------
// Enforcement — over-ceiling is a REFUSAL with the REAL numbers.
// ---------------------------------------------------------------------------

export type CeilingEnforcementReasonCode =
  | "TENANT_ID_EMPTY"
  | "CEILING_NON_INTEGER"
  | "CEILING_NEGATIVE"
  | "AMOUNT_NON_INTEGER"
  | "AMOUNT_NEGATIVE"
  | "OVER_CEILING";

export interface CeilingCheck {
  readonly tenantId: string;
  readonly status: "within-ceiling" | "over-ceiling";
  /** The REAL usage-ledger actual cost (BurnActuals.totalCostMinor). */
  readonly actualCostMinor: number;
  /** The REAL usage-ledger actual units (BurnActuals.totalUnits). */
  readonly actualUnits: number;
  /** Count of REAL ledger entry seqs backing the actuals (BurnActuals.entrySeqs.length). */
  readonly actualEntrySeqCount: number;
  readonly ceiling: BudgetCeiling;
  /** ceiling − actual: NEGATIVE when over — never clamped. */
  readonly remainingMinor: number;
  /** 0 within ceiling; actual − ceiling when over. */
  readonly overByMinor: number;
}

export type CeilingEnforcementResult =
  | { readonly ok: true; readonly check: CeilingCheck }
  | { readonly ok: false; readonly reasonCode: Exclude<CeilingEnforcementReasonCode, "OVER_CEILING"> }
  | { readonly ok: false; readonly reasonCode: "OVER_CEILING"; readonly check: CeilingCheck };

/**
 * Deterministic budget-ceiling enforcement: the REAL usage actuals against
 * the ceiling. Over-ceiling (actual > ceiling) REFUSES with the full check
 * record — the REAL numbers (ceiling, actual, over-by) travel with the
 * refusal; nothing is silently clamped or dropped. Boundary: actual ==
 * ceiling is WITHIN (the last minor unit is spendable — tested).
 */
export function enforceBudgetCeiling(input: {
  readonly tenantId: string;
  /** REAL output: `projectBudgetBurn(...).projection.actuals` (@fleetos/model-gateway). */
  readonly actuals: BurnActuals;
  readonly ceiling: BudgetCeiling;
}): CeilingEnforcementResult {
  if (input.tenantId === "") return { ok: false, reasonCode: "TENANT_ID_EMPTY" };
  const ceilingMinor = input.ceiling.ceilingMinor;
  if (!Number.isInteger(ceilingMinor)) {
    return { ok: false, reasonCode: "CEILING_NON_INTEGER" };
  }
  if (ceilingMinor < 0) return { ok: false, reasonCode: "CEILING_NEGATIVE" };
  const actualCostMinor = input.actuals.totalCostMinor;
  if (!Number.isInteger(actualCostMinor)) {
    return { ok: false, reasonCode: "AMOUNT_NON_INTEGER" };
  }
  if (actualCostMinor < 0) return { ok: false, reasonCode: "AMOUNT_NEGATIVE" };
  const check: CeilingCheck = {
    tenantId: input.tenantId,
    status: actualCostMinor > ceilingMinor ? "over-ceiling" : "within-ceiling",
    actualCostMinor,
    actualUnits: input.actuals.totalUnits,
    actualEntrySeqCount: input.actuals.entrySeqs.length,
    ceiling: input.ceiling,
    remainingMinor: ceilingMinor - actualCostMinor,
    overByMinor: actualCostMinor > ceilingMinor ? actualCostMinor - ceilingMinor : 0,
  };
  if (check.status === "over-ceiling") {
    return { ok: false, reasonCode: "OVER_CEILING", check };
  }
  return { ok: true, check };
}

// ---------------------------------------------------------------------------
// Burn-rate rollups — Σ and counts over REAL projection fields.
// ---------------------------------------------------------------------------

export interface BurnRollup {
  /** Count of REAL projections rolled up. */
  readonly budgetCount: number;
  /** Σ REAL actuals.totalCostMinor. */
  readonly totalActualCostMinor: number;
  /** Σ REAL actuals.totalUnits. */
  readonly totalActualUnits: number;
  /** Σ REAL projectedTotalCostMinor. */
  readonly totalProjectedCostMinor: number;
  /** Σ REAL projectedTotalUnits. */
  readonly totalProjectedUnits: number;
  /** Σ REAL projectedRemainingMinor — may be negative, never clamped. */
  readonly totalProjectedRemainingMinor: number;
  /** Count of REAL severity === "breach". */
  readonly breachCount: number;
  /** Count of REAL severity === "warning". */
  readonly warningCount: number;
  /** Worst REAL severity present (none < warning < breach). */
  readonly worstSeverity: "none" | "warning" | "breach";
  /** Σ REAL assumptions.length. */
  readonly assumptionCount: number;
}

export type BurnRollupResult =
  | { readonly ok: true; readonly rollup: BurnRollup }
  | {
    readonly ok: false;
    readonly reasonCode: "TENANT_ID_EMPTY" | "NO_BUDGETS" | "BUDGET_TENANT_MISMATCH";
    readonly offenderIndex: number | null;
  };

/**
 * Deterministic burn-rate rollup over REAL budget-burn projections. Every
 * number is a Σ or count of REAL projection fields (documented on the
 * type); the projections are never re-run. Fail-closed: a projection whose
 * REAL tenantId does not match refuses the rollup naming the offender.
 */
export function rollUpBudgetBurns(
  tenantId: string,
  budgets: readonly BudgetBurnProjection[],
): BurnRollupResult {
  if (tenantId === "") return { ok: false, reasonCode: "TENANT_ID_EMPTY", offenderIndex: null };
  if (budgets.length === 0) return { ok: false, reasonCode: "NO_BUDGETS", offenderIndex: null };
  for (let i = 0; i < budgets.length; i += 1) {
    if (budgets[i]!.tenantId !== tenantId) {
      return { ok: false, reasonCode: "BUDGET_TENANT_MISMATCH", offenderIndex: i };
    }
  }
  let totalActualCostMinor = 0;
  let totalActualUnits = 0;
  let totalProjectedCostMinor = 0;
  let totalProjectedUnits = 0;
  let totalProjectedRemainingMinor = 0;
  let breachCount = 0;
  let warningCount = 0;
  let assumptionCount = 0;
  for (const budget of budgets) {
    totalActualCostMinor += budget.actuals.totalCostMinor;
    totalActualUnits += budget.actuals.totalUnits;
    totalProjectedCostMinor += budget.projectedTotalCostMinor;
    totalProjectedUnits += budget.projectedTotalUnits;
    totalProjectedRemainingMinor += budget.projectedRemainingMinor;
    if (budget.severity === "breach") breachCount += 1;
    if (budget.severity === "warning") warningCount += 1;
    assumptionCount += budget.assumptions.length;
  }
  const worstSeverity: BurnRollup["worstSeverity"] =
    breachCount > 0 ? "breach" : warningCount > 0 ? "warning" : "none";
  return {
    ok: true,
    rollup: {
      budgetCount: budgets.length,
      totalActualCostMinor,
      totalActualUnits,
      totalProjectedCostMinor,
      totalProjectedUnits,
      totalProjectedRemainingMinor,
      breachCount,
      warningCount,
      worstSeverity,
      assumptionCount,
    },
  };
}

// ---------------------------------------------------------------------------
// Cost posture — the verbatim-by-reference view.
// ---------------------------------------------------------------------------

export type CostPostureHealth = "within-budget" | "warning" | "ceiling-breached";

export interface CostPosture {
  readonly schemaVersion: typeof COST_SCHEMA_VERSION;
  readonly tenantId: string;
  /** The REAL projections, VERBATIM BY REFERENCE — never recomputed or copied. */
  readonly budgets: readonly BudgetBurnProjection[];
  /** The enforcement checks (deterministic records over REAL actuals). */
  readonly checks: readonly CeilingCheck[];
  /** The burn-rate rollup (Σ/counts over the projections above). */
  readonly rollup: BurnRollup;
  readonly health: CostPostureHealth;
  readonly costDigest: string;
}

export type CostPostureResult =
  | { readonly ok: true; readonly posture: CostPosture }
  | {
    readonly ok: false;
    readonly reasonCode:
      | "TENANT_ID_EMPTY"
      | "NO_BUDGETS"
      | "NO_CHECKS"
      | "BUDGET_TENANT_MISMATCH"
      | "CHECK_TENANT_MISMATCH";
    readonly offenderIndex: number | null;
  };

function costDigestOf(posture: Omit<CostPosture, "costDigest">): string {
  return digestOf("cost-posture", posture as unknown as object);
}

/**
 * Build the tenant-scoped cost posture view. The REAL projections are
 * presented VERBATIM BY REFERENCE — the posture never recomputes a
 * projection number (machine-tested with reference identity). Fail-closed:
 * empty tenant, no budgets, no checks, or a foreign-tenant budget/check
 * (REAL tenantId field / check tenant) refuses naming the offender.
 */
export function buildCostPosture(input: {
  readonly tenantId: string;
  readonly budgets: readonly BudgetBurnProjection[];
  readonly checks: readonly CeilingCheck[];
}): CostPostureResult {
  if (input.tenantId === "") return { ok: false, reasonCode: "TENANT_ID_EMPTY", offenderIndex: null };
  if (input.budgets.length === 0) return { ok: false, reasonCode: "NO_BUDGETS", offenderIndex: null };
  if (input.checks.length === 0) return { ok: false, reasonCode: "NO_CHECKS", offenderIndex: null };
  for (let i = 0; i < input.budgets.length; i += 1) {
    if (input.budgets[i]!.tenantId !== input.tenantId) {
      return { ok: false, reasonCode: "BUDGET_TENANT_MISMATCH", offenderIndex: i };
    }
  }
  for (let i = 0; i < input.checks.length; i += 1) {
    if (input.checks[i]!.tenantId !== input.tenantId) {
      return { ok: false, reasonCode: "CHECK_TENANT_MISMATCH", offenderIndex: i };
    }
  }
  const rollup = rollUpBudgetBurns(input.tenantId, input.budgets);
  if (!rollup.ok) {
    return {
      ok: false,
      reasonCode: "BUDGET_TENANT_MISMATCH",
      offenderIndex: rollup.offenderIndex,
    };
  }
  const ceilingBreached =
    input.checks.some((c) => c.status === "over-ceiling") ||
    input.budgets.some((b) => b.severity === "breach");
  const health: CostPostureHealth = ceilingBreached
    ? "ceiling-breached"
    : input.budgets.some((b) => b.severity === "warning")
      ? "warning"
      : "within-budget";
  const base: Omit<CostPosture, "costDigest"> = {
    schemaVersion: COST_SCHEMA_VERSION,
    tenantId: input.tenantId,
    budgets: input.budgets,
    checks: input.checks,
    rollup: rollup.rollup,
    health,
  };
  return { ok: true, posture: { ...base, costDigest: costDigestOf(base) } };
}

/** Recompute the posture digest — false means the presented view was tampered. */
export function verifyCostPosture(posture: CostPosture): boolean {
  const { costDigest, ...rest } = posture;
  return costDigestOf(rest) === costDigest;
}
