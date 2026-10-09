/**
 * @fleetos/agent-organizations — org optimization benchmark (F290C, Wave 9).
 *
 * A DETERMINISTIC benchmark that instantiates an archetype org, runs it
 * through the REAL `allocateRoles` → `optimizeRouting` → `rebalanceBudgets`
 * seams over scenario loads (6 industries × 3 tiers), and reports
 * per-industry scores with improvement-vs-generic-baseline assertions +
 * a byte-identical determinism digest.
 *
 * HONESTY: the durable improvement is driven by the policy's budget-ENVELOPE
 * (ceiling) component — a specialist-heavy industry's higher spend ceiling
 * AFFORDS a specialist role the generic baseline REFUSES (→ higher totalFit);
 * a cost-controlled industry's tighter spend ceiling REFUSES the specialist
 * role the generic baseline AFFORDS (→ lower totalSpend). The fit-repair
 * local search respects refusedPairs, so the ceiling-driven difference
 * SURVIVES (goal-only improvements are erased by local search — a documented
 * seam finding). Every improvement delta is asserted; routing/rebalancing are
 * run for completeness with honest residuals where they do not improve.
 *
 * Pure deterministic TS; no `Date.now`/`Math.random`; logical `at` ticks.
 */

import type { Industry, OrgSizeTier, IndustryArchetype } from "./archetypes.js";
import { INDUSTRY_ARCHETYPES } from "./archetypes.js";
import type { OptimizationInputs, OptimizationProblem, OptimizationGoals } from "../optimization-inputs.js";
import { prepareOptimizationInputs } from "../optimization-inputs.js";
import type { AgentRoleDefinition } from "../roles.js";
import type { OrganizationPolicyCeilings } from "../org-config.js";
import type { TenantScope } from "../contracts.js";
import type { OrgEvent, OrgJournalEntry } from "../org-snapshots.js";
import { nextOrgEntry } from "../org-snapshots.js";
import type { CapabilityBudgetRecord } from "../budgets.js";
import { allocateRoles, type RoleDemand } from "../role-allocator.js";
import { optimizeRouting, type RoutingOptimizationInput } from "../routing-optimizer.js";
import { rebalanceBudgets } from "../budget-rebalancer.js";
import { fnv1a32 } from "../internal-digest.js";
import { appendUsage, type UsageLedgerEntry, type ModelDescriptor, type ProviderRecord, type BudgetCheckPort } from "@fleetos/model-gateway";

// ---------------------------------------------------------------------------
// Generic baseline — the package's established default goals + a NEUTRAL
// tier-scaled envelope (no industry tuning, no floors). The industry
// envelope DIVERGES from this (specialist-heavy ×1.6, cost-controlled ×0.6).
// ---------------------------------------------------------------------------

export const GENERIC_GOALS: OptimizationGoals = { costWeightBps: 3000, capabilityFitWeightBps: 6000, latencyWeightBps: 1000 };

export function genericCeilingsFor(tier: OrgSizeTier): OrganizationPolicyCeilings {
  const spend = tier === "small" ? 50000 : tier === "medium" ? 100000 : 200000;
  const concurrent = tier === "small" ? 2 : tier === "medium" ? 3 : 4;
  const units = tier === "small" ? 1000 : tier === "medium" ? 2000 : 4000;
  const team = tier === "small" ? 5 : tier === "medium" ? 8 : 12;
  return { maxConcurrentRolesPerAgent: concurrent, maxRoleBudgetUnits: units, maxRoleBudgetSpendMinor: spend, maxAgentsPerTeam: team };
}

export type IndustryObjective = "maximize-fit" | "minimize-spend";

/** specialist-heavy industries maximize capability fit; cost-controlled industries minimize spend. */
export function industryObjective(archetype: IndustryArchetype): IndustryObjective {
  return archetype.envelopeKind === "specialist-heavy" ? "maximize-fit" : "minimize-spend";
}

// ---------------------------------------------------------------------------
// Scenario construction — the archetype's PRIMARY role (roles[0]) with one
// specialist agent (agent-S demonstrates every role capability → fit 10000)
// and one novice (agent-G, fit 0). The role's projected spend is calibrated
// to fall BETWEEN the generic and industry spend ceilings, making the
// budget-ENVELOPE (ceiling) the binding knob:
//   - specialist-heavy (industry ceiling > generic): the role is AFFORDED
//     under the industry ceiling but REFUSED under the generic one → the
//     industry policy ENABLES a capability the generic baseline cannot budget
//     for (→ higher totalFit). The fit-repair local search cannot swap the
//     specialist in under the generic run because the role is refused
//     (refusedPairs) — so the ceiling-driven difference SURVIVES.
//   - cost-controlled (industry ceiling < generic): the role is REFUSED
//     under the industry ceiling but AFFORDED under the generic one → the
//     industry policy AVOIDS the specialist spend (→ lower totalSpend).
// A single role avoids cross-role capability coupling (archetype roles share
// `model_invoke`, so a shared global meanSpend would entangle two roles).
// ---------------------------------------------------------------------------

