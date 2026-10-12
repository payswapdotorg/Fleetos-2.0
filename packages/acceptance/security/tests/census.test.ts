/**
 * F331B census tests — the D12 gate, machine-run. The declared table in
 * src/census.ts is ADJUDICATION; everything here is MEASUREMENT. If the
 * two disagree, these tests fail — the lane report cannot lie about the
 * census.
 *
 * Pinned machine facts (see src/census.ts module docs for the method):
 *   1. the declared table covers exactly the 27-journey corpus;
 *   2. responder flags, classes and responding Δ sets match measurement;
 *   3. the 19 declared-invariant journeys are byte-identical across the
 *      whole census grid (same digest at T0 and every Δ);
 *   4. the 6 declared echo-uniform journeys fail with the SAME assertion
 *      set at every anchor (uniform failure — no flip) while their
 *      digests move (readings move, pass/fail does not);
 *   5. NO journey flips at +30d or +90d — the D9-schedule window — so
 *      D10 parameterization is impossible for every journey (the D12
 *      gate's empty-set law);
 *   6. the two responders' exact machine-probed crossing boundaries
 *      (staleness window edge; realized-outcome window boundary);
 *   7. the parameterization set is EMPTY and every census entry is
 *      well-formed.
 */

import { describe, expect, it } from "vitest";
import {
  CENSUS_DELTAS_MS,
  CENSUS_T0,
  EPOCH_30D_MS,
  EPOCH_90D_MS,
  PARAMETERIZED_SECURITY_JOURNEYS,
  SECURITY_CENSUS,
  runSecurityCensus,
} from "../src/census.ts";
import { runJourney } from "../src/runner.ts";
import { SECURITY_JOURNEYS } from "../src/journeys/index.ts";
import { BASE_MS } from "../src/journeys/fixture-world.ts";
import type { AcceptanceJourney } from "../src/journey-contracts.ts";

const byId = new Map(SECURITY_JOURNEYS.map((j) => [j.journeyId, j]));
function journey(id: string): AcceptanceJourney {
  const found = byId.get(id);
  if (found === undefined) throw new Error(`journey ${id} not found`);
  return found;
}

const measured = runSecurityCensus();
const measuredById = new Map(measured.map((m) => [m.journeyId, m]));

