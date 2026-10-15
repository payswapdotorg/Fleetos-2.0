/**
 * F370A signed-session tests — HMAC-SHA256 issuance/verification over the
 * frozen claims, with the tamper / expiry / wrong-key / malformed
 * refusal laws and the TOTALITY law (verify never throws).
 */

import { describe, expect, it } from "vitest";
import {
  issueSignedSession,
  verifySignedSession,
  type SessionSigningKey,
} from "./session.js";

const KEY: SessionSigningKey = { algorithm: "HMAC-SHA256", secretHex: "0011223344556677889900aabbccddeeff00112233445566778899aabbccddee" };
const OTHER_KEY: SessionSigningKey = { algorithm: "HMAC-SHA256", secretHex: "ffeeddccbbaa0099887766554433221100ffeeddccbbaa00998877665544332211" };
const ACTOR = "act_operator-ama-01";
const TENANT = "acme-ops";
const IAT = 1_791_830_400_000;
const EXP = IAT + 3_600_000;

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

describe("F370A issueSignedSession", () => {
  it("issues a versioned three-part token with canonicalized scopes", () => {
    const r = issue();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.token.startsWith("fss1.")).toBe(true);
    expect(r.token.split(".")).toHaveLength(3);
    expect(r.claims.actorId).toBe(ACTOR);
    expect(r.claims.tenantId).toBe(TENANT);
    expect(r.claims.scopes).toEqual([
      "marketplace.offer",
      "marketplace.order",
      "marketplace.request",
    ]);
  });

  it("deduplicates scopes at issue time (the signed bytes are canonical)", () => {
    const a = issue({ scopes: ["marketplace.order", "marketplace.request", "marketplace.order"] });
    const b = issue({ scopes: ["marketplace.request", "marketplace.order"] });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.token).toBe(b.token);
  });

  it("is deterministic: the same inputs (incl. key) re-issue the same token", () => {
    const a = issue();
    const b = issue();
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.token).toBe(b.token);
  });

  it("a different key issues a different token", () => {
    const a = issue();
    const b = issue({ key: OTHER_KEY });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.token).not.toBe(b.token);
  });

  it("refuses malformed issuance inputs fail-closed", () => {
    const refusalOf = (overrides: Partial<Parameters<typeof issueSignedSession>[0]>): string => {
      const r = issue(overrides);
      if (r.ok) throw new Error(`expected refusal, got token ${r.token}`);
      return r.reason;
    };
    expect(refusalOf({ actorId: "no-prefix-actor" })).toBe("malformed-actor-id");
    expect(refusalOf({ actorId: "" })).toBe("missing-actor-id");
    expect(refusalOf({ tenantId: "" })).toBe("missing-tenant-id");
    expect(refusalOf({ tenantId: "bad tenant" })).toBe("malformed-tenant-id");
    expect(refusalOf({ scopes: ["marketplace.nonsense" as "marketplace.order"] })).toBe("malformed-scope");
    expect(refusalOf({ issuedAt: 0 })).toBe("invalid-issued-at");
    expect(refusalOf({ issuedAt: Number.NaN })).toBe("invalid-issued-at");
    expect(refusalOf({ expiresAt: IAT })).toBe("invalid-expiry");
    expect(refusalOf({ expiresAt: IAT - 1 })).toBe("invalid-expiry");
    expect(refusalOf({ key: { algorithm: "HMAC-SHA256", secretHex: "not-hex" } })).toBe("key-invalid");
    expect(refusalOf({ key: { algorithm: "HMAC-MD5" as "HMAC-SHA256", secretHex: KEY.secretHex } })).toBe("key-invalid");
  });
});

