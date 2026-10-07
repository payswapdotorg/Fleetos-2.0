/**
 * @fleetos/projects — Wave 1 kernel-grade tests.
 *
 * Coverage themes:
 *   - milestone gating with honest blocking-item reports;
 *   - legal/illegal project transitions with reason codes;
 *   - portfolio read models (tenant-scoped);
 *   - directory over in-memory repository with audit events;
 *   - tenant fail-closed behavior;
 *   - determinism.
 */
import { describe, expect, it } from "vitest";
import {
  transitionProject,
  checkMilestoneGate,
  milestoneIsCloseable,
  createProjectDirectory,
  createInMemoryProjectRepository,
  type Project,
  type Milestone,
  type TenantScope,
  type WorkItemStatusRefLike,
} from "../src/index.js";

const TENANT: TenantScope = { tenantId: "acme" };

function baseProject(overrides: Partial<Project> = {}): Project {
  return {
    id: { kind: "project", value: "p-1" },
    tenant: TENANT,
    name: "Refit pump P-102",
    status: "draft",
    milestoneIds: ["m-1"],
    ...overrides,
  };
}

function baseMilestone(overrides: Partial<Milestone> = {}): Milestone {
  return {
    id: { kind: "milestone", value: "m-1" },
    tenant: TENANT,
    projectId: "p-1",
    name: "Phase 1",
    status: "open",
    workItemIds: ["w-1", "w-2"],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Project lifecycle transitions.
// ---------------------------------------------------------------------------

describe("transitionProject — legal transitions", () => {
  it("draft -> active on activate", () => {
    const next = transitionProject(baseProject(), { type: "activate" });
    expect(next.ok).toBe(true);
    if (next.ok) expect(next.next.status).toBe("active");
  });

  it("active -> on_hold on hold with reason", () => {
    const next = transitionProject(baseProject({ status: "active" }), {
      type: "hold",
      reason: "waiting on parts",
    });
    expect(next.ok).toBe(true);
    if (next.ok) expect(next.next.status).toBe("on_hold");
  });

  it("on_hold -> active on resume", () => {
    const next = transitionProject(
      baseProject({ status: "on_hold" }),
      { type: "resume" },
    );
    expect(next.ok).toBe(true);
    if (next.ok) expect(next.next.status).toBe("active");
  });

  it("active -> completed on complete", () => {
    const next = transitionProject(
      baseProject({ status: "active" }),
      { type: "complete" },
    );
    expect(next.ok).toBe(true);
    if (next.ok) expect(next.next.status).toBe("completed");
  });

  it("draft -> cancelled on cancel with reason", () => {
    const next = transitionProject(baseProject(), {
      type: "cancel",
      reason: "obsolete",
    });
    expect(next.ok).toBe(true);
    if (next.ok) expect(next.next.status).toBe("cancelled");
  });
});

describe("transitionProject — illegal transitions refused", () => {
  it("refuses activate from completed with ILLEGAL_TRANSITION", () => {
    const next = transitionProject(
      baseProject({ status: "completed" }),
      { type: "activate" },
    );
    expect(next).toEqual({ ok: false, reasonCode: "ILLEGAL_TRANSITION" });
  });

  it("refuses hold without a reason with HOLD_REASON_REQUIRED", () => {
    const next = transitionProject(
      baseProject({ status: "active" }),
      { type: "hold", reason: "   " },
    );
    expect(next).toEqual({ ok: false, reasonCode: "HOLD_REASON_REQUIRED" });
  });

  it("refuses cancel without a reason with CANCEL_REASON_REQUIRED", () => {
    const next = transitionProject(baseProject(), { type: "cancel", reason: "" });
    expect(next).toEqual({ ok: false, reasonCode: "CANCEL_REASON_REQUIRED" });
  });

  it("refuses on broken tenant scope with TENANT_SCOPE_MISSING", () => {
    const next = transitionProject(
      baseProject({ tenant: { tenantId: "" } as unknown as TenantScope }),
      { type: "activate" },
    );
    expect(next).toEqual({ ok: false, reasonCode: "TENANT_SCOPE_MISSING" });
  });
});

// ---------------------------------------------------------------------------
// Milestone gating — REAL kernel-grade with honest blocking-item reports.
// ---------------------------------------------------------------------------

describe("checkMilestoneGate — honest blocking-item reports", () => {
  it("achieves when all work items are terminal", () => {
    const m = baseMilestone();
    const workItems: WorkItemStatusRefLike[] = [
      { id: "w-1", status: "done" },
      { id: "w-2", status: "cancelled" },
    ];
    const result = checkMilestoneGate(m, workItems);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.status).toBe("achieved");
  });

  it("refuses with WORK_ITEMS_NOT_TERMINAL and reports blocking items", () => {
    const m = baseMilestone();
    const workItems: WorkItemStatusRefLike[] = [
      { id: "w-1", status: "in_progress" },
      { id: "w-2", status: "done" },
    ];
    const result = checkMilestoneGate(m, workItems);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("WORK_ITEMS_NOT_TERMINAL");
      expect(result.blockingItems.length).toBe(1);
      expect(result.blockingItems[0]?.workItemId).toBe("w-1");
      expect(result.blockingItems[0]?.currentStatus).toBe("in_progress");
      expect(result.blockingItems[0]?.reasonCode).toBe("WORK_ITEM_NOT_TERMINAL");
    }
  });

  it("reports WORK_ITEM_UNKNOWN when a work item is not in the provided list", () => {
    const m = baseMilestone();
    const workItems: WorkItemStatusRefLike[] = [
      { id: "w-1", status: "done" },
      // w-2 missing
    ];
    const result = checkMilestoneGate(m, workItems);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("WORK_ITEMS_NOT_TERMINAL");
      expect(result.blockingItems[0]?.workItemId).toBe("w-2");
      expect(result.blockingItems[0]?.currentStatus).toBe("unknown");
      expect(result.blockingItems[0]?.reasonCode).toBe("WORK_ITEM_UNKNOWN");
    }
  });

  it("refuses with EMPTY_MILESTONE when the milestone has no work items", () => {
    const m = baseMilestone({ workItemIds: [] });
    const result = checkMilestoneGate(m, []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe("EMPTY_MILESTONE");
  });

  it("refuses with TENANT_SCOPE_MISSING on broken tenant", () => {
    const m = baseMilestone({ tenant: { tenantId: "" } as unknown as TenantScope });
    const result = checkMilestoneGate(m, []);
    expect(result).toEqual({ ok: false, reasonCode: "TENANT_SCOPE_MISSING", blockingItems: [] });
  });

  it("is deterministic — same inputs produce the same result", () => {
    const m = baseMilestone();
    const workItems: WorkItemStatusRefLike[] = [
      { id: "w-1", status: "in_progress" },
      { id: "w-2", status: "done" },
    ];
    expect(checkMilestoneGate(m, workItems)).toEqual(checkMilestoneGate(m, workItems));
  });
});

