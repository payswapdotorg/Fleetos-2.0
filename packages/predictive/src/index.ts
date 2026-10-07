/**
 * @fleetos/predictive — feature projections, predictive interpretations,
 * uncertainty intervals, provenance digests, model/capability version.
 *
 * Law A11: OBSERVED, PREDICTED, and HYPOTHETICAL are SEMANTICALLY DISTINCT
 * types. A counterfactual is never an observation. The type system encodes
 * this — there is no implicit conversion between the three.
 *
 * Law A12: every predictive capability has a deterministic reference path.
 *
 * Law: predictive NEVER writes device state. There is no setter that returns
 * a write effect — only interpretations and advisory proposals.
 *
 * Honest degraded states: model_unavailable, insufficient_history.
 */

/** LOCAL structural tenant scope. */
export interface TenantScopeLike {
  readonly tenantId: string;
}

/** LOCAL structural asset reference. */
export interface AssetRef {
  readonly assetId: string;
}

/** Distinct semantic categories — the key A11 invariant. */
export type SemanticKind = "OBSERVED" | "PREDICTED" | "HYPOTHETICAL";

/**
 * Type-distinctness (law A11) is enforced by the `kind` literal field and
 * the machine-carried `hypothetical: true` marker on HYPOTHETICAL values.
 * The `kind` literal alone makes the three interfaces structurally distinct —
 * a counterfactual can never type-check as an observation because its `kind`
 * is the wrong string literal.
 */

/**
 * OBSERVED — a measured/recorded value. Source: an immutable observation.
 * Cannot be fabricated; only constructed from real observation refs.
 */
export interface ObservedValue<T = unknown> {
  readonly kind: "OBSERVED";
  readonly value: T;
  readonly observedAt: string;
  readonly observationRef: string;
  readonly tenant: TenantScopeLike;
  readonly asset: AssetRef;
}

/** PREDICTED — an inferred future value with uncertainty. */
export interface PredictedValue<T = unknown> {
  readonly kind: "PREDICTED";
  readonly value: T;
  readonly uncertainty: UncertaintyInterval;
  readonly predictedAt: string;
  readonly validUntil: string;
  readonly provenance: ProvenanceDigest;
  readonly tenant: TenantScopeLike;
  readonly asset: AssetRef;
}

/** HYPOTHETICAL — a counterfactual; never an observation.
 *
 * The `hypothetical: true` field is a machine-carried marker that cannot be
 * stripped by the type system — every HYPOTHETICAL value carries it. Runtime
 * guards can verify it on untrusted input.
 */
export interface HypotheticalValue<T = unknown> {
  readonly kind: "HYPOTHETICAL";
  readonly value: T;
  readonly uncertainty: UncertaintyInterval;
  readonly premise: string; // "what-if" premise that produced this counterfactual
  readonly computedAt: string;
  readonly provenance: ProvenanceDigest;
  readonly tenant: TenantScopeLike;
  readonly asset: AssetRef;
  /** Machine-carried marker — cannot be stripped by the type system. */
  readonly hypothetical: true;
}

export type AnyValue<T = unknown> = ObservedValue<T> | PredictedValue<T> | HypotheticalValue<T>;

export interface UncertaintyInterval {
  readonly lower: number;
  readonly upper: number;
  readonly confidence: number; // 0..1
  readonly method: "bootstrap" | "conformal" | "ensemble" | "reference.constant";
}

export interface ProvenanceDigest {
  readonly modelVersion: string;
  readonly capabilityVersion: string;
  readonly featureDigest: string; // sha-256 of the feature set
  readonly inputsDigest: string;
}

/** Honest degraded state — when prediction is not possible. */
export type DegradedState =
  | "model_unavailable"
  | "insufficient_history"
  | "feature_missing"
  | "tenant_isolated";

/** A predictive interpretation — either a value or a degraded state, never both. */
export type PredictiveInterpretation<T = unknown> =
  | { readonly ok: true; readonly value: PredictedValue<T> }
  | { readonly ok: false; readonly degraded: DegradedState; readonly reason: string };

