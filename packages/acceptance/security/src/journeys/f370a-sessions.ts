/**
 * F370A journey 2 — authenticated marketplace sessions (persona:
 * tenant-operator).
 *
 * CENSUS CITATION (F370A, census-first with grep proof at base c6fec46):
 * zero matches for the journey id "authenticated-marketplace-sessions"
 * across packages/; zero matches for `verifySignedSession` / `createHmac`
 * anywhere in packages/ at the base tree (NOTE: the packet's literal name
 * `issueSession` is ALREADY the Wave-1 identity kernel's session-lifecycle
 * API — kernel.ts:138, untouched — so the signed-token surface ships as
 * issueSignedSession/verifySignedSession; the finding is recorded in
 * docs/evidence/F370A/report.md); the op-family prefix `ses-` appears in
 * NO acceptance corpus. The nearest neighboring claim is the F361B
 * approval/evidence journeys — neither exercises the SIGNED-TOKEN
 * boundary (HMAC-SHA256 tamper/expiry/wrong-key refusals), THIS lane's
 * angle.
 *
 * The operator proves the F370A signed-session discipline over the REAL
 * public entry points (packages/identity):
 *   - issueSignedSession — the versioned three-part token over the frozen
 *     claims, canonical scopes, deterministic for the same key;
 *   - verifySignedSession — total, never throws: the tamper refusal (a
 *     mutated claim), the wrong-key refusal (both SIGNATURE_INVALID —
 *     cryptographically indistinguishable by design), the expiry refusal
 *     (SESSION_EXPIRED, boundary inclusive), and the malformed-envelope
 *     refusal (MALFORMED_TOKEN).
 *
 * Determinism: pure fixture data, no wall clock; the journey never reads
 * the run anchor — anchor-invariant by construction.
 */

import type { AcceptanceJourney } from "../journey-contracts.ts";
import { issueSignedSession, verifySignedSession } from "@fleetos/identity";
import type { SessionSigningKey } from "@fleetos/identity";

const KEY: SessionSigningKey = {
  algorithm: "HMAC-SHA256",
  secretHex: "0011223344556677889900aabbccddeeff00112233445566778899aabbccddee",
};
const WRONG_KEY: SessionSigningKey = {
  algorithm: "HMAC-SHA256",
  secretHex: "ffeeddccbbaa0099887766554433221100ffeeddccbbaa00998877665544332211",
};
const ACTOR = "act_operator-ama-01";
const TENANT = "acme-ops";
const IAT = 1_791_830_400_000;
const EXP = IAT + 3_600_000;
const NOW = IAT + 1_000;

// Deterministic module-scope evaluation over the REAL public APIs.
function issue(overrides: Partial<Parameters<typeof issueSignedSession>[0]> = {}) {
  return issueSignedSession({
    actorId: ACTOR,
    tenantId: TENANT,
    scopes: ["marketplace.request", "marketplace.offer", "marketplace.order"],
    issuedAt: IAT,
    expiresAt: EXP,
    key: KEY,
    ...overrides,
  });
}
const token = issue();
if (!token.ok) throw new Error("journey fixture: session issuance failed");
const reissued = issue();
if (!reissued.ok) throw new Error("journey fixture: re-issuance failed");
const otherKey = issue({ key: WRONG_KEY });
if (!otherKey.ok) throw new Error("journey fixture: wrong-key issuance failed");

const verified = verifySignedSession(token.token, { key: KEY, now: NOW });
const boundary = verifySignedSession(token.token, { key: KEY, now: EXP });

// The tamper: decode the payload, mutate the tenant claim, re-encode
// WITHOUT re-signing — the classic cross-tenant forgery.
const parts = token.token.split(".");
const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as Record<string, unknown>;
payload["tenantId"] = "globex-rival";
const tamperedToken = `fss1.${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}.${parts[2]}`;
const tampered = verifySignedSession(tamperedToken, { key: KEY, now: NOW });

// A single flipped signature character.
const flippedSig = parts[2]!.startsWith("A") ? `B${parts[2]!.slice(1)}` : `A${parts[2]!.slice(1)}`;
const flippedSigToken = `fss1.${parts[1]}.${flippedSig}`;
const flipped = verifySignedSession(flippedSigToken, { key: KEY, now: NOW });

const wrongKeyVerify = verifySignedSession(token.token, { key: WRONG_KEY, now: NOW });
const expired = issue({ issuedAt: IAT - 10_000, expiresAt: IAT - 1_000 });
if (!expired.ok) throw new Error("journey fixture: expired issuance failed");
const expiredVerify = verifySignedSession(expired.token, { key: KEY, now: NOW });

