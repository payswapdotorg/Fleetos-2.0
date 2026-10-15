/**
 * F370B journey 1 — the rotating keyring (persona: site-reliability-
 * engineer).
 *
 * CENSUS CITATION (F370B, census-first with grep proof at base 42d3709):
 * zero matches for the journey id "keyring-rotation" across packages/;
 * zero matches for `keyring` in packages/ except the desktop chrome
 * cookie manager's "linux-keyring-v11" reason codes (a different
 * namespace, recorded here, never claimed); zero matches for
 * `KeyringProvider` / `rotateKeyring` / `issueKeyedSession` /
 * `verifyKeyedSession` / `fsk1` anywhere in packages/ at the base tree;
 * the op-family prefix `kr-` appears in NO acceptance corpus. The
 * nearest neighboring claim is the F370A signed-session family
 * (`security.authenticated-marketplace-sessions`) — a SINGLE fixture
 * key with no lifecycle. NONE drives the ROTATION lifecycle (issue
 * under the current key, verify by the carried key id, grace window,
 * KEY_RETIRED / KEY_UNKNOWN refusals, wrong-material refusal) — THIS
 * lane's angle.
 *
 * The operator proves the F370B keyring discipline over the REAL public
 * entry points (packages/identity): the env-backed configuration-class
 * provider load, `issueKeyedSession` under the current key, the pure
 * `rotateKeyring` through the injected deterministic SecureRandom (id
 * first, then material — the frozen draw order), `verifyKeyedSession`
 * by the carried key id (verify-grace -> KEY_RETIRED, KEY_UNKNOWN,
 * wrong-material SIGNATURE_INVALID, malformed envelopes), and the
 * no-leak law over every verdict.
 *
 * Determinism: pure fixture data, no wall clock, no filesystem in the
 * journey (the file-backed provider is machine-covered by the identity
 * suite incl. the never-echo law; this journey drives the env loader —
 * the same parser path); the journey never reads the run anchor —
 * anchor-invariant by construction.
 */

import type { AcceptanceJourney } from "../journey-contracts.ts";
import {
  FIXTURE_KEYRING_DATA,
  KEYRING_ENV_VARIABLE,
  envKeyringProvider,
  issueKeyedSession,
  keyringProviderFromData,
  rotateKeyring,
  verifyKeyedSession,
} from "@fleetos/identity";
import { deterministicSecureRandom } from "@fleetos/identity";

const ACTOR = "act_sre-kr-01";
const TENANT = "acme-ops";
const IAT = 1_791_830_400_000;
const EXP = IAT + 3_600_000;
const ROTATE_AT = IAT + 60_000;
const GRACE_MS = 600_000;
const RETIRE_AT = ROTATE_AT + GRACE_MS;
const NEW_KEY_ID = "a1b2c3d4e5f60718";
const NEW_KEY_MATERIAL = "9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a0";

// The configuration-class env load of the pilot snapshot (the labelled
// provider path — same parser as the file provider, no filesystem here).
const envLoaded = envKeyringProvider({
  env: {
    [KEYRING_ENV_VARIABLE]: JSON.stringify({
      currentKeyId: FIXTURE_KEYRING_DATA.currentKeyId,
      keys: FIXTURE_KEYRING_DATA.keys,
    }),
  },
});
const baseProvider = envLoaded.ok ? envLoaded.provider : keyringProviderFromData(FIXTURE_KEYRING_DATA);

function issue(overrides: Partial<Parameters<typeof issueKeyedSession>[0]> = {}) {
  return issueKeyedSession({
    provider: baseProvider,
    actorId: ACTOR,
    tenantId: TENANT,
    scopes: ["marketplace.request", "marketplace.order"],
    issuedAt: IAT,
    expiresAt: EXP,
    jti: "jti-kr-old-0001",
    ...overrides,
  });
}

const t1 = issue();
if (!t1.ok) throw new Error("journey fixture: k1 issuance failed");
const t1Reissued = issue();
if (!t1Reissued.ok) throw new Error("journey fixture: k1 re-issuance failed");

