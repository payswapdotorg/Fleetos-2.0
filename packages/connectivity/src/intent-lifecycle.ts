/**
 * @fleetos/connectivity — Wave 5 intent lifecycle (F250A).
 *
 * The connectivity intent lifecycle machine:
 *
 *   proposed -> authorized -> active -> suspended -> terminated
 *   (plus `withdraw` from proposed, `terminate` from active/suspended).
 *
 * GUARDIAN LAW — authorization is an INPUT, never minted here. The
 * `authorize` transition requires BOTH:
 *   1. a caller-supplied `IntentPolicyCeiling` with effect `allow` — the
 *      policy is a CEILING, not an authorization (an allow is necessary,
 *      never sufficient); a `deny` ceiling refuses the transition
 *      (`policy-denied`) — the Guardian cannot be bypassed here; and
 *   2. a caller-supplied `AuthorizationGrant` (the Guardian-issued
 *      upstream record). No grant -> `authorization-required`. A grant
 *      past its `expiresAt` vs logical `now` -> `stale-authorization`.
 *
 * Idempotency: same-state transitions are refused (`already-in-state`);
 * every other illegal move is `illegal-transition` with typed codes.
 * Staleness classification is logical-time deterministic.
 *
 * Pure deterministic TypeScript; logical `now` everywhere.
 */

import { createHash } from "node:crypto";
import type { DeviceIdLike, TenantIdLike } from "./connectivity.js";
import type { AuditEventRef } from "./kernel.js";

export type { AuditEventRef };

function digestOf(...parts: ReadonlyArray<string | number>): string {
  const text = parts.map((p) => String(p)).join("|");
  return createHash("sha256").update(text).digest("hex");
}

// ---------------------------------------------------------------------------
// States + transition events.
// ---------------------------------------------------------------------------

export type IntentLifecycleState =
  | "proposed"
  | "authorized"
  | "active"
  | "suspended"
  | "terminated";

export type IntentLifecycleEventKind =
  | "authorize"
  | "activate"
  | "suspend"
  | "resume"
  | "terminate"
  | "withdraw";

// Legal transitions: (current, event) -> next.
const INTENT_TRANSITIONS: Readonly<
  Record<IntentLifecycleState, Partial<Record<IntentLifecycleEventKind, IntentLifecycleState>>>
> = {
  proposed: {
    authorize: "authorized",
    withdraw: "terminated",
    terminate: "terminated",
  },
  authorized: {
    activate: "active",
    terminate: "terminated",
  },
  active: {
    suspend: "suspended",
    terminate: "terminated",
  },
  suspended: {
    resume: "active",
    terminate: "terminated",
  },
  terminated: {}, // terminal — nothing leaves it
};

// Re-applying an already-completed transition: refused as `already-in-state`
// (idempotency is explicit — the posture-machine convention).
const INTENT_SELF_EVENTS: Readonly<Record<IntentLifecycleState, ReadonlySet<IntentLifecycleEventKind>>> = {
  proposed: new Set(),
  authorized: new Set(["authorize"]),
  active: new Set(["activate", "resume"]),
  suspended: new Set(["suspend"]),
  terminated: new Set(["terminate", "withdraw"]),
};

// ---------------------------------------------------------------------------
// Authorization-as-input + policy ceiling (ceilings-not-authorizations).
// ---------------------------------------------------------------------------

/**
 * The Guardian-issued authorization record. CALLER-SUPPLIED INPUT — this
 * module never mints, infers, or upgrades an authorization.
 */
export interface AuthorizationGrant {
  readonly grantedBy: string; // e.g. "guardian" / an operator actor
  readonly authorizationDigest: string; // digest of the upstream record
  readonly grantedAt: number;
  readonly expiresAt: number;
}

/**
 * The policy ceiling decision (from `evaluateIntent` — the connectivity
 * policy evaluator). `allow` is a NECESSARY condition, never sufficient:
 * an authorization grant is still required for `authorize`.
 */
export interface IntentPolicyCeiling {
  readonly effect: "allow" | "deny";
  readonly matchedRulePriority?: number;
  readonly reason: string;
}

export type IntentLifecycleRejectionCode =
  | "missing-tenant-id"
  | "missing-device-id"
  | "illegal-transition"
  | "already-in-state"
  | "missing-reason" // suspend/terminate/withdraw are consequential: reason required
  | "authorization-required" // ceiling allows, but no grant supplied
  | "policy-denied" // ceiling denies — Guardian cannot be bypassed here
  | "stale-authorization" // grant expired vs logical now
  | "invalid-grant" // malformed grant (empty fields / future grantedAt)
  | "invalid-now";

export type IntentTransitionResult =
  | {
      readonly ok: true;
      readonly from: IntentLifecycleState;
      readonly to: IntentLifecycleState;
      readonly audit: AuditEventRef;
    }
  | { readonly ok: false; readonly reason: IntentLifecycleRejectionCode };

export interface IntentTransitionInput {
  readonly tenantId: TenantIdLike;
  readonly deviceId: DeviceIdLike;
  readonly from: IntentLifecycleState;
  readonly event: IntentLifecycleEventKind;
  readonly now: number;
  readonly actor: string;
  readonly reason?: string; // required for suspend / terminate / withdraw
  readonly authorization?: AuthorizationGrant; // required for authorize
  readonly ceiling?: IntentPolicyCeiling; // required for authorize
}

