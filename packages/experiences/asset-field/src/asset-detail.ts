/**
 * @fleetos/experience-asset-field — asset detail sheet read-model.
 *
 * Per-asset detail: identity refs (asset + device identities with serials),
 * observation recency (twin lastObservedAt classified fresh/stale/unknown
 * plus admitted observation count + last kind), health posture (severity
 * rollup + bounded finding summaries), twin provenance (revision count,
 * last seq, head digest) and the redacted scalar attribute projection of
 * the primary device. Unknown asset ids are REFUSED — fail closed, no
 * partial sheet, no existence probing beyond the refusal itself.
 */

import { latestAttributes } from "@fleetos/assets";
import type { AssetKind, AssetLifecycleState } from "@fleetos/assets";
import { defaultHeartbeatTtl, honestPosture } from "@fleetos/connectivity";
import type { HeartbeatTtl, HonestPosture } from "@fleetos/connectivity";
import type { Severity } from "@fleetos/health";
import { viewDigestOf } from "./digest.js";
import { buildStateIndexes } from "./indexes.js";
import type { ExperienceStateSlice } from "./state.js";
import {
  redactForPurpose,
  type ScalarFieldValue,
  type ViewRedactionRule,
} from "./redaction.js";
import { classifyRecency, defaultRecencyThresholds, type RecencyThresholds } from "./staleness.js";
import type { StalenessClass } from "./staleness.js";
import {
  emptySeverityCounts,
  guardView,
  postureOf,
  SCHEMA_VERSION,
  tallySeverity,
  type HealthPosture,
  type SeverityCounts,
  type ViewResult,
} from "./view-support.js";

export interface AssetDetailOptions {
  readonly now: number;
  readonly assetId: string;
  readonly thresholds?: RecencyThresholds;
  readonly ttl?: HeartbeatTtl;
  readonly rules?: readonly ViewRedactionRule[];
}

export interface DeviceSheet {
  readonly deviceId: string;
  readonly serial: string;
  readonly enrolledAt: number;
  readonly connectivity: HonestPosture;
  readonly lastObservedAt: number | null;
  readonly staleness: StalenessClass;
  readonly ageMs: number | null;
  readonly revisionCount: number;
  readonly lastSeq: number | null;
  readonly headDigest: string | null;
  readonly observationCount: number;
  readonly lastObservationKind: string | null;
}

export interface FindingSummary {
  readonly code: string;
  readonly severity: Severity;
  readonly observedAt: number;
}

export interface AssetDetail {
  readonly schemaVersion: number;
  readonly tenantId: string;
  readonly asOf: number;
  readonly assetId: string;
  readonly displayName: string;
  readonly kind: AssetKind;
  readonly lifecycle: AssetLifecycleState;
  readonly createdAt: number;
  readonly devices: readonly DeviceSheet[];
  readonly posture: HealthPosture;
  readonly severityCounts: SeverityCounts;
  readonly findings: readonly FindingSummary[];
  /** Redacted scalar attributes of the primary (lowest-id) device. */
  readonly attributes: Readonly<Record<string, ScalarFieldValue>>;
  readonly redactedFields: readonly string[];
  readonly digest: string;
}

function assetDetailDigestOf(detail: Omit<AssetDetail, "digest">): string {
  return viewDigestOf("asset-detail", detail);
}

/** Recompute the asset-detail digest; false means tampered content. */
export function verifyAssetDetailDigest(detail: AssetDetail): boolean {
  const { digest, ...rest } = detail;
  return assetDetailDigestOf(rest) === digest;
}

/** Assemble the detail sheet for one asset of the tenant. */
export function assembleAssetDetail(
  state: ExperienceStateSlice,
  options: AssetDetailOptions,
): ViewResult<AssetDetail> {
  const thresholds = options.thresholds ?? defaultRecencyThresholds();
  const ttl = options.ttl ?? defaultHeartbeatTtl();
  const refused = guardView(state, options.now, thresholds);
  if (refused) return refused;
  const indexes = buildStateIndexes(state);
  const asset = indexes.assetById.get(options.assetId);
  if (!asset) {
    return {
      ok: false,
      rejected: "unknown-asset",
      detail: `asset ${options.assetId} is not part of tenant ${state.tenantId}`,
    };
  }
  const devices = indexes.devicesByAsset.get(asset.id) ?? [];

  const sheets: DeviceSheet[] = [];
  const severity = emptySeverityCounts();
  const findings: FindingSummary[] = [];
  for (const device of devices) {
    const twin = indexes.twinByDevice.get(device.id);
    const lastObservedAt = twin?.lastObservedAt ?? null;
    const classified = classifyRecency(lastObservedAt, options.now, thresholds);
    if (!classified.ok) return classified;
    const observations = indexes.observationsByDevice.get(device.id) ?? [];
    const lastObservation = observations[observations.length - 1] ?? null;
    const headRevision = twin?.revisions[twin.revisions.length - 1] ?? null;
    for (const finding of indexes.findingsByDevice.get(device.id) ?? []) {
      tallySeverity(severity, finding.severity);
      findings.push({
        code: finding.code,
        severity: finding.severity,
        observedAt: finding.observedAt,
      });
    }
    sheets.push({
      deviceId: device.id,
      serial: device.serial,
      enrolledAt: device.enrolledAt,
      connectivity: honestPosture(
        indexes.connectivityByDevice.get(device.id) ?? null,
        ttl,
        options.now,
      ),
      lastObservedAt,
      staleness: classified.reading.staleness,
      ageMs: classified.reading.ageMs,
      revisionCount: twin?.revisions.length ?? 0,
      lastSeq: twin?.lastSeq ?? null,
      headDigest:
        (headRevision as { readonly revisionDigest?: string } | null)?.revisionDigest ?? null,
      observationCount: observations.length,
      lastObservationKind: lastObservation?.kind ?? null,
    });
  }
  findings.sort((a, b) => {
    const rank: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
    const bySeverity = rank[a.severity] - rank[b.severity];
    if (bySeverity !== 0) return bySeverity;
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    return a.observedAt - b.observedAt;
  });

  const primary = devices[0] ?? null;
  const primaryTwin = primary ? indexes.twinByDevice.get(primary.id) : undefined;
  const redaction = primaryTwin
    ? redactForPurpose("asset-detail", latestAttributes(primaryTwin), options.rules)
    : null;
  if (redaction && !redaction.ok) {
    return { ok: false, rejected: "unknown-purpose", detail: redaction.detail };
  }

  const base: Omit<AssetDetail, "digest"> = {
    schemaVersion: SCHEMA_VERSION,
    tenantId: state.tenantId,
    asOf: options.now,
    assetId: asset.id,
    displayName: asset.displayName,
    kind: asset.kind,
    lifecycle: asset.lifecycle,
    createdAt: asset.createdAt,
    devices: sheets,
    posture: postureOf(severity),
    severityCounts: severity,
    findings,
    attributes: redaction ? redaction.outcome.fields : {},
    redactedFields: redaction ? redaction.outcome.redactedFields : [],
  };
  return { ok: true, view: { ...base, digest: assetDetailDigestOf(base) } };
}
