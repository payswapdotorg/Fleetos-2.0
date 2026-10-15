/**
 * @fleetos/acceptance-commerce — the F370C persistence journey (Wave 18
 * lane C): the F362 transaction-spine shape through the HTTP boundary +
 * the PostgreSQL store END-TO-END, with the crash-restart asserted as
 * DATA, not prose.
 *
 * The REAL deployment service (a real child process, real PostgreSQL via
 * pglite, ephemeral port — never in output) drives the full spine:
 * request (idempotent submit + natural-key conflict) → offers → the
 * current-offer sheet (freshness) → the comparison over the STORE's
 * authoritative offers → the retained offer-snapshot evidence → the
 * Guardian approval → the order lifecycle with the manual provider-ack
 * seam (idempotent + duplicate-refusing) → *** SIGKILL → restart → the
 * digest envelope byte-identical *** → the receipt state machine → the
 * enrollment (asset admission + the twin link) → a SECOND crash-restart
 * with the receipts replayed + verified byte-exact → the record sets
 * intact.
 *
 * CENSUS CITATION: the journey id `marketplace-persistence-spine` and the
 * mps-* op family are NEW at base b6747b3 (greps in docs/evidence/F370C/
 * report.md §1); the F361A/B/C/F362 kernels are composed through the
 * service's HTTP boundary — never re-driven in-process here.
 *
 * Time law: single-epoch (T0) literal journey data; the run anchor never
 * reaches the service. Ports/timestamps never in output.
 */

import type { AcceptanceJourney } from "../journey-contracts.js";

const T0 = 1_774_000_000_000;
const DAY = 86_400_000;
const ALL_SCOPES = [
  "marketplace.request", "marketplace.offer", "marketplace.comparison", "marketplace.order",
  "marketplace.order.ack", "marketplace.receipt", "marketplace.enrollment", "marketplace.approval",
];

