/**
 * @fleetos/maintenance — Wave 2 scheduling conflict tests (F220A).
 *
 * Covers:
 *   - Maintenance scheduling windows with conflict detection.
 *   - Two windows that overlap on the same asset are flagged as a conflict.
 *   - Cross-tenant windows are NEVER conflicting (isolation preserved).
 *   - Different assets in the same tenant are NOT conflicting.
 */

import { describe, it, expect } from "vitest";
import {
  buildScheduleSlot,
  checkMaintenanceOrderConflict,
  detectSchedulingConflict,
  scheduleWindow,
  windowIntersection,
  windowOverlapsAt,
  type ScheduledMaintenanceOrder,
  type ScheduledWindow,
} from "./kernel-scheduling.js";
import { declareMaintenanceWindow, type MaintenanceWindow } from "./kernel.js";
import type { MaintenanceOrderId } from "./maintenance.js";

const NOW = 1_727_000_000_000;
const TENANT_A = "tnt_acme";
const TENANT_B = "tnt_other";
const ASSET1 = "ast_asset-001";
const ASSET2 = "ast_asset-002";

function window1(): ScheduledWindow {
  const r = declareMaintenanceWindow({
    tenantId: TENANT_A,
    kind: "one-time",
    startsAt: NOW,
    endsAt: NOW + 3600_000,
    reason: "scheduled maintenance",
    actor: "act_admin",
  });
  if (!r.ok) throw new Error();
  return { id: "sw_001", tenantId: TENANT_A, assetId: ASSET1, window: r.window };
}

function window2(startsAt: number, endsAt: number): MaintenanceWindow {
  const r = declareMaintenanceWindow({
    tenantId: TENANT_A,
    kind: "one-time",
    startsAt,
    endsAt,
    reason: "second maintenance",
    actor: "act_admin",
  });
  if (!r.ok) throw new Error();
  return r.window;
}

// ---------------------------------------------------------------------------
// detectSchedulingConflict
// ---------------------------------------------------------------------------

