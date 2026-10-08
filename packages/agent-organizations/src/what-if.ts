/**
 * @fleetos/agent-organizations — what-if analysis (F260C).
 *
 * Apply a set of optimization PROPOSALS to an org snapshot PURELY: the
 * input snapshot is never mutated (purity is machine-tested), the projected
 * snapshot is a NEW value whose digest follows the package's own fold
 * convention, and the delta report expresses every change in integer bps.
 * The projection is marked EXPERIMENTAL / proposal-state — it is NEVER an
 * authoritative org state; only the Guardian/governance path can turn a
 * proposal into org reality (A5/A6).
 *
 * Pure deterministic TS.
 */

import type { TenantScope } from "./contracts.js";
import { validateTenantScope } from "./contracts.js";
import type { OrgSnapshot } from "./org-snapshots.js";
import { computeOrgSnapshotDigest } from "./org-snapshots.js";
import type { RoleAllocationProposal } from "./role-allocator.js";
import type { BudgetRebalanceProposal } from "./budget-rebalancer.js";
import type { RoutingOptimizationProposal } from "./routing-optimizer.js";
import { fnv1a32 } from "./internal-digest.js";

// ---------------------------------------------------------------------------
// Inputs + records.
// ---------------------------------------------------------------------------

export interface WhatIfProposalSet {
  readonly roleAllocations: readonly RoleAllocationProposal[];
  readonly budgetRebalances: readonly BudgetRebalanceProposal[];
  readonly routing: readonly RoutingOptimizationProposal[];
}

export interface WhatIfMetricDelta {
  readonly before: number;
  readonly after: number;
  readonly delta: number;
  /** Integer bps change; null when `before` is 0 and `after` is not (honest). */
  readonly deltaBps: number | null;
}

export interface WhatIfRoutingDelta {
  readonly classId: string;
  readonly currentCostMinor: number | null;
  readonly proposedCostMinor: number | null;
}

export interface WhatIfDeltaReport {
  readonly allocatedUnits: WhatIfMetricDelta;
  readonly consumedUnits: WhatIfMetricDelta;
  readonly allocatedSpendMinor: WhatIfMetricDelta;
  readonly consumedSpendMinor: WhatIfMetricDelta;
  readonly utilizationUnitsBps: { readonly before: number; readonly after: number };
  readonly concurrentRoles: readonly {
    readonly agentId: string;
    readonly before: number;
    readonly after: number;
    readonly delta: number;
  }[];
  readonly applied: { readonly roleAssignments: number; readonly budgetAdjustments: number };
  readonly routingCostMinor: { readonly before: number; readonly after: number; readonly deltaBps: number | null };
}

export interface WhatIfAnalysis {
  readonly kind: "what-if-analysis";
  readonly state: "experimental-projection";
  readonly note: "never-authoritative-org-state";
  readonly tenantId: string;
  readonly organizationId: string;
  readonly baseline: OrgSnapshot;
  readonly projected: OrgSnapshot;
  readonly delta: WhatIfDeltaReport;
  readonly routingDeltas: readonly WhatIfRoutingDelta[];
  readonly digest: string;
}

export type WhatIfResult =
  | { readonly ok: true; readonly analysis: WhatIfAnalysis }
  | {
      readonly ok: false;
      readonly reasonCode:
        | "TENANT_SCOPE_MISSING"
        | "SNAPSHOT_DIGEST_MISMATCH"
        | "WHATIF_TENANT_MISMATCH"
        | "PROJECTED_BUDGET_INVALID";
      readonly detail: string | null;
    };

// ---------------------------------------------------------------------------
// The projection — pure, proposal-state only.
// ---------------------------------------------------------------------------

/**
 * Project a proposal set onto an org snapshot. PURE: the input snapshot
 * (and every proposal record) is left untouched — the projected snapshot is
 * a fresh value with a digest from the package's own convention. The result
 * is EXPERIMENTAL: it authorizes nothing and is never org truth.
 */
