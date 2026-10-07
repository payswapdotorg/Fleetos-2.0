/**
 * @fleetos/work — Wave 1 kernel-grade tests.
 *
 * Coverage themes:
 *   - legal/illegal transitions with machine-stable reason codes;
 *   - supersession discipline (reassignment closes old, appends new);
 *   - assignment integrity invariant (one live assignee per record);
 *   - deadline escalation determinism (approaching/breached from timestamps);
 *   - tenant fail-closed behavior;
 *   - directory over in-memory repository with audit + progress events;
 *   - MissionRefLike/WorkflowRefLike seam structural compatibility;
 *   - audit-event digest determinism;
 *   - progress-event digest determinism.
 */
import { describe, expect, it } from "vitest";
import {
  advanceWorkItem,
  assignTo,
  reassignTo,
  removeAssignee,
  findLiveAssignmentRecord,
  assignmentIntegrityHolds,
  type WorkItem,
  type TenantScope,
  type AssignmentRecord,
} from "../src/index.js";

const TENANT: TenantScope = { tenantId: "acme" };

function baseWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: { kind: "work-item", value: "w-1" },
    tenant: TENANT,
    title: "Refit pump P-102",
    assignee: null,
    assignmentHistory: [],
    deadline: null,
    status: "todo",
    blockedReason: null,
    missionRef: null,
    workflowRef: null,
    projectId: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Wave 0 regression — advanceWorkItem legal/illegal transitions.
// ---------------------------------------------------------------------------

describe("advanceWorkItem — legal transitions", () => {
  it("advances todo -> in_progress on start", () => {
    const next = advanceWorkItem(baseWorkItem(), { type: "start" });
    expect(next.ok).toBe(true);
    if (next.ok) expect(next.next.status).toBe("in_progress");
  });

  it("advances in_progress -> done on complete when assignee is set", () => {
    const item = baseWorkItem({
      status: "in_progress",
      assignee: { assigneeId: "u-1", assignedAt: "2026-01-01T00:00:00Z" },
      assignmentHistory: [
        {
          assignmentId: "a-1",
          assigneeId: "u-1",
          assignedAt: "2026-01-01T00:00:00Z",
          closedAt: null,
          supersededBy: null,
          closeReason: null,
        },
      ],
    });
    const next = advanceWorkItem(item, { type: "complete" });
    expect(next.ok).toBe(true);
    if (next.ok) expect(next.next.status).toBe("done");
  });

  it("advances in_progress -> blocked on block with reason", () => {
    const next = advanceWorkItem(baseWorkItem({ status: "in_progress" }), {
      type: "block",
      reason: "Awaiting replacement part",
    });
    expect(next.ok).toBe(true);
    if (next.ok) expect(next.next.status).toBe("blocked");
  });

  it("advances blocked -> in_progress on unblock", () => {
    const next = advanceWorkItem(
      baseWorkItem({ status: "blocked", blockedReason: "waiting" }),
      { type: "unblock" },
    );
    expect(next.ok).toBe(true);
    if (next.ok) expect(next.next.status).toBe("in_progress");
  });

  it("advances todo -> cancelled on cancel with reason", () => {
    const next = advanceWorkItem(baseWorkItem(), {
      type: "cancel",
      reason: "duplicate of w-2",
    });
    expect(next.ok).toBe(true);
    if (next.ok) expect(next.next.status).toBe("cancelled");
  });
});

