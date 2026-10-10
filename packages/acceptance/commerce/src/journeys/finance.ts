/**
 * @fleetos/acceptance-commerce — finance journeys (F310C, Wave 11 lane C).
 *
 * Four genuinely distinct journeys over REAL public APIs:
 *   1. sla-scorecard-credit — vendor SLA contract math end to end:
 *      evaluateSla (fill-rate availability + band-based breach evidence +
 *      honest cap) → buildSlaScorecard (verbatim-by-reference) →
 *      applySlaPenaltyCredit (procurement seam, digest-traceable), with
 *      fail-closed foreign/empty/invalid refusals.
 *   2. batched-order-reconciliation — reconciliation at volume: the
 *      order-id-lexical contiguous-batch law, per-order classification,
 *      and whole-run refusal on mismatch (never partial results).
 *   3. cost-allocation-exact-sums — the largest-remainder exact-sum law
 *      over awkward divisions, the sum-to-10000 law (no normalization),
 *      and signed-drift verification.
 *   4. renewal-window-sweep — subscription grace-law classification with
 *      the honest sweep refusal on unparseable dates, plus seat-burn
 *      projections with mandatory assumptions.
 */

import type { AcceptanceJourney, FactValue } from "../journey-contracts.js";

const eq = (id: string, fact: string, expected: FactValue, description: string) =>
  ({ id, description, fact, op: "eq" as const, expected });
const deq = (id: string, fact: string, expected: readonly string[], description: string) =>
  ({ id, description, fact, op: "deepEq" as const, expected });

const T0 = 1_791_000_000;

