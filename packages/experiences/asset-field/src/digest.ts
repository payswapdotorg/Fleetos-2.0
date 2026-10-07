/**
 * @fleetos/experience-asset-field — deterministic view digests (FNV-1a).
 *
 * Lane convention (F220A..F231): 32-bit FNV-1a digests, hex, 8 chars,
 * prefixed by a per-view scope string. Evidence-grade sha-256 lives in
 * @fleetos/evidence; experience views are read-models, so the lane's
 * FNV-1a convention applies.
 *
 * Every assembled view carries a `digest` computed over its full content
 * (deterministic canonical serialization — recursively key-sorted) plus a
 * `verify*` function that recomputes it from the view's own fields.
 * Tampering with ANY assembled field makes verification false.
 *
 * Pure + deterministic: no clock, no randomness, no I/O.
 */

const FNV_OFFSET = 0x811c9dc5;

/** 32-bit FNV-1a over a UTF-16 string, hex-encoded, zero-padded to 8 chars. */
export function fnv1a(s: string): string {
  let h = FNV_OFFSET;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * Canonical serialization for digesting: JSON-like but with object keys
 * recursively SORTED (input key order is irrelevant), arrays kept in
 * order, and `undefined` object members skipped (JSON.stringify
 * semantics) so optional-absent vs explicit-undefined never diverge.
 */
export function stableStringify(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "number":
    case "boolean":
      return String(value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((v) => stableStringify(v ?? null)).join(",")}]`;
      }
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record)
        .filter((k) => record[k] !== undefined)
        .sort();
      const body = keys
        .map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`)
        .join(",");
      return `{${body}}`;
    }
    default:
      return "null";
  }
}

/**
 * Digest a view: scope-prefixed FNV-1a over the canonical serialization of
 * the (digest-free) view parts. Same view content -> same digest, always.
 */
export function viewDigestOf(scope: string, parts: object): string {
  return fnv1a(`${scope}|v1|${stableStringify(parts)}`);
}
