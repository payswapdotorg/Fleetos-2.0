/**
 * @fleetos/acceptance-field — F361A journeys: the marketplace
 * receipt→asset enrollment discipline (Wave 17 lane A — the F360 freeze
 * §3.5 state machines, per the f361a packet).
 *
 * CENSUS CITATION (F361A report §1, machine-measured at base `cefd588`;
 * zero grep matches across the field/security/commerce corpora — the
 * F354 lesson: the ids name THIS lane's angle):
 *   - journey id `marketplace-receipt-enrollment` / `marketplace-receipt-
 *     discrepancy` — zero matches, all corpora (new);
 *   - op prefix `mre.*` — zero matches, all corpora (new);
 *   - recordReceiptEvidence — packages/assets/src/receipt-evidence.ts:99
 *   - verifyReceiptEvidence — packages/assets/src/receipt-evidence.ts:179
 *   - ReceiptEnrollmentDirectory.recordReceipt/verifyReceipt —
 *     packages/assets/src/receipt-enrollment.ts:170/186
 *   - ReceiptEnrollmentDirectory.openEnrollment/completeEnrollment —
 *     packages/assets/src/receipt-enrollment.ts:214/269
 *   - findEnrollment/getReceipt (tenant fail-closed reads) —
 *     packages/assets/src/receipt-enrollment.ts:321/201
 * (which themselves consume the EXISTING registry public APIs —
 * AssetDirectory.admitAsset kernel-directory.ts:101, transitionAsset
 * :140, applyTwinRevision assets.ts:169 — never a second asset truth).
 *
 * The REAL capability: a marketplace delivery enrolls into the
 * authoritative asset registry ONLY through a VERIFIED receipt — the
 * frozen fields link serial/tag + custody + warranty, the duplicate
 * guard is idempotent keyed tenant+serial (the ORIGINAL record returns,
 * the registry never gains a second asset), a mismatched receipt
 * records a DISCREPANCY with machine-stable reasons and the asset stays
 * un-enrolled until a verified re-record, and foreign tenants see
 * NOTHING.
 *
 * Vocabulary law: persona `fleet-operator` + capability `enrollment`
 * (the asset-admission family of the frozen vocabulary; no vocabulary
 * change, the F331A/F351B precedent). No epochs declared (D14's
 * single-epoch default; the F330 census set is closed).
 */

import type { AcceptanceJourney } from "../journey-contracts.js";

const T0 = 1_774_000_000_000;

