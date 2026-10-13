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
  type JourneyAssertion,
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
import { executeF321AEdgeOperation, F321A_EDGE_OP_KINDS } from "./ops/f321a-edge.js";
import { executeF321ACareOperation, F321A_CARE_OP_KINDS } from "./ops/f321a-care.js";
import { executeF321AAssetCoreOperation, F321A_ASSET_CORE_OP_KINDS } from "./ops/f321a-asset-core.js";
import { executeF331AOtaOperation, F331A_OTA_OP_KINDS } from "./ops/f331a-ota.js";
import { executeF341ABackpressureOperation } from "./ops/f341a-backpressure.js";
import { executeF341ARetentionOperation } from "./ops/f341a-retention.js";
import { executeF341AWorldsOperation } from "./ops/f341a-worlds.js";
import { executeF341AKernelOperation } from "./ops/f341a-kernel.js";
import { F341A_BP_OP_KINDS, F341A_RET_OP_KINDS, F341A_WORLD_OP_KINDS, F341A_KERNEL_OP_KINDS } from "./journey-contracts-f341a.js";
import type { OpExecution } from "./ops/common.js";
import { TENANT, T0 } from "./fixtures.js";
import { deepEquals } from "./determinism.js";
import { FROZEN_EPOCH_SCHEDULE, EPOCH_DECLARING_CLASSES, censusEntryOf } from "./epoch-schedule.js";

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
const F321A_EDGE_OPS = F321A_EDGE_OP_KINDS;
const F321A_CARE_OPS = F321A_CARE_OP_KINDS;
const F321A_ASSET_CORE_OPS = F321A_ASSET_CORE_OP_KINDS;
const F331A_OTA_OPS = F331A_OTA_OP_KINDS;
const F341A_BP_OPS = F341A_BP_OP_KINDS;
const F341A_RET_OPS = F341A_RET_OP_KINDS;
const F341A_WORLD_OPS = F341A_WORLD_OP_KINDS;
const F341A_KERNEL_OPS = F341A_KERNEL_OP_KINDS;

function executeOperation(step: JourneyStep, ctx: JourneyContext): OpExecution {
  const kind = step.op.kind;
  if (ASSET_OPS.has(kind)) return executeAssetOperation(step.op, ctx);
  if (CARE_OPS.has(kind)) return executeCareOperation(step.op, ctx);
  if (EDGE_OPS.has(kind)) return executeEdgeOperation(step.op, ctx);
  if (MISSION_OPS.has(kind)) return executeMissionOperation(step.op, ctx);
  if (HOST_OPS.has(kind)) return executeHostOperation(step.op, ctx);
  if (F321A_EDGE_OPS.has(kind)) return executeF321AEdgeOperation(step.op, ctx);
  if (F321A_CARE_OPS.has(kind)) return executeF321ACareOperation(step.op, ctx);
  if (F321A_ASSET_CORE_OPS.has(kind)) return executeF321AAssetCoreOperation(step.op, ctx);
  if (F331A_OTA_OPS.has(kind)) return executeF331AOtaOperation(step.op, ctx);
  if (F341A_BP_OPS.has(kind)) return executeF341ABackpressureOperation(step.op, ctx);
  if (F341A_RET_OPS.has(kind)) return executeF341ARetentionOperation(step.op, ctx);
  if (F341A_WORLD_OPS.has(kind)) return executeF341AWorldsOperation(step.op, ctx);
  if (F341A_KERNEL_OPS.has(kind)) return executeF341AKernelOperation(step.op, ctx);
  return executeViewOperation(step.op, ctx);
}

// ---------------------------------------------------------------------------
// D10(1) — per-epoch expectation-table resolution (fail-closed).
// ---------------------------------------------------------------------------

/** Resolve an assertion's expected value for the execution anchor. A
 * responding assertion (perEpoch present) resolves the table entry whose
 * `at` equals the anchor; NO entry => the runner FAILS (an epoch without
 * an expectation is not an executable epoch — D10 fail-closed). */
