/**
 * infrastructure/fleetos-kms/kms-core.ts — the KMS core (F373, Wave 19 lane B).
 *
 * The in-process state model + the at-rest envelope mapping + the admin
 * authentication primitives of the FleetOS key-management service. This
 * module is deliberately PURE OVER ITS INPUTS (no I/O, no clock, no
 * entropy): the service (service.ts) is the host that injects the master
 * key, the SecureRandom port binding and the request-carried logical `now`.
 *
 * THE TRUST BOUNDARY (the F373 packet's law, plainly labelled):
 *   - the MASTER KEY exists only at the KMS process boundary — env/file AT
 *     THE SERVICE (FLEETOS_KMS_MASTER_KEY / _FILE), never in the app's
 *     config. It wraps (envelope-encrypts) every data key; it NEVER leaves
 *     the process and NEVER appears at rest, in logs or in any response;
 *   - DATA KEYS (the keyring's HMAC-SHA256 signing keys + the KMS's own
 *     admin token key) live ONLY inside the KMS process (unwrapped) and in
 *     the at-rest envelope (AES-256-GCM, `wrapped` = b64(iv|ct|tag)). The
 *     at-rest state file contains NO plaintext key material — the values
 *     are random-looking GCM bytes, machine-scanned by the journeys;
 *   - KEY MATERIAL IS SERVED ONLY over the authenticated API to the keyring
 *     adapter (`POST /api/keys/resolve`) — never wrapped for caller-side
 *     unwrapping (that would require shipping the master key), never in
 *     logs, errors, the audit journal or health output (the no-leak law).
 *
 * COMPOSITION (compose, never re-implement):
 *   - key rotation is the REAL F370B kernel `rotateKeyring` from
 *     @fleetos/identity, run over the in-process unwrapped state — the
 *     F370B laws (id-then-material draw order, verify-grace deadline,
 *     RETAINED retired keys, its typed refusals) preserved exactly and
 *     propagated verbatim;
 *   - the SecureRandom port binding is the service's choice: production
 *     binds node:crypto randomBytes (the F370B host-boundary recipe); the
 *     journeys bind the REAL `deterministicSecureRandom` fixed-stream impl
 *     through FLEETOS_KMS_RANDOM_STREAM (plainly labelled TEST/CORPUS ONLY
 *     — the fixed-stream impl exists for exactly this).
 *
 * The admin authentication (the packet: "an admin/session credential
 * (HMAC-SHA256, F370A-style issue/verify with expiry + tamper refusals)"):
 *   - the admin CREDENTIAL record stores only an HMAC-SHA256 digest —
 *     `adminCredentialDigest(adminTokenKey, adminId, secret)`; the
 *     plaintext secret is never persisted, never journaled, never echoed.
 *     Verification is timing-safe and byte-identical for unknown admin,
 *     wrong secret and malformed record (enumeration-resistant);
 *   - the admin SESSION token is the `fka1.<payload>.<sig>` envelope —
 *     HMAC-SHA256 over the canonical claims, b64url, constant-time
 *     comparison, carrying expiry; tampered => SIGNATURE_INVALID, expired
 *     => SESSION_EXPIRED, absent/garbage => UNAUTHENTICATED (frozen reason
 *     codes, verdicts-as-data). F370A-STYLE: the F370A kernel's frozen
 *     claim vocabulary is marketplace-session-specific, so the KMS admin
 *     session is a KMS-owned envelope at the host boundary following the
 *     F370A discipline exactly — a boundary-wiring decision recorded here
 *     and in the evidence report, never a silent re-implementation.
 */

import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { KeyringData, KeyringKeyEntry, SecureRandom } from "@fleetos/identity";
import { rotateKeyring } from "@fleetos/identity";

// ---------------------------------------------------------------------------
// The master key (env/file AT THE KMS — the trust boundary)
// ---------------------------------------------------------------------------

/** A master key: 32 bytes, hex-encoded (64 hex chars). */
export type KmsMasterKeyHex = string;

export const MASTER_KEY_BYTES = 32;

/** Validate a master key hex (64 hex chars = 32 bytes). */
export function isValidMasterKeyHex(value: string): boolean {
  return value.length === MASTER_KEY_BYTES * 2 && /^[0-9a-fA-F]+$/.test(value);
}

// ---------------------------------------------------------------------------
// The at-rest envelope (AES-256-GCM under the master key)
// ---------------------------------------------------------------------------