export const slaScorecardCreditJourney: AcceptanceJourney = {
  id: "sla-scorecard-credit",
  persona: "vendor-manager",
  capability: "sla-management",
  goal: "Evaluate a vendor SLA over real fulfillment outcomes — fill-rate availability, band-based breach evidence, the penalty cap applied honestly — carry it into a scorecard BY REFERENCE, and post the penalty credit to order economics traceable to the evaluation digest.",
  steps: [
    { stepId: "s1", kind: "vendor-sla-evaluate", factKey: "main", availabilityTargetBps: 9500, creditCapBps: 600,
      bands: [
        { bandId: "b-within-1h", maxLatenessMs: 3_600_000, penaltyBps: 50 },
        { bandId: "b-within-1d", maxLatenessMs: 86_400_000, penaltyBps: 200 },
        { bandId: "b-terminal", maxLatenessMs: 604_800_000, penaltyBps: 500 },
      ],
      outcomes: [
        { orderId: "ord-t1", promisedAt: T0, deliveredAt: T0, quantityOrdered: 10, quantityReceived: 10 },
        { orderId: "ord-t2", promisedAt: T0, deliveredAt: T0 + 1_800_000, quantityOrdered: 10, quantityReceived: 10 },
        { orderId: "ord-t3", promisedAt: T0, deliveredAt: T0 + 7_200_000, quantityOrdered: 10, quantityReceived: 10 },
        { orderId: "ord-t4", promisedAt: T0, deliveredAt: T0 + 259_200_000, quantityOrdered: 10, quantityReceived: 10 },
        { orderId: "ord-t5", promisedAt: T0, deliveredAt: T0, quantityOrdered: 10, quantityReceived: 6 },
      ] },
    { stepId: "s2", kind: "vendor-sla-scorecard" },
    { stepId: "s3", kind: "vendor-sla-credit", factKey: "ok", orderedQuantity: 10, unitCostMinor: 250_000 },
    { stepId: "s4", kind: "vendor-sla-credit", factKey: "foreign", orderedQuantity: 10, unitCostMinor: 250_000, foreignTenant: true },
    { stepId: "s5", kind: "vendor-sla-evaluate", factKey: "empty", availabilityTargetBps: 9500, creditCapBps: 600,
      bands: [{ bandId: "b-within-1h", maxLatenessMs: 3_600_000, penaltyBps: 50 }], outcomes: [] },
    { stepId: "s6", kind: "vendor-sla-evaluate", factKey: "foreignoutcome", availabilityTargetBps: 9500, creditCapBps: 600,
      bands: [{ bandId: "b-within-1h", maxLatenessMs: 3_600_000, penaltyBps: 50 }],
      outcomes: [{ orderId: "ord-x", promisedAt: T0, deliveredAt: T0, quantityOrdered: 1, quantityReceived: 1, foreignTenant: true }] },
    { stepId: "s7", kind: "vendor-sla-evaluate", factKey: "badbands", availabilityTargetBps: 9500, creditCapBps: 600,
      bands: [
        { bandId: "b-descending", maxLatenessMs: 86_400_000, penaltyBps: 200 },
        { bandId: "b-smaller", maxLatenessMs: 3_600_000, penaltyBps: 50 },
      ],
      outcomes: [{ orderId: "ord-t1", promisedAt: T0, deliveredAt: T0, quantityOrdered: 10, quantityReceived: 10 }] },
  ],
  assertions: [
    eq("a1", "sla.evaluate.main.ok", true, "the REAL evaluation runs over the outcome history"),
    eq("a2", "sla.evaluate.main.outcomeCount", 5, "all five outcomes are evaluated"),
    eq("a3", "sla.evaluate.main.onTimeCount", 2, "two outcomes are on time (including the short-shipped one)"),
    eq("a4", "sla.evaluate.main.availabilityBps", 9200, "fill-rate availability is floor(46*10000/50) = 9200 bps"),
    eq("a5", "sla.evaluate.main.availabilityMet", false, "9200 bps misses the 9500 target — an availability miss, not a breach"),
    eq("a6", "sla.evaluate.main.breachCount", 3, "three outcomes are late (breaches)"),
    deq("a7", "sla.evaluate.main.breachBands", ["b-within-1h", "b-within-1d", "b-terminal"], "each breach lands in its band by exact lateness (30min/2h/3d)"),
    eq("a8", "sla.evaluate.main.totalPenaltyBpsUncapped", 750, "the uncapped penalty sums the bands (50+200+500)"),
    eq("a9", "sla.evaluate.main.totalPenaltyBps", 600, "the credit cap applies: min(750, 600)"),
    eq("a10", "sla.evaluate.main.capApplied", true, "the capping is recorded honestly"),
    eq("a11", "sla.scorecard.ok", true, "the scorecard builds from the evaluation output"),
    eq("a12", "sla.scorecard.status", "penalty", "breaches > 0 means the scorecard status is penalty"),
    eq("a13", "sla.scorecard.totalPenaltyBps", 600, "the scorecard carries the capped penalty verbatim"),
    eq("a14", "sla.scorecard.availabilityBps", 9200, "the scorecard carries availability verbatim"),
    eq("a15", "sla.scorecard.evidenceIsReference", true, "the breach evidence array is reused BY REFERENCE (never recomputed)"),
    eq("a16", "sla.credit.ok.ok", true, "the penalty credit posts through the REAL procurement seam"),
    eq("a17", "sla.credit.ok.orderValueMinor", 2_500_000, "the order value is quantity * unit cost (10 * 250000)"),
    eq("a18", "sla.credit.ok.creditMinorUnits", 150_000, "the credit is floor(2500000 * 600 / 10000) — exact integer math"),
    eq("a19", "sla.credit.ok.digestTracePreserved", true, "the credit's evaluation digest traces verbatim to the evaluation that produced the penalty"),
    eq("a20", "sla.credit.foreign.ok", false, "a credit for another tenant's order refuses"),
    eq("a21", "sla.credit.foreign.reasonCode", "TENANT_MISMATCH", "the fail-closed tenant reason code"),
    eq("a22", "sla.evaluate.empty.ok", false, "an empty history refuses the evaluation"),
    eq("a23", "sla.evaluate.empty.reasonCode", "EMPTY_SLA_HISTORY", "the empty-history reason code"),
    eq("a24", "sla.evaluate.foreignoutcome.ok", false, "a foreign-tenant outcome REFUSES the evaluation"),
    eq("a25", "sla.evaluate.foreignoutcome.reasonCode", "TENANT_MISMATCH", "foreign records are never silently filtered"),
    eq("a26", "sla.evaluate.badbands.ok", false, "structurally invalid bands refuse before any evaluation"),
    eq("a27", "sla.evaluate.badbands.reasonCode", "INVALID_BAND_ORDER", "bands must ascend strictly in maxLatenessMs"),
  ],
};

