import { describe, expect, it } from "vitest";
import type {
  Need,
  ProcurementDemand,
  Quote,
  Order,
  Fulfillment,
  QuoteScoreInput,
} from "@fleetos/procurement";
import { DEFAULT_SCORING_WEIGHTS } from "@fleetos/procurement";
import type { VendorLifecycleRecord } from "@fleetos/vendors";
import type { Subscription, Entitlement } from "@fleetos/software";
import type { CapabilityBudgetRecord } from "@fleetos/agent-organizations";
import {
  buildSpineBoard,
  buildQuoteScoreView,
  buildVendorKpiRollup,
  buildSeatView,
  buildBudgetLedgerRollup,
  CEILING_NOTE,
} from "../src/commerce-views.js";

const TENANT = { tenantId: "acme" };
const OTHER = { tenantId: "other" };
const NOW = "2026-01-01T00:00:00Z";

const need = (v: string): Need => ({
  id: { kind: "need", value: v },
  tenant: TENANT,
  description: `need-${v}`,
  requiredCapabilityTags: ["welding"],
});

const demand = (v: string, needV: string): ProcurementDemand => ({
  id: { kind: "procurement-demand", value: v },
  tenant: TENANT,
  needId: { kind: "need", value: needV },
  quantity: 3,
  requiredBy: "2026-02-01",
  capabilityTags: ["welding"],
});

const quote = (v: string, status: Quote["status"], overrides: Partial<Quote> = {}): Quote => ({
  id: { kind: "quote", value: v },
  tenant: TENANT,
  demandId: { kind: "procurement-demand", value: "d-1" },
  vendorId: "v-1",
  unitCost: 100,
  totalCost: 300,
  status,
  submittedAt: "2026-01-05T00:00:00Z",
  expiresAt: null,
  supersedes: null,
  superseded: false,
  ...overrides,
});

const order = (v: string, status: Order["status"]): Order => ({
  id: { kind: "order", value: v },
  tenant: TENANT,
  quoteId: { kind: "quote", value: "q-1" },
  status,
  authorization: { decisionId: "gd-1", authorized: true, reasonCode: "APPROVED" },
  fulfillmentVerified: false,
});

const fulfillment = (v: string, status: Fulfillment["status"]): Fulfillment => ({
  id: { kind: "fulfillment", value: v },
  tenant: TENANT,
  orderId: { kind: "order", value: "o-1" },
  status,
  verificationEvidence: null,
});

describe("buildSpineBoard", () => {
  it("counts every spine stage and preserves lineage links up the spine", () => {
    const result = buildSpineBoard({
      tenant: TENANT,
      needs: [need("n-1"), need("n-2")],
      demands: [demand("d-1", "n-1"), demand("d-2", "n-2")],
      quotes: [
        quote("q-1", "submitted"),
        quote("q-2", "accepted"),
        quote("q-3", "withdrawn", { superseded: true, supersedes: "q-2" }),
      ],
      orders: [order("o-1", "placed"), order("o-2", "received")],
      fulfillments: [fulfillment("f-1", "delivered")],
      computedAt: NOW,
    });
    if (!result.ok) throw new Error(result.reasonCode);
    const byStage = (stage: string) => result.board.cards.filter((c) => c.stage === stage);
    expect(byStage("demand").map((c) => c.parentId)).toEqual(["n-1", "n-2"]);
    expect(byStage("quote")[0]?.parentId).toBe("d-1");
    expect(byStage("order")[0]?.parentId).toBe("q-1");
    expect(byStage("fulfillment")[0]?.parentId).toBe("o-1");
    expect(result.board.counts).toContainEqual({ stage: "quote", key: "accepted", count: 1 });
    expect(result.board.counts).toContainEqual({ stage: "quote", key: "withdrawn", count: 1 });
    expect(result.board.counts).toContainEqual({ stage: "order", key: "placed", count: 1 });
    expect(result.board.supersededQuotes).toEqual(["q-3"]);
    expect(result.board.cards[0]?.provenance).toEqual([
      { recordKind: "need", recordId: "n-1" },
    ]);
  });

  it("refuses on non-integer quote money and on cross-tenant documents", () => {
    const money = buildSpineBoard({
      tenant: TENANT,
      needs: [],
      demands: [],
      quotes: [quote("q-bad", "submitted", { unitCost: 10.5 })],
      orders: [],
      fulfillments: [],
      computedAt: NOW,
    });
    expect(money.ok).toBe(false);
    if (!money.ok) {
      expect(money.reasonCode).toBe("MONEY_MUST_BE_INTEGER_MINOR");
      expect(money.detail).toBe("q-bad");
    }

    const cross = buildSpineBoard({
      tenant: TENANT,
      needs: [need("n-1")],
      demands: [demand("d-1", "n-1")],
      quotes: [quote("q-1", "submitted", { tenant: OTHER })],
      orders: [],
      fulfillments: [],
      computedAt: NOW,
    });
    expect(cross.ok).toBe(false);
    if (!cross.ok) {
      expect(cross.reasonCode).toBe("TENANT_MISMATCH");
      expect(cross.detail).toBe("q-1");
    }
  });
});