describe("F331B — the security time census (D12, machine-measured)", () => {
  it("the declared table covers exactly the 27-journey corpus, no duplicates", () => {
    expect(SECURITY_CENSUS.length).toBe(SECURITY_JOURNEYS.length);
    expect(new Set(SECURITY_CENSUS.map((e) => e.journeyId)).size).toBe(SECURITY_CENSUS.length);
    for (const e of SECURITY_CENSUS) expect(byId.has(e.journeyId), `unknown journey ${e.journeyId}`).toBe(true);
    for (const j of SECURITY_JOURNEYS) expect(SECURITY_CENSUS.some((e) => e.journeyId === j.journeyId)).toBe(true);
  });

  it("the T0 baseline: 19/27 pass, 8 fail (echo pins in the adoption-anchored regime)", () => {
    const passing = measured.filter((m) => m.baselinePass);
    const failing = measured.filter((m) => !m.baselinePass);
    expect(passing.length).toBe(19);
    expect(failing.length).toBe(8);
    expect(failing.map((m) => m.journeyId).sort()).toEqual([
      "security.action-compensation-rollback",
      "security.benchmark-trust",
      "security.execution-ledger",
      "security.guardian-decision",
      "security.guardian-e2e",
      "security.jepa-family-honesty",
      "security.predictive-advice",
      "security.verified-execution-dispatch",
    ]);
  });

  it("exactly 2 responders, both transition-class, both at +365d only", () => {
    const responders = measured.filter((m) => m.responder);
    expect(responders.map((r) => r.journeyId).sort()).toEqual(["security.benchmark-trust", "security.predictive-advice"]);
    for (const r of responders) {
      const declared = SECURITY_CENSUS.find((e) => e.journeyId === r.journeyId);
      expect(declared?.responder).toBe(true);
      expect(declared?.censusClass).toBe("transition");
      expect(r.respondingDeltas).toEqual([31_536_000_000]);
      expect(r.baselinePass).toBe(false);
      expect(r.perDelta.find((d) => d.deltaMs === 31_536_000_000)?.pass).toBe(true);
    }
  });

  it("every declared non-responder matches the measurement (no flip at any Δ)", () => {
    for (const e of SECURITY_CENSUS) {
      if (e.responder) continue;
      const m = measuredById.get(e.journeyId);
      expect(m, `missing measurement for ${e.journeyId}`).toBeDefined();
      expect(m?.responder, `${e.journeyId} unexpectedly responds`).toBe(false);
      expect(m?.respondingDeltas).toEqual([]);
      expect(e.censusClass).toBeNull();
    }
  });

  it("the 19 declared-invariant journeys are byte-identical across the whole grid", () => {
    const invariant = SECURITY_CENSUS.filter((e) => !e.responder && e.citation.startsWith("F331B census: invariant"));
    expect(invariant.length).toBe(19);
    for (const e of invariant) {
      const m = measuredById.get(e.journeyId);
      expect(m?.byteIdenticalAcrossGrid, `${e.journeyId} is not byte-identical across the grid`).toBe(true);
    }
  });

  it("the 6 declared echo-uniform journeys fail with the SAME assertion set at every anchor, digests moving", () => {
    const echoUniform = [
      "security.guardian-decision",
      "security.execution-ledger",
      "security.guardian-e2e",
      "security.verified-execution-dispatch",
      "security.action-compensation-rollback",
      "security.jepa-family-honesty",
    ];
    expect(echoUniform.length).toBe(6);
    for (const id of echoUniform) {
      const anchors = [CENSUS_T0, ...CENSUS_DELTAS_MS.map((d) => CENSUS_T0 + d)];
      const outcomes = anchors.map((a) => runJourney(journey(id), { startedAt: a }).outcome);
      const failingSets = outcomes.map((o) => o.assertions.filter((a) => !a.pass).map((a) => a.assertionId).sort().join(","));
      expect(outcomes.every((o) => !o.pass), `${id} passes at some anchor`).toBe(true);
      expect(new Set(failingSets).size, `${id} failing set is not uniform across anchors`).toBe(1);
      expect(new Set(outcomes.map((o) => o.digest)).size, `${id} digest is not anchor-sensitive`).toBeGreaterThan(1);
    }
  });

  it("NO journey flips within the frozen D9 schedule window (the empty-parameterization law)", () => {
    for (const m of measured) {
      const at30d = m.perDelta.find((d) => d.deltaMs === EPOCH_30D_MS);
      const at90d = m.perDelta.find((d) => d.deltaMs === EPOCH_90D_MS);
      expect(at30d?.pass).toBe(m.baselinePass);
      expect(at90d?.pass).toBe(m.baselinePass);
    }
    const scheduleOutcomes = measured.map((m) => ({
      journeyId: m.journeyId,
      outcomes: [CENSUS_T0, CENSUS_T0 + EPOCH_30D_MS, CENSUS_T0 + EPOCH_90D_MS].map(
        (a) => runJourney(journey(m.journeyId), { startedAt: a }).outcome,
      ),
    }));
    // D2(d)/D10(2) positive check — the empty-parameterization law: on the
    // frozen schedule every journey EITHER fails at all three anchors
    // (D10(2) "every epoch passes" is impossible) OR is byte-identical
    // across them (no distinctness — D2(d) violated). Either way NO
    // security journey can carry a D10 per-epoch table on this schedule.
    for (const { journeyId, outcomes } of scheduleOutcomes) {
      const failsEverywhere = outcomes.every((o) => !o.pass);
      const byteIdentical = outcomes.every((o) => o.digest === outcomes[0]!.digest);
      expect(
        failsEverywhere || byteIdentical,
        `${journeyId} neither fails uniformly nor is byte-identical on the frozen schedule`,
      ).toBe(true);
    }
  });

  it("the two responders' exact crossing boundaries (machine-probed)", () => {
    // benchmark-trust: the realized-outcome window boundary is inclusive —
    // one ms below it refuses, at it scores.
    expect(runJourney(journey("security.benchmark-trust"), { startedAt: BASE_MS + 4_999 }).outcome.pass).toBe(false);
    expect(runJourney(journey("security.benchmark-trust"), { startedAt: BASE_MS + 5_000 }).outcome.pass).toBe(true);
    // predictive-advice: the staleness window edge — at the edge the class
    // is still stale, one ms past it the pinned unknown returns.
    expect(runJourney(journey("security.predictive-advice"), { startedAt: BASE_MS + 63_000 }).outcome.pass).toBe(false);
    expect(runJourney(journey("security.predictive-advice"), { startedAt: BASE_MS + 63_001 }).outcome.pass).toBe(true);
    // Both crossings sit between +90d and +365d (outside the frozen schedule).
    const crossingLow = BASE_MS + 4_999 - CENSUS_T0;
    const crossingHigh = BASE_MS + 63_001 - CENSUS_T0;
    expect(crossingLow).toBeGreaterThan(EPOCH_90D_MS);
    expect(crossingHigh).toBeLessThan(31_536_000_000);
  });

  it("the D12 gate: the parameterization set is EMPTY (census-justified)", () => {
    expect(PARAMETERIZED_SECURITY_JOURNEYS).toEqual([]);
    // A non-empty set would require a transition-class responder whose
    // flips fall INSIDE the frozen schedule — machine-disproven above.
    const scheduleFlippers = measured.filter((m) =>
      m.respondingDeltas.some((d) => d === EPOCH_30D_MS || d === EPOCH_90D_MS),
    );
    expect(scheduleFlippers).toEqual([]);
  });

  it("the census is deterministic: two full runs produce identical tables", () => {
    const second = runSecurityCensus();
    expect(JSON.stringify(measured)).toBe(JSON.stringify(second));
  });
});
