/**
 * @fleetos/experience-engineering-lab — the optimization review queue
 * (F261 deliverable 4).
 *
 * `buildOptimizationReviewQueue` presents every optimization artifact in
 * the guarded slice as a REVIEW-READY queue: role-allocation proposals
 * with their scoring traces, budget rebalancing proposals with
 * utilization deltas, routing frontier views, and what-if before/after
 * deltas in integer bps — every number VERBATIM from the REAL lane
 * proposals (never recomputed here).
 *
 * LAW (A5/A6, structural): every queue entry carries `proposal: true` and
 * the machine-carried Guardian-path marker — proposals are presented for
 * REVIEW ONLY and are NEVER applied by this shell; adoption flows through
 * the Guardian/governance path. Proposal digests are surfaced on every
 * entry for audit. Views only render GUARDED state (the guard's refusal
 * code surfaces verbatim). Deterministic: byte-identical for identical
 * inputs.
 */

import type {
  BudgetRebalanceProposal,
  RoleAllocationProposal,
  RoutingOptimizationProposal,
  WhatIfAnalysis,
} from "@fleetos/agent-organizations";
import { PROPOSAL_ONLY_MARKER, LAB_SCHEMA_VERSION, cmpString, labDigestOf } from "./lab-core.js";
import { guardLabState, type LabStateSlice } from "./lab-state.js";

export type OptimizationViewRefusal =
  | "lab-state-refused"
  | "invalid-now";

export type OptimizationViewResult<V> =
  | { readonly ok: true; readonly view: V }
  | {
      readonly ok: false;
      readonly refused: OptimizationViewRefusal;
      readonly detail: string;
      /** The guard's own code when the slice itself refused (verbatim). */
      readonly guardCode?: string;
    };

function refuse(refused: OptimizationViewRefusal, detail: string, guardCode?: string): OptimizationViewResult<never> {
  return guardCode === undefined
    ? { ok: false, refused, detail }
    : { ok: false, refused, detail, guardCode };
}

// ---------------------------------------------------------------------------
// Queue entry shapes (all REVIEW-READY proposals, never applied)
// ---------------------------------------------------------------------------

export interface RoleAllocationQueueEntry {
  readonly proposal: true;
  readonly guardianPath: typeof PROPOSAL_ONLY_MARKER;
  readonly digest: string;
  readonly organizationId: string;
  readonly assignedCount: number;
  readonly totalFitBps: number;
  readonly totalProjectedUnits: number;
  readonly totalProjectedSpendMinor: number;
  readonly refusalCount: number;
  readonly unfilledDemandCount: number;
  /** The proposal's full scoring trace length (audit surface). */
  readonly traceEntryCount: number;
  readonly localSearchSwapCount: number;
  readonly excludedAgentCount: number;
}

export interface BudgetRebalanceQueueEntry {
  readonly proposal: true;
  readonly guardianPath: typeof PROPOSAL_ONLY_MARKER;
  readonly digest: string;
  readonly organizationId: string;
  readonly adjustments: readonly {
    readonly budgetId: string;
    readonly capability: string;
    readonly band: string;
    readonly reasonCode: string;
    readonly deltaUnits: number;
    readonly deltaSpendMinor: number;
    readonly revoked: boolean;
  }[];
  readonly refusalCount: number;
  readonly skippedCount: number;
}

export interface RoutingQueueEntry {
  readonly proposal: true;
  readonly guardianPath: typeof PROPOSAL_ONLY_MARKER;
  readonly digest: string;
  readonly perClass: readonly {
    readonly classId: string;
    readonly orderingRule: string;
    readonly currentModelId: string | null;
    readonly proposedModelId: string | null;
    readonly proposedReasonCode: string;
    readonly frontierCount: number;
    readonly infeasibleCount: number;
  }[];
  readonly ladderProposals: readonly {
    readonly modelId: string;
    readonly currentChainOrder: readonly string[];
    readonly proposedChainOrder: readonly string[];
    readonly reasonCode: string;
  }[];
}

export interface WhatIfQueueEntry {
  readonly proposal: true;
  readonly guardianPath: typeof PROPOSAL_ONLY_MARKER;
  readonly digest: string;
  readonly organizationId: string;
  readonly allocatedUnits: { readonly before: number; readonly after: number; readonly delta: number; readonly deltaBps: number | null };
  readonly allocatedSpendMinor: { readonly before: number; readonly after: number; readonly delta: number; readonly deltaBps: number | null };
  readonly utilizationUnitsBps: { readonly before: number; readonly after: number };
  readonly routingCostMinor: { readonly before: number; readonly after: number; readonly deltaBps: number | null };
  readonly applied: { readonly roleAssignments: number; readonly budgetAdjustments: number };
}

export interface OptimizationOrganizationSection {
  readonly organizationId: string;
  readonly problemDigest: string;
  readonly roleAllocations: readonly RoleAllocationQueueEntry[];
  readonly budgetRebalances: readonly BudgetRebalanceQueueEntry[];
  readonly routing: readonly RoutingQueueEntry[];
  readonly whatIfs: readonly WhatIfQueueEntry[];
}

export interface OptimizationReviewQueueView {
  readonly schemaVersion: number;
  readonly tenantId: string;
  readonly asOf: number;
  /** Machine-carried review-only marker over the WHOLE queue. */
  readonly proposal: true;
  readonly guardianPath: typeof PROPOSAL_ONLY_MARKER;
  readonly organizations: readonly OptimizationOrganizationSection[];
  readonly totals: {
    readonly roleAllocationProposals: number;
    readonly budgetRebalanceProposals: number;
    readonly routingProposals: number;
    readonly whatIfAnalyses: number;
  };
  readonly digest: string;
}

