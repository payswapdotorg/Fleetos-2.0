/**
 * @fleetos/vendors — Capability catalog (declared vs verified) +
 * deterministic performance KPI rollups from fulfillment outcomes.
 *
 * Wave 2 lane C (F220C) operational-truth grade.
 *
 * Laws: A3 (verification requires evidence — a declaration is not a
 * verification), A8 (tenant-scoped, fail-closed), A13, A20.
 *
 * NO FLOATS in decision outputs: every ratio is an integer number of
 * basis points. Time is an explicit `number` input.
 */

import type { TenantScope } from "./contracts.js";
import { validateTenantScope } from "./contracts.js";

// ---------------------------------------------------------------------------
// LOCAL structural evidence reference (cross-worker seam, law A13).
// ---------------------------------------------------------------------------

export interface EvidenceRefLike {
  readonly evidenceId: string;
  readonly tenantId: string;
}

// ---------------------------------------------------------------------------
// Capability catalog: declared vs verified capabilities.
// ---------------------------------------------------------------------------

export type CapabilityVerificationStatus = "declared" | "verified";

export interface VendorCapabilityRecord {
  readonly vendorId: string;
  readonly tenant: TenantScope;
  readonly tag: string;
  readonly status: CapabilityVerificationStatus;
  readonly verifiedAt: number | null;
  readonly evidence: EvidenceRefLike | null;
}

export type VerifyCapabilityResult =
  | { readonly ok: true; readonly records: readonly VendorCapabilityRecord[] }
  | { readonly ok: false; readonly reasonCode: CapabilityReasonCode };

export type CapabilityReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "TENANT_MISMATCH"
  | "UNKNOWN_CAPABILITY"
  | "ALREADY_VERIFIED"
  | "VERIFICATION_EVIDENCE_REQUIRED"
  | "VERIFICATION_EVIDENCE_TENANT_MISMATCH";

/**
 * verifyCapability — verification REQUIRES an evidence ref from the same
 * tenant (law A13). A declared capability with no evidence stays
 * declared — it is never silently promoted to verified.
 */
