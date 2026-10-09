/**
 * F290C — org optimization benchmark tests. The industry policy must
 * MEASURABLY beat the generic baseline on the industry's OWN objective,
 * with the delta in the result; re-runs are byte-identical (determinism).
 */
import { describe, expect, it } from "vitest";
import {
  runBenchmarkSuite,
  runIndustryBenchmark,
  genericCeilingsFor,
  GENERIC_GOALS,
  industryObjective,
  computeBenchmarkDigest,
  getArchetype,
  INDUSTRY_ARCHETYPES,
  INDUSTRIES,
  ORG_SIZE_TIERS,
} from "../src/index.js";

describe("F290C benchmark — suite shape + objective mapping", () => {
  it("runs 6 industries × 3 tiers = 18 scenarios", () => {
    const suite = runBenchmarkSuite();
    expect(suite.scenarioCount).toBe(18);
    expect(suite.scenarios).toHaveLength(18);
    expect(suite.kind).toBe("industry-benchmark-suite");
  });

  it("maps specialist-heavy → maximize-fit and cost-controlled → minimize-spend", () => {
    for (const tier of ORG_SIZE_TIERS) {
      expect(industryObjective(getArchetype("manufacturing", tier)!)).toBe("maximize-fit");
      expect(industryObjective(getArchetype("energy-utilities", tier)!)).toBe("maximize-fit");
      expect(industryObjective(getArchetype("field-services", tier)!)).toBe("maximize-fit");
      expect(industryObjective(getArchetype("logistics", tier)!)).toBe("minimize-spend");
      expect(industryObjective(getArchetype("facilities", tier)!)).toBe("minimize-spend");
      expect(industryObjective(getArchetype("construction", tier)!)).toBe("minimize-spend");
    }
  });

  it("the generic baseline is the package default goals + a neutral tier-scaled envelope", () => {
    expect(GENERIC_GOALS).toEqual({ costWeightBps: 3000, capabilityFitWeightBps: 6000, latencyWeightBps: 1000 });
    expect(genericCeilingsFor("small").maxRoleBudgetSpendMinor).toBe(50000);
    expect(genericCeilingsFor("medium").maxRoleBudgetSpendMinor).toBe(100000);
    expect(genericCeilingsFor("large").maxRoleBudgetSpendMinor).toBe(200000);
  });
});

describe("F290C benchmark — improvement-vs-generic (the honesty-critical assertion)", () => {
  // One assertion per industry: the industry policy measurably beats the
  // generic baseline on the industry's OWN objective, with the delta pinned.
  for (const industry of INDUSTRIES) {
    it(`${industry}: every tier beats the generic baseline on its objective (delta > 0)`, () => {
      for (const tier of ORG_SIZE_TIERS) {
        const result = runIndustryBenchmark(getArchetype(industry, tier)!);
        expect(result.improved, `${industry}/${tier}: delta=${result.improvementDelta}`).toBe(true);
        expect(result.improvementDelta).toBeGreaterThan(0);
        expect(result.industryObjectiveScore).toBeGreaterThan(result.genericObjectiveScore);
      }
    });
  }

  it("specialist-heavy industries improve on totalFit; cost-controlled on (negative) totalSpend", () => {
    const mfg = runIndustryBenchmark(getArchetype("manufacturing", "medium")!);
    expect(mfg.objective).toBe("maximize-fit");
    expect(mfg.industryLeg.totalFitBps).toBeGreaterThan(mfg.genericLeg.totalFitBps);
    const con = runIndustryBenchmark(getArchetype("construction", "medium")!);
    expect(con.objective).toBe("minimize-spend");
    expect(con.industryLeg.totalProjectedSpendMinor).toBeLessThan(con.genericLeg.totalProjectedSpendMinor);
  });

  it("the full suite reports all 18 scenarios improved", () => {
    expect(runBenchmarkSuite().improvedCount).toBe(18);
  });
});

describe("F290C benchmark — byte-identical determinism proof", () => {
  it("re-running the suite yields a byte-identical result + digest", () => {
    const a = runBenchmarkSuite();
    const b = runBenchmarkSuite();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.digest).toBe(b.digest);
    expect(a.digest).toMatch(/^bench_[0-9a-f]{8}$/);
  });

  it("computeBenchmarkDigest is stable across re-run and distinct across scenario-set mutation", () => {
    const full = runBenchmarkSuite();
    const half = runBenchmarkSuite(INDUSTRY_ARCHETYPES.slice(0, 9));
    expect(computeBenchmarkDigest(full.scenarios)).toBe(full.digest);
    expect(computeBenchmarkDigest(half.scenarios)).not.toBe(full.digest);
  });
});

describe("F290C benchmark — every seam is exercised (routing + rebalancing run)", () => {
  it("every scenario ran the routing + rebalancing legs (ok)", () => {
    for (const s of runBenchmarkSuite().scenarios) {
      expect(s.routingRan, `${s.industry}/${s.tier} routing`).toBe(true);
      expect(s.rebalanceRan, `${s.industry}/${s.tier} rebalance`).toBe(true);
    }
  });

  it("the improvement is driven by the allocation objective (routing/rebalancing are completeness legs — honest residual)", () => {
    // The benchmark's improvement assertion is on the allocation objective;
    // routing selection is urgency-driven (gateway semantics) and rebalancing
    // is scenario-dependent, so neither carries the improvement claim. Both
    // legs RUN and report ok; the improvement is the allocation delta.
    const s = runIndustryBenchmark(getArchetype("logistics", "small")!);
    expect(s.improved).toBe(true);
    expect(s.improvementDelta).toBe(s.industryObjectiveScore - s.genericObjectiveScore);
  });
});
