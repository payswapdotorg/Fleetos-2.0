/**
 * F370B journey 2 — session revocation (persona: security-analyst).
 *
 * CENSUS CITATION (F370B, census-first with grep proof at base 42d3709):
 * zero matches for the journey id "session-revocation" across packages/;
 * zero matches for `jti` anywhere in packages/ at the base tree (the
 * claim itself is THIS lane's sanctioned grow-only extension); zero
 * matches for `verifySessionWithRevocation` /
 * `SessionRevocationRegistry` / `InMemorySessionRevocationRegistry`;
 * the op-family prefix `rev-` appears in NO acceptance corpus. The
 * nearest neighboring claims are the F370A signed-session family
 * (tamper/expiry/wrong-key, no revocation surface) and the Wave-1
 * kernel session lifecycle (`evaluateSessionTransition` revoke — a
 * DIFFERENT surface: the identity session STATE MACHINE, not signed
 * marketplace tokens). NONE composes a revocation registry into SIGNED
 * TOKEN verification with signature/expiry precedence — THIS lane's
 * angle.
 *
 * The analyst proves the F370B revocation discipline over the REAL
 * public entry points (packages/identity): jti-carrying issuance, the
 * registry port (revoke / revokeActor / the evidence queries), the
 * `verifySessionWithRevocation` composition (a jti revocation, the
 * surviving sibling, the actor-wide sweep), the PRECEDENCE law at the
 * exact seams (signature and expiry precede revocation; the expiry
 * boundary instant hands over to the registry), the fail-closed
 * JTI_MISSING default, and the full keyed stack
 * (`verifyKeyedSessionWithRevocation`) where key retirement also
 * precedes revocation.
 *
 * Determinism: pure fixture data, no wall clock; the journey never
 * reads the run anchor — anchor-invariant by construction.
 */

import type { AcceptanceJourney } from "../journey-contracts.ts";
import {
  InMemorySessionRevocationRegistry,
  issueKeyedSession,
  issueSignedSession,
  keyringProviderFromData,
  rotateKeyring,
  verifyKeyedSessionWithRevocation,
  verifySessionWithRevocation,
} from "@fleetos/identity";
import type { SessionSigningKey } from "@fleetos/identity";
import { deterministicSecureRandom } from "@fleetos/identity";

const KEY: SessionSigningKey = {
  algorithm: "HMAC-SHA256",
  secretHex: "33445566778899aabbccddeeff00112233445566778899aabbccddeeff001122",
};
const ACTOR = "act_analyst-rev-01";
const SIBLING_ACTOR = "act_analyst-rev-02";
const KEYED_ACTOR = "act_analyst-rev-03";
const TENANT = "acme-ops";
const IAT = 1_791_830_400_000;
const EXP = IAT + 3_600_000;
const NOW = IAT + 1_000;
const REVOKE_AT = IAT + 2_000;
const SWEEP_AT = IAT + 3_000;
const JTI_A = "jti-rev-alpha-0001";
const JTI_B = "jti-rev-beta-0002";
const JTI_E = "jti-rev-delta-0004";

function issue(overrides: Partial<Parameters<typeof issueSignedSession>[0]> = {}) {
  return issueSignedSession({
    actorId: ACTOR,
    tenantId: TENANT,
    scopes: ["marketplace.request"],
    issuedAt: IAT,
    expiresAt: EXP,
    jti: JTI_A,
    key: KEY,
    ...overrides,
  });
}

const registry = new InMemorySessionRevocationRegistry();
const tA = issue();
if (!tA.ok) throw new Error("journey fixture: alpha issuance failed");
const tAReissued = issue();
if (!tAReissued.ok) throw new Error("journey fixture: alpha re-issuance failed");
const tB = issue({ jti: JTI_B });
if (!tB.ok) throw new Error("journey fixture: beta issuance failed");
const tC = issue({ jti: "jti-rev-gamma-0003", actorId: SIBLING_ACTOR });
if (!tC.ok) throw new Error("journey fixture: gamma issuance failed");
const tNoJti = issue({ jti: undefined });
if (!tNoJti.ok) throw new Error("journey fixture: jti-less issuance failed");

