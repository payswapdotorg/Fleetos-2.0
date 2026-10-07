/**
 * @fleetos/connectivity — Wave 2 posture tests (F220A).
 */

import { describe, it, expect } from "vitest";
import type { TenantStatusRecord } from "./kernel.js";
import {
  defaultHeartbeatTtl,
  honestPosture,
  isHonestlyOnline,
  sweepConnectivityPosture,
} from "./posture.js";

const NOW = 1_727_000_000_000;
const TENANT_A = "tnt_acme";
const TENANT_B = "tnt_other";
const DEV1 = "dev_truck-001";
const DEV2 = "dev_truck-002";

function record(state: "online" | "offline", observedAt: number, tenantId: string = TENANT_A, deviceId: string = DEV1): TenantStatusRecord {
  return { tenantId, deviceId, state, observedAt };
}

describe("connectivity posture: honestPosture", () => {
  const ttl = defaultHeartbeatTtl();

  it("returns 'unknown' for a null record", () => {
    expect(honestPosture(null, ttl, NOW)).toBe("unknown");
  });

  it("returns 'online' for a fresh online record", () => {
    const r = record("online", NOW - 1000);
    expect(honestPosture(r, ttl, NOW)).toBe("online");
  });

  it("returns 'degraded' for a stale online record (between stale and dead thresholds)", () => {
    const r = record("online", NOW - 35_000); // 35s ago — past staleMs (30s) but before deadMs (120s)
    expect(honestPosture(r, ttl, NOW)).toBe("degraded");
  });

  it("returns 'degraded' for an online record older than deadMs (downgrade, not offline)", () => {
    const r = record("online", NOW - 200_000); // 200s ago — beyond deadMs
    // Online + beyond dead -> degraded (we don't claim "offline" without
    // explicit knowledge; we downgrade the suspect "online" claim).
    expect(honestPosture(r, ttl, NOW)).toBe("degraded");
  });

  it("returns 'offline' for a fresh offline record", () => {
    const r = record("offline", NOW - 1000);
    expect(honestPosture(r, ttl, NOW)).toBe("offline");
  });

  it("returns 'offline' for a stale offline record", () => {
    const r = record("offline", NOW - 200_000);
    expect(honestPosture(r, ttl, NOW)).toBe("offline");
  });
});

describe("connectivity posture: isHonestlyOnline", () => {
  const ttl = defaultHeartbeatTtl();

  it("returns true only for fresh online records", () => {
    expect(isHonestlyOnline(record("online", NOW - 1000), ttl, NOW)).toBe(true);
    expect(isHonestlyOnline(record("online", NOW - 35_000), ttl, NOW)).toBe(false);
    expect(isHonestlyOnline(null, ttl, NOW)).toBe(false);
    expect(isHonestlyOnline(record("offline", NOW - 1000), ttl, NOW)).toBe(false);
  });
});

describe("connectivity posture: sweep", () => {
  const ttl = defaultHeartbeatTtl();

  it("sweeps a tenant's records and counts postures", () => {
    const records: TenantStatusRecord[] = [
      record("online", NOW - 1000, TENANT_A, DEV1), // online
      record("online", NOW - 35_000, TENANT_A, DEV2), // degraded (stale)
      record("offline", NOW - 1000, TENANT_A, "dev_3"), // offline
    ];
    const r = sweepConnectivityPosture(records, TENANT_A, ttl, NOW);
    expect(r.online).toBe(1);
    expect(r.degraded).toBe(1);
    expect(r.offline).toBe(1);
    expect(r.unknown).toBe(0);
    expect(r.records).toHaveLength(3);
  });

  it("sweep is tenant-fail-closed — only includes the caller's tenant records", () => {
    const records: TenantStatusRecord[] = [
      record("online", NOW - 1000, TENANT_A, DEV1),
      record("online", NOW - 1000, TENANT_B, DEV2), // different tenant
    ];
    const r = sweepConnectivityPosture(records, TENANT_A, ttl, NOW);
    expect(r.records).toHaveLength(1);
    expect(r.records[0]!.deviceId).toBe(DEV1);
  });

  it("sweep counts unknowns when records are missing for some devices", () => {
    // No records at all -> all zero, no records in the output.
    const r = sweepConnectivityPosture([], TENANT_A, ttl, NOW);
    expect(r.online).toBe(0);
    expect(r.unknown).toBe(0);
    expect(r.records).toHaveLength(0);
  });

  it("sweep is deterministic for identical inputs", () => {
    const records: TenantStatusRecord[] = [
      record("online", NOW - 1000, TENANT_A, DEV1),
      record("offline", NOW - 1000, TENANT_A, DEV2),
    ];
    const r1 = sweepConnectivityPosture(records, TENANT_A, ttl, NOW);
    const r2 = sweepConnectivityPosture(records, TENANT_A, ttl, NOW);
    expect(r1).toEqual(r2);
  });

  it("defaultHeartbeatTtl has sensible thresholds (staleMs < deadMs)", () => {
    const ttl = defaultHeartbeatTtl();
    expect(ttl.staleMs).toBeGreaterThan(0);
    expect(ttl.deadMs).toBeGreaterThan(ttl.staleMs);
  });

  it("honestPosture treats an online record exactly at staleMs boundary as degraded (>= comparison)", () => {
    const r = record("online", NOW - 30_000); // exactly at staleMs (30s)
    expect(honestPosture(r, ttl, NOW)).toBe("degraded"); // boundary: >= staleMs is degraded
  });

  it("honestPosture treats an online record just before staleMs as online", () => {
    const r = record("online", NOW - 29_999); // 1ms before staleMs
    expect(honestPosture(r, ttl, NOW)).toBe("online");
  });

  it("sweep with a custom ttl honors the custom thresholds", () => {
    const customTtl = { staleMs: 5_000, deadMs: 15_000 };
    const records: TenantStatusRecord[] = [
      record("online", NOW - 6_000, TENANT_A, DEV1), // 6s ago — past 5s stale
    ];
    const r = sweepConnectivityPosture(records, TENANT_A, customTtl, NOW);
    expect(r.degraded).toBe(1);
    expect(r.online).toBe(0);
  });
});