const BENCHMARK_TENANT: TenantScope = { tenantId: "acme" };
const APPROVING: BudgetCheckPort = { check: () => ({ ok: true, remainingUnits: 0, remainingSpendMinor: 0 }) };

const BENCHMARK_BUDGETS: readonly CapabilityBudgetRecord[] = [
  {
    id: "bench-bud", tenant: BENCHMARK_TENANT, scope: { kind: "agent", refId: "agent-S" },
    capability: "model_invoke", allocatedUnits: 1000, allocatedSpendMinor: 200000,
    consumedUnits: 500, consumedSpendMinor: 100000, generation: 1,
  },
];

function specialistSpendBetween(genericCeiling: number, industryCeiling: number): number {
  return Math.floor((genericCeiling + industryCeiling) / 2);
}

function buildBenchmarkJournal(orgId: string): OrgJournalEntry[] {
  const events: readonly { event: OrgEvent; at: number }[] = [
    { event: { kind: "org-created" }, at: 1 },
    { event: { kind: "agent-enrolled", agentId: "agent-S" }, at: 2 },
    { event: { kind: "agent-enrolled", agentId: "agent-G" }, at: 3 },
    { event: { kind: "budget-allocated", capability: "model_invoke", units: 1000, spendMinor: 50000 }, at: 4 },
  ];
  let prev: OrgJournalEntry | null = null;
  const entries: OrgJournalEntry[] = [];
  for (const { event, at } of events) {
    const entry = nextOrgEntry({ tenant: BENCHMARK_TENANT, organizationId: orgId, event, at, prev });
    entries.push(entry);
    prev = entry;
  }
  return entries;
}

function buildBenchmarkExcerpt(archetype: IndustryArchetype, specSpend: number): UsageLedgerEntry[] {
  const specRole = archetype.roles[0] as AgentRoleDefinition;
  const perCap = Math.floor(specSpend / specRole.capabilities.length);
  const appends = specRole.capabilities.map((cap, i) => ({ agentId: "agent-S", capability: cap, costMinor: perCap, modelId: `spec-${i}`, providerId: "p-spec" }));
  let ledger: UsageLedgerEntry[] = [];
  for (const [index, a] of appends.entries()) {
    const result = appendUsage(ledger, APPROVING, { ...a, tenantId: BENCHMARK_TENANT.tenantId, requestRef: `r-${index + 1}`, units: 10, at: index + 1 });
    if (!result.ok) throw new Error(`benchmark excerpt append failed: ${result.reasonCode}`);
    ledger = [...result.ledger];
  }
  return ledger;
}

function buildInputs(
  archetype: IndustryArchetype,
  goals: OptimizationGoals,
  ceilings: OrganizationPolicyCeilings,
  floors: readonly { capability: string; minUnits: number; minSpendMinor: number }[],
  specSpend: number,
): OptimizationProblem {
  const orgId = `bench-${archetype.industry}-${archetype.tier}`;
  const inputs: OptimizationInputs = {
    tenant: BENCHMARK_TENANT,
    organizationId: orgId,
    journal: buildBenchmarkJournal(orgId),
    usageExcerpt: buildBenchmarkExcerpt(archetype, specSpend),
    roles: archetype.roles,
    budgets: BENCHMARK_BUDGETS,
    goals,
    constraints: { policyCeilings: ceilings, budgetFloors: floors, revokedCapabilities: [] },
  };
  const validation = prepareOptimizationInputs(inputs);
  if (!validation.ok) throw new Error(`benchmark inputs invalid: ${validation.reasonCode}:${validation.detail ?? ""}`);
  return validation.problem;
}

// ---------------------------------------------------------------------------
// A small routing scenario exercising optimizeRouting over the archetype's
// skill requirements. Selection is urgency-driven (gateway semantics); the
// routing leg is RUN for completeness — its improvement is a residual.
// ---------------------------------------------------------------------------

function buildRoutingInput(archetype: IndustryArchetype): RoutingOptimizationInput {
  const tags = archetype.skillRequirements;
  const registry: ModelDescriptor[] = [
    { id: "mdl-rich", providerId: "p-a", capabilityTags: tags, costPerUnitMinor: 50, maxContextUnits: 100000 },
    { id: "mdl-cheap", providerId: "p-b", capabilityTags: tags, costPerUnitMinor: 10, maxContextUnits: 100000 },
  ];
  const providers: ProviderRecord[] = [
    { id: "p-a", declaredModels: ["mdl-rich"], health: "healthy" },
    { id: "p-b", declaredModels: ["mdl-cheap"], health: "healthy" },
  ];
  return {
    registry,
    providers,
    degradationHistory: [{ providerId: "p-a", downEvents: 0 }],
    requestClasses: [{ classId: "cls-core", requiredCapabilities: tags, estimatedUnits: 100, priority: 3, budgetCeilingMinor: 100000 }],
    ladders: [{ modelId: "mdl-rich", currentChainOrder: ["p-a", "p-b"] }],
  };
}

