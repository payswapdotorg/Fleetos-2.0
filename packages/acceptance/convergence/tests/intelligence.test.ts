/**
 * @fleetos/acceptance-convergence — deterministic intelligence rollup tests.
 *
 * Every rollup field is verified against the REAL output it names: lineage
 * coverage counts come from the REAL `ancestry` traversals (spot-proved by
 * direct calls), the optimization posture carries the REAL benchmark
 * record's delta verbatim, the forecast utilization entries carry the REAL
 * intervals by reference, and the capability matching surfaces the REAL
 * gateway refusal (unmatched = honest refusals, never invented matches).
 * Tenant fail-closed, digest tamper, determinism machine-tested.
 */

import { describe, expect, it } from "vitest";
import { industryObjective, runIndustryBenchmark } from "@fleetos/agent-organizations";
import { ancestry } from "@fleetos/assets";
import { matchIndustryCapabilities } from "@fleetos/model-gateway";
import { jepaHalfWidthAt, makeJepaSpace, JEPA_FAMILY_REGISTRY } from "@fleetos/world-model";
import {
  buildScenarioIntelligence,
  verifyIntelligenceDigest,
  type IntelligenceShortfall,
} from "../src/intelligence.js";
import { DEFAULT_INDUSTRY_MODEL_REGISTRY } from "../src/scenario-data.js";
import { ALL_INDUSTRIES, freshScenario, intelligenceFor, scenarioFor } from "./fixtures.js";

describe("intelligence — lineage coverage (REAL graph queries, counts cited)", () => {
  it("coverage numbers come from the REAL ancestry traversals (spot-proof)", () => {
    for (const industry of ALL_INDUSTRIES) {
      const scenario = scenarioFor(industry);
      const rollup = intelligenceFor(industry).lineageCoverage;
      expect(rollup.fleetSize).toBe(scenario.fleet.length);
      // Re-run the REAL query per asset and compare depth + edge counts.
      for (const [index, asset] of scenario.fleet.entries()) {
        const result = ancestry(scenario.graph, { tenantId: scenario.tenantId, kind: "asset", id: asset.id });
        const entry = rollup.perAsset[index];
        if (entry === undefined) throw new Error("per-asset entry missing");
        expect(entry.assetId).toBe(asset.id);
        expect(entry.depth).toBe(result.depth);
        expect(entry.edgeCount).toBe(result.edges.length);
        expect(entry.ok).toBe(result.ok);
        expect(entry.source).toContain("ancestry");
      }
    }
  });

  it("the manufacturing fleet: 2 of 3 assets carry ancestry (the replaced + the inspected)", () => {
    const rollup = intelligenceFor("manufacturing").lineageCoverage;
    expect(rollup.fleetSize).toBe(3);
    expect(rollup.assetsWithAncestry).toBe(2);
    expect(rollup.coverageBps).toBe(6666);
    expect(rollup.perAsset.map((a) => a.edgeCount)).toEqual([0, 1, 2]);
    expect(rollup.perAsset.map((a) => a.depth)).toEqual([0, 1, 1]);
  });

  it("coverage source names the REAL query record", () => {
    expect(intelligenceFor("logistics").lineageCoverage.source).toBe("@fleetos/assets lineage.ancestry(graph, {tenantId, kind:'asset', id})");
  });
});

describe("intelligence — optimization posture (REAL benchmark delta verbatim)", () => {
  it("the benchmark record is the REAL runIndustryBenchmark output (deep-equal)", () => {
    for (const industry of ALL_INDUSTRIES) {
      const posture = intelligenceFor(industry).optimizationPosture;
      expect(posture.benchmark).toEqual(runIndustryBenchmark(scenarioFor(industry).archetype));
      expect(posture.objective).toBe(industryObjective(scenarioFor(industry).archetype));
      expect(posture.industryScore).toBe(posture.benchmark.industryObjectiveScore);
      expect(posture.genericScore).toBe(posture.benchmark.genericObjectiveScore);
      expect(posture.improvementDelta).toBe(posture.benchmark.improvementDelta);
    }
  });

  it("all six industries IMPROVE over the generic baseline (delta > 0, REAL law)", () => {
    for (const industry of ALL_INDUSTRIES) {
      const posture = intelligenceFor(industry).optimizationPosture;
      expect(posture.improved).toBe(true);
      expect(posture.improvementDelta).toBeGreaterThan(0);
    }
  });

  it("objective follows the envelope kind (specialist-heavy vs cost-controlled)", () => {
    expect(intelligenceFor("manufacturing").optimizationPosture.objective).toBe("maximize-fit");
    expect(intelligenceFor("energy-utilities").optimizationPosture.objective).toBe("maximize-fit");
    expect(intelligenceFor("facilities").optimizationPosture.objective).toBe("minimize-spend");
    expect(intelligenceFor("construction").optimizationPosture.objective).toBe("minimize-spend");
  });

  it("posture source names the REAL benchmark record", () => {
    expect(intelligenceFor("facilities").optimizationPosture.source).toBe("@fleetos/agent-organizations industries.runIndustryBenchmark(archetype)");
  });
});

