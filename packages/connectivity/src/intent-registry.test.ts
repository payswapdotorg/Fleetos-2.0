/**
 * @fleetos/connectivity — Wave 5 intent registry tests (F250A).
 *
 * Covers: propose + idempotent re-propose; fail-closed cross-tenant
 * lookups; lifecycle transitions through the registry (Guardian law
 * enforced end-to-end); supersede semantics + provenance; deterministic
 * ordering; fold replay == state; checkpoint resume.
 */

import { describe, it, expect } from "vitest";
import {
  activeIntentForDevice,
  checkpointIntentRegistry,
  emptyIntentRegistry,
  findIntent,
  foldIntentRegistry,
  listIntentsByDevice,
  listIntentsByTenant,
  proposeIntent,
  resumeIntentRegistry,
  supersedeIntent,
  transitionRegistryIntent,
  type IntentRegistryState,
} from "./intent-registry.js";
import type { AuthorizationGrant, IntentPolicyCeiling } from "./intent-lifecycle.js";

const NOW = 1_727_000_000_000;
const TENANT_A = "tnt_acme";
const TENANT_B = "tnt_other";
const DEV_1 = "dev_truck-001";
const DEV_2 = "dev_sensor-002";
const ACTOR = "operator:alice";

const GRANT: AuthorizationGrant = {
  grantedBy: "guardian",
  authorizationDigest: "grant-digest-1",
  grantedAt: NOW - 1_000,
  expiresAt: NOW + 60_000,
};
const CEILING_ALLOW: IntentPolicyCeiling = { effect: "allow", reason: "fleet policy" };

function propose(state: IntentRegistryState, key = "k-1", deviceId = DEV_1, at = NOW) {
  return proposeIntent(state, {
    tenantId: TENANT_A, deviceId, desiredState: "online", idempotencyKey: key, at, actor: ACTOR,
  });
}

function proposeOk(state: IntentRegistryState, key = "k-1", deviceId = DEV_1, at = NOW): { intentId: string; state: IntentRegistryState } {
  const r = propose(state, key, deviceId, at);
  if (!r.ok || r.duplicate) throw new Error("propose failed in fixture");
  return { intentId: r.intentId, state: r.state };
}

describe("connectivity intent-registry: propose + tenancy", () => {
  it("proposes an intent with a deterministic content-addressed id", () => {
    const r = propose(emptyIntentRegistry());
    expect(r.ok).toBe(true);
    if (r.ok && !r.duplicate) {
      expect(r.intentId).toMatch(/^intent_/);
      expect(r.state.byId.get(r.intentId)?.state).toBe("proposed");
    }
  });

  it("re-proposing the same idempotency key is idempotent (duplicate=true)", () => {
    const first = proposeOk(emptyIntentRegistry());
    const again = propose(first.state);
    expect(again.ok && again.duplicate).toBe(true);
    if (again.ok) {
      expect(again.intentId).toBe(first.intentId);
      expect(again.state.events.length).toBe(first.state.events.length);
    }
  });

  it("the same key under another tenant is a different intent (tenant-scoped dedup)", () => {
    const a = proposeOk(emptyIntentRegistry());
    const b = proposeIntent(emptyIntentRegistry(), {
      tenantId: TENANT_B, deviceId: DEV_1, desiredState: "online", idempotencyKey: "k-1", at: NOW, actor: ACTOR,
    });
    expect(b.ok && !b.duplicate && b.intentId !== a.intentId).toBe(true);
  });

  it("refuses missing tenant / device / key / invalid now", () => {
    const s = emptyIntentRegistry();
    expect(proposeIntent(s, { tenantId: "", deviceId: DEV_1, desiredState: "online", idempotencyKey: "k", at: NOW, actor: ACTOR })).toMatchObject({ ok: false, reason: "missing-tenant-id" });
    expect(proposeIntent(s, { tenantId: TENANT_A, deviceId: "", desiredState: "online", idempotencyKey: "k", at: NOW, actor: ACTOR })).toMatchObject({ ok: false, reason: "missing-device-id" });
    expect(proposeIntent(s, { tenantId: TENANT_A, deviceId: DEV_1, desiredState: "online", idempotencyKey: "", at: NOW, actor: ACTOR })).toMatchObject({ ok: false, reason: "missing-idempotency-key" });
    expect(proposeIntent(s, { tenantId: TENANT_A, deviceId: DEV_1, desiredState: "online", idempotencyKey: "k", at: 0, actor: ACTOR })).toMatchObject({ ok: false, reason: "invalid-now" });
  });

  it("cross-tenant intentId lookup is fail-closed (== unknown-intent)", () => {
    const r = proposeOk(emptyIntentRegistry());
    expect(findIntent(r.state, TENANT_A, r.intentId)).not.toBeNull();
    expect(findIntent(r.state, TENANT_B, r.intentId)).toBeNull();
    const t = transitionRegistryIntent(r.state, { tenantId: TENANT_B, intentId: r.intentId, eventKind: "authorize", now: NOW, actor: ACTOR, authorization: GRANT, ceiling: CEILING_ALLOW });
    expect(t).toMatchObject({ ok: false, reason: "unknown-intent" });
  });
});

