/**
 * @fleetos/agent-organizations — optimization problem definition (F260C).
 *
 * The single entry point for every optimizer in this package: an
 * OptimizationProblem bundles the org snapshot (folded from the package's
 * OWN journal fold), a usage excerpt (the model gateway's REAL ledger
 * entries), declared optimization goals (FIXED vocabulary — integer bps,
 * never learned weights) and a constraint set (org policy CEILINGS + budget
 * floors).
 *
 * Laws:
 *   A5/A6 — ceilings are CONSTRAINTS, never authorizations. The problem
 *           record says so in its own vocabulary; optimizers downstream
 *           PROPOSE, never apply.
 *   A8    — tenant fail-closed on every path.
 *   A19   — the problem carries a digest; tampering is detectable.
 *
 * Pure deterministic TS; logical `now`/caller-supplied inputs everywhere.
 */

import type { TenantScope } from "./contracts.js";
import { validateTenantScope } from "./contracts.js";
import type { AgentRoleDefinition } from "./roles.js";
import { validateRoleDefinition } from "./roles.js";
import type { CapabilityBudgetRecord } from "./budgets.js";
import { validateBudgetRecord } from "./budgets.js";
import type { OrganizationPolicyCeilings } from "./org-config.js";
import type { OrgJournalEntry, OrgSnapshot } from "./org-snapshots.js";
import { verifyOrgJournalChain, foldOrgSnapshot } from "./org-snapshots.js";
import type { UsageLedgerEntry } from "@fleetos/model-gateway";
import { verifyUsageLedgerChain } from "@fleetos/model-gateway";
import { fnv1a32 } from "./internal-digest.js";

// ---------------------------------------------------------------------------
// Goals — FIXED vocabulary, integer bps. No learned weights, ever.
// ---------------------------------------------------------------------------

export interface OptimizationGoals {
  readonly costWeightBps: number;
  readonly capabilityFitWeightBps: number;
  readonly latencyWeightBps: number;
}

// ---------------------------------------------------------------------------
// Constraints — policy ceilings (hard walls) + budget floors + revocations.
// ---------------------------------------------------------------------------

export interface BudgetFloor {
  readonly capability: string;
  readonly minUnits: number;
  readonly minSpendMinor: number;
}

export interface OptimizationConstraints {
  readonly policyCeilings: OrganizationPolicyCeilings;
  readonly budgetFloors: readonly BudgetFloor[];
  /** Revoked capabilities are never granted more (rebalancer law). */
  readonly revokedCapabilities: readonly string[];
}

// ---------------------------------------------------------------------------
// The problem definition + validation.
// ---------------------------------------------------------------------------

export interface OptimizationInputs {
  readonly tenant: TenantScope;
  readonly organizationId: string;
  readonly journal: readonly OrgJournalEntry[];
  readonly usageExcerpt: readonly UsageLedgerEntry[];
  readonly roles: readonly AgentRoleDefinition[];
  readonly budgets: readonly CapabilityBudgetRecord[];
  readonly goals: OptimizationGoals;
  readonly constraints: OptimizationConstraints;
}

export type OptimizationInputsReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "ORGANIZATION_ID_EMPTY"
  | "JOURNAL_CHAIN_BROKEN"
  | "JOURNAL_TENANT_MISMATCH"
  | "USAGE_LEDGER_CHAIN_BROKEN"
  | "USAGE_TENANT_MISMATCH"
  | "ROLE_DEFINITION_INVALID"
  | "ROLE_ID_DUPLICATED"
  | "BUDGET_RECORD_INVALID"
  | "BUDGET_TENANT_MISMATCH"
  | "BUDGET_ID_DUPLICATED"
  | "WEIGHT_NEGATIVE"
  | "WEIGHT_NON_INTEGER"
  | "WEIGHT_SUM_ZERO"
  | "WEIGHT_SUM_EXCEEDS_TOTAL"
  | "BUDGET_FLOOR_CAPABILITY_EMPTY"
  | "BUDGET_FLOOR_NEGATIVE"
  | "BUDGET_FLOOR_NON_INTEGER"
  | "BUDGET_FLOOR_DUPLICATED"
  | "REVOKED_CAPABILITY_DUPLICATED"
  | "POLICY_MAX_CONCURRENT_ROLES_BELOW_ONE"
  | "POLICY_NEGATIVE_CEILING"
  | "NON_INTEGER_CEILING";

