/**
 * @fleetos/workloads — Wave 2 (F220C) operational-truth grade tests:
 * allocation lifecycle, deterministic capacity accounting, scheduling
 * windows, idempotent demand application.
 */
import { describe, expect, it } from "vitest";
import {
  type AllocationLifecycleCommand,
  type AllocationLifecycleStatus,
  transitionAllocation,
  applyLifecycleToLedger,
  computeAllocationDigest,
  validateWindow,
  detectWindowOverlaps,
  applyDemandIdempotent,
  computeDemandDigest,
  type AllocationLifecycleRecord,
  type CapacityLedger,
  type SchedulingWindow,
  type IdempotentAllocationLedger,
  type TenantScope,
} from "../src/index.js";

const TENANT: TenantScope = { tenantId: "acme" };
const OTHER_TENANT: TenantScope = { tenantId: "globex" };

function record(overrides: Partial<AllocationLifecycleRecord> = {}): AllocationLifecycleRecord {
  return {
    id: "alloc-1",
    tenant: TENANT,
    owner: "owner-1",
    units: 3,
    status: "proposed",
    demandKey: "demand-key-1",
    createdAt: 1000,
    updatedAt: 1000,
    terminalReason: null,
    ...overrides,
  };
}

function ledger(overrides: Partial<CapacityLedger> = {}): CapacityLedger {
  return {
    owner: "owner-1",
    tenant: TENANT,
    maxUnits: 10,
    reservedUnits: 0,
    ...overrides,
  };
}

function window(overrides: Partial<SchedulingWindow> = {}): SchedulingWindow {
  return {
    id: "w-1",
    tenant: TENANT,
    owner: "owner-1",
    start: 100,
    end: 200,
    ...overrides,
  };
}

function idleger(overrides: Partial<IdempotentAllocationLedger> = {}): IdempotentAllocationLedger {
  return {
    tenant: TENANT,
    owner: "owner-1",
    maxUnits: 10,
    allocatedUnits: 0,
    applications: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Allocation lifecycle state machine.
// ---------------------------------------------------------------------------

describe("transitionAllocation — legal transitions", () => {
  it("proposed → committed → active → released is the full legal path", () => {
    const committed = transitionAllocation(record(), { type: "commit" }, 2000);
    expect(committed.ok).toBe(true);
    if (committed.ok) {
      expect(committed.next.status).toBe("committed");
      expect(committed.next.updatedAt).toBe(2000);
      const active = transitionAllocation(committed.next, { type: "activate" }, 3000);
      expect(active.ok).toBe(true);
      if (active.ok) {
        expect(active.next.status).toBe("active");
        const released = transitionAllocation(active.next, { type: "release", reason: "workload done" }, 4000);
        expect(released.ok).toBe(true);
        if (released.ok) {
          expect(released.next.status).toBe("released");
          expect(released.next.terminalReason).toBe("workload done");
        }
      }
    }
  });

  it("proposed → released is legal (cancel before commit) and records the reason", () => {
    const result = transitionAllocation(record(), { type: "release", reason: "cancelled early" }, 1500);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.next.terminalReason).toBe("cancelled early");
  });

  it("active → retired is legal with a reason", () => {
    const active = record({ status: "active" });
    const result = transitionAllocation(active, { type: "retire", reason: "end of life" }, 5000);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.next.status).toBe("retired");
      expect(result.next.terminalReason).toBe("end of life");
    }
  });

  it("transitioning never mutates the input record", () => {
    const input = record();
    transitionAllocation(input, { type: "commit" }, 2000);
    expect(input.status).toBe("proposed");
    expect(input.updatedAt).toBe(1000);
  });
});

