/**
 * @fleetos/acceptance-field — mission-replay operation executors.
 *
 * Drives the LOCAL structural mirror of the tower's mission-replay contract
 * (see mission-mirror.ts for the documented seam) over THIS lane's REAL
 * state: each stage executes one REAL observation batch through the
 * observations pipeline + twin admission, so the folded mission view is
 * checked against the lane's own state, not a mock.
 */

import { admitTwinRevision } from "@fleetos/assets";
import { runPipeline } from "@fleetos/observations";
import type { RawObservationInput } from "@fleetos/observations";
import type { JourneyOperation } from "../journey-contracts.js";
import type { JourneyContext } from "../context.js";
import {
  appendMirrorEntries,
  makeMirrorJournal,
  mirrorWorkOrderIdempotencyKey,
  resumeMirrorMission,
  verifyMirrorJournal,
} from "../mission-mirror.js";
import { encodePayload, OPERATOR } from "../fixtures.js";
import { fnv1a32 } from "../determinism.js";
import { opOk, opRefused, type OpExecution } from "./common.js";

export function executeMissionOperation(op: JourneyOperation, ctx: JourneyContext): OpExecution {
  switch (op.kind) {
    case "mission.run-stages":
      return runMissionStages(op, ctx);
    case "mission.resume":
      return resumeMission(op, ctx);
    default:
      return opRefused("unknown-operation");
  }
}



function ingestBatchForStage(
  ctx: JourneyContext,
  deviceId: string,
  fromSeq: number,
  count: number,
  observationKind: string,
  firstObservedAt: number,
  stepMs: number,
): number {
  let admitted = 0;
  for (let i = 0; i < count; i++) {
    const input: RawObservationInput = {
      tenantId: ctx.tenantId,
      deviceId,
      seq: fromSeq + i,
      observedAt: firstObservedAt + i * stepMs,
      kind: observationKind,
      payload: encodePayload({ stageBatch: fromSeq, index: i }),
      receivedAt: ctx.clock,
    };
    const r = runPipeline(ctx.admission, ctx.metrics, input);
    ctx.metrics = r.metrics;
    if (!r.ok) continue;
    ctx.admission = r.store;
    ctx.observations.push(r.observation);
    admitted += 1;
    const twin = ctx.twins.get(deviceId) ?? null;
    const head = twin ? twin.revisions[twin.revisions.length - 1] : null;
    const tr = admitTwinRevision(twin, {
      deviceId: deviceId as never,
      tenantId: ctx.tenantId,
      seq: (twin?.lastSeq as number | undefined ?? 0) + 1,
      observedAt: input.observedAt,
      appliedAt: ctx.clock,
      source: "observation",
      attributes: { batch: fromSeq, index: i, unit: "count" },
      observationRef: {
        deviceId: input.deviceId,
        seq: input.seq,
        observedAt: input.observedAt,
        payloadDigest: r.observation.payloadDigest,
      },
      parentDigest: (head as { revisionDigest?: string } | null)?.revisionDigest ?? undefined,
      actor: OPERATOR,
    });
    if (tr.ok) ctx.twins.set(deviceId, tr.twin);
  }
  return admitted;
}

