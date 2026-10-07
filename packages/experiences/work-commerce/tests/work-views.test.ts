import { describe, expect, it } from "vitest";
import type { WorkItem, WorkItemStatus } from "@fleetos/work";
import { WORK_ITEM_STATUSES } from "@fleetos/work";
import type { Project, Milestone, ProjectStage } from "@fleetos/projects";
import {
  buildWorkBoard,
  buildProjectStageGateView,
  buildWorkloadRollup,
} from "../src/work-views.js";

const TENANT = { tenantId: "acme" };
const OTHER = { tenantId: "other" };

function workItem(
  value: string,
  status: WorkItemStatus,
  overrides: Partial<WorkItem> = {},
): WorkItem {
  return {
    id: { kind: "work-item", value },
    tenant: TENANT,
    title: `title-${value}`,
    assignee: { assigneeId: `agent-${value}`, assignedAt: "2026-01-01T00:00:00Z" },
    assignmentHistory: [],
    deadline: null,
    status,
    blockedReason: null,
    missionRef: null,
    workflowRef: null,
    projectId: null,
    ...overrides,
  };
}

function stage(
  id: string,
  status: ProjectStage["status"],
  checkpoints: ProjectStage["checkpoints"],
): ProjectStage {
  return {
    id,
    tenant: TENANT,
    projectId: "proj-1",
    name: `stage-${id}`,
    status,
    checkpoints,
    updatedAt: 1000,
  };
}

describe("buildWorkBoard", () => {
  it("groups cards into all five domain status columns with counts", () => {
    const result = buildWorkBoard({
      tenant: TENANT,
      workItems: [
        workItem("w-3", "todo"),
        workItem("w-1", "in_progress"),
        workItem("w-2", "blocked", { blockedReason: "waiting on vendor" }),
        workItem("w-4", "done"),
        workItem("w-5", "cancelled"),
      ],
      computedAt: "2026-01-02T00:00:00Z",
    });
    if (!result.ok) throw new Error(result.reasonCode);
    expect(result.board.columns.map((c) => c.status)).toEqual([...WORK_ITEM_STATUSES]);
    expect(result.board.totals).toEqual([
      { status: "todo", count: 1 },
      { status: "in_progress", count: 1 },
      { status: "blocked", count: 1 },
      { status: "done", count: 1 },
      { status: "cancelled", count: 1 },
    ]);
    const blocked = result.board.columns[2]?.cards[0];
    expect(blocked?.blockedReason).toBe("waiting on vendor");
  });

  it("orders cards lexically within columns and is order-independent (byte-identical digest)", () => {
    const items = [workItem("w-b", "todo"), workItem("w-a", "todo"), workItem("w-c", "todo")];
    const a = buildWorkBoard({ tenant: TENANT, workItems: items, computedAt: "t" });
    const b = buildWorkBoard({ tenant: TENANT, workItems: [...items].reverse(), computedAt: "t" });
    if (!a.ok || !b.ok) throw new Error("refused");
    expect(JSON.stringify(a.board)).toBe(JSON.stringify(b.board));
    expect(a.board.columns[0]?.cards.map((c) => c.workItemId)).toEqual(["w-a", "w-b", "w-c"]);
  });

  it("carries provenance refs and surfaces mission refs and deadlines", () => {
    const result = buildWorkBoard({
      tenant: TENANT,
      workItems: [
        workItem("w-1", "todo", {
          missionRef: { missionId: "m-9" },
          deadline: "2026-06-01",
        }),
      ],
      computedAt: "t",
    });
    if (!result.ok) throw new Error(result.reasonCode);
    const card = result.board.columns[0]?.cards[0];
    expect(card?.provenance).toEqual([{ recordKind: "work-item", recordId: "w-1" }]);
    expect(card?.missionRefId).toBe("m-9");
    expect(card?.deadline).toBe("2026-06-01");
  });

  it("redacts assignee ids with the sentinel — the value is provably absent from the serialized board", () => {
    const result = buildWorkBoard({
      tenant: TENANT,
      workItems: [workItem("w-1", "todo")],
      redactAssignees: true,
      computedAt: "t",
    });
    if (!result.ok) throw new Error(result.reasonCode);
    const card = result.board.columns[0]?.cards[0];
    expect(card?.assigneeId).toBe("[REDACTED]");
    expect(result.board.redactedFields).toEqual(["assigneeId"]);
    expect(JSON.stringify(result.board)).not.toContain("agent-w-1");
  });

  it("refuses the WHOLE board on a cross-tenant work item, naming the offender", () => {
    const result = buildWorkBoard({
      tenant: TENANT,
      workItems: [workItem("w-1", "todo"), workItem("w-x", "todo", { tenant: OTHER })],
      computedAt: "t",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("TENANT_MISMATCH");
      expect(result.detail).toBe("w-x");
    }
  });

  it("refuses on missing, empty, and invalid-char tenant scopes", () => {
    const missing = buildWorkBoard({
      tenant: null as never,
      workItems: [],
      computedAt: "t",
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.reasonCode).toBe("TENANT_SCOPE_MISSING");
    const empty = buildWorkBoard({ tenant: { tenantId: "" }, workItems: [], computedAt: "t" });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.reasonCode).toBe("TENANT_ID_EMPTY");
    const invalid = buildWorkBoard({ tenant: { tenantId: "bad id!" }, workItems: [], computedAt: "t" });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.reasonCode).toBe("TENANT_ID_INVALID_CHARS");
  });
});

