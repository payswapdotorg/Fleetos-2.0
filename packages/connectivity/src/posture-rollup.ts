/**
 * @fleetos/connectivity — Wave 5 posture rollups (F250A).
 *
 * Fleet/asset connectivity posture rollups from the intent registry
 * (`intent-registry.ts`) + the observed status records, using the
 * F220A honest-posture rule (`posture.ts`):
 *
 *   - desired comes from the ACTIVE intent (no active intent -> `none`;
 *     a suspended/terminated intent is NOT a desired state);
 *   - observed is the honest posture — an absent record is `unknown`,
 *     never coerced to online (unknown != fresh);
 *   - alignment is `aligned | divergent | unknown` — `unknown` whenever
 *     either side is unknown (honest, never guessed);
 *   - deterministic aggregation: assets sorted by deviceId, integer
 *     counters, digest + verify (tamper-evident).
 *
 * Pure deterministic TypeScript; logical `now` everywhere.
 */

import { createHash } from "node:crypto";
import type { DeviceIdLike, TenantIdLike } from "./connectivity.js";
import type { TenantStatusRecord } from "./kernel.js";
import {
  classifyIntentStaleness,
  defaultIntentStalenessThresholds,
  type IntentStaleness,
  type IntentStalenessThresholds,
} from "./intent-lifecycle.js";
import type { RegistryIntentRecord } from "./intent-registry.js";
import { activeIntentForDevice, listIntentsByTenant, type IntentRegistryState } from "./intent-registry.js";
import { honestPosture, type HeartbeatTtl, type HonestPosture } from "./posture.js";

function digestOf(...parts: ReadonlyArray<string | number>): string {
  const text = parts.map((p) => String(p)).join("|");
  return createHash("sha256").update(text).digest("hex");
}

// ---------------------------------------------------------------------------
// Asset rollup.
// ---------------------------------------------------------------------------

export type DesiredConnectivity = "online" | "offline" | "none";
export type PostureAlignment = "aligned" | "divergent" | "unknown";

export interface AssetPostureRollup {
  readonly tenantId: TenantIdLike;
  readonly deviceId: DeviceIdLike;
  readonly at: number;
  readonly desired: DesiredConnectivity;
  readonly observed: HonestPosture;
  readonly alignment: PostureAlignment;
  readonly intentState: RegistryIntentRecord["state"] | "none";
  readonly intentStaleness: IntentStaleness;
  readonly lastObservedAt: number | null;
}

function desiredOf(intent: RegistryIntentRecord | null): DesiredConnectivity {
  if (!intent || intent.state !== "active") return "none";
  return intent.desiredState; // "online" | "offline"
}

function alignmentOf(desired: DesiredConnectivity, observed: HonestPosture): PostureAlignment {
  if (desired === "none" || observed === "unknown") return "unknown";
  if (desired === "online") return observed === "online" || observed === "degraded" ? "aligned" : "divergent";
  // desired offline: any non-offline observed posture is divergent
  return observed === "offline" ? "aligned" : "divergent";
}

export function rollupAssetPosture(input: {
  readonly tenantId: TenantIdLike;
  readonly deviceId: DeviceIdLike;
  readonly record: TenantStatusRecord | null;
  readonly intent: RegistryIntentRecord | null;
  readonly ttl: HeartbeatTtl;
  readonly now: number;
  readonly thresholds?: IntentStalenessThresholds;
}): AssetPostureRollup {
  const observed = honestPosture(input.record, input.ttl, input.now);
  const desired = desiredOf(input.intent);
  const thresholds = input.thresholds ?? defaultIntentStalenessThresholds();
  return {
    tenantId: input.tenantId,
    deviceId: input.deviceId,
    at: input.now,
    desired,
    observed,
    alignment: alignmentOf(desired, observed),
    intentState: input.intent ? input.intent.state : "none",
    intentStaleness: input.intent
      ? classifyIntentStaleness(input.intent, thresholds, input.now)
      : "unknown",
    lastObservedAt: input.record ? input.record.observedAt : null,
  };
}

