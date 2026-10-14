/**
 * @fleetos/procurement — The marketplace offer/quote contract (F361C,
 * Wave 17 lane C; the F360 freeze §3.2).
 *
 * The frozen schema: supplier id, SKU, unit+total cost, currency,
 * tax/fees, delivery estimate, condition, warranty, validity window,
 * source reference + captured-at. Every field is validated at capture —
 * refusals carry machine-stable reason codes (never clamped, law A4).
 *
 * THE FRESHNESS LAW (mission §3.2, freeze §3.2): an expired offer NEVER
 * silently appears current. Freshness is a PURE computation over the
 * validity window at a caller-supplied `at`:
 *   - `at` in [validFrom, validUntil]  => "fresh" (the boundary instant
 *     validUntil is still INSIDE — the repo's WINDOW LAW convention);
 *   - `at` > validUntil                => "expired";
 *   - `at` < validFrom                 => "not-yet-valid".
 * The current-offer SHEET read model admits ONLY fresh offers and
 * reports every excluded offer id with its verdict — honest exclusion,
 * never a silent drop, never a stale entry presented as current.
 *
 * MANUAL-SOURCE LAW: the offer's `source` is a MANUAL provenance kind
 * (operator-entered / manual catalogue export / supplier message
 * reference). A "live API" source kind is UNREPRESENTABLE in the type —
 * this package NEVER claims live supplier connectivity.
 *
 * Laws: A1, A4, A8, A16 (an offer is never an order), A20.
 * Pure deterministic TS. Time is an explicit `number` input (epoch ms).
 */

import type { TenantScope } from "./contracts.js";
import { validateTenantScope } from "./contracts.js";

// ---------------------------------------------------------------------------
// The offer (freeze §3.2) — its own contract identity (A16).
// ---------------------------------------------------------------------------

export type OfferCondition = "new" | "certified-refurbished" | "used";

/**
 * MANUAL provenance kinds only — a live-API source kind is deliberately
 * UNREPRESENTABLE (the honest-labelling law: the F361C pilot has NO
 * live supplier API; the freeze sanctions the manually-operated seam).
 */
export type MarketplaceOfferSourceKind =
  | "operator-entered"
  | "manual-catalogue-export"
  | "supplier-message-reference";

export interface MarketplaceOfferSource {
  readonly kind: MarketplaceOfferSourceKind;
  /** The operator-auditable source reference (export id, note ref, message id). */
  readonly reference: string;
}

export interface MarketplaceOffer {
  readonly offerId: string;
  readonly tenant: TenantScope;
  readonly supplierId: string;
  readonly sku: string;
  /** Integer quantity the offer prices (>= 1). */
  readonly quantity: number;
  /** Integer minor units, > 0. */
  readonly unitCostMinor: number;
  /** EXACT integer total: quantity × unitCostMinor (verified, never recomputed silently). */
  readonly totalCostMinor: number;
  readonly currency: string;
  /** Integer tax in minor units, >= 0. */
  readonly taxMinor: number;
  /** Integer fees in minor units, >= 0. */
  readonly feesMinor: number;
  /** Delivery estimate in whole days, >= 0. */
  readonly deliveryEstimateDays: number;
  readonly condition: OfferCondition;
  /** Warranty term in whole months, >= 0. */
  readonly warrantyMonths: number;
  /** Validity window start (epoch ms), inclusive. */
  readonly validFrom: number;
  /** Validity window end (epoch ms), inclusive — the WINDOW LAW boundary. */
  readonly validUntil: number;
  readonly source: MarketplaceOfferSource;
  /** Capture timestamp — the provenance anchor (must be inside the window). */
  readonly capturedAt: number;
}

// ---------------------------------------------------------------------------
// Capture — the full-schema validation battery.
// ---------------------------------------------------------------------------

export type MarketplaceOfferReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "OFFER_ID_REQUIRED"
  | "SUPPLIER_ID_REQUIRED"
  | "SKU_REQUIRED"
  | "INVALID_QUANTITY"
  | "INVALID_UNIT_COST"
  | "TOTAL_MISMATCH"
  | "CURRENCY_REQUIRED"
  | "INVALID_TAX"
  | "INVALID_FEES"
  | "INVALID_DELIVERY_ESTIMATE"
  | "INVALID_WARRANTY"
  | "INVALID_VALIDITY_WINDOW"
  | "CAPTURE_BEFORE_WINDOW_START"
  | "CAPTURE_AFTER_WINDOW_END"
  | "SOURCE_REFERENCE_REQUIRED";

export type MarketplaceOfferCaptureResult =
  | { readonly ok: true; readonly offer: MarketplaceOffer }
  | { readonly ok: false; readonly reasonCode: MarketplaceOfferReasonCode };

export interface MarketplaceOfferCaptureInput {
  readonly offerId: string;
  readonly supplierId: string;
  readonly sku: string;
  readonly quantity: number;
  readonly unitCostMinor: number;
  readonly totalCostMinor: number;
  readonly currency: string;
  readonly taxMinor: number;
  readonly feesMinor: number;
  readonly deliveryEstimateDays: number;
  readonly condition: OfferCondition;
  readonly warrantyMonths: number;
  readonly validFrom: number;
  readonly validUntil: number;
  readonly source: MarketplaceOfferSource;
  readonly capturedAt: number;
}

