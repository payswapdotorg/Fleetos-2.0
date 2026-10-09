/**
 * @fleetos/acceptance-convergence — per-industry convergence scenarios
 * (`./scenarios`, Wave 9 TL lane F291).
 *
 * Assembles one deterministic convergence scenario per REAL F290C industry
 * archetype: the REAL archetype org (roles + budget envelopes through the
 * REAL optimization policies — `policyForArchetype` +
 * `applyPolicyWithGuard`), a scenario asset fleet carrying REAL lineage
 * (material lots consumed, versioned methods applied, transformations —
 * built through the REAL F290A lineage builders with the tamper-evident
 * chain), and REAL JEPA forecasts over caller-supplied world-context
 * windows (the family adapters' public `represent`/`predict` seam).
 *
 * Every scenario record carries its REAL artifacts BY REFERENCE + digest
 * (the FNV-1a family) — the scenario NEVER recomputes a lane's output; the
 * digest cites the owning lanes' own digests where they exist
 * (`computeArchetypeDigest`, `materialLotDigest`, `applicationDigest`,
 * the kernel's problem digest, the lineage chain head) and canonical-JSON
 * parts elsewhere. Post-hoc mutation of any referenced artifact is
 * DETECTED by `verifyScenarioDigest` (machine-tested).
 *
 * The record additionally carries the industry's REAL acceptance-family
 * journey applicability (the F271 adoption masks over the REAL corpora)
 * and the composition lineage to the Wave-8 release lane (F281).
 *
 * Pure deterministic TS: no clock, no randomness, no network, no timers.
 */

import { getArchetype, computeArchetypeDigest, type Industry, type IndustryArchetype, type OrgSizeTier, type TenantProfile } from "@fleetos/agent-organizations";
import { makeJepaSpace, JEPA_FAMILY_REGISTRY, type PredictedValue, type WorldModelRepresentation } from "@fleetos/world-model";
import { materialLotDigest, type ManagedAssetRecord, type MaterialLot, type MethodApplication, type MethodDefinition, type LineageGraph, type ObservationLookupPort } from "@fleetos/assets";
import { ACCEPTANCE_RELEASE_SCHEMA_VERSION } from "@fleetos/acceptance-release";
import { digestOf } from "./digest.js";
import {
  DEFAULT_SCENARIO_INDUSTRIES,
  FORECAST_COMPUTED_AT,
  INDUSTRY_SHORT_KEYS,
  NOW_0,
  fleetSizeForTier,
  industryScenarioData,
  type ScenarioWorldWindow,
} from "./scenario-data.js";
import { assembleFleet, type AnchorOutcome, type AssemblyRefusal, type FleetBundle } from "./scenario-fleet.js";
import { assembleOrg, type ScenarioOrg } from "./scenario-org.js";
import { buildJourneyApplicability, type IndustryJourneyApplicability } from "./scenario-acceptance.js";

export type { ScenarioWorldWindow } from "./scenario-data.js";
export type { AnchorOutcome, AssemblyRefusal, FleetBundle } from "./scenario-fleet.js";
export type { CorpusApplicability, CorpusName, IndustryJourneyApplicability } from "./scenario-acceptance.js";
export { adoptionIndustryIdFor, buildJourneyApplicability } from "./scenario-acceptance.js";

// ---------------------------------------------------------------------------
// Types — the scenario record.
// ---------------------------------------------------------------------------

/** One REAL JEPA forecast (the adapter output, carried by reference). */
export interface ScenarioForecast {
  /** The family member that produced it ("jepa.core" | "jepa.masked" | "jepa.rollout"). */
  readonly adapterId: string;
  readonly assetId: string;
  readonly horizon: number;
  readonly windowIndex: number;
  /** The REAL representation (the `represent` seam output). */
  readonly representation: WorldModelRepresentation;
  /** The REAL prediction (the `predict` seam output — interval carried as-is). */
  readonly predicted: PredictedValue<number>;
}

