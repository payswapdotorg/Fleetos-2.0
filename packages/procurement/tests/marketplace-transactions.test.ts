/**
 * @fleetos/procurement — F331C row 34: the marketplace transaction flow.
 * Machine tests of the placement/checkout/cancel/expire state machine's
 * documented laws, incl. the exact-overshoot refusals, the inclusive
 * window boundary, terminality, the fail-closed tenancy and the
 * deterministic board projection.
 */

import { describe, expect, it } from "vitest";
import {
  placeMarketplaceOrder,
  checkoutMarketplaceOrder,
  cancelMarketplaceOrder,
  expireMarketplaceOrder,
  summarizeMarketplaceOrders,
  type MarketplaceListingLike,
  type MarketplaceOrder,
} from "../src/index.js";

const TENANT = { tenantId: "acme" } as const;
const FOREIGN = { tenantId: "globex" } as const;
const T0 = 1_774_000_000_000;

function listing(overrides: Partial<MarketplaceListingLike> = {}): MarketplaceListingLike {
  return {
    listingId: "lst-1",
    tenant: TENANT,
    vendorId: "ven-1",
    claimedCapabilities: ["cold-chain"],
    exclusions: ["weekend-delivery"],
    status: "published",
    delistReason: null,
    publishedAt: T0 - 30 * 86_400_000,
    ...overrides,
  };
}

function placedOrder(overrides: Partial<MarketplaceOrder> = {}): MarketplaceOrder {
  const draft = {
    orderId: "ord-1",
    listingId: "lst-1",
    vendorId: "ven-1",
    quantity: 4,
    unitPriceMinor: 12_500,
    holdMs: 86_400_000,
    acknowledgeExclusions: true,
  };
  const result = placeMarketplaceOrder(TENANT, draft, [listing()], [], T0);
  if (!result.ok) throw new Error("fixture: placement refused");
  return { ...result.order, ...overrides };
}

describe("placeMarketplaceOrder — the placement gate", () => {
  it("places against a published listing and carries exclusions verbatim on acknowledgement", () => {
    const result = placeMarketplaceOrder(
      TENANT,
      { orderId: "ord-1", listingId: "lst-1", vendorId: "ven-1", quantity: 4, unitPriceMinor: 12_500, holdMs: 86_400_000, acknowledgeExclusions: true },
      [listing()],
      [],
      T0,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.order.status).toBe("placed");
    expect(result.order.totalMinor).toBe(50_000);
    expect(result.order.exclusions).toEqual(["weekend-delivery"]);
    expect(result.order.exclusions).not.toBe(listing().exclusions);
    expect(result.order.placedAt).toBe(T0);
    expect(result.order.validUntil).toBe(T0 + 86_400_000);
  });

  it("refuses an unacknowledged honest exclusion", () => {
    const result = placeMarketplaceOrder(
      TENANT,
      { orderId: "ord-1", listingId: "lst-1", vendorId: "ven-1", quantity: 1, unitPriceMinor: 100, holdMs: 1_000, acknowledgeExclusions: false },
      [listing()],
      [],
      T0,
    );
    expect(result).toMatchObject({ ok: false, reasonCode: "EXCLUSIONS_NOT_ACKNOWLEDGED" });
  });

  it("refuses delisted and unknown listings; a foreign-tenant listing refuses fail-closed", () => {
    const delisted = placeMarketplaceOrder(TENANT, { orderId: "o", listingId: "lst-1", vendorId: "ven-1", quantity: 1, unitPriceMinor: 1, holdMs: 1, acknowledgeExclusions: true }, [listing({ status: "delisted" })], [], T0);
    expect(delisted).toMatchObject({ ok: false, reasonCode: "LISTING_NOT_PUBLISHED" });
    const unknown = placeMarketplaceOrder(TENANT, { orderId: "o", listingId: "lst-x", vendorId: "ven-1", quantity: 1, unitPriceMinor: 1, holdMs: 1, acknowledgeExclusions: true }, [listing()], [], T0);
    expect(unknown).toMatchObject({ ok: false, reasonCode: "LISTING_NOT_FOUND" });
    const foreign = placeMarketplaceOrder(TENANT, { orderId: "o", listingId: "lst-1", vendorId: "ven-9", quantity: 1, unitPriceMinor: 1, holdMs: 1, acknowledgeExclusions: true }, [listing(), listing({ listingId: "lst-f", tenant: FOREIGN })], [], T0);
    expect(foreign).toMatchObject({ ok: false, reasonCode: "TENANT_MISMATCH" });
  });

  it("refuses duplicates and invalid numbers with exact reason codes", () => {
    const draft = { listingId: "lst-1", vendorId: "ven-1", quantity: 2, unitPriceMinor: 10, holdMs: 1_000, acknowledgeExclusions: true } as const;
    const first = placeMarketplaceOrder(TENANT, { ...draft, orderId: "ord-1" }, [listing()], [], T0);
    expect(first.ok).toBe(true);
    const dup = placeMarketplaceOrder(TENANT, { ...draft, orderId: "ord-1" }, [listing()], first.ok ? [first.order] : [], T0);
    expect(dup).toMatchObject({ ok: false, reasonCode: "DUPLICATE_ORDER_ID" });
    const badQty = placeMarketplaceOrder(TENANT, { ...draft, orderId: "o2", quantity: 0 }, [listing()], [], T0);
    expect(badQty).toMatchObject({ ok: false, reasonCode: "INVALID_QUANTITY" });
    const badPrice = placeMarketplaceOrder(TENANT, { ...draft, orderId: "o3", unitPriceMinor: -1 }, [listing()], [], T0);
    expect(badPrice).toMatchObject({ ok: false, reasonCode: "INVALID_UNIT_PRICE" });
    const badHold = placeMarketplaceOrder(TENANT, { ...draft, orderId: "o4", holdMs: 0 }, [listing()], [], T0);
    expect(badHold).toMatchObject({ ok: false, reasonCode: "INVALID_HOLD_WINDOW" });
  });
});

