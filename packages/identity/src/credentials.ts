/**
 * @fleetos/identity — F370A marketplace credential verification.
 *
 * The F370A packet deliverable 1: REAL credential verification for the
 * marketplace transaction spine, as pure functions over node:crypto
 * (NO external dependency):
 *
 *   - `issueCredential` derives a salted scrypt digest over the frozen
 *     credential record (actorId, tenantId, kind) with ONE frozen
 *     deterministic parameter set;
 *   - `verifyCredential` compares digests with `crypto.timingSafeEqual`
 *     (constant time, fixed length);
 *   - ENUMERATION RESISTANCE (the binding law): unknown-actor and
 *     malformed-credential refusals are INDISTINGUISHABLE from a wrong
 *     secret — one single refusal code, and the unknown/malformed paths
 *     perform the SAME scrypt work over a plainly-labelled burn target
 *     so even a timing side channel cannot separate them;
 *   - the plaintext secret is NEVER stored (the record carries the salted
 *     digest only), NEVER logged (this module cannot log — pure), and
 *     NEVER echoed in errors (the single refusal code carries no
 *     material).
 *
 * Id-format laws (composed at their own seams, never conflated — A20):
 *   - actorId follows the identity Actor law (`act_…`, identity.ts);
 *   - tenantId follows the MARKETPLACE TenantScope law
 *     (`[A-Za-z0-9_-]{1,128}`, procurement/src/contracts.ts) — the tenant
 *     format of the transaction-spine surfaces these credentials
 *     authorize. Identity's internal branded `tnt_…` TenantId is a
 *     different surface and stays untouched.
 *
 * Salt policy (honest): the salt is CALLER-SUPPLIED. Production secret
 * management (cryptographically random salt generation at the host
 * boundary) is F370B-class work, recorded as a limitation in
 * docs/evidence/F370A/report.md — the domain function stays pure and
 * deterministic (no Math.random anywhere).
 */

import { scryptSync, timingSafeEqual } from "node:crypto";
import { isActorId } from "./identity.js";

// ---------------------------------------------------------------------------
// Frozen parameters — ONE deterministic set (the packet's law).
// ---------------------------------------------------------------------------

/** The frozen scrypt parameters (OWASP-recommended minimums; deterministic). */
export interface CredentialScryptParameters {
  readonly costN: number;
  readonly blockSizeR: number;
  readonly parallelizationP: number;
  readonly keylenBytes: number;
}

/** The ONE frozen parameter set every credential record carries. */
export const CREDENTIAL_SCRYPT_PARAMETERS: Readonly<CredentialScryptParameters> = {
  costN: 16_384,
  blockSizeR: 8,
  parallelizationP: 1,
  keylenBytes: 32,
};

/** The credential kinds — the identity Actor kinds that may hold credentials. */
export type CredentialKind = "human" | "service" | "agent";

/** The marketplace tenant id law (procurement/src/contracts.ts, verbatim). */
const MARKETPLACE_TENANT_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * The frozen credential record — the ONLY persisted form. The plaintext
 * secret NEVER appears here (digest + salt only, never echoed anywhere).
 */
export interface CredentialRecord {
  readonly credentialId: string;
  readonly actorId: string;
  readonly tenantId: string;
  readonly kind: CredentialKind;
  /** hex-encoded scrypt digest (keylenBytes long) — never the plaintext. */
  readonly digestHex: string;
  /** hex-encoded per-credential salt (caller-supplied; random in production). */
  readonly saltHex: string;
  readonly params: Readonly<CredentialScryptParameters>;
}

// ---------------------------------------------------------------------------
// The burn target — the enumeration-resistance constant.
// ---------------------------------------------------------------------------

/**
 * The fixed dummy salt used when the actor is UNKNOWN or the record is
 * MALFORMED: the same scrypt work is performed over this burn target so
 * the refusal timing matches a genuine verification. Plainly labelled —
 * it is never a real credential's salt.
 */
export const CREDENTIAL_BURN_SALT_HEX = "f370a000000000000000000000000000";

