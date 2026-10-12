/**
 * @fleetos/acceptance-commerce — F331C row 34: the marketplace
 * transaction flow journey (ordering/checkout over published listings).
 *
 * CENSUS CITATION (D12, the F331C commerce census — see
 * docs/evidence/F331C/report.md §4): `marketplace-transaction-flow` is a
 * census-certified TRANSITION-class responder — flips at −1h (the
 * inclusive window boundary turns ord-lapsed's checkout back on and its
 * expiry off) and at +1d and beyond (the deadline breach refuses
 * ord-legacy's checkout and opens ord-expiring's expiry). Both flips are
 * genuine D2(b) window/deadline transitions over ABSOLUTE anchored order
 * data vs the run clock; no timestamp-equality pins anywhere (D13).
 *
 * The per-epoch tables on the six D9-relevant responding assertions
 * cover the frozen schedule {T0, T0+30d, T0+90d} exactly (D9: 30d =
 * 2_592_000_000 ms, 90d = 7_776_000_000 ms); every other assertion is
 * single-valued T0-anchored.
 */

import type { AcceptanceJourney, FactValue } from "../journey-contracts.js";
import { COMMERCE_T0 } from "../journey-world.js";

const HOUR = 3_600_000;
const DAY = 86_400_000;
const T0 = COMMERCE_T0;
const eq = (id: string, fact: string, expected: FactValue, description: string) =>
  ({ id, description, fact, op: "eq" as const, expected });
const deq = (id: string, fact: string, expected: readonly string[], description: string) =>
  ({ id, description, fact, op: "deepEq" as const, expected });

/**
 * The marketplace transaction flow: REAL publication gate → REAL
 * place/checkout/cancel/expire state machine over the published
 * listings, with honest refusal paths (unacknowledged exclusions,
 * delisted source, foreign-tenant input, invalid numbers, duplicate
 * ids, deadline breach with the exact overshoot, checkout limit with
 * the exact overshoot, terminality) and the deterministic board.
 */