export type OptimizationInputsValidation =
  | { readonly ok: true; readonly problem: OptimizationProblem }
  | OptimizationInputsFailure;

export interface OptimizationInputsFailure {
  readonly ok: false;
  readonly reasonCode: OptimizationInputsReasonCode;
  readonly detail: string | null;
  readonly brokenAtSeq: number | null;
}

/** The validated optimization problem. Inert data — nothing here executes. */
export interface OptimizationProblem {
  readonly kind: "optimization-problem";
  readonly tenant: TenantScope;
  readonly organizationId: string;
  readonly snapshot: OrgSnapshot;
  readonly usageExcerpt: readonly UsageLedgerEntry[];
  readonly roles: readonly AgentRoleDefinition[];
  readonly budgets: readonly CapabilityBudgetRecord[];
  readonly goals: OptimizationGoals;
  readonly constraints: OptimizationConstraints;
  readonly note: "ceilings-are-constraints-not-authorizations";
  readonly digest: string;
}

/** Sum of the goal weights in integer bps (fixed vocabulary). */
export function goalWeightSumBps(goals: OptimizationGoals): number {
  return goals.costWeightBps + goals.capabilityFitWeightBps + goals.latencyWeightBps;
}

/**
 * Validate + fold the inputs into an OptimizationProblem. Fail-closed on
 * tenant, journal chain, ledger chain, weights and constraints. The org
 * snapshot is produced by the package's OWN journal fold.
 */
export function prepareOptimizationInputs(inputs: OptimizationInputs): OptimizationInputsValidation {
  const tenantCheck = validateTenantScope(inputs.tenant);
  if (!tenantCheck.ok) {
    return fail("TENANT_SCOPE_MISSING", null, null);
  }
  if (typeof inputs.organizationId !== "string" || inputs.organizationId.length === 0) {
    return fail("ORGANIZATION_ID_EMPTY", null, null);
  }

  const chain = verifyOrgJournalChain(inputs.journal);
  if (!chain.ok) {
    return fail("JOURNAL_CHAIN_BROKEN", chain.reasonCode, chain.brokenAtSeq);
  }
  if (chain.tenantId !== tenantCheck.scope.tenantId) {
    return fail("JOURNAL_TENANT_MISMATCH", chain.tenantId, null);
  }
  const snapshot = foldOrgSnapshot(inputs.journal);

  if (inputs.usageExcerpt.length > 0) {
    const usageChain = verifyUsageLedgerChain(inputs.usageExcerpt);
    if (!usageChain.ok) {
      return fail("USAGE_LEDGER_CHAIN_BROKEN", usageChain.reasonCode, usageChain.brokenAtSeq);
    }
    const first = inputs.usageExcerpt[0] as UsageLedgerEntry;
    if (first.tenantId !== tenantCheck.scope.tenantId) {
      return fail("USAGE_TENANT_MISMATCH", first.tenantId, null);
    }
  }

  const goalCheck = validateGoals(inputs.goals);
  if (goalCheck !== null) return goalCheck;
  const constraintCheck = validateConstraints(inputs.constraints);
  if (constraintCheck !== null) return constraintCheck;

  const roleIds = new Set<string>();
  for (const role of inputs.roles) {
    const roleCheck = validateRoleDefinition(role);
    if (!roleCheck.ok) {
      return fail("ROLE_DEFINITION_INVALID", `${role.id}:${roleCheck.reasonCode}`, null);
    }
    if (roleIds.has(role.id)) return fail("ROLE_ID_DUPLICATED", role.id, null);
    roleIds.add(role.id);
  }

  const budgetIds = new Set<string>();
  for (const budget of inputs.budgets) {
    const budgetCheck = validateBudgetRecord(budget);
    if (!budgetCheck.ok) {
      return fail("BUDGET_RECORD_INVALID", `${budget.id}:${budgetCheck.reasonCode}`, null);
    }
    if (budget.tenant.tenantId !== tenantCheck.scope.tenantId) {
      return fail("BUDGET_TENANT_MISMATCH", budget.id, null);
    }
    if (budgetIds.has(budget.id)) return fail("BUDGET_ID_DUPLICATED", budget.id, null);
    budgetIds.add(budget.id);
  }

  const base: Omit<OptimizationProblem, "digest"> = {
    kind: "optimization-problem",
    tenant: inputs.tenant,
    organizationId: inputs.organizationId,
    snapshot,
    usageExcerpt: inputs.usageExcerpt,
    roles: inputs.roles,
    budgets: inputs.budgets,
    goals: inputs.goals,
    constraints: inputs.constraints,
    note: "ceilings-are-constraints-not-authorizations",
  };
  return { ok: true, problem: { ...base, digest: computeOptimizationProblemDigest(base) } };
}

