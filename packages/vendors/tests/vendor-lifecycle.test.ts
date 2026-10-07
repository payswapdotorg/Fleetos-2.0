/**
 * @fleetos/vendors — Wave 2 (F220C) operational-truth grade tests:
 * vendor lifecycle + reinstatement rules, capability catalog (declared
 * vs verified), KPI rollups in basis points, service exposure limits.
 */
import { describe, expect, it } from "vitest";
import {
  transitionVendorLifecycle,
  commitServiceExposure,
  releaseServiceExposure,
  verifyCapability,
  capabilityCatalogSummary,
  rollupVendorKpis,
  type VendorLifecycleRecord,
  type ServiceExposureLedger,
  type VendorCapabilityRecord,
  type FulfillmentOutcomeRecord,
  type TenantScope,
} from "../src/index.js";

const TENANT: TenantScope = { tenantId: "acme" };
const OTHER_TENANT: TenantScope = { tenantId: "globex" };

function vendor(overrides: Partial<VendorLifecycleRecord> = {}): VendorLifecycleRecord {
  return {
    vendorId: "v-alpha",
    tenant: TENANT,
    displayName: "Alpha Services",
    status: "prospective",
    suspendedReason: null,
    terminatedReason: null,
    terminatedAt: null,
    reinstatementCount: 0,
    ...overrides,
  };
}

function exposure(overrides: Partial<ServiceExposureLedger> = {}): ServiceExposureLedger {
  return {
    vendorId: "v-alpha",
    tenant: TENANT,
    relationshipStatus: "active",
    limitMinorUnits: 1_000_000,
    committedMinorUnits: 0,
    ...overrides,
  };
}

function capability(overrides: Partial<VendorCapabilityRecord> = {}): VendorCapabilityRecord {
  return {
    vendorId: "v-alpha",
    tenant: TENANT,
    tag: "diagnostics",
    status: "declared",
    verifiedAt: null,
    evidence: null,
    ...overrides,
  };
}

function outcome(overrides: Partial<FulfillmentOutcomeRecord> = {}): FulfillmentOutcomeRecord {
  return {
    vendorId: "v-alpha",
    tenant: TENANT,
    orderId: "order-1",
    promisedAt: 5_000,
    deliveredAt: 4_900,
    quantityOrdered: 10,
    quantityReceived: 10,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Vendor lifecycle with reinstatement rules.
// ---------------------------------------------------------------------------

describe("transitionVendorLifecycle — legal path", () => {
  it("prospective → active → suspended → (reinstated) active", () => {
    const active = transitionVendorLifecycle(vendor(), { type: "activate" });
    expect(active.ok).toBe(true);
    if (active.ok) {
      expect(active.next.status).toBe("active");
      const suspended = transitionVendorLifecycle(active.next, { type: "suspend", reason: "SLA breach" });
      expect(suspended.ok).toBe(true);
      if (suspended.ok) {
        expect(suspended.next.status).toBe("suspended");
        expect(suspended.next.suspendedReason).toBe("SLA breach");
        const reinstated = transitionVendorLifecycle(suspended.next, { type: "reinstate", reason: "remediation verified" });
        expect(reinstated.ok).toBe(true);
        if (reinstated.ok) {
          expect(reinstated.next.status).toBe("active");
          expect(reinstated.next.reinstatementCount).toBe(1);
          expect(reinstated.next.suspendedReason).toBeNull();
        }
      }
    }
  });

  it("suspension → termination from every non-terminal status is legal", () => {
    for (const status of ["prospective", "active", "suspended"] as const) {
      const result = transitionVendorLifecycle(vendor({ status }), { type: "terminate", reason: "contract ended", at: 9_000 });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.next.status).toBe("terminated");
        expect(result.next.terminatedAt).toBe(9_000);
      }
    }
  });

  it("transitions never mutate the input record", () => {
    const input = vendor();
    transitionVendorLifecycle(input, { type: "activate" });
    expect(input.status).toBe("prospective");
    expect(input.reinstatementCount).toBe(0);
  });
});