const rotation = rotateKeyring({
  keyring: FIXTURE_KEYRING_DATA,
  now: ROTATE_AT,
  verifyGraceMs: GRACE_MS,
  secureRandom: deterministicSecureRandom([NEW_KEY_ID, NEW_KEY_MATERIAL]),
});
if (!rotation.ok) throw new Error("journey fixture: rotation failed");
const rotationReplay = rotateKeyring({
  keyring: FIXTURE_KEYRING_DATA,
  now: ROTATE_AT,
  verifyGraceMs: GRACE_MS,
  secureRandom: deterministicSecureRandom([NEW_KEY_ID, NEW_KEY_MATERIAL]),
});
if (!rotationReplay.ok) throw new Error("journey fixture: rotation replay failed");
const provider = keyringProviderFromData(rotation.keyring);

const t2 = issueKeyedSession({
  provider,
  actorId: ACTOR,
  tenantId: TENANT,
  scopes: ["marketplace.request"],
  issuedAt: ROTATE_AT,
  expiresAt: ROTATE_AT + 3_600_000,
  jti: "jti-kr-new-0002",
});
if (!t2.ok) throw new Error("journey fixture: k2 issuance failed");

// The lifecycle readings: grace, the inclusive boundary, retirement.
const grace = verifyKeyedSession(t1.token, { provider, now: RETIRE_AT - 1 });
const boundary = verifyKeyedSession(t1.token, { provider, now: RETIRE_AT });
const retired = verifyKeyedSession(t1.token, { provider, now: RETIRE_AT + 1 });
const newKeyVerify = verifyKeyedSession(t2.token, { provider, now: RETIRE_AT + 1 });

// The refusals: an unknown key id (payload/sig otherwise intact), and a
// wrong-material keyring (same ids, different secrets).
const ghostParts = t1.token.split(".");
const unknownKey = verifyKeyedSession(`fsk1.ghost-k9.${ghostParts[2]}.${ghostParts[3]}`, { provider, now: IAT });
const wrongMaterialProvider = keyringProviderFromData({
  currentKeyId: "pilot-k1",
  keys: [{ keyId: "pilot-k1", algorithm: "HMAC-SHA256", secretHex: `ff`.repeat(32), retireAt: null }],
});
const wrongMaterial = verifyKeyedSession(t1.token, { provider: wrongMaterialProvider, now: IAT });

const malformedReasons = ["", "not-a-token", "fss1.aaa.bbb", "fsk1", "fsk1..aa.bb", "fsk2.pilot-k1.aa.bb", `fsk1.bad kid.aa.bb`].map(
  (candidate) => {
    const r = verifyKeyedSession(candidate, { provider, now: IAT });
    return r.ok ? "accepted" : r.reason;
  },
);
const nullToken = verifyKeyedSession(null, { provider, now: IAT });

// The no-leak law: no verdict carries key material (the fixture secret
// or the generated material — both known constants).
const noLeakVerdicts = [grace, boundary, retired, newKeyVerify, unknownKey, wrongMaterial, nullToken];
const verdictsSerialized = JSON.stringify(noLeakVerdicts);

