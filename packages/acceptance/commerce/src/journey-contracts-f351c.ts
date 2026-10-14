/**
 * @fleetos/acceptance-commerce — F351C (Wave 15 lane C) step families:
 * the five commerce-discipline step groups delivered by the F351C tranche-2
 * coverage lane (docs/tech-lead/packets/f351c.md).
 *
 * CENSUS CITATION (D12-analog, the F351C commerce census — see
 * docs/evidence/F351C/report.md §1): every step family below drives a
 * public API with ZERO corpus coverage at base `cb572b8` (grep proof over
 * acceptance/field + acceptance/security + acceptance/commerce src):
 *   - ProcurementDirectoryStep  → @fleetos/procurement directory.ts
 *     (createProcurementDirectory / createOrder / matchVendors / getQuote /
 *     getOrder — the repository-backed application service; the existing
 *     procure-spine journeys drive the FLOW API `awardQuoteToOrder`, a
 *     different public entry point with a different gate).
 *   - QuoteComparisonStep       → @fleetos/procurement commerce-math.ts
 *     `compareQuotes` (the domain scoring kernel with RECORDED tie-break
 *     rules; the existing quote-scoring journey drives the EXPERIENCE
 *     read model `buildQuoteScoreView`).
 *   - VendorKpiStep             → @fleetos/vendors capability-catalog.ts
 *     (rollupVendorKpis — fulfillment-outcome KPIs; the existing
 *     vendor-kpi-view drives vendor-lifecycle buildVendorKpiRollup) and
 *     capabilityCatalogSummary.
 *   - IdempotentCreationStep    → @fleetos/procurement flow.ts
 *     createDocumentIdempotent + computeRequestDigest.
 * File law: this file holds ONLY the typed step data; drivers live in
 * drivers-procurement-directory.ts / drivers-quote-comparison.ts /
 * drivers-vendor-kpis.ts / drivers-procurement-idempotency.ts; journeys
 * live in journeys/f351c-procurement.ts + journeys/f351c-vendors.ts.
 *
 * Time law: F351C journeys are single-epoch (T0) by construction — no
 * step consumes the run anchor and no assertion carries an epoch table
 * (D13: the journeys are invariant across the whole frozen schedule,
 * machine-verified per firm; nothing outside the D8/D12-certified
 * responder set may ever earn counted epochs).
 */

import type { JourneyStepBase } from "./journey-contracts.js";

// ---------------------------------------------------------------------------
// The ProcurementDirectory steps (F351C) — the repository-backed
// application-service surface over quotes and orders (law A5: order
// creation REQUIRES a Guardian authorization; the quote must be ACCEPTED).
// ---------------------------------------------------------------------------

/** A quote seeded into the REAL in-memory procurement repository. */
export interface PdirQuoteSeed {
  readonly quoteId: string;
  readonly vendorId: string;
  readonly unitCost: number;
  readonly totalCost: number;
  /** "foreign" seeds the quote under the OTHER tenant (fail-closed probe input). */
  readonly tenant?: "own" | "foreign";
}

export type ProcurementDirectoryStep =
  | (JourneyStepBase & {
      readonly kind: "pdir-quote-seed";
      readonly factKey: string;
      readonly quotes: readonly PdirQuoteSeed[];
    })
  | (JourneyStepBase & {
      readonly kind: "pdir-quote-transition";
      readonly factKey: string;
      readonly quoteId: string;
      readonly command: "submit" | "accept" | "reject" | "expire" | "withdraw";
    })
  | (JourneyStepBase & {
      readonly kind: "pdir-order-create";
      readonly factKey: string;
      readonly orderId: string;
      readonly quoteId: string;
      /** The Guardian decision (law A5 — procurement never self-authorizes). */
      readonly authorization: { readonly decisionId: string; readonly authorized: boolean; readonly reasonCode: string };
    })
  | (JourneyStepBase & {
      readonly kind: "pdir-order-read";
      readonly factKey: string;
      readonly orderId: string;
      /** "foreign" reads through the OTHER tenant's scope (must see nothing). */
      readonly callerTenant?: "own" | "foreign";
    })
  | (JourneyStepBase & {
      readonly kind: "pdir-quote-read";
      readonly factKey: string;
      readonly quoteId: string;
      /** "foreign" reads through the OTHER tenant's scope (must see nothing). */
      readonly callerTenant?: "own" | "foreign";
    });

// ---------------------------------------------------------------------------
// The vendor-matching steps (F351C) — the REAL procurement matching engine
// through the REAL ProcurementDirectory (score composition, matched tags,
// RECORDED tie-break rules, tenant fail-closed matching).
// ---------------------------------------------------------------------------

/** A vendor the matching engine scores against the demand. */
export interface MatchVendorSeed {
  readonly vendorId: string;
  readonly capabilityTags: readonly string[];
  /** Service level in [0,1]. */
  readonly serviceLevel: number;
  /** Positive unit cost. */
  readonly unitCost: number;
  /** "foreign" seeds the vendor under the OTHER tenant (never matches). */
  readonly tenant?: "own" | "foreign";
}