function grantValid(grant: AuthorizationGrant, now: number): IntentLifecycleRejectionCode | null {
  if (grant.grantedBy === "" || grant.authorizationDigest === "") return "invalid-grant";
  if (!Number.isFinite(grant.grantedAt) || grant.grantedAt > now) return "invalid-grant";
  if (!Number.isFinite(grant.expiresAt) || grant.expiresAt <= now) return "stale-authorization";
  return null;
}

/**
 * The pure lifecycle machine. Same (from, event, inputs) -> same result.
 * `authorize` enforces the ceiling + the grant; consequential transitions
 * (suspend/terminate/withdraw) require a reason.
 */
export function transitionIntentLifecycle(input: IntentTransitionInput): IntentTransitionResult {
  if (input.tenantId === "") return { ok: false, reason: "missing-tenant-id" };
  if (input.deviceId === "") return { ok: false, reason: "missing-device-id" };
  if (!Number.isFinite(input.now) || input.now <= 0) return { ok: false, reason: "invalid-now" };

  if (INTENT_SELF_EVENTS[input.from]!.has(input.event)) {
    return { ok: false, reason: "already-in-state" };
  }
  const next = INTENT_TRANSITIONS[input.from]?.[input.event];
  if (next === undefined) return { ok: false, reason: "illegal-transition" };

  if (input.event === "authorize") {
    if (input.ceiling === undefined) return { ok: false, reason: "authorization-required" };
    if (input.ceiling.effect === "deny") return { ok: false, reason: "policy-denied" };
    if (input.authorization === undefined) return { ok: false, reason: "authorization-required" };
    const grantProblem = grantValid(input.authorization, input.now);
    if (grantProblem !== null) return { ok: false, reason: grantProblem };
  }

  if ((input.event === "suspend" || input.event === "terminate" || input.event === "withdraw") &&
    (input.reason === undefined || input.reason === "")) {
    return { ok: false, reason: "missing-reason" };
  }

  const audit: AuditEventRef = {
    actor: input.actor,
    intent: `connectivity:intent:${input.from}->${next}:${input.event}`,
    tenant: input.tenantId,
    timestamp: input.now,
    digest: digestOf(
      input.tenantId,
      input.deviceId,
      input.from,
      next,
      input.event,
      input.now,
      input.authorization?.authorizationDigest ?? "",
    ),
  };
  return { ok: true, from: input.from, to: next, audit };
}

// ---------------------------------------------------------------------------
// Intent record + staleness classification (logical-time deterministic).
// ---------------------------------------------------------------------------

export interface IntentLifecycleRecord {
  readonly tenantId: TenantIdLike;
  readonly deviceId: DeviceIdLike;
  readonly state: IntentLifecycleState;
  readonly lastTransitionAt: number;
  readonly transitionCount: number;
  readonly authorizedAt: number | null;
  readonly authorizationDigest: string | null;
}

export function initialIntentRecord(
  tenantId: TenantIdLike,
  deviceId: DeviceIdLike,
  at: number,
): IntentLifecycleRecord {
  return {
    tenantId,
    deviceId,
    state: "proposed",
    lastTransitionAt: at,
    transitionCount: 0,
    authorizedAt: null,
    authorizationDigest: null,
  };
}

export function applyIntentTransition(
  record: IntentLifecycleRecord,
  result: IntentTransitionResult,
  at: number,
  authorizationDigest?: string,
): IntentLifecycleRecord {
  if (!result.ok) return record;
  return {
    ...record,
    state: result.to,
    lastTransitionAt: at,
    transitionCount: record.transitionCount + 1,
    authorizedAt: result.to === "authorized" ? at : record.authorizedAt,
    authorizationDigest:
      result.to === "authorized" ? (authorizationDigest ?? null) : record.authorizationDigest,
  };
}

export interface IntentStalenessThresholds {
  readonly staleAfterMs: number;
  readonly unknownAfterMs: number;
}

export function defaultIntentStalenessThresholds(): IntentStalenessThresholds {
  return { staleAfterMs: 300_000, unknownAfterMs: 3_600_000 };
}

export type IntentStaleness = "fresh" | "stale" | "unknown";

/**
 * Logical-time staleness of an intent's last lifecycle step.
 * `unknown` is NOT `fresh`: beyond `unknownAfterMs` the record is too old
 * to act on without re-verification (honest degradation).
 */
export function classifyIntentStaleness(
  record: Pick<IntentLifecycleRecord, "lastTransitionAt">,
  thresholds: IntentStalenessThresholds,
  now: number,
): IntentStaleness {
  const elapsed = now - record.lastTransitionAt;
  if (elapsed >= thresholds.unknownAfterMs) return "unknown";
  if (elapsed >= thresholds.staleAfterMs) return "stale";
  return "fresh";
}

/** An authorization that has gone stale must be re-issued before activation. */
export function isAuthorizationStale(
  record: Pick<IntentLifecycleRecord, "authorizedAt">,
  thresholds: IntentStalenessThresholds,
  now: number,
): boolean {
  if (record.authorizedAt === null) return false; // nothing to stale
  return now - record.authorizedAt >= thresholds.staleAfterMs;
}
