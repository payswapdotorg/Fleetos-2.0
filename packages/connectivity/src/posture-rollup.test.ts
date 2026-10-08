/**
 * @fleetos/connectivity — Wave 5 posture rollup tests (F250A).
 *
 * Covers: asset rollups (desired from ACTIVE intent; honest observed —
 * unknown never coerced; alignment classes incl. degraded-online);
 * fleet rollups (deterministic aggregation, sorted assets, counters);
 * digest verify + tamper; determinism across input order; intent
 * staleness surfaced in the rollup; tenant scoping of records.
 */

import { describe, it, expect } from "vitest";
import {
  rollupAssetPosture,
  rollupFleetPosture,
  verifyFleetPostureDigest,
} from "./posture-rollup.js";
import {
  activeIntentForDevice,
  emptyIntentRegistry,
  proposeIntent,
  transitionRegistryIntent,
  type IntentRegistryState,
} from "./intent-registry.js";
import type { AuthorizationGrant, IntentPolicyCeiling } from "./intent-lifecycle.js";
import { defaultHeartbeatTtl, type HeartbeatTtl } from "./posture.js";
import type { TenantStatusRecord } from "./kernel.js";

const NOW = 1_727_000_000_000;
const TENANT_A = "tnt_acme";
const TENANT_B = "tnt_other";
const DEV_1 = "dev_truck-001";
const DEV_2 = "dev_sensor-002";
const ACTOR = "operator:alice";
const TTL: HeartbeatTtl = defaultHeartbeatTtl();

const GRANT: AuthorizationGrant = {
  grantedBy: "guardian", authorizationDigest: "g1", grantedAt: NOW - 100_000, expiresAt: NOW + 60_000,
};
const CEILING: IntentPolicyCeiling = { effect: "allow", reason: "fleet policy" };

function record(deviceId: string, state: "online" | "offline", observedAt: number, tenantId = TENANT_A): TenantStatusRecord {
  return { tenantId, deviceId, state, observedAt };
}

/** Registry with one ACTIVE online intent for the given device. */
function registryWithActiveIntent(deviceId: string, desired: "online" | "offline"): IntentRegistryState {
  let s = emptyIntentRegistry();
  const p = proposeIntent(s, {
    tenantId: TENANT_A, deviceId, desiredState: desired, idempotencyKey: `k-${deviceId}`, at: NOW - 60_000, actor: ACTOR,
  });
  if (!p.ok || p.duplicate) throw new Error("propose failed in fixture");
  s = p.state;
  const a = transitionRegistryIntent(s, {
    tenantId: TENANT_A, intentId: p.intentId, eventKind: "authorize", now: NOW - 50_000, actor: ACTOR,
    authorization: GRANT, ceiling: CEILING,
  });
  if (!a.ok) throw new Error("authorize failed in fixture");
  const act = transitionRegistryIntent(a.state, {
    tenantId: TENANT_A, intentId: p.intentId, eventKind: "activate", now: NOW - 40_000, actor: ACTOR,
  });
  if (!act.ok) throw new Error("activate failed in fixture");
  return act.state;
}

describe("connectivity posture-rollup: asset rollups", () => {
  it("desired comes from the ACTIVE intent; aligned when online + fresh online record", () => {
    const registry = registryWithActiveIntent(DEV_1, "online");
    const r = rollupAssetPosture({
      tenantId: TENANT_A, deviceId: DEV_1,
      record: record(DEV_1, "online", NOW - 1_000),
      intent: activeIntentForDevice(registry, TENANT_A, DEV_1),
      ttl: TTL, now: NOW,
    });
    expect(r.desired).toBe("online");
    expect(r.observed).toBe("online");
    expect(r.alignment).toBe("aligned");
    expect(r.intentState).toBe("active");
    expect(r.intentStaleness).toBe("fresh");
  });

  it("no status record -> observed unknown, alignment unknown (never guessed online)", () => {
    const registry = registryWithActiveIntent(DEV_1, "online");
    const r = rollupAssetPosture({
      tenantId: TENANT_A, deviceId: DEV_1, record: null,
      intent: activeIntentForDevice(registry, TENANT_A, DEV_1),
      ttl: TTL, now: NOW,
    });
    expect(r.observed).toBe("unknown");
    expect(r.alignment).toBe("unknown");
    expect(r.lastObservedAt).toBeNull();
  });

  it("no active intent -> desired none, alignment unknown (honest)", () => {
    const r = rollupAssetPosture({
      tenantId: TENANT_A, deviceId: DEV_1,
      record: record(DEV_1, "online", NOW - 1_000),
      intent: null,
      ttl: TTL, now: NOW,
    });
    expect(r.desired).toBe("none");
    expect(r.alignment).toBe("unknown");
  });

  it("desired online + offline record -> divergent; stale online record -> degraded observed", () => {
    const registry = registryWithActiveIntent(DEV_1, "online");
    const divergent = rollupAssetPosture({
      tenantId: TENANT_A, deviceId: DEV_1,
      record: record(DEV_1, "offline", NOW - 1_000),
      intent: activeIntentForDevice(registry, TENANT_A, DEV_1),
      ttl: TTL, now: NOW,
    });
    expect(divergent.alignment).toBe("divergent");

    const degraded = rollupAssetPosture({
      tenantId: TENANT_A, deviceId: DEV_1,
      record: record(DEV_1, "online", NOW - 35_000), // past staleMs, before deadMs
      intent: activeIntentForDevice(registry, TENANT_A, DEV_1),
      ttl: TTL, now: NOW,
    });
    expect(degraded.observed).toBe("degraded");
    expect(degraded.alignment).toBe("aligned"); // degraded counts as aligned-with-online
  });

  it("desired offline: online record is divergent, offline record aligned", () => {
    const registry = registryWithActiveIntent(DEV_1, "offline");
    const intent = activeIntentForDevice(registry, TENANT_A, DEV_1);
    const aligned = rollupAssetPosture({ tenantId: TENANT_A, deviceId: DEV_1, record: record(DEV_1, "offline", NOW - 1_000), intent, ttl: TTL, now: NOW });
    expect(aligned.alignment).toBe("aligned");
    const divergent = rollupAssetPosture({ tenantId: TENANT_A, deviceId: DEV_1, record: record(DEV_1, "online", NOW - 1_000), intent, ttl: TTL, now: NOW });
    expect(divergent.alignment).toBe("divergent");
  });
});

