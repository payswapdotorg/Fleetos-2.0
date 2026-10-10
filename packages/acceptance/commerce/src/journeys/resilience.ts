/**
 * @fleetos/acceptance-commerce — resilience journeys (F310C, Wave 11
 * lane C).
 *
 * Two genuinely distinct journeys over REAL public APIs:
 *   1. provider-fallback-ladder — outage routing: the fallback ladder
 *      records a reason code at EVERY hop (selected / provider-down /
 *      provider-missing-model / not-attempted / unknown-provider), and
 *      degraded-mode classification is honest (full / partial /
 *      emergency-only with exact serving counts).
 *   2. budget-rebalance-proposal — capability budgets across utilization
 *      bands: the REAL rebalancer PROPOSES bounded adjustments (expand
 *      toward the 6000bps target within ceilings), refuses ceiling /
 *      consumption / revoked violations with exact overshoots, and skips
 *      healthy budgets — a proposal, never a mutation.
 */

import type { AcceptanceJourney, FactValue } from "../journey-contracts.js";

const eq = (id: string, fact: string, expected: FactValue, description: string) =>
  ({ id, description, fact, op: "eq" as const, expected });
const deq = (id: string, fact: string, expected: readonly string[], description: string) =>
  ({ id, description, fact, op: "deepEq" as const, expected });

export const providerFallbackLadderJourney: AcceptanceJourney = {
  id: "provider-fallback-ladder",
  persona: "org-optimizer",
  capability: "model-gateway-routing",
  goal: "Route a model request through a provider outage: the fallback ladder records why at every hop, selects the first healthy provider that declares the model, and the gateway's degraded mode classifies honestly with exact serving counts.",
  steps: [
    { stepId: "s1", kind: "gw-fallback-ladder", factKey: "outage", modelId: "m-fallback",
      providers: [
        { id: "p-prim", declaredModels: ["m-fallback"], health: "down" },
        { id: "p-sec", declaredModels: ["m-fallback"], health: "healthy" },
        { id: "p-tert", declaredModels: ["m-other"], health: "healthy" },
      ],
      chainOrder: ["p-prim", "p-sec", "p-tert"] },
    { stepId: "s2", kind: "gw-fallback-ladder", factKey: "nobody", modelId: "m-other",
      providers: [
        { id: "p-prim", declaredModels: ["m-fallback"], health: "down" },
        { id: "p-sec", declaredModels: ["m-fallback"], health: "healthy" },
      ],
      chainOrder: ["p-prim", "p-sec"] },
    { stepId: "s3", kind: "gw-fallback-ladder", factKey: "unknown", modelId: "m-fallback",
      providers: [
        { id: "p-sec", declaredModels: ["m-fallback"], health: "healthy" },
      ],
      chainOrder: ["p-ghost", "p-sec"] },
    { stepId: "s4", kind: "gw-fallback-ladder", factKey: "empty", modelId: "m-fallback",
      providers: [], chainOrder: [] },
    { stepId: "s5", kind: "gw-degraded-mode", factKey: "full",
      providers: [
        { id: "p-a", declaredModels: ["m-1"], health: "healthy" },
        { id: "p-b", declaredModels: ["m-1"], health: "healthy" },
        { id: "p-c", declaredModels: ["m-1"], health: "healthy" },
      ] },
    { stepId: "s6", kind: "gw-degraded-mode", factKey: "partial",
      providers: [
        { id: "p-a", declaredModels: ["m-1"], health: "healthy" },
        { id: "p-b", declaredModels: ["m-1"], health: "degraded" },
        { id: "p-c", declaredModels: ["m-1"], health: "down" },
      ] },
    { stepId: "s7", kind: "gw-degraded-mode", factKey: "emergency",
      providers: [
        { id: "p-a", declaredModels: ["m-1"], health: "degraded" },
        { id: "p-b", declaredModels: ["m-1"], health: "down" },
      ] },
    { stepId: "s8", kind: "gw-degraded-mode", factKey: "empty", providers: [] },
  ],
  assertions: [
    eq("a1", "gw.ladder.outage.ok", true, "the ladder resolves despite the primary being down"),
    eq("a2", "gw.ladder.outage.selectedProviderId", "p-sec", "the first healthy provider declaring the model is selected"),
    deq("a3", "gw.ladder.outage.hopReasons", ["1:p-prim:PROVIDER_DOWN", "2:p-sec:SELECTED", "3:p-tert:NOT_ATTEMPTED"], "EVERY hop carries its reason (down / selected / not-attempted)"),
    eq("a4", "gw.ladder.outage.hopCount", 3, "the whole chain is accounted for"),
    eq("a5", "gw.ladder.nobody.ok", false, "no provider able to serve refuses the resolution"),
    eq("a6", "gw.ladder.nobody.reasonCode", "NO_PROVIDER_CAN_SERVE", "the terminal refusal reason"),
    deq("a7", "gw.ladder.nobody.hopReasons", ["1:p-prim:PROVIDER_DOWN", "2:p-sec:PROVIDER_MISSING_MODEL"], "down and missing-model hops are both named"),
    eq("a8", "gw.ladder.unknown.ok", true, "an unknown provider in the chain does not sink the resolution"),
    deq("a9", "gw.ladder.unknown.hopReasons", ["1:p-ghost:UNKNOWN_PROVIDER", "2:p-sec:SELECTED"], "the unknown hop is named, selection still happens"),
    eq("a10", "gw.ladder.empty.ok", false, "an empty chain refuses"),
    eq("a11", "gw.ladder.empty.reasonCode", "LADDER_EMPTY", "the empty-ladder reason"),
    eq("a12", "gw.ladder.empty.hopCount", 0, "no hops exist to report"),
    eq("a13", "gw.degraded.full.mode", "full", "all-healthy providers classify full"),
    eq("a14", "gw.degraded.full.servingProviders", 3, "all three serve"),
    eq("a15", "gw.degraded.partial.mode", "partial", "mixed health classifies partial"),
    eq("a16", "gw.degraded.partial.healthyProviders", 1, "exactly one healthy"),
    eq("a17", "gw.degraded.partial.degradedProviders", 1, "exactly one degraded"),
    eq("a18", "gw.degraded.partial.downProviders", 1, "exactly one down"),
    eq("a19", "gw.degraded.partial.servingProviders", 2, "serving = healthy + degraded (down never serves)"),
    eq("a20", "gw.degraded.emergency.mode", "emergency-only", "no healthy provider classifies emergency-only"),
    eq("a21", "gw.degraded.emergency.servingProviders", 1, "only the degraded provider still serves"),
    eq("a22", "gw.degraded.empty.mode", "emergency-only", "an empty provider set is honestly emergency-only"),
    eq("a23", "gw.degraded.empty.servingProviders", 0, "zero serving providers — never invented"),
  ],
};

