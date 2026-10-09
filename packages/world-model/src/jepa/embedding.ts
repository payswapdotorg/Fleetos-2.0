/**
 * @fleetos/world-model — JEPA-family deterministic embedding space
 * (Wave 9, F290B).
 *
 * "JEPA" here means the DETERMINISTIC STRUCTURAL ANALOGUE of a Joint
 * Embedding Predictive Architecture: representations and predictions live
 * in a fixed LATENT space produced by deterministic projections. These are
 * NOT learned weights — every projection row is derived at construction
 * from FNV-1a-family hashes of the FEATURE NAME (law A12: deterministic
 * reference path — no GPU, no provider, no I/O, no wall clock, no
 * Math.random).
 *
 * Dimensionality: LATENT_DIM = 32 (documented). 32 keeps every operation
 * O(32) or O(32^2) — cheap enough for pure-TS hot paths while giving
 * hash-derived rows enough room to be near-orthogonal with negligible
 * collision pressure. The dimension is a construction parameter, not a
 * learned quantity.
 *
 * Weight derivation: seed = FNV-1a-family hash of
 * `${namespace}#feature#${name}` (the lane's additive FNV-1a variant — the
 * same convention as the other lane packages), expanded into `dim`
 * coordinates by a documented xorshift32 integer stream mapped to [-1, 1),
 * then L2-normalized. No Math.random, no giant precomputed tables — rows
 * are derived at construction from the hash family alone.
 *
 * Distance semantics (both tested for known-answer cases):
 *   - L2: latentL2(a, b) = ||a - b||;
 *   - cosine: latentCosine(a, b) = (a . b) / (||a|| ||b||), with the
 *     documented ZERO-VECTOR CONVENTION cosine(0, x) = 0 (similarity of a
 *     mass-less vector is defined as 0, never NaN).
 *
 * Float determinism: embeddings accumulate in SORTED feature-key order so
 * float summation order is fixed (float + is not associative — the order
 * is part of the determinism contract). All arithmetic is IEEE-754
 * correctly-rounded (+, *, /, Math.sqrt), so outputs are byte-identical
 * across re-runs and re-constructions.
 *
 * Latent dynamics (the prediction operator shared by the JEPA variants):
 * a linear map A = R / sqrt(dim) where every row of R has unit L2 norm
 * (hash-derived, same family). NON-EXPANSION PROOF: by Cauchy–Schwarz,
 * |(Az)_i| = |R_i . z| / sqrt(dim) <= ||R_i|| ||z|| / sqrt(dim) =
 * ||z|| / sqrt(dim); therefore ||Az||^2 = sum_i (Az)_i^2 <=
 * dim * ||z||^2 / dim = ||z||^2, i.e. ||Az|| <= ||z||. This single law
 * underwrites the rollout radius bound (see ./rollout.ts).
 */

/** Documented latent dimensionality (see header). */
export const LATENT_DIM = 32 as const;

/** Version of the JEPA embedding space (provenance-carried). */
export const JEPA_SPACE_VERSION = "jepa-1.0.0" as const;

/** Numeric feature map — same shape as WorldModelRepresentation.features. */
export type FeatureMap = Readonly<Record<string, number>>;

/** A latent vector in the embedding space (length = the space's dim). */
export type LatentVector = readonly number[];

/** Default namespace for the canonical shared space. */
export const JEPA_DEFAULT_NAMESPACE = "fleetos.jepa.v1" as const;

// ---------------------------------------------------------------------------
// Deterministic hash family + canonical serialization (local copies of the
// lane's FNV-1a convention — the TL-hoisting seam decision, same as the
// other lane packages; canonical home remains TL-owned).
// ---------------------------------------------------------------------------

/** FNV-1a-family 32-bit hash (the lane's additive variant). Deterministic. */
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/** 8-hex digest of the FNV-1a-family hash (the lane's digest convention). */
export function jepaDigest(s: string): string {
  return fnv1a32(s).toString(16).padStart(8, "0");
}

