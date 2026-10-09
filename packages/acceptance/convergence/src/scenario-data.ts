/**
 * @fleetos/acceptance-convergence — deterministic per-industry scenario data.
 *
 * The CALLER-SUPPLIED world of each convergence scenario: fleet composition
 * (asset kinds), telemetry windows (the JEPA forecast inputs — the
 * world-context window feature maps), the tenant profile workload mix (the
 * F290C fit-scoring input) and the default model registry for gateway
 * capability matching. All DATA — every number here is either referenced by
 * a REAL surface as caller input or cited from a REAL output downstream;
 * nothing here recomputes a lane's output.
 *
 * The default registry deliberately does NOT carry `grid-balance` (the
 * energy-utilities specialist skill): the capability matcher records the
 * HONEST refusal (`NO_MODEL_MATCHES_REQUIREMENT`) — an explained shortfall,
 * never an invented match.
 *
 * Pure deterministic TS. No clock, no randomness, no network.
 */

import type { Industry, OrgSizeTier } from "@fleetos/agent-organizations";
import type { WorkloadMixEntry } from "@fleetos/agent-organizations";
import type { AssetKind } from "@fleetos/assets";
import type { ModelDescriptor } from "@fleetos/model-gateway";

// ---------------------------------------------------------------------------
// The logical timeline (constants — the lane convention; caller-overridable).
// ---------------------------------------------------------------------------

/** The scenario epoch (the lane's logical `now` anchor). */
export const NOW_0 = 1_774_000_000_000;

/** The JEPA seam's computedAt (caller-supplied ISO string, constant). */
export const FORECAST_COMPUTED_AT = "2026-10-01T00:00:00.000Z";

// ---------------------------------------------------------------------------
// Fleet composition + telemetry windows per industry (deterministic data).
// ---------------------------------------------------------------------------

/** Short id key per industry (stable, used across asset/lot/method ids). */
export const INDUSTRY_SHORT_KEYS: Readonly<Record<Industry, string>> = {
  manufacturing: "mfg",
  logistics: "log",
  "energy-utilities": "enu",
  facilities: "fac",
  "field-services": "flds",
  construction: "con",
};

/** One world-context window: the JEPA forecast input over one fleet asset. */
export interface ScenarioWorldWindow {
  /** Index into the scenario fleet (0-based; validated at assembly). */
  readonly assetIndex: number;
  /** Integer prediction horizon >= 1 (the `jepa.horizon` reserved key). */
  readonly horizon: number;
  /** Previous-frame features (the `jepa.prev.*` rollout seeds). */
  readonly prev?: Readonly<Record<string, number>>;
  /** Current-frame payload features. */
  readonly current: Readonly<Record<string, number>>;
}

/** Deterministic per-industry scenario data (caller-supplied world). */
export interface IndustryScenarioData {
  readonly industry: Industry;
  readonly fleetKinds: readonly AssetKind[];
  readonly windows: readonly ScenarioWorldWindow[];
  readonly workloadMix: readonly WorkloadMixEntry[];
}

const TEACH_MIX = 4000;

function mix(capabilities: readonly [string, number][]): readonly WorkloadMixEntry[] {
  return capabilities.map(([capability, weightBps]) => ({ capability, weightBps }));
}