// ---------------------------------------------------------------------------
// Fleet rollup — deterministic aggregation + digest.
// ---------------------------------------------------------------------------

export interface FleetPostureCounts {
  readonly total: number;
  readonly aligned: number;
  readonly divergent: number;
  readonly unknown: number;
  readonly observedOnline: number;
  readonly observedDegraded: number;
  readonly observedOffline: number;
  readonly observedUnknown: number;
  readonly desiredOnline: number;
  readonly desiredOffline: number;
  readonly noIntent: number;
}

export interface FleetPostureRollup {
  readonly tenantId: TenantIdLike;
  readonly at: number;
  readonly assets: ReadonlyArray<AssetPostureRollup>; // sorted by deviceId
  readonly counts: FleetPostureCounts;
  readonly digest: string;
}

export function rollupFleetPosture(input: {
  readonly tenantId: TenantIdLike;
  readonly records: ReadonlyArray<TenantStatusRecord>;
  readonly registry: IntentRegistryState;
  readonly ttl: HeartbeatTtl;
  readonly now: number;
  readonly thresholds?: IntentStalenessThresholds;
}): FleetPostureRollup {
  const recordsByDevice = new Map<string, TenantStatusRecord>();
  for (const r of input.records) {
    if (r.tenantId !== input.tenantId) continue; // tenant fail-closed
    // Latest observedAt wins for duplicate device records (deterministic).
    const existing = recordsByDevice.get(r.deviceId);
    if (!existing || r.observedAt >= existing.observedAt) {
      recordsByDevice.set(r.deviceId, r);
    }
  }

  const intentsByDevice = new Map<string, RegistryIntentRecord | null>();
  const devices = new Set<string>(recordsByDevice.keys());
  for (const intent of listIntentsByTenant(input.registry, input.tenantId)) {
    devices.add(intent.deviceId);
    intentsByDevice.set(intent.deviceId, null);
  }
  for (const deviceId of devices) {
    intentsByDevice.set(
      deviceId,
      activeIntentForDevice(input.registry, input.tenantId, deviceId),
    );
  }

  const assets: AssetPostureRollup[] = [...devices].sort().map((deviceId) =>
    rollupAssetPosture({
      tenantId: input.tenantId,
      deviceId,
      record: recordsByDevice.get(deviceId) ?? null,
      intent: intentsByDevice.get(deviceId) ?? null,
      ttl: input.ttl,
      now: input.now,
      thresholds: input.thresholds,
    }),
  );

  const counts: FleetPostureCounts = {
    total: assets.length,
    aligned: assets.filter((a) => a.alignment === "aligned").length,
    divergent: assets.filter((a) => a.alignment === "divergent").length,
    unknown: assets.filter((a) => a.alignment === "unknown").length,
    observedOnline: assets.filter((a) => a.observed === "online").length,
    observedDegraded: assets.filter((a) => a.observed === "degraded").length,
    observedOffline: assets.filter((a) => a.observed === "offline").length,
    observedUnknown: assets.filter((a) => a.observed === "unknown").length,
    desiredOnline: assets.filter((a) => a.desired === "online").length,
    desiredOffline: assets.filter((a) => a.desired === "offline").length,
    noIntent: assets.filter((a) => a.desired === "none").length,
  };

  return {
    tenantId: input.tenantId,
    at: input.now,
    assets,
    counts,
    digest: fleetDigest(input.tenantId, input.now, assets),
  };
}

function fleetDigest(tenantId: string, at: number, assets: ReadonlyArray<AssetPostureRollup>): string {
  const parts: string[] = [tenantId, String(at)];
  for (const a of assets) {
    parts.push(a.deviceId, a.desired, a.observed, a.alignment, String(a.lastObservedAt ?? -1));
  }
  return digestOf(...parts);
}

/** Tamper-evident re-verification of a fleet rollup's digest. */
export function verifyFleetPostureDigest(rollup: FleetPostureRollup): boolean {
  return fleetDigest(rollup.tenantId, rollup.at, rollup.assets) === rollup.digest;
}
