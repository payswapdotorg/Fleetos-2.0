/**
 * @fleetos/assets — F361A marketplace receipt evidence (Wave 17 lane A).
 *
 * The F360 freeze §3.5 state machine (MARKETPLACE-MVP-FREEZE.md):
 *
 *   ReceiptEvidence: recorded → verified | discrepancy
 *
 * with the FROZEN fields: serial/asset tag, tenant/site, supplier order
 * reference, condition-on-arrival, warranty reference, captured-at +
 * evidence reference. A receipt verifies only when its recorded fields
 * match the order expectation (the supplier order line — the frozen TYPE
 * seam shared with the F361C order lane, never a shared file); any
 * mismatch records a DISCREPANCY with machine-stable reasons and the
 * asset stays un-enrolled until a verified re-record.
 *
 * Pure TypeScript domain contract ONLY. No I/O, no servers, no
 * databases. The enrollment service that consumes verified receipts
 * lives in receipt-enrollment.ts (same lane). Persistence remains the
 * standing PostgreSQL law (F360 §4) — types + deterministic domain logic
 * + tests only.
 */

import type { TenantIdLike } from "./assets.js";

// ---------------------------------------------------------------------------
// Vocabulary — the frozen condition-on-arrival values (pilot categories:
// end-user computing + printers/photocopiers, F360 §1).
// ---------------------------------------------------------------------------

export type ReceiptConditionOnArrival = "new" | "good" | "damaged";

export const RECEIPT_CONDITIONS: ReadonlyArray<ReceiptConditionOnArrival> = ["new", "good", "damaged"];

// ---------------------------------------------------------------------------
// ReceiptEvidence — the durable receipt record (frozen fields, F360 §3.5).
// ---------------------------------------------------------------------------

export type ReceiptEvidenceState = "recorded" | "verified" | "discrepancy";

export interface ReceiptEvidence {
  /** The receipt-evidence reference id — the frozen seam TYPE with the
   * F361C order lane (F360 §5 correlation ordering); globally unique
   * within the recording tenant. */
  readonly evidenceRef: string;
  readonly tenantId: TenantIdLike;
  /** The delivery site the equipment arrived at (custody anchor). */
  readonly siteId: string;
  /** The supplier order this receipt claims to fulfil (F361C's lane owns
   * the order truth; this is the recorded reference only). */
  readonly supplierOrderRef: string;
  readonly serial: string;
  readonly assetTag: string;
  readonly conditionOnArrival: ReceiptConditionOnArrival;
  readonly warrantyRef: string;
  /** When the receipt was captured (delivery/inspection moment). */
  readonly capturedAt: number;
  readonly state: ReceiptEvidenceState;
  readonly recordedAt: number;
  /** Set when the receipt was decided (verified or discrepancy). */
  readonly decidedAt: number | null;
  /** The machine-stable discrepancy reasons (empty unless state=discrepancy). */
  readonly discrepancyReasons: readonly string[];
}

// ---------------------------------------------------------------------------
// recordReceiptEvidence — the pure recorder (recorded state, full frozen
// field validation, machine-stable refusal codes).
// ---------------------------------------------------------------------------

export type ReceiptRecordRejectionCode =
  | "missing-tenant-id"
  | "missing-site-id"
  | "missing-supplier-order-ref"
  | "missing-serial"
  | "missing-asset-tag"
  | "unknown-condition-on-arrival"
  | "missing-warranty-ref"
  | "invalid-captured-at"
  | "missing-evidence-ref"
  | "invalid-recorded-at";

export interface ReceiptRecordInput {
  readonly evidenceRef: string;
  readonly tenantId: TenantIdLike;
  readonly siteId: string;
  readonly supplierOrderRef: string;
  readonly serial: string;
  readonly assetTag: string;
  readonly conditionOnArrival: ReceiptConditionOnArrival;
  readonly warrantyRef: string;
  readonly capturedAt: number;
  readonly recordedAt: number;
}

export type ReceiptRecordResult =
  | { readonly ok: true; readonly evidence: ReceiptEvidence }
  | { readonly ok: false; readonly reason: ReceiptRecordRejectionCode };