export function projectWhatIf(input: {
  readonly tenant: TenantScope;
  readonly snapshot: OrgSnapshot;
  readonly proposals: WhatIfProposalSet;
}): WhatIfResult {
  const tenantCheck = validateTenantScope(input.tenant);
  if (!tenantCheck.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING", detail: null };
  const tenantId = tenantCheck.scope.tenantId;
  if (input.snapshot.tenantId !== tenantId) {
    return { ok: false, reasonCode: "WHATIF_TENANT_MISMATCH", detail: "snapshot" };
  }
  const { digest: _baselineDigest, ...baselineBase } = input.snapshot;
  if (input.snapshot.digest !== computeOrgSnapshotDigest(baselineBase)) {
    return { ok: false, reasonCode: "SNAPSHOT_DIGEST_MISMATCH", detail: null };
  }
  for (const proposal of input.proposals.roleAllocations) {
    if (proposal.tenantId !== tenantId) {
      return { ok: false, reasonCode: "WHATIF_TENANT_MISMATCH", detail: `role-allocation:${proposal.tenantId}` };
    }
  }
  for (const proposal of input.proposals.budgetRebalances) {
    if (proposal.tenantId !== tenantId) {
      return { ok: false, reasonCode: "WHATIF_TENANT_MISMATCH", detail: `budget-rebalance:${proposal.tenantId}` };
    }
  }
  for (const proposal of input.proposals.routing) {
    if (proposal.tenantId !== tenantId) {
      return { ok: false, reasonCode: "WHATIF_TENANT_MISMATCH", detail: `routing:${proposal.tenantId}` };
    }
  }

  // Concurrent roles — fold the proposed assignments on top of the baseline.
  const concurrentRolesByAgent: Record<string, number> = {
    ...input.snapshot.concurrentRolesByAgent,
  };
  let roleAssignments = 0;
  for (const proposal of input.proposals.roleAllocations) {
    for (const assignment of proposal.assignments) {
      concurrentRolesByAgent[assignment.agentId] =
        (concurrentRolesByAgent[assignment.agentId] ?? 0) + 1;
      roleAssignments++;
    }
  }

  // Budget totals — fold the proposed ceiling adjustments (consumption never
  // changes: proposals adjust ceilings, they never reset consumption).
  const baselineTotals = input.snapshot.budgetTotals;
  let allocatedUnits = baselineTotals.allocatedUnits;
  let allocatedSpendMinor = baselineTotals.allocatedSpendMinor;
  let budgetAdjustments = 0;
  for (const proposal of input.proposals.budgetRebalances) {
    for (const adjustment of proposal.adjustments) {
      allocatedUnits += adjustment.deltaUnits;
      allocatedSpendMinor += adjustment.deltaSpendMinor;
      budgetAdjustments++;
    }
  }
  const consumedUnits = baselineTotals.consumedUnits;
  const consumedSpendMinor = baselineTotals.consumedSpendMinor;
  if (
    allocatedUnits < 0 ||
    allocatedSpendMinor < 0 ||
    consumedUnits > allocatedUnits ||
    consumedSpendMinor > allocatedSpendMinor
  ) {
    return {
      ok: false,
      reasonCode: "PROJECTED_BUDGET_INVALID",
      detail: `units:${allocatedUnits}-spend:${allocatedSpendMinor}`,
    };
  }

  const projectedBase = {
    organizationId: input.snapshot.organizationId,
    tenantId: input.snapshot.tenantId,
    journalLength: input.snapshot.journalLength,
    teams: input.snapshot.teams,
    enrolledAgents: input.snapshot.enrolledAgents,
    removedAgents: input.snapshot.removedAgents,
    concurrentRolesByAgent,
    relievedRoleCount: input.snapshot.relievedRoleCount,
    budgetTotals: {
      allocatedUnits,
      consumedUnits,
      allocatedSpendMinor,
      consumedSpendMinor,
    },
  };

  const routingDeltas: WhatIfRoutingDelta[] = [];
  let routingBefore = 0;
  let routingAfter = 0;
  for (const proposal of input.proposals.routing) {
    for (const perClass of proposal.perClass) {
      routingDeltas.push({
        classId: perClass.classId,
        currentCostMinor: perClass.current.estimatedCostMinor,
        proposedCostMinor: perClass.proposed.estimatedCostMinor,
      });
      if (perClass.current.estimatedCostMinor !== null) routingBefore += perClass.current.estimatedCostMinor;
      if (perClass.proposed.estimatedCostMinor !== null) routingAfter += perClass.proposed.estimatedCostMinor;
    }
  }

  const agents = [
    ...new Set([
      ...Object.keys(input.snapshot.concurrentRolesByAgent),
      ...Object.keys(concurrentRolesByAgent),
    ]),
  ].sort();
  const delta: WhatIfDeltaReport = {
    allocatedUnits: metricDelta(baselineTotals.allocatedUnits, allocatedUnits),
    consumedUnits: metricDelta(baselineTotals.consumedUnits, consumedUnits),
    allocatedSpendMinor: metricDelta(baselineTotals.allocatedSpendMinor, allocatedSpendMinor),
    consumedSpendMinor: metricDelta(baselineTotals.consumedSpendMinor, consumedSpendMinor),
    utilizationUnitsBps: {
      before: utilizationBps(consumedUnits, baselineTotals.allocatedUnits),
      after: utilizationBps(consumedUnits, allocatedUnits),
    },
    concurrentRoles: agents.map((agentId) => ({
      agentId,
      before: input.snapshot.concurrentRolesByAgent[agentId] ?? 0,
      after: concurrentRolesByAgent[agentId] ?? 0,
      delta: (concurrentRolesByAgent[agentId] ?? 0) - (input.snapshot.concurrentRolesByAgent[agentId] ?? 0),
    })),
    applied: { roleAssignments, budgetAdjustments },
    routingCostMinor: {
      before: routingBefore,
      after: routingAfter,
      deltaBps: bpsChange(routingBefore, routingAfter),
    },
  };

  const analysisBase = {
    kind: "what-if-analysis" as const,
    state: "experimental-projection" as const,
    note: "never-authoritative-org-state" as const,
    tenantId,
    organizationId: input.snapshot.organizationId,
    baseline: input.snapshot,
    projected: { ...projectedBase, digest: computeOrgSnapshotDigest(projectedBase) },
    delta,
    routingDeltas,
  };
  return {
    ok: true,
    analysis: {
      ...analysisBase,
      digest: `whatif_${fnv1a32([
        tenantId,
        input.snapshot.digest,
        analysisBase.projected.digest,
        roleAssignments,
        budgetAdjustments,
        routingAfter - routingBefore,
      ])}`,
    },
  };
}

// ---------------------------------------------------------------------------
// Deterministic helpers.
// ---------------------------------------------------------------------------

function metricDelta(before: number, after: number): WhatIfMetricDelta {
  return {
    before,
    after,
    delta: after - before,
    deltaBps: bpsChange(before, after),
  };
}

/** Integer-bps change from before → after; null when not computable. */
function bpsChange(before: number, after: number): number | null {
  if (before === 0) return after === 0 ? 0 : null;
  return Math.floor(((after - before) * 10000) / before);
}

function utilizationBps(consumed: number, allocated: number): number {
  if (allocated === 0) return 0;
  return Math.floor((consumed * 10000) / allocated);
}
