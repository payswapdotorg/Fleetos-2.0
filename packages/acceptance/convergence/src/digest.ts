/**
 * @fleetos/acceptance-convergence — local digest + canonical-JSON helpers.
 *
 * LOCAL COPY of the acceptance family's FNV-1a digest convention (the
 * canonical home is TL-owned tower-core; each acceptance package keeps a
 * local copy — the same structural seam decision as F270A `determinism.ts`,
 * F271 `digest.ts` and F281 `digest.ts`). Hoisting this into a shared digest
 * contract remains a TL decision.
 *
 * Pure deterministic TS. No clock, no randomness, no network.
 */

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** 32-bit FNV-1a over a UTF-16 string, hex, zero-padded to 8 chars. */
export function fnv1a(s: string): string {
  let h = FNV_OFFSET;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * Canonical JSON for digesting: object keys recursively sorted (input key
 * order is irrelevant), arrays kept in order, `undefined` members skipped
 * (JSON.stringify semantics). Accepts only JSON-shaped values; class
 * instances and Maps serialize as their OWN enumerable data properties —
 * digest call sites must pass curated plain parts (the family convention).
 */
export function canonicalJson(value: unknown): string {
  return stableStringify(value);
}

function stableStringify(value: unknown): string {
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

/** Deep structural equality via canonical serialization (order-insensitive). */
export function deepEquals(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

/** Byte-identity comparison via canonical serialization. */
export function byteIdentical(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

/** Scope-prefixed digest over canonical JSON — the view digest form. */
export function digestOf(scope: string, parts: object): string {
  return fnv1a(`${scope}|v1|${stableStringify(parts)}`);
}