export function verifyCapability(
  records: readonly VendorCapabilityRecord[],
  vendorId: string,
  tag: string,
  evidence: EvidenceRefLike | null | undefined,
  verifiedAt: number,
): VerifyCapabilityResult {
  const index = records.findIndex(
    (r) => r.vendorId === vendorId && r.tag === tag,
  );
  if (index === -1) {
    return { ok: false, reasonCode: "UNKNOWN_CAPABILITY" };
  }
  const target = records[index];
  if (target === undefined) {
    return { ok: false, reasonCode: "UNKNOWN_CAPABILITY" };
  }
  const targetTenant = validateTenantScope(target.tenant);
  if (!targetTenant.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  if (target.status === "verified") {
    return { ok: false, reasonCode: "ALREADY_VERIFIED" };
  }
  if (evidence === null || evidence === undefined || evidence.evidenceId.length === 0) {
    return { ok: false, reasonCode: "VERIFICATION_EVIDENCE_REQUIRED" };
  }
  if (evidence.tenantId !== targetTenant.scope.tenantId) {
    return { ok: false, reasonCode: "VERIFICATION_EVIDENCE_TENANT_MISMATCH" };
  }
  const next: VendorCapabilityRecord = {
    ...target,
    status: "verified",
    verifiedAt,
    evidence,
  };
  const updated = [...records];
  updated[index] = next;
  return { ok: true, records: updated };
}

export interface CapabilityCatalogSummary {
  readonly vendorId: string;
  readonly tenant: TenantScope;
  readonly declaredCount: number;
  readonly verifiedCount: number;
}

/**
 * capabilityCatalogSummary — deterministic per-vendor read model. Only
 * records matching BOTH the tenant and the vendor are counted.
 */
export function capabilityCatalogSummary(
  tenant: TenantScope,
  records: readonly VendorCapabilityRecord[],
  vendorId: string,
): CapabilityCatalogSummary {
  const tenantCheck = validateTenantScope(tenant);
  const declaredCount = 0;
  const verifiedCount = 0;
  if (!tenantCheck.ok) {
    return { vendorId, tenant, declaredCount, verifiedCount };
  }
  let d = 0;
  let v = 0;
  for (const r of records) {
    const rTenant = validateTenantScope(r.tenant);
    if (!rTenant.ok) continue;
    if (rTenant.scope.tenantId !== tenantCheck.scope.tenantId) continue;
    if (r.vendorId !== vendorId) continue;
    if (r.status === "verified") v += 1;
    else d += 1;
  }
  return { vendorId, tenant: tenantCheck.scope, declaredCount: d, verifiedCount: v };
}

// ---------------------------------------------------------------------------
// Performance records — deterministic KPI rollups from fulfillment
// outcomes (integer basis points).
// ---------------------------------------------------------------------------

export interface FulfillmentOutcomeRecord {
  readonly vendorId: string;
  readonly tenant: TenantScope;
  readonly orderId: string;
  readonly promisedAt: number;
  readonly deliveredAt: number;
  readonly quantityOrdered: number;
  readonly quantityReceived: number;
}

export interface VendorKpiRollup {
  readonly vendorId: string;
  readonly tenant: TenantScope;
  readonly outcomeCount: number;
  readonly onTimeCount: number;
  /** floor(onTimeCount * 10000 / outcomeCount) — integer basis points. */
  readonly onTimeRatioBps: number;
  readonly quantityOrderedTotal: number;
  readonly quantityReceivedTotal: number;
  /** floor(quantityReceivedTotal * 10000 / quantityOrderedTotal). */
  readonly fillRateBps: number;
}

export type KpiRollupResult =
  | { readonly ok: true; readonly rollup: VendorKpiRollup }
  | { readonly ok: false; readonly reasonCode: KpiReasonCode };

export type KpiReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "EMPTY_PERFORMANCE_HISTORY"
  | "NEGATIVE_QUANTITY";

/**
 * rollupVendorKpis — deterministic KPI rollup over a vendor's fulfillment
 * outcomes. On-time means deliveredAt <= promisedAt. All ratios are
 * integer basis points (floored). Outcomes from other tenants are
 * ignored (tenant-scoped read model).
 */
export function rollupVendorKpis(
  tenant: TenantScope,
  records: readonly FulfillmentOutcomeRecord[],
  vendorId: string,
): KpiRollupResult {
  const tenantCheck = validateTenantScope(tenant);
  if (!tenantCheck.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  const scoped: FulfillmentOutcomeRecord[] = [];
  for (const r of records) {
    const rTenant = validateTenantScope(r.tenant);
    if (!rTenant.ok) continue;
    if (rTenant.scope.tenantId !== tenantCheck.scope.tenantId) continue;
    if (r.vendorId !== vendorId) continue;
    if (
      !Number.isInteger(r.quantityOrdered) ||
      r.quantityOrdered < 0 ||
      !Number.isInteger(r.quantityReceived) ||
      r.quantityReceived < 0
    ) {
      return { ok: false, reasonCode: "NEGATIVE_QUANTITY" };
    }
    scoped.push(r);
  }
  if (scoped.length === 0) {
    return { ok: false, reasonCode: "EMPTY_PERFORMANCE_HISTORY" };
  }
  let onTimeCount = 0;
  let quantityOrderedTotal = 0;
  let quantityReceivedTotal = 0;
  for (const r of scoped) {
    if (r.deliveredAt <= r.promisedAt) onTimeCount += 1;
    quantityOrderedTotal += r.quantityOrdered;
    quantityReceivedTotal += r.quantityReceived;
  }
  const onTimeRatioBps = Math.floor((onTimeCount * 10000) / scoped.length);
  const fillRateBps =
    quantityOrderedTotal === 0
      ? 10000
      : Math.floor((quantityReceivedTotal * 10000) / quantityOrderedTotal);
  return {
    ok: true,
    rollup: {
      vendorId,
      tenant: tenantCheck.scope,
      outcomeCount: scoped.length,
      onTimeCount,
      onTimeRatioBps,
      quantityOrderedTotal,
      quantityReceivedTotal,
      fillRateBps,
    },
  };
}
