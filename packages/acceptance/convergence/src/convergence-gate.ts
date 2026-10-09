/**
 * @fleetos/acceptance-convergence — the convergence verdict gate
 * (`./gate`, Wave 9 TL lane F291).
 *
 * A deterministic, BOOLEAN verdict over the assembled scenario + the
 * intelligence rollup — the F281 release-gate discipline (NO weighted
 * scores, NO partial convergence):
 *
 *   CONVERGED     iff blockers.length === 0, requiring ALL of:
 *     (a) the archetype is TOP-RANKED for the scenario profile by the REAL
 *         fit scoring (`rankIndustryFit` — ties resolved by its documented
 *         rule: score desc, industry asc, tier asc);
 *     (b) the lineage chain verification passes (`verifyLineageChain` — a
 *         tampered/reordered edge fails loudly with the REAL reason);
 *     (c) the REAL benchmark's industry-policy delta beats the generic
 *         baseline on the industry's own objective (delta > 0, VERBATIM
 *         from the REAL BenchmarkScenarioResult);
 *     (d) every JEPA forecast interval satisfies the widening law — never
 *         narrower than the REAL reference adapter's interval at equal
 *         horizon (machine-checked by driving the reference adapter);
 *     (e) no honest-refusal shortfall is unexplained (each carries its
 *         REAL reason code).
 *   NOT-CONVERGED otherwise, with the exact blocking reasons — every
 *   blocker NAMES ITS SOURCE RECORD and carries the REAL reason code or
 *   numbers verbatim.
 *
 * Evaluation order (deterministic, documented): tenant scope (empty → a
 * single TENANT_ID_EMPTY; a foreign-tenant scenario/rollup or a rollup from
 * another scenario is never evaluated) → record pairing → digest tamper
 * checks → conditions (a)..(e), ALL evaluated (no short-circuit between
 * conditions — every failing condition contributes its named blocker).
 *
 * The benchmark + corpora surfaces are industry/corpus-level (fixed
 * deterministic worlds); the gate's tenant scope applies to the scenario +
 * intelligence records (the F281 corpus-level finding, same discipline).
 *
 * Pure deterministic TS: no clock, no randomness, no network, no timers.
 */

import { listArchetypes, rankIndustryFit } from "@fleetos/agent-organizations";
import { verifyLineageChain } from "@fleetos/assets";
import { makeReferenceWorldModelAdapter } from "@fleetos/world-model";
import { digestOf } from "./digest.js";
import { verifyScenarioDigest, type ConvergenceScenario } from "./scenarios.js";
import { verifyIntelligenceDigest, type ScenarioIntelligence } from "./intelligence.js";

export const CONVERGENCE_GATE_SCHEMA_VERSION = 1;

/** The lane's numeric-honesty tolerance (round6 outputs; 1e-6 guards FP subtraction). */
const WIDTH_EPSILON = 1e-6;

export type ConvergenceVerdict = "CONVERGED" | "NOT-CONVERGED";

export type ConvergenceBlockerCode =
  | "TENANT_ID_EMPTY"
  | "SCENARIO_TENANT_MISMATCH"
  | "INTELLIGENCE_TENANT_MISMATCH"
  | "INTELLIGENCE_SCENARIO_MISMATCH"
  | "SCENARIO_TAMPERED"
  | "INTELLIGENCE_TAMPERED"
  | "FIT_RANK_NOT_TOP"
  | "LINEAGE_CHAIN_BROKEN"
  | "BENCHMARK_NOT_IMPROVING"
  | "FORECAST_INTERVAL_TOO_NARROW"
  | "SHORTFALL_UNEXPLAINED";

export interface ConvergenceBlocker {
  readonly code: ConvergenceBlockerCode;
  /** Names the source record this blocker came from. */
  readonly source: string;
  /** The REAL reason code / numbers, verbatim from the source record. */
  readonly detail: string;
}

export interface ConvergenceGateInput {
  readonly tenantId: string;
  readonly scenario: ConvergenceScenario;
  readonly intelligence: ScenarioIntelligence;
}

export interface ConvergenceGateVerdict {
  readonly schemaVersion: typeof CONVERGENCE_GATE_SCHEMA_VERSION;
  readonly tenantId: string;
  readonly scenarioId: string;
  readonly verdict: ConvergenceVerdict;
  readonly blockers: readonly ConvergenceBlocker[];
  readonly gateDigest: string;
}

