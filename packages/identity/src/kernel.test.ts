import { describe, it, expect } from "vitest";
import {
  ActorDirectory,
  InMemoryActorRepository,
  bindRole,
  evaluateSessionTransition,
  issueSession,
  unbindRole,
  validateSession,
} from "./kernel.js";
import { makeTenantContext, type Actor, type Role, type TenantContext } from "./identity.js";

const NOW = 1_727_000_000_000;
const TENANT_A = "tnt_acme-corp-001";
const TENANT_B = "tnt_other-corp-002";
const ACTOR_A = "act_alice-001";
const ACTOR_B = "act_bob-002";
const ROLE_ADMIN = "role_admin";
const ROLE_OPS = "role_ops";
const SESSION_1 = "sess_abcdef0123456789";

function ctxForTenant(tenant: string, actor: string): TenantContext {
  const r = makeTenantContext({
    tenantId: tenant,
    actorId: actor,
    roleId: ROLE_ADMIN,
    establishedAt: NOW,
  });
  if (!r.ok) throw new Error("bad ctx");
  return r.context;
}

function sampleRole(id: string, scope: Role["scope"] = "tenant"): Role {
  return { id: id as Role["id"], scope, label: id, capabilities: ["read"] };
}

function sampleActor(id: string, tenant: string): Actor {
  return {
    id: id as Actor["id"],
    tenantId: tenant as Actor["tenantId"],
    displayName: id,
    kind: "human",
    createdAt: NOW,
  };
}

describe("identity kernel: AuditEventRef shape", () => {
  it("evaluateSessionTransition emits audit with all five fields", () => {
    const r = evaluateSessionTransition("issued", { kind: "activate", at: NOW + 1 }, {
      id: SESSION_1 as never,
      actorId: ACTOR_A as never,
      tenantId: TENANT_A as never,
    });
    if (!r.ok) throw new Error("expected ok");
    expect(r.audit).toBeTruthy();
    expect(typeof r.audit.actor).toBe("string");
    expect(typeof r.audit.intent).toBe("string");
    expect(typeof r.audit.tenant).toBe("string");
    expect(typeof r.audit.timestamp).toBe("number");
    expect(typeof r.audit.digest).toBe("string");
    expect(r.audit.digest.length).toBe(64); // sha256 hex
  });

  it("audit digest is deterministic — same inputs produce same digest", () => {
    const a = evaluateSessionTransition("issued", { kind: "activate", at: NOW + 1 }, {
      id: SESSION_1 as never,
      actorId: ACTOR_A as never,
      tenantId: TENANT_A as never,
    });
    const b = evaluateSessionTransition("issued", { kind: "activate", at: NOW + 1 }, {
      id: SESSION_1 as never,
      actorId: ACTOR_A as never,
      tenantId: TENANT_A as never,
    });
    if (!a.ok || !b.ok) throw new Error("expected ok");
    expect(a.audit.digest).toBe(b.audit.digest);
  });
});

describe("identity kernel: session lifecycle state machine", () => {
  const session = { id: SESSION_1 as never, actorId: ACTOR_A as never, tenantId: TENANT_A as never };

  it("issued -> active via activate", () => {
    const r = evaluateSessionTransition("issued", { kind: "activate", at: NOW + 1 }, session);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.from).toBe("issued");
      expect(r.to).toBe("active");
    }
  });

  it("issued -> revoked via revoke (terminal)", () => {
    const r = evaluateSessionTransition("issued", { kind: "revoke", at: NOW + 2, reason: "compromised" }, session);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.to).toBe("revoked");
  });

  it("revoke requires a reason (missing-reason)", () => {
    const r = evaluateSessionTransition("issued", { kind: "revoke", at: NOW + 2 }, session);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing-reason");
  });

  it("active -> expired via expire", () => {
    const r = evaluateSessionTransition("active", { kind: "expire", at: NOW + 3 }, session);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.to).toBe("expired");
  });

  it("active -> revoked via revoke (reason provided)", () => {
    const r = evaluateSessionTransition("active", { kind: "revoke", at: NOW + 4, reason: "abuse" }, session);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.to).toBe("revoked");
  });

  it("expired is terminal (illegal-transition on activate)", () => {
    const r = evaluateSessionTransition("expired", { kind: "activate", at: NOW + 5 }, session);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("illegal-transition");
  });

  it("revoked is terminal (illegal-transition on activate)", () => {
    const r = evaluateSessionTransition("revoked", { kind: "activate", at: NOW + 6 }, session);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("illegal-transition");
  });

  it("expire from expired -> already-in-target-state", () => {
    const r = evaluateSessionTransition("expired", { kind: "expire", at: NOW + 7 }, session);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("already-in-target-state");
  });

  it("revoke from revoked with reason -> already-in-target-state", () => {
    const r = evaluateSessionTransition("revoked", { kind: "revoke", at: NOW + 8, reason: "again" }, session);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("already-in-target-state");
  });

  it("unknown command kind -> unknown-command", () => {
    const r = evaluateSessionTransition("issued", { kind: "frob" as never, at: NOW }, session);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unknown-command");
  });
});

