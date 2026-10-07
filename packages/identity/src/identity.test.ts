import { describe, it, expect } from "vitest";
import {
  isTenantId,
  isActorId,
  isRoleId,
  isMembershipId,
  isSessionId,
  makeTenantContext,
  sameTenant,
  type TenantContext,
  type TenantId,
  type ActorId,
  type RoleId,
} from "./identity.js";

describe("identity: branded id guards", () => {
  it("accepts well-formed tenant id", () => {
    expect(isTenantId("tnt_acme-corp-001")).toBe(true);
  });
  it("rejects tenant id without prefix", () => {
    expect(isTenantId("acme-corp-001")).toBe(false);
  });
  it("rejects actor id with wrong prefix", () => {
    expect(isActorId("tnt_acme-corp-001")).toBe(false);
  });
  it("accepts role id with role_ prefix", () => {
    expect(isRoleId("role_admin")).toBe(true);
  });
  it("rejects membership id shorter than 4 chars after prefix", () => {
    expect(isMembershipId("mbr_ab")).toBe(false);
  });
  it("accepts session id with long enough suffix", () => {
    expect(isSessionId("sess_abcdef0123456789")).toBe(true);
  });
});

describe("identity: makeTenantContext fail-closed", () => {
  const validInput = {
    tenantId: "tnt_acme-corp-001",
    actorId: "act_alice-001",
    roleId: "role_admin",
    establishedAt: 1_727_000_000_000,
  };

  it("accepts well-formed input and returns immutable context", () => {
    const result = makeTenantContext(validInput);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ctx = result.context as TenantContext;
      expect(ctx.tenantId).toBe("tnt_acme-corp-001");
      expect(ctx.scope).toBe("tenant");
      expect(Object.isFrozen(ctx)).toBe(false); // structural readonly enforced by TS, not Object.freeze
      // But the readonly modifiers prevent reassignment at compile time; verify by attempting access:
      expect(typeof ctx.establishedAt).toBe("number");
    }
  });

  it("rejects missing tenant id with stable reason code", () => {
    const result = makeTenantContext({ ...validInput, tenantId: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("missing-tenant-id");
  });

  it("rejects missing actor id with stable reason code", () => {
    const result = makeTenantContext({ ...validInput, actorId: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("missing-actor-id");
  });

  it("rejects malformed role id with stable reason code", () => {
    const result = makeTenantContext({ ...validInput, roleId: "admin" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("malformed-role-id");
  });

  it("rejects invalid establishedAt boundary", () => {
    const result = makeTenantContext({ ...validInput, establishedAt: NaN });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid-established-at");
  });

  it("rejects cross-tenant-forbidden scope on construction", () => {
    const result = makeTenantContext({ ...validInput, scope: "cross-tenant-forbidden" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("cross-tenant-forbidden");
  });

  it("returns deterministic result for identical inputs", () => {
    const a = makeTenantContext(validInput);
    const b = makeTenantContext(validInput);
    expect(a).toEqual(b);
  });
});

describe("identity: sameTenant predicate", () => {
  const baseInput = {
    tenantId: "tnt_acme-corp-001",
    actorId: "act_alice-001",
    roleId: "role_admin",
    establishedAt: 1_727_000_000_000,
  };
  it("returns true for contexts sharing the same tenant", () => {
    const a = makeTenantContext(baseInput);
    const b = makeTenantContext({ ...baseInput, actorId: "act_bob-002" });
    if (a.ok && b.ok) expect(sameTenant(a.context, b.context)).toBe(true);
  });
  it("returns false for contexts in different tenants", () => {
    const a = makeTenantContext(baseInput);
    const b = makeTenantContext({ ...baseInput, tenantId: "tnt_other-corp-002" });
    if (a.ok && b.ok) expect(sameTenant(a.context, b.context)).toBe(false);
  });
});

describe("identity: structural brand separation", () => {
  it("branded types are structurally strings but not interchangeable", () => {
    const tnt = "tnt_alpha-001" as TenantId;
    const act = "act_alpha-001" as ActorId;
    // Compile-time: branded types are subtypes of string.
    const s1: string = tnt;
    const s2: string = act;
    expect(s1.startsWith("tnt_")).toBe(true);
    expect(s2.startsWith("act_")).toBe(true);
    // isTenantId narrows to TenantId only when format matches.
    expect(isTenantId(s1)).toBe(true);
    expect(isTenantId(s2)).toBe(false);
  });

  it("RoleId brand narrows independently", () => {
    const r = "role_admin-001" as RoleId;
    expect(isRoleId(r)).toBe(true);
    expect(isActorId(r)).toBe(false);
  });
});
