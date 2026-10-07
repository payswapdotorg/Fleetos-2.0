/**
 * @fleetos/mission — journal + fold tests.
 *
 * The event-sourced core: chained digests, the pure fold over every event
 * kind, the 200-ENTRY REPLAY test (replaying the journal reproduces the
 * folded state exactly, digests preserved), tamper detection, and
 * per-mission chain independence.
 */

import { describe, expect, it } from "vitest";
import {
  entryDigest,
  foldMission,
  genesisDigest,
  MissionJournal,
  type MissionJournalEntry,
  type MissionJournalEvent,
} from "../src/journal.js";
import { validateMissionDefinition } from "../src/definition.js";
import { MissionStore } from "../src/outbox.js";
import { asMissionId } from "../src/ids.js";
import type { TenantId } from "@fleetos/kernel";
import { ctxFor, NOW, SEQUENTIAL_DEF, TENANT_A, TENANT_B } from "./helpers.js";

function buildEntries(
  missionId: string,
  events: ReadonlyArray<MissionJournalEvent>,
  at: number = NOW,
  tenant: string = TENANT_A,
): MissionJournalEntry[] {
  let prev: string | null = null;
  return events.map((event, index) => {
    const base = {
      seq: index + 1,
      tenantId: tenant as TenantId,
      missionId: asMissionId(missionId),
      event,
      at,
    };
    const digest = entryDigest(prev, base);
    const entry = { ...base, digest, prevDigest: prev };
    prev = digest;
    return entry;
  });
}

const validated = validateMissionDefinition({ definition: SEQUENTIAL_DEF });
if (!validated.ok) throw new Error("definition must validate");

describe("foldMission — the pure state function", () => {
  it("folds an empty journal to the initial pending view", () => {
    const view = foldMission(validated.value, []);
    expect(view.state).toBe("pending");
    expect(view.stages.map((s) => s.state)).toEqual(["pending", "pending", "pending"]);
    expect(view.lastCheckpoint).toBeNull();
    expect(view.journalLength).toBe(0);
  });

  it("folds mission-created → pending with createdAt", () => {
    const view = foldMission(validated.value, buildEntries("msn_0000000001", [
      { kind: "mission-created", reason: "def-sequential" },
    ]));
    expect(view.state).toBe("pending");
    expect(view.createdAt).toBe(NOW);
    expect(view.missionId).toBe("msn_0000000001");
    expect(view.definitionId).toBe("def-sequential");
  });

  it("folds mission-started + stage-started + work-order-issued → running with the stage in flight", () => {
    const view = foldMission(validated.value, buildEntries("msn_0000000001", [
      { kind: "mission-created" },
      { kind: "mission-started" },
      { kind: "stage-started", stageId: "ingest" },
      { kind: "work-order-issued", stageId: "ingest", commandId: "cmd_0000000001", idempotencyKey: "wo:msn_0000000001:ingest", attempt: 1 },
    ]));
    expect(view.state).toBe("running");
    expect(view.stages[0]?.state).toBe("running");
    expect(view.stages[0]?.workOrders).toHaveLength(1);
    expect(view.stages[0]?.workOrders[0]?.commandId).toBe("cmd_0000000001");
    expect(view.stages[1]?.state).toBe("pending");
  });

  it("folds checkpoint-recorded → lastCheckpoint tracks the LATEST checkpoint", () => {
    const view = foldMission(validated.value, buildEntries("msn_0000000001", [
      { kind: "mission-created" },
      { kind: "mission-started" },
      { kind: "stage-started", stageId: "ingest" },
      { kind: "checkpoint-recorded", stageId: "ingest", checkpointId: "cp-1" },
      { kind: "checkpoint-recorded", stageId: "ingest", checkpointId: "cp-2" },
    ]));
    expect(view.lastCheckpoint).toEqual({
      stageId: "ingest",
      checkpointId: "cp-2",
      seq: 5,
    });
    expect(view.stages[0]?.checkpoints.map((c) => c.checkpointId)).toEqual(["cp-1", "cp-2"]);
  });

  it("folds stage-completed chains: completed stages stay completed", () => {
    const view = foldMission(validated.value, buildEntries("msn_0000000001", [
      { kind: "mission-created" },
      { kind: "mission-started" },
      { kind: "stage-started", stageId: "ingest" },
      { kind: "stage-completed", stageId: "ingest" },
      { kind: "stage-started", stageId: "analyze" },
      { kind: "stage-completed", stageId: "analyze" },
    ]));
    expect(view.stages[0]?.state).toBe("completed");
    expect(view.stages[1]?.state).toBe("completed");
    expect(view.stages[2]?.state).toBe("pending");
    expect(view.state).toBe("running");
  });

  it("folds mission-completed → terminal completed", () => {
    const view = foldMission(validated.value, buildEntries("msn_0000000001", [
      { kind: "mission-created" },
      { kind: "mission-started" },
      { kind: "stage-completed", stageId: "ingest" },
      { kind: "mission-completed" },
    ]));
    expect(view.state).toBe("completed");
    expect(view.endedAt).toBe(NOW);
  });

  it("folds stage-failed + mission-failed → terminal failed", () => {
    const view = foldMission(validated.value, buildEntries("msn_0000000001", [
      { kind: "mission-created" },
      { kind: "mission-started" },
      { kind: "stage-started", stageId: "ingest" },
      { kind: "stage-failed", stageId: "ingest", reason: "sensor-dead" },
      { kind: "mission-failed", reason: "sensor-dead" },
    ]));
    expect(view.state).toBe("failed");
    expect(view.stages[0]?.state).toBe("failed");
  });

  it("folds mission-suspended → suspended, mission-resumed → running", () => {
    const view = foldMission(validated.value, buildEntries("msn_0000000001", [
      { kind: "mission-created" },
      { kind: "mission-started" },
      { kind: "mission-suspended", reason: "operator-pause" },
      { kind: "mission-resumed", checkpointId: "cp-1", stageId: "ingest" },
    ]));
    expect(view.state).toBe("running");
    expect(view.suspendedAt).toBe(NOW);
    expect(view.resumedAt).toBe(NOW);
  });

  it("folds mission-cancelled → terminal cancelled, in-flight stages cancelled", () => {
    const view = foldMission(validated.value, buildEntries("msn_0000000001", [
      { kind: "mission-created" },
      { kind: "mission-started" },
      { kind: "stage-started", stageId: "ingest" },
      { kind: "stage-completed", stageId: "ingest" },
      { kind: "stage-started", stageId: "analyze" },
      { kind: "mission-cancelled", reason: "operator" },
    ]));
    expect(view.state).toBe("cancelled");
    expect(view.stages[0]?.state).toBe("completed"); // completed stays completed
    expect(view.stages[1]?.state).toBe("cancelled"); // IN-FLIGHT stage is cancelled
    expect(view.stages[2]?.state).toBe("pending"); // untouched stages stay pending
    expect(view.endedAt).toBe(NOW);
  });

  it("fold is pure: the same entries always fold to the identical view", () => {
    const entries = buildEntries("msn_0000000001", [
      { kind: "mission-created" },
      { kind: "mission-started" },
      { kind: "checkpoint-recorded", stageId: "ingest", checkpointId: "cp-1" },
    ]);
    expect(foldMission(validated.value, entries)).toEqual(foldMission(validated.value, entries));
  });
});

