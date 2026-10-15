/**
 * @fleetos/identity — F370A the marketplace authorization gate.
 *
 * The F370A packet deliverable 3: `authorizeMarketplaceAction` — the
 * SERVER-SIDE, FAIL-CLOSED authorization gate the marketplace public
 * APIs are driven through (law A8: tenant context is established at the
 * server/application boundary; cross-tenant access fails closed).
 *
 * Composition (the packet's exact recipe): verifySession + the
 * actor→tenant binding + the action-scope table:
 *
 *   1. the ACTION request itself must be well-formed (a known F360 §3
 *      verb + a well-formed tenant scope) — anything else is MALFORMED;
 *   2. no token at all => UNAUTHENTICATED (fail-closed default);
 *   3. the token verifies (tamper / wrong key / malformed envelope all
 *      collapse to UNAUTHENTICATED; an expired window is
 *      SESSION_EXPIRED — authentication precedes authorization, so no
 *      tenant material is ever released from an unauthenticated token);
 *   4. the actor→tenant binding: the session's tenant MUST equal the
 *      action's tenant scope — a cross-tenant session is TENANT_MISMATCH;
 *   5. the action-scope table: the session's scopes MUST contain the
 *      verb's required scope — otherwise SCOPE_MISSING;
 *   6. anything else is AUTHORIZED {actorId, tenantId, action}.
 *
 * VERDICTS ARE DATA: `{ok: true, …}` / `{ok: false, reason, …}` with the
 * FROZEN reason codes (UNAUTHENTICATED / SESSION_EXPIRED /
 * TENANT_MISMATCH / SCOPE_MISSING / MALFORMED) — never exception control
 * flow. Fail-closed default: anything not EXACTLY authorized is refused.
 */

import {
  verifySignedSession,
  type MarketplaceSessionScope,
  type SessionSigningKey,
} from "./session.js";

// ---------------------------------------------------------------------------
// The F360 §3 frozen verbs + the action-scope table
// ---------------------------------------------------------------------------

/** The F360 §3 frozen verb families (the marketplace transaction spine). */
export type MarketplaceActionKind =
  | "request"
  | "offer"
  | "comparison"
  | "order"
  | "ack"
  | "receipt"
  | "enrollment"
  | "approval";

/**
 * The frozen action→scope table: the ONE scope each verb requires.
 * Machine-stable; extending it is a freeze-law change, never a lane edit.
 */
export const MARKETPLACE_ACTION_SCOPE_TABLE: Readonly<
  Record<MarketplaceActionKind, MarketplaceSessionScope>
> = {
  request: "marketplace.request",
  offer: "marketplace.offer",
  comparison: "marketplace.comparison",
  order: "marketplace.order",
  ack: "marketplace.order.ack",
  receipt: "marketplace.receipt",
  enrollment: "marketplace.enrollment",
  approval: "marketplace.approval",
};

// ---------------------------------------------------------------------------
// The frozen reason codes + the verdicts (data, never exceptions)
// ---------------------------------------------------------------------------

/** The FROZEN gate reason codes (the packet's law — never reordered). */
export type MarketplaceGateReason =
  | "UNAUTHENTICATED"
  | "SESSION_EXPIRED"
  | "TENANT_MISMATCH"
  | "SCOPE_MISSING"
  | "MALFORMED";

export interface AuthorizedMarketplaceAction {
  readonly ok: true;
  readonly actorId: string;
  readonly tenantId: string;
  readonly action: MarketplaceActionKind;
  readonly scope: MarketplaceSessionScope;
}

export interface RefusedMarketplaceAction {
  readonly ok: false;
  readonly reason: MarketplaceGateReason;
  /** The action kind when the request named one (null when unreadable). */
  readonly action: MarketplaceActionKind | null;
  /** Machine-stable explanation — never carries token or secret material. */
  readonly detail: string;
}

export type MarketplaceAuthorization = AuthorizedMarketplaceAction | RefusedMarketplaceAction;

/** The action request as the UNVALIDATED boundary sees it (fail-closed). */
export interface MarketplaceActionRequest {
  readonly kind: unknown;
  readonly tenantId: unknown;
}

export interface AuthorizeMarketplaceActionInput {
  /** The presented token — null/undefined/empty all mean unauthenticated. */
  readonly token: string | null | undefined;
  readonly action: MarketplaceActionRequest;
  readonly key: SessionSigningKey;
  /** Caller-supplied logical time (the corpus law: no wall clock). */
  readonly now: number;
}

const MARKETPLACE_TENANT_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function knownActionKind(kind: unknown): MarketplaceActionKind | null {
  if (typeof kind !== "string") return null;
  return (Object.keys(MARKETPLACE_ACTION_SCOPE_TABLE) as MarketplaceActionKind[]).find(
    (k) => k === kind,
  ) ?? null;
}

// ---------------------------------------------------------------------------
// authorizeMarketplaceAction — the gate
// ---------------------------------------------------------------------------

/**
 * Authenticate + authorize one marketplace action. TOTAL and
 * fail-closed: every input anomaly is a typed refusal, never a throw;
 * anything not EXACTLY authorized is refused.
 */
export function authorizeMarketplaceAction(
  input: AuthorizeMarketplaceActionInput,
): MarketplaceAuthorization {
  // (1) The action request must be well-formed before anything else.
  const action = knownActionKind(input.action.kind);
  if (action === null) {
    return {
      ok: false,
      reason: "MALFORMED",
      action: null,
      detail: "action kind is not a frozen marketplace verb",
    };
  }
  if (typeof input.action.tenantId !== "string" || !MARKETPLACE_TENANT_PATTERN.test(input.action.tenantId)) {
    return {
      ok: false,
      reason: "MALFORMED",
      action,
      detail: "action tenant scope is malformed",
    };
  }
  // (2) No token => unauthenticated (the fail-closed default).
  if (typeof input.token !== "string" || input.token.length === 0) {
    return {
      ok: false,
      reason: "UNAUTHENTICATED",
      action,
      detail: "no session token presented",
    };
  }
  // (3) Verify the signed token (total — never throws).
  const verified = verifySignedSession(input.token, { key: input.key, now: input.now });
  if (!verified.ok) {
    if (verified.reason === "SESSION_EXPIRED") {
      return {
        ok: false,
        reason: "SESSION_EXPIRED",
        action,
        detail: "session window has expired",
      };
    }
    // MALFORMED_TOKEN / SIGNATURE_INVALID / KEY_INVALID all collapse to
    // UNAUTHENTICATED — the caller is not authenticated, that is all we
    // ever reveal (no token material in the detail, by construction).
    return {
      ok: false,
      reason: "UNAUTHENTICATED",
      action,
      detail: "session token did not verify",
    };
  }
  const claims = verified.claims;
  // (4) The actor→tenant binding: the session's tenant must BE the
  // action's tenant scope (cross-tenant sessions are refused).
  if (claims.tenantId !== input.action.tenantId) {
    return {
      ok: false,
      reason: "TENANT_MISMATCH",
      action,
      detail: "session tenant does not match the action tenant scope",
    };
  }
  // (5) The action-scope table: the verb's required scope must be held.
  const requiredScope = MARKETPLACE_ACTION_SCOPE_TABLE[action];
  if (!claims.scopes.includes(requiredScope)) {
    return {
      ok: false,
      reason: "SCOPE_MISSING",
      action,
      detail: `action requires scope ${requiredScope}`,
    };
  }
  // (6) Exactly authorized.
  return {
    ok: true,
    actorId: claims.actorId,
    tenantId: claims.tenantId,
    action,
    scope: requiredScope,
  };
}
