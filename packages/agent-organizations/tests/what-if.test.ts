/**
 * @fleetos/agent-organizations — F260C what-if tests: purity (input snapshot
 * unchanged), projection correctness, delta bps, routing deltas, tenant
 * fail-closed, experimental-state markers, determinism.
 */
import { describe, expect, it } from "vitest";
import type { ModelDescriptor, ProviderRecord } from "@fleetos/model-gateway";
import {
  allocateRoles,
  optimizeRouting,
  projectWhatIf,
  rebalanceBudgets,
  type BudgetRebalanceProposal,
  type RoleAllocationProposal,
  type RoutingOptimizationProposal,
} from "../src/index.js";
import { buildProblem } from "./optimize-fixtures.js";

function realProposals() {
  const problem = buildProblem();
  const allocation = allocateRoles(problem, [
    { roleId: "role-ops", holders: 2 },
    { roleId: "role-legacy", holders: 1 },
  ]);
  if (!allocation.ok) throw new Error("allocation fixture failed");
  const rebalance = rebalanceBudgets(
    buildProblem({
      budgets: [
        {
          id: "bud-over",
          tenant: { tenantId: "acme" },
          scope: { kind: "role", refId: "role-ops" },
          capability: "model_invoke",
          allocatedUnits: 350,
          allocatedSpendMinor: 14000,
          consumedUnits: 0,
          consumedSpendMinor: 0,
          generation: 1,
        },
      ],
    }),
  );
  if (!rebalance.ok) throw new Error("rebalance fixture failed");
  return { problem, allocation: allocation.proposal, rebalance: rebalance.proposal };
}

