/**
 * @fleetos/acceptance-commerce — F361C procurement journeys (Wave 17
 * lane C): the marketplace equipment-request lifecycle and the
 * offer-freshness discipline.
 *
 * CENSUS CITATION (the F361C commerce census — docs/evidence/F361C/
 * report.md §1, machine-measured at base `203f077`): every journey here
 * drives public APIs with ZERO corpus coverage across all three corpora
 * (grep proof): `submitEquipmentRequest` /
 * `transitionEquipmentRequest` / `findEquipmentRequest` /
 * `buildEquipmentRequestBoard` (procurement/marketplace-request.ts —
 * the §3.1 machine), `captureMarketplaceOffer` /
 * `buildCurrentOfferSheet` (marketplace-offer.ts — the §3.2 freshness
 * law), and `compareMarketplaceOffers` (marketplace-offer-comparison.ts
 * — composing the EXISTING compareQuotes + matchVendors kernels). The
 * ids name THIS lane's MARKETPLACE angle (the F354 lesson).
 *
 * D14 form: unique ids, REAL domain public entry points, >=5
 * substantive assertions incl. >=1 refusal each, deterministic
 * byte-identity on rerun. Single-epoch (T0): no step consumes the run
 * anchor, no assertion carries an epoch table (D13 — invariant across
 * the frozen schedule, never an epoch-earning responder).
 */

import type { AcceptanceJourney, FactValue } from "../journey-contracts.js";

const eq = (id: string, fact: string, expected: FactValue, description: string) =>
  ({ id, description, fact, op: "eq" as const, expected });
const deq = (id: string, fact: string, expected: readonly string[], description: string) =>
  ({ id, description, fact, op: "deepEq" as const, expected });

const T0 = 1_774_000_000_000;
const DAY = 86_400_000;

/**
 * The equipment-request lifecycle through the REAL §3.1 machine: the
 * idempotent create+submit keyed tenant+natural key (a content-identical
 * replay returns the ORIGINAL request — never a second record; the same
 * natural key with different content is a typed conflict), the full
 * happy chain submitted → resolving → offer_window_closed → comparing →
 * selected → approval_requested → approved → ordered → fulfilled, and
 * the honest refusals: ordering before approval, a refusal without a
 * reason, a cancellation without a reason, a terminal re-transition, and
 * the cross-tenant read that sees NOTHING.
 */
