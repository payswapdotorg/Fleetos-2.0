import { describe, expect, it } from "vitest";
import {
  createDeterministicApifyAdapter,
  proposeActorJob,
  validateTenantScope,
  type TenantScope,
  type GuardianDecisionRefLike,
} from "../src/index.js";

const TENANT: TenantScope = { tenantId: "acme" };

const AUTH: GuardianDecisionRefLike = {
  decisionId: "g-1",
  authorized: true,
  reasonCode: "OK",
};

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

describe("proposeActorJob — proposals, never authorizations", () => {
  it("produces an unauthorized proposal by default (Guardian path required)", () => {
    const p = proposeActorJob(TENANT, "scrape-vendor-prices", { url: "https://example" }, "2026-01-01T00:00:00Z");
    expect(p.authorization).toBeNull();
    expect(p.kind).toBe("actor-job-proposal");
  });
});

describe("deterministic Apify reference adapter — proposal/authorization boundary", () => {
  it("refuses with PROPOSAL_UNAUTHORIZED when authorization is null", () => {
    const adapter = createDeterministicApifyAdapter({
      simulateOutage: false,
      actors: { "scrape-vendor-prices": { prices: [] } },
    });
    const p = proposeActorJob(TENANT, "scrape-vendor-prices", {}, "2026-01-01T00:00:00Z");
    const r = adapter.runActorJob(p);
    expect(r).toEqual({ ok: false, reasonCode: "PROPOSAL_UNAUTHORIZED" });
  });

  it("refuses with PROPOSAL_UNAUTHORIZED when authorization.authorized is false", () => {
    const adapter = createDeterministicApifyAdapter({
      simulateOutage: false,
      actors: { "scrape-vendor-prices": { prices: [] } },
    });
    const p: ReturnType<typeof proposeActorJob> = {
      ...proposeActorJob(TENANT, "scrape-vendor-prices", {}, "2026-01-01T00:00:00Z"),
      authorization: { decisionId: "g-2", authorized: false, reasonCode: "POLICY_DENY" },
    };
    const r = adapter.runActorJob(p);
    expect(r).toEqual({ ok: false, reasonCode: "PROPOSAL_UNAUTHORIZED" });
  });

  it("runs the actor when the proposal is authorized and the actor exists", () => {
    const adapter = createDeterministicApifyAdapter({
      simulateOutage: false,
      actors: { "scrape-vendor-prices": { prices: [10, 20, 30] } },
    });
    const p: ReturnType<typeof proposeActorJob> = {
      ...proposeActorJob(TENANT, "scrape-vendor-prices", {}, "2026-01-01T00:00:00Z"),
      authorization: AUTH,
    };
    const r = adapter.runActorJob(p);
    expect(r).toEqual({ ok: true, output: { prices: [10, 20, 30] } });
  });

  it("refuses with ACTOR_UNKNOWN when the actor id is not registered", () => {
    const adapter = createDeterministicApifyAdapter({
      simulateOutage: false,
      actors: {},
    });
    const p: ReturnType<typeof proposeActorJob> = {
      ...proposeActorJob(TENANT, "ghost-actor", {}, "2026-01-01T00:00:00Z"),
      authorization: AUTH,
    };
    const r = adapter.runActorJob(p);
    expect(r).toEqual({ ok: false, reasonCode: "ACTOR_UNKNOWN" });
  });

  it("refuses with APIFY_UNAVAILABLE when outage is simulated (honest degraded)", () => {
    const adapter = createDeterministicApifyAdapter({
      simulateOutage: true,
      actors: { "scrape-vendor-prices": { prices: [] } },
    });
    const p: ReturnType<typeof proposeActorJob> = {
      ...proposeActorJob(TENANT, "scrape-vendor-prices", {}, "2026-01-01T00:00:00Z"),
      authorization: AUTH,
    };
    const r = adapter.runActorJob(p);
    expect(r).toEqual({ ok: false, reasonCode: "APIFY_UNAVAILABLE" });
  });

  it("refuses with TENANT_SCOPE_MISSING when tenant is broken (fail-closed)", () => {
    const adapter = createDeterministicApifyAdapter({
      simulateOutage: false,
      actors: { "scrape-vendor-prices": { prices: [] } },
    });
    const p: ReturnType<typeof proposeActorJob> = {
      ...proposeActorJob({ tenantId: "" } as unknown as TenantScope, "scrape-vendor-prices", {}, "2026-01-01T00:00:00Z"),
      authorization: AUTH,
    };
    const r = adapter.runActorJob(p);
    expect(r).toEqual({ ok: false, reasonCode: "TENANT_SCOPE_MISSING" });
  });

  it("is deterministic — same input produces the same output across calls", () => {
    const adapter = createDeterministicApifyAdapter({
      simulateOutage: false,
      actors: { "scrape-vendor-prices": { prices: [1] } },
    });
    const p: ReturnType<typeof proposeActorJob> = {
      ...proposeActorJob(TENANT, "scrape-vendor-prices", {}, "2026-01-01T00:00:00Z"),
      authorization: AUTH,
    };
    expect(adapter.runActorJob(p)).toEqual(adapter.runActorJob(p));
  });
});