/**
 * The burn digest the dummy path compares against: the scrypt of the
 * EMPTY string over the burn salt. Unreachable by construction —
 * `issueCredential` refuses empty secrets — so a genuine credential can
 * never collide with it. Computed once (deterministic, pure).
 */
const BURN_DIGEST = scryptSync(
  "",
  CREDENTIAL_BURN_SALT_HEX,
  CREDENTIAL_SCRYPT_PARAMETERS.keylenBytes,
  { N: CREDENTIAL_SCRYPT_PARAMETERS.costN, r: CREDENTIAL_SCRYPT_PARAMETERS.blockSizeR, p: CREDENTIAL_SCRYPT_PARAMETERS.parallelizationP },
);

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function isHex(value: string): boolean {
  return value.length > 0 && value.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(value);
}

/** The single verify-refusal code — by law there is exactly ONE (no
 * user enumeration: unknown actor, malformed record and wrong secret
 * are indistinguishable). */
export type CredentialVerifyRefusalReason = "INVALID_CREDENTIAL";

export type CredentialVerifyResult =
  | { readonly ok: true; readonly actorId: string; readonly tenantId: string }
  | { readonly ok: false; readonly reason: CredentialVerifyRefusalReason };

/** issue-time refusal codes (operational, not attacker-visible). */
export type CredentialIssueRefusalReason =
  | "missing-credential-id"
  | "missing-actor-id"
  | "malformed-actor-id"
  | "missing-tenant-id"
  | "malformed-tenant-id"
  | "missing-kind"
  | "missing-secret"
  | "missing-salt"
  | "malformed-salt"
  | "salt-too-short";

export type CredentialIssueResult =
  | { readonly ok: true; readonly record: CredentialRecord }
  | { readonly ok: false; readonly reason: CredentialIssueRefusalReason };

const CREDENTIAL_KINDS: ReadonlyArray<CredentialKind> = ["human", "service", "agent"];
/** Minimum salt entropy: 16 bytes (32 hex chars) — the production floor. */
const MIN_SALT_HEX_LENGTH = 32;

// ---------------------------------------------------------------------------
// issueCredential — the salted scrypt digest over the frozen record.
// ---------------------------------------------------------------------------

/**
 * Derive the credential record. The caller supplies the secret AND the
 * salt; production generates the salt randomly at the host boundary
 * (F370B — recorded honestly; the domain stays pure/deterministic).
 */
export function issueCredential(input: {
  readonly credentialId: string;
  readonly actorId: string;
  readonly tenantId: string;
  readonly kind: CredentialKind;
  readonly secret: string;
  readonly saltHex: string;
}): CredentialIssueResult {
  if (input.credentialId.length === 0) return { ok: false, reason: "missing-credential-id" };
  if (input.actorId.length === 0) return { ok: false, reason: "missing-actor-id" };
  if (!isActorId(input.actorId)) return { ok: false, reason: "malformed-actor-id" };
  if (input.tenantId.length === 0) return { ok: false, reason: "missing-tenant-id" };
  if (!MARKETPLACE_TENANT_PATTERN.test(input.tenantId)) {
    return { ok: false, reason: "malformed-tenant-id" };
  }
  if (!CREDENTIAL_KINDS.includes(input.kind)) return { ok: false, reason: "missing-kind" };
  if (input.secret.length === 0) return { ok: false, reason: "missing-secret" };
  if (input.saltHex.length === 0) return { ok: false, reason: "missing-salt" };
  if (!isHex(input.saltHex)) return { ok: false, reason: "malformed-salt" };
  if (input.saltHex.length < MIN_SALT_HEX_LENGTH) return { ok: false, reason: "salt-too-short" };
  const digestHex = scryptSync(
    input.secret,
    input.saltHex,
    CREDENTIAL_SCRYPT_PARAMETERS.keylenBytes,
    { N: CREDENTIAL_SCRYPT_PARAMETERS.costN, r: CREDENTIAL_SCRYPT_PARAMETERS.blockSizeR, p: CREDENTIAL_SCRYPT_PARAMETERS.parallelizationP },
  ).toString("hex");
  const record: CredentialRecord = {
    credentialId: input.credentialId,
    actorId: input.actorId,
    tenantId: input.tenantId,
    kind: input.kind,
    digestHex,
    saltHex: input.saltHex,
    params: CREDENTIAL_SCRYPT_PARAMETERS,
  };
  return { ok: true, record };
}