describe("milestoneIsCloseable", () => {
  it("returns true when all work items are terminal", () => {
    const m = baseMilestone();
    const workItems: WorkItemStatusRefLike[] = [
      { id: "w-1", status: "done" },
      { id: "w-2", status: "cancelled" },
    ];
    expect(milestoneIsCloseable(m, workItems)).toBe(true);
  });

  it("returns false when any work item is non-terminal", () => {
    const m = baseMilestone();
    const workItems: WorkItemStatusRefLike[] = [
      { id: "w-1", status: "todo" },
      { id: "w-2", status: "done" },
    ];
    expect(milestoneIsCloseable(m, workItems)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ProjectDirectory over in-memory repository.
// ---------------------------------------------------------------------------

describe("ProjectDirectory over InMemoryProjectRepository", () => {
  it("transitions a project and emits an audit event", async () => {
    const repo = createInMemoryProjectRepository([baseProject()]);
    const directory = createProjectDirectory(repo);
    const result = await directory.transitionProject(
      TENANT,
      { kind: "project", value: "p-1" },
      { type: "activate" },
      { occurredAt: "2026-01-01T00:00:00Z" },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.project?.status).toBe("active");
      expect(result.auditEvents.length).toBe(1);
      expect(result.auditEvents[0]?.kind).toBe("project.transitioned");
      expect(result.auditEvents[0]?.fromStatus).toBe("draft");
      expect(result.auditEvents[0]?.toStatus).toBe("active");
    }
  });

  it("refuses transition for unknown project with PROJECT_NOT_FOUND", async () => {
    const repo = createInMemoryProjectRepository();
    const directory = createProjectDirectory(repo);
    const result = await directory.transitionProject(
      TENANT,
      { kind: "project", value: "missing" },
      { type: "activate" },
      { occurredAt: "2026-01-01T00:00:00Z" },
    );
    expect(result).toEqual({ ok: false, reasonCode: "PROJECT_NOT_FOUND" });
  });

  it("refuses transition with TENANT_SCOPE_MISSING on broken scope", async () => {
    const repo = createInMemoryProjectRepository([baseProject()]);
    const directory = createProjectDirectory(repo);
    const result = await directory.transitionProject(
      { tenantId: "" } as unknown as TenantScope,
      { kind: "project", value: "p-1" },
      { type: "activate" },
      { occurredAt: "2026-01-01T00:00:00Z" },
    );
    expect(result).toEqual({ ok: false, reasonCode: "TENANT_SCOPE_MISSING" });
  });

  it("get returns null for cross-tenant call (fail-closed)", async () => {
    const other: TenantScope = { tenantId: "other" };
    const repo = createInMemoryProjectRepository([baseProject()]);
    const directory = createProjectDirectory(repo);
    const item = await directory.getProject(other, { kind: "project", value: "p-1" });
    expect(item).toBeNull();
  });

  it("verifyMilestoneGate achieves the milestone when all work items are terminal", async () => {
    const repo = createInMemoryProjectRepository(
      [baseProject()],
      [baseMilestone()],
    );
    const directory = createProjectDirectory(repo);
    const result = await directory.verifyMilestoneGate(
      TENANT,
      { kind: "milestone", value: "m-1" },
      [
        { id: "w-1", status: "done" },
        { id: "w-2", status: "done" },
      ],
      { occurredAt: "2026-01-01T00:00:00Z" },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.milestone?.status).toBe("achieved");
      expect(result.auditEvents[0]?.kind).toBe("milestone.achieved");
    }
  });

  it("verifyMilestoneGate refuses with blocking items when work items are not terminal", async () => {
    const repo = createInMemoryProjectRepository(
      [baseProject()],
      [baseMilestone()],
    );
    const directory = createProjectDirectory(repo);
    const result = await directory.verifyMilestoneGate(
      TENANT,
      { kind: "milestone", value: "m-1" },
      [
        { id: "w-1", status: "in_progress" },
        { id: "w-2", status: "done" },
      ],
      { occurredAt: "2026-01-01T00:00:00Z" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("WORK_ITEMS_NOT_TERMINAL");
      expect(result.blockingItems?.length).toBe(1);
      expect(result.blockingItems?.[0]?.workItemId).toBe("w-1");
    }
  });

  it("completeProject refuses when milestones are not achieved", async () => {
    const repo = createInMemoryProjectRepository(
      [baseProject({ status: "active" })],
      [baseMilestone()],
    );
    const directory = createProjectDirectory(repo);
    const result = await directory.completeProject(
      TENANT,
      { kind: "project", value: "p-1" },
      [
        { id: "w-1", status: "todo" },
        { id: "w-2", status: "done" },
      ],
      { occurredAt: "2026-01-01T00:00:00Z" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("MILESTONES_NOT_ACHIEVED");
      expect(result.blockingItems?.length).toBe(1);
    }
  });

  it("completeProject succeeds when all milestones are achieved", async () => {
    const repo = createInMemoryProjectRepository(
      [baseProject({ status: "active" })],
      [baseMilestone({ status: "achieved" })],
    );
    const directory = createProjectDirectory(repo);
    const result = await directory.completeProject(
      TENANT,
      { kind: "project", value: "p-1" },
      [],
      { occurredAt: "2026-01-01T00:00:00Z" },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.project?.status).toBe("completed");
    }
  });

  it("completeProject succeeds when milestones are open but their work items are terminal", async () => {
    const repo = createInMemoryProjectRepository(
      [baseProject({ status: "active" })],
      [baseMilestone()],
    );
    const directory = createProjectDirectory(repo);
    const result = await directory.completeProject(
      TENANT,
      { kind: "project", value: "p-1" },
      [
        { id: "w-1", status: "done" },
        { id: "w-2", status: "done" },
      ],
      { occurredAt: "2026-01-01T00:00:00Z" },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.project?.status).toBe("completed");
    }
  });

  it("readPortfolio returns a tenant-scoped read model", async () => {
    const repo = createInMemoryProjectRepository(
      [
        baseProject({ id: { kind: "project", value: "p-1" }, status: "active" }),
        baseProject({ id: { kind: "project", value: "p-2" }, status: "completed" }),
      ],
      [
        baseMilestone({ id: { kind: "milestone", value: "m-1" }, projectId: "p-1", status: "open" }),
        baseMilestone({ id: { kind: "milestone", value: "m-2" }, projectId: "p-2", status: "achieved" }),
      ],
    );
    const directory = createProjectDirectory(repo);
    const portfolio = await directory.readPortfolio(TENANT);
    expect(portfolio.totalProjects).toBe(2);
    expect(portfolio.activeProjects).toBe(1);
    expect(portfolio.completedProjects).toBe(1);
    expect(portfolio.totalMilestones).toBe(2);
    expect(portfolio.achievedMilestones).toBe(1);
    expect(portfolio.entries.length).toBe(2);
    expect(portfolio.entries[0]?.projectId).toBe("p-1");
    expect(portfolio.entries[0]?.milestoneCount).toBe(1);
    expect(portfolio.entries[0]?.achievedMilestoneCount).toBe(0);
  });

  it("readPortfolio returns an empty model for cross-tenant (fail-closed)", async () => {
    const repo = createInMemoryProjectRepository([baseProject()]);
    const directory = createProjectDirectory(repo);
    const portfolio = await directory.readPortfolio({ tenantId: "other" });
    expect(portfolio.totalProjects).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Determinism.
// ---------------------------------------------------------------------------

describe("determinism", () => {
  it("transitionProject is deterministic across calls", () => {
    const a = transitionProject(baseProject(), { type: "activate" });
    const b = transitionProject(baseProject(), { type: "activate" });
    expect(a).toEqual(b);
  });

  it("checkMilestoneGate is deterministic across calls", () => {
    const m = baseMilestone();
    const items: WorkItemStatusRefLike[] = [{ id: "w-1", status: "done" }, { id: "w-2", status: "done" }];
    expect(checkMilestoneGate(m, items)).toEqual(checkMilestoneGate(m, items));
  });
});