export const budgetRebalanceProposalJourney: AcceptanceJourney = {
  id: "budget-rebalance-proposal",
  persona: "org-optimizer",
  capability: "optimization-review",
  goal: "Capability budgets across utilization bands produce a rebalance PROPOSAL through the REAL rebalancer: over-utilized expands toward the 6000bps target within ceilings, exhausted-beyond-ceiling and revoked capabilities refuse with exact overshoots, live consumption is a hard wall on reclaims, and healthy budgets are skipped — proposal-only, never a mutation.",
  steps: [
    { stepId: "s1", kind: "org-journal-append", events: [
      { kind: "org-created" },
      { kind: "team-added", teamId: "team-1" },
      { kind: "agent-enrolled", agentId: "agent-1" },
      { kind: "agent-enrolled", agentId: "agent-2" },
      { kind: "agent-enrolled", agentId: "agent-5" },
      { kind: "agent-enrolled", agentId: "agent-9" },
      { kind: "budget-allocated", capability: "model_invoke", units: 600, spendMinor: 24_000 },
    ] },
    { stepId: "s2", kind: "org-budgets-seed", budgets: [
      { id: "bud-a", scopeKind: "agent", refId: "agent-1", capability: "model_invoke", allocatedUnits: 600, allocatedSpendMinor: 24_000, consumedUnits: 100, consumedSpendMinor: 4_000 },
      { id: "bud-b", scopeKind: "agent", refId: "agent-2", capability: "model_invoke", allocatedUnits: 700, allocatedSpendMinor: 28_000, consumedUnits: 0, consumedSpendMinor: 0 },
      { id: "bud-d", scopeKind: "agent", refId: "agent-4", capability: "legacy_scan", allocatedUnits: 400, allocatedSpendMinor: 16_000, consumedUnits: 390, consumedSpendMinor: 15_600 },
      { id: "bud-e", scopeKind: "agent", refId: "agent-5", capability: "retired_cap", allocatedUnits: 600, allocatedSpendMinor: 24_000, consumedUnits: 10, consumedSpendMinor: 400 },
      { id: "bud-f", scopeKind: "agent", refId: "agent-9", capability: "summarize", allocatedUnits: 400, allocatedSpendMinor: 16_000, consumedUnits: 0, consumedSpendMinor: 0 },
    ] },
    { stepId: "s3", kind: "usage-append", requestRef: "req-rb-1", agentId: "agent-1", modelId: "m-1", providerId: "p-a", capability: "model_invoke", units: 500, costMinor: 20_000 },
    { stepId: "s4", kind: "usage-append", requestRef: "req-rb-2", agentId: "agent-2", modelId: "m-1", providerId: "p-a", capability: "model_invoke", units: 700, costMinor: 28_000 },
    { stepId: "s5", kind: "usage-append", requestRef: "req-rb-3", agentId: "agent-5", modelId: "m-2", providerId: "p-b", capability: "retired_cap", units: 500, costMinor: 20_000 },
    { stepId: "s6", kind: "usage-append", requestRef: "req-rb-4", agentId: "agent-9", modelId: "m-3", providerId: "p-c", capability: "summarize", units: 200, costMinor: 8_000 },
    { stepId: "s7", kind: "org-prepare-optimization", revokedCapabilities: ["retired_cap"] },
    { stepId: "s8", kind: "org-budget-rebalance", factKey: "main" },
  ],
  assertions: [
    eq("a1", "journal.entries", 7, "the org journal carries the seven seeded events"),
    eq("a2", "journal.enrolledAgents", 4, "four agents are enrolled"),
    eq("a3", "org.budgets.seed.count", 5, "five capability budgets are seeded"),
    deq("a4", "org.budgets.seed.consumedBands", ["bud-a:under-utilized", "bud-b:under-utilized", "bud-d:over-utilized", "bud-e:under-utilized", "bud-f:under-utilized"], "the REAL band classifier reads consumption at seed time"),
    eq("a5", "usage.ok", true, "every usage append passes the REAL agent-budget ceiling fold"),
    eq("a6", "usage.chainOk", true, "the usage ledger chain verifies"),
    eq("a7", "usage.entryCount", 4, "four usage entries accumulate"),
    eq("a8", "opt.prepare.ok", true, "the REAL optimization problem prepares over journal + usage + budgets"),
    eq("a9", "opt.prepare.usageEntries", 4, "the problem carries all four usage entries"),
    eq("a10", "org.rebalance.main.ok", true, "the REAL rebalancer produces a proposal"),
    eq("a11", "org.rebalance.main.note", "proposal-only-guardian-path", "the proposal declares its proposal-only nature"),
    eq("a12", "org.rebalance.main.adjustmentCount", 1, "exactly one budget adjusts (bud-a, the over-utilized one)"),
    deq("a13", "org.rebalance.main.adjustments", ["bud-a:over-utilized-expand:+234/+9334"], "bud-a expands by the exact deltas toward the 6000bps target"),
    eq("a14", "org.rebalance.main.firstTargetUnits", 834, "the target allocation is ceil(500*10000/6000) = 834"),
    eq("a15", "org.rebalance.main.firstIdempotencyKeyPrefix", "rebal_", "each adjustment carries a deterministic rebal_ idempotency key"),
    deq("a16", "org.rebalance.main.refusals", [
      "bud-b:units:ROLE_BUDGET_UNITS_CEILING_EXCEEDED+167",
      "bud-d:units:CONSUMPTION_EXCEEDS_ALLOCATION+390",
      "bud-d:spend:CONSUMPTION_EXCEEDS_ALLOCATION+15600",
      "bud-e:units:CAPABILITY_REVOKED+234",
      "bud-e:spend:CAPABILITY_REVOKED+9334",
    ], "ceiling, consumption-wall, and revoked-capability refusals are exact — overshoots verbatim"),
    deq("a17", "org.rebalance.main.skipped", ["bud-f"], "the healthy budget is skipped with healthy-no-change"),
    eq("a18", "org.rebalance.main.budgetsUnchanged", true, "the proposal mutates NOTHING — the input budgets are untouched"),
  ],
};

export const RESILIENCE_JOURNEYS: readonly AcceptanceJourney[] = [
  providerFallbackLadderJourney,
  budgetRebalanceProposalJourney,
];
