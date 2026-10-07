/**
 * @fleetos/maintenance — Wave 1 kernel (F210A).
 *
 * Maintenance kernel — deepens the Wave 0 state machine to kernel grade:
 *   - Audit reference emission (structural AuditEventRef) on every
 *     consequential transition (start, complete, cancel).
 *   - Scheduling contracts for maintenance windows — the kernel exposes
 *     `MaintenanceWindow` (start/end with optional recurrence) and a pure
 *     `windowNextRun` that returns the next run within the window from a
 *     given `from` time, returning null when the window is expired.
 *   - A MaintenanceOrderRegistry over a structural port + deterministic
 *     in-memory reference; tenant-scoped reads fail-closed.
 *
 * Pure TypeScript over injected PORT interfaces. No I/O, no servers, no
 * databases. Persistence lands at F211 (TL lane).
 */

import { createHash } from "node:crypto";
import {
  applyMaintenanceCommand,
  createMaintenanceOrder,
  type MaintenanceCommand,
  type MaintenanceOrder,
  type MaintenanceOrderId,
  type MaintenanceRejectionCode,
  type MaintenanceState,
  type ServicePlanId,
  type TenantIdLike,
} from "./maintenance.js";

// ---------------------------------------------------------------------------
// AuditEventRef — structural audit reference (A19).
// ---------------------------------------------------------------------------

export interface AuditEventRef {
  readonly actor: string;
  readonly intent: string;
  readonly tenant: string;
  readonly timestamp: number;
  readonly digest: string;
}

function digestOf(...parts: ReadonlyArray<string | number>): string {
  const text = parts.map((p) => String(p)).join("|");
  return createHash("sha256").update(text).digest("hex");
}

// ---------------------------------------------------------------------------
// Audit-emitting transition wrapper.
// ---------------------------------------------------------------------------

export type MaintenanceKernelResult =
  | {
      readonly ok: true;
      readonly from: MaintenanceState;
      readonly to: MaintenanceState;
      readonly order: MaintenanceOrder;
      readonly audit: AuditEventRef;
    }
  | { readonly ok: false; readonly reason: MaintenanceRejectionCode };

export function applyMaintenanceCommandAudited(
  order: MaintenanceOrder,
  command: MaintenanceCommand,
  ctx: { readonly tenantId: TenantIdLike; readonly actor: string },
): MaintenanceKernelResult {
  const r = applyMaintenanceCommand(order, command);
  if (!r.ok) return r;
  const audit: AuditEventRef = {
    actor: ctx.actor,
    intent: `maintenance:${command.kind}`,
    tenant: ctx.tenantId,
    timestamp: command.initiatedAt,
    digest: digestOf(order.id, command.kind, command.initiatedAt),
  };
  return { ok: true, from: order.state, to: r.order.state, order: r.order, audit };
}

// ---------------------------------------------------------------------------
// MaintenanceWindow — a scheduled window during which a maintenance order
// may be worked on. Windows may be one-time or recurring (intervalMs). The
// kernel exposes `windowNextRun(window, from)` returning the next valid
// run time, or null when the window has expired.
// ---------------------------------------------------------------------------

export type MaintenanceWindow =
  | {
      readonly kind: "one-time";
      readonly startsAt: number;
      readonly endsAt: number;
      readonly reason: string;
    }
  | {
      readonly kind: "recurring";
      readonly startsAt: number;
      readonly endsAt: number; // hard stop (recurring windows expire here)
      readonly intervalMs: number;
      readonly durationMs: number; // length of each run within the recurrence
      readonly reason: string;
    };

export type WindowRejectionCode =
  | "missing-reason"
  | "ends-before-start"
  | "invalid-interval"
  | "invalid-duration";

export type WindowResult =
  | { readonly ok: true; readonly window: MaintenanceWindow; readonly audit: AuditEventRef }
  | { readonly ok: false; readonly reason: WindowRejectionCode };

export function declareMaintenanceWindow(input: {
  readonly tenantId: TenantIdLike;
  readonly kind: "one-time" | "recurring";
  readonly startsAt: number;
  readonly endsAt: number;
  readonly intervalMs?: number;
  readonly durationMs?: number;
  readonly reason: string;
  readonly actor: string;
}): WindowResult {
  if (input.reason === "") return { ok: false, reason: "missing-reason" };
  if (!Number.isFinite(input.startsAt) || !Number.isFinite(input.endsAt) || input.startsAt <= 0) {
    return { ok: false, reason: "ends-before-start" };
  }
  if (input.endsAt <= input.startsAt) return { ok: false, reason: "ends-before-start" };

  let window: MaintenanceWindow;
  if (input.kind === "one-time") {
    window = { kind: "one-time", startsAt: input.startsAt, endsAt: input.endsAt, reason: input.reason };
  } else {
    if (!Number.isFinite(input.intervalMs) || input.intervalMs! <= 0) {
      return { ok: false, reason: "invalid-interval" };
    }
    if (!Number.isFinite(input.durationMs) || input.durationMs! <= 0 || input.durationMs! > input.intervalMs!) {
      return { ok: false, reason: "invalid-duration" };
    }
    window = {
      kind: "recurring",
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      intervalMs: input.intervalMs!,
      durationMs: input.durationMs!,
      reason: input.reason,
    };
  }
  const audit: AuditEventRef = {
    actor: input.actor,
    intent: "maintenance:window:declare",
    tenant: input.tenantId,
    timestamp: input.startsAt,
    digest: digestOf(input.tenantId, "window", input.startsAt, input.endsAt, input.kind),
  };
  return { ok: true, window, audit };
}