export function resolveAssertionForAnchor(assertion: JourneyAssertion, anchor: number): JourneyAssertion {
  if (assertion.perEpoch === undefined) return assertion;
  const entry = assertion.perEpoch.find((e) => e.at === anchor);
  if (entry === undefined) {
    throw new Error(
      `assertion ${assertion.id} (${assertion.reading}) declares a per-epoch table with no entry for anchor ${anchor}`,
    );
  }
  return { ...assertion, expected: entry.expected };
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
  // D10(1): responding assertions resolve their per-epoch table entry for
  // THIS execution anchor before evaluation (fail-closed on a missing entry).
  const anchor = ctx.startedAt;
  const assertions: AssertionOutcome[] = journey.assertions.map((a) => evaluateAssertion(resolveAssertionForAnchor(a, anchor), ctx.readings));
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

// ---------------------------------------------------------------------------
// F331A (Wave 13 lane A) — the epoch-execution capability (D10's proof
// form, MECHANICALLY enforced). The counting gate itself is TL-owned at
// F332; this runner delivers the capability + the machine proofs.
// ---------------------------------------------------------------------------

export interface EpochExecutionOptions {
  readonly tenantId?: string;
  /** The schedule to execute at — MUST be a subset of the D9 frozen anchors
   * (FROZEN_EPOCH_SCHEDULE; the small/medium/large firm schedules are
   * prefixes of it). An anchor outside the frozen schedule is refused. */
  readonly schedule: readonly number[];
}

export interface EpochExecutionProof {
  readonly journeyId: string;
  readonly censusCitation: string;
  /** The anchors executed (the schedule, in order). */
  readonly anchors: readonly number[];
  /** The outcome per anchor (index-aligned with `anchors`). */
  readonly outcomes: readonly JourneyOutcome[];
  /** D2(c): the same-anchor re-run digests were byte-identical. */
  readonly sameEpochByteIdentical: boolean;
  /** D2(d): every epoch pair differs on >= 1 ASSERTED reading (the
   * distinctness witnesses: assertion ids that differ per pair). */
  readonly distinctnessWitnesses: ReadonlyArray<{ readonly pair: readonly [number, number]; readonly assertionIds: readonly string[] }>;
  /** D10(1) consistency: every per-epoch table's anchor-0 entry equals the
   * assertion's single-valued expected. */
  readonly tablesAnchor0Consistent: boolean;
}

/**
 * Run the PARAMETERIZED journeys (those declaring `epochs`) at every anchor
 * of the schedule and mechanically enforce D10's proof form:
 *
 *  1. per-epoch table evaluation — `executeJourney` resolves each responding
 *     assertion's table entry for the anchor (fail-closed when missing);
 *  2. every epoch passes (all steps ok + all assertions passed);
 *  3. D2(c) same-epoch re-run byte-identity (digest comparison);
 *  4. D2(d) distinctness — for EVERY pair of anchors the journeys' ASSERTED
 *     readings (assertion actual vectors) must differ on >= 1 assertion;
 *     two epochs agreeing on every asserted value is an ERROR (a byte-identical
 *     re-run is never a distinct journey — D13);
 *  5. D10(1) consistency — each per-epoch table's anchor-0 entry equals the
 *     single-valued `expected` (the T0 corpus outcome is unchanged).
 *
 * Journeys WITHOUT `epochs` are skipped (invariant journeys + the past-only
 * exclusion declare none — D8's closed set; a census-non-certified journey
 * declaring epochs is refused).
 */
export function runJourneyEpochs(
  journeys: readonly AcceptanceJourney[],
  options: EpochExecutionOptions,
): readonly EpochExecutionProof[] {
  for (const anchor of options.schedule) {
    if (!FROZEN_EPOCH_SCHEDULE.includes(anchor)) {
      throw new Error(`epoch anchor ${anchor} is not one of the D9 frozen schedule values ${FROZEN_EPOCH_SCHEDULE.join(", ")}`);
    }
  }
  const proofs: EpochExecutionProof[] = [];
  for (const journey of journeys) {
    if (journey.epochs === undefined) continue;
    const census = censusEntryOf(journey.id);
    if (!census || !EPOCH_DECLARING_CLASSES.includes(census.censusClass)) {
      throw new Error(`journey ${journey.id} declares epochs but the F330 census does not certify it as epoch-declaring (class ${census?.censusClass ?? "absent"})`);
    }
    const declaredAnchors = journey.epochs.anchors;
    for (const anchor of options.schedule) {
      if (!declaredAnchors.includes(anchor)) {
        throw new Error(`journey ${journey.id} does not cover frozen anchor ${anchor} with any per-epoch table entry`);
      }
    }
    // D10(1) consistency: the anchor-0 table entry equals the single expected.
    const anchor0 = declaredAnchors[0] as number;
    const tablesAnchor0Consistent = journey.assertions.every((a) => {
      if (a.perEpoch === undefined) return true;
      const entry = a.perEpoch.find((e) => e.at === anchor0);
      return entry !== undefined && deepEquals(entry.expected, a.expected);
    });

    const outcomes: JourneyOutcome[] = [];
    const reruns: JourneyOutcome[] = [];
    for (const anchor of options.schedule) {
      const first = executeJourney(journey, {
        ...(options.tenantId !== undefined ? { tenantId: options.tenantId } : {}),
        startedAt: anchor,
      });
      const second = executeJourney(journey, {
        ...(options.tenantId !== undefined ? { tenantId: options.tenantId } : {}),
        startedAt: anchor,
      });
      if (!first.outcome.passed) {
        throw new Error(`journey ${journey.id} FAILED at epoch anchor ${anchor} (${first.outcome.steps.filter((s) => !s.ok).length} failing steps, ${first.outcome.assertions.filter((a) => !a.pass).map((a) => a.id).join(", ")} failing assertions)`);
      }
      outcomes.push(first.outcome);
      reruns.push(second.outcome);
    }
    // D2(c): same-epoch re-run byte-identity.
    const sameEpochByteIdentical = outcomes.every((o, i) => o.digest === reruns[i]!.digest);
    if (!sameEpochByteIdentical) {
      throw new Error(`journey ${journey.id} violates D2(c): a same-epoch re-run is not byte-identical`);
    }
    // D2(d): pairwise distinctness on ASSERTED readings (the actual vectors).
    const distinctnessWitnesses: { pair: readonly [number, number]; assertionIds: string[] }[] = [];
    for (let i = 0; i < outcomes.length; i += 1) {
      for (let j = i + 1; j < outcomes.length; j += 1) {
        const differing = outcomes[i]!.assertions
          .filter((a, k) => !deepEquals(a.actual, outcomes[j]!.assertions[k]?.actual))
          .map((a) => a.id);
        if (differing.length === 0) {
          throw new Error(
            `journey ${journey.id} violates D2(d): epochs at anchors ${options.schedule[i]} and ${options.schedule[j]} agree on every asserted reading (byte-identical re-run — never a distinct journey, D13)`,
          );
        }
        distinctnessWitnesses.push({ pair: [options.schedule[i] as number, options.schedule[j] as number], assertionIds: differing });
      }
    }
    proofs.push({
      journeyId: journey.id,
      censusCitation: journey.epochs.censusCitation,
      anchors: [...options.schedule],
      outcomes,
      sameEpochByteIdentical,
      distinctnessWitnesses,
      tablesAnchor0Consistent,
    });
  }
  return proofs;
}