describe("connectivity posture-rollup: fleet rollups", () => {
  it("aggregates deterministically with sorted assets + exact counters", () => {
    const registry = registryWithActiveIntent(DEV_1, "online");
    const rollup = rollupFleetPosture({
      tenantId: TENANT_A,
      records: [
        record(DEV_1, "online", NOW - 1_000),
        record(DEV_2, "offline", NOW - 2_000),
      ],
      registry,
      ttl: TTL,
      now: NOW,
    });
    expect(rollup.assets.map((a) => a.deviceId)).toEqual([DEV_2, DEV_1]); // deviceId lexicographic sort
    expect(rollup.counts).toEqual({
      total: 2,
      aligned: 1, // DEV_1 online-aligned
      divergent: 0,
      unknown: 1, // DEV_2 has a record but no active intent
      observedOnline: 1,
      observedDegraded: 0,
      observedOffline: 1,
      observedUnknown: 0,
      desiredOnline: 1,
      desiredOffline: 0,
      noIntent: 1,
    });
    expect(verifyFleetPostureDigest(rollup)).toBe(true);
  });

  it("input record order does not change the digest (determinism)", () => {
    const registry = registryWithActiveIntent(DEV_1, "online");
    const records = [record(DEV_1, "online", NOW - 1_000), record(DEV_2, "offline", NOW - 2_000)];
    const a = rollupFleetPosture({ tenantId: TENANT_A, records, registry, ttl: TTL, now: NOW });
    const b = rollupFleetPosture({ tenantId: TENANT_A, records: [...records].reverse(), registry, ttl: TTL, now: NOW });
    expect(a.digest).toBe(b.digest);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("latest record wins for duplicate device records", () => {
    const registry = registryWithActiveIntent(DEV_1, "online");
    const rollup = rollupFleetPosture({
      tenantId: TENANT_A,
      records: [record(DEV_1, "offline", NOW - 10_000), record(DEV_1, "online", NOW - 1_000)],
      registry, ttl: TTL, now: NOW,
    });
    expect(rollup.assets[0]?.observed).toBe("online");
  });

  it("records from other tenants are excluded (fail-closed scoping)", () => {
    const registry = registryWithActiveIntent(DEV_1, "online");
    const rollup = rollupFleetPosture({
      tenantId: TENANT_A,
      records: [record(DEV_1, "online", NOW - 1_000), record(DEV_2, "online", NOW - 1_000, TENANT_B)],
      registry, ttl: TTL, now: NOW,
    });
    expect(rollup.assets.map((a) => a.deviceId)).toEqual([DEV_1]);
  });

  it("digest tamper detection", () => {
    const registry = registryWithActiveIntent(DEV_1, "online");
    const rollup = rollupFleetPosture({
      tenantId: TENANT_A, records: [record(DEV_1, "online", NOW - 1_000)], registry, ttl: TTL, now: NOW,
    });
    expect(verifyFleetPostureDigest(rollup)).toBe(true);
    const tamperedObserved = { ...rollup, assets: rollup.assets.map((a) => ({ ...a, observed: "offline" as const })) };
    expect(verifyFleetPostureDigest(tamperedObserved)).toBe(false);
    const tamperedAt = { ...rollup, at: rollup.at + 1 };
    expect(verifyFleetPostureDigest(tamperedAt)).toBe(false);
  });

  it("empty inputs are an empty, verifiable rollup", () => {
    const rollup = rollupFleetPosture({
      tenantId: TENANT_A, records: [], registry: emptyIntentRegistry(), ttl: TTL, now: NOW,
    });
    expect(rollup.assets).toEqual([]);
    expect(rollup.counts.total).toBe(0);
    expect(verifyFleetPostureDigest(rollup)).toBe(true);
  });

  it("intent staleness surfaces in the rollup (unknown != fresh)", () => {
    const registry = registryWithActiveIntent(DEV_1, "online");
    const fresh = rollupFleetPosture({ tenantId: TENANT_A, records: [], registry, ttl: TTL, now: NOW + 60_000 });
    const stale = rollupFleetPosture({ tenantId: TENANT_A, records: [], registry, ttl: TTL, now: NOW + 400_000 });
    const unknown = rollupFleetPosture({ tenantId: TENANT_A, records: [], registry, ttl: TTL, now: NOW + 4_000_000 });
    expect(fresh.assets[0]?.intentStaleness).toBe("fresh");
    expect(stale.assets[0]?.intentStaleness).toBe("stale");
    expect(unknown.assets[0]?.intentStaleness).toBe("unknown");
  });
});
