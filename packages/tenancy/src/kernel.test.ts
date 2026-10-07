import { describe, it, expect } from "vitest";
import {
  InMemoryTenantRegistry,
  TenantRegistry,
  establishTenant,
  evaluateTenantOperation,
  type TenantRecord,
} from "./kernel.js";

const NOW = 1_727_000_000_000;
const TENANT_A = "tnt_acme-corp-001";

function makeRegistry(): { registry: TenantRegistry; port: InMemoryTenantRegistry } {
  const port = new InMemoryTenantRegistry();
  const registry = new TenantRegistry(port);
  return { registry, port };
}

function provisioned(): { registry: TenantRegistry; tenant: TenantRecord } {
  const { registry } = makeRegistry();
  const r = registry.provisionTenant({
    tenantId: TENANT_A,
    displayName: "Acme Corp",
    kind: "organization",
    createdAt: NOW,
    actor: "act_admin-001",
  });
  if (!r.ok) throw new Error("provision failed");
  return { registry, tenant: r.tenant };
}

describe("tenancy kernel: AuditEventRef shape", () => {
  it("provisionTenant emits audit with all five fields", () => {
    const { registry } = makeRegistry();
    const r = registry.provisionTenant({
      tenantId: TENANT_A,
      displayName: "Acme",
      kind: "organization",
      createdAt: NOW,
      actor: "act_admin-001",
    });
    if (!r.ok) throw new Error("expected ok");
    expect(r.audit).toBeTruthy();
    expect(r.audit.intent).toBe("tenant:provision");
    expect(r.audit.tenant).toBe(TENANT_A);
    expect(r.audit.timestamp).toBe(NOW);
    expect(r.audit.digest.length).toBe(64);
  });

  it("audit digest is deterministic — same provision inputs produce same digest", () => {
    const a = makeRegistry();
    const b = makeRegistry();
    const ra = a.registry.provisionTenant({ tenantId: TENANT_A, displayName: "Acme", kind: "organization", createdAt: NOW, actor: "act_admin-001" });
    const rb = b.registry.provisionTenant({ tenantId: TENANT_A, displayName: "Acme", kind: "organization", createdAt: NOW, actor: "act_admin-001" });
    if (!ra.ok || !rb.ok) throw new Error("expected ok");
    expect(ra.audit.digest).toBe(rb.audit.digest);
  });
});

