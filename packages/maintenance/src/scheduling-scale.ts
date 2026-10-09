/**
 * @fleetos/maintenance — Wave 8 fleet-scale schedule conflicts (F280A).
 *
 * The F220A scheduling kernel detects two-window conflicts and refuses the
 * second — correct at unit scale, but a fleet-scale maintenance calendar
 * needs bounded batch scheduling with DETERMINISTIC conflict resolution:
 *
 *   - **MaintenanceCalendar** — windows indexed per (tenantId, assetId)
 *     slot, sorted by startsAt. Conflict checks consult one slot, not the
 *     whole fleet (O(slot) not O(fleet)); tenant slots are isolated — a
 *     foreign tenant's window on the SAME assetId never conflicts
 *     (fail-closed tenant isolation preserved from F220A).
 *   - **findNextFreeSlot** — deterministic earliest-fit: the first gap of
 *     at least `durationMs` after `notBefore` within the horizon. When no
 *     gap fits before the horizon the result REFUSES with
 *     `no-free-slot-in-horizon` — an honest, reason-coded refusal, never
 *     an invented slot.
 *   - **scheduleWindowsBatch** — bounded batch scheduling with per-proposal
 *     acks and two caller-chosen resolution policies:
 *       `refuse-conflicts` — fail-closed: a conflicting proposal is refused
 *       with the conflict record (`time-overlap` + overlap bounds) while
 *       non-conflicting proposals in the same batch are scheduled (honest
 *       partial accept);
 *       `reallocate-next-free` — deterministic conflict RESOLUTION: a
 *       conflicting proposal is moved to its next free slot via
 *       findNextFreeSlot and acked `conflict-reallocated` carrying the
 *       original conflict AND the new slot; if no free slot exists within
 *       the horizon the proposal is REFUSED (`no-free-slot-in-horizon`) —
 *       never silently dropped.
 *     Determinism law: proposals are processed in INPUT ORDER and accepted
 *     proposals join the calendar immediately, so an earlier proposal wins
 *     a contested slot — same input order, byte-identical results (tested).
 *   - **Batch bound** — more than `maxProposalsPerBatch` proposals refuses
 *     the WHOLE batch (`batch-too-large`): nothing is scheduled.
 *   - **Honest time law** — proposals starting at or before `now` refuse
 *     `window-in-past`; non-positive durations refuse `non-positive-duration`.
 *
 * Pure deterministic TypeScript; logical `now` everywhere; no Date.now, no
 * Math.random, no network, no timers.
 */

import type { TenantIdLike } from "./maintenance.js";
import type { ScheduledWindow } from "./kernel-scheduling.js";

// ---------------------------------------------------------------------------
// Calendar windows + slot index.
// ---------------------------------------------------------------------------

export interface CalendarWindow {
  readonly id: string;
  readonly tenantId: TenantIdLike;
  readonly assetId: string;
  readonly startsAt: number;
  readonly endsAt: number;
}

export interface MaintenanceCalendar {
  /** `${tenantId}|${assetId}` -> windows sorted by (startsAt, id) — total order. */
  readonly slots: ReadonlyMap<string, ReadonlyArray<CalendarWindow>>;
}

export function calendarWindowFromScheduled(w: ScheduledWindow): CalendarWindow {
  return {
    id: w.id,
    tenantId: w.tenantId,
    assetId: w.assetId,
    startsAt: w.window.startsAt,
    endsAt: w.window.endsAt,
  };
}

function slotKey(tenantId: TenantIdLike, assetId: string): string {
  return `${tenantId}|${assetId}`;
}

export function buildMaintenanceCalendar(
  windows: ReadonlyArray<CalendarWindow>,
): { readonly ok: true; readonly calendar: MaintenanceCalendar } | { readonly ok: false; readonly reason: "invalid-window" | "ends-before-start" | "missing-window-id" | "missing-tenant-id" | "missing-asset-id" } {
  const slots = new Map<string, CalendarWindow[]>();
  for (const w of windows) {
    if (w.id === "") return { ok: false, reason: "missing-window-id" };
    if (w.tenantId === "") return { ok: false, reason: "missing-tenant-id" };
    if (w.assetId === "") return { ok: false, reason: "missing-asset-id" };
    if (!Number.isFinite(w.startsAt) || !Number.isFinite(w.endsAt) || w.startsAt <= 0) {
      return { ok: false, reason: "invalid-window" };
    }
    if (w.endsAt <= w.startsAt) return { ok: false, reason: "ends-before-start" };
    const key = slotKey(w.tenantId, w.assetId);
    const list = slots.get(key) ?? [];
    list.push(w);
    slots.set(key, list);
  }
  for (const [key, list] of slots) {
    slots.set(
      key,
      list.sort((a, b) => (a.startsAt !== b.startsAt ? a.startsAt - b.startsAt : a.id < b.id ? -1 : 1)),
    );
  }
  return { ok: true, calendar: { slots } };
}

