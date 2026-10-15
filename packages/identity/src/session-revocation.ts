/**
 * @fleetos/identity — F370B session revocation.
 *
 * The F370B packet deliverable 3: individually revocable sessions —
 * the jti claim (THE sanctioned grow-only extension of the frozen
 * F370A claim set, session.ts) + a revocation registry COMPOSED into
 * verification.
 *
 * THE PRECEDENCE LAW (machine-asserted, deterministic order):
 * signature/expiry verification runs FIRST through the untouched F370A
 * kernel (`verifySignedSession`, or `verifyKeyedSession` for the
 * keyring envelope); ONLY a fully-verified, unexpired, jti-carrying
 * token is then checked against the registry. A tampered token
 * refuses SIGNATURE_INVALID even when its jti is revoked; an expired
 * token refuses SESSION_EXPIRED even when its jti is revoked — the
 * registry is never consulted for a token that does not verify.
 *
 * VERDICTS ARE DATA, verify stays TOTAL (never throws):
 *   ok | the kernel refusals verbatim | JTI_MISSING | REVOKED{cause}.
 *
 * JTI_MISSING is the fail-closed default: the revocation composition
 * accepts ONLY jti-carrying tokens — a token without a token id cannot
 * be individually revoked, so it is refused rather than silently
 * treated as unrevocable.
 *
 * The registry PORT is the seam; the in-memory impl here is PLAINLY
 * LABELLED: IN-MEMORY / NON-PERSISTENT (process lifetime only — a
 * restart forgets revocations). PERSISTENT revocation is F370C /
 * server-wiring class, recorded honestly — never pretended. NO new
 * authoritative business store (the Architecture Lock): revocation
 * state is operational security state, loaded into memory at boot.
 */

import { verifySignedSession } from "./session.js";
import type {
  SessionSigningKey,
  SignedSessionClaims,
  SignedSessionVerifyRefusalReason,
} from "./session.js";
import { verifyKeyedSession } from "./keyring.js";
import type { KeyringProvider, KeyedSessionToken, KeyedSessionVerifyRefusalReason } from "./keyring.js";

// ---------------------------------------------------------------------------
// Revocation records (evidence-carrying, never secret material)
// ---------------------------------------------------------------------------

/** An individual (jti) revocation record. */
export interface SessionRevocation {
  readonly jti: string;
  /** When the revocation was recorded (epoch ms — audit evidence). */
  readonly revokedAt: number;
}

/** An actor-wide revocation record (the sweep). */
export interface ActorRevocation {
  readonly actorId: string;
  readonly revokedAt: number;
}

// ---------------------------------------------------------------------------
// The registry port
// ---------------------------------------------------------------------------

/**
 * The session revocation registry port: `revoke(jti, at)` /
 * `isRevoked(jti)` / `revokeActor(actorId, at)` per the packet, plus
 * the symmetric evidence queries (`revocationOf` / `isActorRevoked` /
 * `actorRevocationOf`) the sweep and the journeys read. Revocation is
 * MONOTONE and idempotent: re-revoking returns the FIRST record
 * (never un-revokes, never moves the recorded timestamp).
 */
export interface SessionRevocationRegistry {
  /** Revoke one token id. Idempotent — the first record is retained. */
  revoke(jti: string, at: number): SessionRevocation;
  /** Pure membership: is this token id revoked? */
  isRevoked(jti: string): boolean;
  /** The revocation record for a token id (evidence), or null. */
  revocationOf(jti: string): SessionRevocation | null;
  /** Revoke every session of one actor (the sweep). Idempotent. */
  revokeActor(actorId: string, at: number): ActorRevocation;
  /** Pure membership: is this actor swept? */
  isActorRevoked(actorId: string): boolean;
  /** The actor revocation record (evidence), or null. */
  actorRevocationOf(actorId: string): ActorRevocation | null;
}

// ---------------------------------------------------------------------------
// The in-memory impl (PLAINLY LABELLED — non-persistent)
// ---------------------------------------------------------------------------

/**
 * The IN-MEMORY registry — PROCESS LIFETIME ONLY. A restart forgets
 * every revocation; persistent revocation (store-backed, surviving
 * restarts and shared across replicas) is F370C/server-wiring class,
 * recorded honestly in docs/evidence/F370B/report.md — never pretended.
 */
export class InMemorySessionRevocationRegistry implements SessionRevocationRegistry {
  private readonly revoked = new Map<string, SessionRevocation>();
  private readonly sweptActors = new Map<string, ActorRevocation>();

  revoke(jti: string, at: number): SessionRevocation {
    const existing = this.revoked.get(jti);
    if (existing !== undefined) return existing;
    const record: SessionRevocation = { jti, revokedAt: at };
    this.revoked.set(jti, record);
    return record;
  }

