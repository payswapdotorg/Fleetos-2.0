/**
 * @fleetos/acceptance-convergence — deterministic intelligence rollups
 * (`./intelligence`, Wave 9 TL lane F291).
 *
 * Per scenario, four rollups assembled from REAL package outputs — every
 * field names its REAL source record; honest shortfalls are recorded, never
 * invented:
 *
 *   - LINEAGE COVERAGE — the REAL graph queries (`ancestry` from
 *     @fleetos/assets): what fraction of the fleet has complete ancestry.
 *     The number comes from the REAL traversal (per-asset depth/edge
 *     counts cited), with the count of assets carrying >= 1 ancestor.
 *   - OPTIMIZATION POSTURE — the REAL benchmark output vs the generic
 *     baseline (`runIndustryBenchmark` from @fleetos/agent-organizations):
 *     the industry objective score, the generic score and the improvement
 *     delta VERBATIM from the REAL BenchmarkScenarioResult.
 *   - FORECAST UTILIZATION — the REAL JEPA predictions with their
 *     uncertainty intervals carried AS-IS (the REAL interval object by
 *     reference; only the width is a documented derived number).
 *   - CAPABILITY MATCHING — the REAL gateway skill-to-model matches
 *     (`matchIndustryCapabilities` from @fleetos/model-gateway); unmatched
 *     requirements are recorded as HONEST refusals with the REAL reason
 *     code — never dropped, never invented.
 *
 * The shortfall ledger collects every honest refusal across the surfaces
 * (unmatched capabilities, assembly refusals, observation-anchor
 * refusals) — each carries its REAL reason code, the input to the gate's
 * condition (e).
 *
 * Pure deterministic TS: no clock, no randomness, no network, no timers.
 */

import { industryObjective, runIndustryBenchmark, type BenchmarkScenarioResult, type IndustryObjective } from "@fleetos/agent-organizations";
import { ancestry, type TraversalResult } from "@fleetos/assets";
import { matchIndustryCapabilities, type IndustryCapabilityMatchResult, type ModelDescriptor } from "@fleetos/model-gateway";
import type { UncertaintyInterval } from "@fleetos/world-model";
import { digestOf } from "./digest.js";
import { DEFAULT_INDUSTRY_MODEL_REGISTRY } from "./scenario-data.js";
import type { ConvergenceScenario, ScenarioForecast } from "./scenarios.js";

const LINEAGE_SOURCE = "@fleetos/assets lineage.ancestry(graph, {tenantId, kind:'asset', id})";
const BENCHMARK_SOURCE = "@fleetos/agent-organizations industries.runIndustryBenchmark(archetype)";
const FORECAST_SOURCE = "@fleetos/world-model jepa family adapters .predict(representation)";
const MATCH_SOURCE = "@fleetos/model-gateway matchIndustryCapabilities(registry, archetype.skillRequirements)";

// ---------------------------------------------------------------------------
// Rollup records.
// ---------------------------------------------------------------------------

export interface LineageCoverageAsset {
  readonly assetId: string;
  readonly ok: boolean;
  readonly depth: number;
  readonly edgeCount: number;
  readonly refusal?: string;
  readonly source: string;
}

export interface LineageCoverageRollup {
  readonly fleetSize: number;
  /** Count of REAL traversal results with depth >= 1 (the cited number). */
  readonly assetsWithAncestry: number;
  /** DERIVED (documented): floor(assetsWithAncestry * 10000 / fleetSize). */
  readonly coverageBps: number;
  readonly perAsset: readonly LineageCoverageAsset[];
  readonly source: string;
}

export interface OptimizationPostureRollup {
  /** The REAL benchmark record, BY REFERENCE (never recomputed). */
  readonly benchmark: BenchmarkScenarioResult;
  readonly objective: IndustryObjective;
  readonly industryScore: number;
  readonly genericScore: number;
  readonly improvementDelta: number;
  readonly improved: boolean;
  readonly source: string;
}

export interface ForecastUtilizationEntry {
  readonly adapterId: string;
  readonly assetId: string;
  readonly horizon: number;
  readonly value: number;
  /** The REAL uncertainty interval, carried BY REFERENCE (as-is). */
  readonly interval: UncertaintyInterval;
  /** DERIVED (documented): upper - lower of the REAL interval. */
  readonly width: number;
  readonly source: string;
}

export interface ForecastUtilizationRollup {
  readonly count: number;
  readonly perForecast: readonly ForecastUtilizationEntry[];
  readonly source: string;
}

export interface CapabilityMatchingRollup {
  /** The REAL match result, BY REFERENCE (ok or honest refusal). */
  readonly result: IndustryCapabilityMatchResult;
  readonly matched: readonly string[];
  readonly unmatched: readonly string[];
  /** The REAL refusal reason code when the match refused (else null). */
  readonly refusalReasonCode: string | null;
  readonly source: string;
}

export type ShortfallKind = "capability-unmatched" | "assembly-refusal" | "anchor-refusal";

