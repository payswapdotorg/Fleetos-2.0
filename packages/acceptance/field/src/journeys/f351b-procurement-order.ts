/**
 * @fleetos/acceptance-field — F351B journey 4: the procurement order
 * authorization discipline (Wave 16 lane A — the masked-industry
 * coverage tranche 1; construction-primary persona: contractor/vendor
 * ordering for site works; both personas procure heavily).
 *
 * CENSUS CITATION (F351B report §1, machine-measured at base `4f59ffe`;
 * zero grep matches across the field/security/commerce corpora):
 *   - matchVendors — packages/procurement/src/matching.ts:47
 *   - createOrder — packages/procurement/src/lifecycle.ts:180
 *   (transitionOrder — packages/procurement/src/lifecycle.ts:211 — is the
 *   commerce-covered lifecycle SUBSTRATE honestly used to carry the order
 *   to receipt; it is not claimed as new coverage.)
 *
 * The REAL capability is @fleetos/procurement's ordering law: the
 * deterministic vendor matcher (transparent score breakdown, recorded
 * tie-break rules, tenant fail-closed filtering of foreign vendors) and
 * the Guardian-authorization law A5 (an order NEVER self-authorizes:
 * no decision presented refuses; a denied decision refuses; an
 * authorized decision creates the draft order).
 *
 * Vocabulary law: persona `maintenance-planner` + capability
 * `maintenance` (the parts/services ordering family of the frozen
 * 14-capability vocabulary; no vocabulary change, F331A precedent).
 */

import type { AcceptanceJourney } from "../journey-contracts.js";
import { FOREIGN_TENANT } from "../fixtures.js";