export function recordReceiptEvidence(input: ReceiptRecordInput): ReceiptRecordResult {
  if (typeof input.evidenceRef !== "string" || input.evidenceRef === "") {
    return { ok: false, reason: "missing-evidence-ref" };
  }
  if (typeof input.tenantId !== "string" || input.tenantId === "") {
    return { ok: false, reason: "missing-tenant-id" };
  }
  if (typeof input.siteId !== "string" || input.siteId === "") {
    return { ok: false, reason: "missing-site-id" };
  }
  if (typeof input.supplierOrderRef !== "string" || input.supplierOrderRef === "") {
    return { ok: false, reason: "missing-supplier-order-ref" };
  }
  if (typeof input.serial !== "string" || input.serial === "") {
    return { ok: false, reason: "missing-serial" };
  }
  if (typeof input.assetTag !== "string" || input.assetTag === "") {
    return { ok: false, reason: "missing-asset-tag" };
  }
  if (!RECEIPT_CONDITIONS.includes(input.conditionOnArrival)) {
    return { ok: false, reason: "unknown-condition-on-arrival" };
  }
  if (typeof input.warrantyRef !== "string" || input.warrantyRef === "") {
    return { ok: false, reason: "missing-warranty-ref" };
  }
  if (!Number.isFinite(input.capturedAt) || input.capturedAt <= 0) {
    return { ok: false, reason: "invalid-captured-at" };
  }
  if (!Number.isFinite(input.recordedAt) || input.recordedAt <= 0) {
    return { ok: false, reason: "invalid-recorded-at" };
  }
  const evidence: ReceiptEvidence = {
    evidenceRef: input.evidenceRef,
    tenantId: input.tenantId,
    siteId: input.siteId,
    supplierOrderRef: input.supplierOrderRef,
    serial: input.serial,
    assetTag: input.assetTag,
    conditionOnArrival: input.conditionOnArrival,
    warrantyRef: input.warrantyRef,
    capturedAt: input.capturedAt,
    state: "recorded",
    recordedAt: input.recordedAt,
    decidedAt: null,
    discrepancyReasons: [],
  };
  return { ok: true, evidence };
}

// ---------------------------------------------------------------------------
// verifyReceiptEvidence — the pure decision (recorded → verified |
// discrepancy). Both terminal states are FINAL: re-deciding a decided
// receipt refuses with illegal-transition (a corrected receipt is a NEW
// recorded evidence, never a mutated one — the append-only law).
// ---------------------------------------------------------------------------

/** The order-line expectation a recorded receipt is verified against
 * (the supplier order's promised serial/tag/condition — supplied by the
 * caller from the order context; the frozen seam TYPE, F360 §5). */
export interface ReceiptExpectation {
  readonly supplierOrderRef: string;
  readonly expectedSerial: string;
  readonly expectedAssetTag: string;
  readonly expectedCondition: ReceiptConditionOnArrival;
}

export type ReceiptVerifyRejectionCode = "illegal-transition";

export type ReceiptVerifyResult =
  | { readonly ok: true; readonly evidence: ReceiptEvidence }
  | { readonly ok: false; readonly reason: ReceiptVerifyRejectionCode };

/** The machine-stable discrepancy reasons (the fixed vocabulary order:
 * supplier-order, serial, asset-tag, condition — deterministic). */
export type ReceiptDiscrepancyReason =
  | "asset-tag-mismatch"
  | "condition-mismatch"
  | "serial-mismatch"
  | "supplier-order-mismatch";

export function verifyReceiptEvidence(
  evidence: ReceiptEvidence,
  expectation: ReceiptExpectation,
  decidedAt: number,
): ReceiptVerifyResult {
  if (evidence.state !== "recorded") {
    return { ok: false, reason: "illegal-transition" };
  }
  const reasons: ReceiptDiscrepancyReason[] = [];
  if (evidence.supplierOrderRef !== expectation.supplierOrderRef) {
    reasons.push("supplier-order-mismatch");
  }
  if (evidence.serial !== expectation.expectedSerial) {
    reasons.push("serial-mismatch");
  }
  if (evidence.assetTag !== expectation.expectedAssetTag) {
    reasons.push("asset-tag-mismatch");
  }
  if (evidence.conditionOnArrival !== expectation.expectedCondition) {
    reasons.push("condition-mismatch");
  }
  const state: ReceiptEvidenceState = reasons.length === 0 ? "verified" : "discrepancy";
  return {
    ok: true,
    evidence: {
      ...evidence,
      state,
      decidedAt,
      // Deterministic order (the fixed vocabulary order above).
      discrepancyReasons: reasons,
    },
  };
}

/** True when the receipt is verified (the ONLY state enrollment accepts). */
export function isVerifiedReceipt(evidence: ReceiptEvidence): boolean {
  return evidence.state === "verified";
}
