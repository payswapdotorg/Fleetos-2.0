/**
 * @fleetos/acceptance-commerce — F351C vendor-surface journeys (Wave 15
 * lane C): vendor matching discipline and fulfillment-outcome KPI
 * rollups.
 *
 * CENSUS CITATION (the F351C commerce census — docs/evidence/F351C/
 * report.md §1, machine-measured at base cb572b8): every journey here
 * drives public APIs with ZERO corpus coverage across all three corpora
 * (grep proof): `matchVendors` (procurement matching.ts:47 — scored
 * matches with RECORDED tie-break rules; the existing vendor-capability-
 * feed step drives the DIFFERENT `capabilityMatchingFeed` API in
 * @fleetos/vendors) and `rollupVendorKpis` +
 * `capabilityCatalogSummary` (vendors capability-catalog.ts:175/108 —
 * fulfillment-outcome KPIs and the declared/verified catalog summary;
 * the existing vendor-kpi-view step drives the DIFFERENT
 * `buildVendorKpiRollup` API in vendor-lifecycle.ts).
 *
 * D14 form: unique ids, REAL domain public entry points, >=5 substantive
 * assertions incl. >=1 refusal each, deterministic byte-identity on
 * rerun. Single-epoch (T0): no step consumes the run anchor, no
 * assertion carries an epoch table (D13).
 */

import type { AcceptanceJourney, FactValue } from "../journey-contracts.js";

const eq = (id: string, fact: string, expected: FactValue, description: string) =>
  ({ id, description, fact, op: "eq" as const, expected });
const deq = (id: string, fact: string, expected: readonly string[], description: string) =>
  ({ id, description, fact, op: "deepEq" as const, expected });

/**
 * Vendor matching through the REAL procurement matching engine (driven
 * through the REAL ProcurementDirectory, which emits the
 * match-computed audit): the score composition is 60% capability
 * coverage + 30% service level + 10% cost score; matched tags are
 * carried verbatim; every match after the first records the tie-break
 * rule that decided its position; zero-match vendors and FOREIGN-tenant
 * vendors never enter the match set (fail-closed skip); a foreign demand
 * refuses the whole match with TENANT_MISMATCH; and a demand no vendor
 * can serve yields an honest empty match set.
 */
