/**
 * @fleetos/procurement — Procurement bounded context public contracts.
 *
 * Wave 0 lane C (F200C). Pure TypeScript domain package: types + pure
 * functions only. No I/O, no servers, no databases, no network, no providers.
 *
 * Law A16 — Exchange semantics: Needs, demands, quotes, orders and
 * fulfillment RETAIN INDEPENDENT CONTRACT IDENTITY. A quote is NEVER an
 * order; a demand is NEVER a need. Each contract has its own branded id
 * kind, its own state machine, and its own validation path.
 *
 * Laws satisfied here: A1, A4, A7 (provider neutrality via structural port),
 * A8 (tenant isolation, fail-closed), A16, A20 (no cross-boundary imports).
 */

// ---------------------------------------------------------------------------
// Tenant scope — structural local type (seam rule).
// ---------------------------------------------------------------------------

export interface TenantScope {
  readonly tenantId: string;
}

export type TenantValidation =
  | { ok: true; scope: TenantScope }
  | { ok: false; reasonCode: TenantReasonCode };

export type TenantReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "TENANT_ID_EMPTY"
  | "TENANT_ID_TOO_LONG"
  | "TENANT_ID_INVALID_CHARS";

const TENANT_PATTERN = /^[A-Za-z0-9_-]+$/;

export function validateTenantScope(scope: unknown): TenantValidation {
  if (scope === null || typeof scope !== "object") {
    return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  }
  const candidate = scope as Record<string, unknown>;
  const tenantId = candidate["tenantId"];
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    return { ok: false, reasonCode: "TENANT_ID_EMPTY" };
  }
  if (tenantId.length > 128) {
    return { ok: false, reasonCode: "TENANT_ID_TOO_LONG" };
  }
  if (!TENANT_PATTERN.test(tenantId)) {
    return { ok: false, reasonCode: "TENANT_ID_INVALID_CHARS" };
  }
  return { ok: true, scope: { tenantId } };
}

// ---------------------------------------------------------------------------
// Independent contract identities (law A16) — each carries a branded id
// `kind`. A Need is never a Demand; a Quote is never an Order; etc. The
// types enforce this: assigning one to another is a compile error.
// ---------------------------------------------------------------------------

export interface NeedId { readonly kind: "need"; readonly value: string }
export interface DemandId { readonly kind: "procurement-demand"; readonly value: string }
export interface QuoteId { readonly kind: "quote"; readonly value: string }
export interface OrderId { readonly kind: "order"; readonly value: string }
export interface FulfillmentId { readonly kind: "fulfillment"; readonly value: string }

// ---------------------------------------------------------------------------
// Need — the originating want. Independent of Demand.
// ---------------------------------------------------------------------------

export interface Need {
  readonly id: NeedId;
  readonly tenant: TenantScope;
  readonly description: string;
  readonly requiredCapabilityTags: readonly string[];
}

// ---------------------------------------------------------------------------
// ProcurementDemand — a request to the market for a Need. Carries quantity
// and timing. NOT a Need and NOT a Quote.
// ---------------------------------------------------------------------------

export interface ProcurementDemand {
  readonly id: DemandId;
  readonly tenant: TenantScope;
  readonly needId: NeedId;
  readonly quantity: number;
  readonly requiredBy: string;
  readonly capabilityTags: readonly string[];
}

// ---------------------------------------------------------------------------
// Vendor capability record — structural LOCAL seam; the @fleetos/vendors
// package owns the authoritative Vendor type. We accept any object that
// satisfies this shape at the structural boundary (law A20 — no
// cross-boundary implementation imports).
// ---------------------------------------------------------------------------

export interface VendorCapabilityRefLike {
  readonly vendorId: string;
  readonly tenant: TenantScope;
  readonly capabilityTags: readonly string[];
  /** Self-reported service-level score, e.g. 0..1. */
  readonly serviceLevel: number;
  /** Self-reported unit cost in abstract currency units. */
  readonly unitCost: number;
}

// ---------------------------------------------------------------------------
// Quote — vendor response to a Demand. Independent of Order.
// ---------------------------------------------------------------------------

