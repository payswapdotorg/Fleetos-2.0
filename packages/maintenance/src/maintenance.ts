/**
 * @fleetos/maintenance — Wave 0 contracts.
 *
 * Pure TypeScript domain contracts ONLY. No I/O, no servers, no databases.
 *
 * Owns (per spec/BOUNDED-CONTEXTS.md "Maintenance & Recovery"):
 *   - service plans;
 *   - maintenance orders;
 *   - schedules;
 *   - warranty/service relationships.
 *
 * Order state machine (pure, refusing illegal transitions):
 *   scheduled -> in-progress -> completed
 *   scheduled -> cancelled
 *   in-progress -> cancelled
 *
 * Cross-worker seam: structural `TenantIdLike`, `AssetIdLike`.
 */

// ---------------------------------------------------------------------------
// Structural seam types
// ---------------------------------------------------------------------------

export type TenantIdLike = string;
export type AssetIdLike = string;

// ---------------------------------------------------------------------------
// Branded ids
// ---------------------------------------------------------------------------

declare const __brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [__brand]: B };
export type ServicePlanId = Brand<string, "ServicePlanId">;
export type MaintenanceOrderId = Brand<string, "MaintenanceOrderId">;

const PLAN_ID_RE = /^plan_[A-Za-z0-9_-]{4,128}$/;
const ORDER_ID_RE = /^mo_[A-Za-z0-9_-]{4,128}$/;
export const isServicePlanId = (v: string): v is ServicePlanId =>
  typeof v === "string" && PLAN_ID_RE.test(v);
export const isMaintenanceOrderId = (v: string): v is MaintenanceOrderId =>
  typeof v === "string" && ORDER_ID_RE.test(v);

// ---------------------------------------------------------------------------
// Schedule — pure expression; no cron strings (cron is not pure).
// ---------------------------------------------------------------------------

export type Schedule =
  | { readonly kind: "one-time"; readonly at: number }
  | {
      readonly kind: "recurring";
      readonly intervalMs: number;
      readonly startsAt: number;
      readonly endsAt?: number;
    };

export function nextRun(schedule: Schedule, from: number): number | null {
  if (schedule.kind === "one-time") {
    return schedule.at >= from ? schedule.at : null;
  }
  if (!Number.isFinite(schedule.intervalMs) || schedule.intervalMs <= 0) return null;
  if (from >= (schedule.endsAt ?? Number.POSITIVE_INFINITY)) return null;
  if (from < schedule.startsAt) return schedule.startsAt;
  const elapsed = from - schedule.startsAt;
  const periods = Math.floor(elapsed / schedule.intervalMs);
  const candidate = schedule.startsAt + (periods + 1) * schedule.intervalMs;
  if (schedule.endsAt !== undefined && candidate > schedule.endsAt) return null;
  return candidate;
}

// ---------------------------------------------------------------------------
// ServicePlan
// ---------------------------------------------------------------------------

export type ServicePlanKind = "preventive" | "corrective" | "predictive";

export interface ServicePlan {
  readonly id: ServicePlanId;
  readonly tenantId: TenantIdLike;
  readonly assetId: AssetIdLike;
  readonly kind: ServicePlanKind;
  readonly schedule: Schedule;
  readonly createdAt: number;
}

// ---------------------------------------------------------------------------
// MaintenanceOrder state machine
// ---------------------------------------------------------------------------

export type MaintenanceState =
  | "scheduled"
  | "in-progress"
  | "completed"
  | "cancelled";

export type MaintenanceCommandKind = "start" | "complete" | "cancel";

export interface MaintenanceCommand {
  readonly kind: MaintenanceCommandKind;
  readonly reason?: string;
  readonly initiatedAt: number;
}

export type MaintenanceRejectionCode =
  | "illegal-transition"
  | "already-in-target-state"
  | "unknown-command";

export type MaintenanceTransitionResult =
  | { readonly ok: true; readonly from: MaintenanceState; readonly to: MaintenanceState }
  | { readonly ok: false; readonly reason: MaintenanceRejectionCode };

const TRANSITIONS: Readonly<Record<
  MaintenanceState,
  Partial<Record<MaintenanceCommandKind, MaintenanceState>>
>> = {
  scheduled: { start: "in-progress", cancel: "cancelled" },
  "in-progress": { complete: "completed", cancel: "cancelled" },
  completed: {},
  cancelled: {},
};

export function evaluateMaintenanceTransition(
  current: MaintenanceState,
  command: MaintenanceCommand,
): MaintenanceTransitionResult {
  const known: ReadonlyArray<MaintenanceCommandKind> = ["start", "complete", "cancel"];
  if (!known.includes(command.kind)) return { ok: false, reason: "unknown-command" };
  const next = TRANSITIONS[current]?.[command.kind];
  if (next === undefined) {
    if (
      (command.kind === "complete" && current === "completed") ||
      (command.kind === "cancel" && current === "cancelled")
    ) {
      return { ok: false, reason: "already-in-target-state" };
    }
    return { ok: false, reason: "illegal-transition" };
  }
  return { ok: true, from: current, to: next };
}

// ---------------------------------------------------------------------------
// MaintenanceOrder aggregate
// ---------------------------------------------------------------------------

export interface MaintenanceOrder {
  readonly id: MaintenanceOrderId;
  readonly tenantId: TenantIdLike;
  readonly planId: ServicePlanId;
  readonly state: MaintenanceState;
  readonly createdAt: number;
  readonly assignedTo?: string;
  readonly cancelledReason?: string;
}

export function createMaintenanceOrder(input: {
  readonly id: MaintenanceOrderId;
  readonly tenantId: TenantIdLike;
  readonly planId: ServicePlanId;
  readonly createdAt: number;
  readonly assignedTo?: string;
}): MaintenanceOrder {
  if (!isMaintenanceOrderId(input.id)) throw new TypeError("malformed MaintenanceOrderId");
  if (!isServicePlanId(input.planId)) throw new TypeError("malformed ServicePlanId");
  return {
    id: input.id,
    tenantId: input.tenantId,
    planId: input.planId,
    state: "scheduled",
    createdAt: input.createdAt,
    assignedTo: input.assignedTo,
  };
}

export function applyMaintenanceCommand(
  order: MaintenanceOrder,
  command: MaintenanceCommand,
):
  | { readonly ok: true; readonly order: MaintenanceOrder }
  | { readonly ok: false; readonly reason: MaintenanceRejectionCode } {
  const result = evaluateMaintenanceTransition(order.state, command);
  if (!result.ok) return result;
  const next: MaintenanceOrder = {
    ...order,
    state: result.to,
    cancelledReason: command.kind === "cancel" ? command.reason : order.cancelledReason,
  };
  return { ok: true, order: next };
}
