/**
 * @fleetos/procurement — The marketplace equipment-order lifecycle
 * (F361C, Wave 17 lane C; the F360 freeze §3.4).
 *
 * The frozen state machine:
 *   draft -> placed (provider-ack pending) -> acknowledged -> shipped
 *     -> received -> [accepted | discrepancy] -> [disputed | returned]
 *
 * Documented laws (machine-tested in tests/marketplace-order.test.ts):
 *   - TYPED TRANSITIONS: the allowed-transition matrix below is the
 *     single source of legality; `accepted`, `disputed` and `returned`
 *     are TERMINAL — every further command refuses ILLEGAL_TRANSITION.
 *   - MANUAL PROVIDER-ACK SEAM (freeze §3.4, mission §6): the placed ->
 *     acknowledged transition records the acknowledgement EVIDENCE
 *     REFERENCE (screenshot/export/invoice number — the frozen
 *     EvidenceRefLike type) plus the provider event id, through a
 *     MANUAL-ONLY channel vocabulary (a "live API" channel is
 *     UNREPRESENTABLE in the type — this package never claims live
 *     provider connectivity). IDEMPOTENT: re-presenting the SAME
 *     provider event id returns the acknowledged order unchanged with
 *     duplicate=true (the ORIGINAL evidence reference wins — never a
 *     second conclusion). DUPLICATE PROVIDER EVENTS REFUSED: a
 *     DIFFERENT provider event id presented for an already-acknowledged
 *     order refuses ALREADY_ACKNOWLEDGED (external events are untrusted
 *     until validated and reconciled).
 *   - MONEY: exact integer totals — totalMinor must equal quantity ×
 *     unitCostMinor at drafting (TOTAL_MISMATCH, never recomputed
 *     silently; law A4).
 *   - TENANT FAIL-CLOSED reads: another tenant's order is never
 *     returned.
 *
 * Laws: A1, A4, A8, A13 (the evidence-reference seam), A16 (an order is
 * never an offer), A20. Pure deterministic TS; time is an explicit
 * `number` input (epoch ms).
 */

import type { TenantScope, EvidenceRefLike } from "./contracts.js";
import { validateTenantScope } from "./contracts.js";

// ---------------------------------------------------------------------------
// The marketplace equipment order (freeze §3.4) — its own contract
// identity (A16), distinct from the F331C listing-checkout order.
// ---------------------------------------------------------------------------

export type MarketplaceEquipmentOrderStatus =
  | "draft"
  | "placed"
  | "acknowledged"
  | "shipped"
  | "received"
  | "accepted"
  | "discrepancy"
  | "disputed"
  | "returned";

/**
 * MANUAL acknowledgement channels ONLY — a live-API channel kind is
 * deliberately UNREPRESENTABLE (the honest-labelling law: the freeze
 * sanctions the manually-operated, operator-verified seam).
 */
export type ProviderAckChannel =
  | "manual-portal-export"
  | "manual-email-confirmation"
  | "manual-invoice-reference";

/** The recorded provider acknowledgement — the manual-seam artifact. */
export interface ProviderAcknowledgement {
  /** The provider's event id — the duplicate-event key. */
  readonly providerEventId: string;
  /** The ack evidence reference (screenshot/export/invoice number — freeze §3.4). */
  readonly evidence: EvidenceRefLike;
  readonly channel: ProviderAckChannel;
  readonly acknowledgedAt: number;
}

export interface MarketplaceEquipmentOrder {
  readonly orderId: string;
  readonly tenant: TenantScope;
  /** The equipment request this order fulfils (§3.1 reference). */
  readonly requestId: string;
  /** The selected offer this order prices against (§3.2 reference). */
  readonly offerId: string;
  readonly supplierId: string;
  readonly sku: string;
  readonly quantity: number;
  readonly unitCostMinor: number;
  /** EXACT integer total: quantity × unitCostMinor (verified at drafting). */
  readonly totalCostMinor: number;
  readonly currency: string;
  readonly status: MarketplaceEquipmentOrderStatus;
  readonly placedAt: number | null;
  /** The manual provider acknowledgement (present once acknowledged). */
  readonly acknowledgement: ProviderAcknowledgement | null;
  readonly shippedAt: number | null;
  readonly receivedAt: number | null;
  readonly acceptedAt: number | null;
  readonly discrepancyReason: string | null;
  readonly disputeReason: string | null;
  readonly returnReason: string | null;
}