export const procurementOrderAuthorizationJourney: AcceptanceJourney = {
  id: "procurement-order-authorization",
  persona: "maintenance-planner",
  capability: "maintenance",
  goal: "Order the crane-pad consumables honestly: the REAL matcher scores vendors transparently with recorded tie-breaks and tenant fail-closed filtering, and the REAL order-creation law never self-authorizes — a missing or denied Guardian decision refuses; the authorized draft ships and is received.",
  steps: [
    { id: "m1", summary: "match vendors for the site-services need (four candidates: one full coverage, one partial, one foreign-tenant, one no-overlap)", op: { kind: "pr.match", needId: "need_site-crane-pad", quantity: 40, requiredBy: "2026-10-21", capabilityTags: ["heavy-tire", "field-service"], vendors: [
      { vendorId: "ven_north-supply", capabilityTags: ["heavy-tire", "field-service"], serviceLevel: 1, unitCost: 100 },
      { vendorId: "ven_harbor-parts", capabilityTags: ["heavy-tire"], serviceLevel: 1, unitCost: 50 },
      { vendorId: "ven_foreign-tools", tenantId: FOREIGN_TENANT, capabilityTags: ["heavy-tire", "field-service"], serviceLevel: 1, unitCost: 10 },
      { vendorId: "ven_plumbing-only", capabilityTags: ["plumbing"], serviceLevel: 1, unitCost: 20 },
    ] } },
    { id: "m2", summary: "match two IDENTICAL vendors (the deterministic tie-break decides)", op: { kind: "pr.match", needId: "need_site-consumables", quantity: 12, requiredBy: "2026-10-28", capabilityTags: ["field-service"], vendors: [
      { vendorId: "ven_kilo-supply", capabilityTags: ["field-service"], serviceLevel: 0.8, unitCost: 25 },
      { vendorId: "ven_juliet-parts", capabilityTags: ["field-service"], serviceLevel: 0.8, unitCost: 25 },
    ] } },
    { id: "m3", summary: "try creating the order with NO Guardian decision (must refuse — law A5)", expectRefusal: true, op: { kind: "pr.order-create", orderId: "ord_site-0301", quoteId: "quo_site-0301" } },
    { id: "m4", summary: "try creating the order with a DENIED Guardian decision (must refuse)", expectRefusal: true, op: { kind: "pr.order-create", orderId: "ord_site-0301", quoteId: "quo_site-0301", guardian: { decisionId: "gd_001", authorized: false, reasonCode: "budget-frozen" } } },
    { id: "m5", summary: "create the order under the authorized Guardian decision (draft)", op: { kind: "pr.order-create", orderId: "ord_site-0301", quoteId: "quo_site-0301", guardian: { decisionId: "gd_002", authorized: true, reasonCode: "shift-budget-approved" } } },
    { id: "m6", summary: "try receiving straight from draft (must refuse — illegal transition)", expectRefusal: true, op: { kind: "pr.order-transition", orderId: "ord_site-0301", command: "receive" } },
    { id: "m7", summary: "confirm the order", op: { kind: "pr.order-transition", orderId: "ord_site-0301", command: "confirm" } },
    { id: "m8", summary: "ship the order", op: { kind: "pr.order-transition", orderId: "ord_site-0301", command: "ship" } },
    { id: "m9", summary: "receive the order on the dock", op: { kind: "pr.order-transition", orderId: "ord_site-0301", command: "receive" } },
    { id: "m10", summary: "try receiving again (must refuse — received is terminal)", expectRefusal: true, op: { kind: "pr.order-transition", orderId: "ord_site-0301", command: "receive" } },
  ],
  assertions: [
    { id: "v1", description: "the matcher admits exactly the two overlapping vendors (the foreign-tenant and no-overlap vendors are excluded)", reading: "m1.pr.matchCount", op: "deep-equals", expected: 2 },
    { id: "v2", description: "the top match is the full-coverage vendor", reading: "m1.pr.topVendorId", op: "deep-equals", expected: "ven_north-supply" },
    { id: "v3", description: "the top match covers the whole demand vocabulary (both tags)", reading: "m1.pr.topMatchedTags", op: "deep-equals", expected: ["heavy-tire", "field-service"] },
    { id: "v4", description: "the ranked order is score-descending (full coverage before partial)", reading: "m1.pr.vendorIds", op: "deep-equals", expected: ["ven_north-supply", "ven_harbor-parts"] },
    { id: "v5", description: "the partial-coverage match carries the REAL recorded tie-break rule (higher coverage decided it)", reading: "m1.pr.tieBreaks", op: "deep-equals", expected: ["higher_coverage"] },
    { id: "v6", description: "identical vendors tie-break lexicographically (ven_juliet-parts before ven_kilo-supply)", reading: "m2.pr.topVendorId", op: "deep-equals", expected: "ven_juliet-parts" },
    { id: "v7", description: "the tie is RECORDED, never arbitrary (the REAL lexicographic rule)", reading: "m2.pr.tieBreaks", op: "deep-equals", expected: ["lexicographic_vendor_id"] },
    { id: "v8", description: "order creation without a Guardian decision refuses with the REAL reason (law A5)", reading: "m3.pr.reasonCode", op: "deep-equals", expected: "AUTHORIZATION_REQUIRED" },
    { id: "v9", description: "a denied Guardian decision refuses with the REAL reason", reading: "m4.pr.reasonCode", op: "deep-equals", expected: "AUTHORIZATION_DENIED" },
    { id: "v10", description: "the authorized creation lands the order in draft", reading: "m5.pr.orderStatus", op: "deep-equals", expected: "draft" },
    { id: "v11", description: "the draft carries the REAL quote reference", reading: "m5.pr.orderQuoteId", op: "deep-equals", expected: "quo_site-0301" },
    { id: "v12", description: "receiving from draft refuses with the REAL reason (the order lifecycle law)", reading: "m6.pr.reasonCode", op: "deep-equals", expected: "ILLEGAL_TRANSITION" },
    { id: "v13", description: "confirmation moves the order to confirmed", reading: "m7.pr.orderStatus", op: "deep-equals", expected: "confirmed" },
    { id: "v14", description: "shipping moves the order to shipped", reading: "m8.pr.orderStatus", op: "deep-equals", expected: "shipped" },
    { id: "v15", description: "the shipment is received", reading: "m9.pr.orderStatus", op: "deep-equals", expected: "received" },
    { id: "v16", description: "a second receipt refuses — received is terminal", reading: "m10.pr.reasonCode", op: "deep-equals", expected: "ILLEGAL_TRANSITION" },
  ],
};
