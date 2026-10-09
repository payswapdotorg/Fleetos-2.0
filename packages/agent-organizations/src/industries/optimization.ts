/**
 * @fleetos/agent-organizations — per-industry optimization policies (F290C).
 *
 * A policy is DATA derived from an archetype that feeds the EXISTING
 * `prepareOptimizationInputs` / `allocateRoles` / `optimizeRouting` /
 * `rebalanceBudgets` seams — it is NOT a replacement for any of them. The
 * policy carries the industry+tier goal weights (`OptimizationGoals`), the
 * budget envelope (`OrganizationPolicyCeilings` + `BudgetFloor[]`) and the
 * ladder preference; `applyIndustryPolicy` overlays these onto an
 * `OptimizationInputs` (purely, without mutation) and the resulting inputs
 * flow through the kernel unchanged.
 *
 * Industry MISMATCH is REFUSED (the chosen discipline — not a warning): an
 * energy envelope applied to a manufacturing org configuration refuses with
 * `INDUSTRY_MISMATCH` naming both industries; a tier mismatch refuses with
 * `TIER_MISMATCH`. A policy whose goals/ceilings/floors fail the kernel
 * validators surfaces the REAL `prepareOptimizationInputs` reason code.
 *
 * Pure deterministic TS; PROPOSES, never applies (A5/A6).
 */

import type { Industry, OrgSizeTier, IndustryArchetype, LadderPreference } from "./archetypes.js";
import type { OrganizationPolicyCeilings } from "../org-config.js";
import type { OptimizationGoals, BudgetFloor, OptimizationInputs, OptimizationProblem } from "../optimization-inputs.js";
import { prepareOptimizationInputs } from "../optimization-inputs.js";

// ---------------------------------------------------------------------------
// The policy record — DATA feeding the existing seams.
// ---------------------------------------------------------------------------

export interface IndustryOptimizationPolicy {
  readonly industry: Industry;
  readonly tier: OrgSizeTier;
  readonly goals: OptimizationGoals;
  readonly policyCeilings: OrganizationPolicyCeilings;
  readonly budgetFloors: readonly BudgetFloor[];
  readonly ladderPreference: LadderPreference;
  readonly skillRequirements: readonly string[];
  readonly industryAssumptions: string;
}

/** Pure constructor: extract the policy DATA from an archetype. */
export function policyForArchetype(archetype: IndustryArchetype): IndustryOptimizationPolicy {
  return {
    industry: archetype.industry,
    tier: archetype.tier,
    goals: archetype.goals,
    policyCeilings: archetype.policyCeilings,
    budgetFloors: archetype.budgetFloors,
    ladderPreference: archetype.ladderPreference,
    skillRequirements: archetype.skillRequirements,
    industryAssumptions: archetype.industryAssumptions,
  };
}

// ---------------------------------------------------------------------------
// Overlay the policy onto an OptimizationInputs (PURE — no mutation).
// The policy tunes the goal weights + the budget envelope (ceilings +
// floors); the org's tenant scope, journal, usage excerpt, roles and live
// budgets are the tenant's own and are preserved. Revocations are preserved
// from the base inputs (the policy does not invent revocations).
// ---------------------------------------------------------------------------

export function applyIndustryPolicy(
  inputs: OptimizationInputs,
  policy: IndustryOptimizationPolicy,
): OptimizationInputs {
  return {
    ...inputs,
    goals: policy.goals,
    constraints: {
      policyCeilings: policy.policyCeilings,
      budgetFloors: policy.budgetFloors,
      revokedCapabilities: inputs.constraints.revokedCapabilities,
    },
  };
}

// ---------------------------------------------------------------------------
// The mismatch guard — REFUSES (not warns) an industry/tier-mismatched
// policy application with REAL reason codes. Documented discipline.
// ---------------------------------------------------------------------------

export interface DeclaredOrgContext {
  readonly industry: Industry;
  readonly tier: OrgSizeTier;
}

export type PolicyApplicationResult =
  | { readonly ok: true; readonly problem: OptimizationProblem }
  | {
      readonly ok: false;
      readonly reasonCode: "INDUSTRY_MISMATCH" | "TIER_MISMATCH" | "PROBLEM_INVALID";
      readonly detail: string | null;
    };

/**
 * Apply a policy to a base OptimizationInputs ONLY when it matches the
 * declared org context (industry + tier). A mismatched industry REFUSES with
 * `INDUSTRY_MISMATCH` (detail: `policy:<x> org:<y>`); a mismatched tier
 * REFUSES with `TIER_MISMATCH`. On match, the policy is overlaid and the
 * kernel validates the result; a kernel refusal surfaces as
 * `PROBLEM_INVALID` carrying the REAL `prepareOptimizationInputs` reason.
 */
export function applyPolicyWithGuard(
  baseInputs: OptimizationInputs,
  policy: IndustryOptimizationPolicy,
  declared: DeclaredOrgContext,
): PolicyApplicationResult {
  if (policy.industry !== declared.industry) {
    return {
      ok: false,
      reasonCode: "INDUSTRY_MISMATCH",
      detail: `policy:${policy.industry} org:${declared.industry}`,
    };
  }
  if (policy.tier !== declared.tier) {
    return {
      ok: false,
      reasonCode: "TIER_MISMATCH",
      detail: `policy:${policy.tier} org:${declared.tier}`,
    };
  }
  const overlaid = applyIndustryPolicy(baseInputs, policy);
  const validation = prepareOptimizationInputs(overlaid);
  if (!validation.ok) {
    return {
      ok: false,
      reasonCode: "PROBLEM_INVALID",
      detail: `${validation.reasonCode}:${validation.detail ?? ""}`,
    };
  }
  return { ok: true, problem: validation.problem };
}
