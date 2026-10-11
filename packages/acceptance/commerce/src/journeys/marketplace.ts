/**
 * @fleetos/acceptance-commerce — vendor marketplace + directory journeys
 * (F321C, Wave 12 lane C).
 *
 * Two genuinely distinct journeys over REAL `@fleetos/vendors` public
 * entry points that no acceptance corpus drove before (machine-verified
 * with rg over packages/acceptance/** — see the F321C report §3):
 *   1. marketplace-publication-lifecycle — the F310C §3.2 row-11 slot:
 *      the publication gate (verified-capability law with the verbatim
 *      per-claim report), the revocation→delisting cascade (already
 *      delisted listings keep their original reason), and deterministic
 *      tenant-scoped search (delisted never match).
 *   2. vendor-directory-service-relationship — the row-12 REPLACEMENT
 *      (aurum-delta-sync-session is EXCLUDED: Aurum is CONTRACT_ONLY /
 *      provider not ready): the VendorDirectory over the REAL in-memory
 *      repository — service-relationship transitions with audit events,
 *      worst-wins scorecard aggregation, the capability matching feed,
 *      and fail-closed cross-tenant reads.
 */

import type { AcceptanceJourney, FactValue } from "../journey-contracts.js";
import { CLOCK } from "../journey-world.js";

const eq = (id: string, fact: string, expected: FactValue, description: string) =>
  ({ id, description, fact, op: "eq" as const, expected });
const deq = (id: string, fact: string, expected: readonly string[], description: string) =>
  ({ id, description, fact, op: "deepEq" as const, expected });

