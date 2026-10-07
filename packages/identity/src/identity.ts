/**
 * @fleetos/identity — Wave 0 contracts.
 *
 * Pure TypeScript domain contracts ONLY. No I/O, no servers, no databases.
 *
 * Owns (per spec/BOUNDED-CONTEXTS.md "Identity & Tenancy"):
 *   - tenants, actors/users, roles, memberships, sessions, tenant context.
 *
 * Never owns domain resource truth. TenantContext is the established
 * boundary value carried through every persistence/action surface (A8).
 */

// ---------------------------------------------------------------------------
// Branded id types — structural strings carrying a phantom brand so that
// `TenantId` is not assignable to `ActorId` even though both are strings.
// ---------------------------------------------------------------------------

declare const __brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [__brand]: B };

export type TenantId = Brand<string, "TenantId">;
export type ActorId = Brand<string, "ActorId">;
export type RoleId = Brand<string, "RoleId">;
export type MembershipId = Brand<string, "MembershipId">;
export type SessionId = Brand<string, "SessionId">;

// Canonical id formats — predictable, machine-validated prefixes.
// Format rules are intentionally strict so fail-closed validators can
// reject malformed ids at the boundary without ambiguity.
const ID_PATTERNS: Readonly<Record<string, RegExp>> = {
  TenantId: /^tnt_[A-Za-z0-9_-]{4,128}$/,
  ActorId: /^act_[A-Za-z0-9_-]{4,128}$/,
  RoleId: /^role_[A-Za-z0-9_-]{3,128}$/,
  MembershipId: /^mbr_[A-Za-z0-9_-]{4,128}$/,
  SessionId: /^sess_[A-Za-z0-9_-]{8,256}$/,
};

function makeBranded<B extends string>(brand: B): (value: string) => boolean {
  const pattern = ID_PATTERNS[brand] ?? null;
  return (value: string) =>
    pattern !== null && typeof value === "string" && pattern.test(value);
}

export const isTenantId = makeBranded("TenantId") as (value: string) => value is TenantId;
export const isActorId = makeBranded("ActorId") as (value: string) => value is ActorId;
export const isRoleId = makeBranded("RoleId") as (value: string) => value is RoleId;
export const isMembershipId = makeBranded("MembershipId") as (
  value: string,
) => value is MembershipId;
export const isSessionId = makeBranded("SessionId") as (value: string) => value is SessionId;

// ---------------------------------------------------------------------------
// Core domain contracts
// ---------------------------------------------------------------------------

export interface Tenant {
  readonly id: TenantId;
  readonly displayName: string;
  readonly kind: "organization" | "personal" | "internal";
  readonly createdAt: number;
}

export interface Actor {
  readonly id: ActorId;
  readonly tenantId: TenantId;
  readonly displayName: string;
  readonly kind: "human" | "service" | "agent";
  readonly createdAt: number;
}

export type RoleScope = "tenant" | "fleet" | "system";

export interface Role {
  readonly id: RoleId;
  readonly scope: RoleScope;
  readonly label: string;
  /** Stable, machine-readable capability identifiers granted by this role. */
  readonly capabilities: ReadonlyArray<string>;
}

export interface Membership {
  readonly id: MembershipId;
  readonly tenantId: TenantId;
  readonly actorId: ActorId;
  readonly roleId: RoleId;
  readonly establishedAt: number;
  readonly revokedAt: number | null;
}

export interface Session {
  readonly id: SessionId;
  readonly tenantId: TenantId;
  readonly actorId: ActorId;
  readonly roleId: RoleId;
  readonly establishedAt: number;
  readonly expiresAt: number | null;
}

// ---------------------------------------------------------------------------
// TenantContext — the established boundary value carried across persistence,
// event, queue, object, search, predictive and execution operations (A8).
// Cross-tenant reads/writes MUST fail closed.
// ---------------------------------------------------------------------------

export type TenantScopeVocabulary = "self" | "tenant" | "cross-tenant-forbidden";

export interface TenantContext {
  readonly tenantId: TenantId;
  readonly actorId: ActorId;
  readonly roleId: RoleId;
  readonly establishedAt: number;
  readonly scope: TenantScopeVocabulary;
}

// ---------------------------------------------------------------------------
// makeTenantContext — pure fail-closed validator.
//
// Returns a successful `TenantContext` only when every id is well-formed and
// the establishedAt boundary is a finite epoch-millis value. ANY malformed
// input produces a stable rejection code; no partial context is ever emitted.
// ---------------------------------------------------------------------------

export type TenantContextRejectionCode =
  | "missing-tenant-id"
  | "missing-actor-id"
  | "missing-role-id"
  | "malformed-tenant-id"
  | "malformed-actor-id"
  | "malformed-role-id"
  | "invalid-established-at"
  | "cross-tenant-forbidden";

export type TenantContextResult =
  | { readonly ok: true; readonly context: TenantContext }
  | { readonly ok: false; readonly reason: TenantContextRejectionCode };

export interface TenantContextInput {
  readonly tenantId: string;
  readonly actorId: string;
  readonly roleId: string;
  readonly establishedAt: number;
  readonly scope?: TenantScopeVocabulary;
}

export function makeTenantContext(input: TenantContextInput): TenantContextResult {
  if (input.tenantId === "") return { ok: false, reason: "missing-tenant-id" };
  if (input.actorId === "") return { ok: false, reason: "missing-actor-id" };
  if (input.roleId === "") return { ok: false, reason: "missing-role-id" };
  if (!isTenantId(input.tenantId)) return { ok: false, reason: "malformed-tenant-id" };
  if (!isActorId(input.actorId)) return { ok: false, reason: "malformed-actor-id" };
  if (!isRoleId(input.roleId)) return { ok: false, reason: "malformed-role-id" };
  if (!Number.isFinite(input.establishedAt) || input.establishedAt <= 0) {
    return { ok: false, reason: "invalid-established-at" };
  }
  // Cross-tenant scope is forbidden by construction in Wave 0 — any caller
  // attempting to establish it is rejected at the boundary.
  if (input.scope === "cross-tenant-forbidden") {
    return { ok: false, reason: "cross-tenant-forbidden" };
  }
  const ctx: TenantContext = {
    tenantId: input.tenantId,
    actorId: input.actorId,
    roleId: input.roleId,
    establishedAt: input.establishedAt,
    scope: input.scope ?? "tenant",
  };
  return { ok: true, context: ctx };
}

// ---------------------------------------------------------------------------
// Helpers — pure predicates used by application boundaries to assert
// "same-tenant" before any cross-actor resource access.
// ---------------------------------------------------------------------------

export function sameTenant(a: TenantContext, b: TenantContext): boolean {
  return a.tenantId === b.tenantId;
}

export function contextExpired(ctx: TenantContext, now: number): boolean {
  return now < ctx.establishedAt;
}
