/**
 * @fleetos/acceptance-field — F361A contracts: the marketplace
 * receipt→asset enrollment operations (Wave 17 lane A, per the f361a
 * packet + the F360 freeze §3.5).
 *
 * The executors (ops/f361a-marketplace-ops.ts) drive the REAL public
 * APIs of @fleetos/assets — the F361A census (machine-measured at base
 * `cefd588`; zero grep matches across the field/security/commerce
 * corpora):
 *  - recordReceiptEvidence + verifyReceiptEvidence + ReceiptEvidence
 *    (packages/assets/src/receipt-evidence.ts);
 *  - ReceiptEnrollmentDirectory.recordReceipt / verifyReceipt /
 *    openEnrollment / completeEnrollment / findEnrollment / getReceipt
 *    (packages/assets/src/receipt-enrollment.ts) — which themselves
 *    consume the EXISTING registry public APIs (AssetDirectory
 *    .admitAsset/.transitionAsset/.lookupAsset/.listAssets +
 *    applyTwinRevision).
 *
 * The `mre.` prefix names THIS lane's angle (marketplace receipt
 * enrollment); `tenantId` absent = the context tenant, a foreign tenant
 * probes the fail-closed read (the pj.read/hx.diagnosis-lookup
 * precedent).
 *
 * Pure data; no logic. Census citations are carried in the journey
 * files.
 */

import type { AssetKind, ReceiptConditionOnArrival } from "@fleetos/assets";

// ---------------------------------------------------------------------------
// Receipt evidence — record + verify (the frozen fields, F360 §3.5).
// ---------------------------------------------------------------------------

export interface MreRecordOp {
  readonly kind: "mre.record";
  readonly evidenceRef: string;
  readonly serial: string;
  readonly assetTag: string;
  readonly conditionOnArrival: ReceiptConditionOnArrival;
  readonly supplierOrderRef: string;
  readonly siteId: string;
  readonly warrantyRef: string;
  readonly capturedAt: number;
  /** Deterministic recording time (journey data; never a wall clock). */
  readonly recordedAt: number;
  /** Absent = the context tenant; a foreign tenant probes the tenant law. */
  readonly tenantId?: string;
}

export interface MreVerifyOp {
  readonly kind: "mre.verify";
  readonly evidenceRef: string;
  /** The order-line expectation (the frozen TYPE seam with the F361C lane). */
  readonly expectedSerial: string;
  readonly expectedAssetTag: string;
  readonly expectedCondition: ReceiptConditionOnArrival;
  readonly supplierOrderRef: string;
  /** Deterministic decision time. */
  readonly decidedAt: number;
  readonly tenantId?: string;
}

// ---------------------------------------------------------------------------
// Enrollment — candidate → enrolled over the EXISTING registry.
// ---------------------------------------------------------------------------

export interface MreEnrollOpenOp {
  readonly kind: "mre.enroll-open";
  readonly evidenceRef: string;
  readonly assetId: string;
  readonly displayName: string;
  /** The asset's registry kind (the AssetKind vocabulary). */
  readonly assetKind: AssetKind;
  /** Optional device twin link (the enrollment attributes land on the twin). */
  readonly deviceId?: string;
  /** Deterministic admission time. */
  readonly at: number;
  readonly actor: string;
  readonly tenantId?: string;
}

export interface MreEnrollCompleteOp {
  readonly kind: "mre.enroll-complete";
  /** The idempotency key: the serial the enrollment is keyed on. */
  readonly serial: string;
  readonly deviceId?: string;
  /** Deterministic activation time. */
  readonly at: number;
  readonly actor: string;
  readonly tenantId?: string;
}

// ---------------------------------------------------------------------------
// Reads — tenant-scoped, fail-closed (a foreign tenant sees NOTHING).
// ---------------------------------------------------------------------------

export interface MreEnrollmentLookupOp {
  readonly kind: "mre.enrollment-lookup";
  readonly serial: string;
  readonly tenantId?: string;
}

export interface MreReceiptLookupOp {
  readonly kind: "mre.receipt-lookup";
  readonly evidenceRef: string;
  readonly tenantId?: string;
}

/** The never-a-second-asset proof: the REAL registry's tenant asset count. */
export interface MreRegistryCountOp {
  readonly kind: "mre.registry-count";
}

/** The EXISTING registry's view of one asset (the authoritative record). */
export interface MreAssetLifecycleOp {
  readonly kind: "mre.asset-lifecycle";
  readonly assetId: string;
}

export type F361AOperation =
  | MreRecordOp
  | MreVerifyOp
  | MreEnrollOpenOp
  | MreEnrollCompleteOp
  | MreEnrollmentLookupOp
  | MreReceiptLookupOp
  | MreRegistryCountOp
  | MreAssetLifecycleOp;

export const F361A_OP_KINDS: ReadonlySet<string> = new Set([
  "mre.record",
  "mre.verify",
  "mre.enroll-open",
  "mre.enroll-complete",
  "mre.enrollment-lookup",
  "mre.receipt-lookup",
  "mre.registry-count",
  "mre.asset-lifecycle",
]);
