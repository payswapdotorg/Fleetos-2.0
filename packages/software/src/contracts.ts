/**
 * @fleetos/software — Software bounded context public contracts.
 *
 * Wave 1 lane C (F210C) kernel-grade.
 *
 * Laws: A1, A4 (refuse over-allocation, never clamp), A8 (tenant-scoped,
 * fail-closed), A19 (audit), A20.
 *
 * Wave 1 kernel-grade additions over Wave 0 (F200C):
 *   - allocation/revocation with over-allocation refusal;
 *   - expiry sweep contracts (deterministic from timestamps);
 *   - compliance read models;
 *   - SoftwareDirectory over SoftwareRepositoryPort + in-memory reference.
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
// Subscriptions, entitlements, allocations.
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
  readonly revokedAt: string | null;
  readonly revokedReason: string | null;
}

export interface AllocationRequest {
  readonly tenant: TenantScope;
  readonly subscriptionId: SubscriptionId;
  readonly requestedSeats: number;
}

// ---------------------------------------------------------------------------
// Pure entitlement check — over-allocation REFUSED with the exact
// overshoot, never silently clamped (law A4).
// ---------------------------------------------------------------------------

export type EntitlementCheckResult =
  | {
      readonly ok: true;
      readonly remainingSeats: number;
      readonly utilizationRatio: number;
    }
  | { readonly ok: false; readonly reasonCode: EntitlementReasonCode; readonly overshootSeats: number };

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
      e.revokedAt === null &&
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

// ---------------------------------------------------------------------------
// Expiry sweep — deterministic from timestamps. Pure: returns the set of
// subscriptions that are expired as of `now`. Does NOT mutate inputs.
// ---------------------------------------------------------------------------

export interface ExpirySweepResult {
  readonly tenant: TenantScope;
  readonly expiredSubscriptionIds: readonly string[];
  readonly sweptAt: string;
}

export function sweepExpiredSubscriptions(
  tenant: TenantScope,
  subscriptions: readonly Subscription[],
  now: string,
): ExpirySweepResult {
  const tenantCheck = validateTenantScope(tenant);
  if (!tenantCheck.ok) {
    return {
      tenant: { tenantId: "" },
      expiredSubscriptionIds: [],
      sweptAt: now,
    };
  }
  const nowMs = Date.parse(now);
  if (Number.isNaN(nowMs)) {
    return {
      tenant: tenantCheck.scope,
      expiredSubscriptionIds: [],
      sweptAt: now,
    };
  }
  const expired: string[] = [];
  for (const s of subscriptions) {
    const tc = validateTenantScope(s.tenant);
    if (!tc.ok) continue;
    if (tc.scope.tenantId !== tenantCheck.scope.tenantId) continue;
    if (s.status !== "active") continue;
    if (s.validUntil === null) continue;
    const untilMs = Date.parse(s.validUntil);
    if (Number.isNaN(untilMs)) continue;
    if (untilMs < nowMs) {
      expired.push(s.id.value);
    }
  }
  expired.sort();
  return {
    tenant: tenantCheck.scope,
    expiredSubscriptionIds: expired,
    sweptAt: now,
  };
}

// ---------------------------------------------------------------------------
// Compliance read model — pure projection of subscription + entitlement
// state. Honest: reports over-allocation explicitly.
// ---------------------------------------------------------------------------

export interface SubscriptionCompliance {
  readonly subscriptionId: string;
  readonly tenant: TenantScope;
  readonly seatsTotal: number;
  readonly seatsAllocated: number;
  readonly seatsOverAllocated: number;
  readonly utilizationRatio: number;
  readonly status: SubscriptionStatus;
  readonly expired: boolean;
}

export function computeSubscriptionCompliance(
  subscription: Subscription,
  entitlements: readonly Entitlement[],
  now: string,
): SubscriptionCompliance {
  const tenantCheck = validateTenantScope(subscription.tenant);
  if (!tenantCheck.ok) {
    return {
      subscriptionId: subscription.id.value,
      tenant: { tenantId: "" },
      seatsTotal: 0,
      seatsAllocated: 0,
      seatsOverAllocated: 0,
      utilizationRatio: 0,
      status: subscription.status,
      expired: false,
    };
  }
  const allocated = entitlements.filter(
    (e) =>
      e.revokedAt === null &&
      e.subscriptionId.kind === subscription.id.kind &&
      e.subscriptionId.value === subscription.id.value,
  ).length;
  const seatsOverAllocated = Math.max(0, allocated - subscription.seatsTotal);
  const utilizationRatio =
    subscription.seatsTotal === 0 ? 0 : allocated / subscription.seatsTotal;
  const nowMs = Date.parse(now);
  const untilMs = subscription.validUntil ? Date.parse(subscription.validUntil) : NaN;
  const expired =
    subscription.status === "expired" ||
    (!Number.isNaN(nowMs) && !Number.isNaN(untilMs) && untilMs < nowMs);
  return {
    subscriptionId: subscription.id.value,
    tenant: tenantCheck.scope,
    seatsTotal: subscription.seatsTotal,
    seatsAllocated: allocated,
    seatsOverAllocated,
    utilizationRatio,
    status: subscription.status,
    expired,
  };
}