// ---------------------------------------------------------------------------
// verifyCredential — timing-safe, enumeration-resistant, total.
// ---------------------------------------------------------------------------

/**
 * Accept ONLY a well-formed record over the FROZEN parameter set with a
 * plausible digest — anything else (unknown actor, null, tampered shape,
 * downgraded parameters) is normalized to the burn target so the work
 * shape and the refusal are IDENTICAL to a genuine mismatch.
 */
function usableRecord(record: CredentialRecord | null | undefined): CredentialRecord | null {
  if (record === null || record === undefined) return null;
  if (typeof record !== "object") return null;
  if (!isActorId(record.actorId)) return null;
  if (!MARKETPLACE_TENANT_PATTERN.test(record.tenantId)) return null;
  if (!CREDENTIAL_KINDS.includes(record.kind)) return null;
  if (!isHex(record.saltHex)) return null;
  if (record.saltHex.length < MIN_SALT_HEX_LENGTH) return null;
  if (typeof record.digestHex !== "string" || !isHex(record.digestHex)) return null;
  if (record.digestHex.length !== CREDENTIAL_SCRYPT_PARAMETERS.keylenBytes * 2) return null;
  if (
    record.params.costN !== CREDENTIAL_SCRYPT_PARAMETERS.costN ||
    record.params.blockSizeR !== CREDENTIAL_SCRYPT_PARAMETERS.blockSizeR ||
    record.params.parallelizationP !== CREDENTIAL_SCRYPT_PARAMETERS.parallelizationP ||
    record.params.keylenBytes !== CREDENTIAL_SCRYPT_PARAMETERS.keylenBytes
  ) {
    // A parameter downgrade is a malformed credential — never verified.
    return null;
  }
  return record;
}

/**
 * Verify a presented secret against a credential record. TOTAL: never
 * throws, always a verdict. The plaintext is consumed and discarded —
 * never stored, never echoed.
 *
 * Enumeration resistance: `record === null` (unknown actor), a malformed
 * record, and a wrong secret all produce the byte-identical verdict
 * `{ ok: false, reason: "INVALID_CREDENTIAL" }`, and all three perform
 * one scrypt derivation + one constant-time comparison (the unknown and
 * malformed paths burn the work over the fixed dummy salt).
 */
export function verifyCredential(input: {
  readonly presentedSecret: string;
  readonly record: CredentialRecord | null | undefined;
}): CredentialVerifyResult {
  const record = usableRecord(input.record);
  // Unknown/malformed => burn the same work over the dummy salt, then
  // refuse exactly like a mismatch. A real record => the true digest.
  const salt = record !== null ? record.saltHex : CREDENTIAL_BURN_SALT_HEX;
  const expected = record !== null ? Buffer.from(record.digestHex, "hex") : BURN_DIGEST;
  const candidate = scryptSync(
    input.presentedSecret,
    salt,
    CREDENTIAL_SCRYPT_PARAMETERS.keylenBytes,
    { N: CREDENTIAL_SCRYPT_PARAMETERS.costN, r: CREDENTIAL_SCRYPT_PARAMETERS.blockSizeR, p: CREDENTIAL_SCRYPT_PARAMETERS.parallelizationP },
  );
  // Constant-time comparison over equal-length buffers (never leaks where
  // a mismatch occurred). A mismatch (or the burn target) refuses.
  const matches = candidate.length === expected.length && timingSafeEqual(candidate, expected);
  if (record !== null && matches) {
    return { ok: true, actorId: record.actorId, tenantId: record.tenantId };
  }
  return { ok: false, reason: "INVALID_CREDENTIAL" };
}
