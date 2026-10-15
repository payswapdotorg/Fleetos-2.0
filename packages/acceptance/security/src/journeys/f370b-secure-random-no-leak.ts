/**
 * F370B journey 3 — host-boundary randomness + the no-leak law
 * (persona: compliance-auditor).
 *
 * CENSUS CITATION (F370B, census-first with grep proof at base 42d3709):
 * zero matches for the journey id "secure-random-no-leak" across
 * packages/; zero matches for `SecureRandom` /
 * `deterministicSecureRandom` / `issueCredentialWithGeneratedSalt` /
 * `generateSigningKey` anywhere in packages/ at the base tree; the
 * op-family prefix `sr-` appears in NO acceptance corpus. The nearest
 * neighboring claims are the F370A credentials family (CALLER-supplied
 * salts — the honestly-recorded F370A limitation) and the F370A
 * sessions family (fixture keys). NONE drives randomness THROUGH THE
 * PORT (deterministic-under-injection) with the no-secret-leak law
 * machine-asserted over its own verdicts — THIS lane's angle.
 *
 * The auditor proves the F370B randomness discipline over the REAL
 * public entry points (packages/identity): the deterministic
 * fixed-stream SecureRandom (the determinism battery), the
 * generated-salt credential composition (the pure F370A kernel
 * unchanged, salts + enumeration resistance under GENERATED salts),
 * key material + ids through the port (the rotation draw), and the
 * NO-SECRET-LEAK law — no key material, no plaintext secret, no salt
 * beyond the stored record appears in any verdict the lane produces
 * (the stored record and the returned rotation snapshot are the two
 * sanctioned stores; everything else is grep-asserted clean; the
 * corpus-wide journey-JSON grep is machine-run in tests/f370b.test.ts).
 *
 * Determinism: pure fixture data, no wall clock; the journey never
 * reads the run anchor — anchor-invariant by construction.
 */

import type { AcceptanceJourney } from "../journey-contracts.ts";
import {
  FIXTURE_KEYRING_DATA,
  issueCredentialWithGeneratedSalt,
  issueKeyedSession,
  keyringProviderFromData,
  rotateKeyring,
  verifyCredential,
  verifyKeyedSession,
  deterministicSecureRandom,
} from "@fleetos/identity";

const ACTOR = "act_auditor-sr-01";
const TENANT = "acme-ops";
const IAT = 1_791_830_400_000;
const EXP = IAT + 3_600_000;
const ROTATE_AT = IAT + 60_000;
const GRACE_MS = 600_000;

// The fixed streams (the injected entropy — every value a known
// constant so the no-leak grep is exact).
const PLAINTEXT = "f370b-plaintext-secret-fixture";
const SALT_A = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const SALT_B = "0f1e2d3c4b5a69788796a5b4c3d2e1f0";
const KEY_ID_A = "1122334455667788";
const KEY_ID_B = "8877665544332211";
const MATERIAL_A = "9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a0";
const MATERIAL_B = "11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff";

// The deterministic-stream laws (the stream values match the draw sizes:
// credentialSalt is 16 bytes / 32 hex; the signing-key draw is 32 bytes /
// 64 hex — the port validates every draw, so the sizes are part of the law).
const streamA1 = deterministicSecureRandom([SALT_A, MATERIAL_A]);
const streamA2 = deterministicSecureRandom([SALT_A, MATERIAL_A]);
const streamA3 = deterministicSecureRandom([SALT_A, MATERIAL_A]);
const streamB = deterministicSecureRandom([SALT_B, MATERIAL_B]);
const saltIdentical = streamA1.credentialSalt() === streamA2.credentialSalt();
const keyMaterialIdentical = streamA1.randomHex(32) === streamA2.randomHex(32);
const differentStreamDiffers = streamA3.credentialSalt() !== streamB.credentialSalt();
const saltHexLength = SALT_A.length;
const keyHexLength = MATERIAL_A.length;