describe("buildQuoteScoreView", () => {
  const scoreInput = (
    quoteId: string,
    vendorId: string,
    unitCostMinor: number,
    totalCostMinor: number,
    leadTimeDays: number,
    capabilityTags: string[],
  ): QuoteScoreInput => ({
    quoteId,
    vendorId,
    tenant: TENANT,
    unitCostMinor,
    totalCostMinor,
    leadTimeDays,
    capabilityTags,
    submittedAtEpoch: 100,
  });

  it("surfaces the domain's exact integer-bps ranking with tie-break rules recorded", () => {
    const result = buildQuoteScoreView({
      tenant: TENANT,
      demand: { requiredCapabilityTags: ["welding"] },
      quotes: [
        scoreInput("q-1", "v-1", 100, 300, 2, ["welding"]),
        scoreInput("q-2", "v-2", 200, 600, 4, ["welding"]),
        scoreInput("q-3", "v-3", 400, 1200, 8, []),
      ],
      computedAt: NOW,
    });
    if (!result.ok) throw new Error(result.reasonCode);
    expect(result.view.ranked.map((r) => [r.rank, r.quoteId, r.totalScoreBps])).toEqual([
      [1, "q-1", 10000],
      [2, "q-2", 6500],
      [3, "q-3", 1750],
    ]);
    expect(result.view.ranked[1]?.priceScoreBps).toBe(5000);
    expect(result.view.ranked[1]?.termsScoreBps).toBe(5000);
    expect(result.view.ranked[2]?.capabilityScoreBps).toBe(0);
    expect(result.view.ranked.every((r) => r.tieBreakRule === null)).toBe(true);
    expect(result.view.weights).toEqual(DEFAULT_SCORING_WEIGHTS);
  });

  it("records the tie-break rule on the lower-ranked tied entry", () => {
    const tied = buildQuoteScoreView({
      tenant: TENANT,
      demand: { requiredCapabilityTags: ["welding"] },
      quotes: [
        scoreInput("q-cheap", "v-1", 100, 300, 2, ["welding"]),
        scoreInput("q-pricey", "v-2", 100, 600, 2, ["welding"]),
      ],
      computedAt: NOW,
    });
    if (!tied.ok) throw new Error(tied.reasonCode);
    expect(tied.view.ranked[0]?.quoteId).toBe("q-cheap");
    expect(tied.view.ranked[1]?.tieBreakRule).toBe("lower-total-cost");

    const lexical = buildQuoteScoreView({
      tenant: TENANT,
      demand: { requiredCapabilityTags: ["welding"] },
      quotes: [
        scoreInput("q-a", "v-b", 100, 300, 2, ["welding"]),
        scoreInput("q-b", "v-a", 100, 300, 2, ["welding"]),
      ],
      computedAt: NOW,
    });
    if (!lexical.ok) throw new Error(lexical.reasonCode);
    expect(lexical.view.ranked[0]?.vendorId).toBe("v-a");
    expect(lexical.view.ranked[1]?.tieBreakRule).toBe("vendor-id-lexical");
  });

  it("propagates the domain's refusal codes verbatim — never silent", () => {
    const noQuotes = buildQuoteScoreView({
      tenant: TENANT,
      demand: { requiredCapabilityTags: [] },
      quotes: [],
      computedAt: NOW,
    });
    expect(noQuotes.ok).toBe(false);
    if (!noQuotes.ok) expect(noQuotes.reasonCode).toBe("NO_QUOTES");

    const badWeights = buildQuoteScoreView({
      tenant: TENANT,
      demand: { requiredCapabilityTags: [] },
      quotes: [scoreInput("q-1", "v-1", 100, 300, 2, [])],
      weights: { priceWeightBps: 5000, termsWeightBps: 3000, capabilityWeightBps: 3000 },
      computedAt: NOW,
    });
    expect(badWeights.ok).toBe(false);
    if (!badWeights.ok) expect(badWeights.reasonCode).toBe("WEIGHTS_MUST_SUM_TO_10000");
  });
});

