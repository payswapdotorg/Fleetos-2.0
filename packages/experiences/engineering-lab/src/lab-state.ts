/**
 * @fleetos/experience-engineering-lab — the lab state slice + its guard
 * (F261 deliverable 1).
 *
 * `LabStateSlice` is the tenant-scoped composition of the three Wave-6
 * lanes' REAL public outputs:
 *   - sim-worlds: world definitions, world run journals + experimental run
 *     outputs (`FleetWorld`, `WorldEvent[]`,
 *     `ExperimentalRunOutput<FleetWorldRunSummary>`);
 *   - simulation: benchmark sets, replays, scoring, safety reports and
 *     benchmark reports (advisory EXPERIMENTAL evidence);
 *   - agent-organizations: optimization problems and the three proposal
 *     kinds plus what-if analyses (proposals only, Guardian path).
 *
 * `guardLabState` is TENANT FAIL-CLOSED over the whole slice (A8): a
 * missing/malformed tenant, any cross-tenant record (the offender is
 * NAMED in the refusal detail), any run/report/proposal referencing an
 * unknown world / benchmark set / organization, duplicate ids, an invalid
 * logical `now` — each refuses the ENTIRE slice; there is no partial lab.
 * Accepted slices are NORMALIZED to deterministic ordering (worldId asc,
 * runId asc, report runId asc, organizationId asc, proposal digest asc), so
 * input array order never leaks into the slice digest.
 *
 * Determinism: pure fold; identical inputs produce a byte-identical slice
 * (including the digest).
 */

import type { FaultScenario, FleetWorld, WorldEvent, FleetWorldRunSummary } from "@fleetos/sim-worlds";
import { verifyWorldJournal } from "@fleetos/sim-worlds";
import type { ExperimentalRunOutput } from "@fleetos/simulation";
import type {
  BenchmarkReport,
  BenchmarkScoring,
  BenchmarkSet,
  ReplayRun,
  SafetyReport,
} from "@fleetos/simulation";
import type {
  BudgetRebalanceProposal,
  OptimizationProblem,
  RoleAllocationProposal,
  RoutingOptimizationProposal,
  WhatIfAnalysis,
} from "@fleetos/agent-organizations";
import { cmpString, labDigestOf } from "./lab-core.js";

// ---------------------------------------------------------------------------
// The slice
// ---------------------------------------------------------------------------

/** One executed world run: scenario + journal + the EXPERIMENTAL output. */
export interface LabWorldRun {
  readonly scenario: FaultScenario;
  readonly output: ExperimentalRunOutput<FleetWorldRunSummary>;
  /** The run's journal (the engine's emitted events, in seq order). */
  readonly events: readonly WorldEvent[];
}

/** One benchmark report bundle: set + replays + scoring + safety + report. */
export interface LabBenchmark {
  readonly set: BenchmarkSet;
  readonly replays: readonly ReplayRun[];
  readonly scoring: BenchmarkScoring;
  readonly safety: SafetyReport;
  readonly report: BenchmarkReport;
}

/** One organization's optimization problem + its proposals + what-ifs. */
export interface LabOptimization {
  readonly problem: OptimizationProblem;
  readonly roleAllocations: readonly RoleAllocationProposal[];
  readonly budgetRebalances: readonly BudgetRebalanceProposal[];
  readonly routing: readonly RoutingOptimizationProposal[];
  readonly whatIfs: readonly WhatIfAnalysis[];
}

/** The tenant-scoped composed lab state (caller-assembled from the lanes). */
export interface LabStateSlice {
  readonly tenantId: string;
  /** Logical now (caller-supplied integer milliseconds). */
  readonly now: number;
  readonly worlds: readonly FleetWorld[];
  readonly worldRuns: readonly LabWorldRun[];
  readonly benchmarks: readonly LabBenchmark[];
  readonly optimizations: readonly LabOptimization[];
}

// ---------------------------------------------------------------------------
// The guard — fail-closed over the whole slice
// ---------------------------------------------------------------------------

export type LabStateRefusal =
  | "missing-tenant"
  | "invalid-now"
  | "duplicate-world"
  | "duplicate-world-run"
  | "duplicate-report"
  | "duplicate-organization"
  | "cross-tenant-ref"
  | "unknown-world-ref"
  | "unknown-benchmark-ref"
  | "unknown-organization-ref"
  | "journal-invalid";

export type LabStateResult =
  | { readonly ok: true; readonly slice: LabStateSlice }
  | { readonly ok: false; readonly refused: LabStateRefusal; readonly detail: string };

function refuse(refused: LabStateRefusal, detail: string): LabStateResult {
  return { ok: false, refused, detail };
}