export const marketplaceRequestLifecycleJourney: AcceptanceJourney = {
  id: "marketplace-request-lifecycle",
  persona: "procurement-lead",
  capability: "marketplace-requests",
  goal: "Run an equipment request through the REAL §3.1 state machine — the idempotent create+submit keyed tenant+natural key returns the ORIGINAL request on a content-identical replay (never a second record) and refuses NATURAL_KEY_CONFLICT on drifted content, the chain walks submitted → resolving → offer_window_closed → comparing → selected → approval_requested → approved → ordered → fulfilled with the selected offer carried forward, and the machine refuses honestly: ILLEGAL_TRANSITION on ordering before approval and on any terminal re-transition, REFUSE/CANCEL_REASON_REQUIRED on reason-less consequential commands, and the OTHER tenant's read returns NOTHING (fail-closed).",
  steps: [
    { stepId: "s1", kind: "mreq-submit", factKey: "first", requestId: "req-7710", naturalKey: "site-accra-hq:lt-5540:2026-q4", sku: "LT-5540", quantity: 5, requiredBy: "2026-12-01", at: T0 },
    // The idempotent replay: same natural key, same content, a DIFFERENT requestId.
    { stepId: "s2", kind: "mreq-submit", factKey: "replay", requestId: "req-999", naturalKey: "site-accra-hq:lt-5540:2026-q4", sku: "LT-5540", quantity: 5, requiredBy: "2026-12-01", at: T0 + 1_000 },
    // The conflict: same natural key, DIFFERENT content.
    { stepId: "s3", kind: "mreq-submit", factKey: "conflict", requestId: "req-7711", naturalKey: "site-accra-hq:lt-5540:2026-q4", sku: "LT-5540", quantity: 9, requiredBy: "2026-12-01", at: T0 + 2_000 },
    { stepId: "s4", kind: "mreq-transition", factKey: "resolve", command: "resolve", at: T0 + 3_000 },
    { stepId: "s5", kind: "mreq-transition", factKey: "closeWindow", command: "close_offer_window", at: T0 + 4_000 },
    { stepId: "s6", kind: "mreq-transition", factKey: "compare", command: "compare", at: T0 + 5_000 },
    { stepId: "s7", kind: "mreq-transition", factKey: "select", command: "select", offerId: "off-7710", at: T0 + 6_000 },
    { stepId: "s8", kind: "mreq-transition", factKey: "requestApproval", command: "request_approval", at: T0 + 7_000 },
    // REFUSAL: ordering before the approval exists.
    { stepId: "s9", kind: "mreq-transition", factKey: "earlyOrder", command: "order", at: T0 + 8_000 },
    // REFUSAL: a consequential refusal without an operator reason.
    { stepId: "s10", kind: "mreq-transition", factKey: "noReason", command: "refuse", reason: "", at: T0 + 9_000 },
    { stepId: "s11", kind: "mreq-transition", factKey: "approve", command: "approve", at: T0 + 10_000 },
    { stepId: "s12", kind: "mreq-transition", factKey: "order", command: "order", at: T0 + 11_000 },
    // REFUSAL: a cancellation without a reason.
    { stepId: "s13", kind: "mreq-transition", factKey: "noCancelReason", command: "cancel", reason: " ", at: T0 + 12_000 },
    { stepId: "s14", kind: "mreq-transition", factKey: "fulfill", command: "fulfill", at: T0 + 13_000 },
    // REFUSAL: fulfilled is TERMINAL.
    { stepId: "s15", kind: "mreq-transition", factKey: "terminal", command: "fulfill", at: T0 + 14_000 },
    { stepId: "s16", kind: "mreq-read", factKey: "own", requestId: "req-7710" },
    // Fail-closed: the OTHER tenant's scope sees nothing.
    { stepId: "s17", kind: "mreq-read", factKey: "foreign", requestId: "req-7710", callerTenant: "foreign" },
    { stepId: "s18", kind: "mreq-board", factKey: "final" },
  ],
  assertions: [
    eq("mr1", "mreq.submit.first.ok", true, "the first create+submit succeeds through the REAL API"),
    eq("mr2", "mreq.submit.first.duplicate", false, "the first submission is not a duplicate"),
    eq("mr3", "mreq.submit.first.status", "submitted", "the request is created directly into the submitted status"),
    eq("mr4", "mreq.submit.first.eventFrom", "draft", "the creation carries the draft -> submitted transition event"),
    eq("mr5", "mreq.submit.replay.duplicate", true, "the content-identical replay of the natural key is IDEMPOTENT (duplicate=true)"),
    eq("mr6", "mreq.submit.replay.requestId", "req-7710", "the replay returns the ORIGINAL request id — even though its input named req-999"),
    eq("mr7", "mreq.submit.replay.population", 1, "the registry never creates a second request from the replay"),
    eq("mr8", "mreq.submit.conflict.reasonCode", "NATURAL_KEY_CONFLICT", "REFUSAL: the same natural key with different content is a typed conflict — never a silent overwrite"),
    eq("mr9", "mreq.transition.resolve.status", "resolving", "submitted -> resolving (offer sourcing begins)"),
    eq("mr10", "mreq.transition.closeWindow.status", "offer_window_closed", "resolving -> offer_window_closed"),
    eq("mr11", "mreq.transition.compare.status", "comparing", "offer_window_closed -> comparing"),
    eq("mr12", "mreq.transition.select.status", "selected", "comparing -> selected with the offer id"),
    eq("mr13", "mreq.transition.select.selectedOfferId", "off-7710", "the selected offer id is carried on the request"),
    eq("mr14", "mreq.transition.requestApproval.status", "approval_requested", "selected -> approval_requested (the Guardian gate)"),
    eq("mr15", "mreq.transition.earlyOrder.reasonCode", "ILLEGAL_TRANSITION", "REFUSAL: an order cannot be placed from approval_requested — approval must land first"),
    eq("mr16", "mreq.transition.noReason.reasonCode", "REFUSE_REASON_REQUIRED", "REFUSAL: a consequential refusal requires an operator reason (law A4)"),
    eq("mr17", "mreq.transition.approve.status", "approved", "approval_requested -> approved"),
    eq("mr18", "mreq.transition.order.status", "ordered", "approved -> ordered"),
    eq("mr19", "mreq.transition.noCancelReason.reasonCode", "CANCEL_REASON_REQUIRED", "REFUSAL: a cancellation requires a reason"),
    eq("mr20", "mreq.transition.fulfill.status", "fulfilled", "ordered -> fulfilled (the happy terminal)"),
    eq("mr21", "mreq.transition.terminal.reasonCode", "ILLEGAL_TRANSITION", "REFUSAL: fulfilled is TERMINAL — no further transition ever fires"),
    eq("mr22", "mreq.read.own.found", true, "the own-tenant read finds the fulfilled request"),
    eq("mr23", "mreq.read.foreign.found", false, "REFUSAL-class fact: the OTHER tenant's scope reads NOTHING (fail-closed)"),
    eq("mr24", "mreq.read.foreign.status", null, "the cross-tenant read exposes no request status"),
    eq("mr25", "mreq.board.final.total", 1, "the board holds exactly ONE request (the replay and conflict created nothing)"),
    eq("mr26", "mreq.board.final.fulfilled", 1, "the board counts the request in the fulfilled status"),
    deq("mr27", "mreq.log", [
      "submit:req-7710:created:req-7710:submitted",
      "submit:req-999:duplicate:req-7710:submitted",
      "submit:req-7711:refused:NATURAL_KEY_CONFLICT",
      "transition:req-7710:resolving",
      "transition:req-7710:offer_window_closed",
      "transition:req-7710:comparing",
      "transition:req-7710:selected",
      "transition:req-7710:approval_requested",
      "transition:req-7710:refused:ILLEGAL_TRANSITION",
      "transition:req-7710:refused:REFUSE_REASON_REQUIRED",
      "transition:req-7710:approved",
      "transition:req-7710:ordered",
      "transition:req-7710:refused:CANCEL_REASON_REQUIRED",
      "transition:req-7710:fulfilled",
      "transition:req-7710:refused:ILLEGAL_TRANSITION",
    ], "the request log carries every creation, duplicate, conflict, transition and refusal in order"),
  ],
};

