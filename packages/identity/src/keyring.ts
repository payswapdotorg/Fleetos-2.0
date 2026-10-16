/**
 * @fleetos/identity — F370B the rotating keyring.
 *
 * The F370B packet deliverable 1: key lifecycle REAL at the boundary the
 * Architecture Lock allows. The F370B-era keyring was CONFIGURATION-CLASS
 * (file/env providers over a JSON snapshot, plainly labelled; a labelled
 * fixture for the pilot) with the real KMS honestly BLOCKED and recorded —
 * it LANDED at F373: the `kms` source (keyring-kms.ts) now fetches the
 * material over the real KMS service's authenticated API, and this
 * module's rotation kernel is exactly what that service runs (compose,
 * never re-implement). NO new authoritative business store (the
 * Architecture Lock; the keyring snapshot is configuration, never
 * business truth).
 *
 * The composition (issue + verify + rotate over the `KeyringProvider`
 * port — "the rotating keyring"):
 *
 *   - ISSUE binds the current key id INTO the token. Frozen envelope
 *     design: a keyed token is `fsk1.<keyId>.<payload b64url>.<sig
 *     b64url>` where `fss1.<payload>.<sig>` is the UNTOUCHED F370A
 *     inner token — the keyring WRAPS the kernel's token verbatim and
 *     the kernel's HMAC covers the inner envelope, so any mutation of
 *     the payload or signature is detected by the kernel and any
 *     mutation of the keyId is detected by key resolution (an unknown
 *     id refuses KEY_UNKNOWN; a substituted known id verifies under the
 *     WRONG material and refuses SIGNATURE_INVALID). Key material is
 *     HEX (`secretHex`, the F370A `SessionSigningKey` encoding) — frozen
 *     in this contract. Key ids are envelope-safe `[A-Za-z0-9_-]{1,64}`.
 *
 *   - VERIFY resolves material by id, in this machine-stable order:
 *     envelope shape => MALFORMED_TOKEN; unknown id => KEY_UNKNOWN;
 *     past the key's retire-at => KEY_RETIRED (inclusive grace: the
 *     boundary instant `now === retireAt` still verifies); then the
 *     kernel verdict VERBATIM (SIGNATURE_INVALID / SESSION_EXPIRED /
 *     ok). A key past rotation but within its grace window verifies
 *     with `keyStatus: "verify-grace"`; the current key with
 *     `keyStatus: "current"`. TOTAL — never throws.
 *
 *   - ROTATE (`rotateKeyring`) is a PURE operation over the keyring
 *     snapshot: the new key's id AND material are drawn through the
 *     injected SecureRandom port (id first, then material — the frozen
 *     draw order), the old current key gets `retireAt = now +
 *     verifyGraceMs` (its verify-grace window), the new key becomes
 *     current. A retired key is NEVER deleted from the snapshot —
 *     deleting it would turn KEY_RETIRED into KEY_UNKNOWN; physical
 *     removal is a host operational choice (F370C-class, recorded).
 *
 * NO-LEAK LAW: key material NEVER appears in any verdict, refusal
 * detail or error this module produces (refusal details are fixed
 * strings; the file/env loaders never echo file contents).
 */

import { readFileSync } from "node:fs";
import { issueSignedSession, verifySignedSession } from "./session.js";
import type {
  MarketplaceSessionScope,
  SessionSigningKey,
  SignedSessionClaims,
  SignedSessionIssueRefusalReason,
  SignedSessionVerifyRefusalReason,
  SignedSessionToken,
} from "./session.js";
import { generateSigningKey } from "./secure-random.js";
import type { SecureRandom } from "./secure-random.js";

/** The envelope-safe key id law (the `fsk1` segment charset). */
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** One keyring key. `retireAt === null` IFF current; a timestamp means
 * rotated out, verifying only through that instant (verify-grace). */
