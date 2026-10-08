/**
 * @fleetos/agent-organizations — role allocation optimization (F260C).
 *
 * Deterministic greedy + local-search assignment of agents to roles over
 * the REAL role/capability allow-lists, maximizing capability-fit under
 * the org's policy CEILINGS (hard walls — violations are REFUSED with
 * exact overshoots, never softened) and the FIXED integer-bps goal
 * weights. Two deterministic phases:
 *   1. GREEDY — every (candidate agent × demanded role) pair scored by
 *      the weighted formula, processed in (score desc, agentId, roleId)
 *      order. With `capabilityFitWeightBps` = 0 the greedy is
 *      deliberately FIT-BLIND — the case the local search repairs.
 *   2. LOCAL SEARCH — reassign roles to STRICTLY higher-fit candidates
 *      within the concurrent-roles ceiling (budget-neutral: holder
 *      counts are unchanged; scores are recomputed).
 *
 * Audit trail: `scoringTrace` records the GREEDY pass; `localSearchSwaps`
 * records every amendment — together they reconcile exactly to
 * `assignments`. A pair the greedy REFUSED is never swapped in later, so
 * the refusals list can never contradict the assignments.
 *
 * LAW: the allocator PROPOSES, never applies — every output flows to the
 * Guardian/governance path (A5/A6). Pure deterministic TS.
 */

import type { OptimizationGoals, OptimizationProblem } from "./optimization-inputs.js";
import {
  deriveUsageFacts,
  goalWeightSumBps,
  verifyOptimizationProblemDigest,
} from "./optimization-inputs.js";
import { localSearch, type LocalSearchSwap } from "./role-allocator-search.js";
import { fnv1a32 } from "./internal-digest.js";

export type { LocalSearchSwap };

export interface RoleDemand {
  readonly roleId: string;
  readonly holders: number;
}

export interface ProposedAssignment {
  readonly agentId: string;
  readonly roleId: string;
  /** Capability-fit of the agent for the role, integer bps (floored). */
  readonly fitBps: number;
  /** Projected budget consumption attributable to this holder (role-level). */
  readonly projectedUnits: number;
  readonly projectedSpendMinor: number;
  /** Cost as integer bps of the per-role spend ceiling. */
  readonly costBps: number;
  /** Weighted goal score, integer bps. */
  readonly scoreBps: number;
}

export interface AssignmentRefusal {
  readonly agentId: string;
  readonly roleId: string;
  readonly reasonCode:
    | "MAX_CONCURRENT_ROLES_EXCEEDED"
    | "ROLE_BUDGET_UNITS_CEILING_EXCEEDED"
    | "ROLE_BUDGET_SPEND_CEILING_EXCEEDED";
  readonly overshoot: number;
}

export interface PairScoreTraceEntry {
  readonly agentId: string;
  readonly roleId: string;
  readonly fitBps: number;
  readonly projectedUnits: number;
  readonly projectedSpendMinor: number;
  readonly scoreBps: number;
  readonly outcome: "assigned" | "refused" | "not-selected";
  readonly reasonCode: string | null;
  readonly overshoot: number | null;
}

export interface RoleDemandShortfall {
  readonly roleId: string;
  readonly requestedHolders: number;
  readonly assignedHolders: number;
  readonly shortfall: number;
}

export interface RoleAllocationProposal {
  readonly kind: "role-allocation-proposal";
  readonly note: "proposal-only-guardian-path";
  readonly tenantId: string;
  readonly organizationId: string;
  readonly assignments: readonly ProposedAssignment[];
  readonly refusals: readonly AssignmentRefusal[];
  readonly unfilledDemand: readonly RoleDemandShortfall[];
  readonly scoringTrace: readonly PairScoreTraceEntry[];
  readonly localSearchSwaps: readonly LocalSearchSwap[];
  readonly excludedAgents: readonly { readonly agentId: string; readonly reasonCode: "AGENT_REMOVED" }[];
  readonly totals: {
    readonly assignedCount: number;
    readonly totalFitBps: number;
    readonly totalProjectedUnits: number;
    readonly totalProjectedSpendMinor: number;
  };
  readonly digest: string;
}

export type RoleAllocationResult =
  | { readonly ok: true; readonly proposal: RoleAllocationProposal }
  | {
      readonly ok: false;
      readonly reasonCode:
        | "PROBLEM_DIGEST_MISMATCH"
        | "ROLE_DEMAND_DUPLICATED"
        | "UNKNOWN_ROLE"
        | "NEGATIVE_AMOUNT"
        | "NON_INTEGER_AMOUNT";
      readonly detail: string | null;
    };

/**
 * Assign agents to roles. Deterministic: identical inputs → a byte-identical
 * proposal (including digest). Constraint walls are REFUSED with exact
 * overshoots — never softened. The result is a PROPOSAL for the
 * Guardian/governance path; nothing is applied to any org state.
 */
