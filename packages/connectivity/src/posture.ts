/**
 * @fleetos/connectivity — Wave 2 honest connectivity posture (F220A).
 *
 *   - Honest connectivity posture: the kernel reports the TRUE connectivity
 *     state of a device. An unknown state is reported as "unknown", not
 *     "online". A state whose heartbeat is stale (older than the heartbeat
 *     TTL) is downgraded to "degraded".
 *   - Connectivity posture sweep: a deterministic sweep over the device
 *     status records that downgrades stale records.
 *
 * Pure TypeScript over injected PORT interfaces. No I/O, no servers, no
 * databases. Persistence lands at F211 (TL lane).
 */

import type { DeviceIdLike, TenantIdLike } from "./connectivity.js";
import type { TenantStatusRecord } from "./kernel.js";

// ---------------------------------------------------------------------------
// Honest posture — given a status record + a heartbeat TTL + the current
// time, compute the honest posture.
// ---------------------------------------------------------------------------

export type HonestPosture = "online" | "offline" | "degraded" | "unknown";

export interface HeartbeatTtl {
  readonly staleMs: number; // > staleMs since last heartbeat -> "degraded"
  readonly deadMs: number; // > deadMs since last heartbeat -> "offline"
}

export function defaultHeartbeatTtl(): HeartbeatTtl {
  return { staleMs: 30_000, deadMs: 120_000 };
}

export function honestPosture(
  record: TenantStatusRecord | null,
  ttl: HeartbeatTtl,
  now: number,
): HonestPosture {
  if (!record) return "unknown";
  const elapsed = now - record.observedAt;
  if (elapsed >= ttl.deadMs) {
    // Beyond dead threshold — the recorded state is suspect; downgrade.
    return record.state === "online" ? "degraded" : record.state;
  }
  if (elapsed >= ttl.staleMs) {
    if (record.state === "online") return "degraded"; // stale online -> degraded
    return record.state;
  }
  return record.state;
}

// ---------------------------------------------------------------------------
// Connectivity posture sweep — a deterministic sweep over a tenant's
// status records. Each record is downgraded according to the honestPosture
// rule. Returns the swept list + summary counts.
// ---------------------------------------------------------------------------

export interface PostureSweepResult {
  readonly tenantId: TenantIdLike;
  readonly online: number;
  readonly degraded: number;
  readonly offline: number;
  readonly unknown: number;
  readonly records: ReadonlyArray<{ readonly deviceId: DeviceIdLike; readonly posture: HonestPosture }>;
}

export function sweepConnectivityPosture(
  records: ReadonlyArray<TenantStatusRecord>,
  tenantId: TenantIdLike,
  ttl: HeartbeatTtl,
  now: number,
): PostureSweepResult {
  const out: { deviceId: DeviceIdLike; posture: HonestPosture }[] = [];
  let online = 0;
  let degraded = 0;
  let offline = 0;
  let unknown = 0;
  for (const r of records) {
    if (r.tenantId !== tenantId) continue; // tenant-fail-closed
    const p = honestPosture(r, ttl, now);
    out.push({ deviceId: r.deviceId, posture: p });
    if (p === "online") online++;
    else if (p === "degraded") degraded++;
    else if (p === "offline") offline++;
    else unknown++;
  }
  return { tenantId, online, degraded, offline, unknown, records: out };
}

// ---------------------------------------------------------------------------
// Honest online predicate — a device is "online" only if its record is
// present, its state is "online", AND its heartbeat is fresh.
// ---------------------------------------------------------------------------

export function isHonestlyOnline(
  record: TenantStatusRecord | null,
  ttl: HeartbeatTtl,
  now: number,
): boolean {
  return honestPosture(record, ttl, now) === "online";
}