describe("transitionVendorLifecycle — refusals", () => {
  it("a TERMINATED vendor refuses every command with TERMINAL_STATE (no reinstatement)", () => {
    const terminated = vendor({ status: "terminated", terminatedAt: 1 });
    for (const command of [
      { type: "activate" },
      { type: "suspend", reason: "x" },
      { type: "reinstate", reason: "please" },
      { type: "terminate", reason: "again", at: 2 },
    ] as const) {
      const result = transitionVendorLifecycle(terminated, command);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reasonCode).toBe("TERMINAL_STATE");
    }
  });

  const illegalCases: readonly (readonly [
    string,
    Parameters<typeof transitionVendorLifecycle>[1],
    VendorLifecycleRecord["status"],
  ])[] = [
    ["suspend from prospective (not yet active)", { type: "suspend", reason: "x" }, "prospective"],
    ["activate from active (already active)", { type: "activate" }, "active"],
    ["reinstate from active (not suspended)", { type: "reinstate", reason: "x" }, "active"],
    ["activate from suspended (must reinstate)", { type: "activate" }, "suspended"],
  ];
  it.each(illegalCases)("refuses %s with ILLEGAL_TRANSITION", (_label, command, status) => {
    const result = transitionVendorLifecycle(vendor({ status }), command);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe("ILLEGAL_TRANSITION");
  });

  const reasonRequiredCases: readonly (readonly [
    string,
    Parameters<typeof transitionVendorLifecycle>[1],
    VendorLifecycleRecord["status"],
    string,
  ])[] = [
    ["suspend without reason", { type: "suspend", reason: " " }, "active", "SUSPEND_REASON_REQUIRED"],
    ["terminate without reason", { type: "terminate", reason: "", at: 1 }, "active", "TERMINATE_REASON_REQUIRED"],
    ["reinstate without reason", { type: "reinstate", reason: " " }, "suspended", "REINSTATE_REASON_REQUIRED"],
  ];
  it.each(reasonRequiredCases)("refuses %s", (_label, command, status, expected) => {
    const result = transitionVendorLifecycle(vendor({ status }), command);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Service exposure limits.
// ---------------------------------------------------------------------------

describe("commitServiceExposure / releaseServiceExposure", () => {
  it("commits exposure up to the limit and releases it EXACTLY (round-trip)", () => {
    const c1 = commitServiceExposure(exposure(), 400_000);
    expect(c1.ok).toBe(true);
    if (c1.ok) {
      expect(c1.ledger.committedMinorUnits).toBe(400_000);
      const c2 = commitServiceExposure(c1.ledger, 600_000);
      expect(c2.ok).toBe(true);
      if (c2.ok) {
        expect(c2.ledger.committedMinorUnits).toBe(1_000_000);
        const r = releaseServiceExposure(c2.ledger, 1_000_000);
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.ledger.committedMinorUnits).toBe(0);
      }
    }
  });

  it("refuses exposure beyond the limit with the exact overshoot — never clamped", () => {
    const result = commitServiceExposure(exposure({ committedMinorUnits: 700_000 }), 400_000);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("EXPOSURE_LIMIT_EXCEEDED");
      expect(result.overshootMinorUnits).toBe(100_000);
    }
  });

  it("refuses new commitments on a suspended or terminated relationship", () => {
    for (const relationshipStatus of ["suspended", "terminated"] as const) {
      const result = commitServiceExposure(exposure({ relationshipStatus }), 1);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reasonCode).toBe("RELATIONSHIP_NOT_ACTIVE");
    }
  });

  it("refuses releasing more than committed with RELEASE_EXCEEDS_COMMITTED", () => {
    const result = releaseServiceExposure(exposure({ committedMinorUnits: 100 }), 200);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("RELEASE_EXCEEDS_COMMITTED");
      expect(result.overshootMinorUnits).toBe(100);
    }
  });

  it.each([
    ["zero amount", 0, "ZERO_AMOUNT"],
    ["negative amount", -5, "NEGATIVE_AMOUNT"],
    ["non-integer amount", 10.5, "NEGATIVE_AMOUNT"],
  ])("refuses a %s on commit", (_label, amount, expected) => {
    const result = commitServiceExposure(exposure(), amount);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Capability catalog: declared vs verified.
// ---------------------------------------------------------------------------

describe("verifyCapability", () => {
  it("verifies a declared capability with same-tenant evidence and stamps verifiedAt", () => {
    const result = verifyCapability([capability()], "v-alpha", "diagnostics", { evidenceId: "ev-1", tenantId: "acme" }, 5_000);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.records[0]?.status).toBe("verified");
      expect(result.records[0]?.verifiedAt).toBe(5_000);
      expect(result.records[0]?.evidence?.evidenceId).toBe("ev-1");
    }
  });

  it("refuses verification without evidence with VERIFICATION_EVIDENCE_REQUIRED (declaration is not verification)", () => {
    const result = verifyCapability([capability()], "v-alpha", "diagnostics", null, 5_000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe("VERIFICATION_EVIDENCE_REQUIRED");
  });

  it("refuses cross-tenant evidence with VERIFICATION_EVIDENCE_TENANT_MISMATCH", () => {
    const result = verifyCapability([capability()], "v-alpha", "diagnostics", { evidenceId: "ev-9", tenantId: "globex" }, 5_000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe("VERIFICATION_EVIDENCE_TENANT_MISMATCH");
  });

  it("refuses double verification with ALREADY_VERIFIED", () => {
    const verified = capability({ status: "verified", verifiedAt: 1, evidence: { evidenceId: "ev-0", tenantId: "acme" } });
    const result = verifyCapability([verified], "v-alpha", "diagnostics", { evidenceId: "ev-1", tenantId: "acme" }, 5_000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe("ALREADY_VERIFIED");
  });

  it("refuses an unknown vendor/tag pair with UNKNOWN_CAPABILITY", () => {
    const result = verifyCapability([capability()], "v-beta", "diagnostics", { evidenceId: "ev-1", tenantId: "acme" }, 5_000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe("UNKNOWN_CAPABILITY");
  });

  it("verifyCapability never mutates the input records", () => {
    const input = [capability()];
    verifyCapability(input, "v-alpha", "diagnostics", { evidenceId: "ev-1", tenantId: "acme" }, 5_000);
    expect(input[0]?.status).toBe("declared");
  });
});

describe("capabilityCatalogSummary", () => {
  it("counts declared vs verified per vendor within the tenant only", () => {
    const records = [
      capability({ tag: "diagnostics" }),
      capability({ tag: "repair" }),
      capability({ tag: "calibration", status: "verified", verifiedAt: 1, evidence: { evidenceId: "ev", tenantId: "acme" } }),
      capability({ vendorId: "v-beta", tag: "diagnostics" }),
      capability({ vendorId: "v-alpha", tenant: OTHER_TENANT, tag: "other-tenant" }),
    ];
    const summary = capabilityCatalogSummary(TENANT, records, "v-alpha");
    expect(summary.declaredCount).toBe(2);
    expect(summary.verifiedCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// KPI rollups from fulfillment outcomes.
// ---------------------------------------------------------------------------

describe("rollupVendorKpis — integer basis points", () => {
  it("computes on-time ratio and fill rate as integer bps", () => {
    const records = [
      outcome({ orderId: "o-1", promisedAt: 5000, deliveredAt: 4900, quantityOrdered: 10, quantityReceived: 10 }),
      outcome({ orderId: "o-2", promisedAt: 5000, deliveredAt: 5100, quantityOrdered: 10, quantityReceived: 9 }),
      outcome({ orderId: "o-3", promisedAt: 5000, deliveredAt: 5000, quantityOrdered: 10, quantityReceived: 10 }),
    ];
    const result = rollupVendorKpis(TENANT, records, "v-alpha");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rollup.outcomeCount).toBe(3);
      expect(result.rollup.onTimeCount).toBe(2); // deliveredAt <= promisedAt (o-3 counts as on time)
      expect(result.rollup.onTimeRatioBps).toBe(6666); // floor(2*10000/3)
      expect(result.rollup.quantityOrderedTotal).toBe(30);
      expect(result.rollup.quantityReceivedTotal).toBe(29);
      expect(result.rollup.fillRateBps).toBe(9666); // floor(29*10000/30)
      expect(Number.isInteger(result.rollup.onTimeRatioBps)).toBe(true);
      expect(Number.isInteger(result.rollup.fillRateBps)).toBe(true);
    }
  });

  it("ignores other tenants' and other vendors' outcomes (tenant-scoped)", () => {
    const records = [
      outcome({ orderId: "o-1" }),
      outcome({ orderId: "o-2", tenant: OTHER_TENANT }),
      outcome({ orderId: "o-3", vendorId: "v-beta" }),
    ];
    const result = rollupVendorKpis(TENANT, records, "v-alpha");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rollup.outcomeCount).toBe(1);
  });

  it("refuses an empty performance history with EMPTY_PERFORMANCE_HISTORY", () => {
    const result = rollupVendorKpis(TENANT, [], "v-alpha");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe("EMPTY_PERFORMANCE_HISTORY");
  });

  it("refuses negative quantities with NEGATIVE_QUANTITY", () => {
    const result = rollupVendorKpis(TENANT, [outcome({ quantityReceived: -1 })], "v-alpha");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe("NEGATIVE_QUANTITY");
  });

  it("is deterministic across input orderings", () => {
    const records = [
      outcome({ orderId: "o-1", deliveredAt: 6000, quantityReceived: 5 }),
      outcome({ orderId: "o-2", deliveredAt: 4000, quantityReceived: 10 }),
      outcome({ orderId: "o-3", deliveredAt: 5000, quantityReceived: 7 }),
    ];
    expect(rollupVendorKpis(TENANT, records, "v-alpha")).toEqual(
      rollupVendorKpis(TENANT, [...records].reverse(), "v-alpha"),
    );
  });
});
