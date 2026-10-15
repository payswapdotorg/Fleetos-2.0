/**
 * F370B session-revocation tests — the registry port + the in-memory
 * impl + both verify compositions, with the PRECEDENCE law (signature
 * and expiry precede revocation) asserted at the exact seams.
 */

import { describe, expect, it } from "vitest";
import { issueSignedSession } from "./session.js";
import type { SessionSigningKey } from "./session.js";
import { issueKeyedSession, keyringProviderFromData, rotateKeyring } from "./keyring.js";
import { deterministicSecureRandom } from "./secure-random.js";
import {
  InMemorySessionRevocationRegistry,
  verifyKeyedSessionWithRevocation,
  verifySessionWithRevocation,
} from "./session-revocation.js";

const KEY: SessionSigningKey = {
  algorithm: "HMAC-SHA256",
  secretHex: "33445566778899aabbccddeeff00112233445566778899aabbccddeeff001122",
};
const ACTOR = "act_analyst-rev-01";
const SIBLING_ACTOR = "act_analyst-rev-02";
const TENANT = "acme-ops";
const IAT = 1_791_830_400_000;
const EXP = IAT + 3_600_000;
const NOW = IAT + 1_000;
const REVOKE_AT = IAT + 2_000;
const JTI_A = "jti-rev-alpha-0001";
const JTI_B = "jti-rev-beta-0002";

function issue(overrides: Partial<Parameters<typeof issueSignedSession>[0]> = {}) {
  return issueSignedSession({
    actorId: ACTOR,
    tenantId: TENANT,
    scopes: ["marketplace.request"],
    issuedAt: IAT,
    expiresAt: EXP,
    key: KEY,
    ...overrides,
  });
}

describe("F370B InMemorySessionRevocationRegistry — the port laws", () => {
  it("revoke / isRevoked / revocationOf: membership + evidence", () => {
    const registry = new InMemorySessionRevocationRegistry();
    expect(registry.isRevoked(JTI_A)).toBe(false);
    expect(registry.revocationOf(JTI_A)).toBeNull();
    const record = registry.revoke(JTI_A, REVOKE_AT);
    expect(record).toEqual({ jti: JTI_A, revokedAt: REVOKE_AT });
    expect(registry.isRevoked(JTI_A)).toBe(true);
    expect(registry.revocationOf(JTI_A)).toEqual({ jti: JTI_A, revokedAt: REVOKE_AT });
  });

  it("revocation is MONOTONE and idempotent — the first record is retained", () => {
    const registry = new InMemorySessionRevocationRegistry();
    registry.revoke(JTI_A, REVOKE_AT);
    expect(registry.revoke(JTI_A, REVOKE_AT + 5_000)).toEqual({ jti: JTI_A, revokedAt: REVOKE_AT });
  });

  it("revokeActor / isActorRevoked / actorRevocationOf: the sweep", () => {
    const registry = new InMemorySessionRevocationRegistry();
    expect(registry.isActorRevoked(ACTOR)).toBe(false);
    expect(registry.revokeActor(ACTOR, REVOKE_AT)).toEqual({ actorId: ACTOR, revokedAt: REVOKE_AT });
    expect(registry.isActorRevoked(ACTOR)).toBe(true);
    expect(registry.isActorRevoked(SIBLING_ACTOR)).toBe(false);
    // Idempotent too.
    expect(registry.revokeActor(ACTOR, REVOKE_AT + 5_000)).toEqual({ actorId: ACTOR, revokedAt: REVOKE_AT });
  });
});

