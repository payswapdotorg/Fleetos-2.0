/**
 * @fleetos/acceptance-field — F341A operation executors: A3 the sim-worlds
 * checkpoint determinism (Wave 14 lane A; the F340 §1 census candidate A3 —
 * `packages/sim-worlds/src/world-engine.ts`, the engine's own law: "a run
 * resumed from a checkpoint is byte-identical to the uninterrupted full run
 * (journal + final state)"; only incidental corpus matches existed).
 *
 * Every executor drives REAL public APIs of @fleetos/sim-worlds (runWorld,
 * advanceWorldSteps, genesisWorldState, checkpointWorldRun, resumeWorldRun,
 * foldWorldEvents, verifyWorldJournal) and records readings from the REAL
 * outputs. The byte-identity proofs compare REAL outputs only: the resumed
 * journal (prefix + tail events) against the full run's journal, and the
 * resumed state's own chained digest / seq / step / per-device runtime
 * counters against the full run's — never re-derived values.
 */

import {
  advanceWorldSteps,
  checkpointWorldRun,
  foldWorldEvents,
  genesisWorldState,
  resumeWorldRun,
  runWorld,
  verifyWorldJournal,
} from "@fleetos/sim-worlds";
import type { WorldEngineState } from "@fleetos/sim-worlds";
import type { JourneyOperation } from "../journey-contracts.js";
import type { F341AWorldRunRecord, JourneyContext } from "../context.js";
import { FIELD_LAB_WORLD, FIELD_LAB_WORLD_FOREIGN, FIELD_LAB_WORLD_TENANT_PROBE, findScenario, findWorld } from "../fixtures.js";
import { deepEquals } from "../determinism.js";
import { opOk, opRefused, type OpExecution } from "./common.js";

function recordOf(ctx: JourneyContext, runId: string): F341AWorldRunRecord | undefined {
  return ctx.worldCheckpointRuns.get(runId);
}

/** Per-device runtime counters read from the REAL state (in world order). */
function deviceSeqs(state: WorldEngineState, deviceIds: readonly string[]): number[] {
  return deviceIds.map((id) => state.devices.get(id)?.observationSeq ?? -1);
}

