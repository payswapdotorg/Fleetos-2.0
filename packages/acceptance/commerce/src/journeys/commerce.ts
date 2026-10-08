/**
 * @fleetos/acceptance-commerce — commerce journeys.
 *
 * Journeys 5-9 of the corpus: the procurement spine, quote scoring,
 * order reconciliation, vendor management and software entitlements.
 * Every assertion targets a fact extracted from the REAL package outputs
 * by the step drivers.
 */

import type { AcceptanceJourney, FactValue } from "../journey-contracts.js";
import { CLOCK } from "../journey-world.js";

const eq = (id: string, fact: string, expected: FactValue, description: string) =>
  ({ id, description, fact, op: "eq" as const, expected });
const deq = (id: string, fact: string, expected: readonly string[], description: string) =>
  ({ id, description, fact, op: "deepEq" as const, expected });

export const procureSpineJourney: AcceptanceJourney = {
  id: "procure-spine",
  persona: "procurement-lead",
  capability: "procurement-spine",
  goal: "Run Need → Demand → Quote → Order → Fulfillment through the REAL approval gates and see the whole spine on the board with bps scoring visibility.",
  steps: [
    { stepId: "s1", kind: "demand-flow", command: "solicit", authorized: false, evidenceId: "ev-sol", evidenceTenantId: "acme" },
    { stepId: "s2", kind: "demand-flow", command: "solicit", authorized: true, evidenceId: "ev-sol", evidenceTenantId: "acme" },
    { stepId: "s3", kind: "quote-create", quoteId: "q-1", vendorId: "ven-1", unitCost: 12_00, totalCost: 120_00 },
    { stepId: "s4", kind: "quote-create", quoteId: "q-2", vendorId: "ven-2", unitCost: 15_00, totalCost: 150_00 },
    { stepId: "s5", kind: "quote-transition", quoteId: "q-1", command: "submit" },
    { stepId: "s6", kind: "quote-transition", quoteId: "q-2", command: "submit" },
    {
      stepId: "s7", kind: "quote-score-view", computedAt: CLOCK.now,
      quotes: [
        { quoteId: "q-1", vendorId: "ven-1", unitCostMinor: 1_200, totalCostMinor: 12_000, leadTimeDays: 3, capabilityTags: ["cold-chain", "gps"], submittedAtEpoch: 1_000 },
        { quoteId: "q-2", vendorId: "ven-2", unitCostMinor: 1_500, totalCostMinor: 15_000, leadTimeDays: 2, capabilityTags: ["cold-chain"], submittedAtEpoch: 1_000 },
      ],
    },
    { stepId: "s8", kind: "demand-flow", command: "award", authorized: true, evidenceId: "ev-award", evidenceTenantId: "acme" },
    { stepId: "s9", kind: "award-quote", quoteId: "q-1", authorized: true, evidenceId: "ev-award" },
    { stepId: "s10", kind: "order-transition", command: "confirm" },
    { stepId: "s11", kind: "order-transition", command: "ship" },
    { stepId: "s12", kind: "fulfillment-transition", command: "start_transit" },
    { stepId: "s13", kind: "fulfillment-transition", command: "deliver" },
    { stepId: "s14", kind: "fulfillment-transition", command: "verify", evidenceId: "ev-receipt", evidenceTenantId: "acme" },
    { stepId: "s15", kind: "order-transition", command: "receive" },
    { stepId: "s16", kind: "spine-board", computedAt: CLOCK.now },
  ],
  assertions: [
    deq("a1", "flow.log", ["false:AUTHORIZATION_DENIED", "true:solicited", "true:awarded"], "solicitation without authorization is refused, then gates open with authorization + evidence"),
    eq("a2", "quotes.ok", true, "the REAL quote score view builds"),
    eq("a3", "quotes.rank1QuoteId", "q-1", "the cheaper, fully-capable quote ranks first"),
    eq("a4", "quotes.rank1ScoreBps", 9_333, "the rank-1 score in integer bps (price 10000, terms 6666, capability 10000 at 5000/2000/3000 weights)"),
    deq("a6", "quotes.rankOrder", ["q-1", "q-2"], "the deterministic ranking is q-1 then q-2"),
    eq("a7", "award.orderStatus", "draft", "awarding a submitted quote creates a draft order carrying the authorization"),
    eq("a8", "award.authorizationId", "gd-allow-1", "the order carries the Guardian decision id"),
    deq("a9", "order.log", ["true:confirmed", "true:shipped", "true:received"], "the order moves confirmed → shipped → received"),
    deq("a10", "fulfillment.log", ["true:in_transit", "true:delivered", "true:verified"], "the fulfillment moves in_transit → delivered → verified"),
    eq("a11", "fulfillment.evidenceId", "ev-receipt", "verification recorded the evidence ref"),
    eq("a12", "spine.ok", true, "the REAL spine board builds"),
    eq("a13", "spine.needCount", 1, "the need is on the board"),
    eq("a14", "spine.demandCount", 1, "the demand is on the board"),
    deq("a15", "spine.quoteCountLines", ["submitted:2"], "both quotes show as submitted"),
    deq("a16", "spine.orderCountLines", ["received:1"], "the order shows received"),
    deq("a17", "spine.fulfillmentCountLines", ["verified:1"], "the fulfillment shows verified"),
    eq("a18", "spine.orderParent", "q-1", "the order card links to its quote"),
    eq("a19", "spine.fulfillmentParent", "order-1", "the fulfillment card links to its order"),
    eq("a20", "spine.cardCount", 6, "all five spine stages are visible (need, demand, 2 quotes, order, fulfillment)"),
    deq("a21", "spine.supersededQuotes", [], "no quote is superseded in this journey"),
  ],
};

