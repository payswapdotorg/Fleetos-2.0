/**
 * F260C role-allocator tests: greedy + local-search determinism,
 * hand-computed fit/cost scores, ceiling refusals with exact overshoots.
 */
import { describe, expect, it } from "vitest";
import { appendUsage, type UsageLedgerEntry } from "@fleetos/model-gateway";
import {
  allocateRoles,
  prepareOptimizationInputs,
  type OptimizationInputs,
  type OrgJournalEntry,
  type RoleDemand,
} from "../src/index.js";
import { APPROVING_PORT, buildJournal, buildProblem, reseal } from "./optimize-fixtures.js";

/** A one-entry REAL gateway ledger for agent `agentId` (10 units / 100 minor). */
function oneEntry(agentId: string, requestRef: string) {
  const appended = appendUsage([], APPROVING_PORT, {
    tenantId: "acme",
    agentId,
    requestRef,
    modelId: "model-alpha",
    providerId: "p1",
    capability: "model_invoke",
    units: 10,
    costMinor: 100,
    at: 1,
  });
  if (!appended.ok) throw new Error(`fixture append failed: ${appended.reasonCode}`);
  return appended.ledger;
}

/** A cost-only (fit-blind greedy) single-role problem over a custom journal + excerpt. */
function blindProblem(
  journal: readonly OrgJournalEntry[],
  excerpt: readonly UsageLedgerEntry[],
  ceilings: OptimizationInputs["constraints"]["policyCeilings"],
) {
  return prepareOptimizationInputs({
    tenant: { tenantId: "acme" },
    organizationId: "org-1",
    journal,
    usageExcerpt: excerpt,
    roles: [{ id: "role-r", name: "R", capabilities: ["model_invoke"], responsibilities: [] }],
    budgets: [],
    goals: { costWeightBps: 10000, capabilityFitWeightBps: 0, latencyWeightBps: 0 },
    constraints: { policyCeilings: ceilings, budgetFloors: [], revokedCapabilities: [] },
  });
}

