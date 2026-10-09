/**
 * @fleetos/acceptance-convergence — the convergence gate tests.
 *
 * The boolean CONVERGED / NOT-CONVERGED verdict over the assembled scenario
 * + intelligence rollup (the F281 no-weighted-scores discipline):
 *   - all-green over the REAL surfaces → CONVERGED (per industry);
 *   - EACH single degradation → NOT-CONVERGED with the NAMED blocker:
 *     tampered lineage edge (EDIT + REORDER), failed fit rank,
 *     non-improving benchmark, too-narrow interval, unexplained shortfall;
 *   - tenant fail-closed on every entry path; tamper detection on the
 *     scenario + rollup; multi-degradation blocker completeness;
 *   - EXPLAINED shortfalls do NOT block (the (e) semantics);
 *   - byte-identical determinism.
 *
 * Degradation fixtures are HONEST: mutated records are either left unsealed
 * (tamper — detected) or RESEALED with the package's own digest primitive
 * (digest-consistent records honestly carrying failures — the F281
 * convention).
 */

import { describe, expect, it } from "vitest";
import {
  evaluateConvergenceGate,
  verifyConvergenceGateVerdict,
  type ConvergenceBlocker,
  type ConvergenceGateVerdict,
} from "../src/convergence-gate.js";
import { computeScenarioDigest, type ConvergenceScenario } from "../src/scenarios.js";
import { computeIntelligenceDigest, type ScenarioIntelligence } from "../src/intelligence.js";
import { ALL_INDUSTRIES, freshScenario, intelligenceFor, scenarioFor } from "./fixtures.js";
import { assembleScenario } from "../src/scenarios.js";

const gateOf = (scenario: ConvergenceScenario, intelligence: ScenarioIntelligence): ConvergenceGateVerdict =>
  evaluateConvergenceGate({ tenantId: scenario.tenantId, scenario, intelligence });

const codes = (verdict: ConvergenceGateVerdict): readonly string[] => verdict.blockers.map((b) => b.code);

function findBlocker(verdict: ConvergenceGateVerdict, code: string): ConvergenceBlocker {
  const blocker = verdict.blockers.find((b) => b.code === code);
  if (blocker === undefined) throw new Error(`blocker ${code} missing among [${codes(verdict).join(",")}]`);
  return blocker;
}

describe("convergence gate — all-green over the REAL surfaces", () => {
  for (const industry of ALL_INDUSTRIES) {
    it(`${industry}: CONVERGED with zero blockers, digest verified`, () => {
      const verdict = gateOf(scenarioFor(industry), intelligenceFor(industry));
      expect(verdict.verdict).toBe("CONVERGED");
      expect(verdict.blockers).toEqual([]);
      expect(verdict.scenarioId).toBe(scenarioFor(industry).scenarioId);
      expect(verifyConvergenceGateVerdict(verdict)).toBe(true);
    });
  }

  it("EXPLAINED shortfalls do NOT block: energy-utilities converges with honest refusals", () => {
    const intelligence = intelligenceFor("energy-utilities");
    expect(intelligence.shortfalls.length).toBeGreaterThanOrEqual(2);
    const verdict = gateOf(scenarioFor("energy-utilities"), intelligence);
    expect(verdict.verdict).toBe("CONVERGED");
  });
});