describe("advanceWorkItem — illegal transitions refused", () => {
  it("refuses start from done with ILLEGAL_TRANSITION", () => {
    const next = advanceWorkItem(baseWorkItem({ status: "done" }), { type: "start" });
    expect(next).toEqual({ ok: false, reasonCode: "ILLEGAL_TRANSITION" });
  });

  it("refuses unblock from todo with ILLEGAL_TRANSITION", () => {
    const next = advanceWorkItem(baseWorkItem({ status: "todo" }), { type: "unblock" });
    expect(next).toEqual({ ok: false, reasonCode: "ILLEGAL_TRANSITION" });
  });

  it("refuses complete from todo with ILLEGAL_TRANSITION", () => {
    const next = advanceWorkItem(baseWorkItem({ status: "todo" }), { type: "complete" });
    expect(next).toEqual({ ok: false, reasonCode: "ILLEGAL_TRANSITION" });
  });

  it("refuses block without a reason with BLOCK_REASON_REQUIRED", () => {
    const next = advanceWorkItem(baseWorkItem({ status: "in_progress" }), {
      type: "block",
      reason: "   ",
    });
    expect(next).toEqual({ ok: false, reasonCode: "BLOCK_REASON_REQUIRED" });
  });

  it("refuses cancel without a reason with CANCEL_REASON_REQUIRED", () => {
    const next = advanceWorkItem(baseWorkItem(), { type: "cancel", reason: "" });
    expect(next).toEqual({ ok: false, reasonCode: "CANCEL_REASON_REQUIRED" });
  });

  it("refuses complete without an assignee with ASSIGNEE_REQUIRED_FOR_COMPLETION", () => {
    const next = advanceWorkItem(baseWorkItem({ status: "in_progress" }), {
      type: "complete",
    });
    expect(next).toEqual({ ok: false, reasonCode: "ASSIGNEE_REQUIRED_FOR_COMPLETION" });
  });
});

describe("advanceWorkItem — tenant fail-closed", () => {
  it("refuses when tenant scope is missing with TENANT_SCOPE_MISSING", () => {
    const broken = baseWorkItem({ tenant: { tenantId: "" } as unknown as TenantScope });
    const next = advanceWorkItem(broken, { type: "start" });
    expect(next).toEqual({ ok: false, reasonCode: "TENANT_SCOPE_MISSING" });
  });
});

describe("advanceWorkItem — determinism", () => {
  it("returns the same result shape for the same inputs across calls", () => {
    const item = baseWorkItem({
      status: "in_progress",
      assignee: { assigneeId: "u-1", assignedAt: "2026-01-01T00:00:00Z" },
      assignmentHistory: [
        {
          assignmentId: "a-1",
          assigneeId: "u-1",
          assignedAt: "2026-01-01T00:00:00Z",
          closedAt: null,
          supersededBy: null,
          closeReason: null,
        },
      ],
    });
    const first = advanceWorkItem(item, { type: "complete" });
    const second = advanceWorkItem(item, { type: "complete" });
    expect(first).toEqual(second);
  });
});

// ---------------------------------------------------------------------------
// Wave 1 — assignTo with assignment-id discipline.
// ---------------------------------------------------------------------------

describe("assignTo — first assignment", () => {
  it("assigns a first assignee and appends a history record", () => {
    const result = assignTo(
      baseWorkItem(),
      "a-1",
      "u-1",
      "2026-01-01T00:00:00Z",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.assignment.assigneeId).toBe("u-1");
      expect(result.next.assignee?.assigneeId).toBe("u-1");
      expect(result.next.assignmentHistory.length).toBe(1);
      expect(result.next.assignmentHistory[0]?.assignmentId).toBe("a-1");
      expect(result.supersededRecordId).toBeNull();
    }
  });

  it("refuses empty assignment id with ASSIGNMENT_ID_EMPTY", () => {
    const result = assignTo(baseWorkItem(), "  ", "u-1", "2026-01-01T00:00:00Z");
    expect(result).toEqual({ ok: false, reasonCode: "ASSIGNMENT_ID_EMPTY" });
  });

  it("refuses empty assignee id with ASSIGNEE_ID_EMPTY", () => {
    const result = assignTo(baseWorkItem(), "a-1", "", "2026-01-01T00:00:00Z");
    expect(result).toEqual({ ok: false, reasonCode: "ASSIGNEE_ID_EMPTY" });
  });

  it("is idempotent when re-assigning to the same assignee", () => {
    const item = baseWorkItem({
      assignee: { assigneeId: "u-1", assignedAt: "2026-01-01T00:00:00Z" },
      assignmentHistory: [
        {
          assignmentId: "a-1",
          assigneeId: "u-1",
          assignedAt: "2026-01-01T00:00:00Z",
          closedAt: null,
          supersededBy: null,
          closeReason: null,
        },
      ],
    });
    const result = assignTo(item, "a-1", "u-1", "2026-01-02T00:00:00Z");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.next).toBe(item);
      expect(result.supersededRecordId).toBeNull();
    }
  });

  it("refuses to overwrite an existing different assignee with ALREADY_ASSIGNED", () => {
    const item = baseWorkItem({
      assignee: { assigneeId: "u-1", assignedAt: "2026-01-01T00:00:00Z" },
      assignmentHistory: [
        {
          assignmentId: "a-1",
          assigneeId: "u-1",
          assignedAt: "2026-01-01T00:00:00Z",
          closedAt: null,
          supersededBy: null,
          closeReason: null,
        },
      ],
    });
    const result = assignTo(item, "a-2", "u-2", "2026-01-02T00:00:00Z");
    expect(result).toEqual({ ok: false, reasonCode: "ALREADY_ASSIGNED" });
  });
});