const INDUSTRY_SCENARIO_DATA: Readonly<Record<Industry, IndustryScenarioData>> = {
  manufacturing: {
    industry: "manufacturing",
    fleetKinds: ["robot", "fixed", "sensor"],
    windows: [
      { assetIndex: 0, horizon: 4, prev: { temperature: 71.5, vibration: 3.2 }, current: { temperature: 74.1, vibration: 3.6 } },
      { assetIndex: 1, horizon: 6, prev: { utilization: 0.62, temperature: 69 }, current: { utilization: 0.68, temperature: 71.2 } },
    ],
    workloadMix: mix([
      ["model_invoke", TEACH_MIX],
      ["analyze-telemetry", 3000],
      ["forecast", 2000],
      ["schedule", 1000],
    ]),
  },
  logistics: {
    industry: "logistics",
    fleetKinds: ["vehicle", "handheld", "vehicle"],
    windows: [
      { assetIndex: 0, horizon: 3, prev: { utilization: 0.55, temperature: 61 }, current: { utilization: 0.63, temperature: 64 } },
      { assetIndex: 1, horizon: 5, prev: { pressure: 2.1, temperature: 58.5 }, current: { pressure: 2.4, temperature: 60.1 } },
    ],
    workloadMix: mix([
      ["model_invoke", TEACH_MIX],
      ["route-opt", 2500],
      ["forecast", 2000],
      ["dispatch", 1500],
    ]),
  },
  "energy-utilities": {
    industry: "energy-utilities",
    fleetKinds: ["fixed", "sensor", "fixed"],
    windows: [
      { assetIndex: 0, horizon: 6, prev: { utilization: 0.81, pressure: 4.2 }, current: { utilization: 0.86, pressure: 4.35 } },
      { assetIndex: 1, horizon: 8, prev: { temperature: 44.2, vibration: 1.1 }, current: { temperature: 45.6, vibration: 1.2 } },
    ],
    workloadMix: mix([
      ["model_invoke", TEACH_MIX],
      ["analyze-telemetry", 3000],
      ["grid-balance", 2000],
      ["forecast", 1000],
    ]),
  },
  facilities: {
    industry: "facilities",
    fleetKinds: ["fixed", "fixed", "sensor"],
    windows: [
      { assetIndex: 0, horizon: 3, prev: { utilization: 0.41, temperature: 22.5 }, current: { utilization: 0.44, temperature: 23.1 } },
      { assetIndex: 1, horizon: 5, prev: { pressure: 1.8, temperature: 21.2 }, current: { pressure: 1.9, temperature: 21.8 } },
    ],
    workloadMix: mix([
      ["model_invoke", TEACH_MIX],
      ["schedule", 3000],
      ["summarize", 2000],
      ["forecast", 1000],
    ]),
  },
  "field-services": {
    industry: "field-services",
    fleetKinds: ["vehicle", "handheld", "vehicle"],
    windows: [
      { assetIndex: 0, horizon: 5, prev: { utilization: 0.72, temperature: 66.5 }, current: { utilization: 0.78, temperature: 68.2 } },
      { assetIndex: 1, horizon: 7, prev: { pressure: 2.9, vibration: 2.4 }, current: { pressure: 3.05, vibration: 2.5 } },
    ],
    workloadMix: mix([
      ["model_invoke", TEACH_MIX],
      ["dispatch", 3000],
      ["route-opt", 2000],
      ["summarize", 1000],
    ]),
  },
  construction: {
    industry: "construction",
    fleetKinds: ["vehicle", "fixed", "handheld"],
    windows: [
      { assetIndex: 0, horizon: 7, prev: { utilization: 0.58, vibration: 4.1 }, current: { utilization: 0.61, vibration: 4.4 } },
      { assetIndex: 1, horizon: 9, prev: { temperature: 33.5, pressure: 2.6 }, current: { temperature: 34.8, pressure: 2.7 } },
    ],
    workloadMix: mix([
      ["model_invoke", TEACH_MIX],
      ["schedule", 3000],
      ["forecast", 2000],
      ["route-opt", 1000],
    ]),
  },
};

/** The six default convergence industries (one scenario each, tier medium). */
export const DEFAULT_SCENARIO_INDUSTRIES: readonly Industry[] = [
  "manufacturing",
  "logistics",
  "energy-utilities",
  "facilities",
  "field-services",
  "construction",
];

export function industryScenarioData(industry: Industry): IndustryScenarioData {
  return INDUSTRY_SCENARIO_DATA[industry];
}

// ---------------------------------------------------------------------------
// Fleet size per tier (tier-consistent with the F290C fleetSizeToTier map).
// ---------------------------------------------------------------------------

const FLEET_SIZE_BY_TIER: Readonly<Record<OrgSizeTier, number>> = {
  small: 20,
  medium: 200,
  large: 800,
};

export function fleetSizeForTier(tier: OrgSizeTier): number {
  return FLEET_SIZE_BY_TIER[tier];
}

// ---------------------------------------------------------------------------
// The default model registry (deterministic; no `grid-balance` — honest).
// ---------------------------------------------------------------------------

/**
 * The documented default registry for capability matching: one model option
 * per industry skill family. `grid-balance` is deliberately absent — the
 * REAL matcher records the honest refusal and the rollup carries it as an
 * explained shortfall (never an invented match).
 */
export const DEFAULT_INDUSTRY_MODEL_REGISTRY: readonly ModelDescriptor[] = [
  { id: "mdl-invoke", providerId: "p-conv", capabilityTags: ["model_invoke"], costPerUnitMinor: 20, maxContextUnits: 100000 },
  { id: "mdl-telemetry", providerId: "p-conv", capabilityTags: ["model_invoke", "analyze-telemetry"], costPerUnitMinor: 35, maxContextUnits: 120000 },
  { id: "mdl-forecast", providerId: "p-conv", capabilityTags: ["model_invoke", "forecast"], costPerUnitMinor: 40, maxContextUnits: 200000 },
  { id: "mdl-routing", providerId: "p-conv", capabilityTags: ["model_invoke", "route-opt"], costPerUnitMinor: 30, maxContextUnits: 100000 },
  { id: "mdl-schedule", providerId: "p-conv", capabilityTags: ["model_invoke", "schedule"], costPerUnitMinor: 25, maxContextUnits: 80000 },
  { id: "mdl-summarize", providerId: "p-conv", capabilityTags: ["model_invoke", "summarize"], costPerUnitMinor: 15, maxContextUnits: 60000 },
  { id: "mdl-dispatch", providerId: "p-conv", capabilityTags: ["model_invoke", "dispatch"], costPerUnitMinor: 22, maxContextUnits: 90000 },
];
