/**
 * @fleetos/adcos — Wave 5 session registry tests (F250A).
 *
 * Covers: trust-gated enrollment; nonce dedup (idempotent); heartbeat
 * posture fold (enrolled != connected); expiry classification + sweep;
 * trust adjustments (evidence / reason); revoke; tenant fail-closed
 * lookups; fold replay == state.
 */

import { describe, it, expect } from "vitest";
import {
  adjustSessionTrust,
  classifySessionExpiry,
  defaultSessionTtl,
  enrollSession,
  expireSessions,
  findSession,
  foldSessionRegistry,
  gateSessionCapability,
  heartbeatSession,
  listSessionsByDevice,
  listSessionsByTenant,
  revokeSession,
  SESSION_TRUST_CAPABILITIES,
  type SessionRegistryState,
} from "./session-registry.js";

const NOW = 1_727_000_000_000;
const TENANT_A = "tnt_acme";
const TENANT_B = "tnt_other";
const DEVICE_1 = "dev_truck-001";
const DEVICE_2 = "dev_sensor-002";
const ACTOR = "system:adcos-session";
const TTL = { staleMs: 30_000, deadMs: 120_000 };

function enroll(state: SessionRegistryState, nonce = "n-1", at = NOW, trustLevel: "low" | "standard" | "elevated" | "untrusted" = "standard") {
  return enrollSession(state, {
    tenantId: TENANT_A, deviceId: DEVICE_1, trustLevel, nonce, at, actor: ACTOR, ttl: TTL,
  });
}

function enrollOk(state: SessionRegistryState, nonce = "n-1", at = NOW): { sessionId: string; state: SessionRegistryState } {
  const r = enroll(state, nonce, at);
  if (!r.ok || r.duplicate) throw new Error("enroll failed in fixture");
  return { sessionId: r.sessionId, state: r.state };
}

describe("adcos session-registry: trust-ladder seam", () => {
  it("capability grants mirror the F230A ladder (untrusted=none, low=observe)", () => {
    expect(SESSION_TRUST_CAPABILITIES.untrusted).toEqual([]);
    expect(SESSION_TRUST_CAPABILITIES.low).toEqual(["observe"]);
    expect(SESSION_TRUST_CAPABILITIES.standard).toEqual(["observe", "execute-routine"]);
    expect(SESSION_TRUST_CAPABILITIES.elevated).toContain("execute-destructive");
  });

  it("gateSessionCapability refuses execute-routine at low trust", () => {
    expect(gateSessionCapability("low", "execute-routine")).toMatchObject({ ok: false, reason: "trust-too-low" });
    expect(gateSessionCapability("standard", "execute-routine").ok).toBe(true);
    expect(gateSessionCapability("elevated", "execute-destructive").ok).toBe(true);
  });
});