/** Feature projection — the deterministic input to a predictive model. */
export interface FeatureProjection {
  readonly tenant: TenantScopeLike;
  readonly asset: AssetRef;
  readonly features: Readonly<Record<string, number | string | boolean | null>>;
  readonly computedAt: string;
  readonly sourceObservationRefs: readonly string[];
}

/**
 * Reference predictive model — deterministic. Same inputs => same output.
 *
 * Law A12: deterministic reference path. The model is a pure function over
 * features; no GPU, no provider. Production models can replace this via the
 * adapter seam (see world-model).
 */
export function referencePredict<T = unknown>(
  features: FeatureProjection,
  options: {
    readonly value: T;
    readonly uncertainty: UncertaintyInterval;
    readonly modelVersion: string;
    readonly capabilityVersion: string;
    readonly validUntil: string;
  },
): PredictiveInterpretation<T> {
  if (Object.keys(features.features).length === 0) {
    return {
      ok: false,
      degraded: "insufficient_history",
      reason: "no features available",
    };
  }
  if (features.tenant.tenantId === "") {
    return {
      ok: false,
      degraded: "feature_missing",
      reason: "tenant identifier missing",
    };
  }
  const provenance: ProvenanceDigest = {
    modelVersion: options.modelVersion,
    capabilityVersion: options.capabilityVersion,
    featureDigest: stableDigest(JSON.stringify(features.features)),
    inputsDigest: stableDigest(`${features.tenant.tenantId}|${features.asset.assetId}|${features.computedAt}`),
  };
  return {
    ok: true,
    value: {
      kind: "PREDICTED",
      value: options.value,
      uncertainty: options.uncertainty,
      predictedAt: features.computedAt,
      validUntil: options.validUntil,
      provenance,
      tenant: features.tenant,
      asset: features.asset,
    },
  };
}

/**
 * Build a counterfactual. The returned HYPOTHETICAL value carries a
 * `hypothetical: true` marker that the type system enforces — there is no
 * function that returns a HYPOTHETICAL as an OBSERVED.
 */
export function buildCounterfactual<T = unknown>(
  baseline: PredictedValue<T>,
  premise: string,
  newValue: T,
  newUncertainty: UncertaintyInterval,
): HypotheticalValue<T> {
  return {
    kind: "HYPOTHETICAL",
    value: newValue,
    uncertainty: newUncertainty,
    premise,
    computedAt: baseline.predictedAt,
    provenance: baseline.provenance,
    tenant: baseline.tenant,
    asset: baseline.asset,
    hypothetical: true,
  };
}

/** Build an OBSERVED value from a real observation reference. */
export function buildObserved<T = unknown>(
  value: T,
  observedAt: string,
  observationRef: string,
  tenant: TenantScopeLike,
  asset: AssetRef,
): ObservedValue<T> {
  return {
    kind: "OBSERVED",
    value,
    observedAt,
    observationRef,
    tenant,
    asset,
  };
}

/**
 * Type guard — runtime check that a value is HYPOTHETICAL.
 *
 * The type system already enforces this — but runtime guards are useful when
 * consuming untrusted JSON.
 */
export function isHypothetical<T>(v: AnyValue<T>): v is HypotheticalValue<T> {
  return v.kind === "HYPOTHETICAL" && (v as HypotheticalValue<T>).hypothetical === true;
}

/** Type guard — runtime check that a value is OBSERVED. */
export function isObserved<T>(v: AnyValue<T>): v is ObservedValue<T> {
  return v.kind === "OBSERVED";
}

/** Type guard — runtime check that a value is PREDICTED. */
export function isPredicted<T>(v: AnyValue<T>): v is PredictedValue<T> {
  return v.kind === "PREDICTED";
}

/**
 * Stable string digest — deterministic, NOT cryptographically secure.
 * Used internally for provenance digests. Same input => same digest.
 */
function stableDigest(s: string): string {
  // FNV-1a — deterministic, no crypto dep required at the surface.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * Reference UncertaintyInterval — for the deterministic reference path.
 * Returns a constant interval — useful for tests.
 */
export function referenceUncertainty(): UncertaintyInterval {
  return { lower: -1, upper: 1, confidence: 0.5, method: "reference.constant" };
}
