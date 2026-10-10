/**
 * @fleetos/acceptance-commerce — resilience step drivers (F310C, Wave 11
 * lane C).
 *
 * Interprets typed journey steps against the REAL public entry points of
 * @fleetos/model-gateway (provider fallback ladders + degraded-mode
 * classification) and @fleetos/agent-organizations (capability-budget
 * rebalance PROPOSALS over the REAL optimization problem prepared by the
 * org driver — the same problem surface the optimization-review journey
 * uses).
 *
 * `org-budgets-seed` REPLACES the world's agent budgets with journey data
 * (deterministic; the budget port + prepare + rebalance then run over the
 * seeded records) so a journey can drive over-utilized / exhausted /
 * revoked / healthy budget bands through the REAL laws.
 *
 * Facts are namespaced per `factKey`; refusals are honest facts.
 */

import type { FactValue, ResilienceStep } from "./journey-contracts.js";
import type { JourneyState } from "./journey-world.js";
import { resolveFallbackLadder, classifyDegradedMode, validateProviderRecords } from "@fleetos/model-gateway";
import { rebalanceBudgets, classifyBudgetUtilizationBand } from "@fleetos/agent-organizations";
import type { CapabilityBudgetRecord } from "@fleetos/agent-organizations";
import type { TenantScope as OrgTenantScope } from "@fleetos/agent-organizations";

export type DriverFacts = Record<string, FactValue>;

export async function runResilienceStep(step: ResilienceStep, state: JourneyState): Promise<DriverFacts> {
  switch (step.kind) {
    case "gw-fallback-ladder": {
      const providers = step.providers.map((p) => ({
        id: p.id,
        declaredModels: [...p.declaredModels],
        health: p.health,
      }));
      const validation = validateProviderRecords(providers);
      if (!validation.ok) {
        return {
          [`gw.ladder.${step.factKey}.ok`]: false,
          [`gw.ladder.${step.factKey}.reasonCode`]: validation.reasonCode,
        };
      }
      const result = resolveFallbackLadder(providers, step.chainOrder, step.modelId);
      return {
        [`gw.ladder.${step.factKey}.ok`]: result.ok,
        [`gw.ladder.${step.factKey}.selectedProviderId`]: result.selectedProviderId,
        [`gw.ladder.${step.factKey}.reasonCode`]: result.reasonCode,
        [`gw.ladder.${step.factKey}.hopReasons`]: result.hops.map((h) => `${h.rank}:${h.providerId}:${h.reasonCode}`),
        [`gw.ladder.${step.factKey}.hopCount`]: result.hops.length,
        [`gw.ladder.${step.factKey}.digest`]: result.digest,
      };
    }
    case "gw-degraded-mode": {
      const providers = step.providers.map((p) => ({
        id: p.id,
        declaredModels: [...p.declaredModels],
        health: p.health,
      }));
      const result = classifyDegradedMode(providers);
      return {
        [`gw.degraded.${step.factKey}.mode`]: result.mode,
        [`gw.degraded.${step.factKey}.healthyProviders`]: result.healthyProviders,
        [`gw.degraded.${step.factKey}.degradedProviders`]: result.degradedProviders,
        [`gw.degraded.${step.factKey}.downProviders`]: result.downProviders,
        [`gw.degraded.${step.factKey}.servingProviders`]: result.servingProviders,
        [`gw.degraded.${step.factKey}.digest`]: result.digest,
      };
    }
    case "org-budgets-seed": {
      const budgets: CapabilityBudgetRecord[] = step.budgets.map((b) => ({
        id: b.id,
        tenant: state.tenant as OrgTenantScope,
        scope: { kind: b.scopeKind, refId: b.refId },
        capability: b.capability,
        allocatedUnits: b.allocatedUnits,
        allocatedSpendMinor: b.allocatedSpendMinor,
        consumedUnits: b.consumedUnits,
        consumedSpendMinor: b.consumedSpendMinor,
        generation: 1,
      }));
      state.org.budgets = budgets;
      const bands = budgets.map(
        (b) => `${b.id}:${classifyBudgetUtilizationBand(
          b.allocatedUnits === 0 ? 0 : Math.floor((b.consumedUnits * 10000) / b.allocatedUnits),
        )}`,
      );
      return {
        "org.budgets.seed.count": budgets.length,
        "org.budgets.seed.consumedBands": bands,
      };
    }
    case "org-budget-rebalance": {
      const problem = state.org.problem;
      if (problem === null) {
        return { [`org.rebalance.${step.factKey}.ok`]: false, [`org.rebalance.${step.factKey}.reasonCode`]: "PROBLEM_NOT_PREPARED" };
      }
      const result = rebalanceBudgets(problem);
      if (!result.ok) {
        return {
          [`org.rebalance.${step.factKey}.ok`]: false,
          [`org.rebalance.${step.factKey}.reasonCode`]: result.reasonCode,
        };
      }
      const budgetById = new Map(problem.budgets.map((b) => [b.id, b] as const));
      return {
        [`org.rebalance.${step.factKey}.ok`]: true,
        [`org.rebalance.${step.factKey}.note`]: result.proposal.note,
        [`org.rebalance.${step.factKey}.adjustmentCount`]: result.proposal.adjustments.length,
        [`org.rebalance.${step.factKey}.adjustments`]: result.proposal.adjustments.map(
          (a) => `${a.budgetId}:${a.reasonCode}:${a.deltaUnits >= 0 ? "+" : ""}${a.deltaUnits}/${a.deltaSpendMinor >= 0 ? "+" : ""}${a.deltaSpendMinor}`,
        ),
        [`org.rebalance.${step.factKey}.firstTargetUnits`]: result.proposal.adjustments[0]?.targetAllocatedUnits ?? null,
        [`org.rebalance.${step.factKey}.firstIdempotencyKeyPrefix`]: result.proposal.adjustments[0]?.idempotencyKey.slice(0, 6) ?? null,
        [`org.rebalance.${step.factKey}.refusals`]: result.proposal.refusals.map(
          (r) => `${r.budgetId}:${r.axis}:${r.reasonCode}+${r.overshoot}`,
        ),
        [`org.rebalance.${step.factKey}.skipped`]: result.proposal.skipped.map((s) => s.budgetId),
        [`org.rebalance.${step.factKey}.budgetsUnchanged`]:
          problem.budgets.every((b) => {
            const after = budgetById.get(b.id);
            return after !== undefined && after === b;
          }),
        [`org.rebalance.${step.factKey}.digest`]: result.proposal.digest,
      };
    }
  }
}
