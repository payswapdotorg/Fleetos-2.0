/**
 * @fleetos/software — Wave 8 (F280C) entitlement compliance hardening
 * tests: renewal windows with grace boundaries, seat-burn projections
 * with exact overage, batch seat allocation all-or-nothing refusals,
 * tenant fail-closed probes.
 */
import { describe, expect, it } from "vitest";
import {
  sweepRenewalWindows,
  projectSeatUtilization,
  allocateSeatsBatch,
  type Subscription,
  type TenantScope,
  type EntitlementGrant,
  type PlannedSeatAssignment,
} from "../src/index.js";

const TENANT: TenantScope = { tenantId: "acme" };
const OTHER_TENANT: TenantScope = { tenantId: "globex" };
const VALID_UNTIL = "2026-01-31T00:00:00.000Z";
const VALID_UNTIL_MS = Date.parse(VALID_UNTIL); // deterministic parse of a fixed string
const GRACE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

function subscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: { kind: "subscription", value: "sub-1" },
    tenant: TENANT,
    sku: "sku-pro",
    seatsTotal: 5,
    status: "active",
    validFrom: "2025-01-01T00:00:00.000Z",
    validUntil: VALID_UNTIL,
    ...overrides,
  };
}

function grant(overrides: Partial<EntitlementGrant> = {}): EntitlementGrant {
  return {
    id: "g-1",
    tenant: TENANT,
    subscriptionId: "sub-1",
    catalogEntryId: "cat-1",
    assigneeId: "user-1",
    seats: 2,
    status: "assigned",
    grantedAt: 1,
    assignedAt: 2,
    revokedAt: null,
    revokedReason: null,
    expiresAt: null,
    ...overrides,
  };
}

describe("sweepRenewalWindows — documented grace law, boundary-pinned", () => {
  it("active while now <= validUntil (boundary inclusive)", () => {
    const result = sweepRenewalWindows(TENANT, [subscription()], GRACE_MS, VALID_UNTIL_MS);
    expect(result.ok && result.report.windows[0]?.status).toBe("active");
    const before = sweepRenewalWindows(TENANT, [subscription()], GRACE_MS, VALID_UNTIL_MS - 1);
    expect(before.ok && before.report.windows[0]?.status).toBe("active");
  });

  it("inGrace while validUntil < now <= validUntil + graceMs (both boundaries)", () => {
    const start = sweepRenewalWindows(TENANT, [subscription()], GRACE_MS, VALID_UNTIL_MS + 1);
    expect(start.ok && start.report.windows[0]?.status).toBe("inGrace");
    const end = sweepRenewalWindows(TENANT, [subscription()], GRACE_MS, VALID_UNTIL_MS + GRACE_MS);
    expect(end.ok && end.report.windows[0]?.status).toBe("inGrace");
    expect(end.ok && end.report.windows[0]?.graceEndsAtMs).toBe(VALID_UNTIL_MS + GRACE_MS);
  });

  it("expired when now > validUntil + graceMs (boundary exclusive)", () => {
    const result = sweepRenewalWindows(TENANT, [subscription()], GRACE_MS, VALID_UNTIL_MS + GRACE_MS + 1);
    expect(result.ok && result.report.windows[0]?.status).toBe("expired");
  });

  it("null validUntil is active forever; non-active subscriptions are expired (not renewable)", () => {
    const forever = sweepRenewalWindows(TENANT, [subscription({ validUntil: null })], GRACE_MS, 9_000_000_000);
    expect(forever.ok && forever.report.windows[0]).toMatchObject({ status: "active", graceEndsAtMs: null });
    const cancelled = sweepRenewalWindows(TENANT, [subscription({ status: "cancelled" })], GRACE_MS, VALID_UNTIL_MS - 1);
    expect(cancelled.ok && cancelled.report.windows[0]?.status).toBe("expired");
  });

  it("counts + lexical ordering are honest; input order never leaks", () => {
    const subs = [
      subscription({ id: { kind: "subscription", value: "sub-c" }, validUntil: null }),
      subscription({ id: { kind: "subscription", value: "sub-a" } }),
      subscription({ id: { kind: "subscription", value: "sub-b" }, status: "expired" }),
    ];
    const forward = sweepRenewalWindows(TENANT, subs, GRACE_MS, VALID_UNTIL_MS + 1);
    const permuted = sweepRenewalWindows(TENANT, [...subs].reverse(), GRACE_MS, VALID_UNTIL_MS + 1);
    expect(forward.ok && permuted.ok).toBe(true);
    if (!forward.ok || !permuted.ok) return;
    expect(forward.report).toEqual(permuted.report);
    expect(forward.report.windows.map((w) => w.subscriptionId)).toEqual(["sub-a", "sub-b", "sub-c"]);
    expect(forward.report.activeCount).toBe(1);
    expect(forward.report.inGraceCount).toBe(1);
    expect(forward.report.expiredCount).toBe(1);
    expect(forward.report.sweptAt).toBe(VALID_UNTIL_MS + 1);
  });

  it("refuses invalid grace and unparseable validUntil (never a guessed classification)", () => {
    expect(sweepRenewalWindows(TENANT, [subscription()], -1, 1)).toMatchObject({
      ok: false,
      reasonCode: "INVALID_GRACE_MS",
    });
    expect(
      sweepRenewalWindows(TENANT, [subscription({ validUntil: "not-a-date" })], GRACE_MS, 1),
    ).toMatchObject({ ok: false, reasonCode: "INVALID_VALID_UNTIL" });
  });

  it("TENANT fail-closed: a foreign-tenant subscription refuses the sweep", () => {
    expect(
      sweepRenewalWindows(TENANT, [subscription({ tenant: OTHER_TENANT })], GRACE_MS, 1),
    ).toMatchObject({ ok: false, reasonCode: "TENANT_MISMATCH" });
    expect(
      sweepRenewalWindows({ tenantId: "" }, [subscription()], GRACE_MS, 1),
    ).toMatchObject({ ok: false, reasonCode: "TENANT_SCOPE_MISSING" });
  });
});

