/**
 * @fleetos/acceptance-commerce — F331C (Wave 13 lane C) step families:
 * the marketplace-transaction steps (row 34) and the tenant-billing steps
 * (row 35). File law: this file holds ONLY the typed step data; drivers
 * live in drivers-marketplace-transactions.ts / drivers-tenant-billing.ts;
 * journeys live in journeys/marketplace-transactions.ts /
 * journeys/tenant-billing.ts.
 *
 * Time law (the F331C census mechanism, mirroring the field corpus): a
 * step carries either `at: "now"` (the driver stamps the operation at
 * the run anchor `state.time.startedAt` — the moving clock) or an
 * ABSOLUTE epoch number (a fixed world fact such as an order placed in
 * the past or a listing published last month). The domain compares the
 * two; shifting the run anchor moves `now` relative to the absolute
 * anchors and flips outcomes at genuine window/deadline boundaries
 * (the D2(b) family). Facts that are direct functions of the anchor are
 * never `eq`-asserted (they would be timestamp-echo pins — D13).
 */

import type { JourneyStepBase } from "./journey-contracts.js";

// ---------------------------------------------------------------------------
// Row 34 — marketplace transaction flow (ordering/checkout over published
// listings), driven over the REAL @fleetos/procurement entry points with
// the REAL @fleetos/vendors publication gate at the seed.
// ---------------------------------------------------------------------------

/** A listing draft the driver publishes through the REAL publication gate. */
export interface MtxListingSeed {
  readonly listingId: string;
  readonly vendorId: string;
  readonly claimedCapabilities: readonly string[];
  readonly exclusions: readonly string[];
  /** Publish, then delist through the REAL revocation cascade. */
  readonly delisted?: boolean;
  /** Absolute publication anchor (epoch ms). */
  readonly publishedAt: number;
}

export type MarketplaceTransactionStep =
  | (JourneyStepBase & {
      readonly kind: "mtx-listing-seed";
      readonly factKey: string;
      /** Verified capability records (the publication gate's input). */
      readonly records: readonly { readonly vendorId: string; readonly tag: string }[];
      readonly listings: readonly MtxListingSeed[];
    })
  | (JourneyStepBase & {
      readonly kind: "mtx-place-order";
      readonly factKey: string;
      readonly orderId: string;
      readonly listingId: string;
      readonly vendorId: string;
      readonly quantity: number;
      readonly unitPriceMinor: number;
      readonly holdMs: number;
      readonly acknowledgeExclusions: boolean;
      readonly at: "now" | number;
      /** Inject a foreign-tenant listing into the input (fail-closed probe). */
      readonly injectForeignListing?: boolean;
    })
  | (JourneyStepBase & {
      readonly kind: "mtx-checkout-order";
      readonly factKey: string;
      readonly orderId: string;
      readonly limitMinor: number;
      readonly at: "now" | number;
    })
  | (JourneyStepBase & {
      readonly kind: "mtx-cancel-order";
      readonly factKey: string;
      readonly orderId: string;
      readonly reason: string;
      readonly at: "now" | number;
    })
  | (JourneyStepBase & {
      readonly kind: "mtx-expire-order";
      readonly factKey: string;
      readonly orderId: string;
      readonly at: "now" | number;
    })
  | (JourneyStepBase & {
      readonly kind: "mtx-order-board";
      readonly factKey: string;
    });

// ---------------------------------------------------------------------------
// Row 35 — tenant billing & invoicing (seat/consumption billing from
// entitlements + gateway usage), driven over the REAL @fleetos/software
// entry points with the REAL @fleetos/model-gateway usage ledger at the
// seed (appendUsage through the documented budget-port seam).
// ---------------------------------------------------------------------------

/** A usage record the driver appends through the REAL appendUsage API. */
export interface BillingUsageSeed {
  readonly requestRef: string;
  readonly modelId: string;
  readonly capability: string;
  readonly units: number;
  readonly costMinor: number;
  /** Absolute record anchor (epoch ms). */
  readonly at: number;
}

export type TenantBillingStep =
  | (JourneyStepBase & {
      readonly kind: "billing-usage-seed";
      readonly factKey: string;
      readonly records: readonly BillingUsageSeed[];
      /** Attempt a cross-tenant append (the REAL API's fail-closed probe). */
      readonly foreignProbe?: { readonly requestRef: string };
    })
  | (JourneyStepBase & {
      readonly kind: "billing-invoice-issue";
      readonly factKey: string;
      readonly invoiceId: string;
      readonly period: { readonly from: number; readonly until: number };
      readonly seatRateMinor: number;
      readonly limitMinor: number;
      readonly graceMs?: number;
      /** "world" = the journey world's REAL subscription record. */
      readonly subscription:
        | "world"
        | { readonly status: "active" | "expired" | "cancelled"; readonly validUntil: string | null };
      /** "world" = the journey world's REAL entitlement grants. */
      readonly grants: "world" | { readonly seats: number }[];
      /** "seeded" = the seam's REAL usage ledger; "none" = empty input. */
      readonly usage: "seeded" | "none";
      readonly at: "now" | number;
      /** Inject a foreign-tenant usage record into the input (fail-closed probe). */
      readonly foreignRecord?: { readonly requestRef: string };
    });
