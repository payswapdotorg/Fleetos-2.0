/**
 * @fleetos/mission — the durable mission runtime tests (law A10).
 *
 * The state machine (legal transitions + every rejection code), work-order
 * issuance through the CommandSubmitPort TYPE seam (deterministic
 * idempotency keys, dedupe on resume — never re-executes), checkpointed
 * suspend/resume, the atomic boundary (a rejected submit leaves NO journal
 * and NO outbox residue), journal replay == folded state through the
 * runtime, tenant fail-closed, and cross-stack determinism.
 */

import { describe, expect, it } from "vitest";
import { MissionRuntime, type GuardEvaluator } from "../src/runtime.js";
import { foldMission, MissionJournal } from "../src/journal.js";
import { validateMissionDefinition } from "../src/definition.js";
import { workOrderIdempotencyKey } from "../src/ids.js";
import {
  ctxFor,
  makeStack,
  NOW,
  PARALLEL_DEF,
  GUARDED_DEF,
  SEQUENTIAL_DEF,
  TENANT_A,
  TENANT_B,
} from "./helpers.js";

const CTX_A = ctxFor(TENANT_A);
const CTX_B = ctxFor(TENANT_B);

function makeRuntime(options?: {
  readonly failKeys?: ReadonlySet<string>;
  readonly guards?: GuardEvaluator;
}): { runtime: MissionRuntime; stack: ReturnType<typeof makeStack> } {
  const stack = makeStack({ failKeys: options?.failKeys, guards: options?.guards });
  return {
    runtime: new MissionRuntime({
      store: stack.store,
      outbox: stack.outbox,
      commandSubmit: stack.port,
      guards: options?.guards,
    }),
    stack,
  };
}

/** create + start + run every stage to completion (SEQUENTIAL_DEF). */
function completedMission(runtime: MissionRuntime, missionId: string, t0: number) {
  runtime.createMission({ ctx: CTX_A, definition: SEQUENTIAL_DEF, missionId, now: t0 });
  runtime.startMission({ ctx: CTX_A, missionId, now: t0 + 1 });
  runtime.completeStage({ ctx: CTX_A, missionId, stageId: "ingest", now: t0 + 2 });
  runtime.completeStage({ ctx: CTX_A, missionId, stageId: "analyze", now: t0 + 3 });
  runtime.completeStage({ ctx: CTX_A, missionId, stageId: "report", now: t0 + 4 });
  return missionId;
}