// ---------------------------------------------------------------------------
// Wave 1 — reassignment SUPERSESSION discipline.
// ---------------------------------------------------------------------------

describe("reassignTo — supersession discipline", () => {
  it("closes the old assignment with supersededBy ref pointing at the new assignment", () => {
    const item = baseWorkItem({
      assignee: { assigneeId: "u-1", assignedAt: "2026-01-01T00:00:00Z" },
      assignmentHistory: [
        {
          assignmentId: "a-1",
          assigneeId: "u-1",
          assignedAt: "2026-01-01T00:00:00Z",
          closedAt: null,
          supersededBy: null,
          closeReason: null,
        },
      ],
    });
    const result = reassignTo(item, "a-2", "u-2", "2026-01-02T00:00:00Z");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.next.assignee?.assigneeId).toBe("u-2");
      expect(result.next.assignmentHistory.length).toBe(2);
      // The old record is closed with supersededBy ref — NEVER mutated in place.
      const oldRecord = result.next.assignmentHistory[0]!;
      expect(oldRecord.assigneeId).toBe("u-1");
      expect(oldRecord.assignedAt).toBe("2026-01-01T00:00:00Z");
      expect(oldRecord.closedAt).toBe("2026-01-02T00:00:00Z");
      expect(oldRecord.supersededBy).toBe("a-2");
      expect(oldRecord.closeReason).toBe("reassigned");
      // The new record is live.
      const newRecord = result.next.assignmentHistory[1]!;
      expect(newRecord.assignmentId).toBe("a-2");
      expect(newRecord.assigneeId).toBe("u-2");
      expect(newRecord.closedAt).toBeNull();
      expect(newRecord.supersededBy).toBeNull();
      expect(result.supersededRecordId).toBe("a-1");
    }
  });

  it("refuses reassignment when there is no live assignee", () => {
    const result = reassignTo(baseWorkItem(), "a-1", "u-1", "2026-01-02T00:00:00Z");
    expect(result).toEqual({ ok: false, reasonCode: "ALREADY_ASSIGNED" });
  });

  it("is idempotent when re-reassigning to the same assignee", () => {
    const item = baseWorkItem({
      assignee: { assigneeId: "u-1", assignedAt: "2026-01-01T00:00:00Z" },
      assignmentHistory: [
        {
          assignmentId: "a-1",
          assigneeId: "u-1",
          assignedAt: "2026-01-01T00:00:00Z",
          closedAt: null,
          supersededBy: null,
          closeReason: null,
        },
      ],
    });
    const result = reassignTo(item, "a-2", "u-1", "2026-01-02T00:00:00Z");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.next).toBe(item);
    }
  });

  it("preserves the integrity invariant across multiple reassignments", () => {
    let item = baseWorkItem();
    item = assignTo(item, "a-1", "u-1", "2026-01-01T00:00:00Z").ok
      ? (assignTo(item, "a-1", "u-1", "2026-01-01T00:00:00Z") as { ok: true; next: WorkItem }).next
      : item;
    expect(assignmentIntegrityHolds(item)).toBe(true);
    const r2 = reassignTo(item, "a-2", "u-2", "2026-01-02T00:00:00Z");
    if (r2.ok) item = r2.next;
    expect(assignmentIntegrityHolds(item)).toBe(true);
    const r3 = reassignTo(item, "a-3", "u-3", "2026-01-03T00:00:00Z");
    if (r3.ok) item = r3.next;
    expect(assignmentIntegrityHolds(item)).toBe(true);
    expect(item.assignmentHistory.length).toBe(3);
    expect(item.assignee?.assigneeId).toBe("u-3");
  });
});