export function emptyMaintenanceCalendar(): MaintenanceCalendar {
  return { slots: new Map() };
}

// ---------------------------------------------------------------------------
// Conflict detection over a slot.
// ---------------------------------------------------------------------------

export interface ScheduleConflictRecord {
  readonly existingId: string;
  readonly proposedId: string;
  readonly reason: "time-overlap";
  readonly overlapStart: number;
  readonly overlapEnd: number;
}

export function checkCalendarConflict(
  calendar: MaintenanceCalendar,
  proposed: CalendarWindow,
): ScheduleConflictRecord | null {
  const slot = calendar.slots.get(slotKey(proposed.tenantId, proposed.assetId)) ?? [];
  for (const existing of slot) {
    // No overlap: proposed starts after existing ends OR ends before existing starts.
    if (proposed.startsAt > existing.endsAt || proposed.endsAt < existing.startsAt) continue;
    const overlapStart = Math.max(existing.startsAt, proposed.startsAt);
    const overlapEnd = Math.min(existing.endsAt, proposed.endsAt);
    if (overlapEnd < overlapStart) continue;
    return {
      existingId: existing.id,
      proposedId: proposed.id,
      reason: "time-overlap",
      overlapStart,
      overlapEnd,
    };
  }
  return null; // different tenant/asset slots never conflict (isolation)
}

// ---------------------------------------------------------------------------
// Deterministic earliest-fit slot search.
// ---------------------------------------------------------------------------

export type NextFreeSlotResult =
  | { readonly ok: true; readonly startsAt: number; readonly endsAt: number; readonly searchedUntil: number }
  | { readonly ok: false; readonly reason: "no-free-slot-in-horizon"; readonly searchedUntil: number };

export function findNextFreeSlot(
  calendar: MaintenanceCalendar,
  input: {
    readonly tenantId: TenantIdLike;
    readonly assetId: string;
    readonly durationMs: number;
    readonly notBefore: number;
    readonly horizonMs: number;
  },
): NextFreeSlotResult {
  if (!Number.isFinite(input.durationMs) || input.durationMs <= 0) {
    throw new TypeError("findNextFreeSlot: durationMs must be > 0");
  }
  const limit = input.notBefore + input.horizonMs;
  const slot = calendar.slots.get(slotKey(input.tenantId, input.assetId)) ?? [];
  let cursor = input.notBefore;
  for (const w of slot) {
    if (w.endsAt <= cursor) continue; // entirely behind the cursor
    if (w.startsAt - cursor >= input.durationMs) {
      // Gap before this window fits the duration — earliest fit wins.
      if (cursor + input.durationMs <= limit) {
        return { ok: true, startsAt: cursor, endsAt: cursor + input.durationMs, searchedUntil: limit };
      }
      return { ok: false, reason: "no-free-slot-in-horizon", searchedUntil: limit };
    }
    // Does not fit before this window — jump past it.
    cursor = Math.max(cursor, w.endsAt);
    if (cursor + input.durationMs > limit) {
      return { ok: false, reason: "no-free-slot-in-horizon", searchedUntil: limit };
    }
  }
  // After the last window (or an empty slot).
  if (cursor + input.durationMs <= limit) {
    return { ok: true, startsAt: cursor, endsAt: cursor + input.durationMs, searchedUntil: limit };
  }
  return { ok: false, reason: "no-free-slot-in-horizon", searchedUntil: limit };
}

// ---------------------------------------------------------------------------
// Bounded batch scheduling with deterministic conflict resolution.
// ---------------------------------------------------------------------------

export type ScheduleResolutionPolicy = "refuse-conflicts" | "reallocate-next-free";

export interface BatchSchedulePolicy {
  readonly maxProposalsPerBatch: number;
  readonly resolution: ScheduleResolutionPolicy;
  readonly reallocationHorizonMs: number;
}

export function defaultBatchSchedulePolicy(): BatchSchedulePolicy {
  return { maxProposalsPerBatch: 128, resolution: "refuse-conflicts", reallocationHorizonMs: 30 * 24 * 60 * 60 * 1000 };
}

export type ScheduleBatchRejectionCode =
  | "missing-window-id"
  | "missing-tenant-id"
  | "missing-asset-id"
  | "invalid-window"
  | "non-positive-duration"
  | "window-in-past"
  | "time-overlap"
  | "no-free-slot-in-horizon";

export type ScheduleBatchAck =
  | { readonly index: number; readonly ok: true; readonly outcome: "scheduled"; readonly window: CalendarWindow }
  | {
      readonly index: number;
      readonly ok: true;
      readonly outcome: "reallocated";
      readonly original: CalendarWindow; // the proposed (conflicting) slot
      readonly window: CalendarWindow; // the deterministic next-free slot
      readonly conflict: ScheduleConflictRecord;
    }
  | { readonly index: number; readonly ok: false; readonly reason: ScheduleBatchRejectionCode; readonly conflict?: ScheduleConflictRecord };