function validateGoals(goals: OptimizationGoals): OptimizationInputsFailure | null {
  const weights: readonly [string, number][] = [
    ["costWeightBps", goals.costWeightBps],
    ["capabilityFitWeightBps", goals.capabilityFitWeightBps],
    ["latencyWeightBps", goals.latencyWeightBps],
  ];
  for (const [name, weight] of weights) {
    if (!Number.isInteger(weight)) return fail("WEIGHT_NON_INTEGER", name, null);
    if (weight < 0) return fail("WEIGHT_NEGATIVE", name, null);
  }
  const sum = goalWeightSumBps(goals);
  if (sum === 0) return fail("WEIGHT_SUM_ZERO", null, null);
  if (sum > 10000) return fail("WEIGHT_SUM_EXCEEDS_TOTAL", String(sum), null);
  return null;
}

function validateConstraints(constraints: OptimizationConstraints): OptimizationInputsFailure | null {
  const policy = constraints.policyCeilings;
  if (
    !Number.isInteger(policy.maxConcurrentRolesPerAgent) ||
    !Number.isInteger(policy.maxRoleBudgetUnits) ||
    !Number.isInteger(policy.maxRoleBudgetSpendMinor) ||
    !Number.isInteger(policy.maxAgentsPerTeam)
  ) {
    return fail("NON_INTEGER_CEILING", null, null);
  }
  if (policy.maxConcurrentRolesPerAgent < 1) {
    return fail("POLICY_MAX_CONCURRENT_ROLES_BELOW_ONE", null, null);
  }
  if (
    policy.maxRoleBudgetUnits < 0 ||
    policy.maxRoleBudgetSpendMinor < 0 ||
    policy.maxAgentsPerTeam < 0
  ) {
    return fail("POLICY_NEGATIVE_CEILING", null, null);
  }
  const seenCaps = new Set<string>();
  for (const floor of constraints.budgetFloors) {
    if (typeof floor.capability !== "string" || floor.capability.length === 0) {
      return fail("BUDGET_FLOOR_CAPABILITY_EMPTY", null, null);
    }
    if (!Number.isInteger(floor.minUnits) || !Number.isInteger(floor.minSpendMinor)) {
      return fail("BUDGET_FLOOR_NON_INTEGER", floor.capability, null);
    }
    if (floor.minUnits < 0 || floor.minSpendMinor < 0) {
      return fail("BUDGET_FLOOR_NEGATIVE", floor.capability, null);
    }
    if (seenCaps.has(floor.capability)) return fail("BUDGET_FLOOR_DUPLICATED", floor.capability, null);
    seenCaps.add(floor.capability);
  }
  const seenRevoked = new Set<string>();
  for (const capability of constraints.revokedCapabilities) {
    if (seenRevoked.has(capability)) {
      return fail("REVOKED_CAPABILITY_DUPLICATED", capability, null);
    }
    seenRevoked.add(capability);
  }
  return null;
}

function fail(
  reasonCode: OptimizationInputsReasonCode,
  detail: string | null,
  brokenAtSeq: number | null,
): OptimizationInputsFailure {
  return { ok: false, reasonCode, detail, brokenAtSeq };
}

