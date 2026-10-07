import { describe, expect, it } from "vitest";
import {
  aggregateScorecard,
  validateTenantScope,
  vendorHasCapability,
  type TenantScope,
  type Vendor,
  type VendorScorecard,
  type MetricScore,
  type VendorId,
} from "../src/index.js";

const TENANT: TenantScope = { tenantId: "acme" };
const VENDOR_ID: VendorId = { kind: "vendor", value: "v-1" };

function metric(overrides: Partial<MetricScore> = {}): MetricScore {
  return { metric: "delivery-time", score: 0.9, observedAt: "2026-01-01", ...overrides };
}

function scorecard(
  overrides: Partial<VendorScorecard> = {},
): VendorScorecard {
  return {
    vendorId: VENDOR_ID,
    tenant: TENANT,
    metricScores: [metric()],
    ...overrides,
  };
}

function vendor(overrides: Partial<Vendor> = {}): Vendor {
  return {
    id: VENDOR_ID,
    tenant: TENANT,
    displayName: "Acme Pumps",
    status: "active",
    capabilityTags: ["industrial-pump", "stainless-steel"],
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

describe("aggregateScorecard — worst-wins where honest", () => {
  it("returns the worst observed metric score as the aggregate", () => {
    const sc = scorecard({
      metricScores: [
        metric({ metric: "delivery-time", score: 0.95 }),
        metric({ metric: "quality", score: 0.4 }),
        metric({ metric: "support", score: 0.85 }),
      ],
    });
    const r = aggregateScorecard(sc);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.aggregate.worstScore).toBe(0.4);
      expect(r.aggregate.worstMetric).toBe("quality");
      expect(r.aggregate.observationCount).toBe(3);
    }
  });

  it("refuses an empty scorecard with EMPTY_SCORECARD", () => {
    const r = aggregateScorecard(scorecard({ metricScores: [] }));
    expect(r).toEqual({ ok: false, reasonCode: "EMPTY_SCORECARD" });
  });

  it("refuses out-of-range scores with SCORE_OUT_OF_RANGE, never clamping", () => {
    const r = aggregateScorecard(
      scorecard({
        metricScores: [metric({ score: 1.5 })],
      }),
    );
    expect(r).toEqual({ ok: false, reasonCode: "SCORE_OUT_OF_RANGE" });
  });

  it("refuses negative scores with SCORE_OUT_OF_RANGE, never clamping", () => {
    const r = aggregateScorecard(
      scorecard({
        metricScores: [metric({ score: -0.1 })],
      }),
    );
    expect(r).toEqual({ ok: false, reasonCode: "SCORE_OUT_OF_RANGE" });
  });

  it("refuses with TENANT_SCOPE_MISSING when tenant is broken", () => {
    const broken = scorecard({
      tenant: { tenantId: "" } as unknown as TenantScope,
    });
    const r = aggregateScorecard(broken);
    expect(r).toEqual({ ok: false, reasonCode: "TENANT_SCOPE_MISSING" });
  });

  it("refuses with TENANT_MISMATCH when vendorId is malformed", () => {
    const r = aggregateScorecard(
      scorecard({ vendorId: { kind: "vendor", value: "bad-id" } }),
    );
    expect(r).toEqual({ ok: false, reasonCode: "TENANT_MISMATCH" });
  });
});

describe("aggregateScorecard — determinism", () => {
  it("returns the same aggregate for the same inputs across calls", () => {
    const sc = scorecard({
      metricScores: [metric({ score: 0.7 }), metric({ score: 0.5 })],
    });
    expect(aggregateScorecard(sc)).toEqual(aggregateScorecard(sc));
  });
});

describe("vendorHasCapability", () => {
  it("returns true when the vendor has the capability tag", () => {
    expect(vendorHasCapability(vendor(), "industrial-pump")).toBe(true);
  });

  it("returns false when the vendor does not have the tag", () => {
    expect(vendorHasCapability(vendor(), "rocket-motor")).toBe(false);
  });

  it("returns false when the tenant scope is broken (fail-closed)", () => {
    expect(
      vendorHasCapability(
        vendor({ tenant: { tenantId: "" } as unknown as TenantScope }),
        "industrial-pump",
      ),
    ).toBe(false);
  });
});
