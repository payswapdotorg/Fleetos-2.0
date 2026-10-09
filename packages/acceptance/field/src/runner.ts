/**
 * @fleetos/acceptance-field — the deterministic journey runner.
 *
 * Executes a journey's typed steps IN ORDER against a caller-threaded
 * context wired to the REAL public APIs (the executors), records every
 * reading the REAL outputs produce, then evaluates the journey's declarative
 * assertions against those readings. A FAILING step or a FAILING assertion
 * fails the journey — there are no soft passes. Re-running a journey is
 * byte-identical (same digest).
 *
 * Pure deterministic TS; logical `now` only.
 */

import {
  evaluateAssertion,
  journeyOutcomeDigest,
  type AcceptanceJourney,
  type AssertionOutcome,
  type JourneyOutcome,
  type JourneyStep,
  type StepOutcome,
} from "./journey-contracts.js";
import { createJourneyContext, type JourneyContext, type ReadingValue } from "./context.js";
import { executeAssetOperation } from "./ops/asset-ops.js";
import { executeCareOperation } from "./ops/care-ops.js";
import { executeEdgeOperation } from "./ops/edge-ops.js";
import { executeViewOperation } from "./ops/view-ops.js";
import { executeMissionOperation } from "./ops/mission-ops.js";
import { executeHostOperation } from "./ops/host-ops.js";
import type { OpExecution } from "./ops/common.js";
import { TENANT, T0 } from "./fixtures.js";

const ASSET_OPS = new Set([
  "asset.admit",
  "asset.activate",
  "device.enroll",
  "enrollment.check",
  "twin.admit",
  "observation.ingest",
  "observation.ingest-batch",
  "health.triage",
]);
const CARE_OPS = new Set([
  "recovery.open",
  "recovery.command",
  "maintenance.plan",
  "maintenance.order",
  "maintenance.command",
  "connectivity.record",
  "connectivity.propose-intent",
  "connectivity.transition-intent",
  "connectivity.rollup-posture",
]);
const EDGE_OPS = new Set([
  "adcos.issue",
  "adcos.dispatch",
  "adcos.dispatch-failure",
  "adcos.ack",
  "adcos.result",
  "adcos.reconcile",
  "adcos.expire",
  "adcos.health-rollup",
  "sim.run-world",
  "sim.adapter-run",
  "sim.ingest-emissions",
  "intent.enroll-asset",
  "intent.recovery-request",
  "intent.maintenance-schedule",
  "intent.validate",
]);
const MISSION_OPS = new Set(["mission.run-stages", "mission.resume"]);
const HOST_OPS = new Set(["host.build-view-models", "host.intent-draft", "host.context-probe"]);

function executeOperation(step: JourneyStep, ctx: JourneyContext): OpExecution {
  const kind = step.op.kind;
  if (ASSET_OPS.has(kind)) return executeAssetOperation(step.op, ctx);
  if (CARE_OPS.has(kind)) return executeCareOperation(step.op, ctx);
  if (EDGE_OPS.has(kind)) return executeEdgeOperation(step.op, ctx);
  if (MISSION_OPS.has(kind)) return executeMissionOperation(step.op, ctx);
  if (HOST_OPS.has(kind)) return executeHostOperation(step.op, ctx);
  return executeViewOperation(step.op, ctx);
}

export interface RunJourneyOptions {
  /** Caller-provided context (the handoff chain reuses the producer's). */
  readonly ctx?: JourneyContext;
  readonly tenantId?: string;
  readonly startedAt?: number;
}

export interface RunJourneyResult {
  readonly outcome: JourneyOutcome;
  readonly ctx: JourneyContext;
}

/**
 * Execute one journey. Steps run in declared order; every execution's
 * readings are recorded under `<stepId>.<name>`; a step marked
 * `expectRefusal` passes ONLY when the REAL API refused. After all steps,
 * assertions are evaluated against the recorded readings — any failure fails
 * the journey.
 */
export function executeJourney(journey: AcceptanceJourney, options: RunJourneyOptions = {}): RunJourneyResult {
  const ctx = options.ctx ?? createJourneyContext(options.tenantId ?? TENANT, options.startedAt ?? T0);
  const stepOutcomes: StepOutcome[] = [];
  for (const step of journey.steps) {
    const execution = executeOperation(step, ctx);
    for (const [name, value] of Object.entries(execution.readings)) {
      ctx.readings.set(`${step.id}.${name}`, value as ReadingValue);
    }
    const ok = step.expectRefusal === true ? !execution.ok : execution.ok;
    stepOutcomes.push({
      id: step.id,
      kind: step.op.kind,
      summary: step.summary,
      ok,
      note: execution.note,
    });
  }
  const assertions: AssertionOutcome[] = journey.assertions.map((a) => evaluateAssertion(a, ctx.readings));
  const passed =
    stepOutcomes.every((s) => s.ok) && assertions.every((a) => a.pass);
  const outcome: Omit<JourneyOutcome, "digest"> = {
    journeyId: journey.id,
    persona: journey.persona,
    capability: journey.capability,
    goal: journey.goal,
    steps: stepOutcomes,
    assertions,
    passed,
    handoff: ctx.handoff
      ? { handoffId: ctx.handoff.handoffId, digest: ctx.handoff.digest }
      : null,
  };
  return { outcome: { ...outcome, digest: journeyOutcomeDigest(outcome) }, ctx };
}

/**
 * Run a whole corpus in declared order, threading the handoff chain: a
 * journey with `consumesHandoff` runs on the context of the last journey
 * that published a carrier (the producer's REAL state is what it consumes).
 */
export function runJourneyCorpus(
  journeys: readonly AcceptanceJourney[],
  options: { readonly tenantId?: string; readonly startedAt?: number } = {},
): readonly JourneyOutcome[] {
  const outcomes: JourneyOutcome[] = [];
  let handoffCtx: JourneyContext | null = null;
  for (const journey of journeys) {
    const useShared = journey.consumesHandoff === true && handoffCtx !== null;
    const { outcome, ctx } = executeJourney(journey, {
      ...(useShared && handoffCtx !== null ? { ctx: handoffCtx } : {}),
      ...(options.tenantId !== undefined ? { tenantId: options.tenantId } : {}),
      ...(options.startedAt !== undefined ? { startedAt: options.startedAt } : {}),
    });
    outcomes.push(outcome);
    if (outcome.handoff) handoffCtx = ctx;
  }
  return outcomes;
}