describe("F370A verifySignedSession — the refusal laws + totality", () => {
  it("verifies a genuine token and returns the frozen claims", () => {
    const token = issue();
    if (!token.ok) throw new Error("fixture");
    const v = verifySignedSession(token.token, { key: KEY, now: IAT + 1_000 });
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.claims.actorId).toBe(ACTOR);
      expect(v.claims.tenantId).toBe(TENANT);
      expect(v.claims.scopes).toEqual(["marketplace.offer", "marketplace.order", "marketplace.request"]);
      expect(v.claims.issuedAt).toBe(IAT);
      expect(v.claims.expiresAt).toBe(EXP);
    }
  });

  it("REFUSAL: a mutated payload claim (tamper) refuses SIGNATURE_INVALID", () => {
    const token = issue();
    if (!token.ok) throw new Error("fixture");
    const parts = token.token.split(".");
    const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as Record<string, unknown>;
    payload["tenantId"] = "globex-rival"; // the classic cross-tenant forgery
    const forged = `fss1.${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}.${parts[2]}`;
    expect(verifySignedSession(forged, { key: KEY, now: IAT + 1_000 })).toEqual({
      ok: false,
      reason: "SIGNATURE_INVALID",
    });
  });

  it("REFUSAL: a single flipped signature character refuses SIGNATURE_INVALID", () => {
    const token = issue();
    if (!token.ok) throw new Error("fixture");
    const parts = token.token.split(".");
    const flipped = parts[2]!.startsWith("A") ? `B${parts[2]!.slice(1)}` : `A${parts[2]!.slice(1)}`;
    const tampered = `fss1.${parts[1]}.${flipped}`;
    expect(verifySignedSession(tampered, { key: KEY, now: IAT + 1_000 })).toEqual({
      ok: false,
      reason: "SIGNATURE_INVALID",
    });
  });

  it("REFUSAL: a WRONG KEY refuses SIGNATURE_INVALID (indistinguishable from tamper)", () => {
    const token = issue();
    if (!token.ok) throw new Error("fixture");
    expect(verifySignedSession(token.token, { key: OTHER_KEY, now: IAT + 1_000 })).toEqual({
      ok: false,
      reason: "SIGNATURE_INVALID",
    });
  });

  it("REFUSAL: an expired window refuses SESSION_EXPIRED (boundary inclusive)", () => {
    const token = issue();
    if (!token.ok) throw new Error("fixture");
    expect(verifySignedSession(token.token, { key: KEY, now: EXP }).ok).toBe(true);
    expect(verifySignedSession(token.token, { key: KEY, now: EXP + 1 })).toEqual({
      ok: false,
      reason: "SESSION_EXPIRED",
    });
  });

  it("REFUSAL: malformed envelopes refuse MALFORMED_TOKEN (never throw)", () => {
    const now = IAT + 1_000;
    const adversarial = [
      "",
      "not-a-token",
      "fss1",
      "fss1.",
      "fss1..",
      "fss1...",
      "fss2.aaa.bbb",
      `fss1.${Buffer.from("not json", "utf8").toString("base64url")}.aaaa`,
      `fss1.${Buffer.from("{}", "utf8").toString("base64url")}.aaaa`,
      `fss1.${Buffer.from(JSON.stringify({ v: 2, actorId: ACTOR, tenantId: TENANT, scopes: [], issuedAt: IAT, expiresAt: EXP }), "utf8").toString("base64url")}.aaaa`,
      `fss1.${Buffer.from(JSON.stringify({ v: 1, actorId: "no-prefix", tenantId: TENANT, scopes: [], issuedAt: IAT, expiresAt: EXP }), "utf8").toString("base64url")}.aaaa`,
      `fss1.${Buffer.from(JSON.stringify({ v: 1, actorId: ACTOR, tenantId: "bad tenant", scopes: [], issuedAt: IAT, expiresAt: EXP }), "utf8").toString("base64url")}.aaaa`,
      `fss1.${Buffer.from(JSON.stringify({ v: 1, actorId: ACTOR, tenantId: TENANT, scopes: ["marketplace.nope"], issuedAt: IAT, expiresAt: EXP }), "utf8").toString("base64url")}.aaaa`,
      `fss1.${Buffer.from(JSON.stringify({ v: 1, actorId: ACTOR, tenantId: TENANT, scopes: [], issuedAt: IAT, expiresAt: IAT }), "utf8").toString("base64url")}.aaaa`,
    ];
    for (const token of adversarial) {
      expect(verifySignedSession(token, { key: KEY, now })).toEqual({
        ok: false,
        reason: "MALFORMED_TOKEN",
      });
    }
    // A well-formed envelope with a WRONG-LENGTH signature refuses at the
    // signature comparison (SIGNATURE_INVALID — still never a throw).
    const shortSig = `fss1.${Buffer.from(JSON.stringify({ v: 1, actorId: ACTOR, tenantId: TENANT, scopes: [], issuedAt: IAT, expiresAt: EXP }), "utf8").toString("base64url")}.${Buffer.from("short", "utf8").toString("base64url")}`;
    expect(verifySignedSession(shortSig, { key: KEY, now })).toEqual({
      ok: false,
      reason: "SIGNATURE_INVALID",
    });
  });

  it("REFUSAL: an unusable key refuses KEY_INVALID without touching the token", () => {
    const token = issue();
    if (!token.ok) throw new Error("fixture");
    expect(verifySignedSession(token.token, { key: { algorithm: "HMAC-SHA256", secretHex: "xyz" }, now: IAT })).toEqual({
      ok: false,
      reason: "KEY_INVALID",
    });
  });

  it("is TOTAL: null/undefined/typed-wrong tokens are typed refusals, never throws", () => {
    expect(verifySignedSession(null, { key: KEY, now: IAT })).toEqual({ ok: false, reason: "MALFORMED_TOKEN" });
    expect(verifySignedSession(undefined, { key: KEY, now: IAT })).toEqual({ ok: false, reason: "MALFORMED_TOKEN" });
    expect(verifySignedSession(42 as unknown as string, { key: KEY, now: IAT })).toEqual({
      ok: false,
      reason: "MALFORMED_TOKEN",
    });
  });
});

