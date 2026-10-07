/**
 * @fleetos/predictive — deterministic reference twin model (Wave 3, F230B).
 *
 * LAW (AGENTS.md / ARCHITECTURE-LOCK A2): "Predictive output is advisory and
 * never authoritative." This module makes advisory-ness STRUCTURAL:
 *
 *   - every projection result is a `Prediction` carrying a machine-carried
 *     `advisory: true` marker that cannot be stripped by the type system;
 *   - advisory values are NEVER accepted back as authoritative inputs —
 *     `TwinStateInput` (the authoritative-shaped input) requires an
 *     observation history with observation refs, and no function in this
 *     module accepts a `Prediction`/`HypotheticalProjection` as state;
 *   - there is NO write effect anywhere in this module (pure functions only).
 *
 * LAW A11: OBSERVED / PREDICTED / HYPOTHETICAL stay semantically distinct —
 * a counterfactual projection is a `HypotheticalProjection` (`kind:
 * "HYPOTHETICAL"`, `hypothetical: true`), never a `Prediction`, never an
 * observation.
 *
 * LAW A12: deterministic reference path — the model is a pure function; no
 * GPU, no provider, no I/O, no wall clock, no Math.random. Same inputs =>
 * byte-identical outputs (replayable + auditable via input digests).
 *
 * Numeric honesty: confidences are INTEGER basis points (0..10000). Bounds
 * and projected values use float arithmetic (division for the least-squares
 * drift, Math.sqrt for horizon widening) rounded to fixed decimal scales
 * (1e-6 for values/bounds, 1e-9 for the drift) so outputs are stable and
 * platform-independent; every float use is documented at its site.
 */

import type { AssetRef, TenantScopeLike } from "./index.ts";

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
// Reference model — pure deterministic math
// ---------------------------------------------------------------------------

interface FittedSeries {
  readonly lastAtMs: number;
  readonly lastValue: number;
  readonly driftPerMs: number;
  readonly residualSpread: number;
  readonly observationRefs: readonly string[];
}

function fitSeries(observations: readonly TwinObservation[]): FittedSeries {
  const n = observations.length;
  const last = observations[n - 1] as TwinObservation;
  if (n === 1) {
    return {
      lastAtMs: last.atMs,
      lastValue: last.value,
      driftPerMs: 0,
      residualSpread: 0,
      observationRefs: [last.observationRef],
    };
  }
  // Least-squares drift over (atMs, value). Float division — rounded to 1e-9.
  const x0 = (observations[0] as TwinObservation).atMs;
  const xs = observations.map((o) => o.atMs - x0);
  const ys = observations.map((o) => o.value);
  const xMean = xs.reduce((a, b) => a + b, 0) / n; // float division
  const yMean = ys.reduce((a, b) => a + b, 0) / n; // float division
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = (xs[i] as number) - xMean;
    const dy = (ys[i] as number) - yMean;
    sxx += dx * dx;
    sxy += dx * dy;
  }
  const drift = sxx === 0 ? 0 : round9(sxy / sxx);
  // Residual spread against the drift line anchored at the last observation.
  let maxAbsResidual = 0;
  for (let i = 0; i < n; i += 1) {
    const fitted = last.value + drift * ((observations[i] as TwinObservation).atMs - last.atMs);
    const residual = Math.abs((ys[i] as number) - fitted);
    if (residual > maxAbsResidual) maxAbsResidual = residual;
  }
  return {
    lastAtMs: last.atMs,
    lastValue: last.value,
    driftPerMs: drift,
    residualSpread: round6(maxAbsResidual),
    observationRefs: observations.map((o) => o.observationRef),
  };
}

function validateCommon(
  input: TwinStateInput,
  horizon: ProjectionHorizon,
): ProjectionRejection | null {
  if (input.tenant.tenantId === "") return "missing-tenant";
  if (input.observations.length === 0) return "empty-history";
  for (const o of input.observations) {
    if (o.observationRef === "") return "invalid-observation-ref";
  }
  for (let i = 1; i < input.observations.length; i += 1) {
    const prev = input.observations[i - 1] as TwinObservation;
    const cur = input.observations[i] as TwinObservation;
    if (cur.atMs <= prev.atMs) return "non-monotonic-times";
  }
  if (
    !Number.isInteger(horizon.steps) ||
    horizon.steps < 1 ||
    !Number.isInteger(horizon.stepMs) ||
    horizon.stepMs < 1
  ) {
    return "invalid-horizon";
  }
  if (horizon.steps > MAX_PROJECTION_STEPS) return "horizon-too-large";
  return null;
}