export const batchedOrderReconciliationJourney: AcceptanceJourney = {
  id: "batched-order-reconciliation",
  persona: "finance-controller",
  capability: "order-reconciliation",
  goal: "Reconcile a week of orders at volume: the lexical ordering law never leaks input order, batches are contiguous and bounded, every order keeps its exact/short/over classification, and a receipt mismatch refuses the WHOLE run — never a partial result.",
  steps: [
    { stepId: "s1", kind: "order-reconcile-batch", factKey: "main", batchSize: 2,
      orders: [
        { orderId: "ord-c", orderedQuantity: 8, unitCostMinor: 90_000 },
        { orderId: "ord-a", orderedQuantity: 10, unitCostMinor: 120_000 },
        { orderId: "ord-e", orderedQuantity: 6, unitCostMinor: 40_000 },
        { orderId: "ord-b", orderedQuantity: 12, unitCostMinor: 75_000 },
        { orderId: "ord-d", orderedQuantity: 9, unitCostMinor: 60_000 },
      ],
      receipts: [
        { orderId: "ord-b", receivedQuantity: 8 },
        { orderId: "ord-c", receivedQuantity: 9 },
        { orderId: "ord-a", receivedQuantity: 10 },
        { orderId: "ord-b", receivedQuantity: 2 },
        { orderId: "ord-e", receivedQuantity: 6 },
      ] },
    { stepId: "s2", kind: "order-reconcile-batch", factKey: "mismatch", batchSize: 2,
      orders: [{ orderId: "ord-a", orderedQuantity: 10, unitCostMinor: 120_000 }],
      receipts: [{ orderId: "ord-ghost", receivedQuantity: 3 }] },
    { stepId: "s3", kind: "order-reconcile-batch", factKey: "boundlow", batchSize: 0,
      orders: [{ orderId: "ord-a", orderedQuantity: 10, unitCostMinor: 120_000 }], receipts: [] },
    { stepId: "s4", kind: "order-reconcile-batch", factKey: "boundhigh", batchSize: 501,
      orders: [{ orderId: "ord-a", orderedQuantity: 10, unitCostMinor: 120_000 }], receipts: [] },
    { stepId: "s5", kind: "order-reconcile-batch", factKey: "dup", batchSize: 2,
      orders: [
        { orderId: "ord-a", orderedQuantity: 10, unitCostMinor: 120_000 },
        { orderId: "ord-a", orderedQuantity: 10, unitCostMinor: 120_000 },
      ], receipts: [] },
    { stepId: "s6", kind: "order-reconcile-batch", factKey: "foreign", batchSize: 2,
      orders: [{ orderId: "ord-a", orderedQuantity: 10, unitCostMinor: 120_000, foreignTenant: true }],
      receipts: [{ orderId: "ord-a", receivedQuantity: 10 }] },
    { stepId: "s7", kind: "order-reconcile-batch", factKey: "maxbound", batchSize: 500,
      orders: [
        { orderId: "ord-c", orderedQuantity: 8, unitCostMinor: 90_000 },
        { orderId: "ord-a", orderedQuantity: 10, unitCostMinor: 120_000 },
        { orderId: "ord-e", orderedQuantity: 6, unitCostMinor: 40_000 },
        { orderId: "ord-b", orderedQuantity: 12, unitCostMinor: 75_000 },
        { orderId: "ord-d", orderedQuantity: 9, unitCostMinor: 60_000 },
      ],
      receipts: [
        { orderId: "ord-a", receivedQuantity: 10 },
        { orderId: "ord-b", receivedQuantity: 8 },
        { orderId: "ord-b", receivedQuantity: 2 },
        { orderId: "ord-c", receivedQuantity: 9 },
        { orderId: "ord-e", receivedQuantity: 6 },
      ] },
  ],
  assertions: [
    eq("a1", "recon.batch.main.ok", true, "the batched reconciliation runs"),
    eq("a2", "recon.batch.main.orderCount", 5, "all five orders reconcile"),
    eq("a3", "recon.batch.main.batchCount", 3, "batchSize 2 over 5 orders is 3 contiguous batches"),
    eq("a4", "recon.batch.main.ordering", "order-id-lexical-contiguous-batches", "the ordering law is carried verbatim"),
    deq("a5", "recon.batch.main.firstBatchIds", ["ord-a", "ord-b"], "the first batch is the lexically-first orders — input order never leaks"),
    deq("a6", "recon.batch.main.lastBatchIds", ["ord-e"], "the last batch carries the remainder alone"),
    eq("a7", "recon.batch.main.exactCount", 2, "ord-a and ord-e reconcile exact"),
    eq("a8", "recon.batch.main.shortCount", 2, "ord-b (10 of 12) and ord-d (no receipts) are short"),
    eq("a9", "recon.batch.main.overCount", 1, "ord-c (9 of 8) is over"),
    eq("a10", "recon.batch.mismatch.ok", false, "a receipt for an unknown order refuses the run"),
    eq("a11", "recon.batch.mismatch.reasonCode", "RECEIPT_ORDER_MISMATCH", "the mismatch reason code is verbatim"),
    eq("a12", "recon.batch.boundlow.ok", false, "batchSize 0 is out of the documented range"),
    eq("a13", "recon.batch.boundlow.reasonCode", "BATCH_SIZE_OUT_OF_RANGE", "the bound reason code"),
    eq("a14", "recon.batch.boundhigh.ok", false, "batchSize 501 is out of the documented range"),
    eq("a15", "recon.batch.boundhigh.reasonCode", "BATCH_SIZE_OUT_OF_RANGE", "the same bound reason code at the top end"),
    eq("a16", "recon.batch.dup.ok", false, "duplicate order ids refuse the run"),
    eq("a17", "recon.batch.dup.reasonCode", "ORDER_ID_DUPLICATE", "the duplicate reason code"),
    eq("a18", "recon.batch.foreign.ok", false, "a foreign-tenant order refuses the run"),
    eq("a19", "recon.batch.foreign.reasonCode", "TENANT_MISMATCH", "fail-closed, never silently filtered"),
    eq("a20", "recon.batch.maxbound.ok", true, "batchSize 500 (the documented maximum) is legal"),
    eq("a21", "recon.batch.maxbound.batchCount", 1, "five orders fit one maximum-size batch"),
  ],
};

