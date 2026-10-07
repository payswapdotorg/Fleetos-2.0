/**
 * @fleetos/kernel — TenantContext (law A8).
 *
 * The kernel sits BELOW every domain context. It defines its own
 * TenantContext shape: the established boundary value carried through
 * every persistence, event, queue, object, search, predictive and
 * execution operation. A session without a tenant context fails closed.
 *
 * Pure TypeScript. No I/O. No imports from any @fleetos/* or @zcode/*
 * package. Domain contexts consume the kernel's public entry only.
 */

// ---------------------------------------------------------------------------
// Branded id types — structural strings carrying a phantom brand so that
// `TenantId` is not assignable to `ActorId` even though both are strings.
// ---------------------------------------------------------------------------

declare const __brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [__brand]: B };

export type TenantId = Brand<string, "TenantId">;
export type ActorId = Brand<string, "ActorId">;
export type SessionId = Brand<string, "SessionId">;

// Canonical id formats — predictable, machine-validated prefixes. The
// patterns are intentionally strict so fail-closed validators can reject
// malformed ids at the boundary without ambiguity.
const ID_PATTERNS: Readonly<Record<string, RegExp>> = {
  TenantId: /^tnt_[A-Za-z0-9_-]{4,128}$/,
  ActorId: /^act_[A-Za-z0-9_-]{4,128}$/,
  SessionId: /^sess_[A-Za-z0-9_-]{8,256}$/,
};

function makeBrandedPredicate<B extends string>(
  brand: B,
): (value: string) => boolean {
  const pattern = ID_PATTERNS[brand] ?? null;
  return (value: string) =>
    pattern !== null && typeof value === "string" && pattern.test(value);
}

export const isTenantId = makeBrandedPredicate("TenantId") as (
  value: string,
) => value is TenantId;
export const isActorId = makeBrandedPredicate("ActorId") as (
  value: string,
) => value is ActorId;
export const isSessionId = makeBrandedPredicate("SessionId") as (
  value: string,
) => value is SessionId;

// ---------------------------------------------------------------------------
// TenantContext — the established boundary value (A8).
//
// Constructed ONCE at the server/application boundary and threaded through
// every persistence, event, queue, object, search, predictive and execution
// operation. Cross-tenant reads/writes fail closed.
//
// `scope` is part of the immutable context: "self" restricts reads to the
// actor's own records, "tenant" allows reads across the tenant, and
// "cross-tenant-forbidden" is rejected by construction.
// ---------------------------------------------------------------------------

export type TenantScopeVocabulary = "self" | "tenant" | "cross-tenant-forbidden";

export interface TenantContext {
  readonly tenantId: TenantId;
  readonly actorId: ActorId;
  readonly sessionId: SessionId;
  readonly establishedAt: number;
  readonly scope: TenantScopeVocabulary;
}

// ---------------------------------------------------------------------------
// makeTenantContext — pure fail-closed validator.
//
// Returns a successful `TenantContext` only when every id is well-formed and
// the establishedAt boundary is a finite epoch-millis value. ANY malformed
// input produces a stable rejection code; no partial context is ever
// emitted. Cross-tenant scope is forbidden by construction.
// ---------------------------------------------------------------------------

export type TenantContextRejectionCode =
  | "missing-tenant-id"
  | "missing-actor-id"
  | "missing-session-id"
  | "malformed-tenant-id"
  | "malformed-actor-id"
  | "malformed-session-id"
  | "invalid-established-at"
  | "cross-tenant-forbidden";

export type TenantContextResult =
  | { readonly ok: true; readonly context: TenantContext }
  | { readonly ok: false; readonly reason: TenantContextRejectionCode };

export interface TenantContextInput {
  readonly tenantId: string;
  readonly actorId: string;
  readonly sessionId: string;
  readonly establishedAt: number;
  readonly scope?: TenantScopeVocabulary;
}

export function makeTenantContext(input: TenantContextInput): TenantContextResult {
  if (input.tenantId === "") return { ok: false, reason: "missing-tenant-id" };
  if (input.actorId === "") return { ok: false, reason: "missing-actor-id" };
  if (input.sessionId === "") return { ok: false, reason: "missing-session-id" };
  if (!isTenantId(input.tenantId)) {
    return { ok: false, reason: "malformed-tenant-id" };
  }
  if (!isActorId(input.actorId)) {
    return { ok: false, reason: "malformed-actor-id" };
  }
  if (!isSessionId(input.sessionId)) {
    return { ok: false, reason: "malformed-session-id" };
  }
  if (!Number.isFinite(input.establishedAt) || input.establishedAt <= 0) {
    return { ok: false, reason: "invalid-established-at" };
  }
  // Cross-tenant scope is forbidden by construction — a caller attempting to
  // establish it is rejected at the boundary. This is the kernel's enforcement
  // of A8: tenant isolation must be established at the boundary, not retro.
  if (input.scope === "cross-tenant-forbidden") {
    return { ok: false, reason: "cross-tenant-forbidden" };
  }
  const ctx: TenantContext = {
    tenantId: input.tenantId,
    actorId: input.actorId,
    sessionId: input.sessionId,
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

/**
 * Returns true if `actor` is permitted to read records owned by `tenantId`
 * under the context's scope. The kernel uses this as the fail-closed gate
 * for every repository read: cross-tenant access fails closed.
 */
export function canRead(
  ctx: TenantContext,
  recordTenant: TenantId,
): boolean {
  if (ctx.tenantId === recordTenant) return true;
  return false;
}

/**
 * Returns true if `actor` is permitted to write records owned by `tenantId`
 * under the context's scope. The kernel uses this as the fail-closed gate
 * for every repository write: cross-tenant writes fail closed.
 */
export function canWrite(
  ctx: TenantContext,
  recordTenant: TenantId,
): boolean {
  if (ctx.tenantId === recordTenant) return true;
  return false;
}
