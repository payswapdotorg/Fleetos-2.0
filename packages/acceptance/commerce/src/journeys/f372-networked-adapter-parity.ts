/**
 * @fleetos/acceptance-commerce — the F372 adapter-parity + backup/restore
 * journey (Wave 19 lane A): the SAME record set through the pglite and
 * networked adapters — identical digests — plus the dump -> wipe ->
 * restore round-trip over the network boundary.
 *
 * Phase A (NETWORKED): the REAL postgres server process + the service in
 * networked mode drive the full spine (request → offers → comparison →
 * approval → order acknowledged → shipped → received → receipt verified →
 * enrollment completed); the DUMP is taken over the network boundary
 * (GET /api/admin/backup); the digest is recorded as the parity baseline.
 *
 * Phase B (PGLITE): the service re-boots in the in-process mode (the
 * F370C adapter, byte-unchanged) over a fresh data dir and drives the
 * IDENTICAL record set; npg-parity proves the digest envelope is
 * BYTE-IDENTICAL across the two adapters — the MarketplaceStore PORT
 * contract as a machine fact, not prose.
 *
 * Phase C (RESTORE over the network boundary): the old server is torn
 * down and a FRESH cluster provisioned (the honest wipe — a brand-new
 * PGDATA); the networked service re-boots against it and the --restore
 * boot (the runbook's recorded incident path) imports the dump, envelope
 * re-verified fail-closed; npg-parity proves the restored digest equals
 * the baseline — the round-trip over the network boundary; the restored
 * service serves reads AND writes.
 *
 * CENSUS CITATION: the journey id `marketplace-networked-adapter-parity`
 * is NEW at base 76ddba0 (greps in docs/evidence/F372/report.md §1); the
 * spine verbs reuse the EXISTING mps-* family; the parity surface is the
 * NEW npg-* family.
 *
 * Time law: single-epoch (T0) literal journey data; the run anchor never
 * reaches the service. Ports/timestamps/paths never in output.
 */

import type { AcceptanceJourney, JourneyStep } from "../journey-contracts.js";

const T0 = 1_774_000_000_000;
const DAY = 86_400_000;
const ALL_SCOPES = [
  "marketplace.request", "marketplace.offer", "marketplace.comparison", "marketplace.order",
  "marketplace.order.ack", "marketplace.receipt", "marketplace.enrollment", "marketplace.approval",
];

/** The shared spine seed — IDENTICAL domain data in both phases (the
 *  parity is over the record SETS, so only the fact keys differ). */