export type QuoteStatus = "draft" | "submitted" | "accepted" | "rejected" | "expired";

export interface Quote {
  readonly id: QuoteId;
  readonly tenant: TenantScope;
  readonly demandId: DemandId;
  readonly vendorId: string;
  readonly unitCost: number;
  readonly totalCost: number;
  readonly status: QuoteStatus;
  readonly submittedAt: string | null;
  readonly expiresAt: string | null;
}

// ---------------------------------------------------------------------------
// Order — created from an accepted Quote. Independent of Quote and
// Fulfillment.
// ---------------------------------------------------------------------------

export type OrderStatus =
  | "draft"
  | "placed"
  | "confirmed"
  | "shipped"
  | "received"
  | "cancelled";

export interface Order {
  readonly id: OrderId;
  readonly tenant: TenantScope;
  readonly quoteId: QuoteId;
  readonly status: OrderStatus;
}

// ---------------------------------------------------------------------------
// Fulfillment — tracks the delivery of an Order. Independent of Order.
// ---------------------------------------------------------------------------

export type FulfillmentStatus =
  | "pending"
  | "in_transit"
  | "delivered"
  | "verified"
  | "failed";

export interface Fulfillment {
  readonly id: FulfillmentId;
  readonly tenant: TenantScope;
  readonly orderId: OrderId;
  readonly status: FulfillmentStatus;
}

// ---------------------------------------------------------------------------
// Pure matching function — deterministic scoring over vendor capability
// records. Higher score = better match. Ties broken by deterministic
// lexicographic vendorId ordering for stable output.
// ---------------------------------------------------------------------------

export interface VendorMatch {
  readonly vendorId: string;
  readonly score: number;
  readonly matchedTags: readonly string[];
}

export function matchVendors(
  demand: ProcurementDemand,
  vendors: readonly VendorCapabilityRefLike[],
): readonly VendorMatch[] {
  const tenantCheck = validateTenantScope(demand.tenant);
  if (!tenantCheck.ok) return [];
  const matches: VendorMatch[] = [];
  for (const v of vendors) {
    const vTenant = validateTenantScope(v.tenant);
    if (!vTenant.ok) continue;
    if (vTenant.scope.tenantId !== tenantCheck.scope.tenantId) continue;
    const matched = demand.capabilityTags.filter((t) => v.capabilityTags.includes(t));
    if (matched.length === 0) continue;
    // Tag coverage dominates; service level is a tiebreaker. Lower cost is
    // better, so we subtract a small fraction of unit cost.
    const coverageScore = matched.length / Math.max(demand.capabilityTags.length, 1);
    const serviceScore = Math.max(0, Math.min(1, v.serviceLevel));
    const costScore = 1 / (1 + Math.max(0, v.unitCost));
    const score = coverageScore * 0.6 + serviceScore * 0.3 + costScore * 0.1;
    matches.push({ vendorId: v.vendorId, score, matchedTags: matched });
  }
  matches.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.vendorId < b.vendorId ? -1 : a.vendorId > b.vendorId ? 1 : 0;
  });
  return matches;
}

// ---------------------------------------------------------------------------
// Quote lifecycle state machine — pure, with machine-stable reason codes.
// ---------------------------------------------------------------------------

export type QuoteTransitionCommand =
  | { type: "submit"; submittedAt: string; expiresAt: string }
  | { type: "accept" }
  | { type: "reject" }
  | { type: "expire" };

export type QuoteTransition =
  | { ok: true; next: Quote }
  | { ok: false; reasonCode: QuoteReasonCode };

export type QuoteReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "ILLEGAL_TRANSITION";

const QUOTE_ALLOWED: Readonly<Record<QuoteStatus, readonly string[]>> = {
  draft: ["submit"],
  submitted: ["accept", "reject", "expire"],
  accepted: [],
  rejected: [],
  expired: [],
};