describe("identity kernel: issueSession (monotonic sequence)", () => {
  it("issues first session with seq=1 when lastSeq=0", () => {
    const r = issueSession({
      sessionId: SESSION_1,
      tenantId: TENANT_A,
      actorId: ACTOR_A,
      roleId: ROLE_ADMIN,
      issuedAt: NOW,
      expiresAt: NOW + 3600_000,
      lastSeq: 0,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.issued.session.seq).toBe(1);
      expect(r.issued.session.state).toBe("issued");
      expect(r.issued.audit.intent).toBe("session:issue");
    }
  });

  it("issues second session with seq=2 when lastSeq=1 (strict monotonic)", () => {
    const r = issueSession({
      sessionId: "sess_abcdef0123456790",
      tenantId: TENANT_A,
      actorId: ACTOR_A,
      roleId: ROLE_ADMIN,
      issuedAt: NOW + 1000,
      expiresAt: null,
      lastSeq: 1,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.issued.session.seq).toBe(2);
  });

  it("refuses malformed tenantId (missing-tenant-id then malformed-tenant-id)", () => {
    const r1 = issueSession({ sessionId: SESSION_1, tenantId: "", actorId: ACTOR_A, roleId: ROLE_ADMIN, issuedAt: NOW, expiresAt: null, lastSeq: 0 });
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.reason).toBe("missing-tenant-id");
    const r2 = issueSession({ sessionId: SESSION_1, tenantId: "bad", actorId: ACTOR_A, roleId: ROLE_ADMIN, issuedAt: NOW, expiresAt: null, lastSeq: 0 });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toBe("malformed-tenant-id");
  });

  it("refuses malformed actorId and roleId", () => {
    const r1 = issueSession({ sessionId: SESSION_1, tenantId: TENANT_A, actorId: "", roleId: ROLE_ADMIN, issuedAt: NOW, expiresAt: null, lastSeq: 0 });
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.reason).toBe("missing-actor-id");
    const r2 = issueSession({ sessionId: SESSION_1, tenantId: TENANT_A, actorId: "bad", roleId: ROLE_ADMIN, issuedAt: NOW, expiresAt: null, lastSeq: 0 });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toBe("malformed-actor-id");
    const r3 = issueSession({ sessionId: SESSION_1, tenantId: TENANT_A, actorId: ACTOR_A, roleId: "bad", issuedAt: NOW, expiresAt: null, lastSeq: 0 });
    expect(r3.ok).toBe(false);
    if (!r3.ok) expect(r3.reason).toBe("malformed-role-id");
  });

  it("refuses invalid issuedAt (NaN or <=0)", () => {
    const r = issueSession({ sessionId: SESSION_1, tenantId: TENANT_A, actorId: ACTOR_A, roleId: ROLE_ADMIN, issuedAt: NaN, expiresAt: null, lastSeq: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid-issued-at");
  });

  it("refuses negative lastSeq (non-monotonic-seq)", () => {
    const r = issueSession({ sessionId: SESSION_1, tenantId: TENANT_A, actorId: ACTOR_A, roleId: ROLE_ADMIN, issuedAt: NOW, expiresAt: null, lastSeq: -1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("non-monotonic-seq");
  });
});

describe("identity kernel: validateSession (fail-closed)", () => {
  it("returns valid for an active session in the same tenant", () => {
    const ctx = ctxForTenant(TENANT_A, ACTOR_A);
    const session = {
      id: SESSION_1 as never,
      tenantId: TENANT_A as never,
      actorId: ACTOR_A as never,
      roleId: ROLE_ADMIN as never,
      establishedAt: NOW,
      expiresAt: NOW + 3600_000,
      state: "active" as const,
      seq: 1,
    };
    const r = validateSession(ctx, session, NOW + 1);
    expect(r.ok).toBe(true);
  });

  it("rejects with tenant-mismatch when session belongs to another tenant", () => {
    const ctx = ctxForTenant(TENANT_A, ACTOR_A);
    const session = {
      id: SESSION_1 as never,
      tenantId: TENANT_B as never,
      actorId: ACTOR_A as never,
      roleId: ROLE_ADMIN as never,
      establishedAt: NOW,
      expiresAt: null,
      state: "active" as const,
      seq: 1,
    };
    const r = validateSession(ctx, session, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("tenant-mismatch");
  });

  it("rejects with actor-mismatch when session belongs to another actor", () => {
    const ctx = ctxForTenant(TENANT_A, ACTOR_A);
    const session = {
      id: SESSION_1 as never,
      tenantId: TENANT_A as never,
      actorId: ACTOR_B as never,
      roleId: ROLE_ADMIN as never,
      establishedAt: NOW,
      expiresAt: null,
      state: "active" as const,
      seq: 1,
    };
    const r = validateSession(ctx, session, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("actor-mismatch");
  });

  it("rejects revoked sessions", () => {
    const ctx = ctxForTenant(TENANT_A, ACTOR_A);
    const session = {
      id: SESSION_1 as never,
      tenantId: TENANT_A as never,
      actorId: ACTOR_A as never,
      roleId: ROLE_ADMIN as never,
      establishedAt: NOW,
      expiresAt: null,
      state: "revoked" as const,
      seq: 1,
    };
    const r = validateSession(ctx, session, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("revoked");
  });

  it("rejects issued sessions that have not been activated (not-yet-active)", () => {
    const ctx = ctxForTenant(TENANT_A, ACTOR_A);
    const session = {
      id: SESSION_1 as never,
      tenantId: TENANT_A as never,
      actorId: ACTOR_A as never,
      roleId: ROLE_ADMIN as never,
      establishedAt: NOW,
      expiresAt: null,
      state: "issued" as const,
      seq: 1,
    };
    const r = validateSession(ctx, session, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("not-yet-active");
  });

  it("rejects expired sessions (now > expiresAt)", () => {
    const ctx = ctxForTenant(TENANT_A, ACTOR_A);
    const session = {
      id: SESSION_1 as never,
      tenantId: TENANT_A as never,
      actorId: ACTOR_A as never,
      roleId: ROLE_ADMIN as never,
      establishedAt: NOW,
      expiresAt: NOW + 1000,
      state: "active" as const,
      seq: 1,
    };
    const r = validateSession(ctx, session, NOW + 2000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("expired");
  });
});

describe("identity kernel: bindRole integrity", () => {
  const actorA = sampleActor(ACTOR_A, TENANT_A);
  const roleAdmin = sampleRole(ROLE_ADMIN);

  it("binds a role successfully when no duplicate exists", () => {
    const r = bindRole({
      membershipId: "mbr_alice-admin-001",
      tenantId: TENANT_A,
      actorId: ACTOR_A,
      roleId: ROLE_ADMIN,
      establishedAt: NOW,
      existingBindings: [],
      knownActors: [actorA],
      knownRoles: [roleAdmin],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.membership.state).toBe("bound");
      expect(r.audit.intent).toBe("membership:bind");
    }
  });

  it("refuses duplicate (actor, role) binding", () => {
    const existing = [{
      id: "mbr_alice-admin-000" as never,
      tenantId: TENANT_A as never,
      actorId: ACTOR_A as never,
      roleId: ROLE_ADMIN as never,
      establishedAt: NOW - 1000,
      revokedAt: null,
      state: "bound" as const,
    }];
    const r = bindRole({
      membershipId: "mbr_alice-admin-001",
      tenantId: TENANT_A,
      actorId: ACTOR_A,
      roleId: ROLE_ADMIN,
      establishedAt: NOW,
      existingBindings: existing,
      knownActors: [actorA],
      knownRoles: [roleAdmin],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("duplicate-binding");
  });

  it("refuses orphan-actor (actor not in known set)", () => {
    const r = bindRole({
      membershipId: "mbr_alice-admin-001",
      tenantId: TENANT_A,
      actorId: "act_unknown-999",
      roleId: ROLE_ADMIN,
      establishedAt: NOW,
      existingBindings: [],
      knownActors: [actorA],
      knownRoles: [roleAdmin],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("orphan-actor");
  });

  it("refuses orphan-role (role not in known set)", () => {
    const r = bindRole({
      membershipId: "mbr_alice-admin-001",
      tenantId: TENANT_A,
      actorId: ACTOR_A,
      roleId: "role_unknown",
      establishedAt: NOW,
      existingBindings: [],
      knownActors: [actorA],
      knownRoles: [roleAdmin],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("orphan-role");
  });

  it("refuses tenant-mismatch (actor in different tenant)", () => {
    const r = bindRole({
      membershipId: "mbr_alice-admin-001",
      tenantId: TENANT_B,
      actorId: ACTOR_A,
      roleId: ROLE_ADMIN,
      establishedAt: NOW,
      existingBindings: [],
      knownActors: [actorA],
      knownRoles: [roleAdmin],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("orphan-actor");
  });

  it("refuses malformed-membership-id", () => {
    const r = bindRole({
      membershipId: "bad",
      tenantId: TENANT_A,
      actorId: ACTOR_A,
      roleId: ROLE_ADMIN,
      establishedAt: NOW,
      existingBindings: [],
      knownActors: [actorA],
      knownRoles: [roleAdmin],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("malformed-membership-id");
  });

  it("allows re-binding an unbound (actor, role) pair under a fresh membership id", () => {
    const unbound = {
      id: "mbr_alice-admin-000" as never,
      tenantId: TENANT_A as never,
      actorId: ACTOR_A as never,
      roleId: ROLE_ADMIN as never,
      establishedAt: NOW - 1000,
      revokedAt: NOW - 500,
      state: "unbound" as const,
    };
    const r = bindRole({
      membershipId: "mbr_alice-admin-001",
      tenantId: TENANT_A,
      actorId: ACTOR_A,
      roleId: ROLE_ADMIN,
      establishedAt: NOW,
      existingBindings: [unbound],
      knownActors: [actorA],
      knownRoles: [roleAdmin],
    });
    expect(r.ok).toBe(true);
  });
});

describe("identity kernel: unbindRole (idempotent)", () => {
  it("unbound membership is idempotent (idempotent=true, same membership)", () => {
    const m = {
      id: "mbr_x-0001" as never,
      tenantId: TENANT_A as never,
      actorId: ACTOR_A as never,
      roleId: ROLE_ADMIN as never,
      establishedAt: NOW,
      revokedAt: NOW + 1000,
      state: "unbound" as const,
    };
    const r = unbindRole(m, NOW + 2000, "duplicate");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.idempotent).toBe(true);
      expect(r.membership.state).toBe("unbound");
    }
  });

  it("unbound membership with empty reason still returns idempotent ack", () => {
    const m = {
      id: "mbr_x-0001" as never,
      tenantId: TENANT_A as never,
      actorId: ACTOR_A as never,
      roleId: ROLE_ADMIN as never,
      establishedAt: NOW,
      revokedAt: NOW + 1000,
      state: "unbound" as const,
    };
    const r = unbindRole(m, NOW + 2000, "");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.idempotent).toBe(true);
  });

  it("bound membership with empty reason -> missing-reason", () => {
    const m = {
      id: "mbr_x-0001" as never,
      tenantId: TENANT_A as never,
      actorId: ACTOR_A as never,
      roleId: ROLE_ADMIN as never,
      establishedAt: NOW,
      revokedAt: null,
      state: "bound" as const,
    };
    const r = unbindRole(m, NOW + 2000, "");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing-reason");
  });

  it("bound membership with reason transitions to unbound and emits audit", () => {
    const m = {
      id: "mbr_x-0001" as never,
      tenantId: TENANT_A as never,
      actorId: ACTOR_A as never,
      roleId: ROLE_ADMIN as never,
      establishedAt: NOW,
      revokedAt: null,
      state: "bound" as const,
    };
    const r = unbindRole(m, NOW + 2000, "policy-violation");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.idempotent).toBe(false);
      expect(r.membership.state).toBe("unbound");
      expect(r.membership.revokedAt).toBe(NOW + 2000);
      expect(r.audit.intent).toBe("membership:unbind");
    }
  });
});

describe("identity kernel: ActorDirectory tenant fail-closed", () => {
  function makeDirectory() {
    const repo = new InMemoryActorRepository();
    const roles = [sampleRole(ROLE_ADMIN), sampleRole(ROLE_OPS)];
    const dir = new ActorDirectory(repo, roles);
    return { repo, dir };
  }

  it("registerActor saves actor and emits audit", () => {
    const { dir } = makeDirectory();
    const r = dir.registerActor({
      actorId: ACTOR_A,
      tenantId: TENANT_A,
      displayName: "Alice",
      kind: "human",
      createdAt: NOW,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.actor.id).toBe(ACTOR_A as never);
      expect(r.audit.intent).toBe("actor:register");
    }
  });

  it("lookupActor in same tenant succeeds", () => {
    const { dir } = makeDirectory();
    dir.registerActor({ actorId: ACTOR_A, tenantId: TENANT_A, displayName: "A", kind: "human", createdAt: NOW });
    const ctx = ctxForTenant(TENANT_A, ACTOR_A);
    const r = dir.lookupActor(ctx, ACTOR_A as never);
    expect(r.ok).toBe(true);
  });

  it("lookupActor in different tenant returns actor-not-found (fail-closed)", () => {
    const { dir } = makeDirectory();
    dir.registerActor({ actorId: ACTOR_A, tenantId: TENANT_A, displayName: "A", kind: "human", createdAt: NOW });
    const ctx = ctxForTenant(TENANT_B, "act_b-001");
    const r = dir.lookupActor(ctx, ACTOR_A as never);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("actor-not-found");
  });

  it("listActors returns only the ctx tenant's actors", () => {
    const { dir } = makeDirectory();
    dir.registerActor({ actorId: ACTOR_A, tenantId: TENANT_A, displayName: "A", kind: "human", createdAt: NOW });
    dir.registerActor({ actorId: "act_bob-002", tenantId: TENANT_B, displayName: "B", kind: "human", createdAt: NOW });
    const ctxA = ctxForTenant(TENANT_A, ACTOR_A);
    const ctxB = ctxForTenant(TENANT_B, "act_bob-002");
    expect(dir.listActors(ctxA)).toHaveLength(1);
    expect(dir.listActors(ctxB)).toHaveLength(1);
  });

  it("bindActorToRole creates a binding in the directory", () => {
    const { dir } = makeDirectory();
    dir.registerActor({ actorId: ACTOR_A, tenantId: TENANT_A, displayName: "A", kind: "human", createdAt: NOW });
    const ctx = ctxForTenant(TENANT_A, ACTOR_A);
    const r = dir.bindActorToRole({ ctx, membershipId: "mbr_a-0001", actorId: ACTOR_A as never, roleId: ROLE_ADMIN as never, at: NOW + 100 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.membership.state).toBe("bound");
  });

  it("bindActorToRole refuses duplicate bindings", () => {
    const { dir } = makeDirectory();
    dir.registerActor({ actorId: ACTOR_A, tenantId: TENANT_A, displayName: "A", kind: "human", createdAt: NOW });
    const ctx = ctxForTenant(TENANT_A, ACTOR_A);
    dir.bindActorToRole({ ctx, membershipId: "mbr_a-0001", actorId: ACTOR_A as never, roleId: ROLE_ADMIN as never, at: NOW + 100 });
    const r = dir.bindActorToRole({ ctx, membershipId: "mbr_a-0002", actorId: ACTOR_A as never, roleId: ROLE_ADMIN as never, at: NOW + 200 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("duplicate-binding");
  });

  it("bindActorToRole refuses role-not-found for unknown role", () => {
    const { dir } = makeDirectory();
    dir.registerActor({ actorId: ACTOR_A, tenantId: TENANT_A, displayName: "A", kind: "human", createdAt: NOW });
    const ctx = ctxForTenant(TENANT_A, ACTOR_A);
    const r = dir.bindActorToRole({ ctx, membershipId: "mbr_a-0001", actorId: ACTOR_A as never, roleId: "role_unknown" as never, at: NOW + 100 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("role-not-found");
  });

  it("bindActorToRole refuses actor-not-found for unknown actor", () => {
    const { dir } = makeDirectory();
    const ctx = ctxForTenant(TENANT_A, ACTOR_A);
    const r = dir.bindActorToRole({ ctx, membershipId: "mbr_a-0001", actorId: ACTOR_A as never, roleId: ROLE_ADMIN as never, at: NOW + 100 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("actor-not-found");
  });

  it("unbindActorFromRole transitions to unbound and emits audit", () => {
    const { dir } = makeDirectory();
    dir.registerActor({ actorId: ACTOR_A, tenantId: TENANT_A, displayName: "A", kind: "human", createdAt: NOW });
    const ctx = ctxForTenant(TENANT_A, ACTOR_A);
    dir.bindActorToRole({ ctx, membershipId: "mbr_a-0001", actorId: ACTOR_A as never, roleId: ROLE_ADMIN as never, at: NOW + 100 });
    const r = dir.unbindActorFromRole({ ctx, membershipId: "mbr_a-0001" as never, reason: "rotation", at: NOW + 200 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.membership.state).toBe("unbound");
      expect(r.idempotent).toBe(false);
    }
  });

  it("unbindActorFromRole is idempotent on an already-unbound membership", () => {
    const { dir } = makeDirectory();
    dir.registerActor({ actorId: ACTOR_A, tenantId: TENANT_A, displayName: "A", kind: "human", createdAt: NOW });
    const ctx = ctxForTenant(TENANT_A, ACTOR_A);
    dir.bindActorToRole({ ctx, membershipId: "mbr_a-0001", actorId: ACTOR_A as never, roleId: ROLE_ADMIN as never, at: NOW + 100 });
    dir.unbindActorFromRole({ ctx, membershipId: "mbr_a-0001" as never, reason: "rotation", at: NOW + 200 });
    const r = dir.unbindActorFromRole({ ctx, membershipId: "mbr_a-0001" as never, reason: "rotation", at: NOW + 300 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.idempotent).toBe(true);
  });

  it("unbindActorFromRole with empty reason on a bound membership -> missing-reason", () => {
    const { dir } = makeDirectory();
    dir.registerActor({ actorId: ACTOR_A, tenantId: TENANT_A, displayName: "A", kind: "human", createdAt: NOW });
    const ctx = ctxForTenant(TENANT_A, ACTOR_A);
    dir.bindActorToRole({ ctx, membershipId: "mbr_a-0001", actorId: ACTOR_A as never, roleId: ROLE_ADMIN as never, at: NOW + 100 });
    const r = dir.unbindActorFromRole({ ctx, membershipId: "mbr_a-0001" as never, reason: "", at: NOW + 200 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing-reason");
  });

  it("listActiveRoles returns only active (bound) memberships for an actor", () => {
    const { dir } = makeDirectory();
    dir.registerActor({ actorId: ACTOR_A, tenantId: TENANT_A, displayName: "A", kind: "human", createdAt: NOW });
    const ctx = ctxForTenant(TENANT_A, ACTOR_A);
    dir.bindActorToRole({ ctx, membershipId: "mbr_a-0001", actorId: ACTOR_A as never, roleId: ROLE_ADMIN as never, at: NOW + 100 });
    dir.bindActorToRole({ ctx, membershipId: "mbr_a-0002", actorId: ACTOR_A as never, roleId: ROLE_OPS as never, at: NOW + 200 });
    dir.unbindActorFromRole({ ctx, membershipId: "mbr_a-0001" as never, reason: "r", at: NOW + 300 });
    expect(dir.listActiveRoles(ctx, ACTOR_A as never)).toHaveLength(1);
  });
});
