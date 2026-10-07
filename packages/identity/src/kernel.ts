/**
 * @fleetos/identity — Wave 1 kernel (F210A).
 *
 * Actor kernel:
 *   - Session issuance + validation lifecycle (issue -> active -> expired/revoked)
 *     with machine-stable reason codes and monotonic sequence per actor.
 *   - Membership state machine with role binding/unbinding integrity
 *     (no duplicate (actor,role) pairs; no orphan bindings).
 *
 * The ActorDirectory + ActorRepositoryPort live in `kernel-directory.ts`.
 * AuditEventRef + digestOf live in `kernel-audit.ts`.
 *
 * Pure TypeScript over injected PORT interfaces. No I/O, no servers, no
 * databases. Persistence lands at F211 (TL lane).
 */

import type {
  Actor,
  ActorId,
  Membership,
  MembershipId,
  Role,
  RoleId,
  Session,
  SessionId,
  TenantContext,
  TenantId,
} from "./identity.js";
import { isActorId, isMembershipId, isRoleId, isSessionId, isTenantId, sameTenant } from "./identity.js";

// Re-export the audit + directory primitives so consumers have a single entry.
export * from "./kernel-audit.js";
export * from "./kernel-directory.js";
import type { AuditEventRef } from "./kernel-audit.js";
import { digestOf } from "./kernel-audit.js";

// ---------------------------------------------------------------------------
// Session lifecycle — issue -> active -> expired/revoked.
// ---------------------------------------------------------------------------

export type SessionState = "issued" | "active" | "expired" | "revoked";

export type SessionCommandKind = "activate" | "expire" | "revoke";

export interface SessionCommand {
  readonly kind: SessionCommandKind;
  readonly reason?: string;
  readonly at: number;
}

export type SessionRejectionCode =
  | "illegal-transition"
  | "already-in-target-state"
  | "unknown-command"
  | "missing-reason";

export type SessionTransitionResult =
  | { readonly ok: true; readonly from: SessionState; readonly to: SessionState; readonly audit: AuditEventRef }
  | { readonly ok: false; readonly reason: SessionRejectionCode };

const SESSION_TRANSITIONS: Readonly<Record<
  SessionState,
  Partial<Record<SessionCommandKind, SessionState>>
>> = {
  issued: { activate: "active", revoke: "revoked" },
  active: { expire: "expired", revoke: "revoked" },
  expired: {},
  revoked: {},
};

export function evaluateSessionTransition(
  current: SessionState,
  command: SessionCommand,
  session: { readonly id: SessionId; readonly actorId: ActorId; readonly tenantId: TenantId },
): SessionTransitionResult {
  const known: ReadonlyArray<SessionCommandKind> = ["activate", "expire", "revoke"];
  if (!known.includes(command.kind)) return { ok: false, reason: "unknown-command" };

  if (command.kind === "revoke" && (command.reason === undefined || command.reason === "")) {
    return { ok: false, reason: "missing-reason" };
  }

  const next = SESSION_TRANSITIONS[current]?.[command.kind];
  if (next === undefined) {
    if (
      (command.kind === "expire" && current === "expired") ||
      (command.kind === "revoke" && current === "revoked")
    ) {
      return { ok: false, reason: "already-in-target-state" };
    }
    return { ok: false, reason: "illegal-transition" };
  }

  const audit: AuditEventRef = {
    actor: session.actorId,
    intent: `session:${command.kind}`,
    tenant: session.tenantId,
    timestamp: command.at,
    digest: digestOf(session.id, command.kind, command.at),
  };

  return { ok: true, from: current, to: next, audit };
}

// ---------------------------------------------------------------------------
// Session issuance — monotonic sequence per actor.
// ---------------------------------------------------------------------------

export interface IssuedSession {
  readonly session: Session & { readonly state: SessionState; readonly seq: number };
  readonly audit: AuditEventRef;
}

export type IssueSessionRejectionCode =
  | "missing-actor-id"
  | "missing-role-id"
  | "missing-tenant-id"
  | "malformed-actor-id"
  | "malformed-role-id"
  | "malformed-tenant-id"
  | "non-monotonic-seq"
  | "invalid-issued-at";

export type IssueSessionResult =
  | { readonly ok: true; readonly issued: IssuedSession }
  | { readonly ok: false; readonly reason: IssueSessionRejectionCode };

export interface IssueSessionInput {
  readonly sessionId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly roleId: string;
  readonly issuedAt: number;
  readonly expiresAt: number | null;
  readonly lastSeq: number;
}

export function issueSession(input: IssueSessionInput): IssueSessionResult {
  if (input.tenantId === "") return { ok: false, reason: "missing-tenant-id" };
  if (input.actorId === "") return { ok: false, reason: "missing-actor-id" };
  if (input.roleId === "") return { ok: false, reason: "missing-role-id" };
  if (!isTenantId(input.tenantId)) return { ok: false, reason: "malformed-tenant-id" };
  if (!isActorId(input.actorId)) return { ok: false, reason: "malformed-actor-id" };
  if (!isRoleId(input.roleId)) return { ok: false, reason: "malformed-role-id" };
  if (!Number.isFinite(input.issuedAt) || input.issuedAt <= 0) {
    return { ok: false, reason: "invalid-issued-at" };
  }
  if (!Number.isFinite(input.lastSeq) || input.lastSeq < 0) {
    return { ok: false, reason: "non-monotonic-seq" };
  }
  const seq = input.lastSeq + 1;
  if (seq <= input.lastSeq) return { ok: false, reason: "non-monotonic-seq" };
  if (!isSessionId(input.sessionId)) {
    // Caller may use a non-canonical id scheme; we coerce to SessionId.
  }
  const session: Session & { readonly state: SessionState; readonly seq: number } = {
    id: input.sessionId as SessionId,
    tenantId: input.tenantId as TenantId,
    actorId: input.actorId as ActorId,
    roleId: input.roleId as RoleId,
    establishedAt: input.issuedAt,
    expiresAt: input.expiresAt,
    state: "issued",
    seq,
  };
  const audit: AuditEventRef = {
    actor: input.actorId,
    intent: "session:issue",
    tenant: input.tenantId,
    timestamp: input.issuedAt,
    digest: digestOf(input.sessionId, "issue", seq, input.issuedAt),
  };
  return { ok: true, issued: { session, audit } };
}