// ---------------------------------------------------------------------------
// Drafting — create the order in `draft` from an approved request.
// ---------------------------------------------------------------------------

export type EquipmentOrderDraftReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "ORDER_ID_REQUIRED"
  | "REQUEST_ID_REQUIRED"
  | "OFFER_ID_REQUIRED"
  | "SUPPLIER_ID_REQUIRED"
  | "SKU_REQUIRED"
  | "INVALID_QUANTITY"
  | "INVALID_UNIT_COST"
  | "TOTAL_MISMATCH"
  | "CURRENCY_REQUIRED";

export type EquipmentOrderDraftResult =
  | { readonly ok: true; readonly order: MarketplaceEquipmentOrder }
  | { readonly ok: false; readonly reasonCode: EquipmentOrderDraftReasonCode };

export interface EquipmentOrderDraftInput {
  readonly orderId: string;
  readonly requestId: string;
  readonly offerId: string;
  readonly supplierId: string;
  readonly sku: string;
  readonly quantity: number;
  readonly unitCostMinor: number;
  readonly totalCostMinor: number;
  readonly currency: string;
}

/**
 * draftEquipmentMarketplaceOrder — creates the order in `draft`,
 * carrying the §3.1 request reference and the §3.2 selected offer
 * reference, with the EXACT money law (total = quantity × unit).
 */
export function draftEquipmentMarketplaceOrder(
  tenant: TenantScope,
  input: EquipmentOrderDraftInput,
): EquipmentOrderDraftResult {
  const tenantCheck = validateTenantScope(tenant);
  if (!tenantCheck.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  if (input.orderId.length === 0) return { ok: false, reasonCode: "ORDER_ID_REQUIRED" };
  if (input.requestId.length === 0) return { ok: false, reasonCode: "REQUEST_ID_REQUIRED" };
  if (input.offerId.length === 0) return { ok: false, reasonCode: "OFFER_ID_REQUIRED" };
  if (input.supplierId.length === 0) return { ok: false, reasonCode: "SUPPLIER_ID_REQUIRED" };
  if (input.sku.length === 0) return { ok: false, reasonCode: "SKU_REQUIRED" };
  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    return { ok: false, reasonCode: "INVALID_QUANTITY" };
  }
  if (!Number.isInteger(input.unitCostMinor) || input.unitCostMinor <= 0) {
    return { ok: false, reasonCode: "INVALID_UNIT_COST" };
  }
  if (input.quantity * input.unitCostMinor !== input.totalCostMinor) {
    return { ok: false, reasonCode: "TOTAL_MISMATCH" };
  }
  if (input.currency.length === 0) return { ok: false, reasonCode: "CURRENCY_REQUIRED" };
  return {
    ok: true,
    order: {
      orderId: input.orderId,
      tenant: tenantCheck.scope,
      requestId: input.requestId,
      offerId: input.offerId,
      supplierId: input.supplierId,
      sku: input.sku,
      quantity: input.quantity,
      unitCostMinor: input.unitCostMinor,
      totalCostMinor: input.totalCostMinor,
      currency: input.currency,
      status: "draft",
      placedAt: null,
      acknowledgement: null,
      shippedAt: null,
      receivedAt: null,
      acceptedAt: null,
      discrepancyReason: null,
      disputeReason: null,
      returnReason: null,
    },
  };
}

// ---------------------------------------------------------------------------
// The §3.4 transition machine (non-ack transitions).
// ---------------------------------------------------------------------------

export type EquipmentOrderCommand =
  | { type: "place"; at: number }
  | { type: "ship"; at: number }
  | { type: "receive"; at: number }
  | { type: "accept"; at: number }
  | { type: "record_discrepancy"; at: number; reason: string }
  | { type: "dispute"; at: number; reason: string }
  | { type: "return"; at: number; reason: string };

export const EQUIPMENT_ORDER_ALLOWED: Readonly<
  Record<MarketplaceEquipmentOrderStatus, readonly EquipmentOrderCommand["type"][]>