/**
 * Guard the whole slice: tenant fail-closed, every reference resolved,
 * every journal chain verified through the lanes' OWN verifier, and the
 * accepted slice normalized to deterministic ordering. Pure.
 */
export function guardLabState(slice: LabStateSlice): LabStateResult {
  if (slice.tenantId === "") return refuse("missing-tenant", "slice tenantId is empty");
  if (!Number.isInteger(slice.now) || slice.now <= 0) {
    return refuse("invalid-now", `logical now must be a positive integer, got ${String(slice.now)}`);
  }
  const tenant = slice.tenantId;

  // --- worlds: tenant + duplicates, sorted by worldId ---
  const worldIds = new Set<string>();
  for (const w of slice.worlds) {
    if (worldIds.has(w.worldId)) return refuse("duplicate-world", `duplicate worldId ${w.worldId}`);
    worldIds.add(w.worldId);
    if (w.tenantId !== tenant) {
      return refuse("cross-tenant-ref", `world ${w.worldId} belongs to tenant ${w.tenantId}, not ${tenant}`);
    }
  }
  const worlds = [...slice.worlds].sort((a, b) => cmpString(a.worldId, b.worldId));

  // --- world runs: tenant + world refs + the REAL journal verification ---
  const runIds = new Set<string>();
  for (const run of slice.worldRuns) {
    if (runIds.has(run.output.runId)) {
      return refuse("duplicate-world-run", `duplicate runId ${run.output.runId}`);
    }
    runIds.add(run.output.runId);
    if (run.scenario.tenantId !== tenant) {
      return refuse("cross-tenant-ref", `scenario ${run.scenario.scenarioId} belongs to tenant ${run.scenario.tenantId}, not ${tenant}`);
    }
    if (run.output.tenant.tenantId !== tenant) {
      return refuse("cross-tenant-ref", `run output ${run.output.runId} belongs to tenant ${run.output.tenant.tenantId}, not ${tenant}`);
    }
    const world = worlds.find((w) => w.worldId === run.scenario.worldId && w.worldId === run.output.worldId);
    if (!world) {
      return refuse("unknown-world-ref", `run ${run.output.runId} references unknown worldId ${run.output.worldId}`);
    }
    if (run.scenario.worldId !== run.output.worldId) {
      return refuse("unknown-world-ref", `run ${run.output.runId} scenario world ${run.scenario.worldId} != output world ${run.output.worldId}`);
    }
    const verified = verifyWorldJournal(world, run.events);
    if (!verified.ok) {
      const first = verified.failures[0];
      return refuse("journal-invalid", `run ${run.output.runId} journal invalid at seq ${String(first?.seq ?? 0)} (${String(first?.reason ?? "unknown")})`);
    }
  }
  const worldRuns = [...slice.worldRuns].sort((a, b) => cmpString(a.output.runId, b.output.runId));

  // --- benchmarks: tenant + set/report linkage, sorted by report runId ---
  const reportIds = new Set<string>();
  for (const bench of slice.benchmarks) {
    if (reportIds.has(bench.report.runId)) {
      return refuse("duplicate-report", `duplicate benchmark report runId ${bench.report.runId}`);
    }
    reportIds.add(bench.report.runId);
    if (bench.set.tenant.tenantId !== tenant) {
      return refuse("cross-tenant-ref", `benchmark set ${bench.set.setDigest} belongs to tenant ${bench.set.tenant.tenantId}, not ${tenant}`);
    }
    if (bench.scoring.tenant.tenantId !== tenant) {
      return refuse("cross-tenant-ref", `scoring of report ${bench.report.runId} belongs to tenant ${bench.scoring.tenant.tenantId}, not ${tenant}`);
    }
    if (bench.safety.tenant.tenantId !== tenant) {
      return refuse("cross-tenant-ref", `safety report of ${bench.report.runId} belongs to tenant ${bench.safety.tenant.tenantId}, not ${tenant}`);
    }
    if (bench.report.tenant.tenantId !== tenant) {
      return refuse("cross-tenant-ref", `benchmark report ${bench.report.runId} belongs to tenant ${bench.report.tenant.tenantId}, not ${tenant}`);
    }
    if (bench.report.setDigest !== bench.set.setDigest) {
      return refuse("unknown-benchmark-ref", `report ${bench.report.runId} references unknown set digest ${bench.report.setDigest}`);
    }
    for (const replay of bench.replays) {
      if (replay.tenant.tenantId !== tenant) {
        return refuse("cross-tenant-ref", `replay ${replay.runId} belongs to tenant ${replay.tenant.tenantId}, not ${tenant}`);
      }
    }
  }
  const benchmarks = [...slice.benchmarks].sort((a, b) =>
    cmpString(a.report.runId, b.report.runId),
  );

  // --- optimizations: tenant + organization linkage ---
  const orgIds = new Set<string>();
  for (const opt of slice.optimizations) {
    if (opt.problem.tenant.tenantId !== tenant) {
      return refuse("cross-tenant-ref", `optimization problem ${opt.problem.organizationId} belongs to tenant ${opt.problem.tenant.tenantId}, not ${tenant}`);
    }
    if (orgIds.has(opt.problem.organizationId)) {
      return refuse("duplicate-organization", `duplicate organizationId ${opt.problem.organizationId}`);
    }
    orgIds.add(opt.problem.organizationId);
    const orgId = opt.problem.organizationId;
    for (const p of opt.roleAllocations) {
      if (p.tenantId !== tenant) return refuse("cross-tenant-ref", `role-allocation proposal ${p.digest} belongs to tenant ${p.tenantId}, not ${tenant}`);
      if (p.organizationId !== orgId) {
        return refuse("unknown-organization-ref", `role-allocation proposal ${p.digest} references organization ${p.organizationId}, not ${orgId}`);
      }
    }
    for (const p of opt.budgetRebalances) {
      if (p.tenantId !== tenant) return refuse("cross-tenant-ref", `budget-rebalance proposal ${p.digest} belongs to tenant ${p.tenantId}, not ${tenant}`);
      if (p.organizationId !== orgId) {
        return refuse("unknown-organization-ref", `budget-rebalance proposal ${p.digest} references organization ${p.organizationId}, not ${orgId}`);
      }
    }
    for (const p of opt.routing) {
      // Seam note (F261): routing proposals carry tenantId but NO
      // organizationId — organization linkage is unprovable for them.
      if (p.tenantId !== tenant) return refuse("cross-tenant-ref", `routing proposal ${p.digest} belongs to tenant ${p.tenantId}, not ${tenant}`);
    }
    for (const w of opt.whatIfs) {
      if (w.tenantId !== tenant) return refuse("cross-tenant-ref", `what-if ${w.digest} belongs to tenant ${w.tenantId}, not ${tenant}`);
      if (w.organizationId !== orgId) {
        return refuse("unknown-organization-ref", `what-if ${w.digest} references organization ${w.organizationId}, not ${orgId}`);
      }
    }
  }
  const optimizations = [...slice.optimizations]
    .sort((a, b) => cmpString(a.problem.organizationId, b.problem.organizationId))
    .map((opt) => ({
      problem: opt.problem,
      roleAllocations: [...opt.roleAllocations].sort((a, b) => cmpString(a.digest, b.digest)),
      budgetRebalances: [...opt.budgetRebalances].sort((a, b) => cmpString(a.digest, b.digest)),
      routing: [...opt.routing].sort((a, b) => cmpString(a.digest, b.digest)),
      whatIfs: [...opt.whatIfs].sort((a, b) => cmpString(a.digest, b.digest)),
    }));

  return {
    ok: true,
    slice: {
      tenantId: tenant,
      now: slice.now,
      worlds,
      worldRuns,
      benchmarks,
      optimizations,
    },
  };
}