export const quoteScoringJourney: AcceptanceJourney = {
  id: "quote-scoring",
  persona: "procurement-lead",
  capability: "quote-scoring",
  goal: "Multiple quotes are ranked deterministically with recorded tie-break rules, and identical inputs re-rank byte-identically.",
  steps: [
    {
      stepId: "s1", kind: "quote-score-view", computedAt: CLOCK.now,
      quotes: [
        { quoteId: "q-a", vendorId: "ven-a", unitCostMinor: 1_000, totalCostMinor: 10_000, leadTimeDays: 5, capabilityTags: ["cold-chain", "gps"], submittedAtEpoch: 2_000 },
        { quoteId: "q-b", vendorId: "ven-b", unitCostMinor: 1_000, totalCostMinor: 9_000, leadTimeDays: 5, capabilityTags: ["cold-chain", "gps"], submittedAtEpoch: 2_000 },
        { quoteId: "q-c", vendorId: "ven-c", unitCostMinor: 2_000, totalCostMinor: 20_000, leadTimeDays: 5, capabilityTags: ["cold-chain", "gps"], submittedAtEpoch: 2_000 },
      ],
    },
    {
      stepId: "s2", kind: "quote-score-view", computedAt: CLOCK.now,
      quotes: [
        { quoteId: "q-c", vendorId: "ven-c", unitCostMinor: 2_000, totalCostMinor: 20_000, leadTimeDays: 5, capabilityTags: ["cold-chain", "gps"], submittedAtEpoch: 2_000 },
        { quoteId: "q-b", vendorId: "ven-b", unitCostMinor: 1_000, totalCostMinor: 9_000, leadTimeDays: 5, capabilityTags: ["cold-chain", "gps"], submittedAtEpoch: 2_000 },
        { quoteId: "q-a", vendorId: "ven-a", unitCostMinor: 1_000, totalCostMinor: 10_000, leadTimeDays: 5, capabilityTags: ["cold-chain", "gps"], submittedAtEpoch: 2_000 },
      ],
    },
  ],
  assertions: [
    eq("a1", "quotes.ok", true, "the REAL comparison builds"),
    deq("a2", "quotes.rankOrder", ["q-b", "q-a", "q-c"], "the tie is broken by lower total cost: q-b, q-a, then the expensive q-c"),
    eq("a3", "quotes.rank1ScoreBps", 10_000, "the tied quotes both score 10000 bps"),
    eq("a4", "quotes.rank2TieBreak", "lower-total-cost", "the tie-break rule is recorded on the lower-ranked tied entry"),
    eq("a5", "quotes.digestUniform", true, "re-ranking the same quotes in a different input order yields the identical digest"),
  ],
};

export const orderReconciliationJourney: AcceptanceJourney = {
  id: "order-reconciliation",
  persona: "finance-controller",
  capability: "order-reconciliation",
  goal: "Reconcile received vs ordered quantities across multiple receipts with exact/short/over classifications in integer bps.",
  steps: [
    { stepId: "s1", kind: "reconcile", orderedQuantity: 10, receipts: [4, 4] },
    { stepId: "s2", kind: "reconcile", orderedQuantity: 10, receipts: [5, 5] },
    { stepId: "s3", kind: "reconcile", orderedQuantity: 10, receipts: [11] },
    { stepId: "s4", kind: "reconcile", orderedQuantity: 10, receipts: [] },
  ],
  assertions: [
    deq("a1", "recon.classificationLog", ["short:2000", "exact:0", "over:1000", "short:10000"], "8/10 is short at 2000 bps, 10/10 exact, 11/10 over at 1000 bps, and nothing received is fully short"),
    eq("a2", "recon.ok", true, "the final reconciliation succeeds"),
    eq("a3", "recon.classification", "short", "an empty receipt set is short"),
    eq("a4", "recon.receivedQuantity", 0, "no units were received in the final step"),
    eq("a5", "recon.receiptCount", 0, "the final step has no receipts"),
    eq("a6", "recon.varianceQuantity", -10, "the final variance is the full order"),
  ],
};

