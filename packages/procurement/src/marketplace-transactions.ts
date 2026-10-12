/**
 * @fleetos/procurement — Marketplace transaction flow (F331C row 34):
 * ordering/checkout over PUBLISHED listings as a REAL commerce-domain
 * capability — a placed → checked-out | cancelled | expired order state
 * machine with honest refusal paths, NOT a fixture echo.
 *
 * Bounded-context placement (BOUNDED-CONTEXTS.md): procurement owns
 * orders. The published listing is a @fleetos/vendors record and enters
 * through the LOCAL structural seam below (the VendorCapabilityRefLike
 * pattern — no runtime import of @fleetos/vendors; the acceptance lane
 * is the documented composition site that binds the REAL records).
 *
 * Documented laws (machine-tested in tests/marketplace-transactions.test.ts):
 *   - PLACEMENT: an order may ONLY be placed against a listing of this
 *     tenant with status "published". A delisted listing, a foreign-tenant
 *     listing in the input, an unknown listing, an unacknowledged honest
 *     exclusion, a non-positive quantity/unit price/hold window, or a
 *     duplicate orderId each refuses the WHOLE placement with a reason
 *     code — never a partial order.
 *   - HONEST EXCLUSIONS: the listing's exclusions are carried VERBATIM
 *     onto the placed order once the buyer acknowledges them; what the
 *     vendor declared is what the buyer accepted.
 *   - EXACT MONEY: totalMinor = quantity × unitPriceMinor, integer
 *     arithmetic only — never clamped, recomputed at checkout (a drifted
 *     record refuses TOTAL_MISMATCH).
 *   - CHECKOUT GATES (deterministic order): the listing must STILL be
 *     published at checkout (a delisting between placement and checkout
 *     refuses LISTING_NOT_PUBLISHED_AT_CHECKOUT); the order must still be
 *     "placed" (terminal states refuse ILLEGAL_TRANSITION); the checkout
 *     must happen within the hold window (at > validUntil refuses
 *     ORDER_WINDOW_EXPIRED with the exact overshoot — never clamped);
 *     the checkout limit must cover the exact total (refuses
 *     CHECKOUT_LIMIT_EXCEEDED with the exact overshoot).
 *   - WINDOW LAW: at == validUntil is STILL INSIDE the window (the
 *     boundary is inclusive of the deadline instant); at > validUntil
 *     breaches it.
 *   - TERMINALITY: checked-out / cancelled / expired are terminal;
 *     every further transition refuses ILLEGAL_TRANSITION.
 *   - EXPIRY: the explicit expire transition refuses NOT_EXPIRED_YET
 *     while the window is still open — an order never expires early.
 *
 * Laws: A1, A4 (refuse, never clamp), A8 (tenant-scoped, fail-closed),
 * A16 (an order is never a listing; a checkout is never an expiry), A20.
 *
 * Pure deterministic TS. Time is an explicit `number` input (epoch ms).
 */

import type { TenantScope } from "./contracts.js";
import { validateTenantScope } from "./contracts.js";

// ---------------------------------------------------------------------------
// LOCAL structural listing seam (cross-context, law A13) — structurally
// compatible with @fleetos/vendors `MarketplaceListing`; the acceptance
// composition site binds the REAL records (F331C).
// ---------------------------------------------------------------------------

export interface MarketplaceListingLike {
  readonly listingId: string;
  readonly tenant: TenantScope;
  readonly vendorId: string;
  readonly claimedCapabilities: readonly string[];
  readonly exclusions: readonly string[];
  readonly status: "published" | "delisted";
  readonly delistReason: string | null;
  readonly publishedAt: number;
}

// ---------------------------------------------------------------------------
// The marketplace order.
// ---------------------------------------------------------------------------

export type MarketplaceOrderStatus = "placed" | "checked-out" | "cancelled" | "expired";