export interface IntelligenceShortfall {
  readonly kind: ShortfallKind;
  /** The REAL reason code from the refusing surface — non-empty by contract. */
  readonly reasonCode: string;
  readonly detail: string | null;
  readonly source: string;
}

export interface ScenarioIntelligence {
  readonly kind: "convergence-intelligence";
  readonly scenarioId: string;
  readonly tenantId: string;
  readonly lineageCoverage: LineageCoverageRollup;
  readonly optimizationPosture: OptimizationPostureRollup;
  readonly forecastUtilization: ForecastUtilizationRollup;
  readonly capabilityMatching: CapabilityMatchingRollup;
  readonly shortfalls: readonly IntelligenceShortfall[];
  readonly intelligenceDigest: string;
}

export type IntelligenceReasonCode = "TENANT_ID_EMPTY" | "EMPTY_FLEET";

export type IntelligenceResult =
  | { readonly ok: true; readonly intelligence: ScenarioIntelligence }
  | { readonly ok: false; readonly reasonCode: IntelligenceReasonCode; readonly detail: string | null };

export interface IntelligenceOptions {
  /** Caller-supplied registry (default: the documented default registry). */
  readonly modelRegistry?: readonly ModelDescriptor[];
}

// ---------------------------------------------------------------------------
// The four rollups — each assembled from REAL outputs.
// ---------------------------------------------------------------------------

function buildLineageCoverage(scenario: ConvergenceScenario): LineageCoverageRollup {
  const perAsset: LineageCoverageAsset[] = [];
  let assetsWithAncestry = 0;
  for (const asset of scenario.fleet) {
    const result: TraversalResult = ancestry(scenario.graph, {
      tenantId: scenario.tenantId,
      kind: "asset",
      id: asset.id,
    });
    const hasAncestry = result.ok && result.depth >= 1;
    if (hasAncestry) assetsWithAncestry += 1;
    perAsset.push({
      assetId: asset.id,
      ok: result.ok,
      depth: result.depth,
      edgeCount: result.edges.length,
      refusal: result.refusal,
      source: LINEAGE_SOURCE,
    });
  }
  const fleetSize = scenario.fleet.length;
  const coverageBps = fleetSize === 0 ? 0 : Math.floor((assetsWithAncestry * 10000) / fleetSize);
  return { fleetSize, assetsWithAncestry, coverageBps, perAsset, source: LINEAGE_SOURCE };
}

function buildOptimizationPosture(scenario: ConvergenceScenario): OptimizationPostureRollup {
  const benchmark = runIndustryBenchmark(scenario.archetype);
  return {
    benchmark,
    objective: industryObjective(scenario.archetype),
    industryScore: benchmark.industryObjectiveScore,
    genericScore: benchmark.genericObjectiveScore,
    improvementDelta: benchmark.improvementDelta,
    improved: benchmark.improved,
    source: BENCHMARK_SOURCE,
  };
}

function buildForecastUtilization(scenario: ConvergenceScenario): ForecastUtilizationRollup {
  const perForecast = scenario.forecasts.map((forecast: ScenarioForecast) => ({
    adapterId: forecast.adapterId,
    assetId: forecast.assetId,
    horizon: forecast.horizon,
    value: forecast.predicted.value,
    interval: forecast.predicted.uncertainty,
    width: forecast.predicted.uncertainty.upper - forecast.predicted.uncertainty.lower,
    source: FORECAST_SOURCE,
  }));
  return { count: perForecast.length, perForecast, source: FORECAST_SOURCE };
}

function buildCapabilityMatching(
  scenario: ConvergenceScenario,
  registry: readonly ModelDescriptor[],
): CapabilityMatchingRollup {
  const result = matchIndustryCapabilities(registry, scenario.archetype.skillRequirements);
  if (result.ok) {
    return {
      result,
      matched: result.matches.filter((m) => !m.unmatched).map((m) => m.capability),
      unmatched: [],
      refusalReasonCode: null,
      source: MATCH_SOURCE,
    };
  }
  return {
    result,
    matched: result.partialMatches.filter((m) => !m.unmatched).map((m) => m.capability),
    unmatched: [...result.unmatchedCapabilities],
    refusalReasonCode: result.reasonCode,
    source: MATCH_SOURCE,
  };
}

function buildShortfalls(
  scenario: ConvergenceScenario,
  capability: CapabilityMatchingRollup,
): readonly IntelligenceShortfall[] {
  const shortfalls: IntelligenceShortfall[] = [];
  if (!capability.result.ok) {
    for (const cap of capability.unmatched) {
      shortfalls.push({
        kind: "capability-unmatched",
        reasonCode: capability.result.reasonCode,
        detail: `industry skill '${cap}' has no model in the registry (partial matches preserved)`,
        source: MATCH_SOURCE,
      });
    }
  }
  for (const refusal of scenario.refusals) {
    shortfalls.push({
      kind: "assembly-refusal",
      reasonCode: refusal.reasonCode,
      detail: refusal.detail,
      source: `scenario.assemblyRefusals[${refusal.surface}]`,
    });
  }
  for (const anchor of scenario.anchorResults) {
    if (anchor.ok) continue;
    shortfalls.push({
      kind: "anchor-refusal",
      reasonCode: anchor.reasonCode ?? "",
      detail: `observation ${anchor.observationId} for application ${anchor.applicationId}`,
      source: "@fleetos/assets lineage.validateObservationAnchor",
    });
  }
  return shortfalls;
}

