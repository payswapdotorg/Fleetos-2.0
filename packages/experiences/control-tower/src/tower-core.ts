/**
 * @fleetos/control-tower — shared tower vocabulary (private support module).
 *
 * The Control Tower (F241, Wave 4 TL lane) is THE sanctioned application-
 * composition site for the Wave 4 experience lanes: it assembles the real
 * read-model outputs of `@fleetos/experience-asset-field`,
 * `@fleetos/experience-safety-intel` and `@fleetos/experience-work-commerce`
 * into one tenant-scoped cockpit, binds the REAL control-plane command
 * queue behind the lanes' CommandDraft seams, and presents the mission
 * journal replay surface from `@fleetos/mission`.
 *
 * This module carries the tower-local FNV-1a digest convention (the
 * established Wave-4 lane convention — see work-commerce's internal-view)
 * and the lane vocabulary shared by every deliverable.
 *
 * Determinism laws: no Date.now, no Math.random, no timers, no network;
 * logical `now` and caller-supplied time strings everywhere. Every digest
 * is byte-identical for byte-identical inputs.
 */

/** The three Wave-4 experience lanes the tower composes. */
export type TowerLane = "asset-field" | "safety-intel" | "work-commerce";

/** Tower schema version — bumped when a view shape changes. */
export const TOWER_SCHEMA_VERSION = 1;

/** The machine-carried Guardian-law marker (ceilings are not authorizations). */
export const CEILING_NOT_AUTHORIZATION = "capability-ceiling-not-authorization" as const;

// ---------------------------------------------------------------------------
// FNV-1a digest (32-bit) — the tower-level tamper-evident convention.
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
 * order (the tower digest never depends on input key order).
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

/** The tower-level digest over a canonical serialization of the view body. */
export function towerDigestOf(kind: string, body: unknown): string {
  return `tower_${fnv1a32([kind, TOWER_SCHEMA_VERSION, canonicalJson(body)])}`;
}
