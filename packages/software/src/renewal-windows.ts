/**
 * @fleetos/software — Renewal windows: deterministic expiry sweeps with
 * DOCUMENTED grace semantics, plus seat-utilization projections (the
 * software-side production-economics surface — projected overage is
 * reported exactly, never clamped).
 *
 * Wave 8 lane C (F280C) production-economics grade.
 *
 * Laws: A4 (overage/overshoot reported exactly), A8 (tenant-scoped,
 * fail-closed), A19 (sweptAt is caller-supplied logical time), A20.
 *
 * RENEWAL-WINDOW LAW (documented, boundary-tested):
 *   - A subscription with validUntil V (parsed as epoch ms) is:
 *       active    while now <= V;
 *       inGrace   while V < now <= V + graceMs;
 *       expired   while now > V + graceMs.
 *     This aligns with sweepExpiredSubscriptions (expiry is strictly
 *     AFTER validUntil); the grace window (V, V + graceMs] is the
 *     renewal window — inside it a renewal can still be executed.
 *   - validUntil null means no end date: active forever.
 *   - A subscription whose own status is not "active" (cancelled or
 *     already expired) is reported "expired" — it is not renewable.
 *   - Output ordering: subscriptionId lexical (input order never leaks).
 *   - Fail-closed (F280C hardening): a foreign-tenant subscription in
 *     the input REFUSES the sweep — never silently filtered.
 *
 * SEAT-PROJECTION LAW (documented): projectedHeld = heldNow + Σ planned
 * seats; overage = max(0, projectedHeld - seatsTotal) is reported
 * exactly; utilization is floor(projectedHeld * 10000 / seatsTotal).
 * Every planned point MUST carry a non-empty assumption — projections
 * without stated uncertainty are refused.
 */

import type { Subscription, TenantScope } from "./contracts.js";
import { validateTenantScope } from "./contracts.js";
import type { EntitlementGrant } from "./entitlement-grants.js";
import { countHeldSeats } from "./entitlement-grants.js";

// ---------------------------------------------------------------------------
// Renewal windows.
// ---------------------------------------------------------------------------

export type RenewalWindowStatus = "active" | "inGrace" | "expired";

export interface RenewalWindow {
  readonly subscriptionId: string;
  /** validUntil verbatim from the subscription (null = no end date). */
  readonly validUntil: string | null;
  /** Epoch ms of the grace window's end; null when no end date. */
  readonly graceEndsAtMs: number | null;
  readonly status: RenewalWindowStatus;
}

export interface RenewalSweepReport {
  readonly tenant: TenantScope;
  readonly graceMs: number;
  /** Caller-supplied logical sweep time. */
  readonly sweptAt: number;
  readonly windows: readonly RenewalWindow[];
  readonly activeCount: number;
  readonly inGraceCount: number;
  readonly expiredCount: number;
  readonly ordering: "subscription-id-lexical";
}

export type RenewalSweepResult =
  | { readonly ok: true; readonly report: RenewalSweepReport }
  | { readonly ok: false; readonly reasonCode: RenewalSweepReasonCode };

export type RenewalSweepReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "TENANT_MISMATCH"
  | "INVALID_GRACE_MS"
  | "INVALID_VALID_UNTIL";

/**
 * sweepRenewalWindows — deterministic renewal-window sweep with the
 * documented grace law (see module header). Pure: no input is mutated.
 */
