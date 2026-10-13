/**
 * @fleetos/acceptance-field — F341A journey A3: the sim-worlds checkpoint
 * determinism (Wave 14 lane A).
 *
 * CENSUS CITATION (F340 §1, candidate A3, verbatim row): "sim-worlds
 * checkpoint/resume | `packages/sim-worlds/src/world-engine.ts` ("a run
 * resumed from a checkpoint is byte-identical") | incidental matches only
 * (mission-mirror/cross context — no distinct journey) | CANDIDATE A3".
 *
 * The REAL capability is the engine's own determinism law: every random
 * draw is ADDRESS-KEYED (seed x step x domain x entity), never a hidden
 * counter, so a run resumed from a checkpoint is byte-identical to the
 * uninterrupted full run (journal + final state). The journey runs the lab
 * world 24 steps uninterrupted, then folds a 9-step prefix, checkpoints it,
 * resumes the remaining 15 steps, and proves byte-identity of the journal,
 * the chained state digest, the event seq and the per-device observation
 * counters (carried, never reset) — plus the fold-based resume
 * (resumeWorldRun), the pure-fold rebuild, and the engine's own identity
 * refusals.
 *
 * Vocabulary law: persona `sim-engineer` + capability `simulation` (the
 * frozen vocabulary's simulation family — same pair as the existing
 * simulation-driven-experiment journey; F300A set the multi-journey-per-cell
 * precedent). No vocabulary change.
 */

import type { AcceptanceJourney } from "../journey-contracts.js";
import { FIELD_LAB_SCENARIO, FIELD_LAB_WORLD } from "../fixtures.js";

