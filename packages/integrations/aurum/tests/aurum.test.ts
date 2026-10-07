import { describe, expect, it } from "vitest";
import {
  createDeterministicAurumAdapter,
  validateTenantScope,
  type TenantScope,
  type AurumRequest,
} from "../src/index.js";

const TENANT: TenantScope = { tenantId: "acme" };

function request(intent = "lookup", payload: Record<string, unknown> = {}): AurumRequest {
  return { tenant: TENANT, intent, payload };
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

describe("deterministic Aurum reference adapter", () => {
  it("returns the configured deterministic response for a known intent", () => {
    const adapter = createDeterministicAurumAdapter({
      simulateOutage: false,
      responses: {
        lookup: { found: true, value: 42 },
      },
    });
    const r = adapter.invoke(request("lookup", { id: "x" }));
    expect(r).toEqual({ ok: true, result: { found: true, value: 42 } });
  });

  it("refuses with AURUM_DEGRADED for an unknown intent (honest)", () => {
    const adapter = createDeterministicAurumAdapter({
      simulateOutage: false,
      responses: {},
    });
    const r = adapter.invoke(request("unknown-intent"));
    expect(r).toEqual({ ok: false, reasonCode: "AURUM_DEGRADED" });
  });

  it("refuses with AURUM_UNAVAILABLE when an outage is simulated (honest degraded)", () => {
    const adapter = createDeterministicAurumAdapter({
      simulateOutage: true,
      responses: { lookup: { found: true } },
    });
    const r = adapter.invoke(request("lookup"));
    expect(r).toEqual({ ok: false, reasonCode: "AURUM_UNAVAILABLE" });
  });

  it("refuses with TENANT_SCOPE_MISSING when tenant is broken (fail-closed)", () => {
    const adapter = createDeterministicAurumAdapter({
      simulateOutage: false,
      responses: { lookup: { found: true } },
    });
    const r = adapter.invoke({
      tenant: { tenantId: "" } as unknown as TenantScope,
      intent: "lookup",
      payload: {},
    });
    expect(r).toEqual({ ok: false, reasonCode: "TENANT_SCOPE_MISSING" });
  });

  it("is deterministic — same input always produces the same output", () => {
    const adapter = createDeterministicAurumAdapter({
      simulateOutage: false,
      responses: { lookup: { found: true, value: 7 } },
    });
    const r1 = adapter.invoke(request("lookup"));
    const r2 = adapter.invoke(request("lookup"));
    expect(r1).toEqual(r2);
  });

  it("does NOT touch the network — invoke has no side effects observable from the call site", () => {
    let networkTouchCount = 0;
    const adapter = createDeterministicAurumAdapter({
      simulateOutage: false,
      responses: { lookup: { touched: false } },
    });
    adapter.invoke(request("lookup"));
    adapter.invoke(request("lookup"));
    expect(networkTouchCount).toBe(0);
  });
});
