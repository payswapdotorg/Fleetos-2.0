import { describe, expect, it } from "vitest";
import {
  checkAllocationFeasibility,
  computeUtilization,
  validateTenantScope,
  type WorkloadCapacity,
  type WorkloadAllocation,
  type AllocationDemand,
  type TenantScope,
} from "../src/index.js";

const TENANT: TenantScope = { tenantId: "acme" };

function cap(overrides: Partial<WorkloadCapacity> = {}): WorkloadCapacity {
  return {
    owner: "u-1",
    tenant: TENANT,
    maxUnits: 8,
    unitCost: 1,
    ...overrides,
  };
}

function alloc(overrides: Partial<WorkloadAllocation> = {}): WorkloadAllocation {
  return {
    owner: "u-1",
    tenant: TENANT,
    allocatedUnits: 3,
    reservedCost: 3,
    ...overrides,
  };
}

function demand(overrides: Partial<AllocationDemand> = {}): AllocationDemand {
  return {
    owner: "u-1",
    tenant: TENANT,
    requestedUnits: 2,
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

describe("checkAllocationFeasibility — honest acceptance", () => {
  it("accepts demand that fits within capacity", () => {
    const r = checkAllocationFeasibility(cap(), alloc(), demand());
    expect(r).toEqual({ ok: true, remainingUnits: 3, utilizationRatio: 5 / 8 });
  });

  it("accepts demand that exactly saturates capacity", () => {
    const r = checkAllocationFeasibility(
      cap({ maxUnits: 5 }),
      alloc({ allocatedUnits: 3 }),
      demand({ requestedUnits: 2 }),
    );
    expect(r).toEqual({ ok: true, remainingUnits: 0, utilizationRatio: 1 });
  });
});

describe("checkAllocationFeasibility — honest overload, never clamped", () => {
  it("refuses with EXCEEDS_CAPACITY and exact overshoot when over budget", () => {
    const r = checkAllocationFeasibility(
      cap({ maxUnits: 4 }),
      alloc({ allocatedUnits: 3 }),
      demand({ requestedUnits: 5 }),
    );
    expect(r).toEqual({ ok: false, reasonCode: "EXCEEDS_CAPACITY", overshootUnits: 4 });
  });

  it("never silently clamps overshoot to zero — overshoot is always the truth", () => {
    const r = checkAllocationFeasibility(
      cap({ maxUnits: 2 }),
      alloc({ allocatedUnits: 0 }),
      demand({ requestedUnits: 10 }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.overshootUnits).toBe(8);
  });

  it("refuses negative demand with NEGATIVE_DEMAND", () => {
    const r = checkAllocationFeasibility(cap(), alloc(), demand({ requestedUnits: -1 }));
    expect(r).toEqual({ ok: false, reasonCode: "NEGATIVE_DEMAND", overshootUnits: 0 });
  });

  it("refuses with OWNER_MISMATCH when owners differ", () => {
    const r = checkAllocationFeasibility(cap({ owner: "a" }), alloc({ owner: "b" }), demand());
    expect(r).toEqual({ ok: false, reasonCode: "OWNER_MISMATCH", overshootUnits: 0 });
  });
});

describe("checkAllocationFeasibility — tenant fail-closed", () => {
  it("refuses with TENANT_SCOPE_MISSING when capacity tenant is empty", () => {
    const r = checkAllocationFeasibility(
      cap({ tenant: { tenantId: "" } as unknown as TenantScope }),
      alloc(),
      demand(),
    );
    expect(r).toEqual({ ok: false, reasonCode: "TENANT_SCOPE_MISSING", overshootUnits: 0 });
  });

  it("refuses with TENANT_MISMATCH when tenants differ across inputs", () => {
    const r = checkAllocationFeasibility(
      cap({ tenant: { tenantId: "acme" } }),
      alloc({ tenant: { tenantId: "globex" } as unknown as TenantScope }),
      demand(),
    );
    expect(r).toEqual({ ok: false, reasonCode: "TENANT_MISMATCH", overshootUnits: 0 });
  });
});

describe("checkAllocationFeasibility — determinism", () => {
  it("returns the same result for the same inputs", () => {
    const a = checkAllocationFeasibility(cap(), alloc(), demand());
    const b = checkAllocationFeasibility(cap(), alloc(), demand());
    expect(a).toEqual(b);
  });
});

describe("computeUtilization", () => {
  it("returns utilization > 1 honestly when over-allocated, never clamped", () => {
    const u = computeUtilization(cap({ maxUnits: 2 }), alloc({ allocatedUnits: 5 }));
    expect(u.utilizationRatio).toBe(2.5);
    expect(u.usedUnits).toBe(5);
  });

  it("returns 0 utilization when capacity is zero (no division by zero)", () => {
    const u = computeUtilization(cap({ maxUnits: 0 }), alloc({ allocatedUnits: 0 }));
    expect(u.utilizationRatio).toBe(0);
  });
});
