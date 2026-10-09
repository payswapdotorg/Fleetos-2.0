/**
 * @fleetos/acceptance-convergence — scenario org assembly (F290C REAL surfaces).
 *
 * Builds the scenario's agent organization over the REAL agent-organizations
 * seams: an org event journal through `nextOrgEntry` (the REAL chain), a
 * usage excerpt through the REAL model-gateway `appendUsage`, and the
 * archetype's policy applied through `applyPolicyWithGuard` — the REAL
 * guarded overlay whose kernel validation (`prepareOptimizationInputs`)
 * produces the REAL `OptimizationProblem` (with the kernel's own digest).
 *
 * The scenario's budget envelope is therefore PROVEN to flow through the
 * REAL optimization policy path (goals + ceilings + floors), not merely
 * asserted as data. A guard refusal (industry/tier/kernel) is fail-loud —
 * it cannot happen by construction (the policy derives from the same
 * archetype), so it means a fixture bug and surfaces verbatim.
 *
 * Pure deterministic TS; logical `now` is caller-supplied throughout.
 */

import {
  GENERIC_GOALS,
  applyPolicyWithGuard,
  genericCeilingsFor,
  nextOrgEntry,
  policyForArchetype,
  type BudgetFloor,
  type CapabilityBudgetRecord,
  type IndustryArchetype,
  type IndustryOptimizationPolicy,
  type OptimizationGoals,
  type OptimizationInputs,
  type OptimizationProblem,
  type OrgEvent,
  type OrgJournalEntry,
  type TenantScope,
} from "@fleetos/agent-organizations";
import { appendUsage, type BudgetCheckPort, type UsageLedgerEntry } from "@fleetos/model-gateway";

const APPROVING: BudgetCheckPort = {
  check: () => ({ ok: true, remainingUnits: 0, remainingSpendMinor: 0 }),
};

/** The assembled scenario org (REAL records by reference). */
export interface ScenarioOrg {
  readonly organizationId: string;
  readonly journal: readonly OrgJournalEntry[];
  readonly usageExcerpt: readonly UsageLedgerEntry[];
  readonly budgets: readonly CapabilityBudgetRecord[];
  readonly policy: IndustryOptimizationPolicy;
  readonly problem: OptimizationProblem;
}

export type OrgAssemblyResult =
  | { readonly ok: true; readonly org: ScenarioOrg }
  | { readonly ok: false; readonly reasonCode: string; readonly detail: string | null };

/** Build the org journal (REAL chained entries: created, 2 agents, budget). */
function buildJournal(tenant: TenantScope, organizationId: string, now: number): readonly OrgJournalEntry[] {
  const events: readonly { event: OrgEvent; at: number }[] = [
    { event: { kind: "org-created" }, at: now + 1 },
    { event: { kind: "agent-enrolled", agentId: "agent-conv-1" }, at: now + 2 },
    { event: { kind: "agent-enrolled", agentId: "agent-conv-2" }, at: now + 3 },
    { event: { kind: "budget-allocated", capability: "model_invoke", units: 1000, spendMinor: 50000 }, at: now + 4 },
  ];
  let prev: OrgJournalEntry | null = null;
  const entries: OrgJournalEntry[] = [];
  for (const { event, at } of events) {
    const entry = nextOrgEntry({ tenant, organizationId, event, at, prev });
    entries.push(entry);
    prev = entry;
  }
  return entries;
}

/** Build the usage excerpt over the archetype's PRIMARY role capabilities. */
function buildUsageExcerpt(tenantId: string, archetype: IndustryArchetype): readonly UsageLedgerEntry[] {
  const primary = archetype.roles[0] as IndustryArchetype["roles"][number];
  const budget = archetype.policyCeilings.maxRoleBudgetSpendMinor;
  const perCap = Math.floor(budget / primary.capabilities.length / 2);
  let ledger: UsageLedgerEntry[] = [];
  for (const [index, capability] of primary.capabilities.entries()) {
    const result = appendUsage(ledger, APPROVING, {
      tenantId,
      agentId: "agent-conv-1",
      requestRef: `r-${index + 1}`,
      modelId: `mdl-${index + 1}`,
      providerId: "p-conv",
      capability,
      units: 10,
      costMinor: perCap,
      at: index + 1,
    });
    if (!result.ok) throw new Error(`scenario usage excerpt append failed: ${result.reasonCode}`);
    ledger = [...result.ledger];
  }
  return ledger;
}

/**
 * Assemble the scenario org: journal + usage excerpt + budget records +
 * the REAL policy applied through the guarded overlay. The returned problem
 * carries the kernel's own digest (A19) — cited verbatim downstream.
 */
export function assembleOrg(input: {
  readonly tenantId: string;
  readonly shortKey: string;
  readonly archetype: IndustryArchetype;
  readonly now: number;
}): OrgAssemblyResult {
  const tenant: TenantScope = { tenantId: input.tenantId };
  const organizationId = `org_conv_${input.shortKey}`;
  const journal = buildJournal(tenant, organizationId, input.now);
  const usageExcerpt = buildUsageExcerpt(input.tenantId, input.archetype);
  const floors: readonly BudgetFloor[] = input.archetype.budgetFloors;
  const budgets: readonly CapabilityBudgetRecord[] = [
    {
      id: `conv-bud-${input.shortKey}`,
      tenant,
      scope: { kind: "agent", refId: "agent-conv-1" },
      capability: "model_invoke",
      allocatedUnits: 1000,
      allocatedSpendMinor: 200000,
      consumedUnits: 500,
      consumedSpendMinor: 100000,
      generation: 1,
    },
  ];
  const goals: OptimizationGoals = GENERIC_GOALS;
  const baseInputs: OptimizationInputs = {
    tenant,
    organizationId,
    journal,
    usageExcerpt,
    roles: input.archetype.roles,
    budgets,
    goals,
    constraints: {
      policyCeilings: genericCeilingsFor(input.archetype.tier),
      budgetFloors: floors,
      revokedCapabilities: [],
    },
  };
  const policy = policyForArchetype(input.archetype);
  const applied = applyPolicyWithGuard(baseInputs, policy, {
    industry: input.archetype.industry,
    tier: input.archetype.tier,
  });
  if (!applied.ok) {
    return { ok: false, reasonCode: "ORG_POLICY_REFUSED", detail: `${applied.reasonCode}:${applied.detail ?? ""}` };
  }
  return {
    ok: true,
    org: {
      organizationId,
      journal,
      usageExcerpt,
      budgets,
      policy,
      problem: applied.problem,
    },
  };
}