export interface MarketplaceOrder {
  readonly orderId: string;
  readonly tenant: TenantScope;
  readonly listingId: string;
  readonly vendorId: string;
  readonly quantity: number;
  readonly unitPriceMinor: number;
  /** Exact integer total: quantity × unitPriceMinor (recomputed at checkout). */
  readonly totalMinor: number;
  /** The listing's honest exclusions, carried VERBATIM on acknowledgement. */
  readonly exclusions: readonly string[];
  readonly claimedCapabilities: readonly string[];
  readonly status: MarketplaceOrderStatus;
  readonly placedAt: number;
  /** The hold-window deadline: placedAt + holdMs (inclusive — see WINDOW LAW). */
  readonly validUntil: number;
  readonly checkedOutAt: number | null;
  readonly cancelledAt: number | null;
  readonly cancelledReason: string | null;
  readonly expiredAt: number | null;
}

export interface MarketplaceOrderDraft {
  readonly orderId: string;
  readonly listingId: string;
  readonly vendorId: string;
  readonly quantity: number;
  readonly unitPriceMinor: number;
  /** Hold-window length in ms (validUntil = at + holdMs). */
  readonly holdMs: number;
  /** The buyer acknowledges the listing's honest exclusions (law: refuse otherwise). */
  readonly acknowledgeExclusions: boolean;
}

export type PlaceOrderReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "TENANT_MISMATCH"
  | "ORDER_ID_EMPTY"
  | "DUPLICATE_ORDER_ID"
  | "LISTING_NOT_FOUND"
  | "LISTING_NOT_PUBLISHED"
  | "EXCLUSIONS_NOT_ACKNOWLEDGED"
  | "INVALID_QUANTITY"
  | "INVALID_UNIT_PRICE"
  | "INVALID_HOLD_WINDOW"
  | "INVALID_PLACEMENT_TIME";

export type PlaceOrderResult =
  | { readonly ok: true; readonly order: MarketplaceOrder }
  | { readonly ok: false; readonly reasonCode: PlaceOrderReasonCode };

/**
 * placeMarketplaceOrder — the placement gate over a population of REAL
 * published listings. PURE: returns the placed order; applies nothing.
 */