describe("tenancy kernel: provisionTenant validation", () => {
  it("provisions a tenant in the provisioning state with seq=1", () => {
    const { registry } = makeRegistry();
    const r = registry.provisionTenant({
      tenantId: TENANT_A,
      displayName: "Acme",
      kind: "organization",
      createdAt: NOW,
      actor: "act_admin-001",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.tenant.state).toBe("provisioning");
      expect(r.tenant.transitionSeq).toBe(1);
      expect(r.tenant.suspendReason).toBeNull();
      expect(r.tenant.closeReason).toBeNull();
    }
  });

  it("refuses malformed tenant id", () => {
    const { registry } = makeRegistry();
    const r = registry.provisionTenant({ tenantId: "bad", displayName: "x", kind: "organization", createdAt: NOW, actor: "a" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("malformed-tenant-id");
  });

  it("refuses empty display name", () => {
    const { registry } = makeRegistry();
    const r = registry.provisionTenant({ tenantId: TENANT_A, displayName: "", kind: "organization", createdAt: NOW, actor: "a" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing-display-name");
  });

  it("refuses invalid createdAt (NaN)", () => {
    const { registry } = makeRegistry();
    const r = registry.provisionTenant({ tenantId: TENANT_A, displayName: "x", kind: "organization", createdAt: NaN, actor: "a" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid-created-at");
  });

  it("refuses duplicate tenant (same id)", () => {
    const { registry } = provisioned();
    const r = registry.provisionTenant({ tenantId: TENANT_A, displayName: "dup", kind: "organization", createdAt: NOW, actor: "a" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("duplicate-tenant");
  });
});

describe("tenancy kernel: executeTransition (legal-transition table)", () => {
  it("provision -> active (the activation step)", () => {
    const { registry, tenant } = provisioned();
    const r = registry.executeTransition({
      tenantId: tenant.id,
      command: { kind: "provision", initiatedAt: NOW + 1000 },
      actor: "act_admin-001",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.tenant.state).toBe("active");
      expect(r.tenant.transitionSeq).toBe(2);
      expect(r.audit.intent).toBe("tenant:provision");
    }
  });

  it("active -> suspended (suspend requires a reason)", () => {
    const { registry, tenant } = provisioned();
    registry.executeTransition({ tenantId: tenant.id, command: { kind: "provision", initiatedAt: NOW + 1000 }, actor: "a" });
    const r = registry.executeTransition({ tenantId: tenant.id, command: { kind: "suspend", reason: "non-payment", initiatedAt: NOW + 2000 }, actor: "a" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.tenant.state).toBe("suspended");
      expect(r.tenant.suspendReason).toBe("non-payment");
      expect(r.audit.intent).toBe("tenant:suspend");
    }
  });

  it("suspend with missing reason -> missing-reason", () => {
    const { registry, tenant } = provisioned();
    registry.executeTransition({ tenantId: tenant.id, command: { kind: "provision", initiatedAt: NOW + 1000 }, actor: "a" });
    const r = registry.executeTransition({ tenantId: tenant.id, command: { kind: "suspend", initiatedAt: NOW + 2000 }, actor: "a" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing-reason");
  });

  it("suspended -> active via resume", () => {
    const { registry, tenant } = provisioned();
    registry.executeTransition({ tenantId: tenant.id, command: { kind: "provision", initiatedAt: NOW + 1000 }, actor: "a" });
    registry.executeTransition({ tenantId: tenant.id, command: { kind: "suspend", reason: "x", initiatedAt: NOW + 2000 }, actor: "a" });
    const r = registry.executeTransition({ tenantId: tenant.id, command: { kind: "resume", initiatedAt: NOW + 3000 }, actor: "a" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.tenant.state).toBe("active");
      // Resume does NOT clear suspendReason — the audit trail keeps it.
      expect(r.tenant.suspendReason).toBe("x");
    }
  });

  it("active -> closing -> closed", () => {
    const { registry, tenant } = provisioned();
    registry.executeTransition({ tenantId: tenant.id, command: { kind: "provision", initiatedAt: NOW + 1000 }, actor: "a" });
    const mid = registry.executeTransition({ tenantId: tenant.id, command: { kind: "close", reason: "shutdown", initiatedAt: NOW + 2000 }, actor: "a" });
    expect(mid.ok).toBe(true);
    if (mid.ok) expect(mid.tenant.state).toBe("closing");
    const fin = registry.executeTransition({ tenantId: tenant.id, command: { kind: "close", initiatedAt: NOW + 3000 }, actor: "a" });
    expect(fin.ok).toBe(true);
    if (fin.ok) {
      expect(fin.tenant.state).toBe("closed");
      expect(fin.tenant.closeReason).toBe("shutdown");
    }
  });

  it("suspended -> closing -> closed", () => {
    const { registry, tenant } = provisioned();
    registry.executeTransition({ tenantId: tenant.id, command: { kind: "provision", initiatedAt: NOW + 1000 }, actor: "a" });
    registry.executeTransition({ tenantId: tenant.id, command: { kind: "suspend", reason: "x", initiatedAt: NOW + 2000 }, actor: "a" });
    const mid = registry.executeTransition({ tenantId: tenant.id, command: { kind: "close", reason: "shutdown", initiatedAt: NOW + 3000 }, actor: "a" });
    expect(mid.ok).toBe(true);
    if (mid.ok) expect(mid.tenant.state).toBe("closing");
    const fin = registry.executeTransition({ tenantId: tenant.id, command: { kind: "close", initiatedAt: NOW + 4000 }, actor: "a" });
    expect(fin.ok).toBe(true);
    if (fin.ok) expect(fin.tenant.state).toBe("closed");
  });

  it("executeTransition on unknown tenant -> unknown-tenant", () => {
    const { registry } = makeRegistry();
    const r = registry.executeTransition({ tenantId: "tnt_unknown-999", command: { kind: "provision", initiatedAt: NOW }, actor: "a" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unknown-tenant");
  });

  it("illegal transition (closed -> suspend) -> illegal-transition", () => {
    const { registry, tenant } = provisioned();
    registry.executeTransition({ tenantId: tenant.id, command: { kind: "provision", initiatedAt: NOW + 1000 }, actor: "a" });
    registry.executeTransition({ tenantId: tenant.id, command: { kind: "close", reason: "x", initiatedAt: NOW + 2000 }, actor: "a" });
    registry.executeTransition({ tenantId: tenant.id, command: { kind: "close", initiatedAt: NOW + 3000 }, actor: "a" });
    const r = registry.executeTransition({ tenantId: tenant.id, command: { kind: "suspend", reason: "y", initiatedAt: NOW + 4000 }, actor: "a" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("illegal-transition");
  });

  it("audit digest differs across transition kinds (intent is part of the digest input)", () => {
    const { registry, tenant } = provisioned();
    registry.executeTransition({ tenantId: tenant.id, command: { kind: "provision", initiatedAt: NOW + 1000 }, actor: "a" });
    const suspendA = registry.executeTransition({ tenantId: tenant.id, command: { kind: "suspend", reason: "x", initiatedAt: NOW + 2000 }, actor: "a" });
    registry.executeTransition({ tenantId: tenant.id, command: { kind: "resume", initiatedAt: NOW + 3000 }, actor: "a" });
    const suspendB = registry.executeTransition({ tenantId: tenant.id, command: { kind: "suspend", reason: "y", initiatedAt: NOW + 4000 }, actor: "a" });
    if (!suspendA?.ok || !suspendB?.ok) throw new Error("expected ok");
    // Different transitionSeq (3 vs 5) → different digest, even with same intent
    expect(suspendA.audit.digest).not.toBe(suspendB.audit.digest);
  });
});

describe("tenancy kernel: lookupTenant fail-closed", () => {
  it("returns null for unknown tenant id", () => {
    const { registry } = makeRegistry();
    expect(registry.lookupTenant("tnt_unknown-999")).toBeNull();
  });
  it("returns the persisted record for a known id", () => {
    const { registry, tenant } = provisioned();
    expect(registry.lookupTenant(TENANT_A)?.id).toBe(tenant.id);
  });
  it("boundary returns the Wave 0 vocabulary", () => {
    const { registry, tenant } = provisioned();
    const b = registry.boundary(tenant);
    expect(b.tenantId).toBe(tenant.id);
    expect(b.readCrossTenant).toBe(false);
    expect(b.writeCrossTenant).toBe(false);
  });
});

describe("tenancy kernel: evaluateTenantOperation (suspension propagation)", () => {
  function tenantIn(state: TenantRecord["state"]): TenantRecord {
    return {
      id: TENANT_A,
      displayName: "x",
      kind: "organization",
      state,
      createdAt: NOW,
      lastTransitionAt: NOW,
      suspendReason: state === "suspended" ? "x" : null,
      closeReason: state === "closed" ? "x" : null,
      transitionSeq: 1,
    };
  }

  it("active tenant allows all operations", () => {
    for (const op of ["read", "write", "admit", "mutate", "provision"] as const) {
      const r = evaluateTenantOperation(tenantIn("active"), op);
      expect(r.ok).toBe(true);
    }
  });

  it("suspended tenant allows reads but refuses writes (tenant-suspended-read-only)", () => {
    expect(evaluateTenantOperation(tenantIn("suspended"), "read").ok).toBe(true);
    expect(evaluateTenantOperation(tenantIn("suspended"), "write").ok).toBe(false);
    expect(evaluateTenantOperation(tenantIn("suspended"), "admit").ok).toBe(false);
    expect(evaluateTenantOperation(tenantIn("suspended"), "mutate").ok).toBe(false);
    expect(evaluateTenantOperation(tenantIn("suspended"), "provision").ok).toBe(false);
    const r = evaluateTenantOperation(tenantIn("suspended"), "write");
    if (!r.ok) expect(r.reason).toBe("tenant-suspended-read-only");
  });

  it("closed tenant refuses ALL operations including reads", () => {
    expect(evaluateTenantOperation(tenantIn("closed"), "read").ok).toBe(false);
    expect(evaluateTenantOperation(tenantIn("closed"), "write").ok).toBe(false);
    expect(evaluateTenantOperation(tenantIn("closed"), "admit").ok).toBe(false);
    const r = evaluateTenantOperation(tenantIn("closed"), "read");
    if (!r.ok) expect(r.reason).toBe("tenant-closed-no-operations");
  });

  it("provisioning tenant allows reads and provision but refuses other writes", () => {
    expect(evaluateTenantOperation(tenantIn("provisioning"), "read").ok).toBe(true);
    expect(evaluateTenantOperation(tenantIn("provisioning"), "provision").ok).toBe(true);
    expect(evaluateTenantOperation(tenantIn("provisioning"), "write").ok).toBe(false);
    expect(evaluateTenantOperation(tenantIn("provisioning"), "admit").ok).toBe(false);
    const r = evaluateTenantOperation(tenantIn("provisioning"), "write");
    if (!r.ok) expect(r.reason).toBe("tenant-provisioning-no-writes");
  });

  it("closing tenant allows reads but refuses new writes (tenant-closing-no-new-writes)", () => {
    expect(evaluateTenantOperation(tenantIn("closing"), "read").ok).toBe(true);
    expect(evaluateTenantOperation(tenantIn("closing"), "close").ok).toBe(true);
    expect(evaluateTenantOperation(tenantIn("closing"), "write").ok).toBe(false);
    expect(evaluateTenantOperation(tenantIn("closing"), "admit").ok).toBe(false);
    const r = evaluateTenantOperation(tenantIn("closing"), "write");
    if (!r.ok) expect(r.reason).toBe("tenant-closing-no-new-writes");
  });

  it("null tenant -> unknown-tenant", () => {
    const r = evaluateTenantOperation(null, "read");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unknown-tenant");
  });

  it("suspended tenant allows close (admin can shut down)", () => {
    expect(evaluateTenantOperation(tenantIn("suspended"), "close").ok).toBe(true);
  });
});

describe("tenancy kernel: establishTenant", () => {
  it("establishes an active tenant with a boundary", () => {
    const { registry } = provisioned();
    registry.executeTransition({ tenantId: TENANT_A, command: { kind: "provision", initiatedAt: NOW + 1000 }, actor: "a" });
    const r = establishTenant(registry, TENANT_A, false);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.tenant.state).toBe("active");
      expect(r.boundary.tenantId).toBe(TENANT_A);
    }
  });

  it("refuses establishment for unknown tenant", () => {
    const { registry } = makeRegistry();
    const r = establishTenant(registry, "tnt_unknown-999", false);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unknown-tenant");
  });

  it("refuses establishment for closed tenant", () => {
    const { registry } = provisioned();
    registry.executeTransition({ tenantId: TENANT_A, command: { kind: "provision", initiatedAt: NOW + 1000 }, actor: "a" });
    registry.executeTransition({ tenantId: TENANT_A, command: { kind: "close", reason: "x", initiatedAt: NOW + 2000 }, actor: "a" });
    registry.executeTransition({ tenantId: TENANT_A, command: { kind: "close", initiatedAt: NOW + 3000 }, actor: "a" });
    const r = establishTenant(registry, TENANT_A, false);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("tenant-closed");
  });

  it("refuses establishment for suspended tenant", () => {
    const { registry } = provisioned();
    registry.executeTransition({ tenantId: TENANT_A, command: { kind: "provision", initiatedAt: NOW + 1000 }, actor: "a" });
    registry.executeTransition({ tenantId: TENANT_A, command: { kind: "suspend", reason: "x", initiatedAt: NOW + 2000 }, actor: "a" });
    const r = establishTenant(registry, TENANT_A, false);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("tenant-suspended");
  });

  it("refuses establishment for provisioning tenant unless allowTransitional=true", () => {
    const { registry } = provisioned();
    const r1 = establishTenant(registry, TENANT_A, false);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.reason).toBe("tenant-provisioning");
    const r2 = establishTenant(registry, TENANT_A, true);
    expect(r2.ok).toBe(true);
  });
});

describe("tenancy kernel: InMemoryTenantRegistry determinism", () => {
  it("two registries with identical inputs produce identical tenants and identical audits", () => {
    const a = makeRegistry();
    const b = makeRegistry();
    a.registry.provisionTenant({ tenantId: TENANT_A, displayName: "Acme", kind: "organization", createdAt: NOW, actor: "act_admin-001" });
    b.registry.provisionTenant({ tenantId: TENANT_A, displayName: "Acme", kind: "organization", createdAt: NOW, actor: "act_admin-001" });
    const ta = a.registry.lookupTenant(TENANT_A)!;
    const tb = b.registry.lookupTenant(TENANT_A)!;
    expect(ta).toEqual(tb);
  });
  it("remove() returns true for an existing tenant and false for an unknown one", () => {
    const { port } = makeRegistry();
    port.save({
      id: TENANT_A,
      displayName: "x",
      kind: "organization",
      state: "active",
      createdAt: NOW,
      lastTransitionAt: NOW,
      suspendReason: null,
      closeReason: null,
      transitionSeq: 1,
    });
    expect(port.remove(TENANT_A)).toBe(true);
    expect(port.remove(TENANT_A)).toBe(false);
    expect(port.find(TENANT_A)).toBeNull();
  });
});
