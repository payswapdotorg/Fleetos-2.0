import { describe, expect, it } from "vitest";
import {
  createDeterministicExternalVendorAdapter,
  isExternalProjection,
  projectionDoesNotOwnDomainTruth,
  validateTenantScope,
  type TenantScope,
  type ExternalQuery,
} from "../src/index.js";

const TENANT: TenantScope = { tenantId: "acme" };

function query(externalRef = "ext-1"): ExternalQuery {
  return { tenant: TENANT, sourceSystem: "acme-erp", externalRef };
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

describe("deterministic external vendor reference adapter", () => {
  it("returns a projection tagged kind=external-projection for a known ref", () => {
    const adapter = createDeterministicExternalVendorAdapter({
      simulateOutage: false,
      projections: { "ext-1": { stockOnHand: 42 } },
    });
    const r = adapter.fetchProjection(query());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.projection.kind).toBe("external-projection");
      expect(r.projection.payload).toEqual({ stockOnHand: 42 });
      expect(r.projection.sourceSystem).toBe("acme-erp");
    }
  });

  it("refuses with EXTERNAL_REF_UNKNOWN for an unknown ref (honest)", () => {
    const adapter = createDeterministicExternalVendorAdapter({
      simulateOutage: false,
      projections: {},
    });
    const r = adapter.fetchProjection(query("ghost-ref"));
    expect(r).toEqual({ ok: false, reasonCode: "EXTERNAL_REF_UNKNOWN" });
  });

  it("refuses with EXTERNAL_SYSTEM_UNAVAILABLE when outage is simulated", () => {
    const adapter = createDeterministicExternalVendorAdapter({
      simulateOutage: true,
      projections: { "ext-1": { stockOnHand: 42 } },
    });
    const r = adapter.fetchProjection(query());
    expect(r).toEqual({ ok: false, reasonCode: "EXTERNAL_SYSTEM_UNAVAILABLE" });
  });

  it("refuses with TENANT_SCOPE_MISSING when tenant is broken (fail-closed)", () => {
    const adapter = createDeterministicExternalVendorAdapter({
      simulateOutage: false,
      projections: { "ext-1": { stockOnHand: 42 } },
    });
    const r = adapter.fetchProjection({
      tenant: { tenantId: "" } as unknown as TenantScope,
      sourceSystem: "acme-erp",
      externalRef: "ext-1",
    });
    expect(r).toEqual({ ok: false, reasonCode: "TENANT_SCOPE_MISSING" });
  });

  it("is deterministic — same input produces the same output across calls", () => {
    const adapter = createDeterministicExternalVendorAdapter({
      simulateOutage: false,
      projections: { "ext-1": { stockOnHand: 42 } },
    });
    expect(adapter.fetchProjection(query())).toEqual(adapter.fetchProjection(query()));
  });
});

describe("boundary — external systems never own domain truth", () => {
  it("a returned projection is tagged external-projection, never a domain id kind", () => {
    const adapter = createDeterministicExternalVendorAdapter({
      simulateOutage: false,
      projections: { "ext-1": { stockOnHand: 42 } },
    });
    const r = adapter.fetchProjection(query());
    if (r.ok) {
      expect(isExternalProjection(r.projection)).toBe(true);
      expect(projectionDoesNotOwnDomainTruth(r.projection)).toBe(true);
    }
  });

  it("rejects any value carrying a domain authoritative id kind as NOT a projection", () => {
    expect(projectionDoesNotOwnDomainTruth({ kind: "quote" })).toBe(false);
    expect(projectionDoesNotOwnDomainTruth({ kind: "order" })).toBe(false);
    expect(projectionDoesNotOwnDomainTruth({ kind: "need" })).toBe(false);
    expect(projectionDoesNotOwnDomainTruth({ kind: "external-projection" })).toBe(true);
  });
});