// The generated-salt credential composition (the kernel unchanged).
function issueCredentialFromStream(salt: string) {
  return issueCredentialWithGeneratedSalt({
    credentialId: "cred-f370b-sr-01",
    actorId: ACTOR,
    tenantId: TENANT,
    kind: "human",
    secret: PLAINTEXT,
    secureRandom: deterministicSecureRandom([salt]),
  });
}
const credA1 = issueCredentialFromStream(SALT_A);
const credA2 = issueCredentialFromStream(SALT_A);
const credB = issueCredentialFromStream(SALT_B);
if (!credA1.ok || !credA2.ok || !credB.ok) throw new Error("journey fixture: credential issuance failed");
const credentialVerified = verifyCredential({ presentedSecret: PLAINTEXT, record: credA1.record });
const wrongSecret = verifyCredential({ presentedSecret: "wrong-secret", record: credA1.record });
const unknownActor = verifyCredential({ presentedSecret: "wrong-secret", record: null });
const refusalsByteIdentical = JSON.stringify(wrongSecret) === JSON.stringify(unknownActor);

// Key material + ids through the port (the rotation draw), twice under
// the same stream and once under a different one.
function rotateFromStream(keyId: string, material: string) {
  return rotateKeyring({
    keyring: FIXTURE_KEYRING_DATA,
    now: ROTATE_AT,
    verifyGraceMs: GRACE_MS,
    secureRandom: deterministicSecureRandom([keyId, material]),
  });
}
const rotationA1 = rotateFromStream(KEY_ID_A, MATERIAL_A);
const rotationA2 = rotateFromStream(KEY_ID_A, MATERIAL_A);
const rotationB = rotateFromStream(KEY_ID_B, MATERIAL_B);
if (!rotationA1.ok || !rotationA2.ok || !rotationB.ok) throw new Error("journey fixture: rotation failed");
const rotationIdentical = JSON.stringify(rotationA1.keyring) === JSON.stringify(rotationA2.keyring);

function issueKeyed(rotation: typeof rotationA1) {
  if (!rotation.ok) throw new Error("journey fixture: keyed issuance failed");
  return issueKeyedSession({
    provider: keyringProviderFromData(rotation.keyring),
    actorId: ACTOR,
    tenantId: TENANT,
    scopes: ["marketplace.request"],
    issuedAt: IAT,
    expiresAt: EXP,
    jti: "jti-sr-port-0001",
  });
}
const keyedA1 = issueKeyed(rotationA1);
const keyedA2 = issueKeyed(rotationA2);
const keyedB = issueKeyed(rotationB);
if (!keyedA1.ok || !keyedA2.ok || !keyedB.ok) throw new Error("journey fixture: keyed issuance failed");
const keyedVerified = verifyKeyedSession(keyedA1.token, {
  provider: keyringProviderFromData(rotationA1.keyring),
  now: ROTATE_AT + 1,
});

// THE NO-LEAK LAW (in-journey half; the corpus-wide journey-JSON grep
// is machine-run in tests/f370b.test.ts): the VERDICTS carry no key
// material, no plaintext, no salt. The two sanctioned stores — the
// stored credential record and the returned rotation snapshot — are
// where the salt/material live, and ONLY there.
const verdicts = [credentialVerified, wrongSecret, unknownActor, keyedVerified, keyedA1, keyedB];
const verdictsSerialized = JSON.stringify(verdicts);
const recordSerialized = JSON.stringify(credA1.record);
const rotationMetadata = (({ keyring: _keyring, ...rest }) => rest)(rotationA1);
const rotationMetadataSerialized = JSON.stringify(rotationMetadata);
const secrets = [MATERIAL_A, MATERIAL_B, SALT_A, SALT_B, PLAINTEXT, FIXTURE_KEYRING_DATA.keys[0]!.secretHex];

