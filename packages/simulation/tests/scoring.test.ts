/**
 * F260B — scoring tests: hit-rate, calibration bucket edges, staleness classes,
 * fixed-weight aggregate, digests, tenant/now fail-closed, honest degraded
 * states for empty/partial case sets.
 */
import { describe, it, expect } from "vitest";
import type { WorldJournalEntry } from "@fleetos/world-model";
import { scoreBenchmarkCase, scoreBenchmarkSet } from "../src/scoring.ts";
import type { CaseScore } from "../src/scoring.ts";
import { replayJournal } from "../src/replay-harness.ts";
import {
  CONTEXT_FIELDS,
  ENVELOPE,
  INVOCATION,
  NOW_MS,
  OTHER_TENANT,
  TENANT,
  THRESHOLDS,
  buildJournal,
  shortCase,
  singleObservationCase,
  standardCase,
  standardJournal,
} from "./benchmark-fixtures.ts";

function replayOf(journal: readonly WorldJournalEntry[], entityId: string, tenant: { readonly tenantId: string } = TENANT) {
  const res = replayJournal({ tenant, entityId, journal, invocation: INVOCATION });
  if (!res.ok) throw new Error(`replay failed: ${res.rejected} ${res.detail}`);
  return res.run;
}

function scoreStandard() {
  return scoreBenchmarkCase({
    benchmarkCase: standardCase(), replay: replayOf(standardJournal(), "e1"),
    thresholds: THRESHOLDS, nowMs: NOW_MS,
  });
}