describe("convergence gate — tenant fail-closed on the entry path", () => {
  it("empty tenant short-circuits to exactly ONE TENANT_ID_EMPTY blocker", () => {
    const verdict = evaluateConvergenceGate({
      tenantId: "",
      scenario: scenarioFor("manufacturing"),
      intelligence: intelligenceFor("manufacturing"),
    });
    expect(verdict.verdict).toBe("NOT-CONVERGED");
    expect(verdict.blockers).toHaveLength(1);
    expect(verdict.blockers[0]?.code).toBe("TENANT_ID_EMPTY");
  });

  it("a foreign-tenant scenario is never evaluated (SCENARIO_TENANT_MISMATCH)", () => {
    const verdict = evaluateConvergenceGate({
      tenantId: "tnt_other",
      scenario: scenarioFor("manufacturing"),
      intelligence: intelligenceFor("manufacturing"),
    });
    expect(verdict.verdict).toBe("NOT-CONVERGED");
    expect(codes(verdict)).toEqual(["SCENARIO_TENANT_MISMATCH"]);
  });

  it("a foreign-tenant intelligence rollup is never evaluated (INTELLIGENCE_TENANT_MISMATCH)", () => {
    const scenario = scenarioFor("manufacturing");
    const foreign = { ...intelligenceFor("manufacturing"), tenantId: "tnt_elsewhere" };
    const verdict = evaluateConvergenceGate({ tenantId: scenario.tenantId, scenario, intelligence: foreign });
    expect(verdict.verdict).toBe("NOT-CONVERGED");
    expect(codes(verdict)).toEqual(["INTELLIGENCE_TENANT_MISMATCH"]);
  });

  it("an intelligence rollup from ANOTHER scenario refuses pairing (INTELLIGENCE_SCENARIO_MISMATCH)", () => {
    const smallTier = assembleScenario({ industry: "manufacturing", tier: "small" });
    expect(smallTier.ok).toBe(true);
    if (!smallTier.ok) return;
    expect(smallTier.scenario.tenantId).toBe(scenarioFor("manufacturing").tenantId);
    const verdict = gateOf(smallTier.scenario, intelligenceFor("manufacturing"));
    expect(verdict.verdict).toBe("NOT-CONVERGED");
    expect(codes(verdict)).toEqual(["INTELLIGENCE_SCENARIO_MISMATCH"]);
  });
});

describe("convergence gate — (a) fit rank: the archetype must be TOP-RANKED", () => {
  it("a mismatched sector profile blocks with the top archetype NAMED", () => {
    const scenario = resealed({ ...scenarioFor("manufacturing"), profile: { ...scenarioFor("manufacturing").profile, sectorSignal: "logistics" } });
    const verdict = gateOf(scenario, intelligenceFor("manufacturing"));
    expect(verdict.verdict).toBe("NOT-CONVERGED");
    const blocker = findBlocker(verdict, "FIT_RANK_NOT_TOP");
    expect(blocker.source).toContain("scenario.profile");
    expect(blocker.detail).toContain("logistics/medium");
    expect(blocker.detail).toContain("manufacturing/medium");
  });

  it("a tier-mismatched profile blocks (the adjacent-tier archetype outranks)", () => {
    const base = scenarioFor("facilities");
    const scenario = resealed({ ...base, profile: { ...base.profile, orgSizeHint: "large", fleetSize: 800 } });
    const verdict = gateOf(scenario, intelligenceFor("facilities"));
    expect(verdict.verdict).toBe("NOT-CONVERGED");
    findBlocker(verdict, "FIT_RANK_NOT_TOP");
  });
});

describe("convergence gate — (b) lineage chain: tamper/reorder fails LOUDLY", () => {
  it("an EDITED edge payload fails with the REAL chain reason (edge-digest-mismatch)", () => {
    const scenario = freshScenario("manufacturing");
    const edge = scenario.graph.edges[0];
    if (edge === undefined) throw new Error("edge missing");
    (edge.payload as unknown as { quantity: number }).quantity = 41;
    const verdict = gateOf(scenario, intelligenceFor("manufacturing"));
    expect(verdict.verdict).toBe("NOT-CONVERGED");
    const blocker = findBlocker(verdict, "LINEAGE_CHAIN_BROKEN");
    expect(blocker.source).toContain("seq 1");
    expect(blocker.detail).toContain("edge-digest-mismatch");
    expect(blocker.detail).toContain("expected=");
  });

  it("a REORDERED chain fails loudly (out-of-order-sequence, the REAL reason)", () => {
    const scenario = freshScenario("logistics");
    const edges = [...scenario.graph.edges];
    const first = edges[0];
    const second = edges[1];
    if (first === undefined || second === undefined) throw new Error("edges missing");
    edges[0] = second;
    edges[1] = first;
    const reordered = { ...scenario, graph: { ...scenario.graph, edges } };
    const verdict = gateOf(reordered, intelligenceFor("logistics"));
    expect(verdict.verdict).toBe("NOT-CONVERGED");
    const blocker = findBlocker(verdict, "LINEAGE_CHAIN_BROKEN");
    expect(blocker.detail).toContain("out-of-order-sequence");
  });

  it("the tamper is detected end-to-end (SCENARIO_TAMPERED + LINEAGE_CHAIN_BROKEN)", () => {
    const scenario = freshScenario("construction");
    const edge = scenario.graph.edges[2];
    if (edge === undefined) throw new Error("edge missing");
    (edge.payload as unknown as { yieldRatio: number }).yieldRatio = 0.5;
    const verdict = gateOf(scenario, intelligenceFor("construction"));
    expect(codes(verdict)).toContain("SCENARIO_TAMPERED");
    expect(codes(verdict)).toContain("LINEAGE_CHAIN_BROKEN");
  });
});