describe("adcos session-registry: enroll + heartbeat fold", () => {
  it("enrolls trust-gated: untrusted principals are refused", () => {
    const r = enroll(emptySession(), "n-1", NOW, "untrusted");
    expect(r).toMatchObject({ ok: false, reason: "trust-too-low" });
  });

  it("refuses missing tenant / device / nonce and invalid now", () => {
    const s = emptySession();
    expect(enrollSession(s, { tenantId: "", deviceId: DEVICE_1, trustLevel: "low", nonce: "n", at: NOW, actor: ACTOR })).toMatchObject({ ok: false, reason: "missing-tenant-id" });
    expect(enrollSession(s, { tenantId: TENANT_A, deviceId: "", trustLevel: "low", nonce: "n", at: NOW, actor: ACTOR })).toMatchObject({ ok: false, reason: "missing-device-id" });
    expect(enrollSession(s, { tenantId: TENANT_A, deviceId: DEVICE_1, trustLevel: "low", nonce: "", at: NOW, actor: ACTOR })).toMatchObject({ ok: false, reason: "missing-nonce" });
    expect(enrollSession(s, { tenantId: TENANT_A, deviceId: DEVICE_1, trustLevel: "low", nonce: "n", at: 0, actor: ACTOR })).toMatchObject({ ok: false, reason: "invalid-now" });
  });

  it("re-enrolling the same nonce is idempotent (duplicate=true)", () => {
    const first = enrollOk(emptySession());
    const again = enroll(first.state);
    expect(again.ok).toBe(true);
    if (again.ok) {
      expect(again.duplicate).toBe(true);
      expect(again.sessionId).toBe(first.sessionId);
      expect(again.state.events.length).toBe(first.state.events.length);
    }
  });

  it("enrolled sessions start degraded (NOT connected) until a heartbeat", () => {
    const r = enrollOk(emptySession());
    const record = r.state.byId.get(r.sessionId)!;
    expect(record.posture).toBe("degraded");
    expect(record.state).toBe("active");
  });

  it("a fresh heartbeat connects; a stale-gap heartbeat degrades", () => {
    const r = enrollOk(emptySession());
    const fresh = heartbeatSession(r.state, { tenantId: TENANT_A, sessionId: r.sessionId, at: NOW + 1_000, actor: ACTOR });
    expect(fresh.ok).toBe(true);
    if (fresh.ok) {
      expect(fresh.state.byId.get(r.sessionId)?.posture).toBe("connected");
      const staleGap = heartbeatSession(fresh.state, { tenantId: TENANT_A, sessionId: r.sessionId, at: NOW + 1_000 + 45_000, actor: ACTOR });
      expect(staleGap.ok).toBe(true);
      if (staleGap.ok) {
        const record = staleGap.state.byId.get(r.sessionId)!;
        expect(record.posture).toBe("degraded"); // 45s gap >= staleMs 30s
        expect(record.heartbeatCount).toBe(2);
      }
    }
  });

  it("a dead-gap heartbeat postures the session offline", () => {
    const r = enrollOk(emptySession());
    const dead = heartbeatSession(r.state, { tenantId: TENANT_A, sessionId: r.sessionId, at: NOW + 200_000, actor: ACTOR });
    expect(dead.ok).toBe(true);
    if (dead.ok) expect(dead.state.byId.get(r.sessionId)?.posture).toBe("offline");
  });

  it("heartbeat on an expired session is refused (session-expired)", () => {
    let s = enrollOk(emptySession()).state;
    const sessionId = [...s.byId.keys()][0]!;
    s = expireSessions(s, { tenantId: TENANT_A, now: NOW + 200_000, actor: ACTOR }).state;
    expect(heartbeatSession(s, { tenantId: TENANT_A, sessionId, at: NOW + 200_001, actor: ACTOR })).toMatchObject({ ok: false, reason: "session-expired" });
  });
});