describe("scoreBenchmarkCase: hit-rate + calibration", () => {
  it("computes hit-rate, bands and deviations exactly (integer bps)", () => {
    const res = scoreStandard();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const s = res.score;
    expect(s.matchedPairs).toBe(4);
    expect(s.hitCount).toBe(2);
    expect(s.hitRateBps).toBe(5000);
    // deviations: 40.5/40=125, 51.5/50=300, 60/40=5000, 40/40=0
    expect(s.meanAbsDeviationBps).toBe(1356);
    expect(s.absDeviationSum).toBe(5425);
    expect(s.zeroBaselinePairs).toBe(0);
    const band = (i: number) => s.bands[i]?.count ?? -1;
    expect(band(5)).toBe(1); // 0 bps -> (-100,100]
    expect(band(6)).toBe(2); // 125, 300 -> (100,500]
    expect(band(9)).toBe(1); // 5000 -> (2000,5000]
    expect(s.bands.reduce((a, b) => a + b.count, 0)).toBe(4);
    expect(s.calibrationScoreBps).toBe(10000 - 1356);
  });

  it("hit boundaries are INCLUSIVE at both bounds edges", () => {
    const atLower = singleObservationCase([{ replaySeq: 2, step: 1, atMs: 2000, value: 9, observationRef: "r1" }], "edge-lower");
    const atUpper = singleObservationCase([{ replaySeq: 2, step: 1, atMs: 2000, value: 11, observationRef: "r2" }], "edge-upper");
    const justOut = singleObservationCase([{ replaySeq: 2, step: 1, atMs: 2000, value: 11.000001, observationRef: "r3" }], "edge-out");
    const journal = atLower.journal;
    for (const [c, hit] of [[atLower, true], [atUpper, true], [justOut, false]] as const) {
      const res = scoreBenchmarkCase({ benchmarkCase: c, replay: replayOf(journal, "e4"), thresholds: THRESHOLDS, nowMs: NOW_MS });
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.score.hitCount === 1).toBe(hit);
    }
  });

  it("calibration bucket edges: exact band placement at every boundary", () => {
    // predicted 40/50/60 at (seq,step); realized => deviation bps => band:
    // (4,1):40.4->100->(-100,100] (edge-inclusive upper)
    // (4,2):42 vs 50->-1600->(-2000,-1000]  (4,3):44 vs 60->-2667->(-5000,-2000]
    // (5,1):36 vs 40->-1000->(-2000,-1000]
    // (5,2):39.6 vs 50->-2080->(-5000,-2000]  (5,3):30 vs 60->-5000->(-inf,-5000]
    // (6,1):46 vs 40->1500->(1000,2000]  (6,2):70 vs 50->4000->(2000,5000]
    // (6,3):10 vs 60->-8333->(-inf,-5000]
    const vals: readonly number[] = [40.4, 42, 44, 36, 39.6, 30, 46, 70, 10];
    const placed = vals.map((value, i) => ({
      replaySeq: 4 + Math.floor(i / 3),
      step: (i % 3) + 1,
      atMs: 4000 + Math.floor(i / 3) * 37_000 + (i % 3) * 1000,
      value,
      observationRef: `r${i}`,
    }));
    const res = scoreBenchmarkCase({
      benchmarkCase: { ...standardCase(), caseId: "calibration-edges", expectedOutcomes: placed },
      replay: replayOf(standardJournal(), "e1"), thresholds: THRESHOLDS, nowMs: NOW_MS,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const s = res.score;
    expect(s.matchedPairs).toBe(9);
    const band = (i: number) => s.bands[i]?.count ?? -1;
    expect(band(0)).toBe(2); // -5000, -8333
    expect(band(1)).toBe(2); // -2667, -2080
    expect(band(2)).toBe(2); // -1600, -1000 (edge-inclusive upper)
    expect(band(5)).toBe(1); // 100 (edge-inclusive upper: (-100,100])
    expect(band(8)).toBe(1); // 1500
    expect(band(9)).toBe(1); // 4000
    expect(band(3)).toBe(0);
    expect(band(4)).toBe(0);
    expect(band(6)).toBe(0);
    expect(band(7)).toBe(0);
    expect(band(10)).toBe(0); // the open (+inf) band stays empty
    expect(s.bands.reduce((a, b) => a + b.count, 0)).toBe(9);
  });

  it("zero-baseline predictions: null deviation, fallback calibration, honest counts", () => {
    const journal = buildJournal(TENANT.tenantId, [
      { atMs: 1000, event: { kind: "entity-registered", entityId: "e5", entityType: "asset" } },
      { atMs: 1000, event: { kind: "observation-recorded", entityId: "e5", entityType: "asset", observationRef: "z1", observedAtMs: 1000, value: 0 } },
    ]);
    const c = {
      ...standardCase(),
      caseId: "zero-baseline",
      entityId: "e5",
      journal,
      expectedOutcomes: [{ replaySeq: 2, step: 1, atMs: 2000, value: 5, observationRef: "zr" }],
    };
    const res = scoreBenchmarkCase({ benchmarkCase: c, replay: replayOf(journal, "e5"), thresholds: THRESHOLDS, nowMs: NOW_MS });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const s = res.score;
    expect(s.zeroBaselinePairs).toBe(1);
    expect(s.deviationCount).toBe(0);
    expect(s.meanAbsDeviationBps).toBeNull();
    expect(s.calibrationFallback).toBe(true);
    expect(s.calibrationScoreBps).toBe(s.hitRateBps);
    expect(s.hitRateBps).toBe(0);
    expect(s.aggregateBps).toBe(0);
  });
});

describe("scoreBenchmarkCase: staleness-sensitivity", () => {
  it("classifies pairs per staleness class and measures fresh→stale degradation", () => {
    const res = scoreStandard();
    if (!res.ok) return;
    const byClass = new Map(res.score.stalenessClasses.map((c) => [c.staleness, c]));
    expect(byClass.get("fresh")).toMatchObject({ pairCount: 2, hitCount: 1, hitRateBps: 5000 });
    expect(byClass.get("stale")).toMatchObject({ pairCount: 1, hitCount: 0, hitRateBps: 0 });
    expect(byClass.get("unknown")).toMatchObject({ pairCount: 1, hitCount: 1, hitRateBps: 10000 });
    expect(res.score.degradationBps).toBe(5000);
    expect(res.score.stalenessFallback).toBe(false);
    expect(res.score.stalenessScoreBps).toBe(5000);
  });

  it("honest nulls when a class has no pairs; fallback when nothing is fresh", () => {
    const c = shortCase(); // single fresh pair, no stale/unknown
    const res = scoreBenchmarkCase({ benchmarkCase: c, replay: replayOf(c.journal, "e2"), thresholds: THRESHOLDS, nowMs: NOW_MS });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const byClass = new Map(res.score.stalenessClasses.map((x) => [x.staleness, x]));
    expect(byClass.get("stale")).toMatchObject({ pairCount: 0, hitRateBps: null });
    expect(byClass.get("unknown")).toMatchObject({ pairCount: 0, hitRateBps: null });
    expect(res.score.degradationBps).toBeNull();
    // stale-only journal: one observation at 1000, scored at asOf 40000 -> stale
    const journal = buildJournal(TENANT.tenantId, [
      { atMs: 1000, event: { kind: "entity-registered", entityId: "e6", entityType: "asset" } },
      { atMs: 1000, event: { kind: "observation-recorded", entityId: "e6", entityType: "asset", observationRef: "s1", observedAtMs: 1000, value: 10 } },
      { atMs: 40_000, event: { kind: "entity-tagged", entityId: "e6", entityType: "asset", tags: ["x"] } },
    ]);
    const staleCase = { ...standardCase(), caseId: "stale-only", entityId: "e6", journal, expectedOutcomes: [{ replaySeq: 3, step: 1, atMs: 41_000, value: 10, observationRef: "sr" }] };
    const res2 = scoreBenchmarkCase({ benchmarkCase: staleCase, replay: replayOf(journal, "e6"), thresholds: THRESHOLDS, nowMs: NOW_MS });
    expect(res2.ok).toBe(true);
    if (!res2.ok) return;
    expect(res2.score.freshHitRateBps).toBeNull();
    expect(res2.score.stalenessFallback).toBe(true);
    expect(res2.score.stalenessScoreBps).toBe(res2.score.hitRateBps);
  });
});

describe("scoreBenchmarkCase: fixed-weight aggregate + fail-closed", () => {
  it("aggregate = documented fixed weighting (5000/3000/2000 of 10000)", () => {
    const res = scoreStandard();
    if (!res.ok) return;
    const s = res.score;
    expect(s.aggregateBps).toBe(Math.round((s.hitRateBps * 5000 + s.calibrationScoreBps * 3000 + s.stalenessScoreBps * 2000) / 10000));
    expect(s.aggregateBps).toBe(6093);
    expect(s.scoreDigest).toMatch(/^[0-9a-f]{8}$/);
  });

  it("is tenant fail-closed (case/replay tenant mismatch)", () => {
    const foreignJournal = buildJournal(OTHER_TENANT.tenantId, [
      { atMs: 1000, event: { kind: "entity-registered", entityId: "e1", entityType: "asset" } },
      { atMs: 1000, event: { kind: "observation-recorded", entityId: "e1", entityType: "asset", observationRef: "o", observedAtMs: 1000, value: 10 } },
    ]);
    const res = scoreBenchmarkCase({
      benchmarkCase: standardCase(),
      replay: replayOf(foreignJournal, "e1", OTHER_TENANT),
      thresholds: THRESHOLDS, nowMs: NOW_MS,
    });
    expect(res).toMatchObject({ ok: false, degraded: "tenant-mismatch" });
  });

  it("fails closed on now mismatch and thresholds", () => {
    const c = standardCase();
    const replay = replayOf(c.journal, "e1");
    expect(scoreBenchmarkCase({ benchmarkCase: c, replay, thresholds: THRESHOLDS, nowMs: 700_000 }))
      .toMatchObject({ ok: false, degraded: "now-before-realized" });
    expect(scoreBenchmarkCase({ benchmarkCase: c, replay, thresholds: THRESHOLDS, nowMs: 701_000.5 }))
      .toMatchObject({ ok: false, degraded: "invalid-now" });
    expect(scoreBenchmarkCase({ benchmarkCase: c, replay, thresholds: { freshWithinMs: 60_000, staleWithinMs: 10_000 }, nowMs: NOW_MS }))
      .toMatchObject({ ok: false, degraded: "invalid-thresholds" });
    expect(scoreBenchmarkCase({ benchmarkCase: c, replay: replayOf(shortCase().journal, "e2"), thresholds: THRESHOLDS, nowMs: NOW_MS }))
      .toMatchObject({ ok: false, degraded: "replay-mismatch" });
  });

  it("honest insufficient-evidence when NO outcome matches (named reasons)", () => {
    const c = {
      ...standardCase(),
      caseId: "no-pairs",
      expectedOutcomes: [
        { replaySeq: 1, step: 1, atMs: 2000, value: 1, observationRef: "r1" },
        { replaySeq: 1, step: 2, atMs: 3000, value: 2, observationRef: "r2" },
      ],
    };
    const res = scoreBenchmarkCase({ benchmarkCase: c, replay: replayOf(c.journal, "e1"), thresholds: THRESHOLDS, nowMs: NOW_MS });
    expect(res).toMatchObject({ ok: false, degraded: "insufficient-evidence" });
    if (!res.ok) expect(res.detail).toContain("empty-history");
  });

  it("mixed case: matched pairs + unscoreable outcomes recorded (never silent)", () => {
    const c = {
      ...standardCase(),
      caseId: "mixed",
      expectedOutcomes: [
        ...standardCase().expectedOutcomes,
        { replaySeq: 1, step: 1, atMs: 2000, value: 99, observationRef: "r9" },
      ],
    };
    const res = scoreBenchmarkCase({ benchmarkCase: c, replay: replayOf(c.journal, "e1"), thresholds: THRESHOLDS, nowMs: NOW_MS });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.score.matchedPairs).toBe(4);
    expect(res.score.unscoreableOutcomes).toEqual([{ replaySeq: 1, step: 1, reason: "replay step rejected: empty-history" }]);
  });
});

