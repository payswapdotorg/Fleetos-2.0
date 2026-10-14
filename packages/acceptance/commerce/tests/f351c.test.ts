/**
 * F351C (Wave 15 lane C) machine battery — the five commerce-discipline
 * journeys delivered by the masked-industry coverage tranche-2 lane:
 *   1. CENSUS BOUND: the five journeys drive ONLY their own F351C step
 *      kinds (the census-certified public APIs — no other surface).
 *   2. REFUSAL LAW: each journey carries >= 1 asserted refusal (D14).
 *   3. DETERMINISM: same-journey re-runs are byte-identical (D14); the
 *      full five-journey set re-runs byte-identically.
 *   4. D13 INVARIANCE: the five journeys carry NO epoch tables and are
 *      invariant across the census offsets (they are single-epoch T0
 *      journeys — nothing outside the D8/D12-certified responder set
 *      may ever earn counted epochs; machine-checked at every offset).
 *   5. DEEP FACTS: the refusal logs, ranked orders, recorded tie-break
 *      rules, and KPI arithmetic are pinned verbatim.
 */

import { describe, expect, it } from "vitest";
import { JOURNEYS } from "../src/journeys/index.js";
import { runJourney, runAllJourneys } from "../src/runner.js";
import { COMMERCE_T0 } from "../src/journey-world.js";
import { canonicalJson } from "../src/journey-contracts.js";

const F351C_IDS = [
  "procurement-quote-to-order-authorization",
  "vendor-matching-discipline",
  "quote-comparison-discipline",
  "vendor-fulfillment-kpi-rollup",
  "procurement-idempotent-creation",
] as const;

const F351C_STEP_KINDS = new Set([
  "pdir-quote-seed", "pdir-quote-transition", "pdir-order-create", "pdir-order-read", "pdir-quote-read",
  "pdir-match-vendors", "qcmp-compare",
  "vkpi-outcome-seed", "vkpi-rollup", "vkpi-catalog-summary",
  "pidem-create", "pidem-digest",
]);

const CENSUS_OFFSETS = [-3_600_000, 1_000, 3_600_000, 86_400_000, 2_592_000_000, 7_776_000_000, 31_536_000_000] as const;

function byId(id: string) {
  const journey = JOURNEYS.find((j) => j.id === id);
  if (journey === undefined) throw new Error(`unknown journey ${id}`);
  return journey;
}

const f351cJourneys = () => F351C_IDS.map((id) => byId(id));

describe("F351C — census bound + corpus laws", () => {
  it("the five journeys exist with unique ids in the corpus (36 -> 41; 45 after F361C, 46 after F362)", () => {
    expect(JOURNEYS.length).toBe(46);
    const ids = JOURNEYS.map((j) => j.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of F351C_IDS) expect(ids).toContain(id);
  });

  it("the five journeys drive ONLY their census-certified F351C step kinds", () => {
    for (const journey of f351cJourneys()) {
      for (const step of journey.steps) {
        expect(F351C_STEP_KINDS.has(step.kind), `${journey.id}:${step.kind}`).toBe(true);
      }
    }
  });

  it("every journey carries >= 5 assertions and >= 1 asserted refusal (D14)", () => {
    for (const journey of f351cJourneys()) {
      expect(journey.assertions.length, journey.id).toBeGreaterThanOrEqual(5);
      const refusals = journey.assertions.filter((a) =>
        a.description.startsWith("REFUSAL") || a.description.includes("fail-closed") || a.description.includes("refuses"));
      expect(refusals.length, journey.id).toBeGreaterThanOrEqual(1);
    }
    expect(byId("procurement-quote-to-order-authorization").assertions.length).toBe(24);
    expect(byId("vendor-matching-discipline").assertions.length).toBe(19);
    expect(byId("quote-comparison-discipline").assertions.length).toBe(19);
    expect(byId("vendor-fulfillment-kpi-rollup").assertions.length).toBe(14);
    expect(byId("procurement-idempotent-creation").assertions.length).toBe(20);
  });

  it("the five journeys carry NO epoch tables (D13 — single-epoch T0 by construction)", () => {
    for (const journey of f351cJourneys()) {
      const tables = journey.assertions.filter((a) => a.expectedByEpoch !== undefined);
      expect(tables.length, journey.id).toBe(0);
    }
  });

  it("all five journeys pass end to end", async () => {
    for (const journey of f351cJourneys()) {
      const { outcome } = await runJourney(journey);
      expect(outcome.passed, journey.id).toBe(true);
      expect(outcome.stepOutcomes.every((s) => s.executed && s.ok), journey.id).toBe(true);
      expect(outcome.assertionOutcomes.every((a) => a.ok), journey.id).toBe(true);
    }
  });

  it("same-journey re-runs are byte-identical (D14 determinism)", async () => {
    for (const journey of f351cJourneys()) {
      const first = await runJourney(journey);
      const second = await runJourney(journey);
      expect(second.outcome.digest).toBe(first.outcome.digest);
      expect(canonicalJson(second.facts)).toBe(canonicalJson(first.facts));
    }
  });

  it("the full five-journey set re-runs byte-identically", async () => {
    const journeys = f351cJourneys();
    const first = await runAllJourneys(journeys);
    const second = await runAllJourneys(journeys);
    expect(canonicalJson(second)).toBe(canonicalJson(first));
    expect(first.every((o) => o.passed)).toBe(true);
  });

  it("D13 INVARIANCE: the five journeys are invariant at every census offset (no epoch ever counts)", async () => {
    for (const delta of CENSUS_OFFSETS) {
      const outcomes = await runAllJourneys(f351cJourneys(), { startedAt: COMMERCE_T0 + delta });
      for (const outcome of outcomes) {
        expect(outcome.passed, `${outcome.journeyId} @ ${delta}ms`).toBe(true);
        expect(outcome.assertionOutcomes.some((a) => a.expected === "__missing-epoch__"), outcome.journeyId).toBe(false);
      }
    }
  });
});

