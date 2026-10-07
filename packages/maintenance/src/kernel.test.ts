import { describe, it, expect } from "vitest";
import {
  applyMaintenanceCommandAudited,
  declareMaintenanceWindow,
  InMemoryMaintenanceOrderRegistry,
  MaintenanceOrderDirectory,
  windowContainsAt,
  windowNextRun,
} from "./kernel.js";
import { createMaintenanceOrder, type MaintenanceCommand } from "./maintenance.js";

const NOW = 1_727_000_000_000;
const TENANT_A = "tnt_acme";
const TENANT_B = "tnt_other";
const PLAN_1 = "plan_pm-001";
const ORDER_1 = "mo_2024-0001";

function makeDir(): MaintenanceOrderDirectory {
  return new MaintenanceOrderDirectory(new InMemoryMaintenanceOrderRegistry());
}

function createOrder(dir: MaintenanceOrderDirectory) {
  return dir.createOrder({
    orderId: ORDER_1,
    tenantId: TENANT_A,
    planId: PLAN_1,
    createdAt: NOW,
    actor: "act_a-001",
  });
}

describe("maintenance kernel: AuditEventRef shape", () => {
  it("createOrder emits audit with all five fields", () => {
    const dir = makeDir();
    const r = createOrder(dir);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.audit.intent).toBe("maintenance:create");
      expect(r.audit.tenant).toBe(TENANT_A);
      expect(r.audit.timestamp).toBe(NOW);
      expect(r.audit.digest.length).toBe(64);
    }
  });

  it("transition emits audit with maintenance:<command> intent", () => {
    const dir = makeDir();
    createOrder(dir);
    const r = dir.transition({
      tenantId: TENANT_A,
      orderId: ORDER_1 as never,
      command: { kind: "start", initiatedAt: NOW + 1000 },
      actor: "act_a-001",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.audit.intent).toBe("maintenance:start");
  });
});