describe("adcos session-registry: expiry + trust adjustments", () => {
  it("classifySessionExpiry boundaries: fresh / stale / expired", () => {
    const r = enrollOk(emptySession());
    const record = r.state.byId.get(r.sessionId)!;
    expect(classifySessionExpiry(record, NOW + 29_999)).toBe("fresh");
    expect(classifySessionExpiry(record, NOW + 30_000)).toBe("stale");
    expect(classifySessionExpiry(record, NOW + 120_000)).toBe("expired");
  });

  it("expireSessions sweeps only this tenant's dead sessions (ordered)", () => {
    let s = emptySession();
    s = enrollOk(s, "n-1", NOW).state;
    s = enrollOk(s, "n-2", NOW).state;
    const other = enrollSession(s, { tenantId: TENANT_B, deviceId: DEVICE_2, trustLevel: "standard", nonce: "n-1", at: NOW, actor: ACTOR, ttl: TTL });
    if (other.ok && !other.duplicate) s = other.state;
    const sweep = expireSessions(s, { tenantId: TENANT_A, now: NOW + 200_000, actor: ACTOR });
    expect(sweep.expired.length).toBe(2);
    for (const id of sweep.expired) {
      const record = sweep.state.byId.get(id)!;
      expect(record.tenantId).toBe(TENANT_A);
      expect(record.state).toBe("expired");
    }
  });

  it("upward trust transition requires the evidence kinds; downward requires a reason", () => {
    const r = enrollOk(emptySession(), "n-1", NOW); // standard
    const up = adjustSessionTrust(r.state, {
      tenantId: TENANT_A, sessionId: r.sessionId, to: "elevated", evidence: [], at: NOW + 1, actor: ACTOR,
    });
    expect(up).toMatchObject({ ok: false, reason: "insufficient-evidence" });
    const missingKind = adjustSessionTrust(r.state, {
      tenantId: TENANT_A, sessionId: r.sessionId, to: "elevated",
      evidence: [
        { kind: "attestation", digest: "d1", observedAt: NOW },
        { kind: "attestation", digest: "d2", observedAt: NOW },
        { kind: "attestation", digest: "d3", observedAt: NOW },
      ],
      at: NOW + 1, actor: ACTOR,
    });
    expect(missingKind).toMatchObject({ ok: false, reason: "missing-evidence-kind" });
    const ok = adjustSessionTrust(r.state, {
      tenantId: TENANT_A, sessionId: r.sessionId, to: "elevated",
      evidence: [
        { kind: "attestation", digest: "d1", observedAt: NOW },
        { kind: "behavior-record", digest: "d2", observedAt: NOW },
        { kind: "operator-authorization", digest: "d3", observedAt: NOW },
      ],
      at: NOW + 1, actor: ACTOR,
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.state.byId.get(r.sessionId)?.trustLevel).toBe("elevated");

    const down = adjustSessionTrust(r.state, { tenantId: TENANT_A, sessionId: r.sessionId, to: "untrusted", evidence: [], at: NOW + 2, actor: ACTOR });
    expect(down).toMatchObject({ ok: false, reason: "missing-reason" });
  });

  it("same-level trust adjustment is refused (same-level)", () => {
    const r = enrollOk(emptySession()); // standard
    const same = adjustSessionTrust(r.state, { tenantId: TENANT_A, sessionId: r.sessionId, to: "standard", evidence: [], at: NOW + 1, actor: ACTOR });
    expect(same).toMatchObject({ ok: false, reason: "same-level" });
  });

  it("revoke requires a reason and is terminal", () => {
    const r = enrollOk(emptySession());
    const noReason = revokeSession(r.state, { tenantId: TENANT_A, sessionId: r.sessionId, at: NOW + 1, reason: "", actor: ACTOR });
    expect(noReason).toMatchObject({ ok: false, reason: "missing-reason" });
    const revoked = revokeSession(r.state, { tenantId: TENANT_A, sessionId: r.sessionId, at: NOW + 1, reason: "security incident", actor: ACTOR });
    expect(revoked.ok).toBe(true);
    if (revoked.ok) {
      const record = revoked.state.byId.get(r.sessionId)!;
      expect(record.state).toBe("revoked");
      expect(record.posture).toBe("offline");
      expect(heartbeatSession(revoked.state, { tenantId: TENANT_A, sessionId: r.sessionId, at: NOW + 2, actor: ACTOR })).toMatchObject({ ok: false, reason: "illegal-transition" });
    }
  });
});

describe("adcos session-registry: tenancy + fold", () => {
  it("cross-tenant sessionId lookup is fail-closed (== unknown)", () => {
    const r = enrollOk(emptySession());
    expect(findSession(r.state, TENANT_A, r.sessionId)).not.toBeNull();
    expect(findSession(r.state, TENANT_B, r.sessionId)).toBeNull();
    expect(heartbeatSession(r.state, { tenantId: TENANT_B, sessionId: r.sessionId, at: NOW + 1, actor: ACTOR })).toMatchObject({ ok: false, reason: "unknown-session" });
  });

  it("tenant/device listings are deterministic and tenant-scoped", () => {
    let s = emptySession();
    s = enrollOk(s, "n-1", NOW).state;
    s = enrollOk(s, "n-2", NOW + 1).state;
    const other = enrollSession(s, { tenantId: TENANT_B, deviceId: DEVICE_2, trustLevel: "standard", nonce: "n-x", at: NOW + 2, actor: ACTOR, ttl: TTL });
    if (other.ok && !other.duplicate) s = other.state;
    const mine = listSessionsByTenant(s, TENANT_A);
    expect(mine.length).toBe(2);
    expect(mine.map((r) => r.enrolledAt)).toEqual([NOW, NOW + 1]); // enrollment order
    expect(listSessionsByDevice(s, TENANT_A, DEVICE_1).length).toBe(2);
    expect(listSessionsByTenant(s, TENANT_B).length).toBe(1);
  });

  it("fold replay == state (event-sourced registry)", () => {
    let s = enrollOk(emptySession()).state;
    const sessionId = [...s.byId.keys()][0]!;
    const hb = heartbeatSession(s, { tenantId: TENANT_A, sessionId, at: NOW + 5_000, actor: ACTOR });
    if (!hb.ok) throw new Error("heartbeat failed in fixture");
    const replayed = foldSessionRegistry(hb.state.events);
    expect(replayed.byId).toEqual(hb.state.byId);
    expect(replayed.byNonce).toEqual(hb.state.byNonce);
    expect(replayed.seq).toBe(hb.state.seq);
  });

  it("default TTL matches the connectivity heartbeat convention", () => {
    expect(defaultSessionTtl()).toEqual({ staleMs: 30_000, deadMs: 120_000 });
  });
});

function emptySession() {
  return foldSessionRegistry([]);
}
