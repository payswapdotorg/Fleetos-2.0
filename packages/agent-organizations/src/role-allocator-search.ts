/**
 * @fleetos/agent-organizations — role-allocation local search (F260C).
 *
 * The fit-repair phase of the role allocator (`role-allocator.ts`):
 * repeatedly reassign a role to a candidate with STRICTLY higher fit,
 * within the concurrent-roles ceiling. Budget-neutral (holder counts are
 * unchanged); the score is recomputed for the new holder — never carried
 * over stale. A pair the greedy pass REFUSED is never swapped in. Pure
 * deterministic TS; PROPOSES, never applies.
 */

import type { OptimizationGoals, OptimizationProblem } from "./optimization-inputs.js";

/** One fit-improving local-search amendment (trace → assignments bridge). */
export interface LocalSearchSwap {
  readonly roleId: string;
  readonly fromAgentId: string;
  readonly toAgentId: string;
  readonly fromFitBps: number;
  readonly toFitBps: number;
}

/**
 * Structural assignment shape (frozen-seam pattern): the allocator's
 * `ProposedAssignment` is assignable to this at the call site — no
 * cross-module type import, no cycle.
 */
export interface SearchableAssignment {
  readonly agentId: string;
  readonly roleId: string;
  readonly fitBps: number;
  readonly costBps: number;
  readonly scoreBps: number;
}

/**
 * Deterministic local search. Terminates: total fit strictly increases
 * (integer bps) with every swap, and fit is bounded above by 10000.
 */
export function localSearch(
  goals: OptimizationGoals,
  weightSum: number,
  assignedByRole: Map<string, SearchableAssignment[]>,
  concurrent: Map<string, number>,
  candidates: readonly string[],
  fitByPair: Map<string, number>,
  ceiling: OptimizationProblem["constraints"]["policyCeilings"],
  refusedPairs: ReadonlySet<string>,
): LocalSearchSwap[] {
  const swaps: LocalSearchSwap[] = [];
  const fit = (agentId: string, roleId: string): number => fitByPair.get(`${agentId}>${roleId}`) ?? 0;
  const score = (agentId: string, roleId: string, costBps: number): number =>
    Math.floor(
      (fit(agentId, roleId) * goals.capabilityFitWeightBps +
        (10000 - costBps) * goals.costWeightBps) /
        weightSum,
    );
  let improved = true;
  while (improved) {
    improved = false;
    const roleIds = [...assignedByRole.keys()].sort(cmpString);
    outer: for (const roleId of roleIds) {
      const holders = assignedByRole.get(roleId) ?? [];
      for (const holder of [...holders].sort((a, b) => cmpString(a.agentId, b.agentId))) {
        for (const candidate of candidates) {
          if (holders.some((h) => h.agentId === candidate)) continue;
          if (refusedPairs.has(`${roleId}>${candidate}`)) continue;
          if ((concurrent.get(candidate) ?? 0) + 1 > ceiling.maxConcurrentRolesPerAgent) continue;
          if (fit(candidate, roleId) <= fit(holder.agentId, roleId)) continue;
          const replacement: SearchableAssignment = {
            ...holder,
            agentId: candidate,
            fitBps: fit(candidate, roleId),
            scoreBps: score(candidate, roleId, holder.costBps),
          };
          assignedByRole.set(roleId, holders.filter((h) => h.agentId !== holder.agentId).concat(replacement));
          concurrent.set(holder.agentId, (concurrent.get(holder.agentId) ?? 0) - 1);
          concurrent.set(candidate, (concurrent.get(candidate) ?? 0) + 1);
          swaps.push({
            roleId,
            fromAgentId: holder.agentId,
            toAgentId: candidate,
            fromFitBps: fit(holder.agentId, roleId),
            toFitBps: fit(candidate, roleId),
          });
          improved = true;
          break outer;
        }
      }
    }
  }
  return swaps;
}

/** Lexicographic comparator — locale-independent, always deterministic. */
function cmpString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
