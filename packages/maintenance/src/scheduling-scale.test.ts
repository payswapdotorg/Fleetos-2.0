/**
 * @fleetos/maintenance — Wave 8 fleet-scale schedule conflict tests (F280A).
 *
 * Covers:
 *   - Calendar build: slot index, deterministic ordering, shape validation
 *     fail-closed (invalid-window / ends-before-start / missing ids).
 *   - Conflict detection at scale (500 windows in one slot): exact overlap
 *     bounds with the time-overlap reason.
 *   - findNextFreeSlot: deterministic earliest-fit; gap-before-window wins;
 *     honest no-free-slot-in-horizon refusal at the horizon bound.
 *   - Batch bound: batch-too-large refuses the WHOLE batch (limit hit).
 *   - refuse-conflicts policy: honest partial accept with conflict records.
 *   - reallocate-next-free policy: deterministic conflict RESOLUTION — the
 *     proposal moves to its next free slot, the ack carries the original
 *     conflict AND the new slot; horizon exhaustion refuses honestly.
 *   - Determinism law: input order is the tie-break (first proposal wins);
 *     identical input -> byte-identical results.
 *   - Tenant isolation: a foreign tenant's window on the SAME assetId
 *     never conflicts (fail-closed isolation).
 *   - Honest time law: window-in-past and non-positive-duration refusals.
 */

import { describe, it, expect } from "vitest";
import {
  buildMaintenanceCalendar,
  calendarWindowFromScheduled,
  checkCalendarConflict,
  defaultBatchSchedulePolicy,
  emptyMaintenanceCalendar,
  findNextFreeSlot,
  scheduleWindowsBatch,
  type BatchSchedulePolicy,
  type CalendarWindow,
} from "./scheduling-scale.js";

const NOW = 1_727_000_000_000;
const TENANT_A = "tnt_acme";
const TENANT_B = "tnt_globex";
const ASSET_1 = "ast_pump-001";

function win(id: string, startsAt: number, endsAt: number, tenantId = TENANT_A, assetId = ASSET_1): CalendarWindow {
  return { id, tenantId, assetId, startsAt, endsAt };
}

// ---------------------------------------------------------------------------
// Calendar build + conflict detection at scale
// ---------------------------------------------------------------------------

