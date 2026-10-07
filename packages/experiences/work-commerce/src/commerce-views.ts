/**
 * @fleetos/experience-work-commerce — the procurement spine board +
 * commerce rollups (F240C, Wave 4 lane C).
 *
 * Presentation read-models over the procurement/vendors/software/
 * agent-organizations domain surfaces, projected READ-ONLY:
 *   - the Need→Demand→Quote→Order→Fulfillment status board with lineage
 *     links (parent ids) and supersession visibility;
 *   - bps quote-scoring visibility via the DOMAIN's own deterministic
 *     comparison (tie-break rules recorded, never silent);
 *   - vendor lifecycle + KPI rollups with exposure ledgers in integer
 *     minor units;
 *   - entitlement seat views (over-allocation reported honestly);
 *   - budget-ledger rollups — budgets are CEILINGS, not authorizations:
 *     a passing ceiling authorizes NOTHING (Guardian adjudicates).
 *
 * Laws: A4 (no silent clamp/drop), A5 (never self-authorize), A8 (tenant
 * fail-closed, whole-view refusal naming the offender), A12 (deterministic;
 * `computedAt`/`now` are caller-supplied), A16 (contract identity — the
 * spine NEVER conflates needs/demands/quotes/orders/fulfillments), A19
 * (digest-stamped views). Integer minor units + integer bps end to end.
 */

import type {
  Need,
  ProcurementDemand,
  Quote,
  Order,
  Fulfillment,
  QuoteScoreInput,
  ScoringWeights,
  ScoredQuote,
} from "@fleetos/procurement";
import { compareQuotes, DEFAULT_SCORING_WEIGHTS } from "@fleetos/procurement";
import type {
  VendorLifecycleRecord,
  VendorLifecycleStatus,
  ServiceExposureLedger,
} from "@fleetos/vendors";
import type { Subscription, SubscriptionStatus, Entitlement } from "@fleetos/software";
import { computeSubscriptionCompliance } from "@fleetos/software";
import type { CapabilityBudgetRecord, BudgetScope } from "@fleetos/agent-organizations";
import { classifyBudget, validateBudgetRecord } from "@fleetos/agent-organizations";
import type { TenantScopeLike, ProvenanceRef, TenantViewReasonCode } from "./internal-view.js";
import { checkTenantScope, failClosedOnRecords, fnv1a32, provenance, bpsOf } from "./internal-view.js";

export type CommerceViewReasonCode = TenantViewReasonCode | "MONEY_MUST_BE_INTEGER_MINOR" | "INVALID_BUDGET_RECORD";

// ---------------------------------------------------------------------------
// Spine board — Need → Demand → Quote → Order → Fulfillment
// ---------------------------------------------------------------------------

export type SpineStage = "need" | "demand" | "quote" | "order" | "fulfillment";
const SPINE_STAGE_ORDER: readonly SpineStage[] = ["need", "demand", "quote", "order", "fulfillment"];

export interface SpineCard {
  readonly stage: SpineStage;
  readonly id: string;
  /** Lineage link up the spine (demand→need, quote→demand, …); null for needs. */
  readonly parentId: string | null;
  /** Domain status for quotes/orders/fulfillments; null for needs/demands. */
  readonly status: string | null;
  readonly provenance: readonly ProvenanceRef[];
}

export interface SpineBoard {
  readonly kind: "procurement-spine-board";
  readonly tenantId: string;
  readonly computedAt: string;
  readonly cards: readonly SpineCard[];
  readonly counts: readonly { readonly stage: SpineStage; readonly key: string; readonly count: number }[];
  /** Quote ids that were superseded by a later revision, sorted. */
  readonly supersededQuotes: readonly string[];
  readonly digest: string;
}

export type SpineBoardResult =
  | { readonly ok: true; readonly board: SpineBoard }
  | { readonly ok: false; readonly reasonCode: CommerceViewReasonCode; readonly detail: string };

