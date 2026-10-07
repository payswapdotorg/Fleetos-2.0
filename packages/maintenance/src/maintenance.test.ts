import { describe, it, expect } from "vitest";
import {
  applyMaintenanceCommand,
  createMaintenanceOrder,
  evaluateMaintenanceTransition,
  isMaintenanceOrderId,
  isServicePlanId,
  nextRun,
  type MaintenanceCommand,
  type MaintenanceOrderId,
  type ServicePlanId,
  type Schedule,
} from "./maintenance.js";

const NOW = 1_727_000_000_000;
const MO1 = "mo_order-0001" as MaintenanceOrderId;
const PLAN1 = "plan_truck-001" as ServicePlanId;

function cmd(
  kind: MaintenanceCommand["kind"],
  overrides: Partial<MaintenanceCommand> = {},
): MaintenanceCommand {
  return { kind, initiatedAt: NOW, ...overrides };
}

describe("maintenance: branded id guards", () => {
  it("accepts well-formed ServicePlanId", () => {
    expect(isServicePlanId("plan_truck-001")).toBe(true);
  });
  it("rejects ServicePlanId without prefix", () => {
    expect(isServicePlanId("truck-001")).toBe(false);
  });
  it("accepts well-formed MaintenanceOrderId", () => {
    expect(isMaintenanceOrderId("mo_order-0001")).toBe(true);
  });
  it("rejects MaintenanceOrderId without prefix", () => {
    expect(isMaintenanceOrderId("order-0001")).toBe(false);
  });
});

describe("maintenance: schedule nextRun (pure)", () => {
  it("one-time schedule returns the run time when in future", () => {
    const s: Schedule = { kind: "one-time", at: NOW + 3600_000 };
    expect(nextRun(s, NOW)).toBe(NOW + 3600_000);
  });
  it("one-time schedule returns null when in past", () => {
    const s: Schedule = { kind: "one-time", at: NOW - 1 };
    expect(nextRun(s, NOW)).toBe(null);
  });
  it("recurring schedule returns startsAt when from < startsAt", () => {
    const s: Schedule = {
      kind: "recurring",
      intervalMs: 86_400_000,
      startsAt: NOW + 1000,
    };
    expect(nextRun(s, NOW)).toBe(NOW + 1000);
  });
  it("recurring schedule returns next aligned tick", () => {
    const s: Schedule = {
      kind: "recurring",
      intervalMs: 1000,
      startsAt: NOW,
    };
    expect(nextRun(s, NOW + 2500)).toBe(NOW + 3000);
  });
  it("recurring schedule respects endsAt boundary", () => {
    const s: Schedule = {
      kind: "recurring",
      intervalMs: 1000,
      startsAt: NOW,
      endsAt: NOW + 5000,
    };
    expect(nextRun(s, NOW + 4500)).toBe(NOW + 5000);
    expect(nextRun(s, NOW + 5000)).toBe(null);
  });
});

describe("maintenance: order state machine — legal transitions", () => {
  it("scheduled -> in-progress via 'start'", () => {
    expect(evaluateMaintenanceTransition("scheduled", cmd("start"))).toEqual({
      ok: true,
      from: "scheduled",
      to: "in-progress",
    });
  });
  it("in-progress -> completed via 'complete'", () => {
    expect(evaluateMaintenanceTransition("in-progress", cmd("complete"))).toEqual({
      ok: true,
      from: "in-progress",
      to: "completed",
    });
  });
  it("scheduled -> cancelled via 'cancel'", () => {
    expect(evaluateMaintenanceTransition("scheduled", cmd("cancel", { reason: "duplicate" }))).toEqual({
      ok: true,
      from: "scheduled",
      to: "cancelled",
    });
  });
  it("in-progress -> cancelled via 'cancel'", () => {
    expect(evaluateMaintenanceTransition("in-progress", cmd("cancel", { reason: "no-parts" }))).toEqual({
      ok: true,
      from: "in-progress",
      to: "cancelled",
    });
  });
});

describe("maintenance: order state machine — illegal transitions refused", () => {
  it("scheduled -> complete is illegal (must start first)", () => {
    expect(evaluateMaintenanceTransition("scheduled", cmd("complete"))).toEqual({
      ok: false,
      reason: "illegal-transition",
    });
  });
  it("completed -> start is illegal", () => {
    expect(evaluateMaintenanceTransition("completed", cmd("start"))).toEqual({
      ok: false,
      reason: "illegal-transition",
    });
  });
  it("completed -> complete -> already-in-target-state", () => {
    expect(evaluateMaintenanceTransition("completed", cmd("complete"))).toEqual({
      ok: false,
      reason: "already-in-target-state",
    });
  });
  it("cancelled -> cancel -> already-in-target-state", () => {
    expect(evaluateMaintenanceTransition("cancelled", cmd("cancel"))).toEqual({
      ok: false,
      reason: "already-in-target-state",
    });
  });
  it("unknown command kind -> unknown-command", () => {
    expect(
      evaluateMaintenanceTransition("scheduled", { kind: "nope" as never, initiatedAt: NOW }),
    ).toEqual({ ok: false, reason: "unknown-command" });
  });
});

describe("maintenance: MaintenanceOrder aggregate", () => {
  it("createMaintenanceOrder produces scheduled order", () => {
    const o = createMaintenanceOrder({
      id: MO1,
      tenantId: "tnt_acme",
      planId: PLAN1,
      createdAt: NOW,
    });
    expect(o.state).toBe("scheduled");
  });
  it("createMaintenanceOrder rejects malformed ids", () => {
    expect(() =>
      createMaintenanceOrder({
        id: "bad" as MaintenanceOrderId,
        tenantId: "tnt_acme",
        planId: PLAN1,
        createdAt: NOW,
      }),
    ).toThrow();
  });
  it("applyMaintenanceCommand produces new order (immutable)", () => {
    const o0 = createMaintenanceOrder({
      id: MO1,
      tenantId: "tnt_acme",
      planId: PLAN1,
      createdAt: NOW,
    });
    const r = applyMaintenanceCommand(o0, cmd("start"));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.order.state).toBe("in-progress");
      expect(o0.state).toBe("scheduled"); // immutable: original untouched
    }
  });
  it("applyMaintenanceCommand 'cancel' stores the reason", () => {
    const o0 = createMaintenanceOrder({
      id: MO1,
      tenantId: "tnt_acme",
      planId: PLAN1,
      createdAt: NOW,
    });
    const r = applyMaintenanceCommand(o0, cmd("cancel", { reason: "operator-no-show" }));
    if (r.ok) expect(r.order.cancelledReason).toBe("operator-no-show");
  });
});