describe("maintenance scheduling-scale: calendar + conflicts", () => {
  it("builds a per-(tenant, asset) slot index with deterministic (startsAt, id) ordering", () => {
    const r = buildMaintenanceCalendar([
      win("w-3", NOW + 1000, NOW + 2000),
      win("w-1", NOW + 0, NOW + 500),
      win("w-2", NOW + 1000, NOW + 1500), // same start as w-3 — id tie-break
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const slot = r.calendar.slots.get(`${TENANT_A}|${ASSET_1}`)!;
    expect(slot.map((w) => w.id)).toEqual(["w-1", "w-2", "w-3"]); // startsAt, then id
  });

  it("shape validation is fail-closed (invalid-window / ends-before-start / missing ids)", () => {
    expect(buildMaintenanceCalendar([win("", NOW, NOW + 1)]).ok).toBe(false);
    expect(buildMaintenanceCalendar([win("w", 0, NOW + 1)]).ok).toBe(false); // startsAt <= 0
    expect(buildMaintenanceCalendar([win("w", NOW + 10, NOW + 10)]).ok).toBe(false); // ends == starts
    const r = buildMaintenanceCalendar([win("w", NOW + 10, NOW + 5)]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("ends-before-start");
  });

  it("conflict detection at fleet scale (500 windows) reports the exact overlap bounds", () => {
    const windows: CalendarWindow[] = [];
    for (let i = 0; i < 500; i++) {
      // Non-overlapping windows: each 10 minutes, 5-minute gaps.
      windows.push(win(`w-${String(i).padStart(3, "0")}`, NOW + i * 15 * 60 * 1000, NOW + (i * 15 + 10) * 60 * 1000));
    }
    const r = buildMaintenanceCalendar(windows);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // The proposal overlaps window #250's first minute.
    const start = NOW + 250 * 15 * 60 * 1000 + 60 * 1000;
    const conflict = checkCalendarConflict(r.calendar, win("prop", start, start + 30 * 60 * 1000));
    expect(conflict).not.toBeNull();
    expect(conflict?.reason).toBe("time-overlap");
    expect(conflict?.existingId).toBe("w-250");
    expect(conflict?.overlapStart).toBe(start);
    expect(conflict?.overlapEnd).toBe(NOW + (250 * 15 + 10) * 60 * 1000); // clamped to the existing window's end
  });

  it("no conflict for a gap-fitting proposal; no conflict across assets", () => {
    const r = buildMaintenanceCalendar([win("w-1", NOW, NOW + 600_000)]);
    if (!r.ok) return;
    expect(checkCalendarConflict(r.calendar, win("p-1", NOW + 600_001, NOW + 900_000))).toBeNull();
    expect(checkCalendarConflict(r.calendar, win("p-2", NOW, NOW + 600_000, TENANT_A, "ast_other"))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findNextFreeSlot — deterministic earliest-fit
// ---------------------------------------------------------------------------

describe("maintenance scheduling-scale: findNextFreeSlot", () => {
  it("returns the earliest gap that fits, preferring a gap BEFORE a window", () => {
    const r = buildMaintenanceCalendar([
      win("w-1", NOW + 100, NOW + 200),
      win("w-2", NOW + 250, NOW + 350),
    ]);
    if (!r.ok) return;
    // A 40ms duration fits in the gap [50, 100) BEFORE w-1 — earliest fit wins
    // over the later [200, 250) gap.
    const s = findNextFreeSlot(r.calendar, {
      tenantId: TENANT_A,
      assetId: ASSET_1,
      durationMs: 40,
      notBefore: NOW + 50,
      horizonMs: 10_000,
    });
    expect(s.ok).toBe(true);
    if (s.ok) {
      expect(s.startsAt).toBe(NOW + 50);
      expect(s.endsAt).toBe(NOW + 90);
    }
  });

  it("skips too-small gaps and lands after the last window", () => {
    const r = buildMaintenanceCalendar([win("w-1", NOW + 100, NOW + 200)]);
    if (!r.ok) return;
    // 150ms does NOT fit the gap [50, 100) — the slot after w-1 wins.
    const s = findNextFreeSlot(r.calendar, {
      tenantId: TENANT_A,
      assetId: ASSET_1,
      durationMs: 150,
      notBefore: NOW + 50,
      horizonMs: 10_000,
    });
    expect(s.ok).toBe(true);
    if (s.ok) expect(s.startsAt).toBe(NOW + 200);
  });

  it("honest refusal when no free slot fits within the horizon", () => {
    const r = buildMaintenanceCalendar([win("w-1", NOW + 100, NOW + 200)]);
    if (!r.ok) return;
    const s = findNextFreeSlot(r.calendar, {
      tenantId: TENANT_A,
      assetId: ASSET_1,
      durationMs: 50,
      notBefore: NOW + 50,
      horizonMs: 100, // horizon ends at NOW+150 — only 50ms of gap exist before w-1... which fits exactly? no:
    });
    // Gap [50,100) is exactly 50ms — durationMs 50 fits exactly; use 51 to force refusal.
    const s2 = findNextFreeSlot(r.calendar, {
      tenantId: TENANT_A,
      assetId: ASSET_1,
      durationMs: 51,
      notBefore: NOW + 50,
      horizonMs: 100,
    });
    expect(s2.ok).toBe(false);
    if (!s2.ok) {
      expect(s2.reason).toBe("no-free-slot-in-horizon");
      expect(s2.searchedUntil).toBe(NOW + 150);
    }
    expect(s.ok).toBe(true); // the exact-fit boundary IS admissible
  });

  it("an empty calendar returns notBefore directly", () => {
    const s = findNextFreeSlot(emptyMaintenanceCalendar(), {
      tenantId: TENANT_A,
      assetId: ASSET_1,
      durationMs: 1000,
      notBefore: NOW,
      horizonMs: 10_000,
    });
    expect(s.ok).toBe(true);
    if (s.ok) expect(s.startsAt).toBe(NOW);
  });
});

// ---------------------------------------------------------------------------
// Bounded batch scheduling — both resolution policies
// ---------------------------------------------------------------------------

describe("maintenance scheduling-scale: bounded batch scheduling", () => {
  const policy: BatchSchedulePolicy = { ...defaultBatchSchedulePolicy(), maxProposalsPerBatch: 4 };

  it("batch bound is hit: an over-limit batch is refused WHOLE (nothing scheduled)", () => {
    const proposals = Array.from({ length: 5 }, (_, i) => win(`p-${i}`, NOW + 10_000 + i * 100, NOW + 10_500 + i * 100));
    const r = scheduleWindowsBatch(emptyMaintenanceCalendar(), proposals, { policy, now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("batch-too-large");
      expect(r.size).toBe(5);
      expect(r.maxProposalsPerBatch).toBe(4);
    }
  });

  it("refuse-conflicts: conflicting proposal refused WITH its record; others scheduled (partial accept)", () => {
    const base = buildMaintenanceCalendar([win("w-existing", NOW + 1000, NOW + 2000)]);
    if (!base.ok) return;
    const proposals = [
      win("p-conflict", NOW + 1500, NOW + 2500), // overlaps w-existing
      win("p-free", NOW + 5000, NOW + 6000), // no conflict
    ];
    const r = scheduleWindowsBatch(base.calendar, proposals, { policy: { ...policy, resolution: "refuse-conflicts" }, now: NOW });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.scheduledCount).toBe(1);
    expect(r.refusedCount).toBe(1);
    const refused = r.acks[0];
    expect(refused && !refused.ok).toBe(true);
    if (refused && !refused.ok) {
      expect(refused.reason).toBe("time-overlap");
      expect(refused.conflict?.existingId).toBe("w-existing");
      expect(refused.conflict?.overlapStart).toBe(NOW + 1500);
      expect(refused.conflict?.overlapEnd).toBe(NOW + 2000);
    }
    // The accepted proposal joined the calendar.
    expect(r.calendar.slots.get(`${TENANT_A}|${ASSET_1}`)?.map((w) => w.id)).toContain("p-free");
  });

  it("reallocate-next-free: a conflicting proposal is RESOLVED to its next free slot (deterministic)", () => {
    const base = buildMaintenanceCalendar([win("w-existing", NOW + 1000, NOW + 2000)]);
    if (!base.ok) return;
    const proposals = [win("p-move", NOW + 1500, NOW + 2500)]; // 1000ms duration, conflicts
    const r = scheduleWindowsBatch(base.calendar, proposals, {
      policy: { ...policy, resolution: "reallocate-next-free", reallocationHorizonMs: 100_000 },
      now: NOW,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.reallocatedCount).toBe(1);
    expect(r.refusedCount).toBe(0);
    const ack = r.acks[0];
    expect(ack?.ok).toBe(true);
    if (ack?.ok && ack.outcome === "reallocated") {
      expect(ack.original.startsAt).toBe(NOW + 1500); // the contested slot is recorded
      expect(ack.conflict.existingId).toBe("w-existing");
      expect(ack.window.startsAt).toBe(NOW + 2000); // earliest free slot: right after w-existing
      expect(ack.window.endsAt).toBe(NOW + 3000); // duration preserved (1000ms)
    }
  });

  it("reallocate-next-free: horizon exhaustion refuses honestly (never silently dropped)", () => {
    const base = buildMaintenanceCalendar([win("w-existing", NOW + 1000, NOW + 2000)]);
    if (!base.ok) return;
    const proposals = [win("p-move", NOW + 1500, NOW + 2500)];
    const r = scheduleWindowsBatch(base.calendar, proposals, {
      policy: { ...policy, resolution: "reallocate-next-free", reallocationHorizonMs: 300 }, // too short
      now: NOW,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.refusedCount).toBe(1);
    const ack = r.acks[0];
    expect(ack && !ack.ok).toBe(true);
    if (ack && !ack.ok) {
      expect(ack.reason).toBe("no-free-slot-in-horizon");
      expect(ack.conflict?.existingId).toBe("w-existing"); // the conflict that caused it
    }
  });

  it("determinism law: input order is the tie-break — the FIRST proposal wins the contested slot", () => {
    const proposals = [
      win("p-first", NOW + 1000, NOW + 2000),
      win("p-second", NOW + 1500, NOW + 2500), // conflicts with p-first (not the base calendar)
    ];
    const run = (): string => {
      const r = scheduleWindowsBatch(emptyMaintenanceCalendar(), proposals, {
        policy: { ...policy, resolution: "refuse-conflicts" },
        now: NOW,
      });
      if (!r.ok) throw new Error("refused");
      return JSON.stringify(r.acks.map((a) => (a.ok ? { i: a.index, o: a.outcome } : { i: a.index, r: a.reason })));
    };
    expect(run()).toBe(run()); // byte-identical
    const r = scheduleWindowsBatch(emptyMaintenanceCalendar(), proposals, {
      policy: { ...policy, resolution: "refuse-conflicts" },
      now: NOW,
    });
    if (!r.ok) return;
    expect(r.acks[0]?.ok).toBe(true); // first proposal scheduled
    const second = r.acks[1];
    expect(second && !second.ok && second.reason === "time-overlap").toBe(true); // second loses
    expect(second && !second.ok ? second.conflict?.existingId : null).toBe("p-first"); // against the FIRST proposal
  });

  it("honest time law: window-in-past and non-positive-duration refusals", () => {
    const proposals = [
      win("p-past", NOW - 1000, NOW + 500), // starts in the past
      win("p-zero", NOW + 100, NOW + 100), // zero duration
    ];
    const r = scheduleWindowsBatch(emptyMaintenanceCalendar(), proposals, { policy, now: NOW });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.acks[0] && !r.acks[0].ok ? r.acks[0].reason : null).toBe("window-in-past");
    expect(r.acks[1] && !r.acks[1].ok ? r.acks[1].reason : null).toBe("non-positive-duration");
    expect(r.scheduledCount).toBe(0);
  });

  it("tenant isolation: a foreign tenant's window on the SAME asset never conflicts (fail-closed isolation)", () => {
    const base = buildMaintenanceCalendar([win("w-a", NOW + 1000, NOW + 2000, TENANT_A)]);
    if (!base.ok) return;
    // Tenant B proposes the exact same time on the same asset — no conflict.
    const proposals = [win("w-b", NOW + 1000, NOW + 2000, TENANT_B)];
    const r = scheduleWindowsBatch(base.calendar, proposals, { policy, now: NOW });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.scheduledCount).toBe(1); // B scheduled — its slot is isolated from A's
    expect(checkCalendarConflict(base.calendar, win("probe", NOW + 1000, NOW + 2000, TENANT_B))).toBeNull();
    // And the two tenants' windows live in separate slots.
    expect(r.calendar.slots.get(`${TENANT_B}|${ASSET_1}`)?.map((w) => w.id)).toEqual(["w-b"]);
    expect(r.calendar.slots.get(`${TENANT_A}|${ASSET_1}`)?.map((w) => w.id)).toEqual(["w-a"]);
  });

  it("fleet-scale batch: 100 proposals across 20 assets with deterministic results", () => {
    const proposals: CalendarWindow[] = [];
    for (let a = 0; a < 20; a++) {
      for (let i = 0; i < 5; i++) {
        proposals.push(win(`p-${a}-${i}`, NOW + 10_000 + i * 1000, NOW + 10_500 + i * 1000, TENANT_A, `ast-${a}`));
      }
    }
    const r = scheduleWindowsBatch(emptyMaintenanceCalendar(), proposals, {
      policy: { ...policy, maxProposalsPerBatch: 128, resolution: "reallocate-next-free", reallocationHorizonMs: 1_000_000 },
      now: NOW,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.scheduledCount).toBe(100); // disjoint windows — all schedule
    expect(r.calendar.slots.size).toBe(20);
    // Deterministic: re-run produces identical calendar bytes.
    const again = scheduleWindowsBatch(emptyMaintenanceCalendar(), proposals, {
      policy: { ...policy, maxProposalsPerBatch: 128, resolution: "reallocate-next-free", reallocationHorizonMs: 1_000_000 },
      now: NOW,
    });
    expect(again.ok && r.ok ? JSON.stringify([...again.calendar.slots.entries()]) === JSON.stringify([...r.calendar.slots.entries()]) : false).toBe(true);
  });

  it("calendarWindowFromScheduled bridges the F220A ScheduledWindow shape", () => {
    const scheduled = {
      id: "sw-1",
      tenantId: TENANT_A,
      assetId: ASSET_1,
      window: { kind: "one-time" as const, startsAt: NOW, endsAt: NOW + 100, reason: "swap" },
    };
    expect(calendarWindowFromScheduled(scheduled)).toEqual({
      id: "sw-1",
      tenantId: TENANT_A,
      assetId: ASSET_1,
      startsAt: NOW,
      endsAt: NOW + 100,
    });
  });
});
