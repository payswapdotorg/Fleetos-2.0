/**
 * @fleetos/acceptance-commerce — F361C (Wave 17 lane C) step families:
 * the four marketplace step groups delivered by the supplier/catalogue/
 * request/order contract lane (docs/tech-lead/packets/f361c.md; the
 * binding law docs/product/MARKETPLACE-MVP-FREEZE.md §3.1–§3.4).
 *
 * CENSUS CITATION (the F361C commerce census — docs/evidence/F361C/
 * report.md §1, machine-measured at base `203f077`; the F354 lesson:
 * every id and prefix below names THIS lane's MARKETPLACE angle and had
 * ZERO corpus coverage at the base, grep proof over the
 * commerce/field/security corpora):
 *   - MarketplaceRequestStep  (mreq-*)  → @fleetos/procurement
 *     marketplace-request.ts submitEquipmentRequest /
 *     transitionEquipmentRequest / findEquipmentRequest /
 *     buildEquipmentRequestBoard — the §3.1 machine.
 *   - MarketplaceOfferStep    (moff-*)  → @fleetos/procurement
 *     marketplace-offer.ts captureMarketplaceOffer /
 *     assessOfferFreshness / buildCurrentOfferSheet (the §3.2 freshness
 *     law) + marketplace-offer-comparison.ts compareMarketplaceOffers
 *     (composing the EXISTING compareQuotes + matchVendors kernels).
 *   - MarketplaceSupplierStep (mver-*)  → @fleetos/vendors
 *     supplier-verification.ts (the §3.3 machine + the verified-only
 *     gate) + catalogue-import.ts (the PLAINLY-LABELLED manually-operated
 *     catalogue import seam — never a live-API claim).
 *   - MarketplaceOrderAckStep (mord-*)  → @fleetos/procurement
 *     marketplace-equipment-order.ts (the §3.4 machine + the manual
 *     provider-ack seam) composed with @fleetos/work
 *     marketplace-order-work.ts (the order→work link + the
 *     service-completion accept gate) over the REAL work repository +
 *     work item directory.
 *
 * File law: this file holds ONLY the typed step data; the drivers live
 * in drivers-marketplace-request.ts / drivers-marketplace-offer.ts /
 * drivers-marketplace-suppliers.ts / drivers-marketplace-order.ts; the
 * journeys live in journeys/f361c-procurement.ts +
 * journeys/f361c-vendors.ts + journeys/f361c-order.ts.
 *
 * Time law (D13/D14): F361C journeys are single-epoch (T0) by
 * construction — no step consumes the run anchor and no assertion
 * carries an epoch table; every timestamp is literal journey data.
 */

import type { JourneyStepBase } from "./journey-contracts.js";

// ---------------------------------------------------------------------------
// The marketplace equipment-request steps (§3.1) — the idempotent
// create/submit discipline + the typed state machine + fail-closed reads.
// ---------------------------------------------------------------------------

export type MarketplaceRequestCommand =
  | "resolve"
  | "close_offer_window"
  | "compare"
  | "select"
  | "request_approval"
  | "approve"
  | "refuse"
  | "order"
  | "fulfill"
  | "cancel"
  | "dispute";

export type MarketplaceRequestStep =
  | (JourneyStepBase & {
      readonly kind: "mreq-submit";
      readonly factKey: string;
      readonly requestId: string;
      readonly naturalKey: string;
      readonly sku: string;
      readonly quantity: number;
      readonly requiredBy: string;
      readonly at: number;
    })
  | (JourneyStepBase & {
      readonly kind: "mreq-transition";
      readonly factKey: string;
      readonly command: MarketplaceRequestCommand;
      /** The offer id a `select` selects (empty = SELECT_OFFER_ID_REQUIRED probe). */
      readonly offerId?: string;
      /** The reason a refuse/cancel/dispute carries (empty/absent = the reason-required probe). */
      readonly reason?: string;
      readonly at: number;
    })
  | (JourneyStepBase & {
      readonly kind: "mreq-read";
      readonly factKey: string;
      readonly requestId: string;
      /** "foreign" reads through the OTHER tenant's scope (must see nothing). */
      readonly callerTenant?: "own" | "foreign";
    })
  | (JourneyStepBase & { readonly kind: "mreq-board"; readonly factKey: string });

// ---------------------------------------------------------------------------
// The marketplace offer steps (§3.2) — capture (the full-schema battery),
// the current-offer sheet (the FRESHNESS law), and the comparison
// composing the EXISTING compareQuotes + matchVendors kernels.
// ---------------------------------------------------------------------------

export type MOffCondition = "new" | "certified-refurbished" | "used";

/** An offer captured through the REAL captureMarketplaceOffer API (raw values — malformed seeds refuse honestly). */
export interface MOffOfferSeed {
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
  readonly condition: MOffCondition;
  readonly warrantyMonths: number;
  readonly validFrom: number;
  readonly validUntil: number;
  readonly sourceKind: "manual-catalogue-export" | "operator-entered" | "supplier-message-reference";
  readonly sourceReference: string;
  readonly capturedAt: number;
  /** "foreign" captures under the OTHER tenant (fail-closed probe input). */
  readonly tenant?: "own" | "foreign";
}

/** A supplier verification record the comparison's hard-constraint gate consumes (structural seam seed). */
export interface MOffVerificationSeed {
  readonly supplierId: string;
  readonly status: "pending" | "verified" | "expired" | "suspended";
  readonly expiresAt: number | null;
  /** "foreign" seeds the record under the OTHER tenant (fail-closed probe input). */
  readonly tenant?: "own" | "foreign";
}

