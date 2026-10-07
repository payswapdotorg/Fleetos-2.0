import { describe, it, expect } from "vitest";
import {
  buildComparison,
  isExperimental,
  runSimulation,
  type SimulationScenario,
  type SimulationWorld,
  type TenantScopeLike,
} from "../src/index.ts";

const tenant: TenantScopeLike = { tenantId: "t1" };

function world(): SimulationWorld {
  return {
    worldId: "w1",
    tenant,
    version: "1.0.0",
    initialState: { counter: 0 },
    description: "test world",
  };
}

function scenario(): SimulationScenario {
  return {
    scenarioId: "s1",
    worldId: "w1",
    tenant,
    steps: [
      { stepId: "step-0", action: "increment", inputs: { by: 1 }, expected: { counter: 1 } },
    ],
    description: "increment counter",
  };
}

describe("runSimulation: determinism", () => {
  it("produces identical outputs for identical inputs", () => {
    const runner = (w: SimulationWorld, s: SimulationScenario) => ({
      finalCounter: (w.initialState.counter as number) + s.steps.length,
    });
    const a = runSimulation(world(), scenario(), runner);
    const b = runSimulation(world(), scenario(), runner);
    expect(a).toEqual(b);
  });

  it("returns an EXPERIMENTAL output (not OBSERVED, not PREDICTED)", () => {
    const runner = () => 42;
    const out = runSimulation(world(), scenario(), runner);
    expect(out.kind).toBe("EXPERIMENTAL");
    expect(out.result).toBe(42);
  });
});

describe("runSimulation: tenant fail-closed", () => {
  it("throws when scenario.tenant != world.tenant", () => {
    const w = world();
    const s: SimulationScenario = { ...scenario(), tenant: { tenantId: "t2" } };
    expect(() => runSimulation(w, s, () => 0)).toThrow();
  });

  it("throws when scenario.worldId != world.worldId", () => {
    const w = world();
    const s: SimulationScenario = { ...scenario(), worldId: "w2" };
    expect(() => runSimulation(w, s, () => 0)).toThrow();
  });
});

describe("A11 extended: EXPERIMENTAL type distinctness", () => {
  it("EXPERIMENTAL outputs are not assignable to PredictedValue or HypotheticalValue", () => {
    const out = runSimulation(world(), scenario(), () => 0);
    // Compile-time: out.kind is "EXPERIMENTAL", incompatible with { kind: "PREDICTED" }.
    // @ts-expect-error — EXPERIMENTAL is not PREDICTED
    const _badPred: { kind: "PREDICTED" } = out;
    // @ts-expect-error — EXPERIMENTAL is not HYPOTHETICAL
    const _badHyp: { kind: "HYPOTHETICAL" } = out;
    void _badPred; void _badHyp;
  });
});

describe("isExperimental runtime guard", () => {
  it("returns true for an actual experimental output", () => {
    const out = runSimulation(world(), scenario(), () => 0);
    expect(isExperimental(out)).toBe(true);
  });

  it("returns false for a foreign-shaped object", () => {
    expect(isExperimental({ kind: "OBSERVED" })).toBe(false);
    expect(isExperimental(null)).toBe(false);
    expect(isExperimental(42)).toBe(false);
  });
});

describe("buildComparison", () => {
  it("produces a stable comparisonId for the same run set", () => {
    const a = buildComparison(["r1", "r2"], "accuracy");
    const b = buildComparison(["r2", "r1"], "accuracy");
    expect(a.comparisonId).toBe(b.comparisonId);
  });

  it("differs for different run sets", () => {
    const a = buildComparison(["r1", "r2"], "accuracy");
    const b = buildComparison(["r1", "r3"], "accuracy");
    expect(a.comparisonId).not.toBe(b.comparisonId);
  });
});

describe("simulation outputs never authoritative", () => {
  it("outputs carry deterministic=true marker (reference path)", () => {
    const out = runSimulation(world(), scenario(), () => 0);
    expect(out.deterministic).toBe(true);
  });
});
