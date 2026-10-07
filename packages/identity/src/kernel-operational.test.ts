/**
 * @fleetos/identity — Wave 2 operational depth tests (F220A).
 *
 * Covers:
 *   - Session validation with expiry sweeps (deterministic from timestamps)
 *   - Role hierarchies with inheritance contracts
 *   - Cross-tenant read refusal machine-tests at the directory level
 */

import { describe, it, expect } from "vitest";
import type { ActorId, Role, RoleId, TenantContext, TenantId } from "./identity.js";
import { InMemoryActorRepository, ActorDirectory } from "./kernel-directory.js";
import type { MembershipRecord } from "./kernel.js";
import {
  actorCapabilities,
  addRoleEdge,
  assertCrossTenantRefusal,
  detectCycle,
  emptyRoleHierarchy,
  inheritCapabilities,
  machineTestCrossTenantRefusal,
  sweepSessions,
  type SessionRecord,
} from "./kernel-operational.js";

const NOW = 1_727_000_000_000;
const TENANT_A = "tnt_acme" as TenantId;
const TENANT_B = "tnt_other" as TenantId;
const ACT1 = "act_alice" as ActorId;
const ACT2 = "act_bob" as ActorId;
const ROLE_ADMIN = "role_admin" as RoleId;
const ROLE_OPS = "role_ops" as RoleId;
const ROLE_VIEW = "role_view" as RoleId;

function session(state: SessionRecord["state"], tenantId: TenantId, actorId: ActorId, expiresAt: number | null = null): SessionRecord {
  return {
    id: `sess_${actorId}_${state}_${Math.random().toString(36).slice(2, 8)}`,
    tenantId,
    actorId,
    roleId: ROLE_OPS,
    establishedAt: NOW - 1000,
    expiresAt,
    state,
  };
}

function ctx(t: TenantId, actor: ActorId): TenantContext {
  return { tenantId: t, actorId: actor, roleId: ROLE_VIEW, establishedAt: NOW, scope: "tenant" };
}

// ---------------------------------------------------------------------------
// Session expiry sweeps.
// ---------------------------------------------------------------------------

describe("identity operational: session expiry sweep", () => {
  it("partitions sessions into valid / expired / revoked", () => {
    const sessions: SessionRecord[] = [
      session("active", TENANT_A, ACT1, NOW + 1000),       // valid
      session("active", TENANT_A, ACT2, NOW - 1000),       // expired (past expiresAt)
      session("revoked", TENANT_A, ACT1),                  // revoked
      session("active", TENANT_A, ACT2, NOW + 5000),       // valid
    ];
    const r = sweepSessions(sessions, NOW, TENANT_A);
    expect(r.valid).toHaveLength(2);
    expect(r.expired).toHaveLength(1);
    expect(r.revoked).toHaveLength(1);
  });

  it("sweep is deterministic for identical inputs", () => {
    const sessions: SessionRecord[] = [
      session("active", TENANT_A, ACT1, NOW + 1000),
      session("active", TENANT_A, ACT2, NOW - 1000),
    ];
    const r1 = sweepSessions(sessions, NOW, TENANT_A);
    const r2 = sweepSessions(sessions, NOW, TENANT_A);
    expect(r1).toEqual(r2);
  });

  it("sweep is tenant-fail-closed — sessions from other tenants are not included", () => {
    const sessions: SessionRecord[] = [
      session("active", TENANT_A, ACT1, NOW + 1000),
      session("active", TENANT_B, ACT2, NOW + 1000),
    ];
    const r = sweepSessions(sessions, NOW, TENANT_A);
    expect(r.valid).toHaveLength(1);
    expect(r.valid[0]!.tenantId).toBe(TENANT_A);
  });

  it("sweep marks sessions with null expiresAt as valid (never expire)", () => {
    const sessions: SessionRecord[] = [
      session("active", TENANT_A, ACT1, null),
    ];
    const r = sweepSessions(sessions, NOW + 1000000, TENANT_A);
    expect(r.valid).toHaveLength(1);
    expect(r.expired).toHaveLength(0);
  });

  it("sweep moves already-expired-state sessions into expired bucket", () => {
    const sessions: SessionRecord[] = [
      session("expired", TENANT_A, ACT1, NOW + 1000),
    ];
    const r = sweepSessions(sessions, NOW, TENANT_A);
    expect(r.expired).toHaveLength(1);
    expect(r.valid).toHaveLength(0);
  });

  it("sweep emits an audit event with the partition counts", () => {
    const sessions: SessionRecord[] = [
      session("active", TENANT_A, ACT1, NOW + 1000),
      session("revoked", TENANT_A, ACT2),
    ];
    const r = sweepSessions(sessions, NOW, TENANT_A);
    expect(r.audit.intent).toBe("identity:session:sweep");
    expect(r.audit.tenant).toBe(TENANT_A);
    expect(r.audit.timestamp).toBe(NOW);
  });

  it("sweep audit digest changes when partition counts change", () => {
    const s1: SessionRecord[] = [session("active", TENANT_A, ACT1, NOW + 1000)];
    const s2: SessionRecord[] = [
      session("active", TENANT_A, ACT1, NOW + 1000),
      session("active", TENANT_A, ACT2, NOW + 1000),
    ];
    const r1 = sweepSessions(s1, NOW, TENANT_A);
    const r2 = sweepSessions(s2, NOW, TENANT_A);
    expect(r1.audit.digest).not.toBe(r2.audit.digest);
  });
});