// ---------------------------------------------------------------------------
// Session validation — pure predicate over (context, session, now).
// ---------------------------------------------------------------------------

export type SessionValidationCode =
  | "valid"
  | "expired"
  | "revoked"
  | "not-yet-active"
  | "tenant-mismatch"
  | "actor-mismatch";

export function validateSession(
  ctx: TenantContext,
  session: Session & { readonly state: SessionState },
  now: number,
): { readonly ok: true; readonly code: "valid" } | { readonly ok: false; readonly reason: SessionValidationCode } {
  if (!sameTenant(ctx, { ...ctx, tenantId: session.tenantId })) {
    return { ok: false, reason: "tenant-mismatch" };
  }
  if (ctx.actorId !== session.actorId) {
    return { ok: false, reason: "actor-mismatch" };
  }
  if (session.state === "revoked") return { ok: false, reason: "revoked" };
  if (session.state === "expired") return { ok: false, reason: "expired" };
  if (session.state === "issued") {
    return { ok: false, reason: "not-yet-active" };
  }
  if (session.expiresAt !== null && now > session.expiresAt) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, code: "valid" };
}

// ---------------------------------------------------------------------------
// Membership state machine — role binding/unbinding with integrity.
// ---------------------------------------------------------------------------

export type MembershipState = "bound" | "unbound";

export interface MembershipRecord extends Membership {
  readonly state: MembershipState;
}

export type MembershipRejectionCode =
  | "duplicate-binding"
  | "orphan-actor"
  | "orphan-role"
  | "tenant-mismatch"
  | "malformed-membership-id"
  | "missing-reason"
  | "already-in-target-state";

export type BindRoleResult =
  | { readonly ok: true; readonly membership: MembershipRecord; readonly audit: AuditEventRef }
  | { readonly ok: false; readonly reason: MembershipRejectionCode };

export interface BindRoleInput {
  readonly membershipId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly roleId: string;
  readonly establishedAt: number;
  readonly existingBindings: ReadonlyArray<MembershipRecord>;
  readonly knownActors: ReadonlyArray<Actor>;
  readonly knownRoles: ReadonlyArray<Role>;
}

export function bindRole(input: BindRoleInput): BindRoleResult {
  if (!isMembershipId(input.membershipId)) {
    return { ok: false, reason: "malformed-membership-id" };
  }
  if (!isTenantId(input.tenantId) || !isActorId(input.actorId) || !isRoleId(input.roleId)) {
    return { ok: false, reason: "orphan-actor" };
  }
  const dup = input.existingBindings.some(
    (m) =>
      m.state === "bound" &&
      m.tenantId === input.tenantId &&
      m.actorId === input.actorId &&
      m.roleId === input.roleId,
  );
  if (dup) return { ok: false, reason: "duplicate-binding" };

  const actor = input.knownActors.find((a) => a.id === input.actorId && a.tenantId === input.tenantId);
  if (!actor) return { ok: false, reason: "orphan-actor" };
  const role = input.knownRoles.find((r) => r.id === input.roleId);
  if (!role) return { ok: false, reason: "orphan-role" };
  if (role.scope === "tenant") {
    if (actor.tenantId !== input.tenantId) return { ok: false, reason: "tenant-mismatch" };
  }

  const membership: MembershipRecord = {
    id: input.membershipId as MembershipId,
    tenantId: input.tenantId as TenantId,
    actorId: input.actorId as ActorId,
    roleId: input.roleId as RoleId,
    establishedAt: input.establishedAt,
    revokedAt: null,
    state: "bound",
  };

  const audit: AuditEventRef = {
    actor: input.actorId,
    intent: "membership:bind",
    tenant: input.tenantId,
    timestamp: input.establishedAt,
    digest: digestOf(input.membershipId, "bind", input.establishedAt),
  };

  return { ok: true, membership, audit };
}

export type UnbindRoleResult =
  | { readonly ok: true; readonly membership: MembershipRecord; readonly audit: AuditEventRef; readonly idempotent: boolean }
  | { readonly ok: false; readonly reason: MembershipRejectionCode };

export function unbindRole(
  membership: MembershipRecord,
  at: number,
  reason: string,
): UnbindRoleResult {
  if (membership.state === "unbound") {
    const audit: AuditEventRef = {
      actor: membership.actorId,
      intent: "membership:unbind:idempotent",
      tenant: membership.tenantId,
      timestamp: at,
      digest: digestOf(membership.id, "unbind-idempotent", at),
    };
    return { ok: true, membership, audit, idempotent: true };
  }
  if (reason === "") {
    return { ok: false, reason: "missing-reason" };
  }
  const next: MembershipRecord = {
    ...membership,
    state: "unbound",
    revokedAt: at,
  };
  const audit: AuditEventRef = {
    actor: membership.actorId,
    intent: "membership:unbind",
    tenant: membership.tenantId,
    timestamp: at,
    digest: digestOf(membership.id, "unbind", at),
  };
  return { ok: true, membership: next, audit, idempotent: false };
}
