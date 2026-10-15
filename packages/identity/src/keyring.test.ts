/**
 * F370B keyring tests — the rotating keyring: issue under the current
 * key, verify by the carried key id (KEY_UNKNOWN / KEY_RETIRED /
 * verify-grace), the pure rotation through the SecureRandom port, the
 * labelled providers (fixture / file / env / data), and the no-leak
 * law (key material never in a verdict or refusal detail).
 */

import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FIXTURE_KEYRING_DATA,
  KEYRING_ENV_VARIABLE,
  envKeyringProvider,
  fileKeyringProvider,
  fixtureKeyringProvider,
  issueKeyedSession,
  keyringProviderFromData,
  parseKeyringJson,
  rotateKeyring,
  verifyKeyedSession,
} from "./keyring.js";
import { deterministicSecureRandom } from "./secure-random.js";
import { issueSignedSession } from "./session.js";

const K1_SECRET = "0b1f2e3d4c5b6a7988776655443322110b1f2e3d4c5b6a798877665544332211";
const K2_ID = "a1b2c3d4e5f60718";
const K2_MATERIAL = "9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a0";
const ROTATION_STREAM = [K2_ID, K2_MATERIAL];
const ACTOR = "act_sre-kr-01";
const TENANT = "acme-ops";
const IAT = 1_791_830_400_000;
const EXP = IAT + 3_600_000;
const ROTATE_AT = IAT + 60_000;
const GRACE_MS = 600_000;
const RETIRE_AT = ROTATE_AT + GRACE_MS;

const BASE: KeyringDataLike = FIXTURE_KEYRING_DATA;

type KeyringDataLike = typeof FIXTURE_KEYRING_DATA;

function issue(overrides: Partial<Parameters<typeof issueKeyedSession>[0]> = {}) {
  return issueKeyedSession({
    provider: keyringProviderFromData(BASE),
    actorId: ACTOR,
    tenantId: TENANT,
    scopes: ["marketplace.request", "marketplace.order"],
    issuedAt: IAT,
    expiresAt: EXP,
    ...overrides,
  });
}

describe("F370B issueKeyedSession — issue under the current key", () => {
  it("wraps the kernel token under the fsk1 envelope with the current key id", () => {
    const r = issue();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.token.split(".")).toHaveLength(4);
    expect(r.token.split(".")[0]).toBe("fsk1");
    expect(r.keyId).toBe("pilot-k1");
    expect(r.claims.actorId).toBe(ACTOR);
    // The inner token is byte-identical to a direct kernel issue.
    const direct = issueSignedSession({
      actorId: ACTOR,
      tenantId: TENANT,
      scopes: ["marketplace.request", "marketplace.order"],
      issuedAt: IAT,
      expiresAt: EXP,
      key: { algorithm: "HMAC-SHA256", secretHex: K1_SECRET },
    });
    if (!direct.ok) throw new Error("fixture");
    expect(r.token).toBe(`fsk1.pilot-k1.${direct.token.slice("fss1.".length)}`);
  });

  it("carries the jti through the keyed envelope", () => {
    const r = issue({ jti: "jti-kr-alpha-0001" });
    if (!r.ok) throw new Error("fixture");
    const v = verifyKeyedSession(r.token, { provider: keyringProviderFromData(BASE), now: IAT + 1_000 });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.claims.jti).toBe("jti-kr-alpha-0001");
  });

  it("REFUSAL: an empty keyring refuses no-current-key; claim refusals propagate verbatim", () => {
    const empty = keyringProviderFromData({ currentKeyId: "ghost", keys: [] });
    expect(issue({ provider: empty })).toEqual({ ok: false, reason: "no-current-key" });
    expect(issue({ actorId: "no-prefix" })).toEqual({ ok: false, reason: "malformed-actor-id" });
    // A host provider whose currentKeyId() names a key it cannot resolve:
    // the fail-closed unresolvable refusal (the port permits the inconsistency;
    // the in-memory provider never produces it — honest by construction).
    const unresolvable: import("./keyring.js").KeyringProvider = {
      source: "data",
      currentKeyId: () => "ghost",
      resolveKeyMaterial: () => null,
      listKeyIds: () => [],
    };
    expect(issue({ provider: unresolvable })).toEqual({ ok: false, reason: "current-key-unresolvable" });
  });

  it("is deterministic: the same snapshot re-issues the same keyed token", () => {
    const a = issue({ jti: "jti-kr-alpha-0001" });
    const b = issue({ jti: "jti-kr-alpha-0001" });
    if (a.ok && b.ok) expect(a.token).toBe(b.token);
  });
});