/** The assembled per-industry convergence scenario (REAL artifacts by reference). */
export interface ConvergenceScenario {
  readonly kind: "convergence-scenario";
  readonly scenarioId: string;
  readonly tenantId: string;
  readonly now: number;
  readonly forecastComputedAt: string;
  readonly industry: Industry;
  readonly tier: OrgSizeTier;
  readonly archetype: IndustryArchetype;
  readonly archetypeDigest: string;
  readonly org: ScenarioOrg;
  readonly profile: TenantProfile;
  readonly fleet: readonly ManagedAssetRecord[];
  readonly methodDefinitions: readonly MethodDefinition[];
  readonly applications: readonly MethodApplication[];
  readonly lots: readonly MaterialLot[];
  readonly graph: LineageGraph;
  readonly anchorResults: readonly AnchorOutcome[];
  readonly refusals: readonly AssemblyRefusal[];
  readonly spaceVersion: string;
  readonly forecasts: readonly ScenarioForecast[];
  readonly journeyApplicability: IndustryJourneyApplicability;
  readonly compositionLineage: { readonly releaseSchemaVersion: number };
  readonly scenarioDigest: string;
}

export type ScenarioReasonCode =
  | "TENANT_ID_EMPTY"
  | "UNKNOWN_ARCHETYPE"
  | "INVALID_WORLD"
  | "FLEET_REFUSED"
  | "ORG_POLICY_REFUSED";

export type ScenarioAssemblyResult =
  | { readonly ok: true; readonly scenario: ConvergenceScenario }
  | { readonly ok: false; readonly reasonCode: ScenarioReasonCode; readonly detail: string | null };

/** The caller-supplied world (tenant, logical clock, windows, anchor port). */
export interface ScenarioWorldInput {
  readonly tenantId?: string;
  readonly now?: number;
  readonly forecastComputedAt?: string;
  readonly observationAnchor?: {
    readonly port: ObservationLookupPort;
    readonly observationId: string;
  };
  readonly windows?: readonly ScenarioWorldWindow[];
}

export interface ScenarioInput {
  readonly industry: Industry;
  readonly tier?: OrgSizeTier;
  readonly world?: ScenarioWorldInput;
}

// ---------------------------------------------------------------------------
// Forecasts — the REAL family adapters over the caller-supplied windows.
// ---------------------------------------------------------------------------

function windowFeatures(window: ScenarioWorldWindow): Readonly<Record<string, number>> {
  const features: Record<string, number> = {};
  for (const [name, value] of Object.entries(window.current)) {
    if (typeof value === "number" && Number.isFinite(value)) features[name] = value;
  }
  features["jepa.horizon"] = window.horizon;
  for (const [name, value] of Object.entries(window.prev ?? {})) {
    if (typeof value === "number" && Number.isFinite(value)) features[`jepa.prev.${name}`] = value;
  }
  return features;
}

function buildForecasts(input: {
  readonly tenantId: string;
  readonly computedAt: string;
  readonly fleet: readonly ManagedAssetRecord[];
  readonly windows: readonly ScenarioWorldWindow[];
}): readonly ScenarioForecast[] {
  const space = makeJepaSpace();
  const forecasts: ScenarioForecast[] = [];
  for (const [windowIndex, window] of input.windows.entries()) {
    const asset = input.fleet[window.assetIndex];
    if (asset === undefined) continue;
    const features = windowFeatures(window);
    for (const entry of JEPA_FAMILY_REGISTRY) {
      const adapter = entry.make(space, input.computedAt);
      const representation = adapter.represent({
        tenant: { tenantId: input.tenantId },
        asset: { assetId: asset.id },
        features,
      });
      // The JEPA family decodes number payloads on the seam (machine-tested
      // by the forecast-utilization suite: typeof value === "number").
      const predicted = adapter.predict(representation) as PredictedValue<number>;
      forecasts.push({
        adapterId: entry.id,
        assetId: asset.id,
        horizon: window.horizon,
        windowIndex,
        representation,
        predicted,
      });
    }
  }
  return forecasts;
}

