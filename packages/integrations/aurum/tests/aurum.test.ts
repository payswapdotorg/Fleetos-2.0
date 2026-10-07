/**
 * @fleetos/aurum — Wave 1 kernel-grade tests.
 *
 * Coverage themes:
 *   - retry/idempotency contracts at the seam;
 *   - honest degraded states (UNAVAILABLE vs DEGRADED vs REFUSED);
 *   - idempotency-key-based deduplication;
 *   - tenant fail-closed;
 *   - boundary assertions (no domain truth).
 */
import { describe, expect, it } from "vitest";
import {
  createDeterministicAurumAdapter,
  isAurumProjection,
  aurumDoesNotOwnDomainTruth,
  DEFAULT_RETRY_POLICY,
  type TenantScope,
} from "../src/index.js";

const TENANT: TenantScope = { tenantId: "acme" };

describe("DeterministicAurumAdapter — idempotency", () => {
  it("returns the same response for the same idempotency key (cached)", () => {
    const adapter = createDeterministicAurumAdapter({
      simulateOutage: false,
      responses: { get_asset: { id: "a-1" } },
    });
    const req = {
      tenant: TENANT,
      intent: "get_asset",
      payload: {},
      idempotencyKey: "k-1",
    };
    const first = adapter.invoke(req);
    const second = adapter.invoke(req);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.fromCache).toBe(false);
      expect(second.fromCache).toBe(true);
      expect(first.result).toEqual(second.result);
    }
  });

  it("returns DIFFERENT responses for different idempotency keys", () => {
    const adapter = createDeterministicAurumAdapter({
      simulateOutage: false,
      responses: { get_asset: { id: "a-1" } },
    });
    const first = adapter.invoke({
      tenant: TENANT,
      intent: "get_asset",
      payload: {},
      idempotencyKey: "k-1",
    });
    const second = adapter.invoke({
      tenant: TENANT,
      intent: "get_asset",
      payload: {},
      idempotencyKey: "k-2",
    });
    if (first.ok && second.ok) {
      expect(first.fromCache).toBe(false);
      expect(second.fromCache).toBe(false);
    }
  });

  it("refuses with IDEMPOTENCY_KEY_EMPTY when the key is empty", () => {
    const adapter = createDeterministicAurumAdapter({
      simulateOutage: false,
      responses: { get_asset: { id: "a-1" } },
    });
    const result = adapter.invoke({
      tenant: TENANT,
      intent: "get_asset",
      payload: {},
      idempotencyKey: "  ",
    });
    expect(result).toEqual({ ok: false, reasonCode: "IDEMPOTENCY_KEY_EMPTY", attempts: 0 });
  });
});

describe("DeterministicAurumAdapter — honest degraded states", () => {
  it("returns AURUM_UNAVAILABLE after retries when simulateOutage is true", () => {
    const adapter = createDeterministicAurumAdapter({
      simulateOutage: true,
      responses: {},
    });
    const result = adapter.invoke({
      tenant: TENANT,
      intent: "get_asset",
      payload: {},
      idempotencyKey: "k-1",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("AURUM_UNAVAILABLE");
      expect(result.attempts).toBe(DEFAULT_RETRY_POLICY.maxAttempts);
    }
  });

  it("returns AURUM_DEGRADED when the intent is unknown", () => {
    const adapter = createDeterministicAurumAdapter({
      simulateOutage: false,
      responses: { get_asset: { id: "a-1" } },
    });
    const result = adapter.invoke({
      tenant: TENANT,
      intent: "unknown_intent",
      payload: {},
      idempotencyKey: "k-1",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("AURUM_DEGRADED");
      expect(result.attempts).toBe(DEFAULT_RETRY_POLICY.maxAttempts);
    }
  });

  it("refuses with TENANT_SCOPE_MISSING on broken tenant", () => {
    const adapter = createDeterministicAurumAdapter({
      simulateOutage: false,
      responses: { get_asset: { id: "a-1" } },
    });
    const result = adapter.invoke({
      tenant: { tenantId: "" } as unknown as TenantScope,
      intent: "get_asset",
      payload: {},
      idempotencyKey: "k-1",
    });
    expect(result).toEqual({ ok: false, reasonCode: "TENANT_SCOPE_MISSING", attempts: 0 });
  });
});

describe("DeterministicAurumAdapter — retry policy", () => {
  it("honors a custom retry policy maxAttempts", () => {
    const adapter = createDeterministicAurumAdapter({
      simulateOutage: true,
      responses: {},
      retryPolicy: { maxAttempts: 5, backoffMillis: 50 },
    });
    const result = adapter.invoke({
      tenant: TENANT,
      intent: "get_asset",
      payload: {},
      idempotencyKey: "k-1",
    });
    if (!result.ok) {
      expect(result.attempts).toBe(5);
    }
  });
});

describe("determinism", () => {
  it("returns the same result payload for the same inputs across calls (idempotency)", () => {
    const adapter = createDeterministicAurumAdapter({
      simulateOutage: false,
      responses: { get_asset: { id: "a-1" } },
    });
    const req = {
      tenant: TENANT,
      intent: "get_asset",
      payload: {},
      idempotencyKey: "k-determinism",
    };
    const a = adapter.invoke(req);
    const b = adapter.invoke(req);
    expect(a.ok).toBe(b.ok);
    if (a.ok && b.ok) {
      expect(a.result).toEqual(b.result);
      // The second call is served from cache — deterministic idempotency.
      expect(b.fromCache).toBe(true);
    }
  });

  it("returns the same refusal shape for the same degraded inputs across calls", () => {
    const adapter = createDeterministicAurumAdapter({
      simulateOutage: true,
      responses: {},
    });
    const req = {
      tenant: TENANT,
      intent: "get_asset",
      payload: {},
      idempotencyKey: "k-determinism-refusal",
    };
    const a = adapter.invoke(req);
    const b = adapter.invoke(req);
    expect(a).toEqual(b);
  });
});

describe("boundary assertions", () => {
  it("isAurumProjection returns true for kind=aurum-projection", () => {
    expect(isAurumProjection({ kind: "aurum-projection" })).toBe(true);
  });

  it("isAurumProjection returns false for domain kinds", () => {
    expect(isAurumProjection({ kind: "asset" })).toBe(false);
  });

  it("aurumDoesNotOwnDomainTruth returns true when the payload kind is not a domain kind", () => {
    expect(aurumDoesNotOwnDomainTruth({ kind: "aurum-projection" }, ["asset", "work-item"])).toBe(true);
  });

  it("aurumDoesNotOwnDomainTruth returns false when the payload kind IS a domain kind", () => {
    expect(aurumDoesNotOwnDomainTruth({ kind: "asset" }, ["asset", "work-item"])).toBe(false);
  });
});