export function placeMarketplaceOrder(
  tenant: TenantScope,
  draft: MarketplaceOrderDraft,
  listings: readonly MarketplaceListingLike[],
  existingOrders: readonly MarketplaceOrder[],
  at: number,
): PlaceOrderResult {
  const tenantCheck = validateTenantScope(tenant);
  if (!tenantCheck.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  if (draft.orderId.length === 0) return { ok: false, reasonCode: "ORDER_ID_EMPTY" };
  if (existingOrders.some((o) => o.orderId === draft.orderId)) {
    return { ok: false, reasonCode: "DUPLICATE_ORDER_ID" };
  }
  let listing: MarketplaceListingLike | undefined;
  for (const candidate of listings) {
    const listingTenant = validateTenantScope(candidate.tenant);
    if (!listingTenant.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
    if (listingTenant.scope.tenantId !== tenantCheck.scope.tenantId) {
      // A foreign-tenant listing in the input REFUSES fail-closed — never
      // silently filtered out (law A8).
      return { ok: false, reasonCode: "TENANT_MISMATCH" };
    }
    if (candidate.listingId === draft.listingId) listing = candidate;
  }
  if (listing === undefined) return { ok: false, reasonCode: "LISTING_NOT_FOUND" };
  if (listing.status !== "published") return { ok: false, reasonCode: "LISTING_NOT_PUBLISHED" };
  if (listing.exclusions.length > 0 && !draft.acknowledgeExclusions) {
    return { ok: false, reasonCode: "EXCLUSIONS_NOT_ACKNOWLEDGED" };
  }
  if (!Number.isInteger(draft.quantity) || draft.quantity <= 0) {
    return { ok: false, reasonCode: "INVALID_QUANTITY" };
  }
  if (!Number.isInteger(draft.unitPriceMinor) || draft.unitPriceMinor <= 0) {
    return { ok: false, reasonCode: "INVALID_UNIT_PRICE" };
  }
  if (!Number.isInteger(draft.holdMs) || draft.holdMs <= 0) {
    return { ok: false, reasonCode: "INVALID_HOLD_WINDOW" };
  }
  if (!Number.isInteger(at) || at < 0) {
    return { ok: false, reasonCode: "INVALID_PLACEMENT_TIME" };
  }
  const totalMinor = draft.quantity * draft.unitPriceMinor;
  return {
    ok: true,
    order: {
      orderId: draft.orderId,
      tenant: tenantCheck.scope,
      listingId: draft.listingId,
      vendorId: listing.vendorId,
      quantity: draft.quantity,
      unitPriceMinor: draft.unitPriceMinor,
      totalMinor,
      exclusions: [...listing.exclusions],
      claimedCapabilities: [...listing.claimedCapabilities],
      status: "placed",
      placedAt: at,
      validUntil: at + draft.holdMs,
      checkedOutAt: null,
      cancelledAt: null,
      cancelledReason: null,
      expiredAt: null,
    },
  };
}

// ---------------------------------------------------------------------------
// Checkout.
// ---------------------------------------------------------------------------

export interface CheckoutLimit {
  /** Per-checkout ceiling in minor units (the refusal carries exact numbers). */
  readonly limitMinor: number;
}

export type CheckoutReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "TENANT_MISMATCH"
  | "ORDER_NOT_PLACED"
  | "LISTING_NOT_PUBLISHED_AT_CHECKOUT"
  | "ORDER_WINDOW_EXPIRED"
  | "CHECKOUT_LIMIT_EXCEEDED"
  | "TOTAL_MISMATCH";

export type CheckoutResult =
  | { readonly ok: true; readonly order: MarketplaceOrder }
  | {
      readonly ok: false;
      readonly reasonCode: CheckoutReasonCode;
      readonly at: number;
      readonly validUntil: number | null;
      readonly overshootMs: number | null;
      readonly totalMinor: number | null;
      readonly limitMinor: number | null;
      readonly overshootMinor: number | null;
    };

/**
 * checkoutMarketplaceOrder — the checkout gates, in deterministic order:
 * tenancy → listing still published → order still placed → hold window →
 * checkout limit → exact-total recomputation. Every refusal carries the
 * exact numbers; nothing is ever clamped (law A4).
 */
export function checkoutMarketplaceOrder(
  tenant: TenantScope,
  order: MarketplaceOrder,
  listings: readonly MarketplaceListingLike[],
  limit: CheckoutLimit,
  at: number,
): CheckoutResult {
  const fail = (
    reasonCode: CheckoutReasonCode,
    extras: { validUntil?: number; overshootMs?: number; totalMinor?: number; limitMinor?: number; overshootMinor?: number } = {},
  ): CheckoutResult => ({
    ok: false,
    reasonCode,
    at,
    validUntil: extras.validUntil ?? null,
    overshootMs: extras.overshootMs ?? null,
    totalMinor: extras.totalMinor ?? null,
    limitMinor: extras.limitMinor ?? null,
    overshootMinor: extras.overshootMinor ?? null,
  });
  const tenantCheck = validateTenantScope(tenant);
  if (!tenantCheck.ok) return fail("TENANT_SCOPE_MISSING");
  const orderTenant = validateTenantScope(order.tenant);
  if (!orderTenant.ok) return fail("TENANT_SCOPE_MISSING");
  if (orderTenant.scope.tenantId !== tenantCheck.scope.tenantId) {
    return fail("TENANT_MISMATCH");
  }
  let listing: MarketplaceListingLike | undefined;
  for (const candidate of listings) {
    const listingTenant = validateTenantScope(candidate.tenant);
    if (!listingTenant.ok) return fail("TENANT_SCOPE_MISSING");
    if (listingTenant.scope.tenantId !== tenantCheck.scope.tenantId) {
      return fail("TENANT_MISMATCH");
    }
    if (candidate.listingId === order.listingId) listing = candidate;
  }
  if (listing === undefined) return fail("LISTING_NOT_PUBLISHED_AT_CHECKOUT");
  if (listing.status !== "published") return fail("LISTING_NOT_PUBLISHED_AT_CHECKOUT");
  if (order.status !== "placed") return fail("ORDER_NOT_PLACED");
  // WINDOW LAW: at == validUntil is still inside; at > validUntil breaches.
  if (!Number.isInteger(at) || at < 0) {
    return fail("ORDER_WINDOW_EXPIRED");
  }
  if (at > order.validUntil) {
    return fail("ORDER_WINDOW_EXPIRED", {
      validUntil: order.validUntil,
      overshootMs: at - order.validUntil,
    });
  }
  const recomputedTotal = order.quantity * order.unitPriceMinor;
  if (recomputedTotal !== order.totalMinor) {
    return fail("TOTAL_MISMATCH", { totalMinor: order.totalMinor });
  }
  if (recomputedTotal > limit.limitMinor) {
    return fail("CHECKOUT_LIMIT_EXCEEDED", {
      totalMinor: recomputedTotal,
      limitMinor: limit.limitMinor,
      overshootMinor: recomputedTotal - limit.limitMinor,
    });
  }
  return {
    ok: true,
    order: { ...order, status: "checked-out", checkedOutAt: at },
  };
}

// ---------------------------------------------------------------------------
// Cancel + explicit expiry.
// ---------------------------------------------------------------------------

export type OrderTransitionReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "ILLEGAL_TRANSITION"
  | "CANCEL_REASON_REQUIRED"
  | "NOT_EXPIRED_YET";

export type OrderTransitionResult =
  | { readonly ok: true; readonly order: MarketplaceOrder }
  | { readonly ok: false; readonly reasonCode: OrderTransitionReasonCode };

/**
 * cancelMarketplaceOrder — placed → cancelled. An empty reason refuses
 * (law A4); terminal states refuse ILLEGAL_TRANSITION.
 */
export function cancelMarketplaceOrder(
  order: MarketplaceOrder,
  at: number,
  reason: string,
): OrderTransitionResult {
  if (order.status !== "placed") return { ok: false, reasonCode: "ILLEGAL_TRANSITION" };
  if (reason.length === 0) return { ok: false, reasonCode: "CANCEL_REASON_REQUIRED" };
  return {
    ok: true,
    order: { ...order, status: "cancelled", cancelledAt: at, cancelledReason: reason },
  };
}

/**
 * expireMarketplaceOrder — placed → expired, but ONLY once the hold
 * window has actually lapsed (at > validUntil). An order never expires
 * early: at <= validUntil refuses NOT_EXPIRED_YET.
 */
export function expireMarketplaceOrder(
  order: MarketplaceOrder,
  at: number,
): OrderTransitionResult {
  if (order.status !== "placed") return { ok: false, reasonCode: "ILLEGAL_TRANSITION" };
  if (at <= order.validUntil) return { ok: false, reasonCode: "NOT_EXPIRED_YET" };
  return { ok: true, order: { ...order, status: "expired", expiredAt: at } };
}

// ---------------------------------------------------------------------------
// Deterministic board view (pure projection).
// ---------------------------------------------------------------------------

export interface MarketplaceOrderBoard {
  readonly total: number;
  readonly byStatus: Readonly<Record<MarketplaceOrderStatus, number>>;
  /** Deterministic order: orderId lexical. */
  readonly orderIds: readonly string[];
  readonly issuedTotalMinor: number;
}

/** Summarize a population: counts by status + the checked-out money total. */
export function summarizeMarketplaceOrders(
  orders: readonly MarketplaceOrder[],
): MarketplaceOrderBoard {
  const byStatus: Record<MarketplaceOrderStatus, number> = {
    "placed": 0,
    "checked-out": 0,
    "cancelled": 0,
    "expired": 0,
  };
  let issuedTotalMinor = 0;
  for (const order of orders) {
    byStatus[order.status] += 1;
    if (order.status === "checked-out") issuedTotalMinor += order.totalMinor;
  }
  const sorted = [...orders].map((o) => o.orderId).sort((a, b) => a.localeCompare(b));
  return { total: orders.length, byStatus, orderIds: sorted, issuedTotalMinor };
}
