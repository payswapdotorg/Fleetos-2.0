/**
 * @fleetos/procurement — Wave 8 (F280C) reconciliation-at-volume tests:
 * batched + bounded + deterministic ordering, batched == unbatched over
 * the REAL per-order law, receipts never silently dropped, tenant
 * fail-closed probes.
 */
import { describe, expect, it } from "vitest";
import {
  reconcileOrderTotals,
  reconcileOrdersBatched,
  RECONCILIATION_BATCH_MAX,
  RECONCILIATION_BATCH_MIN,
  type OrderTotals,
  type OrderReceipt,
  type TenantScope,
} from "../src/index.js";

const TENANT: TenantScope = { tenantId: "acme" };
const OTHER_TENANT: TenantScope = { tenantId: "globex" };

function order(orderId: string, quantity = 10, unitCost = 100): OrderTotals {
  return { orderId, tenant: TENANT, orderedQuantity: quantity, unitCostMinor: unitCost };
}

function receipt(orderId: string, quantity: number, at = 1): OrderReceipt {
  return { orderId, tenant: TENANT, receivedQuantity: quantity, receivedAt: at };
}

/** Build N orders o-000..o-(N-1) with mixed reconciliation outcomes. */
function volumeWorld(n: number): { orders: OrderTotals[]; receipts: OrderReceipt[] } {
  const orders: OrderTotals[] = [];
  const receipts: OrderReceipt[] = [];
  for (let i = 0; i < n; i++) {
    const id = `o-${String(i).padStart(3, "0")}`;
    orders.push(order(id, 10, 100));
    if (i % 3 === 0) receipts.push(receipt(id, 10)); // exact
    else if (i % 3 === 1) receipts.push(receipt(id, 8)); // short
    else {
      receipts.push(receipt(id, 5));
      receipts.push(receipt(id, 6)); // over (two partial receipts)
    }
  }
  return { orders, receipts };
}

