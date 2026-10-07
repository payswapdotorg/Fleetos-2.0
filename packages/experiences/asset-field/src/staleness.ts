/**
 * @fleetos/experience-asset-field — observation recency classification.
 *
 * Vocabulary reuse (per the F240A packet): the repo's established staleness
 * vocabulary `fresh | stale | unknown`, classified by integer-millisecond
 * age thresholds against the last-known observation time.
 *
 *   - never observed (null)            -> "unknown"
 *   - age <= freshWithinMs             -> "fresh"
 *   - age <= staleWithinMs             -> "stale"
 *   - age beyond the staleness window  -> "unknown" (no longer trustworthy)
 *
 * OFFLINE TOLERANCE LAW: a classification of "stale"/"unknown" is an
 * explicit last-known declaration — views built on it must never claim
 * freshness. Field-mode views consume these readings to stamp every entry
 * with explicit last-known provenance.
 *
 * Determinism: no clock, no randomness, no I/O. `now` is caller-supplied.
 */

export type StalenessClass = "fresh" | "stale" | "unknown";

export interface RecencyThresholds {
  /** Age (integer ms) at or under which data is "fresh". */
  readonly freshWithinMs: number;
  /** Age (integer ms) at or under which data is "stale"; beyond -> "unknown". */
  readonly staleWithinMs: number;
}

export type RecencyRejection = "invalid-thresholds";

/** A classified reading: staleness class plus the exact age it derives from. */
export interface RecencyReading {
  readonly staleness: StalenessClass;
  readonly ageMs: number | null;
}

export type RecencyResult =
  | { readonly ok: true; readonly reading: RecencyReading }
  | { readonly ok: false; readonly rejected: RecencyRejection; readonly detail: string };

/** Reference thresholds (lane convention): fresh 60s, stale window 5min. */
export function defaultRecencyThresholds(): RecencyThresholds {
  return { freshWithinMs: 60_000, staleWithinMs: 300_000 };
}

/** Validate thresholds: integers with 0 <= freshWithinMs <= staleWithinMs. */
export function validateRecencyThresholds(thresholds: RecencyThresholds): boolean {
  return (
    Number.isInteger(thresholds.freshWithinMs) &&
    Number.isInteger(thresholds.staleWithinMs) &&
    thresholds.freshWithinMs >= 0 &&
    thresholds.staleWithinMs >= thresholds.freshWithinMs
  );
}

/**
 * Classify recency by age thresholds. Null last-observed => "unknown"
 * (never observed); an age beyond the staleness window => "unknown" (data
 * no longer trustworthy — the honest degradation, never "stale forever").
 * Negative ages (observation stamped in the future relative to `now`) are
 * clamped by comparison: they classify "fresh" exactly like age 0.
 */
export function classifyRecency(
  lastObservedAt: number | null,
  now: number,
  thresholds: RecencyThresholds,
): RecencyResult {
  if (!validateRecencyThresholds(thresholds)) {
    return {
      ok: false,
      rejected: "invalid-thresholds",
      detail: "thresholds must be integers with 0 <= freshWithinMs <= staleWithinMs",
    };
  }
  if (lastObservedAt === null) {
    return { ok: true, reading: { staleness: "unknown", ageMs: null } };
  }
  const ageMs = now - lastObservedAt;
  if (ageMs <= thresholds.freshWithinMs) {
    return { ok: true, reading: { staleness: "fresh", ageMs } };
  }
  if (ageMs <= thresholds.staleWithinMs) {
    return { ok: true, reading: { staleness: "stale", ageMs } };
  }
  return { ok: true, reading: { staleness: "unknown", ageMs } };
}