describe("buildVendorKpiRollup", () => {
  const vendor = (v: string, status: VendorLifecycleRecord["status"], reinstatementCount = 0): VendorLifecycleRecord => ({
    vendorId: v,
    tenant: TENANT,
    displayName: `Vendor ${v}`,
    status,
    suspendedReason: null,
    terminatedReason: null,
    terminatedAt: null,
    reinstatementCount,
  });

  it("rolls up quote outcomes, acceptance in exact bps, and exposure in minor units", () => {
    const result = buildVendorKpiRollup({
      tenant: TENANT,
      vendors: [vendor("v-1", "active", 2), vendor("v-2", "suspended")],
      quotes: [
        quote("q-1", "accepted", { vendorId: "v-1" }),
        quote("q-2", "accepted", { vendorId: "v-1" }),
        quote("q-3", "rejected", { vendorId: "v-1" }),
        quote("q-4", "submitted", { vendorId: "v-1" }),
        quote("q-5", "withdrawn", { vendorId: "v-1", superseded: true }),
      ],
      exposures: [
        {
          vendorId: "v-1",
          tenant: TENANT,
          relationshipStatus: "active",
          limitMinorUnits: 1000,
          committedMinorUnits: 250,
        },
      ],
      computedAt: NOW,
    });
    if (!result.ok) throw new Error(result.reasonCode);
    const v1 = result.rows[0];
    expect(v1?.quotesAccepted).toBe(2);
    expect(v1?.quotesRejected).toBe(1);
    expect(v1?.quotesSubmitted).toBe(1);
    expect(v1?.quotesSuperseded).toBe(1);
    expect(v1?.acceptanceBps).toBe(6666);
    expect(v1?.reinstatementCount).toBe(2);
    expect(v1?.exposure).toEqual({
      limitMinorUnits: 1000,
      committedMinorUnits: 250,
      utilizationBps: 2500,
      remainingMinorUnits: 750,
    });
    expect(result.rows[1]?.exposure).toBeNull();
    expect(result.rows.map((r) => r.vendorId)).toEqual(["v-1", "v-2"]);
  });

  it("acceptanceBps is 0 with no decided outcomes; cross-tenant vendor refuses", () => {
    const fresh = buildVendorKpiRollup({
      tenant: TENANT,
      vendors: [vendor("v-1", "prospective")],
      quotes: [],
      exposures: [],
      computedAt: NOW,
    });
    if (!fresh.ok) throw new Error(fresh.reasonCode);
    expect(fresh.rows[0]?.acceptanceBps).toBe(0);

    const refused = buildVendorKpiRollup({
      tenant: TENANT,
      vendors: [vendor("v-x", "active", 0)],
      quotes: [quote("q-1", "accepted", { tenant: OTHER })],
      exposures: [],
      computedAt: NOW,
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reasonCode).toBe("TENANT_MISMATCH");
  });
});

describe("buildSeatView", () => {
  const subscription = (v: string, seatsTotal: number, status: Subscription["status"]): Subscription => ({
    id: { kind: "subscription", value: v },
    tenant: TENANT,
    sku: `SKU-${v}`,
    seatsTotal,
    status,
    validFrom: "2025-01-01T00:00:00Z",
    validUntil: "2027-01-01T00:00:00Z",
  });

  const entitlement = (v: string, subV: string, revokedAt: string | null): Entitlement => ({
    id: { kind: "entitlement", value: v },
    tenant: TENANT,
    subscriptionId: { kind: "subscription", value: subV },
    assigneeId: `agent-${v}`,
    revokedAt,
    revokedReason: revokedAt === null ? null : "left-team",
  });

  it("counts allocated vs revoked seats with floored bps utilization and honest over-allocation", () => {
    const result = buildSeatView({
      tenant: TENANT,
      subscriptions: [subscription("s-1", 4, "active"), subscription("s-2", 2, "active")],
      entitlements: [
        entitlement("e-1", "s-1", null),
        entitlement("e-2", "s-1", null),
        entitlement("e-3", "s-1", null),
        entitlement("e-4", "s-1", "2025-06-01T00:00:00Z"),
        entitlement("e-5", "s-2", null),
        entitlement("e-6", "s-2", null),
        entitlement("e-7", "s-2", null),
      ],
      now: NOW,
      computedAt: NOW,
    });
    if (!result.ok) throw new Error(result.reasonCode);
    expect(result.rows[0]).toMatchObject({
      subscriptionId: "s-1",
      seatsTotal: 4,
      seatsAllocated: 3,
      seatsRevoked: 1,
      seatsOverAllocated: 0,
      utilizationBps: 7500,
      expired: false,
    });
    expect(result.rows[1]).toMatchObject({
      subscriptionId: "s-2",
      seatsAllocated: 3,
      seatsOverAllocated: 1,
      utilizationBps: 15000,
    });
  });

  it("marks expired subscriptions honestly and refuses cross-tenant entitlements", () => {
    const expired = buildSeatView({
      tenant: TENANT,
      subscriptions: [subscription("s-1", 4, "expired")],
      entitlements: [],
      now: NOW,
      computedAt: NOW,
    });
    if (!expired.ok) throw new Error(expired.reasonCode);
    expect(expired.rows[0]?.expired).toBe(true);

    const refused = buildSeatView({
      tenant: TENANT,
      subscriptions: [subscription("s-1", 4, "active")],
      entitlements: [{ ...entitlement("e-1", "s-1", null), tenant: OTHER }],
      now: NOW,
      computedAt: NOW,
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reasonCode).toBe("TENANT_MISMATCH");
  });
});

describe("buildBudgetLedgerRollup", () => {
  const budget = (
    v: string,
    allocatedUnits: number,
    consumedUnits: number,
    allocatedSpend: number,
    consumedSpend: number,
  ): CapabilityBudgetRecord => ({
    id: v,
    tenant: TENANT,
    scope: { kind: "agent", refId: `agent-${v}` },
    capability: "model-inference",
    allocatedUnits,
    allocatedSpendMinor: allocatedSpend,
    consumedUnits,
    consumedSpendMinor: consumedSpend,
    generation: 1,
  });

  it("rolls up spend in integer minor units with exact remainders and bps", () => {
    const result = buildBudgetLedgerRollup({
      tenant: TENANT,
      budgets: [
        budget("b-1", 10, 3, 10000, 2500),
        budget("b-2", 5, 5, 5000, 1000),
        budget("b-3", 8, 0, 8000, 0),
      ],
      computedAt: NOW,
    });
    if (!result.ok) throw new Error(result.reasonCode);
    expect(result.rows.map((r) => r.budgetId)).toEqual(["b-1", "b-2", "b-3"]);
    expect(result.rows[0]).toMatchObject({
      remainingSpendMinor: 7500,
      spendUtilizationBps: 2500,
      phase: "consumed",
      ceilingNote: CEILING_NOTE,
    });
    expect(result.rows[1]?.phase).toBe("exhausted");
    expect(result.rows[2]?.phase).toBe("allocated");
    expect(result.totals).toEqual({
      budgetCount: 3,
      allocatedSpendMinor: 23000,
      consumedSpendMinor: 3500,
      remainingSpendMinor: 19500,
      exhaustedCount: 1,
    });
  });

  it("refuses invalid budget records with the domain reason code, and cross-tenant budgets", () => {
    const invalid = buildBudgetLedgerRollup({
      tenant: TENANT,
      budgets: [budget("b-bad", 5, 9, 100, 50)],
      computedAt: NOW,
    });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.reasonCode).toBe("INVALID_BUDGET_RECORD");
      expect(invalid.detail).toContain("CONSUMPTION_EXCEEDS_ALLOCATION");
    }

    const cross = buildBudgetLedgerRollup({
      tenant: TENANT,
      budgets: [{ ...budget("b-1", 5, 1, 100, 10), tenant: OTHER }],
      computedAt: NOW,
    });
    expect(cross.ok).toBe(false);
    if (!cross.ok) expect(cross.reasonCode).toBe("TENANT_MISMATCH");
  });
});
