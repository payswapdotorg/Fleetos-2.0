/**
 * @fleetos/agent-organizations — F260C optimizer test fixtures.
 *
 * Everything is built through the REAL implementations: the org journal via
 * `nextOrgEntry`, the usage excerpt via the model gateway's `appendUsage`
 * (with an always-approving BudgetCheckPort test double), and the problem
 * via `prepareOptimizationInputs`. No hand-forged digests anywhere.
 */

import {
  computeOptimizationProblemDigest,
  nextOrgEntry,
  prepareOptimizationInputs,
  type AgentRoleDefinition,
  type CapabilityBudgetRecord,
  type OptimizationInputs,
  type OptimizationProblem,
  type OrgEvent,
  type OrgJournalEntry,
  type TenantScope,
} from "../src/index.js";
import { appendUsage, type BudgetCheckPort, type UsageLedgerEntry } from "@fleetos/model-gateway";

export const TENANT: TenantScope = { tenantId: "acme" };
export const OTHER_TENANT: TenantScope = { tenantId: "globex" };

/** Always-approving budget-check port (test double for ledger building). */
export const APPROVING_PORT: BudgetCheckPort = {
  check: () => ({ ok: true, remainingUnits: 0, remainingSpendMinor: 0 }),
};

export const JOURNAL_EVENTS: readonly { event: OrgEvent; at: number }[] = [
  { event: { kind: "org-created" }, at: 1 },
  { event: { kind: "agent-enrolled", agentId: "agent-1" }, at: 2 },
  { event: { kind: "agent-enrolled", agentId: "agent-2" }, at: 3 },
  { event: { kind: "agent-enrolled", agentId: "agent-3" }, at: 4 },
  { event: { kind: "team-added", teamId: "team-core" }, at: 5 },
  { event: { kind: "role-assigned", agentId: "agent-3", roleId: "role-legacy" }, at: 6 },
  { event: { kind: "budget-allocated", capability: "model_invoke", units: 1000, spendMinor: 50000 }, at: 7 },
  { event: { kind: "budget-consumed", capability: "model_invoke", units: 400, spendMinor: 15000 }, at: 8 },
  { event: { kind: "budget-replenished", capability: "model_invoke", units: 500, spendMinor: 25000 }, at: 9 },
];

export function buildJournal(
  events: readonly { event: OrgEvent; at: number }[] = JOURNAL_EVENTS,
  tenant: TenantScope = TENANT,
): OrgJournalEntry[] {
  let prev: OrgJournalEntry | null = null;
  const entries: OrgJournalEntry[] = [];
  for (const { event, at } of events) {
    const entry = nextOrgEntry({ tenant, organizationId: "org-1", event, at, prev });
    entries.push(entry);
    prev = entry;
  }
  return entries;
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

export function buildExcerpt(tenantId = "acme"): UsageLedgerEntry[] {
  let ledger: UsageLedgerEntry[] = [];
  for (const [index, a] of EXCERPT_APPENDS.entries()) {
    const result = appendUsage(ledger, APPROVING_PORT, { ...a, tenantId, at: index + 1 });
    if (!result.ok) throw new Error(`fixture append failed: ${result.reasonCode}`);
    ledger = [...result.ledger];
  }
  return ledger;
}

export const ROLES: readonly AgentRoleDefinition[] = [
  { id: "role-ops", name: "Operations", capabilities: ["model_invoke", "summarize"], responsibilities: ["run-ops"] },
  { id: "role-legacy", name: "Legacy", capabilities: ["legacy_scan"], responsibilities: ["scan"] },
];

export const BUDGETS: readonly CapabilityBudgetRecord[] = [
  {
    id: "bud-a",
    tenant: TENANT,
    scope: { kind: "agent", refId: "agent-1" },
    capability: "model_invoke",
    allocatedUnits: 600,
    allocatedSpendMinor: 24000,
    consumedUnits: 500,
    consumedSpendMinor: 20000,
    generation: 1,
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

export function baseInputs(): OptimizationInputs {
  return {
    tenant: TENANT,
    organizationId: "org-1",
    journal: buildJournal(),
    usageExcerpt: buildExcerpt(),
    roles: ROLES,
    budgets: BUDGETS,
    goals: GOALS,
    constraints: { policyCeilings: CEILINGS, budgetFloors: FLOORS, revokedCapabilities: [] },
  };
}

/** Build the validated problem or throw — fixtures must always be valid. */
export function buildProblem(overrides: Partial<OptimizationInputs> = {}) {
  const validation = prepareOptimizationInputs({ ...baseInputs(), ...overrides });
  if (!validation.ok) {
    throw new Error(`fixture problem invalid: ${validation.reasonCode}:${validation.detail ?? ""}`);
  }
  return validation.problem;
}

/**
 * Re-seal a locally modified problem with a freshly computed digest — the
 * honest way tests vary one field without tripping tamper detection.
 */
export function reseal(
  problem: OptimizationProblemLike,
  overrides: Partial<OptimizationProblemLike>,
): OptimizationProblemLike {
  const base = { ...problem, ...overrides };
  return { ...base, digest: computeOptimizationProblemDigest(base) };
}

export type OptimizationProblemLike = OptimizationProblem;