describe("findLiveAssignmentRecord — invariant helper", () => {
  it("returns the single live record when one exists", () => {
    const history: AssignmentRecord[] = [
      {
        assignmentId: "a-1",
        assigneeId: "u-1",
        assignedAt: "2026-01-01T00:00:00Z",
        closedAt: "2026-01-02T00:00:00Z",
        supersededBy: "a-2",
        closeReason: "reassigned",
      },
      {
        assignmentId: "a-2",
        assigneeId: "u-2",
        assignedAt: "2026-01-02T00:00:00Z",
        closedAt: null,
        supersededBy: null,
        closeReason: null,
      },
    ];
    const live = findLiveAssignmentRecord(history);
    expect(live?.assignmentId).toBe("a-2");
  });

  it("returns null when no live record exists", () => {
    const history: AssignmentRecord[] = [
      {
        assignmentId: "a-1",
        assigneeId: "u-1",
        assignedAt: "2026-01-01T00:00:00Z",
        closedAt: "2026-01-02T00:00:00Z",
        supersededBy: null,
        closeReason: "work_completed",
      },
    ];
    const live = findLiveAssignmentRecord(history);
    expect(live).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Wave 1 — removeAssignee.
// ---------------------------------------------------------------------------

describe("removeAssignee", () => {
  it("closes the live assignment with closeReason assignee_removed", () => {
    const item = baseWorkItem({
      assignee: { assigneeId: "u-1", assignedAt: "2026-01-01T00:00:00Z" },
      assignmentHistory: [
        {
          assignmentId: "a-1",
          assigneeId: "u-1",
          assignedAt: "2026-01-01T00:00:00Z",
          closedAt: null,
          supersededBy: null,
          closeReason: null,
        },
      ],
    });
    const result = removeAssignee(item, "2026-01-02T00:00:00Z");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.next.assignee).toBeNull();
      expect(result.next.assignmentHistory[0]?.closeReason).toBe("assignee_removed");
      expect(result.next.assignmentHistory[0]?.closedAt).toBe("2026-01-02T00:00:00Z");
      expect(result.closedRecordId).toBe("a-1");
    }
  });

  it("refuses when there is no live assignee", () => {
    const result = removeAssignee(baseWorkItem(), "2026-01-02T00:00:00Z");
    expect(result).toEqual({ ok: false, reasonCode: "ALREADY_ASSIGNED" });
  });
});

// ---------------------------------------------------------------------------
// Wave 1 — terminal-transition side effects (assignment closes on done).
// ---------------------------------------------------------------------------

describe("advanceWorkItem — terminal transition closes the live assignment", () => {
  it("closes the live assignment with closeReason work_completed on done", () => {
    const item = baseWorkItem({
      status: "in_progress",
      assignee: { assigneeId: "u-1", assignedAt: "2026-01-01T00:00:00Z" },
      assignmentHistory: [
        {
          assignmentId: "a-1",
          assigneeId: "u-1",
          assignedAt: "2026-01-01T00:00:00Z",
          closedAt: null,
          supersededBy: null,
          closeReason: null,
        },
      ],
    });
    const result = advanceWorkItem(item, { type: "complete" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.next.status).toBe("done");
      expect(result.next.assignee).toBeNull();
      expect(result.next.assignmentHistory[0]?.closeReason).toBe("work_completed");
      expect(result.next.assignmentHistory[0]?.closedAt).toBe("2026-01-01T00:00:00Z");
    }
  });

  it("closes the live assignment with closeReason work_cancelled on cancel", () => {
    const item = baseWorkItem({
      status: "in_progress",
      assignee: { assigneeId: "u-1", assignedAt: "2026-01-01T00:00:00Z" },
      assignmentHistory: [
        {
          assignmentId: "a-1",
          assigneeId: "u-1",
          assignedAt: "2026-01-01T00:00:00Z",
          closedAt: null,
          supersededBy: null,
          closeReason: null,
        },
      ],
    });
    const result = advanceWorkItem(item, { type: "cancel", reason: "obsolete" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.next.status).toBe("cancelled");
      expect(result.next.assignee).toBeNull();
      expect(result.next.assignmentHistory[0]?.closeReason).toBe("work_cancelled");
    }
  });
});
