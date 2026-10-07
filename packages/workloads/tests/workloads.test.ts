/**
 * @fleetos/workloads — Wave 1 kernel-grade tests.
 */
import { describe, expect, it } from "vitest";
import {
  checkAllocationFeasibility,
  computeUtilization,
  proposeRebalance,
  computeRebalanceDigest,
  createWorkloadDirectory,
  createInMemoryWorkloadRepository,
  type WorkloadCapacity,
  type WorkloadAllocation,
  type AllocationDemand,
  type TenantScope,
} from "../src/index.js";

const TENANT: TenantScope = { tenantId: "acme" };

function capacity(overrides: Partial<WorkloadCapacity> = {}): WorkloadCapacity {
  return {
    owner: "owner-1",
    tenant: TENANT,
    maxUnits: 10,
    unitCost: 5,
    ...overrides,
  };
}

function allocation(overrides: Partial<WorkloadAllocation> = {}): WorkloadAllocation {
  return {
    owner: "owner-1",
    tenant: TENANT,
    allocatedUnits: 3,
    reservedCost: 15,
    ...overrides,
  };
}

function demand(overrides: Partial<AllocationDemand> = {}): AllocationDemand {
  return {
    owner: "owner-1",
    tenant: TENANT,
    requestedUnits: 2,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// checkAllocationFeasibility.
// ---------------------------------------------------------------------------

describe("checkAllocationFeasibility — legal cases", () => {
  it("accepts a demand that fits within capacity", () => {
    const result = checkAllocationFeasibility(capacity(), allocation(), demand());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.remainingUnits).toBe(5);
      expect(result.utilizationRatio).toBe(0.5);
    }
  });

  it("accepts a demand that exactly fills capacity (zero remaining)", () => {
    const result = checkAllocationFeasibility(
      capacity(),
      allocation({ allocatedUnits: 8 }),
      demand({ requestedUnits: 2 }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.remainingUnits).toBe(0);
  });

  it("accepts zero demand without changing utilization", () => {
    const result = checkAllocationFeasibility(
      capacity(),
      allocation({ allocatedUnits: 3 }),
      demand({ requestedUnits: 0 }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.utilizationRatio).toBe(0.3);
  });
});

describe("checkAllocationFeasibility — refusals", () => {
  it("refuses with EXCEEDS_CAPACITY and the exact overshoot", () => {
    const result = checkAllocationFeasibility(
      capacity({ maxUnits: 10 }),
      allocation({ allocatedUnits: 8 }),
      demand({ requestedUnits: 5 }),
    );
    expect(result).toEqual({ ok: false, reasonCode: "EXCEEDS_CAPACITY", overshootUnits: 3 });
  });

  it("refuses with NEGATIVE_DEMAND for negative requested units", () => {
    const result = checkAllocationFeasibility(
      capacity(),
      allocation(),
      demand({ requestedUnits: -1 }),
    );
    expect(result).toEqual({ ok: false, reasonCode: "NEGATIVE_DEMAND", overshootUnits: 0 });
  });

  it("refuses with TENANT_MISMATCH when owners do not match", () => {
    const result = checkAllocationFeasibility(
      capacity({ owner: "a" }),
      allocation({ owner: "b" }),
      demand({ owner: "c" }),
    );
    expect(result).toEqual({ ok: false, reasonCode: "OWNER_MISMATCH", overshootUnits: 0 });
  });

  it("refuses with TENANT_MISMATCH when tenants do not match", () => {
    const other: TenantScope = { tenantId: "other" };
    const result = checkAllocationFeasibility(
      capacity({ tenant: TENANT }),
      allocation({ tenant: other }),
      demand({ tenant: TENANT }),
    );
    expect(result).toEqual({ ok: false, reasonCode: "TENANT_MISMATCH", overshootUnits: 0 });
  });

  it("refuses with TENANT_SCOPE_MISSING on broken tenant", () => {
    const broken = { tenantId: "" } as unknown as TenantScope;
    const result = checkAllocationFeasibility(
      capacity({ tenant: broken }),
      allocation({ tenant: broken }),
      demand({ tenant: broken }),
    );
    expect(result).toEqual({ ok: false, reasonCode: "TENANT_SCOPE_MISSING", overshootUnits: 0 });
  });
});

describe("checkAllocationFeasibility — determinism", () => {
  it("returns the same result for the same inputs across calls", () => {
    const a = checkAllocationFeasibility(capacity(), allocation(), demand());
    const b = checkAllocationFeasibility(capacity(), allocation(), demand());
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// computeUtilization.
// ---------------------------------------------------------------------------

describe("computeUtilization — honest projection", () => {
  it("returns utilization under 1.0 when within capacity", () => {
    const util = computeUtilization(capacity({ maxUnits: 10 }), allocation({ allocatedUnits: 5 }));
    expect(util.utilizationRatio).toBe(0.5);
    expect(util.overAllocated).toBe(false);
  });

  it("returns overAllocated true when allocated exceeds capacity (honest, no clamping)", () => {
    const util = computeUtilization(capacity({ maxUnits: 10 }), allocation({ allocatedUnits: 15 }));
    expect(util.utilizationRatio).toBe(1.5);
    expect(util.overAllocated).toBe(true);
  });

  it("returns zero utilization when capacity is zero", () => {
    const util = computeUtilization(capacity({ maxUnits: 0 }), allocation({ allocatedUnits: 0 }));
    expect(util.utilizationRatio).toBe(0);
    expect(util.overAllocated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// proposeRebalance — PROPOSALS only, never silent mutations.
// ---------------------------------------------------------------------------

describe("proposeRebalance — proposal surface", () => {
  it("produces moves from over-allocated owners to owners with headroom", () => {
    const proposal = proposeRebalance(
      TENANT,
      [
        capacity({ owner: "a", maxUnits: 10 }),
        capacity({ owner: "b", maxUnits: 10 }),
      ],
      [
        allocation({ owner: "a", allocatedUnits: 15 }), // overshoot 5
        allocation({ owner: "b", allocatedUnits: 5 }), // headroom 5
      ],
      "2026-01-01T00:00:00Z",
    );
    expect(proposal.kind).toBe("rebalance-proposal");
    expect(proposal.moves.length).toBe(1);
    expect(proposal.moves[0]?.fromOwner).toBe("a");
    expect(proposal.moves[0]?.toOwner).toBe("b");
    expect(proposal.moves[0]?.units).toBe(5);
    expect(proposal.reasonCode).toBeNull();
  });

  it("returns NO_OVER_ALLOCATED_OWNERS reason when nothing is over-allocated", () => {
    const proposal = proposeRebalance(
      TENANT,
      [capacity({ owner: "a", maxUnits: 10 })],
      [allocation({ owner: "a", allocatedUnits: 5 })],
      "2026-01-01T00:00:00Z",
    );
    expect(proposal.moves.length).toBe(0);
    expect(proposal.reasonCode).toBe("NO_OVER_ALLOCATED_OWNERS");
  });

  it("returns INSUFFICIENT_HEADROOM when there are no owners with headroom", () => {
    const proposal = proposeRebalance(
      TENANT,
      [
        capacity({ owner: "a", maxUnits: 10 }),
        capacity({ owner: "b", maxUnits: 10 }),
      ],
      [
        allocation({ owner: "a", allocatedUnits: 15 }), // overshoot
        allocation({ owner: "b", allocatedUnits: 10 }), // no headroom
      ],
      "2026-01-01T00:00:00Z",
    );
    expect(proposal.moves.length).toBe(0);
    expect(proposal.reasonCode).toBe("INSUFFICIENT_HEADROOM");
  });

  it("returns TENANT_SCOPE_MISSING on broken tenant", () => {
    const broken = { tenantId: "" } as unknown as TenantScope;
    const proposal = proposeRebalance(broken, [], [], "2026-01-01T00:00:00Z");
    expect(proposal.reasonCode).toBe("TENANT_SCOPE_MISSING");
  });

  it("returns TENANT_MISMATCH when an owner is in a different tenant", () => {
    const other: TenantScope = { tenantId: "other" };
    const proposal = proposeRebalance(
      TENANT,
      [capacity({ tenant: other })],
      [],
      "2026-01-01T00:00:00Z",
    );
    expect(proposal.reasonCode).toBe("TENANT_MISMATCH");
  });

  it("is deterministic — same inputs produce the same digest", () => {
    const a = proposeRebalance(
      TENANT,
      [
        capacity({ owner: "a", maxUnits: 10 }),
        capacity({ owner: "b", maxUnits: 10 }),
      ],
      [
        allocation({ owner: "a", allocatedUnits: 15 }),
        allocation({ owner: "b", allocatedUnits: 5 }),
      ],
      "2026-01-01T00:00:00Z",
    );
    const b = proposeRebalance(
      TENANT,
      [
        capacity({ owner: "a", maxUnits: 10 }),
        capacity({ owner: "b", maxUnits: 10 }),
      ],
      [
        allocation({ owner: "a", allocatedUnits: 15 }),
        allocation({ owner: "b", allocatedUnits: 5 }),
      ],
      "2026-01-01T00:00:00Z",
    );
    expect(a.digest).toBe(b.digest);
  });

  it("does not mutate inputs", () => {
    const caps = [capacity({ owner: "a", maxUnits: 10 }), capacity({ owner: "b", maxUnits: 10 })];
    const allocs = [allocation({ owner: "a", allocatedUnits: 15 }), allocation({ owner: "b", allocatedUnits: 5 })];
    const capsSnapshot = JSON.stringify(caps);
    const allocsSnapshot = JSON.stringify(allocs);
    proposeRebalance(TENANT, caps, allocs, "2026-01-01T00:00:00Z");
    expect(JSON.stringify(caps)).toBe(capsSnapshot);
    expect(JSON.stringify(allocs)).toBe(allocsSnapshot);
  });
});

describe("computeRebalanceDigest — determinism", () => {
  it("returns the same digest for the same inputs", () => {
    const moves = [
      { fromOwner: "a", toOwner: "b", units: 5, rationale: "x" },
    ];
    expect(computeRebalanceDigest("acme", moves, "2026-01-01T00:00:00Z"))
      .toBe(computeRebalanceDigest("acme", moves, "2026-01-01T00:00:00Z"));
  });
});

// ---------------------------------------------------------------------------
// WorkloadDirectory over in-memory repository.
// ---------------------------------------------------------------------------

describe("WorkloadDirectory over InMemoryWorkloadRepository", () => {
  it("checkFeasibility returns the feasibility result and emits an audit event", async () => {
    const repo = createInMemoryWorkloadRepository([capacity()], [allocation()]);
    const directory = createWorkloadDirectory(repo);
    const result = await directory.checkFeasibility(TENANT, demand(), { occurredAt: "2026-01-01T00:00:00Z" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.feasibility?.ok).toBe(true);
      expect(result.auditEvents[0]?.kind).toBe("workload.allocation-checked");
    }
  });

  it("checkFeasibility refuses with EXCEEDS_CAPACITY and emits a refusal audit", async () => {
    const repo = createInMemoryWorkloadRepository(
      [capacity({ maxUnits: 10 })],
      [allocation({ allocatedUnits: 9 })],
    );
    const directory = createWorkloadDirectory(repo);
    const result = await directory.checkFeasibility(
      TENANT,
      demand({ requestedUnits: 5 }),
      { occurredAt: "2026-01-01T00:00:00Z" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("EXCEEDS_CAPACITY");
      expect(result.overshootUnits).toBe(4);
      expect(result.auditEvents?.[0]?.kind).toBe("workload.allocation-refused");
    }
  });

  it("applyAllocation persists the new allocation when feasible", async () => {
    const repo = createInMemoryWorkloadRepository([capacity()], [allocation()]);
    const directory = createWorkloadDirectory(repo);
    const result = await directory.applyAllocation(TENANT, demand(), { occurredAt: "2026-01-01T00:00:00Z" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.auditEvents[0]?.kind).toBe("workload.allocation-applied");
    }
    const util = await directory.readUtilization(TENANT, "owner-1");
    expect(util?.usedUnits).toBe(5);
  });

  it("applyAllocation REFUSES over-allocation — never silently clamps", async () => {
    const repo = createInMemoryWorkloadRepository(
      [capacity({ maxUnits: 10 })],
      [allocation({ allocatedUnits: 8 })],
    );
    const directory = createWorkloadDirectory(repo);
    const result = await directory.applyAllocation(
      TENANT,
      demand({ requestedUnits: 5 }),
      { occurredAt: "2026-01-01T00:00:00Z" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe("EXCEEDS_CAPACITY");
    // Verify the allocation was NOT mutated.
    const util = await directory.readUtilization(TENANT, "owner-1");
    expect(util?.usedUnits).toBe(8);
  });

  it("applyAllocation refuses with CAPACITY_NOT_FOUND when no capacity exists", async () => {
    const repo = createInMemoryWorkloadRepository();
    const directory = createWorkloadDirectory(repo);
    const result = await directory.applyAllocation(TENANT, demand(), { occurredAt: "2026-01-01T00:00:00Z" });
    expect(result).toEqual({ ok: false, reasonCode: "CAPACITY_NOT_FOUND" });
  });

  it("readUtilization returns null for cross-tenant (fail-closed)", async () => {
    const repo = createInMemoryWorkloadRepository([capacity()], [allocation()]);
    const directory = createWorkloadDirectory(repo);
    const util = await directory.readUtilization({ tenantId: "other" }, "owner-1");
    expect(util).toBeNull();
  });

  it("proposeRebalance returns a proposal with moves", async () => {
    const repo = createInMemoryWorkloadRepository(
      [
        capacity({ owner: "a", maxUnits: 10 }),
        capacity({ owner: "b", maxUnits: 10 }),
      ],
      [
        allocation({ owner: "a", allocatedUnits: 15 }),
        allocation({ owner: "b", allocatedUnits: 5 }),
      ],
    );
    const directory = createWorkloadDirectory(repo);
    const proposal = await directory.proposeRebalance(TENANT, { generatedAt: "2026-01-01T00:00:00Z" });
    expect(proposal.moves.length).toBe(1);
    expect(proposal.moves[0]?.fromOwner).toBe("a");
    expect(proposal.moves[0]?.toOwner).toBe("b");
  });
});
