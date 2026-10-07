/**
 * F241 mission replay view tests — chain-verified journal + the folded
 * snapshot with checkpoint/resume visibility, composed from @fleetos/mission
 * public surfaces (the REAL runtime produces the journal).
 */

import { describe, expect, it } from "vitest";
import { CommandQueue, queueAsSubmitPort } from "@fleetos/control-plane";
import {
  foldMission,
  InMemoryMissionOutbox,
  MissionJournal,
  MissionRuntime,
  MissionStore,
  validateMissionDefinition,
} from "@fleetos/mission";
import {
  buildMissionReplayView,
  verifyMissionReplayDigest,
  type MissionReplayView,
} from "../src/mission-replay-view.js";
import {
  ctxFor,
  makeMissionJournal,
  NOW,
  TENANT,
  TENANT_B,
  TOWER_MISSION_DEFINITION,
} from "./helpers.js";

function replayOk(tenant: string = TENANT) {
  const fixture = makeMissionJournal(tenant);
  const result = buildMissionReplayView({
    tenantId: tenant,
    definition: fixture.definition,
    entries: fixture.entries,
  });
  if (!result.ok) throw new Error(`${result.refused}: ${result.detail}`);
  return { view: result.view, fixture };
}

describe("buildMissionReplayView — the folded snapshot presentation", () => {
  it("presents EXACTLY the mission package's own folded state", () => {
    const { view, fixture } = replayOk();
    const folded = foldMission(fixture.definition, fixture.entries);
    expect(view.state).toBe(folded.state);
    expect(view.missionId).toBe(folded.missionId);
    expect(view.definitionId).toBe(folded.definitionId);
    expect(view.journalLength).toBe(folded.journalLength);
    expect(view.lastCheckpoint).toEqual(folded.lastCheckpoint);
    expect(view.stages.map((stage) => [stage.stageId, stage.state])).toEqual(
      folded.stages.map((stage) => [stage.stageId, stage.state]),
    );
  });

  it("presents the journal timeline with the digest chain", () => {
    const { view, fixture } = replayOk();
    expect(view.timeline.map((item) => item.seq)).toEqual(fixture.entries.map((entry) => entry.seq));
    expect(view.timeline.map((item) => item.digest)).toEqual(fixture.entries.map((entry) => entry.digest));
    expect(view.timeline.map((item) => item.eventKind)).toContain("mission-created");
    expect(view.headDigest).toBe(fixture.entries[fixture.entries.length - 1]?.digest);
  });

  it("surfaces checkpoint visibility per stage", () => {
    const { view } = replayOk();
    const ingest = view.stages.find((stage) => stage.stageId === "ingest");
    expect(ingest?.checkpointCount).toBe(1);
    expect(view.lastCheckpoint).toMatchObject({ stageId: "ingest", checkpointId: "cp-1" });
  });

  it("surfaces the resume point for a suspended mission (first running stage)", () => {
    const { view } = replayOk();
    expect(view.state).toBe("suspended");
    expect(view.resumePoint).toEqual({ stageId: "ingest" });
    expect(view.resumePolicy).toBe("completed-stages-never-re-execute");
  });

  it("never re-executes completed stages: the resume point skips them", () => {
    const store = new MissionStore();
    const runtime = new MissionRuntime({
      store,
      outbox: new InMemoryMissionOutbox({ stores: store.stores }),
      commandSubmit: queueAsSubmitPort(new CommandQueue()),
    });
    const ctx = ctxFor();
    const missionId = "msn_resume0001";
    if (!runtime.createMission({ ctx, definition: TOWER_MISSION_DEFINITION, missionId, now: NOW }).ok) {
      throw new Error("create refused");
    }
    if (!runtime.startMission({ ctx, missionId, now: NOW + 1 }).ok) throw new Error("start refused");
    if (!runtime.completeStage({ ctx, missionId, stageId: "ingest", now: NOW + 2 }).ok) {
      throw new Error("complete refused");
    }
    if (!runtime.suspendMission({ ctx, missionId, reason: "pause", now: NOW + 3 }).ok) {
      throw new Error("suspend refused");
    }
    const entries = new MissionJournal(store).committedEntries(ctx, missionId);
    const validated = validateMissionDefinition({ definition: TOWER_MISSION_DEFINITION });
    if (!validated.ok) throw new Error(validated.reason);
    const result = buildMissionReplayView({ tenantId: TENANT, definition: validated.value, entries });
    if (!result.ok) throw new Error(result.detail);
    expect(result.view.completedStageCount).toBe(1);
    expect(result.view.resumePoint).toEqual({ stageId: "analyze" }); // ingest completed — skipped
  });

  it("handles an empty journal honestly (pending, no head)", () => {
    const validated = validateMissionDefinition({ definition: TOWER_MISSION_DEFINITION });
    if (!validated.ok) throw new Error(validated.reason);
    const result = buildMissionReplayView({ tenantId: TENANT, definition: validated.value, entries: [] });
    if (!result.ok) throw new Error(result.detail);
    expect(result.view.state).toBe("pending");
    expect(result.view.journalLength).toBe(0);
    expect(result.view.headDigest).toBeNull();
    expect(result.view.resumePoint).toBeNull();
  });
});