describe("role allocation — happy path + hand-computed scores", () => {
  it("assigns by weighted score with exact hand-computed fit/cost/score values", () => {
    const result = allocateRoles(buildProblem(), [
      { roleId: "role-ops", holders: 2 },
      { roleId: "role-legacy", holders: 1 },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { assignments } = result.proposal;
    expect(assignments).toHaveLength(3);
    const ops = assignments.filter((a) => a.roleId === "role-ops");
    expect(ops.map((a) => a.agentId).sort()).toEqual(["agent-1", "agent-2"]);
    // role-ops projection: mean(model_invoke)=150u/6000m + mean(summarize)=50u/2500m.
    for (const a of ops) {
      expect(a.projectedUnits).toBe(200);
      expect(a.projectedSpendMinor).toBe(8500);
      expect(a.fitBps).toBe(5000); // 1 of 2 capabilities demonstrated.
      expect(a.costBps).toBe(1700); // floor(8500 * 10000 / 50000).
      expect(a.scoreBps).toBe(5490); // floor((5000*6000 + 8300*3000) / 10000).
    }
    expect(assignments.find((a) => a.roleId === "role-legacy")).toMatchObject({
      agentId: "agent-3",
      fitBps: 10000,
      projectedUnits: 10,
      projectedSpendMinor: 500,
      scoreBps: 8970, // floor((10000*6000 + 9900*3000) / 10000).
    });
  });

  it("is deterministic — identical inputs → byte-identical proposals", () => {
    const problem = buildProblem();
    const demand: RoleDemand[] = [{ roleId: "role-ops", holders: 3 }];
    expect(JSON.stringify(allocateRoles(problem, demand))).toBe(
      JSON.stringify(allocateRoles(problem, demand)),
    );
  });

  it("emits the proposal vocabulary (kind + note + digest)", () => {
    const result = allocateRoles(buildProblem(), [{ roleId: "role-legacy", holders: 1 }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.kind).toBe("role-allocation-proposal");
    expect(result.proposal.note).toBe("proposal-only-guardian-path");
    expect(result.proposal.digest).toMatch(/^roalloc_[0-9a-f]{8}$/);
  });

  it("records the full scoring trace — one outcome per (agent, role) pair", () => {
    const result = allocateRoles(buildProblem(), [
      { roleId: "role-ops", holders: 1 },
      { roleId: "role-legacy", holders: 1 },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const trace = result.proposal.scoringTrace;
    // 3 candidates × 2 demanded roles = 6 trace entries.
    expect(trace).toHaveLength(6);
    expect(trace.filter((t) => t.outcome === "assigned")).toHaveLength(2);
    expect(trace.filter((t) => t.outcome === "not-selected")).toHaveLength(4);
    expect(trace.find((t) => t.agentId === "agent-1" && t.roleId === "role-ops")).toMatchObject({
      fitBps: 5000,
      outcome: "assigned",
    });
  });

  it("treats removed agents as excluded and never assigns them", () => {
    const problem = reseal(buildProblem(), {
      snapshot: { ...buildProblem().snapshot, removedAgents: ["agent-3"] },
    });
    const result = allocateRoles(problem, [{ roleId: "role-legacy", holders: 1 }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.excludedAgents).toEqual([{ agentId: "agent-3", reasonCode: "AGENT_REMOVED" }]);
    const assigned = result.proposal.assignments.map((a) => a.agentId);
    expect(assigned).not.toContain("agent-3");
    // The role is still filled — by the best remaining candidate (fit 0 is
    // a legal proposal; maximization picks what is available).
    expect(assigned).toEqual(["agent-1"]);
  });
});

describe("role allocation — hard constraint walls (never softened)", () => {
  it("refuses assignments that would exceed the per-role UNITS ceiling with the exact overshoot", () => {
    // 3 holders × 200 projected units; holder 3 lands at 600 > ceiling 500.
    const problem = reseal(buildProblem(), {
      constraints: {
        ...buildProblem().constraints,
        policyCeilings: { ...buildProblem().constraints.policyCeilings, maxRoleBudgetUnits: 500 },
      },
    });
    const result = allocateRoles(problem, [{ roleId: "role-ops", holders: 3 }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.assignments).toHaveLength(2);
    expect(result.proposal.refusals).toEqual([
      {
        agentId: "agent-3",
        roleId: "role-ops",
        reasonCode: "ROLE_BUDGET_UNITS_CEILING_EXCEEDED",
        overshoot: 100,
      },
    ]);
    expect(result.proposal.unfilledDemand).toEqual([
      { roleId: "role-ops", requestedHolders: 3, assignedHolders: 2, shortfall: 1 },
    ]);
  });

  it("refuses assignments that would exceed the per-role SPEND ceiling with the exact overshoot", () => {
    // 3 holders × 8500 projected spend; holder 3 lands at 25500 > 20000.
    const problem = reseal(buildProblem(), {
      constraints: {
        ...buildProblem().constraints,
        policyCeilings: { ...buildProblem().constraints.policyCeilings, maxRoleBudgetSpendMinor: 20000 },
      },
    });
    const result = allocateRoles(problem, [{ roleId: "role-ops", holders: 3 }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.assignments).toHaveLength(2);
    expect(result.proposal.refusals[0]).toMatchObject({
      reasonCode: "ROLE_BUDGET_SPEND_CEILING_EXCEEDED",
      overshoot: 5500,
    });
  });

  it("refuses assignments past the concurrent-roles ceiling — baseline roles count", () => {
    // agent-3 already holds 1 concurrent role in the folded snapshot; a
    // ceiling of 1 refuses the second assignment with the exact overshoot,
    // and the role falls to the next candidate instead of being softened.
    const problem = reseal(buildProblem(), {
      constraints: {
        ...buildProblem().constraints,
        policyCeilings: { ...buildProblem().constraints.policyCeilings, maxConcurrentRolesPerAgent: 1 },
      },
    });
    const result = allocateRoles(problem, [{ roleId: "role-legacy", holders: 1 }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.refusals).toEqual([
      {
        agentId: "agent-3",
        roleId: "role-legacy",
        reasonCode: "MAX_CONCURRENT_ROLES_EXCEEDED",
        overshoot: 1,
      },
    ]);
    expect(result.proposal.assignments.map((a) => a.agentId)).toEqual(["agent-1"]);
    expect(result.proposal.unfilledDemand).toEqual([]);
  });
});

describe("role allocation — local search + weight sensitivity", () => {
  it("local search reassigns to the strictly higher-fit agent when greedy is fit-blind", () => {
    // Cost-only goals make the greedy fit-blind (score order degenerates to
    // id order): greedy assigns agent-1; the local search then moves the
    // role to agent-2 — the only agent demonstrating model_invoke.
    const journal = buildJournal([
      { event: { kind: "org-created" }, at: 1 },
      { event: { kind: "agent-enrolled", agentId: "agent-1" }, at: 2 },
      { event: { kind: "agent-enrolled", agentId: "agent-2" }, at: 3 },
    ]);
    // REAL gateway ledger: one entry by agent-2 on model_invoke.
    const validation = blindProblem(journal, oneEntry("agent-2", "req-x"), {
      maxConcurrentRolesPerAgent: 2,
      maxRoleBudgetUnits: 1000,
      maxRoleBudgetSpendMinor: 50000,
      maxAgentsPerTeam: 5,
    });
    expect(validation.ok).toBe(true);
    if (!validation.ok) throw new Error(`fixture invalid: ${validation.reasonCode}`);
    const result = allocateRoles(validation.problem, [{ roleId: "role-r", holders: 1 }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Greedy picked agent-1 (equal scores, id order); local search moved the
    // role to agent-2 — the only agent demonstrating model_invoke.
    expect(result.proposal.assignments).toEqual([
      expect.objectContaining({ agentId: "agent-2", roleId: "role-r", fitBps: 10000 }),
    ]);
    const swaps = result.proposal.localSearchSwaps;
    // The swap is recorded — trace (greedy) + swaps reconcile to assignments.
    expect(swaps).toEqual([
      { roleId: "role-r", fromAgentId: "agent-1", toAgentId: "agent-2", fromFitBps: 0, toFitBps: 10000 },
    ]);
    const greedyAssigned = result.proposal.scoringTrace
      .filter((t) => t.outcome === "assigned")
      .map((t) => `${t.agentId}>${t.roleId}`);
    const swappedIn = swaps.map((s) => `${s.toAgentId}>${s.roleId}`);
    const swappedOut = swaps.map((s) => `${s.fromAgentId}>${s.roleId}`);
    expect(result.proposal.assignments.map((a) => `${a.agentId}>${a.roleId}`)).toEqual(
      [...greedyAssigned.filter((p) => !swappedOut.includes(p)), ...swappedIn].sort(),
    );
  });

  it("cost-heavy goals reorder the greedy queue by cost efficiency", () => {
    const problem = reseal(buildProblem(), {
      goals: { costWeightBps: 10000, capabilityFitWeightBps: 0, latencyWeightBps: 0 },
    });
    const result = allocateRoles(problem, [
      { roleId: "role-ops", holders: 1 },
      { roleId: "role-legacy", holders: 1 },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const trace = result.proposal.scoringTrace;
    // role-legacy costBps = 100 → score 9900; role-ops costBps = 1700 → 8300.
    expect(trace.find((t) => t.roleId === "role-legacy" && t.agentId === "agent-3")?.scoreBps).toBe(9900);
    expect(trace.find((t) => t.roleId === "role-ops" && t.agentId === "agent-1")?.scoreBps).toBe(8300);
  });
});

describe("role allocation — proposal record integrity", () => {
  it("assignments never contradict the refusals list (disjoint pairs)", () => {
    // 3 demanded holders under a 2-holder units ceiling: the third pair is
    // refused with the exact overshoot and NEVER re-enters via local search.
    const problem = reseal(buildProblem(), {
      constraints: {
        ...buildProblem().constraints,
        policyCeilings: { ...buildProblem().constraints.policyCeilings, maxRoleBudgetUnits: 500 },
      },
    });
    const result = allocateRoles(problem, [{ roleId: "role-ops", holders: 3 }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const refusedPairs = new Set(
      result.proposal.refusals.map((r) => `${r.agentId}>${r.roleId}`),
    );
    for (const assignment of result.proposal.assignments) {
      expect(refusedPairs.has(`${assignment.agentId}>${assignment.roleId}`)).toBe(false);
    }
    expect(refusedPairs.has("agent-3>role-ops")).toBe(true);
  });

  it("never swaps in a pair the greedy refused — even a strictly higher-fit one", () => {
    // Fit-blind greedy (cost-only goals): agent-1 (fit 0) is assigned first
    // by id order; agent-9 (fit 10000) is REFUSED at the 2nd holder slot by
    // the units ceiling. The local search MUST NOT repair that refusal —
    // swapping agent-9 in would be budget-neutral, but it would contradict
    // the refusals record. Ceilings are walls, never softened.
    const journal = buildJournal([
      { event: { kind: "org-created" }, at: 1 },
      { event: { kind: "agent-enrolled", agentId: "agent-1" }, at: 2 },
      { event: { kind: "agent-enrolled", agentId: "agent-9" }, at: 3 },
    ]);
    const validation = blindProblem(journal, oneEntry("agent-9", "req-guard"), {
      maxConcurrentRolesPerAgent: 2,
      maxRoleBudgetUnits: 15,
      maxRoleBudgetSpendMinor: 150,
      maxAgentsPerTeam: 5,
    });
    expect(validation.ok).toBe(true);
    if (!validation.ok) throw new Error(`fixture invalid: ${validation.reasonCode}`);
    const result = allocateRoles(validation.problem, [{ roleId: "role-r", holders: 2 }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.assignments).toEqual([
      expect.objectContaining({ agentId: "agent-1", roleId: "role-r", fitBps: 0 }),
    ]);
    expect(result.proposal.refusals).toEqual([
      { agentId: "agent-9", roleId: "role-r", reasonCode: "ROLE_BUDGET_UNITS_CEILING_EXCEEDED", overshoot: 5 },
    ]);
    expect(result.proposal.localSearchSwaps).toEqual([]);
    expect(result.proposal.unfilledDemand).toEqual([
      { roleId: "role-r", requestedHolders: 2, assignedHolders: 1, shortfall: 1 },
    ]);
    expect(
      result.proposal.scoringTrace.find((t) => t.agentId === "agent-9" && t.roleId === "role-r"),
    ).toMatchObject({ outcome: "refused", reasonCode: "ROLE_BUDGET_UNITS_CEILING_EXCEEDED" });
  });

  it("records no swaps when greedy is already fit-optimal (fit-weighted goals)", () => {
    const result = allocateRoles(buildProblem(), [
      { roleId: "role-ops", holders: 2 },
      { roleId: "role-legacy", holders: 1 },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.localSearchSwaps).toEqual([]);
    // Trace (greedy) equals the final assignments exactly — no amendments.
    expect(
      result.proposal.scoringTrace
        .filter((t) => t.outcome === "assigned")
        .map((t) => `${t.agentId}>${t.roleId}`)
        .sort(),
    ).toEqual(result.proposal.assignments.map((a) => `${a.agentId}>${a.roleId}`).sort());
  });

  it("local search never crosses the concurrent-roles ceiling", () => {
    // Ceiling 1 with one baseline concurrent role: agent-3 is refused
    // outright, the other two fill the demand, and the projected state
    // respects the ceiling for every agent.
    const problem = reseal(buildProblem(), {
      goals: { costWeightBps: 10000, capabilityFitWeightBps: 0, latencyWeightBps: 0 },
      constraints: {
        ...buildProblem().constraints,
        policyCeilings: { ...buildProblem().constraints.policyCeilings, maxConcurrentRolesPerAgent: 1 },
      },
    });
    const result = allocateRoles(problem, [{ roleId: "role-ops", holders: 3 }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.refusals).toEqual([
      { agentId: "agent-3", roleId: "role-ops", reasonCode: "MAX_CONCURRENT_ROLES_EXCEEDED", overshoot: 1 },
    ]);
    expect(result.proposal.assignments.map((a) => a.agentId).sort()).toEqual(["agent-1", "agent-2"]);
    // Baseline concurrency + proposed assignments stays within the ceiling.
    const projected: Record<string, number> = { ...problem.snapshot.concurrentRolesByAgent };
    for (const a of result.proposal.assignments) {
      projected[a.agentId] = (projected[a.agentId] ?? 0) + 1;
    }
    for (const [agentId, count] of Object.entries(projected)) {
      expect(count).toBeLessThanOrEqual(1);
      if (agentId === "agent-3") expect(count).toBe(1);
    }
  });
});

describe("role allocation — input refusals", () => {
  it("refuses duplicated role demand, unknown roles and bad holder counts", () => {
    const problem = buildProblem();
    expect(
      allocateRoles(problem, [
        { roleId: "role-ops", holders: 1 },
        { roleId: "role-ops", holders: 1 },
      ]),
    ).toMatchObject({ ok: false, reasonCode: "ROLE_DEMAND_DUPLICATED" });
    expect(allocateRoles(problem, [{ roleId: "role-ghost", holders: 1 }])).toMatchObject({
      ok: false,
      reasonCode: "UNKNOWN_ROLE",
    });
    expect(allocateRoles(problem, [{ roleId: "role-ops", holders: -1 }])).toMatchObject({
      ok: false,
      reasonCode: "NEGATIVE_AMOUNT",
    });
    expect(allocateRoles(problem, [{ roleId: "role-ops", holders: 1.5 }])).toMatchObject({
      ok: false,
      reasonCode: "NON_INTEGER_AMOUNT",
    });
  });

  it("refuses a tampered problem (digest mismatch)", () => {
    const problem = buildProblem();
    const tampered = { ...problem, goals: { ...problem.goals, costWeightBps: 1 } };
    expect(allocateRoles(tampered, [{ roleId: "role-ops", holders: 1 }])).toMatchObject({
      ok: false,
      reasonCode: "PROBLEM_DIGEST_MISMATCH",
    });
  });
});
