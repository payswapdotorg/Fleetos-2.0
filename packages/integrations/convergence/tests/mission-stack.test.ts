/**
 * @fleetos/convergence — mission-stack composition tests (F231).
 *
 * Bind the REAL implementations at the sanctioned composition site:
 * MissionRuntime (mission) + CommandQueue via queueAsSubmitPort
 * (control-plane) + ExecutionLedger + the kernel driver/outbox/UnitOfWork.
 * Deterministic scenarios only; `now` always an explicit input.
 */

import { describe, expect, it } from "vitest";
import { makeTenantContext } from "@fleetos/kernel";
import {
  MissionJournal,
  MissionRuntime,
  foldMission,
  validateMissionDefinition,
} from "@fleetos/mission";
import { assembleMissionStack, driveMission } from "../src/mission-assembly.js";
import {
  AGENT_A,
  ctxFor,
  NOW,
  TENANT_A,
  TENANT_B,
  THREE_STAGE_DEFINITION,
} from "./helpers.js";

const MISSION_ID = "msn_testmission01";

function happyScenario() {
  return {
    ctx: ctxFor(TENANT_A),
    definition: THREE_STAGE_DEFINITION,
    missionId: MISSION_ID,
    startsAt: NOW,
    ticks: [NOW + 1_000, NOW + 2_000, NOW + 3_000],
    stageOutcomes: {
      ingest: [{ kind: "complete" as const }],
      analyze: [{ kind: "complete" as const }],
      report: [{ kind: "complete" as const }],
    },
  };
}

