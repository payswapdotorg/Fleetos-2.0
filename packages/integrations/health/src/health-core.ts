/**
 * @fleetos/integration-health — shared vocabulary (private support module).
 *
 * F251 (Wave 5 TL lane) — the integration-plane composition package over
 * the seven Wave-5 adapter lanes. This module carries the composition-local
 * FNV-1a digest convention (32-bit, ␟ unit-separator join — the established
 * Control Tower convention, see `tower-core.ts`) and the shared adapter
 * vocabulary used by every deliverable.
 *
 * Determinism laws: no wall-clock reads, no randomness, no timers, no
 * network; logical `now` and caller-supplied inputs everywhere. Every digest
 * is byte-identical for byte-identical inputs, and input key order never
 * leaks (canonical JSON).
 */

/** The seven Wave-5 adapter lanes this package composes. */
export type HealthAdapterId =
  | "adcos"
  | "connectivity"
  | "arena"
  | "learning"
  | "aurum"
  | "apify"
  | "vendors";

/** The full adapter set, in fixed canonical order (digests + sort orders). */
export const HEALTH_ADAPTERS: readonly HealthAdapterId[] = [
  "adcos",
  "connectivity",
  "arena",
  "learning",
  "aurum",
  "apify",
  "vendors",
];

/** View schema version — bumped when a view shape changes. */
export const HEALTH_SCHEMA_VERSION = 1;

/** The machine-carried Guardian-law marker (ceilings are not authorizations). */
export const CEILING_NOT_AUTHORIZATION = "ceiling-not-authorization" as const;

// ---------------------------------------------------------------------------
// FNV-1a digest (32-bit) — the composition-level tamper-evident convention.
// ---------------------------------------------------------------------------

export type DigestPart = string | number | boolean | null | undefined | readonly DigestPart[];

/**
 * FNV-1a over the parts joined with the unit-separator convention. Pure and
 * order-sensitive; arrays flatten deterministically.
 */
export function fnv1a32(parts: readonly DigestPart[]): string {
  let hash = 0x811c9dc5;
  const joined = flatten(parts)
    .map((p) => (p === null || p === undefined ? "" : String(p)))
    .join("␟");
  for (let i = 0; i < joined.length; i++) {
    hash ^= joined.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
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

/**
 * Canonical JSON serialization: object keys sorted recursively, arrays kept
 * in order. Byte-identical for structurally equal values regardless of key
 * order (no composition digest ever depends on input key order).
 */
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

/** The composition-level digest over a canonical serialization of a body. */
export function healthDigestOf(kind: string, body: unknown): string {
  return `health_${fnv1a32([kind, HEALTH_SCHEMA_VERSION, canonicalJson(body)])}`;
}

// ---------------------------------------------------------------------------
// Shared vocabulary helpers.
// ---------------------------------------------------------------------------

/** Lexical comparator used for every deterministic sort in this package. */
export function lexical(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Sorted unique copy (deterministic code lists everywhere). */
export function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(lexical);
}