describe("MissionJournal — replay", () => {
  it("replays a journal verbatim: identical digests, identical folded state", () => {
    const source = buildEntries("msn_0000000001", [
      { kind: "mission-created" },
      { kind: "mission-started" },
      { kind: "stage-started", stageId: "ingest" },
      { kind: "checkpoint-recorded", stageId: "ingest", checkpointId: "cp-1" },
      { kind: "stage-completed", stageId: "ingest" },
    ]);
    const target = new MissionJournal(new MissionStore());
    const replayed = target.replay({
      ctx: ctxFor(TENANT_A),
      missionId: "msn_0000000001",
      entries: source,
    });
    expect(replayed).toEqual({ ok: true, value: { replayed: 5 } });
    const targetEntries = target.committedEntries(ctxFor(TENANT_A), "msn_0000000001");
    expect(targetEntries).toEqual(source); // digests + seqs preserved VERBATIM
    expect(
      foldMission(validated.value, targetEntries),
    ).toEqual(foldMission(validated.value, source));
  });

  it("replay refuses a TAMPERED entry: chain-invalid", () => {
    const source = buildEntries("msn_0000000001", [
      { kind: "mission-created" },
      { kind: "mission-started" },
    ]);
    const tampered = source.map((e, i) =>
      i === 1 ? { ...e, event: { ...e.event, kind: "mission-completed" as const } } : e,
    );
    const journal = new MissionJournal(new MissionStore());
    expect(
      journal.replay({ ctx: ctxFor(TENANT_A), missionId: "msn_0000000001", entries: tampered }),
    ).toEqual({ ok: false, reason: "chain-invalid" });
  });

  it("replay refuses a GAPPED chain: chain-invalid", () => {
    const source = buildEntries("msn_0000000001", [
      { kind: "mission-created" },
      { kind: "mission-started" },
      { kind: "mission-completed" },
    ]);
    const gapped = source.filter((_, index) => index !== 1);
    const journal = new MissionJournal(new MissionStore());
    expect(
      journal.replay({ ctx: ctxFor(TENANT_A), missionId: "msn_0000000001", entries: gapped }),
    ).toEqual({ ok: false, reason: "chain-invalid" });
  });

  it("replay refuses entries from another mission / tenant: mission-mismatch", () => {
    const otherMission = buildEntries("msn_0000000002", [{ kind: "mission-created" }]);
    const journal = new MissionJournal(new MissionStore());
    expect(
      journal.replay({ ctx: ctxFor(TENANT_A), missionId: "msn_0000000001", entries: otherMission }),
    ).toEqual({ ok: false, reason: "mission-mismatch" });
    const otherTenant = buildEntries(
      "msn_0000000001",
      [{ kind: "mission-created" }],
      NOW,
      TENANT_B,
    );
    expect(
      journal.replay({ ctx: ctxFor(TENANT_A), missionId: "msn_0000000001", entries: otherTenant }),
    ).toEqual({ ok: false, reason: "mission-mismatch" });
  });

  it("per-mission chains are independent (both start at seq 1 with distinct genesis)", () => {
    const a = buildEntries("msn_0000000001", [{ kind: "mission-created" }]);
    const b = buildEntries("msn_0000000002", [{ kind: "mission-created" }]);
    expect(a[0]?.seq).toBe(1);
    expect(b[0]?.seq).toBe(1);
    expect(genesisDigest(TENANT_A as TenantId, "msn_0000000001")).not.toBe(
      genesisDigest(TENANT_A as TenantId, "msn_0000000002"),
    );
    expect(a[0]?.digest).not.toBe(b[0]?.digest);
  });
});