export interface KeyringKeyEntry {
  readonly keyId: string;
  readonly algorithm: "HMAC-SHA256";
  /** Hex-encoded HMAC key material — NEVER logged, NEVER in verdicts. */
  readonly secretHex: string;
  /** The verify-grace deadline (epoch ms); null while current. */
  readonly retireAt: number | null;
}

/** The keyring snapshot: the keys + which one is current. */
export interface KeyringData {
  readonly currentKeyId: string;
  readonly keys: readonly KeyringKeyEntry[];
}

/** The material shape `resolveKeyMaterial` returns (hex — frozen). */
export interface KeyringKeyMaterial {
  readonly algorithm: "HMAC-SHA256";
  readonly secretHex: string;
  readonly retireAt: number | null;
}

// --- The provider port ----------------------------------------------------

/** Where a provider's snapshot came from (the plain label — not an op).
 * The file/env/data/fixture sources are CONFIGURATION-CLASS; `kms` is the
 * KMS class (F373: material served over the real KMS's authenticated API
 * by the keyring-kms.ts adapter — the file/env providers remain
 * configuration-class fallbacks, labels unchanged). */
export type KeyringProviderSource = "fixture" | "file" | "env" | "data" | "kms";

/**
 * The keyring provider port (the packet's frozen three operations; the
 * `source` field is the labelling law made structural). The F370B-era
 * sources are configuration-class; the real KMS landed at F373 — the `kms`
 * source (keyring-kms.ts) fetches the snapshot over the KMS's
 * authenticated API, never a configuration snapshot.
 */
export interface KeyringProvider {
  readonly source: KeyringProviderSource;
  currentKeyId(): string | null;
  resolveKeyMaterial(keyId: string): KeyringKeyMaterial | null;
  listKeyIds(): readonly string[];
}

/** The in-memory provider over a snapshot (composition glue). Honest by
 * construction: `currentKeyId()` reports the id ONLY when it resolves to an
 * entry — an incoherent snapshot reports null (fail-closed). */
export function keyringProviderFromData(data: KeyringData): KeyringProvider {
  const byId = new Map(data.keys.map((k) => [k.keyId, k]));
  return {
    source: "data",
    currentKeyId: () => (byId.has(data.currentKeyId) ? data.currentKeyId : null),
    resolveKeyMaterial: (keyId) => {
      const entry = byId.get(keyId);
      if (entry === undefined) return null;
      return { algorithm: entry.algorithm, secretHex: entry.secretHex, retireAt: entry.retireAt };
    },
    listKeyIds: () => [...byId.keys()],
  };
}

// --- The labelled fixture (the pilot keyring — NEVER a production source) ---

/** The plainly-labelled PILOT FIXTURE keyring (one current key with a
 * fixed hex secret — the F370A fixture-key precedent). Test/corpus only. */
export const FIXTURE_KEYRING_DATA: KeyringData = {
  currentKeyId: "pilot-k1",
  keys: [
    {
      keyId: "pilot-k1",
      algorithm: "HMAC-SHA256",
      secretHex: "0b1f2e3d4c5b6a7988776655443322110b1f2e3d4c5b6a798877665544332211",
      retireAt: null,
    },
  ],
};

/** The fixture provider (plainly labelled). */
export function fixtureKeyringProvider(): KeyringProvider {
  return { ...keyringProviderFromData(FIXTURE_KEYRING_DATA), source: "fixture" };
}
// --- The JSON snapshot parser (file/env shared; contents never echoed) ----

export type KeyringLoadRefusalReason = "malformed";

export type KeyringLoadResult =
  | { readonly ok: true; readonly data: KeyringData }
  | { readonly ok: false; readonly reason: KeyringLoadRefusalReason; readonly detail: string };

/** A provider-loading verdict: the parsed provider on success, a fixed
 * detail on refusal (contents never echoed — the no-leak law). */
export type KeyringProviderLoadResult =
  | { readonly ok: true; readonly provider: KeyringProvider }
  | { readonly ok: false; readonly reason: KeyringLoadRefusalReason; readonly detail: string };

