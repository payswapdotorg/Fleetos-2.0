/**
 * @fleetos/experience-asset-field — shared view vocabulary + helpers.
 *
 * Private support module for the read-model assemblies: the common
 * rejection/result shapes, severity + posture rollup vocabulary, and the
 * common guard step (state guard + threshold validation) every view runs
 * before projecting.
 */

import type { Severity } from "@fleetos/health";
import { guardExperienceState, type ExperienceStateSlice, type StateRejection } from "./state.js";
import { classifyRecency, type RecencyThresholds } from "./staleness.js";

export const SCHEMA_VERSION = 1;

export type ViewRejection = StateRejection | "invalid-thresholds" | "unknown-asset" | "unknown-purpose";

export type ViewResult<T> =
  | { readonly ok: true; readonly view: T }
  | { readonly ok: false; readonly rejected: ViewRejection; readonly detail: string };

export interface SeverityCounts {
  readonly critical: number;
  readonly warning: number;
  readonly info: number;
}

export type HealthPosture = "critical" | "warning" | "info" | "clear";

export interface ConnectivityCounts {
  readonly online: number;
  readonly degraded: number;
  readonly offline: number;
  readonly unknown: number;
}

export interface RecencyCounts {
  readonly fresh: number;
  readonly stale: number;
  readonly unknown: number;
}

export function emptySeverityCounts(): { critical: number; warning: number; info: number } {
  return { critical: 0, warning: 0, info: 0 };
}

export function postureOf(counts: SeverityCounts): HealthPosture {
  if (counts.critical > 0) return "critical";
  if (counts.warning > 0) return "warning";
  if (counts.info > 0) return "info";
  return "clear";
}

export function tallySeverity(
  counts: { critical: number; warning: number; info: number },
  severity: Severity,
): void {
  if (severity === "critical") counts.critical += 1;
  else if (severity === "warning") counts.warning += 1;
  else counts.info += 1;
}

/**
 * The common guard step: tenant/now state guard + recency threshold
 * validation. Returns the failure half of a ViewResult, or null when the
 * view may proceed.
 */
export function guardView(
  state: ExperienceStateSlice,
  now: number,
  thresholds: RecencyThresholds,
): { readonly ok: false; readonly rejected: ViewRejection; readonly detail: string } | null {
  const guarded = guardExperienceState(state, now);
  if (!guarded.ok) return guarded;
  const classified = classifyRecency(null, now, thresholds);
  if (!classified.ok) return classified;
  return null;
}