// ---------------------------------------------------------------------------
// Role hierarchies with inheritance contracts.
// ---------------------------------------------------------------------------

const ROLE_ADMIN_OBJ: Role = {
  id: ROLE_ADMIN,
  scope: "tenant",
  label: "Administrator",
  capabilities: ["asset:read", "asset:write", "user:invite"],
};

const ROLE_OPS_OBJ: Role = {
  id: ROLE_OPS,
  scope: "tenant",
  label: "Operations",
  capabilities: ["asset:read", "maintenance:schedule"],
};

const ROLE_VIEW_OBJ: Role = {
  id: ROLE_VIEW,
  scope: "tenant",
  label: "Viewer",
  capabilities: ["asset:read"],
};

const ALL_ROLES: ReadonlyArray<Role> = [ROLE_ADMIN_OBJ, ROLE_OPS_OBJ, ROLE_VIEW_OBJ];

describe("identity operational: role hierarchy inheritance", () => {
  it("a role with no parents returns only its own capabilities", () => {
    const h = emptyRoleHierarchy();
    const caps = inheritCapabilities(ROLE_VIEW_OBJ, h, ALL_ROLES);
    expect(caps).toEqual(["asset:read"]);
  });

  it("a child role inherits capabilities from its parent", () => {
    // ROLE_VIEW (child) inherits from ROLE_OPS (parent).
    let h = emptyRoleHierarchy();
    h = addRoleEdge(h, ROLE_OPS, ROLE_VIEW);
    const caps = inheritCapabilities(ROLE_VIEW_OBJ, h, ALL_ROLES);
    // child gets parent's capabilities too.
    expect(caps).toEqual(["asset:read", "maintenance:schedule"]);
  });

  it("inheritance is transitive (grandchild inherits grandparent capabilities)", () => {
    // ROLE_VIEW inherits from ROLE_OPS, ROLE_OPS inherits from ROLE_ADMIN.
    let h = emptyRoleHierarchy();
    h = addRoleEdge(h, ROLE_OPS, ROLE_VIEW);
    h = addRoleEdge(h, ROLE_ADMIN, ROLE_OPS);
    const caps = inheritCapabilities(ROLE_VIEW_OBJ, h, ALL_ROLES);
    // VIEW inherits from OPS and ADMIN — all 4 capabilities.
    expect(caps).toEqual(["asset:read", "asset:write", "maintenance:schedule", "user:invite"]);
  });

  it("addRoleEdge refuses a self-edge (parent === child)", () => {
    let h = emptyRoleHierarchy();
    h = addRoleEdge(h, ROLE_OPS, ROLE_OPS);
    expect(h.edges).toHaveLength(0);
  });

  it("addRoleEdge refuses a duplicate edge", () => {
    let h = emptyRoleHierarchy();
    h = addRoleEdge(h, ROLE_OPS, ROLE_VIEW);
    h = addRoleEdge(h, ROLE_OPS, ROLE_VIEW);
    expect(h.edges).toHaveLength(1);
  });

  it("detectCycle returns ok=true for a DAG with no cycles", () => {
    let h = emptyRoleHierarchy();
    h = addRoleEdge(h, ROLE_ADMIN, ROLE_OPS);
    h = addRoleEdge(h, ROLE_OPS, ROLE_VIEW);
    expect(detectCycle(h, ROLE_ADMIN).ok).toBe(true);
  });

  it("detectCycle returns ok=false when a cycle is present", () => {
    let h = emptyRoleHierarchy();
    h = addRoleEdge(h, ROLE_OPS, ROLE_VIEW);
    h = addRoleEdge(h, ROLE_VIEW, ROLE_OPS); // creates a cycle
    const r = detectCycle(h, ROLE_OPS);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("cycle-detected");
  });

  it("actorCapabilities returns the union across all bound roles (with inheritance)", () => {
    let h = emptyRoleHierarchy();
    h = addRoleEdge(h, ROLE_OPS, ROLE_VIEW);
    const bindings: MembershipRecord[] = [
      // Actor bound to ROLE_VIEW (inherits ROLE_OPS capabilities too).
      {
        id: "mbr_x1" as never,
        tenantId: TENANT_A,
        actorId: ACT1,
        roleId: ROLE_VIEW,
        establishedAt: NOW,
        revokedAt: null,
        state: "bound",
      },
    ];
    const caps = actorCapabilities(ACT1, bindings, h, ALL_ROLES);
    // VIEW + OPS -> ["asset:read", "maintenance:schedule"]
    expect(caps).toEqual(["asset:read", "maintenance:schedule"]);
  });

  it("actorCapabilities ignores unbound memberships", () => {
    let h = emptyRoleHierarchy();
    const bindings: MembershipRecord[] = [
      {
        id: "mbr_x2" as never,
        tenantId: TENANT_A,
        actorId: ACT1,
        roleId: ROLE_VIEW,
        establishedAt: NOW,
        revokedAt: null,
        state: "unbound", // unbound — should be ignored
      },
    ];
    const caps = actorCapabilities(ACT1, bindings, h, ALL_ROLES);
    expect(caps).toEqual([]);
  });

  it("actorCapabilities returns deterministic, sorted results", () => {
    let h = emptyRoleHierarchy();
    const bindings: MembershipRecord[] = [
      {
        id: "mbr_y1" as never,
        tenantId: TENANT_A,
        actorId: ACT1,
        roleId: ROLE_OPS,
        establishedAt: NOW,
        revokedAt: null,
        state: "bound",
      },
      {
        id: "mbr_y2" as never,
        tenantId: TENANT_A,
        actorId: ACT1,
        roleId: ROLE_VIEW,
        establishedAt: NOW,
        revokedAt: null,
        state: "bound",
      },
    ];
    const caps = actorCapabilities(ACT1, bindings, h, ALL_ROLES);
    expect(caps).toEqual([...caps].sort());
  });
});

