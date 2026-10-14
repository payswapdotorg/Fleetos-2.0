/**
 * F331C (Wave 13 lane C) machine battery — the time seam, the census
 * responder laws, and the D10 parameterization proof form:
 *   1. SEAM: a no-options run is byte-identical to an explicit-T0 run
 *      (ZERO behavior change at T0 — D12).
 *   2. CENSUS (base rows, permanent machine check): the 34 pre-F331C
 *      journeys are INVARIANT at every census offset (they carry no
 *      epoch tables; their T0-anchored expectations hold at every Δ).
 *   3. D9 SCHEDULE: the full corpus passes at every frozen epoch
 *      {T0, T0+30d, T0+90d} — the parameterized tables resolve.
 *   4. DISTINCTNESS (D10.2): for each parameterized journey the epoch
 *      outcomes differ on ≥1 ASSERTED reading, and a same-epoch re-run
 *      is byte-identical (D2(c)).
 *   5. CERTIFICATION BOUND: a run at a non-frozen anchor fails the
 *      parameterized journeys with the MISSING_EPOCH sentinel (never a
 *      soft pass — the journeys are certified only at the frozen
 *      epochs).
 */

import { describe, expect, it } from "vitest";
import { JOURNEYS } from "../src/journeys/index.js";
import { runJourney, runAllJourneys } from "../src/runner.js";
import { COMMERCE_T0 } from "../src/journey-world.js";
import { MISSING_EPOCH, canonicalJson, type JourneyOutcome } from "../src/journey-contracts.js";

const T0 = COMMERCE_T0;
const EPOCHS = [T0, T0 + 2_592_000_000, T0 + 7_776_000_000] as const;
const CENSUS_OFFSETS = [-3_600_000, 1_000, 3_600_000, 86_400_000, 2_592_000_000, 7_776_000_000, 31_536_000_000] as const;
const PARAMETERIZED = ["marketplace-transaction-flow", "tenant-billing-invoicing"] as const;
const BASE_34 = JOURNEYS.filter((j) => !PARAMETERIZED.includes(j.id as (typeof PARAMETERIZED)[number]));
function byId(id: string) {
  const journey = JOURNEYS.find((j) => j.id === id);
  if (journey === undefined) throw new Error(`unknown journey ${id}`);
  return journey;
}

/** The set of assertion ids whose ACTUAL values differ between two outcomes. */
function differingAssertions(a: JourneyOutcome, b: JourneyOutcome): string[] {
  const diffs: string[] = [];
  for (let i = 0; i < a.assertionOutcomes.length; i++) {
    const x = a.assertionOutcomes[i]!;
    const y = b.assertionOutcomes[i]!;
    if (canonicalJson(x.actual) !== canonicalJson(y.actual) || x.ok !== y.ok) diffs.push(x.assertionId);
  }
  return diffs;
}

describe("F331C — the time seam (D12)", () => {
  it("a no-options run is byte-identical to an explicit-T0 run (ZERO behavior change at T0)", async () => {
    const noOptions = await runAllJourneys(JOURNEYS);
    const explicitT0 = await runAllJourneys(JOURNEYS, { startedAt: T0 });
    expect(canonicalJson(noOptions)).toBe(canonicalJson(explicitT0));
    expect(noOptions.every((o) => o.passed)).toBe(true);
  });

  it("the default anchor is COMMERCE_T0 and reaches the drivers (state.time)", async () => {
    const { facts } = await runJourney(byId("marketplace-transaction-flow"));
    // ord-fresh is placed at "now" (= the run anchor): its total is the anchored fact chain.
    expect(facts.get("mtx.place.fresh.ok")).toBe(true);
    const { facts: shifted } = await runJourney(byId("marketplace-transaction-flow"), { startedAt: T0 + 86_400_000 });
    // At +1d the anchored legacy checkout flips (census row) — proof the anchor reaches the domain.
    expect(shifted.get("mtx.checkout.legacyOk.ok")).toBe(false);
    expect(facts.get("mtx.checkout.legacyOk.ok")).toBe(true);
  });
});

