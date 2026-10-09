/**
 * F290C — per-industry optimization policy tests. The policy feeds the EXISTING
 * seams; industry/tier mismatch is REFUSED with REAL reason codes; the policy
 * is pure (no mutation) and produces a digest-verified problem on match.
 */
import { describe, expect, it } from "vitest";
import {
  policyForArchetype,
  applyIndustryPolicy,
  applyPolicyWithGuard,
  getArchetype,
  type DeclaredOrgContext,
} from "../src/index.js";
import { verifyOptimizationProblemDigest, validateRoleDefinition } from "../src/index.js";
import { allocateRoles } from "../src/index.js";
import { baseInputs, TENANT } from "./optimize-fixtures.js";

const manufacturingSmall = getArchetype("manufacturing", "small")!;
const energyMedium = getArchetype("energy-utilities", "medium")!;
const constructionLarge = getArchetype("construction", "large")!;

describe("F290C optimization — policy construction + purity", () => {
  it("policyForArchetype extracts the policy DATA from an archetype", () => {
    const policy = policyForArchetype(manufacturingSmall);
    expect(policy.industry).toBe("manufacturing");
    expect(policy.tier).toBe("small");
    expect(policy.goals).toEqual(manufacturingSmall.goals);
    expect(policy.policyCeilings).toEqual(manufacturingSmall.policyCeilings);
    expect(policy.budgetFloors).toEqual(manufacturingSmall.budgetFloors);
    expect(policy.ladderPreference).toBe(manufacturingSmall.ladderPreference);
  });

  it("applyIndustryPolicy overlays goals + ceilings + floors and preserves tenant/journal/roles/budgets", () => {
    const base = baseInputs();
    const policy = policyForArchetype(energyMedium);
    const overlaid = applyIndustryPolicy(base, policy);
    expect(overlaid.goals).toBe(policy.goals);
    expect(overlaid.constraints.policyCeilings).toBe(policy.policyCeilings);
    expect(overlaid.constraints.budgetFloors).toBe(policy.budgetFloors);
    // preserved:
    expect(overlaid.tenant).toBe(base.tenant);
    expect(overlaid.journal).toBe(base.journal);
    expect(overlaid.usageExcerpt).toBe(base.usageExcerpt);
    expect(overlaid.roles).toBe(base.roles);
    expect(overlaid.budgets).toBe(base.budgets);
    expect(overlaid.constraints.revokedCapabilities).toBe(base.constraints.revokedCapabilities);
  });

  it("applyIndustryPolicy never mutates the input (pure)", () => {
    const base = baseInputs();
    const snapshot = structuredClone(base);
    applyIndustryPolicy(base, policyForArchetype(constructionLarge));
    expect(base).toEqual(snapshot);
  });
});

describe("F290C optimization — mismatch REFUSAL (the chosen discipline)", () => {
  it("refuses an industry-mismatched policy with INDUSTRY_MISMATCH naming both industries", () => {
    const base = baseInputs();
    const energyPolicy = policyForArchetype(energyMedium);
    const declared: DeclaredOrgContext = { industry: "manufacturing", tier: "medium" };
    const result = applyPolicyWithGuard(base, energyPolicy, declared);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("INDUSTRY_MISMATCH");
      expect(result.detail).toBe("policy:energy-utilities org:manufacturing");
    }
  });

  it("refuses a tier-mismatched policy with TIER_MISMATCH", () => {
    const base = baseInputs();
    const policy = policyForArchetype(manufacturingSmall);
    const declared: DeclaredOrgContext = { industry: "manufacturing", tier: "large" };
    const result = applyPolicyWithGuard(base, policy, declared);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("TIER_MISMATCH");
      expect(result.detail).toBe("policy:small org:large");
    }
  });

  it("on match, returns a digest-verified OptimizationProblem", () => {
    const base = baseInputs();
    const policy = policyForArchetype(manufacturingSmall);
    const declared: DeclaredOrgContext = { industry: "manufacturing", tier: "small" };
    const result = applyPolicyWithGuard(base, policy, declared);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(verifyOptimizationProblemDigest(result.problem)).toBe(true);
      expect(result.problem.goals).toEqual(policy.goals);
      expect(result.problem.constraints.policyCeilings).toEqual(policy.policyCeilings);
    }
  });

  it("surfaces a kernel refusal as PROBLEM_INVALID carrying the REAL reason code", () => {
    // A policy with an invalid goal sum (exceeds 10000) — the kernel's own
    // validator catches it; the guard surfaces the REAL reason verbatim.
    const base = baseInputs();
    const policy = { ...policyForArchetype(manufacturingSmall), goals: { costWeightBps: 5000, capabilityFitWeightBps: 5000, latencyWeightBps: 5000 } };
    const declared: DeclaredOrgContext = { industry: "manufacturing", tier: "small" };
    const result = applyPolicyWithGuard(base, policy, declared);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("PROBLEM_INVALID");
      expect(result.detail).toContain("WEIGHT_SUM_EXCEEDS_TOTAL");
    }
  });
});

describe("F290C optimization — policy DATA feeds the EXISTING allocator", () => {
  it("the policy-fed problem drives a valid, deterministic allocation through allocateRoles", () => {
    const base = baseInputs();
    const policy = policyForArchetype(manufacturingSmall);
    const result = applyPolicyWithGuard(base, policy, { industry: "manufacturing", tier: "small" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const demand = [{ roleId: "role-ops", holders: 1 }];
    const allocation = allocateRoles(result.problem, demand);
    expect(allocation.ok).toBe(true);
    // byte-identical on re-run (determinism through the existing seam)
    if (allocation.ok) {
      expect(JSON.stringify(allocateRoles(result.problem, demand))).toBe(JSON.stringify(allocation));
    }
  });

  it("every archetype's roles are valid (the policy never introduces an invalid role)", () => {
    for (const archetype of [manufacturingSmall, energyMedium, constructionLarge]) {
      for (const role of archetype.roles) {
        expect(validateRoleDefinition(role).ok).toBe(true);
      }
    }
  });

  it("the guard refuses a base input whose tenant differs from the journal tenant (PROBLEM_INVALID surfaces the REAL tenant code)", () => {
    // baseInputs uses TENANT {acme} with an acme journal; a foreign-tenant
    // base fails the kernel's own JOURNAL_TENANT_MISMATCH check.
    const foreign = { ...baseInputs(), tenant: { tenantId: "globex" } };
    const policy = policyForArchetype(manufacturingSmall);
    const result = applyPolicyWithGuard(foreign, policy, { industry: "manufacturing", tier: "small" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("PROBLEM_INVALID");
      expect(result.detail).toContain("TENANT");
    }
    expect(TENANT.tenantId).toBe("acme");
  });
});