describe("convergence gate — (c) benchmark delta must beat the generic baseline", () => {
  it("a non-improving delta blocks with the delta VERBATIM", () => {
    const intelligence = resealedIntelligence({
      ...intelligenceFor("manufacturing"),
      optimizationPosture: {
        ...intelligenceFor("manufacturing").optimizationPosture,
        improvementDelta: 0,
        improved: false,
      },
    });
    const verdict = gateOf(scenarioFor("manufacturing"), intelligence);
    expect(verdict.verdict).toBe("NOT-CONVERGED");
    const blocker = findBlocker(verdict, "BENCHMARK_NOT_IMPROVING");
    expect(blocker.detail).toContain("improvementDelta=0");
    expect(blocker.detail).toContain("maximize-fit");
  });

  it("a NEGATIVE delta blocks with the delta verbatim (never silently converged)", () => {
    const intelligence = resealedIntelligence({
      ...intelligenceFor("facilities"),
      optimizationPosture: {
        ...intelligenceFor("facilities").optimizationPosture,
        improvementDelta: -500,
        improved: false,
      },
    });
    const verdict = gateOf(scenarioFor("facilities"), intelligence);
    const blocker = findBlocker(verdict, "BENCHMARK_NOT_IMPROVING");
    expect(blocker.detail).toContain("improvementDelta=-500");
  });
});

describe("convergence gate — (d) the widening law is machine-checked", () => {
  it("a too-narrow forecast interval blocks, naming the forecast record", () => {
    const scenario = narrowIntervalScenario("energy-utilities");
    const verdict = gateOf(scenario, intelligenceFor("energy-utilities"));
    expect(verdict.verdict).toBe("NOT-CONVERGED");
    const blocker = findBlocker(verdict, "FORECAST_INTERVAL_TOO_NARROW");
    expect(blocker.source).toContain("scenario.forecasts[0]");
    expect(blocker.source).toContain("jepa.core");
    expect(blocker.detail).toContain("narrower than the reference adapter's");
  });

  it("one blocker per failing forecast (each names its own record)", () => {
    const scenario = narrowIntervalScenario("manufacturing", 2);
    const verdict = gateOf(scenario, intelligenceFor("manufacturing"));
    const narrow = verdict.blockers.filter((b) => b.code === "FORECAST_INTERVAL_TOO_NARROW");
    expect(narrow).toHaveLength(2);
  });

  it("the reference adapter's REAL interval is the comparison (width 2.0)", () => {
    const verdict = gateOf(scenarioFor("field-services"), intelligenceFor("field-services"));
    expect(verdict.verdict).toBe("CONVERGED");
    for (const forecast of scenarioFor("field-services").forecasts) {
      expect(forecast.predicted.uncertainty.upper - forecast.predicted.uncertainty.lower).toBeGreaterThanOrEqual(2 - 1e-6);
    }
  });
});

describe("convergence gate — (e) every honest-refusal shortfall must be explained", () => {
  it("an unexplained shortfall (empty reason code) blocks, naming the record", () => {
    const intelligence = resealedIntelligence({
      ...intelligenceFor("logistics"),
      shortfalls: [
        ...intelligenceFor("logistics").shortfalls,
        { kind: "assembly-refusal", reasonCode: "", detail: "an unexplained honest refusal", source: "test fixture" },
      ],
    });
    const verdict = gateOf(scenarioFor("logistics"), intelligence);
    expect(verdict.verdict).toBe("NOT-CONVERGED");
    const blocker = findBlocker(verdict, "SHORTFALL_UNEXPLAINED");
    expect(blocker.source).toContain("intelligence.shortfalls[");
    expect(blocker.detail).toContain("no reason code");
  });
});

