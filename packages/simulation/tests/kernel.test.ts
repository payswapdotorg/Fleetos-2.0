/**
 * Simulation kernel tests — adoption proposals, degraded states, no-adopt.
 *
 * Wave 1 (F210B) additions.
 */
import { describe, it, expect } from "vitest";
import {
  runSimulationWithDegradation,
  generateSimulationAdoptionProposal,
  isSimulationAdoptionProposal,
  assertNoAdoptFunction,
} from "../src/index.ts";
import type { SimulationWorld, SimulationScenario, TenantScopeLike } from "../src/index.ts";

const tenant: TenantScopeLike = { tenantId: "t1" };

function makeWorld(): SimulationWorld {
  return {
    worldId: "w1",
    tenant,
    version: "1.0.0",
    initialState: { count: 0 },
    description: "test world",
  };
}

function makeScenario(): SimulationScenario {
  return {
    scenarioId: "s1",
    worldId: "w1",
    tenant,
    steps: [{ stepId: "step-1", action: "increment", inputs: { by: 1 }, expected: { count: 1 } }],
    description: "test scenario",
  };
}

// ---------- runSimulationWithDegradation ----------

describe("runSimulationWithDegradation", () => {
  it("returns ok=true with output when everything is OK", () => {
    const result = runSimulationWithDegradation(
      makeWorld(),
      makeScenario(),
      (world, scenario) => ({ steps: scenario.steps.length, initial: world.initialState }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output.kind).toBe("EXPERIMENTAL");
      expect(result.output.runId).toContain("w1");
    }
  });

  it("returns degraded=world_not_found when world is null", () => {
    const result = runSimulationWithDegradation(null, makeScenario(), () => ({}));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.degraded).toBe("world_not_found");
    }
  });

  it("returns degraded=scenario_tenant_mismatch", () => {
    const wrongTenantScenario: SimulationScenario = {
      ...makeScenario(),
      tenant: { tenantId: "WRONG" },
    };
    const result = runSimulationWithDegradation(makeWorld(), wrongTenantScenario, () => ({}));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.degraded).toBe("scenario_tenant_mismatch");
    }
  });

  it("returns degraded=empty_scenario when scenario has no steps", () => {
    const emptyScenario: SimulationScenario = {
      ...makeScenario(),
      steps: [],
    };
    const result = runSimulationWithDegradation(makeWorld(), emptyScenario, () => ({}));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.degraded).toBe("empty_scenario");
    }
  });

  it("returns degraded=runner_unavailable when runner is null", () => {
    const result = runSimulationWithDegradation(makeWorld(), makeScenario(), null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.degraded).toBe("runner_unavailable");
    }
  });
});

// ---------- generateSimulationAdoptionProposal ----------

describe("generateSimulationAdoptionProposal", () => {
  it("generates a proposal with kind SIMULATION_ADOPTION_PROPOSAL", () => {
    const proposal = generateSimulationAdoptionProposal(
      tenant, "w1", ["run-1", "run-2"], "good results", "2026-01-01T00:00:00.000Z",
    );
    expect(proposal.kind).toBe("SIMULATION_ADOPTION_PROPOSAL");
    expect(proposal.proposalId).toContain("sim-prop-w1");
    expect(proposal.runIds).toEqual(["run-1", "run-2"]);
  });

  it("is deterministic — same inputs => same proposalId", () => {
    const p1 = generateSimulationAdoptionProposal(tenant, "w1", ["run-1", "run-2"], "test", "t");
    const p2 = generateSimulationAdoptionProposal(tenant, "w1", ["run-1", "run-2"], "test", "t");
    expect(p1.proposalId).toBe(p2.proposalId);
  });

  it("isSimulationAdoptionProposal guard works", () => {
    const proposal = generateSimulationAdoptionProposal(tenant, "w1", ["run-1"], "test", "t");
    expect(isSimulationAdoptionProposal(proposal)).toBe(true);
    expect(isSimulationAdoptionProposal({ kind: "WRONG" })).toBe(false);
    expect(isSimulationAdoptionProposal(null)).toBe(false);
  });
});

// ---------- assertNoAdoptFunction ----------

describe("assertNoAdoptFunction", () => {
  it("returns ok=true for the simulation module surface", () => {
    const moduleExports = { runSimulation: () => {}, generateSimulationAdoptionProposal: () => {} };
    const probe = assertNoAdoptFunction(moduleExports);
    expect(probe.ok).toBe(true);
  });

  it("catches a forbidden 'adopt' function", () => {
    const badExports = { adopt: () => {} };
    const probe = assertNoAdoptFunction(badExports);
    expect(probe.ok).toBe(false);
    expect(probe.forbidden).toContain("adopt");
  });
});
