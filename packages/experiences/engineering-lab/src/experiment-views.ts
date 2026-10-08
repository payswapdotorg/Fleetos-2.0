/**
 * @fleetos/experience-engineering-lab — the experiment console read-models
 * (F261 deliverable 2).
 *
 * Three pure views over the guarded lab slice:
 *   1. `buildExperimentSetupView` — world summary + scenario script + seed +
 *      planned steps (the plan projected through the REAL
 *      `toSimulationScenario`);
 *   2. `buildRunMonitorView` — the run's journal timeline (seq/step/kind/
 *      subject/digest per event), event-kind counts VERBATIM from the REAL
 *      run output, checkpoint visibility through the lane's OWN
 *      fold/checkpoint/resume machinery;
 *   3. `buildRunOutcomeView` — the `ExperimentalRunOutput` presentation
 *      with the EXPERIMENTAL markers carried STRUCTURALLY (`kind:
 *      "EXPERIMENTAL"`, `experimental: true`, `evidenceKind`).
 *
 * Views only render GUARDED state: every builder runs `guardLabState` first
 * and refuses (surfacing the guard's own code) when the slice does not
 * verify — no partial views. Deterministic: identical inputs produce
 * byte-identical views (including digests).
 */

import {
  checkpointWorldRun,
  foldWorldEvents,
  resumeWorldRun,
  toSimulationScenario,
} from "@fleetos/sim-worlds";
import type { WorldEvent } from "@fleetos/sim-worlds";
import { EXPERIMENTAL_MARKER, LAB_SCHEMA_VERSION, cmpString, labDigestOf } from "./lab-core.js";
import { guardLabState, type LabStateSlice } from "./lab-state.js";

export type LabViewRefusal =
  | "missing-tenant"
  | "invalid-now"
  | "lab-state-refused"
  | "unknown-world"
  | "unknown-scenario"
  | "unknown-run"
  | "invalid-planned-steps"
  | "invalid-checkpoint-interval";

export type LabViewResult<V> =
  | { readonly ok: true; readonly view: V }
  | {
      readonly ok: false;
      readonly refused: LabViewRefusal;
      readonly detail: string;
      /** The guard's own code when the slice itself refused (verbatim). */
      readonly guardCode?: string;
    };

function refuse(refused: LabViewRefusal, detail: string, guardCode?: string): LabViewResult<never> {
  return guardCode === undefined
    ? { ok: false, refused, detail }
    : { ok: false, refused, detail, guardCode };
}

/** Guard the slice or refuse the view (fail-closed, guard code surfaced). */
function guardedSlice(slice: LabStateSlice, now: number): LabViewResult<LabStateSlice> {
  const guarded = guardLabState(slice);
  if (!guarded.ok) {
    return refuse("lab-state-refused", `lab state refused: ${guarded.detail}`, guarded.refused);
  }
  if (!Number.isInteger(now) || now <= 0) {
    return refuse("invalid-now", `logical now must be a positive integer, got ${String(now)}`);
  }
  return { ok: true, view: guarded.slice };
}

// ---------------------------------------------------------------------------
// 1. Experiment setup view
// ---------------------------------------------------------------------------

export interface ExperimentWorldSummary {
  readonly worldId: string;
  readonly description: string;
  readonly seed: string;
  readonly version: number;
  readonly timeUnitMs: number;
  readonly counts: {
    readonly assets: number;
    readonly devices: number;
    readonly links: number;
    readonly maintenancePolicies: number;
    readonly initialHealthPostures: number;
  };
  /** Initial posture counts by posture state (deterministic key order). */
  readonly posturesByState: Readonly<Record<string, number>>;
}

export interface ExperimentScenarioScript {
  readonly scenarioId: string;
  readonly description: string;
  readonly faults: readonly {
    readonly kind: string;
    readonly target: string;
    readonly atStep: number;
    readonly untilStep: number | null;
  }[];
}

export interface ExperimentSetupView {
  readonly schemaVersion: number;
  readonly tenantId: string;
  readonly asOf: number;
  readonly world: ExperimentWorldSummary;
  readonly scenario: ExperimentScenarioScript;
  /** The planned steps projected through the REAL `toSimulationScenario`. */
  readonly plannedSteps: readonly {
    readonly stepId: string;
    readonly action: string;
    readonly step: number;
    readonly faultsAt: readonly string[];
  }[];
  readonly digest: string;
}

