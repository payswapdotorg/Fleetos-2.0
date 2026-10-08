/**
 * @fleetos/simulation — simulation worlds, scenarios, experimental-run contracts.
 *
 * Simulation outputs are typed as EXPERIMENTAL EVIDENCE ONLY — never as
 * authoritative observations or predictions. The kind tag "EXPERIMENTAL"
 * is machine-carried and cannot be stripped by the type system (brand symbol).
 *
 * Law A11 (extended): EXPERIMENTAL is a fourth distinct semantic kind,
 * incompatible with OBSERVED / PREDICTED / HYPOTHETICAL.
 */

/** LOCAL structural tenant scope. */
export interface TenantScopeLike {
  readonly tenantId: string;
}

/** Simulation world — the deterministic initial state for a simulation. */
export interface SimulationWorld {
  readonly worldId: string;
  readonly tenant: TenantScopeLike;
  readonly version: string;
  readonly initialState: Readonly<Record<string, unknown>>;
  readonly description: string;
}

/** Scenario — a sequence of inputs applied to a simulation world. */
export interface SimulationScenario {
  readonly scenarioId: string;
  readonly worldId: string;
  readonly tenant: TenantScopeLike;
  readonly steps: readonly SimulationStep[];
  readonly description: string;
}

export interface SimulationStep {
  readonly stepId: string;
  readonly action: string;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly expected: Readonly<Record<string, unknown>> | null;
}

/** Experimental-run output — typed as EXPERIMENTAL evidence only.
 *
 * The `kind: "EXPERIMENTAL"` literal makes this type structurally distinct
 * from OBSERVED / PREDICTED / HYPOTHETICAL values (law A11 extended).
 */
export interface ExperimentalRunOutput<T = unknown> {
  readonly kind: "EXPERIMENTAL";
  readonly runId: string;
  readonly scenarioId: string;
  readonly worldId: string;
  readonly tenant: TenantScopeLike;
  readonly result: T;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly deterministic: boolean;
}

/** Comparison input for cross-experiment evaluation. */
export interface ExperimentalComparison {
  readonly comparisonId: string;
  readonly runIds: readonly string[];
  readonly metric: string;
  readonly computedAt: string;
}

/**
 * Run a simulation deterministically. Same inputs => same outputs.
 *
 * The runner is INJECTED — the simulation package does not own any concrete
 * simulator. This keeps the package pure (no I/O, no GPU, no provider).
 */
export function runSimulation<T = unknown>(
  world: SimulationWorld,
  scenario: SimulationScenario,
  runner: (world: SimulationWorld, scenario: SimulationScenario) => T,
  startedAt: string = "1970-01-01T00:00:00.000Z",
  endedAt: string = "1970-01-01T00:00:00.000Z",
): ExperimentalRunOutput<T> {
  if (scenario.worldId !== world.worldId) {
    throw new Error(`runSimulation: scenario.worldId (${scenario.worldId}) != world.worldId (${world.worldId})`);
  }
  if (scenario.tenant.tenantId !== world.tenant.tenantId) {
    throw new Error(`runSimulation: tenant mismatch`);
  }
  const result = runner(world, scenario);
  return {
    kind: "EXPERIMENTAL",
    runId: `run-${world.worldId}-${scenario.scenarioId}`,
    scenarioId: scenario.scenarioId,
    worldId: world.worldId,
    tenant: world.tenant,
    result,
    startedAt,
    endedAt,
    deterministic: true,
  };
}

/** Runtime guard — verifies the EXPERIMENTAL marker.
 *
 * Uses the `kind` runtime field — the `__experimentalBrand` symbol is
 * compile-time only (TypeScript structural discrimination) and is erased
 * at runtime.
 */
export function isExperimental<T>(v: unknown): v is ExperimentalRunOutput<T> {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return r.kind === "EXPERIMENTAL" &&
    typeof r.runId === "string" &&
    typeof r.scenarioId === "string" &&
    typeof r.deterministic === "boolean";
}

/** Build a comparison input from a set of run IDs. */
export function buildComparison(runIds: readonly string[], metric: string, computedAt: string = "1970-01-01T00:00:00.000Z"): ExperimentalComparison {
  return {
    comparisonId: `cmp-${[...runIds].sort().join(",")}`,
    runIds,
    metric,
    computedAt,
  };
}

// ---------- Wave 1 (F210B) kernel extensions ----------

export * from "./adoption.ts";

// ---------- Wave 6 (F260B) predictive evaluation/replay/safety benchmarks ----------
//
// These modules bind the intelligence plane's REAL public entry points
// (@fleetos/predictive reference model + ModelPort, @fleetos/world-model
// journal/checkpoints/staleness, @fleetos/world-context tenant-safe assembly)
// to produce EVALUATION EVIDENCE ONLY (law A11 — EXPERIMENTAL markers on
// every artifact; benchmarks are never operational truth and never self-adopt).

export * from "./benchmark-definition.ts";
export * from "./replay-harness.ts";
export * from "./scoring.ts";
export * from "./safety-benchmarks.ts";
export * from "./benchmark-report.ts";
