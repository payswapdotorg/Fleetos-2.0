/**
 * @fleetos/procurement — Deterministic quote comparison (scoring in
 * integer basis points) + order totals reconciliation with variance
 * classification.
 *
 * Wave 2 lane C (F220C) operational-truth grade.
 *
 * Laws: A16 (exchange semantics), A4 (no silent clamping), A20.
 *
 * NO FLOATS in decision outputs: every score is an integer number of
 * basis points. Tie-break rules are RECORDED IN THE MATCH RECORD.
 */

import type { TenantScope } from "./contracts.js";
import { validateTenantScope } from "./contracts.js";

// ---------------------------------------------------------------------------
// Quote comparison — deterministic scoring.
// ---------------------------------------------------------------------------

export interface QuoteScoreInput {
  readonly quoteId: string;
  readonly vendorId: string;
  readonly tenant: TenantScope;
  /** Integer minor units. Must be > 0. */
  readonly unitCostMinor: number;
  readonly totalCostMinor: number;
  /** Lead time in whole days. Must be >= 0. */
  readonly leadTimeDays: number;
  readonly capabilityTags: readonly string[];
  /** Submission time (epoch ms) — used as a tie-break. */
  readonly submittedAtEpoch: number;
}

export interface ScoringWeights {
  /** Integer basis points; the three weights MUST sum to exactly 10000. */
  readonly priceWeightBps: number;
  readonly termsWeightBps: number;
  readonly capabilityWeightBps: number;
}

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  priceWeightBps: 5000,
  termsWeightBps: 2000,
  capabilityWeightBps: 3000,
};

export type QuoteTieBreakRule =
  | "lower-total-cost"
  | "shorter-lead-time"
  | "earlier-submission"
  | "vendor-id-lexical";

export interface ScoredQuote {
  readonly rank: number;
  readonly quoteId: string;
  readonly vendorId: string;
  readonly totalScoreBps: number;
  readonly priceScoreBps: number;
  readonly termsScoreBps: number;
  readonly capabilityScoreBps: number;
  /**
   * Non-null only when this entry tied on totalScoreBps with the entry
   * ranked above it — the rule that resolved the tie is recorded here.
   */
  readonly tieBreakRule: QuoteTieBreakRule | null;
}

export type QuoteComparisonResult =
  | { readonly ok: true; readonly ranked: readonly ScoredQuote[] }
  | { readonly ok: false; readonly reasonCode: QuoteComparisonReasonCode };

export type QuoteComparisonReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "TENANT_MISMATCH"
  | "NO_QUOTES"
  | "WEIGHTS_MUST_SUM_TO_10000"
  | "INVALID_UNIT_COST"
  | "INVALID_LEAD_TIME";

/**
 * compareQuotes — deterministic quote scoring. All scores are integer
 * basis points (floored division — no floats, no rounding ambiguity):
 *   - priceScoreBps: cheapest unit cost scores 10000; others score
 *     floor(cheapest * 10000 / unitCost);
 *   - termsScoreBps: shortest lead time scores 10000; others score
 *     floor(shortest * 10000 / leadTime);
 *   - capabilityScoreBps: floor(matchedTags * 10000 / requiredTags)
 *     (10000 when the demand requires no tags);
 *   - totalScoreBps: floor((p*wP + t*wT + c*wC) / 10000).
 *
 * Ranking tie-breaks (documented, applied in order, recorded on the
 * lower-ranked tied entry): lower total cost → shorter lead time →
 * earlier submission → vendor id lexical.
 */