export function buildSpineBoard(input: {
  readonly tenant: TenantScopeLike;
  readonly needs: readonly Need[];
  readonly demands: readonly ProcurementDemand[];
  readonly quotes: readonly Quote[];
  readonly orders: readonly Order[];
  readonly fulfillments: readonly Fulfillment[];
  readonly computedAt: string;
}): SpineBoardResult {
  const tenant = checkTenantScope(input.tenant);
  if (!tenant.ok) return { ok: false, reasonCode: tenant.reasonCode, detail: "tenant" };

  const closed = failClosedOnRecords(tenant.tenantId, [
    ...input.needs.map((n) => ({ id: n.id.value, tenant: n.tenant })),
    ...input.demands.map((d) => ({ id: d.id.value, tenant: d.tenant })),
    ...input.quotes.map((q) => ({ id: q.id.value, tenant: q.tenant })),
    ...input.orders.map((o) => ({ id: o.id.value, tenant: o.tenant })),
    ...input.fulfillments.map((f) => ({ id: f.id.value, tenant: f.tenant })),
  ]);
  if (!closed.ok) return { ok: false, reasonCode: closed.reasonCode, detail: closed.detail };

  // Integer minor-unit money at the view boundary — refuse, never round.
  for (const q of input.quotes) {
    if (!Number.isInteger(q.unitCost) || !Number.isInteger(q.totalCost) || q.unitCost < 0 || q.totalCost < 0) {
      return { ok: false, reasonCode: "MONEY_MUST_BE_INTEGER_MINOR", detail: q.id.value };
    }
  }

  const cards: SpineCard[] = [
    ...input.needs.map((n) => card("need", n.id.value, null, null)),
    ...input.demands.map((d) => card("demand", d.id.value, d.needId.value, null)),
    ...input.quotes.map((q) => card("quote", q.id.value, q.demandId.value, q.status)),
    ...input.orders.map((o) => card("order", o.id.value, o.quoteId.value, o.status)),
    ...input.fulfillments.map((f) => card("fulfillment", f.id.value, f.orderId.value, f.status)),
  ];
  cards.sort(
    (a, b) =>
      SPINE_STAGE_ORDER.indexOf(a.stage) - SPINE_STAGE_ORDER.indexOf(b.stage) ||
      a.id.localeCompare(b.id),
  );

  const counts: { stage: SpineStage; key: string; count: number }[] = [
    { stage: "need", key: "total", count: input.needs.length },
    { stage: "demand", key: "total", count: input.demands.length },
    ...countByKey(input.quotes.map((q) => q.status)).map((e) => ({ stage: "quote" as const, ...e })),
    ...countByKey(input.orders.map((o) => o.status)).map((e) => ({ stage: "order" as const, ...e })),
    ...countByKey(input.fulfillments.map((f) => f.status)).map((e) => ({ stage: "fulfillment" as const, ...e })),
  ];

  const supersededQuotes = input.quotes.filter((q) => q.superseded).map((q) => q.id.value).sort();

  const digest = `spine_${fnv1a32([
    tenant.tenantId,
    input.computedAt,
    cards.map((c) => `${c.stage}:${c.id}->${c.parentId ?? ""}:${c.status ?? ""}`),
  ])}`;

  return {
    ok: true,
    board: {
      kind: "procurement-spine-board",
      tenantId: tenant.tenantId,
      computedAt: input.computedAt,
      cards,
      counts,
      supersededQuotes,
      digest,
    },
  };
}

function card(stage: SpineStage, id: string, parentId: string | null, status: string | null): SpineCard {
  return { stage, id, parentId, status, provenance: [provenance(stage, id)] };
}

function countByKey(values: readonly string[]): { key: string; count: number }[] {
  const byKey = new Map<string, number>();
  for (const v of values) byKey.set(v, (byKey.get(v) ?? 0) + 1);
  return [...byKey.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, count]) => ({ key, count }));
}

// ---------------------------------------------------------------------------
// Quote score view — the DOMAIN's deterministic comparison, surfaced
// ---------------------------------------------------------------------------

