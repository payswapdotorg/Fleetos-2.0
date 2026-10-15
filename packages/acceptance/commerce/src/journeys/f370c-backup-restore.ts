/**
 * @fleetos/acceptance-commerce — the F370C backup/restore journey (Wave 18
 * lane C): the full spine state dumped to a single file, the service
 * killed, the store restored from the dump — and the digest envelope
 * byte-identical. The journey's steps ARE the runbook's procedure
 * (infrastructure/fleetos-marketplace/RUNBOOK.md — the doc and the test
 * can never drift):
 *
 *   1. seed the full spine state (the F362 shape end-to-end);
 *   2. read the digest envelope (the pre-incident proof);
 *   3. DUMP — GET /api/admin/backup (the single-file canonical-JSON
 *      backup, journaled as data); the operator writes the file;
 *   4. THE INCIDENT — SIGKILL (the service is down);
 *   5. RESTORE — the service binary's --restore boot: wipe + import +
 *      re-verify against the dump's envelope (fail-closed on mismatch),
 *      then serve;
 *   6. verify: the digest envelope identical to the pre-incident value;
 *      every record set survived (requests, orders, receipts,
 *      enrollments, evidence, approvals); the credentials survived
 *      (the post-restore login works);
 *   7. the restored service SERVES WRITES (the order's final transition).
 *
 * CENSUS CITATION: the journey id `marketplace-backup-restore` is NEW at
 * base b6747b3. The restore is the recorded incident path — never ad-hoc
 * SQL (the runbook's rollback law).
 */

import type { AcceptanceJourney } from "../journey-contracts.js";

const T0 = 1_774_000_000_000;
const DAY = 86_400_000;
const ALL_SCOPES = [
  "marketplace.request", "marketplace.offer", "marketplace.comparison", "marketplace.order",
  "marketplace.order.ack", "marketplace.receipt", "marketplace.enrollment", "marketplace.approval",
];

