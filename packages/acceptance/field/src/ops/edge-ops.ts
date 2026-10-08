/**
 * @fleetos/acceptance-field — ADCOS / simulation / experience-intent operation
 * executors. Every executor drives a REAL public API of @fleetos/adcos,
 * @fleetos/sim-worlds or @fleetos/experience-asset-field and records
 * readings from the REAL output (phases, digests, EXPERIMENTAL markers,
 * refusals — never re-derived).
 */

import {
  issueAdcosCommand,
  dispatchAdcosCommand,
  recordAdcosDispatchFailure,
  acknowledgeAdcosCommand,
  recordAdcosResult,
  reconcileAdcosCommand,
  expireAdcosCommands,
  rollupAdapterHealth,
  verifyAdapterHealthReport,
  foldAdapterCircuitAll,
  verifyCommandJournal,
  defaultRetryPolicy,
} from "@fleetos/adcos";
import type { CommandOutcomeObservation } from "@fleetos/adcos";
import { runWorld, verifyWorldJournal } from "@fleetos/sim-worlds";
import { runFleetWorldSimulation, canonicalRunOutput } from "@fleetos/sim-worlds";
import { runPipeline } from "@fleetos/observations";
import type { RawObservationInput } from "@fleetos/observations";
import {
  buildEnrollAssetIntent,
  buildRequestRecoveryIntent,
  buildScheduleMaintenanceIntent,
  validateCommandDraft,
  toSubmitInput,
  verifyCommandDraftDigest,
} from "@fleetos/experience-asset-field";
import type { JourneyOperation } from "../journey-contracts.js";
import type { JourneyContext, SimRunRecord } from "../context.js";
import { EDGE_ACTOR, OPERATOR, TECHNICIAN, encodePayload, findScenario, findWorld } from "../fixtures.js";
import { fnv1a32 } from "../determinism.js";
import { opOk, opRefused, type OpExecution } from "./common.js";

/** Resolve a command id by (tenant-scoped) idempotency key — deterministic,
 * so journey DATA can reference commands without knowing derived ids. */
function resolveCommandId(ctx: JourneyContext, idempotencyKey: string): string {
  const id = ctx.adcos.byIdempotencyKey.get(`${ctx.tenantId}|${idempotencyKey}`);
  if (id === undefined) return `unknown:${idempotencyKey}`;
  return id;
}

