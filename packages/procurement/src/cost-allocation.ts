/**
 * @fleetos/procurement — Cost allocation across work orders: deterministic
 * keys, an exact-sum allocation law (integer minor units only — no
 * rounding drift), and partial-fulfillment accounting laws where partial
 * rows sum EXACTLY to the order total.
 *
 * Wave 8 lane C (F280C) production-economics grade.
 *
 * Laws: A1 (the allocation output is the accounting record), A4 (never
 * silently lose or invent a minor unit), A8 (tenant-scoped, fail-closed),
 * A16, A20.
 *
 * ALLOCATION LAW (documented, machine-tested):
 *   - Input weights are integer basis points per work order and MUST sum
 *     to exactly 10000 (any other sum refuses — no normalization).
 *   - Base allocation: floor(totalMinorUnits * shareBps / 10000) per key.
 *   - Remainder R = totalMinorUnits - Σbase is distributed one minor unit
 *     at a time to the keys with the LARGEST fractional remainder
 *     ((total * shareBps) mod 10000), ties broken by workOrderId lexical
 *     order — the documented deterministic tie-break.
 *   - Invariant: Σ allocations == totalMinorUnits EXACTLY, always
 *     (machine-tested over awkward divisions).
 *   - Output ordering: workOrderId lexical — the deterministic key order.
 */

import type { TenantScope } from "./contracts.js";
import { validateTenantScope } from "./contracts.js";

// ---------------------------------------------------------------------------
// Cost allocation across work orders.
// ---------------------------------------------------------------------------

export interface WorkOrderCostShare {
  readonly workOrderId: string;
  /** Integer basis points; all shares MUST sum to exactly 10000. */
  readonly shareBps: number;
  readonly tenant: TenantScope;
}

export interface WorkOrderCostAllocation {
  readonly workOrderId: string;
  readonly shareBps: number;
  readonly amountMinorUnits: number;
}

export interface CostAllocationInput {
  readonly tenant: TenantScope;
  readonly orderId: string;
  /** Integer minor units to be allocated EXACTLY across the work orders. */
  readonly totalMinorUnits: number;
  readonly shares: readonly WorkOrderCostShare[];
}

export type CostAllocationResult =
  | {
      readonly ok: true;
      readonly allocations: readonly WorkOrderCostAllocation[];
      readonly totalAllocatedMinorUnits: number;
      /** The allocation law, verbatim for evidence. */
      readonly law: "largest-remainder-bps-tie-break-work-order-id-lexical";
    }
  | { readonly ok: false; readonly reasonCode: CostAllocationReasonCode };

export type CostAllocationReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "TENANT_MISMATCH"
  | "ORDER_ID_EMPTY"
  | "NO_SHARES"
  | "WORK_ORDER_ID_EMPTY"
  | "WORK_ORDER_ID_DUPLICATE"
  | "INVALID_TOTAL"
  | "INVALID_SHARE_BPS"
  | "SHARES_MUST_SUM_TO_10000";

/**
 * allocateCostAcrossWorkOrders — deterministic exact-sum allocation of an
 * order's total cost across work orders (largest remainder over integer
 * bps weights; documented tie-break). Fail-closed: a foreign-tenant share
 * refuses the whole allocation.
 */
