/**
 * @fleetos/software — Software bounded context public contracts.
 *
 * Wave 0 lane C (F200C). Pure TypeScript domain package.
 *
 * Laws: A1, A4 (refuse over-allocation, never clamp), A8 (tenant-scoped,
 * fail-closed), A20 (no cross-boundary imports).
 */

export interface TenantScope {
  readonly tenantId: string;
}

export type TenantValidation =
  | { ok: true; scope: TenantScope }
  | { ok: false; reasonCode: TenantReasonCode };

export type TenantReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "TENANT_ID_EMPTY"
  | "TENANT_ID_TOO_LONG"
  | "TENANT_ID_INVALID_CHARS";

const TENANT_PATTERN = /^[A-Za-z0-9_-]+$/;

export function validateTenantScope(scope: unknown): TenantValidation {
  if (scope === null || typeof scope !== "object") {
    return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  }
  const candidate = scope as Record<string, unknown>;
  const tenantId = candidate["tenantId"];
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    return { ok: false, reasonCode: "TENANT_ID_EMPTY" };
  }
  if (tenantId.length > 128) {
    return { ok: false, reasonCode: "TENANT_ID_TOO_LONG" };
  }
  if (!TENANT_PATTERN.test(tenantId)) {
    return { ok: false, reasonCode: "TENANT_ID_INVALID_CHARS" };
  }
  return { ok: true, scope: { tenantId } };
}

// ---------------------------------------------------------------------------
// Software subscriptions, entitlements, allocations.
// ---------------------------------------------------------------------------

export interface SubscriptionId {
  readonly kind: "subscription";
  readonly value: string;
}

export type SubscriptionStatus = "active" | "expired" | "cancelled";

export interface Subscription {
  readonly id: SubscriptionId;
  readonly tenant: TenantScope;
  readonly sku: string;
  readonly seatsTotal: number;
  readonly status: SubscriptionStatus;
  readonly validFrom: string;
  readonly validUntil: string | null;
}

export interface EntitlementId {
  readonly kind: "entitlement";
  readonly value: string;
}

export interface Entitlement {
  readonly id: EntitlementId;
  readonly tenant: TenantScope;
  readonly subscriptionId: SubscriptionId;
  readonly assigneeId: string;
}

export interface AllocationRequest {
  readonly tenant: TenantScope;
  readonly subscriptionId: SubscriptionId;
  readonly requestedSeats: number;
}

// ---------------------------------------------------------------------------
// Pure entitlement check — tenant-scoped, fail-closed. Over-allocation is
// REFUSED with the exact overshoot, never silently clamped (law A4).
// ---------------------------------------------------------------------------

export type EntitlementCheckResult =
  | {
      ok: true;
      remainingSeats: number;
      utilizationRatio: number;
    }
  | { ok: false; reasonCode: EntitlementReasonCode; overshootSeats: number };

export type EntitlementReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "TENANT_MISMATCH"
  | "SUBSCRIPTION_MISMATCH"
  | "SUBSCRIPTION_NOT_ACTIVE"
  | "NEGATIVE_REQUEST"
  | "OVER_ALLOCATION";

export function checkEntitlement(
  subscription: Subscription,
  currentAllocations: readonly Entitlement[],
  request: AllocationRequest,
): EntitlementCheckResult {
  const tenantSub = validateTenantScope(subscription.tenant);
  if (!tenantSub.ok) return fail("TENANT_SCOPE_MISSING", 0);
  const tenantReq = validateTenantScope(request.tenant);
  if (!tenantReq.ok) return fail("TENANT_SCOPE_MISSING", 0);

  if (tenantSub.scope.tenantId !== tenantReq.scope.tenantId) {
    return fail("TENANT_MISMATCH", 0);
  }

  if (
    subscription.id.kind !== request.subscriptionId.kind ||
    subscription.id.value !== request.subscriptionId.value
  ) {
    return fail("SUBSCRIPTION_MISMATCH", 0);
  }

  if (subscription.status !== "active") {
    return fail("SUBSCRIPTION_NOT_ACTIVE", 0);
  }

  if (request.requestedSeats < 0) {
    return fail("NEGATIVE_REQUEST", 0);
  }

  const allocatedForThisSubscription = currentAllocations.filter(
    (e) =>
      e.subscriptionId.kind === subscription.id.kind &&
      e.subscriptionId.value === subscription.id.value,
  ).length;

  const totalAfterRequest =
    allocatedForThisSubscription + request.requestedSeats;

  if (totalAfterRequest > subscription.seatsTotal) {
    return fail(
      "OVER_ALLOCATION",
      totalAfterRequest - subscription.seatsTotal,
    );
  }

  const remainingSeats = subscription.seatsTotal - totalAfterRequest;
  const utilizationRatio =
    subscription.seatsTotal === 0
      ? 0
      : totalAfterRequest / subscription.seatsTotal;
  return { ok: true, remainingSeats, utilizationRatio };
}

function fail(
  reasonCode: EntitlementReasonCode,
  overshootSeats: number,
): EntitlementCheckResult {
  return { ok: false, reasonCode, overshootSeats };
}