export function compareQuotes(
  demand: {
    readonly tenant: TenantScope;
    readonly requiredCapabilityTags: readonly string[];
  },
  quotes: readonly QuoteScoreInput[],
  weights: ScoringWeights = DEFAULT_SCORING_WEIGHTS,
): QuoteComparisonResult {
  const tenantCheck = validateTenantScope(demand.tenant);
  if (!tenantCheck.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  for (const q of quotes) {
    const qTenant = validateTenantScope(q.tenant);
    if (!qTenant.ok || qTenant.scope.tenantId !== tenantCheck.scope.tenantId) {
      return { ok: false, reasonCode: "TENANT_MISMATCH" };
    }
  }
  if (quotes.length === 0) return { ok: false, reasonCode: "NO_QUOTES" };
  if (
    weights.priceWeightBps + weights.termsWeightBps + weights.capabilityWeightBps !==
    10000
  ) {
    return { ok: false, reasonCode: "WEIGHTS_MUST_SUM_TO_10000" };
  }
  for (const q of quotes) {
    if (!Number.isInteger(q.unitCostMinor) || q.unitCostMinor <= 0) {
      return { ok: false, reasonCode: "INVALID_UNIT_COST" };
    }
    if (!Number.isInteger(q.leadTimeDays) || q.leadTimeDays < 0) {
      return { ok: false, reasonCode: "INVALID_LEAD_TIME" };
    }
  }

  const cheapest = Math.min(...quotes.map((q) => q.unitCostMinor));
  const shortest = Math.min(...quotes.map((q) => q.leadTimeDays));
  const required = [...new Set(demand.requiredCapabilityTags)];

  const scored = quotes.map((q) => {
    const priceScoreBps = Math.floor((cheapest * 10000) / q.unitCostMinor);
    const termsScoreBps =
      q.leadTimeDays === 0 ? 10000 : Math.floor((shortest * 10000) / q.leadTimeDays);
    const matched = required.filter((t) => q.capabilityTags.includes(t)).length;
    const capabilityScoreBps =
      required.length === 0 ? 10000 : Math.floor((matched * 10000) / required.length);
    const totalScoreBps = Math.floor(
      (priceScoreBps * weights.priceWeightBps +
        termsScoreBps * weights.termsWeightBps +
        capabilityScoreBps * weights.capabilityWeightBps) /
        10000,
    );
    return { q, priceScoreBps, termsScoreBps, capabilityScoreBps, totalScoreBps };
  });

  const sorted = [...scored].sort((a, b) => {
    if (b.totalScoreBps !== a.totalScoreBps) return b.totalScoreBps - a.totalScoreBps;
    if (a.q.totalCostMinor !== b.q.totalCostMinor) return a.q.totalCostMinor - b.q.totalCostMinor;
    if (a.q.leadTimeDays !== b.q.leadTimeDays) return a.q.leadTimeDays - b.q.leadTimeDays;
    if (a.q.submittedAtEpoch !== b.q.submittedAtEpoch) return a.q.submittedAtEpoch - b.q.submittedAtEpoch;
    return a.q.vendorId.localeCompare(b.q.vendorId);
  });

  const ranked: ScoredQuote[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i];
    if (current === undefined) continue;
    const previous = i > 0 ? sorted[i - 1] : undefined;
    let tieBreakRule: QuoteTieBreakRule | null = null;
    if (previous !== undefined && previous.totalScoreBps === current.totalScoreBps) {
      if (current.q.totalCostMinor !== previous.q.totalCostMinor) {
        tieBreakRule = "lower-total-cost";
      } else if (current.q.leadTimeDays !== previous.q.leadTimeDays) {
        tieBreakRule = "shorter-lead-time";
      } else if (current.q.submittedAtEpoch !== previous.q.submittedAtEpoch) {
        tieBreakRule = "earlier-submission";
      } else {
        tieBreakRule = "vendor-id-lexical";
      }
    }
    ranked.push({
      rank: i + 1,
      quoteId: current.q.quoteId,
      vendorId: current.q.vendorId,
      totalScoreBps: current.totalScoreBps,
      priceScoreBps: current.priceScoreBps,
      termsScoreBps: current.termsScoreBps,
      capabilityScoreBps: current.capabilityScoreBps,
      tieBreakRule,
    });
  }
  return { ok: true, ranked };
}

// ---------------------------------------------------------------------------
// Order totals reconciliation — received vs ordered with variance
// classification.
// ---------------------------------------------------------------------------

export interface OrderTotals {
  readonly orderId: string;
  readonly tenant: TenantScope;
  readonly orderedQuantity: number;
  readonly unitCostMinor: number;
}

export interface OrderReceipt {
  readonly orderId: string;
  readonly tenant: TenantScope;
  readonly receivedQuantity: number;
  readonly receivedAt: number;
}

export type VarianceClassification = "exact" | "short" | "over";

export interface OrderReconciliation {
  readonly orderId: string;
  readonly orderedQuantity: number;
  readonly receivedQuantity: number;
  readonly varianceQuantity: number;
  /** |variance| in integer basis points of the ordered quantity. */
  readonly varianceBps: number;
  readonly classification: VarianceClassification;
  readonly receiptCount: number;
}

export type ReconciliationResult =
  | { readonly ok: true; readonly reconciliation: OrderReconciliation }
  | { readonly ok: false; readonly reasonCode: ReconciliationReasonCode };

export type ReconciliationReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "TENANT_MISMATCH"
  | "NEGATIVE_QUANTITY"
  | "RECEIPT_ORDER_MISMATCH";

/**
 * reconcileOrderTotals — deterministic reconciliation of received vs
 * ordered. Multiple receipts are summed. The variance is classified
 * exact/short/over with the magnitude in integer basis points of the
 * ordered quantity. Receipts from another tenant are refused (fail-closed).
 */
export function reconcileOrderTotals(
  order: OrderTotals,
  receipts: readonly OrderReceipt[],
): ReconciliationResult {
  const orderTenant = validateTenantScope(order.tenant);
  if (!orderTenant.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  if (!Number.isInteger(order.orderedQuantity) || order.orderedQuantity <= 0) {
    return { ok: false, reasonCode: "NEGATIVE_QUANTITY" };
  }
  if (!Number.isInteger(order.unitCostMinor) || order.unitCostMinor < 0) {
    return { ok: false, reasonCode: "NEGATIVE_QUANTITY" };
  }
  let receivedQuantity = 0;
  let receiptCount = 0;
  for (const r of receipts) {
    const rTenant = validateTenantScope(r.tenant);
    if (!rTenant.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
    if (rTenant.scope.tenantId !== orderTenant.scope.tenantId) {
      return { ok: false, reasonCode: "TENANT_MISMATCH" };
    }
    if (r.orderId !== order.orderId) {
      return { ok: false, reasonCode: "RECEIPT_ORDER_MISMATCH" };
    }
    if (!Number.isInteger(r.receivedQuantity) || r.receivedQuantity < 0) {
      return { ok: false, reasonCode: "NEGATIVE_QUANTITY" };
    }
    receivedQuantity += r.receivedQuantity;
    receiptCount += 1;
  }
  const varianceQuantity = receivedQuantity - order.orderedQuantity;
  const classification: VarianceClassification =
    varianceQuantity === 0 ? "exact" : varianceQuantity < 0 ? "short" : "over";
  const varianceBps = Math.floor((Math.abs(varianceQuantity) * 10000) / order.orderedQuantity);
  return {
    ok: true,
    reconciliation: {
      orderId: order.orderId,
      orderedQuantity: order.orderedQuantity,
      receivedQuantity,
      varianceQuantity,
      varianceBps,
      classification,
      receiptCount,
    },
  };
}
