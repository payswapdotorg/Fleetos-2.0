/**
 * @fleetos/experience-engineering-lab — shared lab vocabulary (private
 * support module).
 *
 * The Engineering Lab (F261, Wave 6 TL lane) is the product shell over the
 * Wave-6 simulation/optimization lanes: it composes the REAL public outputs
 * of `@fleetos/sim-worlds`, `@fleetos/simulation` and
 * `@fleetos/agent-organizations` into tenant-scoped READ-MODEL views —
 * an experiment console, benchmark scorecards and an optimization review
 * queue. It is a PRESENTATION shell: it never executes a run, never
 * re-scores a benchmark and never applies a proposal.
 *
 * This module carries the lab-local FNV-1a digest convention (the
 * established experience-plane convention — identical to tower-core /
 * control-tower) and the machine-carried law markers every view repeats:
 *   - EXPERIMENTAL evidence only (law A5/A11);
 *   - advisory only, never operational truth (law A2);
 *   - proposals only — adoption flows through Guardian (laws A5/A6);
 *   - ceilings are not authorizations.
 *
 * Determinism laws: no Date.now, no Math.random, no timers, no network;
 * logical `now` and caller-supplied inputs everywhere. Every digest is
 * byte-identical for byte-identical inputs.
 */

/** Lab schema version — bumped when a view shape changes. */
export const LAB_SCHEMA_VERSION = 1;

/** Machine-carried EXPERIMENTAL-evidence marker (A5/A11). */
export const EXPERIMENTAL_MARKER = "experimental-evidence-only" as const;

/** Machine-carried advisory-law marker (A2). */
export const ADVISORY_MARKER = "advisory-only-never-operational-truth" as const;

/** Machine-carried Guardian-path marker for every optimization proposal. */
export const PROPOSAL_ONLY_MARKER = "proposals-only-adoption-flows-through-guardian" as const;

/** Machine-carried Guardian-law marker (ceilings are not authorizations). */
export const CEILING_NOT_AUTHORIZATION = "capability-ceiling-not-authorization" as const;

// ---------------------------------------------------------------------------
// FNV-1a digest (32-bit) — the lab-level tamper-evident convention.
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
 * order (the lab digest never depends on input key order).
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

/** The lab-level digest over a canonical serialization of the view body. */
export function labDigestOf(kind: string, body: unknown): string {
  return `lab_${fnv1a32([kind, LAB_SCHEMA_VERSION, canonicalJson(body)])}`;
}

/** Lexicographic comparator — locale-independent, always deterministic. */
export function cmpString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
