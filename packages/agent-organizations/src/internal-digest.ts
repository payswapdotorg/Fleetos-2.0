/**
 * @fleetos/agent-organizations — internal FNV-1a digest helper.
 *
 * Matches the repo's established Wave 0/1 convention (deterministic,
 * dependency-free; prefixes like `audit_`, `authzreq_`). NOT exported from
 * the package index — internal only. Pure: no wall clock, no randomness.
 */

export function fnv1a32(parts: readonly (string | number | boolean | null | undefined)[]): string {
  let hash = 0x811c9dc5;
  const joined = parts.map((p) => (p === null || p === undefined ? "" : String(p))).join("\u241f");
  for (let i = 0; i < joined.length; i++) {
    hash ^= joined.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