/**
 * Canonical JSON serialization: object keys sorted recursively, arrays in
 * order, `undefined` serialized as `null`. Deterministic byte-identical
 * output for structurally-equal inputs regardless of key insertion order.
 */
export function canonicalJepaJson(v: unknown): string {
  if (v === null) return "null";
  const t = typeof v;
  if (t === "number" || t === "boolean") return String(v);
  if (t === "string") return JSON.stringify(v);
  if (t === "undefined") return "null";
  if (Array.isArray(v)) {
    return `[${v.map((x) => canonicalJepaJson(x)).join(",")}]`;
  }
  if (t === "object") {
    const rec = v as Record<string, unknown>;
    const keys = Object.keys(rec).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJepaJson(rec[k])}`).join(",")}}`;
  }
  return "null";
}

// ---------------------------------------------------------------------------
// Deterministic coordinate stream (xorshift32) — the weight expander.
// ---------------------------------------------------------------------------

/**
 * xorshift32 stream: x ^= x<<13; x ^= x>>>17; x ^= x<<5 (unsigned). The
 * state is forced odd because xorshift32 degenerates at zero. Deterministic
 * integer recurrence — no randomness.
 */
function xorshiftStream(seed: number, count: number): number[] {
  let x = (seed | 1) >>> 0;
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    x = (x ^ ((x << 13) >>> 0)) >>> 0;
    x = (x ^ (x >>> 17)) >>> 0;
    x = (x ^ ((x << 5) >>> 0)) >>> 0;
    out.push(x >>> 0);
  }
  return out;
}

/** Map a u32 stream value to [-1, 1) (deterministic float division). */
function coordinateOf(u: number): number {
  return u / 2147483648 - 1;
}

/** L2-normalize; a zero-norm stream falls back to a deterministic basis vector. */
function normalizeRow(coords: number[], seed: number, dim: number): LatentVector {
  let normSq = 0;
  for (const c of coords) normSq += c * c;
  if (normSq === 0) {
    // Deterministic degenerate fallback: unit basis direction at seed mod dim.
    const basis = Array.from({ length: dim }, () => 0);
    basis[seed % dim] = 1;
    return Object.freeze(basis);
  }
  const norm = Math.sqrt(normSq);
  return Object.freeze(coords.map((c) => c / norm));
}

// ---------------------------------------------------------------------------
// Distance semantics (pure functions over plain vectors)
// ---------------------------------------------------------------------------

/** Dot product over the common prefix length. */
export function latentDot(a: LatentVector, b: LatentVector): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    s += (a[i] as number) * (b[i] as number);
  }
  return s;
}

/** Euclidean norm. */
export function latentNorm(a: LatentVector): number {
  return Math.sqrt(latentDot(a, a));
}

/** Euclidean distance. */
export function latentL2(a: LatentVector, b: LatentVector): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    const d = (a[i] as number) - (b[i] as number);
    s += d * d;
  }
  return Math.sqrt(s);
}

/**
 * Cosine similarity with the documented ZERO-VECTOR CONVENTION: if either
 * vector has zero norm the similarity is 0 (never NaN, never undefined).
 */
export function latentCosine(a: LatentVector, b: LatentVector): number {
  const na = latentNorm(a);
  const nb = latentNorm(b);
  if (na === 0 || nb === 0) return 0;
  return latentDot(a, b) / (na * nb);
}

// ---------------------------------------------------------------------------
// The embedding space
// ---------------------------------------------------------------------------