describe("convergence gate — completeness, tamper, determinism", () => {
  it("multi-degradation: every failing condition contributes its named blocker", () => {
    const base = scenarioFor("manufacturing");
    const narrowed = narrowIntervalScenario("manufacturing");
    const scenario = resealed({
      ...narrowed,
      profile: { ...base.profile, sectorSignal: "construction" },
    });
    const intelligence = resealedIntelligence({
      ...intelligenceFor("manufacturing"),
      optimizationPosture: { ...intelligenceFor("manufacturing").optimizationPosture, improvementDelta: 0, improved: false },
      shortfalls: [
        ...intelligenceFor("manufacturing").shortfalls,
        { kind: "anchor-refusal", reasonCode: "", detail: null, source: "test fixture" },
      ],
    });
    const verdict = gateOf(scenario, intelligence);
    expect(verdict.verdict).toBe("NOT-CONVERGED");
    expect(new Set(codes(verdict))).toEqual(new Set([
      "FIT_RANK_NOT_TOP",
      "FORECAST_INTERVAL_TOO_NARROW",
      "BENCHMARK_NOT_IMPROVING",
      "SHORTFALL_UNEXPLAINED",
    ]));
  });

  it("a tampered intelligence rollup blocks (INTELLIGENCE_TAMPERED)", () => {
    const intelligence = intelligenceFor("manufacturing");
    (intelligence.shortfalls as unknown as { length: number }).length = 0;
    const verdict = gateOf(scenarioFor("manufacturing"), intelligence);
    expect(codes(verdict)).toContain("INTELLIGENCE_TAMPERED");
    expect(verdict.verdict).toBe("NOT-CONVERGED");
  });

  it("byte-identical determinism: re-evaluation reproduces the verdict + digest", () => {
    const first = gateOf(scenarioFor("construction"), intelligenceFor("construction"));
    const second = gateOf(scenarioFor("construction"), intelligenceFor("construction"));
    expect(second).toEqual(first);
    expect(second.gateDigest).toBe(first.gateDigest);
  });

  it("verdict tamper is DETECTED by verifyConvergenceGateVerdict", () => {
    const verdict = gateOf(scenarioFor("facilities"), intelligenceFor("facilities"));
    expect(verifyConvergenceGateVerdict(verdict)).toBe(true);
    (verdict.blockers as unknown as unknown[]).push({ code: "SHORTFALL_UNEXPLAINED", source: "tamper", detail: "injected" });
    expect(verifyConvergenceGateVerdict(verdict)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Honest degradation fixtures.
// ---------------------------------------------------------------------------

/** Re-seal a mutated scenario with the package's own digest primitive. */
function resealed(scenario: ConvergenceScenario): ConvergenceScenario {
  const { scenarioDigest: _omit, ...rest } = scenario;
  return { ...rest, scenarioDigest: computeScenarioDigest(rest) };
}

/** Re-seal a mutated intelligence rollup with the package's own digest primitive. */
function resealedIntelligence(intelligence: ScenarioIntelligence): ScenarioIntelligence {
  const { intelligenceDigest: _omit, ...rest } = intelligence;
  return { ...rest, intelligenceDigest: computeIntelligenceDigest(rest) };
}

/** A digest-consistent scenario whose forecast `count` carries a too-narrow interval. */
function narrowIntervalScenario(industry: (typeof ALL_INDUSTRIES)[number], count = 1): ConvergenceScenario {
  const base = freshScenario(industry);
  const forecasts = base.forecasts.map((forecast, index) => {
    if (index >= count) return forecast;
    const { lower, upper, ...rest } = forecast.predicted.uncertainty;
    const mid = (lower + upper) / 2;
    return {
      ...forecast,
      predicted: {
        ...forecast.predicted,
        uncertainty: { ...rest, lower: mid - 0.5, upper: mid + 0.5, confidence: 0.9, method: "jepa.latent-sqrt" as const },
      },
    };
  });
  return resealed({ ...base, forecasts });
}