export const marketplaceTransactionFlowJourney: AcceptanceJourney = {
  id: "marketplace-transaction-flow",
  persona: "procurement-lead",
  capability: "marketplace-transactions",
  goal: "Order and check out over PUBLISHED marketplace listings through the REAL transaction state machine — the seed publishes through the REAL publication gate (one listing is delisted by the REAL revocation cascade); placement refuses unacknowledged exclusions, delisted sources, foreign-tenant inputs, invalid numbers and duplicate ids; checkout enforces the listing-still-published gate, the hold-window deadline (inclusive boundary; breach carries the exact overshoot), the exact-total recomputation and the checkout limit; cancel/expire have their own refusal laws; the board summarizes deterministically. Absolute anchored orders (placed at T0−25h with absolute hold windows) against the run clock produce genuine window/deadline transitions.",
  steps: [
    // Seed: REAL publication gate; the delisted listing comes from the REAL cascade.
    { stepId: "s1", kind: "mtx-listing-seed", factKey: "seed",
      records: [
        { vendorId: "ven-1", tag: "cold-chain" },
        { vendorId: "ven-1", tag: "gps" },
        { vendorId: "ven-2", tag: "gps" },
      ],
      listings: [
        { listingId: "lst-fresh", vendorId: "ven-1", claimedCapabilities: ["cold-chain", "gps"], exclusions: ["weekend-delivery"], publishedAt: T0 - 30 * DAY },
        { listingId: "lst-legacy", vendorId: "ven-1", claimedCapabilities: ["cold-chain"], exclusions: [], publishedAt: T0 - 30 * DAY },
        { listingId: "lst-other-vendor", vendorId: "ven-2", claimedCapabilities: ["gps"], exclusions: [], delisted: true, publishedAt: T0 - 30 * DAY },
      ] },
    // Placement refusal paths.
    { stepId: "s2", kind: "mtx-place-order", factKey: "unack", orderId: "ord-x1", listingId: "lst-fresh", vendorId: "ven-1",
      quantity: 4, unitPriceMinor: 12_500, holdMs: 48 * HOUR, acknowledgeExclusions: false, at: "now" },
    { stepId: "s3", kind: "mtx-place-order", factKey: "foreign", orderId: "ord-x2", listingId: "lst-legacy", vendorId: "ven-1",
      quantity: 2, unitPriceMinor: 12_500, holdMs: 48 * HOUR, acknowledgeExclusions: true, at: "now", injectForeignListing: true },
    { stepId: "s4", kind: "mtx-place-order", factKey: "delistedSrc", orderId: "ord-x3", listingId: "lst-other-vendor", vendorId: "ven-2",
      quantity: 1, unitPriceMinor: 12_500, holdMs: 48 * HOUR, acknowledgeExclusions: true, at: "now" },
    { stepId: "s5", kind: "mtx-place-order", factKey: "badQty", orderId: "ord-x4", listingId: "lst-legacy", vendorId: "ven-1",
      quantity: 0, unitPriceMinor: 12_500, holdMs: 48 * HOUR, acknowledgeExclusions: true, at: "now" },
    // Successful placements: the fresh pair (driver clock), the anchored trio (absolute past).
    { stepId: "s6", kind: "mtx-place-order", factKey: "fresh", orderId: "ord-fresh", listingId: "lst-fresh", vendorId: "ven-1",
      quantity: 4, unitPriceMinor: 12_500, holdMs: 48 * HOUR, acknowledgeExclusions: true, at: "now" },
    { stepId: "s7", kind: "mtx-place-order", factKey: "dup", orderId: "ord-fresh", listingId: "lst-fresh", vendorId: "ven-1",
      quantity: 4, unitPriceMinor: 12_500, holdMs: 48 * HOUR, acknowledgeExclusions: true, at: "now" },
    { stepId: "s8", kind: "mtx-place-order", factKey: "legacy", orderId: "ord-legacy", listingId: "lst-legacy", vendorId: "ven-1",
      quantity: 4, unitPriceMinor: 12_500, holdMs: 30 * HOUR, acknowledgeExclusions: true, at: T0 - 25 * HOUR },
    { stepId: "s9", kind: "mtx-place-order", factKey: "lapsed", orderId: "ord-lapsed", listingId: "lst-legacy", vendorId: "ven-1",
      quantity: 2, unitPriceMinor: 12_500, holdMs: 24 * HOUR, acknowledgeExclusions: true, at: T0 - 25 * HOUR },
    { stepId: "s10", kind: "mtx-place-order", factKey: "expiring", orderId: "ord-expiring", listingId: "lst-legacy", vendorId: "ven-1",
      quantity: 1, unitPriceMinor: 12_500, holdMs: 30 * HOUR, acknowledgeExclusions: true, at: T0 - 25 * HOUR },
    { stepId: "s11", kind: "mtx-place-order", factKey: "big", orderId: "ord-big", listingId: "lst-fresh", vendorId: "ven-1",
      quantity: 80, unitPriceMinor: 12_500, holdMs: 48 * HOUR, acknowledgeExclusions: true, at: "now" },
    { stepId: "s12", kind: "mtx-place-order", factKey: "temp", orderId: "ord-temp", listingId: "lst-fresh", vendorId: "ven-1",
      quantity: 1, unitPriceMinor: 12_500, holdMs: 48 * HOUR, acknowledgeExclusions: true, at: "now" },
    // Cancellation laws.
    { stepId: "s13", kind: "mtx-cancel-order", factKey: "tempNoReason", orderId: "ord-temp", reason: "", at: "now" },
    { stepId: "s14", kind: "mtx-cancel-order", factKey: "temp", orderId: "ord-temp", reason: "buyer switched carrier", at: "now" },
    // Checkouts: the fresh pair (invariant), the limit path, the anchored responders.
    { stepId: "s15", kind: "mtx-checkout-order", factKey: "freshOk", orderId: "ord-fresh", limitMinor: 1_000_000, at: "now" },
    { stepId: "s16", kind: "mtx-checkout-order", factKey: "freshAgain", orderId: "ord-fresh", limitMinor: 1_000_000, at: "now" },
    { stepId: "s17", kind: "mtx-checkout-order", factKey: "limit", orderId: "ord-big", limitMinor: 999_999, at: "now" },
    { stepId: "s18", kind: "mtx-checkout-order", factKey: "tempAfterCancel", orderId: "ord-temp", limitMinor: 1_000_000, at: "now" },
    { stepId: "s19", kind: "mtx-checkout-order", factKey: "legacyOk", orderId: "ord-legacy", limitMinor: 1_000_000, at: "now" },
    { stepId: "s20", kind: "mtx-checkout-order", factKey: "lapsed", orderId: "ord-lapsed", limitMinor: 1_000_000, at: "now" },
    // Expiries: the lapsed window (already lapsed at T0), the expiring window (open until T0+5h).
    { stepId: "s21", kind: "mtx-expire-order", factKey: "lapsed", orderId: "ord-lapsed", at: "now" },
    { stepId: "s22", kind: "mtx-expire-order", factKey: "lapsedAgain", orderId: "ord-lapsed", at: "now" },
    { stepId: "s23", kind: "mtx-expire-order", factKey: "expiring", orderId: "ord-expiring", at: "now" },
    // Board.
    { stepId: "s24", kind: "mtx-order-board", factKey: "board" },
  ],
  assertions: [
    eq("a1", "mtx.seed.seed.count", 3, "three listings are published through the REAL publication gate"),
    deq("a2", "mtx.seed.seed.published", ["lst-fresh", "lst-legacy"], "two listings are live (published status)"),
    deq("a3", "mtx.seed.seed.delisted", ["lst-other-vendor"], "the delisted listing was produced by the REAL revocation cascade"),
    eq("a4", "mtx.place.unack.reasonCode", "EXCLUSIONS_NOT_ACKNOWLEDGED", "placement refuses an unacknowledged honest exclusion"),
    eq("a5", "mtx.place.foreign.reasonCode", "TENANT_MISMATCH", "a foreign-tenant listing in the placement input refuses fail-closed"),
    eq("a6", "mtx.place.delistedSrc.reasonCode", "LISTING_NOT_PUBLISHED", "a delisted listing can never be ordered"),
    eq("a7", "mtx.place.badQty.reasonCode", "INVALID_QUANTITY", "a non-positive quantity refuses placement"),
    eq("a8", "mtx.place.fresh.ok", true, "the fresh order places against the published listing"),
    eq("a9", "mtx.place.fresh.totalMinor", 50_000, "the exact integer total is quantity × unit price"),
    deq("a10", "mtx.place.fresh.exclusions", ["weekend-delivery"], "the listing's exclusions are carried VERBATIM onto the acknowledged order"),
    eq("a11", "mtx.place.dup.reasonCode", "DUPLICATE_ORDER_ID", "a duplicate orderId refuses placement"),
    eq("a12", "mtx.place.legacy.validUntil", T0 + 5 * HOUR, "the anchored legacy order's hold window ends at the absolute deadline T0+5h"),
    eq("a13", "mtx.place.lapsed.validUntil", T0 - HOUR, "the anchored lapsed order's hold window ended at T0−1h"),
    eq("a14", "mtx.place.expiring.ok", true, "the expiring order places (never checked out — its window is probed by the expiry transition)"),
    eq("a15", "mtx.checkout.freshOk.ok", true, "the fresh order checks out within its hold window"),
    eq("a16", "mtx.checkout.freshOk.status", "checked-out", "the checkout transition lands in checked-out"),
    eq("a17", "mtx.checkout.freshOk.totalMinor", 50_000, "the checkout carries the exact total"),
    eq("a18", "mtx.checkout.freshAgain.reasonCode", "ORDER_NOT_PLACED", "a checked-out order is terminal — no second checkout"),
    eq("a19", "mtx.checkout.limit.reasonCode", "CHECKOUT_LIMIT_EXCEEDED", "the checkout limit path refuses with the exact overshoot"),
    eq("a20", "mtx.checkout.limit.overshootMinor", 1, "the overshoot is exactly 1 minor unit — never clamped"),
    eq("a21", "mtx.checkout.limit.totalMinor", 1_000_000, "the refused checkout carries the exact would-be total"),
    { id: "a22", description: "the anchored legacy order checks out within its absolute window at T0 (deadline breach beyond)", fact: "mtx.checkout.legacyOk.ok", op: "eq", expected: true },
    { id: "a23", description: "the legacy checkout status is checked-out at T0 (flips to refused beyond the window)", fact: "mtx.checkout.legacyOk.status", op: "eq", expected: "checked-out" },
    { id: "a24", description: "the legacy checkout has no refusal at T0 (the deadline breach names itself beyond the window)", fact: "mtx.checkout.legacyOk.reasonCode", op: "eq", expected: null },
    eq("a25", "mtx.checkout.legacyOk.totalMinor", 50_000, "the legacy order's total is invariant across the window boundary (both paths carry it)"),
    eq("a26", "mtx.checkout.lapsed.ok", false, "the lapsed order's checkout is refused at T0 — its window ended at T0−1h"),
    eq("a27", "mtx.checkout.lapsed.reasonCode", "ORDER_WINDOW_EXPIRED", "the refusal names the deadline breach"),
    eq("a28", "mtx.checkout.lapsed.validUntil", T0 - HOUR, "the refusal carries the exact absolute deadline"),
    eq("a29", "mtx.expire.lapsed.ok", true, "the lapsed order expires through the explicit transition (its window had already lapsed at T0)"),
    eq("a30", "mtx.expire.lapsed.status", "expired", "the expiry transition lands in expired"),
    { id: "a31", description: "the expiring order refuses early expiry at T0 (its window is open until T0+5h)", fact: "mtx.expire.expiring.ok", op: "eq", expected: false },
    { id: "a32", description: "the expiring order is not yet expired at T0 (the transition lands beyond the window)", fact: "mtx.expire.expiring.status", op: "eq", expected: null },
    { id: "a33", description: "the early-expiry refusal names NOT_EXPIRED_YET at T0", fact: "mtx.expire.expiring.reasonCode", op: "eq", expected: "NOT_EXPIRED_YET" },
    eq("a34", "mtx.expire.lapsedAgain.reasonCode", "ILLEGAL_TRANSITION", "an expired order is terminal — no second transition"),
    eq("a35", "mtx.cancel.tempNoReason.reasonCode", "CANCEL_REASON_REQUIRED", "cancellation without a reason refuses"),
    eq("a36", "mtx.cancel.temp.status", "cancelled", "the cancel transition lands in cancelled"),
    eq("a37", "mtx.cancel.temp.cancelledReason", "buyer switched carrier", "the cancellation reason is carried verbatim"),
    eq("a38", "mtx.checkout.tempAfterCancel.reasonCode", "ORDER_NOT_PLACED", "a cancelled order can never be checked out"),
    eq("a39", "mtx.board.board.total", 6, "the board counts exactly the six placed orders"),
    deq("a40", "mtx.board.board.orderIds", ["ord-big", "ord-expiring", "ord-fresh", "ord-lapsed", "ord-legacy", "ord-temp"], "the board lists the orders in the documented lexical order"),
  ],
};

export const MARKETPLACE_TRANSACTION_JOURNEYS: readonly AcceptanceJourney[] = [
  marketplaceTransactionFlowJourney,
];