describe("maintenance kernel: createOrder validation", () => {
  it("refuses malformed order id", () => {
    const dir = makeDir();
    const r = dir.createOrder({ orderId: "bad", tenantId: TENANT_A, planId: PLAN_1, createdAt: NOW, actor: "a" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("malformed-order-id");
  });

  it("refuses malformed plan id", () => {
    const dir = makeDir();
    const r = dir.createOrder({ orderId: ORDER_1, tenantId: TENANT_A, planId: "bad", createdAt: NOW, actor: "a" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("malformed-plan-id");
  });

  it("refuses missing tenant id", () => {
    const dir = makeDir();
    const r = dir.createOrder({ orderId: ORDER_1, tenantId: "", planId: PLAN_1, createdAt: NOW, actor: "a" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing-tenant-id");
  });

  it("refuses duplicate order (same id, same tenant)", () => {
    const dir = makeDir();
    createOrder(dir);
    const r = dir.createOrder({ orderId: ORDER_1, tenantId: TENANT_A, planId: PLAN_1, createdAt: NOW + 1, actor: "a" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("duplicate-order");
  });

  it("allows same order id in different tenants (no collision)", () => {
    const dir = makeDir();
    createOrder(dir);
    const r = dir.createOrder({ orderId: ORDER_1, tenantId: TENANT_B, planId: PLAN_1, createdAt: NOW, actor: "a" });
    expect(r.ok).toBe(true);
  });
});

describe("maintenance kernel: transition (legal/illegal)", () => {
  it("scheduled -> in-progress -> completed", () => {
    const dir = makeDir();
    createOrder(dir);
    const s = dir.transition({ tenantId: TENANT_A, orderId: ORDER_1 as never, command: { kind: "start", initiatedAt: NOW + 1000 }, actor: "a" });
    expect(s.ok).toBe(true);
    if (s.ok) expect(s.order.state).toBe("in-progress");

    const c = dir.transition({ tenantId: TENANT_A, orderId: ORDER_1 as never, command: { kind: "complete", initiatedAt: NOW + 2000 }, actor: "a" });
    expect(c.ok).toBe(true);
    if (c.ok) expect(c.order.state).toBe("completed");
  });

  it("scheduled -> cancelled", () => {
    const dir = makeDir();
    createOrder(dir);
    const r = dir.transition({ tenantId: TENANT_A, orderId: ORDER_1 as never, command: { kind: "cancel", reason: "no-budget", initiatedAt: NOW + 1000 }, actor: "a" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.order.state).toBe("cancelled");
      expect(r.order.cancelledReason).toBe("no-budget");
    }
  });

  it("in-progress -> cancelled", () => {
    const dir = makeDir();
    createOrder(dir);
    dir.transition({ tenantId: TENANT_A, orderId: ORDER_1 as never, command: { kind: "start", initiatedAt: NOW + 1000 }, actor: "a" });
    const r = dir.transition({ tenantId: TENANT_A, orderId: ORDER_1 as never, command: { kind: "cancel", reason: "aborted", initiatedAt: NOW + 2000 }, actor: "a" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.order.state).toBe("cancelled");
  });

  it("completed -> start -> illegal-transition", () => {
    const dir = makeDir();
    createOrder(dir);
    dir.transition({ tenantId: TENANT_A, orderId: ORDER_1 as never, command: { kind: "start", initiatedAt: NOW + 1000 }, actor: "a" });
    dir.transition({ tenantId: TENANT_A, orderId: ORDER_1 as never, command: { kind: "complete", initiatedAt: NOW + 2000 }, actor: "a" });
    const r = dir.transition({ tenantId: TENANT_A, orderId: ORDER_1 as never, command: { kind: "start", initiatedAt: NOW + 3000 }, actor: "a" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("illegal-transition");
  });

  it("cancelled -> complete -> illegal-transition", () => {
    const dir = makeDir();
    createOrder(dir);
    dir.transition({ tenantId: TENANT_A, orderId: ORDER_1 as never, command: { kind: "cancel", reason: "x", initiatedAt: NOW + 1000 }, actor: "a" });
    const r = dir.transition({ tenantId: TENANT_A, orderId: ORDER_1 as never, command: { kind: "complete", initiatedAt: NOW + 2000 }, actor: "a" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("illegal-transition");
  });

  it("complete from completed -> already-in-target-state", () => {
    const dir = makeDir();
    createOrder(dir);
    dir.transition({ tenantId: TENANT_A, orderId: ORDER_1 as never, command: { kind: "start", initiatedAt: NOW + 1000 }, actor: "a" });
    dir.transition({ tenantId: TENANT_A, orderId: ORDER_1 as never, command: { kind: "complete", initiatedAt: NOW + 2000 }, actor: "a" });
    const r = dir.transition({ tenantId: TENANT_A, orderId: ORDER_1 as never, command: { kind: "complete", initiatedAt: NOW + 3000 }, actor: "a" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("already-in-target-state");
  });

  it("transition on unknown order -> unknown-order", () => {
    const dir = makeDir();
    const r = dir.transition({ tenantId: TENANT_A, orderId: "mo_unknown-999" as never, command: { kind: "start", initiatedAt: NOW }, actor: "a" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unknown-order");
  });
});

describe("maintenance kernel: tenant fail-closed", () => {
  it("lookup returns null for cross-tenant reads", () => {
    const dir = makeDir();
    createOrder(dir);
    expect(dir.lookup(TENANT_B, ORDER_1 as never)).toBeNull();
  });

  it("listByTenant returns only the requested tenant's orders", () => {
    const dir = makeDir();
    createOrder(dir);
    dir.createOrder({ orderId: "mo_2024-0002", tenantId: TENANT_B, planId: PLAN_1, createdAt: NOW, actor: "a" });
    expect(dir.listByTenant(TENANT_A)).toHaveLength(1);
    expect(dir.listByTenant(TENANT_B)).toHaveLength(1);
  });

  it("listByPlan filters by tenant and plan", () => {
    const dir = makeDir();
    createOrder(dir);
    dir.createOrder({ orderId: "mo_2024-0002", tenantId: TENANT_A, planId: "plan_pm-002", createdAt: NOW, actor: "a" });
    expect(dir.listByPlan(TENANT_A, "plan_pm-001" as never)).toHaveLength(1);
    expect(dir.listByPlan(TENANT_A, "plan_pm-002" as never)).toHaveLength(1);
    expect(dir.listByPlan(TENANT_B, "plan_pm-001" as never)).toHaveLength(0);
  });
});

describe("maintenance kernel: declareMaintenanceWindow scheduling", () => {
  it("declares a one-time window and emits audit", () => {
    const r = declareMaintenanceWindow({
      tenantId: TENANT_A,
      kind: "one-time",
      startsAt: NOW,
      endsAt: NOW + 3600_000,
      reason: "pm",
      actor: "a",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.window.kind).toBe("one-time");
      expect(r.audit.intent).toBe("maintenance:window:declare");
    }
  });

  it("declares a recurring window with interval + duration", () => {
    const r = declareMaintenanceWindow({
      tenantId: TENANT_A,
      kind: "recurring",
      startsAt: NOW,
      endsAt: NOW + 24 * 3600_000,
      intervalMs: 3600_000,
      durationMs: 600_000,
      reason: "patch-tuesday",
      actor: "a",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.window.kind).toBe("recurring");
  });

  it("refuses empty reason (missing-reason)", () => {
    const r = declareMaintenanceWindow({ tenantId: TENANT_A, kind: "one-time", startsAt: NOW, endsAt: NOW + 1, reason: "", actor: "a" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing-reason");
  });

  it("refuses ends-before-start", () => {
    const r = declareMaintenanceWindow({ tenantId: TENANT_A, kind: "one-time", startsAt: NOW + 1000, endsAt: NOW, reason: "x", actor: "a" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("ends-before-start");
  });

  it("refuses invalid-interval (<=0) for recurring", () => {
    const r = declareMaintenanceWindow({ tenantId: TENANT_A, kind: "recurring", startsAt: NOW, endsAt: NOW + 1000, intervalMs: 0, durationMs: 100, reason: "x", actor: "a" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid-interval");
  });

  it("refuses invalid-duration (duration > interval)", () => {
    const r = declareMaintenanceWindow({ tenantId: TENANT_A, kind: "recurring", startsAt: NOW, endsAt: NOW + 10000, intervalMs: 1000, durationMs: 2000, reason: "x", actor: "a" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid-duration");
  });
});

describe("maintenance kernel: windowNextRun + windowContainsAt", () => {
  it("one-time window: returns startsAt when from <= startsAt", () => {
    const r = declareMaintenanceWindow({ tenantId: TENANT_A, kind: "one-time", startsAt: NOW, endsAt: NOW + 1000, reason: "x", actor: "a" });
    if (!r.ok) throw new Error("window failed");
    expect(windowNextRun(r.window, NOW - 1000)).toBe(NOW);
    expect(windowNextRun(r.window, NOW)).toBe(NOW);
    expect(windowNextRun(r.window, NOW + 500)).toBeNull();
  });

  it("recurring window: returns the next interval boundary", () => {
    const r = declareMaintenanceWindow({
      tenantId: TENANT_A,
      kind: "recurring",
      startsAt: NOW,
      endsAt: NOW + 10_000,
      intervalMs: 1000,
      durationMs: 100,
      reason: "x",
      actor: "a",
    });
    if (!r.ok) throw new Error("window failed");
    expect(windowNextRun(r.window, NOW)).toBe(NOW + 1000);
    expect(windowNextRun(r.window, NOW + 1500)).toBe(NOW + 2000);
    expect(windowNextRun(r.window, NOW + 9500)).toBeNull();
  });

  it("windowContainsAt returns true within, false outside", () => {
    const r = declareMaintenanceWindow({ tenantId: TENANT_A, kind: "one-time", startsAt: NOW, endsAt: NOW + 1000, reason: "x", actor: "a" });
    if (!r.ok) throw new Error("window failed");
    expect(windowContainsAt(r.window, NOW)).toBe(true);
    expect(windowContainsAt(r.window, NOW + 500)).toBe(true);
    expect(windowContainsAt(r.window, NOW - 1)).toBe(false);
    expect(windowContainsAt(r.window, NOW + 1001)).toBe(false);
  });
});

describe("maintenance kernel: applyMaintenanceCommandAudited (audit reference emission)", () => {
  it("emits audit on every successful transition", () => {
    const order = createMaintenanceOrder({
      id: "mo_audit-0001" as never,
      tenantId: TENANT_A,
      planId: "plan_pm-001" as never,
      createdAt: NOW,
    });
    const start = applyMaintenanceCommandAudited(order, { kind: "start", initiatedAt: NOW + 1000 }, { tenantId: TENANT_A, actor: "act_a" });
    if (!start.ok) throw new Error("start failed");
    expect(start.audit.intent).toBe("maintenance:start");

    const complete = applyMaintenanceCommandAudited(start.order, { kind: "complete", initiatedAt: NOW + 2000 }, { tenantId: TENANT_A, actor: "act_a" });
    if (!complete.ok) throw new Error("complete failed");
    expect(complete.audit.intent).toBe("maintenance:complete");
  });

  it("audit digest is deterministic for identical inputs", () => {
    const order1 = createMaintenanceOrder({ id: "mo_audit-0002" as never, tenantId: TENANT_A, planId: "plan_pm-001" as never, createdAt: NOW });
    const order2 = createMaintenanceOrder({ id: "mo_audit-0002" as never, tenantId: TENANT_A, planId: "plan_pm-001" as never, createdAt: NOW });
    const cmd: MaintenanceCommand = { kind: "start", initiatedAt: NOW + 1000 };
    const r1 = applyMaintenanceCommandAudited(order1, cmd, { tenantId: TENANT_A, actor: "act_a" });
    const r2 = applyMaintenanceCommandAudited(order2, cmd, { tenantId: TENANT_A, actor: "act_a" });
    if (!r1.ok || !r2.ok) throw new Error("expected ok");
    expect(r1.audit.digest).toBe(r2.audit.digest);
  });
});
