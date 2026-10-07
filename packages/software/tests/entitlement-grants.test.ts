/**
 * @fleetos/software — Wave 2 (F220C) operational-truth grade tests:
 * catalog version lifecycle, entitlement grant lifecycle with seat
 * invariants, deterministic license compliance checks.
 */
import { describe, expect, it } from "vitest";
import {
  createCatalogEntry,
  transitionCatalogEntry,
  assignGrant,
  assignGrantWithinPopulation,
  revokeGrant,
  expireGrant,
  countHeldSeats,
  checkLicenseCompliance,
  type CatalogSoftwareEntry,
  type EntitlementGrant,
  type Subscription,
  type TenantScope,
} from "../src/index.js";

const TENANT: TenantScope = { tenantId: "acme" };
const OTHER_TENANT: TenantScope = { tenantId: "globex" };

function catalogEntry(overrides: Partial<CatalogSoftwareEntry> = {}): CatalogSoftwareEntry {
  return {
    id: "sw-1",
    tenant: TENANT,
    name: "FleetDiag",
    version: "1.2.3",
    status: "registered",
    deprecatedAt: null,
    retiredAt: null,
    ...overrides,
  };
}

function grant(overrides: Partial<EntitlementGrant> = {}): EntitlementGrant {
  return {
    id: "grant-1",
    tenant: TENANT,
    subscriptionId: "sub-1",
    catalogEntryId: "sw-1",
    assigneeId: null,
    seats: 1,
    status: "granted",
    grantedAt: 1000,
    assignedAt: null,
    revokedAt: null,
    revokedReason: null,
    expiresAt: null,
    ...overrides,
  };
}

function subscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: { kind: "subscription", value: "sub-1" },
    tenant: TENANT,
    sku: "SKU-1",
    seatsTotal: 2,
    status: "active",
    validFrom: "2026-01-01T00:00:00Z",
    validUntil: "2027-01-01T00:00:00Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Catalog version lifecycle.
// ---------------------------------------------------------------------------

describe("createCatalogEntry", () => {
  it("registers an entry with a valid MAJOR.MINOR.PATCH version", () => {
    const result = createCatalogEntry({
      id: "sw-9",
      tenant: TENANT,
      name: "NewTool",
      version: "2.0.0",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entry.status).toBe("registered");
      expect(result.entry.deprecatedAt).toBeNull();
    }
  });

  it.each(["1.2", "v1.2.3", "1.2.3.4", "latest", ""])(
    "refuses invalid version %s with INVALID_VERSION",
    (version) => {
      const result = createCatalogEntry({ id: "sw-9", tenant: TENANT, name: "X", version });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reasonCode).toBe("INVALID_VERSION");
    },
  );
});