/** Wrap plaintext bytes under the master key: b64(iv(12) | ct | tag(16)).
 *  A FRESH random IV per wrap (real crypto; the wrapped bytes are never
 *  journey facts, so run-to-run variance stays outside all output). */
export function wrapWithMasterKey(masterKeyHex: KmsMasterKeyHex, plaintext: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(masterKeyHex, "hex"), iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ct, tag]).toString("base64");
}

/** Unwrap a `wrapped` slot. Fail-closed: ANY error (bad base64, wrong
 *  length, GCM auth failure — i.e. tampered-at-rest or a wrong master key)
 *  refuses the boot. Never throws; a boolean verdict. */
export function unwrapWithMasterKey(masterKeyHex: KmsMasterKeyHex, wrapped: string): { ok: true; plaintext: Buffer } | { ok: false } {
  try {
    const raw = Buffer.from(wrapped, "base64");
    if (raw.length < 12 + 16 + 1) return { ok: false };
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(raw.length - 16);
    const ct = raw.subarray(12, raw.length - 16);
    const decipher = createDecipheriv("aes-256-gcm", Buffer.from(masterKeyHex, "hex"), iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return { ok: true, plaintext: pt };
  } catch {
    return { ok: false };
  }
}

// ---------------------------------------------------------------------------
// The in-process state model (material in the clear ONLY inside the process)
// ---------------------------------------------------------------------------

/** One provisioned admin credential: the digest only, never the secret. */
export interface KmsAdminRecord {
  readonly adminId: string;
  readonly digestHex: string;
}

/** One data key in the process state (the keyring's signing keys). */
export interface KmsKeyEntry {
  readonly keyId: string;
  readonly algorithm: "HMAC-SHA256";
  readonly secretHex: string;
  readonly retireAt: number | null;
}

/** The KMS process state. Plaintext material exists ONLY here and inside
 *  the at-rest `wrapped` slots (never at rest in the clear). */
export interface KmsState {
  readonly currentKeyId: string;
  readonly keys: readonly KmsKeyEntry[];
  readonly adminTokenKeyHex: string;
  readonly admins: readonly KmsAdminRecord[];
  readonly opSeq: number;
}

// ---------------------------------------------------------------------------
// The at-rest state file shape (NO plaintext key material — machine-scanned)
// ---------------------------------------------------------------------------

/** The persisted (wrapped) form of one data key. */
export interface WrappedKeySlot {
  readonly keyId: string;
  readonly algorithm: "HMAC-SHA256";
  readonly wrapped: string;
  readonly retireAt: number | null;
}

/** The persisted state file object (fixed serialization order). */
export interface KmsStateFile {
  readonly version: 1;
  readonly currentKeyId: string;
  readonly keys: readonly WrappedKeySlot[];
  readonly adminTokenKey: string;
  readonly admins: readonly KmsAdminRecord[];
  readonly opSeq: number;
}

const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const ADMIN_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const HEX64 = /^[0-9a-fA-F]{64}$/;

/** Map the process state to the at-rest file (wrap every data key + the
 *  admin token key). Pure; the caller persists. */
export function toStateFile(masterKeyHex: KmsMasterKeyHex, state: KmsState): KmsStateFile {
  return {
    version: 1,
    currentKeyId: state.currentKeyId,
    keys: state.keys.map((k) => ({
      keyId: k.keyId,
      algorithm: k.algorithm,
      wrapped: wrapWithMasterKey(masterKeyHex, Buffer.from(k.secretHex, "utf8")),
      retireAt: k.retireAt,
    })),
    adminTokenKey: wrapWithMasterKey(masterKeyHex, Buffer.from(state.adminTokenKeyHex, "utf8")),
    admins: state.admins.map((a) => ({ adminId: a.adminId, digestHex: a.digestHex })),
    opSeq: state.opSeq,
  };
}

/** Recover the process state from an at-rest file. Fail-closed verdict:
 *  any shape violation or unwrap failure (tampered at rest / wrong master
 *  key) refuses — never a partial recovery. */
export function fromStateFile(masterKeyHex: KmsMasterKeyHex, file: KmsStateFile): { ok: true; state: KmsState } | { ok: false; reason: string } {
  if (file.version !== 1) return { ok: false, reason: "state version not supported" };
  if (typeof file.currentKeyId !== "string" || !KEY_ID_PATTERN.test(file.currentKeyId)) {
    return { ok: false, reason: "state currentKeyId is malformed" };
  }
  if (!Array.isArray(file.keys) || file.keys.length === 0) {
    return { ok: false, reason: "state keys array is malformed or empty" };
  }
  const unwrappedAdminToken = unwrapWithMasterKey(masterKeyHex, file.adminTokenKey);
  if (!unwrappedAdminToken.ok) return { ok: false, reason: "admin token key failed to unwrap (wrong master key or tampered at rest)" };
  const adminTokenKeyHex = unwrappedAdminToken.plaintext.toString("utf8");
  if (!HEX64.test(adminTokenKeyHex)) return { ok: false, reason: "admin token key failed to unwrap (wrong master key or tampered at rest)" };
  const keys: KmsKeyEntry[] = [];
  const seen = new Set<string>();
  for (const slot of file.keys) {
    if (typeof slot?.keyId !== "string" || !KEY_ID_PATTERN.test(slot.keyId) || slot.algorithm !== "HMAC-SHA256" || typeof slot?.wrapped !== "string") {
      return { ok: false, reason: "state key slot is malformed" };
    }
    const retireAt = slot.retireAt;
    if (retireAt !== null && (typeof retireAt !== "number" || !Number.isFinite(retireAt) || retireAt <= 0)) {
      return { ok: false, reason: "state key slot retireAt is malformed" };
    }
    if (seen.has(slot.keyId)) return { ok: false, reason: "state contains a duplicate keyId" };
    seen.add(slot.keyId);
    const unwrapped = unwrapWithMasterKey(masterKeyHex, slot.wrapped);
    if (!unwrapped.ok) return { ok: false, reason: "data key failed to unwrap (wrong master key or tampered at rest)" };
    const secretHex = unwrapped.plaintext.toString("utf8");
    if (!HEX64.test(secretHex)) return { ok: false, reason: "data key failed to unwrap (wrong master key or tampered at rest)" };
    keys.push({ keyId: slot.keyId, algorithm: "HMAC-SHA256", secretHex, retireAt: retireAt ?? null });
  }
  if (!seen.has(file.currentKeyId)) return { ok: false, reason: "state currentKeyId does not resolve to a key slot" };
  const admins: KmsAdminRecord[] = [];
  const seenAdmins = new Set<string>();
  for (const a of file.admins) {
    if (typeof a?.adminId !== "string" || !ADMIN_ID_PATTERN.test(a.adminId) || typeof a?.digestHex !== "string" || !/^[0-9a-fA-F]{64}$/.test(a.digestHex)) {
      return { ok: false, reason: "state admin record is malformed" };
    }
    if (seenAdmins.has(a.adminId)) return { ok: false, reason: "state contains a duplicate adminId" };
    seenAdmins.add(a.adminId);
    admins.push({ adminId: a.adminId, digestHex: a.digestHex });
  }
  if (typeof file.opSeq !== "number" || !Number.isInteger(file.opSeq) || file.opSeq < 0) {
    return { ok: false, reason: "state opSeq is malformed" };
  }
  return { ok: true, state: { currentKeyId: file.currentKeyId, keys, adminTokenKeyHex, admins, opSeq: file.opSeq } };
}

// ---------------------------------------------------------------------------
// The admin credential digest (HMAC-SHA256 — the plaintext never persists)
// ---------------------------------------------------------------------------

/** Derive the stored digest for one admin credential. The secret is
 *  consumed here and exists only in the caller's request + this HMAC. */
export function adminCredentialDigest(adminTokenKeyHex: string, adminId: string, secret: string): string {
  return createHmac("sha256", Buffer.from(adminTokenKeyHex, "hex"))
    .update(`fleetos-kms-admin-credential-v1|${adminId}|${secret}`, "utf8")
    .digest("hex");
}

/** Verify a presented credential against a stored digest. Timing-safe and
 *  byte-identical for unknown admin / wrong secret / malformed record. */
export function verifyAdminCredential(input: {
  readonly presentedSecret: string;
  readonly stored: KmsAdminRecord | null;
  readonly adminTokenKeyHex: string;
  readonly adminId: string;
}): boolean {
  if (input.stored === null) return false;
  const digest = Buffer.from(adminCredentialDigest(input.adminTokenKeyHex, input.adminId, input.presentedSecret), "hex");
  const stored = Buffer.from(input.stored.digestHex, "hex");
  return digest.length === stored.length && timingSafeEqual(digest, stored);
}

// ---------------------------------------------------------------------------
// The admin session token (fka1 — F370A-style, KMS-owned at the boundary)
// ---------------------------------------------------------------------------

export type AdminSessionRefusal = "MALFORMED" | "SIGNATURE_INVALID" | "SESSION_EXPIRED";

export type AdminSessionVerify =
  | { readonly ok: true; readonly adminId: string; readonly expiresAt: number }
  | { readonly ok: false; readonly refusal: AdminSessionRefusal };

const SESSION_JTI_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/** Issue an admin session token: `fka1.<payload b64url>.<sig b64url>` —
 *  HMAC-SHA256 (admin token key) over `fka1.<payload>`, canonical claims
 *  JSON (fixed field order), expiry carried, jti required. TOTAL. */
export function issueAdminSession(input: {
  readonly adminId: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly jti: string;
  readonly adminTokenKeyHex: string;
}): { ok: true; token: string } | { ok: false; refusal: "MALFORMED" } {
  if (!ADMIN_ID_PATTERN.test(input.adminId)) return { ok: false, refusal: "MALFORMED" };
  if (!Number.isFinite(input.issuedAt) || input.issuedAt <= 0) return { ok: false, refusal: "MALFORMED" };
  if (!Number.isFinite(input.expiresAt) || input.expiresAt <= input.issuedAt) return { ok: false, refusal: "MALFORMED" };
  if (!SESSION_JTI_PATTERN.test(input.jti)) return { ok: false, refusal: "MALFORMED" };
  if (!HEX64.test(input.adminTokenKeyHex)) return { ok: false, refusal: "MALFORMED" };
  const payloadJson = JSON.stringify({ v: 1, adminId: input.adminId, issuedAt: input.issuedAt, expiresAt: input.expiresAt, jti: input.jti });
  const payloadB64 = Buffer.from(payloadJson, "utf8").toString("base64url");
  const sig = createHmac("sha256", Buffer.from(input.adminTokenKeyHex, "hex")).update(`fka1.${payloadB64}`, "utf8").digest();
  return { ok: true, token: `fka1.${payloadB64}.${sig.toString("base64url")}` };
}

/** Verify an admin session token. TOTAL — never throws; frozen refusals:
 *  MALFORMED (shape), SIGNATURE_INVALID (tamper — constant-time compare),
 *  SESSION_EXPIRED (past the window). */
export function verifyAdminSession(token: string | null | undefined, options: { readonly adminTokenKeyHex: string; readonly now: number }): AdminSessionVerify {
  if (typeof token !== "string" || token.length === 0) return { ok: false, refusal: "MALFORMED" };
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "fka1" || parts[1]!.length === 0 || parts[2]!.length === 0) {
    return { ok: false, refusal: "MALFORMED" };
  }
  if (!HEX64.test(options.adminTokenKeyHex)) return { ok: false, refusal: "MALFORMED" };
  let claims: { adminId: string; expiresAt: number } | null = null;
  try {
    const parsed = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as unknown;
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      const c = parsed as Record<string, unknown>;
      if (c["v"] === 1 && typeof c["adminId"] === "string" && ADMIN_ID_PATTERN.test(c["adminId"]) &&
        typeof c["issuedAt"] === "number" && Number.isFinite(c["issuedAt"]) && c["issuedAt"] > 0 &&
        typeof c["expiresAt"] === "number" && Number.isFinite(c["expiresAt"]) && c["expiresAt"] > c["issuedAt"] &&
        typeof c["jti"] === "string" && SESSION_JTI_PATTERN.test(c["jti"])) {
        claims = { adminId: c["adminId"], expiresAt: c["expiresAt"] };
      }
    }
  } catch {
    claims = null;
  }
  if (claims === null) return { ok: false, refusal: "MALFORMED" };
  let presented: Buffer;
  try {
    presented = Buffer.from(parts[2]!, "base64url");
  } catch {
    return { ok: false, refusal: "MALFORMED" };
  }
  if (presented.length === 0) return { ok: false, refusal: "MALFORMED" };
  const expected = createHmac("sha256", Buffer.from(options.adminTokenKeyHex, "hex")).update(`fka1.${parts[1]}`, "utf8").digest();
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
    return { ok: false, refusal: "SIGNATURE_INVALID" };
  }
  if (options.now > claims.expiresAt) return { ok: false, refusal: "SESSION_EXPIRED" };
  return { ok: true, adminId: claims.adminId, expiresAt: claims.expiresAt };
}

