/**
 * F261 lab test fixtures — the agent-organizations lane (deterministic,
 * REAL machinery only). The org journal is built with the REAL
 * `nextOrgEntry`; the usage excerpt with a LOCAL replica of the model
 * gateway's public usage-digest convention (identical formula — the lab
 * may only import the three Wave-6 lane packages), machine-verified by the
 * REAL `verifyUsageLedgerChain` inside `prepareOptimizationInputs`. Every
 * proposal comes from the lane's REAL optimizers; the what-if from the
 * REAL `projectWhatIf`.
 */

import {
  allocateRoles,
  nextOrgEntry,
  optimizeRouting,
  prepareOptimizationInputs,
  projectWhatIf,
  rebalanceBudgets,
  type AgentRoleDefinition,
  type BudgetRebalanceProposal,
  type CapabilityBudgetRecord,
  type OptimizationInputs,
  type OptimizationProblem,
  type OrgEvent,
  type OrgJournalEntry,
  type RoleAllocationProposal,
  type RoutingOptimizationProposal,
  type TenantScope,
  type WhatIfAnalysis,
} from "@fleetos/agent-organizations";
import { fnv1a32 } from "../src/lab-core.js";
import { LAB_TENANT } from "./fixtures-sim.js";

export const OPT_TENANT: TenantScope = { tenantId: LAB_TENANT };
export const ORG_ID = "org-1";

/** The usage-excerpt entry type, extracted from the lane's own input contract. */
export type UsageEntry = OptimizationInputs["usageExcerpt"][number];

// ---------------------------------------------------------------------------
// The org journal — REAL chained entries
// ---------------------------------------------------------------------------

const JOURNAL_EVENTS: readonly { event: OrgEvent; at: number }[] = [
  { event: { kind: "org-created" }, at: 1 },
  { event: { kind: "agent-enrolled", agentId: "agent-1" }, at: 2 },
  { event: { kind: "agent-enrolled", agentId: "agent-2" }, at: 3 },
  { event: { kind: "agent-enrolled", agentId: "agent-3" }, at: 4 },
  { event: { kind: "team-added", teamId: "team-core" }, at: 5 },
  { event: { kind: "role-assigned", agentId: "agent-3", roleId: "role-legacy" }, at: 6 },
  { event: { kind: "budget-allocated", capability: "model_invoke", units: 3000, spendMinor: 120000 }, at: 7 },
  { event: { kind: "budget-consumed", capability: "model_invoke", units: 400, spendMinor: 15000 }, at: 8 },
  { event: { kind: "budget-replenished", capability: "model_invoke", units: 500, spendMinor: 25000 }, at: 9 },
];

export function buildOrgJournal(tenant: TenantScope = OPT_TENANT): OrgJournalEntry[] {
  let prev: OrgJournalEntry | null = null;
  const entries: OrgJournalEntry[] = [];
  for (const { event, at } of JOURNAL_EVENTS) {
    const entry = nextOrgEntry({ tenant, organizationId: ORG_ID, event, at, prev });
    entries.push(entry);
    prev = entry;
  }
  return entries;
}

// ---------------------------------------------------------------------------
// The usage excerpt — local replica of the gateway's digest convention
// ---------------------------------------------------------------------------

function usageEntryDigest(
  prevDigest: string | null,
  entry: Omit<UsageEntry, "digest" | "prevDigest">,
): string {
  return `usage_${fnv1a32([
    prevDigest ?? "usagedger_genesis",
    entry.seq,
    entry.tenantId,
    entry.agentId,
    entry.requestRef,
    entry.modelId,
    entry.providerId,
    entry.capability,
    entry.units,
    entry.costMinor,
    entry.at,
  ])}`;
}

const EXCERPT_APPENDS: readonly {
  requestRef: string;
  agentId: string;
  modelId: string;
  providerId: string;
  capability: string;
  units: number;
  costMinor: number;
}[] = [
  { requestRef: "req-1", agentId: "agent-1", modelId: "model-alpha", providerId: "p1", capability: "model_invoke", units: 100, costMinor: 4000 },
  { requestRef: "req-2", agentId: "agent-1", modelId: "model-alpha", providerId: "p1", capability: "model_invoke", units: 200, costMinor: 8000 },
  { requestRef: "req-3", agentId: "agent-2", modelId: "model-beta", providerId: "p2", capability: "summarize", units: 50, costMinor: 2500 },
  { requestRef: "req-4", agentId: "agent-3", modelId: "model-gamma", providerId: "p3", capability: "legacy_scan", units: 10, costMinor: 500 },
];

export function buildExcerpt(tenantId = LAB_TENANT): UsageEntry[] {
  const ledger: UsageEntry[] = [];
  for (const [index, a] of EXCERPT_APPENDS.entries()) {
    const base = { seq: index + 1, tenantId, ...a, at: index + 1 };
    const prevDigest = ledger.length > 0 ? ledger[ledger.length - 1]?.digest ?? null : null;
    ledger.push({ ...base, digest: usageEntryDigest(prevDigest, base), prevDigest });
  }
  return ledger;
}

// ---------------------------------------------------------------------------
// The problem + proposals — all REAL
// ---------------------------------------------------------------------------

export const ROLES: readonly AgentRoleDefinition[] = [
  { id: "role-ops", name: "Operations", capabilities: ["model_invoke", "summarize"], responsibilities: ["run-ops"] },
  { id: "role-legacy", name: "Legacy", capabilities: ["legacy_scan"], responsibilities: ["scan"] },
];

