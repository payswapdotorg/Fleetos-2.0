/**
 * F290C — industry fit scoring tests. The rubric is explainable (each
 * component's contribution is in the result); ties resolve deterministically.
 */
import { describe, expect, it } from "vitest";
import {
  scoreIndustryFit,
  rankIndustryFit,
  fleetSizeToTier,
  computeIndustryFitDigest,
  getArchetype,
  listArchetypes,
  type TenantProfile,
} from "../src/index.js";

const manufacturingSmall = getArchetype("manufacturing", "small")!;
const logisticsSmall = getArchetype("logistics", "small")!;

describe("F290C fit — fleet-size tier mapping", () => {
  it("maps fleet size to small/medium/large at the documented boundaries", () => {
    expect(fleetSizeToTier(0)).toBe("small");
    expect(fleetSizeToTier(49)).toBe("small");
    expect(fleetSizeToTier(50)).toBe("medium");
    expect(fleetSizeToTier(499)).toBe("medium");
    expect(fleetSizeToTier(500)).toBe("large");
  });

  it("treats negative / non-finite fleet sizes as small (fail-closed)", () => {
    expect(fleetSizeToTier(-1)).toBe("small");
    expect(fleetSizeToTier(NaN)).toBe("small");
  });
});

describe("F290C fit — explainable components", () => {
  it("an exact sector match contributes sectorMatchBps = 4000", () => {
    const profile: TenantProfile = { sectorSignal: "manufacturing", fleetSize: 10, workloadMix: [] };
    const score = scoreIndustryFit(profile, manufacturingSmall);
    expect(score.components.sectorMatchBps).toBe(4000);
    expect(score.scoreBps).toBe(score.components.sectorMatchBps + score.components.fleetTierBps + score.components.workloadAlignmentBps);
  });

  it("a non-matching sector contributes 0", () => {
    const profile: TenantProfile = { sectorSignal: "agriculture", fleetSize: 10, workloadMix: [] };
    expect(scoreIndustryFit(profile, manufacturingSmall).components.sectorMatchBps).toBe(0);
  });

  it("sector match tolerates hyphen/space/case variants", () => {
    const profile: TenantProfile = { sectorSignal: "Energy Utilities", fleetSize: 10, workloadMix: [] };
    expect(scoreIndustryFit(profile, getArchetype("energy-utilities", "small")!).components.sectorMatchBps).toBe(4000);
  });

  it("fleet tier exact match contributes 3000, adjacent 1500, far 0", () => {
    const smallOrg: TenantProfile = { sectorSignal: "manufacturing", fleetSize: 10, workloadMix: [] };
    const largeOrg: TenantProfile = { sectorSignal: "manufacturing", fleetSize: 1000, workloadMix: [] };
    expect(scoreIndustryFit(smallOrg, manufacturingSmall).components.fleetTierBps).toBe(3000);
    expect(scoreIndustryFit(largeOrg, getArchetype("manufacturing", "medium")!).components.fleetTierBps).toBe(1500);
    expect(scoreIndustryFit(largeOrg, manufacturingSmall).components.fleetTierBps).toBe(0);
  });

  it("orgSizeHint overrides the fleet-size mapping", () => {
    const profile: TenantProfile = { sectorSignal: "manufacturing", fleetSize: 1000, workloadMix: [], orgSizeHint: "small" };
    expect(scoreIndustryFit(profile, manufacturingSmall).components.fleetTierBps).toBe(3000);
  });

  it("workload alignment is proportional to skill-requirement coverage (full → 3000)", () => {
    const full: TenantProfile = {
      sectorSignal: "manufacturing", fleetSize: 10,
      workloadMix: manufacturingSmall.skillRequirements.map((c) => ({ capability: c, weightBps: 1000 })),
    };
    expect(scoreIndustryFit(full, manufacturingSmall).components.workloadAlignmentBps).toBe(3000);
    const none: TenantProfile = {
      sectorSignal: "manufacturing", fleetSize: 10,
      workloadMix: [{ capability: "unrelated-cap", weightBps: 1000 }],
    };
    expect(scoreIndustryFit(none, manufacturingSmall).components.workloadAlignmentBps).toBe(0);
  });
});

describe("F290C fit — ranking + deterministic tie-break", () => {
  it("ranks every archetype and orders by score desc", () => {
    const profile: TenantProfile = {
      sectorSignal: "logistics", fleetSize: 100,
      workloadMix: logisticsSmall.skillRequirements.map((c) => ({ capability: c, weightBps: 1000 })),
    };
    const ranking = rankIndustryFit(profile);
    expect(ranking).toHaveLength(18);
    expect(ranking[0]!.rank).toBe(1);
    for (let i = 1; i < ranking.length; i++) {
      expect(ranking[i]!.score.scoreBps).toBeLessThanOrEqual(ranking[i - 1]!.score.scoreBps);
    }
    expect(ranking[0]!.archetype.industry).toBe("logistics");
    expect(ranking[0]!.archetype.tier).toBe("medium");
  });

  it("resolves ties deterministically by (industry asc, tier asc) — input order never leaks", () => {
    // A profile with no sector signal and no workload mix: every archetype
    // scores only on fleet tier. fleetSize 100 → medium tier → all 6
    // medium archetypes tie at fleetTierBps=3000; the tie-break must order
    // them by (industry asc, tier asc) regardless of input order.
    const profile: TenantProfile = { sectorSignal: "", fleetSize: 100, workloadMix: [] };
    const ranked = rankIndustryFit(profile, [...listArchetypes()].reverse());
    const topSix = ranked.slice(0, 6).map((r) => `${r.archetype.industry}/${r.archetype.tier}`);
    expect(topSix).toEqual([
      "construction/medium", "energy-utilities/medium", "facilities/medium",
      "field-services/medium", "logistics/medium", "manufacturing/medium",
    ]);
  });

  it("computeIndustryFitDigest is indfit_<8hex> and deterministic", () => {
    const profile: TenantProfile = { sectorSignal: "manufacturing", fleetSize: 10, workloadMix: [] };
    const ranking = rankIndustryFit(profile);
    const d = computeIndustryFitDigest(ranking);
    expect(d).toMatch(/^indfit_[0-9a-f]{8}$/);
    expect(computeIndustryFitDigest(rankIndustryFit(profile))).toBe(d);
  });
});