/** Present the experiment setup: world + scenario + plan (READ-ONLY). */
export function buildExperimentSetupView(
  slice: LabStateSlice,
  options: { readonly worldId: string; readonly scenarioId: string; readonly plannedSteps: number; readonly now: number },
): LabViewResult<ExperimentSetupView> {
  const guarded = guardedSlice(slice, options.now);
  if (!guarded.ok) return guarded;
  const s = guarded.view;
  const world = s.worlds.find((w) => w.worldId === options.worldId);
  if (!world) return refuse("unknown-world", `unknown worldId ${options.worldId}`);
  const run = s.worldRuns.find((r) => r.scenario.scenarioId === options.scenarioId);
  if (!run) return refuse("unknown-scenario", `unknown scenarioId ${options.scenarioId}`);
  if (run.scenario.worldId !== world.worldId) {
    return refuse("unknown-scenario", `scenario ${options.scenarioId} does not belong to world ${options.worldId}`);
  }
  if (!Number.isInteger(options.plannedSteps) || options.plannedSteps < 0) {
    return refuse("invalid-planned-steps", `plannedSteps must be a non-negative integer, got ${String(options.plannedSteps)}`);
  }
  const postures: Record<string, number> = {};
  for (const h of [...world.initialHealthPostures].sort((a, b) => cmpString(a.assetId, b.assetId))) {
    postures[h.posture] = (postures[h.posture] ?? 0) + 1;
  }
  const script: ExperimentScenarioScript = {
    scenarioId: run.scenario.scenarioId,
    description: run.scenario.description,
    faults: run.scenario.faults.map((f) => ({
      kind: f.kind,
      target: f.kind === "link-outage" ? f.linkId : f.assetId,
      atStep: f.kind === "link-outage" ? f.fromStep : f.atStep,
      untilStep: f.kind === "link-outage" ? f.untilStep : null,
    })),
  };
  const planned = toSimulationScenario(world, run.scenario, options.plannedSteps);
  const view: ExperimentSetupView = {
    schemaVersion: LAB_SCHEMA_VERSION,
    tenantId: s.tenantId,
    asOf: options.now,
    world: {
      worldId: world.worldId,
      description: world.description,
      seed: world.seed,
      version: world.version,
      timeUnitMs: world.timeUnitMs,
      counts: {
        assets: world.assets.length,
        devices: world.devices.length,
        links: world.links.length,
        maintenancePolicies: world.maintenancePolicies.length,
        initialHealthPostures: world.initialHealthPostures.length,
      },
      posturesByState: postures,
    },
    scenario: script,
    plannedSteps: planned.steps.map((step) => ({
      stepId: step.stepId,
      action: step.action,
      step: step.inputs.step as number,
      faultsAt: step.inputs.faultsAt as string[],
    })),
    digest: "",
  };
  return { ok: true, view: { ...view, digest: labDigestOf("experiment-setup", omitDigest(view)) } };
}

// ---------------------------------------------------------------------------
// 2. Run monitor view
// ---------------------------------------------------------------------------

export interface RunMonitorCheckpoint {
  readonly atSeq: number;
  readonly step: number;
  readonly lastDigest: string;
  /** The lane's own checkpoint-resume law, machine-checked at presentation. */
  readonly resumesIdentically: boolean;
}

export interface RunMonitorView {
  readonly schemaVersion: number;
  readonly tenantId: string;
  readonly asOf: number;
  readonly runId: string;
  readonly worldId: string;
  readonly scenarioId: string;
  readonly eventCount: number;
  /** VERBATIM from the REAL run output's `eventCountsByKind`. */
  readonly eventCountsByKind: Readonly<Record<string, number>>;
  readonly timeline: readonly {
    readonly seq: number;
    readonly step: number;
    readonly kind: string;
    readonly subject: string | null;
    readonly digest: string;
  }[];
  readonly checkpoints: readonly RunMonitorCheckpoint[];
  readonly journalHeadDigest: string;
  readonly digest: string;
}

function eventSubject(event: WorldEvent): string | null {
  if ("linkId" in event) return event.linkId;
  if ("assetId" in event) return event.assetId;
  if ("deviceId" in event) return event.deviceId;
  return null;
}