// The pre-revocation reading, then the jti revocation.
const beforeRevocation = verifySessionWithRevocation(tA.token, { key: KEY, registry, now: NOW });
const revocationRecord = registry.revoke(JTI_A, REVOKE_AT);
const revokedA = verifySessionWithRevocation(tA.token, { key: KEY, registry, now: NOW });
const siblingB = verifySessionWithRevocation(tB.token, { key: KEY, registry, now: NOW });

// The actor-wide sweep, then the more-specific jti revocation on top.
const sweepRecord = registry.revokeActor(ACTOR, SWEEP_AT);
const sweptB = verifySessionWithRevocation(tB.token, { key: KEY, registry, now: NOW });
const untouchedC = verifySessionWithRevocation(tC.token, { key: KEY, registry, now: NOW });
registry.revoke(JTI_B, SWEEP_AT + 1_000);
const specificB = verifySessionWithRevocation(tB.token, { key: KEY, registry, now: NOW });

// PRECEDENCE: a tampered token refuses at the signature even when the
// jti is revoked; a malformed envelope never reaches the registry.
const parts = tA.token.split(".");
const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as Record<string, unknown>;
payload["tenantId"] = "globex-rival";
const tampered = `fss1.${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}.${parts[2]}`;
const tamperedRevoked = verifySessionWithRevocation(tampered, { key: KEY, registry, now: NOW });
const malformedRevoked = verifySessionWithRevocation("garbage", { key: KEY, registry, now: NOW });
const nullRevoked = verifySessionWithRevocation(null, { key: KEY, registry, now: NOW });

// PRECEDENCE at the exact expiry seam: an expired-and-revoked token
// refuses SESSION_EXPIRED; at the inclusive boundary instant it is NOT
// expired, so the registry is what refuses.
const tE = issue({ jti: JTI_E, issuedAt: IAT - 20_000, expiresAt: IAT - 10_000 });
if (!tE.ok) throw new Error("journey fixture: delta issuance failed");
const expiredBeforeRevocation = verifySessionWithRevocation(tE.token, { key: KEY, registry, now: NOW });
registry.revoke(JTI_E, REVOKE_AT);
const expiredRevoked = verifySessionWithRevocation(tE.token, { key: KEY, registry, now: NOW });
const boundarySeam = verifySessionWithRevocation(tA.token, { key: KEY, registry, now: EXP });
const pastSeam = verifySessionWithRevocation(tA.token, { key: KEY, registry, now: EXP + 1 });
const missingJti = verifySessionWithRevocation(tNoJti.token, { key: KEY, registry, now: NOW });