export const BUDGETS: readonly CapabilityBudgetRecord[] = [
  {
    id: "bud-a",
    tenant: OPT_TENANT,
    scope: { kind: "agent", refId: "agent-1" },
    capability: "model_invoke",
    allocatedUnits: 600,
    allocatedSpendMinor: 24000,
    consumedUnits: 500,
    consumedSpendMinor: 20000,
    generation: 1,
  },
  {
    id: "bud-b",
    tenant: OPT_TENANT,
    scope: { kind: "agent", refId: "agent-1" },
    capability: "model_invoke",
    allocatedUnits: 2000,
    allocatedSpendMinor: 80000,
    consumedUnits: 400,
    consumedSpendMinor: 15000,
    generation: 2,
  },
];

export const GOALS = { costWeightBps: 3000, capabilityFitWeightBps: 6000, latencyWeightBps: 1000 };
export const CEILINGS = {
  maxConcurrentRolesPerAgent: 2,
  maxRoleBudgetUnits: 1000,
  maxRoleBudgetSpendMinor: 50000,
  maxAgentsPerTeam: 5,
};
export const FLOORS = [{ capability: "model_invoke", minUnits: 200, minSpendMinor: 10000 }];

export function baseOptimizationInputs(): OptimizationInputs {
  return {
    tenant: OPT_TENANT,
    organizationId: ORG_ID,
    journal: buildOrgJournal(),
    usageExcerpt: buildExcerpt(),
    roles: ROLES,
    budgets: BUDGETS,
    goals: GOALS,
    constraints: { policyCeilings: CEILINGS, budgetFloors: FLOORS, revokedCapabilities: [] },
  };
}

export function buildProblem(overrides: Partial<OptimizationInputs> = {}): OptimizationProblem {
  const validation = prepareOptimizationInputs({ ...baseOptimizationInputs(), ...overrides });
  if (!validation.ok) {
    throw new Error(`fixture problem invalid: ${validation.reasonCode}:${validation.detail ?? ""}`);
  }
  return validation.problem;
}

const REGISTRY = [
  { id: "model-alpha", providerId: "p1", capabilityTags: ["reasoning", "summarize"], costPerUnitMinor: 100, maxContextUnits: 100000 },
  { id: "model-beta", providerId: "p2", capabilityTags: ["reasoning"], costPerUnitMinor: 30, maxContextUnits: 50000 },
  { id: "model-gamma", providerId: "p3", capabilityTags: ["reasoning", "summarize", "code"], costPerUnitMinor: 250, maxContextUnits: 200000 },
  { id: "model-tiny", providerId: "p1", capabilityTags: ["reasoning", "summarize"], costPerUnitMinor: 5, maxContextUnits: 100 },
] as const;

const PROVIDERS = [
  { id: "p1", declaredModels: ["model-alpha", "model-tiny"], health: "healthy" },
  { id: "p2", declaredModels: ["model-beta"], health: "healthy" },
  { id: "p3", declaredModels: ["model-gamma"], health: "degraded" },
] as const;

const HISTORY = [
  { providerId: "p1", downEvents: 2 },
  { providerId: "p2", downEvents: 0 },
  { providerId: "p3", downEvents: 1 },
] as const;

export interface LabOptimizationFixture {
  readonly problem: OptimizationProblem;
  readonly roleAllocation: RoleAllocationProposal;
  readonly budgetRebalance: BudgetRebalanceProposal;
  readonly routing: RoutingOptimizationProposal;
  readonly whatIf: WhatIfAnalysis;
}

/** Build the whole optimization stack through the REAL lane optimizers. */
export function buildOptimizationStack(): LabOptimizationFixture {
  const problem = buildProblem();
  const roles = allocateRoles(problem, [
    { roleId: "role-ops", holders: 1 },
    { roleId: "role-legacy", holders: 1 },
  ]);
  if (!roles.ok) throw new Error(`fixture roles refused: ${roles.reasonCode}`);
  const budgets = rebalanceBudgets(problem);
  if (!budgets.ok) throw new Error(`fixture rebalance refused: ${budgets.reasonCode}`);
  const routing = optimizeRouting(problem, {
    registry: REGISTRY,
    providers: PROVIDERS,
    degradationHistory: HISTORY,
    requestClasses: [
      { classId: "class-a", requiredCapabilities: ["reasoning", "summarize"], estimatedUnits: 1000, priority: 1, budgetCeilingMinor: 150000 },
      { classId: "class-b", requiredCapabilities: ["reasoning"], estimatedUnits: 500, priority: 4, budgetCeilingMinor: 300000 },
    ],
    ladders: [{ modelId: "model-alpha", currentChainOrder: ["p1", "p2", "p3"] }],
  });
  if (!routing.ok) throw new Error(`fixture routing refused: ${routing.reasonCode}`);
  const whatIf = projectWhatIf({
    tenant: OPT_TENANT,
    snapshot: problem.snapshot,
    proposals: {
      roleAllocations: [roles.proposal],
      budgetRebalances: [budgets.proposal],
      routing: [routing.proposal],
    },
  });
  if (!whatIf.ok) throw new Error(`fixture what-if refused: ${whatIf.reasonCode}`);
  return {
    problem,
    roleAllocation: roles.proposal,
    budgetRebalance: budgets.proposal,
    routing: routing.proposal,
    whatIf: whatIf.analysis,
  };
}