/** Present the run monitor: journal timeline + counts + checkpoints. */
export function buildRunMonitorView(
  slice: LabStateSlice,
  options: { readonly runId: string; readonly now: number; readonly checkpointEvery?: number },
): LabViewResult<RunMonitorView> {
  const guarded = guardedSlice(slice, options.now);
  if (!guarded.ok) return guarded;
  const s = guarded.view;
  const run = s.worldRuns.find((r) => r.output.runId === options.runId);
  if (!run) return refuse("unknown-run", `unknown runId ${options.runId}`);
  const world = s.worlds.find((w) => w.worldId === run.output.worldId);
  if (!world) return refuse("unknown-world", `run ${options.runId} references unknown world ${run.output.worldId}`);
  const every = options.checkpointEvery ?? 10;
  if (!Number.isInteger(every) || every < 1) {
    return refuse("invalid-checkpoint-interval", `checkpointEvery must be a positive integer, got ${String(every)}`);
  }
  const events = run.events;
  const full = foldWorldEvents(world, events);
  const checkpoints: RunMonitorCheckpoint[] = [];
  for (let atSeq = every; atSeq < events.length; atSeq += every) {
    const prefix = foldWorldEvents(world, events.slice(0, atSeq));
    const checkpoint = checkpointWorldRun(prefix);
    const resumed = resumeWorldRun(checkpoint, events);
    checkpoints.push({
      atSeq,
      step: prefix.step,
      lastDigest: prefix.lastDigest,
      resumesIdentically:
        resumed.seq === full.seq && resumed.step === full.step && resumed.lastDigest === full.lastDigest,
    });
  }
  const view: RunMonitorView = {
    schemaVersion: LAB_SCHEMA_VERSION,
    tenantId: s.tenantId,
    asOf: options.now,
    runId: run.output.runId,
    worldId: run.output.worldId,
    scenarioId: run.output.scenarioId,
    eventCount: run.output.result.eventCount,
    eventCountsByKind: run.output.result.eventCountsByKind,
    timeline: events.map((event) => ({
      seq: event.seq,
      step: event.step,
      kind: event.kind,
      subject: eventSubject(event),
      digest: event.digest,
    })),
    checkpoints,
    journalHeadDigest: run.output.result.lastEventDigest,
    digest: "",
  };
  return { ok: true, view: { ...view, digest: labDigestOf("run-monitor", omitDigest(view)) } };
}

// ---------------------------------------------------------------------------
// 3. Run outcome view
// ---------------------------------------------------------------------------

/**
 * The experimental run outcome presentation. The EXPERIMENTAL markers are
 * STRUCTURAL: `kind: "EXPERIMENTAL"` and `experimental: true` are typed
 * literals that cannot be stripped without breaking the view type.
 */
export interface RunOutcomeView {
  readonly schemaVersion: number;
  readonly tenantId: string;
  readonly asOf: number;
  /** VERBATIM from the REAL output — the EXPERIMENTAL evidence kind tag. */
  readonly kind: "EXPERIMENTAL";
  readonly experimental: true;
  readonly evidenceKind: typeof EXPERIMENTAL_MARKER;
  readonly runId: string;
  readonly scenarioId: string;
  readonly worldId: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly deterministic: boolean;
  readonly worldDigest: string;
  readonly scenarioDigest: string;
  readonly steps: number;
  readonly eventCount: number;
  readonly finalStep: number;
  readonly assets: readonly { readonly assetId: string; readonly operational: boolean; readonly posture: string }[];
  readonly devices: readonly { readonly deviceId: string; readonly up: boolean; readonly observationSeq: number }[];
  readonly links: readonly { readonly linkId: string; readonly up: boolean }[];
  readonly digest: string;
}

/** Present the run outcome: the EXPERIMENTAL output, fields verbatim. */
export function buildRunOutcomeView(
  slice: LabStateSlice,
  options: { readonly runId: string; readonly now: number },
): LabViewResult<RunOutcomeView> {
  const guarded = guardedSlice(slice, options.now);
  if (!guarded.ok) return guarded;
  const s = guarded.view;
  const run = s.worldRuns.find((r) => r.output.runId === options.runId);
  if (!run) return refuse("unknown-run", `unknown runId ${options.runId}`);
  const output = run.output;
  const result = output.result;
  const view: RunOutcomeView = {
    schemaVersion: LAB_SCHEMA_VERSION,
    tenantId: s.tenantId,
    asOf: options.now,
    kind: output.kind,
    experimental: true,
    evidenceKind: EXPERIMENTAL_MARKER,
    runId: output.runId,
    scenarioId: output.scenarioId,
    worldId: output.worldId,
    startedAt: output.startedAt,
    endedAt: output.endedAt,
    deterministic: output.deterministic,
    worldDigest: result.worldDigest,
    scenarioDigest: result.scenarioDigest,
    steps: result.steps,
    eventCount: result.eventCount,
    finalStep: result.finalStep,
    assets: result.assets,
    devices: result.devices,
    links: result.links,
    digest: "",
  };
  return { ok: true, view: { ...view, digest: labDigestOf("run-outcome", omitDigest(view)) } };
}

/** Recompute a view digest; false means tampered view content. */
export function verifyExperimentViewDigest(
  view: ExperimentSetupView | RunMonitorView | RunOutcomeView,
): boolean {
  const kind =
    "plannedSteps" in view ? "experiment-setup" : "timeline" in view ? "run-monitor" : "run-outcome";
  const { digest: _omit, ...rest } = view as unknown as Record<string, unknown> & { digest: string };
  return labDigestOf(kind, rest) === view.digest;
}

function omitDigest(view: object): unknown {
  const { digest: _omit, ...rest } = view as Record<string, unknown>;
  return rest;
}
