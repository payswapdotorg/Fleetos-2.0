/**
 * @fleetos/world-model — JEPA joint-embedding predictor (Wave 9, F290B).
 *
 * JEPA core: prediction happens in LATENT space, NOT feature space. The
 * predictor embeds the premise (features + optional premise deltas) into
 * the latent space, advances it with the non-expanding dynamics operator,
 * and DECODES the resulting latent to a `PredictedValue` with a calibrated
 * `UncertaintyInterval`. Deterministic structural analogue — no learned
 * weights (law A12; see ./embedding.ts).
 *
 * UNCERTAINTY WIDENING LAW (composed from the lane's existing laws):
 *   - halfWidth(h) = MIN_BOUND_HALF_WIDTH * (1 + sqrt(h)) — the reference
 *     twin model's law (@fleetos/predictive), imported as the REAL constant
 *     (never a local copy). MIN_BOUND_HALF_WIDTH = 0.5.
 *   - Width at horizon h is therefore (1 + sqrt(h)) >= 2 for every integer
 *     h >= 1 — the reference adapter's constant interval [-1, 1] has width
 *     exactly 2.0, so the JEPA interval is NEVER narrower than the
 *     reference adapter's at equal horizon (equal at h = 1, wider beyond).
 *     Machine-tested at h = 1, 4, 16.
 *   - Confidence: 0.5 at h = 1, decaying 250 bps per step, floored at
 *     500 bps (the reference model's stepConfidenceBps law anchored at the
 *     reference adapter's 0.5) — further horizons are honestly LESS
 *     certain, never more.
 *
 * Reserved feature keys — the WorldModelAdapter seam passes a single
 * feature map, so caller-supplied prediction controls travel in reserved
 * keys (documented convention; module-level APIs accept them too and
 * interpret them identically — one discipline, no dual behavior):
 *   - "jepa.horizon": integer >= 1 (default 1). A malformed value degrades
 *     to the default AND the horizon actually used is carried in the
 *     provenance inputsDigest — nothing is silently hidden.
 *   - "jepa.delta.<feature>": premise delta applied to <feature> before
 *     embedding (the latent intervention for prediction premises).
 *   - "jepa.prev.<feature>": previous-frame feature value (the rollout
 *     variant's velocity seed; interpreted by ./rollout.ts).
 * Reserved keys are never embedded as features.
 *
 * Purity: no clock, no randomness, no I/O. `computedAt` is caller-supplied
 * logical time (the seam's convention). `validUntil` is the seam's fixed
 * constant. Rounding follows the lane's 1e-6 numeric-honesty convention.
 */

import { MIN_BOUND_HALF_WIDTH } from "@fleetos/predictive";
import type {
  AssetRef,
  PredictedValue,
  TenantScopeLike,
  UncertaintyInterval,
} from "../index.ts";
import type { FeatureMap, JepaSpace, LatentVector } from "./embedding.ts";
import { canonicalJepaJson, jepaDigest } from "./embedding.ts";

/** Reserved key: prediction horizon (integer >= 1, default 1). */
export const JEPA_HORIZON_KEY = "jepa.horizon" as const;

/** Reserved key prefix: premise delta for a feature ("jepa.delta.<name>"). */
export const JEPA_DELTA_PREFIX = "jepa.delta." as const;

/** Reserved key prefix: previous-frame feature ("jepa.prev.<name>"). */
export const JEPA_PREV_PREFIX = "jepa.prev." as const;

/** The seam's fixed validity constant (matches the reference adapter). */
export const JEPA_VALID_UNTIL = "9999-12-31T00:00:00.000Z" as const;

/** Parsed caller controls carried in reserved feature keys. */
export interface JepaControls {
  /** Integer horizon >= 1 (malformed/absent "jepa.horizon" => 1). */
  readonly horizon: number;
  /** Premise deltas from "jepa.delta.*" keys (finite numbers only). */
  readonly deltas: Readonly<Record<string, number>>;
  /** Previous-frame features from "jepa.prev.*" keys. */
  readonly prev: Readonly<Record<string, number>>;
  /** The payload features with ALL reserved keys stripped. */
  readonly payload: FeatureMap;
}

/** Interpret the reserved-key controls in a feature map (one discipline). */
export function parseJepaControls(features: FeatureMap): JepaControls {
  let horizon = 1;
  const deltas: Record<string, number> = {};
  const prev: Record<string, number> = {};
  const payload: Record<string, number> = {};
  for (const key of Object.keys(features).sort()) {
    const value = features[key];
    if (key === JEPA_HORIZON_KEY) {
      if (typeof value === "number" && Number.isInteger(value) && value >= 1) {
        horizon = value;
      }
      continue;
    }
    if (key.startsWith(JEPA_DELTA_PREFIX)) {
      const name = key.slice(JEPA_DELTA_PREFIX.length);
      if (name.length > 0 && typeof value === "number" && Number.isFinite(value)) {
        deltas[name] = value;
      }
      continue;
    }
    if (key.startsWith(JEPA_PREV_PREFIX)) {
      const name = key.slice(JEPA_PREV_PREFIX.length);
      if (name.length > 0 && typeof value === "number" && Number.isFinite(value)) {
        prev[name] = value;
      }
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      payload[key] = value;
    }
  }
  return { horizon, deltas, prev, payload };
}

// ---------------------------------------------------------------------------
// The composed widening law
// ---------------------------------------------------------------------------

/** Half-width at a horizon (the reference model's sqrt law; factor for variants). */
export function jepaHalfWidthAt(horizon: number, factor: number = 1): number {
  return round6(MIN_BOUND_HALF_WIDTH * (1 + Math.sqrt(horizon)) * factor);
}

