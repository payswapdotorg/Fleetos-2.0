/**
 * @fleetos/acceptance-commerce — model-gateway routing and role-assignment
 * journeys (F300C, Wave 10).
 *
 *   - gateway-routing: the REAL deterministic model routing (capability
 *     match, priority ordering rules), the over-limit refusals made
 *     VISIBLE (budget ceiling, quota requests/units exhaustion, the
 *     org-budget refusal behind usage appends), burn projection with
 *     explicit assumptions and honest severity, and provider cost
 *     comparison against REAL ledger sums.
 *   - role-assignment-handoff: the REAL assignRole /
 *     transitionRoleAssignment lifecycle — assign → activate → relieve
 *     with the concurrency ceiling, duplicate-id, tenant-mismatch and
 *     terminal-state refusals, projected onto the role assignment board.
 */

import type { AcceptanceJourney, FactValue } from "../journey-contracts.js";
import { CLOCK } from "../journey-world.js";

const eq = (id: string, fact: string, expected: FactValue, description: string) =>
  ({ id, description, fact, op: "eq" as const, expected });
const deq = (id: string, fact: string, expected: readonly string[], description: string) =>
  ({ id, description, fact, op: "deepEq" as const, expected });

export const gatewayRoutingJourney: AcceptanceJourney = {
  id: "gateway-routing",
  persona: "org-optimizer",
  capability: "model-gateway-routing",
  goal:
    "Route model requests through the REAL gateway: deterministic selection with recorded ordering rules, over-limit refusals visible (budget ceiling, quota exhaustion, org budget), burn projection with assumptions, and provider cost comparison over REAL usage.",
  steps: [
    { stepId: "s1", kind: "usage-append", requestRef: "req-gw-1", agentId: "agent-1", modelId: "model-alpha-rich", providerId: "provider-one", capability: "model_invoke", units: 100, costMinor: 4_000 },
    { stepId: "s2", kind: "usage-append", requestRef: "req-gw-2", agentId: "agent-1", modelId: "model-alpha-rich", providerId: "provider-one", capability: "model_invoke", units: 150, costMinor: 2_000 },
    { stepId: "s3", kind: "gw-select-model", requiredCapabilities: ["summarize"], priority: 1, budgetCeilingMinor: 100_000, estimatedUnits: 100 },
    { stepId: "s4", kind: "gw-select-model", requiredCapabilities: ["summarize"], priority: 5, budgetCeilingMinor: 100_000, estimatedUnits: 100 },
    { stepId: "s5", kind: "gw-select-model", requiredCapabilities: ["summarize", "analytics"], priority: 3, budgetCeilingMinor: 300, estimatedUnits: 100 },
    { stepId: "s6", kind: "gw-select-model", requiredCapabilities: ["telepathy"], priority: 3, budgetCeilingMinor: 100_000, estimatedUnits: 100 },
    { stepId: "s7", kind: "gw-quota-request", at: CLOCK.t1, units: 100 },
    { stepId: "s8", kind: "gw-quota-request", at: CLOCK.t2, units: 150 },
    { stepId: "s9", kind: "gw-quota-request", at: 20_000, units: 10 },
    { stepId: "s10", kind: "gw-quota-request", at: CLOCK.t3, units: 10 },
    { stepId: "s11", kind: "gw-burn-projection", ceilingMinor: 10_000, schedule: [
      { label: "w1-batch", units: 200, costMinor: 3_000, at: CLOCK.t4, assumption: "two daily batches at current mix" },
      { label: "w2-batch", units: 200, costMinor: 3_000, at: CLOCK.t5, assumption: "two daily batches at current mix" },
    ] },
    { stepId: "s12", kind: "gw-burn-projection", ceilingMinor: 9_000, schedule: [
      { label: "w1-batch", units: 200, costMinor: 3_000, at: CLOCK.t4, assumption: "two daily batches at current mix" },
      { label: "w2-batch", units: 200, costMinor: 3_000, at: CLOCK.t5, assumption: "two daily batches at current mix" },
    ] },
    { stepId: "s13", kind: "gw-cost-comparison", quotes: [
      { providerId: "provider-one", modelId: "model-alpha-rich", unitCostMinor: 5 },
      { providerId: "provider-two", modelId: "model-gamma-analytic", unitCostMinor: 8 },
    ] },
    { stepId: "s14", kind: "usage-rollup-view", computedAt: CLOCK.now },
  ],
  assertions: [
    eq("a1", "usage.ok", false, "the second usage append is refused by the REAL agent budget — over-limit refusal visible"),
    deq("a2", "usage.log", ["true:1", "false:BUDGET_REFUSED_BY_ORG:UNITS_EXHAUSTED"], "the first append commits at the ceiling; the second exceeds the org's unit budget"),
    deq("a3", "gw.select.log", [
      "ok:model-gamma-analytic:urgency-richness-first",
      "ok:model-beta-cheap:urgency-cost-first",
      "refused:BUDGET_CEILING_EXCEEDED",
      "refused:NO_MODEL_WITH_CAPABILITIES",
    ], "priority 1 selects the richest model, priority 5 the cheapest, the tight ceiling refuses with the exact overshoot available, and no model carries the asked capability"),
    eq("a4", "gw.select.modelId", null, "the final selection (unknown capability) selects nothing"),
    eq("a5", "gw.select.reasonCode", "NO_MODEL_WITH_CAPABILITIES", "the final selection refuses with the domain's reason code"),
    eq("a6", "gw.select.candidatesConsidered", 3, "the whole registry was considered before the capability refusal was recorded"),
    deq("a7", "gw.quota.log", [
      "ok:1:200",
      "ok:0:50",
      "refused:REQUEST_OUTSIDE_WINDOW",
      "refused:QUOTA_REQUESTS_EXHAUSTED",
    ], "the quota window accepts two requests, refuses outside-window traffic, then refuses the third in-window request on request count"),
    eq("a8", "gw.quota.overshootRequests", 1, "the request-count refusal reports the exact overshoot of one request"),
    eq("a9", "gw.quota.requestsAccepted", 2, "the window state honestly records exactly two accepted requests"),
    eq("a10", "gw.quota.unitsConsumed", 250, "the window state honestly records the 250 consumed units"),
    eq("a11", "gw.burn.severity", "breach", "the second projection breaches the lowered ceiling — severity is honest"),
    eq("a12", "gw.burn.projectedTotalCostMinor", 10_000, "actuals (4,000) plus the two scheduled batches (6,000) project to 10,000 minor"),
    eq("a13", "gw.burn.projectedUtilizationBps", 11_111, "the breached projection computes floor(10000*10000/9000) = 11111 bps — never rounded"),
    eq("a14", "gw.burn.points", 2, "both schedule points project"),
    deq("a15", "gw.burn.assumptions", [
      "two daily batches at current mix",
      "two daily batches at current mix",
    ], "every burn point carries its assumption verbatim — uncertainty is explicit"),
    eq("a16", "gw.burn.projectionMarker", true, "the projection output is marked as a projection, never as fact"),
    deq("a17", "gw.cost.providerIds", ["provider-one", "provider-two"], "the comparison covers both quoted providers in lexical order"),
    deq("a18", "gw.cost.unquotedProviders", [], "no ledger provider is silently unquoted"),
    eq("a19", "gw.cost.firstUsageCostMinor", 4_000, "provider-one's REAL ledger spend is 4,000 minor"),
    eq("a20", "gw.cost.firstQuoteCostMinor", 500, "the quote-implied cost at the supplied price is 500 minor (5 × 100 units)"),
    eq("a21", "gw.cost.firstDeltaBps", 70_000, "the real-vs-quote delta is floor((4000-500)*10000/500) = 70000 bps"),
    eq("a22", "usageRollup.ok", true, "the usage rollup view still builds after the refusal"),
    eq("a23", "usageRollup.totalCostMinor", 4_000, "the rollup totals only the committed usage — the refused append never landed"),
  ],
};