function spineSteps(key: "a" | "b"): readonly JourneyStep[] {
  const f = (name: string) => (key === "a" ? name : `${name}2`);
  const credentialId = "cred-npg-par-01";
  const secret = "pilot-parity-secret-01";
  return [
    { stepId: `s-${key}-1`, kind: "mps-provision", factKey: f("provision"), credentialId, actorId: "act_operator-npg-par01", tenantId: "acme", secret },
    { stepId: `s-${key}-2`, kind: "mps-login", factKey: f("operator"), sessionKey: "operator", credentialId, secret, scopes: ALL_SCOPES, ttlMs: 90 * DAY, jti: key === "a" ? "jti-npg-par-001" : "jti-npg-par-002", now: T0 + 100 },
    { stepId: `s-${key}-3`, kind: "mps-request-submit", factKey: f("need"), sessionKey: "operator", tenantId: "acme", requestId: "req-npg-par-001", naturalKey: "acme:lt-5540:2026-q4:batch-par1", sku: "LT-5540", quantity: 5, requiredBy: "2026-12-31", at: T0 + 1_000, now: T0 + 1_000 },
    { stepId: `s-${key}-3b`, kind: "mps-request-submit", factKey: f("replay"), sessionKey: "operator", tenantId: "acme", requestId: "req-npg-par-999", naturalKey: "acme:lt-5540:2026-q4:batch-par1", sku: "LT-5540", quantity: 5, requiredBy: "2026-12-31", at: T0 + 1_200, now: T0 + 1_200 },
    { stepId: `s-${key}-3c`, kind: "mps-request-submit", factKey: f("conflict"), sessionKey: "operator", tenantId: "acme", requestId: "req-npg-par-002", naturalKey: "acme:lt-5540:2026-q4:batch-par1", sku: "LT-5540", quantity: 6, requiredBy: "2026-12-31", at: T0 + 1_400, now: T0 + 1_400 },
    { stepId: `s-${key}-4`, kind: "mps-request-transition", factKey: f("resolve"), sessionKey: "operator", tenantId: "acme", requestId: "req-npg-par-001", command: { type: "resolve", at: T0 + 6_000 }, now: T0 + 6_000 },
    { stepId: `s-${key}-5`, kind: "mps-request-transition", factKey: f("closeWindow"), sessionKey: "operator", tenantId: "acme", requestId: "req-npg-par-001", command: { type: "close_offer_window", at: T0 + 6_500 }, now: T0 + 6_500 },
    { stepId: `s-${key}-6`, kind: "mps-request-transition", factKey: f("comparing"), sessionKey: "operator", tenantId: "acme", requestId: "req-npg-par-001", command: { type: "compare", at: T0 + 7_000 }, now: T0 + 7_000 },
    { stepId: `s-${key}-7`, kind: "mps-offer-capture", factKey: f("offA"), sessionKey: "operator", tenantId: "acme", now: T0 + 4_100, offer: { offerId: "off-npg-par-a", supplierId: "sup-alpha", sku: "LT-5540", quantity: 5, unitCostMinor: 1_400_000, totalCostMinor: 7_000_000, currency: "GHS", taxMinor: 0, feesMinor: 0, deliveryEstimateDays: 4, condition: "new", warrantyMonths: 12, validFrom: T0 + 4_000, validUntil: T0 + 10 * DAY, sourceKind: "operator-entered", sourceReference: "npg-parity-alpha-2026", capturedAt: T0 + 4_100 } },
    { stepId: `s-${key}-8`, kind: "mps-offer-capture", factKey: f("offB"), sessionKey: "operator", tenantId: "acme", now: T0 + 4_200, offer: { offerId: "off-npg-par-b", supplierId: "sup-beta", sku: "LT-5540", quantity: 5, unitCostMinor: 1_350_000, totalCostMinor: 6_750_000, currency: "GHS", taxMinor: 0, feesMinor: 0, deliveryEstimateDays: 3, condition: "new", warrantyMonths: 12, validFrom: T0 + 4_000, validUntil: T0 + 10 * DAY, sourceKind: "operator-entered", sourceReference: "npg-parity-beta-2026", capturedAt: T0 + 4_200 } },
    { stepId: `s-${key}-9`, kind: "mps-comparison", factKey: f("live"), sessionKey: "operator", tenantId: "acme", demandSku: "LT-5540", demandCurrency: "GHS", acceptableConditions: ["new"], suppliers: [{ supplierId: "sup-alpha", evidenceId: "verify-npg-par-alpha-2026", verifiedAt: T0 + 2_500, expiresAt: T0 + 90 * DAY }, { supplierId: "sup-beta", evidenceId: "verify-npg-par-beta-2026", verifiedAt: T0 + 2_600, expiresAt: T0 + 90 * DAY }], at: T0 + 7_600, now: T0 + 7_600 },
    { stepId: `s-${key}-10`, kind: "mps-evidence-retain", factKey: f("snapshot"), sessionKey: "operator", tenantId: "acme", evidenceKind: "offer-snapshot", providerEventId: "exp-npg-par-snap-001", subjectRef: "off-npg-par-b", sourceSystem: "manual-catalogue-export", sourceReference: "exp-2026-10-npg-par-01", retrievedVia: "export", capturedAtIso: "2026-10-14T00:00:00.000Z", recordedAtIso: "2026-10-15T00:00:00.000Z", artifactId: "art-npg-par-snap-01", artifactDescription: "the retained offer snapshot (off-npg-par-b)", artifactJson: "{\"offerId\":\"off-npg-par-b\",\"unitCostMinor\":1350000,\"totalCostMinor\":6750000}", now: T0 + 8_000 },
    { stepId: `s-${key}-11`, kind: "mps-approval", factKey: f("inLimits"), sessionKey: "operator", tenantId: "acme", requestId: "appr-npg-par-001", orderId: "ord-npg-par-001", category: "laptops", transactionKind: "purchase", units: 5, amountTotal: 6_750_000, currency: "GHS", supplierId: "sup-beta", verificationRef: "verify-npg-par-beta-2026", offerSnapshotFromEvidence: true, actorAuthority: ["human.approval"], actorAutonomous: false, at: T0 + 9_000, now: T0 + 9_000 },
    { stepId: `s-${key}-12`, kind: "mps-request-transition", factKey: f("select"), sessionKey: "operator", tenantId: "acme", requestId: "req-npg-par-001", command: { type: "select", at: T0 + 9_500, offerId: "off-npg-par-b" }, now: T0 + 9_500 },
    { stepId: `s-${key}-13`, kind: "mps-request-transition", factKey: f("requestApproval"), sessionKey: "operator", tenantId: "acme", requestId: "req-npg-par-001", command: { type: "request_approval", at: T0 + 9_600 }, now: T0 + 9_600 },
    { stepId: `s-${key}-14`, kind: "mps-request-transition", factKey: f("approve"), sessionKey: "operator", tenantId: "acme", requestId: "req-npg-par-001", command: { type: "approve", at: T0 + 10_000 }, now: T0 + 10_000 },
    { stepId: `s-${key}-15`, kind: "mps-request-transition", factKey: f("order"), sessionKey: "operator", tenantId: "acme", requestId: "req-npg-par-001", command: { type: "order", at: T0 + 11_000 }, now: T0 + 11_000 },
    { stepId: `s-${key}-16`, kind: "mps-order-draft", factKey: f("draft"), sessionKey: "operator", tenantId: "acme", orderId: "ord-npg-par-001", requestId: "req-npg-par-001", offerId: "off-npg-par-b", supplierId: "sup-beta", sku: "LT-5540", quantity: 5, unitCostMinor: 1_350_000, totalCostMinor: 6_750_000, currency: "GHS", now: T0 + 12_000 },
    { stepId: `s-${key}-17`, kind: "mps-order-place", factKey: f("place"), sessionKey: "operator", tenantId: "acme", orderId: "ord-npg-par-001", at: T0 + 13_000, now: T0 + 13_000 },
    { stepId: `s-${key}-18`, kind: "mps-evidence-retain", factKey: f("providerAck"), sessionKey: "operator", tenantId: "acme", evidenceKind: "provider-ack", providerEventId: "inv-npg-par-001", subjectRef: "ord-npg-par-001", sourceSystem: "provider-portal-export", sourceReference: "inv-npg-par-001", retrievedVia: "export", capturedAtIso: "2026-10-14T00:00:01.000Z", recordedAtIso: "2026-10-15T00:00:01.000Z", artifactId: "art-npg-par-ack-01", artifactDescription: "the provider acknowledgement invoice export", artifactJson: "{\"orderId\":\"ord-npg-par-001\",\"providerEventId\":\"inv-npg-par-001\"}", now: T0 + 14_000 },
    { stepId: `s-${key}-19`, kind: "mps-order-ack", factKey: f("ack"), sessionKey: "operator", tenantId: "acme", orderId: "ord-npg-par-001", providerEventId: "prov-ack-npg-par-001", evidenceFromEvidence: true, channel: "manual-invoice-reference", acknowledgedAt: T0 + 15_000, now: T0 + 15_000 },
    { stepId: `s-${key}-20`, kind: "mps-order-transition", factKey: f("ship"), sessionKey: "operator", tenantId: "acme", orderId: "ord-npg-par-001", command: { type: "ship", at: T0 + 16_000 }, now: T0 + 16_000 },
    { stepId: `s-${key}-21`, kind: "mps-order-transition", factKey: f("receive"), sessionKey: "operator", tenantId: "acme", orderId: "ord-npg-par-001", command: { type: "receive", at: T0 + 17_000 }, now: T0 + 17_000 },
    { stepId: `s-${key}-22`, kind: "mps-receipt-record", factKey: f("main"), sessionKey: "operator", tenantId: "acme", evidenceRef: "rcpt-npg-par-001", siteId: "site-accra-east", supplierOrderRef: "ord-npg-par-001", serial: "SN-NPG-PAR-0001", assetTag: "TAG-NPG-PAR-0001", conditionOnArrival: "new", warrantyRef: "wrty-npg-par-0001", capturedAt: T0 + 18_000, recordedAt: T0 + 19_000, now: T0 + 19_000 },
    { stepId: `s-${key}-23`, kind: "mps-receipt-verify", factKey: f("main"), sessionKey: "operator", tenantId: "acme", evidenceRef: "rcpt-npg-par-001", expectSupplierOrderRef: "ord-npg-par-001", expectSerial: "SN-NPG-PAR-0001", expectAssetTag: "TAG-NPG-PAR-0001", expectCondition: "new", decidedAt: T0 + 20_000, now: T0 + 20_000 },
    { stepId: `s-${key}-24`, kind: "mps-enrollment-open", factKey: f("open"), sessionKey: "operator", tenantId: "acme", evidenceRef: "rcpt-npg-par-001", assetId: "ast_npg_par_0001", displayName: "LT-5540 laptop (ord-npg-par-001)", assetKind: "other", deviceId: "dev-npg-par-0001", at: T0 + 21_000, now: T0 + 21_000 },
    { stepId: `s-${key}-25`, kind: "mps-enrollment-complete", factKey: f("complete"), sessionKey: "operator", tenantId: "acme", serial: "SN-NPG-PAR-0001", at: T0 + 22_000, now: T0 + 22_000 },
  ];
}