/** Confidence at a horizon: 0.5 at h=1, -250 bps/step, floor 500 bps. */
export function jepaConfidenceAt(horizon: number): number {
  const bps = Math.max(500, 5000 - 250 * (horizon - 1));
  return bps / 10000;
}

/**
 * The JEPA uncertainty interval at a horizon for a decoded value.
 * Method "jepa.latent-sqrt" — the honest label for this law (the union
 * member added to @fleetos/predictive's UncertaintyInterval in F290B).
 */
export function jepaUncertaintyAt(horizon: number, value: number): UncertaintyInterval {
  const half = jepaHalfWidthAt(horizon);
  return {
    lower: round6(value - half),
    upper: round6(value + half),
    confidence: jepaConfidenceAt(horizon),
    method: "jepa.latent-sqrt",
  };
}

/** The lane's 1e-6 rounding convention (numeric honesty, stable outputs). */
export function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

// ---------------------------------------------------------------------------
// The joint-embedding predictor
// ---------------------------------------------------------------------------

/** Module-level prediction input (caller-supplied logical metadata). */
export interface JepaPredictionInput {
  readonly tenant: TenantScopeLike;
  readonly asset: AssetRef;
  readonly features: FeatureMap;
  readonly horizon: number;
  readonly deltas?: FeatureMap;
  readonly computedAt: string;
}

/** A joint-embedding prediction: the seam-shaped value + the JEPA artifacts. */
export interface JepaPrediction {
  readonly predicted: PredictedValue<number>;
  /** The predicted latent (the JEPA core artifact — prediction in latent space). */
  readonly latent: LatentVector;
  /** Decoded per-feature readouts of the predicted latent (sorted keys). */
  readonly readouts: Readonly<Record<string, number>>;
  readonly horizon: number;
  readonly spaceVersion: string;
}

export type JepaRejection =
  | "invalid-horizon"
  | "invalid-delta"
  | "unknown-mask-target"
  | "empty-window"
  | "non-monotonic-steps"
  | "invalid-truth-steps"
  | "invalid-intervention";

export type JepaPredictionResult =
  | { readonly ok: true; readonly prediction: JepaPrediction }
  | { readonly ok: false; readonly rejected: JepaRejection; readonly detail: string };

/**
 * Predict the latent at a horizon from a representation + premise deltas,
 * then decode. Strict validation (the module surface is fail-loud): the
 * horizon must be an integer >= 1 and deltas must be finite numbers.
 */
export function predictJepa(
  space: JepaSpace,
  input: JepaPredictionInput,
): JepaPredictionResult {
  if (!Number.isInteger(input.horizon) || input.horizon < 1) {
    return {
      ok: false,
      rejected: "invalid-horizon",
      detail: "horizon must be an integer >= 1",
    };
  }
  const controls = parseJepaControls(input.features);
  const deltas = { ...controls.deltas, ...input.deltas };
  for (const key of Object.keys(input.deltas ?? {})) {
    const value = (input.deltas as Record<string, number>)[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return { ok: false, rejected: "invalid-delta", detail: `delta ${key} is not finite` };
    }
  }
  // Premise: base embedding + premise-delta embedding (the latent shift).
  const z0 = addLatents(space.embedFeatures(controls.payload), space.embedFeatures(deltas));
  const zh = space.applyDynamics(z0, input.horizon);

  // Decode: per-feature readouts; the seam value is the PRIMARY feature
  // (lexicographically smallest payload key; no features => 0 — the honest
  // zero-mass prediction, never a refusal and never a fabricated value).
  const readouts: Record<string, number> = {};
  const keys = Object.keys(controls.payload).sort();
  for (const key of keys) {
    readouts[key] = round6(space.decode(zh, key));
  }
  const primary = keys.length > 0 ? (keys[0] as string) : null;
  const value = primary !== null ? (readouts[primary] as number) : 0;
  const uncertainty = jepaUncertaintyAt(input.horizon, value);

  const predicted: PredictedValue<number> = {
    kind: "PREDICTED",
    value,
    uncertainty,
    predictedAt: input.computedAt,
    validUntil: JEPA_VALID_UNTIL,
    provenance: {
      modelVersion: space.version,
      capabilityVersion: "1.0.0",
      featureDigest: jepaDigest(canonicalJepaJson(input.features)),
      // The horizon ACTUALLY used is carried here (the nothing-hidden surface).
      inputsDigest: jepaDigest(
        `${input.tenant.tenantId}|${input.asset.assetId}|${input.computedAt}|h=${input.horizon}|v=${space.version}`,
      ),
    },
    tenant: input.tenant,
    asset: input.asset,
  };
  return {
    ok: true,
    prediction: { predicted, latent: zh, readouts, horizon: input.horizon, spaceVersion: space.version },
  };
}

/** Vector addition (component-wise; length = min of the two lengths). */
export function addLatents(a: LatentVector, b: LatentVector): LatentVector {
  const n = Math.min(a.length, b.length);
  const out = Array.from({ length: n }, (_, i) => (a[i] as number) + (b[i] as number));
  return Object.freeze(out);
}

/** Vector subtraction (component-wise; length = min of the two lengths). */
export function subtractLatents(a: LatentVector, b: LatentVector): LatentVector {
  const n = Math.min(a.length, b.length);
  const out = Array.from({ length: n }, (_, i) => (a[i] as number) - (b[i] as number));
  return Object.freeze(out);
}

/** Scalar multiplication (component-wise). */
export function scaleLatent(a: LatentVector, factor: number): LatentVector {
  return Object.freeze(a.map((c) => c * factor));
}