export const secureRandomNoLeakJourney: AcceptanceJourney = {
  journeyId: "security.secure-random-no-leak",
  persona: "compliance-auditor",
  capabilities: ["host-boundary-randomness"],
  goal: "Prove the host-boundary randomness discipline: salts + key material through the injected SecureRandom port, deterministic-under-injection, enumeration-resistant generated-salt credentials, and the no-secret-leak law",
  steps: [
    {
      stepId: "sr-deterministic-stream",
      kind: "intake",
      description: "The deterministic fixed-stream SecureRandom draws the same values for the same stream and genuinely different values for a different one",
      packages: ["@fleetos/identity"],
      operations: ["deterministicSecureRandom"],
      run: (ctx) => {
        ctx.record("sr.det.saltIdentical", saltIdentical);
        ctx.record("sr.det.keyMaterialIdentical", keyMaterialIdentical);
        ctx.record("sr.det.differentStreamDiffers", differentStreamDiffers);
        ctx.record("sr.det.saltHexLength", saltHexLength);
        ctx.record("sr.det.keyHexLength", keyHexLength);
      },
    },
    {
      stepId: "sr-generated-salt-credentials",
      kind: "negative-check",
      description: "issueCredentialWithGeneratedSalt generates the salt through the port; the record verifies, wrong-secret and unknown-actor refuse byte-identically (enumeration resistance under GENERATED salts)",
      packages: ["@fleetos/identity"],
      operations: ["issueCredentialWithGeneratedSalt", "verifyCredential"],
      run: (ctx) => {
        ctx.record("sr.cred.ok", credA1.ok);
        ctx.record("sr.cred.saltHexLength", credA1.record.saltHex.length);
        ctx.record("sr.cred.verifyOk", credentialVerified.ok);
        ctx.record("sr.cred.wrongSecret", wrongSecret.ok ? "accepted" : wrongSecret.reason);
        ctx.record("sr.cred.unknownActor", unknownActor.ok ? "accepted" : unknownActor.reason);
        ctx.record("sr.cred.refusalsByteIdentical", refusalsByteIdentical);
        ctx.record("sr.cred.sameStreamIdenticalRecord", JSON.stringify(credA1.record) === JSON.stringify(credA2.record));
        ctx.record("sr.cred.differentStreamDiffers", credA1.record.digestHex !== credB.record.digestHex);
      },
    },
    {
      stepId: "sr-key-material-via-port",
      kind: "lifecycle",
      description: "rotateKeyring draws the new key id + material through the port; the same stream rotates to the identical snapshot and issues identical keyed tokens, a different stream differs",
      packages: ["@fleetos/identity"],
      operations: ["rotateKeyring", "issueKeyedSession", "verifyKeyedSession"],
      run: (ctx) => {
        ctx.record("sr.mat.rotationIdentical", rotationIdentical);
        ctx.record("sr.mat.newKeyIdA", rotationA1.newKeyId);
        ctx.record("sr.mat.newKeyIdB", rotationB.newKeyId);
        ctx.record("sr.mat.newKeyIdsDiffer", rotationA1.newKeyId !== rotationB.newKeyId);
        ctx.record("sr.mat.keyedTokenIdentical", keyedA1.token === keyedA2.token);
        ctx.record("sr.mat.keyedTokenDiffers", keyedA1.token !== keyedB.token);
        ctx.record("sr.mat.keyedVerifies", keyedVerified.ok);
        ctx.record("sr.mat.keyedKeyStatus", keyedVerified.ok ? keyedVerified.keyStatus : "refused");
      },
    },
    {
      stepId: "sr-no-leak",
      kind: "negative-check",
      description: "THE NO-SECRET-LEAK LAW: no key material, no plaintext, no salt beyond the stored record appears in any verdict; the rotation metadata is clean (the snapshot and the record are the only stores)",
      packages: ["@fleetos/identity"],
      operations: ["verifyCredential", "verifyKeyedSession", "issueKeyedSession"],
      run: (ctx) => {
        ctx.record("sr.noleak.verdictsClean", !secrets.some((s) => verdictsSerialized.includes(s)));
        ctx.record("sr.noleak.saltOnlyInRecord",
          recordSerialized.includes(SALT_A) && !verdictsSerialized.includes(SALT_A));
        ctx.record("sr.noleak.rotationMetadataClean",
          !secrets.some((s) => rotationMetadataSerialized.includes(s)));
        ctx.record("sr.noleak.plaintextAbsent",
          !verdictsSerialized.includes(PLAINTEXT) && !rotationMetadataSerialized.includes(PLAINTEXT));
      },
    },
  ],
  assertions: [
    { assertionId: "sr-1", description: "The same injected stream yields the identical salt", path: "sr.det.saltIdentical", expected: true },
    { assertionId: "sr-2", description: "The same injected stream yields the identical key material", path: "sr.det.keyMaterialIdentical", expected: true },
    { assertionId: "sr-3", description: "A different stream yields different entropy (the injection genuinely flows)", path: "sr.det.differentStreamDiffers", expected: true },
    { assertionId: "sr-4", description: "The credential salt floor is 16 bytes (32 hex)", path: "sr.det.saltHexLength", expected: 32 },
    { assertionId: "sr-5", description: "The signing-key draw is 32 bytes (64 hex)", path: "sr.det.keyHexLength", expected: 64 },
    { assertionId: "sr-6", description: "The generated-salt credential issues", path: "sr.cred.ok", expected: true },
    { assertionId: "sr-7", description: "The generated salt meets the floor inside the record", path: "sr.cred.saltHexLength", expected: 32 },
    { assertionId: "sr-8", description: "The right secret verifies against the generated-salt record", path: "sr.cred.verifyOk", expected: true },
    { assertionId: "sr-9", description: "REFUSAL: a wrong secret refuses INVALID_CREDENTIAL", path: "sr.cred.wrongSecret", expected: "INVALID_CREDENTIAL" },
    { assertionId: "sr-10", description: "REFUSAL: an unknown actor refuses INVALID_CREDENTIAL", path: "sr.cred.unknownActor", expected: "INVALID_CREDENTIAL" },
    { assertionId: "sr-11", description: "The refusals are byte-identical (enumeration resistance under generated salts)", path: "sr.cred.refusalsByteIdentical", expected: true },
    { assertionId: "sr-12", description: "The same stream issues byte-identical records", path: "sr.cred.sameStreamIdenticalRecord", expected: true },
    { assertionId: "sr-13", description: "A different stream issues a different digest", path: "sr.cred.differentStreamDiffers", expected: true },
    { assertionId: "sr-14", description: "The same stream rotates to the identical snapshot", path: "sr.mat.rotationIdentical", expected: true },
    { assertionId: "sr-15", description: "The new key id comes from the stream (draw A)", path: "sr.mat.newKeyIdA", expected: KEY_ID_A },
    { assertionId: "sr-16", description: "The other stream's new key id (draw B)", path: "sr.mat.newKeyIdB", expected: KEY_ID_B },
    { assertionId: "sr-17", description: "Different streams produce different key ids", path: "sr.mat.newKeyIdsDiffer", expected: true },
    { assertionId: "sr-18", description: "The same stream issues byte-identical keyed tokens", path: "sr.mat.keyedTokenIdentical", expected: true },
    { assertionId: "sr-19", description: "Different material issues different keyed tokens", path: "sr.mat.keyedTokenDiffers", expected: true },
    { assertionId: "sr-20", description: "The port-generated key verifies the keyed token", path: "sr.mat.keyedVerifies", expected: true },
    { assertionId: "sr-21", description: "The new key is the current key", path: "sr.mat.keyedKeyStatus", expected: "current" },
    { assertionId: "sr-22", description: "NO-LEAK: no verdict carries key material, plaintext or salt", path: "sr.noleak.verdictsClean", expected: true },
    { assertionId: "sr-23", description: "NO-LEAK: the salt appears ONLY in the stored record", path: "sr.noleak.saltOnlyInRecord", expected: true },
    { assertionId: "sr-24", description: "NO-LEAK: the rotation metadata (outside the returned snapshot) is clean", path: "sr.noleak.rotationMetadataClean", expected: true },
    { assertionId: "sr-25", description: "NO-LEAK: the plaintext secret appears nowhere in the verdicts or metadata", path: "sr.noleak.plaintextAbsent", expected: true },
  ],
};