// ---------------------------------------------------------------------------
// Validation — fail-closed on the caller-supplied world.
// ---------------------------------------------------------------------------

function validateWorld(world: ScenarioWorldInput, fleetSize: number): string | null {
  for (const [index, window] of (world.windows ?? []).entries()) {
    if (!Number.isInteger(window.horizon) || window.horizon < 1) {
      return `window[${index}].horizon must be an integer >= 1`;
    }
    if (!Number.isInteger(window.assetIndex) || window.assetIndex < 0 || window.assetIndex >= fleetSize) {
      return `window[${index}].assetIndex ${String(window.assetIndex)} out of fleet range 0..${fleetSize - 1}`;
    }
    if (window.current === null || typeof window.current !== "object") {
      return `window[${index}].current must be a feature map`;
    }
    for (const [name, value] of Object.entries(window.prev ?? {})) {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return `window[${index}].prev.${name} is not a finite number`;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// The digest — over the referenced REAL artifacts (evidence, not recompute).
// ---------------------------------------------------------------------------

function scenarioDigestParts(scenario: Omit<ConvergenceScenario, "scenarioDigest">): object {
  return {
    scenarioId: scenario.scenarioId,
    tenantId: scenario.tenantId,
    now: scenario.now,
    forecastComputedAt: scenario.forecastComputedAt,
    industry: scenario.industry,
    tier: scenario.tier,
    archetypeDigest: scenario.archetypeDigest,
    policyDigest: digestOf("conv-policy", scenario.org.policy as unknown as object),
    organizationId: scenario.org.organizationId,
    // Referenced REAL records digested by CANONICAL CONTENT (the F281
    // convention): post-hoc mutation of any referenced artifact is detected
    // by the digest recompute — the stored lane digests (applicationDigest,
    // the kernel problem digest, the chain head) ride along as fields.
    problem: scenario.org.problem,
    fleet: scenario.fleet,
    methodDefinitions: scenario.methodDefinitions,
    applications: scenario.applications,
    lots: scenario.lots.map((lot) => materialLotDigest(lot)),
    graphEdges: scenario.graph.edges,
    graphHeadDigest: scenario.graph.headDigest,
    graphEdgeCount: scenario.graph.edgeCount,
    anchorResults: scenario.anchorResults,
    refusals: scenario.refusals,
    spaceVersion: scenario.spaceVersion,
    forecasts: scenario.forecasts.map((f) => ({
      adapterId: f.adapterId,
      assetId: f.assetId,
      horizon: f.horizon,
      windowIndex: f.windowIndex,
      representation: f.representation,
      predicted: f.predicted,
    })),
    journeyApplicability: scenario.journeyApplicability,
    profile: {
      sectorSignal: scenario.profile.sectorSignal,
      fleetSize: scenario.profile.fleetSize,
      orgSizeHint: scenario.profile.orgSizeHint ?? null,
      workloadMix: scenario.profile.workloadMix,
    },
    compositionLineage: scenario.compositionLineage,
  };
}

/** Compute the scenario digest over its referenced REAL artifacts. */
export function computeScenarioDigest(scenario: Omit<ConvergenceScenario, "scenarioDigest">): string {
  return digestOf("conv-scenario", scenarioDigestParts(scenario));
}

/** Recompute + compare — false means the presented scenario was tampered. */
export function verifyScenarioDigest(scenario: ConvergenceScenario): boolean {
  return computeScenarioDigest(scenario) === scenario.scenarioDigest;
}

// ---------------------------------------------------------------------------
// Assembly.
// ---------------------------------------------------------------------------

function defaultTenantId(industry: Industry): string {
  return `tnt_conv_${industry}`;
}

/**
 * Assemble one convergence scenario. Fail-closed: empty tenant, unknown
 * archetype, an invalid caller world, or an unexpected REAL lane refusal
 * each refuse with a named reason code (the lane's own code in `detail`).
 */
export function assembleScenario(input: ScenarioInput): ScenarioAssemblyResult {
  const tier: OrgSizeTier = input.tier ?? "medium";
  const archetype = getArchetype(input.industry, tier);
  if (archetype === null) {
    return { ok: false, reasonCode: "UNKNOWN_ARCHETYPE", detail: `${input.industry}/${tier}` };
  }
  const world: ScenarioWorldInput = input.world ?? {};
  const tenantId = world.tenantId ?? defaultTenantId(input.industry);
  if (typeof tenantId !== "string" || tenantId.trim() === "") {
    return { ok: false, reasonCode: "TENANT_ID_EMPTY", detail: null };
  }
  const now = world.now ?? NOW_0;
  const computedAt = world.forecastComputedAt ?? FORECAST_COMPUTED_AT;
  const data = industryScenarioData(input.industry);
  const windows = world.windows ?? data.windows;
  const worldProblem = validateWorld({ ...world, windows }, data.fleetKinds.length);
  if (worldProblem !== null) {
    return { ok: false, reasonCode: "INVALID_WORLD", detail: worldProblem };
  }
  const shortKey = INDUSTRY_SHORT_KEYS[input.industry];

  const fleet = assembleFleet({
    tenantId,
    shortKey,
    fleetKinds: data.fleetKinds,
    now,
    observationAnchor: world.observationAnchor === undefined
      ? undefined
      : { ...world.observationAnchor, applicationId: `app_conv_${shortKey}_insp_0001` },
  });
  if (!fleet.ok) return { ok: false, reasonCode: "FLEET_REFUSED", detail: fleet.detail };
  const bundle: FleetBundle = fleet.bundle;

  const org = assembleOrg({ tenantId, shortKey, archetype, now });
  if (!org.ok) return { ok: false, reasonCode: "ORG_POLICY_REFUSED", detail: org.detail };

  const forecasts = buildForecasts({ tenantId, computedAt, fleet: bundle.fleet, windows });
  const spaceVersion = forecasts.length > 0 ? (forecasts[0] as ScenarioForecast).predicted.provenance.modelVersion : "jepa-1.0.0";

  const base: Omit<ConvergenceScenario, "scenarioDigest"> = {
    kind: "convergence-scenario",
    scenarioId: `conv-${input.industry}-${tier}`,
    tenantId,
    now,
    forecastComputedAt: computedAt,
    industry: input.industry,
    tier,
    archetype,
    archetypeDigest: computeArchetypeDigest(archetype),
    org: org.org,
    profile: {
      sectorSignal: input.industry,
      fleetSize: fleetSizeForTier(tier),
      workloadMix: data.workloadMix,
      orgSizeHint: tier,
      tenantId,
    },
    fleet: bundle.fleet,
    methodDefinitions: bundle.methodDefinitions,
    applications: bundle.applications,
    lots: bundle.lots,
    graph: bundle.graph,
    anchorResults: bundle.anchorResults,
    refusals: bundle.refusals,
    spaceVersion,
    forecasts,
    journeyApplicability: buildJourneyApplicability(input.industry),
    compositionLineage: { releaseSchemaVersion: ACCEPTANCE_RELEASE_SCHEMA_VERSION },
  };
  return { ok: true, scenario: { ...base, scenarioDigest: computeScenarioDigest(base) } };
}

/**
 * Assemble the six default convergence scenarios (one per F290C industry at
 * tier medium). The optional per-industry world builder lets each scenario
 * carry its own caller-supplied windows + observation anchor port.
 */
export function assembleDefaultScenarios(
  worldFor?: (industry: Industry) => ScenarioWorldInput,
): readonly ConvergenceScenario[] {
  const out: ConvergenceScenario[] = [];
  for (const industry of DEFAULT_SCENARIO_INDUSTRIES) {
    const result = assembleScenario({ industry, world: worldFor?.(industry) });
    if (!result.ok) throw new Error(`default scenario ${industry} refused: ${result.reasonCode}:${result.detail ?? ""}`);
    out.push(result.scenario);
  }
  return out;
}