export function allocateRoles(
  problem: OptimizationProblem,
  demand: readonly RoleDemand[],
): RoleAllocationResult {
  if (!verifyOptimizationProblemDigest(problem)) {
    return { ok: false, reasonCode: "PROBLEM_DIGEST_MISMATCH", detail: null };
  }
  const seen = new Set<string>();
  for (const d of demand) {
    const bad = !Number.isInteger(d.holders)
      ? "NON_INTEGER_AMOUNT"
      : d.holders < 0
        ? "NEGATIVE_AMOUNT"
        : seen.has(d.roleId)
          ? "ROLE_DEMAND_DUPLICATED"
          : problem.roles.some((r) => r.id === d.roleId)
            ? null
            : "UNKNOWN_ROLE";
    if (bad) return { ok: false, reasonCode: bad, detail: d.roleId };
    seen.add(d.roleId);
  }

  const facts = deriveUsageFacts(problem.usageExcerpt);
  const ceiling = problem.constraints.policyCeilings;
  const weightSum = goalWeightSumBps(problem.goals);

  // Candidates: enrolled agents that were NOT removed (fail-closed), sorted.
  const removed = new Set(problem.snapshot.removedAgents);
  const candidates = problem.snapshot.enrolledAgents
    .filter((a) => !removed.has(a))
    .sort(cmpString);
  const excludedAgents = [...removed]
    .sort(cmpString)
    .map((agentId) => ({ agentId, reasonCode: "AGENT_REMOVED" as const }));

  // Per-role projections + per-pair fits (deterministic, role-level cost).
  const projectionByRole = new Map<string, { units: number; spend: number }>();
  const fitByPair = new Map<string, number>();
  for (const role of problem.roles) {
    let units = 0;
    let spend = 0;
    for (const capability of role.capabilities) {
      const avg = facts.capabilityAverages[capability];
      units += avg?.meanUnitsPerEntry ?? 0;
      spend += avg?.meanSpendMinorPerEntry ?? 0;
    }
    projectionByRole.set(role.id, { units, spend });
    for (const agentId of candidates) {
      const demonstrated = facts.agentDemonstratedCapabilities[agentId] ?? [];
      const covered = role.capabilities.filter((c) => demonstrated.includes(c)).length;
      fitByPair.set(
        `${agentId}>${role.id}`,
        Math.floor((covered * 10000) / role.capabilities.length),
      );
    }
  }

  const concurrent = new Map<string, number>(
    candidates.map((a) => [a, problem.snapshot.concurrentRolesByAgent[a] ?? 0]),
  );
  const remaining = new Map(demand.map((d) => [d.roleId, d.holders]));
  const assignedByRole = new Map<string, ProposedAssignment[]>();
  const trace: PairScoreTraceEntry[] = [];
  const refusals: AssignmentRefusal[] = [];
  const refusedPairs = new Set<string>();

  const pairScore = (agentId: string, roleId: string): number => {
    const fitBps = fitByPair.get(`${agentId}>${roleId}`) ?? 0;
    const projection = projectionByRole.get(roleId) ?? { units: 0, spend: 0 };
    const costBps = spendCeilingBps(ceiling.maxRoleBudgetSpendMinor, projection.spend);
    return weightedScoreBps(fitBps, costBps, problem.goals, weightSum);
  };

  // Greedy pass — every (candidate agent × demanded role) pair, once, in
  // (score desc, agentId, roleId) order. Fit is deliberately NOT a
  // tie-break: the local search below is the fit-repair phase, so the
  // greedy must be able to be fit-blind when the weights make the score
  // fit-independent.
  const pairs = demand.flatMap((d) =>
    candidates.map((agentId) => ({
      agentId,
      roleId: d.roleId,
      scoreBps: pairScore(agentId, d.roleId),
      fitBps: fitByPair.get(`${agentId}>${d.roleId}`) ?? 0,
    })),
  );
  pairs.sort(
    (a, b) =>
      b.scoreBps - a.scoreBps ||
      cmpString(a.agentId, b.agentId) ||
      cmpString(a.roleId, b.roleId),
  );

  for (const pair of pairs) {
    const projection = projectionByRole.get(pair.roleId) ?? { units: 0, spend: 0 };
    const base = {
      agentId: pair.agentId,
      roleId: pair.roleId,
      fitBps: pair.fitBps,
      projectedUnits: projection.units,
      projectedSpendMinor: projection.spend,
      scoreBps: pair.scoreBps,
    };
    const traceEntry = (
      outcome: PairScoreTraceEntry["outcome"],
      reasonCode: string | null,
      overshoot: number | null,
    ): PairScoreTraceEntry => ({ ...base, outcome, reasonCode, overshoot });
    const refuse = (reasonCode: AssignmentRefusal["reasonCode"], overshoot: number): void => {
      refusals.push({ agentId: pair.agentId, roleId: pair.roleId, reasonCode, overshoot });
      refusedPairs.add(`${pair.roleId}>${pair.agentId}`);
      trace.push(traceEntry("refused", reasonCode, overshoot));
    };
    if ((remaining.get(pair.roleId) ?? 0) <= 0) {
      trace.push(traceEntry("not-selected", "ROLE_DEMAND_SATISFIED", null));
      continue;
    }
    const holderCount = (assignedByRole.get(pair.roleId) ?? []).length;
    const nextUnits = (holderCount + 1) * projection.units;
    if (nextUnits > ceiling.maxRoleBudgetUnits) {
      refuse("ROLE_BUDGET_UNITS_CEILING_EXCEEDED", nextUnits - ceiling.maxRoleBudgetUnits);
      continue;
    }
    const nextSpend = (holderCount + 1) * projection.spend;
    if (nextSpend > ceiling.maxRoleBudgetSpendMinor) {
      refuse("ROLE_BUDGET_SPEND_CEILING_EXCEEDED", nextSpend - ceiling.maxRoleBudgetSpendMinor);
      continue;
    }
    if ((concurrent.get(pair.agentId) ?? 0) + 1 > ceiling.maxConcurrentRolesPerAgent) {
      refuse("MAX_CONCURRENT_ROLES_EXCEEDED", 1);
      continue;
    }
    const assignment: ProposedAssignment = {
      ...base,
      costBps: spendCeilingBps(ceiling.maxRoleBudgetSpendMinor, projection.spend),
    };
    assignedByRole.set(pair.roleId, [...(assignedByRole.get(pair.roleId) ?? []), assignment]);
    remaining.set(pair.roleId, (remaining.get(pair.roleId) ?? 0) - 1);
    concurrent.set(pair.agentId, (concurrent.get(pair.agentId) ?? 0) + 1);
    trace.push(traceEntry("assigned", null, null));
  }

  const localSearchSwaps = localSearch(
    problem.goals,
    weightSum,
    assignedByRole,
    concurrent,
    candidates,
    fitByPair,
    ceiling,
    refusedPairs,
  );

  const assignments = [...assignedByRole.values()]
    .flat()
    .sort((a, b) => cmpString(a.roleId, b.roleId) || cmpString(a.agentId, b.agentId));
  const unfilledDemand: RoleDemandShortfall[] = demand
    .map((d) => ({
      roleId: d.roleId,
      requestedHolders: d.holders,
      assignedHolders: (assignedByRole.get(d.roleId) ?? []).length,
      shortfall: Math.max(0, d.holders - (assignedByRole.get(d.roleId) ?? []).length),
    }))
    .filter((u) => u.shortfall > 0)
    .sort((a, b) => cmpString(a.roleId, b.roleId));

  const proposalBase = {
    kind: "role-allocation-proposal" as const,
    note: "proposal-only-guardian-path" as const,
    tenantId: problem.tenant.tenantId,
    organizationId: problem.organizationId,
    assignments,
    refusals: refusals.sort((a, b) => cmpString(a.roleId, b.roleId) || cmpString(a.agentId, b.agentId)),
    unfilledDemand,
    scoringTrace: trace,
    localSearchSwaps,
    excludedAgents,
    totals: {
      assignedCount: assignments.length,
      totalFitBps: assignments.reduce((sum, a) => sum + a.fitBps, 0),
      totalProjectedUnits: assignments.reduce((sum, a) => sum + a.projectedUnits, 0),
      totalProjectedSpendMinor: assignments.reduce((sum, a) => sum + a.projectedSpendMinor, 0),
    },
  };
  return {
    ok: true,
    proposal: { ...proposalBase, digest: computeRoleAllocationDigest(problem, proposalBase) },
  };
}