export const vendorMatchingDisciplineJourney: AcceptanceJourney = {
  id: "vendor-matching-discipline",
  persona: "vendor-manager",
  capability: "vendor-matching",
  goal: "Match vendors to a demand through the REAL matching engine — the score composes 60% capability coverage, 30% service level, and 10% cost score with the matched tags carried verbatim; a vendor with ZERO matched tags never enters the match set; a foreign-tenant vendor never enters the match set (fail-closed skip — its higher score is invisible); every match after the first RECORDS the tie-break rule that decided its position (higher_coverage, higher_service_level, lower_unit_cost, or lexicographic_vendor_id); a demand placed under the OTHER tenant refuses the whole match TENANT_MISMATCH; and a demand no seeded vendor can serve returns an honest empty match set with the match-computed audit still emitted.",
  steps: [
    { stepId: "s1", kind: "pdir-match-vendors", factKey: "main",
      demandId: "demand-match-1", demandTags: ["telemetry", "maintenance"],
      vendors: [
        { vendorId: "ven-full", capabilityTags: ["telemetry", "maintenance"], serviceLevel: 0.9, unitCost: 100 },
        { vendorId: "ven-part", capabilityTags: ["telemetry"], serviceLevel: 0.9, unitCost: 100 },
        { vendorId: "ven-nomatch", capabilityTags: ["repair"], serviceLevel: 1.0, unitCost: 10 },
        { vendorId: "ven-foreign", capabilityTags: ["telemetry", "maintenance"], serviceLevel: 1.0, unitCost: 10, tenant: "foreign" },
      ] },
    { stepId: "s2", kind: "pdir-match-vendors", factKey: "ties",
      demandId: "demand-match-2", demandTags: ["telemetry", "maintenance"],
      vendors: [
        { vendorId: "ven-tie-b", capabilityTags: ["telemetry"], serviceLevel: 0.8, unitCost: 50 },
        { vendorId: "ven-tie-a", capabilityTags: ["telemetry"], serviceLevel: 0.8, unitCost: 50 },
      ] },
    // The foreign-demand probe: the directory refuses the whole match.
    { stepId: "s3", kind: "pdir-match-vendors", factKey: "foreignDemand",
      demandId: "demand-match-3", demandTags: ["telemetry"], demandTenant: "foreign",
      vendors: [
        { vendorId: "ven-full", capabilityTags: ["telemetry", "maintenance"], serviceLevel: 0.9, unitCost: 100 },
      ] },
    // An honest empty match: no seeded vendor serves the demand's tags.
    { stepId: "s4", kind: "pdir-match-vendors", factKey: "empty",
      demandId: "demand-match-4", demandTags: ["hazmat"],
      vendors: [
        { vendorId: "ven-full", capabilityTags: ["telemetry", "maintenance"], serviceLevel: 0.9, unitCost: 100 },
        { vendorId: "ven-nomatch", capabilityTags: ["repair"], serviceLevel: 1.0, unitCost: 10 },
      ] },
  ],
  assertions: [
    eq("vm1", "pdir.match.main.ok", true, "the main match computes through the REAL directory"),
    eq("vm2", "pdir.match.main.matchCount", 2, "exactly two vendors match — the zero-match and foreign vendors never enter"),
    deq("vm3", "pdir.match.main.vendors", ["ven-full", "ven-part"], "the match order is deterministic (score desc)"),
    eq("vm4", "pdir.match.main.score.0", 0.870990099009901, "ven-full's score is the exact composition 0.6*1 + 0.3*0.9 + 0.1*(1/101)"),
    eq("vm5", "pdir.match.main.score.1", 0.570990099009901, "ven-part's score halves the coverage component (0.6*0.5)"),
    deq("vm6", "pdir.match.main.matchedTags", ["ven-full:telemetry+maintenance", "ven-part:telemetry"], "the matched tags are carried verbatim per match"),
    deq("vm7", "pdir.match.main.tieBreakRules", ["ven-full:none", "ven-part:higher_coverage"], "the first match records no tie-break; the second records higher_coverage (the rule that decided the order)"),
    eq("vm8", "pdir.match.main.auditKind", "procurement.match-computed", "the directory emits the match-computed audit event"),
    eq("vm9", "pdir.match.main.auditMatchCount", 2, "the audit carries the honest match count"),
    eq("vm10", "pdir.match.ties.matchCount", 2, "the tie pair both match"),
    deq("vm11", "pdir.match.ties.vendors", ["ven-tie-a", "ven-tie-b"], "identical vendors resolve on vendor-id lexical order"),
    deq("vm12", "pdir.match.ties.tieBreakRules", ["ven-tie-a:none", "ven-tie-b:lexicographic_vendor_id"], "the tie records the lexicographic_vendor_id rule verbatim"),
    eq("vm13", "pdir.match.ties.score.0", 0.5419607843137255, "the tied matches share the exact same score"),
    eq("vm14", "pdir.match.ties.score.1", 0.5419607843137255, "score equality is exact — the tie is genuine, not approximate"),
    eq("vm15", "pdir.match.foreignDemand.reasonCode", "TENANT_MISMATCH", "REFUSAL: a demand under the OTHER tenant refuses the whole match"),
    eq("vm16", "pdir.match.foreignDemand.matchCount", 0, "no matches are produced on refusal"),
    eq("vm17", "pdir.match.empty.ok", true, "a demand no vendor serves returns an honest empty match set"),
    eq("vm18", "pdir.match.empty.matchCount", 0, "the empty match count is zero — never a fabricated match"),
    eq("vm19", "pdir.match.empty.auditMatchCount", 0, "the audit honestly records zero matches"),
  ],
};

/**
 * Fulfillment-outcome KPI rollups through the REAL vendors
 * capability-catalog APIs: on-time means deliveredAt <= promisedAt (the
 * inclusive boundary counts as on-time); every ratio is an integer
 * number of basis points (floored); outcomes from other tenants are
 * ignored (the rollup is a tenant-scoped read model); a vendor with no
 * outcome history refuses EMPTY_PERFORMANCE_HISTORY; a malformed
 * negative quantity refuses NEGATIVE_QUANTITY; and the capability
 * catalog summary counts declared vs verified records for the vendor —
 * with foreign-tenant records never counted.
 */