/**
 * captureMarketplaceOffer — validates the FULL frozen schema and returns
 * the immutable offer record. The capture itself must happen inside the
 * validity window (capturing an already-expired offer refuses
 * CAPTURE_AFTER_WINDOW_END — a stale-on-arrival offer is refused, never
 * recorded as if it were live). The total is verified EXACTLY against
 * quantity × unitCostMinor (TOTAL_MISMATCH, never recomputed silently).
 */
export function captureMarketplaceOffer(
  tenant: TenantScope,
  input: MarketplaceOfferCaptureInput,
): MarketplaceOfferCaptureResult {
  const tenantCheck = validateTenantScope(tenant);
  if (!tenantCheck.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
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
  if (!Number.isInteger(input.taxMinor) || input.taxMinor < 0) {
    return { ok: false, reasonCode: "INVALID_TAX" };
  }
  if (!Number.isInteger(input.feesMinor) || input.feesMinor < 0) {
    return { ok: false, reasonCode: "INVALID_FEES" };
  }
  if (!Number.isInteger(input.deliveryEstimateDays) || input.deliveryEstimateDays < 0) {
    return { ok: false, reasonCode: "INVALID_DELIVERY_ESTIMATE" };
  }
  if (!Number.isInteger(input.warrantyMonths) || input.warrantyMonths < 0) {
    return { ok: false, reasonCode: "INVALID_WARRANTY" };
  }
  if (!Number.isInteger(input.validFrom) || !Number.isInteger(input.validUntil) || input.validUntil <= input.validFrom) {
    return { ok: false, reasonCode: "INVALID_VALIDITY_WINDOW" };
  }
  if (input.capturedAt < input.validFrom) {
    return { ok: false, reasonCode: "CAPTURE_BEFORE_WINDOW_START" };
  }
  if (input.capturedAt > input.validUntil) {
    return { ok: false, reasonCode: "CAPTURE_AFTER_WINDOW_END" };
  }
  if (input.source.reference.length === 0) {
    return { ok: false, reasonCode: "SOURCE_REFERENCE_REQUIRED" };
  }
  return {
    ok: true,
    offer: { ...input, tenant: tenantCheck.scope },
  };
}

// ---------------------------------------------------------------------------
// THE FRESHNESS LAW — pure verdict over the validity window.
// ---------------------------------------------------------------------------

export type OfferFreshnessVerdict = "fresh" | "expired" | "not-yet-valid";

export interface OfferFreshness {
  readonly offerId: string;
  readonly verdict: OfferFreshnessVerdict;
  readonly validFrom: number;
  readonly validUntil: number;
}

/**
 * assessOfferFreshness — the pure freshness computation. `at ==
 * validUntil` is still INSIDE the window (the repo's WINDOW LAW
 * convention); `at > validUntil` is expired; `at < validFrom` is
 * not-yet-valid. An expired offer NEVER silently appears current.
 */
export function assessOfferFreshness(offer: MarketplaceOffer, at: number): OfferFreshness {
  const verdict: OfferFreshnessVerdict =
    at > offer.validUntil ? "expired" : at < offer.validFrom ? "not-yet-valid" : "fresh";
  return {
    offerId: offer.offerId,
    verdict,
    validFrom: offer.validFrom,
    validUntil: offer.validUntil,
  };
}

// ---------------------------------------------------------------------------
// The current-offer sheet — the freshness-law read model.
// ---------------------------------------------------------------------------

export type OfferSheetReasonCode = "TENANT_SCOPE_MISSING" | "TENANT_MISMATCH";

export type CurrentOfferSheetResult =
  | {
      readonly ok: true;
      /** ONLY fresh offers — ordered by offerId lexical (the total order). */
      readonly freshOffers: readonly MarketplaceOffer[];
      /** Every excluded offer with its verdict — honest exclusion, never silent. */
      readonly excluded: readonly OfferFreshness[];
      readonly freshCount: number;
      readonly expiredCount: number;
      readonly notYetValidCount: number;
    }
  | { readonly ok: false; readonly reasonCode: OfferSheetReasonCode };

/**
 * buildCurrentOfferSheet — THE FRESHNESS LAW read model: only fresh
 * (current) offers appear in the sheet; expired and not-yet-valid offers
 * are excluded AND reported with their verdicts. A foreign-tenant offer
 * in the input REFUSES the whole sheet fail-closed (law A8 — never
 * silently filtered out).
 */
export function buildCurrentOfferSheet(
  tenant: TenantScope,
  offers: readonly MarketplaceOffer[],
  at: number,
): CurrentOfferSheetResult {
  const tenantCheck = validateTenantScope(tenant);
  if (!tenantCheck.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  const fresh: MarketplaceOffer[] = [];
  const excluded: OfferFreshness[] = [];
  for (const offer of offers) {
    const offerTenant = validateTenantScope(offer.tenant);
    if (!offerTenant.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
    if (offerTenant.scope.tenantId !== tenantCheck.scope.tenantId) {
      return { ok: false, reasonCode: "TENANT_MISMATCH" };
    }
    const freshness = assessOfferFreshness(offer, at);
    if (freshness.verdict === "fresh") fresh.push(offer);
    else excluded.push(freshness);
  }
  fresh.sort((a, b) => a.offerId.localeCompare(b.offerId));
  excluded.sort((a, b) => a.offerId.localeCompare(b.offerId));
  return {
    ok: true,
    freshOffers: fresh,
    excluded,
    freshCount: fresh.length,
    expiredCount: excluded.filter((e) => e.verdict === "expired").length,
    notYetValidCount: excluded.filter((e) => e.verdict === "not-yet-valid").length,
  };
}
