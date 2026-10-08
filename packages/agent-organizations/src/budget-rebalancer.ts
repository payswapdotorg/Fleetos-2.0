/**
 * @fleetos/agent-organizations — capability budget rebalancing PROPOSALS
 * (F260C).
 *
 * Detects over/under-utilized capability budgets from the model gateway's
 * REAL usage excerpt (integer-bps utilization bands) and proposes ceiling
 * adjustments bounded by the org's policy ceilings (hard walls) and the
 * constraint set's budget floors. Violations are REFUSED with exact
 * overshoots — never softened, never silently clamped. Revocation-aware:
 * a revoked capability is never granted more.
 *
 * LAW: the rebalancer PROPOSES, never applies (A5/A6) — every output flows
 * to the Guardian/governance path. Pure deterministic TS.
 */

import type { OptimizationProblem } from "./optimization-inputs.js";
import { verifyOptimizationProblemDigest } from "./optimization-inputs.js";
import type { CapabilityBudgetRecord } from "./budgets.js";
import { fnv1a32 } from "./internal-digest.js";

// ---------------------------------------------------------------------------
// Utilization bands — fixed integer-bps vocabulary.
// ---------------------------------------------------------------------------

/** Below this utilization a budget is under-utilized (reclaim candidate). */
export const UNDER_UTILIZED_BELOW_BPS = 2500;
/** At or above this utilization a budget is over-utilized (expand candidate). */
export const OVER_UTILIZED_AT_BPS = 7500;
/** The target utilization every adjustment aims for. */
export const TARGET_UTILIZATION_BPS = 6000;

export type UtilizationBand = "under-utilized" | "healthy" | "over-utilized" | "exhausted";

/** Band classification over an integer-bps utilization value. */
export function classifyBudgetUtilizationBand(utilizationBps: number): UtilizationBand {
  if (utilizationBps >= 10000) return "exhausted";
  if (utilizationBps >= OVER_UTILIZED_AT_BPS) return "over-utilized";
  if (utilizationBps >= UNDER_UTILIZED_BELOW_BPS) return "healthy";
  return "under-utilized";
}

// ---------------------------------------------------------------------------
// Proposal records.
// ---------------------------------------------------------------------------

export interface RebalanceAdjustment {
  readonly budgetId: string;
  readonly capability: string;
  readonly scopeKind: "role" | "agent";
  readonly scopeRefId: string;
  readonly utilizationUnitsBps: number;
  readonly utilizationSpendBps: number;
  readonly band: UtilizationBand;
  readonly currentAllocatedUnits: number;
  readonly currentAllocatedSpendMinor: number;
  readonly targetAllocatedUnits: number;
  readonly targetAllocatedSpendMinor: number;
  readonly deltaUnits: number;
  readonly deltaSpendMinor: number;
  readonly revoked: boolean;
  readonly reasonCode: "over-utilized-expand" | "exhausted-expand" | "under-utilized-reclaim";
  readonly idempotencyKey: string;
}

export interface RebalanceRefusal {
  readonly budgetId: string;
  readonly capability: string;
  readonly axis: "units" | "spend";
  readonly reasonCode:
    | "ROLE_BUDGET_UNITS_CEILING_EXCEEDED"
    | "ROLE_BUDGET_SPEND_CEILING_EXCEEDED"
    | "BUDGET_FLOOR_UNITS"
    | "BUDGET_FLOOR_SPEND"
    | "CONSUMPTION_EXCEEDS_ALLOCATION"
    | "CAPABILITY_REVOKED";
  readonly overshoot: number;
  readonly detail: string | null;
}

export interface BudgetRebalanceProposal {
  readonly kind: "budget-rebalance-proposal";
  readonly note: "proposal-only-guardian-path";
  readonly tenantId: string;
  readonly organizationId: string;
  readonly adjustments: readonly RebalanceAdjustment[];
  readonly refusals: readonly RebalanceRefusal[];
  readonly skipped: readonly { readonly budgetId: string; readonly reason: "healthy-no-change" }[];
  readonly digest: string;
}

export type BudgetRebalanceResult =
  | { readonly ok: true; readonly proposal: BudgetRebalanceProposal }
  | { readonly ok: false; readonly reasonCode: "PROBLEM_DIGEST_MISMATCH" };

// ---------------------------------------------------------------------------
// The rebalancer.
// ---------------------------------------------------------------------------

/**
 * Propose budget ceiling adjustments from the usage excerpt. Deterministic:
 * identical inputs → a byte-identical proposal (including digests and
 * idempotency keys). Ceilings and floors are hard walls — a target that
 * would cross one is REFUSED with the exact overshoot, never softened.
 */