describe("mission stack composition", () => {
  it("assembles a fully-wired stack from the real implementations", () => {
    const stack = assembleMissionStack();
    expect(stack.runtime).toBeInstanceOf(MissionRuntime);
    expect(stack.commandSubmit.submit).toBeTypeOf("function");
    expect(stack.queue).toBeTypeOf("object");
    expect(stack.ledger).toBeTypeOf("object");
    expect(stack.kernel.unitOfWork.open).toBeTypeOf("function");
    expect(stack.kernel.outbox).toBeTypeOf("object");
  });

  it("issues work orders through the bus and completes a 3-stage mission deterministically", () => {
    const stack = assembleMissionStack();
    const driven = driveMission(stack, happyScenario());
    expect(driven.ok).toBe(true);
    if (!driven.ok) return;
    const { state } = driven;
    expect(state.view.state).toBe("completed");
    expect(state.view.stages.map((s) => s.state)).toEqual([
      "completed",
      "completed",
      "completed",
    ]);
    // The parallel pair was issued together at start; the singleton after.
    expect(state.commands).toHaveLength(3);
    expect(state.commands.every((c) => c.envelope.kind === "work-order")).toBe(true);
  });

  it("keeps queue + ledger + journal + outbox consistent at every logical step", () => {
    const stack = assembleMissionStack();
    const driven = driveMission(stack, happyScenario());
    expect(driven.ok).toBe(true);
    if (!driven.ok) return;
    const { state } = driven;
    // One outbox event per journal entry (the A14 atomic boundary).
    expect(state.outboxEvents).toHaveLength(state.journal.length);
    expect(state.journal.length).toBe(state.view.journalLength);
    // Every journal work-order-issued event has a live queue command.
    const issued = state.journal.filter((e) => e.event.kind === "work-order-issued");
    const commandIds = new Set(state.commands.map((c) => String(c.envelope.id)));
    for (const entry of issued) {
      expect(commandIds.has(entry.event.commandId ?? "")).toBe(true);
    }
    // The ledger chain verifies (hash-chained, law A19).
    expect(stack.ledger.verifyChain(ctxFor(TENANT_A))).toBe(true);
    // Every submitted command was ledgered exactly once.
    const submitted = state.ledger.filter((e) => e.kind === "submitted");
    expect(submitted).toHaveLength(3);
  });

  it("journal replay across the composition equals the folded state", () => {
    const stack = assembleMissionStack();
    const driven = driveMission(stack, happyScenario());
    expect(driven.ok).toBe(true);
    if (!driven.ok) return;
    const ctx = ctxFor(TENANT_A);
    // Replay VERBATIM into a fresh store and fold: identical state.
    const freshStore = assembleMissionStack().store;
    const replayed = new MissionJournal(freshStore).replay({
      ctx,
      missionId: MISSION_ID,
      entries: driven.state.journal,
    });
    expect(replayed.ok).toBe(true);
    const validated = validateMissionDefinition({ definition: THREE_STAGE_DEFINITION });
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    const refolded = foldMission(
      validated.value,
      new MissionJournal(freshStore).committedEntries(ctx, MISSION_ID),
    );
    expect(refolded).toEqual(driven.state.view);
  });

  it("is deterministic: the same scenario on two fresh stacks is byte-identical", () => {
    const a = driveMission(assembleMissionStack(), happyScenario());
    const b = driveMission(assembleMissionStack(), happyScenario());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("dead-letters a failing work order after max attempts and records the mission failure atomically", () => {
    const stack = assembleMissionStack({
      commandRetryPolicy: {
        maxAttempts: 3,
        baseDelayMs: 1_000,
        maxDelayMs: 60_000,
        backoffBps: 20_000,
      },
    });
    const driven = driveMission(stack, {
      ctx: ctxFor(TENANT_A),
      definition: THREE_STAGE_DEFINITION,
      missionId: MISSION_ID,
      startsAt: NOW,
      // backoff 1000 then 2000 → attempts at t, t+1000, t+3000.
      ticks: [NOW + 1_000, NOW + 2_000, NOW + 4_000, NOW + 5_000],
      stageOutcomes: {
        ingest: [{ kind: "fail", reason: "sensor-offline" }],
        analyze: [{ kind: "complete" as const }],
        report: [{ kind: "complete" as const }],
      },
    });
    expect(driven.ok).toBe(true);
    if (!driven.ok) return;
    const { state } = driven;
    const dead = state.commands.find((c) => c.state === "dead-lettered");
    expect(dead).toBeDefined();
    expect(dead?.failures).toBe(3);
    expect(dead?.attempts).toBe(3);
    // The stage-failed + mission-failed pair is ONE atomic journal commit:
    // contiguous seqs, identical `at` — no dual-write gap (A14).
    const failedAt = state.journal.filter((e) => e.event.kind === "stage-failed");
    const missionFailed = state.journal.filter((e) => e.event.kind === "mission-failed");
    expect(failedAt).toHaveLength(1);
    expect(missionFailed).toHaveLength(1);
    expect(missionFailed[0]?.seq).toBe((failedAt[0]?.seq ?? 0) + 1);
    expect(missionFailed[0]?.at).toBe(failedAt[0]?.at);
    expect(state.view.state).toBe("failed");
    // Outbox events still mirror the journal exactly (same commit).
    expect(state.outboxEvents).toHaveLength(state.journal.length);
    expect(stack.ledger.verifyChain(ctxFor(TENANT_A))).toBe(true);
    const dl = state.ledger.filter((e) => e.kind === "dead-lettered");
    expect(dl).toHaveLength(1);
    expect(dl[0]?.reason).toBe("max-attempts-exceeded");
  });

  it("retry attempts before dead-letter leave the mission running with no partial state", () => {
    const stack = assembleMissionStack({
      commandRetryPolicy: {
        maxAttempts: 5,
        baseDelayMs: 1_000,
        maxDelayMs: 60_000,
        backoffBps: 20_000,
      },
    });
    const driven = driveMission(stack, {
      ctx: ctxFor(TENANT_A),
      definition: THREE_STAGE_DEFINITION,
      missionId: MISSION_ID,
      startsAt: NOW,
      ticks: [NOW + 1_000, NOW + 2_000],
      stageOutcomes: {
        ingest: [
          { kind: "fail", reason: "sensor-offline" },
          { kind: "fail", reason: "sensor-offline" },
        ],
        analyze: [{ kind: "complete" as const }],
      },
    });
    expect(driven.ok).toBe(true);
    if (!driven.ok) return;
    // Two failures, still inside the policy: mission running, no failure events.
    expect(driven.state.view.state).toBe("running");
    expect(driven.state.journal.some((e) => e.event.kind === "mission-failed")).toBe(false);
    const retry = driven.state.commands.find((c) => c.state === "retry-scheduled");
    expect(retry?.failures).toBe(2);
    expect(retry?.nextAttemptAt).toBe(NOW + 2_000 + 2_000);
  });

  it("writes the kernel UnitOfWork run-log + kernel outbox events atomically per tick", () => {
    const stack = assembleMissionStack();
    const driven = driveMission(stack, happyScenario());
    expect(driven.ok).toBe(true);
    if (!driven.ok) return;
    const ctx = ctxFor(TENANT_A);
    expect(driven.state.kernelRunLog).toHaveLength(3);
    expect(driven.state.kernelOutboxEvents).toHaveLength(3);
    for (const event of driven.state.kernelOutboxEvents) {
      expect(event.type).toBe("mission.run-log");
    }
    const snapshot = stack.kernel.driver.snapshot(ctx.tenantId);
    const runLog = snapshot.collections.get("mission-run-log");
    expect(runLog?.size).toBe(3);
  });

  it("submit port honors idempotency: a duplicate submit returns the ORIGINAL ack", () => {
    const stack = assembleMissionStack();
    const ctx = ctxFor(TENANT_A);
    const command = {
      kind: "work-order",
      payload: { missionId: MISSION_ID, stageId: "ingest" },
      idempotencyKey: "wo:manual:ingest",
      issuedAt: NOW,
    };
    const first = stack.commandSubmit.submit({ ctx, command });
    const second = stack.commandSubmit.submit({ ctx, command });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.value.duplicate).toBe(true);
    expect(second.value.commandId).toBe(first.value.commandId);
    expect(stack.queue.listByTenant(ctx)).toHaveLength(1);
  });

  it("fails closed cross-tenant everywhere: no mission, no commands, no ledger, no outbox", () => {
    const stack = assembleMissionStack();
    const driven = driveMission(stack, happyScenario());
    expect(driven.ok).toBe(true);
    if (!driven.ok) return;
    const ctxB = ctxFor(TENANT_B);
    const foreign = stack.runtime.missionView(ctxB, MISSION_ID);
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.reason).toBe("mission-not-found");
    for (const command of driven.state.commands) {
      expect(stack.queue.findById(ctxB, String(command.envelope.id)).ok).toBe(false);
    }
    expect(stack.ledger.entriesFor(ctxB)).toHaveLength(0);
    expect(stack.outbox.eventsFor(ctxB)).toHaveLength(0);
    expect(stack.queue.listByTenant(ctxB)).toHaveLength(0);
    // No partial state: tenant A's mission is untouched by tenant B's reads.
    expect(driven.state.view.state).toBe("completed");
  });

  it("the kernel fails closed on a missing/malformed tenant before any composition state exists", () => {
    const missing = makeTenantContext({
      tenantId: "",
      actorId: AGENT_A,
      sessionId: "sess_abcdef0123456789",
      establishedAt: NOW,
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.reason).toBe("missing-tenant-id");
    }
    const malformed = makeTenantContext({
      tenantId: "not-a-tenant-id",
      actorId: AGENT_A,
      sessionId: "sess_abcdef0123456789",
      establishedAt: NOW,
    });
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) {
      expect(malformed.reason).toBe("malformed-tenant-id");
    }
  });
});