describe("F370B — the sanctioned grow-only jti claim extension", () => {
  const JTI = "jti-f370b-alpha-0001";

  it("GROW-ONLY: jti-less tokens keep the exact frozen F370A canonical field order", () => {
    const r = issue();
    if (!r.ok) throw new Error("fixture");
    const payload = JSON.parse(Buffer.from(r.token.split(".")[1]!, "base64url").toString("utf8")) as Record<string, unknown>;
    // The F370A frozen order, unchanged — the grow-only law as a machine pin.
    expect(Object.keys(payload)).toEqual(["v", "actorId", "tenantId", "scopes", "issuedAt", "expiresAt"]);
  });

  it("issues with a jti and verifies it back (the claim round-trips)", () => {
    const r = issue({ jti: JTI });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.claims.jti).toBe(JTI);
    const payload = JSON.parse(Buffer.from(r.token.split(".")[1]!, "base64url").toString("utf8")) as Record<string, unknown>;
    // jti joins the canonical form LAST (the frozen F370B slot).
    expect(Object.keys(payload)).toEqual(["v", "actorId", "tenantId", "scopes", "issuedAt", "expiresAt", "jti"]);
    const v = verifySignedSession(r.token, { key: KEY, now: IAT + 1_000 });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.claims.jti).toBe(JTI);
  });

  it("the jti changes the signed bytes; a mutated jti refuses SIGNATURE_INVALID", () => {
    const withJti = issue({ jti: JTI });
    const withoutJti = issue();
    if (!withJti.ok || !withoutJti.ok) throw new Error("fixture");
    expect(withJti.token).not.toBe(withoutJti.token);
    const parts = withJti.token.split(".");
    const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as Record<string, unknown>;
    payload["jti"] = "jti-forged-9999";
    const forged = `fss1.${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}.${parts[2]}`;
    expect(verifySignedSession(forged, { key: KEY, now: IAT + 1_000 })).toEqual({
      ok: false,
      reason: "SIGNATURE_INVALID",
    });
  });

  it("REFUSAL: a malformed jti refuses issuance fail-closed (never silently dropped)", () => {
    expect(issue({ jti: "" }).ok).toBe(false);
    expect(issue({ jti: "bad jti!" })).toEqual({ ok: false, reason: "malformed-jti" });
    expect(issue({ jti: "x".repeat(129) }).ok).toBe(false);
    const tooLong = issue({ jti: "x".repeat(128) });
    expect(tooLong.ok).toBe(true);
  });

  it("REFUSAL: a well-formed envelope carrying a malformed jti refuses MALFORMED_TOKEN", () => {
    const payload = Buffer.from(
      JSON.stringify({ v: 1, actorId: ACTOR, tenantId: TENANT, scopes: [], issuedAt: IAT, expiresAt: EXP, jti: "bad jti!" }),
      "utf8",
    ).toString("base64url");
    expect(verifySignedSession(`fss1.${payload}.aaaa`, { key: KEY, now: IAT })).toEqual({
      ok: false,
      reason: "MALFORMED_TOKEN",
    });
  });

  it("is deterministic: the same jti re-issues the same token", () => {
    const a = issue({ jti: JTI });
    const b = issue({ jti: JTI });
    if (a.ok && b.ok) expect(a.token).toBe(b.token);
  });
});