// The full keyed stack: rotation, keyed issuance with jti, and the
// keyring precedes revocation there too.
const NEW_KEY_ID = "a1b2c3d4e5f60718";
const NEW_KEY_MATERIAL = "9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a0";
const ROTATE_AT = IAT + 60_000;
const GRACE_MS = 600_000;
const RETIRE_AT = ROTATE_AT + GRACE_MS;
const BASE_KEYRING = {
  currentKeyId: "pilot-k1",
  keys: [{ keyId: "pilot-k1", algorithm: "HMAC-SHA256" as const, secretHex: KEY.secretHex, retireAt: null }],
};
const keyedRotation = rotateKeyring({
  keyring: BASE_KEYRING,
  now: ROTATE_AT,
  verifyGraceMs: GRACE_MS,
  secureRandom: deterministicSecureRandom([NEW_KEY_ID, NEW_KEY_MATERIAL]),
});
if (!keyedRotation.ok) throw new Error("journey fixture: keyed rotation failed");
const keyedProvider = keyringProviderFromData(keyedRotation.keyring);
const tk = issueKeyedSession({
  provider: keyedProvider,
  actorId: KEYED_ACTOR,
  tenantId: TENANT,
  scopes: ["marketplace.request"],
  issuedAt: IAT,
  expiresAt: EXP,
  jti: "jti-kr-rev-0005",
});
if (!tk.ok) throw new Error("journey fixture: keyed issuance failed");
const keyedOk = verifyKeyedSessionWithRevocation(tk.token, { provider: keyedProvider, registry, now: NOW });
registry.revoke("jti-kr-rev-0005", REVOKE_AT);
const keyedRevoked = verifyKeyedSessionWithRevocation(tk.token, { provider: keyedProvider, registry, now: NOW });
const tkOld = issueKeyedSession({
  provider: keyringProviderFromData(BASE_KEYRING),
  actorId: KEYED_ACTOR,
  tenantId: TENANT,
  scopes: ["marketplace.request"],
  issuedAt: IAT,
  expiresAt: EXP,
  jti: "jti-kr-rev-0006",
});
if (!tkOld.ok) throw new Error("journey fixture: old-key keyed issuance failed");
registry.revoke("jti-kr-rev-0006", REVOKE_AT);
const keyedRetiredRevoked = verifyKeyedSessionWithRevocation(tkOld.token, { provider: keyedProvider, registry, now: RETIRE_AT + 1 });
const keyedGraceRevoked = verifyKeyedSessionWithRevocation(tkOld.token, { provider: keyedProvider, registry, now: RETIRE_AT - 1 });

