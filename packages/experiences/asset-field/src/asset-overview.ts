/**
 * @fleetos/experience-asset-field — fleet overview read-model.
 *
 * One card per managed asset: identity (id, display name, kind,
 * lifecycle), status rollups (health posture + severity counts from
 * @fleetos/health findings; honest connectivity postures from
 * @fleetos/connectivity; observation recency classified fresh/stale/
 * unknown from twin lastObservedAt), fleet-wide counters, and a bounded
 * redacted scalar attribute excerpt. Cards are ordered by assetId — a
 * total deterministic order independent of input order.
 */

import { latestAttributes } from "@fleetos/assets";
import type { AssetKind, AssetLifecycleState } from "@fleetos/assets";
import { defaultHeartbeatTtl, honestPosture } from "@fleetos/connectivity";
import type { HeartbeatTtl } from "@fleetos/connectivity";
import { viewDigestOf } from "./digest.js";
import { buildStateIndexes } from "./indexes.js";
import type { ExperienceStateSlice } from "./state.js";
import {
  limitScalarFields,
  redactForPurpose,
  type ScalarFieldValue,
  type ViewRedactionRule,
} from "./redaction.js";
import { defaultRecencyThresholds, classifyRecency, type RecencyThresholds } from "./staleness.js";
import type { StalenessClass } from "./staleness.js";
import {
  guardView,
  SCHEMA_VERSION,
  tallySeverity,
  postureOf,
  emptySeverityCounts,
  type ViewResult,
  type SeverityCounts,
  type HealthPosture,
  type ConnectivityCounts,
  type RecencyCounts,
} from "./view-support.js";

const DEFAULT_ATTRIBUTE_LIMIT = 8;

export interface FleetOverviewOptions {
  readonly now: number;
  readonly thresholds?: RecencyThresholds;
  readonly ttl?: HeartbeatTtl;
  readonly rules?: readonly ViewRedactionRule[];
  /** Max attribute keys surfaced per card (sorted first). Default 8. */
  readonly attributeLimit?: number;
}

export interface AssetCard {
  readonly assetId: string;
  readonly displayName: string;
  readonly kind: AssetKind;
  readonly lifecycle: AssetLifecycleState;
  readonly deviceCount: number;
  readonly posture: HealthPosture;
  readonly severityCounts: SeverityCounts;
  readonly connectivity: ConnectivityCounts;
  readonly recency: RecencyCounts;
  readonly lastObservedAt: number | null;
  readonly lastObservedStaleness: StalenessClass;
  /** Redacted scalar attribute excerpt (primary device, bounded). */
  readonly attributes: Readonly<Record<string, ScalarFieldValue>>;
  readonly redactedFields: readonly string[];
}

export interface FleetCounters {
  readonly assets: number;
  readonly active: number;
  readonly admitted: number;
  readonly retired: number;
  readonly devices: number;
  readonly fresh: number;
  readonly stale: number;
  readonly unknown: number;
}

export interface FleetOverview {
  readonly schemaVersion: number;
  readonly tenantId: string;
  readonly asOf: number;
  readonly cards: readonly AssetCard[];
  readonly counters: FleetCounters;
  readonly digest: string;
}

function fleetOverviewDigestOf(overview: Omit<FleetOverview, "digest">): string {
  return viewDigestOf("fleet-overview", overview);
}

/** Recompute the fleet-overview digest; false means tampered content. */
export function verifyFleetOverviewDigest(overview: FleetOverview): boolean {
  const { digest, ...rest } = overview;
  return fleetOverviewDigestOf(rest) === digest;
}

/** Assemble the fleet overview: one card per asset, assetId order. */
export function assembleFleetOverview(
  state: ExperienceStateSlice,
  options: FleetOverviewOptions,
): ViewResult<FleetOverview> {
  const thresholds = options.thresholds ?? defaultRecencyThresholds();
  const ttl = options.ttl ?? defaultHeartbeatTtl();
  const attributeLimit = options.attributeLimit ?? DEFAULT_ATTRIBUTE_LIMIT;
  const refused = guardView(state, options.now, thresholds);
  if (refused) return refused;
  const indexes = buildStateIndexes(state);

  const cards: AssetCard[] = [];
  const counters = {
    assets: state.assets.length,
    active: 0,
    admitted: 0,
    retired: 0,
    devices: 0,
    fresh: 0,
    stale: 0,
    unknown: 0,
  };
  const assetsById = [...state.assets].sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const asset of assetsById) {
    if (asset.lifecycle === "active") counters.active += 1;
    else if (asset.lifecycle === "admitted") counters.admitted += 1;
    else counters.retired += 1;
    const devices = indexes.devicesByAsset.get(asset.id) ?? [];
    counters.devices += devices.length;

    const severity = emptySeverityCounts();
    let online = 0;
    let degraded = 0;
    let offline = 0;
    let connUnknown = 0;
    let fresh = 0;
    let stale = 0;
    let recUnknown = 0;
    let lastObservedAt: number | null = null;
    for (const device of devices) {
      for (const finding of indexes.findingsByDevice.get(device.id) ?? []) {
        tallySeverity(severity, finding.severity);
      }
      const posture = honestPosture(
        indexes.connectivityByDevice.get(device.id) ?? null,
        ttl,
        options.now,
      );
      if (posture === "online") online += 1;
      else if (posture === "degraded") degraded += 1;
      else if (posture === "offline") offline += 1;
      else connUnknown += 1;
      const observedAt = indexes.twinByDevice.get(device.id)?.lastObservedAt ?? null;
      const classified = classifyRecency(observedAt, options.now, thresholds);
      if (!classified.ok) return classified;
      if (classified.reading.staleness === "fresh") fresh += 1;
      else if (classified.reading.staleness === "stale") stale += 1;
      else recUnknown += 1;
      if (observedAt !== null && (lastObservedAt === null || observedAt > lastObservedAt)) {
        lastObservedAt = observedAt;
      }
    }
    const lastClassified = classifyRecency(lastObservedAt, options.now, thresholds);
    if (!lastClassified.ok) return lastClassified;

    const primary = devices[0] ?? null;
    const primaryTwin = primary ? indexes.twinByDevice.get(primary.id) : undefined;
    const redaction = primaryTwin
      ? redactForPurpose("fleet-overview", latestAttributes(primaryTwin), options.rules)
      : null;
    if (redaction && !redaction.ok) {
      return { ok: false, rejected: "unknown-purpose", detail: redaction.detail };
    }

    cards.push({
      assetId: asset.id,
      displayName: asset.displayName,
      kind: asset.kind,
      lifecycle: asset.lifecycle,
      deviceCount: devices.length,
      posture: postureOf(severity),
      severityCounts: severity,
      connectivity: { online, degraded, offline, unknown: connUnknown },
      recency: { fresh, stale, unknown: recUnknown },
      lastObservedAt,
      lastObservedStaleness: lastClassified.reading.staleness,
      attributes: redaction
        ? limitScalarFields(redaction.outcome.fields, attributeLimit)
        : {},
      redactedFields: redaction ? redaction.outcome.redactedFields : [],
    });
    counters.fresh += fresh;
    counters.stale += stale;
    counters.unknown += recUnknown;
  }

  const base: Omit<FleetOverview, "digest"> = {
    schemaVersion: SCHEMA_VERSION,
    tenantId: state.tenantId,
    asOf: options.now,
    cards,
    counters,
  };
  return { ok: true, view: { ...base, digest: fleetOverviewDigestOf(base) } };
}