export const vendorManagementJourney: AcceptanceJourney = {
  id: "vendor-management",
  persona: "vendor-manager",
  capability: "vendor-management",
  goal: "Run the vendor lifecycle with capability verification (claimed → verified) and exposure ceilings, then see the KPI rollup.",
  steps: [
    { stepId: "s1", kind: "vendor-lifecycle", command: "activate" },
    { stepId: "s2", kind: "vendor-verify-capability", tag: "cold-chain", evidenceId: "ev-cap-1" },
    { stepId: "s3", kind: "vendor-verify-capability", tag: "gps", evidenceId: null },
    { stepId: "s4", kind: "vendor-verify-capability", tag: "cold-chain", evidenceId: "ev-cap-1" },
    { stepId: "s5", kind: "vendor-exposure", op: "commit", amountMinorUnits: 300_000 },
    { stepId: "s6", kind: "vendor-exposure", op: "commit", amountMinorUnits: 300_000 },
    { stepId: "s7", kind: "vendor-exposure", op: "commit", amountMinorUnits: 100_000 },
    { stepId: "s8", kind: "vendor-lifecycle", command: "suspend", reason: "sla breach" },
    { stepId: "s9", kind: "vendor-lifecycle", command: "reinstate", reason: "remediation accepted" },
    { stepId: "s10", kind: "vendor-lifecycle", command: "terminate", reason: "contract ended" },
    { stepId: "s11", kind: "vendor-lifecycle", command: "reinstate", reason: "attempted revival" },
    { stepId: "s12", kind: "vendor-kpi-view", computedAt: CLOCK.now },
  ],
  assertions: [
    deq("a1", "vendor.log", ["true:active", "true:suspended", "true:active", "true:terminated", "false:TERMINAL_STATE"], "the lifecycle runs active → suspended → reinstated → terminated, and termination is terminal"),
    eq("a2", "vendor.status", "terminated", "the final vendor status is terminated"),
    eq("a3", "vendor.reinstatementCount", 1, "exactly one reinstatement was recorded"),
    deq("a4", "vendorVerify.log", ["true:null", "false:VERIFICATION_EVIDENCE_REQUIRED", "false:ALREADY_VERIFIED"], "verification needs evidence, and cannot re-verify an already-verified capability"),
    deq("a5", "exposure.log", ["true:300000", "false:100000", "true:400000"], "exposure commits up to the ceiling; the overshoot attempt is refused with the exact amount"),
    eq("a6", "exposure.committedMinorUnits", 400_000, "the final committed exposure is 400,000 minor units"),
    eq("a7", "kpi.ok", true, "the REAL vendor KPI rollup view builds"),
    eq("a8", "kpi.status", "terminated", "the KPI row carries the lifecycle status"),
    eq("a9", "kpi.exposureUtilizationBps", 8_000, "exposure utilization is 8000 bps"),
    eq("a10", "kpi.exposureRemaining", 100_000, "100,000 minor units of exposure remain"),
    eq("a11", "kpi.acceptanceBps", 0, "with no decided quote outcomes the acceptance rate is 0 bps"),
  ],
};

export const softwareEntitlementsJourney: AcceptanceJourney = {
  id: "software-entitlements",
  persona: "software-admin",
  capability: "software-entitlements",
  goal: "Allocate seats under the subscription invariant, refuse over-allocation with the exact overshoot, and see the honest seat view.",
  steps: [
    { stepId: "s1", kind: "entitlement-check", requestedSeats: 1 },
    { stepId: "s2", kind: "entitlement-check", requestedSeats: 3 },
    { stepId: "s3", kind: "grant-assign", grantId: "grant-1", seats: 3, assigneeId: "agent-9" },
    { stepId: "s4", kind: "seat-view", now: CLOCK.now, computedAt: CLOCK.now },
    { stepId: "s5", kind: "grant-revoke", grantId: "grant-1", reason: "project cancelled" },
    { stepId: "s6", kind: "seat-view", now: CLOCK.now, computedAt: CLOCK.now },
  ],
  assertions: [
    deq("a1", "entitlement.log", ["true:1", "false:OVER_ALLOCATION"], "one seat fits; three seats are refused as over-allocation"),
    eq("a2", "entitlement.overshootSeats", 1, "the refusal carries the exact overshoot of one seat"),
    eq("a3", "grant.ok", true, "the grant assignment succeeds within the seat invariant"),
    eq("a4", "grant.heldSeatsAfter", 3, "three seats are held after the assignment"),
    eq("a5", "grant.status", "assigned", "the grant is assigned"),
    eq("a6", "seats.ok", true, "the REAL seat view builds"),
    eq("a7", "seats.allocated", 3, "the seat view shows 3 allocated entitlement seats"),
    eq("a8", "seats.total", 5, "the subscription has 5 seats"),
    eq("a9", "seats.utilizationBps", 6_000, "seat utilization is 6000 bps"),
    eq("a10", "seats.expired", false, "the subscription is not expired at the journey's now"),
    eq("a11", "grantRevoke.ok", true, "revoking the grant succeeds with a reason"),
    eq("a12", "grantRevoke.heldSeatsAfter", 0, "revocation releases the grant's seats"),
    eq("a13", "seats.overAllocated", 0, "the seat view reports zero over-allocation — the invariant held"),
  ],
};

export const COMMERCE_JOURNEYS: readonly AcceptanceJourney[] = [
  procureSpineJourney,
  quoteScoringJourney,
  orderReconciliationJourney,
  vendorManagementJourney,
  softwareEntitlementsJourney,
];
