/**
 * @fleetos/procurement — SLA penalty credits: posting an SLA evaluation's
 * penalty to an order's economics in integer minor units (the
 * vendors/procurement seam of the F280C SLA contract math).
 *
 * Wave 8 lane C (F280C) production-economics grade.
 *
 * Laws: A4 (exact credit, never clamped beyond the documented cap), A8
 * (tenant-scoped, fail-closed), A16, A20.
 *
 * Cross-context seam rule: the SLA evaluation lives in @fleetos/vendors;
 * procurement consumes a LOCAL structural penalty reference
 * (SlaPenaltyRefLike). The composing application binds the REAL vendors
 * evaluation at the composition site — this package does NOT import
 * @fleetos/vendors at runtime.
 *
 * Integer law (documented): the credit is
 *   min(floor(orderValueMinor * penaltyBps / 10000),
 *       floor(orderValueMinor * creditCapBps / 10000))
 * where orderValueMinor = orderedQuantity * unitCostMinor. Floor
 * division only — no floats, no rounding drift.
 */

import type { TenantScope } from "./contracts.js";
import { validateTenantScope } from "./contracts.js";
import type { OrderTotals } from "./commerce-math.js";

// ---------------------------------------------------------------------------
// LOCAL structural SLA penalty reference (cross-context seam).
// ---------------------------------------------------------------------------

/**
 * SlaPenaltyRefLike — the structural shape of a vendors SLA evaluation's
 * penalty summary. Structurally compatible with the SlaEvaluation fields
 * a credit needs; no runtime import of @fleetos/vendors.
 */
export interface SlaPenaltyRefLike {
  /** Digest of the SLA evaluation this penalty traces to (audit ref). */
  readonly evaluationDigest: string;
  readonly tenantId: string;
  /** Capped total penalty in integer basis points (0..10000). */
  readonly penaltyBps: number;
  /** Credit cap in integer basis points (0..10000). */
  readonly creditCapBps: number;
}

// ---------------------------------------------------------------------------
// SLA penalty credit application.
// ---------------------------------------------------------------------------

export interface SlaPenaltyCredit {
  readonly orderId: string;
  readonly tenant: TenantScope;
  /** The evaluation digest the credit traces to — verbatim. */
  readonly evaluationDigest: string;
  readonly orderValueMinor: number;
  readonly penaltyBps: number;
  readonly creditCapBps: number;
  /** floor(orderValue * penaltyBps / 10000), never above the cap amount. */
  readonly creditMinorUnits: number;
}

export type SlaCreditResult =
  | { readonly ok: true; readonly credit: SlaPenaltyCredit }
  | { readonly ok: false; readonly reasonCode: SlaCreditReasonCode };

export type SlaCreditReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "TENANT_MISMATCH"
  | "NEGATIVE_QUANTITY"
  | "EVALUATION_DIGEST_EMPTY"
  | "INVALID_PENALTY_BPS"
  | "INVALID_CREDIT_CAP_BPS";

/**
 * applySlaPenaltyCredit — posts an SLA penalty credit against an order's
 * value. The credit traces to the evaluation digest verbatim. Fail-closed
 * (law A8): a penalty assessed for another tenant can NEVER be applied to
 * this tenant's order (TENANT_MISMATCH).
 */
export function applySlaPenaltyCredit(
  order: OrderTotals,
  penalty: SlaPenaltyRefLike,
): SlaCreditResult {
  const orderTenant = validateTenantScope(order.tenant);
  if (!orderTenant.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  if (!Number.isInteger(order.orderedQuantity) || order.orderedQuantity <= 0) {
    return { ok: false, reasonCode: "NEGATIVE_QUANTITY" };
  }
  if (!Number.isInteger(order.unitCostMinor) || order.unitCostMinor < 0) {
    return { ok: false, reasonCode: "NEGATIVE_QUANTITY" };
  }
  if (penalty.evaluationDigest.length === 0) {
    return { ok: false, reasonCode: "EVALUATION_DIGEST_EMPTY" };
  }
  if (!Number.isInteger(penalty.penaltyBps) || penalty.penaltyBps < 0 || penalty.penaltyBps > 10000) {
    return { ok: false, reasonCode: "INVALID_PENALTY_BPS" };
  }
  if (!Number.isInteger(penalty.creditCapBps) || penalty.creditCapBps < 0 || penalty.creditCapBps > 10000) {
    return { ok: false, reasonCode: "INVALID_CREDIT_CAP_BPS" };
  }
  if (penalty.tenantId !== orderTenant.scope.tenantId) {
    return { ok: false, reasonCode: "TENANT_MISMATCH" };
  }
  const orderValueMinor = order.orderedQuantity * order.unitCostMinor;
  const penaltyAmount = Math.floor((orderValueMinor * penalty.penaltyBps) / 10000);
  const capAmount = Math.floor((orderValueMinor * penalty.creditCapBps) / 10000);
  const creditMinorUnits = Math.min(penaltyAmount, capAmount);
  return {
    ok: true,
    credit: {
      orderId: order.orderId,
      tenant: orderTenant.scope,
      evaluationDigest: penalty.evaluationDigest,
      orderValueMinor,
      penaltyBps: penalty.penaltyBps,
      creditCapBps: penalty.creditCapBps,
      creditMinorUnits,
    },
  };
}
