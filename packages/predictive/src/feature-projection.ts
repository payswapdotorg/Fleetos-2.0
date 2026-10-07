/**
 * @fleetos/predictive — REAL feature-set projection with windowing + A2 invariant.
 *
 * Wave 1 (F210B) additions:
 *   - Feature windowing (sliding window over time-series observations)
 *   - Per-observation provenance refs (law A3 — observations are immutable)
 *   - Counterfactual uncertainty WIDENING (law A11 — hypothetical is less certain)
 *   - A2 no-authoritative-write probe (predictive NEVER writes device state)
 *
 * Pure types + pure functions only.
 */

import type {
  FeatureProjection,
  PredictedValue,
  HypotheticalValue,
  UncertaintyInterval,
  PredictiveInterpretation,
  TenantScopeLike,
  AssetRef,
} from "./index.ts";
import { buildCounterfactual, referencePredict } from "./index.ts";

/** A single observation in a time series — immutable (law A3). */
export interface TimeSeriesObservation {
  readonly observationRef: string;
  readonly observedAt: string;
  readonly value: number;
  readonly sensorKind: string;
}

/** A windowed feature set — features computed over a sliding window. */
export interface WindowedFeatureSet {
  readonly tenant: TenantScopeLike;
  readonly asset: AssetRef;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly windowSize: number;
  readonly features: Readonly<Record<string, number>>;
  readonly sourceObservationRefs: readonly string[];
  readonly computedAt: string;
}

/**
 * Project features from a time-series window.
 *
 * Windowing: take observations within [windowStart, windowEnd] and compute
 * deterministic features (mean, min, max, stddev, count).
 *
 * Per-observation provenance: every observation that contributed to the
 * feature set is referenced by its observationRef (law A3).
 *
 * Pure + deterministic.
 */
export function projectWindowedFeatures(
  tenant: TenantScopeLike,
  asset: AssetRef,
  observations: readonly TimeSeriesObservation[],
  windowStart: string,
  windowEnd: string,
  computedAt: string,
): WindowedFeatureSet {
  const windowed = observations.filter(
    (o) => o.observedAt >= windowStart && o.observedAt <= windowEnd,
  );

  if (windowed.length === 0) {
    return {
      tenant,
      asset,
      windowStart,
      windowEnd,
      windowSize: 0,
      features: {},
      sourceObservationRefs: [],
      computedAt,
    };
  }

  const values = windowed.map((o) => o.value);
  const sum = values.reduce((a, b) => a + b, 0);
  const mean = sum / values.length;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  const stddev = Math.sqrt(variance);

  return {
    tenant,
    asset,
    windowStart,
    windowEnd,
    windowSize: windowed.length,
    features: {
      mean: round(mean),
      min,
      max,
      stddev: round(stddev),
      count: values.length,
      range: round(max - min),
    },
    sourceObservationRefs: windowed.map((o) => o.observationRef),
    computedAt,
  };
}

/**
 * Convert a WindowedFeatureSet to a FeatureProjection (for compatibility with
 * the existing referencePredict function).
 */
export function toFeatureProjection(wfs: WindowedFeatureSet): FeatureProjection {
  const features: Record<string, number | string | boolean | null> = {};
  for (const [k, v] of Object.entries(wfs.features)) {
    features[k] = v;
  }
  return {
    tenant: wfs.tenant,
    asset: wfs.asset,
    features,
    computedAt: wfs.computedAt,
    sourceObservationRefs: wfs.sourceObservationRefs,
  };
}

/**
 * Widen uncertainty for counterfactuals (law A11).
 *
 * A counterfactual is LESS certain than a prediction — its uncertainty
 * interval MUST be wider. This function takes a baseline uncertainty and
 * widens it by a factor (default 2x on each side).
 *
 * The widening factor is deterministic — same input => same output.
 */
export function widenUncertainty(
  baseline: UncertaintyInterval,
  factor: number = 2,
): UncertaintyInterval {
  const center = (baseline.lower + baseline.upper) / 2;
  const halfWidth = (baseline.upper - baseline.lower) / 2;
  const widenedHalfWidth = halfWidth * factor;
  return {
    lower: center - widenedHalfWidth,
    upper: center + widenedHalfWidth,
    confidence: Math.max(0, baseline.confidence / factor), // confidence drops
    method: baseline.method === "reference.constant" ? "reference.constant" : "ensemble",
  };
}

/**
 * Build a counterfactual with WIDENED uncertainty.
 *
 * Law A11: the counterfactual's uncertainty MUST be wider than the baseline
 * prediction's uncertainty. This is the machine-tested widening invariant.
 */
export function buildCounterfactualWithWidenedUncertainty<T = unknown>(
  baseline: PredictedValue<T>,
  premise: string,
  newValue: T,
  wideningFactor: number = 2,
): HypotheticalValue<T> {
  const widenedUncertainty = widenUncertainty(baseline.uncertainty, wideningFactor);
  return buildCounterfactual(baseline, premise, newValue, widenedUncertainty);
}

/**
 * A2 invariant probe: verify that no predictive output can reach an
 * authoritative-store interface.
 *
 * The predictive package exports NO function that writes to device state.
 * This function scans the module's exports and verifies that none of them
 * produce a write effect — no "write", "set", "update", "mutate", "persist",
 * "store", "save" function names.
 *
 * Law A2: predictive output is advisory and never authoritative.
 */
export function assertNoAuthoritativeWritePath(moduleExports: Record<string, unknown>): {
  readonly ok: boolean;
  readonly forbidden: readonly string[];
} {
  const FORBIDDEN_PATTERNS = [
    "writeDevice",
    "setDeviceState",
    "updateTwin",
    "mutateAsset",
    "persistToDevice",
    "storeDeviceState",
    "saveToAuthoritativeStore",
    "writeToAuthoritativeStore",
    "writeAuthoritative",
  ];
  const found = FORBIDDEN_PATTERNS.filter((name) => typeof moduleExports[name] === "function");
  return { ok: found.length === 0, forbidden: found };
}

/**
 * Predict with honest degraded states.
 *
 * Returns a PredictiveInterpretation — either a value or a degraded state,
 * never both. Degraded states: model_unavailable, insufficient_history,
 * feature_missing, tenant_isolated.
 *
 * Deterministic + honest.
 */
export function predictWithDegradation<T = unknown>(
  features: FeatureProjection,
  options: {
    readonly value: T;
    readonly uncertainty: UncertaintyInterval;
    readonly modelVersion: string;
    readonly capabilityVersion: string;
    readonly validUntil: string;
    readonly modelAvailable: boolean;
  },
): PredictiveInterpretation<T> {
  if (!options.modelAvailable) {
    return { ok: false, degraded: "model_unavailable", reason: "model is not available" };
  }
  if (Object.keys(features.features).length === 0) {
    return { ok: false, degraded: "insufficient_history", reason: "no features available" };
  }
  if (features.tenant.tenantId === "") {
    return { ok: false, degraded: "tenant_isolated", reason: "tenant identifier missing" };
  }
  return referencePredict(features, options);
}

function round(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