describe("buildProjectStageGateView", () => {
  const project: Project = {
    id: { kind: "project", value: "proj-1" },
    tenant: TENANT,
    name: "Retrofit",
    status: "active",
    milestoneIds: ["ms-1"],
  };

  it("reports open mandatory checkpoints and what unlocks the frontier stage", () => {
    const result = buildProjectStageGateView({
      tenant: TENANT,
      project,
      stages: [
        stage("s-1", "closed", [{ id: "c-1", mandatory: true, completedAt: 10 }]),
        stage("s-2", "in_progress", [
          { id: "c-2", mandatory: true, completedAt: 10 },
          { id: "c-3", mandatory: true, completedAt: null },
          { id: "c-4", mandatory: false, completedAt: null },
        ]),
        stage("s-3", "planned", []),
      ],
      milestones: [],
      workItems: [],
      computedAt: "t",
    });
    if (!result.ok) throw new Error(result.reasonCode);
    expect(result.view.frontierStageId).toBe("s-2");
    expect(result.view.nextUnlock).toEqual({
      stageId: "s-2",
      requires: "close-mandatory-checkpoints",
      openMandatoryCheckpointIds: ["c-3"],
    });
    expect(result.view.stages[1]?.completedCheckpoints).toBe(1);
    expect(result.view.stages[1]?.totalCheckpoints).toBe(3);
  });

  it("a planned frontier requires start-stage; a fully closed project has no frontier", () => {
    const planned = buildProjectStageGateView({
      tenant: TENANT,
      project,
      stages: [stage("s-1", "planned", [])],
      milestones: [],
      workItems: [],
      computedAt: "t",
    });
    if (!planned.ok) throw new Error(planned.reasonCode);
    expect(planned.view.nextUnlock?.requires).toBe("start-stage");

    const done = buildProjectStageGateView({
      tenant: TENANT,
      project,
      stages: [stage("s-1", "closed", [])],
      milestones: [],
      workItems: [],
      computedAt: "t",
    });
    if (!done.ok) throw new Error(done.reasonCode);
    expect(done.view.frontierStageId).toBeNull();
    expect(done.view.nextUnlock).toBeNull();
  });

  it("reports milestone blocking items honestly via the domain gate", () => {
    const milestone: Milestone = {
      id: { kind: "milestone", value: "ms-1" },
      tenant: TENANT,
      projectId: "proj-1",
      name: "Handover",
      status: "open",
      workItemIds: ["w-1", "w-2"],
    };
    const blocked = buildProjectStageGateView({
      tenant: TENANT,
      project,
      stages: [],
      milestones: [milestone],
      workItems: [workItem("w-1", "done"), workItem("w-2", "in_progress")],
      computedAt: "t",
    });
    if (!blocked.ok) throw new Error(blocked.reasonCode);
    expect(blocked.view.milestoneGates[0]?.achieved).toBe(false);
    expect(blocked.view.milestoneGates[0]?.reasonCode).toBe("WORK_ITEMS_NOT_TERMINAL");
    expect(blocked.view.milestoneGates[0]?.blockingItems).toEqual([
      { workItemId: "w-2", currentStatus: "in_progress", reasonCode: "WORK_ITEM_NOT_TERMINAL" },
    ]);

    const achieved = buildProjectStageGateView({
      tenant: TENANT,
      project,
      stages: [],
      milestones: [milestone],
      workItems: [workItem("w-1", "done"), workItem("w-2", "cancelled")],
      computedAt: "t",
    });
    if (!achieved.ok) throw new Error(achieved.reasonCode);
    expect(achieved.view.milestoneGates[0]?.achieved).toBe(true);
    expect(achieved.view.milestoneGates[0]?.reasonCode).toBeNull();
  });

  it("refuses on a cross-tenant stage, naming the offender", () => {
    const result = buildProjectStageGateView({
      tenant: TENANT,
      project,
      stages: [{ ...stage("s-1", "planned", []), tenant: OTHER }],
      milestones: [],
      workItems: [],
      computedAt: "t",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("TENANT_MISMATCH");
      expect(result.detail).toBe("s-1");
    }
  });
});

describe("buildWorkloadRollup", () => {
  it("computes integer-bps utilization exactly (floored) and exact remainders", () => {
    const result = buildWorkloadRollup({
      tenant: TENANT,
      capacities: [
        { owner: "agent-a", tenant: TENANT, maxUnits: 3, unitCost: 1 },
        { owner: "agent-b", tenant: TENANT, maxUnits: 10, unitCost: 1 },
      ],
      allocations: [
        { owner: "agent-a", tenant: TENANT, allocatedUnits: 1, reservedCost: 1 },
        { owner: "agent-b", tenant: TENANT, allocatedUnits: 7, reservedCost: 7 },
      ],
      computedAt: "t",
    });
    if (!result.ok) throw new Error(result.reasonCode);
    expect(result.view.owners.map((o) => o.owner)).toEqual(["agent-a", "agent-b"]);
    expect(result.view.owners[0]?.utilizationBps).toBe(3333);
    expect(result.view.owners[1]?.utilizationBps).toBe(7000);
    expect(result.view.owners[1]?.remainingUnits).toBe(3);
    expect(result.view.totals).toEqual({
      ownerCount: 2,
      usedUnits: 8,
      maxUnits: 13,
      utilizationBps: 6153,
      overAllocatedOwners: 0,
    });
  });

  it("reports over-allocation honestly — remaining goes negative, never clamped", () => {
    const result = buildWorkloadRollup({
      tenant: TENANT,
      capacities: [{ owner: "agent-a", tenant: TENANT, maxUnits: 2, unitCost: 1 }],
      allocations: [{ owner: "agent-a", tenant: TENANT, allocatedUnits: 5, reservedCost: 5 }],
      computedAt: "t",
    });
    if (!result.ok) throw new Error(result.reasonCode);
    expect(result.view.owners[0]?.overAllocated).toBe(true);
    expect(result.view.owners[0]?.remainingUnits).toBe(-3);
    expect(result.view.owners[0]?.utilizationBps).toBe(25000);
    expect(result.view.totals.overAllocatedOwners).toBe(1);
  });

  it("zero capacity floors to 0 bps; cross-tenant allocation refuses the rollup", () => {
    const zero = buildWorkloadRollup({
      tenant: TENANT,
      capacities: [{ owner: "agent-a", tenant: TENANT, maxUnits: 0, unitCost: 1 }],
      allocations: [],
      computedAt: "t",
    });
    if (!zero.ok) throw new Error(zero.reasonCode);
    expect(zero.view.owners[0]?.utilizationBps).toBe(0);

    const refused = buildWorkloadRollup({
      tenant: TENANT,
      capacities: [{ owner: "agent-a", tenant: TENANT, maxUnits: 5, unitCost: 1 }],
      allocations: [{ owner: "agent-a", tenant: OTHER, allocatedUnits: 1, reservedCost: 1 }],
      computedAt: "t",
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reasonCode).toBe("TENANT_MISMATCH");
  });
});
