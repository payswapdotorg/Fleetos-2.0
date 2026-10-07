/**
 * @fleetos/procurement — matching engine (law A16).
 *
 * Deterministic scoring with TIE-BREAKING RULES RECORDED IN THE MATCH
 * RECORD. The score composition is documented; the tie-break order is
 * documented; the match record carries the rule that decided each tie.
 *
 * Laws: A4 (machine-stable), A8 (tenant-scoped), A12 (deterministic
 * reference path), A16 (exchange semantics — match is a separate
 * contract identity from quote/order).
 */

import type { ProcurementDemand, VendorCapabilityRefLike } from "./contracts.js";
import { validateTenantScope } from "./contracts.js";

// ---------------------------------------------------------------------------
// VendorMatch — carries the score AND the tie-break rule that decided
// its position. Honest: ties are explicit, not arbitrary.
// ---------------------------------------------------------------------------

export type TieBreakRule =
  | "higher_coverage"
  | "higher_service_level"
  | "lower_unit_cost"
  | "lexicographic_vendor_id";

export interface VendorMatch {
  readonly vendorId: string;
  readonly score: number;
  readonly matchedTags: readonly string[];
  /** Components of the score — transparent, not a black box. */
  readonly scoreBreakdown: {
    readonly coverage: number;
    readonly serviceLevel: number;
    readonly costScore: number;
  };
  /** The tie-break rule that decided this match's position relative to its predecessor. */
  readonly tieBreakRule: TieBreakRule | null;
}

// ---------------------------------------------------------------------------
// matchVendors — deterministic scoring. Returns matches sorted by
// (score desc, then tie-break rules). The first match has
// tieBreakRule === null (no predecessor to tie-break against).
// ---------------------------------------------------------------------------

export function matchVendors(
  demand: ProcurementDemand,
  vendors: readonly VendorCapabilityRefLike[],
): readonly VendorMatch[] {
  const tenantCheck = validateTenantScope(demand.tenant);
  if (!tenantCheck.ok) return [];
  const matches: VendorMatch[] = [];
  for (const v of vendors) {
    const vTenant = validateTenantScope(v.tenant);
    if (!vTenant.ok) continue;
    if (vTenant.scope.tenantId !== tenantCheck.scope.tenantId) continue;
    const matched = demand.capabilityTags.filter((t) => v.capabilityTags.includes(t));
    if (matched.length === 0) continue;
    const coverageScore = matched.length / Math.max(demand.capabilityTags.length, 1);
    const serviceScore = Math.max(0, Math.min(1, v.serviceLevel));
    const costScore = 1 / (1 + Math.max(0, v.unitCost));
    const score = coverageScore * 0.6 + serviceScore * 0.3 + costScore * 0.1;
    matches.push({
      vendorId: v.vendorId,
      score,
      matchedTags: matched,
      scoreBreakdown: {
        coverage: coverageScore,
        serviceLevel: serviceScore,
        costScore,
      },
      tieBreakRule: null,
    });
  }
  // Sort by (score desc, coverage desc, serviceLevel desc, costScore desc, vendorId asc).
  // Each tie-break is recorded on the match that won the tie.
  matches.sort((a, b) => {
    if (b.score !== a.score) {
      // No tie — record the rule that distinguished them (highest score wins).
      // We annotate the winner (the higher-scored match). Since sort is
      // ascending-by-rank, the winner ends up earlier in the array; we
      // annotate it after sort in a second pass.
      return b.score - a.score;
    }
    if (b.scoreBreakdown.coverage !== a.scoreBreakdown.coverage) {
      return b.scoreBreakdown.coverage - a.scoreBreakdown.coverage;
    }
    if (b.scoreBreakdown.serviceLevel !== a.scoreBreakdown.serviceLevel) {
      return b.scoreBreakdown.serviceLevel - a.scoreBreakdown.serviceLevel;
    }
    if (b.scoreBreakdown.costScore !== a.scoreBreakdown.costScore) {
      return b.scoreBreakdown.costScore - a.scoreBreakdown.costScore;
    }
    return a.vendorId < b.vendorId ? -1 : a.vendorId > b.vendorId ? 1 : 0;
  });
  // Annotate tie-break rules: for each match after the first, identify
  // the rule that distinguished it from its predecessor.
  const annotated = matches.map((m, i) => {
    if (i === 0) return m;
    const prev = matches[i - 1]!;
    return { ...m, tieBreakRule: decideTieBreak(prev, m) };
  });
  return annotated;
}

function decideTieBreak(
  prev: VendorMatch,
  curr: VendorMatch,
): TieBreakRule {
  if (prev.scoreBreakdown.coverage !== curr.scoreBreakdown.coverage) {
    return "higher_coverage";
  }
  if (prev.scoreBreakdown.serviceLevel !== curr.scoreBreakdown.serviceLevel) {
    return "higher_service_level";
  }
  if (prev.scoreBreakdown.costScore !== curr.scoreBreakdown.costScore) {
    return "lower_unit_cost";
  }
  return "lexicographic_vendor_id";
}