function gateDigestOf(verdict: Omit<ConvergenceGateVerdict, "gateDigest">): string {
  return digestOf("convergence-gate", verdict as unknown as object);
}

// ---------------------------------------------------------------------------
// The five conditions — each contributes zero or more named blockers.
// ---------------------------------------------------------------------------

/** (a) The archetype must be TOP-RANKED for the scenario profile (REAL fit scoring). */
function fitRankBlockers(scenario: ConvergenceScenario): ConvergenceBlocker[] {
  const ranking = rankIndustryFit(scenario.profile, listArchetypes());
  const top = ranking[0];
  if (top === undefined) return [];
  if (top.score.industry === scenario.industry && top.score.tier === scenario.tier) return [];
  const own = ranking.find((r) => r.score.industry === scenario.industry && r.score.tier === scenario.tier);
  return [
    {
      code: "FIT_RANK_NOT_TOP",
      source: `scenario.profile (sectorSignal='${scenario.profile.sectorSignal}') via rankIndustryFit`,
      detail: `top-ranked archetype is ${top.score.industry}/${top.score.tier} at ${top.score.scoreBps} bps; scenario archetype ${scenario.industry}/${scenario.tier} ranked ${own === undefined ? "unranked" : `#${own.rank} at ${own.score.scoreBps} bps`}`,
    },
  ];
}

/** (b) The lineage chain must verify (tamper-evident; REAL reason codes). */
function lineageBlockers(scenario: ConvergenceScenario): ConvergenceBlocker[] {
  const verification = verifyLineageChain(scenario.graph);
  if (verification.ok) return [];
  return [
    {
      code: "LINEAGE_CHAIN_BROKEN",
      source: `scenario.graph.edges[seq ${verification.failingSequence}]`,
      detail: `${verification.reason} (expected=${verification.expected}, actual=${verification.actual})`,
    },
  ];
}

/** (c) The REAL benchmark delta must beat the generic baseline (delta > 0 verbatim). */
function benchmarkBlockers(intelligence: ScenarioIntelligence): ConvergenceBlocker[] {
  const posture = intelligence.optimizationPosture;
  if (posture.improvementDelta > 0) return [];
  return [
    {
      code: "BENCHMARK_NOT_IMPROVING",
      source: "intelligence.optimizationPosture.benchmark (runIndustryBenchmark)",
      detail: `improvementDelta=${posture.improvementDelta} on objective ${posture.objective} (industry=${posture.industryScore}, generic=${posture.genericScore}) — the industry policy does not beat the generic baseline`,
    },
  ];
}

/**
 * (d) Every JEPA forecast interval must satisfy the widening law — never
 * narrower than the REAL reference adapter's interval at equal horizon.
 * The reference adapter is DRIVEN (its REAL output is the comparison), and
 * one blocker is emitted per failing forecast (each names its record).
 */
function intervalBlockers(scenario: ConvergenceScenario): ConvergenceBlocker[] {
  const reference = makeReferenceWorldModelAdapter(scenario.forecastComputedAt);
  const blockers: ConvergenceBlocker[] = [];
  for (const [index, forecast] of scenario.forecasts.entries()) {
    const referencePrediction = reference.predict(forecast.representation);
    const referenceWidth = referencePrediction.uncertainty.upper - referencePrediction.uncertainty.lower;
    const jepaWidth = forecast.predicted.uncertainty.upper - forecast.predicted.uncertainty.lower;
    if (jepaWidth + WIDTH_EPSILON < referenceWidth) {
      blockers.push({
        code: "FORECAST_INTERVAL_TOO_NARROW",
        source: `scenario.forecasts[${index}] (${forecast.adapterId} over ${forecast.assetId}, horizon ${forecast.horizon})`,
        detail: `interval width ${jepaWidth} is narrower than the reference adapter's ${referenceWidth} at equal horizon (widening law violated)`,
      });
    }
  }
  return blockers;
}

/** (e) Every honest-refusal shortfall must carry its REAL reason code. */
function shortfallBlockers(intelligence: ScenarioIntelligence): ConvergenceBlocker[] {
  const blockers: ConvergenceBlocker[] = [];
  for (const [index, shortfall] of intelligence.shortfalls.entries()) {
    if (typeof shortfall.reasonCode !== "string" || shortfall.reasonCode.length === 0) {
      blockers.push({
        code: "SHORTFALL_UNEXPLAINED",
        source: `intelligence.shortfalls[${index}] (kind=${shortfall.kind}, source=${shortfall.source})`,
        detail: `shortfall detail=${shortfall.detail ?? null} carries no reason code — an honest refusal must be explained`,
      });
    }
  }
  return blockers;
}

