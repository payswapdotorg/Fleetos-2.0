/**
 * @fleetos/predictive — Advisory staleness propagation (F280B, Wave 8 lane B).
 *
 * The staleness class of an advisory's INPUTS, propagated — never re-scored.
 *
 * The REAL chain: inputs are classified ONCE upstream by the world-model's
 * `classifyStaleness` (fresh / stale / unknown at classification time); this
 * module AGGREGATES the propagated classes into the advisory's headline
 * staleness (worst-of: unknown > stale > fresh) and fingerprints the
 * propagation. It performs NO classification of its own — there is no
 * timestamps-vs-now computation here, structurally: the aggregator never
 * sees a clock, so a card built from a propagation can never silently
 * re-derive a fresher class than the inputs were classified with.
 *
 * (This module deliberately does NOT import @fleetos/world-model — the
 * dependency edge runs world-model -> predictive; the staleness vocabulary
 * is a local structural mirror, the lane's established convention.)
 *
 * Laws:
 *  - A8: tenant fail-closed — a cross-tenant input REFUSES naming the
 *    offender (`staleness.tenant-mismatch`).
 *  - Determinism: no clock, no randomness, no I/O; identical inputs produce
 *    byte-identical propagations.
 */

// ---------------------------------------------------------------------------
// Vocabulary (local structural mirror — see header)
// ---------------------------------------------------------------------------

export type StalenessClassName = "fresh" | "stale" | "unknown";

/** One input's upstream-computed staleness class — propagated verbatim. */
export interface ClassifiedInput {
  /** Stable input reference (e.g. an observation ref). */
  readonly ref: string;
  readonly tenantId: string;
  /** The upstream REAL classification — never recomputed here. */
  readonly staleness: StalenessClassName;
  /** The age at classification time (null for never-observed inputs). */
  readonly ageMs: number | null;
  /** Logical epoch ms at which the upstream classification happened. */
  readonly classifiedAtMs: number;
}

export type StalenessRefusalCode =
  | "staleness.no-inputs"
  | "staleness.missing-ref"
  | "staleness.tenant-mismatch";

export type StalenessPropagationResult =
  | { readonly ok: true; readonly propagation: StalenessPropagation }
  | {
      readonly ok: false;
      readonly reason: StalenessRefusalCode;
      readonly offender: string | null;
    };

/** The propagated advisory staleness — the aggregate of input classes. */
export interface StalenessPropagation {
  readonly tenantId: string;
  /** Worst-of the inputs' classes: unknown > stale > fresh. */
  readonly headline: StalenessClassName;
  /** The input that determined the headline (canonical pick: first by ref). */
  readonly headlineRef: string;
  /** The headline input's age AT CLASSIFICATION TIME (never re-derived). */
  readonly headlineAgeMs: number | null;
  /** All inputs, verbatim, ordered by ref. */
  readonly inputs: readonly ClassifiedInput[];
  /** FNV-1a over the canonical propagation content. */
  readonly propagationDigest: string;
  /** Machine-carried: this propagation performed NO re-scoring. */
  readonly rescored: false;
}

// ---------------------------------------------------------------------------
// Propagation — aggregate, never classify
// ---------------------------------------------------------------------------

const STALENESS_RANK: Readonly<Record<StalenessClassName, number>> = {
  fresh: 0,
  stale: 1,
  unknown: 2,
};

/**
 * Propagate the inputs' staleness classes into the advisory headline.
 *
 * Refuses: no inputs, an input with an empty ref, or a cross-tenant input
 * (A8 — the offender ref is named).
 */
export function propagateStaleness(
  inputs: readonly ClassifiedInput[],
  tenantId: string,
): StalenessPropagationResult {
  if (inputs.length === 0) {
    return { ok: false, reason: "staleness.no-inputs", offender: null };
  }
  if (tenantId === "") {
    return { ok: false, reason: "staleness.tenant-mismatch", offender: null };
  }
  for (const input of inputs) {
    if (input.ref === "") {
      return { ok: false, reason: "staleness.missing-ref", offender: null };
    }
    if (input.tenantId !== tenantId) {
      return { ok: false, reason: "staleness.tenant-mismatch", offender: input.ref };
    }
  }
  // Canonical input order — arrival order never leaks.
  const ordered = [...inputs].sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
  // Worst-of aggregation; the headline input is the CANONICAL FIRST (lowest
  // ref) among the worst class — deterministic.
  let headlineInput = ordered[0]!;
  for (const input of ordered) {
    if (STALENESS_RANK[input.staleness] > STALENESS_RANK[headlineInput.staleness]) {
      headlineInput = input;
    }
  }
  const propagation: StalenessPropagation = {
    tenantId,
    headline: headlineInput.staleness,
    headlineRef: headlineInput.ref,
    headlineAgeMs: headlineInput.ageMs,
    inputs: ordered,
    propagationDigest: fnv1a(
      `staleness|v1|${canonicalJson({
        tenantId,
        headline: headlineInput.staleness,
        inputs: ordered.map((i) => [i.ref, i.staleness, i.ageMs, i.classifiedAtMs]),
      })}`,
    ),
    rescored: false,
  };
  return { ok: true, propagation };
}

/**
 * Verify a propagation's integrity — the digest recomputes and the headline
 * is exactly the worst-of aggregation of the carried inputs (a forged
 * headline, e.g. a "fresh" stamp over stale inputs, FAILS).
 */
export function verifyStalenessPropagation(
  propagation: StalenessPropagation,
): { readonly verified: boolean; readonly reason: "staleness.digest-mismatch" | "staleness.headline-mismatch" | null } {
  const recomputed = propagateStaleness(propagation.inputs, propagation.tenantId);
  if (!recomputed.ok) return { verified: false, reason: "staleness.headline-mismatch" };
  const expected = recomputed.propagation;
  if (propagation.propagationDigest !== expected.propagationDigest) {
    return { verified: false, reason: "staleness.digest-mismatch" };
  }
  if (
    propagation.headline !== expected.headline ||
    propagation.headlineRef !== expected.headlineRef ||
    propagation.headlineAgeMs !== expected.headlineAgeMs
  ) {
    return { verified: false, reason: "staleness.headline-mismatch" };
  }
  return { verified: true, reason: null };
}

// ---------------------------------------------------------------------------
// Deterministic digest (local — the lane's convention)
// ---------------------------------------------------------------------------

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return value === undefined ? "null" : (JSON.stringify(value) ?? "null");
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(",")}]`;
  }
  const rec = value as Record<string, unknown>;
  const keys = Object.keys(rec).filter((k) => rec[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(rec[k])}`).join(",")}}`;
}