function runMissionStages(op: Extract<JourneyOperation, { kind: "mission.run-stages" }>, ctx: JourneyContext): OpExecution {
  if (!ctx.devices.has(op.deviceId)) return opRefused("unknown-device", { "mission.refused": "unknown-device" });
  const stageIds = Array.from({ length: op.stageCount }, (_, i) => `stage-${i + 1}`);
  let journal = makeMirrorJournal({
    missionId: op.missionId,
    definitionId: op.definitionId,
    tenantId: ctx.tenantId,
    stageIds,
  });
  journal = appendMirrorEntries(journal, [
    { at: ctx.clock, event: { kind: "mission-created" } },
    { at: ctx.clock, event: { kind: "mission-started" } },
  ]);
  const executedStages: string[] = [];
  for (let i = 0; i < op.suspendAfterStage; i++) {
    const stageId = stageIds[i]!;
    journal = appendMirrorEntries(journal, [
      {
        at: ctx.clock,
        event: {
          kind: "work-order-issued",
          stageId,
          commandId: `cmd_${fnv1a32(["mission", op.missionId, stageId, "1"])}`,
          idempotencyKey: mirrorWorkOrderIdempotencyKey(op.missionId, stageId),
          attempt: 1,
        },
      },
      { at: ctx.clock, event: { kind: "stage-started", stageId } },
    ]);
    const admitted = ingestBatchForStage(
      ctx, op.deviceId, i * op.batchPerStage + 1, op.batchPerStage,
      op.observationKind, op.firstObservedAt + i * op.batchPerStage * op.stepMs, op.stepMs,
    );
    if (admitted !== op.batchPerStage) return opRefused("stage-batch-incomplete", { "mission.refused": "stage-batch-incomplete" });
    journal = appendMirrorEntries(journal, [
      { at: ctx.clock, event: { kind: "checkpoint-recorded", stageId, checkpointId: `cp-${stageId}` } },
      { at: ctx.clock, event: { kind: "stage-completed", stageId } },
    ]);
    executedStages.push(stageId);
  }
  journal = appendMirrorEntries(journal, [{ at: ctx.clock, event: { kind: "mission-suspended" } }]);
  ctx.missions.set(op.missionId, journal);
  ctx.missionParams.set(op.missionId, {
    deviceId: op.deviceId,
    batchPerStage: op.batchPerStage,
    observationKind: op.observationKind,
    firstObservedAt: op.firstObservedAt,
    stepMs: op.stepMs,
  });
  const twin = ctx.twins.get(op.deviceId) ?? null;
  return opOk({
    "mission.stagesTotal": op.stageCount,
    "mission.executedStages": executedStages,
    "mission.executedCount": executedStages.length,
    "mission.twinLastSeq": twin ? (twin.lastSeq as number) : 0,
    "mission.twinRevisionCount": twin ? twin.revisions.length : 0,
    "mission.observationCount": ctx.observations.length,
    "mission.suspendedAfter": op.suspendAfterStage,
    "mission.journalVerified": verifyMirrorJournal(journal),
  });
}

function resumeMission(op: Extract<JourneyOperation, { kind: "mission.resume" }>, ctx: JourneyContext): OpExecution {
  const journal = ctx.missions.get(op.missionId);
  if (!journal) return opRefused("unknown-mission", { "mission.refused": "unknown-mission" });
  // Recover the original run parameters from the journal's stage count.
  const stageIds = journal.stageIds;
  const params = ctx.missionParams.get(op.missionId);
  if (!params) return opRefused("unknown-mission-params", { "mission.refused": "unknown-mission-params" });
  const commandIds: Record<string, string> = {};
  for (const stageId of stageIds) commandIds[stageId] = `cmd_${fnv1a32(["mission", op.missionId, stageId, "2"])}`;
  const r = resumeMirrorMission({ journal, at: ctx.clock, commandIds });
  let next = r.journal;
  // Execute ONLY the re-issued stages (each is one REAL observation batch).
  const reissued: string[] = [];
  for (const stageId of r.reissuedStages) {
    const index = stageIds.indexOf(stageId);
    const admitted = ingestBatchForStage(
      ctx, params.deviceId, index * params.batchPerStage + 1, params.batchPerStage,
      params.observationKind, params.firstObservedAt + index * params.batchPerStage * params.stepMs, params.stepMs,
    );
    if (admitted !== params.batchPerStage) return opRefused("stage-batch-incomplete", { "mission.refused": "stage-batch-incomplete" });
    next = appendMirrorEntries(next, [
      { at: ctx.clock, event: { kind: "checkpoint-recorded", stageId, checkpointId: `cp-${stageId}` } },
      { at: ctx.clock, event: { kind: "stage-completed", stageId } },
    ]);
    reissued.push(stageId);
  }
  next = appendMirrorEntries(next, [{ at: ctx.clock, event: { kind: "mission-completed" } }]);
  ctx.missions.set(op.missionId, next);
  const twin = ctx.twins.get(params.deviceId) ?? null;
  return opOk({
    "mission.reissuedStages": reissued,
    "mission.reissuedCount": reissued.length,
    "mission.skippedStages": r.skippedStages,
    "mission.skippedCount": r.skippedStages.length,
    "mission.reissuedKeys": reissued.map((stageId) => mirrorWorkOrderIdempotencyKey(op.missionId, stageId)),
    "mission.journalVerified": verifyMirrorJournal(next),
    "mission.twinLastSeq": twin ? (twin.lastSeq as number) : 0,
    "mission.twinRevisionCount": twin ? twin.revisions.length : 0,
    "mission.observationCount": ctx.observations.length,
  });
}