// ---------------------------------------------------------------------------
// The gate.
// ---------------------------------------------------------------------------

/**
 * Evaluate the convergence gate. Pure and total: every failure mode is a
 * NAMED blocker; the function never throws. Empty tenant short-circuits to
 * a single TENANT_ID_EMPTY blocker; a foreign-tenant or mis-paired record
 * short-circuits to its pairing blocker (fail-closed — the signals of a
 * foreign scope are never evaluated). CONVERGED iff blockers.length === 0.
 */
export function evaluateConvergenceGate(input: ConvergenceGateInput): ConvergenceGateVerdict {
  const blockers: ConvergenceBlocker[] = [];
  if (typeof input.tenantId !== "string" || input.tenantId === "") {
    blockers.push({
      code: "TENANT_ID_EMPTY",
      source: "convergence-gate.tenantId",
      detail: "the convergence gate requires a tenant scope; none was supplied",
    });
    return withDigest(input.tenantId, input.scenario.scenarioId, blockers);
  }
  if (input.scenario.tenantId !== input.tenantId) {
    blockers.push({
      code: "SCENARIO_TENANT_MISMATCH",
      source: "scenario.tenantId",
      detail: `scenario tenant ${input.scenario.tenantId} does not match gate tenant ${input.tenantId}`,
    });
    return withDigest(input.tenantId, input.scenario.scenarioId, blockers);
  }
  if (input.intelligence.tenantId !== input.tenantId) {
    blockers.push({
      code: "INTELLIGENCE_TENANT_MISMATCH",
      source: "intelligence.tenantId",
      detail: `intelligence rollup tenant ${input.intelligence.tenantId} does not match gate tenant ${input.tenantId}`,
    });
    return withDigest(input.tenantId, input.scenario.scenarioId, blockers);
  }
  if (input.intelligence.scenarioId !== input.scenario.scenarioId) {
    blockers.push({
      code: "INTELLIGENCE_SCENARIO_MISMATCH",
      source: "intelligence.scenarioId",
      detail: `intelligence rollup ${input.intelligence.scenarioId} does not pair with scenario ${input.scenario.scenarioId}`,
    });
    return withDigest(input.tenantId, input.scenario.scenarioId, blockers);
  }

  if (!verifyScenarioDigest(input.scenario)) {
    blockers.push({
      code: "SCENARIO_TAMPERED",
      source: "scenario.scenarioDigest",
      detail: "scenario digest mismatch — a referenced REAL artifact was mutated after assembly",
    });
  }
  if (!verifyIntelligenceDigest(input.intelligence)) {
    blockers.push({
      code: "INTELLIGENCE_TAMPERED",
      source: "intelligence.intelligenceDigest",
      detail: "intelligence digest mismatch — the presented rollup was tampered",
    });
  }
  blockers.push(...fitRankBlockers(input.scenario));
  blockers.push(...lineageBlockers(input.scenario));
  blockers.push(...benchmarkBlockers(input.intelligence));
  blockers.push(...intervalBlockers(input.scenario));
  blockers.push(...shortfallBlockers(input.intelligence));
  return withDigest(input.tenantId, input.scenario.scenarioId, blockers);
}

function withDigest(
  tenantId: string,
  scenarioId: string,
  blockers: readonly ConvergenceBlocker[],
): ConvergenceGateVerdict {
  const base: Omit<ConvergenceGateVerdict, "gateDigest"> = {
    schemaVersion: CONVERGENCE_GATE_SCHEMA_VERSION,
    tenantId,
    scenarioId,
    verdict: blockers.length === 0 ? "CONVERGED" : "NOT-CONVERGED",
    blockers,
  };
  return { ...base, gateDigest: gateDigestOf(base) };
}

/** Recompute the verdict digest — false means the presented verdict was tampered. */
export function verifyConvergenceGateVerdict(verdict: ConvergenceGateVerdict): boolean {
  const { gateDigest, ...rest } = verdict;
  return gateDigestOf(rest) === gateDigest;
}