export const simWorldsCheckpointDeterminismJourney: AcceptanceJourney = {
  id: "sim-worlds-checkpoint-determinism",
  persona: "sim-engineer",
  capability: "simulation",
  goal: "Prove the world engine's own resume law end-to-end: checkpoint a run mid-flight, resume it, and land byte-identically on the uninterrupted full run — journal, chained digest, and every carried counter — with the engine's identity refusals honest.",
  steps: [
    {
      id: "c1",
      summary: "run the lab world uninterrupted for 24 steps under the fault scenario (the reference journal + final state)",
      op: { kind: "world.run-full", runId: "wrun_ckpt-01", worldId: FIELD_LAB_WORLD.worldId, steps: 24, scenarioId: FIELD_LAB_SCENARIO.scenarioId },
    },
    {
      id: "c2",
      summary: "fold the first 9 steps from genesis (a real mid-run state, after the pump failure and inside the link outage)",
      op: { kind: "world.advance-prefix", runId: "wrun_ckpt-01", steps: 9 },
    },
    {
      id: "c3",
      summary: "checkpoint the mid-run state (the fold prefix, recorded exactly)",
      op: { kind: "world.checkpoint", runId: "wrun_ckpt-01" },
    },
    {
      id: "c4",
      summary: "resume the remaining 15 steps from the checkpointed state (the engine's own resume path)",
      op: { kind: "world.advance-resume", runId: "wrun_ckpt-01", steps: 15 },
    },
    { id: "c5", summary: "resume the fold itself: replay the FULL journal from the checkpoint (replay-stable)", op: { kind: "world.resume-fold", runId: "wrun_ckpt-01" } },
    { id: "c6", summary: "rebuild the state by folding the full journal from genesis (the pure-fold law)", op: { kind: "world.fold-rebuild", runId: "wrun_ckpt-01" } },
    {
      id: "c7",
      summary: "a negative step count is refused by the engine",
      expectRefusal: true,
      op: { kind: "world.refusal-probe", probe: "invalid-step-count" },
    },
    {
      id: "c8",
      summary: "advancing the lab world from a DIFFERENT world's state is refused (state-world-mismatch)",
      expectRefusal: true,
      op: { kind: "world.refusal-probe", probe: "state-world-mismatch" },
    },
    {
      id: "c9",
      summary: "advancing the lab world from the same worldId under a foreign tenant is refused (state-tenant-mismatch)",
      expectRefusal: true,
      op: { kind: "world.refusal-probe", probe: "state-tenant-mismatch" },
    },
  ],
  assertions: [
    { id: "w1", description: "the full run's journal verifies (chained digests, step discipline)", reading: "c1.world.journalVerified", op: "deep-equals", expected: true },
    { id: "w2", description: "the full run reaches step 24", reading: "c1.world.finalStep", op: "deep-equals", expected: 24 },
    { id: "w3", description: "the prefix is a real mid-run state at step 9", reading: "c2.world.prefixStep", op: "deep-equals", expected: 9 },
    { id: "w4", description: "the prefix emitted at least one event per step (step markers)", reading: "c2.world.prefixEventCount", op: "number-gte", expected: 9 },
    { id: "w5", description: "the checkpoint records EXACTLY the folded prefix (foldedSeq == the prefix state's own seq)", reading: "c3.world.foldedSeq", op: "reading-equals", expected: "c3.world.checkpointSeq" },
    { id: "w6", description: "the checkpointed state is the step-9 state", reading: "c3.world.checkpointStep", op: "deep-equals", expected: 9 },
    { id: "w7", description: "the resumed run reaches the full run's final step", reading: "c4.world.resumeStep", op: "deep-equals", expected: 24 },
    { id: "w8", description: "BYTE-IDENTITY (journal): prefix + resumed tail events deep-equal the uninterrupted run's journal", reading: "c4.world.resume.journalIdentical", op: "deep-equals", expected: true },
    { id: "w9", description: "BYTE-IDENTITY (state digest): the resumed run's chained digest equals the full run's", reading: "c4.world.resumeLastDigest", op: "reading-equals", expected: "c1.world.lastDigest" },
    { id: "w10", description: "BYTE-IDENTITY (seq): the resumed event seq equals the full run's", reading: "c4.world.resumeSeq", op: "reading-equals", expected: "c1.world.seq" },
    { id: "w11", description: "the hidden per-device observation counters are CARRIED, never reset (resumed == full)", reading: "c4.world.resume.deviceSeqs", op: "reading-equals", expected: "c1.world.deviceSeqs" },
    { id: "w12", description: "the fold-based resume over the full journal lands on the full state head", reading: "c5.world.fold.matchesFull", op: "deep-equals", expected: true },
    { id: "w13", description: "the fold-resumed state's chained digest equals the full run's", reading: "c5.world.foldLastDigest", op: "reading-equals", expected: "c1.world.lastDigest" },
    { id: "w14", description: "re-feeding the full journal (already-folded prefix included) is a replay-stable no-op", reading: "c5.world.fold.replayIdempotent", op: "deep-equals", expected: true },
    { id: "w15", description: "the pure-fold rebuild of the full journal lands on the full state head (same events => same state)", reading: "c6.world.rebuild.matchesFull", op: "deep-equals", expected: true },
    { id: "w16", description: "the fold-rebuilt state's chained digest equals the full run's", reading: "c6.world.rebuildLastDigest", op: "reading-equals", expected: "c1.world.lastDigest" },
    { id: "w17", description: "the fold-rebuilt per-device counters equal the full run's", reading: "c6.world.rebuild.deviceSeqs", op: "reading-equals", expected: "c1.world.deviceSeqs" },
    { id: "w18", description: "a negative step count is refused (invalid-step-count)", reading: "c7.world.refused", op: "deep-equals", expected: "invalid-step-count" },
    { id: "w19", description: "resuming from a different world's state is refused (state-world-mismatch)", reading: "c8.world.refused", op: "deep-equals", expected: "state-world-mismatch" },
    { id: "w20", description: "resuming from a foreign tenant's state is refused (state-tenant-mismatch)", reading: "c9.world.refused", op: "deep-equals", expected: "state-tenant-mismatch" },
  ],
};
