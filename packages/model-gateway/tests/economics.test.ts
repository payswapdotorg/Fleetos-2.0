/**
 * @fleetos/model-gateway — Wave 8 (F280C) production-economics tests:
 * budget-burn projections from the REAL usage ledger + schedule
 * (uncertainty marked), provider cost-model comparisons in bps
 * (quotes + usage both verbatim), tenant fail-closed probes.
 */
import { describe, expect, it } from "vitest";
import {
  projectBudgetBurn,
  compareProviderCosts,
  type BurnSchedulePoint,
  type ProviderCostQuoteLike,
  type UsageLedgerEntry,
} from "../src/index.js";

function entry(overrides: Partial<UsageLedgerEntry> = {}): UsageLedgerEntry {
  return {
    seq: 1,
    tenantId: "acme",
    agentId: "agent-1",
    requestRef: "req-1",
    modelId: "m-base",
    providerId: "prov-a",
    capability: "reasoning",
    units: 10,
    costMinor: 500,
    at: 100,
    digest: "usage_x",
    prevDigest: null,
    ...overrides,
  };
}

function point(overrides: Partial<BurnSchedulePoint> = {}): BurnSchedulePoint {
  return {
    label: "next-week",
    units: 20,
    costMinor: 1000,
    at: 200,
    assumption: "steady-state request rate observed over the last ledger window",
    ...overrides,
  };
}

