import type { FleetWorld } from "../src/world-definition.js";
import type { WorldEngineState } from "../src/world-journal.js";

/** Byte-comparable serialization of an engine state (Maps flattened in
 * deterministic key order — worlds are validated sorted). */
export function serializeState(s: WorldEngineState): string {
  return JSON.stringify({
    worldId: s.worldId,
    tenantId: s.tenantId,
    step: s.step,
    seq: s.seq,
    lastDigest: s.lastDigest,
    events: s.events,
    assets: [...s.assets.entries()].sort(([a], [b]) => a.localeCompare(b)),
    devices: [...s.devices.entries()].sort(([a], [b]) => a.localeCompare(b)),
    links: [...s.links.entries()].sort(([a], [b]) => a.localeCompare(b)),
  });
}

export function baseWorld(overrides?: Partial<FleetWorld>): FleetWorld {
  return {
    worldId: "world-test",
    tenantId: "tenant-a",
    version: 1,
    description: "worker-A test world",
    seed: "seed-alpha",
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
    ...overrides,
  };
}