export const F370C_PERSISTENCE_JOURNEYS: readonly AcceptanceJourney[] = [
  {
    id: "marketplace-persistence-spine",
    persona: "procurement-lead",
    capability: "marketplace-persistence",
    goal: "Prove the marketplace transaction spine is PostgreSQL-authoritative end-to-end: the full F362 shape through the HTTP boundary, a real SIGKILL crash mid-journey with the digest envelope byte-identical after restart, and the receipts replayed + verified byte-exact on boot.",
    steps: [
      { stepId: "s1", kind: "mps-boot", factKey: "boot" },
      { stepId: "s2", kind: "mps-provision", factKey: "provision", credentialId: "cred-mps-p-01", actorId: "act_operator-mps-01", tenantId: "acme", secret: "pilot-persistence-secret-01" },
      { stepId: "s3", kind: "mps-login", factKey: "operator", sessionKey: "operator", credentialId: "cred-mps-p-01", secret: "pilot-persistence-secret-01", scopes: ALL_SCOPES, ttlMs: 90 * DAY, jti: "jti-mps-p-001", now: T0 + 100 },
      { stepId: "s4", kind: "mps-request-submit", factKey: "need", sessionKey: "operator", tenantId: "acme", requestId: "req-mps-001", naturalKey: "acme:lt-5540:2026-q4:batch-p1", sku: "LT-5540", quantity: 5, requiredBy: "2026-12-31", at: T0 + 1_000, now: T0 + 1_000 },
      { stepId: "s5", kind: "mps-request-submit", factKey: "replay", sessionKey: "operator", tenantId: "acme", requestId: "req-mps-999", naturalKey: "acme:lt-5540:2026-q4:batch-p1", sku: "LT-5540", quantity: 5, requiredBy: "2026-12-31", at: T0 + 1_500, now: T0 + 1_500 },
      { stepId: "s6", kind: "mps-request-submit", factKey: "conflict", sessionKey: "operator", tenantId: "acme", requestId: "req-mps-002", naturalKey: "acme:lt-5540:2026-q4:batch-p1", sku: "LT-5540", quantity: 6, requiredBy: "2026-12-31", at: T0 + 2_000, now: T0 + 2_000 },
      { stepId: "s7", kind: "mps-request-transition", factKey: "resolve", sessionKey: "operator", tenantId: "acme", requestId: "req-mps-001", command: { type: "resolve", at: T0 + 6_000 }, now: T0 + 6_000 },
      { stepId: "s8", kind: "mps-request-transition", factKey: "closeWindow", sessionKey: "operator", tenantId: "acme", requestId: "req-mps-001", command: { type: "close_offer_window", at: T0 + 6_500 }, now: T0 + 6_500 },
      { stepId: "s9", kind: "mps-request-transition", factKey: "comparing", sessionKey: "operator", tenantId: "acme", requestId: "req-mps-001", command: { type: "compare", at: T0 + 7_000 }, now: T0 + 7_000 },
      { stepId: "s10", kind: "mps-offer-capture", factKey: "offA", sessionKey: "operator", tenantId: "acme", now: T0 + 4_100, offer: { offerId: "off-mps-a", supplierId: "sup-alpha", sku: "LT-5540", quantity: 5, unitCostMinor: 1_400_000, totalCostMinor: 7_000_000, currency: "GHS", taxMinor: 0, feesMinor: 0, deliveryEstimateDays: 4, condition: "new", warrantyMonths: 12, validFrom: T0 + 4_000, validUntil: T0 + 10 * DAY, sourceKind: "operator-entered", sourceReference: "mps-offer-alpha-2026", capturedAt: T0 + 4_100 } },
      { stepId: "s11", kind: "mps-offer-capture", factKey: "offB", sessionKey: "operator", tenantId: "acme", now: T0 + 4_200, offer: { offerId: "off-mps-b", supplierId: "sup-beta", sku: "LT-5540", quantity: 5, unitCostMinor: 1_350_000, totalCostMinor: 6_750_000, currency: "GHS", taxMinor: 0, feesMinor: 0, deliveryEstimateDays: 3, condition: "new", warrantyMonths: 12, validFrom: T0 + 4_000, validUntil: T0 + 10 * DAY, sourceKind: "operator-entered", sourceReference: "mps-offer-beta-2026", capturedAt: T0 + 4_200 } },
      { stepId: "s12", kind: "mps-offer-sheet", factKey: "whileOpen", sessionKey: "operator", tenantId: "acme", at: T0 + 7_500, now: T0 + 7_500 },
      { stepId: "s13", kind: "mps-comparison", factKey: "live", sessionKey: "operator", tenantId: "acme", demandSku: "LT-5540", demandCurrency: "GHS", acceptableConditions: ["new"], suppliers: [{ supplierId: "sup-alpha", evidenceId: "verify-mps-alpha-2026", verifiedAt: T0 + 2_500, expiresAt: T0 + 90 * DAY }, { supplierId: "sup-beta", evidenceId: "verify-mps-beta-2026", verifiedAt: T0 + 2_600, expiresAt: T0 + 90 * DAY }], at: T0 + 7_600, now: T0 + 7_600 },
      { stepId: "s14", kind: "mps-evidence-retain", factKey: "snapshot", sessionKey: "operator", tenantId: "acme", evidenceKind: "offer-snapshot", providerEventId: "exp-mps-snap-001", subjectRef: "off-mps-b", sourceSystem: "manual-catalogue-export", sourceReference: "exp-2026-10-mps-01", retrievedVia: "export", capturedAtIso: "2026-10-14T00:00:00.000Z", recordedAtIso: "2026-10-15T00:00:00.000Z", artifactId: "art-mps-snap-01", artifactDescription: "the retained offer snapshot (off-mps-b)", artifactJson: "{\"offerId\":\"off-mps-b\",\"unitCostMinor\":1350000,\"totalCostMinor\":6750000,\"currency\":\"GHS\",\"validUntil\":1782595200000}", now: T0 + 8_000 },
      { stepId: "s15", kind: "mps-approval", factKey: "inLimits", sessionKey: "operator", tenantId: "acme", requestId: "appr-mps-001", orderId: "ord-mps-001", category: "laptops", transactionKind: "purchase", units: 5, amountTotal: 6_750_000, currency: "GHS", supplierId: "sup-beta", verificationRef: "verify-mps-beta-2026", offerSnapshotFromEvidence: true, actorAuthority: ["human.approval"], actorAutonomous: false, at: T0 + 9_000, now: T0 + 9_000 },
      { stepId: "s16", kind: "mps-request-transition", factKey: "select", sessionKey: "operator", tenantId: "acme", requestId: "req-mps-001", command: { type: "select", at: T0 + 9_500, offerId: "off-mps-b" }, now: T0 + 9_500 },
      { stepId: "s17", kind: "mps-request-transition", factKey: "requestApproval", sessionKey: "operator", tenantId: "acme", requestId: "req-mps-001", command: { type: "request_approval", at: T0 + 9_600 }, now: T0 + 9_600 },
      { stepId: "s18", kind: "mps-request-transition", factKey: "earlyOrder", sessionKey: "operator", tenantId: "acme", requestId: "req-mps-001", command: { type: "order", at: T0 + 9_700 }, now: T0 + 9_700 },
      { stepId: "s19", kind: "mps-request-transition", factKey: "approve", sessionKey: "operator", tenantId: "acme", requestId: "req-mps-001", command: { type: "approve", at: T0 + 10_000 }, now: T0 + 10_000 },
      { stepId: "s20", kind: "mps-request-transition", factKey: "order", sessionKey: "operator", tenantId: "acme", requestId: "req-mps-001", command: { type: "order", at: T0 + 11_000 }, now: T0 + 11_000 },
      { stepId: "s21", kind: "mps-order-draft", factKey: "draft", sessionKey: "operator", tenantId: "acme", orderId: "ord-mps-001", requestId: "req-mps-001", offerId: "off-mps-b", supplierId: "sup-beta", sku: "LT-5540", quantity: 5, unitCostMinor: 1_350_000, totalCostMinor: 6_750_000, currency: "GHS", now: T0 + 12_000 },
      { stepId: "s22", kind: "mps-order-place", factKey: "place", sessionKey: "operator", tenantId: "acme", orderId: "ord-mps-001", at: T0 + 13_000, now: T0 + 13_000 },
      { stepId: "s23", kind: "mps-evidence-retain", factKey: "providerAck", sessionKey: "operator", tenantId: "acme", evidenceKind: "provider-ack", providerEventId: "inv-mps-001", subjectRef: "ord-mps-001", sourceSystem: "provider-portal-export", sourceReference: "inv-mps-001", retrievedVia: "export", capturedAtIso: "2026-10-14T00:00:01.000Z", recordedAtIso: "2026-10-15T00:00:01.000Z", artifactId: "art-mps-ack-01", artifactDescription: "the provider acknowledgement invoice export", artifactJson: "{\"orderId\":\"ord-mps-001\",\"providerEventId\":\"inv-mps-001\",\"acknowledged\":true}", now: T0 + 14_000 },
      { stepId: "s24", kind: "mps-order-ack", factKey: "ack", sessionKey: "operator", tenantId: "acme", orderId: "ord-mps-001", providerEventId: "prov-ack-mps-001", evidenceFromEvidence: true, channel: "manual-invoice-reference", acknowledgedAt: T0 + 15_000, now: T0 + 15_000 },
      { stepId: "s25", kind: "mps-order-ack", factKey: "replay", sessionKey: "operator", tenantId: "acme", orderId: "ord-mps-001", providerEventId: "prov-ack-mps-001", evidenceFromEvidence: false, channel: "manual-portal-export", acknowledgedAt: T0 + 16_000, now: T0 + 16_000 },
      { stepId: "s26", kind: "mps-order-ack", factKey: "differentEvent", sessionKey: "operator", tenantId: "acme", orderId: "ord-mps-001", providerEventId: "prov-ack-mps-002", evidenceFromEvidence: false, channel: "manual-email-confirmation", acknowledgedAt: T0 + 17_000, now: T0 + 17_000 },
      { stepId: "s27", kind: "mps-digest", factKey: "beforeCrash" },
      { stepId: "s28", kind: "mps-restart", factKey: "crash", mode: "kill", at: T0 + 18_000 },
      { stepId: "s29", kind: "mps-receipt-record", factKey: "main", sessionKey: "operator", tenantId: "acme", evidenceRef: "rcpt-mps-001", siteId: "site-accra-east", supplierOrderRef: "ord-mps-001", serial: "SN-MPS-0001", assetTag: "TAG-MPS-0001", conditionOnArrival: "new", warrantyRef: "wrty-mps-0001", capturedAt: T0 + 19_000, recordedAt: T0 + 20_000, now: T0 + 20_000 },
      { stepId: "s30", kind: "mps-receipt-record", factKey: "replay", sessionKey: "operator", tenantId: "acme", evidenceRef: "rcpt-mps-001", siteId: "site-accra-east", supplierOrderRef: "ord-mps-001", serial: "SN-MPS-0001", assetTag: "TAG-MPS-0001", conditionOnArrival: "new", warrantyRef: "wrty-mps-0001", capturedAt: T0 + 19_000, recordedAt: T0 + 20_000, now: T0 + 20_500 },
      { stepId: "s31", kind: "mps-receipt-verify", factKey: "main", sessionKey: "operator", tenantId: "acme", evidenceRef: "rcpt-mps-001", expectSupplierOrderRef: "ord-mps-001", expectSerial: "SN-MPS-0001", expectAssetTag: "TAG-MPS-0001", expectCondition: "new", decidedAt: T0 + 21_000, now: T0 + 21_000 },
      { stepId: "s32", kind: "mps-enrollment-open", factKey: "open", sessionKey: "operator", tenantId: "acme", evidenceRef: "rcpt-mps-001", assetId: "ast_mps_0001", displayName: "LT-5540 laptop (ord-mps-001)", assetKind: "other", deviceId: "dev-mps-0001", at: T0 + 22_000, now: T0 + 22_000 },
      { stepId: "s33", kind: "mps-enrollment-open", factKey: "duplicate", sessionKey: "operator", tenantId: "acme", evidenceRef: "rcpt-mps-001", assetId: "ast_mps_DUPLICATE", displayName: "LT-5540 laptop (duplicate attempt)", assetKind: "other", at: T0 + 23_000, now: T0 + 23_000 },
      { stepId: "s34", kind: "mps-enrollment-complete", factKey: "complete", sessionKey: "operator", tenantId: "acme", serial: "SN-MPS-0001", at: T0 + 24_000, now: T0 + 24_000 },
      { stepId: "s35", kind: "mps-restart", factKey: "crashTwo", mode: "kill", at: T0 + 25_000 },
      { stepId: "s36", kind: "mps-state", factKey: "enrollments", sessionKey: "operator", tenantId: "acme", family: "enrollments", now: T0 + 26_000 },
      { stepId: "s37", kind: "mps-state", factKey: "requests", sessionKey: "operator", tenantId: "acme", family: "requests", now: T0 + 26_100 },
      { stepId: "s38", kind: "mps-state", factKey: "receipts", sessionKey: "operator", tenantId: "acme", family: "receipts", now: T0 + 26_200 },
      { stepId: "s39", kind: "mps-digest", factKey: "final" },
      { stepId: "s40", kind: "mps-shutdown", factKey: "shutdown" },
    ],
    assertions: [
      { id: "mps-p1", description: "the service booted with the env keyring (the F370B env provider)", fact: "mps.boot.boot.ok", op: "eq", expected: true },
      { id: "mps-p2", description: "the credential provisioned (the F370B host-boundary salt binding)", fact: "mps.provision.provision.ok", op: "eq", expected: true },
      { id: "mps-p3", description: "the login issued under the current keyring key", fact: "mps.login.operator.ok", op: "eq", expected: true },
      { id: "mps-p4", description: "the request submitted (draft -> submitted)", fact: "mps.request.need.ok", op: "eq", expected: true },
      { id: "mps-p5", description: "the natural-key replay returned the ORIGINAL request (duplicate=true, never a second create)", fact: "mps.request.replay.duplicate", op: "eq", expected: true },
      { id: "mps-p6", description: "the replay carried the original request id", fact: "mps.request.replay.requestId", op: "eq", expected: "req-mps-001" },
      { id: "mps-p7", description: "the divergent natural-key content refused NATURAL_KEY_CONFLICT (a domain refusal as data)", fact: "mps.request.conflict.reason", op: "eq", expected: "NATURAL_KEY_CONFLICT" },
      { id: "mps-p8", description: "the request machine walked to comparing through the boundary", fact: "mps.requestT.comparing.status", op: "eq", expected: "comparing" },
      { id: "mps-p9", description: "the current-offer sheet carried both fresh offers (the freshness law at the boundary)", fact: "mps.sheet.whileOpen.freshCount", op: "eq", expected: 2 },
      { id: "mps-p10", description: "the comparison ranked the store's authoritative offers with the cheaper offer on top", fact: "mps.compare.live.topOfferId", op: "eq", expected: "off-mps-b" },
      { id: "mps-p11", description: "the comparison found both suppliers eligible", fact: "mps.compare.live.eligibleCount", op: "eq", expected: 2 },
      { id: "mps-p12", description: "the offer-snapshot evidence retained (content-addressed id)", fact: "mps.evidence.snapshot.ok", op: "eq", expected: true },
      { id: "mps-p13", description: "the in-limits Guardian approval decided approve (advisory-never-authorizes baseline)", fact: "mps.approval.inLimits.decision", op: "eq", expected: "approve" },
      { id: "mps-p14", description: "the early order attempt refused ILLEGAL_TRANSITION (the state machine at the boundary)", fact: "mps.requestT.earlyOrder.reason", op: "eq", expected: "ILLEGAL_TRANSITION" },
      { id: "mps-p15", description: "the request machine reached ordered", fact: "mps.requestT.order.status", op: "eq", expected: "ordered" },
      { id: "mps-p16", description: "the order placed", fact: "mps.orderPlace.place.status", op: "eq", expected: "placed" },
      { id: "mps-p17", description: "the manual provider-ack seam acknowledged the order", fact: "mps.ack.ack.status", op: "eq", expected: "acknowledged" },
      { id: "mps-p18", description: "the ack replay was idempotent (duplicate=true, the original evidence wins)", fact: "mps.ack.replay.duplicate", op: "eq", expected: true },
      { id: "mps-p19", description: "a DIFFERENT provider event for the acknowledged order refused ALREADY_ACKNOWLEDGED", fact: "mps.ack.differentEvent.reason", op: "eq", expected: "ALREADY_ACKNOWLEDGED" },
      { id: "mps-p20", description: "THE CRASH-RESTART: the SIGKILL left the digest envelope byte-identical", fact: "mps.restart.crash.digestsIdentical", op: "eq", expected: true },
      { id: "mps-p21", description: "the boot verify-on-start reported ok", fact: "mps.restart.crash.verifyOk", op: "eq", expected: true },
      { id: "mps-p22", description: "the post-crash receipt recorded", fact: "mps.receipt.main.ok", op: "eq", expected: true },
      { id: "mps-p23", description: "the identical receipt replay was idempotent", fact: "mps.receipt.replay.duplicate", op: "eq", expected: true },
      { id: "mps-p24", description: "the receipt verified", fact: "mps.verify.main.state", op: "eq", expected: "verified" },
      { id: "mps-p25", description: "the enrollment opened (candidate)", fact: "mps.enrollOpen.open.state", op: "eq", expected: "candidate" },
      { id: "mps-p26", description: "the duplicate enrollment returned the ORIGINAL record", fact: "mps.enrollOpen.duplicate.duplicate", op: "eq", expected: true },
      { id: "mps-p27", description: "the enrollment completed with the twin linked", fact: "mps.enrollComplete.complete.twinLinked", op: "eq", expected: true },
      { id: "mps-p28", description: "THE SECOND CRASH: digests still byte-identical (now WITH a decided receipt on board)", fact: "mps.restart.crashTwo.digestsIdentical", op: "eq", expected: true },
      { id: "mps-p29", description: "the second boot replayed exactly one receipt", fact: "mps.restart.crashTwo.receiptsReplayed", op: "eq", expected: 1 },
      { id: "mps-p30", description: "the enrollment survived both crashes (enrolled)", fact: "mps.state.enrollments.statuses", op: "deepEq", expected: ["SN-MPS-0001:enrolled"] },
      { id: "mps-p31", description: "the request record survived both crashes (ordered)", fact: "mps.state.requests.statuses", op: "deepEq", expected: ["req-mps-001:ordered"] },
      { id: "mps-p32", description: "the decided receipt survived the crash (verified, replayed byte-exact)", fact: "mps.state.receipts.statuses", op: "deepEq", expected: ["rcpt-mps-001:verified"] },
      { id: "mps-p33", description: "the final digest counts exactly one enrollment record", fact: "mps.digest.final.countEnrollments", op: "eq", expected: 1 },
      { id: "mps-p34", description: "the audit journal recorded the spine (>= 20 attempts)", fact: "mps.digest.final.countAudit", op: "gte", expected: 20 },
      { id: "mps-p36", description: "the final digest counts exactly one request record", fact: "mps.digest.final.countRequests", op: "eq", expected: 1 },
      { id: "mps-p37", description: "the final digest counts exactly one order record", fact: "mps.digest.final.countOrders", op: "eq", expected: 1 },
      { id: "mps-p35", description: "the evidence set holds the snapshot + the provider-ack records", fact: "mps.digest.final.countEvidence", op: "eq", expected: 2 },
    ],
  },
];