describe("buildMissionReplayView — fail-closed chain verification", () => {
  it("refuses a tampered entry digest", () => {
    const fixture = makeMissionJournal();
    const entries = fixture.entries.map((entry, index) =>
      index === 2 ? { ...entry, digest: `${entry.digest.slice(0, 6)}deadbeef` } : entry,
    );
    const result = buildMissionReplayView({ tenantId: TENANT, definition: fixture.definition, entries });
    expect(result).toMatchObject({ ok: false, refused: "chain-invalid" });
  });

  it("refuses a seq gap (a dropped entry)", () => {
    const fixture = makeMissionJournal();
    const entries = fixture.entries.filter((entry) => entry.seq !== 2);
    const result = buildMissionReplayView({ tenantId: TENANT, definition: fixture.definition, entries });
    expect(result).toMatchObject({ ok: false, refused: "chain-invalid" });
  });

  it("refuses a tenant mismatch", () => {
    const fixture = makeMissionJournal();
    const result = buildMissionReplayView({
      tenantId: TENANT_B,
      definition: fixture.definition,
      entries: fixture.entries,
    });
    expect(result).toMatchObject({ ok: false, refused: "tenant-mismatch" });
  });

  it("refuses a missing tenant scope", () => {
    const fixture = makeMissionJournal();
    const result = buildMissionReplayView({ tenantId: "", definition: fixture.definition, entries: fixture.entries });
    expect(result).toMatchObject({ ok: false, refused: "missing-tenant" });
  });

  it("refuses entries mixed from a different mission", () => {
    const fixture = makeMissionJournal();
    const other = makeMissionJournal(TENANT, "msn_other9999"); // a second, independent journal
    const foreign = other.entries.slice(0, 2).map((entry, index) => ({
      ...entry,
      seq: fixture.entries.length + 1 + index,
    }));
    const result = buildMissionReplayView({
      tenantId: TENANT,
      definition: fixture.definition,
      entries: [...fixture.entries, ...foreign],
    });
    expect(result).toMatchObject({ ok: false, refused: "mission-mismatch" });
  });
});

describe("buildMissionReplayView — determinism + tamper evidence", () => {
  it("is byte-identical for identical inputs (order of entries irrelevant)", () => {
    const a = replayOk().view;
    const fixture = makeMissionJournal();
    const shuffled = [...fixture.entries].reverse();
    const result = buildMissionReplayView({
      tenantId: TENANT,
      definition: fixture.definition,
      entries: shuffled,
    });
    if (!result.ok) throw new Error(result.detail);
    expect(JSON.stringify(result.view)).toBe(JSON.stringify(a));
  });

  it("verifies the replay digest and detects tampering", () => {
    const view: MissionReplayView = replayOk().view;
    expect(verifyMissionReplayDigest(view)).toBe(true);
    const tampered = { ...view, state: "completed" as const };
    expect(verifyMissionReplayDigest(tampered)).toBe(false);
  });
});