// ---------------------------------------------------------------------------
// Per-scenario result + the suite.
// ---------------------------------------------------------------------------

export interface BenchmarkLegAllocation {
  readonly ok: boolean;
  readonly totalFitBps: number;
  readonly totalProjectedSpendMinor: number;
  readonly assignedCount: number;
  readonly unfilledCount: number;
}

export interface BenchmarkScenarioResult {
  readonly industry: Industry;
  readonly tier: OrgSizeTier;
  readonly objective: IndustryObjective;
  readonly industryLeg: BenchmarkLegAllocation;
  readonly genericLeg: BenchmarkLegAllocation;
  readonly industryObjectiveScore: number;
  readonly genericObjectiveScore: number;
  readonly improvementDelta: number;
  readonly improved: boolean;
  readonly routingRan: boolean;
  readonly rebalanceRan: boolean;
}

export interface BenchmarkSuiteResult {
  readonly kind: "industry-benchmark-suite";
  readonly scenarioCount: number;
  readonly scenarios: readonly BenchmarkScenarioResult[];
  readonly improvedCount: number;
  readonly digest: string;
}

function legFrom(allocation: ReturnType<typeof allocateRoles>): BenchmarkLegAllocation {
  if (!allocation.ok) return { ok: false, totalFitBps: 0, totalProjectedSpendMinor: 0, assignedCount: 0, unfilledCount: 0 };
  const p = allocation.proposal;
  return {
    ok: true,
    totalFitBps: p.totals.totalFitBps,
    totalProjectedSpendMinor: p.totals.totalProjectedSpendMinor,
    assignedCount: p.totals.assignedCount,
    unfilledCount: p.unfilledDemand.reduce((s, u) => s + u.shortfall, 0),
  };
}

function objectiveScore(leg: BenchmarkLegAllocation, objective: IndustryObjective): number {
  return objective === "maximize-fit" ? leg.totalFitBps : -leg.totalProjectedSpendMinor;
}

export function runIndustryBenchmark(archetype: IndustryArchetype): BenchmarkScenarioResult {
  const objective = industryObjective(archetype);
  const genericCeiling = genericCeilingsFor(archetype.tier).maxRoleBudgetSpendMinor;
  const industryCeiling = archetype.policyCeilings.maxRoleBudgetSpendMinor;
  const specSpend = specialistSpendBetween(genericCeiling, industryCeiling);

  const industryProblem = buildInputs(archetype, archetype.goals, archetype.policyCeilings, archetype.budgetFloors, specSpend);
  const genericProblem = buildInputs(archetype, GENERIC_GOALS, genericCeilingsFor(archetype.tier), [], specSpend);

  const demand: RoleDemand[] = [{ roleId: (archetype.roles[0] as AgentRoleDefinition).id, holders: 1 }];
  const industryLeg = legFrom(allocateRoles(industryProblem, demand));
  const genericLeg = legFrom(allocateRoles(genericProblem, demand));

  // Exercise the routing + rebalancing seams (run for completeness).
  const routingInput = buildRoutingInput(archetype);
  const routingRan = optimizeRouting(industryProblem, routingInput).ok && optimizeRouting(genericProblem, routingInput).ok;
  const rebalanceRan = rebalanceBudgets(industryProblem).ok && rebalanceBudgets(genericProblem).ok;

  const indScore = objectiveScore(industryLeg, objective);
  const genScore = objectiveScore(genericLeg, objective);
  const delta = indScore - genScore;
  return {
    industry: archetype.industry,
    tier: archetype.tier,
    objective,
    industryLeg,
    genericLeg,
    industryObjectiveScore: indScore,
    genericObjectiveScore: genScore,
    improvementDelta: delta,
    improved: delta > 0,
    routingRan,
    rebalanceRan,
  };
}

export function runBenchmarkSuite(archetypes: readonly IndustryArchetype[] = INDUSTRY_ARCHETYPES): BenchmarkSuiteResult {
  const scenarios = archetypes.map(runIndustryBenchmark);
  const improvedCount = scenarios.filter((s) => s.improved).length;
  return {
    kind: "industry-benchmark-suite",
    scenarioCount: scenarios.length,
    scenarios,
    improvedCount,
    digest: computeBenchmarkDigest(scenarios),
  };
}

/** Deterministic FNV-1a digest over the suite — byte-identical on re-run. */
export function computeBenchmarkDigest(scenarios: readonly BenchmarkScenarioResult[]): string {
  return `bench_${fnv1a32([
    scenarios.length,
    scenarios
      .map((s) => `${s.industry}/${s.tier}:${s.objective}=${s.industryObjectiveScore}vs${s.genericObjectiveScore}+${s.improvementDelta}${s.improved ? "Y" : "N"}`)
      .join(";"),
  ])}`;
}