export type MarketplaceOfferStep =
  | (JourneyStepBase & { readonly kind: "moff-capture"; readonly factKey: string; readonly offer: MOffOfferSeed })
  | (JourneyStepBase & { readonly kind: "moff-sheet"; readonly factKey: string; readonly at: number })
  | (JourneyStepBase & {
      readonly kind: "moff-compare";
      readonly factKey: string;
      readonly demandSku: string;
      readonly demandCurrency: string;
      readonly acceptableConditions: readonly MOffCondition[];
      readonly verifications: readonly MOffVerificationSeed[];
      /** Absent = the domain's DEFAULT_SCORING_WEIGHTS (5000/2000/3000). */
      readonly weights?: { readonly priceWeightBps: number; readonly termsWeightBps: number; readonly capabilityWeightBps: number };
      readonly at: number;
    });

// ---------------------------------------------------------------------------
// The supplier verification steps (§3.3) — the pending → verified |
// expired | suspended machine, the verified-only matching gate, and the
// PLAINLY-LABELLED manually-operated catalogue import seam.
// ---------------------------------------------------------------------------

export type MarketplaceSupplierStep =
  | (JourneyStepBase & { readonly kind: "mver-open"; readonly factKey: string; readonly supplierId: string })
  | (JourneyStepBase & {
      readonly kind: "mver-verify";
      readonly factKey: string;
      readonly supplierId: string;
      readonly evidenceId: string;
      readonly evidenceTenantId: string;
      readonly verifiedAt: number;
      readonly expiresAt: number;
    })
  | (JourneyStepBase & {
      readonly kind: "mver-suspend";
      readonly factKey: string;
      readonly supplierId: string;
      /** Empty = the SUSPEND_REASON_REQUIRED probe. */
      readonly reason: string;
    })
  | (JourneyStepBase & {
      readonly kind: "mver-expire";
      readonly factKey: string;
      readonly supplierId: string;
      readonly at: number;
    })
  | (JourneyStepBase & { readonly kind: "mver-gate"; readonly factKey: string; readonly at: number })
  | (JourneyStepBase & {
      readonly kind: "mver-read";
      readonly factKey: string;
      readonly supplierId: string;
      /** "foreign" reads through the OTHER tenant's scope (must see nothing). */
      readonly callerTenant?: "own" | "foreign";
    })
  | (JourneyStepBase & {
      readonly kind: "mver-catalogue-import";
      readonly factKey: string;
      /** Empty operator/export ids = the required-field probes. */
      readonly operatorId: string;
      readonly exportId: string;
      readonly exportCapturedAt: number;
      readonly entries: readonly {
        readonly supplierId: string;
        readonly sku: string;
        readonly unitCostMinor: number;
        readonly currency: string;
        readonly condition: MOffCondition;
        readonly warrantyMonths: number;
        readonly deliveryEstimateDays: number;
      }[];
    });

// ---------------------------------------------------------------------------
// The marketplace order steps (§3.4) — the order machine + the manual
// provider-ack seam (idempotent, duplicate-event-refusing) + the
// order→work composition through the REAL work package.
// ---------------------------------------------------------------------------

export type MordWorkCommand = "start" | "complete";

export type MarketplaceOrderAckStep =
  | (JourneyStepBase & {
      readonly kind: "mord-draft";
      readonly factKey: string;
      readonly orderId: string;
      readonly requestId: string;
      readonly offerId: string;
      readonly supplierId: string;
      readonly sku: string;
      readonly quantity: number;
      readonly unitCostMinor: number;
      readonly totalCostMinor: number;
      readonly currency: string;
    })
  | (JourneyStepBase & { readonly kind: "mord-place"; readonly factKey: string; readonly at: number })
  | (JourneyStepBase & {
      readonly kind: "mord-ack";
      readonly factKey: string;
      readonly providerEventId: string;
      readonly evidenceId: string;
      readonly evidenceTenantId: string;
      readonly channel: "manual-portal-export" | "manual-email-confirmation" | "manual-invoice-reference";
      readonly acknowledgedAt: number;
    })
  | (JourneyStepBase & {
      readonly kind: "mord-transition";
      readonly factKey: string;
      readonly command: "ship" | "receive" | "accept" | "record_discrepancy" | "dispute" | "return";
      /** The reason a record_discrepancy/dispute/return carries (empty = the reason-required probe). */
      readonly reason?: string;
      readonly at: number;
    })
  | (JourneyStepBase & {
      readonly kind: "mord-read";
      readonly factKey: string;
      /** "foreign" reads through the OTHER tenant's scope (must see nothing). */
      readonly callerTenant?: "own" | "foreign";
    })
  | (JourneyStepBase & { readonly kind: "mord-board"; readonly factKey: string })
  | (JourneyStepBase & { readonly kind: "mord-work-create"; readonly factKey: string; readonly workItemId: string; readonly title: string })
  | (JourneyStepBase & {
      readonly kind: "mord-work-assign";
      readonly factKey: string;
      readonly workItemId: string;
      readonly assignmentId: string;
      readonly assigneeId: string;
    })
  | (JourneyStepBase & {
      readonly kind: "mord-work-transition";
      readonly factKey: string;
      readonly workItemId: string;
      readonly command: MordWorkCommand;
    })
  | (JourneyStepBase & {
      readonly kind: "mord-work-link";
      readonly factKey: string;
      readonly workItemId: string;
      /** The order→work link kind (purchase tracking vs repair service). */
      readonly linkKind: "purchase-delivery" | "repair-service";
      readonly at: number;
    })
  | (JourneyStepBase & { readonly kind: "mord-work-gate"; readonly factKey: string })
  | (JourneyStepBase & {
      readonly kind: "mord-accept";
      readonly factKey: string;
      readonly at: number;
      /** True = the §3.4 accept COMPOSITION: the REAL work service-completion gate must clear first. */
      readonly requireWorkGate: boolean;
    });
