/**
 * @fleetos/acceptance-commerce — the F372 networked-persistence journey
 * (Wave 19 lane A): the F362 transaction-spine shape END-TO-END over TCP
 * through the store port, with the networked PostgreSQL as the backing —
 * REAL PostgreSQL as a SEPARATE SERVER PROCESS, driven by the `pg`
 * (node-postgres) adapter at the MarketplaceStore port.
 *
 * The REAL deployment service boots in NETWORKED mode (FLEETOS_MARKETPLACE_
 * STORE=networked) against the REAL postgres server process provisioned by
 * the harness (initdb a temp PGDATA, an ephemeral port — never in output):
 * request (idempotent submit + natural-key conflict) → offers → the
 * current-offer sheet (freshness) → the comparison over the STORE's
 * authoritative offers → the retained offer-snapshot evidence → the
 * Guardian approval (the two-layer law) → the order lifecycle with the
 * manual provider-ack seam (idempotent + duplicate-refusing) → *** SIGKILL
 * the POSTGRES SERVER PROCESS mid-journey → the service SURVIVES (the
 * boundary reports the persistence plane's death as HTTP 500) → the server
 * restarts over the SAME PGDATA → REAL WAL recovery → the digest envelope
 * BYTE-IDENTICAL *** → the receipt state machine → the enrollment (asset
 * admission + the twin link) → the record sets intact.
 *
 * CENSUS CITATION: the journey id `marketplace-networked-persistence` and
 * the npg-* op family are NEW at base 76ddba0 (greps in docs/evidence/F372/
 * report.md §1); the spine verbs reuse the EXISTING mps-* family (the same
 * F362 HTTP-boundary shape — only the backing store differs).
 *
 * Time law: single-epoch (T0) literal journey data; the run anchor never
 * reaches the service. Ports/timestamps/paths never in output.
 */

import type { AcceptanceJourney } from "../journey-contracts.js";

const T0 = 1_774_000_000_000;
const DAY = 86_400_000;
const ALL_SCOPES = [
  "marketplace.request", "marketplace.offer", "marketplace.comparison", "marketplace.order",
  "marketplace.order.ack", "marketplace.receipt", "marketplace.enrollment", "marketplace.approval",
];