const malformedReasons = [
  "",
  "not-a-token",
  "fss1..",
  "fss2.aaa.bbb",
  `fss1.${Buffer.from("not json", "utf8").toString("base64url")}.aaaa`,
  `fss1.${Buffer.from(JSON.stringify({ v: 2 }), "utf8").toString("base64url")}.aaaa`,
  `fss1.${Buffer.from(JSON.stringify({ v: 1, actorId: "no-prefix", tenantId: TENANT, scopes: [], issuedAt: IAT, expiresAt: EXP }), "utf8").toString("base64url")}.aaaa`,
].map((candidate) => {
  const r = verifySignedSession(candidate, { key: KEY, now: NOW });
  return r.ok ? "accepted" : r.reason;
});
const nullToken = verifySignedSession(null, { key: KEY, now: NOW });

export const authenticatedMarketplaceSessionsJourney: AcceptanceJourney = {
  journeyId: "security.authenticated-marketplace-sessions",
  persona: "tenant-operator",
  capabilities: ["session-authorization"],
  goal: "Prove the signed-session discipline: HMAC-SHA256 tokens over frozen claims with tamper, wrong-key, expiry and malformed refusals — verify is total",
  steps: [
    {
      stepId: "ses-issue",
      kind: "intake",
      description: "issueSignedSession mints the versioned three-part token with canonicalized scopes, deterministic under the same key",
      packages: ["@fleetos/identity"],
      operations: ["issueSignedSession"],
      run: (ctx) => {
        ctx.record("ses.issue.ok", token.ok);
        ctx.record("ses.issue.prefix", token.token.slice(0, 5));
        ctx.record("ses.issue.partCount", token.token.split(".").length);
        ctx.record("ses.issue.claimScopes", token.claims.scopes);
        ctx.record("ses.issue.claimActor", token.claims.actorId);
        ctx.record("ses.issue.claimTenant", token.claims.tenantId);
        ctx.record("ses.issue.deterministic", token.token === reissued.token);
        ctx.record("ses.issue.otherKeyDiffers", token.token !== otherKey.token);
        ctx.record("ses.issue.scopesCanonical",
          JSON.stringify(token.claims.scopes) === JSON.stringify(["marketplace.offer", "marketplace.order", "marketplace.request"]));
      },
    },
    {
      stepId: "ses-verify-ok",
      kind: "view-read",
      description: "verifySignedSession accepts the genuine token and returns the frozen claims (boundary inclusive at expiresAt)",
      packages: ["@fleetos/identity"],
      operations: ["verifySignedSession"],
      run: (ctx) => {
        ctx.record("ses.verify.ok", verified.ok);
        ctx.record("ses.verify.actorId", verified.ok ? verified.claims.actorId : "refused");
        ctx.record("ses.verify.tenantId", verified.ok ? verified.claims.tenantId : "refused");
        ctx.record("ses.verify.issuedAt", verified.ok ? verified.claims.issuedAt : -1);
        ctx.record("ses.verify.expiresAt", verified.ok ? verified.claims.expiresAt : -1);
        ctx.record("ses.verify.boundaryInclusive", boundary.ok);
      },
    },
    {
      stepId: "ses-tamper-refusal",
      kind: "negative-check",
      description: "REFUSALS: a mutated tenant claim (no re-sign) and a flipped signature character both refuse SIGNATURE_INVALID",
      packages: ["@fleetos/identity"],
      operations: ["verifySignedSession"],
      run: (ctx) => {
        ctx.record("ses.tamper.claimMutation", tampered.ok ? "accepted" : tampered.reason);
        ctx.record("ses.tamper.flippedSignature", flipped.ok ? "accepted" : flipped.reason);
        ctx.record("ses.tamper.sameReason", (tampered.ok ? "" : tampered.reason) === (flipped.ok ? "" : flipped.reason));
      },
    },
    {
      stepId: "ses-wrongkey-expiry-refusal",
      kind: "negative-check",
      description: "REFUSALS: the wrong key refuses SIGNATURE_INVALID (indistinguishable from tamper, by design); an expired window refuses SESSION_EXPIRED",
      packages: ["@fleetos/identity"],
      operations: ["verifySignedSession"],
      run: (ctx) => {
        ctx.record("ses.refusal.wrongKey", wrongKeyVerify.ok ? "accepted" : wrongKeyVerify.reason);
        ctx.record("ses.refusal.expired", expiredVerify.ok ? "accepted" : expiredVerify.reason);
        ctx.record("ses.refusal.wrongKeyEqualsTamper",
          (wrongKeyVerify.ok ? "" : wrongKeyVerify.reason) === (tampered.ok ? "" : tampered.reason));
      },
    },
    {
      stepId: "ses-malformed-refusal",
      kind: "negative-check",
      description: "REFUSALS: every malformed envelope (empty, wrong version, non-JSON, bad claims, null) refuses MALFORMED_TOKEN — verify never throws",
      packages: ["@fleetos/identity"],
      operations: ["verifySignedSession"],
      run: (ctx) => {
        ctx.record("ses.malformed.reasons", malformedReasons);
        ctx.record("ses.malformed.allOneReason", malformedReasons.every((r) => r === "MALFORMED_TOKEN"));
        ctx.record("ses.malformed.nullToken", nullToken.ok ? "accepted" : nullToken.reason);
      },
    },
  ],
  assertions: [
    { assertionId: "ses-1", description: "The session issues as a token", path: "ses.issue.ok", expected: true },
    { assertionId: "ses-2", description: "The token carries the fss1 version prefix", path: "ses.issue.prefix", expected: "fss1." },
    { assertionId: "ses-3", description: "The token is the three-part envelope", path: "ses.issue.partCount", expected: 3 },
    { assertionId: "ses-4", description: "The claims carry the canonical sorted scopes", path: "ses.issue.claimScopes", expected: ["marketplace.offer", "marketplace.order", "marketplace.request"] },
    { assertionId: "ses-5", description: "The claims bind the actor", path: "ses.issue.claimActor", expected: ACTOR },
    { assertionId: "ses-6", description: "The claims bind the tenant", path: "ses.issue.claimTenant", expected: TENANT },
    { assertionId: "ses-7", description: "Deterministic: the same inputs re-issue the same token", path: "ses.issue.deterministic", expected: true },
    { assertionId: "ses-8", description: "A different key issues a different token", path: "ses.issue.otherKeyDiffers", expected: true },
    { assertionId: "ses-9", description: "The signed scope bytes are canonical (sorted, deduplicated)", path: "ses.issue.scopesCanonical", expected: true },
    { assertionId: "ses-10", description: "The genuine token verifies", path: "ses.verify.ok", expected: true },
    { assertionId: "ses-11", description: "Verification returns the actor claim", path: "ses.verify.actorId", expected: ACTOR },
    { assertionId: "ses-12", description: "Verification returns the tenant claim", path: "ses.verify.tenantId", expected: TENANT },
    { assertionId: "ses-13", description: "Verification returns the issuedAt claim", path: "ses.verify.issuedAt", expected: IAT },
    { assertionId: "ses-14", description: "Verification returns the expiresAt claim", path: "ses.verify.expiresAt", expected: EXP },
    { assertionId: "ses-15", description: "The expiry boundary is inclusive (now == expiresAt still verifies)", path: "ses.verify.boundaryInclusive", expected: true },
    { assertionId: "ses-16", description: "REFUSAL: a mutated claim refuses SIGNATURE_INVALID", path: "ses.tamper.claimMutation", expected: "SIGNATURE_INVALID" },
    { assertionId: "ses-17", description: "REFUSAL: a flipped signature character refuses SIGNATURE_INVALID", path: "ses.tamper.flippedSignature", expected: "SIGNATURE_INVALID" },
    { assertionId: "ses-18", description: "Both tamper shapes refuse with the same machine-stable reason", path: "ses.tamper.sameReason", expected: true },
    { assertionId: "ses-19", description: "REFUSAL: the wrong key refuses SIGNATURE_INVALID", path: "ses.refusal.wrongKey", expected: "SIGNATURE_INVALID" },
    { assertionId: "ses-20", description: "REFUSAL: an expired window refuses SESSION_EXPIRED", path: "ses.refusal.expired", expected: "SESSION_EXPIRED" },
    { assertionId: "ses-21", description: "Wrong-key and tamper refusals are indistinguishable (the HMAC law)", path: "ses.refusal.wrongKeyEqualsTamper", expected: true },
    { assertionId: "ses-22", description: "REFUSALS: every malformed envelope refuses MALFORMED_TOKEN", path: "ses.malformed.reasons", expected: ["MALFORMED_TOKEN", "MALFORMED_TOKEN", "MALFORMED_TOKEN", "MALFORMED_TOKEN", "MALFORMED_TOKEN", "MALFORMED_TOKEN", "MALFORMED_TOKEN"] },
    { assertionId: "ses-23", description: "The malformed family is one machine-stable reason", path: "ses.malformed.allOneReason", expected: true },
    { assertionId: "ses-24", description: "A null token is a typed refusal, never a throw", path: "ses.malformed.nullToken", expected: "MALFORMED_TOKEN" },
  ],
};
