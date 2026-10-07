/**
 * @fleetos/software — Wave 1 kernel-grade tests.
 */
import { describe, expect, it } from "vitest";
import {
  checkEntitlement,
  sweepExpiredSubscriptions,
  computeSubscriptionCompliance,
  createSoftwareDirectory,
  createInMemorySoftwareRepository,
  type Subscription,
  type Entitlement,
  type AllocationRequest,
  type TenantScope,
} from "../src/index.js";

const TENANT: TenantScope = { tenantId: "acme" };

function baseSubscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: { kind: "subscription", value: "sub-1" },
    tenant: TENANT,
    sku: "sku-1",
    seatsTotal: 10,
    status: "active",
    validFrom: "2026-01-01T00:00:00Z",
    validUntil: "2026-12-31T00:00:00Z",
    ...overrides,
  };
}

function baseEntitlement(overrides: Partial<Entitlement> = {}): Entitlement {
  return {
    id: { kind: "entitlement", value: "e-1" },
    tenant: TENANT,
    subscriptionId: { kind: "subscription", value: "sub-1" },
    assigneeId: "u-1",
    revokedAt: null,
    revokedReason: null,
    ...overrides,
  };
}

function baseRequest(overrides: Partial<AllocationRequest> = {}): AllocationRequest {
  return {
    tenant: TENANT,
    subscriptionId: { kind: "subscription", value: "sub-1" },
    requestedSeats: 2,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// checkEntitlement.
// ---------------------------------------------------------------------------

describe("checkEntitlement — legal cases", () => {
  it("accepts a request that fits within seats", () => {
    const result = checkEntitlement(baseSubscription(), [baseEntitlement()], baseRequest());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.remainingSeats).toBe(7);
      expect(result.utilizationRatio).toBe(0.3);
    }
  });

  it("accepts a request that exactly fills seats", () => {
    const result = checkEntitlement(
      baseSubscription({ seatsTotal: 5 }),
      [baseEntitlement(), baseEntitlement({ id: { kind: "entitlement", value: "e-2" } }), baseEntitlement({ id: { kind: "entitlement", value: "e-3" }})],
      baseRequest({ requestedSeats: 2 }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.remainingSeats).toBe(0);
  });

  it("does not count revoked entitlements against the limit", () => {
    const revoked = baseEntitlement({ revokedAt: "2026-01-02T00:00:00Z", revokedReason: "left" });
    const result = checkEntitlement(
      baseSubscription({ seatsTotal: 2 }),
      [revoked],
      baseRequest({ requestedSeats: 2 }),
    );
    expect(result.ok).toBe(true);
  });
});

describe("checkEntitlement — refusals", () => {
  it("refuses with OVER_ALLOCATION and the exact overshoot", () => {
    const result = checkEntitlement(
      baseSubscription({ seatsTotal: 5 }),
      [baseEntitlement(), baseEntitlement({ id: { kind: "entitlement", value: "e-2" }}), baseEntitlement({ id: { kind: "entitlement", value: "e-3" }}), baseEntitlement({ id: { kind: "entitlement", value: "e-4" }})],
      baseRequest({ requestedSeats: 3 }),
    );
    expect(result).toEqual({ ok: false, reasonCode: "OVER_ALLOCATION", overshootSeats: 2 });
  });

  it("refuses with SUBSCRIPTION_NOT_ACTIVE when status is expired", () => {
    const result = checkEntitlement(
      baseSubscription({ status: "expired" }),
      [],
      baseRequest(),
    );
    expect(result).toEqual({ ok: false, reasonCode: "SUBSCRIPTION_NOT_ACTIVE", overshootSeats: 0 });
  });

  it("refuses with NEGATIVE_REQUEST for negative requested seats", () => {
    const result = checkEntitlement(
      baseSubscription(),
      [],
      baseRequest({ requestedSeats: -1 }),
    );
    expect(result).toEqual({ ok: false, reasonCode: "NEGATIVE_REQUEST", overshootSeats: 0 });
  });

  it("refuses with TENANT_MISMATCH when tenants do not match", () => {
    const other: TenantScope = { tenantId: "other" };
    const result = checkEntitlement(
      baseSubscription({ tenant: TENANT }),
      [],
      baseRequest({ tenant: other }),
    );
    expect(result).toEqual({ ok: false, reasonCode: "TENANT_MISMATCH", overshootSeats: 0 });
  });

  it("refuses with SUBSCRIPTION_MISMATCH when subscription ids do not match", () => {
    const result = checkEntitlement(
      baseSubscription({ id: { kind: "subscription", value: "sub-1" } }),
      [],
      baseRequest({ subscriptionId: { kind: "subscription", value: "sub-2" } }),
    );
    expect(result).toEqual({ ok: false, reasonCode: "SUBSCRIPTION_MISMATCH", overshootSeats: 0 });
  });

  it("is deterministic across calls", () => {
    expect(checkEntitlement(baseSubscription(), [], baseRequest()))
      .toEqual(checkEntitlement(baseSubscription(), [], baseRequest()));
  });
});

// ---------------------------------------------------------------------------
// sweepExpiredSubscriptions — deterministic from timestamps.
// ---------------------------------------------------------------------------

describe("sweepExpiredSubscriptions — deterministic from timestamps", () => {
  it("returns active subscriptions whose validUntil is in the past", () => {
    const subs = [
      baseSubscription({ id: { kind: "subscription", value: "sub-1" }, validUntil: "2026-01-01T00:00:00Z" }),
      baseSubscription({ id: { kind: "subscription", value: "sub-2" }, validUntil: "2026-12-31T00:00:00Z" }),
    ];
    const result = sweepExpiredSubscriptions(TENANT, subs, "2026-06-01T00:00:00Z");
    expect(result.expiredSubscriptionIds).toEqual(["sub-1"]);
  });

  it("skips non-active subscriptions", () => {
    const subs = [
      baseSubscription({ id: { kind: "subscription", value: "sub-1" }, status: "cancelled", validUntil: "2026-01-01T00:00:00Z" }),
    ];
    const result = sweepExpiredSubscriptions(TENANT, subs, "2026-06-01T00:00:00Z");
    expect(result.expiredSubscriptionIds).toEqual([]);
  });

  it("skips subscriptions with null validUntil", () => {
    const subs = [
      baseSubscription({ id: { kind: "subscription", value: "sub-1" }, validUntil: null }),
    ];
    const result = sweepExpiredSubscriptions(TENANT, subs, "2026-06-01T00:00:00Z");
    expect(result.expiredSubscriptionIds).toEqual([]);
  });

  it("skips cross-tenant subscriptions", () => {
    const other: TenantScope = { tenantId: "other" };
    const subs = [
      baseSubscription({ id: { kind: "subscription", value: "sub-1" }, tenant: other, validUntil: "2026-01-01T00:00:00Z" }),
    ];
    const result = sweepExpiredSubscriptions(TENANT, subs, "2026-06-01T00:00:00Z");
    expect(result.expiredSubscriptionIds).toEqual([]);
  });

  it("is deterministic across calls", () => {
    const subs = [baseSubscription({ validUntil: "2026-01-01T00:00:00Z" })];
    expect(sweepExpiredSubscriptions(TENANT, subs, "2026-06-01T00:00:00Z"))
      .toEqual(sweepExpiredSubscriptions(TENANT, subs, "2026-06-01T00:00:00Z"));
  });
});

// ---------------------------------------------------------------------------
// computeSubscriptionCompliance.
// ---------------------------------------------------------------------------

describe("computeSubscriptionCompliance — honest projection", () => {
  it("reports over-allocation explicitly (no clamping)", () => {
    const sub = baseSubscription({ seatsTotal: 5 });
    const ents = [
      baseEntitlement(),
      baseEntitlement({ id: { kind: "entitlement", value: "e-2" }}),
      baseEntitlement({ id: { kind: "entitlement", value: "e-3" }}),
      baseEntitlement({ id: { kind: "entitlement", value: "e-4" }}),
      baseEntitlement({ id: { kind: "entitlement", value: "e-5" }}),
      baseEntitlement({ id: { kind: "entitlement", value: "e-6" }}),
    ];
    const compliance = computeSubscriptionCompliance(sub, ents, "2026-06-01T00:00:00Z");
    expect(compliance.seatsAllocated).toBe(6);
    expect(compliance.seatsOverAllocated).toBe(1);
    expect(compliance.utilizationRatio).toBe(1.2);
  });

  it("marks expired subscriptions as expired", () => {
    const sub = baseSubscription({ status: "expired" });
    const compliance = computeSubscriptionCompliance(sub, [], "2026-06-01T00:00:00Z");
    expect(compliance.expired).toBe(true);
  });

  it("marks active-but-past-validUntil as expired", () => {
    const sub = baseSubscription({ validUntil: "2026-01-01T00:00:00Z" });
    const compliance = computeSubscriptionCompliance(sub, [], "2026-06-01T00:00:00Z");
    expect(compliance.expired).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SoftwareDirectory over in-memory repository.
// ---------------------------------------------------------------------------

describe("SoftwareDirectory over InMemorySoftwareRepository", () => {
  it("checkEntitlement returns feasibility and emits an audit event", async () => {
    const repo = createInMemorySoftwareRepository([baseSubscription()]);
    const directory = createSoftwareDirectory(repo);
    const result = await directory.checkEntitlement(TENANT, baseRequest(), { occurredAt: "2026-01-01T00:00:00Z" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.feasibility?.ok).toBe(true);
      expect(result.auditEvents[0]?.kind).toBe("software.allocation-checked");
    }
  });

  it("allocateEntitlement persists and emits an audit event", async () => {
    const repo = createInMemorySoftwareRepository([baseSubscription()]);
    const directory = createSoftwareDirectory(repo);
    const result = await directory.allocateEntitlement(
      TENANT,
      { kind: "entitlement", value: "e-1" },
      { kind: "subscription", value: "sub-1" },
      "u-1",
      { occurredAt: "2026-01-01T00:00:00Z" },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entitlement?.assigneeId).toBe("u-1");
      expect(result.auditEvents[0]?.kind).toBe("software.allocation-applied");
    }
  });

  it("allocateEntitlement REFUSES over-allocation — never silently clamps", async () => {
    const repo = createInMemorySoftwareRepository(
      [baseSubscription({ seatsTotal: 1 })],
      [baseEntitlement()],
    );
    const directory = createSoftwareDirectory(repo);
    const result = await directory.allocateEntitlement(
      TENANT,
      { kind: "entitlement", value: "e-2" },
      { kind: "subscription", value: "sub-1" },
      "u-2",
      { occurredAt: "2026-01-01T00:00:00Z" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe("OVER_ALLOCATION");
  });

  it("revokeEntitlement closes the entitlement with reason", async () => {
    const repo = createInMemorySoftwareRepository([baseSubscription()], [baseEntitlement()]);
    const directory = createSoftwareDirectory(repo);
    const result = await directory.revokeEntitlement(
      TENANT,
      { kind: "entitlement", value: "e-1" },
      "user left",
      "2026-02-01T00:00:00Z",
      { occurredAt: "2026-02-01T00:00:00Z" },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entitlement?.revokedAt).toBe("2026-02-01T00:00:00Z");
      expect(result.entitlement?.revokedReason).toBe("user left");
    }
  });

  it("sweepExpiries transitions expired subscriptions and emits an audit event", async () => {
    const repo = createInMemorySoftwareRepository([
      baseSubscription({ id: { kind: "subscription", value: "sub-1" }, validUntil: "2026-01-01T00:00:00Z" }),
      baseSubscription({ id: { kind: "subscription", value: "sub-2" }, validUntil: "2026-12-31T00:00:00Z" }),
    ]);
    const directory = createSoftwareDirectory(repo);
    const result = await directory.sweepExpiries(TENANT, "2026-06-01T00:00:00Z");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.expirySweep?.expiredSubscriptionIds).toEqual(["sub-1"]);
      expect(result.auditEvents[0]?.kind).toBe("software.expiry-swept");
      expect(result.auditEvents[0]?.expiredCount).toBe(1);
    }
  });

  it("readCompliance returns the compliance projection", async () => {
    const repo = createInMemorySoftwareRepository(
      [baseSubscription({ seatsTotal: 5 })],
      [baseEntitlement()],
    );
    const directory = createSoftwareDirectory(repo);
    const result = await directory.readCompliance(
      TENANT,
      { kind: "subscription", value: "sub-1" },
      "2026-06-01T00:00:00Z",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.compliance?.seatsAllocated).toBe(1);
      expect(result.compliance?.utilizationRatio).toBe(0.2);
    }
  });

  it("readCompliance returns SUBSCRIPTION_NOT_FOUND for cross-tenant call (fail-closed: no tenant leak)", async () => {
    const repo = createInMemorySoftwareRepository([baseSubscription()]);
    const directory = createSoftwareDirectory(repo);
    const result = await directory.readCompliance(
      { tenantId: "other" },
      { kind: "subscription", value: "sub-1" },
      "2026-06-01T00:00:00Z",
    );
    // The repository's loadSubscription is tenant-scoped and returns null
    // for cross-tenant reads — so the directory surfaces
    // SUBSCRIPTION_NOT_FOUND rather than leaking the subscription's
    // existence to a different tenant. Fail-closed (law A8).
    expect(result).toEqual({ ok: false, reasonCode: "SUBSCRIPTION_NOT_FOUND" });
  });
});