export const F372_NETWORKED_ADAPTER_PARITY_JOURNEYS: readonly AcceptanceJourney[] = [
  {
    id: "marketplace-networked-adapter-parity",
    persona: "software-admin",
    capability: "marketplace-networked-adapter-parity",
    goal: "Prove the MarketplaceStore PORT contract as a machine fact: the SAME record set driven through the networked adapter (REAL PostgreSQL as a separate server process over TCP) and the pglite adapter (the WASM in-process build) produces a BYTE-IDENTICAL digest envelope — then the dump -> wipe -> restore round-trip over the network boundary onto a FRESH postgres cluster reproduces the same envelope, and the restored service serves reads and writes.",
    steps: [
      { stepId: "s1", kind: "npg-server-boot", factKey: "serverOne" },
      { stepId: "s2", kind: "mps-boot", factKey: "bootNetworked", store: "networked" },
      ...spineSteps("a"),
      { stepId: "s3", kind: "mps-digest", factKey: "networked" },
      { stepId: "s4", kind: "mps-backup", factKey: "dump", now: T0 + 23_000 },
      { stepId: "s5", kind: "npg-digest-baseline", factKey: "networked" },
      // --- Phase B: the SAME record set through the pglite adapter ---
      { stepId: "s6", kind: "mps-restart", factKey: "toPglite", mode: "kill", at: T0 + 24_000 },
      { stepId: "s7", kind: "mps-boot", factKey: "bootPglite", store: "pglite" },
      ...spineSteps("b"),
      { stepId: "s8", kind: "mps-digest", factKey: "pglite" },
      { stepId: "s9", kind: "npg-parity", factKey: "pgliteVsNetworked" },
      // --- Phase C: dump -> wipe (a FRESH cluster) -> restore over the network boundary ---
      { stepId: "s10", kind: "mps-restart", factKey: "beforeWipe", mode: "kill", at: T0 + 25_000 },
      { stepId: "s11", kind: "npg-server-stop", factKey: "teardown" },
      { stepId: "s12", kind: "npg-server-boot", factKey: "serverTwo" },
      { stepId: "s13", kind: "mps-boot", factKey: "bootFresh", store: "networked" },
      { stepId: "s14", kind: "mps-restart", factKey: "restore", mode: "restore", at: T0 + 26_000 },
      { stepId: "s15", kind: "npg-parity", factKey: "restored" },
      { stepId: "s16", kind: "mps-state", factKey: "requests", sessionKey: "operator", tenantId: "acme", family: "requests", now: T0 + 27_000 },
      { stepId: "s17", kind: "mps-state", factKey: "enrollments", sessionKey: "operator", tenantId: "acme", family: "enrollments", now: T0 + 27_100 },
      { stepId: "s18", kind: "mps-order-transition", factKey: "accept", sessionKey: "operator", tenantId: "acme", orderId: "ord-npg-par-001", command: { type: "accept", at: T0 + 28_000 }, now: T0 + 28_000 },
      { stepId: "s19", kind: "mps-digest", factKey: "final" },
      { stepId: "s20", kind: "mps-shutdown", factKey: "shutdown" },
    ],
    assertions: [
      { id: "npg-r1", description: "the networked phase booted (the REAL postgres server + the pg adapter)", fact: "mps.boot.bootNetworked.store", op: "eq", expected: "networked" },
      { id: "npg-r1b", description: "REFUSAL: the divergent natural-key content refused NATURAL_KEY_CONFLICT in the networked phase", fact: "mps.request.conflict.reason", op: "eq", expected: "NATURAL_KEY_CONFLICT" },
      { id: "npg-r1c", description: "REFUSAL: the same conflict refused identically in the pglite phase (the same spine, the same laws)", fact: "mps.request.conflict2.reason", op: "eq", expected: "NATURAL_KEY_CONFLICT" },
      { id: "npg-r2", description: "the networked spine reached the received order + the verified receipt + the enrolled asset", fact: "mps.enrollComplete.complete.twinLinked", op: "eq", expected: true },
      { id: "npg-r3", description: "the received order state before the dump (the full lifecycle in the backup set)", fact: "mps.orderT.receive2.status", op: "eq", expected: "received" },
      { id: "npg-r4", description: "THE DUMP over the network boundary: the single-file envelope produced", fact: "mps.backup.dump.ok", op: "eq", expected: true },
      { id: "npg-r5", description: "the pglite phase booted (the F370C in-process adapter, byte-unchanged)", fact: "mps.boot.bootPglite.store", op: "eq", expected: "pglite" },
      { id: "npg-r6", description: "the pglite re-seed drove the same spine (order received, receipt verified)", fact: "mps.verify.main2.state", op: "eq", expected: "verified" },
      { id: "npg-r7", description: "THE PORT CONTRACT: the SAME record set through BOTH adapters — the digest envelope BYTE-IDENTICAL", fact: "npg.parity.pgliteVsNetworked.digestsIdentical", op: "eq", expected: true },
      { id: "npg-r8", description: "the old server torn down and a FRESH cluster provisioned (the honest wipe — a brand-new PGDATA)", fact: "npg.serverBoot.serverTwo.ok", op: "eq", expected: true },
      { id: "npg-r9", description: "the fresh-cluster networked service booted (empty store, DDL applied)", fact: "mps.boot.bootFresh.store", op: "eq", expected: "networked" },
      { id: "npg-r10", description: "THE RESTORE over the network boundary: the --restore boot verified the envelope and served (fail-closed)", fact: "mps.restart.restore.verifyOk", op: "eq", expected: true },
      { id: "npg-r11", description: "THE ROUND-TRIP: the restored store's digest equals the networked baseline (byte-identical)", fact: "npg.parity.restored.digestsIdentical", op: "eq", expected: true },
      { id: "npg-r12", description: "the requests survived the round-trip onto the fresh cluster (ordered)", fact: "mps.state.requests.statuses", op: "deepEq", expected: ["req-npg-par-001:ordered"] },
      { id: "npg-r13", description: "the enrollments survived the round-trip (enrolled)", fact: "mps.state.enrollments.statuses", op: "deepEq", expected: ["SN-NPG-PAR-0001:enrolled"] },
      { id: "npg-r14", description: "the restored service SERVES WRITES over the network boundary (the order's final transition)", fact: "mps.orderT.accept.status", op: "eq", expected: "accepted" },
      { id: "npg-r15", description: "the final digest counts the spine records (one order, one enrollment)", fact: "mps.digest.final.countOrders", op: "eq", expected: 1 },
      { id: "npg-r16", description: "the final digest counts the decided receipt + the twin", fact: "mps.digest.final.countEnrollments", op: "eq", expected: 1 },
      { id: "npg-r17", description: "the final evidence set holds the snapshot + the provider-ack", fact: "mps.digest.final.countEvidence", op: "eq", expected: 2 },
    ],
  },
];