describe("connectivity intent-registry: transitions + supersede", () => {
  it("walks authorize -> activate -> suspend -> resume through the registry", () => {
    let s = proposeOk(emptyIntentRegistry()).state;
    const id = [...s.byId.keys()][0]!;
    s = auth(s, id, NOW + 1);
    const activate = transitionRegistryIntent(s, { tenantId: TENANT_A, intentId: id, eventKind: "activate", now: NOW + 2, actor: ACTOR });
    expect(activate.ok).toBe(true);
    if (activate.ok) {
      expect(activate.record.state).toBe("active");
      s = activate.state;
    }
    const suspend = transitionRegistryIntent(s, { tenantId: TENANT_A, intentId: id, eventKind: "suspend", now: NOW + 3, actor: ACTOR, reason: "maintenance" });
    expect(suspend.ok && suspend.record.state).toBe("suspended");
    if (suspend.ok) s = suspend.state;
    const resume = transitionRegistryIntent(s, { tenantId: TENANT_A, intentId: id, eventKind: "resume", now: NOW + 4, actor: ACTOR });
    expect(resume.ok && resume.record.state).toBe("active");
  });

  it("authorize without a grant refuses through the registry (Guardian law)", () => {
    const s = proposeOk(emptyIntentRegistry()).state;
    const id = [...s.byId.keys()][0]!;
    const r = transitionRegistryIntent(s, { tenantId: TENANT_A, intentId: id, eventKind: "authorize", now: NOW, actor: ACTOR, ceiling: CEILING_ALLOW });
    expect(r).toMatchObject({ ok: false, reason: "authorization-required" });
  });

  it("supersede links predecessor/successor with provenance (non-active only)", () => {
    const p = proposeOk(emptyIntentRegistry(), "k-old", DEV_1, NOW);
    const r = supersedeIntent(p.state, {
      tenantId: TENANT_A,
      predecessorIntentId: p.intentId,
      successor: { deviceId: DEV_1, desiredState: "offline", idempotencyKey: "k-new" },
      provenance: { actor: ACTOR, reason: "policy change: keep device offline", at: NOW + 1 },
    });
    expect(r.ok).toBe(true);
    if (r.ok && !r.duplicate) {
      const predecessor = r.state.byId.get(p.intentId)!;
      const successor = r.state.byId.get(r.intentId)!;
      expect(predecessor.supersededBy).toBe(r.intentId);
      expect(successor.supersedes).toBe(p.intentId);
      expect(successor.desiredState).toBe("offline");
      const supersededEvent = r.state.events.find((e) => e.kind === "superseded");
      expect(supersededEvent).toBeDefined();
    }
  });

  it("an ACTIVE intent cannot be superseded (suspend/terminate first)", () => {
    let s = proposeOk(emptyIntentRegistry(), "k-old", DEV_1, NOW).state;
    const id = [...s.byId.keys()][0]!;
    s = auth(s, id, NOW + 1);
    s = transitionRegistryIntent(s, { tenantId: TENANT_A, intentId: id, eventKind: "activate", now: NOW + 2, actor: ACTOR }).ok
      ? activated(s, id, NOW + 2) : s;
    const r = supersedeIntent(s, {
      tenantId: TENANT_A, predecessorIntentId: id,
      successor: { deviceId: DEV_1, desiredState: "offline", idempotencyKey: "k-new" },
      provenance: { actor: ACTOR, reason: "try anyway", at: NOW + 3 },
    });
    expect(r).toMatchObject({ ok: false, reason: "not-supersedeable" });
  });

  it("supersede without a provenance reason is refused", () => {
    const p = proposeOk(emptyIntentRegistry(), "k-old", DEV_1, NOW);
    const r = supersedeIntent(p.state, {
      tenantId: TENANT_A, predecessorIntentId: p.intentId,
      successor: { deviceId: DEV_1, desiredState: "offline", idempotencyKey: "k-new" },
      provenance: { actor: ACTOR, reason: "", at: NOW + 1 },
    });
    expect(r).toMatchObject({ ok: false, reason: "missing-provenance-reason" });
  });
});