export type VendorMatchingStep =
  | (JourneyStepBase & {
      readonly kind: "pdir-match-vendors";
      readonly factKey: string;
      readonly demandId: string;
      readonly demandTags: readonly string[];
      readonly vendors: readonly MatchVendorSeed[];
      /** "foreign" places the DEMAND under the OTHER tenant (fail-closed probe). */
      readonly demandTenant?: "own" | "foreign";
    });

// ---------------------------------------------------------------------------
// The quote-comparison steps (F351C) — the REAL procurement commerce-math
// kernel `compareQuotes`: integer-bps score decomposition, the weighted
// total, ranking with RECORDED tie-break rules, and the honest refusals.
// ---------------------------------------------------------------------------

/** A quote the comparison kernel scores. */
export interface QcmpQuoteSeed {
  readonly quoteId: string;
  readonly vendorId: string;
  /** Integer minor units, > 0. */
  readonly unitCostMinor: number;
  readonly totalCostMinor: number;
  /** Whole days, >= 0. */
  readonly leadTimeDays: number;
  readonly capabilityTags: readonly string[];
  readonly submittedAtEpoch: number;
  /** "foreign" seeds the quote under the OTHER tenant (fail-closed probe). */
  readonly tenant?: "own" | "foreign";
}

export type QuoteComparisonStep =
  | (JourneyStepBase & {
      readonly kind: "qcmp-compare";
      readonly factKey: string;
      readonly demandTags: readonly string[];
      readonly quotes: readonly QcmpQuoteSeed[];
      /** Absent = the domain's DEFAULT_SCORING_WEIGHTS (5000/2000/3000). */
      readonly weights?: { readonly priceWeightBps: number; readonly termsWeightBps: number; readonly capabilityWeightBps: number };
    });

// ---------------------------------------------------------------------------
// The vendor-performance steps (F351C) — the REAL vendors capability-catalog
// read models: fulfillment-outcome KPI rollups (on-time ratio + fill rate
// in integer bps) and the declared/verified capability catalog summary.
// ---------------------------------------------------------------------------

/** A fulfillment outcome record the KPI rollup consumes. */
export interface VkpiOutcomeSeed {
  readonly vendorId: string;
  readonly orderId: string;
  readonly promisedAt: number;
  readonly deliveredAt: number;
  readonly quantityOrdered: number;
  readonly quantityReceived: number;
  /** "foreign" seeds the record under the OTHER tenant (never counted). */
  readonly tenant?: "own" | "foreign";
}

/** A capability record the catalog summary counts. */
export interface VkpiCapabilitySeed {
  readonly vendorId: string;
  readonly tag: string;
  readonly status: "declared" | "verified";
  /** "foreign" seeds the record under the OTHER tenant (never counted). */
  readonly tenant?: "own" | "foreign";
}

export type VendorKpiStep =
  | (JourneyStepBase & {
      readonly kind: "vkpi-outcome-seed";
      readonly factKey: string;
      readonly outcomes: readonly VkpiOutcomeSeed[];
    })
  | (JourneyStepBase & {
      readonly kind: "vkpi-rollup";
      readonly factKey: string;
      readonly vendorId: string;
      /** "empty" runs the rollup over an empty record set (honest refusal probe). */
      readonly records: "seeded" | "empty";
      /** Present = append ONE malformed record to the seeded set (NEGATIVE_QUANTITY probe). */
      readonly malformed?: { readonly vendorId: string; readonly quantityReceived: number };
    })
  | (JourneyStepBase & {
      readonly kind: "vkpi-catalog-summary";
      readonly factKey: string;
      readonly capabilities: readonly VkpiCapabilitySeed[];
      readonly vendorId: string;
    });

// ---------------------------------------------------------------------------
// The idempotent-creation steps (F351C) — the REAL procurement flow.ts
// document idempotency discipline: same request id + same digest returns
// the ORIGINAL document id (duplicate: true); same id + different digest
// is a typed conflict; required-field refusals; deterministic digests.
// ---------------------------------------------------------------------------

export type IdempotentCreationStep =
  | (JourneyStepBase & {
      readonly kind: "pidem-create";
      readonly factKey: string;
      readonly requestId: string;
      /** The semantic content the request digest is computed from. */
      readonly semanticContent: string;
      readonly documentKind: "need" | "procurement-demand" | "quote" | "order" | "fulfillment";
      readonly documentId: string;
      readonly createdAt: number;
    })
  | (JourneyStepBase & {
      readonly kind: "pidem-digest";
      readonly factKey: string;
      /** Two semantic contents the digest law is probed over. */
      readonly first: string;
      readonly second: string;
      /** Present = a THIRD content asserted distinct from `first`. */
      readonly third?: string;
    });
