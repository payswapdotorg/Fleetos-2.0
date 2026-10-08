/**
 * F261 lab test fixtures — the sim-worlds lane (deterministic, REAL
 * machinery only). The world is accepted by the lane's OWN
 * `validateWorld`; the scenario by `validateFaultScenario`; runs come
 * from the REAL `runWorld` + `runFleetWorldSimulation`. Logical `now`
 * everywhere; no clock, no randomness.
 */

import type { FaultScenario, FleetWorld, WorldEvent, FleetWorldRunSummary } from "@fleetos/sim-worlds";
import { runFleetWorldSimulation, runWorld } from "@fleetos/sim-worlds";
import type { ExperimentalRunOutput } from "@fleetos/simulation";

export const LAB_TENANT = "lab-tenant-1";
export const LAB_NOW = 1_700_000_000_000;
export const COMPUTED_AT = "2026-10-12T00:00:00.000Z";

export function makeWorld(tenantId: string = LAB_TENANT, worldId: string = "world-lab-main"): FleetWorld {
  return {
    worldId,
    tenantId,
    version: 1,
    description: "F261 engineering-lab fixture world",
    seed: "seed-lab-alpha",
    timeUnitMs: 1_000,
    healthPolicy: { downAfterSteps: 3, recoveryGraceSteps: 1 },
    assets: [
      { assetId: "asset-alpha", assetClass: "pump", failureRateBps: 1 },
      { assetId: "asset-beta", assetClass: "vehicle", failureRateBps: 1 },
    ],
    devices: [
      {
        deviceId: "dev-alpha-1",
        assetId: "asset-alpha",
        dropoutBps: 1,
        emitEverySteps: 1,
        streams: [
          { kind: "temperature", unit: "C", baseValue: 40, jitterMinOffset: -2, jitterMaxOffset: 2 },
        ],
      },
      {
        deviceId: "dev-beta-1",
        assetId: "asset-beta",
        dropoutBps: 1,
        emitEverySteps: 2,
        streams: [
          { kind: "pressure", unit: "kPa", baseValue: 100, jitterMinOffset: -5, jitterMaxOffset: 5 },
        ],
      },
    ],
    links: [
      { linkId: "link-a1-b1", endpoints: ["dev-alpha-1", "dev-beta-1"], uptimeBps: 9_000 },
    ],
    maintenancePolicies: [
      {
        policyId: "pol-alpha",
        assetId: "asset-alpha",
        windowEverySteps: 5,
        windowLengthSteps: 2,
        serviceLevel: "standard",
        mtbfSteps: 6,
      },
    ],
    initialHealthPostures: [
      { assetId: "asset-alpha", posture: "healthy" },
      { assetId: "asset-beta", posture: "healthy" },
    ],
  };
}

/** Faults sorted by (atStep, kind, target) — the lane's deterministic order. */
export function makeScenario(tenantId: string = LAB_TENANT, worldId: string = "world-lab-main"): FaultScenario {
  return {
    scenarioId: "scenario-lab-1",
    worldId,
    tenantId,
    description: "F261 scripted fault scenario",
    faults: [
      { kind: "asset-failure", assetId: "asset-alpha", atStep: 2 },
      { kind: "link-outage", linkId: "link-a1-b1", fromStep: 3, untilStep: 5 },
      { kind: "maintenance-skip", assetId: "asset-alpha", atStep: 4 },
    ],
  };
}

export interface LabRunFixture {
  readonly world: FleetWorld;
  readonly scenario: FaultScenario;
  readonly events: readonly WorldEvent[];
  readonly state: import("@fleetos/sim-worlds").WorldEngineState;
  readonly output: ExperimentalRunOutput<FleetWorldRunSummary>;
}

/** Drive the REAL engine + adapter for a full experimental run. */
export function makeWorldRun(
  steps = 6,
  tenantId: string = LAB_TENANT,
  worldId: string = "world-lab-main",
): LabRunFixture {
  const world = makeWorld(tenantId, worldId);
  const scenario = makeScenario(tenantId, worldId);
  const run = runWorld(world, steps, scenario);
  if (!run.ok) throw new Error(`fixture run refused: ${run.reason}`);
  const output = runFleetWorldSimulation(world, scenario, steps);
  if (!output.ok) throw new Error(`fixture simulation refused: ${output.reason}`);
  return { world, scenario, events: run.events, state: run.state, output: output.output };
}
