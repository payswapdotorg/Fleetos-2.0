/**
 * @fleetos/external-vendors — Wave 1 kernel-grade tests.
 */
import { describe, expect, it } from "vitest";
import {
  createDeterministicExternalVendorAdapter,
  isExternalProjection,
  projectionDoesNotOwnDomainTruth,
  DEFAULT_RETRY_POLICY,
  type TenantScope,
} from "../src/index.js";

const TENANT: TenantScope = { tenantId: "acme" };

describe("DeterministicExternalVendorAdapter — idempotency", () => {
  it("returns the same projection for the same idempotency key (cached)", () => {
    const adapter = createDeterministicExternalVendorAdapter({
      simulateOutage: false,
      projections: { "ext-1": { value: "data" } },
    });
    const query = {
      tenant: TENANT,
      sourceSystem: "vendor-system",
      externalRef: "ext-1",
      idempotencyKey: "k-1",
    };
    const first = adapter.fetchProjection(query);
    const second = adapter.fetchProjection(query);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.fromCache).toBe(false);
      expect(second.fromCache).toBe(true);
      expect(first.projection.payload).toEqual(second.projection.payload);
    }
  });

  it("refuses with IDEMPOTENCY_KEY_EMPTY when the key is empty", () => {
    const adapter = createDeterministicExternalVendorAdapter({
      simulateOutage: false,
      projections: {},
    });
    const result = adapter.fetchProjection({
      tenant: TENANT,
      sourceSystem: "vendor-system",
      externalRef: "ext-1",
      idempotencyKey: "  ",
    });
    expect(result).toEqual({ ok: false, reasonCode: "IDEMPOTENCY_KEY_EMPTY", attempts: 0 });
  });
});

describe("DeterministicExternalVendorAdapter — honest degraded states", () => {
  it("returns EXTERNAL_SYSTEM_UNAVAILABLE after retries when simulateOutage is true", () => {
    const adapter = createDeterministicExternalVendorAdapter({
      simulateOutage: true,
      projections: {},
    });
    const result = adapter.fetchProjection({
      tenant: TENANT,
      sourceSystem: "vendor-system",
      externalRef: "ext-1",
      idempotencyKey: "k-1",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("EXTERNAL_SYSTEM_UNAVAILABLE");
      expect(result.attempts).toBe(DEFAULT_RETRY_POLICY.maxAttempts);
    }
  });

  it("returns EXTERNAL_REF_UNKNOWN when the external ref is not in the config", () => {
    const adapter = createDeterministicExternalVendorAdapter({
      simulateOutage: false,
      projections: {},
    });
    const result = adapter.fetchProjection({
      tenant: TENANT,
      sourceSystem: "vendor-system",
      externalRef: "missing",
      idempotencyKey: "k-1",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe("EXTERNAL_REF_UNKNOWN");
  });

  it("refuses with TENANT_SCOPE_MISSING on broken tenant", () => {
    const adapter = createDeterministicExternalVendorAdapter({
      simulateOutage: false,
      projections: {},
    });
    const result = adapter.fetchProjection({
      tenant: { tenantId: "" } as unknown as TenantScope,
      sourceSystem: "vendor-system",
      externalRef: "ext-1",
      idempotencyKey: "k-1",
    });
    expect(result).toEqual({ ok: false, reasonCode: "TENANT_SCOPE_MISSING", attempts: 0 });
  });
});

describe("DeterministicExternalVendorAdapter — retry policy", () => {
  it("honors a custom retry policy maxAttempts", () => {
    const adapter = createDeterministicExternalVendorAdapter({
      simulateOutage: true,
      projections: {},
      retryPolicy: { maxAttempts: 5, backoffMillis: 50 },
    });
    const result = adapter.fetchProjection({
      tenant: TENANT,
      sourceSystem: "vendor-system",
      externalRef: "ext-1",
      idempotencyKey: "k-1",
    });
    if (!result.ok) expect(result.attempts).toBe(5);
  });
});

describe("determinism", () => {
  it("returns the same projection payload for the same inputs across calls (idempotency)", () => {
    const adapter = createDeterministicExternalVendorAdapter({
      simulateOutage: false,
      projections: { "ext-1": { value: "data" } },
    });
    const query = {
      tenant: TENANT,
      sourceSystem: "vendor-system",
      externalRef: "ext-1",
      idempotencyKey: "k-determinism",
    };
    const a = adapter.fetchProjection(query);
    const b = adapter.fetchProjection(query);
    expect(a.ok).toBe(b.ok);
    if (a.ok && b.ok) {
      expect(a.projection.payload).toEqual(b.projection.payload);
      expect(b.fromCache).toBe(true);
    }
  });
});

describe("boundary assertions — external systems never own domain truth", () => {
  it("isExternalProjection returns true for kind=external-projection", () => {
    expect(isExternalProjection({ kind: "external-projection" })).toBe(true);
  });

  it("isExternalProjection returns false for domain kinds", () => {
    expect(isExternalProjection({ kind: "quote" })).toBe(false);
    expect(isExternalProjection({ kind: "order" })).toBe(false);
    expect(isExternalProjection({ kind: "vendor" })).toBe(false);
  });

  it("projectionDoesNotOwnDomainTruth returns true for external-projection", () => {
    expect(projectionDoesNotOwnDomainTruth({ kind: "external-projection" })).toBe(true);
  });

  it("projectionDoesNotOwnDomainTruth returns false for domain kinds", () => {
    expect(projectionDoesNotOwnDomainTruth({ kind: "quote" })).toBe(false);
    expect(projectionDoesNotOwnDomainTruth({ kind: "order" })).toBe(false);
    expect(projectionDoesNotOwnDomainTruth({ kind: "vendor" })).toBe(false);
    expect(projectionDoesNotOwnDomainTruth({ kind: "subscription" })).toBe(false);
    expect(projectionDoesNotOwnDomainTruth({ kind: "entitlement" })).toBe(false);
    expect(projectionDoesNotOwnDomainTruth({ kind: "organization" })).toBe(false);
    expect(projectionDoesNotOwnDomainTruth({ kind: "need" })).toBe(false);
    expect(projectionDoesNotOwnDomainTruth({ kind: "procurement-demand" })).toBe(false);
    expect(projectionDoesNotOwnDomainTruth({ kind: "fulfillment" })).toBe(false);
  });

  it("a successful fetch returns a projection with kind=external-projection (NOT a domain kind)", () => {
    const adapter = createDeterministicExternalVendorAdapter({
      simulateOutage: false,
      projections: { "ext-1": { value: "data" } },
    });
    const result = adapter.fetchProjection({
      tenant: TENANT,
      sourceSystem: "vendor-system",
      externalRef: "ext-1",
      idempotencyKey: "k-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.projection.kind).toBe("external-projection");
      expect(projectionDoesNotOwnDomainTruth(result.projection)).toBe(true);
    }
  });
});