describe("transitionAllocation — illegal transitions and reason codes", () => {
  const illegalCases: readonly (readonly [
    string,
    AllocationLifecycleCommand,
    AllocationLifecycleStatus,
  ])[] = [
    ["activate from proposed", { type: "activate" }, "proposed"],
    ["commit from active", { type: "commit" }, "active"],
    ["retire from committed", { type: "retire", reason: "x" }, "committed"],
    ["commit from released", { type: "commit" }, "released"],
    ["release from retired", { type: "release", reason: "x" }, "retired"],
    ["activate from retired (terminal)", { type: "activate" }, "retired"],
  ];
  it.each(illegalCases)("refuses %s with ILLEGAL_TRANSITION", (_label, command, status) => {
    const result = transitionAllocation(record({ status }), command, 9999);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe("ILLEGAL_TRANSITION");
  });

  it("refuses release without a reason with RELEASE_REASON_REQUIRED", () => {
    const result = transitionAllocation(record({ status: "active" }), { type: "release", reason: "  " }, 2000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe("RELEASE_REASON_REQUIRED");
  });

  it("refuses retire without a reason with RETIRE_REASON_REQUIRED", () => {
    const result = transitionAllocation(record({ status: "active" }), { type: "retire", reason: "" }, 2000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe("RETIRE_REASON_REQUIRED");
  });

  it("refuses a record with negative units with NEGATIVE_UNITS", () => {
    const result = transitionAllocation(record({ units: -1 }), { type: "commit" }, 2000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe("NEGATIVE_UNITS");
  });

  it("computeAllocationDigest is stable for identical inputs and differs across statuses", () => {
    const a = computeAllocationDigest(record());
    const b = computeAllocationDigest(record());
    expect(a).toBe(b);
    const committed = computeAllocationDigest(record({ status: "committed" }));
    expect(committed).not.toBe(a);
  });
});

// ---------------------------------------------------------------------------
// Deterministic capacity accounting (ledger invariant).
// ---------------------------------------------------------------------------

describe("applyLifecycleToLedger — accounting invariants", () => {
  it("commit reserves exactly the record's units", () => {
    const result = applyLifecycleToLedger(ledger(), record({ units: 3 }), { type: "commit" }, 2000);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ledger.reservedUnits).toBe(3);
  });

  it("activate is reservation-neutral (no double counting)", () => {
    const committed = applyLifecycleToLedger(ledger(), record({ units: 3 }), { type: "commit" }, 2000);
    expect(committed.ok).toBe(true);
    if (committed.ok) {
      const active = applyLifecycleToLedger(committed.ledger, committed.next, { type: "activate" }, 3000);
      expect(active.ok).toBe(true);
      if (active.ok) expect(active.ledger.reservedUnits).toBe(3);
    }
  });

  it("release after commit restores the ledger EXACTLY (allocate/release round-trip)", () => {
    const committed = applyLifecycleToLedger(ledger(), record({ units: 3 }), { type: "commit" }, 2000);
    expect(committed.ok).toBe(true);
    if (committed.ok) {
      const released = applyLifecycleToLedger(committed.ledger, committed.next, { type: "release", reason: "done" }, 4000);
      expect(released.ok).toBe(true);
      if (released.ok) expect(released.ledger.reservedUnits).toBe(0);
    }
  });

  it("commit beyond capacity is REFUSED with the exact overshoot — never clamped", () => {
    const result = applyLifecycleToLedger(
      ledger({ reservedUnits: 8 }),
      record({ units: 4 }),
      { type: "commit" },
      2000,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("EXCEEDS_CAPACITY");
      expect(result.overshootUnits).toBe(2);
    }
  });

  it("release of a reservation the ledger does not hold is refused with NOT_RESERVED", () => {
    const result = applyLifecycleToLedger(
      ledger({ reservedUnits: 1 }),
      record({ status: "active", units: 3 }),
      { type: "release", reason: "done" },
      4000,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe("NOT_RESERVED");
  });

  it("release from proposed leaves the ledger unchanged (nothing was reserved)", () => {
    const result = applyLifecycleToLedger(
      ledger({ reservedUnits: 5 }),
      record({ units: 3 }),
      { type: "release", reason: "cancelled" },
      1500,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ledger.reservedUnits).toBe(5);
  });

  it("refuses a tenant mismatch between ledger and record with TENANT_MISMATCH", () => {
    const result = applyLifecycleToLedger(
      ledger({ tenant: OTHER_TENANT }),
      record(),
      { type: "commit" },
      2000,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe("TENANT_MISMATCH");
  });

  it("refuses an owner mismatch with OWNER_MISMATCH", () => {
    const result = applyLifecycleToLedger(
      ledger({ owner: "owner-2" }),
      record(),
      { type: "commit" },
      2000,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe("OWNER_MISMATCH");
  });

  it("repeated identical sequences converge to identical ledgers (determinism)", () => {
    const run = () => {
      let l = ledger();
      const r1 = record({ id: "a", demandKey: "k1", units: 4 });
      const r2 = record({ id: "b", demandKey: "k2", units: 5 });
      const s1 = applyLifecycleToLedger(l, r1, { type: "commit" }, 100);
      if (s1.ok) {
        l = s1.ledger;
        const s2 = applyLifecycleToLedger(l, r2, { type: "commit" }, 200);
        if (s2.ok) {
          l = s2.ledger;
          const s3 = applyLifecycleToLedger(l, s2.next, { type: "activate" }, 300);
          if (s3.ok) {
            l = s3.ledger;
            const s4 = applyLifecycleToLedger(l, s1.next, { type: "release", reason: "x" }, 400);
            if (s4.ok) l = s4.ledger;
          }
        }
      }
      return l;
    };
    expect(run()).toEqual(run());
    expect(run().reservedUnits).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Scheduling windows.
// ---------------------------------------------------------------------------

describe("validateWindow", () => {
  it("accepts start < end", () => {
    expect(validateWindow(window()).ok).toBe(true);
  });
  it.each([
    ["start == end", 200, 200],
    ["start > end", 300, 200],
  ])("refuses %s with START_NOT_BEFORE_END", (_label, start, end) => {
    const result = validateWindow(window({ start, end }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe("START_NOT_BEFORE_END");
  });
});

describe("detectWindowOverlaps", () => {
  it("flags two overlapping windows on the same owner", () => {
    const overlaps = detectWindowOverlaps([
      window({ id: "w-1", start: 100, end: 200 }),
      window({ id: "w-2", start: 150, end: 250 }),
    ]);
    expect(overlaps.length).toBe(1);
    expect(overlaps[0]?.a).toBe("w-1");
    expect(overlaps[0]?.b).toBe("w-2");
  });

  it("touching boundaries do NOT overlap", () => {
    const overlaps = detectWindowOverlaps([
      window({ id: "w-1", start: 100, end: 200 }),
      window({ id: "w-2", start: 200, end: 300 }),
    ]);
    expect(overlaps.length).toBe(0);
  });

  it("different owners at the same time do NOT overlap (per-owner scoping)", () => {
    const overlaps = detectWindowOverlaps([
      window({ id: "w-1", owner: "owner-1", start: 100, end: 200 }),
      window({ id: "w-2", owner: "owner-2", start: 100, end: 200 }),
    ]);
    expect(overlaps.length).toBe(0);
  });

  it("identical ranges tie-break lexically by window id, recorded in the overlap", () => {
    const overlaps = detectWindowOverlaps([
      window({ id: "w-b", start: 100, end: 200 }),
      window({ id: "w-a", start: 100, end: 200 }),
    ]);
    expect(overlaps.length).toBe(1);
    expect(overlaps[0]?.a).toBe("w-a");
    expect(overlaps[0]?.b).toBe("w-b");
    expect(overlaps[0]?.tieBreakRule).toBe("window-id-lexical");
  });

  it("output ordering is deterministic regardless of input order", () => {
    const windows = [
      window({ id: "w-9", start: 500, end: 600 }),
      window({ id: "w-2", start: 100, end: 300 }),
      window({ id: "w-1", start: 200, end: 400 }),
      window({ id: "w-7", start: 550, end: 700 }),
    ];
    expect(detectWindowOverlaps(windows)).toEqual(detectWindowOverlaps([...windows].reverse()));
  });

  it("ignores invalid windows entirely", () => {
    const overlaps = detectWindowOverlaps([
      window({ id: "w-1", start: 300, end: 200 }),
      window({ id: "w-2", start: 100, end: 400 }),
    ]);
    expect(overlaps.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Idempotent demand application.
// ---------------------------------------------------------------------------

describe("applyDemandIdempotent", () => {
  it("first application commits and is not a duplicate", () => {
    const result = applyDemandIdempotent(idleger(), {
      owner: "owner-1",
      tenant: TENANT,
      units: 3,
      demandKey: "k-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.duplicate).toBe(false);
      expect(result.ledger.allocatedUnits).toBe(3);
    }
  });

  it("re-applying the SAME demand key returns the SAME ledger, no double-commit", () => {
    const first = applyDemandIdempotent(idleger(), {
      owner: "owner-1",
      tenant: TENANT,
      units: 3,
      demandKey: "k-1",
    });
    expect(first.ok).toBe(true);
    if (first.ok) {
      const second = applyDemandIdempotent(first.ledger, {
        owner: "owner-1",
        tenant: TENANT,
        units: 3,
        demandKey: "k-1",
      });
      expect(second.ok).toBe(true);
      if (second.ok) {
        expect(second.duplicate).toBe(true);
        expect(second.ledger).toEqual(first.ledger);
        expect(second.ledger.allocatedUnits).toBe(3);
        expect(second.ledger.applications.length).toBe(1);
      }
    }
  });

  it("same key with a DIFFERENT payload is refused with IDEMPOTENCY_KEY_CONFLICT", () => {
    const first = applyDemandIdempotent(idleger(), {
      owner: "owner-1",
      tenant: TENANT,
      units: 3,
      demandKey: "k-1",
    });
    expect(first.ok).toBe(true);
    if (first.ok) {
      const conflict = applyDemandIdempotent(first.ledger, {
        owner: "owner-1",
        tenant: TENANT,
        units: 4,
        demandKey: "k-1",
      });
      expect(conflict.ok).toBe(false);
      if (!conflict.ok) expect(conflict.reasonCode).toBe("IDEMPOTENCY_KEY_CONFLICT");
    }
  });

  it("different keys accumulate within capacity", () => {
    let ledger = idleger();
    for (const key of ["k-1", "k-2", "k-3"]) {
      const r = applyDemandIdempotent(ledger, { owner: "owner-1", tenant: TENANT, units: 2, demandKey: key });
      expect(r.ok).toBe(true);
      if (r.ok) ledger = r.ledger;
    }
    expect(ledger.allocatedUnits).toBe(6);
    expect(ledger.applications.length).toBe(3);
  });

  it("over-capacity application is refused with the exact overshoot", () => {
    const first = applyDemandIdempotent(idleger(), {
      owner: "owner-1",
      tenant: TENANT,
      units: 8,
      demandKey: "k-1",
    });
    expect(first.ok).toBe(true);
    if (first.ok) {
      const second = applyDemandIdempotent(first.ledger, {
        owner: "owner-1",
        tenant: TENANT,
        units: 5,
        demandKey: "k-2",
      });
      expect(second.ok).toBe(false);
      if (!second.ok) {
        expect(second.reasonCode).toBe("EXCEEDS_CAPACITY");
        expect(second.overshootUnits).toBe(3);
      }
    }
  });

  it.each([
    ["empty demand key", { demandKey: "" }, "IDEMPOTENCY_KEY_EMPTY"],
    ["negative units", { units: -1 }, "NEGATIVE_UNITS"],
    ["tenant mismatch", { tenant: OTHER_TENANT }, "TENANT_MISMATCH"],
  ])("refuses %s", (_label, overrides, expected) => {
    const result = applyDemandIdempotent(idleger(), {
      owner: "owner-1",
      tenant: TENANT,
      units: 1,
      demandKey: "k-1",
      ...overrides,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe(expected);
  });

  it("computeDemandDigest is stable and input-sensitive", () => {
    expect(computeDemandDigest("acme", "owner-1", 3)).toBe(computeDemandDigest("acme", "owner-1", 3));
    expect(computeDemandDigest("acme", "owner-1", 3)).not.toBe(computeDemandDigest("acme", "owner-1", 4));
  });

  it("property-style: a seeded sequence of re-applied demands never double-commits", () => {
    let l = idleger({ maxUnits: 50 });
    // deterministic pseudo-sequence (no Math.random): units cycle 1..5
    for (let i = 0; i < 25; i++) {
      const units = (i % 5) + 1;
      const key = `k-${i % 7}`; // deliberate key reuse
      const r = applyDemandIdempotent(l, { owner: "owner-1", tenant: TENANT, units, demandKey: key });
      if (r.ok) {
        l = r.ledger;
      } else if (r.reasonCode === "IDEMPOTENCY_KEY_CONFLICT") {
        // key reuse with different units — expected; re-apply with the
        // ORIGINAL units for that key to prove idempotency holds.
        const original = l.applications.find((a) => a.demandKey === key);
        expect(original).toBeDefined();
        if (original) {
          const retry = applyDemandIdempotent(l, {
            owner: "owner-1",
            tenant: TENANT,
            units: original.units,
            demandKey: key,
          });
          expect(retry.ok).toBe(true);
          if (retry.ok) {
            expect(retry.duplicate).toBe(true);
            expect(retry.ledger).toEqual(l);
          }
        }
      }
    }
    // allocatedUnits is exactly the sum of distinct committed applications.
    const sum = l.applications.reduce((acc, a) => acc + a.units, 0);
    expect(l.allocatedUnits).toBe(sum);
    expect(l.allocatedUnits).toBeLessThanOrEqual(50);
  });
});