// ---------------------------------------------------------------------------
// Cross-tenant read refusal at the directory level.
// ---------------------------------------------------------------------------

describe("identity operational: cross-tenant directory refusal (machine-tests)", () => {
  it("assertCrossTenantRefusal refuses when caller tenant != target tenant", () => {
    const lookup = { tenantId: TENANT_B, actorId: ACT1 };
    const r = assertCrossTenantRefusal(lookup, ctx(TENANT_A, ACT1));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("cross-tenant-forbidden");
  });

  it("assertCrossTenantRefusal allows when tenants match", () => {
    const lookup = { tenantId: TENANT_A, actorId: ACT1 };
    const r = assertCrossTenantRefusal(lookup, ctx(TENANT_A, ACT1));
    expect(r.ok).toBe(true);
  });

  it("machineTestCrossTenantRefusal returns 'refused' for cross-tenant lookup", () => {
    const repo = new InMemoryActorRepository();
    repo.saveActor({
      id: ACT1,
      tenantId: TENANT_A,
      displayName: "Alice",
      kind: "human",
      createdAt: NOW,
    });
    const r = machineTestCrossTenantRefusal(repo, ctx(TENANT_B, ACT2), { tenantId: TENANT_A, actorId: ACT1 });
    expect(r.result).toBe("refused");
    expect(r.reason).toBe("cross-tenant-forbidden");
  });

  it("machineTestCrossTenantRefusal returns 'allowed' for same-tenant lookup", () => {
    const repo = new InMemoryActorRepository();
    repo.saveActor({
      id: ACT1,
      tenantId: TENANT_A,
      displayName: "Alice",
      kind: "human",
      createdAt: NOW,
    });
    const r = machineTestCrossTenantRefusal(repo, ctx(TENANT_A, ACT2), { tenantId: TENANT_A, actorId: ACT1 });
    expect(r.result).toBe("allowed");
    expect(r.reason).toBeNull();
  });

  it("machineTestCrossTenantRefusal returns 'allowed' with reason 'actor-not-found' when same-tenant but unknown actor", () => {
    const repo = new InMemoryActorRepository();
    const r = machineTestCrossTenantRefusal(repo, ctx(TENANT_A, ACT2), { tenantId: TENANT_A, actorId: ACT1 });
    expect(r.result).toBe("allowed"); // not a cross-tenant issue; same-tenant but unknown actor
    expect(r.reason).toBe("actor-not-found");
  });

  it("ActorDirectory.lookupActor refuses cross-tenant reads at the directory level", () => {
    const repo = new InMemoryActorRepository();
    repo.saveActor({
      id: ACT1,
      tenantId: TENANT_A,
      displayName: "Alice",
      kind: "human",
      createdAt: NOW,
    });
    const dir = new ActorDirectory(repo, ALL_ROLES);
    // Caller from tenant B tries to look up an actor in tenant A.
    const r = dir.lookupActor(ctx(TENANT_B, ACT2), ACT1);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("actor-not-found"); // fail-closed: looks like "not found" to the caller
  });

  it("ActorDirectory.lookupActor returns the actor for same-tenant reads", () => {
    const repo = new InMemoryActorRepository();
    repo.saveActor({
      id: ACT1,
      tenantId: TENANT_A,
      displayName: "Alice",
      kind: "human",
      createdAt: NOW,
    });
    const dir = new ActorDirectory(repo, ALL_ROLES);
    const r = dir.lookupActor(ctx(TENANT_A, ACT2), ACT1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.actor.id).toBe(ACT1);
  });

  it("ActorDirectory.listActors returns only the caller's tenant actors", () => {
    const repo = new InMemoryActorRepository();
    repo.saveActor({ id: ACT1, tenantId: TENANT_A, displayName: "Alice", kind: "human", createdAt: NOW });
    repo.saveActor({ id: ACT2, tenantId: TENANT_B, displayName: "Bob", kind: "human", createdAt: NOW });
    const dir = new ActorDirectory(repo, ALL_ROLES);
    const a = dir.listActors(ctx(TENANT_A, ACT1));
    const b = dir.listActors(ctx(TENANT_B, ACT2));
    expect(a).toHaveLength(1);
    expect(a[0]!.id).toBe(ACT1);
    expect(b).toHaveLength(1);
    expect(b[0]!.id).toBe(ACT2);
  });
});
