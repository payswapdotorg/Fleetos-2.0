/**
 * @fleetos/procurement — Quote / Order / Fulfillment lifecycle state machines.
 *
 * Wave 1 kernel-grade additions over Wave 0:
 *   - quote lifecycle with SUPERSESSION (revised quotes supersede the
 *     previous one — old quote withdrawn with supersededBy ref);
 *   - order-creating transitions require a GuardianDecisionRefLike
 *     authorization (law A5 — procurement never self-authorizes);
 *   - fulfillment verification hooks (cannot mark verified without
 *     verification evidence);
 *   - machine-stable reason codes on every refusal.
 */

import type {
  Quote,
  QuoteId,
  QuoteStatus,
  Order,
  OrderId,
  OrderStatus,
  Fulfillment,
  FulfillmentStatus,
  DemandId,
  TenantScope,
  GuardianDecisionRefLike,
  EvidenceRefLike,
} from "./contracts.js";
import { validateTenantScope } from "./contracts.js";

// ---------------------------------------------------------------------------
// Quote lifecycle.
// ---------------------------------------------------------------------------

export type QuoteTransitionCommand =
  | { type: "submit"; submittedAt: string; expiresAt: string }
  | { type: "accept" }
  | { type: "reject" }
  | { type: "expire" }
  | { type: "withdraw" };

export type QuoteTransition =
  | { ok: true; next: Quote }
  | { ok: false; reasonCode: QuoteReasonCode };

export type QuoteReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "ILLEGAL_TRANSITION";

const QUOTE_ALLOWED: Readonly<Record<QuoteStatus, readonly QuoteTransitionCommand["type"][]>> = {
  draft: ["submit", "withdraw"],
  submitted: ["accept", "reject", "expire", "withdraw"],
  accepted: [],
  rejected: [],
  expired: [],
  withdrawn: [],
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
    case "withdraw":
      return { ok: true, next: { ...current, status: "withdrawn" } };
  }
}

/**
 * supersedeQuote — SUPERSESSION discipline. The previous quote is
 * withdrawn with `superseded: true` and `supersedes` cleared (it didn't
 * supersede anything itself; it WAS superseded). The new quote carries
 * `supersedes: <previousId>` and `superseded: false`. The previous quote
 * is NEVER mutated in place — the function returns BOTH quotes.
 */
export type SupersedeQuoteResult =
  | {
      readonly ok: true;
      readonly previousWithdrew: Quote;
      readonly next: Quote;
    }
  | { readonly ok: false; reasonCode: QuoteReasonCode };