export function executeEdgeOperation(op: JourneyOperation, ctx: JourneyContext): OpExecution {
  switch (op.kind) {
    case "adcos.issue": {
      const r = issueAdcosCommand(ctx.adcos, {
        tenantId: ctx.tenantId,
        deviceId: op.deviceId,
        kind: op.commandKind,
        idempotencyKey: op.idempotencyKey,
        actor: EDGE_ACTOR,
        at: ctx.clock,
        ...(op.expiresAt !== undefined ? { expiresAt: op.expiresAt } : {}),
      });
      if (!r.ok) return opRefused(r.reason, { "cmd.refused": r.reason });
      ctx.adcos = r.state;
      return opOk({ "cmd.id": r.commandId, "cmd.duplicate": r.duplicate });
    }
    case "adcos.dispatch": {
      const r = dispatchAdcosCommand(ctx.adcos, {
        tenantId: ctx.tenantId,
        commandId: resolveCommandId(ctx, op.idempotencyKey),
        at: ctx.clock,
        actor: EDGE_ACTOR,
        policy: defaultRetryPolicy(),
      });
      if (!r.ok) return opRefused(r.reason, { "cmd.refused": r.reason });
      ctx.adcos = r.state;
      return opOk({ "cmd.phase": r.record.phase, "cmd.attempts": r.record.attempts });
    }
    case "adcos.dispatch-failure": {
      const r = recordAdcosDispatchFailure(ctx.adcos, {
        tenantId: ctx.tenantId,
        commandId: resolveCommandId(ctx, op.idempotencyKey),
        at: ctx.clock,
        code: op.code,
        actor: EDGE_ACTOR,
        policy: defaultRetryPolicy(),
      });
      if (!r.ok) return opRefused(r.reason, { "cmd.refused": r.reason });
      ctx.adcos = r.state;
      return opOk({
        "cmd.phase": r.record.phase,
        ...(r.record.deadLetterCode !== null ? { "cmd.deadLetterCode": r.record.deadLetterCode } : {}),
        ...(r.record.backoffMs !== null ? { "cmd.backoffMs": r.record.backoffMs } : {}),
      });
    }
    case "adcos.ack": {
      const r = acknowledgeAdcosCommand(ctx.adcos, {
        tenantId: ctx.tenantId,
        commandId: resolveCommandId(ctx, op.idempotencyKey),
        at: ctx.clock,
        requestId: op.requestId,
        actor: EDGE_ACTOR,
      });
      if (!r.ok) return opRefused(r.reason, { "cmd.refused": r.reason });
      ctx.adcos = r.state;
      return opOk({ "cmd.phase": r.record.phase, "cmd.requestId": r.record.requestId });
    }
    case "adcos.result": {
      const commandId = resolveCommandId(ctx, op.idempotencyKey);
      const r = recordAdcosResult(ctx.adcos, {
        tenantId: ctx.tenantId,
        commandId,
        at: ctx.clock,
        ok: op.ok,
        resultDigest: fnv1a32(["result", commandId, ctx.clock]),
        actor: EDGE_ACTOR,
      });
      if (!r.ok) return opRefused(r.reason, { "cmd.refused": r.reason });
      ctx.adcos = r.state;
      return opOk({ "cmd.phase": r.record.phase, "cmd.resultOk": r.record.resultOk });
    }
    case "adcos.reconcile": {
      const r = reconcileAdcosCommand(ctx.adcos, {
        tenantId: ctx.tenantId,
        commandId: resolveCommandId(ctx, op.idempotencyKey),
        at: ctx.clock,
        actor: EDGE_ACTOR,
      });
      if (!r.ok) return opRefused(r.reason, { "cmd.refused": r.reason });
      ctx.adcos = r.state;
      return opOk({ "cmd.phase": r.record.phase });
    }
    case "adcos.expire": {
      const r = expireAdcosCommands(ctx.adcos, { tenantId: ctx.tenantId, now: op.now, actor: EDGE_ACTOR });
      ctx.adcos = r.state;
      return opOk({ "adcos.expired": r.expired });
    }
    case "adcos.health-rollup": {
      const outcomes: CommandOutcomeObservation[] = ctx.adcos.events
        .filter((e) => e.kind === "resulted")
        .map((e) => ({ ok: (e as { ok: boolean }).ok, at: (e as { at: number }).at }));
      const circuit = foldAdapterCircuitAll(outcomes, { failureThreshold: 3, cooldownMs: 60_000 });
      const report = rollupAdapterHealth(
        {
          tenantId: ctx.tenantId,
          now: op.now,
          commandOutcomes: outcomes,
          sessionSummary: { active: 0, fresh: 0, stale: 0, expired: 0, revoked: 0 },
          postureSignals: [],
        },
        circuit,
      );
      return opOk({
        "adcos.health.status": report.status,
        "adcos.health.digestVerified": verifyAdapterHealthReport(report),
        "adcos.health.total": report.commandStats.total,
        "adcos.health.failures": report.commandStats.failures,
        "adcos.health.failureBps": report.commandStats.failureBps,
        "adcos.health.circuit": report.circuit,
        "adcos.health.reasons": report.reasons,
        "adcos.journalVerified": verifyCommandJournal(ctx.adcos.events).ok,
      });
    }
    case "sim.run-world": {
      const world = findWorld(op.worldId);
      if (!world) return opRefused("unknown-world", { "run.refused": "unknown-world" });
      const scenario = op.scenarioId !== undefined ? findScenario(op.scenarioId) : undefined;
      if (op.scenarioId !== undefined && !scenario) {
        return opRefused("unknown-scenario", { "run.refused": "unknown-scenario" });
      }
      const r = runWorld(world, op.steps, scenario ?? undefined);
      if (!r.ok) return opRefused(r.reason, { "run.refused": r.reason });
      const record: SimRunRecord = {
        runId: op.runId,
        worldId: world.worldId,
        steps: op.steps,
        eventCount: r.events.length,
        finalStep: r.state.step,
        assetFailureEvents: r.events
          .filter((e) => e.kind === "asset-failed")
          .map((e) => ({ assetId: (e as { assetId: string }).assetId, cause: (e as { cause: string }).cause, step: e.step })),
        emissions: r.events
          .filter((e) => e.kind === "observation-emitted")
          .map((e) => {
            const o = e as {
              deviceId: string; observationSeq: number; streamKind: string; unit: string;
              value: number; observedAt: number; payloadDigest: string;
            };
            return {
              deviceId: o.deviceId, seq: o.observationSeq, streamKind: o.streamKind,
              unit: o.unit, value: o.value, observedAt: o.observedAt, payloadDigest: o.payloadDigest,
            };
          }),
      };
      ctx.simRuns.set(op.runId, record);
      const verification = verifyWorldJournal(world, r.events);
      return opOk({
        "run.eventCount": record.eventCount,
        "run.finalStep": record.finalStep,
        "run.assetFailures": record.assetFailureEvents.length,
        "run.injectedFailures": record.assetFailureEvents.filter((f) => f.cause === "injected").length,
        "run.emissions": record.emissions.length,
        "run.journalVerified": verification.ok,
      });
    }
    case "sim.adapter-run": {
      const world = findWorld(op.worldId);
      const scenario = findScenario(op.scenarioId);
      if (!world || !scenario) return opRefused("unknown-world-or-scenario", { "sim.refused": "unknown-world-or-scenario" });
      const r = runFleetWorldSimulation(world, scenario, op.steps);
      if (!r.ok) return opRefused(r.reason, { "sim.refused": r.reason });
      return opOk({
        "sim.kind": r.output.kind,
        "sim.evidenceKind": r.output.result.evidenceKind,
        "sim.worldDigest": r.output.result.worldDigest,
        "sim.scenarioDigest": r.output.result.scenarioDigest,
        "sim.deterministic": r.output.deterministic,
        "sim.eventCount": r.output.result.eventCount,
        "sim.canonicalLength": canonicalRunOutput(r.output).length,
      });
    }
    case "sim.ingest-emissions": {
      const run = ctx.simRuns.get(op.runId);
      if (!run) return opRefused("unknown-run", { "emissions.refused": "unknown-run" });
      let ingested = 0;
      let refused = 0;
      let lastReason: string | null = null;
      for (const e of run.emissions) {
        if (op.deviceId !== undefined && e.deviceId !== op.deviceId) continue;
        const input: RawObservationInput = {
          tenantId: ctx.tenantId,
          deviceId: e.deviceId,
          seq: e.seq,
          observedAt: e.observedAt,
          kind: e.streamKind,
          payload: encodePayload({ unit: e.unit, value: e.value }),
          receivedAt: ctx.clock,
        };
        const r = runPipeline(ctx.admission, ctx.metrics, input);
        ctx.metrics = r.metrics;
        if (!r.ok) {
          refused += 1;
          lastReason = `${r.stage}:${r.reason}`;
          continue;
        }
        ctx.admission = r.store;
        ctx.observations.push(r.observation);
        ingested += 1;
      }
      return opOk({
        "emissions.ingested": ingested,
        "emissions.refused": refused,
        ...(lastReason !== null ? { "emissions.lastReason": lastReason } : {}),
      });
    }
    case "intent.enroll-asset": {
      const r = buildEnrollAssetIntent({
        tenantId: ctx.tenantId,
        actorId: OPERATOR,
        assetId: op.assetId,
        deviceId: op.deviceId,
        ...(op.serial !== undefined ? { serial: op.serial } : {}),
        ...(op.displayName !== undefined ? { displayName: op.displayName } : {}),
        issuedAt: ctx.clock,
        reason: "acceptance: enroll a new asset into the fleet",
      });
      if (!r.ok) return opRefused(r.rejected, { "intent.refused": r.rejected });
      ctx.lastDraft = r.draft;
      return opOk({
        "intent.kind": r.draft.kind,
        "intent.idempotencyKey": r.draft.idempotencyKey,
        "intent.capability": r.draft.capabilityRequirement,
        "intent.digestVerified": verifyCommandDraftDigest(r.draft),
      });
    }
    case "intent.recovery-request": {
      const r = buildRequestRecoveryIntent({
        tenantId: ctx.tenantId,
        actorId: TECHNICIAN,
        deviceId: op.deviceId,
        issuedAt: ctx.clock,
        reason: "acceptance: request recovery for a degraded device",
      });
      if (!r.ok) return opRefused(r.rejected, { "intent.refused": r.rejected });
      ctx.lastDraft = r.draft;
      return opOk({
        "intent.kind": r.draft.kind,
        "intent.idempotencyKey": r.draft.idempotencyKey,
        "intent.capability": r.draft.capabilityRequirement,
        "intent.digestVerified": verifyCommandDraftDigest(r.draft),
      });
    }
    case "intent.maintenance-schedule": {
      const r = buildScheduleMaintenanceIntent({
        tenantId: ctx.tenantId,
        actorId: OPERATOR,
        assetId: op.assetId,
        planId: op.planId,
        schedule: op.schedule,
        issuedAt: ctx.clock,
        reason: "acceptance: schedule preventive maintenance",
      });
      if (!r.ok) return opRefused(r.rejected, { "intent.refused": r.rejected });
      ctx.lastDraft = r.draft;
      return opOk({
        "intent.kind": r.draft.kind,
        "intent.idempotencyKey": r.draft.idempotencyKey,
        "intent.capability": r.draft.capabilityRequirement,
        "intent.digestVerified": verifyCommandDraftDigest(r.draft),
      });
    }
    case "intent.validate": {
      if (!ctx.lastDraft) return opRefused("no-draft", { "validate.refused": "no-draft" });
      const v = validateCommandDraft(ctx.lastDraft);
      const submit = toSubmitInput(ctx.lastDraft);
      return opOk({
        "validate.ok": v.ok,
        ...(v.ok ? {} : { "validate.rejected": v.rejected }),
        "submit.kind": submit.kind,
        "submit.idempotencyKey": submit.idempotencyKey,
        "submit.hasNotBefore": submit.notBefore !== undefined,
      });
    }
    default:
      return opRefused("unknown-operation");
  }
}
