/**
 * @fleetos/tenancy — Wave 2 operational depth tests (F220A).
 */

import { describe, it, expect } from "vitest";
import type { TenantRecord } from "./kernel.js";
import {
  assertTenantIsolation,
  sessionSweepActionForTenant,
  sweepTenants,
} from "./kernel-operational.js";

const NOW = 1_727_000_000_000;
const TENANT_A = "tnt_acme";
const TENANT_B = "tnt_other";

function tenant(id: string, state: TenantRecord["state"]): TenantRecord {
  return {
    id,
    displayName: id,
    kind: "organization",
    state,
    createdAt: NOW,
    lastTransitionAt: NOW,
    suspendReason: state === "suspended" ? "billing" : null,
    closeReason: state === "closed" ? "voluntary" : null,
    transitionSeq: 1,
  };
}

describe("tenancy operational: tenant sweep", () => {
  it("partitions tenants by state into separate buckets", () => {
    const tenants = [
      tenant(TENANT_A, "provisioning"),
      tenant(TENANT_B, "active"),
      tenant("tnt_x1", "suspended"),
      tenant("tnt_x2", "closing"),
      tenant("tnt_x3", "closed"),
    ];
    const r = sweepTenants(tenants, NOW);
    expect(r.provisioning).toHaveLength(1);
    expect(r.active).toHaveLength(1);
    expect(r.suspended).toHaveLength(1);
    expect(r.closing).toHaveLength(1);
    expect(r.closed).toHaveLength(1);
  });

  it("sweep is deterministic — same tenants, same time, same result", () => {
    const tenants = [tenant(TENANT_A, "active"), tenant(TENANT_B, "suspended")];
    const r1 = sweepTenants(tenants, NOW);
    const r2 = sweepTenants(tenants, NOW);
    expect(r1).toEqual(r2);
  });

  it("sweep sorts tenants deterministically by id within each bucket", () => {
    const tenants = [
      tenant("tnt_zeta", "active"),
      tenant("tnt_alpha", "active"),
      tenant("tnt_mu", "active"),
    ];
    const r = sweepTenants(tenants, NOW);
    expect(r.active.map((t) => t.id)).toEqual(["tnt_alpha", "tnt_mu", "tnt_zeta"]);
  });

  it("sweep emits an audit event with the partition counts", () => {
    const r = sweepTenants([tenant(TENANT_A, "active"), tenant(TENANT_B, "suspended")], NOW);
    expect(r.audit.intent).toBe("tenancy:tenant:sweep");
    expect(r.audit.timestamp).toBe(NOW);
  });

  it("sweep audit digest changes when partition counts change", () => {
    const r1 = sweepTenants([tenant(TENANT_A, "active")], NOW);
    const r2 = sweepTenants([tenant(TENANT_A, "active"), tenant(TENANT_B, "suspended")], NOW);
    expect(r1.audit.digest).not.toBe(r2.audit.digest);
  });
});

describe("tenancy operational: session sweep action contract", () => {
  it("provisioning tenants preserve sessions", () => {
    expect(sessionSweepActionForTenant("provisioning")).toBe("preserve");
  });
  it("active tenants preserve sessions", () => {
    expect(sessionSweepActionForTenant("active")).toBe("preserve");
  });
  it("suspended tenants preserve sessions (read-only)", () => {
    expect(sessionSweepActionForTenant("suspended")).toBe("preserve");
  });
  it("closing tenants expire sessions immediately", () => {
    expect(sessionSweepActionForTenant("closing")).toBe("expire-immediately");
  });
  it("closed tenants expire sessions immediately", () => {
    expect(sessionSweepActionForTenant("closed")).toBe("expire-immediately");
  });
});

describe("tenancy operational: cross-tenant isolation assertion", () => {
  it("allows same-tenant access", () => {
    expect(assertTenantIsolation(TENANT_A, TENANT_A).ok).toBe(true);
  });
  it("refuses cross-tenant access with machine-stable reason", () => {
    const r = assertTenantIsolation(TENANT_A, TENANT_B);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("cross-tenant-forbidden");
  });
  it("refuses empty tenant ids", () => {
    expect(assertTenantIsolation("", TENANT_A).ok).toBe(false);
    expect(assertTenantIsolation(TENANT_A, "").ok).toBe(false);
  });
});
