import { describe, expect, it } from "vitest";
import {
  assignTo,
  advanceWorkItem,
  validateTenantScope,
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
    deadline: null,
    status: "todo",
    blockedReason: null,
    ...overrides,
  };
}

describe("validateTenantScope", () => {
  it("accepts a non-empty well-formed tenant id", () => {
    const result = validateTenantScope({ tenantId: "acme" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.scope.tenantId).toBe("acme");
  });

  it("refuses null scope with TENANT_SCOPE_MISSING", () => {
    const result = validateTenantScope(null);
    expect(result).toEqual({ ok: false, reasonCode: "TENANT_SCOPE_MISSING" });
  });

  it("refuses empty tenant id with TENANT_ID_EMPTY", () => {
    const result = validateTenantScope({ tenantId: "" });
    expect(result).toEqual({ ok: false, reasonCode: "TENANT_ID_EMPTY" });
  });

  it("refuses invalid characters with TENANT_ID_INVALID_CHARS", () => {
    const result = validateTenantScope({ tenantId: "ac me!" });
    expect(result).toEqual({ ok: false, reasonCode: "TENANT_ID_INVALID_CHARS" });
  });
});

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
    const item = baseWorkItem({ status: "in_progress" });
    const first = advanceWorkItem(item, { type: "complete" });
    const second = advanceWorkItem(item, { type: "complete" });
    expect(first).toEqual(second);
  });
});

describe("assignTo — one assignee per assignment record", () => {
  it("assigns a first assignee successfully", () => {
    const result = assignTo(baseWorkItem(), "u-1", "2026-01-01T00:00:00Z");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.assignment.assigneeId).toBe("u-1");
  });

  it("refuses to replace an existing different assignee with ALREADY_ASSIGNED", () => {
    const item = baseWorkItem({
      assignee: { assigneeId: "u-1", assignedAt: "2026-01-01T00:00:00Z" },
    });
    const result = assignTo(item, "u-2", "2026-01-02T00:00:00Z");
    expect(result).toEqual({ ok: false, reasonCode: "ALREADY_ASSIGNED" });
  });

  it("refuses an empty assignee id with ASSIGNEE_ID_EMPTY", () => {
    const result = assignTo(baseWorkItem(), "  ", "2026-01-01T00:00:00Z");
    expect(result).toEqual({ ok: false, reasonCode: "ASSIGNEE_ID_EMPTY" });
  });
});