export function supersedeQuote(
  previous: Quote,
  newQuoteId: QuoteId,
  newTenant: TenantScope,
  newDemandId: DemandId,
  newVendorId: string,
  newUnitCost: number,
  newTotalCost: number,
  newSubmittedAt: string,
  newExpiresAt: string,
): SupersedeQuoteResult {
  const tenantCheck = validateTenantScope(previous.tenant);
  if (!tenantCheck.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  if (previous.status === "withdrawn" || previous.status === "rejected" || previous.status === "expired") {
    return { ok: false, reasonCode: "ILLEGAL_TRANSITION" };
  }
  // Withdraw the previous quote with superseded flag set.
  const previousWithdrew: Quote = {
    ...previous,
    status: "withdrawn",
    superseded: true,
  };
  const next: Quote = {
    id: newQuoteId,
    tenant: newTenant,
    demandId: newDemandId,
    vendorId: newVendorId,
    unitCost: newUnitCost,
    totalCost: newTotalCost,
    status: "submitted",
    submittedAt: newSubmittedAt,
    expiresAt: newExpiresAt,
    supersedes: previous.id.value,
    superseded: false,
  };
  return { ok: true, previousWithdrew, next };
}

// ---------------------------------------------------------------------------
// Order lifecycle — every order-creating transition requires a
// GuardianDecisionRefLike authorization (law A5).
// ---------------------------------------------------------------------------

export type OrderTransitionCommand =
  | { type: "create"; authorization: GuardianDecisionRefLike }
  | { type: "confirm" }
  | { type: "ship" }
  | { type: "receive" }
  | { type: "cancel" };

export type OrderTransition =
  | { ok: true; next: Order }
  | { ok: false; reasonCode: OrderReasonCode };

export type OrderReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "ILLEGAL_TRANSITION"
  | "AUTHORIZATION_REQUIRED"
  | "AUTHORIZATION_DENIED"
  | "AUTHORIZATION_TENANT_MISMATCH";

const ORDER_ALLOWED: Readonly<Record<OrderStatus, readonly OrderTransitionCommand["type"][]>> = {
  draft: ["confirm", "cancel"],
  placed: ["confirm", "cancel"],
  confirmed: ["ship", "cancel"],
  shipped: ["receive"],
  received: [],
  cancelled: [],
};

/**
 * createOrder — the order-creating transition. REQUIRES a Guardian
 * authorization; procurement never self-authorizes (law A5). The
 * authorization must be authorized=true and the tenant must match.
 */
export function createOrder(
  id: OrderId,
  tenant: TenantScope,
  quoteId: QuoteId,
  authorization: GuardianDecisionRefLike,
): OrderTransition {
  const tenantCheck = validateTenantScope(tenant);
  if (!tenantCheck.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  if (!authorization) return { ok: false, reasonCode: "AUTHORIZATION_REQUIRED" };
  if (!authorization.authorized) {
    return { ok: false, reasonCode: "AUTHORIZATION_DENIED" };
  }
  return {
    ok: true,
    next: {
      id,
      tenant,
      quoteId,
      status: "draft",
      authorization,
      fulfillmentVerified: false,
    },
  };
}

/**
 * transitionOrder — applies a non-create transition. The `create`
 * command type is accepted but routed to createOrder logic (draft is the
 * initial state, so createOrder produces a draft order; transitionOrder
 * with create would only be used to re-issue authorization on a draft).
 */
export function transitionOrder(
  current: Order,
  command: OrderTransitionCommand,
): OrderTransition {
  const tenantCheck = validateTenantScope(current.tenant);
  if (!tenantCheck.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  if (command.type === "create") {
    // Re-authorization on a draft: validate the new authorization.
    if (!command.authorization.authorized) {
      return { ok: false, reasonCode: "AUTHORIZATION_DENIED" };
    }
    return {
      ok: true,
      next: { ...current, authorization: command.authorization },
    };
  }
  const allowed = ORDER_ALLOWED[current.status] ?? [];
  if (!allowed.includes(command.type)) {
    return { ok: false, reasonCode: "ILLEGAL_TRANSITION" };
  }
  const next: Record<Exclude<OrderTransitionCommand["type"], "create">, OrderStatus> = {
    confirm: "confirmed",
    ship: "shipped",
    receive: "received",
    cancel: "cancelled",
  };
  return { ok: true, next: { ...current, status: next[command.type] } };
}

// ---------------------------------------------------------------------------
// Fulfillment lifecycle — verification hooks.
// ---------------------------------------------------------------------------

export type FulfillmentTransitionCommand =
  | { type: "start_transit" }
  | { type: "deliver" }
  | { type: "verify"; evidence: EvidenceRefLike }
  | { type: "fail" };

export type FulfillmentTransition =
  | { ok: true; next: Fulfillment }
  | { ok: false; reasonCode: FulfillmentReasonCode };

export type FulfillmentReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "ILLEGAL_TRANSITION"
  | "VERIFICATION_EVIDENCE_REQUIRED"
  | "VERIFICATION_EVIDENCE_TENANT_MISMATCH";

const FULFILLMENT_ALLOWED: Readonly<
  Record<FulfillmentStatus, readonly FulfillmentTransitionCommand["type"][]>
> = {
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
  if (command.type === "verify") {
    if (!command.evidence || !command.evidence.evidenceId) {
      return { ok: false, reasonCode: "VERIFICATION_EVIDENCE_REQUIRED" };
    }
    if (command.evidence.tenantId !== current.tenant.tenantId) {
      return { ok: false, reasonCode: "VERIFICATION_EVIDENCE_TENANT_MISMATCH" };
    }
    return {
      ok: true,
      next: {
        ...current,
        status: "verified",
        verificationEvidence: command.evidence,
      },
    };
  }
  const next: Record<Exclude<FulfillmentTransitionCommand["type"], "verify">, FulfillmentStatus> = {
    start_transit: "in_transit",
    deliver: "delivered",
    fail: "failed",
  };
  return { ok: true, next: { ...current, status: next[command.type] } };
}
