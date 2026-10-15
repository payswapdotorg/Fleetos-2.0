/**
 * @fleetos/identity — F370A signed session tokens.
 *
 * The F370A packet deliverable 2: `issueSignedSession` / `verifySignedSession`
 * — HMAC-SHA256 over the frozen claims (actorId, tenantId, scopes,
 * issuedAt, expiresAt) with a CALLER-SUPPLIED key.
 *
 *   - the token is `fss1.<base64url payload>.<base64url signature>` — the
 *     signature covers the version prefix + the payload bytes verbatim,
 *     so ANY mutation of any claim (or the token envelope) is detected;
 *   - TAMPER refusal and WRONG-KEY refusal both surface as
 *     SIGNATURE_INVALID — they are cryptographically indistinguishable
 *     by design (an HMAC either verifies under the presented key or it
 *     does not); the journeys assert both refusals separately;
 *   - EXPIRY refusal: a signature-valid token whose expiresAt has passed
 *     (now > expiresAt) refuses SESSION_EXPIRED — never silently honored;
 *   - verify is TOTAL: never throws, always a typed verdict
 *     (MALFORMED_TOKEN / KEY_INVALID / SIGNATURE_INVALID / SESSION_EXPIRED);
 *   - scopes are canonicalized (deduplicated + sorted) at issue time so
 *     the signed bytes are deterministic for the same claim set.
 *
 * Name note (the F354 census, recorded in docs/evidence/F370A/report.md):
 * the packet's literal name `issueSession` is ALREADY TAKEN by the
 * Wave-1 identity session-lifecycle kernel (kernel.ts:138 — the
 * field-corpus-driven public API, untouched by the grow-only law). The
 * signed-token surface therefore ships as `issueSignedSession` /
 * `verifySignedSession` — a FINDING, never an edit of the existing API.
 *
 * Key policy (honest): the signing key is CALLER-SUPPLIED. The pilot key
 * used by the acceptance corpus is a plainly-labelled FIXTURE; real
 * secret management is F370B-class work, recorded as a limitation.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { isActorId } from "./identity.js";

// ---------------------------------------------------------------------------
// The frozen scope vocabulary (the F360 §3 verb families this lane gates)
// ---------------------------------------------------------------------------

/** The marketplace session scopes — one per F360 §3 frozen verb family. */
export type MarketplaceSessionScope =
  | "marketplace.request"
  | "marketplace.offer"
  | "marketplace.comparison"
  | "marketplace.order"
  | "marketplace.order.ack"
  | "marketplace.receipt"
  | "marketplace.enrollment"
  | "marketplace.approval";

/** The frozen scope vocabulary, machine-stable. */
export const MARKETPLACE_SESSION_SCOPES: readonly MarketplaceSessionScope[] = [
  "marketplace.request",
  "marketplace.offer",
  "marketplace.comparison",
  "marketplace.order",
  "marketplace.order.ack",
  "marketplace.receipt",
  "marketplace.enrollment",
  "marketplace.approval",
];

function isMarketplaceSessionScope(value: unknown): value is MarketplaceSessionScope {
  return typeof value === "string" && (MARKETPLACE_SESSION_SCOPES as readonly string[]).includes(value);
}

/** The marketplace tenant id law (procurement/src/contracts.ts, verbatim). */
const MARKETPLACE_TENANT_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

// ---------------------------------------------------------------------------
// The signing key + the frozen claims
// ---------------------------------------------------------------------------

/** A caller-supplied HMAC-SHA256 signing key (hex-encoded secret). */
export interface SessionSigningKey {
  readonly algorithm: "HMAC-SHA256";
  readonly secretHex: string;
}

/** The frozen signed claims — exactly these five, nothing else. */
export interface SignedSessionClaims {
  readonly actorId: string;
  readonly tenantId: string;
  readonly scopes: readonly MarketplaceSessionScope[];
  readonly issuedAt: number;
  readonly expiresAt: number;
}

/** A signed session token: `fss1.<payload b64url>.<signature b64url>`. */
export type SignedSessionToken = string;

export type SignedSessionIssueRefusalReason =
  | "missing-actor-id"
  | "malformed-actor-id"
  | "missing-tenant-id"
  | "malformed-tenant-id"
  | "malformed-scope"
  | "invalid-issued-at"
  | "invalid-expiry"
  | "key-invalid";

export type SignedSessionIssueResult =
  | { readonly ok: true; readonly token: SignedSessionToken; readonly claims: SignedSessionClaims }
  | { readonly ok: false; readonly reason: SignedSessionIssueRefusalReason };

function isHex(value: string): boolean {
  return value.length > 0 && value.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(value);
}

// ---------------------------------------------------------------------------
// Canonical claim serialization (deterministic bytes)
// ---------------------------------------------------------------------------

/** Canonical claims JSON: scopes deduplicated + sorted, fixed field order. */
function canonicalClaimsJson(claims: SignedSessionClaims): string {
  const scopes = [...new Set(claims.scopes)].sort();
  return JSON.stringify({
    v: 1,
    actorId: claims.actorId,
    tenantId: claims.tenantId,
    scopes,
    issuedAt: claims.issuedAt,
    expiresAt: claims.expiresAt,
  });
}

// ---------------------------------------------------------------------------
// issueSignedSession
// ---------------------------------------------------------------------------

/**
 * Issue a signed session token over the frozen claims. Deterministic:
 * the same inputs (including the key) always produce the same token.
 */