  isRevoked(jti: string): boolean {
    return this.revoked.has(jti);
  }

  revocationOf(jti: string): SessionRevocation | null {
    return this.revoked.get(jti) ?? null;
  }

  revokeActor(actorId: string, at: number): ActorRevocation {
    const existing = this.sweptActors.get(actorId);
    if (existing !== undefined) return existing;
    const record: ActorRevocation = { actorId, revokedAt: at };
    this.sweptActors.set(actorId, record);
    return record;
  }

  isActorRevoked(actorId: string): boolean {
    return this.sweptActors.has(actorId);
  }

  actorRevocationOf(actorId: string): ActorRevocation | null {
    return this.sweptActors.get(actorId) ?? null;
  }
}

// ---------------------------------------------------------------------------
// The verdicts (data, never exception control flow)
// ---------------------------------------------------------------------------

export type SessionRevocationVerifyRefusalReason =
  | SignedSessionVerifyRefusalReason
  | "JTI_MISSING"
  | "REVOKED";

export type SessionRevocationVerifyResult =
  | { readonly ok: true; readonly claims: SignedSessionClaims }
  | { readonly ok: false; readonly reason: SessionRevocationVerifyRefusalReason; readonly cause?: "jti" | "actor" };

export type KeyedSessionRevocationVerifyRefusalReason =
  | KeyedSessionVerifyRefusalReason
  | "JTI_MISSING"
  | "REVOKED";

export type KeyedSessionRevocationVerifyResult =
  | { readonly ok: true; readonly claims: SignedSessionClaims; readonly keyId: string; readonly keyStatus: "current" | "verify-grace" }
  | { readonly ok: false; readonly reason: KeyedSessionRevocationVerifyRefusalReason; readonly cause?: "jti" | "actor" };

/**
 * The registry check, SHARED by both compositions so the precedence
 * law is structural: it runs ONLY over an already-verified claim set.
 * The most specific cause wins (a jti revocation is reported even
 * when the actor is also swept). Fail-closed: a jti-less claim set
 * refuses JTI_MISSING.
 */
function applyRevocation(claims: SignedSessionClaims, registry: SessionRevocationRegistry): SessionRevocationVerifyResult {
  if (claims.jti === undefined) {
    return { ok: false, reason: "JTI_MISSING" };
  }
  if (registry.isRevoked(claims.jti)) {
    return { ok: false, reason: "REVOKED", cause: "jti" };
  }
  if (registry.isActorRevoked(claims.actorId)) {
    return { ok: false, reason: "REVOKED", cause: "actor" };
  }
  return { ok: true, claims };
}

/**
 * Verify a signed session WITH revocation. TOTAL — never throws.
 * Precedence (machine-stable): the F370A kernel verifies FIRST
 * (signature, then expiry — its own frozen order); only a verified,
 * unexpired token reaches the registry check. The kernel's refusals
 * propagate VERBATIM (never re-mapped).
 */
export function verifySessionWithRevocation(
  token: string | null | undefined,
  options: {
    readonly key: SessionSigningKey;
    readonly registry: SessionRevocationRegistry;
    readonly now: number;
  },
): SessionRevocationVerifyResult {
  const verified = verifySignedSession(token, { key: options.key, now: options.now });
  if (!verified.ok) {
    return { ok: false, reason: verified.reason };
  }
  return applyRevocation(verified.claims, options.registry);
}

/**
 * Verify a KEYED session WITH revocation — the full F370B stack: the
 * keyring envelope (key resolution, grace/retirement) and the kernel
 * signature/expiry verify FIRST, then the same shared registry check.
 * The keyed refusals (KEY_UNKNOWN / KEY_RETIRED / SIGNATURE_INVALID /
 * SESSION_EXPIRED / MALFORMED_TOKEN) precede revocation, verbatim.
 */
export function verifyKeyedSessionWithRevocation(
  token: KeyedSessionToken | null | undefined,
  options: {
    readonly provider: KeyringProvider;
    readonly registry: SessionRevocationRegistry;
    readonly now: number;
  },
): KeyedSessionRevocationVerifyResult {
  const verified = verifyKeyedSession(token, { provider: options.provider, now: options.now });
  if (!verified.ok) {
    return { ok: false, reason: verified.reason };
  }
  const checked = applyRevocation(verified.claims, options.registry);
  if (!checked.ok) {
    return { ok: false, reason: checked.reason, ...(checked.cause !== undefined ? { cause: checked.cause } : {}) };
  }
  return { ok: true, claims: checked.claims, keyId: verified.keyId, keyStatus: verified.keyStatus };
}