export const marketplaceReceiptEnrollmentJourney: AcceptanceJourney = {
  id: "marketplace-receipt-enrollment",
  persona: "fleet-operator",
  capability: "enrollment",
  goal: "Enroll a marketplace laptop delivery into the authoritative asset registry ONLY through a verified receipt: the frozen fields link serial/tag + custody + warranty, the duplicate-serial guard returns the ORIGINAL enrollment (never a second asset), and a foreign tenant sees NOTHING.",
  steps: [
    { id: "a1", summary: "record the delivery receipt for the Accra HQ laptop order (every frozen field: serial/tag, site, supplier order ref, condition, warranty, captured-at + evidence ref)", op: { kind: "mre.record", evidenceRef: "rev_po-2026-7710-01", serial: "SN-LT-7710-001", assetTag: "TAG-ACCRA-77101", conditionOnArrival: "new", supplierOrderRef: "po-2026-7710", siteId: "site_accra-hq", warrantyRef: "war-24m-7710", capturedAt: T0 + 3_600_000, recordedAt: T0 + 3_700_000 } },
    { id: "a2", summary: "read the recorded receipt back (state recorded, nothing decided yet)", op: { kind: "mre.receipt-lookup", evidenceRef: "rev_po-2026-7710-01" } },
    { id: "a3", summary: "attempt to open enrollment BEFORE verification (must refuse: the authoritative asset updates ONLY on a verified receipt)", expectRefusal: true, op: { kind: "mre.enroll-open", evidenceRef: "rev_po-2026-7710-01", assetId: "ast_mkt-lt-7710", displayName: "Dell Latitude 5540 (marketplace)", assetKind: "other", deviceId: "dev_mkt-lt-7710", at: T0 + 3_800_000, actor: "act_operator-ada-01" } },
    { id: "a4", summary: "the registry still holds ZERO marketplace assets (the refusal admitted nothing)", op: { kind: "mre.registry-count" } },
    { id: "a5", summary: "verify the receipt against the supplier order line (serial, tag and condition all match)", op: { kind: "mre.verify", evidenceRef: "rev_po-2026-7710-01", expectedSerial: "SN-LT-7710-001", expectedAssetTag: "TAG-ACCRA-77101", expectedCondition: "new", supplierOrderRef: "po-2026-7710", decidedAt: T0 + 3_900_000 } },
    { id: "a6", summary: "read the receipt back (now verified)", op: { kind: "mre.receipt-lookup", evidenceRef: "rev_po-2026-7710-01" } },
    { id: "a7", summary: "open the enrollment candidate through the REAL registry (admitAsset: the asset enters the EXISTING truth)", op: { kind: "mre.enroll-open", evidenceRef: "rev_po-2026-7710-01", assetId: "ast_mkt-lt-7710", displayName: "Dell Latitude 5540 (marketplace)", assetKind: "other", deviceId: "dev_mkt-lt-7710", at: T0 + 4_000_000, actor: "act_operator-ada-01" } },
    { id: "a8", summary: "the EXISTING registry's own view: the asset is ADMITTED (candidate phase, not yet active)", op: { kind: "mre.asset-lifecycle", assetId: "ast_mkt-lt-7710" } },
    { id: "a9", summary: "complete the enrollment (transitionAsset activate + the twin link carrying serial/tag + custody + warranty)", op: { kind: "mre.enroll-complete", serial: "SN-LT-7710-001", at: T0 + 5_000_000, actor: "act_operator-ada-01" } },
    { id: "a10", summary: "the EXISTING registry's own view: the asset is ACTIVE with the REAL enrolledAt", op: { kind: "mre.asset-lifecycle", assetId: "ast_mkt-lt-7710" } },
    { id: "a11", summary: "read the enrollment record (enrolled, custody + warranty linked)", op: { kind: "mre.enrollment-lookup", serial: "SN-LT-7710-001" } },
    { id: "a12", summary: "a SECOND enrollment attempt for the same serial (different asset id!) — the duplicate guard must return the ORIGINAL", op: { kind: "mre.enroll-open", evidenceRef: "rev_po-2026-7710-01", assetId: "ast_mkt-lt-DUPLICATE", displayName: "Dell Latitude 5540 (duplicate attempt)", assetKind: "other", at: T0 + 6_000_000, actor: "act_operator-ada-01" } },
    { id: "a13", summary: "the registry still holds exactly ONE asset (never a second asset from the duplicate attempt)", op: { kind: "mre.registry-count" } },
    { id: "a14", summary: "a foreign tenant reads the enrollment (must see NOTHING — fail-closed)", expectRefusal: true, op: { kind: "mre.enrollment-lookup", serial: "SN-LT-7710-001", tenantId: "tnt_rival-fleet-99" } },
    { id: "a15", summary: "a foreign tenant reads the receipt evidence (must see NOTHING — no existence leak)", expectRefusal: true, op: { kind: "mre.receipt-lookup", evidenceRef: "rev_po-2026-7710-01", tenantId: "tnt_rival-fleet-99" } },
  ],
  assertions: [
    { id: "r1", description: "the receipt records with every frozen field in the recorded state", reading: "a1.mre.recState", op: "deep-equals", expected: "recorded" },
    { id: "r2", description: "the first record is not a duplicate", reading: "a1.mre.recDuplicate", op: "deep-equals", expected: false },
    { id: "r3", description: "enrollment from a recorded-only receipt refuses with the REAL code", reading: "a3.mre.openReason", op: "deep-equals", expected: "receipt-not-verified" },
    { id: "r4", description: "the refused attempt admitted NOTHING into the registry", reading: "a4.mre.registryCount", op: "deep-equals", expected: 0 },
    { id: "r5", description: "the matching receipt verifies against the order line", reading: "a5.mre.verState", op: "deep-equals", expected: "verified" },
    { id: "r6", description: "the stored receipt now reads verified", reading: "a6.mre.rcpState", op: "deep-equals", expected: "verified" },
    { id: "r7", description: "the enrollment opens as a CANDIDATE over the REAL registry", reading: "a7.mre.openState", op: "deep-equals", expected: "candidate" },
    { id: "r8", description: "custody is linked from the receipt's frozen site field", reading: "a7.mre.openCustody", op: "deep-equals", expected: "site_accra-hq" },
    { id: "r9", description: "the warranty reference is linked onto the enrollment", reading: "a7.mre.openWarranty", op: "deep-equals", expected: "war-24m-7710" },
    { id: "r10", description: "the EXISTING registry holds the candidate asset as ADMITTED (its own law, not the enrollment's copy)", reading: "a8.mre.assetLifecycle", op: "deep-equals", expected: "admitted" },
    { id: "r11", description: "the enrollment completes to ENROLLED", reading: "a9.mre.cmpState", op: "deep-equals", expected: "enrolled" },
    { id: "r12", description: "the REAL twin link carried the enrollment attributes", reading: "a9.mre.cmpTwinLinked", op: "deep-equals", expected: true },
    { id: "r13", description: "the EXISTING registry now shows the asset ACTIVE", reading: "a10.mre.assetLifecycle", op: "deep-equals", expected: "active" },
    { id: "r14", description: "the registry's enrolledAt is the REAL activation timestamp", reading: "a10.mre.assetEnrolledAt", op: "deep-equals", expected: T0 + 5_000_000 },
    { id: "r15", description: "the enrollment reads back ENROLLED with the same enrolledAt", reading: "a11.mre.lookupState", op: "deep-equals", expected: "enrolled" },
    { id: "r16", description: "the read-back enrolledAt matches the completion timestamp", reading: "a11.mre.lookupEnrolledAt", op: "deep-equals", expected: T0 + 5_000_000 },
    { id: "r17", description: "the duplicate-serial attempt returns duplicate=true (the guard fires)", reading: "a12.mre.openDuplicate", op: "deep-equals", expected: true },
    { id: "r18", description: "the duplicate attempt returned the ORIGINAL asset (not the second attempt's id)", reading: "a12.mre.openAssetId", op: "deep-equals", expected: "ast_mkt-lt-7710" },
    { id: "r19", description: "the duplicate attempt returned the ORIGINAL enrollment record (same enrollment id as the first opening)", reading: "a12.mre.openEnrollmentId", op: "reading-equals", expected: "a7.mre.openEnrollmentId" },
    { id: "r20", description: "the registry still holds exactly ONE asset — never a second asset", reading: "a13.mre.registryCount", op: "deep-equals", expected: 1 },
    { id: "r21", description: "the single registry asset is ACTIVE (the original enrollment's)", reading: "a13.mre.registryLifecycles", op: "deep-equals", expected: ["active"] },
    { id: "r22", description: "the foreign tenant's enrollment read sees NOTHING", reading: "a14.mre.lookupKnown", op: "deep-equals", expected: false },
    { id: "r23", description: "the foreign tenant's receipt read sees NOTHING (no existence leak)", reading: "a15.mre.rcpKnown", op: "deep-equals", expected: false },
  ],
};