describe("intelligence — forecast utilization (REAL intervals carried as-is)", () => {
  it("entries reference the REAL prediction objects (identity) with values verbatim", () => {
    for (const industry of ALL_INDUSTRIES) {
      const utilization = intelligenceFor(industry).forecastUtilization;
      expect(utilization.count).toBe(6);
      expect(utilization.perForecast).toHaveLength(6);
      for (const [index, forecast] of scenarioFor(industry).forecasts.entries()) {
        const entry = utilization.perForecast[index];
        if (entry === undefined) throw new Error("entry missing");
        expect(entry.interval).toBe(forecast.predicted.uncertainty);
        expect(entry.value).toBe(forecast.predicted.value);
        expect(entry.width).toBeCloseTo(forecast.predicted.uncertainty.upper - forecast.predicted.uncertainty.lower, 9);
        expect(entry.adapterId).toBe(forecast.adapterId);
        expect(entry.horizon).toBe(forecast.horizon);
      }
    }
  });

  it("core + rollout widths satisfy the composed widening law at each horizon", () => {
    const utilization = intelligenceFor("manufacturing").forecastUtilization;
    for (const entry of utilization.perForecast) {
      if (entry.adapterId === "jepa.masked") continue;
      expect(entry.width).toBeCloseTo(2 * jepaHalfWidthAt(entry.horizon), 5);
    }
    expect(entry_h(utilization, 0).horizon).toBe(4);
    expect(entry_h(utilization, 0).width).toBeCloseTo(3, 5);
  });

  it("the masked adapter is LESS certain (A11-widened interval, never narrower)", () => {
    const utilization = intelligenceFor("manufacturing").forecastUtilization;
    const masked = utilization.perForecast.filter((e) => e.adapterId === "jepa.masked");
    expect(masked).toHaveLength(2);
    for (const entry of masked) {
      expect(entry.width).toBeCloseTo(4, 5);
      expect(entry.width).toBeGreaterThanOrEqual(2 * jepaHalfWidthAt(1));
    }
  });

  it("the method label is the honest composed-law name on every interval", () => {
    for (const entry of intelligenceFor("logistics").forecastUtilization.perForecast) {
      expect(entry.interval.method).toBe("jepa.latent-sqrt");
    }
  });

  it("forecasts reproduce the REAL family adapters exactly (independent re-drive)", () => {
    const scenario = scenarioFor("energy-utilities");
    const utilization = intelligenceFor("energy-utilities").forecastUtilization;
    const space = makeJepaSpace();
    const entry = utilization.perForecast[0];
    if (entry === undefined) throw new Error("entry missing");
    const window = scenario.journeyApplicability; // referenced REAL data unaffected
    expect(window).toBeDefined();
    const adapter = JEPA_FAMILY_REGISTRY[0];
    if (adapter === undefined) throw new Error("adapter missing");
    const forecast = scenario.forecasts[0];
    if (forecast === undefined) throw new Error("forecast missing");
    const fresh = adapter.make(space, scenario.forecastComputedAt).predict(forecast.representation);
    expect(fresh.value).toBeCloseTo(entry.value, 9);
    expect(fresh.uncertainty.lower).toBeCloseTo(entry.interval.lower, 9);
    expect(fresh.uncertainty.upper).toBeCloseTo(entry.interval.upper, 9);
  });
});

describe("intelligence — capability matching (REAL gateway matches; honest refusals)", () => {
  it("five industries: every industry skill matches a REAL registry model", () => {
    for (const industry of ["manufacturing", "logistics", "facilities", "field-services", "construction"] as const) {
      const rollup = intelligenceFor(industry).capabilityMatching;
      expect(rollup.refusalReasonCode).toBeNull();
      expect(rollup.unmatched).toEqual([]);
      expect(rollup.matched).toEqual(scenarioFor(industry).archetype.skillRequirements);
    }
  });

  it("energy-utilities: grid-balance is UNMATCHED — the honest REAL refusal recorded", () => {
    const rollup = intelligenceFor("energy-utilities").capabilityMatching;
    expect(rollup.result.ok).toBe(false);
    expect(rollup.refusalReasonCode).toBe("NO_MODEL_MATCHES_REQUIREMENT");
    expect(rollup.unmatched).toEqual(["grid-balance"]);
    expect(rollup.matched).toEqual(["model_invoke", "analyze-telemetry"]);
  });

  it("the match result equals a direct REAL matchIndustryCapabilities call", () => {
    const scenario = scenarioFor("energy-utilities");
    const direct = matchIndustryCapabilities(DEFAULT_INDUSTRY_MODEL_REGISTRY, scenario.archetype.skillRequirements);
    expect(intelligenceFor("energy-utilities").capabilityMatching.result).toEqual(direct);
  });

  it("a caller-supplied registry widens the honest-refusal record (never invents matches)", () => {
    const scenario = scenarioFor("manufacturing");
    const withoutForecast = DEFAULT_INDUSTRY_MODEL_REGISTRY.filter((m) => m.id !== "mdl-forecast");
    const result = buildScenarioIntelligence(scenario, { modelRegistry: withoutForecast });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.intelligence.capabilityMatching.unmatched).toEqual(["forecast"]);
    const capabilityShortfalls = result.intelligence.shortfalls.filter((s) => s.kind === "capability-unmatched");
    expect(capabilityShortfalls).toHaveLength(1);
    expect(capabilityShortfalls[0]?.reasonCode).toBe("NO_MODEL_MATCHES_REQUIREMENT");
  });
});

