import { describe, expect, it } from "vitest";
import {
  transitionProject,
  checkMilestoneGate,
  validateTenantScope,
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
    name: "Refit pump station 12",
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
    name: "Parts procured",
    status: "open",
    workItemIds: ["w-1", "w-2"],
    ...overrides,
  };
}

describe("validateTenantScope", () => {
  it("accepts a valid tenant id", () => {
    expect(validateTenantScope({ tenantId: "acme" })).toEqual({
      ok: true,
      scope: { tenantId: "acme" },
    });
  });

  it("refuses a null scope with TENANT_SCOPE_MISSING", () => {
    expect(validateTenantScope(null)).toEqual({
      ok: false,
      reasonCode: "TENANT_SCOPE_MISSING",
    });
  });
});

describe("transitionProject — legal transitions", () => {
  it("activates a draft project", () => {
    const r = transitionProject(baseProject(), { type: "activate" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.next.status).toBe("active");
  });

  it("holds an active project with a reason", () => {
    const r = transitionProject(baseProject({ status: "active" }), {
      type: "hold",
      reason: "waiting on vendor",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.next.status).toBe("on_hold");
  });

  it("resumes an on_hold project", () => {
    const r = transitionProject(baseProject({ status: "on_hold" }), { type: "resume" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.next.status).toBe("active");
  });

  it("completes an active project", () => {
    const r = transitionProject(baseProject({ status: "active" }), { type: "complete" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.next.status).toBe("completed");
  });
});

describe("transitionProject — illegal transitions refused", () => {
  it("refuses complete from draft with ILLEGAL_TRANSITION", () => {
    const r = transitionProject(baseProject(), { type: "complete" });
    expect(r).toEqual({ ok: false, reasonCode: "ILLEGAL_TRANSITION" });
  });

  it("refuses hold without a reason with HOLD_REASON_REQUIRED", () => {
    const r = transitionProject(baseProject({ status: "active" }), {
      type: "hold",
      reason: "",
    });
    expect(r).toEqual({ ok: false, reasonCode: "HOLD_REASON_REQUIRED" });
  });

  it("refuses cancel without a reason with CANCEL_REASON_REQUIRED", () => {
    const r = transitionProject(baseProject(), { type: "cancel", reason: "  " });
    expect(r).toEqual({ ok: false, reasonCode: "CANCEL_REASON_REQUIRED" });
  });

  it("refuses any transition from completed with ILLEGAL_TRANSITION", () => {
    const r = transitionProject(baseProject({ status: "completed" }), { type: "activate" });
    expect(r).toEqual({ ok: false, reasonCode: "ILLEGAL_TRANSITION" });
  });
});

describe("transitionProject — tenant fail-closed", () => {
  it("refuses transition with TENANT_SCOPE_MISSING when tenant is empty", () => {
    const broken = baseProject({ tenant: { tenantId: "" } as unknown as TenantScope });
    const r = transitionProject(broken, { type: "activate" });
    expect(r).toEqual({ ok: false, reasonCode: "TENANT_SCOPE_MISSING" });
  });
});

describe("transitionProject — determinism", () => {
  it("returns the same result for the same inputs", () => {
    const p = baseProject({ status: "active" });
    expect(transitionProject(p, { type: "complete" })).toEqual(
      transitionProject(p, { type: "complete" }),
    );
  });
});

describe("checkMilestoneGate", () => {
  it("achieves the milestone when all work items are terminal", () => {
    const workItems: WorkItemStatusRefLike[] = [
      { id: "w-1", status: "done" },
      { id: "w-2", status: "cancelled" },
    ];
    const r = checkMilestoneGate(baseMilestone(), workItems);
    expect(r).toEqual({ ok: true, status: "achieved" });
  });

  it("refuses an empty milestone with EMPTY_MILESTONE", () => {
    const r = checkMilestoneGate(baseMilestone({ workItemIds: [] }), []);
    expect(r).toEqual({ ok: false, reasonCode: "EMPTY_MILESTONE", blockingWorkItemIds: [] });
  });

  it("refuses when work items are not terminal and lists the blockers", () => {
    const workItems: WorkItemStatusRefLike[] = [
      { id: "w-1", status: "in_progress" },
      { id: "w-2", status: "done" },
    ];
    const r = checkMilestoneGate(baseMilestone(), workItems);
    expect(r).toEqual({
      ok: false,
      reasonCode: "WORK_ITEMS_NOT_TERMINAL",
      blockingWorkItemIds: ["w-1"],
    });
  });

  it("refuses with TENANT_SCOPE_MISSING when tenant is broken", () => {
    const broken = baseMilestone({ tenant: { tenantId: "" } as unknown as TenantScope });
    const r = checkMilestoneGate(broken, []);
    expect(r).toEqual({
      ok: false,
      reasonCode: "TENANT_SCOPE_MISSING",
      blockingWorkItemIds: [],
    });
  });
});