describe("projectSeatUtilization — seat-burn projection with exact overage", () => {
  function planned(list: readonly [string, number, string][]): PlannedSeatAssignment[] {
    return list.map(([requestId, seats, assumption]) => ({ requestId, seats, assumption }));
  }

  it("projects held + planned with utilization bps and EXACT overage, assumptions verbatim", () => {
    const result = projectSeatUtilization(
      TENANT,
      subscription({ seatsTotal: 10 }),
      [grant({ seats: 4 })],
      planned([["r-1", 5, "new hires in Q3"], ["r-2", 3, "contractor onboarding"]]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.projection).toMatchObject({
      subscriptionId: "sub-1",
      seatsTotal: 10,
      heldSeatsNow: 4,
      plannedSeats: 8,
      projectedHeldSeats: 12,
      utilizationBps: 12000,
      overageSeats: 2,
      projection: true,
    });
    expect(result.projection.assumptions).toEqual(["new hires in Q3", "contractor onboarding"]);
  });

  it("a plan inside capacity reports zero overage honestly", () => {
    const result = projectSeatUtilization(
      TENANT,
      subscription({ seatsTotal: 10 }),
      [grant({ seats: 4 })],
      planned([["r-1", 5, "growth"]]),
    );
    expect(result.ok && result.projection.overageSeats).toBe(0);
    expect(result.ok && result.projection.utilizationBps).toBe(9000);
  });

  it("refuses empty assumptions, invalid seats, duplicate/empty request ids, non-active subscriptions", () => {
    const sub = subscription();
    const grants = [grant()];
    expect(projectSeatUtilization(TENANT, sub, grants, planned([["r-1", 1, "  "]]))).toMatchObject({
      ok: false,
      reasonCode: "ASSUMPTION_EMPTY",
    });
    expect(projectSeatUtilization(TENANT, sub, grants, planned([["r-1", 0, "a"]]))).toMatchObject({
      ok: false,
      reasonCode: "INVALID_SEATS",
    });
    expect(
      projectSeatUtilization(TENANT, sub, grants, planned([["r-1", 1, "a"], ["r-1", 1, "b"]])),
    ).toMatchObject({ ok: false, reasonCode: "REQUEST_ID_DUPLICATE" });
    expect(projectSeatUtilization(TENANT, sub, grants, planned([["", 1, "a"]]))).toMatchObject({
      ok: false,
      reasonCode: "REQUEST_ID_EMPTY",
    });
    expect(
      projectSeatUtilization(TENANT, subscription({ status: "cancelled" }), grants, planned([["r-1", 1, "a"]])),
    ).toMatchObject({ ok: false, reasonCode: "SUBSCRIPTION_NOT_ACTIVE" });
  });

  it("TENANT fail-closed: a foreign-tenant grant refuses the projection", () => {
    expect(
      projectSeatUtilization(TENANT, subscription(), [grant({ tenant: OTHER_TENANT })], [
        { requestId: "r-1", seats: 1, assumption: "a" },
      ]),
    ).toMatchObject({ ok: false, reasonCode: "TENANT_MISMATCH" });
  });
});

describe("allocateSeatsBatch — all-or-nothing overage refusals", () => {
  it("allocates in requestId lexical order with running totals", () => {
    const result = allocateSeatsBatch(
      TENANT,
      subscription({ seatsTotal: 10 }),
      [grant({ seats: 3 })],
      [
        { requestId: "r-2", seats: 4 },
        { requestId: "r-1", seats: 2 },
      ],
      1,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.heldBefore).toBe(3);
    expect(result.heldAfter).toBe(9);
    expect(result.allocations).toEqual([
      { requestId: "r-1", seats: 2, heldAfterStep: 5 },
      { requestId: "r-2", seats: 4, heldAfterStep: 9 },
    ]);
  });

  it("over-allocation REFUSES the whole batch with exact numbers and the first refused request", () => {
    const result = allocateSeatsBatch(
      TENANT,
      subscription({ seatsTotal: 5 }),
      [grant({ seats: 4 })],
      [
        { requestId: "r-1", seats: 1 }, // 5 — fits exactly
        { requestId: "r-2", seats: 1 }, // 6 — REFUSES the batch
      ],
      1,
    );
    expect(result).toMatchObject({
      ok: false,
      reasonCode: "SEAT_LIMIT_EXCEEDED",
      capacitySeats: 5,
      heldBefore: 4,
      requestedTotal: 2,
      overshootSeats: 1,
      firstRefusedRequestId: "r-2",
    });
  });

  it("filling capacity exactly is allowed (no premature refusal)", () => {
    const result = allocateSeatsBatch(
      TENANT,
      subscription({ seatsTotal: 5 }),
      [grant({ seats: 4 })],
      [{ requestId: "r-1", seats: 1 }],
      1,
    );
    expect(result.ok && result.heldAfter).toBe(5);
  });

  it("allocation respects the renewal window: refused after validUntil + grace, allowed inside it", () => {
    const sub = subscription();
    const request = [{ requestId: "r-1", seats: 1 }];
    const inside = allocateSeatsBatch(TENANT, sub, [], request, VALID_UNTIL_MS + GRACE_MS, GRACE_MS);
    expect(inside.ok).toBe(true);
    const outside = allocateSeatsBatch(TENANT, sub, [], request, VALID_UNTIL_MS + GRACE_MS + 1, GRACE_MS);
    expect(outside).toMatchObject({ ok: false, reasonCode: "SUBSCRIPTION_EXPIRED" });
    const noGrace = allocateSeatsBatch(TENANT, sub, [], request, VALID_UNTIL_MS + 1, 0);
    expect(noGrace).toMatchObject({ ok: false, reasonCode: "SUBSCRIPTION_EXPIRED" });
  });

  it("refuses non-active subscriptions, invalid requests, duplicates", () => {
    const sub = subscription();
    expect(allocateSeatsBatch(TENANT, subscription({ status: "cancelled" }), [], [], 1)).toMatchObject({
      ok: false,
      reasonCode: "SUBSCRIPTION_NOT_ACTIVE",
    });
    expect(allocateSeatsBatch(TENANT, sub, [], [{ requestId: "", seats: 1 }], 1)).toMatchObject({
      ok: false,
      reasonCode: "REQUEST_ID_EMPTY",
    });
    expect(
      allocateSeatsBatch(TENANT, sub, [], [{ requestId: "r-1", seats: 1 }, { requestId: "r-1", seats: 1 }], 1),
    ).toMatchObject({ ok: false, reasonCode: "REQUEST_ID_DUPLICATE" });
    expect(allocateSeatsBatch(TENANT, sub, [], [{ requestId: "r-1", seats: -2 }], 1)).toMatchObject({
      ok: false,
      reasonCode: "INVALID_SEATS",
    });
  });

  it("TENANT fail-closed: foreign tenant / foreign grants refuse the batch", () => {
    expect(
      allocateSeatsBatch(OTHER_TENANT, subscription(), [], [{ requestId: "r-1", seats: 1 }], 1),
    ).toMatchObject({ ok: false, reasonCode: "TENANT_MISMATCH" });
    expect(
      allocateSeatsBatch(TENANT, subscription(), [grant({ tenant: OTHER_TENANT })], [{ requestId: "r-1", seats: 1 }], 1),
    ).toMatchObject({ ok: false, reasonCode: "TENANT_MISMATCH" });
    expect(
      allocateSeatsBatch({ tenantId: "" }, subscription(), [], [], 1),
    ).toMatchObject({ ok: false, reasonCode: "TENANT_SCOPE_MISSING" });
  });
});