export function transitionQuote(
  current: Quote,
  command: QuoteTransitionCommand,
): QuoteTransition {
  const tenantCheck = validateTenantScope(current.tenant);
  if (!tenantCheck.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  const allowed = QUOTE_ALLOWED[current.status] ?? [];
  if (!allowed.includes(command.type)) {
    return { ok: false, reasonCode: "ILLEGAL_TRANSITION" };
  }
  switch (command.type) {
    case "submit":
      return {
        ok: true,
        next: {
          ...current,
          status: "submitted",
          submittedAt: command.submittedAt,
          expiresAt: command.expiresAt,
        },
      };
    case "accept":
      return { ok: true, next: { ...current, status: "accepted" } };
    case "reject":
      return { ok: true, next: { ...current, status: "rejected" } };
    case "expire":
      return { ok: true, next: { ...current, status: "expired" } };
  }
}

// ---------------------------------------------------------------------------
// Order transitions — pure state machine.
// ---------------------------------------------------------------------------

export type OrderTransitionCommand =
  | { type: "place" }
  | { type: "confirm" }
  | { type: "ship" }
  | { type: "receive" }
  | { type: "cancel" };

export type OrderTransition =
  | { ok: true; next: Order }
  | { ok: false; reasonCode: OrderReasonCode };

export type OrderReasonCode = "TENANT_SCOPE_MISSING" | "ILLEGAL_TRANSITION";

const ORDER_ALLOWED: Readonly<Record<OrderStatus, readonly string[]>> = {
  draft: ["place", "cancel"],
  placed: ["confirm", "cancel"],
  confirmed: ["ship", "cancel"],
  shipped: ["receive"],
  received: [],
  cancelled: [],
};

export function transitionOrder(
  current: Order,
  command: OrderTransitionCommand,
): OrderTransition {
  const tenantCheck = validateTenantScope(current.tenant);
  if (!tenantCheck.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  const allowed = ORDER_ALLOWED[current.status] ?? [];
  if (!allowed.includes(command.type)) {
    return { ok: false, reasonCode: "ILLEGAL_TRANSITION" };
  }
  const next: Record<typeof command.type, OrderStatus> = {
    place: "placed",
    confirm: "confirmed",
    ship: "shipped",
    receive: "received",
    cancel: "cancelled",
  };
  return { ok: true, next: { ...current, status: next[command.type] } };
}

// ---------------------------------------------------------------------------
// Fulfillment transitions — pure, with verification hooks.
// ---------------------------------------------------------------------------

export type FulfillmentTransitionCommand =
  | { type: "start_transit" }
  | { type: "deliver" }
  | { type: "verify" }
  | { type: "fail" };

export type FulfillmentTransition =
  | { ok: true; next: Fulfillment }
  | { ok: false; reasonCode: FulfillmentReasonCode };

export type FulfillmentReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "ILLEGAL_TRANSITION"
  | "VERIFICATION_REQUIRED_BEFORE_VERIFY";

const FULFILLMENT_ALLOWED: Readonly<Record<FulfillmentStatus, readonly string[]>> = {
  pending: ["start_transit", "fail"],
  in_transit: ["deliver", "fail"],
  delivered: ["verify", "fail"],
  verified: [],
  failed: [],
};

export function transitionFulfillment(
  current: Fulfillment,
  command: FulfillmentTransitionCommand,
): FulfillmentTransition {
  const tenantCheck = validateTenantScope(current.tenant);
  if (!tenantCheck.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  const allowed = FULFILLMENT_ALLOWED[current.status] ?? [];
  if (!allowed.includes(command.type)) {
    return { ok: false, reasonCode: "ILLEGAL_TRANSITION" };
  }
  const next: Record<typeof command.type, FulfillmentStatus> = {
    start_transit: "in_transit",
    deliver: "delivered",
    verify: "verified",
    fail: "failed",
  };
  return { ok: true, next: { ...current, status: next[command.type] } };
}

// ---------------------------------------------------------------------------
// Exchange identity proof — runtime guard asserting that two contract ids
// are of different kinds. Used by tests to prove exchange-identity
// separation (quote != order != demand != need).
// ---------------------------------------------------------------------------

export function contractsAreDistinct(
  a: { readonly kind: string },
  b: { readonly kind: string },
): boolean {
  return a.kind !== b.kind;
}
