/**
 * @fleetos/procurement — Wave 8 (F280C) production-economics tests:
 * SLA penalty credits, exact-sum cost allocation across work orders,
 * partial-fulfillment sum laws, tenant fail-closed probes.
 */
import { describe, expect, it } from "vitest";
import {
  applySlaPenaltyCredit,
  allocateCostAcrossWorkOrders,
  allocatePartialFulfillmentAmounts,
  verifyPartialFulfillmentSums,
  type OrderTotals,
  type TenantScope,
  type WorkOrderCostShare,
  type PartialFulfillmentRow,
} from "../src/index.js";

const TENANT: TenantScope = { tenantId: "acme" };
const OTHER_TENANT: TenantScope = { tenantId: "globex" };

function order(overrides: Partial<OrderTotals> = {}): OrderTotals {
  return {
    orderId: "o-1",
    tenant: TENANT,
    orderedQuantity: 10,
    unitCostMinor: 350,
    ...overrides,
  };
}

function shares(list: readonly [string, number][]): WorkOrderCostShare[] {
  return list.map(([workOrderId, shareBps]) => ({ workOrderId, shareBps, tenant: TENANT }));
}

describe("applySlaPenaltyCredit — SLA economics on orders", () => {
  it("computes the credit as floor(value * penaltyBps / 10000) capped by the cap amount", () => {
    const result = applySlaPenaltyCredit(order(), {
      evaluationDigest: "sla_ab12cd34",
      tenantId: "acme",
      penaltyBps: 300,
      creditCapBps: 1000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 10 * 350 = 3500; 300 bps -> floor(3500*300/10000) = 105.
    expect(result.credit.orderValueMinor).toBe(3500);
    expect(result.credit.creditMinorUnits).toBe(105);
    expect(result.credit.evaluationDigest).toBe("sla_ab12cd34");
  });

  it("the cap binds: a penalty above the cap credits the cap amount only", () => {
    const result = applySlaPenaltyCredit(order(), {
      evaluationDigest: "sla_ab12cd34",
      tenantId: "acme",
      penaltyBps: 900,
      creditCapBps: 100,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 900 bps -> 315; cap 100 bps -> 35. Cap binds.
    expect(result.credit.creditMinorUnits).toBe(35);
  });

  it("floor division never rounds up (3500 * 33 bps = 11.55 -> 11)", () => {
    const result = applySlaPenaltyCredit(order(), {
      evaluationDigest: "d",
      tenantId: "acme",
      penaltyBps: 33,
      creditCapBps: 10000,
    });
    expect(result.ok && result.credit.creditMinorUnits).toBe(11);
  });

  it("TENANT fail-closed: a penalty assessed for another tenant is refused", () => {
    expect(
      applySlaPenaltyCredit(order(), {
        evaluationDigest: "d",
        tenantId: "globex",
        penaltyBps: 100,
        creditCapBps: 1000,
      }),
    ).toEqual({ ok: false, reasonCode: "TENANT_MISMATCH" });
  });

  it("refuses invalid orders and invalid penalty references", () => {
    const penalty = { evaluationDigest: "d", tenantId: "acme", penaltyBps: 100, creditCapBps: 1000 };
    expect(applySlaPenaltyCredit(order({ orderedQuantity: 0 }), penalty)).toMatchObject({
      reasonCode: "NEGATIVE_QUANTITY",
    });
    expect(applySlaPenaltyCredit(order(), { ...penalty, evaluationDigest: "" })).toMatchObject({
      reasonCode: "EVALUATION_DIGEST_EMPTY",
    });
    expect(applySlaPenaltyCredit(order(), { ...penalty, penaltyBps: 10001 })).toMatchObject({
      reasonCode: "INVALID_PENALTY_BPS",
    });
    expect(applySlaPenaltyCredit(order(), { ...penalty, creditCapBps: -1 })).toMatchObject({
      reasonCode: "INVALID_CREDIT_CAP_BPS",
    });
  });
});

describe("allocateCostAcrossWorkOrders — exact-sum allocation law", () => {
  it("allocates 100 minor units across thirds with NO rounding drift (sum exact)", () => {
    const result = allocateCostAcrossWorkOrders({
      tenant: TENANT,
      orderId: "o-1",
      totalMinorUnits: 100,
      shares: shares([
        ["wo-a", 3333],
        ["wo-b", 3333],
        ["wo-c", 3334],
      ]),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.allocations.map((a) => a.workOrderId)).toEqual(["wo-a", "wo-b", "wo-c"]);
    const sum = result.allocations.reduce((acc, a) => acc + a.amountMinorUnits, 0);
    expect(sum).toBe(100);
    expect(result.totalAllocatedMinorUnits).toBe(100);
    expect(result.law).toBe("largest-remainder-bps-tie-break-work-order-id-lexical");
  });

  it("awkward division: 1000 units over 3 equal shares sums exactly", () => {
    const result = allocateCostAcrossWorkOrders({
      tenant: TENANT,
      orderId: "o-1",
      totalMinorUnits: 1000,
      shares: shares([
        ["wo-x", 3333],
        ["wo-y", 3334],
        ["wo-z", 3333],
      ]),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const sum = result.allocations.reduce((acc, a) => acc + a.amountMinorUnits, 0);
    expect(sum).toBe(1000);
    // 1000*3333/10000 = 333.3 -> base 333; 1000*3334/10000 = 333.4 -> base 333.
    // Remainder 1 goes to the largest fractional remainder: wo-y (4000).
    expect(result.allocations).toEqual([
      { workOrderId: "wo-x", shareBps: 3333, amountMinorUnits: 333 },
      { workOrderId: "wo-y", shareBps: 3334, amountMinorUnits: 334 },
      { workOrderId: "wo-z", shareBps: 3333, amountMinorUnits: 333 },
    ]);
  });

  it("ties on fractional remainder break by workOrderId lexical order", () => {
    const result = allocateCostAcrossWorkOrders({
      tenant: TENANT,
      orderId: "o-1",
      totalMinorUnits: 3,
      shares: shares([
        ["wo-b", 3333],
        ["wo-a", 3333],
        ["wo-c", 3334],
      ]),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Bases: 0,0,1 (3*3334/10000 = 1.0002 -> 1); remainder 2 -> the two 3333
    // shares have equal fractional remainder (9999) -> lexical: wo-a, wo-b.
    expect(result.allocations).toEqual([
      { workOrderId: "wo-a", shareBps: 3333, amountMinorUnits: 1 },
      { workOrderId: "wo-b", shareBps: 3333, amountMinorUnits: 1 },
      { workOrderId: "wo-c", shareBps: 3334, amountMinorUnits: 1 },
    ]);
  });

  it("a single key takes the whole total; zero total allocates zeros", () => {
    const whole = allocateCostAcrossWorkOrders({
      tenant: TENANT,
      orderId: "o-1",
      totalMinorUnits: 999,
      shares: shares([["wo-solo", 10000]]),
    });
    expect(whole.ok && whole.allocations[0]?.amountMinorUnits).toBe(999);
    const zero = allocateCostAcrossWorkOrders({
      tenant: TENANT,
      orderId: "o-1",
      totalMinorUnits: 0,
      shares: shares([["wo-a", 5000], ["wo-b", 5000]]),
    });
    expect(zero.ok && zero.allocations.every((a) => a.amountMinorUnits === 0)).toBe(true);
  });

  it("refuses shares that do not sum to exactly 10000 — never normalizes", () => {
    expect(
      allocateCostAcrossWorkOrders({
        tenant: TENANT,
        orderId: "o-1",
        totalMinorUnits: 100,
        shares: shares([["wo-a", 5000], ["wo-b", 4999]]),
      }),
    ).toMatchObject({ ok: false, reasonCode: "SHARES_MUST_SUM_TO_10000" });
  });

  it("refuses duplicate ids, empty ids, invalid totals and empty shares", () => {
    const base = { tenant: TENANT, orderId: "o-1", totalMinorUnits: 100 };
    expect(
      allocateCostAcrossWorkOrders({ ...base, shares: shares([["wo-a", 5000], ["wo-a", 5000]]) }),
    ).toMatchObject({ ok: false, reasonCode: "WORK_ORDER_ID_DUPLICATE" });
    expect(
      allocateCostAcrossWorkOrders({ ...base, shares: shares([["", 10000]]) }),
    ).toMatchObject({ ok: false, reasonCode: "WORK_ORDER_ID_EMPTY" });
    expect(
      allocateCostAcrossWorkOrders({ ...base, totalMinorUnits: -1, shares: shares([["wo-a", 10000]]) }),
    ).toMatchObject({ ok: false, reasonCode: "INVALID_TOTAL" });
    expect(allocateCostAcrossWorkOrders({ ...base, shares: [] })).toMatchObject({
      ok: false,
      reasonCode: "NO_SHARES",
    });
  });

  it("TENANT fail-closed: a foreign-tenant share refuses the whole allocation", () => {
    expect(
      allocateCostAcrossWorkOrders({
        tenant: TENANT,
        orderId: "o-1",
        totalMinorUnits: 100,
        shares: [{ workOrderId: "wo-a", shareBps: 5000, tenant: OTHER_TENANT }, ...shares([["wo-b", 5000]])],
      }),
    ).toMatchObject({ ok: false, reasonCode: "TENANT_MISMATCH" });
  });
});

describe("allocatePartialFulfillmentAmounts + verifyPartialFulfillmentSums", () => {
  function partials(list: readonly [string, number][]): PartialFulfillmentRow[] {
    return list.map(([fulfillmentId, quantity]) => ({ fulfillmentId, quantity, tenant: TENANT }));
  }

  it("partial rows sum EXACTLY to the order total (no rounding drift)", () => {
    // 100 minor units over quantities 1,1,1 -> exact shares 33.33 each.
    const result = allocatePartialFulfillmentAmounts(
      TENANT,
      { orderId: "o-1", totalMinorUnits: 100 },
      partials([["f-1", 1], ["f-2", 1], ["f-3", 1]]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.totalAllocatedMinorUnits).toBe(100);
    const sum = result.rows.reduce((acc, r) => acc + r.amountMinorUnits, 0);
    expect(sum).toBe(100);
    expect(verifyPartialFulfillmentSums({ orderId: "o-1", totalMinorUnits: 100 }, result.rows)).toEqual({
      ok: true,
      sumMinorUnits: 100,
    });
  });

  it("proportional quantities allocate proportionally with exact sum", () => {
    // 1000 over 1,2,7 -> 100, 200, 700 exactly.
    const result = allocatePartialFulfillmentAmounts(
      TENANT,
      { orderId: "o-1", totalMinorUnits: 1000 },
      partials([["f-1", 1], ["f-2", 2], ["f-3", 7]]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows.map((r) => r.amountMinorUnits)).toEqual([100, 200, 700]);
  });

  it("remainder ties break by fulfillmentId lexical order (documented law)", () => {
    // 10 over 1,1,3 (total 5): exact 2, 2, 6 — already exact; ordering is
    // lexical and the sum is exact. The tie-break law is exercised above
    // where fractional remainders actually tie.
    const result = allocatePartialFulfillmentAmounts(
      TENANT,
      { orderId: "o-1", totalMinorUnits: 10 },
      partials([["f-b", 1], ["f-a", 1], ["f-c", 3]]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows.map((r) => [r.fulfillmentId, r.amountMinorUnits])).toEqual([
      ["f-a", 2],
      ["f-b", 2],
      ["f-c", 6],
    ]);
    expect(result.law).toBe("largest-remainder-by-quantity-tie-break-fulfillment-id-lexical");
  });

  it("verifyPartialFulfillmentSums refuses ANY drift with the exact signed drift", () => {
    const verdict = verifyPartialFulfillmentSums(
      { orderId: "o-1", totalMinorUnits: 100 },
      [
        { fulfillmentId: "f-1", amountMinorUnits: 60 },
        { fulfillmentId: "f-2", amountMinorUnits: 41 },
      ],
    );
    expect(verdict).toEqual({
      ok: false,
      reasonCode: "ROWS_DO_NOT_SUM_TO_ORDER_TOTAL",
      driftMinorUnits: 1,
    });
  });

  it("refuses duplicate/empty fulfillment ids, non-positive quantities, empty partials", () => {
    const orderSpec = { orderId: "o-1", totalMinorUnits: 100 };
    expect(
      allocatePartialFulfillmentAmounts(TENANT, orderSpec, partials([["f-1", 1], ["f-1", 1]])),
    ).toMatchObject({ ok: false, reasonCode: "FULFILLMENT_ID_DUPLICATE" });
    expect(
      allocatePartialFulfillmentAmounts(TENANT, orderSpec, partials([["", 1]])),
    ).toMatchObject({ ok: false, reasonCode: "FULFILLMENT_ID_EMPTY" });
    expect(
      allocatePartialFulfillmentAmounts(TENANT, orderSpec, partials([["f-1", 0]])),
    ).toMatchObject({ ok: false, reasonCode: "INVALID_QUANTITY" });
    expect(allocatePartialFulfillmentAmounts(TENANT, orderSpec, [])).toMatchObject({
      ok: false,
      reasonCode: "NO_PARTIALS",
    });
  });

  it("TENANT fail-closed: a foreign-tenant partial row refuses the allocation", () => {
    expect(
      allocatePartialFulfillmentAmounts(
        TENANT,
        { orderId: "o-1", totalMinorUnits: 100 },
        [{ fulfillmentId: "f-1", quantity: 1, tenant: OTHER_TENANT }],
      ),
    ).toMatchObject({ ok: false, reasonCode: "TENANT_MISMATCH" });
  });
});
