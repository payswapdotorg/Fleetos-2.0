/**
 * @fleetos/vendors — Wave 1 kernel-grade tests.
 */
import { describe, expect, it } from "vitest";
import {
  transitionServiceRelationship,
  aggregateScorecard,
  capabilityMatchingFeed,
  vendorHasCapability,
  createVendorDirectory,
  createInMemoryVendorRepository,
  type Vendor,
  type VendorServiceRelationship,
  type VendorScorecard,
  type TenantScope,
} from "../src/index.js";

const TENANT: TenantScope = { tenantId: "acme" };

function baseVendor(overrides: Partial<Vendor> = {}): Vendor {
  return {
    id: { kind: "vendor", value: "v-1" },
    tenant: TENANT,
    displayName: "Acme Pumps",
    status: "active",
    capabilityTags: ["pump", "industrial"],
    ...overrides,
  };
}

function baseRelationship(overrides: Partial<VendorServiceRelationship> = {}): VendorServiceRelationship {
  return {
    vendorId: { kind: "vendor", value: "v-1" },
    tenant: TENANT,
    startedAt: "2026-01-01T00:00:00Z",
    endedAt: null,
    contractRef: "contract-1",
    status: "active",
    ...overrides,
  };
}

function baseScorecard(overrides: Partial<VendorScorecard> = {}): VendorScorecard {
  return {
    vendorId: { kind: "vendor", value: "v-1" },
    tenant: TENANT,
    metricScores: [
      { metric: "on_time", score: 0.9, observedAt: "2026-01-01T00:00:00Z" },
      { metric: "quality", score: 0.7, observedAt: "2026-01-01T00:00:00Z" },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Service-relationship lifecycle.
// ---------------------------------------------------------------------------

describe("transitionServiceRelationship — legal transitions", () => {
  it("active -> suspended on suspend with reason", () => {
    const next = transitionServiceRelationship(baseRelationship(), {
      type: "suspend",
      reason: "performance issues",
    });
    expect(next.ok).toBe(true);
    if (next.ok) expect(next.next.status).toBe("suspended");
  });

  it("suspended -> active on resume", () => {
    const next = transitionServiceRelationship(
      baseRelationship({ status: "suspended" }),
      { type: "resume" },
    );
    expect(next.ok).toBe(true);
    if (next.ok) expect(next.next.status).toBe("active");
  });

  it("active -> terminated on terminate with reason and endedAt", () => {
    const next = transitionServiceRelationship(baseRelationship(), {
      type: "terminate",
      reason: "contract expired",
      endedAt: "2026-02-01T00:00:00Z",
    });
    expect(next.ok).toBe(true);
    if (next.ok) {
      expect(next.next.status).toBe("terminated");
      expect(next.next.endedAt).toBe("2026-02-01T00:00:00Z");
    }
  });
});

describe("transitionServiceRelationship — illegal transitions refused", () => {
  it("refuses suspend without a reason with SUSPEND_REASON_REQUIRED", () => {
    const next = transitionServiceRelationship(baseRelationship(), {
      type: "suspend",
      reason: "   ",
    });
    expect(next).toEqual({ ok: false, reasonCode: "SUSPEND_REASON_REQUIRED" });
  });

  it("refuses terminate without a reason with TERMINATE_REASON_REQUIRED", () => {
    const next = transitionServiceRelationship(baseRelationship(), {
      type: "terminate",
      reason: "",
      endedAt: "2026-02-01T00:00:00Z",
    });
    expect(next).toEqual({ ok: false, reasonCode: "TERMINATE_REASON_REQUIRED" });
  });

  it("refuses resume from active with ILLEGAL_TRANSITION", () => {
    const next = transitionServiceRelationship(baseRelationship(), { type: "resume" });
    expect(next).toEqual({ ok: false, reasonCode: "ILLEGAL_TRANSITION" });
  });

  it("refuses on broken tenant with TENANT_SCOPE_MISSING", () => {
    const next = transitionServiceRelationship(
      baseRelationship({ tenant: { tenantId: "" } as unknown as TenantScope }),
      { type: "suspend", reason: "x" },
    );
    expect(next).toEqual({ ok: false, reasonCode: "TENANT_SCOPE_MISSING" });
  });
});

// ---------------------------------------------------------------------------
// Scorecard aggregation — WORST-WINS.
// ---------------------------------------------------------------------------

describe("aggregateScorecard — worst-wins honesty", () => {
  it("returns the worst score and the metric that produced it", () => {
    const result = aggregateScorecard(baseScorecard());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.aggregate.worstScore).toBe(0.7);
      expect(result.aggregate.worstMetric).toBe("quality");
      expect(result.aggregate.observationCount).toBe(2);
    }
  });

  it("refuses with EMPTY_SCORECARD when no metric scores", () => {
    const result = aggregateScorecard(baseScorecard({ metricScores: [] }));
    expect(result).toEqual({ ok: false, reasonCode: "EMPTY_SCORECARD" });
  });

  it("refuses with SCORE_OUT_OF_RANGE when a score is < 0", () => {
    const result = aggregateScorecard(
      baseScorecard({
        metricScores: [{ metric: "x", score: -0.1, observedAt: "2026-01-01T00:00:00Z" }],
      }),
    );
    expect(result).toEqual({ ok: false, reasonCode: "SCORE_OUT_OF_RANGE" });
  });

  it("refuses with SCORE_OUT_OF_RANGE when a score is > 1", () => {
    const result = aggregateScorecard(
      baseScorecard({
        metricScores: [{ metric: "x", score: 1.5, observedAt: "2026-01-01T00:00:00Z" }],
      }),
    );
    expect(result).toEqual({ ok: false, reasonCode: "SCORE_OUT_OF_RANGE" });
  });

  it("refuses with TENANT_SCOPE_MISSING on broken tenant", () => {
    const result = aggregateScorecard(
      baseScorecard({ tenant: { tenantId: "" } as unknown as TenantScope }),
    );
    expect(result).toEqual({ ok: false, reasonCode: "TENANT_SCOPE_MISSING" });
  });

  it("is deterministic — same inputs produce the same result", () => {
    expect(aggregateScorecard(baseScorecard())).toEqual(aggregateScorecard(baseScorecard()));
  });
});

// ---------------------------------------------------------------------------
// Capability matching feed.
// ---------------------------------------------------------------------------

describe("capabilityMatchingFeed — deterministic, tenant-scoped", () => {
  it("returns refs for active vendors with at least one matching tag", () => {
    const vendors = [
      baseVendor({ id: { kind: "vendor", value: "v-1" }, capabilityTags: ["pump"] }),
      baseVendor({ id: { kind: "vendor", value: "v-2" }, capabilityTags: ["unrelated"] }),
      baseVendor({ id: { kind: "vendor", value: "v-3" }, capabilityTags: ["pump", "industrial"] }),
    ];
    const feed = capabilityMatchingFeed(TENANT, vendors, [], ["pump"]);
    expect(feed.length).toBe(2);
    expect(feed[0]?.vendorId).toBe("v-1");
    expect(feed[1]?.vendorId).toBe("v-3");
  });

  it("skips non-active vendors", () => {
    const vendors = [
      baseVendor({ id: { kind: "vendor", value: "v-1" }, status: "suspended", capabilityTags: ["pump"] }),
    ];
    const feed = capabilityMatchingFeed(TENANT, vendors, [], ["pump"]);
    expect(feed).toEqual([]);
  });

  it("skips cross-tenant vendors", () => {
    const other: TenantScope = { tenantId: "other" };
    const vendors = [
      baseVendor({ id: { kind: "vendor", value: "v-1" }, tenant: other, capabilityTags: ["pump"] }),
    ];
    const feed = capabilityMatchingFeed(TENANT, vendors, [], ["pump"]);
    expect(feed).toEqual([]);
  });

  it("uses the scorecard worst score as service level", () => {
    const vendors = [baseVendor({ capabilityTags: ["pump"] })];
    const scorecards = [baseScorecard()];
    const feed = capabilityMatchingFeed(TENANT, vendors, scorecards, ["pump"]);
    expect(feed[0]?.serviceLevel).toBe(0.7);
  });

  it("defaults service level to 0.5 when no scorecard exists", () => {
    const vendors = [baseVendor({ capabilityTags: ["pump"] })];
    const feed = capabilityMatchingFeed(TENANT, vendors, [], ["pump"]);
    expect(feed[0]?.serviceLevel).toBe(0.5);
  });

  it("is deterministic across calls", () => {
    const vendors = [baseVendor({ capabilityTags: ["pump"] })];
    expect(capabilityMatchingFeed(TENANT, vendors, [], ["pump"]))
      .toEqual(capabilityMatchingFeed(TENANT, vendors, [], ["pump"]));
  });
});

describe("vendorHasCapability", () => {
  it("returns true when the vendor has the capability", () => {
    expect(vendorHasCapability(baseVendor(), "pump")).toBe(true);
  });

  it("returns false when the vendor does not have the capability", () => {
    expect(vendorHasCapability(baseVendor(), "forklift")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// VendorDirectory over in-memory repository.
// ---------------------------------------------------------------------------

describe("VendorDirectory over InMemoryVendorRepository", () => {
  it("transitionServiceRelationship persists and emits an audit event", async () => {
    const repo = createInMemoryVendorRepository(
      [baseVendor()],
      [baseRelationship()],
    );
    const directory = createVendorDirectory(repo);
    const result = await directory.transitionServiceRelationship(
      TENANT,
      { kind: "vendor", value: "v-1" },
      { type: "suspend", reason: "perf" },
      { occurredAt: "2026-01-02T00:00:00Z" },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.relationship?.status).toBe("suspended");
      expect(result.auditEvents[0]?.kind).toBe("vendor.service-relationship-transitioned");
    }
  });

  it("aggregateScorecard returns the aggregate and emits an audit event", async () => {
    const repo = createInMemoryVendorRepository(
      [baseVendor()],
      [],
      [baseScorecard()],
    );
    const directory = createVendorDirectory(repo);
    const result = await directory.aggregateScorecard(TENANT, { kind: "vendor", value: "v-1" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.aggregate?.worstScore).toBe(0.7);
      expect(result.auditEvents[0]?.kind).toBe("vendor.scorecard-aggregated");
    }
  });

  it("capabilityMatchingFeed returns the feed and emits an audit event", async () => {
    const repo = createInMemoryVendorRepository(
      [baseVendor()],
      [],
      [baseScorecard()],
    );
    const directory = createVendorDirectory(repo);
    const result = await directory.capabilityMatchingFeed(
      TENANT,
      ["pump"],
      { occurredAt: "2026-01-02T00:00:00Z" },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.feed?.length).toBe(1);
      expect(result.auditEvents[0]?.kind).toBe("vendor.capability-feed-produced");
    }
  });

  it("getVendor returns null for cross-tenant (fail-closed)", async () => {
    const repo = createInMemoryVendorRepository([baseVendor()]);
    const directory = createVendorDirectory(repo);
    const item = await directory.getVendor({ tenantId: "other" }, { kind: "vendor", value: "v-1" });
    expect(item).toBeNull();
  });

  it("refuses transition for unknown relationship with SERVICE_RELATIONSHIP_NOT_FOUND", async () => {
    const repo = createInMemoryVendorRepository([baseVendor()]);
    const directory = createVendorDirectory(repo);
    const result = await directory.transitionServiceRelationship(
      TENANT,
      { kind: "vendor", value: "v-1" },
      { type: "suspend", reason: "x" },
      { occurredAt: "2026-01-02T00:00:00Z" },
    );
    expect(result).toEqual({ ok: false, reasonCode: "SERVICE_RELATIONSHIP_NOT_FOUND" });
  });
});