describe("transitionCatalogEntry — registered → deprecated → retired", () => {
  it("walks the full legal path and stamps timestamps", () => {
    const deprecated = transitionCatalogEntry(catalogEntry(), { type: "deprecate", at: 5_000 });
    expect(deprecated.ok).toBe(true);
    if (deprecated.ok) {
      expect(deprecated.next.status).toBe("deprecated");
      expect(deprecated.next.deprecatedAt).toBe(5_000);
      const retired = transitionCatalogEntry(deprecated.next, { type: "retire", at: 9_000 });
      expect(retired.ok).toBe(true);
      if (retired.ok) {
        expect(retired.next.status).toBe("retired");
        expect(retired.next.retiredAt).toBe(9_000);
      }
    }
  });

  it("refuses retire from registered with ILLEGAL_TRANSITION (must deprecate first)", () => {
    const result = transitionCatalogEntry(catalogEntry(), { type: "retire", at: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe("ILLEGAL_TRANSITION");
  });

  it("refuses every command on a retired entry with TERMINAL_STATE", () => {
    const retired = catalogEntry({ status: "retired" });
    for (const command of [
      { type: "deprecate", at: 2 },
      { type: "retire", at: 2 },
    ] as const) {
      const result = transitionCatalogEntry(retired, command);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reasonCode).toBe("TERMINAL_STATE");
    }
  });

  it("transitions never mutate the input entry", () => {
    const input = catalogEntry();
    transitionCatalogEntry(input, { type: "deprecate", at: 5 });
    expect(input.status).toBe("registered");
    expect(input.deprecatedAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Entitlement grant lifecycle + seat invariants.
// ---------------------------------------------------------------------------

describe("assignGrant — lifecycle and gate refusals", () => {
  it("granted → assigned records the assignee and timestamp", () => {
    const result = assignGrant(grant(), catalogEntry(), subscription(), "user-1", 2_000);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.next.status).toBe("assigned");
      expect(result.next.assigneeId).toBe("user-1");
      expect(result.next.assignedAt).toBe(2_000);
    }
  });

  it.each([
    ["retired catalog", catalogEntry({ status: "retired" }), "CATALOG_RETIRED"],
    ["deprecated catalog", catalogEntry({ status: "deprecated" }), "CATALOG_DEPRECATED"],
    ["cancelled subscription", catalogEntry(), "SUBSCRIPTION_NOT_ACTIVE"],
  ])("refuses assignment on a %s", (_label, catalog, expected) => {
    const result = assignGrant(
      grant(),
      catalog,
      subscription({ status: "cancelled" }),
      "user-1",
      2_000,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe(expected);
  });

  it("refuses assignment on an expired subscription with SUBSCRIPTION_EXPIRED", () => {
    const result = assignGrant(
      grant(),
      catalogEntry(),
      subscription({ validUntil: "2026-01-01T00:00:00Z" }),
      "user-1",
      Date.parse("2026-06-01T00:00:00Z"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe("SUBSCRIPTION_EXPIRED");
  });

  it("refuses assignment with an empty assignee with ASSIGNEE_REQUIRED", () => {
    const result = assignGrant(grant(), catalogEntry(), subscription(), "", 2_000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe("ASSIGNEE_REQUIRED");
  });

  it("refuses a cross-tenant catalog entry with TENANT_MISMATCH", () => {
    const result = assignGrant(
      grant(),
      catalogEntry({ tenant: OTHER_TENANT }),
      subscription(),
      "user-1",
      2_000,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe("TENANT_MISMATCH");
  });

  it("refuses assignment of a single grant whose seats alone exceed seatsTotal", () => {
    const result = assignGrant(grant({ seats: 5 }), catalogEntry(), subscription({ seatsTotal: 2 }), "user-1", 2_000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe("SEATS_EXHAUSTED");
  });
});

describe("assignGrantWithinPopulation — the seat-count invariant", () => {
  it("assigns while the population fits within seatsTotal", () => {
    const grants = [
      grant({ id: "grant-a", seats: 1, status: "assigned", assigneeId: "user-1" }),
    ];
    const result = assignGrantWithinPopulation(grant({ id: "grant-b", seats: 1 }), grants, catalogEntry(), subscription(), "user-2", 2_000);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.heldSeatsAfter).toBe(2);
  });

  it("refuses over-assignment with the exact overshoot — never clamped", () => {
    const grants = [
      grant({ id: "grant-a", seats: 2, status: "assigned", assigneeId: "user-1" }),
    ];
    const result = assignGrantWithinPopulation(grant({ id: "grant-b", seats: 2 }), grants, catalogEntry(), subscription(), "user-2", 2_000);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("SEATS_EXHAUSTED");
      expect(result.overshootSeats).toBe(2);
    }
  });

  it("expired and revoked grants release their seats (invariant recovers)", () => {
    const grants = [
      grant({ id: "grant-a", seats: 2, status: "expired" }),
    ];
    const result = assignGrantWithinPopulation(grant({ id: "grant-b", seats: 2 }), grants, catalogEntry(), subscription(), "user-2", 2_000);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.heldSeatsAfter).toBe(2);
  });
});

describe("countHeldSeats", () => {
  it("counts only granted/assigned grants for the subscription", () => {
    const grants = [
      grant({ id: "g-1", seats: 2 }),
      grant({ id: "g-2", seats: 3, status: "assigned" }),
      grant({ id: "g-3", seats: 4, status: "revoked" }),
      grant({ id: "g-4", seats: 5, status: "expired" }),
      grant({ id: "g-5", seats: 6, subscriptionId: "sub-2" }),
    ];
    expect(countHeldSeats("sub-1", grants)).toBe(5);
  });
});

describe("revokeGrant / expireGrant", () => {
  it("revokes a granted (or assigned) grant with a reason and releases seats", () => {
    const result = revokeGrant(grant(), "audit finding", 3_000);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.next.status).toBe("revoked");
      expect(result.next.revokedReason).toBe("audit finding");
      expect(result.next.revokedAt).toBe(3_000);
      expect(countHeldSeats("sub-1", [result.next])).toBe(0);
    }
    const assigned = revokeGrant(grant({ status: "assigned", assigneeId: "u1" }), "offboarded", 3_000);
    expect(assigned.ok).toBe(true);
    if (assigned.ok) expect(assigned.next.assigneeId).toBeNull();
  });

  it("refuses revocation without a reason with REVOCATION_REASON_REQUIRED", () => {
    const result = revokeGrant(grant(), "  ", 3_000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe("REVOCATION_REASON_REQUIRED");
  });

  it("expires a granted or assigned grant (terminal) and releases seats", () => {
    const result = expireGrant(grant({ status: "assigned", assigneeId: "u1" }), 4_000);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.next.status).toBe("expired");
      expect(countHeldSeats("sub-1", [result.next])).toBe(0);
    }
  });

  it.each([
    ["revoke a revoked grant", revokeGrant, "revoked", "TERMINAL_STATE"],
    ["revoke an expired grant", revokeGrant, "expired", "TERMINAL_STATE"],
  ])("refuses %s", (_label, fn, status, expected) => {
    const result = fn(grant({ status: status as EntitlementGrant["status"] }), "reason", 5_000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe(expected);
  });

  it("refuses expire on an already-expired grant with TERMINAL_STATE", () => {
    const result = expireGrant(grant({ status: "expired" }), 5_000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe("TERMINAL_STATE");
  });

  it("refuses assignment from a revoked grant with TERMINAL_STATE (not generic illegal)", () => {
    const result = assignGrant(grant({ status: "revoked" }), catalogEntry(), subscription(), "user-1", 2_000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe("TERMINAL_STATE");
  });

  it("refuses assignment from an assigned grant with ILLEGAL_TRANSITION", () => {
    const result = assignGrant(grant({ status: "assigned", assigneeId: "u1" }), catalogEntry(), subscription(), "user-2", 2_000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe("ILLEGAL_TRANSITION");
  });
});

// ---------------------------------------------------------------------------
// License compliance — deterministic rule evaluation.
// ---------------------------------------------------------------------------

describe("checkLicenseCompliance", () => {
  it("a clean population is compliant with exact seat counts", () => {
    const grants = [grant({ id: "g-1", seats: 1, status: "assigned", assigneeId: "u1" }), grant({ id: "g-2", seats: 1 })];
    const report = checkLicenseCompliance(subscription(), grants, [catalogEntry()], 0);
    expect(report.compliant).toBe(true);
    expect(report.violations).toEqual([]);
    expect(report.seatsHeld).toBe(2);
    expect(report.seatsTotal).toBe(2);
  });

  it("flags grants held on a RETIRED catalog version", () => {
    const grants = [grant({ seats: 1 })];
    const report = checkLicenseCompliance(subscription(), grants, [catalogEntry({ status: "retired" })], 0);
    expect(report.compliant).toBe(false);
    expect(report.violations[0]?.code).toBe("CATALOG_RETIRED_IN_USE");
  });

  it("flags grants held on a DEPRECATED catalog version", () => {
    const grants = [grant({ seats: 1 })];
    const report = checkLicenseCompliance(subscription(), grants, [catalogEntry({ status: "deprecated" })], 0);
    expect(report.compliant).toBe(false);
    expect(report.violations[0]?.code).toBe("CATALOG_DEPRECATED_IN_USE");
  });

  it("flags an inactive subscription", () => {
    const report = checkLicenseCompliance(subscription({ status: "cancelled" }), [], [], 0);
    expect(report.compliant).toBe(false);
    expect(report.violations[0]?.code).toBe("SUBSCRIPTION_NOT_ACTIVE");
  });

  it("flags an expired subscription (deterministic from timestamps)", () => {
    const report = checkLicenseCompliance(
      subscription({ validUntil: "2026-01-01T00:00:00Z" }),
      [],
      [],
      Date.parse("2026-06-01T00:00:00Z"),
    );
    expect(report.compliant).toBe(false);
    expect(report.violations[0]?.code).toBe("SUBSCRIPTION_EXPIRED");
  });

  it("flags over-assigned seats with the exact overshoot in the detail", () => {
    const grants = [grant({ id: "g-1", seats: 3 })];
    const report = checkLicenseCompliance(subscription({ seatsTotal: 2 }), grants, [], 0);
    expect(report.compliant).toBe(false);
    const over = report.violations.find((v) => v.code === "OVER_ASSIGNED_SEATS");
    expect(over?.detail).toContain("by 1");
    expect(report.seatsHeld).toBe(3);
  });

  it("ignores revoked/expired grants and other-tenant catalog entries", () => {
    const grants = [
      grant({ id: "g-1", seats: 9, status: "revoked" }),
      grant({ id: "g-2", seats: 9, status: "expired" }),
    ];
    const catalog = [catalogEntry({ id: "sw-1", status: "retired", tenant: OTHER_TENANT })];
    const report = checkLicenseCompliance(subscription(), grants, catalog, 0);
    expect(report.compliant).toBe(true);
    expect(report.seatsHeld).toBe(0);
  });

  it("is deterministic: identical inputs produce identical reports", () => {
    const grants = [grant({ seats: 1 }), grant({ id: "g-2", seats: 2, status: "assigned", assigneeId: "u1" })];
    const catalog = [catalogEntry({ status: "deprecated" })];
    const a = checkLicenseCompliance(subscription({ seatsTotal: 1 }), grants, catalog, 42);
    const b = checkLicenseCompliance(subscription({ seatsTotal: 1 }), grants, catalog, 42);
    expect(a).toEqual(b);
  });
});
