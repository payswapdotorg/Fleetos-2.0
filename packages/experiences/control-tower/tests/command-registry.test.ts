/**
 * F241 command-registry tests — the universal command surface bound to the
 * REAL control-plane queue via the queueAsSubmitPort seam.
 */

import { describe, expect, it } from "vitest";
import { CommandQueue } from "@fleetos/control-plane";
import { buildEnrollAssetIntent } from "@fleetos/experience-asset-field";
import { requestRemediation } from "@fleetos/experience-safety-intel";
import { draftCreateWorkOrder } from "@fleetos/experience-work-commerce";
import {
  InMemoryMissionOutbox,
  MissionRuntime,
  MissionStore,
} from "@fleetos/mission";
import {
  TOWER_COMMAND_REGISTRY,
  TowerCommandBus,
  draftCapabilityOf,
  draftReasonOf,
  draftSubmitCommandOf,
  draftTenantOf,
  findTowerCommandByKind,
  listTowerCommands,
  type TowerCommandDraft,
} from "../src/command-registry.js";
import { ctxFor, NOW, TENANT, TENANT_B } from "./helpers.js";

// --- REAL lane drafts (built by the lanes' own builders) ---

function enrollDraft() {
  const built = buildEnrollAssetIntent({
    tenantId: TENANT,
    actorId: "act_towerop001",
    assetId: "ast_towercrane",
    deviceId: "dev_crane03",
    issuedAt: NOW,
    reason: "onboarding",
  });
  if (!built.ok) throw new Error(built.detail);
  return built.draft;
}

function remediationDraft() {
  const built = requestRemediation({
    intentId: "int-001",
    tenantId: TENANT,
    actorId: "act_towerop001",
    requiredCapabilityId: "security.remediation.execute",
    reason: "risk-reduction",
    issuedAt: NOW,
    proposalId: "rem-001",
    findingIds: ["sf-001"],
    remediationKind: "patch",
  });
  if (!built.ok) throw new Error(built.detail);
  return built.draft;
}

function workOrderDraft() {
  const built = draftCreateWorkOrder({
    tenant: { tenantId: TENANT },
    idempotencyKey: "idem-tower-1",
    issuedAt: NOW,
    title: "Inspect crane load sensor",
    reason: "task-creation",
  });
  if (!built.ok) throw new Error(built.detail);
  return built.draft;
}

describe("the universal command registry", () => {
  it("carries one entry per lane intent kind (3 + 3 + 4)", () => {
    expect(TOWER_COMMAND_REGISTRY.length).toBe(10);
    expect(listTowerCommands("asset-field").length).toBe(3);
    expect(listTowerCommands("safety-intel").length).toBe(3);
    expect(listTowerCommands("work-commerce").length).toBe(4);
  });

  it("preserves the Guardian law structurally: every entry is a ceiling, never an authorization", () => {
    for (const entry of TOWER_COMMAND_REGISTRY) {
      expect(entry.ceiling).toBe("capability-ceiling-not-authorization");
      expect(entry.reasonVocabulary.length).toBeGreaterThan(0);
    }
  });

  it("mirrors the lane-fixed capabilities and marks lane B draft-declared capabilities", () => {
    expect(findTowerCommandByKind("asset.enroll")?.capabilityRequirement).toBe("assets.enroll");
    expect(findTowerCommandByKind("procurement.place-order")?.capabilityRequirement).toBe("procurement.order.place");
    const laneB = findTowerCommandByKind("security.remediation.request");
    expect(laneB?.capabilityRequirement).toBeNull();
    expect(laneB?.capabilitySource).toBe("draft-declared");
    expect(findTowerCommandByKind("nope.unknown")).toBeNull();
  });

  it("projects every lane draft shape onto the real submit contract", () => {
    const a = enrollDraft();
    const b = remediationDraft();
    const c = workOrderDraft();
    expect(draftSubmitCommandOf(a)).toEqual({
      kind: "asset.enroll",
      payload: a.payload,
      idempotencyKey: a.idempotencyKey,
      issuedAt: NOW,
    });
    expect(draftSubmitCommandOf(b).kind).toBe("security.remediation.request");
    expect(draftSubmitCommandOf(c).idempotencyKey).toBe("idem-tower-1");
    expect(draftTenantOf(a)).toBe(TENANT);
    expect(draftTenantOf(b)).toBe(TENANT);
    expect(draftTenantOf(c)).toBe(TENANT);
    expect(draftReasonOf(a)).toBe("onboarding");
    expect(draftReasonOf(b)).toBe("risk-reduction");
    expect(draftReasonOf(c)).toBe("task-creation");
    expect(draftCapabilityOf(b)).toBe("security.remediation.execute");
  });
});

