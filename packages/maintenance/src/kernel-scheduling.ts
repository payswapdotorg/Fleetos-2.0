/**
 * @fleetos/maintenance — Wave 2 scheduling conflict detection (F220A).
 *
 *   - Maintenance scheduling windows with conflict detection — two windows
 *     that overlap on the same asset are flagged as a conflict. The kernel
 *     refuses to schedule a conflicting window.
 *   - Scheduling windows carry a typed set of constraints: tenant scope,
 *     asset scope, recurrence, and exclusivity.
 *
 * Pure TypeScript over injected PORT interfaces. No I/O, no servers, no
 * databases. Persistence lands at F211 (TL lane).
 */

import type { TenantIdLike, MaintenanceOrderId } from "./maintenance.js";
import type { MaintenanceWindow } from "./kernel.js";
import { windowContainsAt } from "./kernel.js";

// ---------------------------------------------------------------------------
// Scheduling conflict detection — two windows conflict if they overlap on
// the same (tenant, assetId) AND their time ranges intersect.
// ---------------------------------------------------------------------------

export interface ScheduledWindow {
  readonly id: string;
  readonly tenantId: TenantIdLike;
  readonly assetId: string;
  readonly window: MaintenanceWindow;
}

export type SchedulingConflictReason =
  | "time-overlap"
  | "asset-conflict"
  | "tenant-mismatch";

export interface SchedulingConflict {
  readonly existingId: string;
  readonly proposedId: string;
  readonly reason: SchedulingConflictReason;
  readonly overlapStart: number;
  readonly overlapEnd: number;
}

export function detectSchedulingConflict(
  existing: ScheduledWindow,
  proposed: ScheduledWindow,
): SchedulingConflict | null {
  if (existing.tenantId !== proposed.tenantId) {
    // Different tenants — no conflict (cross-tenant isolation is preserved).
    return null;
  }
  if (existing.assetId !== proposed.assetId) {
    // Different assets — no conflict (even in the same tenant).
    return null;
  }
  // Compute the time overlap.
  const existingStart = existing.window.startsAt;
  const existingEnd = existing.window.endsAt;
  const proposedStart = proposed.window.startsAt;
  const proposedEnd = proposed.window.endsAt;
  // No overlap: proposed starts after existing ends OR proposed ends before existing starts.
  if (proposedStart > existingEnd || proposedEnd < existingStart) {
    return null;
  }
  const overlapStart = Math.max(existingStart, proposedStart);
  const overlapEnd = Math.min(existingEnd, proposedEnd);
  if (overlapEnd < overlapStart) return null;
  return {
    existingId: existing.id,
    proposedId: proposed.id,
    reason: "time-overlap",
    overlapStart,
    overlapEnd,
  };
}

// ---------------------------------------------------------------------------
// Conflict-aware scheduler — refuses to schedule a window that conflicts
// with any existing window in the same (tenant, assetId) slot.
// ---------------------------------------------------------------------------

export type ScheduleResult =
  | { readonly ok: true; readonly window: ScheduledWindow }
  | { readonly ok: false; readonly reason: SchedulingConflictReason; readonly conflict: SchedulingConflict };

export function scheduleWindow(
  existing: ReadonlyArray<ScheduledWindow>,
  proposed: ScheduledWindow,
): ScheduleResult {
  for (const w of existing) {
    const conflict = detectSchedulingConflict(w, proposed);
    if (conflict) {
      return { ok: false, reason: conflict.reason, conflict };
    }
  }
  return { ok: true, window: proposed };
}

// ---------------------------------------------------------------------------
// Conflict-aware scheduler for maintenance orders — given a list of
// already-scheduled orders (with their windows), attempt to schedule a new
// order. The order is refused if its window conflicts with any existing.
// ---------------------------------------------------------------------------

export interface ScheduledMaintenanceOrder {
  readonly orderId: MaintenanceOrderId;
  readonly tenantId: TenantIdLike;
  readonly assetId: string;
  readonly window: MaintenanceWindow;
}

export function checkMaintenanceOrderConflict(
  existing: ReadonlyArray<ScheduledMaintenanceOrder>,
  proposed: ScheduledMaintenanceOrder,
): { readonly ok: true } | { readonly ok: false; readonly conflict: SchedulingConflict } {
  for (const o of existing) {
    const conflict = detectSchedulingConflict(
      { id: o.orderId as string, tenantId: o.tenantId, assetId: o.assetId, window: o.window },
      { id: proposed.orderId as string, tenantId: proposed.tenantId, assetId: proposed.assetId, window: proposed.window },
    );
    if (conflict) return { ok: false, conflict };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Window intersection helpers — used to compute the overlap region.
// ---------------------------------------------------------------------------

export function windowIntersection(
  a: MaintenanceWindow,
  b: MaintenanceWindow,
): { readonly start: number; readonly end: number } | null {
  const start = Math.max(a.startsAt, b.startsAt);
  const end = Math.min(a.endsAt, b.endsAt);
  if (end < start) return null;
  return { start, end };
}

export function windowOverlapsAt(a: MaintenanceWindow, b: MaintenanceWindow, at: number): boolean {
  return windowContainsAt(a, at) && windowContainsAt(b, at);
}

// ---------------------------------------------------------------------------
// Schedule slot — a typed slot in the schedule for a (tenant, assetId)
// pair. The slot carries the active windows and a "blocked" flag that's
// true when any window in the slot is currently active.
// ---------------------------------------------------------------------------

export interface ScheduleSlot {
  readonly tenantId: TenantIdLike;
  readonly assetId: string;
  readonly windows: ReadonlyArray<MaintenanceWindow>;
  readonly blocked: boolean; // true if any window is currently active
}

export function buildScheduleSlot(
  tenantId: TenantIdLike,
  assetId: string,
  windows: ReadonlyArray<MaintenanceWindow>,
  now: number,
): ScheduleSlot {
  const blocked = windows.some((w) => windowContainsAt(w, now));
  return { tenantId, assetId, windows, blocked };
}
