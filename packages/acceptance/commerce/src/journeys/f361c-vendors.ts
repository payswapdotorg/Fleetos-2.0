/**
 * @fleetos/acceptance-commerce — F361C vendors journey (Wave 17 lane
 * C): the supplier-verification gate.
 *
 * CENSUS CITATION (the F361C commerce census — docs/evidence/F361C/
 * report.md §1, machine-measured at base `203f077`): every step here
 * drives public APIs with ZERO corpus coverage across all three
 * corpora (grep proof): `openSupplierVerification` /
 * `transitionSupplierVerification` / `supplierVerificationGate` /
 * `findSupplierVerification` (vendors/supplier-verification.ts — the
 * §3.3 machine + the verified-only gate) and `importCatalogueBatch`
 * (vendors/catalogue-import.ts — the PLAINLY-LABELLED manually-operated
 * catalogue import seam). The id names THIS lane's MARKETPLACE angle
 * (the F354 lesson; the pre-existing `vendor-verify-capability` step
 * family drives the DIFFERENT capability-catalog verifyCapability API).
 *
 * D14 form: unique id, REAL domain public entry points, >=5 substantive
 * assertions incl. >=1 refusal, deterministic byte-identity on rerun.
 * Single-epoch (T0): no step consumes the run anchor, no assertion
 * carries an epoch table (D13).
 */

import type { AcceptanceJourney, FactValue } from "../journey-contracts.js";

const eq = (id: string, fact: string, expected: FactValue, description: string) =>
  ({ id, description, fact, op: "eq" as const, expected });
const deq = (id: string, fact: string, expected: readonly string[], description: string) =>
  ({ id, description, fact, op: "deepEq" as const, expected });

const T0 = 1_774_000_000_000;
const DAY = 86_400_000;

/**
 * The supplier verification gate through the REAL §3.3 machine: pending
 * suppliers verify ONLY behind same-tenant evidence with a strictly-
 * later expiry; the honest expiry refuses NOT_EXPIRED_YET before the
 * lapse; VERIFIED-ONLY suppliers enter matching (pending, suspended and
 * lapsed suppliers are excluded WITH their reasons — an expired
 * verification NEVER silently enters the gate); terminal states refuse
 * re-verification; the cross-tenant read sees NOTHING; and the
 * manually-operated catalogue import seam is PLAINLY LABELLED — the
 * label travels verbatim on every result, one malformed or duplicate
 * entry refuses the WHOLE batch with the per-entry report, and every
 * imported entry carries its tracked source and captured-at.
 */
