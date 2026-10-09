/**
 * @fleetos/procurement — Reconciliation at volume: batched, bounded,
 * deterministic ordering over many orders. Each order is reconciled with
 * the REAL reconcileOrderTotals law (commerce-math); batching NEVER
 * changes the per-order result (machine-tested: batched == unbatched).
 *
 * Wave 8 lane C (F280C) production-economics grade.
 *
 * Laws: A1, A4 (refusals are never silent drops), A8 (tenant-scoped,
 * fail-closed), A16, A20.
 *
 * ORDERING LAW (documented, machine-tested):
 *   - Orders are processed in orderId LEXICAL order — input order never
 *     leaks into the output.
 *   - Receipts are grouped per order keeping their input order (stable).
 *   - Batches are CONTIGUOUS slices of the sorted order list, each of at
 *     most `batchSize` orders (the last batch may be smaller). The batch
 *     boundaries are deterministic functions of (sorted orders,
 *     batchSize) — nothing else.
 *   - batchSize must be an integer in [1, 500] — the documented bound.
 *   - A receipt referencing an order NOT in the input refuses the whole
 *     run (RECEIPT_ORDER_MISMATCH) — never silently dropped.
 *   - A foreign-tenant order or receipt refuses the whole run
 *     (TENANT_MISMATCH) — fail-closed, never silently filtered.
 */

import type { TenantScope } from "./contracts.js";
import { validateTenantScope } from "./contracts.js";
import type { OrderTotals, OrderReceipt, OrderReconciliation } from "./commerce-math.js";
import { reconcileOrderTotals } from "./commerce-math.js";

// ---------------------------------------------------------------------------
// Batched reconciliation.
// ---------------------------------------------------------------------------

export const RECONCILIATION_BATCH_MIN = 1;
export const RECONCILIATION_BATCH_MAX = 500;

export interface ReconciliationBatch {
  readonly batchIndex: number;
  readonly orderIds: readonly string[];
  readonly reconciliations: readonly OrderReconciliation[];
}

export interface BatchedReconciliationReport {
  readonly tenant: TenantScope;
  readonly batchSize: number;
  readonly batchCount: number;
  readonly batches: readonly ReconciliationBatch[];
  readonly orderCount: number;
  readonly receiptCount: number;
  /** The ordering law, verbatim for evidence. */
  readonly ordering: "order-id-lexical-contiguous-batches";
  /** Orders classified exact by the REAL reconcileOrderTotals law. */
  readonly exactCount: number;
  readonly shortCount: number;
  readonly overCount: number;
}

export type BatchedReconciliationResult =
  | { readonly ok: true; readonly report: BatchedReconciliationReport }
  | { readonly ok: false; readonly reasonCode: BatchedReconciliationReasonCode };

export type BatchedReconciliationReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "TENANT_MISMATCH"
  | "NO_ORDERS"
  | "BATCH_SIZE_OUT_OF_RANGE"
  | "ORDER_ID_EMPTY"
  | "ORDER_ID_DUPLICATE"
  | "RECEIPT_ORDER_MISMATCH"
  | "RECONCILIATION_REFUSED";

/**
 * reconcileOrdersBatched — reconciliation at volume over the REAL
 * per-order law. Deterministic ordering (orderId lexical), contiguous
 * bounded batches, per-order results IDENTICAL to running
 * reconcileOrderTotals order-by-order (machine-tested). Any per-order
 * refusal (foreign tenant, negative quantity, receipt mismatch) refuses
 * the entire run with the refusal's reason code — partial results are
 * never returned.
 */
export function reconcileOrdersBatched(
  tenant: TenantScope,
  orders: readonly OrderTotals[],
  receipts: readonly OrderReceipt[],
  batchSize: number,
): BatchedReconciliationResult {
  const tenantCheck = validateTenantScope(tenant);
  if (!tenantCheck.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  if (orders.length === 0) return { ok: false, reasonCode: "NO_ORDERS" };
  if (
    !Number.isInteger(batchSize) ||
    batchSize < RECONCILIATION_BATCH_MIN ||
    batchSize > RECONCILIATION_BATCH_MAX
  ) {
    return { ok: false, reasonCode: "BATCH_SIZE_OUT_OF_RANGE" };
  }
  for (const order of orders) {
    const orderTenant = validateTenantScope(order.tenant);
    if (!orderTenant.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
    if (orderTenant.scope.tenantId !== tenantCheck.scope.tenantId) {
      return { ok: false, reasonCode: "TENANT_MISMATCH" };
    }
    if (order.orderId.length === 0) return { ok: false, reasonCode: "ORDER_ID_EMPTY" };
  }
  const seenOrderIds = new Set<string>();
  for (const order of orders) {
    if (seenOrderIds.has(order.orderId)) {
      return { ok: false, reasonCode: "ORDER_ID_DUPLICATE" };
    }
    seenOrderIds.add(order.orderId);
  }
  for (const receipt of receipts) {
    const receiptTenant = validateTenantScope(receipt.tenant);
    if (!receiptTenant.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
    if (receiptTenant.scope.tenantId !== tenantCheck.scope.tenantId) {
      return { ok: false, reasonCode: "TENANT_MISMATCH" };
    }
    if (!seenOrderIds.has(receipt.orderId)) {
      return { ok: false, reasonCode: "RECEIPT_ORDER_MISMATCH" };
    }
  }
  // Deterministic ordering: orderId lexical (input order never leaks).
  const ordered = [...orders].sort((a, b) => a.orderId.localeCompare(b.orderId));
  const receiptsByOrder = new Map<string, OrderReceipt[]>();
  for (const receipt of receipts) {
    const bucket = receiptsByOrder.get(receipt.orderId);
    if (bucket === undefined) {
      receiptsByOrder.set(receipt.orderId, [receipt]);
    } else {
      bucket.push(receipt);
    }
  }
  const batches: ReconciliationBatch[] = [];
  let exactCount = 0;
  let shortCount = 0;
  let overCount = 0;
  for (let batchIndex = 0; batchIndex * batchSize < ordered.length; batchIndex++) {
    const slice = ordered.slice(batchIndex * batchSize, (batchIndex + 1) * batchSize);
    const reconciliations: OrderReconciliation[] = [];
    for (const order of slice) {
      const result = reconcileOrderTotals(order, receiptsByOrder.get(order.orderId) ?? []);
      if (!result.ok) {
        return { ok: false, reasonCode: "RECONCILIATION_REFUSED" };
      }
      reconciliations.push(result.reconciliation);
      if (result.reconciliation.classification === "exact") exactCount += 1;
      else if (result.reconciliation.classification === "short") shortCount += 1;
      else overCount += 1;
    }
    batches.push({
      batchIndex,
      orderIds: slice.map((o) => o.orderId),
      reconciliations,
    });
  }
  return {
    ok: true,
    report: {
      tenant: tenantCheck.scope,
      batchSize,
      batchCount: batches.length,
      batches,
      orderCount: ordered.length,
      receiptCount: receipts.length,
      ordering: "order-id-lexical-contiguous-batches",
      exactCount,
      shortCount,
      overCount,
    },
  };
}
