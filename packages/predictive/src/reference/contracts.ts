/**
 * @fleetos/predictive — reference twin model CONTRACTS (Wave 3, F230B).
 *
 * LAW (AGENTS.md / ARCHITECTURE-LOCK A2): "Predictive output is advisory and
 * never authoritative." These contracts make advisory-ness STRUCTURAL:
 *
 *   - every projection result is a `Prediction` carrying a machine-carried
 *     `advisory: true` marker that cannot be stripped by the type system;
 *   - advisory values are NEVER accepted back as authoritative inputs —
 *     `TwinStateInput` (the authoritative-shaped input) requires an
 *     observation history with observation refs, and no function accepts a
 *     `Prediction`/`HypotheticalProjection` as state;
 *   - there is NO write effect anywhere in this module (pure types + one
 *     pure runtime guard).
 *
 * LAW A11: OBSERVED / PREDICTED / HYPOTHETICAL stay semantically distinct —
 * a counterfactual projection is a `HypotheticalProjection` (`kind:
 * "HYPOTHETICAL"`, `hypothetical: true`), never a `Prediction`, never an
 * observation.
 *
 * LAW A12: deterministic reference path — the implementation (in
 * `./model.ts`) is a pure function; no GPU, no provider, no I/O, no wall
 * clock, no Math.random. Same inputs => byte-identical outputs (replayable
 * + auditable via input digests).
 *
 * Numeric honesty: confidences are INTEGER basis points (0..10000). Bounds
 * and projected values use float arithmetic (division for the least-squares
 * drift, Math.sqrt for horizon widening) rounded to fixed decimal scales
 * (1e-6 for values/bounds, 1e-9 for the drift) so outputs are stable and
 * platform-independent; every float use is documented at its site.
 *
 * Split note (F230B lint conformance): these declarations moved verbatim
 * from `../reference-model.ts` (now the subpath barrel) to keep every src
 * file under the repo's max-lines lint budget. The exported surface is
 * symbol-for-symbol identical.
 */

import type { AssetRef, TenantScopeLike } from "../index.ts";

// ---------------------------------------------------------------------------
// Model identity
// ---------------------------------------------------------------------------

/** Version of the deterministic reference twin model (provenance-carried). */
export const REFERENCE_MODEL_VERSION = "reference-twin-1.0.0" as const;

/** Hard cap on projection steps — rejects runaway horizons honestly. */
export const MAX_PROJECTION_STEPS = 1000;

/** Minimum half-width of a bound interval (reference-model floor, in value units). */
export const MIN_BOUND_HALF_WIDTH = 0.5;

// ---------------------------------------------------------------------------
// Inputs (authoritative-shaped; supplied by the caller, never by this model)
// ---------------------------------------------------------------------------

/** One immutable observation in the twin's history (law A3). */
export interface TwinObservation {
  readonly observationRef: string;
  readonly atMs: number;
  readonly value: number;
}

/**
 * Structurally-typed twin state input — the AUTHORITATIVE side of the seam.
 * It can only be built from real observation refs; a Prediction cannot be
 * assigned to it (no `observations` field, no per-observation refs).
 */
export interface TwinStateInput {
  readonly tenant: TenantScopeLike;
  readonly asset: AssetRef;
  readonly metric: string;
  readonly observations: readonly TwinObservation[];
  readonly asOfMs: number;
}

/** Projection horizon — integer steps of an integer millisecond span. */
export interface ProjectionHorizon {
  readonly steps: number;
  readonly stepMs: number;
}

// ---------------------------------------------------------------------------
// Outputs (advisory side of the seam)
// ---------------------------------------------------------------------------

/** Bound interval for one projected point (float bounds, rounded to 1e-6). */
export interface BoundInterval {
  readonly lower: number;
  readonly upper: number;
}

/** One projected point — ADVISORY ONLY. Confidence is integer basis points. */
export interface ProjectedPoint {
  readonly step: number;
  readonly atMs: number;
  readonly value: number;
  readonly bounds: BoundInterval;
  readonly confidenceBps: number;
}

/** Provenance — makes every prediction replayable and auditable. */
export interface PredictionProvenance {
  readonly modelVersion: string;
  readonly method: "reference.linear-drift";
  readonly observationRefs: readonly string[];
  readonly inputDigest: string;
}

/**
 * A prediction — the advisory result envelope.
 *
 * `advisory: true` is machine-carried: the type system cannot strip it, and
 * runtime guards (`isAdvisoryPrediction`) can verify it on untrusted input.
 */
