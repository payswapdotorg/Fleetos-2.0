/**
 * @fleetos/experience-asset-field — health board read-model.
 *
 * Posture rollup over @fleetos/health findings, grouped per asset: the
 * fleet's health at a glance. Rows carry the per-asset severity counts and
 * the worst finding (highest severity, then code, then observedAt — total
 * deterministic order); the board carries fleet counters including
 * devices with no findings at all. Rows are ordered worst-posture-first
 * (critical, warning, info, clear), then assetId.
 */

import { viewDigestOf } from "../digest.js";
import { buildStateIndexes } from "../indexes.js";
import type { ExperienceStateSlice } from "../state.js";
import type { Severity } from "@fleetos/health";
import { defaultRecencyThresholds, type RecencyThresholds } from "../staleness.js";
import {
  emptySeverityCounts,
  guardView,
  postureOf,
  SCHEMA_VERSION,
  tallySeverity,
  type HealthPosture,
  type SeverityCounts,
  type ViewResult,
} from "../view-support.js";

export interface HealthBoardOptions {
  readonly now: number;
  readonly thresholds?: RecencyThresholds;
}

export interface HealthRow {
  readonly assetId: string;
  readonly displayName: string;
  readonly posture: HealthPosture;
  readonly severityCounts: SeverityCounts;
  readonly deviceCount: number;
  /** Devices of this asset carrying no findings at all. */
  readonly devicesWithNoFindings: number;
  readonly worstFinding: { readonly code: string; readonly severity: string; readonly observedAt: number } | null;
}

export interface HealthBoard {
  readonly schemaVersion: number;
  readonly tenantId: string;
  readonly asOf: number;
  readonly rows: readonly HealthRow[];
  readonly fleet: {
    readonly assets: number;
    readonly critical: number;
    readonly warning: number;
    readonly info: number;
    readonly clear: number;
    readonly devicesWithNoFindings: number;
  };
  readonly digest: string;
}

const POSTURE_RANK: Readonly<Record<HealthPosture, number>> = {
  critical: 0,
  warning: 1,
  info: 2,
  clear: 3,
};

const SEVERITY_RANK: Readonly<Record<Severity, number>> = {
  critical: 0,
  warning: 1,
  info: 2,
};

function healthBoardDigestOf(board: Omit<HealthBoard, "digest">): string {
  return viewDigestOf("health-board", board);
}

/** Recompute the health-board digest; false means tampered content. */
export function verifyHealthBoardDigest(board: HealthBoard): boolean {
  const { digest, ...rest } = board;
  return healthBoardDigestOf(rest) === digest;
}

/** Assemble the health posture board. */
export function assembleHealthBoard(
  state: ExperienceStateSlice,
  options: HealthBoardOptions,
): ViewResult<HealthBoard> {
  const refused = guardView(state, options.now, options.thresholds ?? defaultRecencyThresholds());
  if (refused) return refused;
  const indexes = buildStateIndexes(state);

  const rows: HealthRow[] = [];
  let fleetCritical = 0;
  let fleetWarning = 0;
  let fleetInfo = 0;
  let fleetClear = 0;
  let fleetNoFindings = 0;
  const assetsById = [...state.assets].sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const asset of assetsById) {
    const devices = indexes.devicesByAsset.get(asset.id) ?? [];
    const severity = emptySeverityCounts();
    let devicesWithNoFindings = 0;
    for (const device of devices) {
      const deviceFindings = indexes.findingsByDevice.get(device.id) ?? [];
      if (deviceFindings.length === 0) {
        devicesWithNoFindings += 1;
        fleetNoFindings += 1;
      }
      for (const finding of deviceFindings) {
        tallySeverity(severity, finding.severity);
      }
    }
    const assetFindings = devices
      .flatMap((device) => indexes.findingsByDevice.get(device.id) ?? [])
      .sort((a, b) => {
        const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
        if (bySeverity !== 0) return bySeverity;
        if (a.code !== b.code) return a.code < b.code ? -1 : 1;
        return a.observedAt - b.observedAt;
      });
    const worstFinding = assetFindings[0] ?? null;
    const posture = postureOf(severity);
    if (posture === "critical") fleetCritical += 1;
    else if (posture === "warning") fleetWarning += 1;
    else if (posture === "info") fleetInfo += 1;
    else fleetClear += 1;
    rows.push({
      assetId: asset.id,
      displayName: asset.displayName,
      posture,
      severityCounts: severity,
      deviceCount: devices.length,
      devicesWithNoFindings,
      worstFinding:
        worstFinding === null
          ? null
          : {
              code: worstFinding.code,
              severity: worstFinding.severity,
              observedAt: worstFinding.observedAt,
            },
    });
  }
  rows.sort((a, b) => {
    const byPosture = POSTURE_RANK[a.posture] - POSTURE_RANK[b.posture];
    if (byPosture !== 0) return byPosture;
    return a.assetId < b.assetId ? -1 : 1;
  });

  const base: Omit<HealthBoard, "digest"> = {
    schemaVersion: SCHEMA_VERSION,
    tenantId: state.tenantId,
    asOf: options.now,
    rows,
    fleet: {
      assets: state.assets.length,
      critical: fleetCritical,
      warning: fleetWarning,
      info: fleetInfo,
      clear: fleetClear,
      devicesWithNoFindings: fleetNoFindings,
    },
  };
  return { ok: true, view: { ...base, digest: healthBoardDigestOf(base) } };
}
