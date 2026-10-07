/**
 * @fleetos/identity — Wave 1 kernel directory (F210A).
 *
 * ActorDirectory — the kernel service over a structural ActorRepositoryPort
 * with a deterministic in-memory reference implementation. Tenant-scoped
 * reads fail-closed.
 *
 * Pure TypeScript over injected PORT interfaces. No I/O, no servers, no
 * databases. Persistence lands at F211 (TL lane).
 */

import type {
  Actor,
  ActorId,
  MembershipId,
  Role,
  RoleId,
  TenantContext,
  TenantId,
} from "./identity.js";
import { isActorId, isMembershipId, isTenantId } from "./identity.js";
import type { AuditEventRef } from "./kernel-audit.js";
import { digestOf } from "./kernel-audit.js";
import type { MembershipRecord } from "./kernel.js";

// ---------------------------------------------------------------------------
// ActorRepositoryPort — structural seam.
//
// Implementations may be in-memory (this package) or persistent (F211 TL).
// Every operation is tenant-scoped; cross-tenant reads fail closed.
// ---------------------------------------------------------------------------

export interface ActorRepositoryPort {
  readonly saveActor: (actor: Actor) => void;
  readonly findActor: (tenantId: TenantId, actorId: ActorId) => Actor | null;
  readonly listActorsByTenant: (tenantId: TenantId) => ReadonlyArray<Actor>;
  readonly saveMembership: (membership: MembershipRecord) => void;
  readonly listMembershipsByTenant: (tenantId: TenantId) => ReadonlyArray<MembershipRecord>;
  readonly listMembershipsByActor: (tenantId: TenantId, actorId: ActorId) => ReadonlyArray<MembershipRecord>;
}

// ---------------------------------------------------------------------------
// InMemoryActorRepository — deterministic reference (no network, no fs).
// ---------------------------------------------------------------------------

export class InMemoryActorRepository implements ActorRepositoryPort {
  private readonly actors = new Map<string, Actor>();
  private readonly memberships = new Map<string, MembershipRecord>();

  saveActor(actor: Actor): void {
    this.actors.set(`${actor.tenantId}:${actor.id}`, actor);
  }

  findActor(tenantId: TenantId, actorId: ActorId): Actor | null {
    return this.actors.get(`${tenantId}:${actorId}`) ?? null;
  }

