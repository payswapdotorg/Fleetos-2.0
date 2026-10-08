/**
 * @fleetos/sim-worlds — deterministic entropy source (F260A).
 *
 * The lane's single entropy law: NO `Math.random`, NO `Date.now`, NO
 * timers. Every random-looking value is a PURE function of a caller-
 * supplied seed string. The generator is counter-mode FNV-1a: a draw at
 * address `(seed, counter)` hashes the address itself, so a run never
 * carries hidden PRNG state — a draw can be re-derived from where it
 * happened, which is what makes checkpointed runs byte-identical to
 * full runs (the world engine addresses draws by
 * `${seed}|step|${step}|${slot}`).
 *
 * Same seed -> byte-identical value sequences, machine-tested.
 * The FNV-1a digest convention mirrors the established lane convention
 * (tower-core / control-tower) as a LOCAL copy — cross-package imports
 * of another owner's module are forbidden.
 */

// ---------------------------------------------------------------------------
// FNV-1a digest (32-bit) — the lane's tamper-evident digest convention.
// ---------------------------------------------------------------------------

export type DigestPart = string | number | boolean | null | undefined | readonly DigestPart[];

/** FNV-1a over the parts joined with the unit-separator convention. Pure,
 * order-sensitive; arrays flatten deterministically. Returns 8 lowercase
 * hex chars. */
export function fnv1a32(parts: readonly DigestPart[]): string {
  return fnv1a32Int(parts).toString(16).padStart(8, "0");
}

/** The raw uint32 behind {@link fnv1a32} — used as the PRNG mixing input. */
export function fnv1a32Int(parts: readonly DigestPart[]): number {
  let hash = 0x811c9dc5;
  const joined = flatten(parts)
    .map((p) => (p === null || p === undefined ? "" : String(p)))
    .join("␟");
  for (let i = 0; i < joined.length; i++) {
    hash ^= joined.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function isDigestPartArray(part: DigestPart): part is readonly DigestPart[] {
  return Array.isArray(part);
}

function flatten(
  parts: readonly DigestPart[],
): (string | number | boolean | null | undefined)[] {
  const out: (string | number | boolean | null | undefined)[] = [];
  for (const p of parts) {
    if (isDigestPartArray(p)) out.push(...flatten(p));
    else out.push(p);
  }
  return out;
}

/** Canonical JSON: object keys sorted recursively, arrays kept in order.
 * Byte-identical for structurally equal values regardless of key order. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

// ---------------------------------------------------------------------------
// The seeded generator — counter-mode FNV-1a + splitmix32 finalizer.
// ---------------------------------------------------------------------------

/** Basis for bps (basis points) rates: 10000 bps = certainty. */
export const BPS_BASIS = 10_000;

/**
 * Pure draw: a uniform value in [0, 1) derived ONLY from the seed string.
 * `randomFromSeed("a")` is a fixed real number forever — there is no hidden
 * state, so any address (seed) can be re-evaluated at any time and yield
 * the same value (the property the checkpoint law needs).
 *
 * Mixing: FNV-1a over the seed string, then a splitmix32 finalizer avalanche
 * step, so consecutive addresses (…#41, …#42) decorrelate.
 */
export function randomFromSeed(seed: string): number {
  return splitmixFinalize(fnv1a32Int([seed])) / 4_294_967_296;
}

/** The stateful view over the counter-mode generator. */
export interface PrngState {
  readonly seed: string;
  readonly counter: number;
}

export function createPrng(seed: string): PrngState {
  return { seed, counter: 0 };
}

/** Pure step: returns the next value AND the successor state. */
export function nextRandom(state: PrngState): {
  readonly value: number;
  readonly state: PrngState;
} {
  return {
    value: randomFromSeed(`${state.seed}#${state.counter}`),
    state: { seed: state.seed, counter: state.counter + 1 },
  };
}

/** Splitmix32 finalizer — avalanches the FNV hash into uniform bits. */
function splitmixFinalize(x: number): number {
  let z = x >>> 0;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
  z = (z ^ (z >>> 15)) >>> 0;
  return z;
}

// ---------------------------------------------------------------------------
// Derived samplers — all pure over the seed + parameters.
// ---------------------------------------------------------------------------

/** Bernoulli draw from an integer bps rate: P(hit) = bps / 10000.
 * Out-of-bounds bps is refused (fail-closed), not clamped. */
export function bernoulliFromBps(seed: string, bps: number): {
  readonly ok: boolean;
  readonly reason?: "bps-out-of-bounds";
  readonly hit: boolean;
} {
  if (!Number.isInteger(bps) || bps < 0 || bps > BPS_BASIS) {
    return { ok: false, reason: "bps-out-of-bounds", hit: false };
  }
  const v = randomFromSeed(seed);
  return { ok: true, hit: v * BPS_BASIS < bps };
}

/** Discrete pick from non-negative integer weights. Returns the chosen
 * index. A zero-total weight vector is refused (fail-closed). */
export function pickWeighted(seed: string, weights: readonly number[]): {
  readonly ok: boolean;
  readonly reason?: "empty-weights" | "negative-weight" | "zero-total-weight";
  readonly index: number;
} {
  if (weights.length === 0) return { ok: false, reason: "empty-weights", index: -1 };
  let total = 0;
  for (const w of weights) {
    if (!Number.isInteger(w) || w < 0) {
      return { ok: false, reason: "negative-weight", index: -1 };
    }
    total += w;
  }
  if (total === 0) return { ok: false, reason: "zero-total-weight", index: -1 };
  const target = randomFromSeed(seed) * total;
  let cumulative = 0;
  for (let i = 0; i < weights.length; i++) {
    cumulative += weights[i]!;
    if (target < cumulative) return { ok: true, index: i };
  }
  return { ok: true, index: weights.length - 1 }; // float-tail guard
}

/** Deterministic integer jitter in [minOffset, maxOffset] (inclusive),
 * added to `base`. Bounds must be integers with min <= max. */
export function jitterInBounds(seed: string, base: number, minOffset: number, maxOffset: number): {
  readonly ok: boolean;
  readonly reason?: "bad-bounds";
  readonly value: number;
} {
  if (
    !Number.isInteger(minOffset) || !Number.isInteger(maxOffset) ||
    minOffset > maxOffset
  ) {
    return { ok: false, reason: "bad-bounds", value: 0 };
  }
  const span = maxOffset - minOffset;
  const v = randomFromSeed(seed);
  const offset = minOffset + Math.floor(v * (span + 1));
  return { ok: true, value: base + Math.min(offset, maxOffset) };
}