// ---------------------------------------------------------------------------
// The audit journal (append-only; who/what/when-as-op-seq; no secrets)
// ---------------------------------------------------------------------------

export type KmsAuditOp = "kms.admin-token-key" | "kms.admin-provision" | "kms.key-create" | "kms.key-rotate";

/** One append-only audit line. `when` is the op sequence — never a wall
 *  clock; `detail` carries ids and deadlines only, never any secret. */
export interface KmsAuditEntry {
  readonly opSeq: number;
  readonly op: KmsAuditOp;
  readonly actor: string;
  readonly detail: string;
}

// ---------------------------------------------------------------------------
// The key operations (create = the bootstrap draw; rotate = the REAL kernel)
// ---------------------------------------------------------------------------

export type KmsCreateRefusal = "KEY_EXISTS" | "KEY_ID_INVALID" | "KEY_MATERIAL_INVALID";

export type KmsCreateResult =
  | { readonly ok: true; readonly state: KmsState; readonly keyId: string; readonly audit: KmsAuditEntry }
  | { readonly ok: false; readonly refusal: KmsCreateRefusal };

/** Create the FIRST data key (the bootstrap draw): id FIRST then material
 *  (the frozen F370B draw order), through the injected SecureRandom port. */
export function kmsCreateKey(input: { readonly state: KmsState; readonly secureRandom: SecureRandom }): KmsCreateResult {
  if (input.state.keys.length > 0) return { ok: false, refusal: "KEY_EXISTS" };
  const keyId = input.secureRandom.randomHex(8);
  if (!KEY_ID_PATTERN.test(keyId)) return { ok: false, refusal: "KEY_ID_INVALID" };
  const secretHex = input.secureRandom.randomHex(32);
  if (!HEX64.test(secretHex)) return { ok: false, refusal: "KEY_MATERIAL_INVALID" };
  const opSeq = input.state.opSeq + 1;
  const entry: KmsKeyEntry = { keyId, algorithm: "HMAC-SHA256", secretHex, retireAt: null };
  const state: KmsState = { ...input.state, currentKeyId: keyId, keys: [entry], opSeq };
  const audit: KmsAuditEntry = { opSeq, op: "kms.key-create", actor: "kms", detail: `created the first data key ${keyId}` };
  return { ok: true, state, keyId, audit };
}