describe("TowerCommandBus — submission through the REAL control-plane queue", () => {
  it("submits a lane A draft through the real bus and records it on the queue", () => {
    const bus = new TowerCommandBus();
    const ctx = ctxFor();
    const submitted = bus.submit({ ctx, draft: enrollDraft() });
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) throw new Error(submitted.detail);
    expect(submitted.ack.duplicate).toBe(false);
    expect(submitted.ack.ceiling).toBe("capability-ceiling-not-authorization");
    const record = bus.queueOf().findById(ctx, submitted.ack.commandId);
    expect(record.ok).toBe(true);
    if (!record.ok) return;
    expect(record.value.envelope.kind).toBe("asset.enroll");
    expect(record.value.envelope.actorId).toBe(ctx.actorId);
    expect(record.value.envelope.tenantId).toBe(TENANT);
  });

  it("dedupes an identical re-submission (the queue's idempotency law)", () => {
    const bus = new TowerCommandBus();
    const ctx = ctxFor();
    const first = bus.submit({ ctx, draft: enrollDraft() });
    const second = bus.submit({ ctx, draft: enrollDraft() });
    if (!first.ok || !second.ok) throw new Error("submit refused");
    expect(second.ack.duplicate).toBe(true);
    expect(second.ack.commandId).toBe(first.ack.commandId);
    expect(bus.queueOf().listByTenant(ctx).length).toBe(1);
  });

  it("submits lane B and lane C drafts with their declared capabilities", () => {
    const bus = new TowerCommandBus();
    const ctx = ctxFor();
    const b = bus.submit({ ctx, draft: remediationDraft() });
    const c = bus.submit({ ctx, draft: workOrderDraft() });
    if (!b.ok || !c.ok) throw new Error("submit refused");
    expect(b.ack.capabilityRequirement).toBe("security.remediation.execute");
    expect(c.ack.capabilityRequirement).toBe("work.order.create");
    expect(bus.queueOf().listByTenant(ctx).length).toBe(2);
  });

  it("refuses a draft scoped to another tenant (fail closed)", () => {
    const bus = new TowerCommandBus();
    const submitted = bus.submit({ ctx: ctxFor(TENANT_B), draft: enrollDraft() });
    expect(submitted).toMatchObject({ ok: false, refused: "tenant-mismatch" });
  });

  it("refuses an unregistered command kind", () => {
    const bus = new TowerCommandBus();
    const draft: TowerCommandDraft = { ...workOrderDraft(), command: { ...workOrderDraft().command, kind: "nope.kind" } };
    const submitted = bus.submit({ ctx: ctxFor(), draft });
    expect(submitted).toMatchObject({ ok: false, refused: "unknown-command-kind" });
  });

  it("refuses a reason outside the command's vocabulary", () => {
    const bus = new TowerCommandBus();
    const draft: TowerCommandDraft = { ...enrollDraft(), reason: "just because" };
    const submitted = bus.submit({ ctx: ctxFor(), draft });
    expect(submitted).toMatchObject({ ok: false, refused: "reason-not-in-vocabulary" });
  });

  it("refuses an empty reason and a mismatched lane-fixed capability", () => {
    const bus = new TowerCommandBus();
    const empty: TowerCommandDraft = { ...enrollDraft(), reason: "" };
    expect(bus.submit({ ctx: ctxFor(), draft: empty })).toMatchObject({ ok: false, refused: "empty-reason" });
    const mismatched: TowerCommandDraft = { ...enrollDraft(), capabilityRequirement: "assets.delete" };
    expect(bus.submit({ ctx: ctxFor(), draft: mismatched })).toMatchObject({ ok: false, refused: "capability-mismatch" });
  });

  it("surfaces a real queue rejection through the seam", () => {
    const bus = new TowerCommandBus();
    const base = workOrderDraft();
    const draft: TowerCommandDraft = { ...base, command: { ...base.command, idempotencyKey: "" } };
    const submitted = bus.submit({ ctx: ctxFor(), draft });
    expect(submitted).toMatchObject({ ok: false, refused: "queue-rejected", detail: "missing-idempotency-key" });
  });

  it("makes dead letters visible at the tower level after the retry policy exhausts", () => {
    const bus = new TowerCommandBus();
    const ctx = ctxFor();
    const queue = bus.queueOf();
    const submitted = bus.submit({ ctx, draft: enrollDraft() });
    if (!submitted.ok) throw new Error(submitted.detail);
    const commandId = submitted.ack.commandId;
    let now = NOW;
    for (let attempt = 0; attempt < 5; attempt++) {
      const claimed = queue.drain({ ctx, now });
      for (const record of claimed) {
        const failed = queue.fail({ ctx, commandId: record.envelope.id, reason: "executor-error", now });
        expect(failed.ok).toBe(true);
      }
      now += 10_000;
    }
    const dead = bus.deadLetters(ctx);
    expect(dead.length).toBe(1);
    expect(dead[0]?.envelope.id).toBe(commandId);
    expect(dead[0]?.state).toBe("dead-lettered");
    expect(bus.commandStatus(ctx, commandId).ok).toBe(true);
  });

  it("hides command status from another tenant (fail-closed, no existence leak)", () => {
    const bus = new TowerCommandBus();
    const submitted = bus.submit({ ctx: ctxFor(), draft: enrollDraft() });
    if (!submitted.ok) throw new Error(submitted.detail);
    const foreign = bus.commandStatus(ctxFor(TENANT_B), submitted.ack.commandId);
    expect(foreign).toMatchObject({ ok: false, detail: "command-not-found" });
    expect(bus.deadLetters(ctxFor(TENANT_B))).toEqual([]);
  });
});

