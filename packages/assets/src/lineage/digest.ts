/**
 * @fleetos/assets — Wave 9 lineage digest helper (F290A).
 *
 * LOCAL COPY of the lane's FNV-1a digest convention (the canonical home is
 * TL-owned tower-core / control-tower). Cross-package imports of another
 * owner's digest module are forbidden by the architecture lock; the lane
 * convention (per F270A/F281/F290B) is a per-package local copy with
 * byte-identical behavior to the lane family.
 *
 * The same family the repo's digest chains use:
 *   - 32-bit FNV-1a over the parts joined with the unit-separator (␟, U+241F).
 *   - canonicalJson: object keys sorted recursively; arrays kept in order;
 *     byte-identical for structurally equal values regardless of key order.
 *
 * Pure TypeScript, no I/O, no Date.now, no Math.random, no timers, no network.
 */

// ---------------------------------------------------------------------------
// Digest parts — what a digest can hash.
// ---------------------------------------------------------------------------

export type DigestPart = string | number | boolean | null | undefined | readonly DigestPart[];

/**
 * FNV-1a 32-bit digest over the parts joined with the unit-separator
 * convention. Pure, order-sensitive; arrays flatten deterministically.
 * Returns 8 lowercase hex chars.
 */
export function fnv1a32(parts: readonly DigestPart[]): string {
  return fnv1a32Int(parts).toString(16).padStart(8, "0");
}

/**
 * The raw uint32 behind {@link fnv1a32}. Useful as a mixing input when a
 * caller needs the integer instead of the hex form.
 */
export function fnv1a32Int(parts: readonly DigestPart[]): number {
  let hash = 0x811c9dc5;
  const joined = flatten(parts)
    .map((p) => (p === null || p === undefined ? "" : String(p)))
    .join("\u241f");
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
): Array<string | number | boolean | null | undefined> {
  const out: Array<string | number | boolean | null | undefined> = [];
  for (const p of parts) {
    if (isDigestPartArray(p)) out.push(...flatten(p));
    else out.push(p);
  }
  return out;
}

/**
 * Canonical JSON: object keys sorted recursively, arrays kept in order.
 * Byte-identical for structurally equal values regardless of key order.
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

/**
 * Convenience: FNV-1a digest over the canonical-JSON encoding of a single
 * value. Used by the lineage chain for edge payloads (so edge ordering AND
 * edge content both contribute to the chain — any edit breaks verification).
 */
export function fnv1a32OfJson(value: unknown): string {
  return fnv1a32([canonicalJson(value)]);
}
