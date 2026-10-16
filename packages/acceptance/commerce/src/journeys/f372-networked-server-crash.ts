/**
 * @fleetos/acceptance-commerce — the F372 server-crash-restart journey
 * (Wave 19 lane A): the F370C client-crash proof EXTENDED TO THE POSTGRES
 * SERVER PROCESS, as DATA, not prose.
 *
 * The REAL deployment service boots in NETWORKED mode against the REAL
 * postgres server process. The journey drives the spine to the
 * acknowledged order, then:
 *   - SERVER CRASH #1: SIGKILL the postgres server process mid-journey ->
 *     the service survives (the frozen STORE_UNREACHABLE refusal at the
 *     boundary — the crash-window verdict as data, never the raw pool
 *     error) -> the server restarts over the SAME PGDATA (REAL WAL
 *     recovery) -> the digest envelope BYTE-IDENTICAL (read after a
 *     VERIFIED reconnect) -> writes continue (the receipt + the decided
 *     verification + the enrollment);
 *   - SERVER CRASH #2: SIGKILL again — now with a DECIDED receipt and an
 *     ENROLLED asset on board (the harder WAL state) -> restart -> the
 *     digest envelope STILL byte-identical;
 *   - SERVICE COLD RESTART over the network boundary: SIGKILL the SERVICE
 *     (the F370C client-crash shape, now networked) -> the reboot
 *     verify-on-start replays the decided receipt BYTE-EXACT and the
 *     revocation journal — the recovery law holds across BOTH process
 *     boundaries.
 *
 * CENSUS CITATION: the journey id `marketplace-networked-server-crash` is
 * NEW at base 76ddba0 (greps in docs/evidence/F372/report.md §1); the
 * spine verbs reuse the EXISTING mps-* family; the crash ops are the NEW
 * npg-* family.
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

export const F372_NETWORKED_SERVER_CRASH_JOURNEYS: readonly AcceptanceJourney[] = [
  {
    id: "marketplace-networked-server-crash",
    persona: "operations-manager",
    capability: "marketplace-networked-server-crash",
    goal: "Prove the F370C crash-restart durability machine-asserted at the SERVER process: two real SIGKILLs of the postgres SERVER PROCESS mid-journey (before and after the decided receipt), each followed by a restart over the same PGDATA with the digest envelope byte-identical (REAL WAL recovery), then a SERVICE cold restart over the network boundary with verify-on-start replaying the decided receipt byte-exact — the recovery law across both process boundaries.",
    steps: [
      { stepId: "s1", kind: "npg-server-boot", factKey: "server" },
      { stepId: "s2", kind: "mps-boot", factKey: "boot", store: "networked" },
      { stepId: "s3", kind: "mps-provision", factKey: "provision", credentialId: "cred-npg-c-01", actorId: "act_operator-npg-c01", tenantId: "acme", secret: "pilot-crash-secret-01" },
      { stepId: "s4", kind: "mps-login", factKey: "operator", sessionKey: "operator", credentialId: "cred-npg-c-01", secret: "pilot-crash-secret-01", scopes: ALL_SCOPES, ttlMs: 90 * DAY, jti: "jti-npg-c-001", now: T0 + 100 },
      { stepId: "s5", kind: "mps-request-submit", factKey: "need", sessionKey: "operator", tenantId: "acme", requestId: "req-npg-c-001", naturalKey: "acme:lt-5540:2026-q4:batch-nc1", sku: "LT-5540", quantity: 5, requiredBy: "2026-12-31", at: T0 + 1_000, now: T0 + 1_000 },
      { stepId: "s5b", kind: "mps-request-submit", factKey: "replay", sessionKey: "operator", tenantId: "acme", requestId: "req-npg-c-999", naturalKey: "acme:lt-5540:2026-q4:batch-nc1", sku: "LT-5540", quantity: 5, requiredBy: "2026-12-31", at: T0 + 1_200, now: T0 + 1_200 },
      { stepId: "s5c", kind: "mps-request-submit", factKey: "conflict", sessionKey: "operator", tenantId: "acme", requestId: "req-npg-c-002", naturalKey: "acme:lt-5540:2026-q4:batch-nc1", sku: "LT-5540", quantity: 6, requiredBy: "2026-12-31", at: T0 + 1_400, now: T0 + 1_400 },
      { stepId: "s6", kind: "mps-request-transition", factKey: "resolve", sessionKey: "operator", tenantId: "acme", requestId: "req-npg-c-001", command: { type: "resolve", at: T0 + 6_000 }, now: T0 + 6_000 },
      { stepId: "s7", kind: "mps-request-transition", factKey: "closeWindow", sessionKey: "operator", tenantId: "acme", requestId: "req-npg-c-001", command: { type: "close_offer_window", at: T0 + 6_500 }, now: T0 + 6_500 },
      { stepId: "s8", kind: "mps-request-transition", factKey: "comparing", sessionKey: "operator", tenantId: "acme", requestId: "req-npg-c-001", command: { type: "compare", at: T0 + 7_000 }, now: T0 + 7_000 },
      { stepId: "s9", kind: "mps-offer-capture", factKey: "offA", sessionKey: "operator", tenantId: "acme", now: T0 + 4_100, offer: { offerId: "off-npg-c-a", supplierId: "sup-alpha", sku: "LT-5540", quantity: 5, unitCostMinor: 1_400_000, totalCostMinor: 7_000_000, currency: "GHS", taxMinor: 0, feesMinor: 0, deliveryEstimateDays: 4, condition: "new", warrantyMonths: 12, validFrom: T0 + 4_000, validUntil: T0 + 10 * DAY, sourceKind: "operator-entered", sourceReference: "npg-crash-alpha-2026", capturedAt: T0 + 4_100 } },
      { stepId: "s10", kind: "mps-offer-capture", factKey: "offB", sessionKey: "operator", tenantId: "acme", now: T0 + 4_200, offer: { offerId: "off-npg-c-b", supplierId: "sup-beta", sku: "LT-5540", quantity: 5, unitCostMinor: 1_350_000, totalCostMinor: 6_750_000, currency: "GHS", taxMinor: 0, feesMinor: 0, deliveryEstimateDays: 3, condition: "new", warrantyMonths: 12, validFrom: T0 + 4_000, validUntil: T0 + 10 * DAY, sourceKind: "operator-entered", sourceReference: "npg-crash-beta-2026", capturedAt: T0 + 4_200 } },
      { stepId: "s11", kind: "mps-comparison", factKey: "live", sessionKey: "operator", tenantId: "acme", demandSku: "LT-5540", demandCurrency: "GHS", acceptableConditions: ["new"], suppliers: [{ supplierId: "sup-alpha", evidenceId: "verify-npg-c-alpha-2026", verifiedAt: T0 + 2_500, expiresAt: T0 + 90 * DAY }, { supplierId: "sup-beta", evidenceId: "verify-npg-c-beta-2026", verifiedAt: T0 + 2_600, expiresAt: T0 + 90 * DAY }], at: T0 + 7_600, now: T0 + 7_600 },
      { stepId: "s12", kind: "mps-approval", factKey: "inLimits", sessionKey: "operator", tenantId: "acme", requestId: "appr-npg-c-001", orderId: "ord-npg-c-001", category: "laptops", transactionKind: "purchase", units: 5, amountTotal: 6_750_000, currency: "GHS", supplierId: "sup-beta", verificationRef: "verify-npg-c-beta-2026", offerSnapshotFromEvidence: false, actorAuthority: ["human.approval"], actorAutonomous: false, at: T0 + 9_000, now: T0 + 9_000 },
      { stepId: "s13", kind: "mps-request-transition", factKey: "select", sessionKey: "operator", tenantId: "acme", requestId: "req-npg-c-001", command: { type: "select", at: T0 + 9_500, offerId: "off-npg-c-b" }, now: T0 + 9_500 },
      { stepId: "s14", kind: "mps-request-transition", factKey: "requestApproval", sessionKey: "operator", tenantId: "acme", requestId: "req-npg-c-001", command: { type: "request_approval", at: T0 + 9_600 }, now: T0 + 9_600 },
      { stepId: "s15", kind: "mps-request-transition", factKey: "approve", sessionKey: "operator", tenantId: "acme", requestId: "req-npg-c-001", command: { type: "approve", at: T0 + 10_000 }, now: T0 + 10_000 },
      { stepId: "s16", kind: "mps-request-transition", factKey: "order", sessionKey: "operator", tenantId: "acme", requestId: "req-npg-c-001", command: { type: "order", at: T0 + 11_000 }, now: T0 + 11_000 },
      { stepId: "s17", kind: "mps-order-draft", factKey: "draft", sessionKey: "operator", tenantId: "acme", orderId: "ord-npg-c-001", requestId: "req-npg-c-001", offerId: "off-npg-c-b", supplierId: "sup-beta", sku: "LT-5540", quantity: 5, unitCostMinor: 1_350_000, totalCostMinor: 6_750_000, currency: "GHS", now: T0 + 12_000 },
      { stepId: "s18", kind: "mps-order-place", factKey: "place", sessionKey: "operator", tenantId: "acme", orderId: "ord-npg-c-001", at: T0 + 13_000, now: T0 + 13_000 },
      { stepId: "s19", kind: "mps-evidence-retain", factKey: "providerAck", sessionKey: "operator", tenantId: "acme", evidenceKind: "provider-ack", providerEventId: "inv-npg-c-001", subjectRef: "ord-npg-c-001", sourceSystem: "provider-portal-export", sourceReference: "inv-npg-c-001", retrievedVia: "export", capturedAtIso: "2026-10-14T00:00:01.000Z", recordedAtIso: "2026-10-15T00:00:01.000Z", artifactId: "art-npg-c-ack-01", artifactDescription: "the provider acknowledgement invoice export", artifactJson: "{\"orderId\":\"ord-npg-c-001\",\"providerEventId\":\"inv-npg-c-001\",\"acknowledged\":true}", now: T0 + 14_000 },
      { stepId: "s20", kind: "mps-order-ack", factKey: "ack", sessionKey: "operator", tenantId: "acme", orderId: "ord-npg-c-001", providerEventId: "prov-ack-npg-c-001", evidenceFromEvidence: true, channel: "manual-invoice-reference", acknowledgedAt: T0 + 15_000, now: T0 + 15_000 },
      { stepId: "s21", kind: "mps-digest", factKey: "beforeCrashOne" },
      { stepId: "s22", kind: "npg-server-kill", factKey: "crashOne" },
      { stepId: "s23", kind: "npg-server-restart", factKey: "recoveryOne" },
      { stepId: "s24", kind: "mps-receipt-record", factKey: "main", sessionKey: "operator", tenantId: "acme", evidenceRef: "rcpt-npg-c-001", siteId: "site-accra-east", supplierOrderRef: "ord-npg-c-001", serial: "SN-NPG-C-0001", assetTag: "TAG-NPG-C-0001", conditionOnArrival: "new", warrantyRef: "wrty-npg-c-0001", capturedAt: T0 + 19_000, recordedAt: T0 + 20_000, now: T0 + 20_000 },
      { stepId: "s25", kind: "mps-receipt-verify", factKey: "main", sessionKey: "operator", tenantId: "acme", evidenceRef: "rcpt-npg-c-001", expectSupplierOrderRef: "ord-npg-c-001", expectSerial: "SN-NPG-C-0001", expectAssetTag: "TAG-NPG-C-0001", expectCondition: "new", decidedAt: T0 + 21_000, now: T0 + 21_000 },
      { stepId: "s26", kind: "mps-enrollment-open", factKey: "open", sessionKey: "operator", tenantId: "acme", evidenceRef: "rcpt-npg-c-001", assetId: "ast_npg_c_0001", displayName: "LT-5540 laptop (ord-npg-c-001)", assetKind: "other", deviceId: "dev-npg-c-0001", at: T0 + 22_000, now: T0 + 22_000 },
      { stepId: "s27", kind: "mps-enrollment-complete", factKey: "complete", sessionKey: "operator", tenantId: "acme", serial: "SN-NPG-C-0001", at: T0 + 24_000, now: T0 + 24_000 },
      { stepId: "s28", kind: "mps-digest", factKey: "beforeCrashTwo" },
      { stepId: "s29", kind: "npg-server-kill", factKey: "crashTwo" },
      { stepId: "s30", kind: "npg-server-restart", factKey: "recoveryTwo" },
      { stepId: "s31", kind: "mps-restart", factKey: "coldRestart", mode: "kill", at: T0 + 25_000 },
      { stepId: "s32", kind: "mps-state", factKey: "enrollments", sessionKey: "operator", tenantId: "acme", family: "enrollments", now: T0 + 26_000 },
      { stepId: "s33", kind: "mps-state", factKey: "receipts", sessionKey: "operator", tenantId: "acme", family: "receipts", now: T0 + 26_100 },
      { stepId: "s34", kind: "mps-digest", factKey: "final" },
      { stepId: "s35", kind: "mps-shutdown", factKey: "shutdown" },
    ],
    assertions: [
      { id: "npg-c1", description: "the postgres server process provisioned and the service booted NETWORKED", fact: "mps.boot.boot.store", op: "eq", expected: "networked" },
      { id: "npg-c1b", description: "REFUSAL: the natural-key replay is idempotent (duplicate=true) and the divergent content refused NATURAL_KEY_CONFLICT over TCP", fact: "mps.request.conflict.reason", op: "eq", expected: "NATURAL_KEY_CONFLICT" },
      { id: "npg-c1c", description: "the natural-key replay returned the ORIGINAL request (never a second create)", fact: "mps.request.replay.duplicate", op: "eq", expected: true },
      { id: "npg-c2", description: "the spine reached the acknowledged order over TCP", fact: "mps.ack.ack.status", op: "eq", expected: "acknowledged" },
      { id: "npg-c3", description: "SERVER CRASH #1: the postgres server process was SIGKILLed", fact: "npg.serverKill.crashOne.ok", op: "eq", expected: true },
      { id: "npg-c4", description: "the service survived server crash #1 (the boundary answered)", fact: "npg.serverKill.crashOne.serviceAlive", op: "eq", expected: true },
      { id: "npg-c5", description: "the persistence plane's death surfaced at the boundary (the frozen STORE_UNREACHABLE refusal)", fact: "npg.serverKill.crashOne.storeUnreachable", op: "eq", expected: true },
      { id: "npg-c6", description: "WAL RECOVERY #1: the service reconnected transparently", fact: "npg.serverRestart.recoveryOne.recovered", op: "eq", expected: true },
      { id: "npg-c7", description: "WAL RECOVERY #1: the digest envelope BYTE-IDENTICAL after the first server crash", fact: "npg.serverRestart.recoveryOne.digestsIdentical", op: "eq", expected: true },
      { id: "npg-c8", description: "the recovered server served the post-crash receipt + verification", fact: "mps.verify.main.state", op: "eq", expected: "verified" },
      { id: "npg-c9", description: "the enrollment completed with the twin linked between the server crashes", fact: "mps.enrollComplete.complete.twinLinked", op: "eq", expected: true },
      { id: "npg-c10", description: "SERVER CRASH #2 (the harder WAL state: a decided receipt + an enrolled asset on board)", fact: "npg.serverKill.crashTwo.ok", op: "eq", expected: true },
      { id: "npg-c11", description: "the service survived server crash #2 as well", fact: "npg.serverKill.crashTwo.serviceAlive", op: "eq", expected: true },
      { id: "npg-c12", description: "WAL RECOVERY #2: the digest envelope STILL byte-identical", fact: "npg.serverRestart.recoveryTwo.digestsIdentical", op: "eq", expected: true },
      { id: "npg-c13", description: "THE SERVICE COLD RESTART over the network boundary: verify-on-start ok", fact: "mps.restart.coldRestart.verifyOk", op: "eq", expected: true },
      { id: "npg-c14", description: "the cold restart replayed exactly one receipt (byte-exact, fail-closed)", fact: "mps.restart.coldRestart.receiptsReplayed", op: "eq", expected: 1 },
      { id: "npg-c15", description: "the client-crash digest is also identical (the F370C law holds networked)", fact: "mps.restart.coldRestart.digestsIdentical", op: "eq", expected: true },
      { id: "npg-c16", description: "the enrollment survived BOTH server crashes + the service restart (enrolled)", fact: "mps.state.enrollments.statuses", op: "deepEq", expected: ["SN-NPG-C-0001:enrolled"] },
      { id: "npg-c17", description: "the decided receipt survived (verified, replayed byte-exact)", fact: "mps.state.receipts.statuses", op: "deepEq", expected: ["rcpt-npg-c-001:verified"] },
      { id: "npg-c18", description: "the final digest counts exactly one enrollment + one receipt", fact: "mps.digest.final.countEnrollments", op: "eq", expected: 1 },
      { id: "npg-c19", description: "the final digest counts the order + the audit trail (>= 20 attempts over TCP)", fact: "mps.digest.final.countAudit", op: "gte", expected: 20 },
    ],
  },
];