export const F372_NETWORKED_PERSISTENCE_JOURNEYS: readonly AcceptanceJourney[] = [
  {
    id: "marketplace-networked-persistence",
    persona: "procurement-lead",
    capability: "marketplace-networked-persistence",
    goal: "Prove the marketplace transaction spine is PostgreSQL-authoritative end-to-end over the REAL network boundary: the full F362 shape through the HTTP boundary into a REAL separate postgres SERVER process (the pg adapter at the MarketplaceStore port), a real SIGKILL of the SERVER PROCESS mid-journey with the digest envelope byte-identical after WAL recovery, and the recovered server serving the post-crash writes.",
    steps: [
      { stepId: "s1", kind: "npg-server-boot", factKey: "server" },
      { stepId: "s2", kind: "mps-boot", factKey: "boot", store: "networked" },
      { stepId: "s3", kind: "mps-provision", factKey: "provision", credentialId: "cred-npg-p-01", actorId: "act_operator-npg-01", tenantId: "acme", secret: "pilot-networked-secret-01" },
      { stepId: "s4", kind: "mps-login", factKey: "operator", sessionKey: "operator", credentialId: "cred-npg-p-01", secret: "pilot-networked-secret-01", scopes: ALL_SCOPES, ttlMs: 90 * DAY, jti: "jti-npg-p-001", now: T0 + 100 },
      { stepId: "s5", kind: "mps-request-submit", factKey: "need", sessionKey: "operator", tenantId: "acme", requestId: "req-npg-001", naturalKey: "acme:lt-5540:2026-q4:batch-np1", sku: "LT-5540", quantity: 5, requiredBy: "2026-12-31", at: T0 + 1_000, now: T0 + 1_000 },
      { stepId: "s6", kind: "mps-request-submit", factKey: "replay", sessionKey: "operator", tenantId: "acme", requestId: "req-npg-999", naturalKey: "acme:lt-5540:2026-q4:batch-np1", sku: "LT-5540", quantity: 5, requiredBy: "2026-12-31", at: T0 + 1_500, now: T0 + 1_500 },
      { stepId: "s7", kind: "mps-request-submit", factKey: "conflict", sessionKey: "operator", tenantId: "acme", requestId: "req-npg-002", naturalKey: "acme:lt-5540:2026-q4:batch-np1", sku: "LT-5540", quantity: 6, requiredBy: "2026-12-31", at: T0 + 2_000, now: T0 + 2_000 },
      { stepId: "s8", kind: "mps-request-transition", factKey: "resolve", sessionKey: "operator", tenantId: "acme", requestId: "req-npg-001", command: { type: "resolve", at: T0 + 6_000 }, now: T0 + 6_000 },
      { stepId: "s9", kind: "mps-request-transition", factKey: "closeWindow", sessionKey: "operator", tenantId: "acme", requestId: "req-npg-001", command: { type: "close_offer_window", at: T0 + 6_500 }, now: T0 + 6_500 },
      { stepId: "s10", kind: "mps-request-transition", factKey: "comparing", sessionKey: "operator", tenantId: "acme", requestId: "req-npg-001", command: { type: "compare", at: T0 + 7_000 }, now: T0 + 7_000 },
      { stepId: "s11", kind: "mps-offer-capture", factKey: "offA", sessionKey: "operator", tenantId: "acme", now: T0 + 4_100, offer: { offerId: "off-npg-a", supplierId: "sup-alpha", sku: "LT-5540", quantity: 5, unitCostMinor: 1_400_000, totalCostMinor: 7_000_000, currency: "GHS", taxMinor: 0, feesMinor: 0, deliveryEstimateDays: 4, condition: "new", warrantyMonths: 12, validFrom: T0 + 4_000, validUntil: T0 + 10 * DAY, sourceKind: "operator-entered", sourceReference: "npg-offer-alpha-2026", capturedAt: T0 + 4_100 } },
      { stepId: "s12", kind: "mps-offer-capture", factKey: "offB", sessionKey: "operator", tenantId: "acme", now: T0 + 4_200, offer: { offerId: "off-npg-b", supplierId: "sup-beta", sku: "LT-5540", quantity: 5, unitCostMinor: 1_350_000, totalCostMinor: 6_750_000, currency: "GHS", taxMinor: 0, feesMinor: 0, deliveryEstimateDays: 3, condition: "new", warrantyMonths: 12, validFrom: T0 + 4_000, validUntil: T0 + 10 * DAY, sourceKind: "operator-entered", sourceReference: "npg-offer-beta-2026", capturedAt: T0 + 4_200 } },
      { stepId: "s13", kind: "mps-offer-sheet", factKey: "whileOpen", sessionKey: "operator", tenantId: "acme", at: T0 + 7_500, now: T0 + 7_500 },
      { stepId: "s14", kind: "mps-comparison", factKey: "live", sessionKey: "operator", tenantId: "acme", demandSku: "LT-5540", demandCurrency: "GHS", acceptableConditions: ["new"], suppliers: [{ supplierId: "sup-alpha", evidenceId: "verify-npg-alpha-2026", verifiedAt: T0 + 2_500, expiresAt: T0 + 90 * DAY }, { supplierId: "sup-beta", evidenceId: "verify-npg-beta-2026", verifiedAt: T0 + 2_600, expiresAt: T0 + 90 * DAY }], at: T0 + 7_600, now: T0 + 7_600 },
      { stepId: "s15", kind: "mps-evidence-retain", factKey: "snapshot", sessionKey: "operator", tenantId: "acme", evidenceKind: "offer-snapshot", providerEventId: "exp-npg-snap-001", subjectRef: "off-npg-b", sourceSystem: "manual-catalogue-export", sourceReference: "exp-2026-10-npg-01", retrievedVia: "export", capturedAtIso: "2026-10-14T00:00:00.000Z", recordedAtIso: "2026-10-15T00:00:00.000Z", artifactId: "art-npg-snap-01", artifactDescription: "the retained offer snapshot (off-npg-b)", artifactJson: "{\"offerId\":\"off-npg-b\",\"unitCostMinor\":1350000,\"totalCostMinor\":6750000,\"currency\":\"GHS\",\"validUntil\":1782595200000}", now: T0 + 8_000 },
      { stepId: "s16", kind: "mps-approval", factKey: "inLimits", sessionKey: "operator", tenantId: "acme", requestId: "appr-npg-001", orderId: "ord-npg-001", category: "laptops", transactionKind: "purchase", units: 5, amountTotal: 6_750_000, currency: "GHS", supplierId: "sup-beta", verificationRef: "verify-npg-beta-2026", offerSnapshotFromEvidence: true, actorAuthority: ["human.approval"], actorAutonomous: false, at: T0 + 9_000, now: T0 + 9_000 },
      { stepId: "s17", kind: "mps-approval", factKey: "overLimit", sessionKey: "operator", tenantId: "acme", requestId: "appr-npg-002", orderId: "ord-npg-002", category: "laptops", transactionKind: "purchase", units: 5, amountTotal: 9_000_000, currency: "GHS", supplierId: "sup-beta", verificationRef: "verify-npg-beta-2026", offerSnapshotFromEvidence: false, actorAuthority: ["human.approval"], actorAutonomous: false, at: T0 + 9_100, now: T0 + 9_100 },
      { stepId: "s18", kind: "mps-request-transition", factKey: "select", sessionKey: "operator", tenantId: "acme", requestId: "req-npg-001", command: { type: "select", at: T0 + 9_500, offerId: "off-npg-b" }, now: T0 + 9_500 },
      { stepId: "s19", kind: "mps-request-transition", factKey: "requestApproval", sessionKey: "operator", tenantId: "acme", requestId: "req-npg-001", command: { type: "request_approval", at: T0 + 9_600 }, now: T0 + 9_600 },
      { stepId: "s20", kind: "mps-request-transition", factKey: "earlyOrder", sessionKey: "operator", tenantId: "acme", requestId: "req-npg-001", command: { type: "order", at: T0 + 9_700 }, now: T0 + 9_700 },
      { stepId: "s21", kind: "mps-request-transition", factKey: "approve", sessionKey: "operator", tenantId: "acme", requestId: "req-npg-001", command: { type: "approve", at: T0 + 10_000 }, now: T0 + 10_000 },
      { stepId: "s22", kind: "mps-request-transition", factKey: "order", sessionKey: "operator", tenantId: "acme", requestId: "req-npg-001", command: { type: "order", at: T0 + 11_000 }, now: T0 + 11_000 },
      { stepId: "s23", kind: "mps-order-draft", factKey: "draft", sessionKey: "operator", tenantId: "acme", orderId: "ord-npg-001", requestId: "req-npg-001", offerId: "off-npg-b", supplierId: "sup-beta", sku: "LT-5540", quantity: 5, unitCostMinor: 1_350_000, totalCostMinor: 6_750_000, currency: "GHS", now: T0 + 12_000 },
      { stepId: "s24", kind: "mps-order-place", factKey: "place", sessionKey: "operator", tenantId: "acme", orderId: "ord-npg-001", at: T0 + 13_000, now: T0 + 13_000 },
      { stepId: "s25", kind: "mps-evidence-retain", factKey: "providerAck", sessionKey: "operator", tenantId: "acme", evidenceKind: "provider-ack", providerEventId: "inv-npg-001", subjectRef: "ord-npg-001", sourceSystem: "provider-portal-export", sourceReference: "inv-npg-001", retrievedVia: "export", capturedAtIso: "2026-10-14T00:00:01.000Z", recordedAtIso: "2026-10-15T00:00:01.000Z", artifactId: "art-npg-ack-01", artifactDescription: "the provider acknowledgement invoice export", artifactJson: "{\"orderId\":\"ord-npg-001\",\"providerEventId\":\"inv-npg-001\",\"acknowledged\":true}", now: T0 + 14_000 },
      { stepId: "s26", kind: "mps-order-ack", factKey: "ack", sessionKey: "operator", tenantId: "acme", orderId: "ord-npg-001", providerEventId: "prov-ack-npg-001", evidenceFromEvidence: true, channel: "manual-invoice-reference", acknowledgedAt: T0 + 15_000, now: T0 + 15_000 },
      { stepId: "s27", kind: "mps-order-ack", factKey: "replay", sessionKey: "operator", tenantId: "acme", orderId: "ord-npg-001", providerEventId: "prov-ack-npg-001", evidenceFromEvidence: false, channel: "manual-portal-export", acknowledgedAt: T0 + 16_000, now: T0 + 16_000 },
      { stepId: "s28", kind: "mps-order-ack", factKey: "differentEvent", sessionKey: "operator", tenantId: "acme", orderId: "ord-npg-001", providerEventId: "prov-ack-npg-002", evidenceFromEvidence: false, channel: "manual-email-confirmation", acknowledgedAt: T0 + 17_000, now: T0 + 17_000 },
      { stepId: "s29", kind: "mps-digest", factKey: "beforeCrash" },
      { stepId: "s30", kind: "npg-server-kill", factKey: "crash" },
      { stepId: "s31", kind: "npg-server-restart", factKey: "recovery" },
      { stepId: "s32", kind: "mps-receipt-record", factKey: "main", sessionKey: "operator", tenantId: "acme", evidenceRef: "rcpt-npg-001", siteId: "site-accra-east", supplierOrderRef: "ord-npg-001", serial: "SN-NPG-0001", assetTag: "TAG-NPG-0001", conditionOnArrival: "new", warrantyRef: "wrty-npg-0001", capturedAt: T0 + 19_000, recordedAt: T0 + 20_000, now: T0 + 20_000 },
      { stepId: "s33", kind: "mps-receipt-verify", factKey: "main", sessionKey: "operator", tenantId: "acme", evidenceRef: "rcpt-npg-001", expectSupplierOrderRef: "ord-npg-001", expectSerial: "SN-NPG-0001", expectAssetTag: "TAG-NPG-0001", expectCondition: "new", decidedAt: T0 + 21_000, now: T0 + 21_000 },
      { stepId: "s34", kind: "mps-enrollment-open", factKey: "open", sessionKey: "operator", tenantId: "acme", evidenceRef: "rcpt-npg-001", assetId: "ast_npg_0001", displayName: "LT-5540 laptop (ord-npg-001)", assetKind: "other", deviceId: "dev-npg-0001", at: T0 + 22_000, now: T0 + 22_000 },
      { stepId: "s35", kind: "mps-enrollment-complete", factKey: "complete", sessionKey: "operator", tenantId: "acme", serial: "SN-NPG-0001", at: T0 + 24_000, now: T0 + 24_000 },
      { stepId: "s36", kind: "mps-state", factKey: "enrollments", sessionKey: "operator", tenantId: "acme", family: "enrollments", now: T0 + 26_000 },
      { stepId: "s37", kind: "mps-state", factKey: "requests", sessionKey: "operator", tenantId: "acme", family: "requests", now: T0 + 26_100 },
      { stepId: "s38", kind: "mps-state", factKey: "receipts", sessionKey: "operator", tenantId: "acme", family: "receipts", now: T0 + 26_200 },
      { stepId: "s39", kind: "mps-digest", factKey: "final" },
      { stepId: "s40", kind: "mps-shutdown", factKey: "shutdown" },
    ],
    assertions: [
      { id: "npg-p1", description: "the postgres server process provisioned (initdb + ephemeral port, ready)", fact: "npg.serverBoot.server.ok", op: "eq", expected: true },
      { id: "npg-p2", description: "the service booted in NETWORKED mode (the pg adapter at the store port)", fact: "mps.boot.boot.store", op: "eq", expected: "networked" },
      { id: "npg-p3", description: "the credential provisioned + the login issued over the network boundary", fact: "mps.login.operator.ok", op: "eq", expected: true },
      { id: "npg-p4", description: "the request submitted over TCP (draft -> submitted)", fact: "mps.request.need.ok", op: "eq", expected: true },
      { id: "npg-p5", description: "the natural-key replay returned the ORIGINAL request (duplicate=true, never a second create)", fact: "mps.request.replay.duplicate", op: "eq", expected: true },
      { id: "npg-p6", description: "REFUSAL: the divergent natural-key content refused NATURAL_KEY_CONFLICT (a domain refusal as data over TCP)", fact: "mps.request.conflict.reason", op: "eq", expected: "NATURAL_KEY_CONFLICT" },
      { id: "npg-p7", description: "the request machine walked to comparing through the boundary", fact: "mps.requestT.comparing.status", op: "eq", expected: "comparing" },
      { id: "npg-p8", description: "the current-offer sheet carried both fresh offers (the freshness law over TCP)", fact: "mps.sheet.whileOpen.freshCount", op: "eq", expected: 2 },
      { id: "npg-p9", description: "the comparison ranked the networked store's authoritative offers (cheaper on top)", fact: "mps.compare.live.topOfferId", op: "eq", expected: "off-npg-b" },
      { id: "npg-p10", description: "the in-limits Guardian approval decided approve; the over-limit REFUSED (the two-layer law)", fact: "mps.approval.overLimit.decision", op: "eq", expected: "refuse" },
      { id: "npg-p11", description: "REFUSAL: the early order attempt refused ILLEGAL_TRANSITION (the state machine over TCP)", fact: "mps.requestT.earlyOrder.reason", op: "eq", expected: "ILLEGAL_TRANSITION" },
      { id: "npg-p12", description: "the order placed and the provider-ack seam acknowledged it", fact: "mps.ack.ack.status", op: "eq", expected: "acknowledged" },
      { id: "npg-p13", description: "the ack replay was idempotent (duplicate=true)", fact: "mps.ack.replay.duplicate", op: "eq", expected: true },
      { id: "npg-p14", description: "REFUSAL: a DIFFERENT provider event refused ALREADY_ACKNOWLEDGED", fact: "mps.ack.differentEvent.reason", op: "eq", expected: "ALREADY_ACKNOWLEDGED" },
      { id: "npg-p15", description: "THE SERVER CRASH: the postgres SERVER PROCESS was SIGKILLed (the F370C client-crash proof extended to the server)", fact: "npg.serverKill.crash.ok", op: "eq", expected: true },
      { id: "npg-p16", description: "the SERVICE survived the server's death (the boundary answered — the client process never died)", fact: "npg.serverKill.crash.serviceAlive", op: "eq", expected: true },
      { id: "npg-p17", description: "the persistence plane's death surfaced at the boundary (HTTP 500, never a silent hang)", fact: "npg.serverKill.crash.storeUnreachable", op: "eq", expected: true },
      { id: "npg-p18", description: "THE WAL RECOVERY: the restarted server recovered and the service reconnected transparently", fact: "npg.serverRestart.recovery.recovered", op: "eq", expected: true },
      { id: "npg-p19", description: "THE WAL RECOVERY: the digest envelope BYTE-IDENTICAL after the server-process crash-restart", fact: "npg.serverRestart.recovery.digestsIdentical", op: "eq", expected: true },
      { id: "npg-p20", description: "the RECOVERED server serves writes: the post-crash receipt recorded", fact: "mps.receipt.main.ok", op: "eq", expected: true },
      { id: "npg-p21", description: "the recovered server serves decisions: the receipt verified", fact: "mps.verify.main.state", op: "eq", expected: "verified" },
      { id: "npg-p22", description: "the enrollment completed with the twin linked over the recovered network boundary", fact: "mps.enrollComplete.complete.twinLinked", op: "eq", expected: true },
      { id: "npg-p23", description: "the enrollment survived the server crash (enrolled)", fact: "mps.state.enrollments.statuses", op: "deepEq", expected: ["SN-NPG-0001:enrolled"] },
      { id: "npg-p24", description: "the request record survived the server crash (ordered)", fact: "mps.state.requests.statuses", op: "deepEq", expected: ["req-npg-001:ordered"] },
      { id: "npg-p25", description: "the decided receipt survived the server crash (verified)", fact: "mps.state.receipts.statuses", op: "deepEq", expected: ["rcpt-npg-001:verified"] },
      { id: "npg-p26", description: "the final digest counts the spine records (one request, one order)", fact: "mps.digest.final.countRequests", op: "eq", expected: 1 },
      { id: "npg-p27", description: "the final digest counts the enrollment + the decided receipt", fact: "mps.digest.final.countEnrollments", op: "eq", expected: 1 },
      { id: "npg-p28", description: "the audit journal recorded the spine over TCP (>= 20 attempts)", fact: "mps.digest.final.countAudit", op: "gte", expected: 20 },
      { id: "npg-p29", description: "the evidence set holds the snapshot + the provider-ack records", fact: "mps.digest.final.countEvidence", op: "eq", expected: 2 },
    ],
  },
];