/**
 * THE FRESHNESS LAW through the REAL offer APIs: capture validates the
 * full §3.2 schema (source reference + captured-at REQUIRED; an offer
 * already past its validity window at capture refuses — never recorded
 * as if live), the current-offer sheet admits ONLY fresh offers and
 * reports every exclusion, and at a later instant EVERY offer lapses —
 * nothing stale ever appears current. The comparison composes the
 * EXISTING compareQuotes + matchVendors kernels over the eligible set
 * with the hard-constraint report (unverified and lapsed suppliers are
 * hard failures a weight can never rescue) and the per-offer explainable
 * rationale; a foreign-tenant verification or offer REFUSES the whole
 * operation fail-closed.
 */
export const marketplaceOfferFreshnessDisciplineJourney: AcceptanceJourney = {
  id: "marketplace-offer-freshness-discipline",
  persona: "procurement-lead",
  capability: "marketplace-offers",
  goal: "Prove the freshness law through the REAL offer APIs — capture records the full §3.2 schema with the manual source reference and captured-at (refusing a stale-on-arrival offer, a missing source reference and a drifted total), the current-offer sheet admits ONLY fresh offers with every exclusion reported (at a later instant ALL THREE lapse — an expired offer NEVER silently appears current), and the comparison composes the EXISTING compareQuotes + matchVendors kernels: unverified/lapsed suppliers are HARD-constraint failures the preference weights can never rescue, the eligible set is ranked with the integer-bps decomposition and recorded tie-breaks, and a foreign-tenant verification record or offer REFUSES the whole operation fail-closed (never silently filtered).",
  steps: [
    { stepId: "s1", kind: "moff-capture", factKey: "offA",
      offer: { offerId: "off-7710-a", supplierId: "sup-accra", sku: "LT-5540", quantity: 5, unitCostMinor: 1_200_000, totalCostMinor: 6_000_000, currency: "GHS", taxMinor: 150_000, feesMinor: 25_000, deliveryEstimateDays: 10, condition: "new", warrantyMonths: 24, validFrom: T0 - DAY, validUntil: T0 + 14 * DAY, sourceKind: "manual-catalogue-export", sourceReference: "exp-2026-10-01:sup-accra:lt-5540", capturedAt: T0 } },
    { stepId: "s2", kind: "moff-capture", factKey: "offB",
      offer: { offerId: "off-7710-b", supplierId: "sup-tema", sku: "LT-5540", quantity: 5, unitCostMinor: 1_000_000, totalCostMinor: 5_000_000, currency: "GHS", taxMinor: 120_000, feesMinor: 20_000, deliveryEstimateDays: 3, condition: "new", warrantyMonths: 12, validFrom: T0 - DAY, validUntil: T0 + 14 * DAY, sourceKind: "manual-catalogue-export", sourceReference: "exp-2026-10-01:sup-tema:lt-5540", capturedAt: T0 } },
    // Captured while live, but ALREADY expired at the comparison instant.
    { stepId: "s3", kind: "moff-capture", factKey: "offExpired",
      offer: { offerId: "off-7710-old", supplierId: "sup-accra", sku: "LT-5540", quantity: 5, unitCostMinor: 900_000, totalCostMinor: 4_500_000, currency: "GHS", taxMinor: 100_000, feesMinor: 10_000, deliveryEstimateDays: 5, condition: "certified-refurbished", warrantyMonths: 6, validFrom: T0 - 30 * DAY, validUntil: T0 - DAY, sourceKind: "supplier-message-reference", sourceReference: "msg-sup-accra-2026-09", capturedAt: T0 - 2 * DAY } },
    // Fresh at T0 but the supplier is UNVERIFIED (the comparison's hard gate fires).
    { stepId: "s3b", kind: "moff-capture", factKey: "offPend",
      offer: { offerId: "off-7710-pend", supplierId: "sup-unverified", sku: "LT-5540", quantity: 5, unitCostMinor: 950_000, totalCostMinor: 4_750_000, currency: "GHS", taxMinor: 95_000, feesMinor: 5_000, deliveryEstimateDays: 6, condition: "new", warrantyMonths: 12, validFrom: T0 - DAY, validUntil: T0 + 14 * DAY, sourceKind: "manual-catalogue-export", sourceReference: "exp-2026-10-01:sup-unverified", capturedAt: T0 } },
    // Fresh at T0 but the supplier's verification has LAPSED (verified-on-paper, expired now).
    { stepId: "s3c", kind: "moff-capture", factKey: "offLap",
      offer: { offerId: "off-7710-lap", supplierId: "sup-lapsed", sku: "LT-5540", quantity: 5, unitCostMinor: 980_000, totalCostMinor: 4_900_000, currency: "GHS", taxMinor: 98_000, feesMinor: 10_000, deliveryEstimateDays: 8, condition: "new", warrantyMonths: 18, validFrom: T0 - DAY, validUntil: T0 + 14 * DAY, sourceKind: "manual-catalogue-export", sourceReference: "exp-2026-10-01:sup-lapsed", capturedAt: T0 } },
    // REFUSAL: capturing an offer already past its own validity window.
    { stepId: "s4", kind: "moff-capture", factKey: "staleArrival",
      offer: { offerId: "off-7710-stale", supplierId: "sup-tema", sku: "LT-5540", quantity: 5, unitCostMinor: 950_000, totalCostMinor: 4_750_000, currency: "GHS", taxMinor: 90_000, feesMinor: 5_000, deliveryEstimateDays: 4, condition: "new", warrantyMonths: 6, validFrom: T0 - 30 * DAY, validUntil: T0 - DAY, sourceKind: "manual-catalogue-export", sourceReference: "exp-2026-09:sup-tema", capturedAt: T0 } },
    // REFUSAL: the manual source reference is REQUIRED.
    { stepId: "s5", kind: "moff-capture", factKey: "noSource",
      offer: { offerId: "off-7710-nosrc", supplierId: "sup-tema", sku: "LT-5540", quantity: 5, unitCostMinor: 1_000_000, totalCostMinor: 5_000_000, currency: "GHS", taxMinor: 120_000, feesMinor: 20_000, deliveryEstimateDays: 3, condition: "new", warrantyMonths: 12, validFrom: T0 - DAY, validUntil: T0 + 14 * DAY, sourceKind: "operator-entered", sourceReference: "", capturedAt: T0 } },
    // REFUSAL: the total must be exactly quantity × unit cost.
    { stepId: "s6", kind: "moff-capture", factKey: "totalMismatch",
      offer: { offerId: "off-7710-bad", supplierId: "sup-tema", sku: "LT-5540", quantity: 5, unitCostMinor: 1_000_000, totalCostMinor: 5_000_001, currency: "GHS", taxMinor: 120_000, feesMinor: 20_000, deliveryEstimateDays: 3, condition: "new", warrantyMonths: 12, validFrom: T0 - DAY, validUntil: T0 + 14 * DAY, sourceKind: "operator-entered", sourceReference: "note-op-ada-7710", capturedAt: T0 } },
    // The sheet at T0: two fresh, one expired.
    { stepId: "s7", kind: "moff-sheet", factKey: "atT0", at: T0 },
    // The sheet at T0 + 15 days: EVERY offer has lapsed — nothing current.
    { stepId: "s8", kind: "moff-sheet", factKey: "afterLapse", at: T0 + 15 * DAY },
    // The comparison at T0: hard constraints gate; the EXISTING kernels rank the eligible set.
    { stepId: "s9", kind: "moff-compare", factKey: "main", demandSku: "LT-5540", demandCurrency: "GHS", acceptableConditions: ["new", "certified-refurbished"],
      verifications: [
        { supplierId: "sup-accra", status: "verified", expiresAt: T0 + 90 * DAY },
        { supplierId: "sup-tema", status: "verified", expiresAt: T0 + 90 * DAY },
        { supplierId: "sup-unverified", status: "pending", expiresAt: null },
        { supplierId: "sup-lapsed", status: "verified", expiresAt: T0 - DAY },
      ],
      at: T0 },
    // REFUSAL: a foreign-tenant verification record refuses the whole comparison.
    { stepId: "s10", kind: "moff-compare", factKey: "foreignVerification", demandSku: "LT-5540", demandCurrency: "GHS", acceptableConditions: ["new"],
      verifications: [{ supplierId: "sup-foreign", status: "verified", expiresAt: T0 + DAY, tenant: "foreign" }],
      at: T0 },
    // REFUSAL: weights that do not sum to 10000.
    { stepId: "s11", kind: "moff-compare", factKey: "badWeights", demandSku: "LT-5540", demandCurrency: "GHS", acceptableConditions: ["new"],
      verifications: [{ supplierId: "sup-accra", status: "verified", expiresAt: T0 + 90 * DAY }],
      weights: { priceWeightBps: 4000, termsWeightBps: 3000, capabilityWeightBps: 2000 },
      at: T0 },
    // A foreign-tenant offer enters the population (captured under the OTHER tenant)...
    { stepId: "s12", kind: "moff-capture", factKey: "foreignOffer",
      offer: { offerId: "off-7710-foreign", supplierId: "sup-foreign", sku: "LT-5540", quantity: 5, unitCostMinor: 800_000, totalCostMinor: 4_000_000, currency: "GHS", taxMinor: 80_000, feesMinor: 10_000, deliveryEstimateDays: 7, condition: "new", warrantyMonths: 12, validFrom: T0 - DAY, validUntil: T0 + 14 * DAY, sourceKind: "manual-catalogue-export", sourceReference: "exp-2026-10-01:foreign", capturedAt: T0, tenant: "foreign" } },
    // REFUSAL: the foreign offer refuses the whole sheet fail-closed.
    { stepId: "s13", kind: "moff-sheet", factKey: "foreignInInput", at: T0 },
  ],
  assertions: [
    eq("of1", "moff.capture.offA.ok", true, "the first offer captures with the full §3.2 schema"),
    eq("of2", "moff.capture.offA.sourceKind", "manual-catalogue-export", "the offer's source is the MANUAL catalogue export kind (tracked provenance)"),
    eq("of3", "moff.capture.offA.capturedAt", T0, "the captured-at timestamp is the freshness anchor of record"),
    eq("of4", "moff.capture.offB.ok", true, "the second offer captures"),
    eq("of5", "moff.capture.offExpired.ok", true, "an offer captured while live but already expired at the comparison instant also captures"),
    eq("of6", "moff.capture.staleArrival.reasonCode", "CAPTURE_AFTER_WINDOW_END", "REFUSAL: an offer past its own validity window at capture is stale-on-arrival — never recorded as live"),
    eq("of7", "moff.capture.noSource.reasonCode", "SOURCE_REFERENCE_REQUIRED", "REFUSAL: the manual source reference is required (operator-auditable provenance)"),
    eq("of8", "moff.capture.totalMismatch.reasonCode", "TOTAL_MISMATCH", "REFUSAL: the total must equal quantity × unit cost exactly — never silently recomputed"),
    deq("of9", "moff.sheet.atT0.freshOfferIds", ["off-7710-a", "off-7710-b", "off-7710-lap", "off-7710-pend"], "the sheet at T0 lists every freshness-current offer (the sheet gates freshness ONLY — the supplier gate is the comparison's job)"),
    deq("of10", "moff.sheet.atT0.excluded", ["off-7710-old:expired"], "the expired offer is EXCLUDED with its verdict reported — honest exclusion, never silent"),
    eq("of11", "moff.sheet.atT0.expiredCount", 1, "the sheet counts one expired offer"),
    deq("of12", "moff.sheet.afterLapse.freshOfferIds", [], "THE FRESHNESS LAW: fifteen days later EVERY offer has lapsed — the sheet is empty, nothing stale appears current"),
    eq("of13", "moff.sheet.afterLapse.freshCount", 0, "the lapsed sheet holds zero current offers"),
    eq("of14", "moff.sheet.afterLapse.expiredCount", 5, "all five captured offers are reported expired"),
    deq("of15", "moff.compare.main.rankedOrder", ["off-7710-b", "off-7710-a"], "the EXISTING compareQuotes kernel ranks the eligible offers (the cheaper, faster offer first)"),
    eq("of16", "moff.compare.main.eligibleCount", 2, "exactly two offers are eligible after the hard-constraint gate"),
    eq("of17", "moff.compare.main.ineligibleCount", 3, "the expired, unverified-supplier and lapsed-supplier offers are all ineligible — hard failures no weight can rescue"),
    deq("of18", "moff.compare.main.hardFailures", ["off-7710-lap:supplier_verification:VERIFICATION_EXPIRED", "off-7710-old:freshness:OFFER_EXPIRED", "off-7710-pend:supplier_verification:SUPPLIER_NOT_VERIFIED"], "the per-offer rationale records every hard-constraint failure with its exact reason code"),
    deq("of19", "moff.compare.main.totals", ["off-7710-b:10000", "off-7710-a:7766"], "the weighted totals come from the composed kernel (integer bps)"),
    deq("of20", "moff.compare.main.priceScores", ["off-7710-b:10000", "off-7710-a:8333"], "the cheapest unit cost scores 10000; the other scores floor(1000000*10000/1200000)"),
    deq("of21", "moff.compare.main.termsScores", ["off-7710-b:10000", "off-7710-a:3000"], "the shortest delivery estimate scores 10000; the 10-day offer scores floor(3*10000/10)"),
    deq("of22", "moff.compare.main.capabilityScores", ["off-7710-b:10000", "off-7710-a:10000"], "both eligible offers fully cover the demanded SKU tag"),
    deq("of23", "moff.compare.main.supplierMatches", ["sup-accra:0.800000:none", "sup-tema:0.700000:higher_service_level"], "the EXISTING matchVendors kernel scores the eligible suppliers with recorded tie-breaks (the 24-month warranty outranks the 12-month via the documented proxy)"),
    deq("of24", "moff.compare.main.matchedTags", ["sup-accra:LT-5540", "sup-tema:LT-5540"], "the supplier match records the matched capability tags"),
    eq("of25", "moff.compare.foreignVerification.reasonCode", "TENANT_MISMATCH", "REFUSAL: a foreign-tenant verification record refuses the whole comparison fail-closed"),
    eq("of26", "moff.compare.badWeights.reasonCode", "WEIGHTS_MUST_SUM_TO_10000", "REFUSAL: weights summing to 9000 refuse — the policy is never silently rebalanced"),
    eq("of27", "moff.capture.foreignOffer.ok", true, "the foreign-tenant offer itself captures under the OTHER tenant's scope"),
    eq("of28", "moff.sheet.foreignInInput.reasonCode", "TENANT_MISMATCH", "REFUSAL: the foreign offer in the sheet input refuses the whole sheet fail-closed — never silently filtered"),
    deq("of29", "moff.log", [
      "capture:off-7710-a:ok:sup-accra",
      "capture:off-7710-b:ok:sup-tema",
      "capture:off-7710-old:ok:sup-accra",
      "capture:off-7710-pend:ok:sup-unverified",
      "capture:off-7710-lap:ok:sup-lapsed",
      "capture:off-7710-stale:refused:CAPTURE_AFTER_WINDOW_END",
      "capture:off-7710-nosrc:refused:SOURCE_REFERENCE_REQUIRED",
      "capture:off-7710-bad:refused:TOTAL_MISMATCH",
      "sheet:atT0:fresh:off-7710-a,off-7710-b,off-7710-lap,off-7710-pend:excluded:off-7710-old:expired",
      "sheet:afterLapse:fresh:-:excluded:off-7710-a:expired,off-7710-b:expired,off-7710-lap:expired,off-7710-old:expired,off-7710-pend:expired",
      "compare:main:ranked:1:off-7710-b:10000|2:off-7710-a:7766",
      "compare:foreignVerification:refused:TENANT_MISMATCH",
      "compare:badWeights:refused:WEIGHTS_MUST_SUM_TO_10000",
      "capture:off-7710-foreign:ok:sup-foreign",
      "sheet:foreignInInput:refused:TENANT_MISMATCH",
    ], "the offer log carries every capture, refusal, sheet verdict and comparison in order"),
  ],
};

export const F361C_PROCUREMENT_JOURNEYS: readonly AcceptanceJourney[] = [
  marketplaceRequestLifecycleJourney,
  marketplaceOfferFreshnessDisciplineJourney,
];