describe("one bus for missions AND tower commands", () => {
  it("flows tower commands through the same real queue mission work orders use, with the shared idempotency law", () => {
    const queue = new CommandQueue();
    const bus = new TowerCommandBus({ queue });
    const ctx = ctxFor();
    const store = new MissionStore();
    const runtime = new MissionRuntime({
      store,
      outbox: new InMemoryMissionOutbox({ stores: store.stores }),
      commandSubmit: bus.submitPortOf(),
    });
    const missionId = "msn_shared0001";
    const created = runtime.createMission({
      ctx,
      definition: {
        id: "def_shared",
        stages: [
          { id: "ingest", parallelGroup: "phase-1" },
          { id: "analyze", parallelGroup: "phase-1" },
        ],
      },
      missionId,
      now: NOW,
    });
    if (!created.ok) throw new Error(created.reason);
    const started = runtime.startMission({ ctx, missionId, now: NOW + 1 });
    if (!started.ok) throw new Error(started.reason);
    expect(queue.listByTenant(ctx).length).toBe(2); // one work order per ready stage

    const towerSubmission = bus.submit({ ctx, draft: workOrderDraft() });
    if (!towerSubmission.ok) throw new Error(towerSubmission.detail);
    expect(queue.listByTenant(ctx).length).toBe(3); // missions + tower share ONE bus

    // suspend + resume: the runtime re-issues work orders for RUNNING stages
    // with the SAME idempotency keys — the shared bus dedupes them.
    const suspended = runtime.suspendMission({ ctx, missionId, reason: "pause", now: NOW + 2 });
    if (!suspended.ok) throw new Error(suspended.reason);
    const resumed = runtime.resumeMission({ ctx, missionId, now: NOW + 3 });
    if (!resumed.ok) throw new Error(resumed.reason);
    expect(queue.listByTenant(ctx).length).toBe(3); // never re-executed, never double-submitted
    const kinds = queue.listByTenant(ctx).map((record) => record.envelope.kind);
    expect(kinds.filter((kind) => kind === "work-order").length).toBe(2);
    expect(kinds.includes("work.create-work-order")).toBe(true);
  });
});