// ---------------------------------------------------------------------------
// Entry derivations — verbatim from the REAL proposal records
// ---------------------------------------------------------------------------

function roleEntry(p: RoleAllocationProposal): RoleAllocationQueueEntry {
  return {
    proposal: true,
    guardianPath: PROPOSAL_ONLY_MARKER,
    digest: p.digest,
    organizationId: p.organizationId,
    assignedCount: p.totals.assignedCount,
    totalFitBps: p.totals.totalFitBps,
    totalProjectedUnits: p.totals.totalProjectedUnits,
    totalProjectedSpendMinor: p.totals.totalProjectedSpendMinor,
    refusalCount: p.refusals.length,
    unfilledDemandCount: p.unfilledDemand.length,
    traceEntryCount: p.scoringTrace.length,
    localSearchSwapCount: p.localSearchSwaps.length,
    excludedAgentCount: p.excludedAgents.length,
  };
}

function budgetEntry(p: BudgetRebalanceProposal): BudgetRebalanceQueueEntry {
  return {
    proposal: true,
    guardianPath: PROPOSAL_ONLY_MARKER,
    digest: p.digest,
    organizationId: p.organizationId,
    adjustments: p.adjustments.map((a) => ({
      budgetId: a.budgetId,
      capability: a.capability,
      band: a.band,
      reasonCode: a.reasonCode,
      deltaUnits: a.deltaUnits,
      deltaSpendMinor: a.deltaSpendMinor,
      revoked: a.revoked,
    })),
    refusalCount: p.refusals.length,
    skippedCount: p.skipped.length,
  };
}

function routingEntry(p: RoutingOptimizationProposal): RoutingQueueEntry {
  return {
    proposal: true,
    guardianPath: PROPOSAL_ONLY_MARKER,
    digest: p.digest,
    perClass: p.perClass.map((c) => ({
      classId: c.classId,
      orderingRule: c.orderingRule,
      currentModelId: c.current.selectedModelId,
      proposedModelId: c.proposed.selectedModelId,
      proposedReasonCode: c.proposed.reasonCode,
      frontierCount: c.frontier.length,
      infeasibleCount: c.infeasible.length,
    })),
    ladderProposals: p.ladderProposals.map((l) => ({
      modelId: l.modelId,
      currentChainOrder: [...l.currentChainOrder],
      proposedChainOrder: [...l.proposedChainOrder],
      reasonCode: l.reasonCode,
    })),
  };
}

function whatIfEntry(w: WhatIfAnalysis): WhatIfQueueEntry {
  return {
    proposal: true,
    guardianPath: PROPOSAL_ONLY_MARKER,
    digest: w.digest,
    organizationId: w.organizationId,
    allocatedUnits: w.delta.allocatedUnits,
    allocatedSpendMinor: w.delta.allocatedSpendMinor,
    utilizationUnitsBps: w.delta.utilizationUnitsBps,
    routingCostMinor: w.delta.routingCostMinor,
    applied: w.delta.applied,
  };
}

// ---------------------------------------------------------------------------
// The queue
// ---------------------------------------------------------------------------

/** Present the optimization review queue (REVIEW-READY, never applied). */
export function buildOptimizationReviewQueue(
  slice: LabStateSlice,
  options: { readonly now: number },
): OptimizationViewResult<OptimizationReviewQueueView> {
  const guarded = guardLabState(slice);
  if (!guarded.ok) {
    return refuse("lab-state-refused", `lab state refused: ${guarded.detail}`, guarded.refused);
  }
  if (!Number.isInteger(options.now) || options.now <= 0) {
    return refuse("invalid-now", `logical now must be a positive integer, got ${String(options.now)}`);
  }
  const s = guarded.slice;
  const organizations: OptimizationOrganizationSection[] = s.optimizations.map((opt) => ({
    organizationId: opt.problem.organizationId,
    problemDigest: opt.problem.digest,
    roleAllocations: opt.roleAllocations.map(roleEntry).sort((a, b) => cmpString(a.digest, b.digest)),
    budgetRebalances: opt.budgetRebalances.map(budgetEntry).sort((a, b) => cmpString(a.digest, b.digest)),
    routing: opt.routing.map(routingEntry).sort((a, b) => cmpString(a.digest, b.digest)),
    whatIfs: opt.whatIfs.map(whatIfEntry).sort((a, b) => cmpString(a.digest, b.digest)),
  }));
  const view: OptimizationReviewQueueView = {
    schemaVersion: LAB_SCHEMA_VERSION,
    tenantId: s.tenantId,
    asOf: options.now,
    proposal: true,
    guardianPath: PROPOSAL_ONLY_MARKER,
    organizations,
    totals: {
      roleAllocationProposals: organizations.reduce((n, o) => n + o.roleAllocations.length, 0),
      budgetRebalanceProposals: organizations.reduce((n, o) => n + o.budgetRebalances.length, 0),
      routingProposals: organizations.reduce((n, o) => n + o.routing.length, 0),
      whatIfAnalyses: organizations.reduce((n, o) => n + o.whatIfs.length, 0),
    },
    digest: "",
  };
  return { ok: true, view: { ...view, digest: labDigestOf("optimization-queue", omitDigest(view)) } };
}

/** Recompute the queue digest; false means tampered queue content. */
export function verifyOptimizationQueueDigest(view: OptimizationReviewQueueView): boolean {
  const { digest: _omit, ...rest } = view;
  return labDigestOf("optimization-queue", rest) === view.digest;
}

function omitDigest(view: object): unknown {
  const { digest: _omit, ...rest } = view as Record<string, unknown>;
  return rest;
}