function baseConfidenceBps(observationCount: number): number {
  // Integer bps only: 1000 bps per observation, clamped to [1000, 9000].
  const raw = 1000 * observationCount;
  return Math.min(9000, Math.max(1000, raw));
}

function stepConfidenceBps(base: number, step: number): number {
  // Integer bps, monotonically non-increasing in the horizon, floored at 500.
  return Math.max(500, base - 250 * (step - 1));
}

/**
 * The deterministic reference projection: last-value anchor + least-squares
 * drift, bounds widening with sqrt(step), integer-bps confidence decaying
 * with the horizon. Pure — no clock, no randomness, no I/O.
 */
export function projectReferenceTwin(
  input: TwinStateInput,
  horizon: ProjectionHorizon,
): ProjectionResult {
  const rejected = validateCommon(input, horizon);
  if (rejected !== null) {
    return { ok: false, rejected, detail: detailFor(rejected) };
  }
  const fit = fitSeries(input.observations);
  const baseBps = baseConfidenceBps(input.observations.length);
  const baseHalfWidth = Math.max(fit.residualSpread, MIN_BOUND_HALF_WIDTH);
  const points: ProjectedPoint[] = [];
  for (let k = 1; k <= horizon.steps; k += 1) {
    const atMs = input.asOfMs + k * horizon.stepMs;
    // Float multiply — rounded to 1e-6.
    const value = round6(fit.lastValue + fit.driftPerMs * (k * horizon.stepMs));
    // Float sqrt widening — rounded to 1e-6.
    const halfWidth = round6(baseHalfWidth * (1 + Math.sqrt(k)));
    points.push({
      step: k,
      atMs,
      value,
      bounds: { lower: round6(value - halfWidth), upper: round6(value + halfWidth) },
      confidenceBps: stepConfidenceBps(baseBps, k),
    });
  }
  return {
    ok: true,
    prediction: {
      kind: "PREDICTION",
      advisory: true,
      tenant: input.tenant,
      asset: input.asset,
      metric: input.metric,
      originMs: input.asOfMs,
      horizon,
      points,
      provenance: {
        modelVersion: REFERENCE_MODEL_VERSION,
        method: "reference.linear-drift",
        observationRefs: fit.observationRefs,
        inputDigest: digestTwinInput(input, horizon),
      },
    },
  };
}

function counterfactualPointsFor(
  intervention: CounterfactualIntervention,
  baseline: Prediction,
  fit: FittedSeries,
  baseBps: number,
  baseHalfWidth: number,
): readonly ProjectedPoint[] {
  const points: ProjectedPoint[] = [];
  for (let k = 1; k <= baseline.horizon.steps; k += 1) {
    const basePoint = baseline.points[k - 1] as ProjectedPoint;
    let value: number;
    switch (intervention.kind) {
      case "offset":
        value = round6(basePoint.value + intervention.offset);
        break;
      case "scale":
        value = round6(basePoint.value * intervention.factor);
        break;
      case "hold":
        value = round6(intervention.value);
        break;
      case "set-drift":
        value = round6(fit.lastValue + intervention.driftPerStepMs * (k * baseline.horizon.stepMs));
        break;
      case "truncate-history":
        value = basePoint.value;
        break;
    }
    // Law A11: hypothetical is LESS certain — bounds widened 2x, confidence halved (integer floor).
    const widenedHalf = round6(baseHalfWidth * (1 + Math.sqrt(k)) * 2);
    const cfConfidence = Math.max(0, Math.floor(stepConfidenceBps(baseBps, k) / 2));
    points.push({
      step: k,
      atMs: basePoint.atMs,
      value,
      bounds: { lower: round6(value - widenedHalf), upper: round6(value + widenedHalf) },
      confidenceBps: cfConfidence,
    });
  }
  return points;
}

/**
 * Run a counterfactual: a divergent projection under a structured what-if
 * intervention, with full divergence accounting against the baseline.
 * The result is a `HypotheticalProjection` — never a Prediction (law A11).
 */