export const marketplacePublicationLifecycleJourney: AcceptanceJourney = {
  id: "marketplace-publication-lifecycle",
  persona: "vendor-manager",
  capability: "vendor-marketplace",
  goal: "Publish marketplace listings through the REAL publication gate — every claimed capability must be a verified record of this vendor in this tenant (one unverified or unknown claim refuses the WHOLE publication with a verbatim per-claim report, exclusions carried verbatim); revoking a capability cascades to exactly the intersecting listings (already-delisted keep their original reason); search is deterministic (vendor-id then listing-id lexical) and delisted listings never match; foreign-tenant records in any input refuse fail-closed.",
  steps: [
    { stepId: "s1", kind: "marketplace-capabilities-seed", factKey: "seed", records: [
      { vendorId: "ven-1", tag: "cold-chain", status: "verified" },
      { vendorId: "ven-1", tag: "gps", status: "verified" },
      { vendorId: "ven-1", tag: "hazmat", status: "declared" },
      { vendorId: "ven-2", tag: "hazmat", status: "verified" },
      { vendorId: "ven-3", tag: "cold-chain", status: "verified", tenant: "foreign" },
    ] },
    { stepId: "s2", kind: "marketplace-publish", factKey: "ok1", listingId: "listing-1", vendorId: "ven-1",
      claimedCapabilities: ["cold-chain", "gps"], exclusions: ["weekend-delivery"] },
    { stepId: "s3", kind: "marketplace-publish", factKey: "unverified", listingId: "listing-2", vendorId: "ven-1",
      claimedCapabilities: ["hazmat"], exclusions: [] },
    { stepId: "s4", kind: "marketplace-publish", factKey: "unknown", listingId: "listing-3", vendorId: "ven-1",
      claimedCapabilities: ["cold-chain", "telemetry"], exclusions: [] },
    { stepId: "s5", kind: "marketplace-publish", factKey: "empty", listingId: "listing-4", vendorId: "ven-1",
      claimedCapabilities: [], exclusions: [] },
    { stepId: "s6", kind: "marketplace-publish", factKey: "foreign", listingId: "listing-5", vendorId: "ven-3",
      claimedCapabilities: ["cold-chain"], exclusions: [] },
    { stepId: "s7", kind: "marketplace-publish", factKey: "ok2", listingId: "listing-6", vendorId: "ven-2",
      claimedCapabilities: ["hazmat"], exclusions: [] },
    { stepId: "s8", kind: "marketplace-search", factKey: "cold", capabilityTag: "cold-chain", vendorId: null },
    { stepId: "s9", kind: "marketplace-search", factKey: "all", capabilityTag: null, vendorId: null },
    { stepId: "s10", kind: "marketplace-revoke-cascade", factKey: "mixed", vendorId: "ven-2", revokedTags: ["hazmat"],
      foreignVendorListingInjected: true },
    { stepId: "s11", kind: "marketplace-revoke-cascade", factKey: "delist", vendorId: "ven-1", revokedTags: ["cold-chain"] },
    { stepId: "s12", kind: "marketplace-search", factKey: "afterDelist", capabilityTag: "cold-chain", vendorId: null },
    { stepId: "s13", kind: "marketplace-search", factKey: "hazmat", capabilityTag: "hazmat", vendorId: null },
    { stepId: "s14", kind: "marketplace-revoke-cascade", factKey: "revokeAgain", vendorId: "ven-1", revokedTags: ["gps"] },
    { stepId: "s15", kind: "marketplace-revoke-cascade", factKey: "noTags", vendorId: "ven-2", revokedTags: [] },
    { stepId: "s16", kind: "marketplace-search", factKey: "foreign", capabilityTag: "cold-chain", vendorId: null,
      foreignListingInjected: true },
  ],
  assertions: [
    eq("a1", "mp.seed.seed.count", 5, "five capability records are seeded"),
    deq("a2", "mp.seed.seed.verifiedTags", ["ven-1:cold-chain", "ven-1:gps", "ven-2:hazmat", "ven-3:cold-chain"], "the verified records are exactly the four seeded verified tags (the declared one is not verified)"),
    eq("a3", "mp.publish.ok1.ok", true, "a listing whose claims are all verified publishes"),
    eq("a4", "mp.publish.ok1.status", "published", "the listing is published"),
    deq("a5", "mp.publish.ok1.exclusions", ["weekend-delivery"], "the declared exclusions are carried VERBATIM onto the published listing — what the vendor declared is what buyers see"),
    deq("a6", "mp.publish.ok1.claimReport", ["cold-chain:verified:-", "gps:verified:-"], "every claim reports verified with no reason code"),
    eq("a7", "mp.publish.unverified.ok", false, "a listing claiming a declared-but-unverified capability refuses the ENTIRE publication"),
    eq("a8", "mp.publish.unverified.reasonCode", "CAPABILITY_UNVERIFIED", "the refusal names the publication gate reason"),
    deq("a9", "mp.publish.unverified.claimReport", ["hazmat:declared:CAPABILITY_UNVERIFIED"], "the per-claim report names exactly the unverified claim"),
    deq("a10", "mp.publish.unknown.claimReport", ["cold-chain:verified:-", "telemetry:unknown:CAPABILITY_UNKNOWN"], "an unknown capability tag is reported per-claim, never silently dropped"),
    eq("a11", "mp.publish.empty.reasonCode", "NO_CLAIMED_CAPABILITIES", "a listing with no claimed capabilities refuses"),
    eq("a12", "mp.publish.foreign.reasonCode", "TENANT_MISMATCH", "a foreign-tenant capability record in the input refuses the publication fail-closed"),
    eq("a13", "mp.publish.ok2.ok", true, "the second vendor's verified listing publishes"),
    eq("a14", "mp.publish.ok2.publishedCount", 2, "exactly two listings are live"),
    deq("a15", "mp.search.cold.ids", ["listing-1"], "search by capability tag matches the claiming listing"),
    deq("a16", "mp.search.all.ids", ["listing-1", "listing-6"], "unfiltered search returns both listings in the documented total order (vendor-id lexical, then listing-id lexical)"),
    eq("a17", "mp.search.all.ordering", "vendor-id-lexical-then-listing-id-lexical", "the ordering law is carried verbatim for evidence"),
    eq("a18", "mp.cascade.mixed.ok", false, "a foreign-vendor listing in the cascade input refuses the WHOLE cascade"),
    eq("a19", "mp.cascade.mixed.reasonCode", "VENDOR_MISMATCH", "the cascade refusal names the vendor boundary"),
    deq("a20", "mp.cascade.delist.delistedIds", ["listing-1"], "revoking cold-chain delists exactly the intersecting listing"),
    eq("a21", "mp.cascade.delist.firstDelistReason", "CAPABILITY_REVOKED:cold-chain", "the delist reason records the revoked tags"),
    deq("a22", "mp.search.afterDelist.ids", [], "a delisted listing NEVER matches search"),
    deq("a23", "mp.search.hazmat.ids", ["listing-6"], "the untouched listing of the other vendor still matches"),
    deq("a24", "mp.cascade.revokeAgain.delistedIds", [], "an already-delisted listing is not re-delisted"),
    eq("a25", "mp.cascade.revokeAgain.firstDelistReason", "CAPABILITY_REVOKED:cold-chain", "the already-delisted listing keeps its ORIGINAL delist reason"),
    eq("a26", "mp.cascade.noTags.reasonCode", "NO_REVOKED_TAGS", "a revocation with no tags refuses"),
    eq("a27", "mp.search.foreign.ok", false, "a foreign-tenant listing in the search input refuses the search"),
    eq("a28", "mp.search.foreign.reasonCode", "TENANT_MISMATCH", "the search refusal names the tenant boundary — never silently filtered"),
  ],
};