export const costAllocationExactSumsJourney: AcceptanceJourney = {
  id: "cost-allocation-exact-sums",
  persona: "finance-controller",
  capability: "cost-allocation",
  goal: "Allocate an order's awkward total across work orders with the largest-remainder law — the parts sum EXACTLY to the whole with no rounding drift — while weights must sum to exactly 10000 (never normalized), and partial-fulfillment rows verify with signed drift on violation.",
  steps: [
    { stepId: "s1", kind: "cost-allocate", factKey: "main", orderId: "ord-alloc-1", totalMinorUnits: 1_000_003,
      shares: [
        { workOrderId: "wo-c1", shareBps: 3333 },
        { workOrderId: "wo-c2", shareBps: 3333 },
        { workOrderId: "wo-c3", shareBps: 3334 },
      ] },
    { stepId: "s2", kind: "cost-allocate", factKey: "badsum", orderId: "ord-alloc-2", totalMinorUnits: 1_000_000,
      shares: [
        { workOrderId: "wo-c1", shareBps: 3333 },
        { workOrderId: "wo-c2", shareBps: 3333 },
        { workOrderId: "wo-c3", shareBps: 3333 },
      ] },
    { stepId: "s3", kind: "cost-allocate-partial", factKey: "main", orderId: "ord-alloc-3", totalMinorUnits: 1_000_003,
      partials: [
        { fulfillmentId: "ful-1", quantity: 3 },
        { fulfillmentId: "ful-2", quantity: 7 },
      ] },
    { stepId: "s4", kind: "cost-alloc-verify", factKey: "ok", orderId: "ord-alloc-3", totalMinorUnits: 1_000_003,
      rows: [
        { fulfillmentId: "ful-1", amountMinorUnits: 300_001 },
        { fulfillmentId: "ful-2", amountMinorUnits: 700_002 },
      ] },
    { stepId: "s5", kind: "cost-alloc-verify", factKey: "drift", orderId: "ord-alloc-3", totalMinorUnits: 1_000_003,
      rows: [
        { fulfillmentId: "ful-1", amountMinorUnits: 300_000 },
        { fulfillmentId: "ful-2", amountMinorUnits: 700_001 },
      ] },
  ],
  assertions: [
    eq("a1", "cost.alloc.main.ok", true, "the allocation runs over the awkward total"),
    deq("a2", "cost.alloc.main.amounts", ["wo-c1:333301", "wo-c2:333301", "wo-c3:333401"], "largest-remainder bumps the two 9999-remainder keys by one each"),
    eq("a3", "cost.alloc.main.totalAllocated", 1_000_003, "the allocations sum EXACTLY to the order total (no drift)"),
    eq("a4", "cost.alloc.main.law", "largest-remainder-bps-tie-break-work-order-id-lexical", "the allocation law is carried verbatim"),
    eq("a5", "cost.alloc.badsum.ok", false, "weights summing to 9999 refuse"),
    eq("a6", "cost.alloc.badsum.reasonCode", "SHARES_MUST_SUM_TO_10000", "no silent normalization — the law's reason code"),
    eq("a7", "cost.partial.main.ok", true, "the partial-fulfillment allocation runs"),
    deq("a8", "cost.partial.main.rows", ["ful-1:300001", "ful-2:700002"], "quantity-proportional rows with the remainder to the larger fractional part"),
    eq("a9", "cost.partial.main.totalAllocated", 1_000_003, "the partial rows also sum EXACTLY to the whole"),
    eq("a10", "cost.verify.ok.ok", true, "the verification law passes on exact rows"),
    eq("a11", "cost.verify.ok.sumMinorUnits", 1_000_003, "the verified sum is the order total"),
    eq("a12", "cost.verify.drift.ok", false, "rows two minor units short refuse the verification"),
    eq("a13", "cost.verify.drift.reasonCode", "ROWS_DO_NOT_SUM_TO_ORDER_TOTAL", "the drift reason code"),
    eq("a14", "cost.verify.drift.driftMinorUnits", -2, "the signed drift is exact (never clamped)"),
  ],
};