// ---------------------------------------------------------------------------
// The slice digest — tamper-evident, order-independent by construction
// ---------------------------------------------------------------------------

/** Deterministic digest over the guarded slice's presented content. */
export function labStateDigestOf(slice: LabStateSlice): string {
  return labDigestOf("lab-state", {
    tenantId: slice.tenantId,
    now: slice.now,
    worlds: slice.worlds.map((w) => [w.worldId, w.tenantId, w.version, w.seed]),
    worldRuns: slice.worldRuns.map((r) => [
      r.output.runId,
      r.scenario.worldId,
      r.scenario.scenarioId,
      r.output.result.eventCount,
      r.output.result.lastEventDigest,
    ]),
    benchmarks: slice.benchmarks.map((b) => [
      b.report.runId,
      b.set.setDigest,
      b.report.reportDigest,
      b.scoring.scoringDigest,
      b.safety.safetyDigest,
    ]),
    optimizations: slice.optimizations.map((o) => [
      o.problem.organizationId,
      o.problem.digest,
      o.roleAllocations.map((p) => p.digest),
      o.budgetRebalances.map((p) => p.digest),
      o.routing.map((p) => p.digest),
      o.whatIfs.map((w) => w.digest),
    ]),
  });
}

/** Recompute the slice digest; false means tampered slice content. */
export function verifyLabStateDigest(slice: LabStateSlice, digest: string): boolean {
  return labStateDigestOf(slice) === digest;
}