describe("reconcileOrdersBatched — deterministic batched reconciliation", () => {
  it("batches are contiguous, bounded and ordered by orderId lexical — input order never leaks", () => {
    const { orders, receipts } = volumeWorld(10);
    const forward = reconcileOrdersBatched(TENANT, orders, receipts, 4);
    const permuted = reconcileOrdersBatched(TENANT, [...orders].reverse(), [...receipts].reverse(), 4);
    expect(forward.ok && permuted.ok).toBe(true);
    if (!forward.ok || !permuted.ok) return;
    expect(permuted.report).toEqual(forward.report);
    expect(forward.report.batchSize).toBe(4);
    expect(forward.report.batchCount).toBe(3);
    expect(forward.report.batches.map((b) => b.orderIds)).toEqual([
      ["o-000", "o-001", "o-002", "o-003"],
      ["o-004", "o-005", "o-006", "o-007"],
      ["o-008", "o-009"],
    ]);
    expect(forward.report.ordering).toBe("order-id-lexical-contiguous-batches");
  });

  it("batched output is IDENTICAL to running the REAL reconcileOrderTotals order-by-order", () => {
    const { orders, receipts } = volumeWorld(25);
    const result = reconcileOrdersBatched(TENANT, orders, receipts, 7);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const batch of result.report.batches) {
      for (const rec of batch.reconciliations) {
        const order = orders.find((o) => o.orderId === rec.orderId);
        expect(order).toBeDefined();
        if (!order) continue;
        const solo = reconcileOrderTotals(order, receipts.filter((r) => r.orderId === rec.orderId));
        expect(solo.ok).toBe(true);
        if (solo.ok) expect(solo.reconciliation).toEqual(rec);
      }
    }
    expect(result.report.orderCount).toBe(25);
    expect(result.report.receiptCount).toBe(33);
  });

  it("classification counts are honest: 9 exact, 8 short, 8 over for n=25", () => {
    const { orders, receipts } = volumeWorld(25);
    const result = reconcileOrdersBatched(TENANT, orders, receipts, 10);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // i%3==0 -> exact (i=0,3,6,9,12,15,18,21,24 = 9); short (i=1,4,...,22 = 8); over = 8.
    expect(result.report.exactCount).toBe(9);
    expect(result.report.shortCount).toBe(8);
    expect(result.report.overCount).toBe(8);
  });

  it("batch size 1 and a size larger than the order count both work (bounded)", () => {
    const { orders, receipts } = volumeWorld(5);
    const single = reconcileOrdersBatched(TENANT, orders, receipts, 1);
    expect(single.ok && single.report.batchCount).toBe(5);
    const huge = reconcileOrdersBatched(TENANT, orders, receipts, 500);
    expect(huge.ok && huge.report.batchCount).toBe(1);
    expect(RECONCILIATION_BATCH_MIN).toBe(1);
    expect(RECONCILIATION_BATCH_MAX).toBe(500);
  });

  it("refuses batch sizes outside the documented bound [1, 500]", () => {
    const { orders, receipts } = volumeWorld(3);
    expect(reconcileOrdersBatched(TENANT, orders, receipts, 0)).toMatchObject({
      ok: false,
      reasonCode: "BATCH_SIZE_OUT_OF_RANGE",
    });
    expect(reconcileOrdersBatched(TENANT, orders, receipts, 501)).toMatchObject({
      ok: false,
      reasonCode: "BATCH_SIZE_OUT_OF_RANGE",
    });
  });

  it("a receipt for an order NOT in the input refuses the whole run (never dropped)", () => {
    const { orders, receipts } = volumeWorld(3);
    const result = reconcileOrdersBatched(TENANT, orders, [...receipts, receipt("o-ghost", 1)], 2);
    expect(result).toMatchObject({ ok: false, reasonCode: "RECEIPT_ORDER_MISMATCH" });
  });

  it("duplicate order ids and empty order ids refuse", () => {
    expect(
      reconcileOrdersBatched(TENANT, [order("o-1"), order("o-1")], [], 2),
    ).toMatchObject({ ok: false, reasonCode: "ORDER_ID_DUPLICATE" });
    expect(reconcileOrdersBatched(TENANT, [order("")], [], 2)).toMatchObject({
      ok: false,
      reasonCode: "ORDER_ID_EMPTY",
    });
    expect(reconcileOrdersBatched(TENANT, [], [], 2)).toMatchObject({
      ok: false,
      reasonCode: "NO_ORDERS",
    });
  });

  it("per-order law refusals propagate (negative quantity refuses the run)", () => {
    const result = reconcileOrdersBatched(
      TENANT,
      [order("o-1", 0)],
      [receipt("o-1", 1)],
      2,
    );
    expect(result).toMatchObject({ ok: false, reasonCode: "RECONCILIATION_REFUSED" });
  });

  it("TENANT fail-closed: a foreign-tenant order refuses the whole run", () => {
    const result = reconcileOrdersBatched(
      TENANT,
      [order("o-1"), { orderId: "o-2", tenant: OTHER_TENANT, orderedQuantity: 1, unitCostMinor: 1 }],
      [],
      2,
    );
    expect(result).toMatchObject({ ok: false, reasonCode: "TENANT_MISMATCH" });
  });

  it("TENANT fail-closed: a foreign-tenant receipt refuses the whole run", () => {
    const result = reconcileOrdersBatched(
      TENANT,
      [order("o-1")],
      [{ orderId: "o-1", tenant: OTHER_TENANT, receivedQuantity: 1, receivedAt: 1 }],
      2,
    );
    expect(result).toMatchObject({ ok: false, reasonCode: "TENANT_MISMATCH" });
  });

  it("an invalid caller tenant scope refuses the run", () => {
    expect(
      reconcileOrdersBatched({ tenantId: "" }, [order("o-1")], [], 2),
    ).toMatchObject({ ok: false, reasonCode: "TENANT_SCOPE_MISSING" });
  });
});
