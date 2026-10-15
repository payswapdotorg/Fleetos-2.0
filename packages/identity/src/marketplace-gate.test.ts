/**
 * F370A marketplace-gate tests — the fail-closed authorization gate over
 * the frozen reason codes, the check order (action shape → token →
 * verify → tenant binding → scope), and the action-scope table law.
 */

import { describe, expect, it } from "vitest";
import {
  MARKETPLACE_ACTION_SCOPE_TABLE,
  authorizeMarketplaceAction,
  type MarketplaceActionKind,
} from "./marketplace-gate.js";
import { issueSignedSession, type SessionSigningKey } from "./session.js";

const KEY: SessionSigningKey = { algorithm: "HMAC-SHA256", secretHex: "0011223344556677889900aabbccddeeff00112233445566778899aabbccddee" };
const WRONG_KEY: SessionSigningKey = { algorithm: "HMAC-SHA256", secretHex: "ffeeddccbbaa0099887766554433221100ffeeddccbbaa00998877665544332211" };
const ACTOR = "act_operator-ama-01";
const FOREIGN_ACTOR = "act_rival-ops-02";
const TENANT = "acme-ops";
const FOREIGN_TENANT = "globex-rival";
const IAT = 1_791_830_400_000;
const EXP = IAT + 3_600_000;
const NOW = IAT + 1_000;

function tokenFor(overrides: Partial<Parameters<typeof issueSignedSession>[0]> = {}): string {
  const r = issueSignedSession({
    actorId: ACTOR,
    tenantId: TENANT,
    scopes: ["marketplace.request", "marketplace.offer", "marketplace.order", "marketplace.order.ack"],
    issuedAt: IAT,
    expiresAt: EXP,
    key: KEY,
    ...overrides,
  });
  if (!r.ok) throw new Error("fixture issuance failed");
  return r.token;
}

function gate(
  token: string | null,
  kind: unknown,
  tenantId: unknown,
  key: SessionSigningKey = KEY,
  now: number = NOW,
) {
  return authorizeMarketplaceAction({ token, action: { kind, tenantId }, key, now });
}

describe("F370A authorizeMarketplaceAction — the frozen verdicts", () => {
  it("AUTHORIZES an authenticated, tenant-bound, scoped session", () => {
    const r = gate(tokenFor(), "request", TENANT);
    expect(r).toEqual({
      ok: true,
      actorId: ACTOR,
      tenantId: TENANT,
      action: "request",
      scope: "marketplace.request",
    });
  });

  it("REFUSAL: no token => UNAUTHENTICATED (the fail-closed default)", () => {
    expect(gate(null, "request", TENANT)).toMatchObject({ ok: false, reason: "UNAUTHENTICATED" });
    expect(gate("", "request", TENANT)).toMatchObject({ ok: false, reason: "UNAUTHENTICATED" });
  });

  it("REFUSAL: garbage/tampered/wrong-key tokens => UNAUTHENTICATED", () => {
    expect(gate("garbage", "request", TENANT)).toMatchObject({ ok: false, reason: "UNAUTHENTICATED" });
    const tampered = tokenFor().split(".");
    const forged = `${tampered[0]}.${tampered[1]!.slice(0, -1)}${tampered[1]!.slice(-1) === "A" ? "B" : "A"}.${tampered[2]}`;
    expect(gate(forged, "request", TENANT)).toMatchObject({ ok: false, reason: "UNAUTHENTICATED" });
    expect(gate(tokenFor(), "request", TENANT, WRONG_KEY)).toMatchObject({ ok: false, reason: "UNAUTHENTICATED" });
  });

  it("REFUSAL: an expired session => SESSION_EXPIRED", () => {
    const expired = tokenFor({ issuedAt: IAT - 10_000, expiresAt: IAT - 1_000 });
    expect(gate(expired, "request", TENANT, KEY, NOW)).toMatchObject({ ok: false, reason: "SESSION_EXPIRED" });
  });

  it("REFUSAL: a foreign-tenant session on the home scope => TENANT_MISMATCH", () => {
    const foreign = tokenFor({ actorId: FOREIGN_ACTOR, tenantId: FOREIGN_TENANT });
    expect(gate(foreign, "request", TENANT)).toMatchObject({ ok: false, reason: "TENANT_MISMATCH" });
  });

  it("REFUSAL: a missing required scope => SCOPE_MISSING (the verb's own scope named in the detail)", () => {
    const noReceipt = tokenFor({ scopes: ["marketplace.request"] });
    const r = gate(noReceipt, "receipt", TENANT);
    expect(r).toMatchObject({ ok: false, reason: "SCOPE_MISSING", action: "receipt" });
    if (!r.ok) expect(r.detail).toContain("marketplace.receipt");
  });

  it("REFUSAL: an unknown verb => MALFORMED (fail-closed on the action shape)", () => {
    expect(gate(tokenFor(), "not-a-verb", TENANT)).toMatchObject({ ok: false, reason: "MALFORMED", action: null });
    expect(gate(tokenFor(), 42, TENANT)).toMatchObject({ ok: false, reason: "MALFORMED" });
    expect(gate(tokenFor(), null, TENANT)).toMatchObject({ ok: false, reason: "MALFORMED" });
  });

  it("REFUSAL: a malformed action tenant scope => MALFORMED", () => {
    expect(gate(tokenFor(), "request", "")).toMatchObject({ ok: false, reason: "MALFORMED" });
    expect(gate(tokenFor(), "request", "bad tenant!")).toMatchObject({ ok: false, reason: "MALFORMED" });
    expect(gate(tokenFor(), "request", 7)).toMatchObject({ ok: false, reason: "MALFORMED" });
  });

  it("the check order is machine-stable: malformed action beats a missing token; expiry beats tenant mismatch", () => {
    expect(gate(null, "nonsense", TENANT)).toMatchObject({ ok: false, reason: "MALFORMED" });
    const expiredForeign = tokenFor({ actorId: FOREIGN_ACTOR, tenantId: FOREIGN_TENANT, issuedAt: IAT - 10_000, expiresAt: IAT - 1_000 });
    expect(gate(expiredForeign, "request", TENANT, KEY, NOW)).toMatchObject({ ok: false, reason: "SESSION_EXPIRED" });
  });

  it("every verb of the frozen table authorizes with exactly its scope", () => {
    const allScopes = Object.values(MARKETPLACE_ACTION_SCOPE_TABLE);
    const token = tokenFor({ scopes: allScopes });
    for (const [kind, scope] of Object.entries(MARKETPLACE_ACTION_SCOPE_TABLE) as [MarketplaceActionKind, string][]) {
      const r = gate(token, kind, TENANT);
      expect(r).toEqual({ ok: true, actorId: ACTOR, tenantId: TENANT, action: kind, scope });
    }
  });

  it("the action-scope table covers exactly the eight F360 §3 verbs", () => {
    expect(Object.keys(MARKETPLACE_ACTION_SCOPE_TABLE).sort()).toEqual(
      ["ack", "approval", "comparison", "enrollment", "offer", "order", "receipt", "request"].sort(),
    );
  });
});
