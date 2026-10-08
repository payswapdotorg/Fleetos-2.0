/**
 * @fleetos/acceptance-field — shared deterministic journey fixtures.
 *
 * Fixed tenants, actors, ids, logical times, and the two simulation worlds
 * (+ their fault scenarios) the journeys drive. All values are constants —
 * the corpus is byte-identical on every run.
 */

import type { FleetWorld } from "@fleetos/sim-worlds";
import type { FaultScenario } from "@fleetos/sim-worlds";

// ---------------------------------------------------------------------------
// Fixed vocabulary (tenant / actors / logical clock).
// ---------------------------------------------------------------------------

export const TENANT = "tnt_field-accept-01";
export const FOREIGN_TENANT = "tnt_other-operator-9";
export const OPERATOR = "act_operator-ada-01";
export const TECHNICIAN = "act_tech-tomas-01";
export const EDGE_ACTOR = "act_edge-edda-01";
export const ACTOR_IDS = { OPERATOR, TECHNICIAN, EDGE_ACTOR } as const;

/** Base logical time for the whole corpus (fixed epoch-ms — never a clock). */
export const T0 = 1_774_000_000_000;
export const FRESH_MS = 10_000;
export const STALE_MS = 120_000;
export const UNKNOWN_MS = 400_000;

// ---------------------------------------------------------------------------
// Asset / device identities used across journeys.
// ---------------------------------------------------------------------------

export const AST_TRUCK = "ast_truck-alpha-01";
export const AST_TRAILER = "ast_trailer-beta-02";
export const DEV_TELEMETRY = "dev_telem-1001";
export const DEV_GATEWAY = "dev_gate-2002";
export const DEV_MISSION = "dev_mission-relay-7";
export const DEV_SIM_A = "dev_sim-thermo-a1";
export const DEV_SIM_B = "dev_sim-flow-b2";

// ---------------------------------------------------------------------------
// Simulation worlds (valid against @fleetos/sim-worlds' fail-closed
// validateWorld — arrays id-sorted, integer bps rates in [1,10000]).
// ---------------------------------------------------------------------------

export const FIELD_LAB_WORLD: FleetWorld = {
  worldId: "world_field-lab-01",
  tenantId: TENANT,
  version: 1,
  description: "Acceptance field lab: two assets, jittered telemetry, a fault stream, a lab link.",
  seed: "field-lab-seed-01",
  timeUnitMs: 1_000,
  healthPolicy: { downAfterSteps: 3, recoveryGraceSteps: 2 },
  assets: [
    { assetId: "ast_lab-alpha", assetClass: "pump", failureRateBps: 1 },
    { assetId: "ast_lab-beta", assetClass: "valve", failureRateBps: 1 },
  ],
  devices: [
    {
      deviceId: DEV_SIM_B,
      assetId: "ast_lab-beta",
      dropoutBps: 1,
      emitEverySteps: 2,
      streams: [{ kind: "telemetry.flow", unit: "lpm", baseValue: 120, jitterMinOffset: -5, jitterMaxOffset: 5 }],
    },
    {
      deviceId: DEV_SIM_A,
      assetId: "ast_lab-alpha",
      dropoutBps: 1,
      emitEverySteps: 1,
      streams: [
        { kind: "telemetry.temp", unit: "C", baseValue: 40, jitterMinOffset: -2, jitterMaxOffset: 2 },
        { kind: "event.fault", unit: "code", baseValue: 7, jitterMinOffset: 0, jitterMaxOffset: 0 },
      ],
    },
  ],
  links: [{ linkId: "lnk_lab-a-b", endpoints: [DEV_SIM_A, DEV_SIM_B], uptimeBps: 9_999 }],
  maintenancePolicies: [
    {
      policyId: "pol_lab-alpha",
      assetId: "ast_lab-alpha",
      windowEverySteps: 10,
      windowLengthSteps: 3,
      serviceLevel: "expedited",
      mtbfSteps: 50,
    },
  ],
  initialHealthPostures: [
    { assetId: "ast_lab-alpha", posture: "healthy" },
    { assetId: "ast_lab-beta", posture: "healthy" },
  ],
};

export const FIELD_LAB_SCENARIO: FaultScenario = {
  scenarioId: "scn_field-lab-pumpfail",
  worldId: FIELD_LAB_WORLD.worldId,
  tenantId: TENANT,
  description: "The lab pump fails at step 4; the lab link drops for steps 6..8.",
  faults: [
    { kind: "asset-failure", assetId: "ast_lab-alpha", atStep: 4 },
    { kind: "link-outage", linkId: "lnk_lab-a-b", fromStep: 6, untilStep: 9 },
  ],
};

export const WORLDS: ReadonlyArray<FleetWorld> = [FIELD_LAB_WORLD];
export const SCENARIOS: ReadonlyArray<FaultScenario> = [FIELD_LAB_SCENARIO];

export function findWorld(worldId: string): FleetWorld | null {
  return WORLDS.find((w) => w.worldId === worldId) ?? null;
}

export function findScenario(scenarioId: string): FaultScenario | null {
  return SCENARIOS.find((s) => s.scenarioId === scenarioId) ?? null;
}

/** Deterministic JSON payload encoder for observation ingestion (UTF-8 bytes). */
export function encodePayload(payload: Readonly<Record<string, unknown>>): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(payload));
}