export interface Prediction {
  readonly kind: "PREDICTION";
  readonly advisory: true;
  readonly tenant: TenantScopeLike;
  readonly asset: AssetRef;
  readonly metric: string;
  readonly originMs: number;
  readonly horizon: ProjectionHorizon;
  readonly points: readonly ProjectedPoint[];
  readonly provenance: PredictionProvenance;
}

/** Rejection reason codes for projection attempts. */
export type ProjectionRejection =
  | "missing-tenant"
  | "empty-history"
  | "invalid-observation-ref"
  | "non-monotonic-times"
  | "invalid-horizon"
  | "horizon-too-large"
  | "unknown-intervention"
  | "invalid-intervention";

export type ProjectionResult =
  | { readonly ok: true; readonly prediction: Prediction }
  | { readonly ok: false; readonly rejected: ProjectionRejection; readonly detail: string };

// ---------------------------------------------------------------------------
// Counterfactuals (law A11 — HYPOTHETICAL is a distinct semantic kind)
// ---------------------------------------------------------------------------

/** A structured what-if intervention applied to a baseline projection. */
export type CounterfactualIntervention =
  | { readonly kind: "offset"; readonly offset: number }
  | { readonly kind: "scale"; readonly factor: number }
  | { readonly kind: "hold"; readonly value: number }
  | { readonly kind: "set-drift"; readonly driftPerStepMs: number }
  | { readonly kind: "truncate-history"; readonly dropCount: number };

export interface CounterfactualInput {
  readonly baseline: TwinStateInput;
  readonly horizon: ProjectionHorizon;
  readonly premise: string;
  readonly intervention: CounterfactualIntervention;
}

/** Divergence accounting — which outputs changed, by how much. */
export interface DivergenceEntry {
  readonly step: number;
  readonly atMs: number;
  readonly baselineValue: number;
  readonly counterfactualValue: number;
  /** counterfactual - baseline, rounded to 1e-6. */
  readonly delta: number;
  /** Integer bps of the baseline value; null when the baseline value is 0. */
  readonly deltaBpsOfBaseline: number | null;
}

/**
 * A counterfactual projection — HYPOTHETICAL, never a Prediction, never an
 * observation. Carries the machine-carried `hypothetical: true` marker and
 * full divergence accounting against the baseline.
 */
export interface HypotheticalProjection {
  readonly kind: "HYPOTHETICAL";
  readonly hypothetical: true;
  readonly premise: string;
  readonly tenant: TenantScopeLike;
  readonly asset: AssetRef;
  readonly metric: string;
  readonly originMs: number;
  readonly horizon: ProjectionHorizon;
  readonly points: readonly ProjectedPoint[];
  readonly divergence: readonly DivergenceEntry[];
  readonly changedSteps: readonly number[];
  readonly baselineProvenance: PredictionProvenance;
  readonly provenance: PredictionProvenance;
}

export type CounterfactualResult =
  | { readonly ok: true; readonly projection: HypotheticalProjection }
  | { readonly ok: false; readonly rejected: ProjectionRejection; readonly detail: string };

// ---------------------------------------------------------------------------
// ModelPort — the adapter seam (Wave 5 / F290B JEPA family plugs in here)
// ---------------------------------------------------------------------------

/**
 * ModelPort — the TYPE seam external model adapters implement. The
 * deterministic reference model sits behind the SAME port (A12), so callers
 * cannot tell — and must not care — whether they are talking to the
 * reference model or a future learned model. Implementations MUST be
 * deterministic and MUST be advisory-only.
 */
export interface ModelPort {
  readonly name: string;
  readonly modelVersion: string;
  readonly project: (input: TwinStateInput, horizon: ProjectionHorizon) => ProjectionResult;
  readonly runCounterfactual: (input: CounterfactualInput) => CounterfactualResult;
}

// ---------------------------------------------------------------------------
// Advisory envelope runtime guard
// ---------------------------------------------------------------------------

/**
 * Runtime guard for the advisory envelope: verifies the machine-carried
 * `advisory: true` marker survives transit through untrusted JSON.
 */
export function isAdvisoryPrediction(v: unknown): v is Prediction {
  if (typeof v !== "object" || v === null) return false;
  const rec = v as { kind?: unknown; advisory?: unknown; points?: unknown };
  return rec.kind === "PREDICTION" && rec.advisory === true && Array.isArray(rec.points);
}