describe("projectBudgetBurn — deterministic, uncertainty marked", () => {
  it("actuals trace to the REAL ledger (sums + entry seqs); projections add the schedule", () => {
    const ledger = [
      entry({ seq: 1, units: 10, costMinor: 500 }),
      entry({ seq: 2, units: 5, costMinor: 250, requestRef: "req-2" }),
    ];
    const result = projectBudgetBurn("acme", ledger, [point()], { ceilingMinor: 5000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const p = result.projection;
    expect(p.projection).toBe(true);
    expect(p.actuals).toEqual({
      totalUnits: 15,
      totalCostMinor: 750,
      entrySeqs: [1, 2],
      source: "usage-ledger",
    });
    expect(p.projectedTotalCostMinor).toBe(1750);
    expect(p.projectedTotalUnits).toBe(35);
    expect(p.projected).toEqual([
      {
        label: "next-week",
        units: 20,
        costMinor: 1000,
        at: 200,
        assumption: "steady-state request rate observed over the last ledger window",
        cumulativeCostMinor: 1750,
        source: "burn-schedule",
      },
    ]);
    expect(p.assumptions).toEqual([
      "steady-state request rate observed over the last ledger window",
    ]);
  });

  it("severity law: warning at >= threshold bps, breach above the ceiling, none below", () => {
    const ledger = [entry({ costMinor: 4000, units: 40 })];
    // 4000 + 1000 = 5000 of 5000 -> 10000 bps -> warning (not above).
    const warn = projectBudgetBurn("acme", ledger, [point()], { ceilingMinor: 5000 });
    expect(warn.ok && warn.projection.severity).toBe("warning");
    // 4000 + 1000 = 5000 of 4999 -> breach.
    const breach = projectBudgetBurn("acme", ledger, [point()], { ceilingMinor: 4999 });
    expect(breach.ok && breach.projection.severity).toBe("breach");
    expect(breach.ok && breach.projection.projectedRemainingMinor).toBe(-1);
    // 4000 + 1000 = 5000 of 6000 -> 8333 bps, default threshold 9000 -> none.
    const none = projectBudgetBurn("acme", ledger, [point()], { ceilingMinor: 6000 });
    expect(none.ok && none.projection.severity).toBe("none");
    expect(none.ok && none.projection.projectedUtilizationBps).toBe(8333);
  });

  it("the threshold is caller-tunable and recorded verbatim", () => {
    const ledger = [entry({ costMinor: 4000, units: 40 })];
    const result = projectBudgetBurn("acme", ledger, [point()], {
      ceilingMinor: 6000,
      warningThresholdBps: 8000,
    });
    expect(result.ok && result.projection.severity).toBe("warning");
    expect(result.ok && result.projection.warningThresholdBps).toBe(8000);
  });

  it("multiple schedule points accumulate in order with running cumulative totals", () => {
    const result = projectBudgetBurn("acme", [entry({ costMinor: 100 })], [
      point({ label: "w1", costMinor: 200, assumption: "a1" }),
      point({ label: "w2", costMinor: 300, assumption: "a2" }),
      point({ label: "w3", costMinor: 400, assumption: "a3" }),
    ], { ceilingMinor: 10000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.projection.projected.map((p) => p.cumulativeCostMinor)).toEqual([300, 600, 1000]);
    expect(result.projection.assumptions).toEqual(["a1", "a2", "a3"]);
  });

  it("identical inputs produce byte-identical projections (determinism)", () => {
    const ledger = [entry(), entry({ seq: 2, requestRef: "r2", costMinor: 100 })];
    const schedule = [point(), point({ label: "w2" })];
    const a = projectBudgetBurn("acme", ledger, schedule, { ceilingMinor: 9000 });
    const b = projectBudgetBurn("acme", ledger, schedule, { ceilingMinor: 9000 });
    expect(a).toEqual(b);
  });

  it("an empty ledger is honest actuals zero; the projection still stands on its assumptions", () => {
    const result = projectBudgetBurn("acme", [], [point()], { ceilingMinor: 1000 });
    expect(result.ok && result.projection.actuals.totalCostMinor).toBe(0);
    expect(result.ok && result.projection.actuals.entrySeqs).toEqual([]);
    expect(result.ok && result.projection.projectedTotalCostMinor).toBe(1000);
  });

  it("refuses empty schedules and empty assumptions (uncertainty must be stated)", () => {
    expect(projectBudgetBurn("acme", [], [], { ceilingMinor: 1 })).toMatchObject({
      ok: false,
      reasonCode: "EMPTY_SCHEDULE",
    });
    expect(
      projectBudgetBurn("acme", [], [point({ assumption: "   " })], { ceilingMinor: 1 }),
    ).toMatchObject({ ok: false, reasonCode: "ASSUMPTION_EMPTY" });
    expect(projectBudgetBurn("acme", [], [point({ label: "" })], { ceilingMinor: 1 })).toMatchObject({
      ok: false,
      reasonCode: "LABEL_EMPTY",
    });
  });

  it("refuses invalid ceilings, thresholds, and non-integer amounts", () => {
    expect(projectBudgetBurn("acme", [], [point()], { ceilingMinor: -1 })).toMatchObject({
      ok: false,
      reasonCode: "NEGATIVE_CEILING",
    });
    expect(
      projectBudgetBurn("acme", [], [point()], { ceilingMinor: 1, warningThresholdBps: 20000 }),
    ).toMatchObject({ ok: false, reasonCode: "INVALID_THRESHOLD_BPS" });
    expect(projectBudgetBurn("acme", [], [point({ units: 1.5 })], { ceilingMinor: 1 })).toMatchObject({
      ok: false,
      reasonCode: "NON_INTEGER_AMOUNT",
    });
    expect(projectBudgetBurn("", [], [point()], { ceilingMinor: 1 })).toMatchObject({
      ok: false,
      reasonCode: "TENANT_ID_EMPTY",
    });
  });

  it("TENANT fail-closed: a foreign-tenant ledger entry refuses the projection", () => {
    expect(
      projectBudgetBurn("acme", [entry({ tenantId: "globex" })], [point()], { ceilingMinor: 1 }),
    ).toMatchObject({ ok: false, reasonCode: "TENANT_MISMATCH" });
  });
});

describe("compareProviderCosts — quotes and usage both verbatim", () => {
  const quoteA: ProviderCostQuoteLike = { providerId: "prov-a", modelId: "m-base", unitCostMinor: 50 };
  const quoteB: ProviderCostQuoteLike = { providerId: "prov-b", modelId: "m-alt", unitCostMinor: 30 };

  it("presents the quote verbatim AND the real usage sums with entry seqs", () => {
    const ledger = [
      entry({ seq: 1, providerId: "prov-a", units: 10, costMinor: 600 }),
      entry({ seq: 2, providerId: "prov-a", units: 10, costMinor: 600, requestRef: "r2" }),
    ];
    const result = compareProviderCosts("acme", [quoteA], ledger);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const row = result.comparison.rows[0];
    expect(row).toMatchObject({
      providerId: "prov-a",
      quote: quoteA,
      usageUnits: 20,
      usageCostMinor: 1200,
      usageEntrySeqs: [1, 2],
      quoteCostMinor: 1000,
      deltaBps: 2000,
      quoteZero: false,
    });
    expect(result.comparison.quotesVerbatim).toEqual([quoteA]);
    expect(result.comparison.ordering).toBe("provider-id-lexical");
  });

  it("delta is negative when real spend is below the quote-implied cost", () => {
    const ledger = [entry({ providerId: "prov-a", units: 10, costMinor: 400 })];
    const result = compareProviderCosts("acme", [quoteA], ledger);
    // quoteCost = 50*10 = 500; usage 400 -> delta = floor(-100*10000/500) = -2000.
    expect(result.ok && result.comparison.rows[0]?.deltaBps).toBe(-2000);
  });

  it("floor division: deltas never round up", () => {
    const ledger = [entry({ providerId: "prov-a", units: 3, costMinor: 151 })];
    const result = compareProviderCosts("acme", [quoteA], ledger);
    // quoteCost = 150; delta = floor(1*10000/150) = 66.
    expect(result.ok && result.comparison.rows[0]?.deltaBps).toBe(66);
  });

  it("a quoted provider with zero usage reports honest zeros (quoteZero flag)", () => {
    const result = compareProviderCosts("acme", [quoteA, quoteB], []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const a = result.comparison.rows.find((r) => r.providerId === "prov-a");
    expect(a).toMatchObject({ usageUnits: 0, usageCostMinor: 0, quoteCostMinor: 0, deltaBps: null, quoteZero: true });
  });

  it("providers in the ledger WITHOUT a quote are listed, never silently dropped", () => {
    const ledger = [
      entry({ providerId: "prov-a" }),
      entry({ seq: 2, providerId: "prov-ghost", requestRef: "r2" }),
    ];
    const result = compareProviderCosts("acme", [quoteA], ledger);
    expect(result.ok && result.comparison.unquotedProviders).toEqual(["prov-ghost"]);
  });

  it("deterministic ordering regardless of quote input order", () => {
    const ledger = [entry({ providerId: "prov-b", units: 1, costMinor: 30 })];
    const forward = compareProviderCosts("acme", [quoteA, quoteB], ledger);
    const reversed = compareProviderCosts("acme", [quoteB, quoteA], ledger);
    expect(forward.ok && reversed.ok).toBe(true);
    if (!forward.ok || !reversed.ok) return;
    expect(forward.comparison.rows.map((r) => r.providerId)).toEqual(["prov-a", "prov-b"]);
    expect(reversed.comparison.rows.map((r) => r.providerId)).toEqual(["prov-a", "prov-b"]);
    // quotesVerbatim preserves input order (both sources verbatim).
    expect(forward.comparison.quotesVerbatim).toEqual([quoteA, quoteB]);
    expect(reversed.comparison.quotesVerbatim).toEqual([quoteB, quoteA]);
  });

  it("refuses empty quotes, invalid unit costs, duplicate provider quotes", () => {
    expect(compareProviderCosts("acme", [], [])).toMatchObject({ ok: false, reasonCode: "NO_QUOTES" });
    expect(
      compareProviderCosts("acme", [{ providerId: "p", modelId: "m", unitCostMinor: 0 }], []),
    ).toMatchObject({ ok: false, reasonCode: "INVALID_UNIT_COST" });
    expect(
      compareProviderCosts("acme", [quoteA, { ...quoteA }], []),
    ).toMatchObject({ ok: false, reasonCode: "DUPLICATE_PROVIDER_QUOTE" });
    expect(
      compareProviderCosts("acme", [{ providerId: "", modelId: "m", unitCostMinor: 1 }], []),
    ).toMatchObject({ ok: false, reasonCode: "PROVIDER_ID_EMPTY" });
  });

  it("TENANT fail-closed: a foreign-tenant ledger entry refuses the comparison", () => {
    expect(
      compareProviderCosts("acme", [quoteA], [entry({ tenantId: "globex" })]),
    ).toMatchObject({ ok: false, reasonCode: "TENANT_MISMATCH" });
    expect(compareProviderCosts("", [quoteA], [])).toMatchObject({
      ok: false,
      reasonCode: "TENANT_ID_EMPTY",
    });
  });
});
