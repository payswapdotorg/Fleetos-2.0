/**
 * infrastructure/fleetos-marketplace/auth.ts — the authenticated boundary
 * (F370C, Wave 18 lane C).
 *
 * THE composition the F370B report recorded as this lane's work ("the gate
 * is not yet keyring-aware — composing the gate with the keyring provider
 * (and with revocation) at the HTTP boundary is the F370C deployment-
 * service composition"): every marketplace request passes through TWO
 * REAL, UNEDITED @fleetos/identity surfaces:
 *
 *   1. AUTHENTICATION — verifyKeyedSessionWithRevocation (the full F370B
 *      stack): the fsk1 keyring envelope (key resolution, verify-grace,
 *      retirement), the untouched F370A kernel signature/expiry verify,
 *      then the revocation registry. Its typed refusals map to the
 *      boundary's authentication layer: SESSION_EXPIRED stays SESSION_
 *      EXPIRED (the gate's own reason for an expired window); everything
 *      else (MALFORMED_TOKEN / KEY_UNKNOWN / KEY_RETIRED / SIGNATURE_
 *      INVALID / JTI_MISSING / REVOKED) collapses to UNAUTHENTICATED —
 *      the F370A gate's collapse law (the caller is not authenticated,
 *      that is all we ever reveal; no token or key material in details).
 *
 *   2. AUTHORIZATION — the F370A gate itself, authorizeMarketplaceAction
 *      (driven inside the composed marketplace-authenticated verbs, or
 *      directly for the verbs F370A did not wrap), over the INNER fss1
 *      token with the key material resolved BY THE CARRIED KEY ID. The
 *      six-line envelope unwrap below is boundary wiring, never a
 *      re-implementation: the verification already ran (step 1); the
 *      unwrap only hands the kernel's own token form to the kernel's own
 *      gate. The gate's five frozen reason codes (UNAUTHENTICATED /
 *      SESSION_EXPIRED / TENANT_MISMATCH / SCOPE_MISSING / MALFORMED)
 *      surface at the HTTP boundary verbatim.
 *
 * The revocation registry is the F370B in-memory registry, hydrated from
 * the store's revocation journal at boot (the F370B honest limitation
 * "persistent revocation is F370C/server-wiring class" — closed here).
 */

import type {
  KeyringProvider,
  KeyedSessionToken,
  SessionRevocationRegistry,
  SessionSigningKey,
  SignedSessionClaims,
} from "@fleetos/identity";
import { verifyKeyedSessionWithRevocation } from "@fleetos/identity";

// ---------------------------------------------------------------------------
// The boundary verdicts (data, never exception control flow)
// ---------------------------------------------------------------------------

export type BoundaryAuthReason = "UNAUTHENTICATED" | "SESSION_EXPIRED";

export interface BoundaryIdentity {
  readonly claims: SignedSessionClaims;
  readonly keyId: string;
  readonly keyStatus: "current" | "verify-grace";
  /** The resolved key material — handed to the F370A gate, never echoed. */
  readonly key: SessionSigningKey;
  /** The kernel's own fss1 token form — handed to the F370A gate. */
  readonly innerToken: string;
}

export type BoundaryAuthResult =
  | { readonly ok: true; readonly identity: BoundaryIdentity }
  | { readonly ok: false; readonly reason: BoundaryAuthReason; readonly detail: string };

// ---------------------------------------------------------------------------
// authenticateAtBoundary — the F370B stack, then the unwrap for the gate
// ---------------------------------------------------------------------------

/** Unwrap the VERIFIED keyed envelope to the kernel's own token form
 *  (fss1.<payload>.<sig>) — boundary wiring; verification already ran. */
export function innerTokenOfKeyed(token: KeyedSessionToken): string | null {
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "fsk1" || parts[2] === undefined || parts[3] === undefined) {
    return null;
  }
  return `fss1.${parts[2]}.${parts[3]}`;
}

/** Authenticate one HTTP request's token through the REAL F370B stack. */
export function authenticateAtBoundary(input: {
  readonly token: string | null | undefined;
  readonly provider: KeyringProvider;
  readonly registry: SessionRevocationRegistry;
  readonly now: number;
}): BoundaryAuthResult {
  if (typeof input.token !== "string" || input.token.length === 0) {
    return { ok: false, reason: "UNAUTHENTICATED", detail: "no session token presented" };
  }
  const verified = verifyKeyedSessionWithRevocation(input.token, {
    provider: input.provider,
    registry: input.registry,
    now: input.now,
  });
  if (!verified.ok) {
    if (verified.reason === "SESSION_EXPIRED") {
      return { ok: false, reason: "SESSION_EXPIRED", detail: "session window has expired" };
    }
    // MALFORMED_TOKEN / KEY_UNKNOWN / KEY_RETIRED / SIGNATURE_INVALID /
    // JTI_MISSING / REVOKED — all collapse to UNAUTHENTICATED (the gate's
    // collapse law; no material in the detail, by construction).
    return { ok: false, reason: "UNAUTHENTICATED", detail: "session token did not verify" };
  }
  const inner = innerTokenOfKeyed(input.token);
  if (inner === null) {
    // Unreachable after a verified envelope; fail-closed regardless.
    return { ok: false, reason: "UNAUTHENTICATED", detail: "session token did not verify" };
  }
  const material = input.provider.resolveKeyMaterial(verified.keyId);
  if (material === null) {
    return { ok: false, reason: "UNAUTHENTICATED", detail: "session token did not verify" };
  }
  return {
    ok: true,
    identity: {
      claims: verified.claims,
      keyId: verified.keyId,
      keyStatus: verified.keyStatus,
      key: { algorithm: material.algorithm, secretHex: material.secretHex },
      innerToken: inner,
    },
  };
}