export function rebalanceBudgets(problem: OptimizationProblem): BudgetRebalanceResult {
  if (!verifyOptimizationProblemDigest(problem)) {
    return { ok: false, reasonCode: "PROBLEM_DIGEST_MISMATCH" };
  }
  const ceilings = problem.constraints.policyCeilings;
  const floors = new Map(problem.constraints.budgetFloors.map((f) => [f.capability, f]));
  const revoked = new Set(problem.constraints.revokedCapabilities);

  const adjustments: RebalanceAdjustment[] = [];
  const refusals: RebalanceRefusal[] = [];
  const skipped: { budgetId: string; reason: "healthy-no-change" }[] = [];

  for (const budget of [...problem.budgets].sort((a, b) => cmpString(a.id, b.id))) {
    const usage = scopedExcerptUsage(problem, budget);
    const utilUnits = utilizationBps(usage.units, budget.allocatedUnits);
    const utilSpend = utilizationBps(usage.spendMinor, budget.allocatedSpendMinor);
    const isRevoked = revoked.has(budget.capability);

    const unitsPlan = planAxis({
      used: usage.units,
      allocated: budget.allocatedUnits,
      consumed: budget.consumedUnits,
      ceiling: ceilings.maxRoleBudgetUnits,
      floor: floors.get(budget.capability)?.minUnits ?? 0,
      revoked: isRevoked,
      axis: "units",
      ceilingCode: "ROLE_BUDGET_UNITS_CEILING_EXCEEDED",
      floorCode: "BUDGET_FLOOR_UNITS",
    });
    const spendPlan = planAxis({
      used: usage.spendMinor,
      allocated: budget.allocatedSpendMinor,
      consumed: budget.consumedSpendMinor,
      ceiling: ceilings.maxRoleBudgetSpendMinor,
      floor: floors.get(budget.capability)?.minSpendMinor ?? 0,
      revoked: isRevoked,
      axis: "spend",
      ceilingCode: "ROLE_BUDGET_SPEND_CEILING_EXCEEDED",
      floorCode: "BUDGET_FLOOR_SPEND",
    });

    for (const refusal of [...unitsPlan.refusals, ...spendPlan.refusals]) {
      refusals.push({ budgetId: budget.id, capability: budget.capability, ...refusal });
    }
    // Atomic per budget: ANY axis refusal means NO adjustment at all for
    // this budget (the lane's batch-atomicity discipline).
    if (unitsPlan.refusals.length > 0 || spendPlan.refusals.length > 0) {
      continue;
    }
    const targetUnits = unitsPlan.target ?? budget.allocatedUnits;
    const targetSpend = spendPlan.target ?? budget.allocatedSpendMinor;
    const deltaUnits = targetUnits - budget.allocatedUnits;
    const deltaSpend = targetSpend - budget.allocatedSpendMinor;
    if (deltaUnits === 0 && deltaSpend === 0) {
      skipped.push({ budgetId: budget.id, reason: "healthy-no-change" });
      continue;
    }
    const band = classifyBudgetUtilizationBand(Math.max(utilUnits, utilSpend));
    const reasonCode: RebalanceAdjustment["reasonCode"] =
      band === "exhausted" ? "exhausted-expand" : band === "over-utilized" ? "over-utilized-expand" : "under-utilized-reclaim";
    const adjustment: RebalanceAdjustment = {
      budgetId: budget.id,
      capability: budget.capability,
      scopeKind: budget.scope.kind,
      scopeRefId: budget.scope.refId,
      utilizationUnitsBps: utilUnits,
      utilizationSpendBps: utilSpend,
      band,
      currentAllocatedUnits: budget.allocatedUnits,
      currentAllocatedSpendMinor: budget.allocatedSpendMinor,
      targetAllocatedUnits: targetUnits,
      targetAllocatedSpendMinor: targetSpend,
      deltaUnits,
      deltaSpendMinor: deltaSpend,
      revoked: isRevoked,
      reasonCode,
      idempotencyKey: "",
    };
    adjustments.push({
      ...adjustment,
      idempotencyKey: `rebal_${fnv1a32([
        problem.tenant.tenantId,
        problem.organizationId,
        budget.id,
        budget.generation,
        budget.allocatedUnits,
        budget.allocatedSpendMinor,
        targetUnits,
        targetSpend,
        reasonCode,
      ])}`,
    });
  }

  const proposalBase = {
    kind: "budget-rebalance-proposal" as const,
    note: "proposal-only-guardian-path" as const,
    tenantId: problem.tenant.tenantId,
    organizationId: problem.organizationId,
    adjustments,
    refusals: refusals.sort((a, b) => cmpString(a.budgetId, b.budgetId)),
    skipped,
  };
  return {
    ok: true,
    proposal: { ...proposalBase, digest: computeRebalanceDigest(problem, proposalBase) },
  };
}