export const marketplaceReceiptDiscrepancyJourney: AcceptanceJourney = {
  id: "marketplace-receipt-discrepancy",
  persona: "fleet-operator",
  capability: "enrollment",
  goal: "A mismatched marketplace printer delivery records a DISCREPANCY with machine-stable reasons, refuses enrollment (the asset stays un-enrolled in the authoritative registry), and only the corrected verified re-record enrolls — the discrepancy state is terminal and never re-decided.",
  steps: [
    { id: "b1", summary: "record the printer delivery receipt with the transposed serial and the damaged condition noted at inspection", op: { kind: "mre.record", evidenceRef: "rev_po-2026-3308-01", serial: "SN-PR-3308-017", assetTag: "TAG-ACCRA-33081", conditionOnArrival: "damaged", supplierOrderRef: "po-2026-3308", siteId: "site_accra-depot", warrantyRef: "war-12m-3308", capturedAt: T0 + 10_800_000, recordedAt: T0 + 10_900_000 } },
    { id: "b2", summary: "verify against the order line (the promised serial was SN-PR-3308-071 in NEW condition — the recorded serial and condition both mismatch)", op: { kind: "mre.verify", evidenceRef: "rev_po-2026-3308-01", expectedSerial: "SN-PR-3308-071", expectedAssetTag: "TAG-ACCRA-33081", expectedCondition: "new", supplierOrderRef: "po-2026-3308", decidedAt: T0 + 11_000_000 } },
    { id: "b3", summary: "read the receipt back (discrepancy with the recorded reasons)", op: { kind: "mre.receipt-lookup", evidenceRef: "rev_po-2026-3308-01" } },
    { id: "b4", summary: "attempt to enroll from the discrepancy receipt (must refuse — the asset stays un-enrolled)", expectRefusal: true, op: { kind: "mre.enroll-open", evidenceRef: "rev_po-2026-3308-01", assetId: "ast_mkt-pr-3308", displayName: "HP LaserJet MFP (marketplace)", assetKind: "other", at: T0 + 11_200_000, actor: "act_operator-ada-01" } },
    { id: "b5", summary: "the registry holds ZERO assets (nothing enrolled from a discrepancy)", op: { kind: "mre.registry-count" } },
    { id: "b6", summary: "attempt to re-decide the already-discrepant receipt (must refuse: terminal state, a corrected receipt is a NEW record)", expectRefusal: true, op: { kind: "mre.verify", evidenceRef: "rev_po-2026-3308-01", expectedSerial: "SN-PR-3308-071", expectedAssetTag: "TAG-ACCRA-33081", expectedCondition: "new", supplierOrderRef: "po-2026-3308", decidedAt: T0 + 11_400_000 } },
    { id: "b7", summary: "record the CORRECTED re-record after the supplier swap (a new evidence ref, right serial, good condition)", op: { kind: "mre.record", evidenceRef: "rev_po-2026-3308-01-r2", serial: "SN-PR-3308-071", assetTag: "TAG-ACCRA-33081", conditionOnArrival: "new", supplierOrderRef: "po-2026-3308", siteId: "site_accra-depot", warrantyRef: "war-12m-3308", capturedAt: T0 + 14_400_000, recordedAt: T0 + 14_500_000 } },
    { id: "b8", summary: "verify the corrected re-record against the same order line", op: { kind: "mre.verify", evidenceRef: "rev_po-2026-3308-01-r2", expectedSerial: "SN-PR-3308-071", expectedAssetTag: "TAG-ACCRA-33081", expectedCondition: "new", supplierOrderRef: "po-2026-3308", decidedAt: T0 + 14_600_000 } },
    { id: "b9", summary: "open the enrollment candidate on the corrected verified receipt", op: { kind: "mre.enroll-open", evidenceRef: "rev_po-2026-3308-01-r2", assetId: "ast_mkt-pr-3308", displayName: "HP LaserJet MFP (marketplace)", assetKind: "other", at: T0 + 14_700_000, actor: "act_operator-ada-01" } },
    { id: "b10", summary: "complete the enrollment (activate + twin link)", op: { kind: "mre.enroll-complete", serial: "SN-PR-3308-071", at: T0 + 14_800_000, actor: "act_operator-ada-01" } },
    { id: "b11", summary: "the EXISTING registry shows the printer ACTIVE", op: { kind: "mre.asset-lifecycle", assetId: "ast_mkt-pr-3308" } },
    { id: "b12", summary: "read the enrollment (enrolled, custody at the depot)", op: { kind: "mre.enrollment-lookup", serial: "SN-PR-3308-071" } },
    { id: "b13", summary: "the registry holds exactly ONE asset (the discrepancy period enrolled nothing; the re-record enrolled exactly one)", op: { kind: "mre.registry-count" } },
  ],
  assertions: [
    { id: "s1", description: "the mismatched receipt still records honestly (recorded state, frozen fields intact)", reading: "b1.mre.recState", op: "deep-equals", expected: "recorded" },
    { id: "s2", description: "verification records a DISCREPANCY (never a silent pass)", reading: "b2.mre.verState", op: "deep-equals", expected: "discrepancy" },
    { id: "s3", description: "the discrepancy reasons are the machine-stable mismatch codes in the fixed vocabulary order", reading: "b2.mre.verReasons", op: "deep-equals", expected: ["serial-mismatch", "condition-mismatch"] },
    { id: "s4", description: "the stored receipt reads back discrepancy", reading: "b3.mre.rcpState", op: "deep-equals", expected: "discrepancy" },
    { id: "s5", description: "the read-back reasons match the decision's (never re-derived)", reading: "b3.mre.rcpReasons", op: "deep-equals", expected: ["serial-mismatch", "condition-mismatch"] },
    { id: "s6", description: "enrollment from a discrepancy receipt refuses with the REAL distinct code", reading: "b4.mre.openReason", op: "deep-equals", expected: "receipt-discrepancy" },
    { id: "s7", description: "the asset stays UN-ENROLLED (registry count zero)", reading: "b5.mre.registryCount", op: "deep-equals", expected: 0 },
    { id: "s8", description: "re-deciding the terminal discrepancy refuses with the REAL code (append-only law)", reading: "b6.mre.verReason", op: "deep-equals", expected: "illegal-transition" },
    { id: "s9", description: "the corrected re-record is a NEW recorded receipt", reading: "b7.mre.recState", op: "deep-equals", expected: "recorded" },
    { id: "s10", description: "the re-record is not a duplicate of the original evidence", reading: "b7.mre.recDuplicate", op: "deep-equals", expected: false },
    { id: "s11", description: "the corrected re-record VERIFIES against the same order line", reading: "b8.mre.verState", op: "deep-equals", expected: "verified" },
    { id: "s12", description: "the enrollment opens as a candidate on the corrected receipt", reading: "b9.mre.openState", op: "deep-equals", expected: "candidate" },
    { id: "s13", description: "the enrollment completes to ENROLLED", reading: "b10.mre.cmpState", op: "deep-equals", expected: "enrolled" },
    { id: "s14", description: "the enrolledAt is the REAL completion timestamp", reading: "b10.mre.cmpEnrolledAt", op: "deep-equals", expected: T0 + 14_800_000 },
    { id: "s15", description: "the EXISTING registry shows the printer ACTIVE", reading: "b11.mre.assetLifecycle", op: "deep-equals", expected: "active" },
    { id: "s16", description: "the enrollment reads back ENROLLED", reading: "b12.mre.lookupState", op: "deep-equals", expected: "enrolled" },
    { id: "s17", description: "custody is the depot site from the corrected receipt's frozen field", reading: "b12.mre.lookupCustody", op: "deep-equals", expected: "site_accra-depot" },
    { id: "s18", description: "exactly ONE asset entered the registry across the whole discrepancy + re-record chain", reading: "b13.mre.registryCount", op: "deep-equals", expected: 1 },
  ],
};
