/**
 * @fleetos/procurement — The marketplace offer comparison (F361C, Wave
 * 17 lane C; the F360 freeze §3.2): HARD-ELIGIBILITY CONSTRAINTS
 * separated from PREFERENCE WEIGHTS, composing the EXISTING public
 * scoring kernels — `compareQuotes` (commerce-math.ts, the integer-bps
 * quote scorer) and `matchVendors` (matching.ts, the recorded-tie-break
 * supplier matcher) — with a per-offer EXPLAINABLE RATIONALE.
 *
 * Documented laws (machine-tested in tests/marketplace-offer.test.ts):
 *   - HARD vs PREFERENCE SEPARATION: the six hard constraints
 *     (supplier-verification gate, SKU, freshness, currency, condition)
 *     decide ELIGIBILITY ONLY — an ineligible offer never enters the
 *     weighted ranking (a preference weight can NEVER rescue a failed
 *     hard constraint). The preference weights rank ONLY the eligible
 *     set, through the EXISTING compareQuotes kernel.
 *   - VERIFIED-ONLY ENTER MATCHING (freeze §3.3): a supplier that is
 *     not verified-and-current at the comparison instant is a hard
 *     constraint failure (SUPPLIER_NOT_VERIFIED / VERIFICATION_EXPIRED)
 *     and its offers are ineligible.
 *   - FRESHNESS: an offer whose validity window is not current at `at`
 *     is ineligible (OFFER_EXPIRED / OFFER_NOT_YET_VALID) — an expired
 *     offer NEVER silently appears current (mission §3.2).
 *   - FAIL-CLOSED: a foreign-tenant offer OR verification record in the
 *     input REFUSES the whole comparison (TENANT_MISMATCH, law A8) —
 *     never silently filtered.
 *   - RATIONALE: every offer (eligible or not) carries its hard-
 *     constraint report; every eligible offer additionally carries the
 *     compareQuotes rank + integer-bps score decomposition + recorded
 *     tie-break rule, and its supplier's matchVendors score + matched
 *     tags + recorded supplier tie-break — the explainable record.
 *   - WARRANTY→SERVICE PROXY (documented): the frozen offer schema
 *     carries no service metric, so the supplier service level passed
 *     to matchVendors is min(warrantyMonths, 36) / 36 — the documented
 *     deterministic mapping of the offer's warranty term.
 *   - DETERMINISTIC ORDER: rationales list eligible entries first (in
 *     compareQuotes rank order), then ineligible entries (offerId
 *     lexical); supplierMatches are matchVendors' own order.
 *
 * Laws: A1, A4, A8, A16, A20. Pure deterministic TS; time is an
 * explicit `number` input (epoch ms).
 */

import type { TenantScope } from "./contracts.js";
import { validateTenantScope } from "./contracts.js";
import type { MarketplaceOffer, OfferCondition } from "./marketplace-offer.js";
import { assessOfferFreshness } from "./marketplace-offer.js";
import { compareQuotes, type QuoteTieBreakRule, type ScoredQuote, type ScoringWeights } from "./commerce-math.js";
import { matchVendors, type TieBreakRule, type VendorMatch } from "./matching.js";

// ---------------------------------------------------------------------------
// LOCAL structural supplier-verification seam (cross-context, law A13/20).
// Structurally compatible with @fleetos/vendors SupplierVerificationRecord;
// the acceptance lane is the composition site that binds the REAL records.
// ---------------------------------------------------------------------------

export interface SupplierVerificationLike {
  readonly supplierId: string;
  readonly tenant: TenantScope;
  readonly status: "pending" | "verified" | "expired" | "suspended";
  readonly expiresAt: number | null;
}

// ---------------------------------------------------------------------------
// The comparison input.
// ---------------------------------------------------------------------------

export interface MarketplaceOfferDemand {
  readonly tenant: TenantScope;
  readonly sku: string;
  readonly currency: string;
  /** Hard-constraint set: an offer whose condition is not listed is ineligible. */
  readonly acceptableConditions: readonly OfferCondition[];
}

export interface MarketplaceOfferComparisonOptions {
  /** The comparison instant — the freshness anchor (epoch ms). */
  readonly at: number;
  /** Absent = the domain's DEFAULT_SCORING_WEIGHTS (5000/2000/3000). */
  readonly weights?: ScoringWeights;
}