describe("F370B verifySessionWithRevocation — the composition + precedence laws", () => {
  it("a jti-carrying token verifies ok before revocation and refuses REVOKED after", () => {
    const registry = new InMemorySessionRevocationRegistry();
    const t = issue({ jti: JTI_A });
    if (!t.ok) throw new Error("fixture");
    expect(verifySessionWithRevocation(t.token, { key: KEY, registry, now: NOW })).toEqual({ ok: true, claims: t.claims });
    registry.revoke(JTI_A, REVOKE_AT);
    const refused = verifySessionWithRevocation(t.token, { key: KEY, registry, now: NOW });
    expect(refused).toEqual({ ok: false, reason: "REVOKED", cause: "jti" });
    if (!refused.ok) expect(refused.cause).toBe("jti");
  });

  it("the sibling token (different jti, same actor) stays valid after the jti revocation", () => {
    const registry = new InMemorySessionRevocationRegistry();
    const tA = issue({ jti: JTI_A });
    const tB = issue({ jti: JTI_B });
    if (!tA.ok || !tB.ok) throw new Error("fixture");
    registry.revoke(JTI_A, REVOKE_AT);
    expect(verifySessionWithRevocation(tA.token, { key: KEY, registry, now: NOW }).ok).toBe(false);
    expect(verifySessionWithRevocation(tB.token, { key: KEY, registry, now: NOW }).ok).toBe(true);
  });

  it("the actor-wide sweep revokes every token of the actor, both causes reported honestly", () => {
    const registry = new InMemorySessionRevocationRegistry();
    const tA = issue({ jti: JTI_A });
    const tB = issue({ jti: JTI_B });
    const tC = issue({ jti: "jti-rev-gamma-0003", actorId: SIBLING_ACTOR });
    if (!tA.ok || !tB.ok || !tC.ok) throw new Error("fixture");
    registry.revokeActor(ACTOR, REVOKE_AT);
    expect(verifySessionWithRevocation(tA.token, { key: KEY, registry, now: NOW })).toEqual({ ok: false, reason: "REVOKED", cause: "actor" });
    expect(verifySessionWithRevocation(tB.token, { key: KEY, registry, now: NOW })).toEqual({ ok: false, reason: "REVOKED", cause: "actor" });
    // A different actor's token is untouched by the sweep.
    expect(verifySessionWithRevocation(tC.token, { key: KEY, registry, now: NOW }).ok).toBe(true);
    // The most specific cause wins: a jti revocation is reported even when swept.
    registry.revoke(JTI_B, REVOKE_AT + 1_000);
    expect(verifySessionWithRevocation(tB.token, { key: KEY, registry, now: NOW })).toEqual({ ok: false, reason: "REVOKED", cause: "jti" });
  });

  it("PRECEDENCE: signature precedes revocation — a tampered token refuses SIGNATURE_INVALID even when revoked", () => {
    const registry = new InMemorySessionRevocationRegistry();
    const t = issue({ jti: JTI_A });
    if (!t.ok) throw new Error("fixture");
    registry.revoke(JTI_A, REVOKE_AT);
    const parts = t.token.split(".");
    const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as Record<string, unknown>;
    payload["tenantId"] = "globex-rival";
    const tampered = `fss1.${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}.${parts[2]}`;
    expect(verifySessionWithRevocation(tampered, { key: KEY, registry, now: NOW })).toEqual({ ok: false, reason: "SIGNATURE_INVALID" });
    // Wrong key: same law.
    expect(verifySessionWithRevocation(t.token, { key: { algorithm: "HMAC-SHA256", secretHex: "ff".repeat(32) }, registry, now: NOW })).toEqual({ ok: false, reason: "SIGNATURE_INVALID" });
  });

  it("PRECEDENCE: expiry precedes revocation — an expired token refuses SESSION_EXPIRED even when revoked", () => {
    const registry = new InMemorySessionRevocationRegistry();
    const t = issue({ jti: JTI_A, issuedAt: IAT - 10_000, expiresAt: IAT - 1_000 });
    if (!t.ok) throw new Error("fixture");
    registry.revoke(JTI_A, REVOKE_AT);
    expect(verifySessionWithRevocation(t.token, { key: KEY, registry, now: NOW })).toEqual({ ok: false, reason: "SESSION_EXPIRED" });
  });

  it("PRECEDENCE: malformed precedes revocation; JTI_MISSING is the fail-closed default", () => {
    const registry = new InMemorySessionRevocationRegistry();
    registry.revoke(JTI_A, REVOKE_AT);
    expect(verifySessionWithRevocation("garbage", { key: KEY, registry, now: NOW })).toEqual({ ok: false, reason: "MALFORMED_TOKEN" });
    expect(verifySessionWithRevocation(null, { key: KEY, registry, now: NOW })).toEqual({ ok: false, reason: "MALFORMED_TOKEN" });
    const noJti = issue();
    if (!noJti.ok) throw new Error("fixture");
    expect(verifySessionWithRevocation(noJti.token, { key: KEY, registry, now: NOW })).toEqual({ ok: false, reason: "JTI_MISSING" });
  });

  it("is TOTAL: type-confused inputs are typed refusals, never throws", () => {
    const registry = new InMemorySessionRevocationRegistry();
    expect(verifySessionWithRevocation(undefined, { key: KEY, registry, now: NOW })).toEqual({ ok: false, reason: "MALFORMED_TOKEN" });
    expect(verifySessionWithRevocation(42 as unknown as string, { key: KEY, registry, now: NOW })).toEqual({ ok: false, reason: "MALFORMED_TOKEN" });
  });
});