describe("F351C — deep facts (pinned verbatim)", () => {
  it("procurement-quote-to-order-authorization: the refusal + creation logs in order", async () => {
    const { facts } = await runJourney(byId("procurement-quote-to-order-authorization"));
    expect(facts.get("pdir.orderLog")).toEqual([
      "ord-1:refused:AUTHORIZATION_DENIED",
      "ord-1:refused:ILLEGAL_TRANSITION",
      "ord-1:draft:gd-allow-1",
    ]);
    expect(facts.get("pdir.quoteLog")).toEqual([
      "q-alpha:submitted",
      "q-beta:submitted",
      "q-alpha:accepted",
      "q-alpha:refused:ILLEGAL_TRANSITION",
    ]);
    expect(facts.get("pdir.readLog")).toEqual([
      "own:ord-1:draft",
      "foreign:ord-1:null",
      "own:q-alpha:accepted",
      "foreign:q-alpha:null",
    ]);
  });

  it("vendor-matching-discipline: the deterministic match log with the recorded tie-breaks", async () => {
    const { facts } = await runJourney(byId("vendor-matching-discipline"));
    expect(facts.get("pdir.matchLog")).toEqual([
      "demand-match-1:ven-full@0.870990,ven-part@0.570990",
      "demand-match-2:ven-tie-a@0.541961,ven-tie-b@0.541961",
      "demand-match-3:refused:TENANT_MISMATCH",
      "demand-match-4:-",
    ]);
    expect(facts.get("pdir.match.main.tieBreakRules")).toEqual(["ven-full:none", "ven-part:higher_coverage"]);
    expect(facts.get("pdir.match.ties.tieBreakRules")).toEqual(["ven-tie-a:none", "ven-tie-b:lexicographic_vendor_id"]);
  });

  it("quote-comparison-discipline: all four tie-break rules are exercised and recorded", async () => {
    const { facts } = await runJourney(byId("quote-comparison-discipline"));
    expect(facts.get("qcmp.main.tieBreakRules")).toEqual(["q-bravo:none", "q-alpha:lower-total-cost", "q-cheap:none"]);
    expect(facts.get("qcmp.tieLead.tieBreakRules")).toEqual(["q-quil:none", "q-papa:shorter-lead-time"]);
    expect(facts.get("qcmp.tieSubmit.tieBreakRules")).toEqual(["q-first:none", "q-second:earlier-submission"]);
    expect(facts.get("qcmp.tieLexical.tieBreakRules")).toEqual(["q-lex-a:none", "q-lex-b:vendor-id-lexical"]);
    expect(facts.get("qcmp.main.totals")).toEqual(["q-bravo:7500", "q-alpha:7500", "q-cheap:7100"]);
    expect(facts.get("qcmp.log")).toEqual([
      "main:1:q-bravo:7500|2:q-alpha:7500|3:q-cheap:7100",
      "tieLead:1:q-quil:7500|2:q-papa:7500",
      "tieSubmit:1:q-first:10000|2:q-second:10000",
      "tieLexical:1:q-lex-a:10000|2:q-lex-b:10000",
      "refEmpty:refused:NO_QUOTES",
      "refWeights:refused:WEIGHTS_MUST_SUM_TO_10000",
      "refUnitCost:refused:INVALID_UNIT_COST",
      "refLeadTime:refused:INVALID_LEAD_TIME",
      "refForeign:refused:TENANT_MISMATCH",
    ]);
  });

  it("vendor-fulfillment-kpi-rollup: the bps arithmetic is exact and the refusals honest", async () => {
    const { facts } = await runJourney(byId("vendor-fulfillment-kpi-rollup"));
    expect(facts.get("vkpi.rollup.main.onTimeRatioBps")).toBe(6666);
    expect(facts.get("vkpi.rollup.main.fillRateBps")).toBe(9200);
    expect(facts.get("vkpi.rollupLog")).toEqual([
      "ven-haul:6666:9200",
      "ven-unknown:refused:EMPTY_PERFORMANCE_HISTORY",
      "ven-haul:refused:NEGATIVE_QUANTITY",
    ]);
    expect(facts.get("vkpi.catalogLog")).toEqual(["ven-haul:2d:1v"]);
  });

  it("procurement-idempotent-creation: the registry log in order (create, duplicate, conflict, refusals)", async () => {
    const { facts } = await runJourney(byId("procurement-idempotent-creation"));
    expect(facts.get("pidem.log")).toEqual([
      "req-101:created:doc-1",
      "req-101:duplicate:doc-1",
      "req-101:refused:IDEMPOTENCY_KEY_CONFLICT",
      "req-102:created:doc-2",
      "-:refused:REQUEST_ID_REQUIRED",
      "req-103:refused:REQUEST_DIGEST_REQUIRED",
      "req-103:refused:DOCUMENT_ID_REQUIRED",
    ]);
    expect(facts.get("pidem.create.replay.documentId")).toBe("doc-1");
    expect(facts.get("pidem.create.replay.recordCount")).toBe(1);
    expect(facts.get("pidem.digest.law.first")).toMatch(/^req_[0-9a-f]{8}$/);
  });
});