export const renewalWindowSweepJourney: AcceptanceJourney = {
  id: "renewal-window-sweep",
  persona: "software-admin",
  capability: "software-entitlements",
  goal: "Sweep subscription renewal windows under the documented grace law — active, inGrace inside the renewal window, expired past it — with an unparseable date refusing the whole sweep (never a guessed classification), and project seat burn with mandatory assumptions and exact overage.",
  steps: [
    { stepId: "s1", kind: "software-renewal-sweep", factKey: "main", graceMs: 2_592_000_000, now: 1_791_158_400_000,
      subscriptions: [
        { subscriptionId: "sub-active-future", status: "active", validUntil: "2026-10-20T00:00:00Z" },
        { subscriptionId: "sub-grace", status: "active", validUntil: "2026-10-03T00:00:00Z" },
        { subscriptionId: "sub-expired", status: "active", validUntil: "2026-08-01T00:00:00Z" },
        { subscriptionId: "sub-noend", status: "active", validUntil: null },
        { subscriptionId: "sub-cancelled", status: "cancelled", validUntil: "2026-12-01T00:00:00Z" },
      ] },
    { stepId: "s2", kind: "software-renewal-sweep", factKey: "invalid", graceMs: 2_592_000_000, now: 1_791_158_400_000,
      subscriptions: [
        { subscriptionId: "sub-ok", status: "active", validUntil: "2026-10-20T00:00:00Z" },
        { subscriptionId: "sub-bad", status: "active", validUntil: "not-a-date" },
      ] },
    { stepId: "s3", kind: "software-renewal-sweep", factKey: "foreign", graceMs: 2_592_000_000, now: 1_791_158_400_000,
      subscriptions: [
        { subscriptionId: "sub-ok", status: "active", validUntil: "2026-10-20T00:00:00Z", foreignTenant: true },
      ] },
    { stepId: "s4", kind: "software-seat-projection", factKey: "main",
      planned: [
        { requestId: "req-depot", seats: 4, assumption: "depot onboarding wave 1 (committed headcount)" },
        { requestId: "req-audit", seats: 2, assumption: "seasonal audit staff (Q4 only)" },
      ] },
    { stepId: "s5", kind: "software-seat-projection", factKey: "noassumption",
      planned: [{ requestId: "req-x", seats: 1, assumption: "   " }] },
    { stepId: "s6", kind: "software-seat-projection", factKey: "dup",
      planned: [
        { requestId: "req-1", seats: 1, assumption: "first" },
        { requestId: "req-1", seats: 1, assumption: "duplicate request id" },
      ] },
  ],
  assertions: [
    eq("a1", "renewal.sweep.main.ok", true, "the sweep runs over the mixed subscription set"),
    eq("a2", "renewal.sweep.main.activeCount", 2, "the future-dated and no-end-date subscriptions are active"),
    eq("a3", "renewal.sweep.main.inGraceCount", 1, "exactly one subscription sits inside its grace window"),
    eq("a4", "renewal.sweep.main.expiredCount", 2, "the past-grace and cancelled subscriptions are expired (not renewable)"),
    eq("a5", "renewal.sweep.main.ordering", "subscription-id-lexical", "the ordering law is carried verbatim"),
    deq("a6", "renewal.sweep.main.statuses", [
      "sub-active-future:active",
      "sub-cancelled:expired",
      "sub-expired:expired",
      "sub-grace:inGrace",
      "sub-noend:active",
    ], "every subscription classifies under the grace law (lexical order)"),
    deq("a7", "renewal.sweep.main.graceEnds", [
      "sub-active-future:1795046400000",
      "sub-expired:1788134400000",
      "sub-grace:1793577600000",
    ], "every grace end is validUntil + 30d, computed exactly (lexical order)"),
    eq("a8", "renewal.sweep.invalid.ok", false, "one unparseable validUntil refuses the WHOLE sweep"),
    eq("a9", "renewal.sweep.invalid.reasonCode", "INVALID_VALID_UNTIL", "never a guessed classification — the honest refusal"),
    eq("a10", "renewal.sweep.foreign.ok", false, "a foreign-tenant subscription refuses the sweep"),
    eq("a11", "renewal.sweep.foreign.reasonCode", "TENANT_MISMATCH", "fail-closed, never silently filtered"),
    eq("a12", "seats.project.main.ok", true, "the seat projection runs over the REAL grant population"),
    eq("a13", "seats.project.main.heldSeatsNow", 3, "the REAL held seats now (the world's grant-1: 3 seats)"),
    eq("a14", "seats.project.main.plannedSeats", 6, "the planned assignments sum to 6 seats"),
    eq("a15", "seats.project.main.projectedHeldSeats", 9, "projected held = 3 + 6"),
    eq("a16", "seats.project.main.utilizationBps", 18_000, "utilization is floor(9*10000/5) — 180% honestly, never clamped"),
    eq("a17", "seats.project.main.overageSeats", 4, "the projected overage is exact: 9 - 5"),
    eq("a18", "seats.project.main.projection", true, "the projection marker is carried"),
    deq("a19", "seats.project.main.assumptions", ["depot onboarding wave 1 (committed headcount)", "seasonal audit staff (Q4 only)"], "every assumption is carried verbatim, in plan order"),
    eq("a20", "seats.project.noassumption.ok", false, "a projection without a stated assumption refuses"),
    eq("a21", "seats.project.noassumption.reasonCode", "ASSUMPTION_EMPTY", "projections without uncertainty statements are refused"),
    eq("a22", "seats.project.dup.ok", false, "duplicate request ids refuse the projection"),
    eq("a23", "seats.project.dup.reasonCode", "REQUEST_ID_DUPLICATE", "the duplicate reason code"),
  ],
};

export const FINANCE_JOURNEYS: readonly AcceptanceJourney[] = [
  slaScorecardCreditJourney,
  batchedOrderReconciliationJourney,
  costAllocationExactSumsJourney,
  renewalWindowSweepJourney,
];
