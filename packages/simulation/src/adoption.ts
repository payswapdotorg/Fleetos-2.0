/**
 * @fleetos/simulation — Adoption proposal generation + degraded states.
 *
 * Wave 1 (F210B) additions:
 *   - Adoption PROPOSAL generation from simulation experimental runs (proposals only)
 *   - Honest degraded states for simulation runs
 *
 * Law A5: simulation proposals NEVER self-execute. The Guardian path adopts.
 * Law A11 extended: EXPERIMENTAL outputs remain experimental evidence.
 *
 * Pure types + pure functions.
 */

import type {
  SimulationWorld,
  SimulationScenario,
  ExperimentalRunOutput,
  TenantScopeLike,
} from "./index.ts";
import { runSimulation } from "./index.ts";

/** Simulation degraded state — honest, machine-stable. */
export type SimulationDegradedState =
  | "world_not_found"
  | "scenario_tenant_mismatch"
  | "empty_scenario"
  | "runner_unavailable";

/** A simulation result — either a run output or a degraded state. */
export type SimulationResult<T = unknown> =
  | { readonly ok: true; readonly output: ExperimentalRunOutput<T> }
  | { readonly ok: false; readonly degraded: SimulationDegradedState; readonly reason: string };

/**
 * Run a simulation with honest degraded states.
 *
 * Returns a SimulationResult — either a run output or a degraded state.
 * Degraded states: world_not_found, scenario_tenant_mismatch, empty_scenario,
 * runner_unavailable.
 *
 * Deterministic + honest.
 */
export function runSimulationWithDegradation<T = unknown>(
  world: SimulationWorld | null,
  scenario: SimulationScenario,
  runner: ((world: SimulationWorld, scenario: SimulationScenario) => T) | null,
  startedAt: string = "1970-01-01T00:00:00.000Z",
  endedAt: string = "1970-01-01T00:00:00.000Z",
): SimulationResult<T> {
  if (world === null) {
    return { ok: false, degraded: "world_not_found", reason: "simulation world not found" };
  }
  if (scenario.tenant.tenantId !== world.tenant.tenantId) {
    return { ok: false, degraded: "scenario_tenant_mismatch", reason: "scenario tenant does not match world tenant" };
  }
  if (scenario.steps.length === 0) {
    return { ok: false, degraded: "empty_scenario", reason: "scenario has no steps" };
  }
  if (runner === null) {
    return { ok: false, degraded: "runner_unavailable", reason: "simulation runner is not available" };
  }
  try {
    const output = runSimulation(world, scenario, runner, startedAt, endedAt);
    return { ok: true, output };
  } catch (err) {
    return {
      ok: false,
      degraded: "runner_unavailable",
      reason: err instanceof Error ? err.message : "runner threw",
    };
  }
}

/**
 * An adoption PROPOSAL generated from simulation experimental runs.
 *
 * Law A5: this is a PROPOSAL — it does NOT adopt. The Guardian path (in
 * @fleetos/policy) is the SOLE authority that can convert a proposal into
 * an authorization. There is NO `adopt()` function here.
 */
export interface SimulationAdoptionProposal {
  readonly kind: "SIMULATION_ADOPTION_PROPOSAL";
  readonly proposalId: string;
  readonly tenant: TenantScopeLike;
  readonly worldId: string;
  readonly runIds: readonly string[];
  readonly rationale: string;
  readonly proposedAt: string;
}

/**
 * Generate an adoption PROPOSAL from simulation experimental runs.
 *
 * Returns a PROPOSAL — never adopts. The Guardian path adopts.
 */
export function generateSimulationAdoptionProposal(
  tenant: TenantScopeLike,
  worldId: string,
  runIds: readonly string[],
  rationale: string,
  proposedAt: string,
): SimulationAdoptionProposal {
  return {
    kind: "SIMULATION_ADOPTION_PROPOSAL",
    proposalId: `sim-prop-${worldId}-${[...runIds].sort().join(",")}`,
    tenant,
    worldId,
    runIds,
    rationale,
    proposedAt,
  };
}

/** Runtime guard — verifies the SIMULATION_ADOPTION_PROPOSAL marker. */
export function isSimulationAdoptionProposal(v: unknown): v is SimulationAdoptionProposal {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return r.kind === "SIMULATION_ADOPTION_PROPOSAL" &&
    typeof r.proposalId === "string" &&
    typeof r.worldId === "string";
}

/**
 * Machine-test: the simulation package exports NO `adopt()` function.
 *
 * Law A5: simulation adoption requires the Guardian path.
 */
export function assertNoAdoptFunction(moduleExports: Record<string, unknown>): {
  readonly ok: boolean;
  readonly forbidden: readonly string[];
} {
  const FORBIDDEN = ["adopt", "execute", "activate", "install", "selfAdopt"];
  const found = FORBIDDEN.filter((name) => typeof moduleExports[name] === "function");
  return { ok: found.length === 0, forbidden: found };
}