export const marketplaceSupplierVerificationGateJourney: AcceptanceJourney = {
  id: "marketplace-supplier-verification-gate",
  persona: "vendor-manager",
  capability: "marketplace-suppliers",
  goal: "Gate suppliers through the REAL §3.3 verification machine — verification REQUIRES same-tenant evidence and a strictly-later expiry (a missing reference and a foreign evidence tenant both refuse), the explicit expiry refuses NOT_EXPIRED_YET before the lapse, the gate admits ONLY verified-and-current suppliers (pending, suspended and lapsed suppliers are excluded WITH per-supplier reasons — an expired verification NEVER silently enters matching), terminal states refuse re-verification, the OTHER tenant's read sees NOTHING, and the manually-operated catalogue import is PLAINLY LABELLED (the label verbatim on every result, tracked source and captured-at on every entry, one malformed or duplicate entry refusing the WHOLE batch).",
  steps: [
    { stepId: "s1", kind: "mver-open", factKey: "accra", supplierId: "sup-accra" },
    { stepId: "s2", kind: "mver-open", factKey: "tema", supplierId: "sup-tema" },
    { stepId: "s3", kind: "mver-open", factKey: "kumasi", supplierId: "sup-kumasi" },
    // REFUSAL: verification without an evidence reference.
    { stepId: "s4", kind: "mver-verify", factKey: "noEvidence", supplierId: "sup-accra", evidenceId: "", evidenceTenantId: "acme", verifiedAt: T0, expiresAt: T0 + 90 * DAY },
    // REFUSAL: the evidence reference belongs to the OTHER tenant.
    { stepId: "s5", kind: "mver-verify", factKey: "foreignEvidence", supplierId: "sup-accra", evidenceId: "ev-x", evidenceTenantId: "globex", verifiedAt: T0, expiresAt: T0 + 90 * DAY },
    { stepId: "s6", kind: "mver-verify", factKey: "accraOk", supplierId: "sup-accra", evidenceId: "ev-sup-accra-01", evidenceTenantId: "acme", verifiedAt: T0, expiresAt: T0 + 90 * DAY },
    { stepId: "s7", kind: "mver-verify", factKey: "temaOk", supplierId: "sup-tema", evidenceId: "ev-sup-tema-01", evidenceTenantId: "acme", verifiedAt: T0, expiresAt: T0 + 30 * DAY },
    { stepId: "s8", kind: "mver-suspend", factKey: "kumasi", supplierId: "sup-kumasi", reason: "delivery fraud investigation" },
    // REFUSAL: a suspension without a reason.
    { stepId: "s9", kind: "mver-suspend", factKey: "noReason", supplierId: "sup-accra", reason: " " },
    // REFUSAL: the expiry before the lapse (boundary inclusive).
    { stepId: "s10", kind: "mver-expire", factKey: "notYet", supplierId: "sup-accra", at: T0 + 90 * DAY },
    // The gate at T0+10d: two verified, one suspended.
    { stepId: "s11", kind: "mver-gate", factKey: "early", at: T0 + 10 * DAY },
    // The tema verification lapses one ms past its expiry.
    { stepId: "s12", kind: "mver-expire", factKey: "temaLapse", supplierId: "sup-tema", at: T0 + 30 * DAY + 1 },
    // The gate at T0+31d: ONLY sup-accra remains — the lapsed verification never silently enters.
    { stepId: "s13", kind: "mver-gate", factKey: "late", at: T0 + 31 * DAY },
    // REFUSAL: expired is terminal — re-verification refuses.
    { stepId: "s14", kind: "mver-verify", factKey: "terminal", supplierId: "sup-tema", evidenceId: "ev-sup-tema-02", evidenceTenantId: "acme", verifiedAt: T0 + 32 * DAY, expiresAt: T0 + 120 * DAY },
    { stepId: "s15", kind: "mver-read", factKey: "own", supplierId: "sup-accra" },
    // Fail-closed: the OTHER tenant's scope sees nothing.
    { stepId: "s16", kind: "mver-read", factKey: "foreign", supplierId: "sup-accra", callerTenant: "foreign" },
    // The PLAINLY-LABELLED manually-operated catalogue import seam.
    { stepId: "s17", kind: "mver-catalogue-import", factKey: "first", operatorId: "act_operator-ada-01", exportId: "exp-2026-10-14", exportCapturedAt: T0,
      entries: [
        { supplierId: "sup-accra", sku: "LT-5540", unitCostMinor: 1_200_000, currency: "GHS", condition: "new", warrantyMonths: 24, deliveryEstimateDays: 10 },
        { supplierId: "sup-tema", sku: "PR-3300", unitCostMinor: 800_000, currency: "GHS", condition: "new", warrantyMonths: 12, deliveryEstimateDays: 7 },
      ] },
    // REFUSAL: a duplicate supplier+SKU within the batch.
    { stepId: "s18", kind: "mver-catalogue-import", factKey: "duplicate", operatorId: "act_operator-ada-01", exportId: "exp-2026-10-15", exportCapturedAt: T0 + DAY,
      entries: [
        { supplierId: "sup-accra", sku: "LT-5540", unitCostMinor: 1_150_000, currency: "GHS", condition: "new", warrantyMonths: 24, deliveryEstimateDays: 9 },
        { supplierId: "sup-accra", sku: "LT-5540", unitCostMinor: 1_100_000, currency: "GHS", condition: "certified-refurbished", warrantyMonths: 12, deliveryEstimateDays: 5 },
      ] },
    // REFUSAL: a malformed entry refuses the WHOLE batch (per-entry report).
    { stepId: "s19", kind: "mver-catalogue-import", factKey: "malformed", operatorId: "act_operator-ada-01", exportId: "exp-2026-10-16", exportCapturedAt: T0 + 2 * DAY,
      entries: [
        { supplierId: "sup-kumasi", sku: "PR-3300", unitCostMinor: 700_000, currency: "GHS", condition: "new", warrantyMonths: 6, deliveryEstimateDays: 4 },
        { supplierId: "sup-kumasi", sku: "SC-2100", unitCostMinor: 0, currency: "GHS", condition: "new", warrantyMonths: 6, deliveryEstimateDays: 4 },
      ] },
    // REFUSAL: the operator id is required (auditable provenance).
    { stepId: "s20", kind: "mver-catalogue-import", factKey: "noOperator", operatorId: "", exportId: "exp-2026-10-17", exportCapturedAt: T0 + 3 * DAY,
      entries: [{ supplierId: "sup-accra", sku: "DO-5500", unitCostMinor: 500_000, currency: "GHS", condition: "new", warrantyMonths: 6, deliveryEstimateDays: 3 }] },
  ],
  assertions: [
    eq("sv1", "mver.open.accra.status", "pending", "the Accra supplier opens as pending"),
    eq("sv2", "mver.open.tema.status", "pending", "the Tema supplier opens as pending"),
    eq("sv3", "mver.verify.noEvidence.reasonCode", "VERIFICATION_EVIDENCE_REQUIRED", "REFUSAL: verification without an evidence reference never promotes a declaration (law A3)"),
    eq("sv4", "mver.verify.foreignEvidence.reasonCode", "VERIFICATION_EVIDENCE_TENANT_MISMATCH", "REFUSAL: the evidence reference must belong to the SAME tenant"),
    eq("sv5", "mver.verify.accraOk.status", "verified", "the Accra supplier verifies behind the same-tenant evidence reference"),
    eq("sv6", "mver.verify.accraOk.evidenceId", "ev-sup-accra-01", "the verification record carries the evidence reference"),
    eq("sv7", "mver.verify.accraOk.expiresAt", T0 + 90 * DAY, "the verification carries its expires-at horizon"),
    eq("sv8", "mver.verify.temaOk.status", "verified", "the Tema supplier verifies with the shorter horizon"),
    eq("sv9", "mver.suspend.kumasi.status", "suspended", "the Kumasi supplier suspends with the recorded reason"),
    eq("sv10", "mver.suspend.noReason.reasonCode", "SUSPEND_REASON_REQUIRED", "REFUSAL: a suspension requires a reason (law A4)"),
    eq("sv11", "mver.expire.notYet.reasonCode", "NOT_EXPIRED_YET", "REFUSAL: at the boundary instant the verification is still inside — never expired early"),
    deq("sv12", "mver.gate.early.admitted", ["sup-accra", "sup-tema"], "the early gate admits both verified suppliers (deterministic order)"),
    deq("sv13", "mver.gate.early.excluded", ["sup-kumasi:SUPPLIER_SUSPENDED"], "the suspended supplier is excluded WITH its reason"),
    eq("sv14", "mver.expire.temaLapse.status", "expired", "the Tema verification lapses one instant past its expiry"),
    deq("sv15", "mver.gate.late.admitted", ["sup-accra"], "the late gate admits ONLY the still-current verification — an expired verification NEVER silently enters matching"),
    deq("sv16", "mver.gate.late.excluded", ["sup-kumasi:SUPPLIER_SUSPENDED", "sup-tema:VERIFICATION_EXPIRED"], "the lapsed and suspended suppliers are excluded with their reasons"),
    eq("sv17", "mver.verify.terminal.reasonCode", "ILLEGAL_TRANSITION", "REFUSAL: expired is TERMINAL — re-verification refuses"),
    eq("sv18", "mver.read.own.found", true, "the own-tenant read finds the verified record"),
    eq("sv19", "mver.read.foreign.found", false, "REFUSAL-class fact: the OTHER tenant's scope reads NOTHING (fail-closed)"),
    eq("sv20", "mver.read.foreign.status", null, "the cross-tenant read exposes no verification status"),
    eq("sv21", "mver.catalogue.first.ok", true, "the manually-operated catalogue import succeeds"),
    eq("sv22", "mver.catalogue.first.label", "manual-operator-catalogue-import (NOT a live supplier API; source and freshness tracked per entry)", "the seam label is PLAIN and travels verbatim on the result — never a live-API claim"),
    eq("sv23", "mver.catalogue.first.entryCount", 2, "the batch imports two entries"),
    deq("sv24", "mver.catalogue.first.entryIds", ["cat_acme_sup-accra_LT-5540", "cat_acme_sup-tema_PR-3300"], "the entry ids are deterministic (tenant + supplier + sku)"),
    deq("sv25", "mver.catalogue.first.provenance", ["sup-accra:LT-5540:act_operator-ada-01:exp-2026-10-14:" + T0, "sup-tema:PR-3300:act_operator-ada-01:exp-2026-10-14:" + T0], "every entry carries its tracked import source and captured-at (operator-auditable provenance)"),
    eq("sv26", "mver.catalogue.duplicate.reasonCode", "DUPLICATE_CATALOGUE_ENTRY", "REFUSAL: a duplicate supplier+SKU within a batch refuses the WHOLE import"),
    eq("sv27", "mver.catalogue.malformed.reasonCode", "ENTRY_VALIDATION_FAILED", "REFUSAL: one malformed entry refuses the whole batch — never a partial import"),
    eq("sv28", "mver.catalogue.noOperator.reasonCode", "OPERATOR_ID_REQUIRED", "REFUSAL: the operator id is required (auditable provenance)"),
    deq("sv29", "mver.log", [
      "open:sup-accra:pending",
      "open:sup-tema:pending",
      "open:sup-kumasi:pending",
      "verify:sup-accra:refused:VERIFICATION_EVIDENCE_REQUIRED",
      "verify:sup-accra:refused:VERIFICATION_EVIDENCE_TENANT_MISMATCH",
      "verify:sup-accra:verified",
      "verify:sup-tema:verified",
      "suspend:sup-kumasi:suspended",
      "suspend:sup-accra:refused:SUSPEND_REASON_REQUIRED",
      "expire:sup-accra:refused:NOT_EXPIRED_YET",
      "gate:early:admitted:sup-accra,sup-tema:excluded:sup-kumasi:SUPPLIER_SUSPENDED",
      "expire:sup-tema:expired",
      "gate:late:admitted:sup-accra:excluded:sup-kumasi:SUPPLIER_SUSPENDED,sup-tema:VERIFICATION_EXPIRED",
      "verify:sup-tema:refused:ILLEGAL_TRANSITION",
      "catalogue:first:imported:2",
      "catalogue:duplicate:refused:DUPLICATE_CATALOGUE_ENTRY",
      "catalogue:malformed:refused:ENTRY_VALIDATION_FAILED",
      "catalogue:noOperator:refused:OPERATOR_ID_REQUIRED",
    ], "the verification log carries every transition, refusal, gate verdict and catalogue import in order"),
  ],
};

export const F361C_VENDOR_JOURNEYS: readonly AcceptanceJourney[] = [
  marketplaceSupplierVerificationGateJourney,
];