// ---------------------------------------------------------------------------
// Hard constraints (eligibility) — never weighted, never rescuable.
// ---------------------------------------------------------------------------

export type MarketplaceHardConstraintName =
  | "supplier_verification"
  | "sku"
  | "freshness"
  | "currency"
  | "condition";

export type MarketplaceHardConstraintReasonCode =
  | "SUPPLIER_NOT_VERIFIED"
  | "VERIFICATION_EXPIRED"
  | "OFFER_SKU_MISMATCH"
  | "OFFER_EXPIRED"
  | "OFFER_NOT_YET_VALID"
  | "OFFER_CURRENCY_MISMATCH"
  | "OFFER_CONDITION_NOT_ACCEPTABLE";

export interface HardConstraintCheck {
  readonly constraint: MarketplaceHardConstraintName;
  readonly pass: boolean;
  readonly reasonCode: MarketplaceHardConstraintReasonCode | null;
}

// ---------------------------------------------------------------------------
// The per-offer explainable rationale.
// ---------------------------------------------------------------------------

export interface MarketplaceOfferRationale {
  readonly offerId: string;
  readonly supplierId: string;
  readonly eligible: boolean;
  readonly hardConstraints: readonly HardConstraintCheck[];
  // Preference-weight layer (eligible offers only; null when ineligible):
  readonly rank: number | null;
  readonly totalScoreBps: number | null;
  readonly priceScoreBps: number | null;
  readonly termsScoreBps: number | null;
  readonly capabilityScoreBps: number | null;
  readonly tieBreakRule: QuoteTieBreakRule | null;
  // Supplier-match layer (eligible offers only; from matchVendors):
  readonly supplierMatchScore: number | null;
  readonly supplierTieBreakRule: TieBreakRule | null;
  readonly matchedTags: readonly string[];
}

export type MarketplaceOfferComparisonResult =
  | {
      readonly ok: true;
      /** compareQuotes' ranked output over the ELIGIBLE offers, verbatim. */
      readonly ranked: readonly ScoredQuote[];
      /** Every offer's explainable rationale (eligible first, then ineligible). */
      readonly rationales: readonly MarketplaceOfferRationale[];
      /** matchVendors' output over the eligible suppliers, verbatim. */
      readonly supplierMatches: readonly VendorMatch[];
      readonly eligibleCount: number;
      readonly ineligibleCount: number;
    }
  | {
      readonly ok: false;
      readonly reasonCode: MarketplaceOfferComparisonReasonCode;
      /** Present on NO_ELIGIBLE_OFFERS only — the per-offer hard-constraint report. */
      readonly rationales?: readonly MarketplaceOfferRationale[];
    };

export type MarketplaceOfferComparisonReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "TENANT_MISMATCH"
  | "NO_OFFERS"
  | "DUPLICATE_OFFER_ID"
  | "WEIGHTS_MUST_SUM_TO_10000"
  | "NO_ELIGIBLE_OFFERS"
  | "INVALID_COMPARISON_TIME"
  // Propagated verbatim from the composed compareQuotes kernel:
  | "NO_QUOTES"
  | "INVALID_UNIT_COST"
  | "INVALID_LEAD_TIME";

/** The documented warranty→service-level proxy cap (36 months scores 1.0). */
export const SERVICE_WARRANTY_CAP_MONTHS = 36;

function warrantyServiceLevel(warrantyMonths: number): number {
  return Math.min(warrantyMonths, SERVICE_WARRANTY_CAP_MONTHS) / SERVICE_WARRANTY_CAP_MONTHS;
}

/**
 * compareMarketplaceOffers — the freeze §3.2 comparison: hard-constraint
 * eligibility gate, then the EXISTING compareQuotes preference-weight
 * ranking and the EXISTING matchVendors supplier match over the eligible
 * set, with a per-offer explainable rationale. A foreign-tenant offer or
 * verification record refuses the whole comparison fail-closed.
 */