// ---------------------------------------------------------------------------
// Digest — over the referenced REAL outputs (evidence, not recompute).
// ---------------------------------------------------------------------------

function intelligenceDigestParts(intelligence: Omit<ScenarioIntelligence, "intelligenceDigest">): object {
  return {
    scenarioId: intelligence.scenarioId,
    tenantId: intelligence.tenantId,
    lineageCoverage: {
      fleetSize: intelligence.lineageCoverage.fleetSize,
      assetsWithAncestry: intelligence.lineageCoverage.assetsWithAncestry,
      coverageBps: intelligence.lineageCoverage.coverageBps,
      perAsset: intelligence.lineageCoverage.perAsset.map((a) => [a.assetId, a.ok, a.depth, a.edgeCount, a.refusal ?? ""]),
    },
    // The posture record digested by CANONICAL CONTENT (wrapper + the
    // referenced REAL benchmark): post-hoc mutation of the verbatim delta
    // the gate reads is DETECTED by the digest recompute.
    optimizationPosture: intelligence.optimizationPosture,
    forecastUtilization: intelligence.forecastUtilization.perForecast.map((f) => [
      f.adapterId, f.assetId, f.horizon, f.value,
      f.interval.lower, f.interval.upper, f.interval.confidence, f.interval.method,
    ]),
    capabilityMatching: intelligence.capabilityMatching.result,
    shortfalls: intelligence.shortfalls.map((s) => [s.kind, s.reasonCode, s.detail, s.source]),
  };
}

/** Compute the intelligence digest over its referenced REAL outputs. */
export function computeIntelligenceDigest(intelligence: Omit<ScenarioIntelligence, "intelligenceDigest">): string {
  return digestOf("conv-intelligence", intelligenceDigestParts(intelligence));
}

/** Recompute + compare — false means the presented rollup was tampered. */
export function verifyIntelligenceDigest(intelligence: ScenarioIntelligence): boolean {
  return computeIntelligenceDigest(intelligence) === intelligence.intelligenceDigest;
}

// ---------------------------------------------------------------------------
// The rollup builder.
// ---------------------------------------------------------------------------

/**
 * Build the deterministic intelligence rollup for one scenario. Fail-closed:
 * an empty tenant or an empty fleet refuses with a named reason code (a
 * coverage fraction over an empty fleet would be invented — refused instead).
 */
export function buildScenarioIntelligence(
  scenario: ConvergenceScenario,
  options?: IntelligenceOptions,
): IntelligenceResult {
  if (typeof scenario.tenantId !== "string" || scenario.tenantId === "") {
    return { ok: false, reasonCode: "TENANT_ID_EMPTY", detail: null };
  }
  if (scenario.fleet.length === 0) {
    return { ok: false, reasonCode: "EMPTY_FLEET", detail: `scenario ${scenario.scenarioId} carries no fleet assets` };
  }
  const registry = options?.modelRegistry ?? DEFAULT_INDUSTRY_MODEL_REGISTRY;
  const lineageCoverage = buildLineageCoverage(scenario);
  const optimizationPosture = buildOptimizationPosture(scenario);
  const forecastUtilization = buildForecastUtilization(scenario);
  const capabilityMatching = buildCapabilityMatching(scenario, registry);
  const shortfalls = buildShortfalls(scenario, capabilityMatching);
  const base: Omit<ScenarioIntelligence, "intelligenceDigest"> = {
    kind: "convergence-intelligence",
    scenarioId: scenario.scenarioId,
    tenantId: scenario.tenantId,
    lineageCoverage,
    optimizationPosture,
    forecastUtilization,
    capabilityMatching,
    shortfalls,
  };
  return { ok: true, intelligence: { ...base, intelligenceDigest: computeIntelligenceDigest(base) } };
}

/** Build the rollups for every scenario in the set (fail-loud on refusal). */
export function buildScenarioIntelligenceSet(
  scenarios: readonly ConvergenceScenario[],
  options?: IntelligenceOptions,
): readonly ScenarioIntelligence[] {
  const out: ScenarioIntelligence[] = [];
  for (const scenario of scenarios) {
    const result = buildScenarioIntelligence(scenario, options);
    if (!result.ok) throw new Error(`intelligence for ${scenario.scenarioId} refused: ${result.reasonCode}`);
    out.push(result.intelligence);
  }
  return out;
}