export function runReferenceCounterfactual(input: CounterfactualInput): CounterfactualResult {
  const baselineRun = projectReferenceTwin(input.baseline, input.horizon);
  if (!baselineRun.ok) {
    return { ok: false, rejected: baselineRun.rejected, detail: baselineRun.detail };
  }
  const baseline = baselineRun.prediction;

  // Intervention validation (after baseline validation — deterministic order).
  switch (input.intervention.kind) {
    case "offset":
    case "scale":
    case "hold":
    case "set-drift":
      break;
    case "truncate-history":
      if (
        !Number.isInteger(input.intervention.dropCount) ||
        input.intervention.dropCount < 1 ||
        input.intervention.dropCount >= input.baseline.observations.length
      ) {
        return {
          ok: false,
          rejected: "invalid-intervention",
          detail: "truncate-history requires an integer dropCount in [1, observations-1]",
        };
      }
      break;
    default:
      return {
        ok: false,
        rejected: "unknown-intervention",
        detail: `unknown intervention kind: ${String((input.intervention as { kind?: unknown }).kind)}`,
      };
  }

  const fit = fitSeries(input.baseline.observations);
  const baseBps = baseConfidenceBps(input.baseline.observations.length);

  if (input.intervention.kind === "truncate-history") {
    // Re-fit on the truncated history (fewer observations => honestly lower confidence).
    const kept = input.baseline.observations.slice(
      0,
      input.baseline.observations.length - input.intervention.dropCount,
    );
    const fit = fitSeries(kept);
    const baseBps = baseConfidenceBps(kept.length);
    // The counterfactual series itself is re-projected from the truncated fit.
    const cfPoints: ProjectedPoint[] = [];
    for (let k = 1; k <= input.horizon.steps; k += 1) {
      const value = round6(fit.lastValue + fit.driftPerMs * (k * input.horizon.stepMs));
      const baseHalfWidth = Math.max(fit.residualSpread, MIN_BOUND_HALF_WIDTH);
      const widenedHalf = round6(baseHalfWidth * (1 + Math.sqrt(k)) * 2);
      cfPoints.push({
        step: k,
        atMs: input.baseline.asOfMs + k * input.horizon.stepMs,
        value,
        bounds: { lower: round6(value - widenedHalf), upper: round6(value + widenedHalf) },
        confidenceBps: Math.max(0, Math.floor(stepConfidenceBps(baseBps, k) / 2)),
      });
    }
    const divergence = divergenceBetween(baseline, cfPoints);
    return {
      ok: true,
      projection: {
        kind: "HYPOTHETICAL",
        hypothetical: true,
        premise: input.premise,
        tenant: input.baseline.tenant,
        asset: input.baseline.asset,
        metric: input.baseline.metric,
        originMs: input.baseline.asOfMs,
        horizon: input.horizon,
        points: cfPoints,
        divergence: divergence.entries,
        changedSteps: divergence.changedSteps,
        baselineProvenance: baseline.provenance,
        provenance: {
          modelVersion: REFERENCE_MODEL_VERSION,
          method: "reference.linear-drift",
          observationRefs: fit.observationRefs,
          inputDigest: digestCounterfactualInput(input),
        },
      },
    };
  }

  const baseHalfWidth = Math.max(fit.residualSpread, MIN_BOUND_HALF_WIDTH);
  const cfPoints = counterfactualPointsFor(
    input.intervention,
    baseline,
    fit,
    baseBps,
    baseHalfWidth,
  );
  const divergence = divergenceBetween(baseline, cfPoints);
  return {
    ok: true,
    projection: {
      kind: "HYPOTHETICAL",
      hypothetical: true,
      premise: input.premise,
      tenant: input.baseline.tenant,
      asset: input.baseline.asset,
      metric: input.baseline.metric,
      originMs: input.baseline.asOfMs,
      horizon: input.horizon,
      points: cfPoints,
      divergence: divergence.entries,
      changedSteps: divergence.changedSteps,
      baselineProvenance: baseline.provenance,
      provenance: {
        modelVersion: REFERENCE_MODEL_VERSION,
        method: "reference.linear-drift",
        observationRefs: fit.observationRefs,
        inputDigest: digestCounterfactualInput(input),
      },
    },
  };
}

