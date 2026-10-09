/**
 * @fleetos/model-gateway — industry capability matching (F290C, Wave 9 lane C).
 *
 * A SMALL additive extension that maps industry skill requirements (caller-
 * supplied capability tags — typically an archetype's `skillRequirements`)
 * to model-option capability tags through the gateway's EXISTING public
 * surfaces: `validateModelRegistry` + `findModelsByCapabilities`. It introduces
 * NO new matching algorithm and NO new cross-package import — the skill
 * requirements arrive as plain data (the archetype lives in another bounded
 * context and is never imported here, preserving the one-way dependency).
 *
 * Unmatched requirements are an HONEST REFUSAL (the chosen discipline, not a
 * warning): `matchIndustryCapabilities` returns `ok: false` with
 * `NO_MODEL_MATCHES_REQUIREMENT` naming every capability the registry cannot
 * cover, while still carrying the partial matches so the caller can see what
 * WAS satisfiable. Pure deterministic TS; FNV-1a digest.
 */

import type { ModelDescriptor } from "./registry.js";
import { validateModelRegistry, findModelsByCapabilities } from "./registry.js";
import { fnv1a32 } from "./internal-digest.js";

// ---------------------------------------------------------------------------
// Inputs + result.
// ---------------------------------------------------------------------------

export interface CapabilityMatchForRequirement {
  readonly capability: string;
  /** Models in the registry that carry this capability tag, lexically sorted by id (findModelsByCapabilities). */
  readonly matched: readonly ModelDescriptor[];
  /** True when NO model in the registry declares this capability tag. */
  readonly unmatched: boolean;
}

export type CapabilityMatchReasonCode =
  | "REGISTRY_INVALID"
  | "REQUIREMENTS_EMPTY"
  | "REQUIREMENT_CAPABILITY_EMPTY"
  | "REQUIREMENT_CAPABILITY_DUPLICATED"
  | "NO_MODEL_MATCHES_REQUIREMENT";

export type IndustryCapabilityMatchResult =
  | {
      readonly ok: true;
      readonly matches: readonly CapabilityMatchForRequirement[];
      readonly digest: string;
    }
  | {
      readonly ok: false;
      readonly reasonCode: CapabilityMatchReasonCode;
      readonly detail: string | null;
      /** Partial matches (the satisfiable requirements), surfaced even on refusal. */
      readonly partialMatches: readonly CapabilityMatchForRequirement[];
      readonly unmatchedCapabilities: readonly string[];
    };

// ---------------------------------------------------------------------------
// The matcher — over the EXISTING gateway surfaces only.
// ---------------------------------------------------------------------------

/**
 * Match each required capability tag against the registry. The registry is
 * validated with the REAL `validateModelRegistry`; each requirement is
 * resolved with the REAL `findModelsByCapabilities`. Any requirement no
 * model can cover is an HONEST REFUSAL (`NO_MODEL_MATCHES_REQUIREMENT`)
 * naming all unmatched capabilities in `detail`, with partial matches
 * preserved. Deterministic: identical inputs → a byte-identical result +
 * digest. Pure; no mutation of the registry.
 */
export function matchIndustryCapabilities(
  registry: readonly ModelDescriptor[],
  requiredCapabilities: readonly string[],
): IndustryCapabilityMatchResult {
  const registryCheck = validateModelRegistry(registry);
  if (!registryCheck.ok) {
    return {
      ok: false,
      reasonCode: "REGISTRY_INVALID",
      detail: registryCheck.reasonCode,
      partialMatches: [],
      unmatchedCapabilities: [],
    };
  }
  if (!Array.isArray(requiredCapabilities) || requiredCapabilities.length === 0) {
    return {
      ok: false,
      reasonCode: "REQUIREMENTS_EMPTY",
      detail: null,
      partialMatches: [],
      unmatchedCapabilities: [],
    };
  }
  const seen = new Set<string>();
  for (const cap of requiredCapabilities) {
    if (typeof cap !== "string" || cap.length === 0) {
      return {
        ok: false,
        reasonCode: "REQUIREMENT_CAPABILITY_EMPTY",
        detail: null,
        partialMatches: [],
        unmatchedCapabilities: [],
      };
    }
    if (seen.has(cap)) {
      return {
        ok: false,
        reasonCode: "REQUIREMENT_CAPABILITY_DUPLICATED",
        detail: cap,
        partialMatches: [],
        unmatchedCapabilities: [],
      };
    }
    seen.add(cap);
  }

  const matches: CapabilityMatchForRequirement[] = requiredCapabilities.map((cap) => {
    const matched = findModelsByCapabilities(registry, [cap]);
    return { capability: cap, matched, unmatched: matched.length === 0 };
  });
  const unmatchedCapabilities = matches.filter((m) => m.unmatched).map((m) => m.capability);
  if (unmatchedCapabilities.length > 0) {
    return {
      ok: false,
      reasonCode: "NO_MODEL_MATCHES_REQUIREMENT",
      detail: unmatchedCapabilities.join(","),
      partialMatches: matches,
      unmatchedCapabilities,
    };
  }
  return { ok: true, matches, digest: computeCapabilityMatchDigest(matches) };
}

/** Deterministic FNV-1a digest over the matched capabilities. */
export function computeCapabilityMatchDigest(matches: readonly CapabilityMatchForRequirement[]): string {
  return `indcap_${fnv1a32([
    matches.length,
    matches.map((m) => `${m.capability}:${m.matched.map((md) => md.id).join("+") || "none"}`).join(";"),
  ])}`;
}