// ---------------------------------------------------------------------------
// Per-axis planning. Hard walls: violations refuse, never soften.
// ---------------------------------------------------------------------------

interface AxisPlan {
  readonly target: number | null;
  readonly refusals: readonly Omit<RebalanceRefusal, "budgetId" | "capability">[];
}

function planAxis(input: {
  readonly used: number;
  readonly allocated: number;
  readonly consumed: number;
  readonly ceiling: number;
  readonly floor: number;
  readonly revoked: boolean;
  readonly axis: "units" | "spend";
  readonly ceilingCode: "ROLE_BUDGET_UNITS_CEILING_EXCEEDED" | "ROLE_BUDGET_SPEND_CEILING_EXCEEDED";
  readonly floorCode: "BUDGET_FLOOR_UNITS" | "BUDGET_FLOOR_SPEND";
}): AxisPlan {
  const util = utilizationBps(input.used, input.allocated);
  const band = classifyBudgetUtilizationBand(util);
  if (band === "healthy") return { target: null, refusals: [] };
  // Ideal target: the allocation that would put utilization at the target band.
  const ideal = ceilDiv(input.used * 10000, TARGET_UTILIZATION_BPS);
  const delta = ideal - input.allocated;
  if (delta === 0) return { target: null, refusals: [] };
  if (delta > 0) {
    if (input.revoked) {
      return {
        target: null,
        refusals: [{ axis: input.axis, reasonCode: "CAPABILITY_REVOKED", overshoot: delta, detail: "revoked-capability-never-granted-more" }],
      };
    }
    if (ideal > input.ceiling) {
      return {
        target: null,
        refusals: [{ axis: input.axis, reasonCode: input.ceilingCode, overshoot: ideal - input.ceiling, detail: `ideal-${ideal}-ceiling-${input.ceiling}` }],
      };
    }
    return { target: ideal, refusals: [] };
  }
  // delta < 0 — reclaim. Floors and live consumption are hard walls.
  if (ideal < input.consumed) {
    return {
      target: null,
      refusals: [{ axis: input.axis, reasonCode: "CONSUMPTION_EXCEEDS_ALLOCATION", overshoot: input.consumed - ideal, detail: `ideal-${ideal}-consumed-${input.consumed}` }],
    };
  }
  if (ideal < input.floor) {
    return {
      target: null,
      refusals: [{ axis: input.axis, reasonCode: input.floorCode, overshoot: input.floor - ideal, detail: `ideal-${ideal}-floor-${input.floor}` }],
    };
  }
  return { target: ideal, refusals: [] };
}

// ---------------------------------------------------------------------------
// Deterministic helpers.
// ---------------------------------------------------------------------------

/**
 * Usage attributable to one budget from the excerpt: agent-scoped budgets
 * match (agentId, capability); role-scoped budgets match the capability
 * org-wide (the excerpt carries no role attribution).
 */
function scopedExcerptUsage(
  problem: OptimizationProblem,
  budget: CapabilityBudgetRecord,
): { units: number; spendMinor: number } {
  let units = 0;
  let spendMinor = 0;
  for (const entry of problem.usageExcerpt) {
    const agentMatch = budget.scope.kind === "agent" && entry.agentId === budget.scope.refId;
    if (agentMatch || budget.scope.kind === "role") {
      if (entry.capability === budget.capability) {
        units += entry.units;
        spendMinor += entry.costMinor;
      }
    }
  }
  return { units, spendMinor };
}

/** Integer-bps utilization, floored; 10000 when used > 0 and allocated is 0. */
function utilizationBps(used: number, allocated: number): number {
  if (allocated === 0) return used > 0 ? 10000 : 0;
  return Math.floor((used * 10000) / allocated);
}

/** Integer division rounded up — exact, no floats. */
function ceilDiv(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.floor((numerator + denominator - 1) / denominator);
}

function cmpString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function computeRebalanceDigest(
  problem: OptimizationProblem,
  proposal: Omit<BudgetRebalanceProposal, "digest">,
): string {
  return `rebalp_${fnv1a32([
    problem.digest,
    proposal.adjustments
      .map((a) => `${a.budgetId}:${a.targetAllocatedUnits}/${a.targetAllocatedSpendMinor}#${a.idempotencyKey}`)
      .join(";"),
    proposal.refusals
      .map((r) => `${r.budgetId}:${r.axis}:${r.reasonCode}+${r.overshoot}`)
      .join(";"),
    proposal.skipped.map((s) => s.budgetId).join(","),
  ])}`;
}
