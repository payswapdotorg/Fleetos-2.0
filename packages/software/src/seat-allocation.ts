/**
 * @fleetos/software — Seat-overage refusal semantics at batch grade:
 * allocation batches are ALL-OR-NOTHING — any request that would push
 * the subscription over its seat limit refuses the ENTIRE batch with
 * reason codes and the exact numbers (capacity, held, requested,
 * overshoot, first refused request). Over-allocation never silently
 * overbooks: no partial state is ever produced.
 *
 * Wave 8 lane C (F280C) production-economics grade.
 *
 * Laws: A4 (refuse with exact overshoot, never clamp, never partially
 * apply), A8 (tenant-scoped, fail-closed), A19, A20.
 *
 * ALLOCATION LAW (documented, machine-tested):
 *   - Requests are processed in requestId LEXICAL order (deterministic).
 *   - The cumulative running total starts at countHeldSeats (REAL grant
 *     population) and adds each request's seats. The FIRST request whose
 *     cumulative total exceeds seatsTotal refuses the whole batch — the
 *     refusal carries the exact numbers and the first refused requestId.
 *   - Expiry: allocation is allowed while now <= validUntil + graceMs
 *     (the renewal window keeps allocation open for renewals — the SAME
 *     grace law as renewal-windows.ts); after that SUBSCRIPTION_EXPIRED.
 *   - Success returns the allocation DECISION (deterministic steps);
 *     grant construction stays with the caller — this function cannot
 *     partially mutate a grant population because it applies nothing.
 */

import type { Subscription, TenantScope } from "./contracts.js";
import { validateTenantScope } from "./contracts.js";
import type { EntitlementGrant } from "./entitlement-grants.js";
import { countHeldSeats } from "./entitlement-grants.js";

// ---------------------------------------------------------------------------
// Batch seat allocation.
// ---------------------------------------------------------------------------

export interface SeatAllocationRequest {
  readonly requestId: string;
  /** Positive integer seats. */
  readonly seats: number;
}

export interface SeatAllocationStep {
  readonly requestId: string;
  readonly seats: number;
  /** Held seats AFTER this step (running total, deterministic order). */
  readonly heldAfterStep: number;
}

export type SeatAllocationResult =
  | {
      readonly ok: true;
      readonly subscriptionId: string;
      readonly heldBefore: number;
      readonly heldAfter: number;
      readonly allocations: readonly SeatAllocationStep[];
    }
  | {
      readonly ok: false;
      readonly reasonCode: SeatAllocationReasonCode;
      readonly capacitySeats: number;
      readonly heldBefore: number;
      readonly requestedTotal: number;
      /** Exact overshoot — never clamped (law A4). */
      readonly overshootSeats: number;
      readonly firstRefusedRequestId: string | null;
    };

export type SeatAllocationReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "TENANT_MISMATCH"
  | "SUBSCRIPTION_NOT_ACTIVE"
  | "SUBSCRIPTION_EXPIRED"
  | "REQUEST_ID_EMPTY"
  | "REQUEST_ID_DUPLICATE"
  | "INVALID_SEATS"
  | "SEAT_LIMIT_EXCEEDED";

/**
 * allocateSeatsBatch — all-or-nothing batch seat allocation with
 * seat-overage refusal semantics. Over-allocation REFUSES the entire
 * batch (reason codes + exact numbers); nothing is ever silently
 * overbooked because the function applies no state — it decides.
 */
export function allocateSeatsBatch(
  tenant: TenantScope,
  subscription: Subscription,
  grants: readonly EntitlementGrant[],
  requests: readonly SeatAllocationRequest[],
  now: number,
  graceMs = 0,
): SeatAllocationResult {
  const fail = (
    reasonCode: SeatAllocationReasonCode,
    heldBefore: number,
    requestedTotal: number,
    firstRefusedRequestId: string | null,
  ): SeatAllocationResult => ({
    ok: false,
    reasonCode,
    capacitySeats: subscription.seatsTotal,
    heldBefore,
    requestedTotal,
    overshootSeats: Math.max(0, heldBefore + requestedTotal - subscription.seatsTotal),
    firstRefusedRequestId,
  });
  const tenantCheck = validateTenantScope(tenant);
  if (!tenantCheck.ok) {
    return fail("TENANT_SCOPE_MISSING", 0, 0, null);
  }
  const subTenant = validateTenantScope(subscription.tenant);
  if (!subTenant.ok) {
    return fail("TENANT_SCOPE_MISSING", 0, 0, null);
  }
  if (subTenant.scope.tenantId !== tenantCheck.scope.tenantId) {
    return fail("TENANT_MISMATCH", 0, 0, null);
  }
  if (subscription.status !== "active") {
    return fail("SUBSCRIPTION_NOT_ACTIVE", 0, 0, null);
  }
  if (subscription.validUntil !== null) {
    const validUntilMs = Date.parse(subscription.validUntil);
    if (!Number.isNaN(validUntilMs) && now > validUntilMs + graceMs) {
      return fail("SUBSCRIPTION_EXPIRED", 0, 0, null);
    }
  }
  const seen = new Set<string>();
  let requestedTotal = 0;
  for (const request of requests) {
    if (request.requestId.length === 0) {
      return fail("REQUEST_ID_EMPTY", 0, requestedTotal, request.requestId);
    }
    if (seen.has(request.requestId)) {
      return fail("REQUEST_ID_DUPLICATE", 0, requestedTotal, request.requestId);
    }
    seen.add(request.requestId);
    if (!Number.isInteger(request.seats) || request.seats <= 0) {
      return fail("INVALID_SEATS", 0, requestedTotal, request.requestId);
    }
    requestedTotal += request.seats;
  }
  for (const grant of grants) {
    const grantTenant = validateTenantScope(grant.tenant);
    if (!grantTenant.ok) {
      return fail("TENANT_SCOPE_MISSING", countHeldSeats(subscriptionIdOf(subscription), grants), requestedTotal, null);
    }
    if (grantTenant.scope.tenantId !== tenantCheck.scope.tenantId) {
      return fail("TENANT_MISMATCH", 0, requestedTotal, null);
    }
  }
  const subscriptionId = subscriptionIdOf(subscription);
  const heldBefore = countHeldSeats(subscriptionId, grants);
  // Deterministic processing order: requestId lexical.
  const ordered = [...requests].sort((a, b) => a.requestId.localeCompare(b.requestId));
  const allocations: SeatAllocationStep[] = [];
  let running = heldBefore;
  for (const request of ordered) {
    const next = running + request.seats;
    if (next > subscription.seatsTotal) {
      // ALL-OR-NOTHING: the whole batch refuses at the first overage.
      return fail("SEAT_LIMIT_EXCEEDED", heldBefore, requestedTotal, request.requestId);
    }
    running = next;
    allocations.push({ requestId: request.requestId, seats: request.seats, heldAfterStep: running });
  }
  return {
    ok: true,
    subscriptionId,
    heldBefore,
    heldAfter: running,
    allocations,
  };
}

function subscriptionIdOf(subscription: Subscription): string {
  return subscription.id.kind === "subscription" ? subscription.id.value : "";
}
