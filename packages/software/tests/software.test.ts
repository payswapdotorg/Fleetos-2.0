import { describe, expect, it } from "vitest";
import {
  checkEntitlement,
  validateTenantScope,
  type TenantScope,
  type Subscription,
  type Entitlement,
  type AllocationRequest,
  type SubscriptionId,
} from "../src/index.js";

const TENANT: TenantScope = { tenantId: "acme" };
const SUB_ID: SubscriptionId = { kind: "subscription", value: "s-1" };

function subscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: SUB_ID,
    tenant: TENANT,
    sku: "fleet-pro",
    seatsTotal: 10,
    status: "active",
    validFrom: "2026-01-01",
    validUntil: null,
    ...overrides,
  };
}

function entitlement(overrides: Partial<Entitlement> = {}): Entitlement {
  return {
    id: { kind: "entitlement", value: "e-1" },
    tenant: TENANT,
    subscriptionId: SUB_ID,
    assigneeId: "u-1",
    ...overrides,
  };
}

function request(overrides: Partial<AllocationRequest> = {}): AllocationRequest {
  return {
    tenant: TENANT,
    subscriptionId: SUB_ID,
    requestedSeats: 2,
    ...overrides,
  };
}

describe("validateTenantScope", () => {
  it("accepts a valid tenant id", () => {
    expect(validateTenantScope({ tenantId: "acme" })).toEqual({
      ok: true,
      scope: { tenantId: "acme" },
    });
  });

  it("refuses a null scope with TENANT_SCOPE_MISSING", () => {
    expect(validateTenantScope(null)).toEqual({
      ok: false,
      reasonCode: "TENANT_SCOPE_MISSING",
    });
  });
});

describe("checkEntitlement — honest acceptance", () => {
  it("accepts a request that fits within remaining seats", () => {
    const r = checkEntitlement(subscription(), [], request());
    expect(r).toEqual({ ok: true, remainingSeats: 8, utilizationRatio: 0.2 });
  });

  it("accepts a request that exactly saturates capacity", () => {
    const r = checkEntitlement(
      subscription({ seatsTotal: 5 }),
      [
        entitlement(),
        entitlement({ id: { kind: "entitlement", value: "e-2" } }),
        entitlement({ id: { kind: "entitlement", value: "e-3" } }),
      ],
      request({ requestedSeats: 2 }),
    );
    expect(r).toEqual({ ok: true, remainingSeats: 0, utilizationRatio: 1 });
  });
});

describe("checkEntitlement — over-allocation refused, never clamped", () => {
  it("refuses with OVER_ALLOCATION and the exact overshoot", () => {
    const r = checkEntitlement(
      subscription({ seatsTotal: 3 }),
      [
        entitlement(),
        entitlement({ id: { kind: "entitlement", value: "e-2" } }),
      ],
      request({ requestedSeats: 5 }),
    );
    expect(r).toEqual({
      ok: false,
      reasonCode: "OVER_ALLOCATION",
      overshootSeats: 4,
    });
  });

  it("refuses negative requests with NEGATIVE_REQUEST", () => {
    const r = checkEntitlement(subscription(), [], request({ requestedSeats: -1 }));
    expect(r).toEqual({
      ok: false,
      reasonCode: "NEGATIVE_REQUEST",
      overshootSeats: 0,
    });
  });

  it("refuses when subscription is not active with SUBSCRIPTION_NOT_ACTIVE", () => {
    const r = checkEntitlement(subscription({ status: "expired" }), [], request());
    expect(r).toEqual({
      ok: false,
      reasonCode: "SUBSCRIPTION_NOT_ACTIVE",
      overshootSeats: 0,
    });
  });

  it("refuses when subscription id does not match with SUBSCRIPTION_MISMATCH", () => {
    const r = checkEntitlement(subscription(), [], request({
      subscriptionId: { kind: "subscription", value: "s-other" },
    }));
    expect(r).toEqual({
      ok: false,
      reasonCode: "SUBSCRIPTION_MISMATCH",
      overshootSeats: 0,
    });
  });
});

describe("checkEntitlement — tenant fail-closed", () => {
  it("refuses with TENANT_SCOPE_MISSING when subscription tenant is broken", () => {
    const r = checkEntitlement(
      subscription({ tenant: { tenantId: "" } as unknown as TenantScope }),
      [],
      request(),
    );
    expect(r).toEqual({
      ok: false,
      reasonCode: "TENANT_SCOPE_MISSING",
      overshootSeats: 0,
    });
  });

  it("refuses with TENANT_MISMATCH when tenants differ across inputs", () => {
    const r = checkEntitlement(
      subscription({ tenant: { tenantId: "acme" } }),
      [],
      request({ tenant: { tenantId: "globex" } as unknown as TenantScope }),
    );
    expect(r).toEqual({
      ok: false,
      reasonCode: "TENANT_MISMATCH",
      overshootSeats: 0,
    });
  });
});

describe("checkEntitlement — determinism", () => {
  it("returns the same result for the same inputs across calls", () => {
    const a = checkEntitlement(subscription(), [entitlement()], request());
    const b = checkEntitlement(subscription(), [entitlement()], request());
    expect(a).toEqual(b);
  });
});
