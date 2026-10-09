/**
 * F290C — industry archetype registry tests. Every archetype must pass the
 * EXISTING kernel validators (`validateRoleDefinition`, `goalWeightSumBps`,
 * the constraint rules); the registry is DATA over the real contracts.
 */
import { describe, expect, it } from "vitest";
import {
  INDUSTRY_ARCHETYPES,
  INDUSTRIES,
  ORG_SIZE_TIERS,
  getArchetype,
  listArchetypes,
  listIndustries,
  listTiers,
  validateArchetype,
  computeArchetypeDigest,
  type Industry,
  type OrgSizeTier,
} from "../src/index.js";
import { validateRoleDefinition, goalWeightSumBps } from "../src/index.js";

describe("F290C archetypes — registry shape", () => {
  it("registers exactly 6 industries × 3 tiers = 18 archetypes", () => {
    expect(INDUSTRY_ARCHETYPES).toHaveLength(18);
    expect(listIndustries()).toHaveLength(6);
    expect(listTiers()).toEqual(["small", "medium", "large"]);
  });

  it("covers the six named industries (manufacturing…construction)", () => {
    expect(listIndustries()).toEqual([
      "manufacturing", "logistics", "energy-utilities",
      "facilities", "field-services", "construction",
    ]);
  });

  it("getArchetype returns the matching record and null for unknown", () => {
    expect(getArchetype("manufacturing", "small")?.industry).toBe("manufacturing");
    expect(getArchetype("construction", "large")?.tier).toBe("large");
    expect(getArchetype("nonexistent" as Industry, "small")).toBeNull();
    expect(getArchetype("manufacturing", "xl" as OrgSizeTier)).toBeNull();
  });

  it("listArchetypes is registry-identical and stable", () => {
    expect(listArchetypes()).toBe(INDUSTRY_ARCHETYPES);
  });
});

describe("F290C archetypes — every artifact passes the EXISTING validators", () => {
  it("every archetype passes validateArchetype", () => {
    for (const a of INDUSTRY_ARCHETYPES) {
      const v = validateArchetype(a);
      expect(v.ok, `${a.industry}/${a.tier}: ${v.ok ? "" : v.reasonCode + ":" + v.detail}`).toBe(true);
    }
  });

  it("every role passes the REAL validateRoleDefinition", () => {
    for (const a of INDUSTRY_ARCHETYPES) {
      for (const role of a.roles) {
        const check = validateRoleDefinition(role);
        expect(check.ok, `${a.industry}/${a.tier} role ${role.id}`).toBe(true);
      }
    }
  });

  it("every archetype's goal weights are valid integer bps summing to 10000", () => {
    for (const a of INDUSTRY_ARCHETYPES) {
      expect(goalWeightSumBps(a.goals)).toBe(10000);
      expect(Number.isInteger(a.goals.costWeightBps)).toBe(true);
      expect(Number.isInteger(a.goals.capabilityFitWeightBps)).toBe(true);
      expect(Number.isInteger(a.goals.latencyWeightBps)).toBe(true);
    }
  });

  it("every archetype has non-empty skill requirements + assumptions + envelopeKind", () => {
    for (const a of INDUSTRY_ARCHETYPES) {
      expect(a.skillRequirements.length).toBeGreaterThan(0);
      expect(a.industryAssumptions.length).toBeGreaterThan(0);
      expect(a.envelopeKind === "specialist-heavy" || a.envelopeKind === "cost-controlled").toBe(true);
    }
  });
});

describe("F290C archetypes — tier scaling + envelope divergence", () => {
  it("spend ceiling grows with tier for every industry", () => {
    for (const industry of INDUSTRIES) {
      const s = getArchetype(industry, "small")!.policyCeilings.maxRoleBudgetSpendMinor;
      const m = getArchetype(industry, "medium")!.policyCeilings.maxRoleBudgetSpendMinor;
      const l = getArchetype(industry, "large")!.policyCeilings.maxRoleBudgetSpendMinor;
      expect(s).toBeLessThan(m);
      expect(m).toBeLessThan(l);
    }
  });

  it("specialist-heavy and cost-controlled envelopes both exist (3 industries each)", () => {
    const specialist = INDUSTRIES.filter((i) => getArchetype(i, "small")!.envelopeKind === "specialist-heavy");
    const costControlled = INDUSTRIES.filter((i) => getArchetype(i, "small")!.envelopeKind === "cost-controlled");
    expect(specialist.length).toBe(3);
    expect(costControlled.length).toBe(3);
    expect(specialist).toEqual(["manufacturing", "energy-utilities", "field-services"]);
    expect(costControlled).toEqual(["logistics", "facilities", "construction"]);
  });

  it("specialist-heavy spend ceiling exceeds cost-controlled for the same tier", () => {
    for (const tier of ORG_SIZE_TIERS) {
      const spec = getArchetype("manufacturing", tier)!.policyCeilings.maxRoleBudgetSpendMinor;
      const cost = getArchetype("construction", tier)!.policyCeilings.maxRoleBudgetSpendMinor;
      expect(spec).toBeGreaterThan(cost);
    }
  });
});

describe("F290C archetypes — digest + determinism", () => {
  it("computeArchetypeDigest is indarch_<8hex> and deterministic", () => {
    const a = getArchetype("manufacturing", "medium")!;
    const d = computeArchetypeDigest(a);
    expect(d).toMatch(/^indarch_[0-9a-f]{8}$/);
    expect(computeArchetypeDigest(a)).toBe(d);
  });

  it("every archetype has a distinct digest", () => {
    const digests = new Set(INDUSTRY_ARCHETYPES.map(computeArchetypeDigest));
    expect(digests.size).toBe(18);
  });
});

describe("F290C archetypes — validateArchetype honest refusals", () => {
  it("refuses an archetype with no roles (ROLES_EMPTY)", () => {
    const a = { ...getArchetype("manufacturing", "small")!, roles: [] };
    const v = validateArchetype(a);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reasonCode).toBe("ROLES_EMPTY");
  });

  it("refuses an archetype with an invalid goal sum (GOALS_INVALID)", () => {
    const a = { ...getArchetype("manufacturing", "small")!, goals: { costWeightBps: 5000, capabilityFitWeightBps: 5000, latencyWeightBps: 5000 } };
    const v = validateArchetype(a);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reasonCode).toBe("GOALS_INVALID");
  });

  it("refuses an archetype with a non-positive concurrent ceiling (CEILINGS_INVALID)", () => {
    const base = getArchetype("manufacturing", "small")!;
    const a = { ...base, policyCeilings: { ...base.policyCeilings, maxConcurrentRolesPerAgent: 0 } };
    const v = validateArchetype(a);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reasonCode).toBe("CEILINGS_INVALID");
  });

  it("refuses an archetype with an empty skill-requirements list (SKILL_REQUIREMENTS_EMPTY)", () => {
    const a = { ...getArchetype("manufacturing", "small")!, skillRequirements: [] };
    const v = validateArchetype(a);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reasonCode).toBe("SKILL_REQUIREMENTS_EMPTY");
  });

  it("refuses an archetype with a duplicate budget floor capability (FLOORS_INVALID)", () => {
    const base = getArchetype("manufacturing", "small")!;
    const dup = [...base.budgetFloors, ...base.budgetFloors];
    const a = { ...base, budgetFloors: dup };
    const v = validateArchetype(a);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reasonCode).toBe("FLOORS_INVALID");
  });
});
