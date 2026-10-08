/**
 * @fleetos/sim-worlds — bridge to the @fleetos/simulation kernel (F260A).
 *
 * Maps a fleet world + fault scenario onto the EXISTING simulation
 * kernel's public shapes (`SimulationWorld` / `SimulationScenario`) and
 * runs the world engine through `runSimulation`, producing an
 * `ExperimentalRunOutput` that carries the world digest + the scenario
 * digest in its result.
 *
 * Law A5: simulation proposals NEVER self-execute — this package NEVER
 * adopts anything; adoption stays in @fleetos/simulation's proposal
 * path (which itself only proposes). Law A11: every output here is
 * EXPERIMENTAL EVIDENCE ONLY — never operational truth; the run output
 * carries the kernel's `"EXPERIMENTAL"` kind and the summary repeats
 * `evidenceKind: "EXPERIMENTAL"` inside the result payload.
 *
 * Tenant fail-closed: the world is validated and the scenario's
 * worldId/tenant must match before any run; the kernel re-checks both.
 * Pure deterministic TS; caller-supplied logical timestamps.
 */

import { runSimulation } from "@fleetos/simulation";
import type {
  ExperimentalRunOutput,
  SimulationScenario,
  SimulationStep,
  SimulationWorld,
} from "@fleetos/simulation";
import { scenarioAppliesTo, scenarioDigest, validateFaultScenario } from "./fault-injection.js";
import type { FaultScenario } from "./fault-injection.js";
import { runWorld } from "./world-engine.js";
import type { WorldEvent, WorldEngineState } from "./world-engine.js";
import { canonicalJson } from "./determinism.js";
import { validateWorld, worldDigest } from "./world-definition.js";
import type { FleetWorld } from "./world-definition.js";

// ---------------------------------------------------------------------------
// world + scenario -> kernel shapes
// ---------------------------------------------------------------------------

export function toSimulationWorld(world: FleetWorld): SimulationWorld {
  return {
    worldId: world.worldId,
    tenant: { tenantId: world.tenantId },
    version: `v${String(world.version)}`,
    initialState: {
      seed: world.seed,
      timeUnitMs: world.timeUnitMs,
      healthPolicy: world.healthPolicy,
      assets: world.assets,
      devices: world.devices,
      links: world.links,
      maintenancePolicies: world.maintenancePolicies,
      initialHealthPostures: world.initialHealthPostures,
    },
    description: world.description,
  };
}

/** One SimulationStep per logical step; faults that fire at that step are
 * carried in the step inputs (deterministic, ordered by fault key). */
export function toSimulationScenario(
  world: FleetWorld,
  scenario: FaultScenario,
  steps: number,
): SimulationScenario {
  const simSteps: SimulationStep[] = [];
  for (let step = 1; step <= steps; step++) {
    const faultsAt = scenario.faults
      .filter((f) => (f.kind === "link-outage" ? step >= f.fromStep && step < f.untilStep : f.atStep === step))
      .map((f) => f.kind);
    simSteps.push({
      stepId: `step-${String(step)}`,
      action: "advance-world",
      inputs: { step, faultsAt },
      expected: null,
    });
  }
  return {
    scenarioId: scenario.scenarioId,
    worldId: world.worldId,
    tenant: { tenantId: scenario.tenantId },
    steps: simSteps,
    description: scenario.description,
  };
}

// ---------------------------------------------------------------------------
// Run summary — the engine result mapped for the kernel's `T`.
// ---------------------------------------------------------------------------

export interface FleetWorldRunSummary {
  readonly evidenceKind: "EXPERIMENTAL";
  readonly worldDigest: string;
  readonly scenarioDigest: string;
  readonly steps: number;
  readonly eventCount: number;
  readonly finalStep: number;
  readonly lastEventDigest: string;
  readonly eventCountsByKind: Readonly<Record<string, number>>;
  readonly assets: ReadonlyArray<{ readonly assetId: string; readonly operational: boolean; readonly posture: string }>;
  readonly devices: ReadonlyArray<{ readonly deviceId: string; readonly up: boolean; readonly observationSeq: number }>;
  readonly links: ReadonlyArray<{ readonly linkId: string; readonly up: boolean }>;
}

export function summarizeRun(
  world: FleetWorld,
  scenario: FaultScenario,
  steps: number,
  state: WorldEngineState,
  events: ReadonlyArray<WorldEvent>,
): FleetWorldRunSummary {
  const counts: Record<string, number> = {};
  for (const e of events) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
  return {
    evidenceKind: "EXPERIMENTAL",
    worldDigest: worldDigest(world),
    scenarioDigest: scenarioDigest(scenario),
    steps,
    eventCount: events.length,
    finalStep: state.step,
    lastEventDigest: state.lastDigest,
    eventCountsByKind: counts,
    assets: world.assets.map((a) => {
      const rt = state.assets.get(a.assetId);
      return { assetId: a.assetId, operational: rt?.operational === true, posture: rt?.posture ?? "healthy" };
    }),
    devices: world.devices.map((d) => {
      const rt = state.devices.get(d.deviceId);
      return { deviceId: d.deviceId, up: rt?.up === true, observationSeq: rt?.observationSeq ?? 0 };
    }),
    links: world.links.map((l) => ({ linkId: l.linkId, up: state.links.get(l.linkId)?.up === true })),
  };
}

// ---------------------------------------------------------------------------
// The run — kernel-shaped, fail-closed, experimental-evidence-only.
// ---------------------------------------------------------------------------

export type SimulationAdapterRefusal =
  | "invalid-world"
  | "invalid-scenario"
  | "scenario-world-mismatch"
  | "scenario-tenant-mismatch"
  | "invalid-step-count"
  | "engine-refused";

export type FleetWorldSimulationResult =
  | { readonly ok: true; readonly output: ExperimentalRunOutput<FleetWorldRunSummary> }
  | {
      readonly ok: false;
      readonly reason: SimulationAdapterRefusal;
      readonly detail?: string;
      readonly issues?: ReadonlyArray<{ readonly code: string; readonly ref: string; readonly detail?: string }>;
    };

export function runFleetWorldSimulation(
  world: FleetWorld,
  scenario: FaultScenario,
  steps: number,
  startedAt = "1970-01-01T00:00:00.000Z",
  endedAt = "1970-01-01T00:00:00.000Z",
): FleetWorldSimulationResult {
  const validation = validateWorld(world);
  if (!validation.ok) return { ok: false, reason: "invalid-world", issues: validation.issues };
  const gate = scenarioAppliesTo(scenario, world);
  if (!gate.ok) return { ok: false, reason: gate.reason };
  const sv = validateFaultScenario(scenario, world);
  if (!sv.ok) return { ok: false, reason: "invalid-scenario", issues: sv.issues };
  if (!Number.isInteger(steps) || steps < 0) return { ok: false, reason: "invalid-step-count", detail: `steps=${String(steps)}` };

  const run = runWorld(world, steps, scenario);
  if (!run.ok) {
    return { ok: false, reason: "engine-refused", detail: run.reason, issues: run.issues };
  }

  const simWorld = toSimulationWorld(world);
  const simScenario = toSimulationScenario(world, scenario, steps);
  const output = runSimulation<FleetWorldRunSummary>(
    simWorld,
    simScenario,
    () => summarizeRun(world, scenario, steps, run.state, run.events),
    startedAt,
    endedAt,
  );
  return { ok: true, output };
}

/** Deterministic canonical form of a run output (byte-identical replay
 * check for callers — used by the determinism tests). */
export function canonicalRunOutput(output: ExperimentalRunOutput<FleetWorldRunSummary>): string {
  return canonicalJson(output);
}
