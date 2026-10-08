/**
 * @fleetos/aurum — deterministic digest helpers (Wave 5).
 *
 * FNV-1a 32-bit digests with a per-purpose prefix — the established lane
 * convention (matching `audit_` / `ledger_` / `alloc_` prefixes in the
 * domain packages). Deterministic evidence-grade digests, NOT cryptography;
 * a stronger hash would be a cross-cutting TL-owned swap.
 *
 * Canonical JSON serialization is key-order independent: two payloads that
 * differ only in key order produce byte-identical canonical forms, so all
 * digests computed through `canonicalJson` are input-order independent.
 */

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export function fnv1a32Hex(prefix: string, input: string): string {
  let hash = FNV_OFFSET;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = (hash * FNV_PRIME) >>> 0;
  }
  return `${prefix}_${hash.toString(16).padStart(8, "0")}`;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const parts: string[] = [];
  for (const key of keys) {
    parts.push(`${JSON.stringify(key)}:${canonicalJson(record[key])}`);
  }
  return `{${parts.join(",")}}`;
}
