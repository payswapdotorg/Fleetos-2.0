/**
 * @fleetos/predictive — reference twin model IMPLEMENTATION (Wave 3, F230B).
 *
 * The deterministic reference model: last-value-anchored least-squares drift
 * projection with sqrt-widening bounds and integer-bps confidence decay,
 * plus the structured counterfactual machinery with full divergence
 * accounting, the in-memory reference `ModelPort` adapter, and the
 * deterministic provenance digests. Pure functions only — no clock, no
 * randomness, no I/O (law A12).
 *
 * The contracts these functions produce/consume live in `./contracts.ts`
 * (advisory envelope, provenance, interventions, ModelPort). Split note
 * (F230B lint conformance): this implementation moved verbatim from
 * `../reference-model.ts` (now the subpath barrel) to keep every src file
 * under the repo's max-lines lint budget — zero behavior change.
 */

import type {
  CounterfactualInput,
  CounterfactualIntervention,
  CounterfactualResult,
  DivergenceEntry,
  ModelPort,
  Prediction,
  ProjectedPoint,
  ProjectionHorizon,
  ProjectionRejection,
  ProjectionResult,
  TwinObservation,
  TwinStateInput,
} from "./contracts.ts";
import {
  MAX_PROJECTION_STEPS,
  MIN_BOUND_HALF_WIDTH,
  REFERENCE_MODEL_VERSION,
} from "./contracts.ts";

// ---------------------------------------------------------------------------
// Series fitting + validation (private deterministic math)
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

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Counterfactuals (law A11 — HYPOTHETICAL, widened bounds, halved confidence)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// ModelPort — in-memory deterministic reference adapter
// ---------------------------------------------------------------------------

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