describe("MissionRuntime — createMission", () => {
  it("creates a pending mission: one mission-created journal entry + one outbox event", () => {
    const { runtime, stack } = makeRuntime();
    const created = runtime.createMission({
      ctx: CTX_A,
      definition: SEQUENTIAL_DEF,
      missionId: "msn_0000000001",
      now: NOW,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.view.state).toBe("pending");
    expect(created.value.view.stages.map((s) => s.state)).toEqual([
      "pending",
      "pending",
      "pending",
    ]);
    expect(created.value.view.createdAt).toBe(NOW);
    const entries = runtime.journalEntries(CTX_A, "msn_0000000001");
    expect(entries.ok && entries.value).toHaveLength(1);
    expect(entries.ok && entries.value[0]?.event.kind).toBe("mission-created");
    expect(stack.outbox.eventsFor(CTX_A)).toHaveLength(1);
    expect(stack.outbox.eventsFor(CTX_A)[0]?.type).toBe("mission.mission-created");
  });

  it("generates per-tenant monotonic mission ids", () => {
    const { runtime } = makeRuntime();
    const first = runtime.createMission({ ctx: CTX_A, definition: SEQUENTIAL_DEF, now: NOW });
    const second = runtime.createMission({ ctx: CTX_A, definition: SEQUENTIAL_DEF, now: NOW });
    expect(first.ok && first.value.view.missionId).toBe("msn_0000000001");
    expect(second.ok && second.value.view.missionId).toBe("msn_0000000002");
  });

  it("rejects an invalid definition: invalid-definition", () => {
    const { runtime } = makeRuntime();
    const bad = runtime.createMission({
      ctx: CTX_A,
      definition: { id: "def-bad", stages: [] },
      now: NOW,
    });
    expect(bad).toEqual({ ok: false, reason: "invalid-definition" });
  });

  it("rejects unknown guards when a knownGuards registry is supplied", () => {
    const { runtime } = makeRuntime();
    const created = runtime.createMission({
      ctx: CTX_A,
      definition: GUARDED_DEF,
      now: NOW,
      knownGuards: new Set(["capability:ingest:run"]),
    });
    expect(created).toEqual({ ok: false, reason: "invalid-definition" });
    const okCreate = runtime.createMission({
      ctx: CTX_A,
      definition: GUARDED_DEF,
      now: NOW,
      knownGuards: new Set([
        "capability:ingest:run",
        "capability:analyze:run",
        "predicate:data-ready",
      ]),
    });
    expect(okCreate.ok).toBe(true);
  });

  it("rejects a duplicate mission id: mission-exists", () => {
    const { runtime } = makeRuntime();
    runtime.createMission({
      ctx: CTX_A,
      definition: SEQUENTIAL_DEF,
      missionId: "msn_0000000009",
      now: NOW,
    });
    expect(
      runtime.createMission({
        ctx: CTX_A,
        definition: SEQUENTIAL_DEF,
        missionId: "msn_0000000009",
        now: NOW + 1,
      }),
    ).toEqual({ ok: false, reason: "mission-exists" });
  });

  it("rejects an invalid now: invalid-input", () => {
    const { runtime } = makeRuntime();
    expect(
      runtime.createMission({ ctx: CTX_A, definition: SEQUENTIAL_DEF, now: 0 }),
    ).toEqual({ ok: false, reason: "invalid-input" });
  });

  it("an unknown mission id is mission-not-found (same tenant)", () => {
    const { runtime } = makeRuntime();
    expect(runtime.missionView(CTX_A, "msn_nope000001")).toEqual({
      ok: false,
      reason: "mission-not-found",
    });
    expect(
      runtime.startMission({ ctx: CTX_A, missionId: "msn_nope000001", now: NOW }),
    ).toEqual({ ok: false, reason: "mission-not-found" });
  });
});

describe("MissionRuntime — startMission + work-order issuance (the TYPE seam)", () => {
  it("pending → running; issues the ready stage through the port with kind work-order", () => {
    const { runtime, stack } = makeRuntime();
    runtime.createMission({
      ctx: CTX_A,
      definition: SEQUENTIAL_DEF,
      missionId: "msn_0000000001",
      now: NOW,
    });
    const started = runtime.startMission({
      ctx: CTX_A,
      missionId: "msn_0000000001",
      now: NOW + 1,
    });
    expect(started.ok && started.value.view.state).toBe("running");
    expect(started.ok && started.value.view.startedAt).toBe(NOW + 1);
    // Exactly ONE work order — for the single ready stage.
    expect(stack.port.calls).toHaveLength(1);
    const call = stack.port.calls[0];
    expect(call?.kind).toBe("work-order");
    expect(call?.idempotencyKey).toBe("wo:msn_0000000001:ingest");
    expect(call?.issuedAt).toBe(NOW + 1);
    expect(call?.payload).toEqual({
      missionId: "msn_0000000001",
      stageId: "ingest",
      definitionId: "def-sequential",
    });
    // The in-flight stage is running; downstream stages stay pending.
    expect(started.ok && started.value.view.stages.map((s) => s.state)).toEqual([
      "running",
      "pending",
      "pending",
    ]);
  });

  it("journal and outbox grow in LOCKSTEP (one outbox event per journal entry)", () => {
    const { runtime, stack } = makeRuntime();
    runtime.createMission({
      ctx: CTX_A,
      definition: SEQUENTIAL_DEF,
      missionId: "msn_0000000001",
      now: NOW,
    });
    runtime.startMission({ ctx: CTX_A, missionId: "msn_0000000001", now: NOW + 1 });
    const entries = runtime.journalEntries(CTX_A, "msn_0000000001");
    const events = stack.outbox.eventsFor(CTX_A);
    expect(entries.ok && entries.value).toHaveLength(4);
    expect(events).toHaveLength(4);
    expect(events.map((e) => e.idempotencyKey)).toEqual([
      `mj::${TENANT_A}::msn_0000000001::1`,
      `mj::${TENANT_A}::msn_0000000001::2`,
      `mj::${TENANT_A}::msn_0000000001::3`,
      `mj::${TENANT_A}::msn_0000000001::4`,
    ]);
    expect(events.map((e) => e.type)).toEqual([
      "mission.mission-created",
      "mission.mission-started",
      "mission.stage-started",
      "mission.work-order-issued",
    ]);
  });

  it("idempotent re-start: duplicate=true and NO new journal entries", () => {
    const { runtime } = makeRuntime();
    runtime.createMission({
      ctx: CTX_A,
      definition: SEQUENTIAL_DEF,
      missionId: "msn_0000000001",
      now: NOW,
    });
    runtime.startMission({ ctx: CTX_A, missionId: "msn_0000000001", now: NOW + 1 });
    const again = runtime.startMission({
      ctx: CTX_A,
      missionId: "msn_0000000001",
      now: NOW + 2,
    });
    expect(again.ok && again.value.duplicate).toBe(true);
    const entries = runtime.journalEntries(CTX_A, "msn_0000000001");
    expect(entries.ok && entries.value).toHaveLength(4); // unchanged
  });

  it("THE ATOMIC BOUNDARY — a rejected submit leaves NO journal and NO outbox residue", () => {
    const missionId = "msn_0000000001";
    const { runtime, stack } = makeRuntime({
      failKeys: new Set([workOrderIdempotencyKey(missionId, "ingest")]),
    });
    runtime.createMission({ ctx: CTX_A, definition: SEQUENTIAL_DEF, missionId, now: NOW });
    const before = runtime.journalEntries(CTX_A, missionId);
    const beforeCount = before.ok ? before.value.length : 0;
    const started = runtime.startMission({ ctx: CTX_A, missionId, now: NOW + 1 });
    expect(started).toEqual({ ok: false, reason: "command-submit-rejected" });
    // Rollback: nothing was appended anywhere.
    const after = runtime.journalEntries(CTX_A, missionId);
    expect(after.ok && after.value).toHaveLength(beforeCount);
    expect(stack.outbox.eventsFor(CTX_A)).toHaveLength(beforeCount);
    // The mission is still pending — the failed start did not half-apply.
    const view = runtime.missionView(CTX_A, missionId);
    expect(view.ok && view.value.state).toBe("pending");
  });

  it("a parallel first block issues ALL member stages together", () => {
    const { runtime, stack } = makeRuntime();
    runtime.createMission({
      ctx: CTX_A,
      definition: PARALLEL_DEF,
      missionId: "msn_0000000002",
      now: NOW,
    });
    const started = runtime.startMission({
      ctx: CTX_A,
      missionId: "msn_0000000002",
      now: NOW + 1,
    });
    expect(started.ok && started.value.view.stages.map((s) => s.state)).toEqual([
      "running",
      "running",
      "running",
      "pending",
    ]);
    expect(stack.port.calls.map((c) => c.idempotencyKey)).toEqual([
      "wo:msn_0000000002:fetch-a",
      "wo:msn_0000000002:fetch-b",
      "wo:msn_0000000002:fetch-c",
    ]);
    // mission-started + 3 × (stage-started + work-order-issued) = 7 entries.
    const entries = runtime.journalEntries(CTX_A, "msn_0000000002");
    expect(entries.ok && entries.value).toHaveLength(8);
  });

  it("the work-order idempotency key is the deterministic wo:{missionId}:{stageId}", () => {
    expect(workOrderIdempotencyKey("msn_0000000001", "ingest")).toBe(
      "wo:msn_0000000001:ingest",
    );
    const { runtime, stack } = makeRuntime();
    runtime.createMission({
      ctx: CTX_A,
      definition: SEQUENTIAL_DEF,
      missionId: "msn_0000000007",
      now: NOW,
    });
    runtime.startMission({ ctx: CTX_A, missionId: "msn_0000000007", now: NOW + 1 });
    expect(stack.port.calls[0]?.idempotencyKey).toBe(
      workOrderIdempotencyKey("msn_0000000007", "ingest"),
    );
  });
});

describe("MissionRuntime — recordCheckpoint", () => {
  function runningMission() {
    const { runtime } = makeRuntime();
    runtime.createMission({
      ctx: CTX_A,
      definition: SEQUENTIAL_DEF,
      missionId: "msn_0000000001",
      now: NOW,
    });
    runtime.startMission({ ctx: CTX_A, missionId: "msn_0000000001", now: NOW + 1 });
    return { runtime, missionId: "msn_0000000001" };
  }

  it("records a checkpoint on a running stage and advances lastCheckpoint", () => {
    const { runtime, missionId } = runningMission();
    const cp = runtime.recordCheckpoint({
      ctx: CTX_A,
      missionId,
      stageId: "ingest",
      checkpointId: "cp-1",
      now: NOW + 2,
    });
    expect(cp.ok && cp.value.view.lastCheckpoint).toEqual({
      stageId: "ingest",
      checkpointId: "cp-1",
      seq: 5,
    });
    expect(cp.ok && cp.value.view.stages[0]?.checkpoints.map((c) => c.checkpointId)).toEqual([
      "cp-1",
    ]);
  });

  it("recording the SAME checkpointId is idempotent (duplicate, no new entry)", () => {
    const { runtime, missionId } = runningMission();
    runtime.recordCheckpoint({
      ctx: CTX_A,
      missionId,
      stageId: "ingest",
      checkpointId: "cp-1",
      now: NOW + 2,
    });
    const again = runtime.recordCheckpoint({
      ctx: CTX_A,
      missionId,
      stageId: "ingest",
      checkpointId: "cp-1",
      now: NOW + 3,
    });
    expect(again.ok && again.value.duplicate).toBe(true);
    const entries = runtime.journalEntries(CTX_A, missionId);
    expect(entries.ok && entries.value).toHaveLength(5);
  });

  it("an unknown stage is rejected: unknown-stage", () => {
    const { runtime, missionId } = runningMission();
    expect(
      runtime.recordCheckpoint({
        ctx: CTX_A,
        missionId,
        stageId: "nope",
        checkpointId: "cp-1",
        now: NOW + 2,
      }),
    ).toEqual({ ok: false, reason: "unknown-stage" });
  });

  it("a checkpoint on a non-running stage is rejected: stage-not-running", () => {
    const { runtime, missionId } = runningMission();
    expect(
      runtime.recordCheckpoint({
        ctx: CTX_A,
        missionId,
        stageId: "analyze", // still pending
        checkpointId: "cp-1",
        now: NOW + 2,
      }),
    ).toEqual({ ok: false, reason: "stage-not-running" });
  });

  it("a checkpoint on a suspended mission is rejected: illegal-transition", () => {
    const { runtime, missionId } = runningMission();
    runtime.suspendMission({ ctx: CTX_A, missionId, now: NOW + 2 });
    expect(
      runtime.recordCheckpoint({
        ctx: CTX_A,
        missionId,
        stageId: "ingest",
        checkpointId: "cp-1",
        now: NOW + 3,
      }),
    ).toEqual({ ok: false, reason: "illegal-transition" });
  });

  it("an empty checkpointId is rejected: invalid-input", () => {
    const { runtime, missionId } = runningMission();
    expect(
      runtime.recordCheckpoint({
        ctx: CTX_A,
        missionId,
        stageId: "ingest",
        checkpointId: "",
        now: NOW + 2,
      }),
    ).toEqual({ ok: false, reason: "invalid-input" });
  });
});

describe("MissionRuntime — completeStage", () => {
  function runningMission() {
    const { runtime, stack } = makeRuntime();
    runtime.createMission({
      ctx: CTX_A,
      definition: SEQUENTIAL_DEF,
      missionId: "msn_0000000001",
      now: NOW,
    });
    runtime.startMission({ ctx: CTX_A, missionId: "msn_0000000001", now: NOW + 1 });
    return { runtime, stack, missionId: "msn_0000000001" };
  }

  it("completing a stage CHAINS issuance of the next ready stage", () => {
    const { runtime, stack, missionId } = runningMission();
    const completed = runtime.completeStage({
      ctx: CTX_A,
      missionId,
      stageId: "ingest",
      now: NOW + 2,
    });
    expect(completed.ok && completed.value.view.stages.map((s) => s.state)).toEqual([
      "completed",
      "running",
      "pending",
    ]);
    // New work order for the newly ready stage.
    expect(stack.port.calls.map((c) => c.idempotencyKey)).toEqual([
      "wo:msn_0000000001:ingest",
      "wo:msn_0000000001:analyze",
    ]);
    const entries = runtime.journalEntries(CTX_A, missionId);
    expect(entries.ok && entries.value).toHaveLength(7); // 4 + completed + started + wo
  });

  it("re-completing a completed stage is idempotent (duplicate, no new entries)", () => {
    const { runtime, missionId } = runningMission();
    runtime.completeStage({ ctx: CTX_A, missionId, stageId: "ingest", now: NOW + 2 });
    const again = runtime.completeStage({
      ctx: CTX_A,
      missionId,
      stageId: "ingest",
      now: NOW + 3,
    });
    expect(again.ok && again.value.duplicate).toBe(true);
    const entries = runtime.journalEntries(CTX_A, missionId);
    expect(entries.ok && entries.value).toHaveLength(7);
  });

  it("completing the FINAL stage emits mission-completed (terminal)", () => {
    const { runtime, stack, missionId } = runningMission();
    runtime.completeStage({ ctx: CTX_A, missionId, stageId: "ingest", now: NOW + 2 });
    runtime.completeStage({ ctx: CTX_A, missionId, stageId: "analyze", now: NOW + 3 });
    const final = runtime.completeStage({
      ctx: CTX_A,
      missionId,
      stageId: "report",
      now: NOW + 4,
    });
    expect(final.ok && final.value.view.state).toBe("completed");
    expect(final.ok && final.value.view.endedAt).toBe(NOW + 4);
    expect(final.ok && final.value.view.stages.every((s) => s.state === "completed")).toBe(
      true,
    );
    const entries = runtime.journalEntries(CTX_A, missionId);
    expect(entries.ok && entries.value).toHaveLength(12);
    expect(entries.ok && entries.value[11]?.event.kind).toBe("mission-completed");
    expect(stack.port.distinctSubmits()).toBe(3);
    // Terminal: nothing further is legal.
    expect(
      runtime.completeStage({ ctx: CTX_A, missionId, stageId: "report", now: NOW + 5 }),
    ).toMatchObject({ ok: true, value: { duplicate: true } });
  });

  it("rejections: unknown-stage / stage-not-running / illegal-transition (suspended)", () => {
    const { runtime, missionId } = runningMission();
    expect(
      runtime.completeStage({ ctx: CTX_A, missionId, stageId: "nope", now: NOW + 2 }),
    ).toEqual({ ok: false, reason: "unknown-stage" });
    expect(
      runtime.completeStage({ ctx: CTX_A, missionId, stageId: "analyze", now: NOW + 2 }),
    ).toEqual({ ok: false, reason: "stage-not-running" });
    runtime.suspendMission({ ctx: CTX_A, missionId, now: NOW + 3 });
    expect(
      runtime.completeStage({ ctx: CTX_A, missionId, stageId: "ingest", now: NOW + 4 }),
    ).toEqual({ ok: false, reason: "illegal-transition" });
  });
});

describe("MissionRuntime — failStage", () => {
  function runningMission() {
    const { runtime } = makeRuntime();
    runtime.createMission({
      ctx: CTX_A,
      definition: SEQUENTIAL_DEF,
      missionId: "msn_0000000001",
      now: NOW,
    });
    runtime.startMission({ ctx: CTX_A, missionId: "msn_0000000001", now: NOW + 1 });
    return { runtime, missionId: "msn_0000000001" };
  }

  it("failing a running stage fails the mission terminally", () => {
    const { runtime, missionId } = runningMission();
    const failed = runtime.failStage({
      ctx: CTX_A,
      missionId,
      stageId: "ingest",
      reason: "sensor-dead",
      now: NOW + 2,
    });
    expect(failed.ok && failed.value.view.state).toBe("failed");
    expect(failed.ok && failed.value.view.endedAt).toBe(NOW + 2);
    expect(failed.ok && failed.value.view.stages[0]?.state).toBe("failed");
    const entries = runtime.journalEntries(CTX_A, missionId);
    expect(entries.ok && entries.value[5]?.event.kind).toBe("mission-failed");
    expect(
      runtime.failStage({ ctx: CTX_A, missionId, stageId: "ingest", reason: "x", now: NOW + 3 }),
    ).toEqual({ ok: false, reason: "stage-not-running" });
  });

  it("rejections: empty reason → invalid-input; pending stage → stage-not-running", () => {
    const { runtime, missionId } = runningMission();
    expect(
      runtime.failStage({ ctx: CTX_A, missionId, stageId: "ingest", reason: "", now: NOW + 2 }),
    ).toEqual({ ok: false, reason: "invalid-input" });
    expect(
      runtime.failStage({ ctx: CTX_A, missionId, stageId: "analyze", reason: "x", now: NOW + 2 }),
    ).toEqual({ ok: false, reason: "stage-not-running" });
    expect(
      runtime.failStage({ ctx: CTX_A, missionId, stageId: "nope", reason: "x", now: NOW + 2 }),
    ).toEqual({ ok: false, reason: "unknown-stage" });
  });
});

describe("MissionRuntime — suspend / resume (checkpoint semantics)", () => {
  function suspendedWithInFlight() {
    const { runtime, stack } = makeRuntime();
    const missionId = "msn_0000000001";
    runtime.createMission({ ctx: CTX_A, definition: SEQUENTIAL_DEF, missionId, now: NOW });
    runtime.startMission({ ctx: CTX_A, missionId, now: NOW + 1 });
    runtime.recordCheckpoint({
      ctx: CTX_A,
      missionId,
      stageId: "ingest",
      checkpointId: "cp-1",
      now: NOW + 2,
    });
    runtime.completeStage({ ctx: CTX_A, missionId, stageId: "ingest", now: NOW + 3 });
    runtime.recordCheckpoint({
      ctx: CTX_A,
      missionId,
      stageId: "analyze",
      checkpointId: "cp-a1",
      now: NOW + 4,
    });
    runtime.suspendMission({ ctx: CTX_A, missionId, reason: "operator-pause", now: NOW + 5 });
    return { runtime, stack, missionId };
  }

  it("suspend: running → suspended (idempotent; in-flight stage keeps its state)", () => {
    const { runtime, missionId } = suspendedWithInFlight();
    const view = runtime.missionView(CTX_A, missionId);
    expect(view.ok && view.value.state).toBe("suspended");
    expect(view.ok && view.value.suspendedAt).toBe(NOW + 5);
    expect(view.ok && view.value.stages[1]?.state).toBe("running"); // in-flight paused
    expect(view.ok && view.value.stages[1]?.checkpoints.map((c) => c.checkpointId)).toEqual([
      "cp-a1",
    ]);
    const again = runtime.suspendMission({ ctx: CTX_A, missionId, now: NOW + 6 });
    expect(again.ok && again.value.duplicate).toBe(true);
    const entries = runtime.journalEntries(CTX_A, missionId);
    expect(entries.ok && entries.value).toHaveLength(10); // no new entry
  });

  it("THE RESUME TEST — resumes from the last checkpoint; re-issues ONLY the in-flight stage with the SAME key", () => {
    const { runtime, stack, missionId } = suspendedWithInFlight();
    const resumed = runtime.resumeMission({ ctx: CTX_A, missionId, now: NOW + 6 });
    expect(resumed.ok && resumed.value.view.state).toBe("running");
    expect(resumed.ok && resumed.value.view.resumedAt).toBe(NOW + 6);
    // The resume event carries the last recorded checkpoint.
    const entries = runtime.journalEntries(CTX_A, missionId);
    const resumeEntry = entries.ok ? entries.value[entries.value.length - 2] : undefined;
    expect(resumeEntry?.event.kind).toBe("mission-resumed");
    expect(resumeEntry?.event.stageId).toBe("analyze");
    expect(resumeEntry?.event.checkpointId).toBe("cp-a1");
    // The in-flight stage's work order was re-submitted with the SAME key →
    // the port DEDUPED it (duplicate) — never re-executed.
    const analyzeKey = workOrderIdempotencyKey(missionId, "analyze");
    expect(stack.port.submitsFor(analyzeKey)).toBe(2);
    const analyzeCommandIds = new Set(
      stack.port.calls.filter((c) => c.idempotencyKey === analyzeKey).map((c) => c.commandId),
    );
    expect(analyzeCommandIds.size).toBe(1);
    const last = entries.ok ? entries.value[entries.value.length - 1] : undefined;
    expect(last?.event.kind).toBe("work-order-issued");
    expect(last?.event.duplicate).toBe(true);
    expect(last?.event.attempt).toBe(2);
    // The view: analyze still running, now with TWO work-order records.
    const view = resumed.ok ? resumed.value.view : null;
    expect(view?.stages[1]?.state).toBe("running");
    expect(view?.stages[1]?.workOrders.map((w) => w.attempt)).toEqual([1, 2]);
    expect(view?.stages[1]?.checkpoints.map((c) => c.checkpointId)).toEqual(["cp-a1"]);
  });

  it("completed stages are NEVER re-issued on resume", () => {
    const { runtime, stack, missionId } = suspendedWithInFlight();
    runtime.resumeMission({ ctx: CTX_A, missionId, now: NOW + 6 });
    expect(stack.port.submitsFor(workOrderIdempotencyKey(missionId, "ingest"))).toBe(1);
    expect(stack.port.distinctSubmits()).toBe(2); // ingest + analyze, nothing more
  });

  it("THE RESUME STORM — 50 suspend/resume cycles → ONE distinct command per stage", () => {
    const { runtime, stack, missionId } = suspendedWithInFlight();
    for (let i = 0; i < 50; i++) {
      runtime.suspendMission({ ctx: CTX_A, missionId, now: NOW + 10 + i * 2 });
      runtime.resumeMission({ ctx: CTX_A, missionId, now: NOW + 11 + i * 2 });
    }
    const analyzeKey = workOrderIdempotencyKey(missionId, "analyze");
    expect(stack.port.submitsFor(analyzeKey)).toBe(51); // 1 initial + 50 resumes
    expect(stack.port.distinctSubmits()).toBe(2); // exactly two distinct work orders
    const analyzeIds = new Set(
      stack.port.calls.filter((c) => c.idempotencyKey === analyzeKey).map((c) => c.commandId),
    );
    expect(analyzeIds.size).toBe(1); // ONE execution identity, forever
    const view = runtime.missionView(CTX_A, missionId);
    expect(view.ok && view.value.state).toBe("running");
    expect(view.ok && view.value.stages[1]?.workOrders).toHaveLength(51);
  });

  it("resume rejections: not-suspended from running/pending; illegal-transition from terminal", () => {
    const { runtime, missionId } = suspendedWithInFlight();
    runtime.resumeMission({ ctx: CTX_A, missionId, now: NOW + 6 }); // now running
    expect(runtime.resumeMission({ ctx: CTX_A, missionId, now: NOW + 7 })).toEqual({
      ok: false,
      reason: "not-suspended",
    });
    const { runtime: runtime2 } = makeRuntime();
    runtime2.createMission({
      ctx: CTX_A,
      definition: SEQUENTIAL_DEF,
      missionId: "msn_0000000002",
      now: NOW,
    });
    expect(
      runtime2.resumeMission({ ctx: CTX_A, missionId: "msn_0000000002", now: NOW + 1 }),
    ).toEqual({ ok: false, reason: "not-suspended" });
    const { runtime: runtime3 } = makeRuntime();
    completedMission(runtime3, "msn_0000000003", NOW);
    expect(
      runtime3.resumeMission({ ctx: CTX_A, missionId: "msn_0000000003", now: NOW + 10 }),
    ).toEqual({ ok: false, reason: "illegal-transition" });
  });

  it("JOURNAL REPLAY == FOLDED STATE through the runtime path", () => {
    const { runtime, missionId } = suspendedWithInFlight();
    runtime.resumeMission({ ctx: CTX_A, missionId, now: NOW + 6 });
    runtime.completeStage({ ctx: CTX_A, missionId, stageId: "analyze", now: NOW + 7 });
    runtime.completeStage({ ctx: CTX_A, missionId, stageId: "report", now: NOW + 8 });
    const entriesResult = runtime.journalEntries(CTX_A, missionId);
    expect(entriesResult.ok).toBe(true);
    if (!entriesResult.ok) return;
    const entries = entriesResult.value;
    expect(entries.length).toBeGreaterThanOrEqual(12);

    // Replay the WHOLE journal into a fresh store, verbatim.
    const { stack: freshStack } = makeRuntime();
    const freshJournal = new MissionJournal(freshStack.store);
    const replayed = freshJournal.replay({ ctx: CTX_A, missionId, entries });
    expect(replayed).toEqual({ ok: true, value: { replayed: entries.length } });
    const replayedEntries = freshJournal.committedEntries(CTX_A, missionId);
    expect(replayedEntries).toEqual(entries); // digests + seqs preserved

    // Fold of the replayed journal == the runtime's live view — exactly.
    const validated = validateMissionDefinition({ definition: SEQUENTIAL_DEF });
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    const liveView = runtime.missionView(CTX_A, missionId);
    expect(foldMission(validated.value, replayedEntries)).toEqual(
      liveView.ok ? liveView.value : null,
    );
  });
});

describe("MissionRuntime — cancelMission", () => {
  it("cancel from running: in-flight stage cancelled, untouched stages stay pending", () => {
    const { runtime } = makeRuntime();
    const missionId = "msn_0000000001";
    runtime.createMission({ ctx: CTX_A, definition: SEQUENTIAL_DEF, missionId, now: NOW });
    runtime.startMission({ ctx: CTX_A, missionId, now: NOW + 1 });
    const cancelled = runtime.cancelMission({
      ctx: CTX_A,
      missionId,
      reason: "operator",
      now: NOW + 2,
    });
    expect(cancelled.ok && cancelled.value.view.state).toBe("cancelled");
    expect(cancelled.ok && cancelled.value.view.endedAt).toBe(NOW + 2);
    expect(cancelled.ok && cancelled.value.view.stages.map((s) => s.state)).toEqual([
      "cancelled",
      "pending",
      "pending",
    ]);
    const again = runtime.cancelMission({ ctx: CTX_A, missionId, now: NOW + 3 });
    expect(again.ok && again.value.duplicate).toBe(true);
  });

  it("cancel from suspended and from pending is legal", () => {
    const { runtime } = makeRuntime();
    const missionId = "msn_0000000002";
    runtime.createMission({ ctx: CTX_A, definition: SEQUENTIAL_DEF, missionId, now: NOW });
    runtime.startMission({ ctx: CTX_A, missionId, now: NOW + 1 });
    runtime.suspendMission({ ctx: CTX_A, missionId, now: NOW + 2 });
    const fromSuspended = runtime.cancelMission({ ctx: CTX_A, missionId, now: NOW + 3 });
    expect(fromSuspended.ok && fromSuspended.value.view.state).toBe("cancelled");

    const { runtime: runtime2 } = makeRuntime();
    const pendingId = "msn_0000000003";
    runtime2.createMission({ ctx: CTX_A, definition: SEQUENTIAL_DEF, missionId: pendingId, now: NOW });
    const fromPending = runtime2.cancelMission({ ctx: CTX_A, missionId: pendingId, now: NOW + 1 });
    expect(fromPending.ok && fromPending.value.view.state).toBe("cancelled");
  });

  it("cancel from completed/failed is illegal-transition", () => {
    const { runtime } = makeRuntime();
    const doneId = completedMission(runtime, "msn_0000000004", NOW);
    expect(runtime.cancelMission({ ctx: CTX_A, missionId: doneId, now: NOW + 10 })).toEqual({
      ok: false,
      reason: "illegal-transition",
    });
    const { runtime: runtime2 } = makeRuntime();
    const failedId = "msn_0000000005";
    runtime2.createMission({ ctx: CTX_A, definition: SEQUENTIAL_DEF, missionId: failedId, now: NOW });
    runtime2.startMission({ ctx: CTX_A, missionId: failedId, now: NOW + 1 });
    runtime2.failStage({ ctx: CTX_A, missionId: failedId, stageId: "ingest", reason: "x", now: NOW + 2 });
    expect(
      runtime2.cancelMission({ ctx: CTX_A, missionId: failedId, now: NOW + 3 }),
    ).toEqual({ ok: false, reason: "illegal-transition" });
  });
});

describe("MissionRuntime — THE legal-transition matrix (every state × every op)", () => {
  type Op = "start" | "suspend" | "resume" | "cancel";
  const ops: ReadonlyArray<Op> = ["start", "suspend", "resume", "cancel"];

  function missionInState(state: string, n: number): { runtime: MissionRuntime; id: string } {
    const { runtime } = makeRuntime();
    const id = `msn_mat_${n}_${state}`;
    runtime.createMission({ ctx: CTX_A, definition: SEQUENTIAL_DEF, missionId: id, now: NOW });
    if (state === "pending") return { runtime, id };
    runtime.startMission({ ctx: CTX_A, missionId: id, now: NOW + 1 });
    if (state === "running") return { runtime, id };
    if (state === "suspended") {
      runtime.suspendMission({ ctx: CTX_A, missionId: id, now: NOW + 2 });
      return { runtime, id };
    }
    if (state === "cancelled") {
      runtime.cancelMission({ ctx: CTX_A, missionId: id, now: NOW + 2 });
      return { runtime, id };
    }
    if (state === "failed") {
      runtime.failStage({ ctx: CTX_A, missionId: id, stageId: "ingest", reason: "x", now: NOW + 2 });
      return { runtime, id };
    }
    // completed
    runtime.completeStage({ ctx: CTX_A, missionId: id, stageId: "ingest", now: NOW + 2 });
    runtime.completeStage({ ctx: CTX_A, missionId: id, stageId: "analyze", now: NOW + 3 });
    runtime.completeStage({ ctx: CTX_A, missionId: id, stageId: "report", now: NOW + 4 });
    return { runtime, id };
  }

  const expectations: Readonly<
    Record<string, Record<Op, { ok: true; duplicate: boolean } | { ok: false; reason: string }>>
  > = {
    pending: {
      start: { ok: true, duplicate: false },
      suspend: { ok: false, reason: "illegal-transition" },
      resume: { ok: false, reason: "not-suspended" },
      cancel: { ok: true, duplicate: false },
    },
    running: {
      start: { ok: true, duplicate: true },
      suspend: { ok: true, duplicate: false },
      resume: { ok: false, reason: "not-suspended" },
      cancel: { ok: true, duplicate: false },
    },
    suspended: {
      start: { ok: false, reason: "illegal-transition" },
      suspend: { ok: true, duplicate: true },
      resume: { ok: true, duplicate: false },
      cancel: { ok: true, duplicate: false },
    },
    completed: {
      start: { ok: false, reason: "illegal-transition" },
      suspend: { ok: false, reason: "illegal-transition" },
      resume: { ok: false, reason: "illegal-transition" },
      cancel: { ok: false, reason: "illegal-transition" },
    },
    failed: {
      start: { ok: false, reason: "illegal-transition" },
      suspend: { ok: false, reason: "illegal-transition" },
      resume: { ok: false, reason: "illegal-transition" },
      cancel: { ok: false, reason: "illegal-transition" },
    },
    cancelled: {
      start: { ok: false, reason: "illegal-transition" },
      suspend: { ok: false, reason: "illegal-transition" },
      resume: { ok: false, reason: "illegal-transition" },
      cancel: { ok: true, duplicate: true },
    },
  };

  let n = 0;
  for (const state of Object.keys(expectations)) {
    for (const op of ops) {
      const expected = expectations[state]?.[op];
      it(`${state} --${op}--> ${JSON.stringify(expected)}`, () => {
        expect(expected).toBeDefined();
        const { runtime, id } = missionInState(state, (n += 1));
        const result =
          op === "start"
            ? runtime.startMission({ ctx: CTX_A, missionId: id, now: NOW + 50 })
            : op === "suspend"
              ? runtime.suspendMission({ ctx: CTX_A, missionId: id, now: NOW + 50 })
              : op === "resume"
                ? runtime.resumeMission({ ctx: CTX_A, missionId: id, now: NOW + 50 })
                : runtime.cancelMission({ ctx: CTX_A, missionId: id, now: NOW + 50 });
        if (expected && expected.ok) {
          expect(result.ok).toBe(true);
          if (result.ok) expect(result.value.duplicate).toBe(expected.duplicate);
        } else {
          expect(result).toEqual({ ok: false, reason: expected?.reason });
        }
      });
    }
  }
});

describe("MissionRuntime — guards", () => {
  const REJECT_PREDICATES: GuardEvaluator = {
    evaluate: ({ guard }) => guard.kind === "capability",
  };

  it("a rejected guard records guard-rejected and leaves the stage pending (NO work order)", () => {
    const { runtime, stack } = makeRuntime({ guards: REJECT_PREDICATES });
    const missionId = "msn_0000000001";
    runtime.createMission({ ctx: CTX_A, definition: GUARDED_DEF, missionId, now: NOW });
    runtime.startMission({ ctx: CTX_A, missionId, now: NOW + 1 });
    // ingest (capability guard) issued normally.
    expect(stack.port.calls.map((c) => c.idempotencyKey)).toEqual([
      "wo:msn_0000000001:ingest",
    ]);
    // Completing ingest makes analyze ready; its predicate guard REJECTS.
    const completed = runtime.completeStage({
      ctx: CTX_A,
      missionId,
      stageId: "ingest",
      now: NOW + 2,
    });
    expect(completed.ok && completed.value.view.stages[1]?.state).toBe("pending");
    expect(stack.port.calls).toHaveLength(1); // NO submit for analyze
    const entries = runtime.journalEntries(CTX_A, missionId);
    const last = entries.ok ? entries.value[entries.value.length - 1] : undefined;
    expect(last?.event.kind).toBe("guard-rejected");
    expect(last?.event.stageId).toBe("analyze");
    expect(last?.event.reason).toBe("predicate:data-ready");
    // The mission itself keeps running; analyze was simply not issued.
    expect(completed.ok && completed.value.view.state).toBe("running");
  });

  it("passing guards issue normally (ALLOW_ALL default)", () => {
    const { runtime, stack } = makeRuntime();
    const missionId = "msn_0000000002";
    runtime.createMission({ ctx: CTX_A, definition: GUARDED_DEF, missionId, now: NOW });
    runtime.startMission({ ctx: CTX_A, missionId, now: NOW + 1 });
    runtime.completeStage({ ctx: CTX_A, missionId, stageId: "ingest", now: NOW + 2 });
    runtime.completeStage({ ctx: CTX_A, missionId, stageId: "analyze", now: NOW + 3 });
    const view = runtime.missionView(CTX_A, missionId);
    expect(view.ok && view.value.state).toBe("completed");
    expect(stack.port.distinctSubmits()).toBe(2);
  });
});

describe("MissionRuntime — tenant fail-closed (A8)", () => {
  it("cross-tenant access to a mission is mission-not-found for EVERY operation", () => {
    const { runtime, stack } = makeRuntime();
    const missionId = "msn_0000000001";
    runtime.createMission({ ctx: CTX_A, definition: SEQUENTIAL_DEF, missionId, now: NOW });
    runtime.startMission({ ctx: CTX_A, missionId, now: NOW + 1 });
    expect(runtime.missionView(CTX_B, missionId)).toEqual({
      ok: false,
      reason: "mission-not-found",
    });
    expect(
      runtime.startMission({ ctx: CTX_B, missionId, now: NOW + 2 }),
    ).toEqual({ ok: false, reason: "mission-not-found" });
    expect(
      runtime.completeStage({ ctx: CTX_B, missionId, stageId: "ingest", now: NOW + 2 }),
    ).toEqual({ ok: false, reason: "mission-not-found" });
    expect(
      runtime.suspendMission({ ctx: CTX_B, missionId, now: NOW + 2 }),
    ).toEqual({ ok: false, reason: "mission-not-found" });
    expect(
      runtime.cancelMission({ ctx: CTX_B, missionId, now: NOW + 2 }),
    ).toEqual({ ok: false, reason: "mission-not-found" });
    expect(runtime.journalEntries(CTX_B, missionId)).toEqual({
      ok: false,
      reason: "mission-not-found",
    });
    // No leak through the outbox either — tenant B drains NOTHING.
    expect(stack.outbox.eventsFor(CTX_B)).toEqual([]);
    expect(stack.outbox.pending({ ctx: CTX_B, now: NOW + 100 })).toEqual([]);
  });

  it("the SAME mission id under two tenants are fully independent missions", () => {
    const { runtime } = makeRuntime();
    const shared = "msn_shared000001";
    runtime.createMission({ ctx: CTX_A, definition: SEQUENTIAL_DEF, missionId: shared, now: NOW });
    runtime.createMission({ ctx: CTX_B, definition: SEQUENTIAL_DEF, missionId: shared, now: NOW });
    runtime.startMission({ ctx: CTX_A, missionId: shared, now: NOW + 1 });
    const viewA = runtime.missionView(CTX_A, shared);
    const viewB = runtime.missionView(CTX_B, shared);
    expect(viewA.ok && viewA.value.state).toBe("running");
    expect(viewA.ok && viewA.value.journalLength).toBe(4);
    expect(viewB.ok && viewB.value.state).toBe("pending");
    expect(viewB.ok && viewB.value.journalLength).toBe(1);
  });
});

describe("MissionRuntime — determinism", () => {
  it("two identical stacks produce byte-identical journal digests", () => {
    function run(missionId: string): ReadonlyArray<string> {
      const { runtime } = makeRuntime();
      runtime.createMission({ ctx: CTX_A, definition: SEQUENTIAL_DEF, missionId, now: NOW });
      runtime.startMission({ ctx: CTX_A, missionId, now: NOW + 1 });
      runtime.recordCheckpoint({
        ctx: CTX_A,
        missionId,
        stageId: "ingest",
        checkpointId: "cp-1",
        now: NOW + 2,
      });
      runtime.completeStage({ ctx: CTX_A, missionId, stageId: "ingest", now: NOW + 3 });
      runtime.suspendMission({ ctx: CTX_A, missionId, now: NOW + 4 });
      runtime.resumeMission({ ctx: CTX_A, missionId, now: NOW + 5 });
      const entries = runtime.journalEntries(CTX_A, missionId);
      return entries.ok ? entries.value.map((e) => e.digest) : [];
    }
    expect(run("msn_0000000001")).toEqual(run("msn_0000000001"));
    expect(run("msn_0000000001")).not.toEqual(run("msn_0000000002"));
  });
});

describe("MissionRuntime — full parallel lifecycle (end to end)", () => {
  it("create → start(3 parallel) → complete a,b,c → merge issued → completed", () => {
    const { runtime, stack } = makeRuntime();
    const missionId = "msn_0000000003";
    runtime.createMission({ ctx: CTX_A, definition: PARALLEL_DEF, missionId, now: NOW });
    expect(runtime.journalEntries(CTX_A, missionId).ok && 1).toBe(1);

    runtime.startMission({ ctx: CTX_A, missionId, now: NOW + 1 });
    let entries = runtime.journalEntries(CTX_A, missionId);
    expect(entries.ok && entries.value).toHaveLength(8);

    runtime.completeStage({ ctx: CTX_A, missionId, stageId: "fetch-a", now: NOW + 2 });
    runtime.completeStage({ ctx: CTX_A, missionId, stageId: "fetch-b", now: NOW + 3 });
    entries = runtime.journalEntries(CTX_A, missionId);
    expect(entries.ok && entries.value).toHaveLength(10);

    // Completing the LAST parallel member unlocks the merge stage.
    runtime.completeStage({ ctx: CTX_A, missionId, stageId: "fetch-c", now: NOW + 4 });
    entries = runtime.journalEntries(CTX_A, missionId);
    expect(entries.ok && entries.value).toHaveLength(13);
    const view = runtime.missionView(CTX_A, missionId);
    expect(view.ok && view.value.stages.map((s) => s.state)).toEqual([
      "completed",
      "completed",
      "completed",
      "running",
    ]);

    runtime.completeStage({ ctx: CTX_A, missionId, stageId: "merge", now: NOW + 5 });
    const final = runtime.missionView(CTX_A, missionId);
    expect(final.ok && final.value.state).toBe("completed");
    expect(final.ok && final.value.stages.every((s) => s.state === "completed")).toBe(true);
    expect(stack.port.calls.map((c) => c.idempotencyKey)).toEqual([
      "wo:msn_0000000003:fetch-a",
      "wo:msn_0000000003:fetch-b",
      "wo:msn_0000000003:fetch-c",
      "wo:msn_0000000003:merge",
    ]);
    // Dual-write lockstep held across the whole lifecycle.
    expect(stack.outbox.eventsFor(CTX_A)).toHaveLength(15);
  });
});
