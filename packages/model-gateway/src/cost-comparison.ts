/**
 * @fleetos/model-gateway — Provider cost-model comparison in bps: the
 * REAL vendor quotes (structural seam — quotes are caller-supplied at
 * the composition site) against the REAL usage ledger. The comparison
 * presents BOTH sources verbatim: the quotes as passed, and the usage
 * aggregates summed from actual ledger entries with their seqs.
 *
 * Wave 8 lane C (F280C) production-economics grade.
 *
 * Laws: A1 (the usage ledger is the actuals authority), A4 (deltas are
 * honest — never clamped), A8 (tenant-scoped, fail-closed), A20.
 *
 * COMPARISON LAW (documented):
 *   - For each provider with a quote: quoteCostMinor = floor(quote unit
 *     cost * usage units) — the quote-implied cost of the units ACTUALLY
 *     consumed; usageCostMinor = Σ ledger costMinor for that provider
 *     (the real spend), with entry seqs.
 *   - deltaBps = floor((usageCost - quoteCost) * 10000 / quoteCost) —
 *     positive means the real spend EXCEEDS the quote-implied cost.
 *     quoteCost of 0 with nonzero usage is reported with
 *     deltaBps: null and flagged quoteZero (honest, no division by zero).
 *   - A provider present in the ledger with NO quote is reported as
 *     unquoted (UNQUOTED_PROVIDERS lists them; never silently dropped).
 *   - Output ordering: providerId lexical — the deterministic key order.
 *   - Fail-closed: a ledger entry from another tenant refuses the
 *     comparison (TENANT_MISMATCH).
 */

import type { UsageLedgerEntry } from "./usage.js";

// ---------------------------------------------------------------------------
// Quotes (structural seam) + comparison contracts.
// ---------------------------------------------------------------------------

/**
 * ProviderCostQuoteLike — the LOCAL structural shape of a vendor quote
 * for a provider's cost model (per-unit price in integer minor units).
 * The composing application binds REAL vendor quotes at the composition
 * site; this package does not import the vendors/procurement contexts.
 */
export interface ProviderCostQuoteLike {
  readonly providerId: string;
  readonly modelId: string;
  /** Per-unit price in integer minor units. Must be > 0. */
  readonly unitCostMinor: number;
}

export interface ProviderCostComparisonRow {
  readonly providerId: string;
  readonly modelId: string | null;
  /** The quote verbatim (as passed in). */
  readonly quote: ProviderCostQuoteLike;
  /** Units actually consumed by this provider (REAL ledger sums). */
  readonly usageUnits: number;
  /** Real spend (REAL ledger sums) with contributing entry seqs. */
  readonly usageCostMinor: number;
  readonly usageEntrySeqs: readonly number[];
  /** floor(unitCostMinor * usageUnits) — the quote-implied cost. */
  readonly quoteCostMinor: number;
  /** floor((usageCost - quoteCost) * 10000 / quoteCost); null if quoteCost 0. */
  readonly deltaBps: number | null;
  readonly quoteZero: boolean;
}

export interface ProviderCostComparison {
  readonly tenantId: string;
  readonly rows: readonly ProviderCostComparisonRow[];
  /** Providers seen in the ledger with NO quote — never silently dropped. */
  readonly unquotedProviders: readonly string[];
  /** The quotes verbatim, in input order (both sources preserved). */
  readonly quotesVerbatim: readonly ProviderCostQuoteLike[];
  readonly ordering: "provider-id-lexical";
}

export type ProviderCostComparisonResult =
  | { readonly ok: true; readonly comparison: ProviderCostComparison }
  | { readonly ok: false; readonly reasonCode: ProviderCostComparisonReasonCode };

export type ProviderCostComparisonReasonCode =
  | "TENANT_ID_EMPTY"
  | "TENANT_MISMATCH"
  | "NO_QUOTES"
  | "PROVIDER_ID_EMPTY"
  | "MODEL_ID_EMPTY"
  | "INVALID_UNIT_COST"
  | "DUPLICATE_PROVIDER_QUOTE";

/**
 * compareProviderCosts — deterministic provider cost-model comparison in
 * bps, presenting the REAL quotes and the REAL usage ledger side by
 * side. Identical inputs produce byte-identical outputs.
 */
export function compareProviderCosts(
  tenantId: string,
  quotes: readonly ProviderCostQuoteLike[],
  ledger: readonly UsageLedgerEntry[],
): ProviderCostComparisonResult {
  if (tenantId.length === 0) return { ok: false, reasonCode: "TENANT_ID_EMPTY" };
  if (quotes.length === 0) return { ok: false, reasonCode: "NO_QUOTES" };
  const seenProviders = new Set<string>();
  for (const quote of quotes) {
    if (quote.providerId.length === 0) return { ok: false, reasonCode: "PROVIDER_ID_EMPTY" };
    if (quote.modelId.length === 0) return { ok: false, reasonCode: "MODEL_ID_EMPTY" };
    if (!Number.isInteger(quote.unitCostMinor) || quote.unitCostMinor <= 0) {
      return { ok: false, reasonCode: "INVALID_UNIT_COST" };
    }
    if (seenProviders.has(quote.providerId)) {
      return { ok: false, reasonCode: "DUPLICATE_PROVIDER_QUOTE" };
    }
    seenProviders.add(quote.providerId);
  }
  // REAL usage aggregation per provider (fail-closed on foreign tenants).
  const usageByProvider = new Map<string, { units: number; cost: number; seqs: number[]; models: Set<string> }>();
  for (const entry of ledger) {
    if (entry.tenantId !== tenantId) {
      return { ok: false, reasonCode: "TENANT_MISMATCH" };
    }
    const bucket = usageByProvider.get(entry.providerId);
    if (bucket === undefined) {
      usageByProvider.set(entry.providerId, {
        units: entry.units,
        cost: entry.costMinor,
        seqs: [entry.seq],
        models: new Set([entry.modelId]),
      });
    } else {
      bucket.units += entry.units;
      bucket.cost += entry.costMinor;
      bucket.seqs.push(entry.seq);
      bucket.models.add(entry.modelId);
    }
  }
  const rows: ProviderCostComparisonRow[] = [];
  for (const quote of quotes) {
    const usage = usageByProvider.get(quote.providerId);
    const usageUnits = usage?.units ?? 0;
    const usageCostMinor = usage?.cost ?? 0;
    const quoteCostMinor = Math.floor(quote.unitCostMinor * usageUnits);
    const quoteZero = quoteCostMinor === 0;
    const deltaBps = quoteZero
      ? null
      : Math.floor(((usageCostMinor - quoteCostMinor) * 10000) / quoteCostMinor);
    rows.push({
      providerId: quote.providerId,
      modelId: usage?.models.size === 1 ? [...usage.models][0] ?? null : quote.modelId,
      quote,
      usageUnits,
      usageCostMinor,
      usageEntrySeqs: usage?.seqs ?? [],
      quoteCostMinor,
      deltaBps,
      quoteZero,
    });
  }
  rows.sort((a, b) => a.providerId.localeCompare(b.providerId));
  const unquotedProviders = [...usageByProvider.keys()]
    .filter((providerId) => !seenProviders.has(providerId))
    .sort();
  return {
    ok: true,
    comparison: {
      tenantId,
      rows,
      unquotedProviders,
      quotesVerbatim: quotes,
      ordering: "provider-id-lexical",
    },
  };
}