export const vendorDirectoryServiceRelationshipJourney: AcceptanceJourney = {
  id: "vendor-directory-service-relationship",
  persona: "vendor-manager",
  capability: "vendor-management",
  goal: `Drive the REAL VendorDirectory over the in-memory repository (seeded at ${CLOCK.iso1}): service-relationship transitions append audit events with verifiable digests and refuse illegal transitions and missing reasons; worst-wins scorecard aggregation names the worst metric (EMPTY_SCORECARD and SCORE_OUT_OF_RANGE refuse); the capability matching feed is deterministic (active vendors only, tenant-scoped, lexical order); cross-tenant reads through the repository return NOTHING.`,
  steps: [
    { stepId: "s1", kind: "vendor-directory-seed", factKey: "seed",
      vendors: [
        { vendorId: "v-1", displayName: "Northwind Logistics", status: "active", capabilityTags: ["cold-chain", "gps"] },
        { vendorId: "v-2", displayName: "Meridian Freight", status: "suspended", capabilityTags: ["gps"] },
        { vendorId: "v-3", displayName: "Aurora Chemical", status: "active", capabilityTags: ["hazmat"] },
        { vendorId: "v-4", displayName: "Borealis Cold", status: "active", capabilityTags: ["cold-chain"] },
        { vendorId: "v-5", displayName: "Zenith Haul", status: "active", capabilityTags: ["gps"] },
        { vendorId: "v-9", displayName: "Foreign Co", status: "active", capabilityTags: ["cold-chain"], tenant: "foreign" },
      ],
      relationships: [
        { vendorId: "v-1", contractRef: "CON-001" },
        { vendorId: "v-3", contractRef: "CON-003" },
        { vendorId: "v-5", contractRef: "CON-005" },
      ],
      scorecards: [
        { vendorId: "v-1", metrics: [
          { metric: "on-time", score: 0.9, observedAt: CLOCK.iso1 },
          { metric: "fill-rate", score: 0.7, observedAt: CLOCK.iso2 },
        ] },
        { vendorId: "v-3", metrics: [{ metric: "hazmat-handling", score: 0.55, observedAt: CLOCK.iso1 }] },
        { vendorId: "v-5", metrics: [{ metric: "delivery", score: 1.5, observedAt: CLOCK.iso1 }] },
      ] },
    { stepId: "s2", kind: "vendor-relationship-transition", factKey: "suspend", vendorId: "v-1", command: "suspend", reason: "sla breach" },
    { stepId: "s3", kind: "vendor-relationship-transition", factKey: "suspendAgain", vendorId: "v-1", command: "suspend", reason: "second breach" },
    { stepId: "s4", kind: "vendor-relationship-transition", factKey: "resume", vendorId: "v-1", command: "resume" },
    { stepId: "s5", kind: "vendor-relationship-transition", factKey: "terminateNoReason", vendorId: "v-1", command: "terminate", reason: "" },
    { stepId: "s6", kind: "vendor-relationship-transition", factKey: "terminate", vendorId: "v-1", command: "terminate", reason: "contract ended", endedAt: CLOCK.iso3 },
    { stepId: "s7", kind: "vendor-relationship-transition", factKey: "terminatedSuspend", vendorId: "v-1", command: "suspend", reason: "late" },
    { stepId: "s8", kind: "vendor-relationship-transition", factKey: "missing", vendorId: "v-2", command: "suspend", reason: "sla breach" },
    { stepId: "s9", kind: "vendor-scorecard-aggregate", factKey: "v1", vendorId: "v-1" },
    { stepId: "s10", kind: "vendor-scorecard-aggregate", factKey: "v3", vendorId: "v-3" },
    { stepId: "s11", kind: "vendor-scorecard-aggregate", factKey: "none", vendorId: "v-4" },
    { stepId: "s12", kind: "vendor-scorecard-aggregate", factKey: "range", vendorId: "v-5" },
    { stepId: "s13", kind: "vendor-capability-feed", factKey: "cold", requestedTags: ["cold-chain", "gps"] },
    { stepId: "s14", kind: "vendor-capability-feed", factKey: "hazmat", requestedTags: ["hazmat"] },
    { stepId: "s15", kind: "vendor-directory-read", factKey: "own", vendorId: "v-1" },
    { stepId: "s16", kind: "vendor-directory-read", factKey: "foreign", vendorId: "v-1", callerTenant: "foreign" },
    { stepId: "s17", kind: "vendor-directory-read", factKey: "unknown", vendorId: "v-77" },
  ],
  assertions: [
    eq("a1", "vd.seed.seed.vendorCount", 6, "six vendors are seeded in the REAL in-memory repository"),
    eq("a2", "vd.seed.seed.relationshipCount", 3, "three service relationships start active"),
    eq("a3", "vd.transition.suspend.ok", true, "suspending an active relationship succeeds"),
    eq("a4", "vd.transition.suspend.status", "suspended", "the relationship is suspended"),
    eq("a5", "vd.transition.suspend.auditKind", "vendor.service-relationship-transitioned", "the transition appends a REAL audit event"),
    eq("a6", "vd.transition.suspend.auditFromStatus", "active", "the audit event carries the from status"),
    eq("a7", "vd.transition.suspend.auditToStatus", "suspended", "the audit event carries the to status"),
    eq("a8", "vd.transition.suspend.auditCount", 1, "exactly one audit event per transition"),
    eq("a9", "vd.transition.suspendAgain.reasonCode", "ILLEGAL_TRANSITION", "suspending a suspended relationship refuses — no double suspension"),
    eq("a10", "vd.transition.resume.ok", true, "resuming a suspended relationship succeeds"),
    eq("a11", "vd.transition.resume.status", "active", "the relationship is active again"),
    eq("a12", "vd.transition.terminateNoReason.reasonCode", "TERMINATE_REASON_REQUIRED", "terminating without a reason refuses"),
    eq("a13", "vd.transition.terminate.ok", true, "terminating with a reason succeeds"),
    eq("a14", "vd.transition.terminate.status", "terminated", "the relationship is terminated"),
    eq("a15", "vd.transition.terminate.endedAt", CLOCK.iso3, "the termination records the endedAt timestamp"),
    eq("a16", "vd.transition.terminatedSuspend.reasonCode", "ILLEGAL_TRANSITION", "a terminated relationship is terminal — no further transitions"),
    eq("a17", "vd.transition.missing.reasonCode", "SERVICE_RELATIONSHIP_NOT_FOUND", "a vendor with no relationship refuses — never invented"),
    eq("a18", "vd.scorecard.v1.ok", true, "the v-1 scorecard aggregates"),
    eq("a19", "vd.scorecard.v1.worstScore", 0.7, "worst-wins: the 0.7 fill-rate dominates the 0.9 on-time"),
    eq("a20", "vd.scorecard.v1.worstMetric", "fill-rate", "the worst metric is named"),
    eq("a21", "vd.scorecard.v1.observationCount", 2, "both observations count"),
    eq("a22", "vd.scorecard.v3.worstScore", 0.55, "the single-metric scorecard aggregates to its own score"),
    eq("a23", "vd.scorecard.none.reasonCode", "EMPTY_SCORECARD", "a vendor with no scorecard refuses aggregation"),
    eq("a24", "vd.scorecard.range.reasonCode", "SCORE_OUT_OF_RANGE", "a metric score outside [0,1] refuses — never clamped"),
    deq("a25", "vd.feed.cold.vendors", ["v-1", "v-4", "v-5"], "the feed lists the ACTIVE tag-matching vendors in lexical order — the suspended v-2 and the foreign-tenant v-9 never enter"),
    deq("a26", "vd.feed.cold.serviceLevels", ["v-1:0.7", "v-4:0.5", "v-5:0.5"], "service levels are worst-score aggregates; a vendor without an aggregatable scorecard honestly defaults to 0.5"),
    deq("a27", "vd.feed.cold.tags", ["v-1:cold-chain+gps", "v-4:cold-chain", "v-5:gps"], "each feed row carries the vendor's capability tags"),
    deq("a28", "vd.feed.hazmat.vendors", ["v-3"], "the hazmat feed matches exactly the hazmat vendor"),
    eq("a29", "vd.feed.hazmat.auditKind", "vendor.capability-feed-produced", "the feed production is audited"),
    eq("a30", "vd.read.own.found", true, "an own-tenant read finds the vendor"),
    eq("a31", "vd.read.own.displayName", "Northwind Logistics", "the read returns the REAL vendor record"),
    eq("a32", "vd.read.foreign.found", false, "reading through the OTHER tenant's scope finds NOTHING — cross-tenant reads fail closed"),
    eq("a33", "vd.read.foreign.displayName", null, "no foreign record leaks through the read"),
    eq("a34", "vd.read.unknown.found", false, "an unknown vendor id reads as null — never invented"),
    deq("a35", "vd.transitionLog", [
      "v-1:suspended", "v-1:refused:ILLEGAL_TRANSITION", "v-1:active",
      "v-1:refused:TERMINATE_REASON_REQUIRED", "v-1:terminated", "v-1:refused:ILLEGAL_TRANSITION",
      "v-2:refused:SERVICE_RELATIONSHIP_NOT_FOUND",
    ], "the full relationship lifecycle with every refusal in order"),
  ],
};

export const MARKETPLACE_JOURNEYS: readonly AcceptanceJourney[] = [
  marketplacePublicationLifecycleJourney,
  vendorDirectoryServiceRelationshipJourney,
];