export function compareMarketplaceOffers(
  demand: MarketplaceOfferDemand,
  offers: readonly MarketplaceOffer[],
  supplierVerifications: readonly SupplierVerificationLike[],
  options: MarketplaceOfferComparisonOptions,
): MarketplaceOfferComparisonResult {
  const tenantCheck = validateTenantScope(demand.tenant);
  if (!tenantCheck.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  if (offers.length === 0) return { ok: false, reasonCode: "NO_OFFERS" };
  if (!Number.isInteger(options.at) || options.at < 0) {
    return { ok: false, reasonCode: "INVALID_COMPARISON_TIME" };
  }
  const seen = new Set<string>();
  for (const offer of offers) {
    const offerTenant = validateTenantScope(offer.tenant);
    if (!offerTenant.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
    if (offerTenant.scope.tenantId !== tenantCheck.scope.tenantId) {
      return { ok: false, reasonCode: "TENANT_MISMATCH" };
    }
    if (seen.has(offer.offerId)) return { ok: false, reasonCode: "DUPLICATE_OFFER_ID" };
    seen.add(offer.offerId);
  }
  for (const verification of supplierVerifications) {
    const vTenant = validateTenantScope(verification.tenant);
    if (!vTenant.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
    if (vTenant.scope.tenantId !== tenantCheck.scope.tenantId) {
      return { ok: false, reasonCode: "TENANT_MISMATCH" };
    }
  }
  if (options.weights !== undefined) {
    const w = options.weights;
    if (w.priceWeightBps + w.termsWeightBps + w.capabilityWeightBps !== 10000) {
      return { ok: false, reasonCode: "WEIGHTS_MUST_SUM_TO_10000" };
    }
  }

  const eligible: MarketplaceOffer[] = [];
  const checksByOfferId = new Map<string, readonly HardConstraintCheck[]>();
  for (const offer of offers) {
    const checks = checkHardConstraints(offer, demand, supplierVerifications, options.at);
    checksByOfferId.set(offer.offerId, checks);
    if (checks.every((c) => c.pass)) eligible.push(offer);
  }
  if (eligible.length === 0) {
    const rationales = offers.map((offer) => ineligibleRationale(offer, checksByOfferId.get(offer.offerId) ?? []))
      .sort((a, b) => a.offerId.localeCompare(b.offerId));
    return { ok: false, reasonCode: "NO_ELIGIBLE_OFFERS", rationales };
  }

  // Preference layer 1 — the EXISTING compareQuotes kernel over the eligible set.
  const quoteInputs = eligible.map((offer) => ({
    quoteId: offer.offerId,
    vendorId: offer.supplierId,
    tenant: offer.tenant,
    unitCostMinor: offer.unitCostMinor,
    totalCostMinor: offer.totalCostMinor,
    leadTimeDays: offer.deliveryEstimateDays,
    capabilityTags: [offer.sku] as readonly string[],
    submittedAtEpoch: offer.capturedAt,
  }));
  const comparison = compareQuotes(
    { tenant: demand.tenant, requiredCapabilityTags: [demand.sku] },
    quoteInputs,
    options.weights,
  );
  if (!comparison.ok) return { ok: false, reasonCode: comparison.reasonCode };

  // Preference layer 2 — the EXISTING matchVendors matcher over the eligible
  // suppliers (one entry per supplier: its lowest-cost eligible offer's terms).
  const bestBySupplier = new Map<string, MarketplaceOffer>();
  for (const offer of eligible) {
    const current = bestBySupplier.get(offer.supplierId);
    if (current === undefined || offer.unitCostMinor < current.unitCostMinor) {
      bestBySupplier.set(offer.supplierId, offer);
    }
  }
  const matchDemand = {
    id: { kind: "procurement-demand" as const, value: `marketplace-comparison:${demand.sku}` },
    tenant: demand.tenant,
    needId: { kind: "need" as const, value: `marketplace-comparison:${demand.sku}` },
    quantity: 1,
    requiredBy: String(options.at),
    capabilityTags: [demand.sku] as readonly string[],
  };
  const vendorInputs = [...bestBySupplier.values()].map((offer) => ({
    vendorId: offer.supplierId,
    tenant: offer.tenant,
    capabilityTags: [offer.sku] as readonly string[],
    serviceLevel: warrantyServiceLevel(offer.warrantyMonths),
    unitCost: offer.unitCostMinor,
  }));
  const supplierMatches = matchVendors(matchDemand, vendorInputs);

  // Attach the explainable layers to the eligible rationales.
  const rankByOfferId = new Map(comparison.ranked.map((r) => [r.quoteId, r]));
  const matchBySupplierId = new Map(supplierMatches.map((m) => [m.vendorId, m]));
  const eligibleRationales: MarketplaceOfferRationale[] = eligible.map((offer) => {
    const scored = rankByOfferId.get(offer.offerId);
    const match = matchBySupplierId.get(offer.supplierId);
    return {
      offerId: offer.offerId,
      supplierId: offer.supplierId,
      eligible: true,
      hardConstraints: checksByOfferId.get(offer.offerId) ?? [],
      rank: scored?.rank ?? null,
      totalScoreBps: scored?.totalScoreBps ?? null,
      priceScoreBps: scored?.priceScoreBps ?? null,
      termsScoreBps: scored?.termsScoreBps ?? null,
      capabilityScoreBps: scored?.capabilityScoreBps ?? null,
      tieBreakRule: scored?.tieBreakRule ?? null,
      supplierMatchScore: match?.score ?? null,
      supplierTieBreakRule: match?.tieBreakRule ?? null,
      matchedTags: [...(match?.matchedTags ?? [])],
    };
  });

  // Deterministic order: eligible (rank order) first, then ineligible (lexical).
  eligibleRationales.sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
  const ineligibleRationales = offers
    .filter((o) => !eligible.includes(o))
    .map((offer) => ineligibleRationale(offer, checksByOfferId.get(offer.offerId) ?? []))
    .sort((a, b) => a.offerId.localeCompare(b.offerId));
  return {
    ok: true,
    ranked: comparison.ranked,
    rationales: [...eligibleRationales, ...ineligibleRationales],
    supplierMatches,
    eligibleCount: eligible.length,
    ineligibleCount: offers.length - eligible.length,
  };
}

function ineligibleRationale(
  offer: MarketplaceOffer,
  checks: readonly HardConstraintCheck[],
): MarketplaceOfferRationale {
  return {
    offerId: offer.offerId,
    supplierId: offer.supplierId,
    eligible: false,
    hardConstraints: checks,
    rank: null,
    totalScoreBps: null,
    priceScoreBps: null,
    termsScoreBps: null,
    capabilityScoreBps: null,
    tieBreakRule: null,
    supplierMatchScore: null,
    supplierTieBreakRule: null,
    matchedTags: [],
  };
}

function checkHardConstraints(
  offer: MarketplaceOffer,
  demand: MarketplaceOfferDemand,
  verifications: readonly SupplierVerificationLike[],
  at: number,
): readonly HardConstraintCheck[] {
  const verification = verifications.find((v) => v.supplierId === offer.supplierId);
  let verificationCode: MarketplaceHardConstraintReasonCode | null = null;
  if (verification === undefined || verification.status !== "verified") {
    verificationCode = "SUPPLIER_NOT_VERIFIED";
  } else if (verification.expiresAt === null || at > verification.expiresAt) {
    // WINDOW LAW: at == expiresAt is still inside; at > expiresAt has lapsed.
    verificationCode = "VERIFICATION_EXPIRED";
  }
  const freshness = assessOfferFreshness(offer, at);
  const freshnessCode: MarketplaceHardConstraintReasonCode | null =
    freshness.verdict === "fresh"
      ? null
      : freshness.verdict === "expired"
        ? "OFFER_EXPIRED"
        : "OFFER_NOT_YET_VALID";
  const skuCode = offer.sku === demand.sku ? null : "OFFER_SKU_MISMATCH";
  const currencyCode = offer.currency === demand.currency ? null : "OFFER_CURRENCY_MISMATCH";
  const conditionCode = demand.acceptableConditions.includes(offer.condition)
    ? null
    : "OFFER_CONDITION_NOT_ACCEPTABLE";
  return [
    { constraint: "supplier_verification", pass: verificationCode === null, reasonCode: verificationCode },
    { constraint: "sku", pass: skuCode === null, reasonCode: skuCode },
    { constraint: "freshness", pass: freshnessCode === null, reasonCode: freshnessCode },
    { constraint: "currency", pass: currencyCode === null, reasonCode: currencyCode },
    { constraint: "condition", pass: conditionCode === null, reasonCode: conditionCode },
  ];
}