describe("F370B rotateKeyring — rotation through the SecureRandom port", () => {
  it("draws id then material, retires the old key with a grace window, keeps it in the snapshot", () => {
    const r = rotateKeyring({ keyring: BASE, now: ROTATE_AT, verifyGraceMs: GRACE_MS, secureRandom: deterministicSecureRandom(ROTATION_STREAM) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.newKeyId).toBe(K2_ID);
    expect(r.rotatedOutKeyId).toBe("pilot-k1");
    expect(r.retireAt).toBe(RETIRE_AT);
    expect(r.keyring.currentKeyId).toBe(K2_ID);
    const oldKey = r.keyring.keys.find((k) => k.keyId === "pilot-k1");
    expect(oldKey?.retireAt).toBe(RETIRE_AT);
    expect(r.keyring.keys.find((k) => k.keyId === K2_ID)?.retireAt).toBeNull();
    // RETAINED, never deleted (KEY_RETIRED must not decay into KEY_UNKNOWN).
    expect(r.keyring.keys).toHaveLength(2);
  });

  it("issues under the NEW current key after rotation and verifies both tokens", () => {
    const rotated = rotateKeyring({ keyring: BASE, now: ROTATE_AT, verifyGraceMs: GRACE_MS, secureRandom: deterministicSecureRandom(ROTATION_STREAM) });
    if (!rotated.ok) throw new Error("fixture");
    const provider = keyringProviderFromData(rotated.keyring);
    const t1 = issue({ provider: keyringProviderFromData(BASE), jti: "jti-kr-old-0001" });
    const t2 = issue({ provider, jti: "jti-kr-new-0002" });
    if (!t1.ok || !t2.ok) throw new Error("fixture");
    expect(t1.keyId).toBe("pilot-k1");
    expect(t2.keyId).toBe(K2_ID);
    // In-grace: the k1 token verifies with keyStatus verify-grace.
    const v1 = verifyKeyedSession(t1.token, { provider, now: RETIRE_AT - 1 });
    expect(v1.ok).toBe(true);
    if (v1.ok) {
      expect(v1.keyStatus).toBe("verify-grace");
      expect(v1.keyId).toBe("pilot-k1");
    }
    // The boundary instant itself still verifies (inclusive grace).
    expect(verifyKeyedSession(t1.token, { provider, now: RETIRE_AT }).ok).toBe(true);
    // Past the retire-at: KEY_RETIRED.
    expect(verifyKeyedSession(t1.token, { provider, now: RETIRE_AT + 1 })).toEqual({ ok: false, reason: "KEY_RETIRED" });
    // The new key's token verifies as current.
    const v2 = verifyKeyedSession(t2.token, { provider, now: RETIRE_AT + 1 });
    expect(v2.ok).toBe(true);
    if (v2.ok) expect(v2.keyStatus).toBe("current");
  });

  it("deterministic-under-injection: the same stream rotates to the same snapshot", () => {
    const a = rotateKeyring({ keyring: BASE, now: ROTATE_AT, verifyGraceMs: GRACE_MS, secureRandom: deterministicSecureRandom(ROTATION_STREAM) });
    const b = rotateKeyring({ keyring: BASE, now: ROTATE_AT, verifyGraceMs: GRACE_MS, secureRandom: deterministicSecureRandom(ROTATION_STREAM) });
    if (!a.ok || !b.ok) throw new Error("fixture");
    expect(JSON.stringify(a.keyring)).toBe(JSON.stringify(b.keyring));
  });

  it("REFUSAL: the rotation validates grace, current key, id collision and material", () => {
    const refusalOf = (r: ReturnType<typeof rotateKeyring>): string => {
      if (r.ok) throw new Error("expected refusal");
      return r.reason;
    };
    expect(refusalOf(rotateKeyring({ keyring: BASE, now: ROTATE_AT, verifyGraceMs: 0, secureRandom: deterministicSecureRandom(ROTATION_STREAM) }))).toBe("invalid-grace-window");
    const noCurrent = { currentKeyId: "ghost", keys: [] };
    expect(refusalOf(rotateKeyring({ keyring: noCurrent, now: ROTATE_AT, verifyGraceMs: GRACE_MS, secureRandom: deterministicSecureRandom(ROTATION_STREAM) }))).toBe("no-current-key");
    // The generated (hex) id collides with a key already in the snapshot.
    const hexIdBase = {
      currentKeyId: "a1b2c3d4e5f60718",
      keys: [{ keyId: "a1b2c3d4e5f60718", algorithm: "HMAC-SHA256" as const, secretHex: K1_SECRET, retireAt: null }],
    };
    const collision = rotateKeyring({ keyring: hexIdBase, now: ROTATE_AT, verifyGraceMs: GRACE_MS, secureRandom: deterministicSecureRandom(["a1b2c3d4e5f60718", K2_MATERIAL]) });
    expect(refusalOf(collision)).toBe("key-id-collision");
  });

  it("double rotation retires the second current key and retains the first's deadline", () => {
    const first = rotateKeyring({ keyring: BASE, now: ROTATE_AT, verifyGraceMs: GRACE_MS, secureRandom: deterministicSecureRandom(ROTATION_STREAM) });
    if (!first.ok) throw new Error("fixture");
    const K3_ID = "1122334455667788";
    const second = rotateKeyring({ keyring: first.keyring, now: RETIRE_AT, verifyGraceMs: GRACE_MS, secureRandom: deterministicSecureRandom([K3_ID, K2_MATERIAL]) });
    if (!second.ok) throw new Error("fixture");
    expect(second.rotatedOutKeyId).toBe(K2_ID);
    expect(second.retireAt).toBe(RETIRE_AT + GRACE_MS);
    // pilot-k1's original deadline is untouched.
    expect(second.keyring.keys.find((k) => k.keyId === "pilot-k1")?.retireAt).toBe(RETIRE_AT);
    expect(second.keyring.keys).toHaveLength(3);
  });
});

describe("F370B verifyKeyedSession — the refusal laws + totality", () => {
  it("REFUSAL: an unknown key id refuses KEY_UNKNOWN (the token is otherwise intact)", () => {
    const r = issue();
    if (!r.ok) throw new Error("fixture");
    const parts = r.token.split(".");
    const ghostToken = `fsk1.ghost-k9.${parts[2]}.${parts[3]}`;
    expect(verifyKeyedSession(ghostToken, { provider: keyringProviderFromData(BASE), now: IAT })).toEqual({ ok: false, reason: "KEY_UNKNOWN" });
  });

  it("REFUSAL: a wrong-material keyring (same id, different secret) refuses SIGNATURE_INVALID", () => {
    const r = issue();
    if (!r.ok) throw new Error("fixture");
    const wrongMaterial = keyringProviderFromData({
      currentKeyId: "pilot-k1",
      keys: [{ keyId: "pilot-k1", algorithm: "HMAC-SHA256", secretHex: "ff".repeat(32), retireAt: null }],
    });
    expect(verifyKeyedSession(r.token, { provider: wrongMaterial, now: IAT })).toEqual({ ok: false, reason: "SIGNATURE_INVALID" });
  });

  it("REFUSAL: tampered payload / flipped signature / expired window refuse via the kernel verdicts", () => {
    const r = issue({ jti: "jti-kr-alpha-0001" });
    if (!r.ok) throw new Error("fixture");
    const provider = keyringProviderFromData(BASE);
    const parts = r.token.split(".");
    const payload = JSON.parse(Buffer.from(parts[2]!, "base64url").toString("utf8")) as Record<string, unknown>;
    payload["tenantId"] = "globex-rival";
    const tampered = `fsk1.${parts[1]}.${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}.${parts[3]}`;
    expect(verifyKeyedSession(tampered, { provider, now: IAT })).toEqual({ ok: false, reason: "SIGNATURE_INVALID" });
    const flipped = parts[3]!.startsWith("A") ? `B${parts[3]!.slice(1)}` : `A${parts[3]!.slice(1)}`;
    expect(verifyKeyedSession(`fsk1.${parts[1]}.${parts[2]}.${flipped}`, { provider, now: IAT })).toEqual({ ok: false, reason: "SIGNATURE_INVALID" });
    expect(verifyKeyedSession(r.token, { provider, now: EXP + 1 })).toEqual({ ok: false, reason: "SESSION_EXPIRED" });
  });

  it("REFUSAL: malformed envelopes refuse MALFORMED_TOKEN (never throws)", () => {
    const provider = keyringProviderFromData(BASE);
    for (const candidate of [
      "",
      "not-a-token",
      "fss1.aaa.bbb",
      "fsk1",
      "fsk1.",
      "fsk1..aa.bb",
      "fsk2.pilot-k1.aa.bb",
      `fsk1.bad kid.${"aa"}.${"bb"}`,
      `fsk1.pilot-k1..bb`,
    ]) {
      expect(verifyKeyedSession(candidate, { provider, now: IAT })).toEqual({ ok: false, reason: "MALFORMED_TOKEN" });
    }
    expect(verifyKeyedSession(null, { provider, now: IAT })).toEqual({ ok: false, reason: "MALFORMED_TOKEN" });
    expect(verifyKeyedSession(undefined, { provider, now: IAT })).toEqual({ ok: false, reason: "MALFORMED_TOKEN" });
  });

  it("the NO-LEAK law: no verdict or refusal detail carries key material", () => {
    const rotated = rotateKeyring({ keyring: BASE, now: ROTATE_AT, verifyGraceMs: GRACE_MS, secureRandom: deterministicSecureRandom(ROTATION_STREAM) });
    if (!rotated.ok) throw new Error("fixture");
    const provider = keyringProviderFromData(rotated.keyring);
    const r = issue({ provider });
    if (!r.ok) throw new Error("fixture");
    const verdicts = [
      verifyKeyedSession(r.token, { provider, now: IAT }),
      verifyKeyedSession(r.token, { provider: keyringProviderFromData(BASE), now: IAT }),
      verifyKeyedSession("fsk1.ghost-k9.aa.bb", { provider, now: IAT }),
      verifyKeyedSession(r.token, { provider, now: RETIRE_AT + 1 }),
      verifyKeyedSession(r.token, { provider, now: EXP + 1 }),
    ];
    const serialized = JSON.stringify(verdicts);
    expect(serialized.includes(K1_SECRET)).toBe(false);
    expect(serialized.includes(K2_MATERIAL)).toBe(false);
  });
});

describe("F370B keyring providers — labelled, configuration-class", () => {
  it("the fixture provider is plainly labelled and resolves the pilot key", () => {
    const provider = fixtureKeyringProvider();
    expect(provider.source).toBe("fixture");
    expect(provider.currentKeyId()).toBe("pilot-k1");
    expect(provider.listKeyIds()).toEqual(["pilot-k1"]);
    expect(provider.resolveKeyMaterial("pilot-k1")?.secretHex).toBe(K1_SECRET);
    expect(provider.resolveKeyMaterial("ghost")).toBeNull();
  });

  it("parseKeyringJson accepts a well-formed snapshot and refuses malformed ones without echoing content", () => {
    const good = parseKeyringJson(
      JSON.stringify({ currentKeyId: "ops-2026-a", keys: [{ keyId: "ops-2026-a", algorithm: "HMAC-SHA256", secretHex: K2_MATERIAL, retireAt: null }] }),
    );
    expect(good.ok).toBe(true);
    const hostile = "}{ this is not json ";
    for (const bad of [
      hostile,
      "null",
      "[]",
      JSON.stringify({ keys: [] }),
      JSON.stringify({ currentKeyId: "ops", keys: "nope" }),
      JSON.stringify({ currentKeyId: "bad id", keys: [{ keyId: "bad id", algorithm: "HMAC-SHA256", secretHex: K2_MATERIAL, retireAt: null }] }),
      JSON.stringify({ currentKeyId: "ops-2026-a", keys: [{ keyId: "ops-2026-a", algorithm: "HMAC-MD5", secretHex: K2_MATERIAL, retireAt: null }] }),
      JSON.stringify({ currentKeyId: "ops-2026-a", keys: [{ keyId: "ops-2026-a", algorithm: "HMAC-SHA256", secretHex: "xyz", retireAt: null }] }),
      JSON.stringify({ currentKeyId: "ops-2026-a", keys: [{ keyId: "ops-2026-a", algorithm: "HMAC-SHA256", secretHex: K2_MATERIAL, retireAt: -5 }] }),
      JSON.stringify({ currentKeyId: "ops-2026-a", keys: [{ keyId: "a", algorithm: "HMAC-SHA256", secretHex: K2_MATERIAL, retireAt: null }, { keyId: "a", algorithm: "HMAC-SHA256", secretHex: K2_MATERIAL, retireAt: null }] }),
      JSON.stringify({ currentKeyId: "ghost", keys: [{ keyId: "ops-2026-a", algorithm: "HMAC-SHA256", secretHex: K2_MATERIAL, retireAt: null }] }),
    ]) {
      const r = parseKeyringJson(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.detail.includes(hostile)).toBe(false);
    }
  });

  it("the file provider loads a host-supplied snapshot and never echoes contents", () => {
    const dir = mkdtempSync(join(tmpdir(), "f370b-keyring-"));
    try {
      const path = join(dir, "keyring.json");
      writeFileSync(path, JSON.stringify({ currentKeyId: "ops-2026-a", keys: [{ keyId: "ops-2026-a", algorithm: "HMAC-SHA256", secretHex: K2_MATERIAL, retireAt: null }] }));
      const loaded = fileKeyringProvider({ path });
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) return;
      expect(loaded.provider?.source).toBe("file");
      expect(loaded.provider?.currentKeyId()).toBe("ops-2026-a");
      const missing = fileKeyringProvider({ path: join(dir, "absent.json") });
      expect(missing.ok).toBe(false);
      if (!missing.ok) expect(missing.detail.includes(K2_MATERIAL)).toBe(false);
      writeFileSync(join(dir, "bad.json"), "}{ not json");
      const bad = fileKeyringProvider({ path: join(dir, "bad.json") });
      expect(bad.ok).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the env provider loads an injected snapshot (deterministic-under-injection)", () => {
    const snapshot = JSON.stringify({ currentKeyId: "ops-2026-b", keys: [{ keyId: "ops-2026-b", algorithm: "HMAC-SHA256", secretHex: K2_MATERIAL, retireAt: 1_791_840_000_000 }] });
    const loaded = envKeyringProvider({ env: { [KEYRING_ENV_VARIABLE]: snapshot } });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.provider?.source).toBe("env");
    expect(loaded.provider?.resolveKeyMaterial("ops-2026-b")?.retireAt).toBe(1_791_840_000_000);
    const missing = envKeyringProvider({ env: {} });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.detail.includes(snapshot)).toBe(false);
    const custom = envKeyringProvider({ variable: "OTHER_KEYRING", env: { OTHER_KEYRING: snapshot } });
    expect(custom.ok).toBe(true);
  });
});