function divergenceBetween(
  baseline: Prediction,
  cfPoints: readonly ProjectedPoint[],
): { entries: readonly DivergenceEntry[]; changedSteps: readonly number[] } {
  const entries: DivergenceEntry[] = [];
  const changedSteps: number[] = [];
  for (let k = 1; k <= baseline.points.length; k += 1) {
    const basePoint = baseline.points[k - 1] as ProjectedPoint;
    const cfPoint = cfPoints[k - 1] as ProjectedPoint;
    const delta = round6(cfPoint.value - basePoint.value);
    // Integer bps relative change; null when the baseline value is exactly 0.
    const deltaBps =
      basePoint.value === 0 ? null : Math.round((10000 * delta) / basePoint.value);
    entries.push({
      step: k,
      atMs: basePoint.atMs,
      baselineValue: basePoint.value,
      counterfactualValue: cfPoint.value,
      delta,
      deltaBpsOfBaseline: deltaBps,
    });
    if (delta !== 0) changedSteps.push(k);
  }
  return { entries, changedSteps };
}

/**
 * The in-memory deterministic reference adapter implementing ModelPort.
 * External adapters (Wave 5 / F290B JEPA family) implement the same TYPE.
 */
export function makeReferenceModelPort(): ModelPort {
  return {
    name: "reference.twin.linear-drift",
    modelVersion: REFERENCE_MODEL_VERSION,
    project: projectReferenceTwin,
    runCounterfactual: runReferenceCounterfactual,
  };
}

/**
 * Runtime guard for the advisory envelope: verifies the machine-carried
 * `advisory: true` marker survives transit through untrusted JSON.
 */
export function isAdvisoryPrediction(v: unknown): v is Prediction {
  if (typeof v !== "object" || v === null) return false;
  const rec = v as { kind?: unknown; advisory?: unknown; points?: unknown };
  return rec.kind === "PREDICTION" && rec.advisory === true && Array.isArray(rec.points);
}

// ---------------------------------------------------------------------------
// Deterministic digests (FNV-1a over canonical serializations)
// ---------------------------------------------------------------------------

function digestTwinInput(input: TwinStateInput, horizon: ProjectionHorizon): string {
  const obs = input.observations
    .map((o) => `${o.observationRef}@${o.atMs}=${o.value}`)
    .join(",");
  return fnv1a(
    `v1|${input.tenant.tenantId}|${input.asset.assetId}|${input.metric}|${input.asOfMs}|${obs}|h=${horizon.steps}x${horizon.stepMs}`,
  );
}

function canonicalIntervention(i: CounterfactualIntervention): string {
  switch (i.kind) {
    case "offset":
      return `offset:${i.offset}`;
    case "scale":
      return `scale:${i.factor}`;
    case "hold":
      return `hold:${i.value}`;
    case "set-drift":
      return `set-drift:${i.driftPerStepMs}`;
    case "truncate-history":
      return `truncate-history:${i.dropCount}`;
  }
}

function digestCounterfactualInput(input: CounterfactualInput): string {
  return fnv1a(
    `${digestTwinInput(input.baseline, input.horizon)}|p=${input.premise}|i=${canonicalIntervention(input.intervention)}`,
  );
}

function detailFor(rejected: ProjectionRejection): string {
  switch (rejected) {
    case "missing-tenant":
      return "tenant identifier is empty";
    case "empty-history":
      return "observation history is empty";
    case "invalid-observation-ref":
      return "an observation has an empty observationRef";
    case "non-monotonic-times":
      return "observation atMs values must be strictly increasing";
    case "invalid-horizon":
      return "horizon requires integer steps >= 1 and integer stepMs >= 1";
    case "horizon-too-large":
      return `horizon steps exceed MAX_PROJECTION_STEPS (${MAX_PROJECTION_STEPS})`;
    case "unknown-intervention":
      return "intervention kind is not a known CounterfactualIntervention";
    case "invalid-intervention":
      return "intervention parameters are out of range";
  }
}

/** FNV-1a 32-bit — deterministic, not cryptographic; internal provenance only. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

function round9(n: number): number {
  return Math.round(n * 1_000_000_000) / 1_000_000_000;
}