describe("what-if — purity + experimental state", () => {
  it("never mutates the input snapshot or the proposals (deep-equal)", () => {
    const { problem, allocation, rebalance } = realProposals();
    const snapshotBefore = structuredClone(problem.snapshot);
    const allocationBefore = structuredClone(allocation);
    const rebalanceBefore = structuredClone(rebalance);
    const result = projectWhatIf({
      tenant: { tenantId: "acme" },
      snapshot: problem.snapshot,
      proposals: { roleAllocations: [allocation], budgetRebalances: [rebalance], routing: [] },
    });
    expect(result.ok).toBe(true);
    expect(problem.snapshot).toEqual(snapshotBefore);
    expect(allocation).toEqual(allocationBefore);
    expect(rebalance).toEqual(rebalanceBefore);
    if (!result.ok) return;
    expect(result.analysis.state).toBe("experimental-projection");
    expect(result.analysis.note).toBe("never-authoritative-org-state");
    expect(result.analysis.kind).toBe("what-if-analysis");
  });

  it("with no proposals the projection equals the baseline but is a NEW value", () => {
    const problem = buildProblem();
    const result = projectWhatIf({
      tenant: { tenantId: "acme" },
      snapshot: problem.snapshot,
      proposals: { roleAllocations: [], budgetRebalances: [], routing: [] },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.analysis.projected).toEqual(problem.snapshot);
    expect(result.analysis.projected).not.toBe(problem.snapshot);
    expect(result.analysis.delta.allocatedUnits).toEqual({ before: 1500, after: 1500, delta: 0, deltaBps: 0 });
    expect(result.analysis.delta.applied).toEqual({ roleAssignments: 0, budgetAdjustments: 0 });
  });
});

describe("what-if — projection correctness (hand-computed)", () => {
  it("folds role assignments onto concurrent roles and budget adjustments onto totals", () => {
    const { problem, allocation, rebalance } = realProposals();
    const result = projectWhatIf({
      tenant: { tenantId: "acme" },
      snapshot: problem.snapshot,
      proposals: { roleAllocations: [allocation], budgetRebalances: [rebalance], routing: [] },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { projected, delta } = result.analysis;
    // Baseline: allocated 1500/75000, consumed 400/15000; bud-over expands
    // by +150 units / +6000 spend (role-scoped model_invoke over-utilized).
    expect(projected.budgetTotals).toEqual({
      allocatedUnits: 1650,
      consumedUnits: 400,
      allocatedSpendMinor: 81000,
      consumedSpendMinor: 15000,
    });
    expect(delta.allocatedUnits).toEqual({ before: 1500, after: 1650, delta: 150, deltaBps: 1000 });
    expect(delta.consumedUnits).toEqual({ before: 400, after: 400, delta: 0, deltaBps: 0 });
    expect(delta.utilizationUnitsBps).toEqual({ before: 2666, after: 2424 });
    expect(delta.applied).toEqual({ roleAssignments: 3, budgetAdjustments: 1 });
    // Concurrent roles: baseline {agent-3: 1} + 3 assignments.
    expect(projected.concurrentRolesByAgent).toEqual({ "agent-1": 1, "agent-2": 1, "agent-3": 2 });
    expect(delta.concurrentRoles).toEqual([
      { agentId: "agent-1", before: 0, after: 1, delta: 1 },
      { agentId: "agent-2", before: 0, after: 1, delta: 1 },
      { agentId: "agent-3", before: 1, after: 2, delta: 1 },
    ]);
    // The projected digest follows the package's own fold convention.
    expect(projected.digest).toMatch(/^orgsnap_[0-9a-f]{8}$/);
    expect(projected.digest).not.toBe(problem.snapshot.digest);
  });

  it("refuses a projection that would invalidate the budget invariants", () => {
    // A reclaim far below the snapshot's totals → projected allocation < 0.
    const reclaimProblem = buildProblem({
      budgets: [
        {
          id: "bud-huge",
          tenant: { tenantId: "acme" },
          scope: { kind: "agent", refId: "agent-3" },
          capability: "legacy_scan",
          allocatedUnits: 100000,
          allocatedSpendMinor: 100000,
          consumedUnits: 0,
          consumedSpendMinor: 0,
          generation: 1,
        },
      ],
    });
    const rebalance = rebalanceBudgets(reclaimProblem);
    if (!rebalance.ok) throw new Error("rebalance fixture failed");
    expect(rebalance.proposal.adjustments[0]?.deltaUnits).toBe(-99983);
    const result = projectWhatIf({
      tenant: { tenantId: "acme" },
      snapshot: buildProblem().snapshot,
      proposals: { roleAllocations: [], budgetRebalances: [rebalance.proposal], routing: [] },
    });
    expect(result).toMatchObject({ ok: false, reasonCode: "PROJECTED_BUDGET_INVALID" });
  });

  it("aggregates routing before/after costs with integer-bps deltas", () => {
    // m-b is cheaper but sorts after m-a by id; both floor to the same
    // costBps against the huge m-z cost, so the frontier's id tie-break
    // picks m-a while the REAL gateway picks the strictly cheaper m-b.
    const registry: readonly ModelDescriptor[] = [
      { id: "m-a", providerId: "p1", capabilityTags: ["reasoning"], costPerUnitMinor: 101, maxContextUnits: 100000 },
      { id: "m-b", providerId: "p1", capabilityTags: ["reasoning"], costPerUnitMinor: 100, maxContextUnits: 100000 },
      { id: "m-z", providerId: "p1", capabilityTags: ["reasoning"], costPerUnitMinor: 1000000, maxContextUnits: 100000 },
    ];
    const providers: readonly ProviderRecord[] = [{ id: "p1", declaredModels: ["m-a", "m-b", "m-z"], health: "healthy" }];
    const routing = optimizeRouting(buildProblem(), {
      registry,
      providers,
      degradationHistory: [],
      requestClasses: [
        { classId: "class-r", requiredCapabilities: ["reasoning"], estimatedUnits: 1000, priority: 4, budgetCeilingMinor: 150000 },
      ],
      ladders: [],
    });
    if (!routing.ok) throw new Error("routing fixture failed");
    const perClass = routing.proposal.perClass[0];
    if (!perClass) throw new Error("missing class");
    expect(perClass.current.selectedModelId).toBe("m-b");
    expect(perClass.proposed.selectedModelId).toBe("m-a");
    expect(perClass.current.estimatedCostMinor).toBe(100000);
    expect(perClass.proposed.estimatedCostMinor).toBe(101000);
    const result = projectWhatIf({
      tenant: { tenantId: "acme" },
      snapshot: buildProblem().snapshot,
      proposals: { roleAllocations: [], budgetRebalances: [], routing: [routing.proposal] },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.analysis.routingDeltas).toEqual([
      { classId: "class-r", currentCostMinor: 100000, proposedCostMinor: 101000 },
    ]);
    expect(result.analysis.delta.routingCostMinor).toEqual({ before: 100000, after: 101000, deltaBps: 100 });
  });
});

describe("what-if — fail-closed + determinism", () => {
  it("fails closed on tenant mismatches", () => {
    const { problem, allocation } = realProposals();
    const foreign: RoleAllocationProposal = { ...allocation, tenantId: "globex" };
    expect(projectWhatIf({
      tenant: { tenantId: "acme" },
      snapshot: problem.snapshot,
      proposals: { roleAllocations: [foreign], budgetRebalances: [], routing: [] },
    })).toMatchObject({ ok: false, reasonCode: "WHATIF_TENANT_MISMATCH" });
    const { rebalance } = realProposals();
    const foreignRebalance: BudgetRebalanceProposal = { ...rebalance, tenantId: "globex" };
    expect(projectWhatIf({
      tenant: { tenantId: "acme" },
      snapshot: problem.snapshot,
      proposals: { roleAllocations: [], budgetRebalances: [foreignRebalance], routing: [] },
    })).toMatchObject({ ok: false, reasonCode: "WHATIF_TENANT_MISMATCH" });
    expect(projectWhatIf({
      tenant: { tenantId: "" },
      snapshot: problem.snapshot,
      proposals: { roleAllocations: [], budgetRebalances: [], routing: [] },
    })).toMatchObject({ ok: false, reasonCode: "TENANT_SCOPE_MISSING" });
  });

  it("refuses a tampered snapshot (digest mismatch) and foreign snapshot tenants", () => {
    const problem = buildProblem();
    const tampered = {
      ...problem.snapshot,
      budgetTotals: { ...problem.snapshot.budgetTotals, allocatedUnits: 9999 },
    };
    expect(projectWhatIf({
      tenant: { tenantId: "acme" },
      snapshot: tampered,
      proposals: { roleAllocations: [], budgetRebalances: [], routing: [] },
    })).toMatchObject({ ok: false, reasonCode: "SNAPSHOT_DIGEST_MISMATCH" });
    const foreignTenant = { ...problem.snapshot, tenantId: "globex" };
    expect(projectWhatIf({
      tenant: { tenantId: "acme" },
      snapshot: foreignTenant,
      proposals: { roleAllocations: [], budgetRebalances: [], routing: [] },
    })).toMatchObject({ ok: false, reasonCode: "WHATIF_TENANT_MISMATCH" });
  });

  it("is deterministic — identical inputs → byte-identical analyses", () => {
    const { problem, allocation, rebalance } = realProposals();
    const proposals = { roleAllocations: [allocation], budgetRebalances: [rebalance], routing: [] };
    const a = projectWhatIf({ tenant: { tenantId: "acme" }, snapshot: problem.snapshot, proposals });
    const b = projectWhatIf({ tenant: { tenantId: "acme" }, snapshot: problem.snapshot, proposals });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.ok && b.ok && a.analysis.digest).toBe(a.ok && b.ok && b.analysis.digest);
    expect(a.ok && b.ok && a.analysis.digest).toMatch(/^whatif_[0-9a-f]{8}$/);
  });

  it("composes the full optimizer chain end-to-end (allocator → rebalancer → routing → what-if)", () => {
    const { problem, allocation, rebalance } = realProposals();
    const routing = optimizeRouting(problem, {
      registry: [
        { id: "model-alpha", providerId: "p1", capabilityTags: ["reasoning", "summarize"], costPerUnitMinor: 100, maxContextUnits: 100000 },
      ],
      providers: [{ id: "p1", declaredModels: ["model-alpha"], health: "healthy" }],
      degradationHistory: [],
      requestClasses: [
        { classId: "class-a", requiredCapabilities: ["reasoning", "summarize"], estimatedUnits: 100, priority: 2, budgetCeilingMinor: 50000 },
      ],
      ladders: [{ modelId: "model-alpha", currentChainOrder: ["p1"] }],
    });
    if (!routing.ok) throw new Error("routing fixture failed");
    const routingProposal: RoutingOptimizationProposal = routing.proposal;
    const result = projectWhatIf({
      tenant: { tenantId: "acme" },
      snapshot: problem.snapshot,
      proposals: { roleAllocations: [allocation], budgetRebalances: [rebalance], routing: [routingProposal] },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.analysis.delta.applied).toEqual({ roleAssignments: 3, budgetAdjustments: 1 });
    expect(result.analysis.routingDeltas).toEqual([
      { classId: "class-a", currentCostMinor: 10000, proposedCostMinor: 10000 },
    ]);
    // The optimizers themselves never mutated the problem's snapshot.
    expect(problem.snapshot.budgetTotals.allocatedUnits).toBe(1500);
    expect(problem.snapshot.concurrentRolesByAgent).toEqual({ "agent-3": 1 });
  });
});