describe("maintenance scheduling: detectSchedulingConflict", () => {
  it("returns null when the proposed window does not overlap (later)", () => {
    const existing = window1();
    const proposed: ScheduledWindow = {
      id: "sw_002",
      tenantId: TENANT_A,
      assetId: ASSET1,
      window: window2(NOW + 7200_000, NOW + 10800_000),
    };
    expect(detectSchedulingConflict(existing, proposed)).toBeNull();
  });

  it("returns null when the proposed window does not overlap (earlier)", () => {
    const existing = window1();
    const proposed: ScheduledWindow = {
      id: "sw_003",
      tenantId: TENANT_A,
      assetId: ASSET1,
      window: window2(NOW - 7200_000, NOW - 3600_000),
    };
    expect(detectSchedulingConflict(existing, proposed)).toBeNull();
  });

  it("returns a conflict when the proposed window overlaps on the same asset", () => {
    const existing = window1();
    const proposed: ScheduledWindow = {
      id: "sw_004",
      tenantId: TENANT_A,
      assetId: ASSET1,
      window: window2(NOW + 1800_000, NOW + 5400_000), // overlaps [NOW, NOW+3600_000]
    };
    const c = detectSchedulingConflict(existing, proposed);
    expect(c).not.toBeNull();
    expect(c!.reason).toBe("time-overlap");
    expect(c!.overlapStart).toBe(NOW + 1800_000);
    expect(c!.overlapEnd).toBe(NOW + 3600_000);
  });

  it("returns a conflict when the proposed window fully contains the existing", () => {
    const existing = window1();
    const proposed: ScheduledWindow = {
      id: "sw_005",
      tenantId: TENANT_A,
      assetId: ASSET1,
      window: window2(NOW - 1000_000, NOW + 5000_000), // contains [NOW, NOW+3600_000]
    };
    const c = detectSchedulingConflict(existing, proposed);
    expect(c).not.toBeNull();
    expect(c!.overlapStart).toBe(NOW);
    expect(c!.overlapEnd).toBe(NOW + 3600_000);
  });

  it("returns null when the proposed window is on a different asset (same tenant)", () => {
    const existing = window1();
    const proposed: ScheduledWindow = {
      id: "sw_006",
      tenantId: TENANT_A,
      assetId: ASSET2,
      window: window2(NOW, NOW + 3600_000), // same time, different asset
    };
    expect(detectSchedulingConflict(existing, proposed)).toBeNull();
  });

  it("returns null when the proposed window is on the same asset but a different tenant", () => {
    const existing = window1();
    const proposed: ScheduledWindow = {
      id: "sw_007",
      tenantId: TENANT_B,
      assetId: ASSET1,
      window: window2(NOW, NOW + 3600_000), // same time, same asset, different tenant
    };
    expect(detectSchedulingConflict(existing, proposed)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// scheduleWindow — refuses to schedule a conflicting window.
// ---------------------------------------------------------------------------

describe("maintenance scheduling: scheduleWindow", () => {
  it("schedules a window when no conflicts exist", () => {
    const existing: ScheduledWindow[] = [];
    const r = scheduleWindow(existing, window1());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.window.id).toBe("sw_001");
  });

  it("refuses to schedule a window that conflicts with an existing one", () => {
    const existing: ScheduledWindow[] = [window1()];
    const proposed: ScheduledWindow = {
      id: "sw_008",
      tenantId: TENANT_A,
      assetId: ASSET1,
      window: window2(NOW + 1000_000, NOW + 2000_000), // overlaps
    };
    const r = scheduleWindow(existing, proposed);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("time-overlap");
    expect(r.conflict.existingId).toBe("sw_001");
    expect(r.conflict.proposedId).toBe("sw_008");
  });

  it("schedules a window on a different asset (no conflict)", () => {
    const existing: ScheduledWindow[] = [window1()];
    const proposed: ScheduledWindow = {
      id: "sw_009",
      tenantId: TENANT_A,
      assetId: ASSET2,
      window: window2(NOW, NOW + 3600_000),
    };
    const r = scheduleWindow(existing, proposed);
    expect(r.ok).toBe(true);
  });

  it("schedules a window on the same asset in a different tenant (no conflict)", () => {
    const existing: ScheduledWindow[] = [window1()];
    const proposed: ScheduledWindow = {
      id: "sw_010",
      tenantId: TENANT_B,
      assetId: ASSET1,
      window: window2(NOW, NOW + 3600_000),
    };
    const r = scheduleWindow(existing, proposed);
    expect(r.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// checkMaintenanceOrderConflict — same logic, different input shape.
// ---------------------------------------------------------------------------

describe("maintenance scheduling: checkMaintenanceOrderConflict", () => {
  it("returns ok=true when no conflict exists", () => {
    const existing: ScheduledMaintenanceOrder[] = [];
    const proposed: ScheduledMaintenanceOrder = {
      orderId: "mo_001" as MaintenanceOrderId,
      tenantId: TENANT_A,
      assetId: ASSET1,
      window: window2(NOW, NOW + 3600_000),
    };
    const r = checkMaintenanceOrderConflict(existing, proposed);
    expect(r.ok).toBe(true);
  });

  it("returns ok=false with the conflict details when a conflict exists", () => {
    const existing: ScheduledMaintenanceOrder[] = [
      {
        orderId: "mo_001" as MaintenanceOrderId,
        tenantId: TENANT_A,
        assetId: ASSET1,
        window: window2(NOW, NOW + 3600_000),
      },
    ];
    const proposed: ScheduledMaintenanceOrder = {
      orderId: "mo_002" as MaintenanceOrderId,
      tenantId: TENANT_A,
      assetId: ASSET1,
      window: window2(NOW + 1000, NOW + 2000_000),
    };
    const r = checkMaintenanceOrderConflict(existing, proposed);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.conflict.existingId).toBe("mo_001");
    expect(r.conflict.proposedId).toBe("mo_002");
  });
});

// ---------------------------------------------------------------------------
// windowIntersection + windowOverlapsAt — pure helpers.
// ---------------------------------------------------------------------------

describe("maintenance scheduling: windowIntersection + windowOverlapsAt", () => {
  it("windowIntersection returns the overlap region when windows overlap", () => {
    const a = window2(NOW, NOW + 100);
    const b = window2(NOW + 50, NOW + 200);
    const i = windowIntersection(a, b);
    expect(i).toEqual({ start: NOW + 50, end: NOW + 100 });
  });

  it("windowIntersection returns null when windows do not overlap", () => {
    const a = window2(NOW, NOW + 100);
    const b = window2(NOW + 200, NOW + 300);
    expect(windowIntersection(a, b)).toBeNull();
  });

  it("windowOverlapsAt returns true when both windows contain the time", () => {
    const a = window2(NOW, NOW + 100);
    const b = window2(NOW + 50, NOW + 200);
    expect(windowOverlapsAt(a, b, NOW + 75)).toBe(true);
  });

  it("windowOverlapsAt returns false when only one window contains the time", () => {
    const a = window2(NOW, NOW + 100);
    const b = window2(NOW + 200, NOW + 300);
    expect(windowOverlapsAt(a, b, NOW + 50)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildScheduleSlot — typed slot per (tenant, asset).
// ---------------------------------------------------------------------------

describe("maintenance scheduling: buildScheduleSlot", () => {
  it("builds a slot with windows for the tenant+asset pair", () => {
    const w = window2(NOW, NOW + 100);
    const slot = buildScheduleSlot(TENANT_A, ASSET1, [w], NOW + 50);
    expect(slot.tenantId).toBe(TENANT_A);
    expect(slot.assetId).toBe(ASSET1);
    expect(slot.windows).toHaveLength(1);
    expect(slot.blocked).toBe(true); // NOW+50 is within [NOW, NOW+100]
  });

  it("blocked=false when no window is currently active", () => {
    const w = window2(NOW, NOW + 100);
    const slot = buildScheduleSlot(TENANT_A, ASSET1, [w], NOW + 200); // 200 > 100, outside window
    expect(slot.blocked).toBe(false);
  });

  it("blocked=true when ANY window is currently active (multiple windows)", () => {
    const w1 = window2(NOW - 1000, NOW - 500);
    const w2 = window2(NOW + 1000, NOW + 2000);
    const slot1 = buildScheduleSlot(TENANT_A, ASSET1, [w1, w2], NOW); // outside both
    expect(slot1.blocked).toBe(false);
    const slot2 = buildScheduleSlot(TENANT_A, ASSET1, [w1, w2], NOW + 1500); // inside w2
    expect(slot2.blocked).toBe(true);
  });
});