// ---------------------------------------------------------------------------
// Digest (law A19) — tamper-detectable problem definition.
// ---------------------------------------------------------------------------

/** Canonical digest over the problem definition — deterministic. */
export function computeOptimizationProblemDigest(problem: Omit<OptimizationProblem, "digest">): string {
  return `optin_${fnv1a32([
    problem.tenant.tenantId,
    problem.organizationId,
    problem.snapshot.digest,
    problem.usageExcerpt.map((e) => e.digest).join(","),
    problem.roles.map((r) => `${r.id}>${r.capabilities.join("+")}>${r.responsibilities.join("+")}`).join(";"),
    problem.budgets.map((b) => `${b.id}>${b.scope.kind}:${b.scope.refId}>${b.capability}>${b.allocatedUnits}/${b.allocatedSpendMinor}/${b.consumedUnits}/${b.consumedSpendMinor}/${b.generation}`).join(";"),
    problem.goals.costWeightBps,
    problem.goals.capabilityFitWeightBps,
    problem.goals.latencyWeightBps,
    problem.constraints.policyCeilings.maxConcurrentRolesPerAgent,
    problem.constraints.policyCeilings.maxRoleBudgetUnits,
    problem.constraints.policyCeilings.maxRoleBudgetSpendMinor,
    problem.constraints.policyCeilings.maxAgentsPerTeam,
    problem.constraints.budgetFloors.map((f) => `${f.capability}:${f.minUnits}/${f.minSpendMinor}`).join(";"),
    problem.constraints.revokedCapabilities.join(","),
  ])}`;
}

/** Recompute the problem digest — `false` when the record was tampered with. */
export function verifyOptimizationProblemDigest(problem: OptimizationProblem): boolean {
  const { digest: _omit, ...rest } = problem;
  return problem.digest === computeOptimizationProblemDigest(rest);
}

// ---------------------------------------------------------------------------
// Derived usage facts — deterministic projections of the usage excerpt that
// the optimizers share. Pure folds over REAL gateway ledger entries.
// ---------------------------------------------------------------------------

export interface CapabilityUsageAverage {
  readonly entries: number;
  readonly totalUnits: number;
  readonly totalSpendMinor: number;
  /** Floored integer mean per entry — 0 when the capability has no entries. */
  readonly meanUnitsPerEntry: number;
  readonly meanSpendMinorPerEntry: number;
}

export interface UsageFacts {
  readonly capabilityAverages: Readonly<Record<string, CapabilityUsageAverage>>;
  readonly agentDemonstratedCapabilities: Readonly<Record<string, readonly string[]>>;
}

/** Fold the excerpt into shared facts. Deterministic; input never mutated. */
export function deriveUsageFacts(excerpt: readonly UsageLedgerEntry[]): UsageFacts {
  const byCapability = new Map<string, { entries: number; units: number; spend: number }>();
  const byAgent = new Map<string, Set<string>>();
  for (const entry of excerpt) {
    const cap = byCapability.get(entry.capability) ?? { entries: 0, units: 0, spend: 0 };
    cap.entries += 1;
    cap.units += entry.units;
    cap.spend += entry.costMinor;
    byCapability.set(entry.capability, cap);
    if (entry.units > 0) {
      const caps = byAgent.get(entry.agentId) ?? new Set<string>();
      caps.add(entry.capability);
      byAgent.set(entry.agentId, caps);
    }
  }
  const capabilityAverages: Record<string, CapabilityUsageAverage> = {};
  for (const [capability, acc] of [...byCapability.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    capabilityAverages[capability] = {
      entries: acc.entries,
      totalUnits: acc.units,
      totalSpendMinor: acc.spend,
      meanUnitsPerEntry: Math.floor(acc.units / acc.entries),
      meanSpendMinorPerEntry: Math.floor(acc.spend / acc.entries),
    };
  }
  const agentDemonstratedCapabilities: Record<string, readonly string[]> = {};
  for (const [agentId, caps] of [...byAgent.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    agentDemonstratedCapabilities[agentId] = [...caps].sort();
  }
  return { capabilityAverages, agentDemonstratedCapabilities };
}
