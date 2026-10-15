/**
 * F370B SecureRandom tests — the host-boundary randomness port: the
 * deterministic fixed-stream impl (fail-loud laws), the generated-salt
 * credential composition (the F370A kernel unchanged), and the
 * deterministic-under-injection law.
 */

import { describe, expect, it } from "vitest";
import {
  CREDENTIAL_SALT_BYTES,
  SIGNING_KEY_BYTES,
  deterministicSecureRandom,
  generateSigningKey,
  issueCredentialWithGeneratedSalt,
} from "./secure-random.js";
import { verifyCredential } from "./credentials.js";

const ACTOR = "act_auditor-sr-01";
const TENANT = "acme-ops";
const SECRET = "f370b-plaintext-secret-fixture";

describe("F370B deterministicSecureRandom — the fixed-stream laws", () => {
  it("consumes the stream in order and returns the draws verbatim", () => {
    const rng = deterministicSecureRandom([
      "00112233445566778899aabbccddeeff",
      "ffeeddccbbaa99887766554433221100",
    ]);
    expect(rng.credentialSalt()).toBe("00112233445566778899aabbccddeeff");
    expect(rng.randomHex(16)).toBe("ffeeddccbbaa99887766554433221100");
  });

  it("same stream => identical draw chain (deterministic-under-injection)", () => {
    const stream = ["a1b2c3d4e5f60718293a4b5c6d7e8f90", "0f1e2d3c4b5a69788796a5b4c3d2e1f0"];
    const a = deterministicSecureRandom(stream);
    const b = deterministicSecureRandom(stream);
    expect([a.credentialSalt(), a.randomHex(16)]).toEqual([b.credentialSalt(), b.randomHex(16)]);
  });

  it("a different stream => different material (the injection genuinely flows)", () => {
    const a = deterministicSecureRandom(["11111111111111111111111111111111"]);
    const b = deterministicSecureRandom(["22222222222222222222222222222222"]);
    expect(a.credentialSalt()).not.toBe(b.credentialSalt());
  });

  it("FAILS LOUD on stream exhaustion — never a silent repeat", () => {
    const rng = deterministicSecureRandom(["00112233445566778899aabbccddeeff"]);
    expect(rng.credentialSalt()).toBe("00112233445566778899aabbccddeeff");
    expect(() => rng.credentialSalt()).toThrow(/exhausted/);
  });

  it("FAILS LOUD on a non-hex or wrong-length draw", () => {
    expect(() => deterministicSecureRandom(["not-hex"]).credentialSalt()).toThrow(/not a hex string/);
    expect(() => deterministicSecureRandom(["abcd"]).credentialSalt()).toThrow(/bytes, expected/);
  });

  it("FAILS LOUD on a non-positive byte count", () => {
    const rng = deterministicSecureRandom(["00112233445566778899aabbccddeeff"]);
    expect(() => rng.randomHex(0)).toThrow(/positive byte count/);
  });

  it("the salt floor is 16 bytes and the signing key draw is 32 bytes", () => {
    expect(CREDENTIAL_SALT_BYTES).toBe(16);
    expect(SIGNING_KEY_BYTES).toBe(32);
    const rng = deterministicSecureRandom([
      "00112233445566778899aabbccddeeff",
      "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
    ]);
    expect(rng.credentialSalt()).toHaveLength(32);
    expect(generateSigningKey(rng)).toEqual({
      algorithm: "HMAC-SHA256",
      secretHex: "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
    });
  });
});

describe("F370B issueCredentialWithGeneratedSalt — the composition laws", () => {
  it("generates the salt through the port and verifies against the record", () => {
    const rng = deterministicSecureRandom(["0f1e2d3c4b5a69788796a5b4c3d2e1f0"]);
    const issued = issueCredentialWithGeneratedSalt({
      credentialId: "cred-f370b-sr-01",
      actorId: ACTOR,
      tenantId: TENANT,
      kind: "human",
      secret: SECRET,
      secureRandom: rng,
    });
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;
    // The stored record carries the generated salt (the ONLY place it lands).
    expect(issued.record.saltHex).toBe("0f1e2d3c4b5a69788796a5b4c3d2e1f0");
    expect(verifyCredential({ presentedSecret: SECRET, record: issued.record })).toEqual({
      ok: true,
      actorId: ACTOR,
      tenantId: TENANT,
    });
  });

  it("enumeration resistance HOLDS under generated salts (byte-identical refusals)", () => {
    const rng = deterministicSecureRandom([
      "0f1e2d3c4b5a69788796a5b4c3d2e1f0",
      "11111111111111111111111111111111",
    ]);
    const issued = issueCredentialWithGeneratedSalt({
      credentialId: "cred-f370b-sr-01",
      actorId: ACTOR,
      tenantId: TENANT,
      kind: "service",
      secret: SECRET,
      secureRandom: rng,
    });
    if (!issued.ok) throw new Error("fixture");
    const wrongSecret = verifyCredential({ presentedSecret: "wrong-secret", record: issued.record });
    const unknownActor = verifyCredential({ presentedSecret: "wrong-secret", record: null });
    expect(wrongSecret).toEqual({ ok: false, reason: "INVALID_CREDENTIAL" });
    expect(unknownActor).toEqual({ ok: false, reason: "INVALID_CREDENTIAL" });
    expect(JSON.stringify(wrongSecret)).toBe(JSON.stringify(unknownActor));
  });

  it("the same injected stream => byte-identical records (deterministic-under-injection)", () => {
    const issue = () =>
      issueCredentialWithGeneratedSalt({
        credentialId: "cred-f370b-sr-01",
        actorId: ACTOR,
        tenantId: TENANT,
        kind: "human",
        secret: SECRET,
        secureRandom: deterministicSecureRandom(["a1b2c3d4e5f60718293a4b5c6d7e8f90"]),
      });
    const a = issue();
    const b = issue();
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(JSON.stringify(a.record)).toBe(JSON.stringify(b.record));
  });

  it("a different injected stream => a different record (same plaintext)", () => {
    const issue = (salt: string) =>
      issueCredentialWithGeneratedSalt({
        credentialId: "cred-f370b-sr-01",
        actorId: ACTOR,
        tenantId: TENANT,
        kind: "human",
        secret: SECRET,
        secureRandom: deterministicSecureRandom([salt]),
      });
    const a = issue("a1b2c3d4e5f60718293a4b5c6d7e8f90");
    const b = issue("0f1e2d3c4b5a69788796a5b4c3d2e1f0");
    if (a.ok && b.ok) expect(a.record.digestHex).not.toBe(b.record.digestHex);
  });

  it("propagates the kernel's refusal codes verbatim (no re-mapping)", () => {
    const rng = deterministicSecureRandom(["0f1e2d3c4b5a69788796a5b4c3d2e1f0"]);
    expect(
      issueCredentialWithGeneratedSalt({
        credentialId: "cred-f370b-sr-01",
        actorId: "no-prefix",
        tenantId: TENANT,
        kind: "human",
        secret: SECRET,
        secureRandom: rng,
      }),
    ).toEqual({ ok: false, reason: "malformed-actor-id" });
  });
});
