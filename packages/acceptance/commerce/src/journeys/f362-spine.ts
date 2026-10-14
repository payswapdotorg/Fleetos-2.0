/**
 * @fleetos/acceptance-commerce — the F362 transaction-spine journey (Wave 17,
 * the TL-delegated E2E lane; packet docs/tech-lead/packets/f362.md §2).
 *
 * ONE deterministic journey through the REAL public APIs of ALL THREE
 * Wave-17 lanes — the exact chain the packet freezes:
 *
 *   real need (F361C request contract)
 *     → seeded supplier catalogue (verified suppliers, plainly-labelled
 *       manual import)
 *     → two offers (F361C offer schema, freshness law asserted)
 *     → explainable comparison (hard constraints vs preference weights)
 *     → Guardian approval (F361B approval contract, advisory-never-authorizes)
 *     → order placement + manual provider-ack seam (idempotent, dedup-refusing)
 *     → receipt evidence (F361A ReceiptEvidence)
 *     → asset enrollment (F361A duplicate guard; the authoritative record)
 *
 * CENSUS CITATION (the F354 lesson; grep proofs at base d714616 in
 * docs/evidence/F362/report.md §1): the journey id
 * `marketplace-transaction-spine` and the spn-* op family are NEW at this
 * base; the F361C chain (mreq-/moff-/mver-/mord-) is COMPOSED verbatim
 * through its census-certified drivers; the F361B surfaces
 * (evaluateMarketplaceOrderApproval / assertAdvisoryNeverAuthorizes /
 * InMemoryMarketplaceEvidenceStore) and the F361A surfaces
 * (ReceiptEnrollmentDirectory / AssetDirectory / applyTwinRevision) had
 * ZERO commerce-corpus coverage — the spn-* kinds drive them here for the
 * first time (the documented composition site, law A20).
 *
 * D14 form: >=5 substantive assertions per segment incl. >=1 refusal at
 * every gate — illegal transition (order-before-approval; the terminal
 * receipt re-decision), authorization denial (the over-ceiling limit
 * refusal; the actor-missing-human-approval refusal; the
 * advisory-never-authorizes law), expired offer (the post-lapse
 * comparison refuses NO_ELIGIBLE_OFFERS; the post-lapse sheet is empty
 * with both verdicts "expired" — no weight rescues a hard-constraint
 * failure), duplicate serial (the enrollment duplicate guard returns the
 * ORIGINAL with the registry untouched; the same-serial different-tag
 * attempt refuses serial-tag-conflict), foreign-tenant read (request,
 * order, receipt, enrollment, registry and evidence reads all see
 * NOTHING). Deterministic byte-identity on rerun. Fixture-labelled —
 * never "live" (the live gate stays BLOCKED on F369).
 *
 * Single-epoch (T0): no step consumes the run anchor, no assertion
 * carries an epoch table (D13); every timestamp is literal journey data
 * or a fixed ISO fixture string (the F361B corpus convention).
 */

import type { AcceptanceJourney, FactValue } from "../journey-contracts.js";

const eq = (id: string, fact: string, expected: FactValue, description: string) =>
  ({ id, description, fact, op: "eq" as const, expected });
const deq = (id: string, fact: string, expected: readonly string[], description: string) =>
  ({ id, description, fact, op: "deepEq" as const, expected });

/** The commerce corpus time anchor (the F330 census value, cited per F331C D12). */
const T0 = 1_774_000_000_000;
const DAY = 86_400_000;

/**
 * The deterministic transaction-spine journey: one tenant (acme) procures
 * five laptops through the REAL public APIs of all three Wave-17 lanes —
 * the need is submitted idempotently (natural-key law), two verified
 * suppliers enter matching through the plainly-labelled manual catalogue
 * seam, two fresh offers are compared (hard constraints vs preference
 * weights), the winning offer's frozen snapshot is retained as evidence
 * and approved by the Guardian (advisory never authorizes), the order is
 * placed and acknowledged through the manual provider-ack seam (idempotent,
 * dedup-refusing), the verified receipt evidence enrolls the asset into
 * the authoritative registry (the duplicate-serial guard; the twin link),
 * and both state machines close honestly. A refusal is asserted at EVERY
 * gate; the OTHER tenant reads NOTHING anywhere.
 */