describe("intelligence — the shortfall ledger (explained honest refusals)", () => {
  it("every scenario records the REAL assembly refusal (method-deprecated)", () => {
    for (const industry of ALL_INDUSTRIES) {
      const shortfalls = intelligenceFor(industry).shortfalls;
      const assembly = shortfalls.filter((s) => s.kind === "assembly-refusal");
      expect(assembly).toHaveLength(1);
      expect(assembly[0]?.reasonCode).toBe("method-deprecated");
      expect(assembly[0]?.source).toContain("applyMethodToAsset");
    }
  });

  it("energy-utilities additionally carries the capability shortfall with the REAL code", () => {
    const shortfalls = intelligenceFor("energy-utilities").shortfalls;
    const capability = shortfalls.filter((s) => s.kind === "capability-unmatched");
    expect(capability).toHaveLength(1);
    expect(capability[0]?.reasonCode).toBe("NO_MODEL_MATCHES_REQUIREMENT");
    expect(capability[0]?.detail).toContain("grid-balance");
  });

  it("EVERY shortfall carries a non-empty reason code (the gate's (e) input law)", () => {
    for (const industry of ALL_INDUSTRIES) {
      for (const shortfall of intelligenceFor(industry).shortfalls as readonly IntelligenceShortfall[]) {
        expect(typeof shortfall.reasonCode).toBe("string");
        expect(shortfall.reasonCode.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("intelligence — fail-closed, digest, determinism", () => {
  it("tenant fail-closed: an empty tenant refuses the rollup", () => {
    const scenario = scenarioFor("manufacturing");
    const result = buildScenarioIntelligence({ ...scenario, tenantId: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe("TENANT_ID_EMPTY");
  });

  it("an empty fleet refuses (a fraction over nothing would be invented)", () => {
    const scenario = scenarioFor("manufacturing");
    const result = buildScenarioIntelligence({ ...scenario, fleet: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe("EMPTY_FLEET");
  });

  it("the digest verifies; post-hoc mutation of the posture delta is DETECTED", () => {
    const built = buildScenarioIntelligence(scenarioFor("construction"));
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(verifyIntelligenceDigest(built.intelligence)).toBe(true);
    (built.intelligence.optimizationPosture as unknown as { improvementDelta: number }).improvementDelta = -1;
    expect(verifyIntelligenceDigest(built.intelligence)).toBe(false);
  });

  it("post-hoc mutation of the referenced benchmark record is DETECTED", () => {
    const built = buildScenarioIntelligence(scenarioFor("construction"));
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const benchmark = built.intelligence.optimizationPosture.benchmark;
    (benchmark as unknown as { improvementDelta: number }).improvementDelta = 0;
    expect(verifyIntelligenceDigest(built.intelligence)).toBe(false);
  });

  it("post-hoc mutation of a forecast interval is DETECTED", () => {
    const scenario = freshScenario("logistics");
    const built = buildScenarioIntelligence(scenario);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(verifyIntelligenceDigest(built.intelligence)).toBe(true);
    const forecast = scenario.forecasts[0];
    if (forecast === undefined) throw new Error("forecast missing");
    (forecast.predicted.uncertainty as unknown as { upper: number }).upper = forecast.predicted.uncertainty.lower + 0.5;
    expect(verifyIntelligenceDigest(built.intelligence)).toBe(false);
  });

  it("byte-identical determinism: re-built rollups reproduce every digest", () => {
    for (const industry of ALL_INDUSTRIES) {
      const rebuilt = buildScenarioIntelligence(scenarioFor(industry));
      expect(rebuilt.ok).toBe(true);
      if (!rebuilt.ok) continue;
      expect(rebuilt.intelligence.intelligenceDigest).toBe(intelligenceFor(industry).intelligenceDigest);
    }
  });
});

function entry_h(utilization: { readonly perForecast: readonly { readonly horizon: number; readonly width: number }[] }, index: number) {
  const entry = utilization.perForecast[index];
  if (entry === undefined) throw new Error("entry missing");
  return entry;
}