function malformed(detail: string): KeyringLoadResult {
  return { ok: false, reason: "malformed", detail };
}

/** Parse a keyring JSON snapshot. Pure, TOTAL (a verdict, never a throw);
 * the input text is NEVER echoed into the refusal (the no-leak law). */
export function parseKeyringJson(text: string): KeyringLoadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return malformed("keyring snapshot is not valid JSON (contents never echoed)");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return malformed("keyring snapshot must be a JSON object");
  }
  const c = parsed as Record<string, unknown>;
  if (typeof c["currentKeyId"] !== "string" || !KEY_ID_PATTERN.test(c["currentKeyId"])) {
    return malformed("keyring snapshot currentKeyId is missing or malformed");
  }
  if (!Array.isArray(c["keys"]) || c["keys"].length === 0) {
    return malformed("keyring snapshot keys array is missing or empty");
  }
  const keys: KeyringKeyEntry[] = [];
  const seen = new Set<string>();
  for (const raw of c["keys"]) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return malformed("keyring snapshot key entry is not an object");
    }
    const k = raw as Record<string, unknown>;
    if (typeof k["keyId"] !== "string" || !KEY_ID_PATTERN.test(k["keyId"])) {
      return malformed("keyring snapshot key entry has a malformed keyId");
    }
    if (k["algorithm"] !== "HMAC-SHA256") {
      return malformed("keyring snapshot key entry algorithm must be HMAC-SHA256");
    }
    if (typeof k["secretHex"] !== "string" || !/^[0-9a-fA-F]+$/.test(k["secretHex"]) || k["secretHex"].length % 2 !== 0 || k["secretHex"].length === 0) {
      return malformed("keyring snapshot key entry secretHex is malformed");
    }
    const retireAt = k["retireAt"];
    if (retireAt !== null && (typeof retireAt !== "number" || !Number.isFinite(retireAt) || retireAt <= 0)) {
      return malformed("keyring snapshot key entry retireAt must be null or a positive epoch-ms");
    }
    if (seen.has(k["keyId"])) {
      return malformed("keyring snapshot contains a duplicate keyId");
    }
    seen.add(k["keyId"]);
    keys.push({ keyId: k["keyId"], algorithm: "HMAC-SHA256", secretHex: k["secretHex"], retireAt: retireAt ?? null });
  }
  if (!seen.has(c["currentKeyId"])) {
    return malformed("keyring snapshot currentKeyId does not resolve to a key entry");
  }
  return { ok: true, data: { currentKeyId: c["currentKeyId"], keys } };
}

/** Load a keyring snapshot from a host-supplied file path.
 * CONFIGURATION-CLASS (dev/staging): the path is host-supplied; the file's
 * CONTENTS are never read into errors or logs. The real-KMS source is
 * keyring-kms.ts (F373); this one remains the configuration-class
 * fallback it has always been, label unchanged. */
export function fileKeyringProvider(input: { readonly path: string }): KeyringProviderLoadResult {
  let text: string;
  try {
    text = readFileSync(input.path, "utf8");
  } catch {
    return { ok: false, reason: "malformed", detail: `keyring file could not be read (path: ${input.path}; contents never echoed)` };
  }
  const parsed = parseKeyringJson(text);
  if (!parsed.ok) return parsed;
  return { ok: true, provider: { ...keyringProviderFromData(parsed.data), source: "file" } };
}

/** The default env variable for the env-backed provider. */
export const KEYRING_ENV_VARIABLE = "FLEETOS_SESSION_KEYRING_JSON";

/** Load a keyring snapshot from an injected environment record.
 * CONFIGURATION-CLASS (dev/staging): the host supplies the env (a record —
 * deterministic-under-injection); the VALUE never enters errors/logs. */