export function executeF341AWorldsOperation(op: JourneyOperation, ctx: JourneyContext): OpExecution {
  switch (op.kind) {
    case "world.run-full": {
      const world = findWorld(op.worldId);
      if (!world) return opRefused("unknown-world", { "world.refused": "unknown-world" });
      const scenario = op.scenarioId !== undefined ? findScenario(op.scenarioId) : undefined;
      if (op.scenarioId !== undefined && !scenario) {
        return opRefused("unknown-scenario", { "world.refused": "unknown-scenario" });
      }
      const r = runWorld(world, op.steps, scenario ?? undefined);
      if (!r.ok) return opRefused(r.reason, { "world.refused": r.reason });
      ctx.worldCheckpointRuns.set(op.runId, {
        world,
        scenario: scenario ?? undefined,
        fullState: r.state,
        fullEvents: r.events,
        prefixState: null,
        prefixEvents: [],
        checkpoint: null,
        resumedState: null,
        tailEvents: [],
      });
      return opOk({
        "world.eventCount": r.events.length,
        "world.finalStep": r.state.step,
        "world.seq": r.state.seq,
        "world.lastDigest": r.state.lastDigest,
        "world.journalVerified": verifyWorldJournal(world, r.events).ok,
        "world.deviceSeqs": deviceSeqs(r.state, world.devices.map((d) => d.deviceId)),
      });
    }
    case "world.advance-prefix": {
      const record = recordOf(ctx, op.runId);
      if (!record) return opRefused("unknown-run", { "world.refused": "unknown-run" });
      const r = advanceWorldSteps(record.world, genesisWorldState(record.world), op.steps, record.scenario);
      if (!r.ok) return opRefused(r.reason, { "world.refused": r.reason });
      record.prefixState = r.state;
      record.prefixEvents = r.events;
      return opOk({
        "world.prefixStep": r.state.step,
        "world.prefixSeq": r.state.seq,
        "world.prefixLastDigest": r.state.lastDigest,
        "world.prefixEventCount": r.events.length,
        "world.prefixDeviceSeqs": deviceSeqs(r.state, record.world.devices.map((d) => d.deviceId)),
      });
    }
    case "world.checkpoint": {
      const record = recordOf(ctx, op.runId);
      if (!record) return opRefused("unknown-run", { "world.refused": "unknown-run" });
      if (!record.prefixState) return opRefused("no-prefix-state", { "world.refused": "no-prefix-state" });
      const checkpoint = checkpointWorldRun(record.prefixState);
      record.checkpoint = checkpoint;
      return opOk({
        // Checkpoint contents honesty: the checkpoint records EXACTLY the
        // folded prefix (its foldedSeq equals the prefix state's own seq —
        // nothing folded away, nothing invented).
        "world.foldedSeq": checkpoint.foldedSeq,
        "world.checkpointSeq": checkpoint.state.seq,
        "world.checkpointStep": checkpoint.state.step,
        "world.checkpointLastDigest": checkpoint.state.lastDigest,
      });
    }
    case "world.advance-resume": {
      const record = recordOf(ctx, op.runId);
      if (!record) return opRefused("unknown-run", { "world.refused": "unknown-run" });
      if (!record.prefixState) return opRefused("no-prefix-state", { "world.refused": "no-prefix-state" });
      const r = advanceWorldSteps(record.world, record.prefixState, op.steps, record.scenario);
      if (!r.ok) return opRefused(r.reason, { "world.refused": r.reason });
      record.resumedState = r.state;
      record.tailEvents = r.events;
      const resumedJournal = [...record.prefixEvents, ...r.events];
      return opOk({
        "world.resumeStep": r.state.step,
        "world.resumeSeq": r.state.seq,
        "world.resumeLastDigest": r.state.lastDigest,
        "world.resumeTailEventCount": r.events.length,
        // The byte-identity proofs — REAL outputs compared, never re-derived.
        "world.resume.journalIdentical": deepEquals(resumedJournal, record.fullEvents),
        "world.resume.digestMatchesFull": r.state.lastDigest === record.fullState.lastDigest,
        "world.resume.seqMatchesFull": r.state.seq === record.fullState.seq,
        "world.resume.stepMatchesFull": r.state.step === record.fullState.step,
        "world.resume.deviceSeqs": deviceSeqs(r.state, record.world.devices.map((d) => d.deviceId)),
      });
    }
    case "world.resume-fold": {
      const record = recordOf(ctx, op.runId);
      if (!record) return opRefused("unknown-run", { "world.refused": "unknown-run" });
      if (!record.checkpoint) return opRefused("no-checkpoint", { "world.refused": "no-checkpoint" });
      const resumed = resumeWorldRun(record.checkpoint, record.fullEvents);
      // Re-feeding the FULL journal (already-folded prefix included) must be
      // a replay-stable no-op: the fold skips seq <= foldedSeq.
      const replay = resumeWorldRun(record.checkpoint, [...record.fullEvents, ...record.fullEvents]);
      return opOk({
        "world.foldStep": resumed.step,
        "world.foldSeq": resumed.seq,
        "world.foldLastDigest": resumed.lastDigest,
        "world.fold.matchesFull":
          resumed.lastDigest === record.fullState.lastDigest &&
          resumed.seq === record.fullState.seq &&
          resumed.step === record.fullState.step,
        "world.fold.replayIdempotent": replay.lastDigest === resumed.lastDigest && replay.seq === resumed.seq,
      });
    }
    case "world.fold-rebuild": {
      const record = recordOf(ctx, op.runId);
      if (!record) return opRefused("unknown-run", { "world.refused": "unknown-run" });
      const rebuilt = foldWorldEvents(record.world, record.fullEvents);
      return opOk({
        "world.rebuildStep": rebuilt.step,
        "world.rebuildSeq": rebuilt.seq,
        "world.rebuildLastDigest": rebuilt.lastDigest,
        // The pure-fold law: same events => byte-identical state head.
        "world.rebuild.matchesFull":
          rebuilt.lastDigest === record.fullState.lastDigest &&
          rebuilt.seq === record.fullState.seq &&
          rebuilt.step === record.fullState.step,
        "world.rebuild.deviceSeqs": deviceSeqs(rebuilt, record.world.devices.map((d) => d.deviceId)),
      });
    }
    case "world.refusal-probe": {
      // Each probe trips one REAL engine refusal on the lab world.
      if (op.probe === "invalid-step-count") {
        const r = advanceWorldSteps(FIELD_LAB_WORLD, genesisWorldState(FIELD_LAB_WORLD), -1);
        if (r.ok) return opRefused("probe-did-not-refuse", { "world.refused": "probe-did-not-refuse" });
        return opRefused(r.reason, { "world.refused": r.reason });
      }
      if (op.probe === "state-world-mismatch") {
        const r = advanceWorldSteps(FIELD_LAB_WORLD, genesisWorldState(FIELD_LAB_WORLD_FOREIGN), 1);
        if (r.ok) return opRefused("probe-did-not-refuse", { "world.refused": "probe-did-not-refuse" });
        return opRefused(r.reason, { "world.refused": r.reason });
      }
      const r = advanceWorldSteps(FIELD_LAB_WORLD, genesisWorldState(FIELD_LAB_WORLD_TENANT_PROBE), 1);
      if (r.ok) return opRefused("probe-did-not-refuse", { "world.refused": "probe-did-not-refuse" });
      return opRefused(r.reason, { "world.refused": r.reason });
    }
    default:
      return opRefused("unknown-operation");
  }
}
