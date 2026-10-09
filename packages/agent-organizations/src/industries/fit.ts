/**
 * @fleetos/agent-organizations — industry fit scoring (F290C, Wave 9 lane C).
 *
 * A deterministic, EXPLAINABLE rubric that scores a caller-supplied tenant
 * profile against each industry archetype. The score is the SUM of three
 * integer-bps components, each surfaced in the result so the ranking is
 * auditable (no opaque weighted blend):
 *   1. sectorMatchBps   — the declared sector signal vs the archetype industry;
 *   2. fleetTierBps     — the tenant's fleet-size tier vs the archetype tier;
 *   3. workloadAlignmentBps — the tenant's workload-mix capability coverage
 *      of the archetype's required skills + role capabilities.
 *
 * Ties are broken DETERMINISTICALLY by (industry asc, tier asc) — input
 * order never leaks. Pure deterministic TS; the profile is caller-supplied
 * data (no imports outside this lane). No `Date.now`/`Math.random`.
 */

import type { Industry, OrgSizeTier, IndustryArchetype } from "./archetypes.js";
import { listArchetypes, ORG_SIZE_TIERS } from "./archetypes.js";
import { fnv1a32 } from "../internal-digest.js";

// ---------------------------------------------------------------------------
// The tenant profile — caller-supplied, tenant-scoped data.
// ---------------------------------------------------------------------------

export interface WorkloadMixEntry {
  readonly capability: string;
  /** Integer bps weight (0..10000); the rubric normalizes across the mix. */
  readonly weightBps: number;
}

export interface TenantProfile {
  /** Declared sector signal (free-form string; matched case-insensitively to Industry). */
  readonly sectorSignal: string;
  /** Number of enrolled agents / devices — drives the fleet-size tier. */
  readonly fleetSize: number;
  readonly workloadMix: readonly WorkloadMixEntry[];
  /** Optional explicit tier declaration; when present it overrides the fleet-size mapping. */
  readonly orgSizeHint?: OrgSizeTier;
  readonly tenantId?: string;
}

// ---------------------------------------------------------------------------
// The score + components (every contribution is surfaced for audit).
// ---------------------------------------------------------------------------

export interface IndustryFitComponents {
  readonly sectorMatchBps: number;
  readonly fleetTierBps: number;
  readonly workloadAlignmentBps: number;
}

export interface IndustryFitScore {
  readonly industry: Industry;
  readonly tier: OrgSizeTier;
  readonly scoreBps: number;
  readonly components: IndustryFitComponents;
}

export interface IndustryFitRanking {
  readonly rank: number;
  readonly score: IndustryFitScore;
  readonly archetype: IndustryArchetype;
}

const SECTOR_MATCH_BPS = 4000;
const FLEET_TIER_EXACT_BPS = 3000;
const FLEET_TIER_ADJACENT_BPS = 1500;
const WORKLOAD_ALIGNMENT_MAX_BPS = 3000;

// ---------------------------------------------------------------------------
// Pure helpers.
// ---------------------------------------------------------------------------

/** Map a fleet size to a tier (the default when orgSizeHint is absent). */
export function fleetSizeToTier(fleetSize: number): OrgSizeTier {
  if (!Number.isFinite(fleetSize) || fleetSize < 0) return "small";
  if (fleetSize < 50) return "small";
  if (fleetSize < 500) return "medium";
  return "large";
}

function tierStep(tier: OrgSizeTier): number {
  return tier === "small" ? 0 : tier === "medium" ? 1 : 2;
}

function tierProximityBps(declared: OrgSizeTier, archetype: OrgSizeTier): number {
  const delta = Math.abs(tierStep(declared) - tierStep(archetype));
  if (delta === 0) return FLEET_TIER_EXACT_BPS;
  if (delta === 1) return FLEET_TIER_ADJACENT_BPS;
  return 0;
}

function sectorMatchBps(profile: TenantProfile, archetype: IndustryArchetype): number {
  if (typeof profile.sectorSignal !== "string") return 0;
  const signal = profile.sectorSignal.trim().toLowerCase();
  if (signal.length === 0) return 0;
  const target = archetype.industry.toLowerCase();
  if (signal === target) return SECTOR_MATCH_BPS;
  // Tolerate hyphen/space variants and the "industry" suffix noise.
  const normalized = signal.replace(/[\s_-]+/g, "");
  const targetNorm = target.replace(/[\s_-]+/g, "");
  return normalized === targetNorm ? SECTOR_MATCH_BPS : 0;
}

function workloadAlignmentBps(profile: TenantProfile, archetype: IndustryArchetype): number {
  if (!Array.isArray(profile.workloadMix) || profile.workloadMix.length === 0) return 0;
  const required = new Set<string>(archetype.skillRequirements);
  for (const role of archetype.roles) {
    for (const cap of role.capabilities) required.add(cap);
  }
  let totalWeight = 0;
  let matchedWeight = 0;
  for (const entry of profile.workloadMix) {
    if (typeof entry.capability !== "string" || !Number.isInteger(entry.weightBps) || entry.weightBps <= 0) continue;
    totalWeight += entry.weightBps;
    if (required.has(entry.capability)) matchedWeight += entry.weightBps;
  }
  if (totalWeight === 0) return 0;
  return Math.floor((matchedWeight * WORKLOAD_ALIGNMENT_MAX_BPS) / totalWeight);
}

// ---------------------------------------------------------------------------
// Scoring + ranking.
// ---------------------------------------------------------------------------

export function scoreIndustryFit(profile: TenantProfile, archetype: IndustryArchetype): IndustryFitScore {
  const declaredTier: OrgSizeTier = profile.orgSizeHint ?? fleetSizeToTier(profile.fleetSize);
  const components: IndustryFitComponents = {
    sectorMatchBps: sectorMatchBps(profile, archetype),
    fleetTierBps: tierProximityBps(declaredTier, archetype.tier),
    workloadAlignmentBps: workloadAlignmentBps(profile, archetype),
  };
  return {
    industry: archetype.industry,
    tier: archetype.tier,
    scoreBps: components.sectorMatchBps + components.fleetTierBps + components.workloadAlignmentBps,
    components,
  };
}

/**
 * Rank every archetype against the profile. Deterministic ordering:
 * (scoreBps desc, industry asc, tier asc). Input order never leaks; ties
 * resolve to a stable lexical order. `rank` is 1-based.
 */
export function rankIndustryFit(
  profile: TenantProfile,
  archetypes: readonly IndustryArchetype[] = listArchetypes(),
): readonly IndustryFitRanking[] {
  const tierOrder = (t: OrgSizeTier): number => ORG_SIZE_TIERS.indexOf(t);
  const scored = archetypes.map((archetype) => ({
    score: scoreIndustryFit(profile, archetype),
    archetype,
  }));
  scored.sort((a, b) =>
    b.score.scoreBps - a.score.scoreBps ||
    cmpString(a.score.industry, b.score.industry) ||
    tierOrder(a.score.tier) - tierOrder(b.score.tier),
  );
  return scored.map((entry, index) => ({
    rank: index + 1,
    score: entry.score,
    archetype: entry.archetype,
  }));
}

/** Deterministic digest over a ranked fit (for caching/audit). */
export function computeIndustryFitDigest(ranking: readonly IndustryFitRanking[]): string {
  return `indfit_${fnv1a32([
    ranking.length,
    ranking.map((r) => `${r.score.industry}/${r.score.tier}:${r.score.scoreBps}[${r.score.components.sectorMatchBps},${r.score.components.fleetTierBps},${r.score.components.workloadAlignmentBps}]`).join(";"),
  ])}`;
}

function cmpString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