export function envKeyringProvider(input: {
  readonly variable?: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}): KeyringProviderLoadResult {
  const variable = input.variable ?? KEYRING_ENV_VARIABLE;
  const value = input.env[variable];
  if (value === undefined || value.length === 0) {
    return { ok: false, reason: "malformed", detail: `keyring env variable ${variable} is not set (value never echoed)` };
  }
  const parsed = parseKeyringJson(value);
  if (!parsed.ok) return parsed;
  return { ok: true, provider: { ...keyringProviderFromData(parsed.data), source: "env" } };
}
// --- rotateKeyring — the pure rotation over the snapshot ------------------

export type RotateKeyringRefusalReason =
  | "no-current-key"
  | "invalid-grace-window"
  | "key-id-collision"
  | "key-material-invalid";

export type RotateKeyringResult =
  | {
      readonly ok: true;
      readonly keyring: KeyringData;
      readonly newKeyId: string;
      readonly rotatedOutKeyId: string;
      readonly retireAt: number;
    }
  | { readonly ok: false; readonly reason: RotateKeyringRefusalReason; readonly detail: string };

/** Rotate the keyring: the new key (id AND material) is drawn through the
 * injected SecureRandom — ID FIRST, THEN MATERIAL (the frozen draw order) —
 * the old current key's verify-grace deadline becomes `now + verifyGraceMs`
 * and the new key becomes current. PURE over the snapshot; the host
 * persists the result (F370C-class). Retired keys are retained so their
 * tokens keep refusing KEY_RETIRED, never KEY_UNKNOWN. */
export function rotateKeyring(input: {
  readonly keyring: KeyringData;
  readonly now: number;
  readonly verifyGraceMs: number;
  readonly secureRandom: SecureRandom;
}): RotateKeyringResult {
  if (!Number.isFinite(input.verifyGraceMs) || input.verifyGraceMs <= 0) {
    return { ok: false, reason: "invalid-grace-window", detail: "verifyGraceMs must be a positive duration" };
  }
  const current = input.keyring.keys.find((k) => k.keyId === input.keyring.currentKeyId);
  if (current === undefined) {
    return { ok: false, reason: "no-current-key", detail: "keyring snapshot has no current key" };
  }
  const newKeyId = input.secureRandom.randomHex(8);
  if (!KEY_ID_PATTERN.test(newKeyId) || input.keyring.keys.some((k) => k.keyId === newKeyId)) {
    return { ok: false, reason: "key-id-collision", detail: "generated key id is malformed or already present" };
  }
  const newKey = generateSigningKey(input.secureRandom);
  if (newKey.algorithm !== "HMAC-SHA256" || !/^[0-9a-fA-F]+$/.test(newKey.secretHex)) {
    return { ok: false, reason: "key-material-invalid", detail: "generated key material failed validation" };
  }
  const retireAt = input.now + input.verifyGraceMs;
  const rotated: KeyringKeyEntry = { ...current, retireAt };
  const entry: KeyringKeyEntry = { keyId: newKeyId, algorithm: "HMAC-SHA256", secretHex: newKey.secretHex, retireAt: null };
  const keys = [...input.keyring.keys.filter((k) => k.keyId !== current.keyId), rotated, entry];
  return { ok: true, keyring: { currentKeyId: newKeyId, keys }, newKeyId, rotatedOutKeyId: current.keyId, retireAt };
}
// --- issueKeyedSession — issue under the CURRENT key, id bound into the token ---

/** A keyed session token: `fsk1.<keyId>.<payload b64url>.<sig b64url>`. */
export type KeyedSessionToken = string;

export type KeyedSessionIssueRefusalReason =
  | "no-current-key"
  | "current-key-unresolvable"
  | SignedSessionIssueRefusalReason;

export type KeyedSessionIssueResult =
  | { readonly ok: true; readonly token: KeyedSessionToken; readonly claims: SignedSessionClaims; readonly keyId: string }
  | { readonly ok: false; readonly reason: KeyedSessionIssueRefusalReason };

