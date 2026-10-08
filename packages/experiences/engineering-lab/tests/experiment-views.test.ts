/**
 * F261 — experiment console view tests: setup/monitor/outcome views derived
 * from the lanes' REAL outputs (counts + digests equal direct lane calls),
 * EXPERIMENTAL markers structural, fail-closed refusals, digest verify +
 * tamper, determinism.
 */

import { describe, expect, it } from "vitest";
import { toSimulationScenario, summarizeRun } from "@fleetos/sim-worlds";
import {
  buildExperimentSetupView,
  buildRunMonitorView,
  buildRunOutcomeView,
  verifyExperimentViewDigest,
  type RunOutcomeView,
} from "../src/experiment-views.js";
import { guardLabState } from "../src/lab-state.js";
import { LAB_NOW, LAB_TENANT, makeLabState } from "./helpers.js";
import { makeWorldRun } from "./fixtures-sim.js";

const NOW = LAB_NOW;

function slice() {
  const guarded = guardLabState(makeLabState());
  if (!guarded.ok) throw new Error(`fixture slice refused: ${guarded.refused}`);
  return guarded.slice;
}

describe("experiment setup view", () => {
  it("presents the world summary with counts equal the REAL world definition", () => {
    const s = slice();
    const world = s.worlds[0]!;
    const result = buildExperimentSetupView(s, {
      worldId: world.worldId,
      scenarioId: s.worldRuns[0]!.scenario.scenarioId,
      plannedSteps: 6,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.world).toMatchObject({
      worldId: "world-lab-main",
      seed: "seed-lab-alpha",
      timeUnitMs: 1_000,
      counts: {
        assets: world.assets.length,
        devices: world.devices.length,
        links: world.links.length,
        maintenancePolicies: world.maintenancePolicies.length,
        initialHealthPostures: world.initialHealthPostures.length,
      },
    });
    expect(result.view.world.posturesByState).toEqual({ healthy: 2 });
  });

  it("presents the scenario script: all scripted faults with their step windows", () => {
    const result = buildExperimentSetupView(slice(), {
      worldId: "world-lab-main",
      scenarioId: "scenario-lab-1",
      plannedSteps: 6,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.scenario.faults).toEqual([
      { kind: "asset-failure", target: "asset-alpha", atStep: 2, untilStep: null },
      { kind: "link-outage", target: "link-a1-b1", atStep: 3, untilStep: 5 },
      { kind: "maintenance-skip", target: "asset-alpha", atStep: 4, untilStep: null },
    ]);
  });

  it("planned steps equal the REAL toSimulationScenario projection", () => {
    const s = slice();
    const world = s.worlds[0]!;
    const scenario = s.worldRuns[0]!.scenario;
    const real = toSimulationScenario(world, scenario, 6);
    const result = buildExperimentSetupView(s, {
      worldId: world.worldId,
      scenarioId: scenario.scenarioId,
      plannedSteps: 6,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.plannedSteps).toHaveLength(real.steps.length);
    expect(result.view.plannedSteps.map((p) => [p.stepId, p.action, p.step, p.faultsAt])).toEqual(
      real.steps.map((p) => [p.stepId, p.action, p.inputs.step, p.inputs.faultsAt]),
    );
  });

  it("refuses unknown world / unknown scenario with exact codes", () => {
    const s = slice();
    expect(
      buildExperimentSetupView(s, { worldId: "world-nope", scenarioId: "scenario-lab-1", plannedSteps: 6, now: NOW }),
    ).toMatchObject({ ok: false, refused: "unknown-world" });
    expect(
      buildExperimentSetupView(s, { worldId: "world-lab-main", scenarioId: "scenario-nope", plannedSteps: 6, now: NOW }),
    ).toMatchObject({ ok: false, refused: "unknown-scenario" });
    expect(
      buildExperimentSetupView(s, { worldId: "world-lab-main", scenarioId: "scenario-lab-1", plannedSteps: -1, now: NOW }),
    ).toMatchObject({ ok: false, refused: "invalid-planned-steps" });
  });

  it("refuses a cross-tenant slice, surfacing the guard's own code verbatim", () => {
    const bad = makeLabState();
    const world = { ...bad.worlds[0]!, tenantId: "tenant-other" };
    const result = buildExperimentSetupView({ ...bad, worlds: [world] }, {
      worldId: "world-lab-main",
      scenarioId: "scenario-lab-1",
      plannedSteps: 6,
      now: NOW,
    });
    expect(result).toMatchObject({ ok: false, refused: "lab-state-refused", guardCode: "cross-tenant-ref" });
  });

  it("digest verifies and detects tampering; byte-identical determinism", () => {
    const a = buildExperimentSetupView(slice(), {
      worldId: "world-lab-main",
      scenarioId: "scenario-lab-1",
      plannedSteps: 6,
      now: NOW,
    });
    const b = buildExperimentSetupView(slice(), {
      worldId: "world-lab-main",
      scenarioId: "scenario-lab-1",
      plannedSteps: 6,
      now: NOW,
    });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(JSON.stringify(a.view)).toBe(JSON.stringify(b.view));
    expect(verifyExperimentViewDigest(a.view)).toBe(true);
    const tampered = { ...a.view, asOf: a.view.asOf + 1 };
    expect(verifyExperimentViewDigest(tampered)).toBe(false);
  });
});

describe("run monitor view", () => {
  it("timeline equals the REAL journal; counts equal the REAL run summary", () => {
    const s = slice();
    const run = s.worldRuns[0]!;
    const result = buildRunMonitorView(s, { runId: run.output.runId, now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.timeline).toHaveLength(run.events.length);
    expect(result.view.timeline.map((t) => [t.seq, t.step, t.kind, t.digest])).toEqual(
      run.events.map((e) => [e.seq, e.step, e.kind, e.digest]),
    );
    // The counts are VERBATIM from the REAL output (never recomputed here).
    expect(result.view.eventCountsByKind).toEqual(run.output.result.eventCountsByKind);
    // And they equal a DIRECT call to the lane's REAL summarizeRun.
    const direct = makeWorldRun(6, LAB_TENANT);
    const summary = summarizeRun(direct.world, direct.scenario, 6, direct.state, direct.events);
    expect(result.view.eventCountsByKind).toEqual(summary.eventCountsByKind);
    expect(result.view.eventCount).toBe(summary.eventCount);
  });

  it("presents checkpoint visibility with the lane's resume-equivalence law", () => {
    const s = slice();
    const result = buildRunMonitorView(s, {
      runId: s.worldRuns[0]!.output.runId,
      now: NOW,
      checkpointEvery: 5,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.checkpoints.length).toBeGreaterThan(0);
    expect(result.view.checkpoints.every((c) => c.resumesIdentically)).toBe(true);
    expect(result.view.journalHeadDigest).toBe(s.worldRuns[0]!.output.result.lastEventDigest);
  });

  it("refuses unknown runs and invalid checkpoint intervals", () => {
    const s = slice();
    expect(buildRunMonitorView(s, { runId: "run-nope", now: NOW })).toMatchObject({
      ok: false,
      refused: "unknown-run",
    });
    expect(
      buildRunMonitorView(s, { runId: s.worldRuns[0]!.output.runId, now: NOW, checkpointEvery: 0 }),
    ).toMatchObject({ ok: false, refused: "invalid-checkpoint-interval" });
  });

  it("digest verifies and detects tampering", () => {
    const s = slice();
    const result = buildRunMonitorView(s, { runId: s.worldRuns[0]!.output.runId, now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(verifyExperimentViewDigest(result.view)).toBe(true);
    const tampered = {
      ...result.view,
      eventCountsByKind: { ...result.view.eventCountsByKind, "step-advanced": 0 },
    };
    expect(verifyExperimentViewDigest(tampered)).toBe(false);
  });
});

describe("run outcome view", () => {
  it("presents the EXPERIMENTAL output verbatim (markers, digests, results)", () => {
    const s = slice();
    const run = s.worldRuns[0]!;
    const result = buildRunOutcomeView(s, { runId: run.output.runId, now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const view = result.view;
    expect(view.kind).toBe("EXPERIMENTAL");
    expect(view.experimental).toBe(true);
    expect(view.deterministic).toBe(true);
    expect(view.runId).toBe(run.output.runId);
    expect(view.startedAt).toBe(run.output.startedAt);
    expect(view.endedAt).toBe(run.output.endedAt);
    expect(view.worldDigest).toBe(run.output.result.worldDigest);
    expect(view.scenarioDigest).toBe(run.output.result.scenarioDigest);
    expect(view.steps).toBe(run.output.result.steps);
    expect(view.finalStep).toBe(run.output.result.finalStep);
    expect(view.assets).toEqual(run.output.result.assets);
    expect(view.devices).toEqual(run.output.result.devices);
    expect(view.links).toEqual(run.output.result.links);
  });

  it("carries the EXPERIMENTAL marker STRUCTURALLY (type-level proof)", () => {
    // @ts-expect-error — an OBSERVED claim is not assignable to the EXPERIMENTAL literal
    const observed: RunOutcomeView["kind"] = "OBSERVED";
    expect(observed).toBe("OBSERVED");
  });

  it("refuses unknown runs; digest verifies and detects tampering", () => {
    const s = slice();
    expect(buildRunOutcomeView(s, { runId: "run-nope", now: NOW })).toMatchObject({
      ok: false,
      refused: "unknown-run",
    });
    const result = buildRunOutcomeView(s, { runId: s.worldRuns[0]!.output.runId, now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(verifyExperimentViewDigest(result.view)).toBe(true);
    const tampered = { ...result.view, eventCount: result.view.eventCount + 1 };
    expect(verifyExperimentViewDigest(tampered)).toBe(false);
  });
});

// (No local stubs: every comparison above binds the lanes' REAL functions.)
