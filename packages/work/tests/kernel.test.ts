/**
 * @fleetos/work — deadline escalation + progress event + audit event
 * + directory tests (Wave 1 kernel-grade).
 */
import { describe, expect, it } from "vitest";
import {
  evaluateDeadline,
  produceDeadlineEscalation,
  markDeadlineMet,
  progressEventForTransition,
  progressEventForAssignment,
  progressEventForDeadlineEscalation,
  computeProgressDigest,
  makeAuditEvent,
  computeAuditDigest,
  createWorkItemDirectory,
  createInMemoryWorkRepository,
  type WorkItem,
  type TenantScope,
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
// Deadline escalation.
// ---------------------------------------------------------------------------

describe("evaluateDeadline — deterministic from timestamps", () => {
  it("returns status none when deadline is null", () => {
    const state = evaluateDeadline(null, "2026-01-01T00:00:00Z", 1000);
    expect(state.status).toBe("none");
    expect(state.approaching).toBe(false);
    expect(state.breached).toBe(false);
  });

  it("returns status scheduled when the deadline is far in the future", () => {
    const state = evaluateDeadline(
      "2026-12-31T00:00:00Z",
      "2026-01-01T00:00:00Z",
      24 * 60 * 60 * 1000,
    );
    expect(state.status).toBe("scheduled");
    expect(state.approaching).toBe(false);
    expect(state.breached).toBe(false);
  });

  it("returns status approaching when within the window but not breached", () => {
    const state = evaluateDeadline(
      "2026-01-02T00:00:00Z",
      "2026-01-01T12:00:00Z",
      24 * 60 * 60 * 1000,
    );
    expect(state.status).toBe("approaching");
    expect(state.approaching).toBe(true);
    expect(state.breached).toBe(false);
  });

  it("returns status breached when now is past the deadline", () => {
    const state = evaluateDeadline(
      "2026-01-01T00:00:00Z",
      "2026-01-02T00:00:00Z",
      24 * 60 * 60 * 1000,
    );
    expect(state.status).toBe("breached");
    expect(state.breached).toBe(true);
    expect(state.approaching).toBe(false);
    expect(state.millisUntilDeadline).toBeLessThan(0);
  });

  it("is deterministic — same inputs produce the same state across calls", () => {
    const a = evaluateDeadline("2026-01-02T00:00:00Z", "2026-01-01T00:00:00Z", 1000);
    const b = evaluateDeadline("2026-01-02T00:00:00Z", "2026-01-01T00:00:00Z", 1000);
    expect(a).toEqual(b);
  });

  it("treats unparseable timestamps as no-deadline (honest degradation)", () => {
    const state = evaluateDeadline("not-a-timestamp", "2026-01-01T00:00:00Z", 1000);
    expect(state.status).toBe("none");
  });
});

describe("produceDeadlineEscalation — escalation surface", () => {
  it("produces a deadline.breached escalation when breached", () => {
    const escalation = produceDeadlineEscalation({
      workItemId: "w-1",
      tenantId: "acme",
      deadline: "2026-01-01T00:00:00Z",
      now: "2026-01-02T00:00:00Z",
      approachingWindowMillis: 1000,
    });
    expect(escalation).not.toBeNull();
    expect(escalation?.kind).toBe("deadline.breached");
    expect(escalation?.workItemId).toBe("w-1");
    expect(escalation?.tenantId).toBe("acme");
  });

  it("produces a deadline.approaching escalation when within the window", () => {
    const escalation = produceDeadlineEscalation({
      workItemId: "w-1",
      tenantId: "acme",
      deadline: "2026-01-02T00:00:00Z",
      now: "2026-01-01T12:00:00Z",
      approachingWindowMillis: 24 * 60 * 60 * 1000,
    });
    expect(escalation?.kind).toBe("deadline.approaching");
  });

  it("produces null when the deadline is far away", () => {
    const escalation = produceDeadlineEscalation({
      workItemId: "w-1",
      tenantId: "acme",
      deadline: "2026-12-31T00:00:00Z",
      now: "2026-01-01T00:00:00Z",
      approachingWindowMillis: 1000,
    });
    expect(escalation).toBeNull();
  });

  it("produces null when deadline is null", () => {
    const escalation = produceDeadlineEscalation({
      workItemId: "w-1",
      tenantId: "acme",
      deadline: null,
      now: "2026-01-01T00:00:00Z",
      approachingWindowMillis: 1000,
    });
    expect(escalation).toBeNull();
  });
});

describe("markDeadlineMet", () => {
  it("returns status met for a non-null deadline", () => {
    const state = markDeadlineMet("2026-01-01T00:00:00Z");
    expect(state.status).toBe("met");
  });

  it("returns status none when the deadline was null", () => {
    const state = markDeadlineMet(null);
    expect(state.status).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// Progress events.
// ---------------------------------------------------------------------------

describe("progressEventForTransition — typed events", () => {
  it("produces a work.started event for todo -> in_progress", () => {
    const event = progressEventForTransition({
      tenant: TENANT,
      workItem: baseWorkItem(),
      fromStatus: "todo",
      toStatus: "in_progress",
      emittedAt: "2026-01-01T00:00:00Z",
    });
    expect(event.kind).toBe("work.started");
    expect(event.workItemId).toBe("w-1");
    expect(event.fromStatus).toBe("todo");
    expect(event.toStatus).toBe("in_progress");
    expect(event.digest).toMatch(/^progress_[0-9a-f]{8}$/);
  });

  it("produces a work.completed event for in_progress -> done", () => {
    const event = progressEventForTransition({
      tenant: TENANT,
      workItem: baseWorkItem(),
      fromStatus: "in_progress",
      toStatus: "done",
      emittedAt: "2026-01-01T00:00:00Z",
    });
    expect(event.kind).toBe("work.completed");
  });

  it("produces a work.blocked event for in_progress -> blocked", () => {
    const event = progressEventForTransition({
      tenant: TENANT,
      workItem: baseWorkItem(),
      fromStatus: "in_progress",
      toStatus: "blocked",
      emittedAt: "2026-01-01T00:00:00Z",
    });
    expect(event.kind).toBe("work.blocked");
  });

  it("produces a work.unblocked event for blocked -> in_progress", () => {
    const event = progressEventForTransition({
      tenant: TENANT,
      workItem: baseWorkItem(),
      fromStatus: "blocked",
      toStatus: "in_progress",
      emittedAt: "2026-01-01T00:00:00Z",
    });
    expect(event.kind).toBe("work.unblocked");
  });

  it("produces a work.cancelled event for todo -> cancelled", () => {
    const event = progressEventForTransition({
      tenant: TENANT,
      workItem: baseWorkItem(),
      fromStatus: "todo",
      toStatus: "cancelled",
      emittedAt: "2026-01-01T00:00:00Z",
    });
    expect(event.kind).toBe("work.cancelled");
  });

  it("carries missionRef when the work item has one", () => {
    const event = progressEventForTransition({
      tenant: TENANT,
      workItem: baseWorkItem({
        missionRef: { missionId: "m-1", runId: "r-1" },
      }),
      fromStatus: "todo",
      toStatus: "in_progress",
      emittedAt: "2026-01-01T00:00:00Z",
    });
    expect(event.missionRef?.missionId).toBe("m-1");
  });

  it("is deterministic — same inputs produce the same digest", () => {
    const a = progressEventForTransition({
      tenant: TENANT,
      workItem: baseWorkItem(),
      fromStatus: "todo",
      toStatus: "in_progress",
      emittedAt: "2026-01-01T00:00:00Z",
    });
    const b = progressEventForTransition({
      tenant: TENANT,
      workItem: baseWorkItem(),
      fromStatus: "todo",
      toStatus: "in_progress",
      emittedAt: "2026-01-01T00:00:00Z",
    });
    expect(a.digest).toBe(b.digest);
  });
});

describe("progressEventForAssignment", () => {
  it("produces a work.assigned event", () => {
    const event = progressEventForAssignment({
      tenant: TENANT,
      workItem: baseWorkItem(),
      kind: "work.assigned",
      assigneeId: "u-1",
      emittedAt: "2026-01-01T00:00:00Z",
    });
    expect(event.kind).toBe("work.assigned");
    expect(event.reason).toBe("u-1");
  });

  it("produces a work.reassigned event", () => {
    const event = progressEventForAssignment({
      tenant: TENANT,
      workItem: baseWorkItem(),
      kind: "work.reassigned",
      assigneeId: "u-2",
      emittedAt: "2026-01-01T00:00:00Z",
    });
    expect(event.kind).toBe("work.reassigned");
    expect(event.reason).toBe("u-2");
  });
});

describe("progressEventForDeadlineEscalation", () => {
  it("produces a work.deadline-approaching event", () => {
    const event = progressEventForDeadlineEscalation({
      tenant: TENANT,
      workItem: baseWorkItem(),
      kind: "work.deadline-approaching",
      emittedAt: "2026-01-01T00:00:00Z",
      millisUntilDeadline: 1000,
    });
    expect(event.kind).toBe("work.deadline-approaching");
    expect(event.reason).toContain("1000");
  });

  it("produces a work.deadline-breached event", () => {
    const event = progressEventForDeadlineEscalation({
      tenant: TENANT,
      workItem: baseWorkItem(),
      kind: "work.deadline-breached",
      emittedAt: "2026-01-01T00:00:00Z",
      millisUntilDeadline: -1000,
    });
    expect(event.kind).toBe("work.deadline-breached");
  });
});

describe("computeProgressDigest — determinism", () => {
  it("returns the same digest for the same inputs", () => {
    const inputs = {
      kind: "work.started" as const,
      workItemId: "w-1",
      tenantId: "acme",
      emittedAt: "2026-01-01T00:00:00Z",
      fromStatus: "todo" as const,
      toStatus: "in_progress" as const,
    };
    expect(computeProgressDigest(inputs)).toBe(computeProgressDigest(inputs));
  });
});

// ---------------------------------------------------------------------------
// Audit events.
// ---------------------------------------------------------------------------

describe("makeAuditEvent + computeAuditDigest", () => {
  it("constructs an audit event with a stable digest", () => {
    const event = makeAuditEvent({
      kind: "work-item.transitioned",
      tenant: TENANT,
      workItemId: "w-1",
      occurredAt: "2026-01-01T00:00:00Z",
      fromStatus: "todo",
      toStatus: "in_progress",
    });
    expect(event.kind).toBe("work-item.transitioned");
    expect(event.workItemId).toBe("w-1");
    expect(event.fromStatus).toBe("todo");
    expect(event.toStatus).toBe("in_progress");
    expect(event.digest).toMatch(/^audit_[0-9a-f]{8}$/);
    expect(event.actorRef).toBeNull();
    expect(event.missionRef).toBeNull();
    expect(event.authorizationRef).toBeNull();
    expect(event.evidenceRef).toBeNull();
  });

  it("attaches optional refs when provided", () => {
    const event = makeAuditEvent({
      kind: "work-item.assigned",
      tenant: TENANT,
      workItemId: "w-1",
      occurredAt: "2026-01-01T00:00:00Z",
      fromStatus: "todo",
      toStatus: "todo",
      actorRef: { actorId: "act-1", tenantId: "acme" },
      missionRef: { missionId: "m-1" },
      authorizationRef: { decisionId: "d-1", authorized: true, reasonCode: "allow.matched_rule" },
      evidenceRef: { evidenceId: "e-1", tenantId: "acme" },
    });
    expect(event.actorRef?.actorId).toBe("act-1");
    expect(event.missionRef?.missionId).toBe("m-1");
    expect(event.authorizationRef?.decisionId).toBe("d-1");
    expect(event.evidenceRef?.evidenceId).toBe("e-1");
  });

  it("is deterministic — same inputs produce the same digest", () => {
    const inputs = {
      kind: "work-item.transitioned" as const,
      tenantId: "acme",
      workItemId: "w-1",
      occurredAt: "2026-01-01T00:00:00Z",
      fromStatus: "todo" as const,
      toStatus: "in_progress" as const,
    };
    expect(computeAuditDigest(inputs)).toBe(computeAuditDigest(inputs));
  });
});

// ---------------------------------------------------------------------------
// Directory over in-memory repository.
// ---------------------------------------------------------------------------

describe("WorkItemDirectory over InMemoryWorkRepository", () => {
  it("transitions a work item and emits audit + progress events", async () => {
    const repo = createInMemoryWorkRepository([baseWorkItem()]);
    const directory = createWorkItemDirectory(repo);
    const result = await directory.transition(
      TENANT,
      { kind: "work-item", value: "w-1" },
      { type: "start" },
      { occurredAt: "2026-01-01T00:00:00Z" },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.workItem.status).toBe("in_progress");
      expect(result.auditEvents.length).toBe(1);
      expect(result.auditEvents[0]?.kind).toBe("work-item.transitioned");
      expect(result.progressEvents.length).toBe(1);
      expect(result.progressEvents[0]?.kind).toBe("work.started");
    }
  });

  it("refuses transition for an unknown work item with WORK_ITEM_NOT_FOUND", async () => {
    const repo = createInMemoryWorkRepository();
    const directory = createWorkItemDirectory(repo);
    const result = await directory.transition(
      TENANT,
      { kind: "work-item", value: "missing" },
      { type: "start" },
      { occurredAt: "2026-01-01T00:00:00Z" },
    );
    expect(result).toEqual({ ok: false, reasonCode: "WORK_ITEM_NOT_FOUND" });
  });

  it("refuses transition with WORK_ITEM_NOT_FOUND for a cross-tenant call (fail-closed: no tenant leak)", async () => {
    const other: TenantScope = { tenantId: "other" };
    const repo = createInMemoryWorkRepository([
      baseWorkItem({ tenant: other }),
    ]);
    const directory = createWorkItemDirectory(repo);
    const result = await directory.transition(
      TENANT,
      { kind: "work-item", value: "w-1" },
      { type: "start" },
      { occurredAt: "2026-01-01T00:00:00Z" },
    );
    // The in-memory repository's load() is tenant-scoped and returns null
    // for cross-tenant reads — so the directory surfaces
    // WORK_ITEM_NOT_FOUND rather than leaking the item's existence to a
    // different tenant. This is the fail-closed boundary (law A8).
    expect(result).toEqual({ ok: false, reasonCode: "WORK_ITEM_NOT_FOUND" });
  });

  it("refuses transition with TENANT_SCOPE_MISSING when tenant scope is broken", async () => {
    const repo = createInMemoryWorkRepository([baseWorkItem()]);
    const directory = createWorkItemDirectory(repo);
    const result = await directory.transition(
      { tenantId: "" } as unknown as TenantScope,
      { kind: "work-item", value: "w-1" },
      { type: "start" },
      { occurredAt: "2026-01-01T00:00:00Z" },
    );
    expect(result).toEqual({ ok: false, reasonCode: "TENANT_SCOPE_MISSING" });
  });

  it("assigns a first assignee and emits audit + progress events", async () => {
    const repo = createInMemoryWorkRepository([baseWorkItem()]);
    const directory = createWorkItemDirectory(repo);
    const result = await directory.assign(
      TENANT,
      { kind: "work-item", value: "w-1" },
      "a-1",
      "u-1",
      "2026-01-01T00:00:00Z",
      { occurredAt: "2026-01-01T00:00:00Z" },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.workItem.assignee?.assigneeId).toBe("u-1");
      expect(result.auditEvents[0]?.kind).toBe("work-item.assigned");
      expect(result.progressEvents[0]?.kind).toBe("work.assigned");
    }
  });

  it("reassigns via supersession and emits work-item.reassigned audit", async () => {
    const repo = createInMemoryWorkRepository([
      baseWorkItem({
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
      }),
    ]);
    const directory = createWorkItemDirectory(repo);
    const result = await directory.reassign(
      TENANT,
      { kind: "work-item", value: "w-1" },
      "a-2",
      "u-2",
      "2026-01-02T00:00:00Z",
      { occurredAt: "2026-01-02T00:00:00Z" },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.workItem.assignee?.assigneeId).toBe("u-2");
      expect(result.auditEvents[0]?.kind).toBe("work-item.reassigned");
      expect(result.progressEvents[0]?.kind).toBe("work.reassigned");
      const old = result.workItem.assignmentHistory[0];
      expect(old?.supersededBy).toBe("a-2");
    }
  });

  it("get returns the work item for the same tenant", async () => {
    const repo = createInMemoryWorkRepository([baseWorkItem()]);
    const directory = createWorkItemDirectory(repo);
    const item = await directory.get(TENANT, { kind: "work-item", value: "w-1" });
    expect(item?.id.value).toBe("w-1");
  });

  it("get returns null for a cross-tenant call (fail-closed)", async () => {
    const other: TenantScope = { tenantId: "other" };
    const repo = createInMemoryWorkRepository([baseWorkItem()]);
    const directory = createWorkItemDirectory(repo);
    const item = await directory.get(other, { kind: "work-item", value: "w-1" });
    expect(item).toBeNull();
  });

  it("list returns only items for the calling tenant", async () => {
    const other: TenantScope = { tenantId: "other" };
    const repo = createInMemoryWorkRepository([
      baseWorkItem({ id: { kind: "work-item", value: "w-1" } }),
      baseWorkItem({
        id: { kind: "work-item", value: "w-2" },
        tenant: other,
      }),
    ]);
    const directory = createWorkItemDirectory(repo);
    const items = await directory.list(TENANT);
    expect(items.length).toBe(1);
    expect(items[0]?.id.value).toBe("w-1");
  });

  it("listTerminal returns only terminal-status items for the calling tenant", async () => {
    const repo = createInMemoryWorkRepository([
      baseWorkItem({ id: { kind: "work-item", value: "w-1" }, status: "todo" }),
      baseWorkItem({ id: { kind: "work-item", value: "w-2" }, status: "done" }),
      baseWorkItem({ id: { kind: "work-item", value: "w-3" }, status: "cancelled" }),
    ]);
    const directory = createWorkItemDirectory(repo);
    const items = await directory.listTerminal(TENANT);
    expect(items.length).toBe(2);
    expect(items.map((i) => i.id.value).sort()).toEqual(["w-2", "w-3"]);
  });

  it("directory transitions persist via the repository", async () => {
    const repo = createInMemoryWorkRepository([baseWorkItem()]);
    const directory = createWorkItemDirectory(repo);
    await directory.transition(
      TENANT,
      { kind: "work-item", value: "w-1" },
      { type: "start" },
      { occurredAt: "2026-01-01T00:00:00Z" },
    );
    const after = await directory.get(TENANT, { kind: "work-item", value: "w-1" });
    expect(after?.status).toBe("in_progress");
  });
});

// ---------------------------------------------------------------------------
// MissionRefLike / WorkflowRefLike seam structural compatibility.
// ---------------------------------------------------------------------------

describe("MissionRefLike / WorkflowRefLike seam", () => {
  it("work items carry a missionRef without runtime cross-package import", () => {
    const item = baseWorkItem({
      missionRef: { missionId: "m-1", runId: "r-1", workItemId: "w-1" },
    });
    expect(item.missionRef?.missionId).toBe("m-1");
    expect(item.missionRef?.runId).toBe("r-1");
    expect(item.missionRef?.workItemId).toBe("w-1");
  });

  it("work items carry a workflowRef without runtime cross-package import", () => {
    const item = baseWorkItem({
      workflowRef: { workflowRunId: "wf-1", missionId: "m-1" },
    });
    expect(item.workflowRef?.workflowRunId).toBe("wf-1");
    expect(item.workflowRef?.missionId).toBe("m-1");
  });
});