/** Issue a session bound to the keyring's CURRENT key: the kernel's `fss1`
 * token is minted under the current material and wrapped as
 * `fsk1.<keyId>.<payload>.<sig>` — byte-identical to a direct kernel issue
 * under the same key (compose, never re-implement). */
export function issueKeyedSession(input: {
  readonly provider: KeyringProvider;
  readonly actorId: string;
  readonly tenantId: string;
  readonly scopes: readonly MarketplaceSessionScope[];
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly jti?: string;
}): KeyedSessionIssueResult {
  const currentKeyId = input.provider.currentKeyId();
  if (currentKeyId === null) {
    return { ok: false, reason: "no-current-key" };
  }
  const material = input.provider.resolveKeyMaterial(currentKeyId);
  if (material === null) {
    return { ok: false, reason: "current-key-unresolvable" };
  }
  const issued = issueSignedSession({
    actorId: input.actorId,
    tenantId: input.tenantId,
    scopes: input.scopes,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
    ...(input.jti !== undefined ? { jti: input.jti } : {}),
    key: { algorithm: material.algorithm, secretHex: material.secretHex },
  });
  if (!issued.ok) return { ok: false, reason: issued.reason };
  return {
    ok: true,
    token: `fsk1.${currentKeyId}.${issued.token.slice("fss1.".length)}`,
    claims: issued.claims,
    keyId: currentKeyId,
  };
}
// --- verifyKeyedSession — resolve by id, grace then retirement, kernel verdict ---

export type KeyedSessionVerifyRefusalReason =
  | "KEY_UNKNOWN"
  | "KEY_RETIRED"
  | SignedSessionVerifyRefusalReason;

export type KeyedSessionVerifyResult =
  | { readonly ok: true; readonly claims: SignedSessionClaims; readonly keyId: string; readonly keyStatus: "current" | "verify-grace" }
  | { readonly ok: false; readonly reason: KeyedSessionVerifyRefusalReason };

/** Verify a keyed session token. TOTAL — never throws. Machine-stable
 * order: envelope shape => key resolution (KEY_UNKNOWN) => retirement
 * (KEY_RETIRED; `now === retireAt` still verifies — inclusive grace) =>
 * the kernel's verdict VERBATIM over the wrapped `fss1` token. A grace
 * key's ok verdict carries `keyStatus: "verify-grace"`. */
export function verifyKeyedSession(
  token: KeyedSessionToken | null | undefined,
  options: { readonly provider: KeyringProvider; readonly now: number },
): KeyedSessionVerifyResult {
  if (typeof token !== "string" || token.length === 0) {
    return { ok: false, reason: "MALFORMED_TOKEN" };
  }
  const parts = token.split(".");
  if (
    parts.length !== 4 ||
    parts[0]! !== "fsk1" ||
    parts[1]!.length === 0 ||
    parts[2]!.length === 0 ||
    parts[3]!.length === 0 ||
    !KEY_ID_PATTERN.test(parts[1]!)
  ) {
    return { ok: false, reason: "MALFORMED_TOKEN" };
  }
  const keyId = parts[1]!;
  const material = options.provider.resolveKeyMaterial(keyId);
  if (material === null) {
    return { ok: false, reason: "KEY_UNKNOWN" };
  }
  if (material.retireAt !== null && options.now > material.retireAt) {
    return { ok: false, reason: "KEY_RETIRED" };
  }
  const inner: SignedSessionToken = `fss1.${parts[2]}.${parts[3]}`;
  const key: SessionSigningKey = { algorithm: material.algorithm, secretHex: material.secretHex };
  const verified = verifySignedSession(inner, { key, now: options.now });
  if (!verified.ok) return { ok: false, reason: verified.reason };
  const keyStatus = material.retireAt === null ? "current" : "verify-grace";
  return { ok: true, claims: verified.claims, keyId, keyStatus };
}