describe("scoreBenchmarkSet", () => {
  it("aggregates exact totals across cases (order-independent, byte-identical)", () => {
    const members = [
      { benchmarkCase: standardCase(), replay: replayOf(standardJournal(), "e1") },
      { benchmarkCase: shortCase(), replay: replayOf(shortCase().journal, "e2") },
    ];
    const res = scoreBenchmarkSet({ tenant: TENANT, nowMs: NOW_MS, thresholds: THRESHOLDS, members });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const scoring = res.scoring;
    expect(scoring.experimental).toBe(true);
    expect(scoring.kind).toBe("BENCHMARK_SCORING");
    expect(scoring.perCase.map((s) => s.caseId)).toEqual(["case-short", "case-standard"]);
    expect(scoring.aggregate.totalPairs).toBe(5);
    expect(scoring.aggregate.hitCount).toBe(3);
    expect(scoring.aggregate.hitRateBps).toBe(6000);
    expect(scoring.aggregate.meanAbsDeviationBps).toBe(1135);
    const byClass = new Map(scoring.aggregate.stalenessClasses.map((c) => [c.staleness, c]));
    expect(byClass.get("fresh")).toMatchObject({ pairCount: 3, hitCount: 2, hitRateBps: 6667 });
    expect(scoring.aggregate.degradationBps).toBe(6667);
    expect(scoring.scoringDigest).toMatch(/^[0-9a-f]{8}$/);
    const reversed = scoreBenchmarkSet({ tenant: TENANT, nowMs: NOW_MS, thresholds: THRESHOLDS, members: [...members].reverse() });
    expect(JSON.stringify(reversed.ok ? reversed.scoring : null)).toBe(JSON.stringify(scoring));
  });

  it("honest degraded states: empty set, partial set (with named unscored + partial aggregate)", () => {
    expect(scoreBenchmarkSet({ tenant: TENANT, nowMs: NOW_MS, thresholds: THRESHOLDS, members: [] }))
      .toMatchObject({ ok: false, degraded: "insufficient-evidence" });
    expect(scoreBenchmarkSet({ tenant: { tenantId: "" }, nowMs: NOW_MS, thresholds: THRESHOLDS, members: [] }))
      .toMatchObject({ ok: false, degraded: "insufficient-evidence" });
    expect(scoreBenchmarkSet({ tenant: TENANT, nowMs: NOW_MS + 0.5, thresholds: THRESHOLDS, members: [{ benchmarkCase: standardCase(), replay: replayOf(standardJournal(), "e1") }] }))
      .toMatchObject({ ok: false, degraded: "invalid-now" });
    const noPairs = {
      ...standardCase(),
      caseId: "no-pairs",
      expectedOutcomes: [{ replaySeq: 1, step: 1, atMs: 2000, value: 1, observationRef: "r" }],
    };
    const partial = scoreBenchmarkSet({
      tenant: TENANT, nowMs: NOW_MS, thresholds: THRESHOLDS,
      members: [
        { benchmarkCase: standardCase(), replay: replayOf(standardJournal(), "e1") },
        { benchmarkCase: noPairs, replay: replayOf(noPairs.journal, "e1") },
      ],
    });
    expect(partial).toMatchObject({ ok: false, degraded: "partial-case-set" });
    if (!partial.ok) {
      expect(partial.unscored.map((u) => u.caseId)).toEqual(["no-pairs"]);
      expect(partial.unscored[0]?.degraded).toBe("insufficient-evidence");
      expect(partial.partialAggregate?.totalPairs).toBe(4);
    }
    const tenantFail = scoreBenchmarkSet({
      tenant: TENANT, nowMs: NOW_MS, thresholds: THRESHOLDS,
      members: [{ benchmarkCase: { ...standardCase(), tenant: OTHER_TENANT }, replay: replayOf(standardJournal(), "e1") }],
    });
    expect(tenantFail).toMatchObject({ ok: false, degraded: "tenant-mismatch" });
  });

  it("CaseScore carries the honest unscoreable-outcome trail (type-level check)", () => {
    const res = scoreStandard();
    if (!res.ok) return;
    const s: CaseScore = res.score;
    expect(s.unscoreableOutcomes.every((u) => typeof u.reason === "string")).toBe(true);
    expect(CONTEXT_FIELDS.operatorName).toBe("Ada");
    expect(ENVELOPE.maxCounterfactualDeltaBps).toBe(500);
  });
});