export function sweepRenewalWindows(
  tenant: TenantScope,
  subscriptions: readonly Subscription[],
  graceMs: number,
  now: number,
): RenewalSweepResult {
  const tenantCheck = validateTenantScope(tenant);
  if (!tenantCheck.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  if (!Number.isInteger(graceMs) || graceMs < 0) {
    return { ok: false, reasonCode: "INVALID_GRACE_MS" };
  }
  const windows: RenewalWindow[] = [];
  let activeCount = 0;
  let inGraceCount = 0;
  let expiredCount = 0;
  const ordered = [...subscriptions].sort((a, b) => a.id.value.localeCompare(b.id.value));
  for (const subscription of ordered) {
    const subTenant = validateTenantScope(subscription.tenant);
    if (!subTenant.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
    if (subTenant.scope.tenantId !== tenantCheck.scope.tenantId) {
      return { ok: false, reasonCode: "TENANT_MISMATCH" };
    }
    let status: RenewalWindowStatus;
    let graceEndsAtMs: number | null = null;
    if (subscription.status !== "active") {
      status = "expired";
    } else if (subscription.validUntil === null) {
      status = "active";
    } else {
      const validUntilMs = Date.parse(subscription.validUntil);
      if (Number.isNaN(validUntilMs)) {
        // An unparseable date can never honestly place the subscription
        // in a window — refusing the whole sweep keeps the read model
        // honest (never a guessed classification).
        return { ok: false, reasonCode: "INVALID_VALID_UNTIL" };
      }
      graceEndsAtMs = validUntilMs + graceMs;
      if (now <= validUntilMs) {
        status = "active";
      } else if (now <= graceEndsAtMs) {
        status = "inGrace";
      } else {
        status = "expired";
      }
    }
    if (status === "active") activeCount += 1;
    else if (status === "inGrace") inGraceCount += 1;
    else expiredCount += 1;
    windows.push({
      subscriptionId: subscription.id.value,
      validUntil: subscription.validUntil,
      graceEndsAtMs,
      status,
    });
  }
  return {
    ok: true,
    report: {
      tenant: tenantCheck.scope,
      graceMs,
      sweptAt: now,
      windows,
      activeCount,
      inGraceCount,
      expiredCount,
      ordering: "subscription-id-lexical",
    },
  };
}

// ---------------------------------------------------------------------------
// Seat-utilization projection (software-side production economics).
// ---------------------------------------------------------------------------

export interface PlannedSeatAssignment {
  readonly requestId: string;
  readonly seats: number;
  /** REQUIRED non-empty assumption — the uncertainty statement. */
  readonly assumption: string;
}

export interface SeatUtilizationProjection {
  readonly subscriptionId: string;
  readonly tenant: TenantScope;
  readonly seatsTotal: number;
  readonly heldSeatsNow: number;
  readonly plannedSeats: number;
  readonly projectedHeldSeats: number;
  /** floor(projectedHeld * 10000 / seatsTotal). */
  readonly utilizationBps: number;
  /** max(0, projectedHeld - seatsTotal) — exact, never clamped. */
  readonly overageSeats: number;
  readonly projection: true;
  /** Every assumption verbatim, in plan order. */
  readonly assumptions: readonly string[];
}

export type SeatProjectionResult =
  | { readonly ok: true; readonly projection: SeatUtilizationProjection }
  | { readonly ok: false; readonly reasonCode: SeatProjectionReasonCode };

export type SeatProjectionReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "TENANT_MISMATCH"
  | "SUBSCRIPTION_NOT_ACTIVE"
  | "REQUEST_ID_EMPTY"
  | "REQUEST_ID_DUPLICATE"
  | "INVALID_SEATS"
  | "ASSUMPTION_EMPTY";

/**
 * projectSeatUtilization — deterministic seat-burn projection: seats
 * held now (REAL grant population) plus planned assignments, with the
 * projected overage reported exactly (never clamped) and every
 * assumption carried verbatim. Refuses a non-active subscription —
 * projections are for live planning, not dead subscriptions.
 */
export function projectSeatUtilization(
  tenant: TenantScope,
  subscription: Subscription,
  grants: readonly EntitlementGrant[],
  planned: readonly PlannedSeatAssignment[],
): SeatProjectionResult {
  const tenantCheck = validateTenantScope(tenant);
  if (!tenantCheck.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  const subTenant = validateTenantScope(subscription.tenant);
  if (!subTenant.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  if (subTenant.scope.tenantId !== tenantCheck.scope.tenantId) {
    return { ok: false, reasonCode: "TENANT_MISMATCH" };
  }
  if (subscription.status !== "active") {
    return { ok: false, reasonCode: "SUBSCRIPTION_NOT_ACTIVE" };
  }
  const seen = new Set<string>();
  for (const request of planned) {
    if (request.requestId.length === 0) {
      return { ok: false, reasonCode: "REQUEST_ID_EMPTY" };
    }
    if (seen.has(request.requestId)) {
      return { ok: false, reasonCode: "REQUEST_ID_DUPLICATE" };
    }
    seen.add(request.requestId);
    if (!Number.isInteger(request.seats) || request.seats <= 0) {
      return { ok: false, reasonCode: "INVALID_SEATS" };
    }
    if (request.assumption.trim().length === 0) {
      return { ok: false, reasonCode: "ASSUMPTION_EMPTY" };
    }
  }
  for (const grant of grants) {
    const grantTenant = validateTenantScope(grant.tenant);
    if (!grantTenant.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
    if (grantTenant.scope.tenantId !== tenantCheck.scope.tenantId) {
      return { ok: false, reasonCode: "TENANT_MISMATCH" };
    }
  }
  const subscriptionId =
    subscription.id.kind === "subscription" ? subscription.id.value : "";
  const heldSeatsNow = countHeldSeats(subscriptionId, grants);
  const plannedSeats = planned.reduce((acc, r) => acc + r.seats, 0);
  const projectedHeldSeats = heldSeatsNow + plannedSeats;
  const utilizationBps =
    subscription.seatsTotal === 0
      ? projectedHeldSeats > 0 ? 10000 : 0
      : Math.floor((projectedHeldSeats * 10000) / subscription.seatsTotal);
  return {
    ok: true,
    projection: {
      subscriptionId,
      tenant: tenantCheck.scope,
      seatsTotal: subscription.seatsTotal,
      heldSeatsNow,
      plannedSeats,
      projectedHeldSeats,
      utilizationBps,
      overageSeats: Math.max(0, projectedHeldSeats - subscription.seatsTotal),
      projection: true,
      assumptions: planned.map((r) => r.assumption),
    },
  };
}
