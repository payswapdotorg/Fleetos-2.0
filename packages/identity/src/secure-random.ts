/**
 * @fleetos/identity — F370B the host-boundary SecureRandom port.
 *
 * The F370B packet deliverable 2: randomness ENTERS the identity domain
 * ONLY through injection. The port is the seam; the domain stays
 * deterministic-under-injection (the repo law — no Math.random, no
 * wall clock, no ambient entropy anywhere in packages/identity):
 *
 *   - `SecureRandom` — the port: `randomHex(byteCount)` + `credentialSalt()`
 *     (16+ bytes of salt, hex-encoded — the F370A credential floor);
 *   - `deterministicSecureRandom(stream)` — the fixed-stream test impl
 *     (the determinism battery): consumes the caller's hex values in
 *     order, validates every draw, and FAILS LOUD on exhaustion — a
 *     silent repeat or a fabricated fallback would be a dishonest
 *     determinism, so under-provisioning the stream throws;
 *   - `issueCredentialWithGeneratedSalt` — the authenticated composition:
 *     the credential salt is GENERATED through the port while the pure
 *     F370A `issueCredential` kernel keeps its caller-supplied contract
 *     UNCHANGED (grow-only, zero edits to F370A semantics — this module
 *     composes it, never re-implements it);
 *   - `generateSigningKey` — HMAC-SHA256 key material via the port
 *     (32 bytes = 64 hex chars, the rotation draw of keyring.ts).
 *
 * PRODUCTION BINDING NOTE (node:crypto at the host boundary ONLY):
 * this module deliberately ships NO entropy source. The host (the
 * F370C/server-wiring class) binds the port at its own boundary, e.g.:
 *
 *   import { randomBytes } from "node:crypto";
 *   const hostSecureRandom: SecureRandom = {
 *     randomHex: (n) => randomBytes(n).toString("hex"),
 *     credentialSalt: () => randomBytes(16).toString("hex"),
 *   };
 *
 * Journeys, corpora and tests NEVER use that binding — they inject the
 * deterministic impl, which is the whole point of the port: identical
 * injected stream => byte-identical salts, keys, digests and tokens.
 */

import { issueCredential } from "./credentials.js";
import type { CredentialIssueResult, CredentialKind } from "./credentials.js";
import type { SessionSigningKey } from "./session.js";

// ---------------------------------------------------------------------------
// The port
// ---------------------------------------------------------------------------

/**
 * The host-boundary randomness port. Implementations MUST be
 * cryptographically random in production (host-boundary binding) and
 * MAY be deterministic under test (the fixed-stream impl below).
 */
export interface SecureRandom {
  /** `byteCount` bytes of entropy, hex-encoded (`byteCount * 2` chars). */
  randomHex(byteCount: number): string;
  /** A credential salt: 16+ bytes, hex-encoded (the F370A floor). */
  credentialSalt(): string;
}

/** The credential-salt draw: 16 bytes (32 hex chars — the F370A floor). */
export const CREDENTIAL_SALT_BYTES = 16;

/** The signing-key draw: 32 bytes (64 hex chars — a 256-bit HMAC key). */
export const SIGNING_KEY_BYTES = 32;

// ---------------------------------------------------------------------------
// The deterministic fixed-stream impl (the determinism battery)
// ---------------------------------------------------------------------------

function isHex(value: string): boolean {
  return value.length > 0 && value.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(value);
}

/**
 * The plainly-labelled DETERMINISTIC test impl: a fixed stream of hex
 * values consumed in order. TEST/CORPUS ONLY — never a production
 * entropy source (a fixed stream is the opposite of random; it exists
 * so the domain's behavior under injection is byte-reproducible).
 *
 * Fails loud on ANY anomaly: a non-hex draw, a wrong-length draw, or a
 * draw past the end of the stream throws — never a silent repeat, never
 * a fabricated fallback (honest determinism).
 */
export function deterministicSecureRandom(stream: readonly string[]): SecureRandom {
  let cursor = 0;
  const draw = (byteCount: number): string => {
    if (cursor >= stream.length) {
      throw new Error(`deterministic SecureRandom stream exhausted at draw ${cursor + 1} (${byteCount} bytes requested)`);
    }
    const value = stream[cursor]!;
    cursor += 1;
    if (typeof value !== "string" || !isHex(value)) {
      throw new Error(`deterministic SecureRandom draw ${cursor} is not a hex string`);
    }
    if (value.length !== byteCount * 2) {
      throw new Error(`deterministic SecureRandom draw ${cursor} is ${value.length / 2} bytes, expected ${byteCount}`);
    }
    return value;
  };
  return {
    randomHex: (byteCount: number) => {
      if (!Number.isInteger(byteCount) || byteCount <= 0) {
        throw new Error(`SecureRandom.randomHex requires a positive byte count, got ${byteCount}`);
      }
      return draw(byteCount);
    },
    credentialSalt: () => draw(CREDENTIAL_SALT_BYTES),
  };
}

// ---------------------------------------------------------------------------
// The compositions (randomness through injection, kernels unchanged)
// ---------------------------------------------------------------------------

/**
 * Generate an HMAC-SHA256 signing key via the port (32 bytes). The
 * rotation draw of keyring.ts and the host's bootstrap draw; the KEY
 * MATERIAL never appears in any verdict, error or log (the no-leak law).
 */
export function generateSigningKey(secureRandom: SecureRandom): SessionSigningKey {
  return { algorithm: "HMAC-SHA256", secretHex: secureRandom.randomHex(SIGNING_KEY_BYTES) };
}

/**
 * The authenticated credential composition: the salt is GENERATED
 * through the injected port, then the PURE F370A `issueCredential`
 * kernel runs VERBATIM over it (its caller-supplied contract unchanged —
 * grow-only). The plaintext secret is consumed and discarded by the
 * kernel; the generated salt lands only in the stored record.
 */
export function issueCredentialWithGeneratedSalt(input: {
  readonly credentialId: string;
  readonly actorId: string;
  readonly tenantId: string;
  readonly kind: CredentialKind;
  readonly secret: string;
  readonly secureRandom: SecureRandom;
}): CredentialIssueResult {
  const { secureRandom, ...credential } = input;
  return issueCredential({ ...credential, saltHex: secureRandom.credentialSalt() });
}