describe("F331C — census responder laws (machine checks of the recorded table)", () => {
  it("the table-less journeys are INVARIANT at every census offset (34 pre-F331C + 5 F351C = 39)", async () => {
    // F351C grow-only: the five Wave-15 lane-C journeys carry no epoch
    // tables (D13 single-epoch by construction), so the invariant set
    // grows with the corpus — every table-less journey stays invariant
    // at every census offset.
    expect(BASE_34.length).toBe(39);
    const baseline = await runAllJourneys(BASE_34, { startedAt: T0 });
    expect(baseline.every((o) => o.passed)).toBe(true);
    for (const delta of CENSUS_OFFSETS) {
      const atDelta = await runAllJourneys(BASE_34, { startedAt: T0 + delta });
      for (let i = 0; i < BASE_34.length; i++) {
        expect(atDelta[i]!.passed, `${BASE_34[i]!.id} @ ${delta}ms`).toBe(true);
      }
    }
  });

  it("the two F331C journeys respond exactly as the census table records (pre-parameterization semantics: T0-anchored expectations)", async () => {
    // The census measured the table-less state; the flip sets are
    // reproducible by evaluating the journeys' T0-anchored expectations
    // at the census anchors — done here against the SAME corpus by
    // asserting the domain facts directly (the assertions' T0 entries).
    const legacy = await runJourney(byId("marketplace-transaction-flow"), { startedAt: T0 + 3_600_000 });
    expect(legacy.facts.get("mtx.checkout.legacyOk.ok")).toBe(true); // +1h: within the T0+5h window — no flip
    const legacyBeyond = await runJourney(byId("marketplace-transaction-flow"), { startedAt: T0 + 86_400_000 });
    expect(legacyBeyond.facts.get("mtx.checkout.legacyOk.ok")).toBe(false); // +1d: deadline breach — flip
    expect(legacyBeyond.facts.get("mtx.checkout.legacyOk.reasonCode")).toBe("ORDER_WINDOW_EXPIRED");
    const past = await runJourney(byId("marketplace-transaction-flow"), { startedAt: T0 - 3_600_000 });
    expect(past.facts.get("mtx.checkout.lapsed.ok")).toBe(true); // −1h: the inclusive boundary turns the checkout back on — flip
    expect(past.facts.get("mtx.expire.lapsed.ok")).toBe(false); // −1h: the expiry refuses NOT_EXPIRED_YET — flip
    const at30d = await runJourney(byId("marketplace-transaction-flow"), { startedAt: T0 + 2_592_000_000 });
    expect(at30d.facts.get("mtx.checkout.slowOk.ok")).toBe(true); // +30d: the slow order is still within its T0+45d window — no flip from it
    const at90d = await runJourney(byId("marketplace-transaction-flow"), { startedAt: T0 + 7_776_000_000 });
    expect(at90d.facts.get("mtx.checkout.slowOk.ok")).toBe(false); // +90d: the second boundary breaches — flip (recorded set: +90d already flipping)
    expect(at90d.facts.get("mtx.checkout.slowOk.reasonCode")).toBe("ORDER_WINDOW_EXPIRED");
    const billing = await runJourney(byId("tenant-billing-invoicing"), { startedAt: T0 + 86_400_000 });
    expect(billing.facts.get("bil.invoice.open.ok")).toBe(true); // +1d: the window boundary opens issuance — flip
    expect(billing.facts.get("bil.invoice.open.totalMinor")).toBe(75_000);
    const billing30 = await runJourney(byId("tenant-billing-invoicing"), { startedAt: T0 + 2_592_000_000 });
    expect(billing30.facts.get("bil.invoice.late.ok")).toBe(false); // +30d: the late period is still open — no flip from it
    const billing90 = await runJourney(byId("tenant-billing-invoicing"), { startedAt: T0 + 7_776_000_000 });
    expect(billing90.facts.get("bil.invoice.late.ok")).toBe(true); // +90d: the second boundary opens issuance — flip
    expect(billing90.facts.get("bil.invoice.late.totalMinor")).toBe(75_000);
    const billingPast = await runJourney(byId("tenant-billing-invoicing"), { startedAt: T0 - 3_600_000 });
    expect(billingPast.facts.get("bil.invoice.open.ok")).toBe(false); // −1h: no past flip
  });
});

describe("F331C — the D9 frozen schedule (parameterized corpus)", () => {
  it("the full corpus passes at every frozen epoch {T0, T0+30d, T0+90d}", async () => {
    for (const epoch of EPOCHS) {
      const outcomes = await runAllJourneys(JOURNEYS, { startedAt: epoch });
      for (const outcome of outcomes) {
        expect(outcome.passed, `${outcome.journeyId} @ ${epoch}`).toBe(true);
      }
    }
  });

  it("DISTINCTNESS (D10.2): each parameterized journey's epochs differ on ≥1 ASSERTED reading", async () => {
    for (const id of PARAMETERIZED) {
      const journey = byId(id);
      const outcomes = await Promise.all(EPOCHS.map((epoch) => runJourney(journey, { startedAt: epoch })));
      for (let i = 0; i < EPOCHS.length; i++) {
        for (let j = i + 1; j < EPOCHS.length; j++) {
          const diffs = differingAssertions(outcomes[i]!.outcome, outcomes[j]!.outcome);
          expect(diffs.length > 0, `${id}: epochs ${EPOCHS[i]} vs ${EPOCHS[j]} agree on every asserted reading`).toBe(true);
        }
      }
      // The named differing assertions are exactly the table-bearing ones.
      const t0Vs30d = differingAssertions(outcomes[0]!.outcome, outcomes[1]!.outcome);
      const tableIds = journey.assertions.filter((a) => a.expectedByEpoch !== undefined).map((a) => a.id);
      for (const diff of t0Vs30d) expect(tableIds).toContain(diff);
    }
  });

  it("same-epoch re-runs are byte-identical (D2(c))", async () => {
    for (const id of PARAMETERIZED) {
      const journey = byId(id);
      for (const epoch of EPOCHS) {
        const a = await runJourney(journey, { startedAt: epoch });
        const b = await runJourney(journey, { startedAt: epoch });
        expect(b.outcome.digest).toBe(a.outcome.digest);
      }
    }
  });

  it("CERTIFICATION BOUND: a non-frozen anchor fails the parameterized journeys with MISSING_EPOCH (never a soft pass)", async () => {
    for (const id of PARAMETERIZED) {
      const { outcome } = await runJourney(byId(id), { startedAt: T0 + 3_600_000 }); // +1h — not a frozen epoch
      expect(outcome.passed).toBe(false);
      const sentinel = outcome.assertionOutcomes.find((a) => a.expected === MISSING_EPOCH);
      expect(sentinel, id).toBeDefined();
    }
    // The 34 base journeys have no tables — a non-frozen anchor never produces MISSING_EPOCH for them.
    const base = await runAllJourneys(BASE_34, { startedAt: T0 + 3_600_000 });
    for (const outcome of base) {
      expect(outcome.assertionOutcomes.some((a) => a.expected === MISSING_EPOCH)).toBe(false);
    }
  });
});