export interface QuoteScoreView {
  readonly kind: "quote-score-view";
  readonly tenantId: string;
  readonly computedAt: string;
  readonly requiredCapabilityTags: readonly string[];
  readonly weights: ScoringWeights;
  readonly ranked: readonly ScoredQuote[];
  readonly digest: string;
}

export type QuoteScoreViewResult =
  | { readonly ok: true; readonly view: QuoteScoreView }
  | { readonly ok: false; readonly reasonCode: string; readonly detail: string };

export function buildQuoteScoreView(input: {
  readonly tenant: TenantScopeLike;
  readonly demand: { readonly requiredCapabilityTags: readonly string[] };
  readonly quotes: readonly QuoteScoreInput[];
  readonly weights?: ScoringWeights;
  readonly computedAt: string;
}): QuoteScoreViewResult {
  const tenant = checkTenantScope(input.tenant);
  if (!tenant.ok) return { ok: false, reasonCode: tenant.reasonCode, detail: "tenant" };

  // The domain comparison is authoritative — its refusal codes propagate
  // verbatim (never silently swallowed).
  const comparison = compareQuotes(
    { tenant: { tenantId: tenant.tenantId }, requiredCapabilityTags: input.demand.requiredCapabilityTags },
    input.quotes,
    input.weights ?? DEFAULT_SCORING_WEIGHTS,
  );
  if (!comparison.ok) {
    return { ok: false, reasonCode: comparison.reasonCode, detail: "domain-comparison-refused" };
  }

  const digest = `quotescore_${fnv1a32([
    tenant.tenantId,
    input.computedAt,
    input.demand.requiredCapabilityTags,
    comparison.ranked.map((r) => `${r.rank}:${r.quoteId}:${r.totalScoreBps}:${r.tieBreakRule ?? ""}`),
  ])}`;

  return {
    ok: true,
    view: {
      kind: "quote-score-view",
      tenantId: tenant.tenantId,
      computedAt: input.computedAt,
      requiredCapabilityTags: [...input.demand.requiredCapabilityTags],
      weights: input.weights ?? DEFAULT_SCORING_WEIGHTS,
      ranked: comparison.ranked,
      digest,
    },
  };
}

// ---------------------------------------------------------------------------
// Vendor lifecycle + KPI rollup
// ---------------------------------------------------------------------------

export interface VendorKpiRow {
  readonly vendorId: string;
  readonly displayName: string;
  readonly status: VendorLifecycleStatus;
  readonly quotesSubmitted: number;
  readonly quotesAccepted: number;
  readonly quotesRejected: number;
  readonly quotesSuperseded: number;
  /** floor(accepted * 10000 / (accepted + rejected)); 0 when no decided outcome. */
  readonly acceptanceBps: number;
  readonly reinstatementCount: number;
  readonly exposure: {
    readonly limitMinorUnits: number;
    readonly committedMinorUnits: number;
    readonly utilizationBps: number;
    readonly remainingMinorUnits: number;
  } | null;
}

export type VendorKpiResult =
  | { readonly ok: true; readonly rows: readonly VendorKpiRow[]; readonly digest: string }
  | { readonly ok: false; readonly reasonCode: CommerceViewReasonCode; readonly detail: string };

