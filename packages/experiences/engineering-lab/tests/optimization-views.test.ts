/**
 * F261 — optimization review queue tests: every entry derived VERBATIM from
 * the REAL lane proposals (totals, deltas in bps, digests equal direct lane
 * calls), Guardian-path markers structural on every entry, fail-closed
 * refusals, digest verify + tamper, determinism.
 */

import { describe, expect, it } from "vitest";
import {
  buildOptimizationReviewQueue,
  verifyOptimizationQueueDigest,
  type OptimizationReviewQueueView,
} from "../src/optimization-views.js";
import { PROPOSAL_ONLY_MARKER } from "../src/lab-core.js";
import { guardLabState } from "../src/lab-state.js";
import { LAB_NOW, makeLabState } from "./helpers.js";

const NOW = LAB_NOW;

function slice() {
  const guarded = guardLabState(makeLabState());
  if (!guarded.ok) throw new Error(`fixture slice refused: ${guarded.refused}`);
  return guarded.slice;
}

describe("optimization review queue", () => {
  it("presents one organization section carrying the REAL problem digest", () => {
    const s = slice();
    const result = buildOptimizationReviewQueue(s, { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.organizations).toHaveLength(1);
    const section = result.view.organizations[0]!;
    expect(section.organizationId).toBe("org-1");
    expect(section.problemDigest).toBe(s.optimizations[0]!.problem.digest);
  });

  it("role-allocation entries carry the REAL proposal totals + scoring-trace counts", () => {
    const s = slice();
    const proposal = s.optimizations[0]!.roleAllocations[0]!;
    const result = buildOptimizationReviewQueue(s, { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const entry = result.view.organizations[0]!.roleAllocations[0]!;
    expect(entry.digest).toBe(proposal.digest);
    expect(entry.assignedCount).toBe(proposal.totals.assignedCount);
    expect(entry.totalFitBps).toBe(proposal.totals.totalFitBps);
    expect(entry.totalProjectedUnits).toBe(proposal.totals.totalProjectedUnits);
    expect(entry.totalProjectedSpendMinor).toBe(proposal.totals.totalProjectedSpendMinor);
    expect(entry.refusalCount).toBe(proposal.refusals.length);
    expect(entry.unfilledDemandCount).toBe(proposal.unfilledDemand.length);
    expect(entry.traceEntryCount).toBe(proposal.scoringTrace.length);
    expect(entry.localSearchSwapCount).toBe(proposal.localSearchSwaps.length);
    expect(entry.excludedAgentCount).toBe(proposal.excludedAgents.length);
  });

  it("budget entries carry utilization deltas VERBATIM from the REAL proposal", () => {
    const s = slice();
    const proposal = s.optimizations[0]!.budgetRebalances[0]!;
    const result = buildOptimizationReviewQueue(s, { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const entry = result.view.organizations[0]!.budgetRebalances[0]!;
    expect(entry.digest).toBe(proposal.digest);
    expect(entry.adjustments).toEqual(
      proposal.adjustments.map((a) => ({
        budgetId: a.budgetId,
        capability: a.capability,
        band: a.band,
        reasonCode: a.reasonCode,
        deltaUnits: a.deltaUnits,
        deltaSpendMinor: a.deltaSpendMinor,
        revoked: a.revoked,
      })),
    );
    expect(entry.refusalCount).toBe(proposal.refusals.length);
    expect(entry.skippedCount).toBe(proposal.skipped.length);
  });

  it("routing entries present current vs proposed per class + ladder reorders", () => {
    const s = slice();
    const proposal = s.optimizations[0]!.routing[0]!;
    const result = buildOptimizationReviewQueue(s, { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const entry = result.view.organizations[0]!.routing[0]!;
    expect(entry.digest).toBe(proposal.digest);
    expect(entry.perClass).toEqual(
      proposal.perClass.map((c) => ({
        classId: c.classId,
        orderingRule: c.orderingRule,
        currentModelId: c.current.selectedModelId,
        proposedModelId: c.proposed.selectedModelId,
        proposedReasonCode: c.proposed.reasonCode,
        frontierCount: c.frontier.length,
        infeasibleCount: c.infeasible.length,
      })),
    );
    expect(entry.ladderProposals[0]).toMatchObject({ modelId: "model-alpha" });
    expect(entry.ladderProposals[0]!.currentChainOrder).toEqual(["p1", "p2", "p3"]);
  });

  it("what-if entries present before/after deltas in bps VERBATIM", () => {
    const s = slice();
    const whatIf = s.optimizations[0]!.whatIfs[0]!;
    const result = buildOptimizationReviewQueue(s, { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const entry = result.view.organizations[0]!.whatIfs[0]!;
    expect(entry.digest).toBe(whatIf.digest);
    expect(entry.allocatedUnits).toEqual(whatIf.delta.allocatedUnits);
    expect(entry.allocatedSpendMinor).toEqual(whatIf.delta.allocatedSpendMinor);
    expect(entry.utilizationUnitsBps).toEqual(whatIf.delta.utilizationUnitsBps);
    expect(entry.routingCostMinor).toEqual(whatIf.delta.routingCostMinor);
    expect(entry.applied).toEqual(whatIf.delta.applied);
    expect(typeof entry.allocatedUnits.deltaBps).toBe("number");
  });

  it("carries the Guardian-path marker STRUCTURALLY on every entry and the queue", () => {
    const result = buildOptimizationReviewQueue(slice(), { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const view = result.view;
    expect(view.proposal).toBe(true);
    expect(view.guardianPath).toBe(PROPOSAL_ONLY_MARKER);
    for (const section of view.organizations) {
      for (const e of section.roleAllocations) {
        expect(e.proposal).toBe(true);
        expect(e.guardianPath).toBe(PROPOSAL_ONLY_MARKER);
      }
      for (const e of section.budgetRebalances) {
        expect(e.proposal).toBe(true);
        expect(e.guardianPath).toBe(PROPOSAL_ONLY_MARKER);
      }
      for (const e of section.routing) {
        expect(e.proposal).toBe(true);
        expect(e.guardianPath).toBe(PROPOSAL_ONLY_MARKER);
      }
      for (const e of section.whatIfs) {
        expect(e.proposal).toBe(true);
        expect(e.guardianPath).toBe(PROPOSAL_ONLY_MARKER);
      }
    }
    // @ts-expect-error — an applied marker is not assignable to the proposal literal
    const applied: OptimizationReviewQueueView["proposal"] = false;
    expect(applied).toBe(false);
  });

  it("totals count every proposal kind across organizations", () => {
    const result = buildOptimizationReviewQueue(slice(), { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.totals).toEqual({
      roleAllocationProposals: 1,
      budgetRebalanceProposals: 1,
      routingProposals: 1,
      whatIfAnalyses: 1,
    });
  });

  it("refuses a cross-tenant slice, surfacing the guard's own code verbatim", () => {
    const bad = makeLabState();
    const opt = bad.optimizations[0]!;
    const proposal = { ...opt.roleAllocations[0]!, tenantId: "tenant-other" };
    const result = buildOptimizationReviewQueue(
      { ...bad, optimizations: [{ ...opt, roleAllocations: [proposal] }] },
      { now: NOW },
    );
    expect(result).toMatchObject({ ok: false, refused: "lab-state-refused", guardCode: "cross-tenant-ref" });
  });

  it("digest verifies and detects tampering", () => {
    const result = buildOptimizationReviewQueue(slice(), { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(verifyOptimizationQueueDigest(result.view)).toBe(true);
    const tampered = {
      ...result.view,
      organizations: [
        { ...result.view.organizations[0]!, problemDigest: "tampered" },
        ...result.view.organizations.slice(1),
      ],
    };
    expect(verifyOptimizationQueueDigest(tampered)).toBe(false);
  });

  it("is byte-identical for identical inputs (pure fold, same digest)", () => {
    const a = buildOptimizationReviewQueue(slice(), { now: NOW });
    const b = buildOptimizationReviewQueue(slice(), { now: NOW });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(JSON.stringify(a.view)).toBe(JSON.stringify(b.view));
    expect(a.view.digest).toBe(b.view.digest);
  });
});