export type KmsRotateRefusal =
  | "NO_CURRENT_KEY"
  | "INVALID_GRACE_WINDOW"
  | "KEY_ID_COLLISION"
  | "KEY_MATERIAL_INVALID";

export type KmsRotateResult =
  | { readonly ok: true; readonly state: KmsState; readonly newKeyId: string; readonly rotatedOutKeyId: string; readonly retireAt: number; readonly audit: KmsAuditEntry }
  | { readonly ok: false; readonly refusal: KmsRotateRefusal };

/** Rotate: the REAL F370B `rotateKeyring` kernel over the unwrapped state,
 *  its refusal codes propagated (mapped to the KMS's frozen set). */
export function kmsRotateKey(input: {
  readonly state: KmsState;
  readonly now: number;
  readonly verifyGraceMs: number;
  readonly secureRandom: SecureRandom;
}): KmsRotateResult {
  const keyring: KeyringData = { currentKeyId: input.state.currentKeyId, keys: input.state.keys.map((k) => k as KeyringKeyEntry) };
  const rotated = rotateKeyring({ keyring, now: input.now, verifyGraceMs: input.verifyGraceMs, secureRandom: input.secureRandom });
  if (!rotated.ok) {
    if (rotated.reason === "no-current-key") return { ok: false, refusal: "NO_CURRENT_KEY" };
    if (rotated.reason === "invalid-grace-window") return { ok: false, refusal: "INVALID_GRACE_WINDOW" };
    if (rotated.reason === "key-id-collision") return { ok: false, refusal: "KEY_ID_COLLISION" };
    return { ok: false, refusal: "KEY_MATERIAL_INVALID" };
  }
  const opSeq = input.state.opSeq + 1;
  const state: KmsState = {
    currentKeyId: rotated.keyring.currentKeyId,
    keys: rotated.keyring.keys.map((k) => ({ keyId: k.keyId, algorithm: k.algorithm, secretHex: k.secretHex, retireAt: k.retireAt })),
    adminTokenKeyHex: input.state.adminTokenKeyHex,
    admins: input.state.admins,
    opSeq,
  };
  const audit: KmsAuditEntry = {
    opSeq,
    op: "kms.key-rotate",
    actor: "kms",
    detail: `rotated ${rotated.rotatedOutKeyId} out (retireAt ${rotated.retireAt}); ${rotated.newKeyId} is current (RETAINED: ${rotated.keyring.keys.map((k) => k.keyId).sort().join("+")})`,
  };
  return { ok: true, state, newKeyId: rotated.newKeyId, rotatedOutKeyId: rotated.rotatedOutKeyId, retireAt: rotated.retireAt, audit };
}