export function issueSignedSession(input: {
  readonly actorId: string;
  readonly tenantId: string;
  readonly scopes: readonly MarketplaceSessionScope[];
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly key: SessionSigningKey;
}): SignedSessionIssueResult {
  if (input.actorId.length === 0) return { ok: false, reason: "missing-actor-id" };
  if (!isActorId(input.actorId)) return { ok: false, reason: "malformed-actor-id" };
  if (input.tenantId.length === 0) return { ok: false, reason: "missing-tenant-id" };
  if (!MARKETPLACE_TENANT_PATTERN.test(input.tenantId)) {
    return { ok: false, reason: "malformed-tenant-id" };
  }
  for (const scope of input.scopes) {
    if (!isMarketplaceSessionScope(scope)) return { ok: false, reason: "malformed-scope" };
  }
  if (!Number.isFinite(input.issuedAt) || input.issuedAt <= 0) {
    return { ok: false, reason: "invalid-issued-at" };
  }
  if (!Number.isFinite(input.expiresAt) || input.expiresAt <= input.issuedAt) {
    return { ok: false, reason: "invalid-expiry" };
  }
  if (input.key.algorithm !== "HMAC-SHA256" || !isHex(input.key.secretHex)) {
    return { ok: false, reason: "key-invalid" };
  }
  const claims: SignedSessionClaims = {
    actorId: input.actorId,
    tenantId: input.tenantId,
    scopes: [...new Set(input.scopes)].sort(),
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
  };
  const payloadB64 = Buffer.from(canonicalClaimsJson(claims), "utf8").toString("base64url");
  const mac = createHmac("sha256", Buffer.from(input.key.secretHex, "hex"))
    .update(`fss1.${payloadB64}`, "utf8")
    .digest();
  const sigB64 = mac.toString("base64url");
  return { ok: true, token: `fss1.${payloadB64}.${sigB64}`, claims };
}

// ---------------------------------------------------------------------------
// verifySignedSession — total, never throws
// ---------------------------------------------------------------------------

/** The typed verify refusals (data, never exception control flow). */
export type SignedSessionVerifyRefusalReason =
  | "MALFORMED_TOKEN"
  | "KEY_INVALID"
  | "SIGNATURE_INVALID"
  | "SESSION_EXPIRED";

export type SignedSessionVerifyResult =
  | { readonly ok: true; readonly claims: SignedSessionClaims }
  | { readonly ok: false; readonly reason: SignedSessionVerifyRefusalReason };

function parseClaims(raw: string): SignedSessionClaims | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const c = parsed as Record<string, unknown>;
  if (c["v"] !== 1) return null;
  if (typeof c["actorId"] !== "string" || !isActorId(c["actorId"])) return null;
  if (typeof c["tenantId"] !== "string" || !MARKETPLACE_TENANT_PATTERN.test(c["tenantId"])) return null;
  if (!Array.isArray(c["scopes"]) || !c["scopes"].every(isMarketplaceSessionScope)) return null;
  const issuedAt = c["issuedAt"];
  const expiresAt = c["expiresAt"];
  if (typeof issuedAt !== "number" || !Number.isFinite(issuedAt) || issuedAt <= 0) return null;
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt) || expiresAt <= issuedAt) return null;
  return {
    actorId: c["actorId"],
    tenantId: c["tenantId"],
    scopes: [...new Set(c["scopes"] as MarketplaceSessionScope[])].sort(),
    issuedAt,
    expiresAt,
  };
}

/**
 * Verify a signed session token. TOTAL: any malformed envelope, bad
 * base64, bad JSON, wrong claim shapes, unusable key, failed signature
 * or expired window is a TYPED refusal — this function never throws.
 *
 * `now` is caller-supplied logical time (the corpus law: no wall clock).
 */
export function verifySignedSession(
  token: SignedSessionToken | null | undefined,
  options: { readonly key: SessionSigningKey; readonly now: number },
): SignedSessionVerifyResult {
  if (typeof token !== "string" || token.length === 0) {
    return { ok: false, reason: "MALFORMED_TOKEN" };
  }
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0]! !== "fss1" || parts[1]!.length === 0 || parts[2]!.length === 0) {
    return { ok: false, reason: "MALFORMED_TOKEN" };
  }
  if (options.key.algorithm !== "HMAC-SHA256" || !isHex(options.key.secretHex)) {
    return { ok: false, reason: "KEY_INVALID" };
  }
  let payload: Buffer;
  let presentedSig: Buffer;
  let claims: SignedSessionClaims | null;
  try {
    payload = Buffer.from(parts[1]!, "base64url");
    presentedSig = Buffer.from(parts[2]!, "base64url");
    claims = parseClaims(payload.toString("utf8"));
  } catch {
    return { ok: false, reason: "MALFORMED_TOKEN" };
  }
  if (claims === null || presentedSig.length === 0) {
    return { ok: false, reason: "MALFORMED_TOKEN" };
  }
  const expected = createHmac("sha256", Buffer.from(options.key.secretHex, "hex"))
    .update(`fss1.${parts[1]!}`, "utf8")
    .digest();
  // Constant-time signature comparison — tampered payload, forged
  // signature and wrong key all refuse here (indistinguishable by design).
  if (presentedSig.length !== expected.length || !timingSafeEqual(presentedSig, expected)) {
    return { ok: false, reason: "SIGNATURE_INVALID" };
  }
  if (options.now > claims.expiresAt) {
    return { ok: false, reason: "SESSION_EXPIRED" };
  }
  return { ok: true, claims };
}