export function allocateCostAcrossWorkOrders(
  input: CostAllocationInput,
): CostAllocationResult {
  const tenantCheck = validateTenantScope(input.tenant);
  if (!tenantCheck.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  if (input.orderId.length === 0) return { ok: false, reasonCode: "ORDER_ID_EMPTY" };
  if (input.shares.length === 0) return { ok: false, reasonCode: "NO_SHARES" };
  if (!Number.isInteger(input.totalMinorUnits) || input.totalMinorUnits < 0) {
    return { ok: false, reasonCode: "INVALID_TOTAL" };
  }
  const seen = new Set<string>();
  let shareSum = 0;
  for (const share of input.shares) {
    if (share.workOrderId.length === 0) {
      return { ok: false, reasonCode: "WORK_ORDER_ID_EMPTY" };
    }
    if (seen.has(share.workOrderId)) {
      return { ok: false, reasonCode: "WORK_ORDER_ID_DUPLICATE" };
    }
    seen.add(share.workOrderId);
    if (!Number.isInteger(share.shareBps) || share.shareBps < 0) {
      return { ok: false, reasonCode: "INVALID_SHARE_BPS" };
    }
    const shareTenant = validateTenantScope(share.tenant);
    if (!shareTenant.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
    if (shareTenant.scope.tenantId !== tenantCheck.scope.tenantId) {
      return { ok: false, reasonCode: "TENANT_MISMATCH" };
    }
    shareSum += share.shareBps;
  }
  if (shareSum !== 10000) {
    return { ok: false, reasonCode: "SHARES_MUST_SUM_TO_10000" };
  }
  // Deterministic key order: workOrderId lexical.
  const ordered = [...input.shares].sort((a, b) => a.workOrderId.localeCompare(b.workOrderId));
  const base = ordered.map((share) => {
    const exact = input.totalMinorUnits * share.shareBps;
    return {
      workOrderId: share.workOrderId,
      shareBps: share.shareBps,
      baseAmount: Math.floor(exact / 10000),
      remainder: exact % 10000,
    };
  });
  let distributed = base.reduce((acc, b) => acc + b.baseAmount, 0);
  const remainder = input.totalMinorUnits - distributed;
  // Largest fractional remainder first; ties -> lexical workOrderId (the
  // array is already in lexical order, and sort is stable).
  const byRemainder = [...base].sort((a, b) => b.remainder - a.remainder);
  const bumps = new Map<string, number>();
  for (let i = 0; i < remainder; i++) {
    const target = byRemainder[i % byRemainder.length];
    if (target === undefined) break;
    bumps.set(target.workOrderId, (bumps.get(target.workOrderId) ?? 0) + 1);
    distributed += 1;
  }
  const allocations: WorkOrderCostAllocation[] = base.map((b) => ({
    workOrderId: b.workOrderId,
    shareBps: b.shareBps,
    amountMinorUnits: b.baseAmount + (bumps.get(b.workOrderId) ?? 0),
  }));
  return {
    ok: true,
    allocations,
    totalAllocatedMinorUnits: distributed,
    law: "largest-remainder-bps-tie-break-work-order-id-lexical",
  };
}

// ---------------------------------------------------------------------------
// Partial-fulfillment accounting laws.
// ---------------------------------------------------------------------------

export interface PartialFulfillmentRow {
  readonly fulfillmentId: string;
  readonly quantity: number;
  readonly tenant: TenantScope;
}

export interface PartialFulfillmentAllocationRow {
  readonly fulfillmentId: string;
  readonly quantity: number;
  readonly amountMinorUnits: number;
}

export type PartialFulfillmentAllocationResult =
  | {
      readonly ok: true;
      readonly rows: readonly PartialFulfillmentAllocationRow[];
      readonly totalMinorUnits: number;
      readonly totalAllocatedMinorUnits: number;
      readonly law: "largest-remainder-by-quantity-tie-break-fulfillment-id-lexical";
    }
  | { readonly ok: false; readonly reasonCode: PartialFulfillmentReasonCode };

export type PartialFulfillmentReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "TENANT_MISMATCH"
  | "ORDER_ID_EMPTY"
  | "INVALID_TOTAL"
  | "NO_PARTIALS"
  | "FULFILLMENT_ID_EMPTY"
  | "FULFILLMENT_ID_DUPLICATE"
  | "INVALID_QUANTITY"
  | "ZERO_TOTAL_QUANTITY";

/**
 * allocatePartialFulfillmentAmounts — splits an order's total cost across
 * its partial fulfillment rows so the rows sum EXACTLY to the order
 * total (integer minor units only — no rounding drift). Each row's exact
 * share is proportional to its quantity; base amounts use floor
 * division; the remainder is distributed by largest fractional remainder
 * with lexical fulfillmentId tie-break (the documented law). Fail-closed:
 * a foreign-tenant partial row refuses the whole allocation.
 */
export function allocatePartialFulfillmentAmounts(
  tenant: TenantScope,
  order: { readonly orderId: string; readonly totalMinorUnits: number },
  partials: readonly PartialFulfillmentRow[],
): PartialFulfillmentAllocationResult {
  const tenantCheck = validateTenantScope(tenant);
  if (!tenantCheck.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  if (order.orderId.length === 0) return { ok: false, reasonCode: "ORDER_ID_EMPTY" };
  if (!Number.isInteger(order.totalMinorUnits) || order.totalMinorUnits < 0) {
    return { ok: false, reasonCode: "INVALID_TOTAL" };
  }
  if (partials.length === 0) return { ok: false, reasonCode: "NO_PARTIALS" };
  const seen = new Set<string>();
  for (const row of partials) {
    if (row.fulfillmentId.length === 0) {
      return { ok: false, reasonCode: "FULFILLMENT_ID_EMPTY" };
    }
    if (seen.has(row.fulfillmentId)) {
      return { ok: false, reasonCode: "FULFILLMENT_ID_DUPLICATE" };
    }
    seen.add(row.fulfillmentId);
    if (!Number.isInteger(row.quantity) || row.quantity <= 0) {
      return { ok: false, reasonCode: "INVALID_QUANTITY" };
    }
    const rowTenant = validateTenantScope(row.tenant);
    if (!rowTenant.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
    if (rowTenant.scope.tenantId !== tenantCheck.scope.tenantId) {
      return { ok: false, reasonCode: "TENANT_MISMATCH" };
    }
  }
  const totalQuantity = partials.reduce((acc, r) => acc + r.quantity, 0);
  if (totalQuantity === 0) return { ok: false, reasonCode: "ZERO_TOTAL_QUANTITY" };
  const ordered = [...partials].sort((a, b) => a.fulfillmentId.localeCompare(b.fulfillmentId));
  const base = ordered.map((row) => {
    const exact = order.totalMinorUnits * row.quantity;
    return {
      fulfillmentId: row.fulfillmentId,
      quantity: row.quantity,
      baseAmount: Math.floor(exact / totalQuantity),
      remainder: exact % totalQuantity,
    };
  });
  let distributed = base.reduce((acc, b) => acc + b.baseAmount, 0);
  const remainder = order.totalMinorUnits - distributed;
  const byRemainder = [...base].sort((a, b) => b.remainder - a.remainder);
  const bumps = new Map<string, number>();
  for (let i = 0; i < remainder; i++) {
    const target = byRemainder[i % byRemainder.length];
    if (target === undefined) break;
    bumps.set(target.fulfillmentId, (bumps.get(target.fulfillmentId) ?? 0) + 1);
    distributed += 1;
  }
  const rows: PartialFulfillmentAllocationRow[] = base.map((b) => ({
    fulfillmentId: b.fulfillmentId,
    quantity: b.quantity,
    amountMinorUnits: b.baseAmount + (bumps.get(b.fulfillmentId) ?? 0),
  }));
  return {
    ok: true,
    rows,
    totalMinorUnits: order.totalMinorUnits,
    totalAllocatedMinorUnits: distributed,
    law: "largest-remainder-by-quantity-tie-break-fulfillment-id-lexical",
  };
}

export type PartialFulfillmentSumVerification =
  | { readonly ok: true; readonly sumMinorUnits: number }
  | {
      readonly ok: false;
      readonly reasonCode: "ROWS_DO_NOT_SUM_TO_ORDER_TOTAL";
      /** Signed drift: sum(rows) - total (exact, never clamped). */
      readonly driftMinorUnits: number;
    };

/**
 * verifyPartialFulfillmentSums — the partial accounting LAW as a check:
 * the partial rows must sum EXACTLY to the order total. Any drift — even
 * one minor unit — refuses with the exact signed drift (integer bps only,
 * no rounding drift tolerated).
 */
export function verifyPartialFulfillmentSums(
  order: { readonly orderId: string; readonly totalMinorUnits: number },
  rows: readonly { readonly fulfillmentId: string; readonly amountMinorUnits: number }[],
): PartialFulfillmentSumVerification {
  const sum = rows.reduce((acc, r) => acc + r.amountMinorUnits, 0);
  if (sum === order.totalMinorUnits) {
    return { ok: true, sumMinorUnits: sum };
  }
  return {
    ok: false,
    reasonCode: "ROWS_DO_NOT_SUM_TO_ORDER_TOTAL",
    driftMinorUnits: sum - order.totalMinorUnits,
  };
}
