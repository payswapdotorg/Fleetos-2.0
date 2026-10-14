/**
 * @fleetos/vendors — The supplier verification contract (F361C, Wave 17
 * lane C; the F360 freeze §3.3).
 *
 * The frozen state machine:
 *   pending -> verified | expired | suspended
 * (plus the verified -> expired lapse and verified -> suspension; the
 * terminal states are expired and suspended — the machine is frozen in
 * the record type below and machine-tested.)
 *
 * Documented laws (machine-tested in tests/supplier-verification.test.ts):
 *   - VERIFICATION REQUIRES EVIDENCE (law A3/A13): pending -> verified
 *     requires an evidence reference from the SAME tenant plus
 *     verified-at and an expires-at strictly after verified-at. A
 *     declaration is never silently promoted to a verification.
 *   - VERIFIED-ONLY ENTER MATCHING (freeze §3.3): `supplierVerificationGate`
 *     admits ONLY suppliers whose verification is BOTH status "verified"
 *     AND current at the caller-supplied instant (at <= expiresAt — the
 *     WINDOW LAW boundary is inclusive). Pending, suspended, lapsed and
 *     unknown suppliers are excluded WITH per-supplier reason codes
 *     (honest exclusion — an expired verification NEVER silently enters
 *     matching).
 *   - EXPIRY IS HONEST: the explicit expire transition refuses
 *     NOT_EXPIRED_YET while at <= expiresAt — a verification never
 *     expires early.
 *   - FAIL-CLOSED: a foreign-tenant verification record in the gate
 *     input REFUSES the whole gate (TENANT_MISMATCH, law A8) — never
 *     silently filtered.
 *
 * Laws: A1, A3, A4, A8, A13, A20. Pure deterministic TS; time is an
 * explicit `number` input (epoch ms).
 */

import type { TenantScope } from "./contracts.js";
import { validateTenantScope } from "./contracts.js";

// ---------------------------------------------------------------------------
// LOCAL structural evidence reference (cross-worker seam, law A13) —
// structurally identical to the procurement/evidence packages' refs.
// ---------------------------------------------------------------------------

export interface SupplierEvidenceRef {
  readonly evidenceId: string;
  readonly tenantId: string;
}

// ---------------------------------------------------------------------------
// The supplier verification record (freeze §3.3).
// ---------------------------------------------------------------------------

export type SupplierVerificationStatus = "pending" | "verified" | "expired" | "suspended";

export interface SupplierVerificationRecord {
  readonly supplierId: string;
  readonly tenant: TenantScope;
  readonly status: SupplierVerificationStatus;
  /** Verification evidence reference — REQUIRED for verified (law A3). */
  readonly evidence: SupplierEvidenceRef | null;
  readonly verifiedAt: number | null;
  readonly expiresAt: number | null;
  readonly suspendedReason: string | null;
}

export type SupplierVerificationCommand =
  | { type: "verify"; evidence: SupplierEvidenceRef; verifiedAt: number; expiresAt: number }
  | { type: "suspend"; reason: string }
  | { type: "expire"; at: number };

/** The allowed-transition matrix — the single source of legality. */
export const SUPPLIER_VERIFICATION_ALLOWED: Readonly<
  Record<SupplierVerificationStatus, readonly SupplierVerificationCommand["type"][]>
> = {
  pending: ["verify", "suspend", "expire"],
  verified: ["suspend", "expire"],
  expired: [],
  suspended: [],
};

export type SupplierVerificationReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "ILLEGAL_TRANSITION"
  | "SUPPLIER_ID_REQUIRED"
  | "VERIFICATION_EVIDENCE_REQUIRED"
  | "VERIFICATION_EVIDENCE_TENANT_MISMATCH"
  | "EXPIRY_BEFORE_VERIFICATION"
  | "SUSPEND_REASON_REQUIRED"
  | "NOT_EXPIRED_YET"
  | "INVALID_EXPIRY_TIME";

export type SupplierVerificationTransition =
  | { readonly ok: true; readonly next: SupplierVerificationRecord }
  | { readonly ok: false; readonly reasonCode: SupplierVerificationReasonCode };