export type ScheduleBatchResult =
  | { readonly ok: false; readonly reason: "batch-too-large"; readonly size: number; readonly maxProposalsPerBatch: number }
  | {
      readonly ok: true;
      readonly acks: ReadonlyArray<ScheduleBatchAck>;
      readonly calendar: MaintenanceCalendar; // includes every scheduled/reallocated window
      readonly scheduledCount: number;
      readonly reallocatedCount: number;
      readonly refusedCount: number;
    };

export function scheduleWindowsBatch(
  calendar: MaintenanceCalendar,
  proposals: ReadonlyArray<CalendarWindow>,
  input: { readonly policy: BatchSchedulePolicy; readonly now: number },
): ScheduleBatchResult {
  if (input.policy.maxProposalsPerBatch < 1) {
    throw new TypeError("scheduleWindowsBatch: maxProposalsPerBatch must be >= 1");
  }
  if (input.policy.resolution === "reallocate-next-free" && input.policy.reallocationHorizonMs < 1) {
    throw new TypeError("scheduleWindowsBatch: reallocationHorizonMs must be >= 1");
  }
  // Fail-closed whole-batch refusal — nothing is scheduled.
  if (proposals.length > input.policy.maxProposalsPerBatch) {
    return { ok: false, reason: "batch-too-large", size: proposals.length, maxProposalsPerBatch: input.policy.maxProposalsPerBatch };
  }

  // Working copy: accepted proposals join the calendar immediately, so later
  // proposals in the SAME batch see them (input order is the tie-break law).
  const slots = new Map<string, CalendarWindow[]>();
  for (const [key, list] of calendar.slots) slots.set(key, [...list]);
  const insert = (w: CalendarWindow): void => {
    const key = slotKey(w.tenantId, w.assetId);
    const list = slots.get(key) ?? [];
    list.push(w);
    list.sort((a, b) => (a.startsAt !== b.startsAt ? a.startsAt - b.startsAt : a.id < b.id ? -1 : 1));
    slots.set(key, list);
  };

  const acks: ScheduleBatchAck[] = [];
  let scheduledCount = 0;
  let reallocatedCount = 0;
  let refusedCount = 0;

  for (let i = 0; i < proposals.length; i++) {
    const p = proposals[i]!;
    if (p.id === "") { acks.push({ index: i, ok: false, reason: "missing-window-id" }); refusedCount++; continue; }
    if (p.tenantId === "") { acks.push({ index: i, ok: false, reason: "missing-tenant-id" }); refusedCount++; continue; }
    if (p.assetId === "") { acks.push({ index: i, ok: false, reason: "missing-asset-id" }); refusedCount++; continue; }
    if (!Number.isFinite(p.startsAt) || !Number.isFinite(p.endsAt) || p.startsAt <= 0) {
      acks.push({ index: i, ok: false, reason: "invalid-window" }); refusedCount++; continue;
    }
    const duration = p.endsAt - p.startsAt;
    if (duration <= 0) { acks.push({ index: i, ok: false, reason: "non-positive-duration" }); refusedCount++; continue; }
    if (p.startsAt <= input.now) { acks.push({ index: i, ok: false, reason: "window-in-past" }); refusedCount++; continue; }

    const conflict = checkCalendarConflict({ slots }, p);
    if (conflict === null) {
      insert(p);
      acks.push({ index: i, ok: true, outcome: "scheduled", window: p });
      scheduledCount++;
      continue;
    }
    if (input.policy.resolution === "refuse-conflicts") {
      // Fail-closed: the conflict is refused WITH its record; other proposals
      // in the same batch still schedule (honest partial accept).
      acks.push({ index: i, ok: false, reason: "time-overlap", conflict });
      refusedCount++;
      continue;
    }
    // reallocate-next-free: deterministic resolution — move to the next free slot.
    const slot = findNextFreeSlot({ slots }, {
      tenantId: p.tenantId,
      assetId: p.assetId,
      durationMs: duration,
      notBefore: p.startsAt,
      horizonMs: input.policy.reallocationHorizonMs,
    });
    if (!slot.ok) {
      // Never silently dropped — the honest refusal carries the conflict.
      acks.push({ index: i, ok: false, reason: "no-free-slot-in-horizon", conflict });
      refusedCount++;
      continue;
    }
    const moved: CalendarWindow = { ...p, startsAt: slot.startsAt, endsAt: slot.endsAt };
    insert(moved);
    acks.push({ index: i, ok: true, outcome: "reallocated", original: p, window: moved, conflict });
    reallocatedCount++;
  }

  return { ok: true, acks, calendar: { slots }, scheduledCount, reallocatedCount, refusedCount };
}