export function buildVendorKpiRollup(input: {
  readonly tenant: TenantScopeLike;
  readonly vendors: readonly VendorLifecycleRecord[];
  readonly quotes: readonly Quote[];
  readonly exposures: readonly ServiceExposureLedger[];
  readonly computedAt: string;
}): VendorKpiResult {
  const tenant = checkTenantScope(input.tenant);
  if (!tenant.ok) return { ok: false, reasonCode: tenant.reasonCode, detail: "tenant" };

  const closed = failClosedOnRecords(tenant.tenantId, [
    ...input.vendors.map((v) => ({ id: v.vendorId, tenant: v.tenant })),
    ...input.quotes.map((q) => ({ id: q.id.value, tenant: q.tenant })),
    ...input.exposures.map((e) => ({ id: `exposure:${e.vendorId}`, tenant: e.tenant })),
  ]);
  if (!closed.ok) return { ok: false, reasonCode: closed.reasonCode, detail: closed.detail };

  const exposureByVendor = new Map(input.exposures.map((e) => [e.vendorId, e]));
  const rows = [...input.vendors]
    .sort((a, b) => a.vendorId.localeCompare(b.vendorId))
    .map((v) => {
      const quotes = input.quotes.filter((q) => q.vendorId === v.vendorId);
      const accepted = quotes.filter((q) => q.status === "accepted").length;
      const rejected = quotes.filter((q) => q.status === "rejected").length;
      const exposure = exposureByVendor.get(v.vendorId) ?? null;
      return {
        vendorId: v.vendorId,
        displayName: v.displayName,
        status: v.status,
        quotesSubmitted: quotes.filter((q) => q.status === "submitted").length,
        quotesAccepted: accepted,
        quotesRejected: rejected,
        quotesSuperseded: quotes.filter((q) => q.superseded).length,
        acceptanceBps: bpsOf(accepted, accepted + rejected),
        reinstatementCount: v.reinstatementCount,
        exposure:
          exposure === null
            ? null
            : {
                limitMinorUnits: exposure.limitMinorUnits,
                committedMinorUnits: exposure.committedMinorUnits,
                utilizationBps: bpsOf(exposure.committedMinorUnits, exposure.limitMinorUnits),
                remainingMinorUnits: exposure.limitMinorUnits - exposure.committedMinorUnits,
              },
      } satisfies VendorKpiRow;
    });

  const digest = `vendorkpi_${fnv1a32([
    tenant.tenantId,
    input.computedAt,
    rows.map((r) => `${r.vendorId}:${r.status}:${r.acceptanceBps}:${r.exposure?.committedMinorUnits ?? ""}`),
  ])}`;
  return { ok: true, rows, digest };
}

// ---------------------------------------------------------------------------
// Entitlement seat view — over-allocation reported honestly
// ---------------------------------------------------------------------------

export interface SeatRow {
  readonly subscriptionId: string;
  readonly sku: string;
  readonly status: SubscriptionStatus;
  readonly seatsTotal: number;
  readonly seatsAllocated: number;
  readonly seatsRevoked: number;
  readonly seatsOverAllocated: number;
  readonly utilizationBps: number;
  readonly expired: boolean;
}

export type SeatViewResult =
  | { readonly ok: true; readonly rows: readonly SeatRow[]; readonly digest: string }
  | { readonly ok: false; readonly reasonCode: CommerceViewReasonCode; readonly detail: string };

export function buildSeatView(input: {
  readonly tenant: TenantScopeLike;
  readonly subscriptions: readonly Subscription[];
  readonly entitlements: readonly Entitlement[];
  readonly now: string;
  readonly computedAt: string;
}): SeatViewResult {
  const tenant = checkTenantScope(input.tenant);
  if (!tenant.ok) return { ok: false, reasonCode: tenant.reasonCode, detail: "tenant" };

  const closed = failClosedOnRecords(tenant.tenantId, [
    ...input.subscriptions.map((s) => ({ id: s.id.value, tenant: s.tenant })),
    ...input.entitlements.map((e) => ({ id: e.id.value, tenant: e.tenant })),
  ]);
  if (!closed.ok) return { ok: false, reasonCode: closed.reasonCode, detail: closed.detail };

  const rows = [...input.subscriptions]
    .sort((a, b) => a.id.value.localeCompare(b.id.value))
    .map((s) => {
      // The DOMAIN's compliance projection is authoritative.
      const compliance = computeSubscriptionCompliance(s, input.entitlements, input.now);
      const forThis = input.entitlements.filter(
        (e) => e.subscriptionId.value === s.id.value && e.subscriptionId.kind === s.id.kind,
      );
      return {
        subscriptionId: s.id.value,
        sku: s.sku,
        status: s.status,
        seatsTotal: s.seatsTotal,
        seatsAllocated: compliance.seatsAllocated,
        seatsRevoked: forThis.filter((e) => e.revokedAt !== null).length,
        seatsOverAllocated: compliance.seatsOverAllocated,
        utilizationBps: bpsOf(compliance.seatsAllocated, s.seatsTotal),
        expired: compliance.expired,
      } satisfies SeatRow;
    });

  const digest = `seats_${fnv1a32([
    tenant.tenantId,
    input.computedAt,
    rows.map((r) => `${r.subscriptionId}:${r.seatsAllocated}/${r.seatsTotal}:${r.utilizationBps}`),
  ])}`;
  return { ok: true, rows, digest };
}

