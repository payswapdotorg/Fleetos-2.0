/**
 * @fleetos/world-model — entity staleness classification (Wave 3, F230B).
 *
 * World entities (assets/agents/orgs as opaque refs) are classified
 * fresh / stale / unknown by integer-millisecond age thresholds against
 * their last observation. Never-observed entities classify "unknown"; an
 * age beyond the staleness window also classifies "unknown" (data no longer
 * trustworthy). All ages/thresholds are integer milliseconds.
 *
 * Deterministic: no clock, no randomness, no I/O.
 *
 * Split note (F230B lint conformance): these declarations moved verbatim
 * from `../world-fold.ts` (now the subpath barrel) to keep every src file
 * under the repo's max-lines lint budget. The exported surface is
 * symbol-for-symbol identical.
 */

import type { WorldEntityView } from "./journal.ts";

export type StalenessClass = "fresh" | "stale" | "unknown";

export interface StalenessThresholds {
  readonly freshWithinMs: number;
  readonly staleWithinMs: number;
}

export type StalenessResult =
  | { readonly ok: true; readonly staleness: StalenessClass; readonly ageMs: number | null }
  | { readonly ok: false; readonly rejected: "invalid-thresholds" };

/**
 * Classify staleness by age thresholds. Null last-observation => unknown
 * (never observed); an age beyond the staleness window => unknown (data no
 * longer trustworthy). Ages beyond `freshWithinMs` but within
 * `staleWithinMs` => stale. Thresholds must be integers with
 * 0 <= freshWithinMs <= staleWithinMs.
 */
export function classifyStaleness(
  lastObservedAtMs: number | null,
  nowMs: number,
  thresholds: StalenessThresholds,
): StalenessResult {
  if (
    !Number.isInteger(thresholds.freshWithinMs) ||
    !Number.isInteger(thresholds.staleWithinMs) ||
    thresholds.freshWithinMs < 0 ||
    thresholds.staleWithinMs < thresholds.freshWithinMs
  ) {
    return { ok: false, rejected: "invalid-thresholds" };
  }
  if (lastObservedAtMs === null) {
    return { ok: true, staleness: "unknown", ageMs: null };
  }
  const ageMs = nowMs - lastObservedAtMs;
  if (ageMs <= thresholds.freshWithinMs) return { ok: true, staleness: "fresh", ageMs };
  if (ageMs <= thresholds.staleWithinMs) return { ok: true, staleness: "stale", ageMs };
  return { ok: true, staleness: "unknown", ageMs };
}

export interface EntityProjection extends WorldEntityView {
  readonly staleness: StalenessClass;
  readonly ageMs: number | null;
}

export type EntityProjectionResult =
  | { readonly ok: true; readonly projection: EntityProjection }
  | { readonly ok: false; readonly rejected: "invalid-thresholds" };

/** Project a world entity with staleness classification at `nowMs`. */
export function projectEntity(
  entity: WorldEntityView,
  nowMs: number,
  thresholds: StalenessThresholds,
): EntityProjectionResult {
  const classified = classifyStaleness(
    entity.lastObservation ? entity.lastObservation.atMs : null,
    nowMs,
    thresholds,
  );
  if (!classified.ok) return { ok: false, rejected: classified.rejected };
  return {
    ok: true,
    projection: { ...entity, staleness: classified.staleness, ageMs: classified.ageMs },
  };
}