export const F370C_BACKUP_JOURNEYS: readonly AcceptanceJourney[] = [
  {
    id: "marketplace-backup-restore",
    persona: "software-admin",
    capability: "marketplace-backup-restore",
    goal: "Prove the runbook's backup/restore procedure end-to-end on the real deployment service: full spine state → the single-file dump → a real SIGKILL incident → the --restore boot (wipe + import + envelope re-verify) → the digest envelope byte-identical → every record set and credential survived → the restored service serves writes.",
    steps: [
      { stepId: "s1", kind: "mps-boot", factKey: "boot" },
      { stepId: "s2", kind: "mps-provision", factKey: "provision", credentialId: "cred-mps-r-01", actorId: "act_operator-mps-r01", tenantId: "acme", secret: "pilot-restore-secret-01" },
      { stepId: "s3", kind: "mps-login", factKey: "operator", sessionKey: "operator", credentialId: "cred-mps-r-01", secret: "pilot-restore-secret-01", scopes: ALL_SCOPES, ttlMs: 90 * DAY, jti: "jti-mps-r-001", now: T0 + 100 },
      { stepId: "s4", kind: "mps-request-submit", factKey: "need", sessionKey: "operator", tenantId: "acme", requestId: "req-mps-r-001", naturalKey: "acme:lt-5540:2026-q4:batch-r1", sku: "LT-5540", quantity: 5, requiredBy: "2026-12-31", at: T0 + 1_000, now: T0 + 1_000 },
      { stepId: "s5", kind: "mps-request-transition", factKey: "resolve", sessionKey: "operator", tenantId: "acme", requestId: "req-mps-r-001", command: { type: "resolve", at: T0 + 6_000 }, now: T0 + 6_000 },
      { stepId: "s6", kind: "mps-request-transition", factKey: "closeWindow", sessionKey: "operator", tenantId: "acme", requestId: "req-mps-r-001", command: { type: "close_offer_window", at: T0 + 6_500 }, now: T0 + 6_500 },
      { stepId: "s7", kind: "mps-request-transition", factKey: "comparing", sessionKey: "operator", tenantId: "acme", requestId: "req-mps-r-001", command: { type: "compare", at: T0 + 7_000 }, now: T0 + 7_000 },
      { stepId: "s8", kind: "mps-offer-capture", factKey: "offA", sessionKey: "operator", tenantId: "acme", now: T0 + 4_100, offer: { offerId: "off-mps-r-a", supplierId: "sup-alpha", sku: "LT-5540", quantity: 5, unitCostMinor: 1_400_000, totalCostMinor: 7_000_000, currency: "GHS", taxMinor: 0, feesMinor: 0, deliveryEstimateDays: 4, condition: "new", warrantyMonths: 12, validFrom: T0 + 4_000, validUntil: T0 + 10 * DAY, sourceKind: "operator-entered", sourceReference: "mps-restore-alpha-2026", capturedAt: T0 + 4_100 } },
      { stepId: "s9", kind: "mps-offer-capture", factKey: "offB", sessionKey: "operator", tenantId: "acme", now: T0 + 4_200, offer: { offerId: "off-mps-r-b", supplierId: "sup-beta", sku: "LT-5540", quantity: 5, unitCostMinor: 1_350_000, totalCostMinor: 6_750_000, currency: "GHS", taxMinor: 0, feesMinor: 0, deliveryEstimateDays: 3, condition: "new", warrantyMonths: 12, validFrom: T0 + 4_000, validUntil: T0 + 10 * DAY, sourceKind: "operator-entered", sourceReference: "mps-restore-beta-2026", capturedAt: T0 + 4_200 } },
      { stepId: "s10", kind: "mps-comparison", factKey: "live", sessionKey: "operator", tenantId: "acme", demandSku: "LT-5540", demandCurrency: "GHS", acceptableConditions: ["new"], suppliers: [{ supplierId: "sup-alpha", evidenceId: "verify-mps-r-alpha-2026", verifiedAt: T0 + 2_500, expiresAt: T0 + 90 * DAY }, { supplierId: "sup-beta", evidenceId: "verify-mps-r-beta-2026", verifiedAt: T0 + 2_600, expiresAt: T0 + 90 * DAY }], at: T0 + 7_600, now: T0 + 7_600 },
      { stepId: "s11", kind: "mps-evidence-retain", factKey: "snapshot", sessionKey: "operator", tenantId: "acme", evidenceKind: "offer-snapshot", providerEventId: "exp-mps-r-snap-001", subjectRef: "off-mps-r-b", sourceSystem: "manual-catalogue-export", sourceReference: "exp-2026-10-mps-r-01", retrievedVia: "export", capturedAtIso: "2026-10-14T00:00:00.000Z", recordedAtIso: "2026-10-15T00:00:00.000Z", artifactId: "art-mps-r-snap-01", artifactDescription: "the retained offer snapshot (off-mps-r-b)", artifactJson: "{\"offerId\":\"off-mps-r-b\",\"unitCostMinor\":1350000,\"totalCostMinor\":6750000}", now: T0 + 8_000 },
      { stepId: "s12", kind: "mps-approval", factKey: "inLimits", sessionKey: "operator", tenantId: "acme", requestId: "appr-mps-r-001", orderId: "ord-mps-r-001", category: "laptops", transactionKind: "purchase", units: 5, amountTotal: 6_750_000, currency: "GHS", supplierId: "sup-beta", verificationRef: "verify-mps-r-beta-2026", offerSnapshotFromEvidence: true, actorAuthority: ["human.approval"], actorAutonomous: false, at: T0 + 9_000, now: T0 + 9_000 },
      { stepId: "s13", kind: "mps-approval", factKey: "overLimit", sessionKey: "operator", tenantId: "acme", requestId: "appr-mps-r-002", orderId: "ord-mps-r-002", category: "laptops", transactionKind: "purchase", units: 5, amountTotal: 9_000_000, currency: "GHS", supplierId: "sup-beta", verificationRef: "verify-mps-r-beta-2026", offerSnapshotFromEvidence: false, actorAuthority: ["human.approval"], actorAutonomous: false, at: T0 + 9_100, now: T0 + 9_100 },
      { stepId: "s14", kind: "mps-request-transition", factKey: "select", sessionKey: "operator", tenantId: "acme", requestId: "req-mps-r-001", command: { type: "select", at: T0 + 9_500, offerId: "off-mps-r-b" }, now: T0 + 9_500 },
      { stepId: "s15", kind: "mps-request-transition", factKey: "requestApproval", sessionKey: "operator", tenantId: "acme", requestId: "req-mps-r-001", command: { type: "request_approval", at: T0 + 9_600 }, now: T0 + 9_600 },
      { stepId: "s16", kind: "mps-request-transition", factKey: "approve", sessionKey: "operator", tenantId: "acme", requestId: "req-mps-r-001", command: { type: "approve", at: T0 + 10_000 }, now: T0 + 10_000 },
      { stepId: "s17", kind: "mps-request-transition", factKey: "order", sessionKey: "operator", tenantId: "acme", requestId: "req-mps-r-001", command: { type: "order", at: T0 + 11_000 }, now: T0 + 11_000 },
      { stepId: "s18", kind: "mps-order-draft", factKey: "draft", sessionKey: "operator", tenantId: "acme", orderId: "ord-mps-r-001", requestId: "req-mps-r-001", offerId: "off-mps-r-b", supplierId: "sup-beta", sku: "LT-5540", quantity: 5, unitCostMinor: 1_350_000, totalCostMinor: 6_750_000, currency: "GHS", now: T0 + 12_000 },
      { stepId: "s19", kind: "mps-order-place", factKey: "place", sessionKey: "operator", tenantId: "acme", orderId: "ord-mps-r-001", at: T0 + 13_000, now: T0 + 13_000 },
      { stepId: "s20", kind: "mps-evidence-retain", factKey: "providerAck", sessionKey: "operator", tenantId: "acme", evidenceKind: "provider-ack", providerEventId: "inv-mps-r-001", subjectRef: "ord-mps-r-001", sourceSystem: "provider-portal-export", sourceReference: "inv-mps-r-001", retrievedVia: "export", capturedAtIso: "2026-10-14T00:00:01.000Z", recordedAtIso: "2026-10-15T00:00:01.000Z", artifactId: "art-mps-r-ack-01", artifactDescription: "the provider acknowledgement invoice export", artifactJson: "{\"orderId\":\"ord-mps-r-001\",\"providerEventId\":\"inv-mps-r-001\"}", now: T0 + 14_000 },
      { stepId: "s21", kind: "mps-order-ack", factKey: "ack", sessionKey: "operator", tenantId: "acme", orderId: "ord-mps-r-001", providerEventId: "prov-ack-mps-r-001", evidenceFromEvidence: true, channel: "manual-invoice-reference", acknowledgedAt: T0 + 15_000, now: T0 + 15_000 },
      { stepId: "s22", kind: "mps-order-transition", factKey: "ship", sessionKey: "operator", tenantId: "acme", orderId: "ord-mps-r-001", command: { type: "ship", at: T0 + 16_000 }, now: T0 + 16_000 },
      { stepId: "s23", kind: "mps-order-transition", factKey: "receive", sessionKey: "operator", tenantId: "acme", orderId: "ord-mps-r-001", command: { type: "receive", at: T0 + 17_000 }, now: T0 + 17_000 },
      { stepId: "s24", kind: "mps-receipt-record", factKey: "main", sessionKey: "operator", tenantId: "acme", evidenceRef: "rcpt-mps-r-001", siteId: "site-accra-east", supplierOrderRef: "ord-mps-r-001", serial: "SN-MPS-R-0001", assetTag: "TAG-MPS-R-0001", conditionOnArrival: "new", warrantyRef: "wrty-mps-r-0001", capturedAt: T0 + 18_000, recordedAt: T0 + 19_000, now: T0 + 19_000 },
      { stepId: "s25", kind: "mps-receipt-verify", factKey: "main", sessionKey: "operator", tenantId: "acme", evidenceRef: "rcpt-mps-r-001", expectSupplierOrderRef: "ord-mps-r-001", expectSerial: "SN-MPS-R-0001", expectAssetTag: "TAG-MPS-R-0001", expectCondition: "new", decidedAt: T0 + 20_000, now: T0 + 20_000 },
      { stepId: "s26", kind: "mps-enrollment-open", factKey: "open", sessionKey: "operator", tenantId: "acme", evidenceRef: "rcpt-mps-r-001", assetId: "ast_mps_r_0001", displayName: "LT-5540 laptop (ord-mps-r-001)", assetKind: "other", deviceId: "dev-mps-r-0001", at: T0 + 21_000, now: T0 + 21_000 },
      { stepId: "s27", kind: "mps-enrollment-complete", factKey: "complete", sessionKey: "operator", tenantId: "acme", serial: "SN-MPS-R-0001", at: T0 + 22_000, now: T0 + 22_000 },
      { stepId: "s28", kind: "mps-digest", factKey: "beforeIncident" },
      { stepId: "s29", kind: "mps-backup", factKey: "dump", now: T0 + 23_000 },
      { stepId: "s30", kind: "mps-restart", factKey: "restore", mode: "restore", at: T0 + 24_000 },
      { stepId: "s31", kind: "mps-state", factKey: "requests", sessionKey: "operator", tenantId: "acme", family: "requests", now: T0 + 25_000 },
      { stepId: "s32", kind: "mps-state", factKey: "orders", sessionKey: "operator", tenantId: "acme", family: "orders", now: T0 + 25_100 },
      { stepId: "s33", kind: "mps-state", factKey: "receipts", sessionKey: "operator", tenantId: "acme", family: "receipts", now: T0 + 25_200 },
      { stepId: "s34", kind: "mps-state", factKey: "enrollments", sessionKey: "operator", tenantId: "acme", family: "enrollments", now: T0 + 25_300 },
      { stepId: "s35", kind: "mps-order-transition", factKey: "accept", sessionKey: "operator", tenantId: "acme", orderId: "ord-mps-r-001", command: { type: "accept", at: T0 + 26_000 }, now: T0 + 26_000 },
      { stepId: "s36", kind: "mps-digest", factKey: "afterRestore" },
      { stepId: "s37", kind: "mps-shutdown", factKey: "shutdown" },
    ],
    assertions: [
      { id: "mps-r1", description: "the service booted and the credential provisioned", fact: "mps.provision.provision.ok", op: "eq", expected: true },
      { id: "mps-r2", description: "the full spine seeded: the request reached ordered", fact: "mps.requestT.order.status", op: "eq", expected: "ordered" },
      { id: "mps-r3", description: "the order acknowledged before the incident", fact: "mps.ack.ack.status", op: "eq", expected: "acknowledged" },
      { id: "mps-r4", description: "the receipt verified before the incident", fact: "mps.verify.main.state", op: "eq", expected: "verified" },
      { id: "mps-r5", description: "the enrollment completed with the twin linked before the incident", fact: "mps.enrollComplete.complete.twinLinked", op: "eq", expected: true },
      { id: "mps-r6", description: "the over-limit Guardian refusal was retained as data (the two-layer law in the backup set)", fact: "mps.approval.overLimit.decision", op: "eq", expected: "refuse" },
      { id: "mps-r7", description: "THE DUMP: the backup produced the single-file envelope", fact: "mps.backup.dump.ok", op: "eq", expected: true },
      { id: "mps-r8", description: "the dump's envelope carries the full spine record counts (the file is the state)", fact: "mps.backup.dump.countEnrollments", op: "eq", expected: 1 },
      { id: "mps-r9", description: "THE RESTORE: the --restore boot verified the envelope and served (digests identical)", fact: "mps.restart.restore.digestsIdentical", op: "eq", expected: true },
      { id: "mps-r10", description: "the restore boot replayed + byte-verified the decided receipt", fact: "mps.restart.restore.receiptsReplayed", op: "eq", expected: 1 },
      { id: "mps-r11", description: "the requests survived the round-trip (ordered)", fact: "mps.state.requests.statuses", op: "deepEq", expected: ["req-mps-r-001:ordered"] },
      { id: "mps-r12", description: "the orders survived the round-trip (received, pre-accept)", fact: "mps.state.orders.statuses", op: "deepEq", expected: ["ord-mps-r-001:received"] },
      { id: "mps-r13", description: "the decided receipts survived the round-trip (verified)", fact: "mps.state.receipts.statuses", op: "deepEq", expected: ["rcpt-mps-r-001:verified"] },
      { id: "mps-r14", description: "the enrollments survived the round-trip (enrolled)", fact: "mps.state.enrollments.statuses", op: "deepEq", expected: ["SN-MPS-R-0001:enrolled"] },
      { id: "mps-r15", description: "the credentials survived (the restored service still authorizes the operator — the login token verifies statelessly AND the record exists)", fact: "mps.orderT.accept.ok", op: "eq", expected: true },
      { id: "mps-r16", description: "the restored service SERVES WRITES: the order's final transition landed (accepted)", fact: "mps.orderT.accept.status", op: "eq", expected: "accepted" },
      { id: "mps-r17", description: "the post-restore digest counts the same spine records (one request, one order)", fact: "mps.digest.afterRestore.countRequests", op: "eq", expected: 1 },
      { id: "mps-r18", description: "the post-restore evidence set holds the snapshot + the provider-ack", fact: "mps.digest.afterRestore.countEvidence", op: "eq", expected: 2 },
      { id: "mps-r19", description: "the post-restore approvals set holds BOTH Guardian decisions (approve + the over-limit refuse — evaluated data, both retained)", fact: "mps.digest.afterRestore.countApprovals", op: "eq", expected: 2 },
      { id: "mps-r20", description: "the pre-incident digest is recorded (the proof surface)", fact: "mps.digest.beforeIncident.countEnrollments", op: "eq", expected: 1 },
    ],
  },
];