// ---------------------------------------------------------------------------
// Budget-ledger rollup — CEILINGS, never authorizations
// ---------------------------------------------------------------------------

export const CEILING_NOTE = "ceiling-satisfied-not-authorization" as const;

export interface BudgetSpendRow {
  readonly budgetId: string;
  readonly scope: BudgetScope;
  readonly capability: string;
  readonly generation: number;
  readonly phase: "allocated" | "consumed" | "exhausted";
  readonly allocatedSpendMinor: number;
  readonly consumedSpendMinor: number;
  readonly remainingSpendMinor: number;
  readonly spendUtilizationBps: number;
  readonly ceilingNote: typeof CEILING_NOTE;
}

export type BudgetLedgerRollupResult =
  | {
      readonly ok: true;
      readonly rows: readonly BudgetSpendRow[];
      readonly totals: {
        readonly budgetCount: number;
        readonly allocatedSpendMinor: number;
        readonly consumedSpendMinor: number;
        readonly remainingSpendMinor: number;
        readonly exhaustedCount: number;
      };
      readonly digest: string;
    }
  | { readonly ok: false; readonly reasonCode: CommerceViewReasonCode; readonly detail: string };

export function buildBudgetLedgerRollup(input: {
  readonly tenant: TenantScopeLike;
  readonly budgets: readonly CapabilityBudgetRecord[];
  readonly computedAt: string;
}): BudgetLedgerRollupResult {
  const tenant = checkTenantScope(input.tenant);
  if (!tenant.ok) return { ok: false, reasonCode: tenant.reasonCode, detail: "tenant" };

  const closed = failClosedOnRecords(
    tenant.tenantId,
    input.budgets.map((b) => ({ id: b.id, tenant: b.tenant })),
  );
  if (!closed.ok) return { ok: false, reasonCode: closed.reasonCode, detail: closed.detail };

  // Domain invariants are re-checked here — an invalid budget record
  // refuses the whole rollup with the DOMAIN's reason code (never silent).
  for (const b of input.budgets) {
    const validation = validateBudgetRecord(b);
    if (!validation.ok) {
      return { ok: false, reasonCode: "INVALID_BUDGET_RECORD", detail: `${b.id}:${validation.reasonCode}` };
    }
  }

  const rows = [...input.budgets]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((b) => {
      const phase = classifyBudget(b);
      return {
        budgetId: b.id,
        scope: b.scope,
        capability: b.capability,
        generation: b.generation,
        phase,
        allocatedSpendMinor: b.allocatedSpendMinor,
        consumedSpendMinor: b.consumedSpendMinor,
        remainingSpendMinor: b.allocatedSpendMinor - b.consumedSpendMinor,
        spendUtilizationBps: bpsOf(b.consumedSpendMinor, b.allocatedSpendMinor),
        ceilingNote: CEILING_NOTE,
      } satisfies BudgetSpendRow;
    });

  const allocated = rows.reduce((sum, r) => sum + r.allocatedSpendMinor, 0);
  const consumed = rows.reduce((sum, r) => sum + r.consumedSpendMinor, 0);
  const digest = `budgetledger_${fnv1a32([
    tenant.tenantId,
    input.computedAt,
    rows.map((r) => `${r.budgetId}:${r.consumedSpendMinor}/${r.allocatedSpendMinor}:${r.phase}`),
  ])}`;

  return {
    ok: true,
    rows,
    totals: {
      budgetCount: rows.length,
      allocatedSpendMinor: allocated,
      consumedSpendMinor: consumed,
      remainingSpendMinor: allocated - consumed,
      exhaustedCount: rows.filter((r) => r.phase === "exhausted").length,
    },
    digest,
  };
}