export const keyringRotationJourney: AcceptanceJourney = {
  journeyId: "security.keyring-rotation",
  persona: "site-reliability-engineer",
  capabilities: ["rotating-keyring"],
  goal: "Prove the rotating-keyring discipline: issue under the current key, verify by the carried key id through grace to KEY_RETIRED, with KEY_UNKNOWN, wrong-material and malformed refusals",
  steps: [
    {
      stepId: "kr-issue-under-current",
      kind: "intake",
      description: "The env-backed provider loads the pilot snapshot and issueKeyedSession binds the current key id into the fsk1 envelope",
      packages: ["@fleetos/identity"],
      operations: ["envKeyringProvider", "issueKeyedSession"],
      run: (ctx) => {
        ctx.record("kr.env.loadOk", envLoaded.ok);
        ctx.record("kr.env.source", envLoaded.ok ? envLoaded.provider.source : "refused");
        ctx.record("kr.env.currentKey", baseProvider.currentKeyId());
        ctx.record("kr.issue.ok", t1.ok);
        ctx.record("kr.issue.version", t1.token.split(".")[0] ?? "");
        ctx.record("kr.issue.partCount", t1.token.split(".").length);
        ctx.record("kr.issue.keyId", t1.keyId);
        ctx.record("kr.issue.jti", t1.claims.jti ?? "none");
        ctx.record("kr.issue.deterministic", t1.token === t1Reissued.token);
      },
    },
    {
      stepId: "kr-rotate",
      kind: "lifecycle",
      description: "rotateKeyring draws the new key (id then material) through the SecureRandom port, gives the old key a verify-grace deadline and RETAINS it",
      packages: ["@fleetos/identity"],
      operations: ["rotateKeyring"],
      run: (ctx) => {
        ctx.record("kr.rotate.ok", rotation.ok);
        ctx.record("kr.rotate.newKeyId", rotation.newKeyId);
        ctx.record("kr.rotate.rotatedOutKeyId", rotation.rotatedOutKeyId);
        ctx.record("kr.rotate.retireAt", rotation.retireAt);
        ctx.record("kr.rotate.snapshotKeys", rotation.keyring.keys.map((k) => k.keyId).sort());
        ctx.record("kr.rotate.newKeyRetireAtNull", rotation.keyring.keys.find((k) => k.keyId === NEW_KEY_ID)?.retireAt === null);
        ctx.record("kr.rotate.deterministic", JSON.stringify(rotation.keyring) === JSON.stringify(rotationReplay.keyring));
        ctx.record("kr.rotate.t2UnderNewKey", t2.keyId);
      },
    },
    {
      stepId: "kr-verify-grace-retirement",
      kind: "negative-check",
      description: "verifyKeyedSession by the carried key id: the k1 token verifies in grace, at the inclusive boundary, then refuses KEY_RETIRED; the k2 token stays current",
      packages: ["@fleetos/identity"],
      operations: ["verifyKeyedSession"],
      run: (ctx) => {
        ctx.record("kr.grace.ok", grace.ok);
        ctx.record("kr.grace.keyStatus", grace.ok ? grace.keyStatus : "refused");
        ctx.record("kr.grace.keyId", grace.ok ? grace.keyId : "refused");
        ctx.record("kr.grace.boundaryInclusive", boundary.ok);
        ctx.record("kr.retired", retired.ok ? "accepted" : retired.reason);
        ctx.record("kr.newKey.ok", newKeyVerify.ok);
        ctx.record("kr.newKey.keyStatus", newKeyVerify.ok ? newKeyVerify.keyStatus : "refused");
        ctx.record("kr.newKey.keyId", newKeyVerify.ok ? newKeyVerify.keyId : "refused");
      },
    },
    {
      stepId: "kr-unknown-wrong-material",
      kind: "negative-check",
      description: "REFUSALS: an unknown key id refuses KEY_UNKNOWN; a wrong-material keyring (same id, different secret) refuses SIGNATURE_INVALID",
      packages: ["@fleetos/identity"],
      operations: ["verifyKeyedSession"],
      run: (ctx) => {
        ctx.record("kr.unknownKey", unknownKey.ok ? "accepted" : unknownKey.reason);
        ctx.record("kr.wrongMaterial", wrongMaterial.ok ? "accepted" : wrongMaterial.reason);
      },
    },
    {
      stepId: "kr-malformed-refusals",
      kind: "negative-check",
      description: "REFUSALS: every malformed envelope (wrong version, wrong arity, bad key-id charset, empty, null) refuses MALFORMED_TOKEN — verify never throws; no verdict carries key material",
      packages: ["@fleetos/identity"],
      operations: ["verifyKeyedSession"],
      run: (ctx) => {
        ctx.record("kr.malformed.reasons", malformedReasons);
        ctx.record("kr.malformed.allOneReason", malformedReasons.every((r) => r === "MALFORMED_TOKEN"));
        ctx.record("kr.malformed.nullToken", nullToken.ok ? "accepted" : nullToken.reason);
        ctx.record("kr.noleak.verdictsClean",
          !verdictsSerialized.includes(NEW_KEY_MATERIAL) && !verdictsSerialized.includes(FIXTURE_KEYRING_DATA.keys[0]!.secretHex));
      },
    },
  ],
  assertions: [
    { assertionId: "kr-1", description: "The env-backed provider loads the pilot snapshot (configuration-class, labelled)", path: "kr.env.loadOk", expected: true },
    { assertionId: "kr-2", description: "The provider is plainly labelled env-sourced", path: "kr.env.source", expected: "env" },
    { assertionId: "kr-3", description: "The current key is the pilot key", path: "kr.env.currentKey", expected: "pilot-k1" },
    { assertionId: "kr-4", description: "The session issues under the current key", path: "kr.issue.ok", expected: true },
    { assertionId: "kr-5", description: "The keyed token carries the fsk1 version prefix", path: "kr.issue.version", expected: "fsk1" },
    { assertionId: "kr-6", description: "The keyed token is the four-part envelope", path: "kr.issue.partCount", expected: 4 },
    { assertionId: "kr-7", description: "The current key id is bound into the token", path: "kr.issue.keyId", expected: "pilot-k1" },
    { assertionId: "kr-8", description: "The jti travels through the keyed envelope", path: "kr.issue.jti", expected: "jti-kr-old-0001" },
    { assertionId: "kr-9", description: "Issuance is deterministic under the same snapshot", path: "kr.issue.deterministic", expected: true },
    { assertionId: "kr-10", description: "The rotation succeeds", path: "kr.rotate.ok", expected: true },
    { assertionId: "kr-11", description: "The new key id is drawn from the SecureRandom stream", path: "kr.rotate.newKeyId", expected: NEW_KEY_ID },
    { assertionId: "kr-12", description: "The old current key is the rotated-out key", path: "kr.rotate.rotatedOutKeyId", expected: "pilot-k1" },
    { assertionId: "kr-13", description: "The old key's verify-grace deadline is now + grace", path: "kr.rotate.retireAt", expected: RETIRE_AT },
    { assertionId: "kr-14", description: "The retired key is RETAINED in the snapshot (KEY_RETIRED never decays into KEY_UNKNOWN)", path: "kr.rotate.snapshotKeys", expected: [NEW_KEY_ID, "pilot-k1"] },
    { assertionId: "kr-15", description: "The new current key has no retirement deadline", path: "kr.rotate.newKeyRetireAtNull", expected: true },
    { assertionId: "kr-16", description: "The same injected stream rotates to the identical snapshot (deterministic-under-injection)", path: "kr.rotate.deterministic", expected: true },
    { assertionId: "kr-17", description: "Post-rotation issuance binds the new current key id", path: "kr.rotate.t2UnderNewKey", expected: NEW_KEY_ID },
    { assertionId: "kr-18", description: "The k1 token still verifies inside the grace window", path: "kr.grace.ok", expected: true },
    { assertionId: "kr-19", description: "The grace verdict names the verify-grace status", path: "kr.grace.keyStatus", expected: "verify-grace" },
    { assertionId: "kr-20", description: "The grace verdict resolves by the carried key id", path: "kr.grace.keyId", expected: "pilot-k1" },
    { assertionId: "kr-21", description: "The retire-at boundary instant still verifies (inclusive grace)", path: "kr.grace.boundaryInclusive", expected: true },
    { assertionId: "kr-22", description: "REFUSAL: past the retire-at the k1 token refuses KEY_RETIRED", path: "kr.retired", expected: "KEY_RETIRED" },
    { assertionId: "kr-23", description: "The k2 token verifies past the old key's retirement", path: "kr.newKey.ok", expected: true },
    { assertionId: "kr-24", description: "The k2 verdict names the current status", path: "kr.newKey.keyStatus", expected: "current" },
    { assertionId: "kr-25", description: "REFUSAL: an unknown key id refuses KEY_UNKNOWN", path: "kr.unknownKey", expected: "KEY_UNKNOWN" },
    { assertionId: "kr-26", description: "REFUSAL: a wrong-material keyring refuses SIGNATURE_INVALID", path: "kr.wrongMaterial", expected: "SIGNATURE_INVALID" },
    { assertionId: "kr-27", description: "REFUSALS: every malformed envelope refuses MALFORMED_TOKEN", path: "kr.malformed.reasons", expected: ["MALFORMED_TOKEN", "MALFORMED_TOKEN", "MALFORMED_TOKEN", "MALFORMED_TOKEN", "MALFORMED_TOKEN", "MALFORMED_TOKEN", "MALFORMED_TOKEN"] },
    { assertionId: "kr-28", description: "The malformed family is one machine-stable reason", path: "kr.malformed.allOneReason", expected: true },
    { assertionId: "kr-29", description: "A null token is a typed refusal, never a throw", path: "kr.malformed.nullToken", expected: "MALFORMED_TOKEN" },
    { assertionId: "kr-30", description: "NO-LEAK: no verdict carries key material (fixture or generated)", path: "kr.noleak.verdictsClean", expected: true },
  ],
};