function computeRoleAllocationDigest(
  problem: OptimizationProblem,
  proposal: Omit<RoleAllocationProposal, "digest">,
): string {
  return `roalloc_${fnv1a32([
    problem.digest,
    proposal.assignments
      .map((a) => `${a.agentId}>${a.roleId}:${a.fitBps}/${a.projectedUnits}/${a.projectedSpendMinor}/${a.scoreBps}`)
      .join(";"),
    proposal.refusals.map((r) => `${r.agentId}>${r.roleId}:${r.reasonCode}+${r.overshoot}`).join(";"),
    proposal.unfilledDemand.map((u) => `${u.roleId}:${u.shortfall}`).join(";"),
    proposal.localSearchSwaps
      .map((s) => `${s.roleId}:${s.fromAgentId}>${s.toAgentId}:${s.fromFitBps}/${s.toFitBps}`)
      .join(";"),
    proposal.totals.assignedCount,
    proposal.totals.totalFitBps,
  ])}`;
}

/** Lexicographic comparator — locale-independent, always deterministic. */
function cmpString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Cost as integer bps of the spend ceiling; 10000 (saturated) when the ceiling is 0 but the cost is not. */
function spendCeilingBps(ceilingSpendMinor: number, projectedSpendMinor: number): number {
  if (ceilingSpendMinor === 0) return projectedSpendMinor === 0 ? 0 : 10000;
  return Math.floor((projectedSpendMinor * 10000) / ceilingSpendMinor);
}

/** Weighted goal score in integer bps (floored) — the ONLY score formula. */
function weightedScoreBps(
  fitBps: number,
  costBps: number,
  goals: OptimizationGoals,
  weightSum: number,
): number {
  return Math.floor(
    (fitBps * goals.capabilityFitWeightBps + (10000 - costBps) * goals.costWeightBps) / weightSum,
  );
}