export const vendorFulfillmentKpiRollupJourney: AcceptanceJourney = {
  id: "vendor-fulfillment-kpi-rollup",
  persona: "vendor-manager",
  capability: "vendor-performance",
  goal: "Roll up a vendor's fulfillment performance through the REAL rollupVendorKpis API — on-time means deliveredAt <= promisedAt (the equal boundary is ON time), the on-time ratio and fill rate are integer basis points (floored, never rounded up), foreign-tenant outcome records never enter the tenant-scoped rollup, a vendor with no history refuses EMPTY_PERFORMANCE_HISTORY (an honest refusal, never a zero-filled fabrication), a malformed negative quantity refuses NEGATIVE_QUANTITY, and the capabilityCatalogSummary counts the vendor's declared vs verified records — foreign-tenant capability records never counted.",
  steps: [
    { stepId: "s1", kind: "vkpi-outcome-seed", factKey: "seed",
      outcomes: [
        { vendorId: "ven-haul", orderId: "ord-100", promisedAt: 1_000, deliveredAt: 900, quantityOrdered: 10, quantityReceived: 10 },
        { vendorId: "ven-haul", orderId: "ord-101", promisedAt: 1_000, deliveredAt: 1_200, quantityOrdered: 10, quantityReceived: 8 },
        { vendorId: "ven-haul", orderId: "ord-102", promisedAt: 2_000, deliveredAt: 2_000, quantityOrdered: 5, quantityReceived: 5 },
        { vendorId: "ven-haul", orderId: "ord-900", promisedAt: 1_000, deliveredAt: 800, quantityOrdered: 20, quantityReceived: 20, tenant: "foreign" },
        { vendorId: "ven-other", orderId: "ord-103", promisedAt: 1_000, deliveredAt: 950, quantityOrdered: 7, quantityReceived: 7 },
      ] },
    { stepId: "s2", kind: "vkpi-rollup", factKey: "main", vendorId: "ven-haul", records: "seeded" },
    // A vendor with no outcome history refuses honestly.
    { stepId: "s3", kind: "vkpi-rollup", factKey: "empty", vendorId: "ven-unknown", records: "seeded" },
    // A malformed negative quantity refuses the whole rollup.
    { stepId: "s4", kind: "vkpi-rollup", factKey: "negative", vendorId: "ven-haul", records: "seeded", malformed: { vendorId: "ven-haul", quantityReceived: -1 } },
    // The declared/verified catalog summary (foreign records never counted).
    { stepId: "s5", kind: "vkpi-catalog-summary", factKey: "catalog", vendorId: "ven-haul",
      capabilities: [
        { vendorId: "ven-haul", tag: "telemetry", status: "verified" },
        { vendorId: "ven-haul", tag: "maintenance", status: "declared" },
        { vendorId: "ven-haul", tag: "repair", status: "declared" },
        { vendorId: "ven-other", tag: "telemetry", status: "verified" },
        { vendorId: "ven-haul", tag: "hazmat", status: "verified", tenant: "foreign" },
      ] },
  ],
  assertions: [
    eq("vk1", "vkpi.seed.seed.count", 5, "five outcome records are seeded (one foreign, one for another vendor)"),
    eq("vk2", "vkpi.seed.seed.foreignCount", 1, "one outcome record sits under the OTHER tenant"),
    eq("vk3", "vkpi.rollup.main.ok", true, "the rollup computes over the REAL seeded outcomes"),
    eq("vk4", "vkpi.rollup.main.outcomeCount", 3, "exactly THREE outcomes count — the foreign record and the other vendor's record never enter"),
    eq("vk5", "vkpi.rollup.main.onTimeCount", 2, "two deliveries are on time (deliveredAt <= promisedAt; the equal boundary counts)"),
    eq("vk6", "vkpi.rollup.main.onTimeRatioBps", 6666, "the on-time ratio is floor(2*10000/3) = 6666 bps — floored, never rounded up"),
    eq("vk7", "vkpi.rollup.main.quantityOrderedTotal", 25, "the ordered total composes from the counted outcomes only (10+10+5)"),
    eq("vk8", "vkpi.rollup.main.quantityReceivedTotal", 23, "the received total composes from the counted outcomes only (10+8+5)"),
    eq("vk9", "vkpi.rollup.main.fillRateBps", 9200, "the fill rate is floor(23*10000/25) = 9200 bps"),
    eq("vk10", "vkpi.rollup.empty.reasonCode", "EMPTY_PERFORMANCE_HISTORY", "REFUSAL: a vendor with no outcome history refuses — never a zero-filled fabrication"),
    eq("vk11", "vkpi.rollup.negative.reasonCode", "NEGATIVE_QUANTITY", "REFUSAL: a malformed negative quantity refuses the whole rollup"),
    eq("vk12", "vkpi.rollup.negative.ok", false, "the malformed rollup does not produce a partial result"),
    eq("vk13", "vkpi.catalog.catalog.declaredCount", 2, "the catalog summary counts ven-haul's two declared capabilities"),
    eq("vk14", "vkpi.catalog.catalog.verifiedCount", 1, "the summary counts ONE verified capability — the foreign-tenant verified record never counts"),
  ],
};

export const F351C_VENDOR_JOURNEYS: readonly AcceptanceJourney[] = [
  vendorMatchingDisciplineJourney,
  vendorFulfillmentKpiRollupJourney,
];