/** The deterministic JEPA embedding space (all functions pure). */
export interface JepaSpace {
  readonly dim: number;
  readonly namespace: string;
  readonly version: typeof JEPA_SPACE_VERSION;
  /** Unit-norm latent row for a feature NAME (hash-derived, memoized). */
  readonly featureRow: (name: string) => LatentVector;
  /** Embed a feature map: sum(value * row(name)) in sorted-key order. */
  readonly embedFeatures: (features: FeatureMap) => LatentVector;
  /** Decode: read out a feature's value as the projection of z on its row. */
  readonly decode: (z: LatentVector, feature: string) => number;
  /**
   * Apply the non-expanding latent dynamics A `steps` times (integer >= 0;
   * any other value is treated as 0 — identity, documented). Vectors whose
   * length differs from the space's dim are returned unchanged (defensive
   * identity — the operator is only defined on this space's vectors).
   */
  readonly applyDynamics: (z: LatentVector, steps: number) => LatentVector;
  /** Deterministic digest of a latent (coordinates rounded to 1e-9). */
  readonly digest: (z: LatentVector) => string;
}

/**
 * Construct a deterministic embedding space. Construction-time validation
 * is fail-loud (programming errors, not domain refusals):
 *   - dim: integer in [2, 1024] (default LATENT_DIM);
 *   - namespace: non-empty string (default JEPA_DEFAULT_NAMESPACE).
 * Two spaces constructed with the same parameters derive byte-identical
 * rows (machine-tested).
 */
export function makeJepaSpace(options?: {
  readonly dim?: number;
  readonly namespace?: string;
}): JepaSpace {
  const dim = options?.dim ?? LATENT_DIM;
  const namespace = options?.namespace ?? JEPA_DEFAULT_NAMESPACE;
  if (!Number.isInteger(dim) || dim < 2 || dim > 1024) {
    throw new RangeError(`jepa space dim must be an integer in [2, 1024], got ${String(dim)}`);
  }
  if (typeof namespace !== "string" || namespace.length === 0) {
    throw new RangeError("jepa space namespace must be a non-empty string");
  }

  const rowCache = new Map<string, LatentVector>();
  const featureRow = (name: string): LatentVector => {
    const cached = rowCache.get(name);
    if (cached !== undefined) return cached;
    const seed = fnv1a32(`${namespace}#feature#${name}`);
    const row = normalizeRow(xorshiftStream(seed, dim).map(coordinateOf), seed, dim);
    rowCache.set(name, row);
    return row;
  };

  // Dynamics rows: R (unit-norm rows, hash-derived per row index).
  const rows: LatentVector[] = [];
  for (let i = 0; i < dim; i += 1) {
    const seed = fnv1a32(`${namespace}#dynamics#${i}`);
    rows.push(normalizeRow(xorshiftStream(seed, dim).map(coordinateOf), seed, dim));
  }
  const dynamicsRows: readonly LatentVector[] = rows;
  const dynamicsScale = 1 / Math.sqrt(dim);

  const embedFeatures = (features: FeatureMap): LatentVector => {
    const acc = Array.from({ length: dim }, () => 0);
    for (const key of Object.keys(features).sort()) {
      const value = features[key];
      // Non-finite feature values are EXCLUDED (documented honesty): a
      // NaN/Infinity never poisons the latent.
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      const row = featureRow(key);
      for (let i = 0; i < dim; i += 1) {
        acc[i] = (acc[i] as number) + value * (row[i] as number);
      }
    }
    return Object.freeze(acc);
  };

  const decode = (z: LatentVector, feature: string): number => latentDot(z, featureRow(feature));

  const applyDynamics = (z: LatentVector, steps: number): LatentVector => {
    if (z.length !== dim) return z;
    const n = Number.isInteger(steps) && steps > 0 ? steps : 0;
    let cur = z;
    for (let k = 0; k < n; k += 1) {
      cur = Object.freeze(dynamicsRows.map((row) => latentDot(row, cur) * dynamicsScale));
    }
    return cur;
  };

  const digest = (z: LatentVector): string => {
    const coords = z.map((c) => String(Math.round(c * 1_000_000_000) / 1_000_000_000)).join(",");
    return jepaDigest(`latent|v1|${coords}`);
  };

  return Object.freeze({
    dim,
    namespace,
    version: JEPA_SPACE_VERSION,
    featureRow,
    embedFeatures,
    decode,
    applyDynamics,
    digest,
  });
}