export const marketplaceTransactionSpineJourney: AcceptanceJourney = {
  id: "marketplace-transaction-spine",
  persona: "procurement-lead",
  capability: "marketplace-transaction-spine",
  goal: "Run the frozen F362 §2 transaction spine end-to-end through the REAL public APIs of all three Wave-17 lanes — real need (F361C request contract, idempotent natural-key submit), seeded supplier catalogue (verified suppliers, plainly-labelled manual import, verified-only matching gate), two offers (F361C offer schema, THE FRESHNESS LAW asserted — expired offers never silently appear current), explainable comparison (hard constraints vs preference weights, per-offer rationale), Guardian approval (F361B approval contract composing the EXISTING evaluateCapability — advisory recommendations never authorize, over-ceiling and missing-human-approval refusals asserted), order placement + the manual provider-ack seam (idempotent same-event replay returning the ORIGINAL evidence, different-event ALREADY_ACKNOWLEDGED refusal, future-dated captures refused as untrusted), receipt evidence (F361A recorded→verified, terminal re-decision refused), and asset enrollment (the F361A duplicate-serial guard returning the ORIGINAL with the registry untouched, the same-serial different-tag serial-tag-conflict refusal, the authoritative record + twin link) — with a refusal asserted at every gate and the OTHER tenant reading NOTHING.",
  steps: [
    // ----- SEGMENT 1: the real need (F361C §3.1 request contract) -----
    { stepId: "s1", kind: "mreq-submit", factKey: "need", requestId: "req-spine-001", naturalKey: "acme:lt-5540:2026-q4:batch-1", sku: "LT-5540", quantity: 5, requiredBy: "2026-12-31", at: T0 + 1_000 },
    // The idempotent replay: content-identical, a different request id — the ORIGINAL returns.
    { stepId: "s2", kind: "mreq-submit", factKey: "replay", requestId: "req-spine-999", naturalKey: "acme:lt-5540:2026-q4:batch-1", sku: "LT-5540", quantity: 5, requiredBy: "2026-12-31", at: T0 + 1_500 },
    // REFUSAL: the same natural key with drifted content refuses NATURAL_KEY_CONFLICT.
    { stepId: "s3", kind: "mreq-submit", factKey: "conflict", requestId: "req-spine-002", naturalKey: "acme:lt-5540:2026-q4:batch-1", sku: "LT-5540", quantity: 6, requiredBy: "2026-12-31", at: T0 + 2_000 },
    { stepId: "s4", kind: "mreq-transition", factKey: "resolve", command: "resolve", at: T0 + 6_000 },
    { stepId: "s5", kind: "mreq-transition", factKey: "closeWindow", command: "close_offer_window", at: T0 + 6_500 },
    { stepId: "s6", kind: "mreq-transition", factKey: "comparing", command: "compare", at: T0 + 7_000 },

    // ----- SEGMENT 2: the seeded supplier catalogue (F361C §3.3) -----
    { stepId: "s7", kind: "mver-open", factKey: "alpha", supplierId: "sup-alpha" },
    { stepId: "s8", kind: "mver-open", factKey: "beta", supplierId: "sup-beta" },
    // sup-gamma stays PENDING — the verified-only gate must exclude it.
    { stepId: "s9", kind: "mver-open", factKey: "gamma", supplierId: "sup-gamma" },
    { stepId: "s10", kind: "mver-verify", factKey: "alpha", supplierId: "sup-alpha", evidenceId: "verify-sup-alpha-2026", evidenceTenantId: "acme", verifiedAt: T0 + 2_500, expiresAt: T0 + 90 * DAY },
    { stepId: "s11", kind: "mver-verify", factKey: "beta", supplierId: "sup-beta", evidenceId: "verify-sup-beta-2026", evidenceTenantId: "acme", verifiedAt: T0 + 2_600, expiresAt: T0 + 90 * DAY },
    // The verified-only gate: alpha+beta admitted, the PENDING gamma excluded (the refusal at this gate).
    { stepId: "s12", kind: "mver-gate", factKey: "spine", at: T0 + 3_000 },
    // The plainly-labelled manual catalogue import (the seeded catalogue).
    { stepId: "s13", kind: "mver-catalogue-import", factKey: "spine", operatorId: "act_operator-ama-01", exportId: "exp-2026-10-spine-01", exportCapturedAt: T0 + 2_800,
      entries: [
        { supplierId: "sup-alpha", sku: "LT-5540", unitCostMinor: 1_200_000, currency: "GHS", condition: "new", warrantyMonths: 24, deliveryEstimateDays: 10 },
        { supplierId: "sup-beta", sku: "LT-5540", unitCostMinor: 1_350_000, currency: "GHS", condition: "new", warrantyMonths: 12, deliveryEstimateDays: 5 },
      ] },

    // ----- SEGMENT 3: the two offers (F361C §3.2, THE FRESHNESS LAW) -----
    { stepId: "s14", kind: "moff-capture", factKey: "offA", offer: {
      offerId: "off-spine-a", supplierId: "sup-alpha", sku: "LT-5540", quantity: 5,
      unitCostMinor: 1_200_000, totalCostMinor: 6_000_000, currency: "GHS",
      taxMinor: 300_000, feesMinor: 0, deliveryEstimateDays: 10, condition: "new", warrantyMonths: 24,
      validFrom: T0 + 4_000, validUntil: T0 + 10 * DAY,
      sourceKind: "manual-catalogue-export", sourceReference: "exp-2026-10-spine-01:sup-alpha", capturedAt: T0 + 5_000,
    } },
    { stepId: "s15", kind: "moff-capture", factKey: "offB", offer: {
      offerId: "off-spine-b", supplierId: "sup-beta", sku: "LT-5540", quantity: 5,
      unitCostMinor: 1_350_000, totalCostMinor: 6_750_000, currency: "GHS",
      taxMinor: 337_500, feesMinor: 0, deliveryEstimateDays: 5, condition: "new", warrantyMonths: 12,
      validFrom: T0 + 4_500, validUntil: T0 + 10 * DAY,
      sourceKind: "manual-catalogue-export", sourceReference: "exp-2026-10-spine-01:sup-beta", capturedAt: T0 + 5_500,
    } },
    // THE FRESHNESS LAW while the window is open: both offers current, nothing excluded.
    { stepId: "s16", kind: "moff-sheet", factKey: "whileOpen", at: T0 + 7_500 },

    // ----- SEGMENT 4: the explainable comparison (hard vs preference) -----
    { stepId: "s17", kind: "moff-compare", factKey: "live", demandSku: "LT-5540", demandCurrency: "GHS", acceptableConditions: ["new"],
      verifications: [
        { supplierId: "sup-alpha", status: "verified", expiresAt: T0 + 90 * DAY },
        { supplierId: "sup-beta", status: "verified", expiresAt: T0 + 90 * DAY },
        { supplierId: "sup-gamma", status: "pending", expiresAt: null },
      ], at: T0 + 8_000 },
    // REFUSAL (expired offer): after the validity lapse the comparison refuses
    // NO_ELIGIBLE_OFFERS — both offers fail the freshness HARD constraint (no
    // preference weight can rescue it) and the sheet is EMPTY with both
    // verdicts "expired" (expired offers NEVER silently appear current).
    { stepId: "s18", kind: "moff-compare", factKey: "postLapse", demandSku: "LT-5540", demandCurrency: "GHS", acceptableConditions: ["new"],
      verifications: [
        { supplierId: "sup-alpha", status: "verified", expiresAt: T0 + 90 * DAY },
        { supplierId: "sup-beta", status: "verified", expiresAt: T0 + 90 * DAY },
        { supplierId: "sup-gamma", status: "pending", expiresAt: null },
      ], at: T0 + 10 * DAY + 1_000 },
    { stepId: "s19", kind: "moff-sheet", factKey: "postLapse", at: T0 + 10 * DAY + 1_000 },

    // The selection + approval request on the §3.1 machine.
    { stepId: "s20", kind: "mreq-transition", factKey: "select", command: "select", offerId: "off-spine-b", at: T0 + 9_000 },
    { stepId: "s21", kind: "mreq-transition", factKey: "requestApproval", command: "request_approval", at: T0 + 9_500 },
    // REFUSAL (illegal transition): order-before-approval never fires.
    { stepId: "s22", kind: "mreq-transition", factKey: "earlyOrder", command: "order", at: T0 + 9_600 },

    // ----- SEGMENT 5: the Guardian approval (F361B, advisory-never-authorizes) -----
    // The frozen offer snapshot retained FIRST (the evidence contract) — the
    // approval's offerSnapshotRef binds the retained record's evidence id.
    { stepId: "s23", kind: "spn-evidence-retain", factKey: "snapshot", evidenceKind: "offer-snapshot",
      providerEventId: "prov-snap-off-spine-b", subjectRef: "off-spine-b",
      sourceSystem: "manual-catalogue-import", sourceReference: "exp-2026-10-spine-01:sup-beta", retrievedVia: "manual",
      capturedAtIso: "2026-10-14T09:30:00.000Z", recordedAtIso: "2026-10-14T09:35:00.000Z",
      artifactId: "art-spine-snapshot-b", artifactDescription: "frozen offer snapshot for off-spine-b",
      artifactJson: "{\"offerId\":\"off-spine-b\",\"supplierId\":\"sup-beta\",\"sku\":\"LT-5540\",\"quantity\":5,\"unitCostMinor\":1350000,\"totalCostMinor\":6750000,\"currency\":\"GHS\",\"validFrom\":1774000004500,\"validUntil\":1774864000000}" },
    // The REAL chain approval: within limits, over the EXISTING Guardian.
    { stepId: "s24", kind: "spn-guardian-approval", factKey: "inLimits", mode: "in-limits",
      orderId: "ord-spine-001", category: "laptops", transactionKind: "purchase", units: 5,
      amountTotal: 6_750_000, currency: "GHS", supplierId: "sup-beta", verificationRef: "verify-sup-beta-2026",
      offerSnapshotFromEvidence: true, actorId: "act_proc-ama-01", actorAuthority: ["tenant.operator", "human.approval"], actorAutonomous: false },
    // REFUSAL (authorization denial): over the per-kind ceiling.
    { stepId: "s25", kind: "spn-guardian-approval", factKey: "overLimit", mode: "over-limit",
      orderId: "ord-spine-001", category: "laptops", transactionKind: "purchase", units: 5,
      amountTotal: 9_000_000, currency: "GHS", supplierId: "sup-beta", verificationRef: "verify-sup-beta-2026",
      offerSnapshotFromEvidence: true, actorId: "act_proc-ama-01", actorAuthority: ["tenant.operator", "human.approval"], actorAutonomous: false },
    // REFUSAL (authorization denial): the actor lacks human.approval.
    { stepId: "s26", kind: "spn-guardian-approval", factKey: "noHumanApproval", mode: "missing-human-approval",
      orderId: "ord-spine-001", category: "laptops", transactionKind: "purchase", units: 5,
      amountTotal: 6_750_000, currency: "GHS", supplierId: "sup-beta", verificationRef: "verify-sup-beta-2026",
      offerSnapshotFromEvidence: true, actorId: "act_proc-ama-01", actorAuthority: ["tenant.operator"], actorAutonomous: false },
    // REFUSAL-class (advisory-never-authorizes): the advisory changes NOTHING.
    { stepId: "s27", kind: "spn-guardian-approval", factKey: "advisory", mode: "advisory",
      orderId: "ord-spine-001", category: "laptops", transactionKind: "purchase", units: 5,
      amountTotal: 6_750_000, currency: "GHS", supplierId: "sup-beta", verificationRef: "verify-sup-beta-2026",
      offerSnapshotFromEvidence: true, actorId: "act_proc-ama-01", actorAuthority: ["tenant.operator", "human.approval"], actorAutonomous: false,
      advisorySource: "predictive.model/supplier-score", advisoryRecommendation: "approve", advisoryRationale: "advisory suggests the order is routine" },

    // The approved request orders (the §3.1 machine advances honestly).
    { stepId: "s28", kind: "mreq-transition", factKey: "approve", command: "approve", at: T0 + 12_000 },
    { stepId: "s29", kind: "mreq-transition", factKey: "order", command: "order", at: T0 + 13_000 },

    // ----- SEGMENT 6: order placement + the manual provider-ack seam -----
    { stepId: "s30", kind: "mord-draft", factKey: "draft", orderId: "ord-spine-001", requestId: "req-spine-001", offerId: "off-spine-b", supplierId: "sup-beta", sku: "LT-5540", quantity: 5, unitCostMinor: 1_350_000, totalCostMinor: 6_750_000, currency: "GHS" },
    { stepId: "s31", kind: "mord-place", factKey: "place", at: T0 + 14_000 },
    { stepId: "s32", kind: "mord-board", factKey: "placed" },
    // The provider-ack evidence retained through the evidence contract FIRST
    // (plainly-labelled manual portal export), then the order-side ack cites
    // the SAME reference — the frozen TYPE seam binding, asserted below.
    { stepId: "s33", kind: "spn-evidence-retain", factKey: "providerAck", evidenceKind: "provider-ack",
      providerEventId: "prov-ack-spine-001", subjectRef: "ord-spine-001",
      sourceSystem: "manual-portal-export", sourceReference: "inv-spine-001", retrievedVia: "export",
      capturedAtIso: "2026-10-14T10:20:00.000Z", recordedAtIso: "2026-10-14T10:25:00.000Z",
      artifactId: "art-spine-ack-001", artifactDescription: "provider acknowledgement invoice export for ord-spine-001",
      artifactJson: "{\"orderId\":\"ord-spine-001\",\"invoice\":\"inv-spine-001\",\"providerEventId\":\"prov-ack-spine-001\"}" },
    { stepId: "s34", kind: "mord-ack", factKey: "ack", providerEventId: "prov-ack-spine-001", evidenceId: "inv-spine-001", evidenceTenantId: "acme", channel: "manual-invoice-reference", acknowledgedAt: T0 + 16_000 },
    // The IDEMPOTENT replay: the same provider event — the ORIGINAL evidence wins.
    { stepId: "s35", kind: "mord-ack", factKey: "replay", providerEventId: "prov-ack-spine-001", evidenceId: "inv-OTHER", evidenceTenantId: "acme", channel: "manual-portal-export", acknowledgedAt: T0 + 17_000 },
    // REFUSAL (dedup-refusing): a DIFFERENT provider event on the acknowledged order.
    { stepId: "s36", kind: "mord-ack", factKey: "differentEvent", providerEventId: "prov-ack-spine-002", evidenceId: "inv-spine-001-b", evidenceTenantId: "acme", channel: "manual-email-confirmation", acknowledgedAt: T0 + 18_000 },
    // The store-side dedup laws: identical replay + divergent re-presentation.
    { stepId: "s37", kind: "spn-evidence-retain", factKey: "ackReplay", evidenceKind: "provider-ack",
      providerEventId: "prov-ack-spine-001", subjectRef: "ord-spine-001",
      sourceSystem: "manual-portal-export", sourceReference: "inv-spine-001", retrievedVia: "export",
      capturedAtIso: "2026-10-14T10:20:00.000Z", recordedAtIso: "2026-10-14T10:30:00.000Z",
      artifactId: "art-spine-ack-001", artifactDescription: "provider acknowledgement invoice export for ord-spine-001",
      artifactJson: "{\"orderId\":\"ord-spine-001\",\"invoice\":\"inv-spine-001\",\"providerEventId\":\"prov-ack-spine-001\"}" },
    { stepId: "s38", kind: "spn-evidence-retain", factKey: "ackDivergent", evidenceKind: "provider-ack",
      providerEventId: "prov-ack-spine-001", subjectRef: "ord-spine-001",
      sourceSystem: "manual-portal-export", sourceReference: "inv-spine-001", retrievedVia: "export",
      capturedAtIso: "2026-10-14T10:20:00.000Z", recordedAtIso: "2026-10-14T10:35:00.000Z",
      artifactId: "art-spine-ack-001", artifactDescription: "a forged replacement payload",
      artifactJson: "{\"orderId\":\"ord-spine-001\",\"invoice\":\"inv-FORGED\",\"providerEventId\":\"prov-ack-spine-001\"}" },
    // REFUSAL (untrusted external events): a future-dated capture is refused.
    { stepId: "s39", kind: "spn-evidence-retain", factKey: "futureDated", evidenceKind: "provider-ack",
      providerEventId: "prov-ack-spine-future", subjectRef: "ord-spine-001",
      sourceSystem: "manual-portal-export", sourceReference: "inv-spine-future", retrievedVia: "export",
      capturedAtIso: "2026-10-14T11:00:00.000Z", recordedAtIso: "2026-10-14T10:45:00.000Z",
      artifactId: "art-spine-ack-future", artifactDescription: "a future-dated capture attempt",
      artifactJson: "{\"orderId\":\"ord-spine-001\",\"invoice\":\"inv-spine-future\",\"providerEventId\":\"prov-ack-spine-future\"}" },
    // The evidence reads: own finds it; the foreign tenant sees NOTHING.
    { stepId: "s40", kind: "spn-evidence-read", factKey: "own", evidenceKind: "provider-ack" },
    { stepId: "s41", kind: "spn-evidence-read", factKey: "foreign", evidenceKind: "provider-ack", callerTenant: "foreign" },

    // The §3.4 fulfilment chain.
    { stepId: "s42", kind: "mord-transition", factKey: "ship", command: "ship", at: T0 + 19_000 },
    { stepId: "s43", kind: "mord-transition", factKey: "receive", command: "receive", at: T0 + 19_500 },

    // ----- SEGMENT 7: the receipt evidence (F361A) -----
    { stepId: "s44", kind: "spn-receipt-record", factKey: "main", evidenceRef: "rcpt-spine-001", serial: "SN-LT5540-0001", assetTag: "TAG-LT5540-0001", conditionOnArrival: "new", supplierOrderRef: "ord-spine-001", siteId: "site-accra-east", warrantyRef: "wrty-2026-spine-0001", capturedAt: T0 + 20_000, recordedAt: T0 + 21_000 },
    // The idempotent re-record: identical payload under the same ref.
    { stepId: "s45", kind: "spn-receipt-record", factKey: "replay", evidenceRef: "rcpt-spine-001", serial: "SN-LT5540-0001", assetTag: "TAG-LT5540-0001", conditionOnArrival: "new", supplierOrderRef: "ord-spine-001", siteId: "site-accra-east", warrantyRef: "wrty-2026-spine-0001", capturedAt: T0 + 20_000, recordedAt: T0 + 21_000 },
    { stepId: "s46", kind: "spn-receipt-verify", factKey: "main", evidenceRef: "rcpt-spine-001", expectSupplierOrderRef: "ord-spine-001", expectSerial: "SN-LT5540-0001", expectAssetTag: "TAG-LT5540-0001", expectCondition: "new", decidedAt: T0 + 22_000 },
    // REFUSAL (illegal transition): a decided receipt is NEVER re-decided (append-only).
    { stepId: "s47", kind: "spn-receipt-verify", factKey: "redecide", evidenceRef: "rcpt-spine-001", expectSupplierOrderRef: "ord-spine-001", expectSerial: "SN-LT5540-0001", expectAssetTag: "TAG-LT5540-0001", expectCondition: "new", decidedAt: T0 + 22_500 },
    // The foreign-tenant receipt read sees NOTHING.
    { stepId: "s48", kind: "spn-receipt-read", factKey: "foreign", evidenceRef: "rcpt-spine-001", callerTenant: "foreign" },

    // ----- SEGMENT 8: the asset enrollment (F361A duplicate guard) -----
    { stepId: "s49", kind: "spn-enrollment-open", factKey: "open", evidenceRef: "rcpt-spine-001", assetId: "ast_spine-0001", displayName: "LT-5540 laptop (ord-spine-001)", assetKind: "other", deviceId: "dev-spine-0001", at: T0 + 23_000, actor: "act_operator-ama-01" },
    { stepId: "s50", kind: "spn-enrollment-complete", factKey: "complete", serial: "SN-LT5540-0001", at: T0 + 24_000, actor: "act_operator-ama-01" },
    // REFUSAL-class (duplicate serial): a second attempt for the SAME serial
    // (a different asset id!) returns the ORIGINAL — the registry stays at 1.
    { stepId: "s51", kind: "spn-enrollment-open", factKey: "duplicate", evidenceRef: "rcpt-spine-001", assetId: "ast_spine-DUPLICATE", displayName: "LT-5540 laptop (duplicate attempt)", assetKind: "other", at: T0 + 25_000, actor: "act_operator-ama-01" },
    // The same-serial different-tag conflict: a second verified receipt for
    // the same serial with a DIFFERENT tag must refuse serial-tag-conflict.
    { stepId: "s52", kind: "spn-receipt-record", factKey: "conflict", evidenceRef: "rcpt-spine-002", serial: "SN-LT5540-0001", assetTag: "TAG-CONFLICT-0009", conditionOnArrival: "new", supplierOrderRef: "ord-spine-001", siteId: "site-accra-east", warrantyRef: "wrty-2026-spine-0001", capturedAt: T0 + 25_500, recordedAt: T0 + 26_000 },
    { stepId: "s53", kind: "spn-receipt-verify", factKey: "conflict", evidenceRef: "rcpt-spine-002", expectSupplierOrderRef: "ord-spine-001", expectSerial: "SN-LT5540-0001", expectAssetTag: "TAG-CONFLICT-0009", expectCondition: "new", decidedAt: T0 + 27_000 },
    // REFUSAL (duplicate serial, the hard form): serial-tag-conflict.
    { stepId: "s54", kind: "spn-enrollment-open", factKey: "conflict", evidenceRef: "rcpt-spine-002", assetId: "ast_spine-0003", displayName: "LT-5540 laptop (conflict attempt)", assetKind: "other", at: T0 + 27_500, actor: "act_operator-ama-01" },
    // The authoritative record + the fail-closed reads.
    { stepId: "s55", kind: "spn-registry-read", factKey: "own", assetId: "ast_spine-0001", serial: "SN-LT5540-0001" },
    { stepId: "s56", kind: "spn-registry-read", factKey: "foreign", assetId: "ast_spine-0001", serial: "SN-LT5540-0001", callerTenant: "foreign" },
    { stepId: "s57", kind: "spn-enrollment-read", factKey: "own", serial: "SN-LT5540-0001" },
    { stepId: "s58", kind: "spn-enrollment-read", factKey: "foreign", serial: "SN-LT5540-0001", callerTenant: "foreign" },

    // ----- The honest closure of both state machines -----
    { stepId: "s59", kind: "mord-transition", factKey: "accept", command: "accept", at: T0 + 28_000 },
    { stepId: "s60", kind: "mord-board", factKey: "final" },
    { stepId: "s61", kind: "mord-read", factKey: "own" },
    // Fail-closed: the OTHER tenant's scope sees nothing.
    { stepId: "s62", kind: "mord-read", factKey: "foreign", callerTenant: "foreign" },
    { stepId: "s63", kind: "mreq-transition", factKey: "fulfill", command: "fulfill", at: T0 + 29_000 },
    { stepId: "s64", kind: "mreq-board", factKey: "final" },
    { stepId: "s65", kind: "mreq-read", factKey: "own", requestId: "req-spine-001" },
    // Fail-closed: the OTHER tenant's scope sees nothing.
    { stepId: "s66", kind: "mreq-read", factKey: "foreign", requestId: "req-spine-001", callerTenant: "foreign" },
  ],
  assertions: [
    // ----- SEGMENT 1: the real need -----
    eq("sp1", "mreq.submit.need.ok", true, "the real need submits through the REAL §3.1 contract"),
    eq("sp2", "mreq.submit.need.status", "submitted", "the request lands in submitted"),
    eq("sp3", "mreq.submit.replay.duplicate", true, "the natural-key replay is IDEMPOTENT (duplicate=true)"),
    eq("sp4", "mreq.submit.replay.requestId", "req-spine-001", "the replay returns the ORIGINAL request — even though it named req-spine-999"),
    eq("sp5", "mreq.submit.replay.population", 1, "the replay never grows the population (one request)"),
    eq("sp6", "mreq.submit.conflict.reasonCode", "NATURAL_KEY_CONFLICT", "REFUSAL: drifted content under the same natural key never creates a second request"),
    eq("sp7", "mreq.transition.earlyOrder.reasonCode", "ILLEGAL_TRANSITION", "REFUSAL: order-before-approval is an illegal transition — the approval gate holds"),
    eq("sp8", "mreq.transition.approve.status", "approved", "the Guardian-approved request reaches approved"),
    eq("sp9", "mreq.transition.order.status", "ordered", "the approved request orders"),
    eq("sp10", "mreq.transition.fulfill.status", "fulfilled", "the §3.1 machine closes honestly at fulfilled"),
    eq("sp11", "mreq.board.final.fulfilled", 1, "the final board counts the fulfilled request"),
    eq("sp12", "mreq.read.foreign.found", false, "REFUSAL-class fact: the OTHER tenant reads NOTHING (fail-closed)"),

    // ----- SEGMENT 2: the seeded supplier catalogue -----
    eq("sp13", "mver.open.gamma.status", "pending", "sup-gamma opens pending and is never verified"),
    eq("sp14", "mver.verify.alpha.status", "verified", "sup-alpha verifies with same-tenant evidence"),
    eq("sp15", "mver.verify.beta.status", "verified", "sup-beta verifies with same-tenant evidence"),
    eq("sp16", "mver.gate.spine.admittedCount", 2, "the verified-only gate admits exactly the two verified suppliers"),
    deq("sp17", "mver.gate.spine.admitted", ["sup-alpha", "sup-beta"], "the admitted set is exactly [sup-alpha, sup-beta]"),
    deq("sp18", "mver.gate.spine.excluded", ["sup-gamma:SUPPLIER_PENDING"], "REFUSAL: the pending supplier is EXCLUDED from matching (verified-only enters)"),
    eq("sp19", "mver.catalogue.spine.ok", true, "the seeded catalogue imports through the plainly-labelled manual seam"),
    eq("sp20", "mver.catalogue.spine.entryCount", 2, "both entries import (never a partial import)"),
    eq("sp21", "mver.catalogue.spine.label", "manual-operator-catalogue-import (NOT a live supplier API; source and freshness tracked per entry)", "the label travels verbatim — never a live-API claim"),

    // ----- SEGMENT 3: the two offers + THE FRESHNESS LAW -----
    eq("sp22", "moff.capture.offA.ok", true, "the first offer captures through the REAL §3.2 schema"),
    eq("sp23", "moff.capture.offA.sourceKind", "manual-catalogue-export", "the offer's source is MANUAL-only (a live-API kind is unrepresentable)"),
    eq("sp24", "moff.capture.offA.totalCostMinor", 6_000_000, "the offer carries the exact integer total"),
    eq("sp25", "moff.capture.offB.ok", true, "the second offer captures through the REAL §3.2 schema"),
    eq("sp26", "moff.sheet.whileOpen.freshCount", 2, "THE FRESHNESS LAW: both offers are current while the window is open"),
    deq("sp27", "moff.sheet.whileOpen.freshOfferIds", ["off-spine-a", "off-spine-b"], "the current sheet lists exactly the two offers"),
    deq("sp28", "moff.sheet.whileOpen.excluded", [], "nothing is excluded while the window is open"),
    eq("sp29", "moff.sheet.postLapse.freshCount", 0, "REFUSAL (expired offer): after the lapse the sheet is EMPTY — expired offers NEVER silently appear current"),
    deq("sp30", "moff.sheet.postLapse.excluded", ["off-spine-a:expired", "off-spine-b:expired"], "both expired offers are excluded with their verdicts reported"),

    // ----- SEGMENT 4: the explainable comparison -----
    eq("sp31", "moff.compare.live.ok", true, "the live comparison runs over the EXISTING kernels"),
    eq("sp32", "moff.compare.live.eligibleCount", 2, "both offers pass every HARD constraint"),
    eq("sp33", "moff.compare.live.ineligibleCount", 0, "nothing is ineligible in the live comparison"),
    deq("sp34", "moff.compare.live.rationaleOrder", ["off-spine-b:eligible", "off-spine-a:eligible"], "every offer carries its per-offer explainable rationale (rank order)"),
    deq("sp35", "moff.compare.live.hardFailures", [], "no hard-constraint failure in the live comparison"),
    deq("sp36", "moff.compare.live.rankedOrder", ["off-spine-b", "off-spine-a"], "the preference weights rank the eligible set (rank 1 first)"),
    deq("sp37", "moff.compare.live.ranks", ["off-spine-b:1", "off-spine-a:2"], "the ranks are recorded per offer"),
    eq("sp38", "moff.compare.postLapse.reasonCode", "NO_ELIGIBLE_OFFERS", "REFUSAL (expired offer): after the lapse the comparison refuses — no weight rescues a failed hard constraint"),
    eq("sp39", "moff.compare.postLapse.rationaleCount", 2, "the refusal carries BOTH per-offer hard-constraint reports"),
    eq("sp40", "mreq.transition.select.selectedOfferId", "off-spine-b", "the selection names the winning offer (the comparison's rank 1)"),

    // ----- SEGMENT 5: the Guardian approval (advisory-never-authorizes) -----
    eq("sp41", "spn.evidence.snapshot.ok", true, "the frozen offer snapshot retains through the REAL evidence contract"),
    eq("sp42", "spn.evidence.snapshot.kind", "marketplace.offer-snapshot", "the retained record is the offer-snapshot kind"),
    eq("sp43", "spn.evidence.snapshot.subjectRef", "off-spine-b", "the snapshot belongs to the selected offer"),
    eq("sp44", "spn.approval.inLimits.decision", "approve", "the REAL chain order is approved within limits"),
    eq("sp45", "spn.approval.inLimits.reason", "approve.within_limits", "the approval reason is approve.within_limits"),
    eq("sp46", "spn.approval.inLimits.authoritySource", "guardian.evaluateCapability", "the ONLY authority is the EXISTING Guardian"),
    eq("sp47", "spn.approval.inLimits.guardianVerdict", "REQUIRE_APPROVAL", "the composed Guardian verdict flows through verbatim"),
    eq("sp48", "spn.approval.inLimits.limitCheckCount", 8, "ALL eight limit checks are evaluated"),
    eq("sp49", "spn.approval.inLimits.allLimitsPassed", true, "every limit check passes for the chain order"),
    eq("sp50", "spn.approval.inLimits.digestStable", true, "the approval is deterministic (re-evaluation is byte-identical)"),
    eq("sp51", "spn.approval.inLimits.offerSnapshotRef", "mpe-63956eaaabc7", "the approval's offerSnapshotRef IS the retained snapshot's evidence id (the composition binding)"),
    eq("sp52", "spn.approval.inLimits.verificationRef", "verify-sup-beta-2026", "the approval's verificationRef IS the §3.3 verification evidence id (the cross-lane binding)"),
    eq("sp53", "spn.approval.overLimit.decision", "refuse", "REFUSAL (authorization denial): the over-ceiling order is refused"),
    eq("sp54", "spn.approval.overLimit.reason", "refuse.amount_over_limit", "the refusal reason is the amount-over-limit law"),
    eq("sp55", "spn.approval.overLimit.amountCheckPassed", false, "the amount check fails machine-reported"),
    eq("sp56", "spn.approval.overLimit.amountObserved", "9000000", "the observed amount is reported verbatim"),
    eq("sp57", "spn.approval.overLimit.amountLimit", "8000000", "the ceiling is reported verbatim"),
    eq("sp58", "spn.approval.noHumanApproval.decision", "refuse", "REFUSAL (authorization denial): an actor lacking human.approval never authorizes"),
    eq("sp59", "spn.approval.noHumanApproval.reason", "refuse.actor_missing_human_approval", "the refusal reason is the missing-human-approval law"),
    eq("sp60", "spn.approval.advisory.lawHolds", true, "REFUSAL-class fact: the advisory law holds — advisory recommendations NEVER authorize"),
    eq("sp61", "spn.approval.advisory.withDecision", "approve", "the approve-flavored advisory changes nothing (still approve)"),
    eq("sp62", "spn.approval.advisory.digestIdentical", true, "the digest is byte-identical with and without the advisory"),
    eq("sp63", "spn.approval.advisory.overLimitWithAdvisoryDecision", "refuse", "the advisory CANNOT rescue the over-limit refusal"),
    eq("sp64", "spn.approval.advisory.overLimitWithAdvisoryReason", "refuse.amount_over_limit", "the over-limit refusal reason is unchanged with the advisory attached"),

    // ----- SEGMENT 6: order placement + the manual provider-ack seam -----
    eq("sp65", "mord.draft.draft.ok", true, "the order drafts from the approved request + selected offer"),
    eq("sp66", "mord.draft.draft.totalCostMinor", 6_750_000, "the exact integer total carries verbatim (the selected offer's total)"),
    eq("sp67", "mord.place.place.status", "placed", "the order places into provider-ack pending"),
    deq("sp68", "mord.board.placed.ackPendingOrderIds", ["ord-spine-001"], "the board lists the order in the ack-pending set"),
    eq("sp69", "spn.evidence.providerAck.ok", true, "the provider-ack evidence retains through the REAL evidence contract"),
    eq("sp70", "spn.evidence.providerAck.sourceReference", "inv-spine-001", "the retained record cites the invoice reference"),
    eq("sp71", "mord.ack.ack.status", "acknowledged", "the order-side ack acknowledges through the MANUAL channel"),
    eq("sp72", "mord.ack.ack.evidenceId", "inv-spine-001", "the order-side ack records the SAME reference as the retained evidence (the frozen TYPE seam binding)"),
    eq("sp73", "mord.ack.ack.channel", "manual-invoice-reference", "the ack channel is MANUAL-only — never a live-API claim"),
    eq("sp74", "mord.ack.replay.duplicate", true, "the same provider event replayed is IDEMPOTENT (duplicate=true)"),
    eq("sp75", "mord.ack.replay.evidenceId", "inv-spine-001", "the replay returns the ORIGINAL evidence — even though its input named inv-OTHER"),
    eq("sp76", "mord.ack.replay.acknowledgedAt", T0 + 16_000, "the replay leaves the ORIGINAL acknowledgement timestamp — never a second conclusion"),
    eq("sp77", "mord.ack.differentEvent.reasonCode", "ALREADY_ACKNOWLEDGED", "REFUSAL: a DIFFERENT provider event on the acknowledged order is refused (dedup-refusing)"),
    eq("sp78", "spn.evidence.ackReplay.duplicate", true, "the store-side replay is idempotent (the ORIGINAL record returns)"),
    eq("sp79", "spn.evidence.ackReplay.storeSize", 2, "the store never grows on the replay (snapshot + ack only)"),
    eq("sp80", "spn.evidence.ackDivergent.divergent", true, "the divergent re-presentation is flagged (a forged payload)"),
    eq("sp81", "spn.evidence.ackDivergent.evidenceId", "mpe-7fc36cbf2897", "the ORIGINAL record still wins verbatim — never a second conclusion"),
    eq("sp82", "spn.evidence.ackDivergent.storeSize", 2, "the store never grows on the divergent re-presentation"),
    eq("sp83", "spn.evidence.futureDated.reasonCode", "refused.captured_at_in_future", "REFUSAL: a future-dated capture is refused as untrusted (mission §6 external-events law)"),
    eq("sp84", "spn.evidenceRead.own.found", true, "the own-tenant evidence read finds the retained ack"),
    eq("sp85", "spn.evidenceRead.foreign.found", false, "REFUSAL-class fact: the OTHER tenant reads NOTHING (fail-closed)"),
    eq("sp86", "mord.transition.ship.status", "shipped", "the acknowledged order ships"),
    eq("sp87", "mord.transition.receive.status", "received", "the shipped order is received"),

    // ----- SEGMENT 7: the receipt evidence -----
    eq("sp88", "spn.receipt.main.ok", true, "the receipt records through the REAL F361A contract"),
    eq("sp89", "spn.receipt.main.state", "recorded", "the receipt lands in recorded"),
    eq("sp90", "spn.receipt.main.supplierOrderRef", "ord-spine-001", "the receipt names the supplier order (the §3.4 seam)"),
    eq("sp91", "spn.receipt.replay.duplicate", true, "the identical re-record is idempotent (the ORIGINAL returns)"),
    eq("sp92", "spn.verify.main.state", "verified", "the receipt verifies against the order-line expectation"),
    eq("sp93", "spn.verify.redecide.reasonCode", "illegal-transition", "REFUSAL: a decided receipt is NEVER re-decided (append-only)"),
    eq("sp94", "spn.receiptRead.foreign.found", false, "REFUSAL-class fact: the OTHER tenant reads NOTHING (no existence leak)"),

    // ----- SEGMENT 8: the asset enrollment (the authoritative record) -----
    eq("sp95", "spn.enrollOpen.open.ok", true, "the enrollment opens through the REAL F361A directory"),
    eq("sp96", "spn.enrollOpen.open.state", "candidate", "the enrollment lands in candidate"),
    eq("sp97", "spn.enrollOpen.open.auditPresent", true, "the REAL AssetDirectory.admitAsset ran (the audit trail is present)"),
    eq("sp98", "spn.enrollOpen.open.custodySiteId", "site-accra-east", "the enrollment links the custody site"),
    eq("sp99", "spn.enrollOpen.open.warrantyRef", "wrty-2026-spine-0001", "the enrollment links the warranty reference"),
    eq("sp100", "spn.enrollComplete.complete.state", "enrolled", "the enrollment completes to enrolled"),
    eq("sp101", "spn.enrollComplete.complete.twinLinked", true, "the REAL applyTwinRevision linked the twin (serial/tag + custody + warranty)"),
    eq("sp102", "spn.registry.own.count", 1, "the authoritative registry holds EXACTLY one asset"),
    eq("sp103", "spn.registry.own.lifecycle", "active", "the authoritative record is active (admitted → active through the REAL transitionAsset)"),
    deq("sp104", "spn.registry.own.twinLink", ["serial:SN-LT5540-0001", "assetTag:TAG-LT5540-0001", "custodySiteId:site-accra-east", "warrantyRef:wrty-2026-spine-0001", "receiptEvidenceRef:rcpt-spine-001"], "the twin link carries serial/tag + custody + warranty + the receipt evidence ref"),
    eq("sp105", "spn.enrollOpen.duplicate.duplicate", true, "REFUSAL-class fact (duplicate serial): the second attempt for the same serial returns the ORIGINAL"),
    eq("sp106", "spn.enrollOpen.duplicate.enrollmentId", "enr_acme_SN-LT5540-0001", "the ORIGINAL enrollment id returns (never a second enrollment)"),
    eq("sp107", "spn.enrollOpen.conflict.reasonCode", "serial-tag-conflict", "REFUSAL: the same serial with a different tag refuses serial-tag-conflict"),
    eq("sp108", "spn.registry.foreign.count", 0, "REFUSAL-class fact: the OTHER tenant's registry read sees NOTHING"),
    eq("sp109", "spn.enrollRead.foreign.found", false, "REFUSAL-class fact: the OTHER tenant's enrollment read sees NOTHING"),
    eq("sp110", "spn.registry.own.twinLastSeq", 1, "the twin's revision sequence is monotonic from the enrollment link"),

    // ----- The honest closure -----
    eq("sp111", "mord.transition.accept.status", "accepted", "the order accepts (terminal)"),
    eq("sp112", "mord.board.final.accepted", 1, "the final board counts the accepted order"),
    deq("sp113", "mord.board.final.ackPendingOrderIds", [], "the final board has an empty ack-pending set"),
    eq("sp114", "mord.read.foreign.found", false, "REFUSAL-class fact: the OTHER tenant reads NOTHING (fail-closed)"),
    eq("sp115", "mord.read.own.acknowledged", true, "the own-tenant read back shows the acknowledgement persisted"),
    deq("sp116", "spn.log", [
      "evidence:offer-snapshot:prov-snap-off-spine-b:retained:mpe-63956eaaabc7",
      "approval:in-limits:approve:approve.within_limits:mpe-63956eaaabc7",
      "approval:over-limit:refuse:refuse.amount_over_limit",
      "approval:missing-human-approval:refuse:refuse.actor_missing_human_approval",
      "approval:advisory:law-holds:approve",
      "approval:advisory-over-limit:refuse:refuse.amount_over_limit",
      "evidence:provider-ack:prov-ack-spine-001:retained:mpe-7fc36cbf2897",
      "evidence:provider-ack:prov-ack-spine-001:duplicate:mpe-7fc36cbf2897",
      "evidence:provider-ack:prov-ack-spine-001:duplicate-divergent:mpe-7fc36cbf2897",
      "evidence:provider-ack:prov-ack-spine-future:refused:refused.captured_at_in_future",
      "evidence-read:own:provider-ack:mpe-7fc36cbf2897",
      "evidence-read:foreign:provider-ack:null",
      "receipt:rcpt-spine-001:recorded:recorded:SN-LT5540-0001",
      "receipt:rcpt-spine-001:duplicate:recorded:SN-LT5540-0001",
      "verify:rcpt-spine-001:verified:-",
      "verify:rcpt-spine-001:refused:illegal-transition",
      "receipt-read:foreign:rcpt-spine-001:null",
      "enroll-open:rcpt-spine-001:candidate:enr_acme_SN-LT5540-0001:ast_spine-0001",
      "enroll-complete:SN-LT5540-0001:enrolled:twin=linked",
      "enroll-open:rcpt-spine-001:duplicate:enr_acme_SN-LT5540-0001:ast_spine-0001",
      "receipt:rcpt-spine-002:recorded:recorded:SN-LT5540-0001",
      "verify:rcpt-spine-002:verified:-",
      "enroll-open:rcpt-spine-002:refused:serial-tag-conflict",
      "registry:own:1:active",
      "registry:foreign:0:null",
      "enroll-read:own:SN-LT5540-0001:enrolled",
      "enroll-read:foreign:SN-LT5540-0001:null",
    ], "the spine log carries every retain, approval verdict, refusal, receipt, enrollment and registry read in order"),
  ],
};

export const F362_SPINE_JOURNEYS: readonly AcceptanceJourney[] = [
  marketplaceTransactionSpineJourney,
];