export const sessionRevocationJourney: AcceptanceJourney = {
  journeyId: "security.session-revocation",
  persona: "security-analyst",
  capabilities: ["session-revocation"],
  goal: "Prove the session-revocation discipline: the jti claim, the registry (jti + actor sweep) composed into verification, and the signature/expiry-precedes-revocation law at the exact seams",
  steps: [
    {
      stepId: "rev-issue-verify",
      kind: "intake",
      description: "issueSignedSession mints jti-carrying tokens that verify through verifySessionWithRevocation before any revocation",
      packages: ["@fleetos/identity"],
      operations: ["issueSignedSession", "verifySessionWithRevocation"],
      run: (ctx) => {
        ctx.record("rev.issue.jtiClaim", tA.claims.jti ?? "none");
        ctx.record("rev.issue.deterministic", tA.token === tAReissued.token);
        ctx.record("rev.verify.beforeRevocation", beforeRevocation.ok);
        ctx.record("rev.verify.jtiRoundTrip", beforeRevocation.ok ? beforeRevocation.claims.jti ?? "none" : "refused");
      },
    },
    {
      stepId: "rev-jti-revocation",
      kind: "negative-check",
      description: "revoke(jti) refuses the token REVOKED (cause jti) while the sibling token (different jti, same actor) stays valid; the registry records the evidence",
      packages: ["@fleetos/identity"],
      operations: ["revoke", "isRevoked", "revocationOf", "verifySessionWithRevocation"],
      run: (ctx) => {
        ctx.record("rev.jti.record", [revocationRecord.jti, revocationRecord.revokedAt]);
        ctx.record("rev.jti.membership", registry.isRevoked(JTI_A));
        ctx.record("rev.jti.refusal", revokedA.ok ? "accepted" : revokedA.reason);
        ctx.record("rev.jti.cause", revokedA.ok ? "none" : revokedA.cause ?? "none");
        ctx.record("rev.jti.siblingValid", siblingB.ok);
      },
    },
    {
      stepId: "rev-actor-sweep",
      kind: "negative-check",
      description: "revokeActor sweeps every token of the actor (cause actor); another actor's token is untouched; a jti revocation still wins as the most specific cause",
      packages: ["@fleetos/identity"],
      operations: ["revokeActor", "isActorRevoked", "actorRevocationOf", "verifySessionWithRevocation"],
      run: (ctx) => {
        ctx.record("rev.sweep.record", [sweepRecord.actorId, sweepRecord.revokedAt]);
        ctx.record("rev.sweep.membership", registry.isActorRevoked(ACTOR));
        ctx.record("rev.sweep.refusal", sweptB.ok ? "accepted" : sweptB.reason);
        ctx.record("rev.sweep.cause", sweptB.ok ? "none" : sweptB.cause ?? "none");
        ctx.record("rev.sweep.otherActorUntouched", untouchedC.ok);
        ctx.record("rev.sweep.specificCauseWins", specificB.ok ? "none" : specificB.cause ?? "none");
      },
    },
    {
      stepId: "rev-precedence",
      kind: "negative-check",
      description: "REFUSALS: signature and expiry PRECEDE revocation — a tampered token refuses SIGNATURE_INVALID, an expired token SESSION_EXPIRED, malformed MALFORMED_TOKEN, a jti-less token JTI_MISSING (all despite revocation)",
      packages: ["@fleetos/identity"],
      operations: ["verifySessionWithRevocation"],
      run: (ctx) => {
        ctx.record("rev.prec.tampered", tamperedRevoked.ok ? "accepted" : tamperedRevoked.reason);
        ctx.record("rev.prec.malformed", malformedRevoked.ok ? "accepted" : malformedRevoked.reason);
        ctx.record("rev.prec.nullToken", nullRevoked.ok ? "accepted" : nullRevoked.reason);
        ctx.record("rev.prec.expiredBefore", expiredBeforeRevocation.ok ? "accepted" : expiredBeforeRevocation.reason);
        ctx.record("rev.prec.expiredRevoked", expiredRevoked.ok ? "accepted" : expiredRevoked.reason);
        ctx.record("rev.prec.boundarySeam", boundarySeam.ok ? "accepted" : boundarySeam.reason);
        ctx.record("rev.prec.boundarySeamCause", boundarySeam.ok ? "none" : boundarySeam.cause ?? "none");
        ctx.record("rev.prec.pastSeam", pastSeam.ok ? "accepted" : pastSeam.reason);
        ctx.record("rev.prec.missingJti", missingJti.ok ? "accepted" : missingJti.reason);
      },
    },
    {
      stepId: "rev-keyed-composition",
      kind: "negative-check",
      description: "The FULL stack: keyed jti tokens verify then refuse REVOKED; a retired key refuses KEY_RETIRED even when revoked; in grace the revocation is the refusing verdict",
      packages: ["@fleetos/identity"],
      operations: ["rotateKeyring", "issueKeyedSession", "verifyKeyedSessionWithRevocation"],
      run: (ctx) => {
        ctx.record("rev.keyed.ok", keyedOk.ok);
        ctx.record("rev.keyed.keyStatus", keyedOk.ok ? keyedOk.keyStatus : "refused");
        ctx.record("rev.keyed.refusal", keyedRevoked.ok ? "accepted" : keyedRevoked.reason);
        ctx.record("rev.keyed.retiredBeatsRevoked", keyedRetiredRevoked.ok ? "accepted" : keyedRetiredRevoked.reason);
        ctx.record("rev.keyed.graceRevoked", keyedGraceRevoked.ok ? "accepted" : keyedGraceRevoked.reason);
        ctx.record("rev.keyed.graceCause", keyedGraceRevoked.ok ? "none" : keyedGraceRevoked.cause ?? "none");
      },
    },
  ],
  assertions: [
    { assertionId: "rev-1", description: "The issued token carries the jti claim", path: "rev.issue.jtiClaim", expected: JTI_A },
    { assertionId: "rev-2", description: "jti-carrying issuance is deterministic", path: "rev.issue.deterministic", expected: true },
    { assertionId: "rev-3", description: "The token verifies through the revocation composition before any revocation", path: "rev.verify.beforeRevocation", expected: true },
    { assertionId: "rev-4", description: "The jti round-trips through verification", path: "rev.verify.jtiRoundTrip", expected: JTI_A },
    { assertionId: "rev-5", description: "The registry records the revocation evidence", path: "rev.jti.record", expected: [JTI_A, REVOKE_AT] },
    { assertionId: "rev-6", description: "The registry membership query answers true", path: "rev.jti.membership", expected: true },
    { assertionId: "rev-7", description: "REFUSAL: the revoked token refuses REVOKED", path: "rev.jti.refusal", expected: "REVOKED" },
    { assertionId: "rev-8", description: "The refusal names the jti cause", path: "rev.jti.cause", expected: "jti" },
    { assertionId: "rev-9", description: "The sibling token (different jti, same actor) stays valid", path: "rev.jti.siblingValid", expected: true },
    { assertionId: "rev-10", description: "The sweep records the actor evidence", path: "rev.sweep.record", expected: [ACTOR, SWEEP_AT] },
    { assertionId: "rev-11", description: "The actor membership query answers true", path: "rev.sweep.membership", expected: true },
    { assertionId: "rev-12", description: "REFUSAL: the swept sibling refuses REVOKED", path: "rev.sweep.refusal", expected: "REVOKED" },
    { assertionId: "rev-13", description: "The sweep refusal names the actor cause", path: "rev.sweep.cause", expected: "actor" },
    { assertionId: "rev-14", description: "Another actor's token is untouched by the sweep", path: "rev.sweep.otherActorUntouched", expected: true },
    { assertionId: "rev-15", description: "The most specific cause wins (jti beats the actor sweep)", path: "rev.sweep.specificCauseWins", expected: "jti" },
    { assertionId: "rev-16", description: "PRECEDENCE: a tampered token refuses SIGNATURE_INVALID even when revoked", path: "rev.prec.tampered", expected: "SIGNATURE_INVALID" },
    { assertionId: "rev-17", description: "PRECEDENCE: a malformed envelope refuses MALFORMED_TOKEN even under a loaded registry", path: "rev.prec.malformed", expected: "MALFORMED_TOKEN" },
    { assertionId: "rev-18", description: "A null token is a typed refusal, never a throw", path: "rev.prec.nullToken", expected: "MALFORMED_TOKEN" },
    { assertionId: "rev-19", description: "The expired window refuses SESSION_EXPIRED before its jti is revoked", path: "rev.prec.expiredBefore", expected: "SESSION_EXPIRED" },
    { assertionId: "rev-20", description: "PRECEDENCE: the expired window STILL refuses SESSION_EXPIRED after the revocation (expiry precedes revocation)", path: "rev.prec.expiredRevoked", expected: "SESSION_EXPIRED" },
    { assertionId: "rev-21", description: "The exact seam: at the inclusive expiry boundary the token is not expired, so the registry refuses REVOKED", path: "rev.prec.boundarySeam", expected: "REVOKED" },
    { assertionId: "rev-22", description: "The seam refusal names the jti cause", path: "rev.prec.boundarySeamCause", expected: "jti" },
    { assertionId: "rev-23", description: "One instant past the seam the expiry verdict takes over", path: "rev.prec.pastSeam", expected: "SESSION_EXPIRED" },
    { assertionId: "rev-24", description: "REFUSAL: a jti-less token refuses JTI_MISSING (the fail-closed default)", path: "rev.prec.missingJti", expected: "JTI_MISSING" },
    { assertionId: "rev-25", description: "The keyed jti token verifies through the full stack", path: "rev.keyed.ok", expected: true },
    { assertionId: "rev-26", description: "The keyed verdict names the current key status", path: "rev.keyed.keyStatus", expected: "current" },
    { assertionId: "rev-27", description: "REFUSAL: the revoked keyed token refuses REVOKED", path: "rev.keyed.refusal", expected: "REVOKED" },
    { assertionId: "rev-28", description: "PRECEDENCE: a retired key refuses KEY_RETIRED even when the jti is revoked", path: "rev.keyed.retiredBeatsRevoked", expected: "KEY_RETIRED" },
    { assertionId: "rev-29", description: "In grace the same token refuses REVOKED instead (the registry check follows the keyring check)", path: "rev.keyed.graceRevoked", expected: "REVOKED" },
    { assertionId: "rev-30", description: "The grace refusal names the jti cause", path: "rev.keyed.graceCause", expected: "jti" },
  ],
};