export const roleAssignmentHandoffJourney: AcceptanceJourney = {
  id: "role-assignment-handoff",
  persona: "org-optimizer",
  capability: "role-assignment",
  goal:
    "Hand an agent's role through the REAL assignment lifecycle: assign → activate → relieve with the concurrency ceiling, duplicate-id, cross-tenant and terminal-state refusals — then see the board the host renders.",
  steps: [
    { stepId: "s1", kind: "org-assign-role", assignmentId: "ra-1", agentId: "agent-1", roleId: "role-ops" },
    { stepId: "s2", kind: "org-assign-role", assignmentId: "ra-1", agentId: "agent-2", roleId: "role-ops" },
    { stepId: "s3", kind: "org-assign-role", assignmentId: "ra-2", agentId: "agent-2", roleId: "role-ops" },
    { stepId: "s4", kind: "org-assign-role", assignmentId: "ra-3", agentId: "agent-2", roleId: "role-ops", maxConcurrentRoles: 1 },
    { stepId: "s5", kind: "org-assign-role", assignmentId: "ra-4", agentId: "agent-9", roleId: "role-ops", foreignTenant: true },
    { stepId: "s6", kind: "org-transition-role", command: "activate" },
    { stepId: "s7", kind: "org-transition-role", command: "relieve", reason: "shift rotation" },
    { stepId: "s8", kind: "org-transition-role", command: "activate" },
    { stepId: "s9", kind: "org-assign-role", assignmentId: "ra-5", agentId: "agent-3", roleId: "role-ops" },
    { stepId: "s10", kind: "org-transition-role", command: "activate" },
    { stepId: "s11", kind: "org-role-board", computedAt: CLOCK.now },
    { stepId: "s12", kind: "host-build-view-models", now: 1_774_000_000_000 },
  ],
  assertions: [
    deq("a1", "role.assign.log", [
      "ok:ra-1:assigned",
      "refused:DUPLICATE_ASSIGNMENT_ID:ra-1",
      "ok:ra-2:assigned",
      "refused:MAX_CONCURRENT_ROLES_EXCEEDED:exact-overshoot-1",
      "refused:TENANT_MISMATCH:ra-1",
      "ok:ra-5:assigned",
    ], "the REAL assignment lifecycle: assign, refuse duplicate ids, assign, refuse the concurrency ceiling, refuse cross-tenant, then assign the replacement holder"),
    deq("a2", "role.transition.log", [
      "ok:active",
      "ok:relieved",
      "refused:TERMINAL_STATE",
      "ok:active",
    ], "activate, relieve with reason, then the TERMINAL_STATE refusal on the relieved assignment, then the next assignment activates"),
    eq("a3", "role.transition.ok", true, "the final (activate) transition succeeds"),
    eq("a4", "roleBoard.ok", true, "the REAL role assignment board builds"),
    deq("a5", "roleBoard.activeIds", ["ra-5"], "the board shows the last assignment active"),
    deq("a6", "roleBoard.relievedIds", ["ra-2"], "the board shows the relieved assignment — the never-transitioned first assignment stays in the assigned column"),
    deq("a7", "host.roleBoard.activeIds", ["ra-5"], "the host surface's role board renders the same REAL active assignment"),
  ],
};

export const GATEWAY_JOURNEYS: readonly AcceptanceJourney[] = [
  gatewayRoutingJourney,
  roleAssignmentHandoffJourney,
];