describe("MissionJournal — THE 200-ENTRY REPLAY", () => {
  it("a 200-entry journal replays into a fresh store with the identical folded state", () => {
    // Exactly 200 events: creation + start + ingest issuance (4), 190
    // checkpoints on the in-flight stage, ingest completion + analyze
    // issuance + analyze checkpoint + suspension (5), resume (1).
    const events: MissionJournalEvent[] = [
      { kind: "mission-created", reason: "def-sequential" },
      { kind: "mission-started" },
      { kind: "stage-started", stageId: "ingest" },
      { kind: "work-order-issued", stageId: "ingest", commandId: "cmd_0000000001", idempotencyKey: "wo:msn_0000000001:ingest", attempt: 1 },
    ];
    for (let i = 1; i <= 190; i++) {
      events.push({
        kind: "checkpoint-recorded",
        stageId: "ingest",
        checkpointId: `cp-${String(i).padStart(3, "0")}`,
      });
    }
    events.push(
      { kind: "stage-completed", stageId: "ingest" },
      { kind: "stage-started", stageId: "analyze" },
      { kind: "work-order-issued", stageId: "analyze", commandId: "cmd_0000000002", idempotencyKey: "wo:msn_0000000001:analyze", attempt: 1 },
      { kind: "checkpoint-recorded", stageId: "analyze", checkpointId: "cp-analyze-1" },
      { kind: "mission-suspended", reason: "checkpoint-pause" },
      { kind: "mission-resumed", checkpointId: "cp-analyze-1", stageId: "analyze" },
    );
    expect(events).toHaveLength(200);

    const entries = buildEntries("msn_0000000001", events);
    expect(entries).toHaveLength(200);

    const target = new MissionJournal(new MissionStore());
    const replayed = target.replay({
      ctx: ctxFor(TENANT_A),
      missionId: "msn_0000000001",
      entries,
    });
    expect(replayed.ok && replayed.value.replayed).toBe(200);
    const targetEntries = target.committedEntries(ctxFor(TENANT_A), "msn_0000000001");
    expect(targetEntries).toHaveLength(200);
    // JOURNAL REPLAY EQUALS FOLDED STATE — byte-identical digests preserved.
    expect(targetEntries).toEqual(entries);
    const view = foldMission(validated.value, targetEntries);
    expect(view.state).toBe("running");
    expect(view.journalLength).toBe(200);
    expect(view.stages[0]?.state).toBe("completed");
    expect(view.stages[1]?.state).toBe("running");
    expect(view.stages[1]?.checkpoints).toHaveLength(1);
    expect(view.lastCheckpoint?.checkpointId).toBe("cp-analyze-1");
    // Determinism: fold the same journal twice — identical.
    expect(foldMission(validated.value, entries)).toEqual(view);
  });
});