describe("connectivity intent-registry: ordering + fold", () => {
  it("listings are deterministic: (deviceId, proposedAt, intentId)", () => {
    let s = emptyIntentRegistry();
    s = proposeOk(s, "k-b", DEV_2, NOW + 2).state;
    s = proposeOk(s, "k-a", DEV_1, NOW + 1).state;
    s = proposeOk(s, "k-a2", DEV_1, NOW + 3).state;
    const listed = listIntentsByTenant(s, TENANT_A);
    expect(listed.map((r) => r.deviceId)).toEqual([DEV_2, DEV_1, DEV_1]); // deviceId sort
    expect(listed.map((r) => r.proposedAt)).toEqual([NOW + 2, NOW + 1, NOW + 3]);
    expect(listIntentsByDevice(s, TENANT_A, DEV_1).length).toBe(2);
  });

  it("activeIntentForDevice returns the latest active intent (or null)", () => {
    let s = emptyIntentRegistry();
    const a = proposeOk(s, "k-a", DEV_1, NOW);
    s = auth(a.state, a.intentId, NOW + 1);
    s = transitionRegistryIntent(s, { tenantId: TENANT_A, intentId: a.intentId, eventKind: "activate", now: NOW + 2, actor: ACTOR }).ok
      ? activated(s, a.intentId, NOW + 2) : s;
    const found = activeIntentForDevice(s, TENANT_A, DEV_1);
    expect(found?.intentId).toBe(a.intentId);
    expect(activeIntentForDevice(s, TENANT_A, DEV_2)).toBeNull();
  });

  it("fold replay == state; checkpoint resume equals a full fold", () => {
    let s = proposeOk(emptyIntentRegistry(), "k-a", DEV_1, NOW).state;
    const id = [...s.byId.keys()][0]!;
    const checkpoint = checkpointIntentRegistry(s);
    s = auth(s, id, NOW + 1);
    const replayed = foldIntentRegistry(s.events);
    expect(replayed.byId).toEqual(s.byId);
    expect(replayed.seq).toBe(s.seq);
    const resumed = resumeIntentRegistry(checkpoint, s.events);
    expect(resumed).toEqual(s);
  });
});

function auth(s: IntentRegistryState, id: string, at: number): IntentRegistryState {
  const r = transitionRegistryIntent(s, {
    tenantId: TENANT_A, intentId: id, eventKind: "authorize", now: at, actor: ACTOR,
    authorization: GRANT, ceiling: CEILING_ALLOW,
  });
  if (!r.ok) throw new Error("authorize failed in fixture");
  return r.state;
}

function activated(s: IntentRegistryState, id: string, at: number): IntentRegistryState {
  const r = transitionRegistryIntent(s, {
    tenantId: TENANT_A, intentId: id, eventKind: "activate", now: at, actor: ACTOR,
  });
  if (!r.ok) throw new Error("activate failed in fixture");
  return r.state;
}