describe("F370B verifyKeyedSessionWithRevocation — the full-stack composition", () => {
  const K2_ID = "a1b2c3d4e5f60718";
  const K2_MATERIAL = "9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a0";
  const BASE = {
    currentKeyId: "pilot-k1",
    keys: [{ keyId: "pilot-k1", algorithm: "HMAC-SHA256" as const, secretHex: KEY.secretHex, retireAt: null }],
  };
  const ROTATE_AT = IAT + 60_000;
  const GRACE_MS = 600_000;
  const RETIRE_AT = ROTATE_AT + GRACE_MS;

  function rotatedFixture() {
    const rotation = rotateKeyring({ keyring: BASE, now: ROTATE_AT, verifyGraceMs: GRACE_MS, secureRandom: deterministicSecureRandom([K2_ID, K2_MATERIAL]) });
    if (!rotation.ok) throw new Error("fixture");
    return { provider: keyringProviderFromData(rotation.keyring), rotation };
  }

  it("a keyed jti-carrying token verifies ok, then REVOKED, with the key metadata preserved", () => {
    const registry = new InMemorySessionRevocationRegistry();
    const { provider } = rotatedFixture();
    const t = issueKeyedSession({ provider, actorId: ACTOR, tenantId: TENANT, scopes: ["marketplace.request"], issuedAt: IAT, expiresAt: EXP, jti: JTI_A });
    if (!t.ok) throw new Error("fixture");
    const ok = verifyKeyedSessionWithRevocation(t.token, { provider, registry, now: NOW });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.keyId).toBe(K2_ID);
      expect(ok.keyStatus).toBe("current");
    }
    registry.revoke(JTI_A, REVOKE_AT);
    expect(verifyKeyedSessionWithRevocation(t.token, { provider, registry, now: NOW })).toEqual({ ok: false, reason: "REVOKED", cause: "jti" });
  });

  it("PRECEDENCE across the whole stack: key retirement precedes revocation", () => {
    const registry = new InMemorySessionRevocationRegistry();
    const { provider } = rotatedFixture();
    // Issue under the OLD key (before rotation) — it is past retirement at RETIRE_AT+1.
    const oldProvider = keyringProviderFromData(BASE);
    const t = issueKeyedSession({ provider: oldProvider, actorId: ACTOR, tenantId: TENANT, scopes: ["marketplace.request"], issuedAt: IAT, expiresAt: EXP, jti: JTI_A });
    if (!t.ok) throw new Error("fixture");
    registry.revoke(JTI_A, REVOKE_AT);
    expect(verifyKeyedSessionWithRevocation(t.token, { provider, registry, now: RETIRE_AT + 1 })).toEqual({ ok: false, reason: "KEY_RETIRED" });
    // Still in grace: the revocation is the refusing verdict instead.
    expect(verifyKeyedSessionWithRevocation(t.token, { provider, registry, now: RETIRE_AT - 1 })).toEqual({ ok: false, reason: "REVOKED", cause: "jti" });
  });

  it("PRECEDENCE: keyed signature/expiry/JTI_MISSING precede the registry, verbatim", () => {
    const registry = new InMemorySessionRevocationRegistry();
    const { provider } = rotatedFixture();
    const t = issueKeyedSession({ provider, actorId: ACTOR, tenantId: TENANT, scopes: ["marketplace.request"], issuedAt: IAT, expiresAt: EXP, jti: JTI_A });
    const noJti = issueKeyedSession({ provider, actorId: ACTOR, tenantId: TENANT, scopes: ["marketplace.request"], issuedAt: IAT, expiresAt: EXP });
    if (!t.ok || !noJti.ok) throw new Error("fixture");
    registry.revoke(JTI_A, REVOKE_AT);
    // Expired + revoked => SESSION_EXPIRED.
    expect(verifyKeyedSessionWithRevocation(t.token, { provider, registry, now: EXP + 1 })).toEqual({ ok: false, reason: "SESSION_EXPIRED" });
    // Unknown key + revoked => KEY_UNKNOWN.
    expect(verifyKeyedSessionWithRevocation(`fsk1.ghost-k9.${t.token.split(".")[2]}.${t.token.split(".")[3]}`, { provider, registry, now: NOW })).toEqual({ ok: false, reason: "KEY_UNKNOWN" });
    // Malformed + revoked => MALFORMED_TOKEN.
    expect(verifyKeyedSessionWithRevocation("junk", { provider, registry, now: NOW })).toEqual({ ok: false, reason: "MALFORMED_TOKEN" });
    // No jti at all => JTI_MISSING (fail-closed).
    expect(verifyKeyedSessionWithRevocation(noJti.token, { provider, registry, now: NOW })).toEqual({ ok: false, reason: "JTI_MISSING" });
  });
});
