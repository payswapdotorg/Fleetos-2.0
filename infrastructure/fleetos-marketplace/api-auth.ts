/**
 * infrastructure/fleetos-marketplace/api-auth.ts — the security plane of
 * the marketplace deployment service (F370C, Wave 18 lane C).
 *
 * The auth endpoints (credential bootstrap, login, revocation) authenti-
 * cate through the REAL F370A/F370B surfaces; the FROZEN marketplace
 * action-scope table does not govern them (login has no session yet;
 * revocation is the identity plane — recorded in the evidence report).
 *
 *   - POST /api/auth/credentials — the BOOTSTRAP seam: issueCredential
 *     WithGeneratedSalt (the REAL F370B composition) with node:crypto
 *     randomBytes — the exact host-binding recipe from secure-random.ts's
 *     header (the F370B "NOTE" becomes wiring here). Unauthenticated but
 *     journaled; operator-channel hardening is host-deployment class
 *     (honestly recorded, never pretended).
 *   - POST /api/auth/login — verifyCredential (the REAL F370A kernel,
 *     enumeration-resistant) then issueKeyedSession (the REAL F370B
 *     keyring: the current key, the fsk1 envelope). The credential record
 *     binds the actor+tenant (never the body); the requested scopes are
 *     the pilot's caller-declared convention (the F370A fixture law — a
 *     real credential→scope RBAC binding is host-deployment class,
 *     recorded). jti: caller-supplied (the idempotency-key convention)
 *     or host-generated when absent.
 *   - POST /api/auth/revocations — the F370B registry + the store's
 *     revocation journal (revocations now SURVIVE RESTARTS — the F370B
 *     honest limitation closed at the server boundary). Self-scope only:
 *     a session may revoke its own token id or sweep its own actor.
 *
 * Logical time only (`now` from the request); the audit journal records
 * every attempt as data (fixed reason codes — never secrets, never
 * tokens, never key material).
 */

import { randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { CredentialKind, MarketplaceSessionScope, SecureRandom } from "@fleetos/identity";
import { issueCredentialWithGeneratedSalt, issueKeyedSession, verifyCredential } from "@fleetos/identity";
import type { Json, ServiceContext } from "./api.js";
import { bearerTokenOf } from "./api.js";

// The F370B host-boundary binding — the module header's exact recipe:
// node:crypto randomBytes at the host boundary ONLY (the domain packages
// stay deterministic-under-injection; this service IS the host).
export const hostSecureRandom: SecureRandom = {
  randomHex: (n) => randomBytes(n).toString("hex"),
  credentialSalt: () => randomBytes(16).toString("hex"),
};

/** POST /api/auth/credentials — the journaled bootstrap seam. */
export async function handleProvision(ctx: ServiceContext, body: Json): Promise<{ status: number; body: unknown }> {
  const issued = issueCredentialWithGeneratedSalt({
    credentialId: String(body["credentialId"] ?? ""),
    actorId: String(body["actorId"] ?? ""),
    tenantId: String(body["tenantId"] ?? ""),
    kind: (String(body["kind"] ?? "human")) as CredentialKind,
    secret: String(body["secret"] ?? ""),
    secureRandom: hostSecureRandom,
  });
  if (!issued.ok) {
    return { status: 400, body: { ok: false, refusedBy: "boundary", refusal: { reason: "BAD_REQUEST", detail: issued.reason } } };
  }
  await ctx.store.saveCredential(issued.record);
  await ctx.store.appendAudit({ tenantId: issued.record.tenantId }, {
    at: 0, actorId: issued.record.actorId, tenantId: issued.record.tenantId,
    family: "auth", op: "auth.provision", ok: true, duplicate: false, detail: issued.record.credentialId,
  });
  // The response echoes identity fields ONLY (never the salt or digest).
  return {
    status: 200,
    body: { ok: true, credentialId: issued.record.credentialId, actorId: issued.record.actorId, tenantId: issued.record.tenantId, kind: issued.record.kind },
  };
}

/** POST /api/auth/login — verifyCredential → issueKeyedSession. */
export async function handleLogin(ctx: ServiceContext, body: Json): Promise<{ status: number; body: unknown }> {
  const now = typeof body["now"] === "number" && Number.isFinite(body["now"]) ? body["now"] : 0;
  const credentialId = String(body["credentialId"] ?? "");
  const record = await ctx.store.findCredential(credentialId);
  const verified = verifyCredential({ presentedSecret: String(body["secret"] ?? ""), record });
  if (!verified.ok || record === null) {
    // Enumeration-resistant: unknown actor, malformed record and wrong
    // secret are byte-identical here too (one fixed audit line + verdict).
    await ctx.store.appendAudit({ tenantId: "-" }, {
      at: now, actorId: "-", tenantId: "-", family: "auth", op: "auth.login", ok: false, duplicate: false, detail: "INVALID_CREDENTIAL",
    });
    return { status: 401, body: { ok: false, refusedBy: "boundary", refusal: { reason: "UNAUTHENTICATED", detail: "credential did not verify" } } };
  }
  const ttlMs = typeof body["ttlMs"] === "number" && Number.isFinite(body["ttlMs"]) ? body["ttlMs"] : 3_600_000;
  const scopes = Array.isArray(body["scopes"]) ? (body["scopes"] as unknown[]) : [];
  // The jti: caller-supplied (the idempotency-key convention) or drawn
  // from the host boundary's real entropy — NEVER absent: the F370B
  // revocation composition refuses jti-less tokens (JTI_MISSING, the
  // fail-closed law), so every issued session is individually revocable.
  const jti = String(body["jti"] ?? "") !== "" ? String(body["jti"]) : hostSecureRandom.randomHex(16);
  const issued = issueKeyedSession({
    provider: ctx.provider,
    actorId: record.actorId,
    tenantId: record.tenantId,
    scopes: scopes as MarketplaceSessionScope[],
    issuedAt: now,
    expiresAt: now + ttlMs,
    ...(jti !== "" ? { jti } : {}),
  });
  if (!issued.ok) {
    await ctx.store.appendAudit({ tenantId: record.tenantId }, {
      at: now, actorId: record.actorId, tenantId: record.tenantId, family: "auth", op: "auth.login", ok: false, duplicate: false, detail: issued.reason,
    });
    return { status: 400, body: { ok: false, refusedBy: "boundary", refusal: { reason: "BAD_REQUEST", detail: issued.reason } } };
  }
  await ctx.store.appendAudit({ tenantId: record.tenantId }, {
    at: now, actorId: record.actorId, tenantId: record.tenantId, family: "auth", op: "auth.login", ok: true, duplicate: false, detail: issued.keyId,
  });
  return { status: 200, body: { ok: true, token: issued.token, keyId: issued.keyId, claims: issued.claims } };
}

/** POST /api/auth/revocations — the F370B registry, persisted. */
export async function handleRevoke(ctx: ServiceContext, req: IncomingMessage, body: Json): Promise<{ status: number; body: unknown }> {
  const auth = ctx.authenticate({ token: bearerTokenOf(req), now: typeof body["now"] === "number" ? body["now"] : 0 });
  if (!auth.ok) {
    return { status: 401, body: { ok: false, refusedBy: "boundary", refusal: { reason: auth.reason, detail: auth.detail } } };
  }
  const now = typeof body["now"] === "number" && Number.isFinite(body["now"]) ? body["now"] : 0;
  const claims = auth.identity.claims;
  if (body["allActor"] === true) {
    ctx.registry.revokeActor(claims.actorId, now);
    await ctx.store.appendRevocation({ cause: "actor", jti: null, actorId: claims.actorId, tenantId: claims.tenantId, revokedAt: now });
    await ctx.store.appendAudit({ tenantId: claims.tenantId }, {
      at: now, actorId: claims.actorId, tenantId: claims.tenantId, family: "auth", op: "auth.revoke-actor", ok: true, duplicate: false, detail: "actor-sweep",
    });
    return { status: 200, body: { ok: true, revoked: "actor" } };
  }
  const jti = String(body["jti"] ?? "") || claims.jti || "";
  if (jti === "" || (claims.jti !== undefined && jti !== claims.jti)) {
    return {
      status: 403,
      body: { ok: false, refusedBy: "boundary", refusal: { reason: "FORBIDDEN", detail: "a session may revoke only its own token id (the admin plane is out of the pilot scope)" } },
    };
  }
  ctx.registry.revoke(jti, now);
  await ctx.store.appendRevocation({ cause: "jti", jti, actorId: claims.actorId, tenantId: claims.tenantId, revokedAt: now });
  await ctx.store.appendAudit({ tenantId: claims.tenantId }, {
    at: now, actorId: claims.actorId, tenantId: claims.tenantId, family: "auth", op: "auth.revoke", ok: true, duplicate: false, detail: "jti",
  });
  return { status: 200, body: { ok: true, revoked: jti } };
}
