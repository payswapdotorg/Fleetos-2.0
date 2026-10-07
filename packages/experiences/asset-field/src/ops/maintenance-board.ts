/**
 * @fleetos/experience-asset-field — maintenance schedule board read-model.
 *
 * The maintenance board over @fleetos/maintenance: orders grouped into
 * state columns (scheduled / in-progress / completed / cancelled, each
 * deterministically ordered by createdAt then orderId) plus the upcoming
 * schedule runs — each service plan's next run computed by the domain's
 * own pure `nextRun(schedule, now)` (one-time and recurring schedules),
 * ordered soonest-first with expired/no-next plans last, then planId.
 */

import { nextRun } from "@fleetos/maintenance";
import type { MaintenanceState, ServicePlanKind } from "@fleetos/maintenance";
import { viewDigestOf } from "../digest.js";
import { buildStateIndexes } from "../indexes.js";
import type { ExperienceStateSlice } from "../state.js";
import { defaultRecencyThresholds, type RecencyThresholds } from "../staleness.js";
import { guardView, SCHEMA_VERSION, type ViewResult } from "../view-support.js";

export interface MaintenanceBoardOptions {
  readonly now: number;
  readonly thresholds?: RecencyThresholds;
}

export interface OrderRow {
  readonly orderId: string;
  readonly planId: string;
  readonly assetId: string;
  readonly state: MaintenanceState;
  readonly createdAt: number;
  readonly assignedTo: string | null;
}

export interface PlanRun {
  readonly planId: string;
  readonly assetId: string;
  readonly planKind: ServicePlanKind;
  readonly nextRunAt: number | null;
}

export interface MaintenanceBoard {
  readonly schemaVersion: number;
  readonly tenantId: string;
  readonly asOf: number;
  readonly scheduled: readonly OrderRow[];
  readonly inProgress: readonly OrderRow[];
  readonly completed: readonly OrderRow[];
  readonly cancelled: readonly OrderRow[];
  readonly upcoming: readonly PlanRun[];
  readonly digest: string;
}

function maintenanceBoardDigestOf(board: Omit<MaintenanceBoard, "digest">): string {
  return viewDigestOf("maintenance-board", board);
}

/** Recompute the maintenance-board digest; false means tampered content. */
export function verifyMaintenanceBoardDigest(board: MaintenanceBoard): boolean {
  const { digest, ...rest } = board;
  return maintenanceBoardDigestOf(rest) === digest;
}

function orderRowOf(
  order: {
    readonly id: string;
    readonly planId: string;
    readonly state: MaintenanceState;
    readonly createdAt: number;
    readonly assignedTo?: string;
  },
  assetId: string,
): OrderRow {
  return {
    orderId: order.id,
    planId: order.planId,
    assetId,
    state: order.state,
    createdAt: order.createdAt,
    assignedTo: order.assignedTo ?? null,
  };
}

/** Assemble the maintenance schedule board. */
export function assembleMaintenanceBoard(
  state: ExperienceStateSlice,
  options: MaintenanceBoardOptions,
): ViewResult<MaintenanceBoard> {
  const refused = guardView(state, options.now, options.thresholds ?? defaultRecencyThresholds());
  if (refused) return refused;
  const indexes = buildStateIndexes(state);

  const byOrder = (a: OrderRow, b: OrderRow): number => {
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    return a.orderId < b.orderId ? -1 : 1;
  };
  const scheduled: OrderRow[] = [];
  const inProgress: OrderRow[] = [];
  const completed: OrderRow[] = [];
  const cancelled: OrderRow[] = [];
  for (const order of state.orders) {
    const plan = indexes.planById.get(order.planId);
    if (!plan) continue; // guarded; kept for total determinism
    const row = orderRowOf(order, plan.assetId);
    if (order.state === "scheduled") scheduled.push(row);
    else if (order.state === "in-progress") inProgress.push(row);
    else if (order.state === "completed") completed.push(row);
    else cancelled.push(row);
  }
  scheduled.sort(byOrder);
  inProgress.sort(byOrder);
  completed.sort(byOrder);
  cancelled.sort(byOrder);

  const upcoming: PlanRun[] = [];
  for (const plan of state.plans) {
    upcoming.push({
      planId: plan.id,
      assetId: plan.assetId,
      planKind: plan.kind,
      nextRunAt: nextRun(plan.schedule, options.now),
    });
  }
  upcoming.sort((a, b) => {
    if (a.nextRunAt !== b.nextRunAt) {
      if (a.nextRunAt === null) return 1;
      if (b.nextRunAt === null) return -1;
      return a.nextRunAt - b.nextRunAt;
    }
    return a.planId < b.planId ? -1 : 1;
  });

  const base: Omit<MaintenanceBoard, "digest"> = {
    schemaVersion: SCHEMA_VERSION,
    tenantId: state.tenantId,
    asOf: options.now,
    scheduled,
    inProgress,
    completed,
    cancelled,
    upcoming,
  };
  return { ok: true, view: { ...base, digest: maintenanceBoardDigestOf(base) } };
}
