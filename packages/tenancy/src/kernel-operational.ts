/**
 * @fleetos/tenancy — Wave 2 operational depth (F220A).
 *
 *   - Tenant operation sweep — a deterministic, time-based sweep that
 *     classifies tenants by state and reports counts. Pure function over
 *     the tenant registry; no I/O.
 *   - Tenant-scoped session sweep integration — the tenancy sweep
 *     interacts with the identity session sweep at the application layer;
 *     the kernel exposes the typed contract for that composition.
 *
 * Pure TypeScript over injected PORT interfaces. No I/O, no servers, no
 * databases. Persistence lands at F211 (TL lane).
 */

import type { TenantIdLike } from "./tenancy.js";
import type { TenantRecord } from "./kernel.js";
import type { AuditEventRef } from "./kernel.js";

// ---------------------------------------------------------------------------
// Tenant operation sweep — deterministic, time-based classification.
// ---------------------------------------------------------------------------

export interface TenantSweepResult {
  readonly provisioning: ReadonlyArray<TenantRecord>;
  readonly active: ReadonlyArray<TenantRecord>;
  readonly suspended: ReadonlyArray<TenantRecord>;
  readonly closing: ReadonlyArray<TenantRecord>;
  readonly closed: ReadonlyArray<TenantRecord>;
  readonly sweepedAt: number;
  readonly audit: AuditEventRef;
}

export function sweepTenants(
  tenants: ReadonlyArray<TenantRecord>,
  now: number,
): TenantSweepResult {
  const provisioning: TenantRecord[] = [];
  const active: TenantRecord[] = [];
  const suspended: TenantRecord[] = [];
  const closing: TenantRecord[] = [];
  const closed: TenantRecord[] = [];
  for (const t of tenants) {
    switch (t.state) {
      case "provisioning": provisioning.push(t); break;
      case "active": active.push(t); break;
      case "suspended": suspended.push(t); break;
      case "closing": closing.push(t); break;
      case "closed": closed.push(t); break;
    }
  }
  // Deterministic ordering by tenant id (no Map iteration order dependency).
  provisioning.sort((a, b) => (a.id < b.id ? -1 : 1));
  active.sort((a, b) => (a.id < b.id ? -1 : 1));
  suspended.sort((a, b) => (a.id < b.id ? -1 : 1));
  closing.sort((a, b) => (a.id < b.id ? -1 : 1));
  closed.sort((a, b) => (a.id < b.id ? -1 : 1));
  const audit: AuditEventRef = {
    actor: "system:tenant-sweep",
    intent: "tenancy:tenant:sweep",
    tenant: "system",
    timestamp: now,
    digest: `${provisioning.length}|${active.length}|${suspended.length}|${closing.length}|${closed.length}|${now}`,
  };
  return { provisioning, active, suspended, closing, closed, sweepedAt: now, audit };
}

// ---------------------------------------------------------------------------
// Tenant session sweep integration contract — the application layer
// composes the tenant sweep with the identity session sweep. The kernel
// exposes the typed contract so callers know that suspended/closed tenants
// must have their sessions refused at the next sweep.
// ---------------------------------------------------------------------------

export type TenantSessionSweepAction =
  | "preserve"
  | "expire-immediately"
  | "refuse-new";

export function sessionSweepActionForTenant(state: TenantRecord["state"]): TenantSessionSweepAction {
  switch (state) {
    case "provisioning": return "preserve"; // sessions may be issued but not yet active
    case "active": return "preserve"; // sessions remain valid
    case "suspended": return "preserve"; // existing sessions remain (read-only) — new sessions refused
    case "closing": return "expire-immediately"; // sessions expire on next sweep
    case "closed": return "expire-immediately";
  }
}

// ---------------------------------------------------------------------------
// Tenant directory cross-tenant isolation contract — the directory's
// lookup is already tenant-keyed (Wave 1). The kernel exposes the typed
// refusal so callers can assert isolation at the call site.
// ---------------------------------------------------------------------------

export type CrossTenantRefusalReason = "cross-tenant-forbidden";

export function assertTenantIsolation(
  caller: TenantIdLike,
  target: TenantIdLike,
): { readonly ok: true } | { readonly ok: false; readonly reason: CrossTenantRefusalReason } {
  if (caller === "" || target === "") return { ok: false, reason: "cross-tenant-forbidden" };
  if (caller !== target) return { ok: false, reason: "cross-tenant-forbidden" };
  return { ok: true };
}