/** openSupplierVerification — creates a PENDING verification record. */
export function openSupplierVerification(
  tenant: TenantScope,
  supplierId: string,
): SupplierVerificationTransition {
  const tenantCheck = validateTenantScope(tenant);
  if (!tenantCheck.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  if (supplierId.length === 0) return { ok: false, reasonCode: "SUPPLIER_ID_REQUIRED" };
  return {
    ok: true,
    next: {
      supplierId,
      tenant: tenantCheck.scope,
      status: "pending",
      evidence: null,
      verifiedAt: null,
      expiresAt: null,
      suspendedReason: null,
    },
  };
}

/**
 * transitionSupplierVerification — the pure §3.3 machine. `verify`
 * requires same-tenant evidence + a strictly-later expiry; `suspend`
 * requires a reason; `expire` fires ONLY once the expiry has actually
 * lapsed (at > expiresAt) — a verification never expires early.
 */
export function transitionSupplierVerification(
  current: SupplierVerificationRecord,
  command: SupplierVerificationCommand,
): SupplierVerificationTransition {
  const tenantCheck = validateTenantScope(current.tenant);
  if (!tenantCheck.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  const allowed = SUPPLIER_VERIFICATION_ALLOWED[current.status] ?? [];
  if (!allowed.includes(command.type)) {
    return { ok: false, reasonCode: "ILLEGAL_TRANSITION" };
  }
  switch (command.type) {
    case "verify": {
      if (command.evidence.evidenceId.length === 0) {
        return { ok: false, reasonCode: "VERIFICATION_EVIDENCE_REQUIRED" };
      }
      if (command.evidence.tenantId !== tenantCheck.scope.tenantId) {
        return { ok: false, reasonCode: "VERIFICATION_EVIDENCE_TENANT_MISMATCH" };
      }
      if (!Number.isInteger(command.verifiedAt) || command.verifiedAt < 0) {
        return { ok: false, reasonCode: "EXPIRY_BEFORE_VERIFICATION" };
      }
      if (!Number.isInteger(command.expiresAt) || command.expiresAt <= command.verifiedAt) {
        return { ok: false, reasonCode: "EXPIRY_BEFORE_VERIFICATION" };
      }
      return {
        ok: true,
        next: {
          ...current,
          status: "verified",
          evidence: command.evidence,
          verifiedAt: command.verifiedAt,
          expiresAt: command.expiresAt,
        },
      };
    }
    case "suspend": {
      if (command.reason.trim().length === 0) {
        return { ok: false, reasonCode: "SUSPEND_REASON_REQUIRED" };
      }
      return { ok: true, next: { ...current, status: "suspended", suspendedReason: command.reason } };
    }
    case "expire": {
      if (current.expiresAt === null) {
        // A pending record with no expiry horizon cannot lapse.
        return { ok: false, reasonCode: "INVALID_EXPIRY_TIME" };
      }
      if (!Number.isInteger(command.at) || command.at < 0) {
        return { ok: false, reasonCode: "INVALID_EXPIRY_TIME" };
      }
      // WINDOW LAW: at == expiresAt is still inside; at > expiresAt lapses.
      if (command.at <= current.expiresAt) {
        return { ok: false, reasonCode: "NOT_EXPIRED_YET" };
      }
      return { ok: true, next: { ...current, status: "expired" } };
    }
  }
}

// ---------------------------------------------------------------------------
// The verified-only matching gate (freeze §3.3).
// ---------------------------------------------------------------------------

export type SupplierGateExclusionReason =
  | "SUPPLIER_PENDING"
  | "VERIFICATION_EXPIRED"
  | "SUPPLIER_SUSPENDED"
  | "VERIFICATION_ABSENT";

export interface SupplierGateEntry {
  readonly supplierId: string;
  readonly current: boolean;
  readonly exclusionReason: SupplierGateExclusionReason | null;
}

export type SupplierVerificationGateResult =
  | {
      readonly ok: true;
      /** Supplier ids admitted to matching (deterministic: supplierId lexical). */
      readonly admittedSupplierIds: readonly string[];
      /** Every non-admitted supplier with its reason — honest exclusion. */
      readonly excluded: readonly SupplierGateEntry[];
      readonly admittedCount: number;
    }
  | { readonly ok: false; readonly reasonCode: "TENANT_SCOPE_MISSING" | "TENANT_MISMATCH" };

/**
 * isSupplierVerificationCurrent — the pure currency check: status
 * "verified" AND at <= expiresAt (the boundary instant is inside).
 */
export function isSupplierVerificationCurrent(
  record: SupplierVerificationRecord,
  at: number,
): boolean {
  return record.status === "verified" && record.expiresAt !== null && at <= record.expiresAt;
}

/**
 * supplierVerificationGate — VERIFIED-ONLY ENTER MATCHING. Admits only
 * suppliers whose verification record is verified AND current at `at`;
 * every other supplier is excluded with its reason code. A
 * foreign-tenant record in the input REFUSES the whole gate
 * (fail-closed, law A8).
 */
export function supplierVerificationGate(
  tenant: TenantScope,
  records: readonly SupplierVerificationRecord[],
  at: number,
): SupplierVerificationGateResult {
  const tenantCheck = validateTenantScope(tenant);
  if (!tenantCheck.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  const admitted: string[] = [];
  const excluded: SupplierGateEntry[] = [];
  for (const record of records) {
    const recordTenant = validateTenantScope(record.tenant);
    if (!recordTenant.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
    if (recordTenant.scope.tenantId !== tenantCheck.scope.tenantId) {
      return { ok: false, reasonCode: "TENANT_MISMATCH" };
    }
    let exclusionReason: SupplierGateExclusionReason | null = null;
    if (record.status === "pending") exclusionReason = "SUPPLIER_PENDING";
    else if (record.status === "suspended") exclusionReason = "SUPPLIER_SUSPENDED";
    else if (record.status === "expired") exclusionReason = "VERIFICATION_EXPIRED";
    else if (record.expiresAt === null || at > record.expiresAt) {
      // Verified on paper but the expiry has lapsed — never silently current.
      exclusionReason = "VERIFICATION_EXPIRED";
    }
    if (exclusionReason === null) admitted.push(record.supplierId);
    else excluded.push({ supplierId: record.supplierId, current: false, exclusionReason });
  }
  admitted.sort((a, b) => a.localeCompare(b));
  excluded.sort((a, b) => a.supplierId.localeCompare(b.supplierId));
  return { ok: true, admittedSupplierIds: admitted, excluded, admittedCount: admitted.length };
}

/** findSupplierVerification — fail-closed tenant read (null for other tenants). */
export function findSupplierVerification(
  tenant: TenantScope,
  records: readonly SupplierVerificationRecord[],
  supplierId: string,
): SupplierVerificationRecord | null {
  const tenantCheck = validateTenantScope(tenant);
  if (!tenantCheck.ok) return null;
  const found = records.find(
    (r) =>
      r.supplierId === supplierId && r.tenant.tenantId === tenantCheck.scope.tenantId,
  );
  return found ?? null;
}