  listActorsByTenant(tenantId: TenantId): ReadonlyArray<Actor> {
    const out: Actor[] = [];
    for (const a of this.actors.values()) {
      if (a.tenantId === tenantId) out.push(a);
    }
    return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  saveMembership(membership: MembershipRecord): void {
    this.memberships.set(`${membership.tenantId}:${membership.id}`, membership);
  }

  listMembershipsByTenant(tenantId: TenantId): ReadonlyArray<MembershipRecord> {
    const out: MembershipRecord[] = [];
    for (const m of this.memberships.values()) {
      if (m.tenantId === tenantId) out.push(m);
    }
    return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  listMembershipsByActor(tenantId: TenantId, actorId: ActorId): ReadonlyArray<MembershipRecord> {
    const out: MembershipRecord[] = [];
    for (const m of this.memberships.values()) {
      if (m.tenantId === tenantId && m.actorId === actorId) out.push(m);
    }
    return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
}

// ---------------------------------------------------------------------------
// ActorDirectory — the kernel service. Tenant-scoped, fail-closed.
//
// Operations:
//   - registerActor: create an Actor (fail-closed validation)
//   - lookupActor: tenant-scoped read (cross-tenant -> null)
//   - listActors: tenant-scoped enumeration
//   - bindActorToRole: bind a role to an actor (with integrity invariants)
//   - unbindActorFromRole: unbind (idempotent)
//   - listActiveRoles: read active role bindings for an actor (tenant-scoped)
// ---------------------------------------------------------------------------

export type ActorDirectoryRejectionCode =
  | "tenant-mismatch"
  | "actor-not-found"
  | "role-not-found"
  | "duplicate-binding"
  | "orphan-actor"
  | "orphan-role"
  | "malformed-id"
  | "missing-reason";

export class ActorDirectory {
  constructor(
    private readonly repo: ActorRepositoryPort,
    private readonly knownRoles: ReadonlyArray<Role>,
  ) {}

  registerActor(input: {
    readonly actorId: string;
    readonly tenantId: string;
    readonly displayName: string;
    readonly kind: Actor["kind"];
    readonly createdAt: number;
  }):
    | { readonly ok: true; readonly actor: Actor; readonly audit: AuditEventRef }
    | { readonly ok: false; readonly reason: ActorDirectoryRejectionCode } {
    if (!isActorId(input.actorId) || !isTenantId(input.tenantId)) {
      return { ok: false, reason: "malformed-id" };
    }
    const actor: Actor = {
      id: input.actorId as ActorId,
      tenantId: input.tenantId as TenantId,
      displayName: input.displayName,
      kind: input.kind,
      createdAt: input.createdAt,
    };
    this.repo.saveActor(actor);
    const audit: AuditEventRef = {
      actor: actor.id,
      intent: "actor:register",
      tenant: actor.tenantId,
      timestamp: input.createdAt,
      digest: digestOf(actor.id, "register", input.createdAt),
    };
    return { ok: true, actor, audit };
  }

  lookupActor(
    ctx: TenantContext,
    actorId: ActorId,
  ):
    | { readonly ok: true; readonly actor: Actor }
    | { readonly ok: false; readonly reason: ActorDirectoryRejectionCode } {
    const actor = this.repo.findActor(ctx.tenantId, actorId);
    if (!actor) return { ok: false, reason: "actor-not-found" };
    if (actor.tenantId !== ctx.tenantId) return { ok: false, reason: "tenant-mismatch" };
    return { ok: true, actor };
  }

  listActors(ctx: TenantContext): ReadonlyArray<Actor> {
    return this.repo.listActorsByTenant(ctx.tenantId);
  }

  bindActorToRole(input: {
    readonly ctx: TenantContext;
    readonly membershipId: string;
    readonly actorId: ActorId;
    readonly roleId: RoleId;
    readonly at: number;
  }):
    | { readonly ok: true; readonly membership: MembershipRecord; readonly audit: AuditEventRef }
    | { readonly ok: false; readonly reason: ActorDirectoryRejectionCode; readonly audit?: AuditEventRef } {
    const actor = this.repo.findActor(input.ctx.tenantId, input.actorId);
    if (!actor) return { ok: false, reason: "actor-not-found" };
    if (actor.tenantId !== input.ctx.tenantId) return { ok: false, reason: "tenant-mismatch" };
    const role = this.knownRoles.find((r) => r.id === input.roleId);
    if (!role) return { ok: false, reason: "role-not-found" };

    const existing = this.repo.listMembershipsByActor(input.ctx.tenantId, input.actorId);
    const dup = existing.some(
      (m) => m.state === "bound" && m.roleId === input.roleId,
    );
    if (dup) return { ok: false, reason: "duplicate-binding" };

    if (!isMembershipId(input.membershipId)) {
      return { ok: false, reason: "malformed-id" };
    }
    const membership: MembershipRecord = {
      id: input.membershipId as never,
      tenantId: input.ctx.tenantId,
      actorId: input.actorId,
      roleId: input.roleId,
      establishedAt: input.at,
      revokedAt: null,
      state: "bound",
    };
    this.repo.saveMembership(membership);
    const audit: AuditEventRef = {
      actor: input.actorId,
      intent: "membership:bind",
      tenant: input.ctx.tenantId,
      timestamp: input.at,
      digest: digestOf(membership.id, "bind", input.at),
    };
    return { ok: true, membership, audit };
  }

  unbindActorFromRole(input: {
    readonly ctx: TenantContext;
    readonly membershipId: MembershipId;
    readonly reason: string;
    readonly at: number;
  }):
    | { readonly ok: true; readonly membership: MembershipRecord; readonly audit: AuditEventRef; readonly idempotent: boolean }
    | { readonly ok: false; readonly reason: ActorDirectoryRejectionCode } {
    const all = this.repo.listMembershipsByTenant(input.ctx.tenantId);
    const m = all.find((x) => x.id === input.membershipId);
    if (!m) return { ok: false, reason: "actor-not-found" };
    if (m.tenantId !== input.ctx.tenantId) return { ok: false, reason: "tenant-mismatch" };
    if (m.state === "unbound") {
      const audit: AuditEventRef = {
        actor: m.actorId,
        intent: "membership:unbind:idempotent",
        tenant: m.tenantId,
        timestamp: input.at,
        digest: digestOf(m.id, "unbind-idempotent", input.at),
      };
      return { ok: true, membership: m, audit, idempotent: true };
    }
    if (input.reason === "") return { ok: false, reason: "missing-reason" };
    const next: MembershipRecord = { ...m, state: "unbound", revokedAt: input.at };
    this.repo.saveMembership(next);
    const audit: AuditEventRef = {
      actor: m.actorId,
      intent: "membership:unbind",
      tenant: m.tenantId,
      timestamp: input.at,
      digest: digestOf(m.id, "unbind", input.at),
    };
    return { ok: true, membership: next, audit, idempotent: false };
  }

  listActiveRoles(ctx: TenantContext, actorId: ActorId): ReadonlyArray<MembershipRecord> {
    return this.repo
      .listMembershipsByActor(ctx.tenantId, actorId)
      .filter((m) => m.state === "bound");
  }
}