export function windowNextRun(window: MaintenanceWindow, from: number): number | null {
  if (from > window.endsAt) return null;
  if (window.kind === "one-time") {
    return from <= window.startsAt ? window.startsAt : null;
  }
  // Recurring: compute next interval boundary >= max(from, startsAt).
  const start = window.startsAt;
  if (from < start) return start;
  const elapsed = from - start;
  const periods = Math.floor(elapsed / window.intervalMs);
  const candidate = start + (periods + 1) * window.intervalMs;
  // The run fits only if candidate + durationMs <= endsAt.
  if (candidate + window.durationMs > window.endsAt) return null;
  return candidate;
}

export function windowContainsAt(window: MaintenanceWindow, at: number): boolean {
  return at >= window.startsAt && at <= window.endsAt;
}

// ---------------------------------------------------------------------------
// MaintenanceOrderRegistryPort — structural seam.
// ---------------------------------------------------------------------------

export interface MaintenanceOrderRegistryPort {
  readonly save: (order: MaintenanceOrder) => void;
  readonly find: (tenantId: TenantIdLike, id: MaintenanceOrderId) => MaintenanceOrder | null;
  readonly listByTenant: (tenantId: TenantIdLike) => ReadonlyArray<MaintenanceOrder>;
  readonly listByPlan: (tenantId: TenantIdLike, planId: ServicePlanId) => ReadonlyArray<MaintenanceOrder>;
}

export class InMemoryMaintenanceOrderRegistry implements MaintenanceOrderRegistryPort {
  private readonly orders = new Map<string, MaintenanceOrder>();
  save(o: MaintenanceOrder): void {
    this.orders.set(`${o.tenantId}:${o.id}`, o);
  }
  find(t: TenantIdLike, id: MaintenanceOrderId): MaintenanceOrder | null {
    return this.orders.get(`${t}:${id}`) ?? null;
  }
  listByTenant(t: TenantIdLike): ReadonlyArray<MaintenanceOrder> {
    const out: MaintenanceOrder[] = [];
    for (const o of this.orders.values()) if (o.tenantId === t) out.push(o);
    return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  listByPlan(t: TenantIdLike, p: ServicePlanId): ReadonlyArray<MaintenanceOrder> {
    const out: MaintenanceOrder[] = [];
    for (const o of this.orders.values()) if (o.tenantId === t && o.planId === p) out.push(o);
    return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
}

// ---------------------------------------------------------------------------
// MaintenanceOrderDirectory — kernel service.
// ---------------------------------------------------------------------------

export type MaintenanceDirectoryRejectionCode =
  | MaintenanceRejectionCode
  | "malformed-order-id"
  | "malformed-plan-id"
  | "missing-tenant-id"
  | "duplicate-order"
  | "unknown-order"
  | "tenant-mismatch";

export type MaintenanceDirectoryResult =
  | { readonly ok: true; readonly order: MaintenanceOrder; readonly audit: AuditEventRef }
  | { readonly ok: false; readonly reason: MaintenanceDirectoryRejectionCode };

const ORDER_ID_RE = /^mo_[A-Za-z0-9_-]{4,128}$/;
const PLAN_ID_RE = /^plan_[A-Za-z0-9_-]{4,128}$/;

export class MaintenanceOrderDirectory {
  constructor(private readonly port: MaintenanceOrderRegistryPort) {}

  createOrder(input: {
    readonly orderId: string;
    readonly tenantId: TenantIdLike;
    readonly planId: string;
    readonly createdAt: number;
    readonly assignedTo?: string;
    readonly actor: string;
  }): MaintenanceDirectoryResult {
    if (!ORDER_ID_RE.test(input.orderId)) return { ok: false, reason: "malformed-order-id" };
    if (!PLAN_ID_RE.test(input.planId)) return { ok: false, reason: "malformed-plan-id" };
    if (input.tenantId === "") return { ok: false, reason: "missing-tenant-id" };
    if (this.port.find(input.tenantId, input.orderId as MaintenanceOrderId)) {
      return { ok: false, reason: "duplicate-order" };
    }
    const order = createMaintenanceOrder({
      id: input.orderId as MaintenanceOrderId,
      tenantId: input.tenantId,
      planId: input.planId as ServicePlanId,
      createdAt: input.createdAt,
      assignedTo: input.assignedTo,
    });
    this.port.save(order);
    const audit: AuditEventRef = {
      actor: input.actor,
      intent: "maintenance:create",
      tenant: input.tenantId,
      timestamp: input.createdAt,
      digest: digestOf(input.orderId, "create", input.createdAt),
    };
    return { ok: true, order, audit };
  }

  transition(input: {
    readonly tenantId: TenantIdLike;
    readonly orderId: MaintenanceOrderId;
    readonly command: MaintenanceCommand;
    readonly actor: string;
  }): MaintenanceDirectoryResult {
    const order = this.port.find(input.tenantId, input.orderId);
    if (!order) return { ok: false, reason: "unknown-order" };
    if (order.tenantId !== input.tenantId) return { ok: false, reason: "tenant-mismatch" };
    const r = applyMaintenanceCommandAudited(order, input.command, { tenantId: input.tenantId, actor: input.actor });
    if (!r.ok) return r;
    this.port.save(r.order);
    return { ok: true, order: r.order, audit: r.audit };
  }

  lookup(tenantId: TenantIdLike, id: MaintenanceOrderId): MaintenanceOrder | null {
    return this.port.find(tenantId, id);
  }

  listByTenant(tenantId: TenantIdLike): ReadonlyArray<MaintenanceOrder> {
    return this.port.listByTenant(tenantId);
  }

  listByPlan(tenantId: TenantIdLike, planId: ServicePlanId): ReadonlyArray<MaintenanceOrder> {
    return this.port.listByPlan(tenantId, planId);
  }
}