describe("F331C — the two new journeys' corpus laws", () => {
  it("both journeys carry well over the five-assertion law", () => {
    for (const id of PARAMETERIZED) {
      const journey = byId(id);
      expect(journey.assertions.length, id).toBeGreaterThanOrEqual(5);
    }
    expect(byId("marketplace-transaction-flow").assertions.length).toBe(43);
    expect(byId("tenant-billing-invoicing").assertions.length).toBe(28);
  });

  it("the refusal logs carry every refusal in order (marketplace-transaction-flow)", async () => {
    const { facts } = await runJourney(byId("marketplace-transaction-flow"));
    expect(facts.get("mtx.placeLog")).toEqual([
      "ord-x1:refused:EXCLUSIONS_NOT_ACKNOWLEDGED",
      "ord-x2:refused:TENANT_MISMATCH",
      "ord-x3:refused:LISTING_NOT_PUBLISHED",
      "ord-x4:refused:INVALID_QUANTITY",
      "ord-fresh:placed:50000",
      "ord-fresh:refused:DUPLICATE_ORDER_ID",
      "ord-legacy:placed:50000",
      "ord-lapsed:placed:25000",
      "ord-expiring:placed:12500",
      "ord-slow:placed:50000",
      "ord-big:placed:1000000",
      "ord-temp:placed:12500",
    ]);
    expect(facts.get("mtx.checkoutLog")).toEqual([
      "ord-fresh:checked-out:50000",
      "ord-fresh:refused:ORDER_NOT_PLACED",
      "ord-big:refused:CHECKOUT_LIMIT_EXCEEDED",
      "ord-temp:refused:ORDER_NOT_PLACED",
      "ord-legacy:checked-out:50000",
      "ord-slow:checked-out:50000",
      "ord-lapsed:refused:ORDER_WINDOW_EXPIRED",
    ]);
    expect(facts.get("mtx.expireLog")).toEqual([
      "ord-lapsed:expired",
      "ord-lapsed:refused:ILLEGAL_TRANSITION",
      "ord-expiring:refused:NOT_EXPIRED_YET",
    ]);
    expect(facts.get("mtx.cancelLog")).toEqual([
      "ord-temp:refused:CANCEL_REASON_REQUIRED",
      "ord-temp:cancelled",
    ]);
  });

  it("the invoice log carries every issuance and refusal in order (tenant-billing-invoicing)", async () => {
    const { facts } = await runJourney(byId("tenant-billing-invoicing"));
    expect(facts.get("bil.invoiceLog")).toEqual([
      "inv-1:issued:85000",
      "inv-2:refused:PERIOD_NOT_ENDED",
      "inv-9:refused:PERIOD_NOT_ENDED",
      "inv-1:refused:DUPLICATE_INVOICE_ID",
      "inv-3:refused:DUPLICATE_BILLING_PERIOD",
      "inv-4:refused:INVOICE_LIMIT_EXCEEDED",
      "inv-5:refused:SUBSCRIPTION_EXPIRED_BEYOND_GRACE",
      "inv-6:refused:USAGE_TENANT_MISMATCH",
      "inv-7:refused:EMPTY_INVOICE",
      "inv-8:refused:SUBSCRIPTION_NOT_ACTIVE",
    ]);
    expect(facts.get("bil.seedLog")).toEqual(["1:req-1|2:req-2|3:req-3|4:req-4|foreign:refused:TENANT_MISMATCH"]);
  });

  it("no live provider claim anywhere: the row-34/35 surfaces are local domain APIs only", () => {
    for (const id of PARAMETERIZED) {
      const journey = byId(id);
      expect(journey.steps.every((s) =>
        s.kind.startsWith("mtx-") || s.kind.startsWith("billing-") ||
        s.kind.startsWith("work-") || s.kind.startsWith("gw-"))).toBe(true);
    }
  });

  it("re-runs byte-identically (fresh world per run)", async () => {
    for (const id of PARAMETERIZED) {
      const first = await runJourney(byId(id));
      const second = await runJourney(byId(id));
      expect(second.outcome.digest).toBe(first.outcome.digest);
    }
  });
});
