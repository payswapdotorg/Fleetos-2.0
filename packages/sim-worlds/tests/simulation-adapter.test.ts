/**
 * @fleetos/sim-worlds — simulation adapter tests (F260A).
 *
 * Bridge fidelity to the @fleetos/simulation kernel: world/scenario
 * mapping, ExperimentalRunOutput carrying the world digest + scenario
 * digest, the EXPERIMENTAL marker law, byte-identical replay, and the
 * A5 self-check (this package NEVER adopts / self-executes).
 */

import { describe, expect, it } from "vitest";
import { assertNoAdoptFunction, isExperimental } from "@fleetos/simulation";
import {
  canonicalRunOutput,
  runFleetWorldSimulation,
  toSimulationScenario,
  toSimulationWorld,
} from "../src/simulation-adapter.js";
import type { FaultScenario } from "../src/fault-injection.js";
import { scenarioDigest } from "../src/fault-injection.js";
import { worldDigest } from "../src/world-definition.js";
import * as simWorlds from "../src/index.js";
import { baseWorld } from "./helpers.js";

const scenario: FaultScenario = {
  scenarioId: "scen-adapter",
  worldId: "world-test",
  tenantId: "tenant-a",
  description: "adapter test scenario",
  faults: [
    { kind: "link-outage", linkId: "link-a1-b1", fromStep: 2, untilStep: 4 },
    { kind: "asset-failure", assetId: "asset-alpha", atStep: 3 },
  ],
};

describe("kernel shape mapping", () => {
  it("toSimulationWorld maps the fleet world onto SimulationWorld", () => {
    const w = baseWorld();
    const sim = toSimulationWorld(w);
    expect(sim.worldId).toBe("world-test");
    expect(sim.tenant).toEqual({ tenantId: "tenant-a" });
    expect(sim.version).toBe("v1");
    expect(sim.description).toBe(w.description);
    const init = sim.initialState as Record<string, unknown>;
    expect(init.seed).toBe("seed-alpha");
    expect(init.assets).toEqual(w.assets);
    expect(init.maintenancePolicies).toEqual(w.maintenancePolicies);
  });

  it("toSimulationScenario produces one ordered step per logical step with fault annotations", () => {
    const sim = toSimulationScenario(baseWorld(), scenario, 5);
    expect(sim.scenarioId).toBe("scen-adapter");
    expect(sim.worldId).toBe("world-test");
    expect(sim.tenant).toEqual({ tenantId: "tenant-a" });
    expect(sim.steps).toHaveLength(5);
    expect(sim.steps.map((s) => s.stepId)).toEqual(["step-1", "step-2", "step-3", "step-4", "step-5"]);
    expect(sim.steps.every((s) => s.action === "advance-world" && s.expected === null)).toBe(true);
    expect(sim.steps[0]?.inputs).toEqual({ step: 1, faultsAt: [] });
    expect(sim.steps[1]?.inputs).toEqual({ step: 2, faultsAt: ["link-outage"] });
    expect(sim.steps[2]?.inputs).toEqual({ step: 3, faultsAt: ["link-outage", "asset-failure"] });
    expect(sim.steps[4]?.inputs).toEqual({ step: 5, faultsAt: [] });
  });
});

describe("runFleetWorldSimulation — the experimental-evidence run", () => {
  it("produces an ExperimentalRunOutput carrying both digests", () => {
    const r = runFleetWorldSimulation(baseWorld(), scenario, 12);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const out = r.output;
    expect(out.kind).toBe("EXPERIMENTAL");
    expect(isExperimental(out)).toBe(true);
    expect(out.deterministic).toBe(true);
    expect(out.runId).toBe("run-world-test-scen-adapter");
    expect(out.worldId).toBe("world-test");
    expect(out.tenant).toEqual({ tenantId: "tenant-a" });
    expect(out.result.worldDigest).toBe(worldDigest(baseWorld()));
    expect(out.result.scenarioDigest).toBe(scenarioDigest(scenario));
    expect(out.result.evidenceKind).toBe("EXPERIMENTAL");
    expect(out.result.steps).toBe(12);
  });

  it("the summary carries engine facts (events, counts, runtime snapshots)", () => {
    const r = runFleetWorldSimulation(baseWorld(), scenario, 12);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const sum = r.output.result;
    expect(sum.eventCount).toBeGreaterThan(0);
    expect(sum.eventCountsByKind["step-advanced"]).toBe(12);
    expect(sum.assets).toHaveLength(2);
    expect(sum.devices).toHaveLength(2);
    expect(sum.links).toHaveLength(1);
    expect(sum.finalStep).toBe(12);
  });

  it("is byte-identical on replay (same inputs, same output)", () => {
    const a = runFleetWorldSimulation(baseWorld(), scenario, 12, "2026-10-08T00:00:00.000Z", "2026-10-08T00:01:00.000Z");
    const b = runFleetWorldSimulation(baseWorld(), scenario, 12, "2026-10-08T00:00:00.000Z", "2026-10-08T00:01:00.000Z");
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(canonicalRunOutput(b.output)).toBe(canonicalRunOutput(a.output));
  });

  it("respects caller-supplied logical timestamps", () => {
    const r = runFleetWorldSimulation(baseWorld(), scenario, 2, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:10.000Z");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.output.startedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(r.output.endedAt).toBe("2026-01-01T00:00:10.000Z");
  });
});

describe("runFleetWorldSimulation — fail-closed refusals", () => {
  it("refuses an invalid world", () => {
    const r = runFleetWorldSimulation(baseWorld({ assets: [] }), scenario, 5);
    expect(r).toMatchObject({ ok: false, reason: "invalid-world" });
  });

  it("refuses a cross-tenant scenario (world+scenario tenant law)", () => {
    const cross: FaultScenario = { ...scenario, tenantId: "tenant-b" };
    const r = runFleetWorldSimulation(baseWorld(), cross, 5);
    expect(r).toMatchObject({ ok: false, reason: "scenario-tenant-mismatch" });
  });

  it("refuses a cross-world scenario", () => {
    const cross: FaultScenario = { ...scenario, worldId: "world-other" };
    const r = runFleetWorldSimulation(baseWorld(), cross, 5);
    expect(r).toMatchObject({ ok: false, reason: "scenario-world-mismatch" });
  });

  it("refuses an invalid scenario and invalid step counts", () => {
    const invalid: FaultScenario = { ...scenario, faults: [{ kind: "asset-failure", assetId: "asset-ghost", atStep: 1 }] };
    expect(runFleetWorldSimulation(baseWorld(), invalid, 5)).toMatchObject({ ok: false, reason: "invalid-scenario" });
    expect(runFleetWorldSimulation(baseWorld(), scenario, -3)).toMatchObject({ ok: false, reason: "invalid-step-count" });
  });

  it("steps=0 is a valid no-op run (empty journal)", () => {
    const r = runFleetWorldSimulation(baseWorld(), scenario, 0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.output.result.eventCount).toBe(0);
    expect(r.output.result.finalStep).toBe(0);
  });
});

describe("A5 law — this package never adopts, never self-executes", () => {
  it("exports no adopt/execute/activate/install/selfAdopt function (kernel-checked)", () => {
    const check = assertNoAdoptFunction(simWorlds as unknown as Record<string, unknown>);
    expect(check.ok).toBe(true);
    expect(check.forbidden).toEqual([]);
  });
});