describe("checkoutMarketplaceOrder — the checkout gates", () => {
  it("checks out within the hold window at the exact recomputed total", () => {
    const result = checkoutMarketplaceOrder(TENANT, placedOrder(), [listing()], { limitMinor: 1_000_000 }, T0 + 3_600_000);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.order.status).toBe("checked-out");
    expect(result.order.checkedOutAt).toBe(T0 + 3_600_000);
  });

  it("WINDOW LAW: at == validUntil is still inside the window", () => {
    const order = placedOrder();
    const result = checkoutMarketplaceOrder(TENANT, order, [listing()], { limitMinor: 1_000_000 }, order.validUntil);
    expect(result.ok).toBe(true);
  });

  it("a deadline breach refuses with the exact overshoot — never clamped", () => {
    const order = placedOrder();
    const result = checkoutMarketplaceOrder(TENANT, order, [listing()], { limitMinor: 1_000_000 }, order.validUntil + 1);
    expect(result).toMatchObject({ ok: false, reasonCode: "ORDER_WINDOW_EXPIRED" });
    if (result.ok) return;
    expect(result.validUntil).toBe(order.validUntil);
    expect(result.overshootMs).toBe(1);
  });

  it("a delisting between placement and checkout refuses the checkout", () => {
    const result = checkoutMarketplaceOrder(TENANT, placedOrder(), [listing({ status: "delisted", delistReason: "CAPABILITY_REVOKED:cold-chain" })], { limitMinor: 1_000_000 }, T0 + 1);
    expect(result).toMatchObject({ ok: false, reasonCode: "LISTING_NOT_PUBLISHED_AT_CHECKOUT" });
  });

  it("the limit path refuses with the exact overshoot", () => {
    const order = placedOrder(); // total 50_000
    const result = checkoutMarketplaceOrder(TENANT, order, [listing()], { limitMinor: 49_999 }, T0 + 1);
    expect(result).toMatchObject({ ok: false, reasonCode: "CHECKOUT_LIMIT_EXCEEDED" });
    if (result.ok) return;
    expect(result.totalMinor).toBe(50_000);
    expect(result.limitMinor).toBe(49_999);
    expect(result.overshootMinor).toBe(1);
  });

  it("a drifted total refuses TOTAL_MISMATCH; a terminal order refuses ORDER_NOT_PLACED", () => {
    const drifted = checkoutMarketplaceOrder(TENANT, placedOrder({ totalMinor: 49_999 }), [listing()], { limitMinor: 1_000_000 }, T0 + 1);
    expect(drifted).toMatchObject({ ok: false, reasonCode: "TOTAL_MISMATCH" });
    const checkedOut = placedOrder({ status: "checked-out" });
    const again = checkoutMarketplaceOrder(TENANT, checkedOut, [listing()], { limitMinor: 1_000_000 }, T0 + 1);
    expect(again).toMatchObject({ ok: false, reasonCode: "ORDER_NOT_PLACED" });
  });
});

describe("cancel + expire transitions", () => {
  it("cancel requires a reason and records it; terminality refuses further transitions", () => {
    const noReason = cancelMarketplaceOrder(placedOrder(), T0 + 1, "");
    expect(noReason).toMatchObject({ ok: false, reasonCode: "CANCEL_REASON_REQUIRED" });
    const cancelled = cancelMarketplaceOrder(placedOrder(), T0 + 1, "buyer changed mind");
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) return;
    expect(cancelled.order.status).toBe("cancelled");
    expect(cancelled.order.cancelledReason).toBe("buyer changed mind");
    const after = cancelMarketplaceOrder(cancelled.order, T0 + 2, "again");
    expect(after).toMatchObject({ ok: false, reasonCode: "ILLEGAL_TRANSITION" });
  });

  it("expire refuses NOT_EXPIRED_YET while the window is open, then expires after the lapse", () => {
    const order = placedOrder();
    const early = expireMarketplaceOrder(order, order.validUntil);
    expect(early).toMatchObject({ ok: false, reasonCode: "NOT_EXPIRED_YET" });
    const late = expireMarketplaceOrder(order, order.validUntil + 1);
    expect(late.ok).toBe(true);
    if (!late.ok) return;
    expect(late.order.status).toBe("expired");
    expect(late.order.expiredAt).toBe(order.validUntil + 1);
  });
});

describe("summarizeMarketplaceOrders — deterministic board", () => {
  it("counts by status, sums checked-out money, orders ids lexically", () => {
    const a = placedOrder(); // placed (50_000)
    const b = placedOrder({ orderId: "ord-0", status: "checked-out", checkedOutAt: T0 + 5 });
    const c = placedOrder({ orderId: "ord-2", status: "cancelled", cancelledAt: T0 + 6, cancelledReason: "x" });
    const d = placedOrder({ orderId: "ord-3", status: "expired", expiredAt: T0 + 7 });
    const board = summarizeMarketplaceOrders([a, b, c, d]);
    expect(board.total).toBe(4);
    expect(board.byStatus).toEqual({ placed: 1, "checked-out": 1, cancelled: 1, expired: 1 });
    expect(board.issuedTotalMinor).toBe(50_000);
    expect(board.orderIds).toEqual(["ord-0", "ord-1", "ord-2", "ord-3"]);
  });
});