> = {
  draft: ["place"],
  placed: [],
  acknowledged: ["ship"],
  shipped: ["receive"],
  received: ["accept", "record_discrepancy"],
  accepted: [],
  discrepancy: ["dispute", "return"],
  disputed: [],
  returned: [],
};

export type EquipmentOrderReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "ILLEGAL_TRANSITION"
  | "DISCREPANCY_REASON_REQUIRED"
  | "DISPUTE_REASON_REQUIRED"
  | "RETURN_REASON_REQUIRED"
  | "INVALID_TRANSITION_TIME";

export type EquipmentOrderTransitionResult =
  | { readonly ok: true; readonly order: MarketplaceEquipmentOrder }
  | { readonly ok: false; readonly reasonCode: EquipmentOrderReasonCode };

/**
 * transitionEquipmentMarketplaceOrder — the pure §3.4 machine (the
 * placed -> acknowledged leg lives in acknowledgeProviderOrder — the
 * manual seam with its own idempotency laws).
 */
export function transitionEquipmentMarketplaceOrder(
  current: MarketplaceEquipmentOrder,
  command: EquipmentOrderCommand,
): EquipmentOrderTransitionResult {
  const tenantCheck = validateTenantScope(current.tenant);
  if (!tenantCheck.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  if (!Number.isInteger(command.at) || command.at < 0) {
    return { ok: false, reasonCode: "INVALID_TRANSITION_TIME" };
  }
  const allowed = EQUIPMENT_ORDER_ALLOWED[current.status] ?? [];
  if (!allowed.includes(command.type)) {
    return { ok: false, reasonCode: "ILLEGAL_TRANSITION" };
  }
  switch (command.type) {
    case "place":
      return { ok: true, order: { ...current, status: "placed", placedAt: command.at } };
    case "ship":
      return { ok: true, order: { ...current, status: "shipped", shippedAt: command.at } };
    case "receive":
      return { ok: true, order: { ...current, status: "received", receivedAt: command.at } };
    case "accept":
      return { ok: true, order: { ...current, status: "accepted", acceptedAt: command.at } };
    case "record_discrepancy": {
      if (command.reason.trim().length === 0) {
        return { ok: false, reasonCode: "DISCREPANCY_REASON_REQUIRED" };
      }
      return {
        ok: true,
        order: { ...current, status: "discrepancy", discrepancyReason: command.reason },
      };
    }
    case "dispute": {
      if (command.reason.trim().length === 0) {
        return { ok: false, reasonCode: "DISPUTE_REASON_REQUIRED" };
      }
      return { ok: true, order: { ...current, status: "disputed", disputeReason: command.reason } };
    }
    case "return": {
      if (command.reason.trim().length === 0) {
        return { ok: false, reasonCode: "RETURN_REASON_REQUIRED" };
      }
      return { ok: true, order: { ...current, status: "returned", returnReason: command.reason } };
    }
  }
}

// ---------------------------------------------------------------------------
// THE MANUAL PROVIDER-ACK SEAM — idempotent, duplicate-event-refusing.
// ---------------------------------------------------------------------------

export type ProviderAckReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "ILLEGAL_TRANSITION"
  | "PROVIDER_EVENT_ID_REQUIRED"
  | "ACK_EVIDENCE_REFERENCE_REQUIRED"
  | "ACK_EVIDENCE_TENANT_MISMATCH"
  | "INVALID_ACK_TIME"
  | "ALREADY_ACKNOWLEDGED";

export type ProviderAckResult =
  | { readonly ok: true; readonly order: MarketplaceEquipmentOrder; readonly duplicate: boolean }
  | { readonly ok: false; readonly reasonCode: ProviderAckReasonCode };

export interface ProviderAckInput {
  readonly providerEventId: string;
  readonly evidence: EvidenceRefLike;
  readonly channel: ProviderAckChannel;
  readonly acknowledgedAt: number;
}

/**
 * acknowledgeProviderOrder — the manual provider-ack seam (freeze §3.4).
 * REQUIRES an evidence reference from the order's own tenant. IDEMPOTENT:
 * re-presenting the SAME provider event id returns the order unchanged
 * with duplicate=true (the ORIGINAL evidence reference wins — the
 * acknowledgement is never recorded twice). A DIFFERENT provider event
 * id for an already-acknowledged order REFUSES ALREADY_ACKNOWLEDGED —
 * duplicate provider events are refused, never reconciled silently.
 */
export function acknowledgeProviderOrder(
  current: MarketplaceEquipmentOrder,
  ack: ProviderAckInput,
): ProviderAckResult {
  const tenantCheck = validateTenantScope(current.tenant);
  if (!tenantCheck.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  if (ack.providerEventId.length === 0) {
    return { ok: false, reasonCode: "PROVIDER_EVENT_ID_REQUIRED" };
  }
  if (ack.evidence === null || ack.evidence.evidenceId.length === 0) {
    return { ok: false, reasonCode: "ACK_EVIDENCE_REFERENCE_REQUIRED" };
  }
  if (ack.evidence.tenantId !== tenantCheck.scope.tenantId) {
    return { ok: false, reasonCode: "ACK_EVIDENCE_TENANT_MISMATCH" };
  }
  if (!Number.isInteger(ack.acknowledgedAt) || ack.acknowledgedAt < 0) {
    return { ok: false, reasonCode: "INVALID_ACK_TIME" };
  }
  if (current.status === "acknowledged" && current.acknowledgement !== null) {
    if (current.acknowledgement.providerEventId === ack.providerEventId) {
      // Idempotent replay — the ORIGINAL acknowledgement wins, no second
      // conclusion, no state change.
      return { ok: true, order: current, duplicate: true };
    }
    return { ok: false, reasonCode: "ALREADY_ACKNOWLEDGED" };
  }
  if (current.status !== "placed") return { ok: false, reasonCode: "ILLEGAL_TRANSITION" };
  return {
    ok: true,
    order: {
      ...current,
      status: "acknowledged",
      acknowledgement: {
        providerEventId: ack.providerEventId,
        evidence: ack.evidence,
        channel: ack.channel,
        acknowledgedAt: ack.acknowledgedAt,
      },
    },
    duplicate: false,
  };
}

// ---------------------------------------------------------------------------
// Tenant fail-closed read + deterministic board.
// ---------------------------------------------------------------------------

/** findEquipmentMarketplaceOrder — fail-closed: another tenant's order is never returned. */
export function findEquipmentMarketplaceOrder(
  tenant: TenantScope,
  orders: readonly MarketplaceEquipmentOrder[],
  orderId: string,
): MarketplaceEquipmentOrder | null {
  const tenantCheck = validateTenantScope(tenant);
  if (!tenantCheck.ok) return null;
  const found = orders.find(
    (o) => o.orderId === orderId && o.tenant.tenantId === tenantCheck.scope.tenantId,
  );
  return found ?? null;
}

export interface EquipmentOrderBoard {
  readonly total: number;
  readonly byStatus: Readonly<Record<MarketplaceEquipmentOrderStatus, number>>;
  /** Orders placed but not yet acknowledged (the manual-ack pending set). */
  readonly ackPendingOrderIds: readonly string[];
  /** Deterministic order: orderId lexical. */
  readonly orderIds: readonly string[];
}

/** buildEquipmentMarketplaceOrderBoard — deterministic per-tenant summary. */
export function buildEquipmentMarketplaceOrderBoard(
  tenant: TenantScope,
  orders: readonly MarketplaceEquipmentOrder[],
): EquipmentOrderBoard {
  const tenantCheck = validateTenantScope(tenant);
  const byStatus: Record<MarketplaceEquipmentOrderStatus, number> = {
    draft: 0, placed: 0, acknowledged: 0, shipped: 0, received: 0,
    accepted: 0, discrepancy: 0, disputed: 0, returned: 0,
  };
  if (!tenantCheck.ok) return { total: 0, byStatus, ackPendingOrderIds: [], orderIds: [] };
  const scoped = orders.filter((o) => o.tenant.tenantId === tenantCheck.scope.tenantId);
  for (const o of scoped) byStatus[o.status] += 1;
  const orderIds = scoped.map((o) => o.orderId).sort((a, b) => a.localeCompare(b));
  const ackPendingOrderIds = scoped
    .filter((o) => o.status === "placed")
    .map((o) => o.orderId)
    .sort((a, b) => a.localeCompare(b));
  return { total: scoped.length, byStatus, ackPendingOrderIds, orderIds };
}
