/**
 * @fleetos/agent-organizations — industry archetypes (F290C, Wave 9 lane C).
 *
 * Industry-specific organization archetypes: DATA + pure constructors over
 * the EXISTING contracts. Each archetype pairs an industry × org-size tier
 * with a REAL `AgentRoleDefinition` topology, a capability budget ENVELOPE
 * (`OrganizationPolicyCeilings` + `BudgetFloor[]`), routing OBJECTIVE
 * weights (`OptimizationGoals` — cost vs latency vs capability-fit as
 * explicit integer bps), a ladder preference, the industry's required skill
 * tags (for gateway capability matching) and an HONEST assumptions note.
 *
 * Archetypes never fork the machinery — they are policy DATA that feeds the
 * existing `prepareOptimizationInputs` / `allocateRoles` / `optimizeRouting`
 * / `rebalanceBudgets` seams. `validateArchetype` runs the EXISTING
 * validators (`validateRoleDefinition`, `goalWeightSumBps`, the constraint
 * rules) so every artifact is machine-proven to pass the kernel.
 *
 * Pure deterministic TS; no `Date.now`/`Math.random`; logical inputs only.
 */

import type { AgentRoleDefinition } from "../roles.js";
import { validateRoleDefinition } from "../roles.js";
import type { OrganizationPolicyCeilings } from "../org-config.js";
import type { OptimizationGoals, BudgetFloor } from "../optimization-inputs.js";
import { goalWeightSumBps } from "../optimization-inputs.js";
import { fnv1a32 } from "../internal-digest.js";

// ---------------------------------------------------------------------------
// Vocabulary — the in-lane industry taxonomy (self-contained; no import of
// the adoption-suite taxonomy, which is a different bounded context).
// ---------------------------------------------------------------------------

export type Industry =
  | "manufacturing"
  | "logistics"
  | "energy-utilities"
  | "facilities"
  | "field-services"
  | "construction";

export type OrgSizeTier = "small" | "medium" | "large";

export type LadderPreference = "cost-first" | "latency-first" | "quality-first";

// ---------------------------------------------------------------------------
// The archetype record — pure data over the existing contracts.
// ---------------------------------------------------------------------------

export interface IndustryArchetype {
  readonly industry: Industry;
  readonly tier: OrgSizeTier;
  readonly roles: readonly AgentRoleDefinition[];
  readonly policyCeilings: OrganizationPolicyCeilings;
  readonly budgetFloors: readonly BudgetFloor[];
  readonly goals: OptimizationGoals;
  readonly ladderPreference: LadderPreference;
  readonly skillRequirements: readonly string[];
  readonly industryAssumptions: string;
  /** specialist-heavy industries afford specialist agents; cost-controlled industries enforce tighter spend. */
  readonly envelopeKind: "specialist-heavy" | "cost-controlled";
}

export type ArchetypeReasonCode =
  | "ROLES_EMPTY"
  | "ROLE_INVALID"
  | "GOALS_INVALID"
  | "CEILINGS_INVALID"
  | "FLOORS_INVALID"
  | "SKILL_REQUIREMENTS_EMPTY"
  | "ASSUMPTIONS_EMPTY";

export type ArchetypeValidation =
  | { readonly ok: true; readonly archetype: IndustryArchetype }
  | { readonly ok: false; readonly reasonCode: ArchetypeReasonCode; readonly detail: string | null };

export const INDUSTRIES: readonly Industry[] = [
  "manufacturing",
  "logistics",
  "energy-utilities",
  "facilities",
  "field-services",
  "construction",
];

export const ORG_SIZE_TIERS: readonly OrgSizeTier[] = ["small", "medium", "large"];

// ---------------------------------------------------------------------------
// Per-industry objective weights + ladder preference + skill requirements +
// the honest assumptions note. These are the industry-CONSTANT policy dials;
// the tier-scaled envelope is applied on top.
// ---------------------------------------------------------------------------

interface IndustryDials {
  readonly goals: OptimizationGoals;
  readonly ladderPreference: LadderPreference;
  readonly skillRequirements: readonly string[];
  readonly assumptions: string;
  /** specialist-heavy industries afford specialist agents (higher spend ceiling); cost-controlled industries enforce tighter spend. */
  readonly envelopeKind: "specialist-heavy" | "cost-controlled";
  readonly floorCapability: string;
}

const INDUSTRY_DIALS: Record<Industry, IndustryDials> = {
  manufacturing: {
    goals: { costWeightBps: 3000, capabilityFitWeightBps: 6000, latencyWeightBps: 1000 },
    ladderPreference: "quality-first",
    skillRequirements: ["model_invoke", "analyze-telemetry", "forecast"],
    assumptions:
      "Assumes discrete-process production with deterministic shift cycles; does not model continuous-flow chemical batching.",
    envelopeKind: "specialist-heavy",
    floorCapability: "model_invoke",
  },
  logistics: {
    goals: { costWeightBps: 3000, capabilityFitWeightBps: 2000, latencyWeightBps: 5000 },
    ladderPreference: "latency-first",
    skillRequirements: ["model_invoke", "route-opt", "forecast"],
    assumptions:
      "Assumes hub-and-spoke distribution with a bounded road fleet; does not model multi-modal maritime routing.",
    envelopeKind: "cost-controlled",
    floorCapability: "model_invoke",
  },
  "energy-utilities": {
    goals: { costWeightBps: 1500, capabilityFitWeightBps: 4500, latencyWeightBps: 4000 },
    ladderPreference: "latency-first",
    skillRequirements: ["model_invoke", "analyze-telemetry", "grid-balance"],
    assumptions:
      "Assumes a regulated grid operator with SCADA telemetry; does not model distributed renewable prosumer markets.",
    envelopeKind: "specialist-heavy",
    floorCapability: "model_invoke",
  },
  facilities: {
    goals: { costWeightBps: 4000, capabilityFitWeightBps: 2500, latencyWeightBps: 3500 },
    ladderPreference: "cost-first",
    skillRequirements: ["model_invoke", "schedule", "summarize"],
    assumptions:
      "Assumes multi-site commercial facilities management; does not model industrial process plants.",
    envelopeKind: "cost-controlled",
    floorCapability: "model_invoke",
  },
  "field-services": {
    goals: { costWeightBps: 3500, capabilityFitWeightBps: 1500, latencyWeightBps: 5000 },
    ladderPreference: "latency-first",
    skillRequirements: ["model_invoke", "dispatch", "route-opt"],
    assumptions:
      "Assumes mobile technician dispatch over a road network; does not model offshore or aerial operations.",
    envelopeKind: "specialist-heavy",
    floorCapability: "model_invoke",
  },
  construction: {
    goals: { costWeightBps: 4500, capabilityFitWeightBps: 4000, latencyWeightBps: 1500 },
    ladderPreference: "cost-first",
    skillRequirements: ["model_invoke", "schedule", "forecast"],
    assumptions:
      "Assumes staged commercial construction projects; does not model modular prefab assembly lines.",
    envelopeKind: "cost-controlled",
    floorCapability: "model_invoke",
  },
};

// ---------------------------------------------------------------------------
// Tier scaling — concurrent-roles ceiling + per-role budget unit ceiling +
// team size grow with tier; the spend ceiling grows with tier AND diverges
// by envelope kind (specialist-heavy industries can afford higher spend).
// ---------------------------------------------------------------------------

interface TierEnvelope {
  readonly maxConcurrentRolesPerAgent: number;
  readonly maxRoleBudgetUnits: number;
  readonly maxAgentsPerTeam: number;
  readonly specialistSpendMinor: number;
  readonly costControlledSpendMinor: number;
  readonly floorUnits: number;
  readonly floorSpendMinor: number;
}

const TIER_ENVELOPES: Record<OrgSizeTier, TierEnvelope> = {
  small: {
    maxConcurrentRolesPerAgent: 2, maxRoleBudgetUnits: 1000, maxAgentsPerTeam: 5,
    specialistSpendMinor: 80000, costControlledSpendMinor: 30000,
    floorUnits: 100, floorSpendMinor: 5000,
  },
  medium: {
    maxConcurrentRolesPerAgent: 3, maxRoleBudgetUnits: 2000, maxAgentsPerTeam: 8,
    specialistSpendMinor: 160000, costControlledSpendMinor: 60000,
    floorUnits: 200, floorSpendMinor: 10000,
  },
  large: {
    maxConcurrentRolesPerAgent: 4, maxRoleBudgetUnits: 4000, maxAgentsPerTeam: 12,
    specialistSpendMinor: 320000, costControlledSpendMinor: 120000,
    floorUnits: 400, floorSpendMinor: 20000,
  },
};

// ---------------------------------------------------------------------------
// Role topologies per industry, sized by tier (small = core roles only;
// medium adds a specialist; large adds a coordinator). Every role passes
// `validateRoleDefinition` (non-empty id/name, non-empty + duplicate-free
// capabilities and responsibilities).
// ---------------------------------------------------------------------------

function rolesFor(industry: Industry, tier: OrgSizeTier): readonly AgentRoleDefinition[] {
  const base = ROLE_TOPOLOGIES[industry];
  if (tier === "small") return base.core;
  if (tier === "medium") return [...base.core, base.specialist];
  return [...base.core, base.specialist, base.coordinator];
}

interface RoleTopology {
  readonly core: readonly AgentRoleDefinition[];
  readonly specialist: AgentRoleDefinition;
  readonly coordinator: AgentRoleDefinition;
}

const ROLE_TOPOLOGIES: Record<Industry, RoleTopology> = {
  manufacturing: {
    core: [
      { id: "mfg-ops", name: "Manufacturing Operations", capabilities: ["model_invoke", "analyze-telemetry"], responsibilities: ["run-production"] },
      { id: "mfg-quality", name: "Quality Control", capabilities: ["model_invoke", "forecast"], responsibilities: ["quality-control"] },
    ],
    specialist: { id: "mfg-maintenance", name: "Equipment Health", capabilities: ["model_invoke", "analyze-telemetry"], responsibilities: ["equipment-health"] },
    coordinator: { id: "mfg-supply", name: "Supply Planning", capabilities: ["forecast", "model_invoke"], responsibilities: ["supply-planning"] },
  },
  logistics: {
    core: [
      { id: "log-dispatch", name: "Dispatch", capabilities: ["model_invoke", "route-opt"], responsibilities: ["dispatch"] },
      { id: "log-forecast", name: "Demand Forecast", capabilities: ["model_invoke", "forecast"], responsibilities: ["demand-forecast"] },
    ],
    specialist: { id: "log-routing", name: "Route Optimization", capabilities: ["route-opt", "model_invoke"], responsibilities: ["route-optimization"] },
    coordinator: { id: "log-network", name: "Network Planning", capabilities: ["forecast", "route-opt"], responsibilities: ["network-planning"] },
  },
  "energy-utilities": {
    core: [
      { id: "enu-ops", name: "Grid Operations", capabilities: ["model_invoke", "analyze-telemetry"], responsibilities: ["grid-ops"] },
      { id: "enu-balance", name: "Load Balance", capabilities: ["model_invoke", "grid-balance"], responsibilities: ["load-balance"] },
    ],
    specialist: { id: "enu-forecast", name: "Demand Forecast", capabilities: ["model_invoke", "forecast"], responsibilities: ["demand-forecast"] },
    coordinator: { id: "enu-dispatch", name: "Outage Dispatch", capabilities: ["model_invoke", "dispatch"], responsibilities: ["outage-dispatch"] },
  },
  facilities: {
    core: [
      { id: "fac-ops", name: "Facility Operations", capabilities: ["model_invoke", "schedule"], responsibilities: ["facility-ops"] },
      { id: "fac-maint", name: "Maintenance", capabilities: ["model_invoke", "summarize"], responsibilities: ["maintenance"] },
    ],
    specialist: { id: "fac-schedule", name: "Scheduling", capabilities: ["model_invoke", "schedule"], responsibilities: ["scheduling"] },
    coordinator: { id: "fac-compliance", name: "Compliance", capabilities: ["model_invoke", "summarize"], responsibilities: ["compliance-reporting"] },
  },
  "field-services": {
    core: [
      { id: "flds-dispatch", name: "Dispatch", capabilities: ["model_invoke", "dispatch"], responsibilities: ["dispatch"] },
      { id: "flds-route", name: "Routing", capabilities: ["model_invoke", "route-opt"], responsibilities: ["routing"] },
    ],
    specialist: { id: "flds-schedule", name: "Scheduling", capabilities: ["model_invoke", "dispatch"], responsibilities: ["scheduling"] },
    coordinator: { id: "flds-escalation", name: "Escalation", capabilities: ["model_invoke", "summarize"], responsibilities: ["escalation-handling"] },
  },
  construction: {
    core: [
      { id: "con-ops", name: "Site Operations", capabilities: ["model_invoke", "schedule"], responsibilities: ["site-ops"] },
      { id: "con-cost", name: "Cost Control", capabilities: ["model_invoke", "forecast"], responsibilities: ["cost-control"] },
    ],
    specialist: { id: "con-schedule", name: "Scheduling", capabilities: ["model_invoke", "schedule"], responsibilities: ["scheduling"] },
    coordinator: { id: "con-procurement", name: "Procurement Liaison", capabilities: ["model_invoke", "forecast"], responsibilities: ["procurement-liaison"] },
  },
};

// ---------------------------------------------------------------------------
// The registry — 6 industries × 3 tiers = 18 archetypes, built from the dials.
// ---------------------------------------------------------------------------

function buildArchetype(industry: Industry, tier: OrgSizeTier): IndustryArchetype {
  const dials = INDUSTRY_DIALS[industry];
  const env = TIER_ENVELOPES[tier];
  const spendMinor = dials.envelopeKind === "specialist-heavy" ? env.specialistSpendMinor : env.costControlledSpendMinor;
  return {
    industry,
    tier,
    roles: rolesFor(industry, tier),
    policyCeilings: {
      maxConcurrentRolesPerAgent: env.maxConcurrentRolesPerAgent,
      maxRoleBudgetUnits: env.maxRoleBudgetUnits,
      maxRoleBudgetSpendMinor: spendMinor,
      maxAgentsPerTeam: env.maxAgentsPerTeam,
    },
    budgetFloors: [{ capability: dials.floorCapability, minUnits: env.floorUnits, minSpendMinor: env.floorSpendMinor }],
    goals: dials.goals,
    ladderPreference: dials.ladderPreference,
    skillRequirements: dials.skillRequirements,
    industryAssumptions: dials.assumptions,
    envelopeKind: dials.envelopeKind,
  };
}

export const INDUSTRY_ARCHETYPES: readonly IndustryArchetype[] = INDUSTRIES.flatMap((industry) =>
  ORG_SIZE_TIERS.map((tier) => buildArchetype(industry, tier)),
);

// ---------------------------------------------------------------------------
// Lookups + validation + digest — pure constructors.
// ---------------------------------------------------------------------------

export function getArchetype(industry: Industry, tier: OrgSizeTier): IndustryArchetype | null {
  for (const a of INDUSTRY_ARCHETYPES) {
    if (a.industry === industry && a.tier === tier) return a;
  }
  return null;
}

export function listArchetypes(): readonly IndustryArchetype[] {
  return INDUSTRY_ARCHETYPES;
}

export function listIndustries(): readonly Industry[] {
  return INDUSTRIES;
}

export function listTiers(): readonly OrgSizeTier[] {
  return ORG_SIZE_TIERS;
}

/**
 * Validate an archetype against the EXISTING kernel validators: every role
 * must pass `validateRoleDefinition`; goal weights must be valid integer bps
 * (non-negative, sum 1..10000); ceilings must be positive integers; floors
 * must be valid (non-empty capability, non-negative integers, no
 * duplicates); skill requirements non-empty; assumptions non-empty. Pure.
 */
export function validateArchetype(archetype: IndustryArchetype): ArchetypeValidation {
  if (!Array.isArray(archetype.roles) || archetype.roles.length === 0) {
    return { ok: false, reasonCode: "ROLES_EMPTY", detail: null };
  }
  for (const role of archetype.roles) {
    const check = validateRoleDefinition(role);
    if (!check.ok) {
      return { ok: false, reasonCode: "ROLE_INVALID", detail: `${role.id}:${check.reasonCode}` };
    }
  }
  const sum = goalWeightSumBps(archetype.goals);
  if (
    !Number.isInteger(archetype.goals.costWeightBps) ||
    !Number.isInteger(archetype.goals.capabilityFitWeightBps) ||
    !Number.isInteger(archetype.goals.latencyWeightBps) ||
    archetype.goals.costWeightBps < 0 ||
    archetype.goals.capabilityFitWeightBps < 0 ||
    archetype.goals.latencyWeightBps < 0 ||
    sum === 0 ||
    sum > 10000
  ) {
    return { ok: false, reasonCode: "GOALS_INVALID", detail: `sum:${sum}` };
  }
  const c = archetype.policyCeilings;
  if (
    !Number.isInteger(c.maxConcurrentRolesPerAgent) || c.maxConcurrentRolesPerAgent < 1 ||
    !Number.isInteger(c.maxRoleBudgetUnits) || c.maxRoleBudgetUnits < 0 ||
    !Number.isInteger(c.maxRoleBudgetSpendMinor) || c.maxRoleBudgetSpendMinor < 0 ||
    !Number.isInteger(c.maxAgentsPerTeam) || c.maxAgentsPerTeam < 0
  ) {
    return { ok: false, reasonCode: "CEILINGS_INVALID", detail: null };
  }
  const seenFloor = new Set<string>();
  for (const floor of archetype.budgetFloors) {
    if (typeof floor.capability !== "string" || floor.capability.length === 0) {
      return { ok: false, reasonCode: "FLOORS_INVALID", detail: "CAPABILITY_EMPTY" };
    }
    if (!Number.isInteger(floor.minUnits) || !Number.isInteger(floor.minSpendMinor) || floor.minUnits < 0 || floor.minSpendMinor < 0) {
      return { ok: false, reasonCode: "FLOORS_INVALID", detail: floor.capability };
    }
    if (seenFloor.has(floor.capability)) {
      return { ok: false, reasonCode: "FLOORS_INVALID", detail: `DUP:${floor.capability}` };
    }
    seenFloor.add(floor.capability);
  }
  if (!Array.isArray(archetype.skillRequirements) || archetype.skillRequirements.length === 0) {
    return { ok: false, reasonCode: "SKILL_REQUIREMENTS_EMPTY", detail: null };
  }
  if (typeof archetype.industryAssumptions !== "string" || archetype.industryAssumptions.length === 0) {
    return { ok: false, reasonCode: "ASSUMPTIONS_EMPTY", detail: null };
  }
  return { ok: true, archetype };
}

/** Deterministic FNV-1a digest over the archetype definition. */
export function computeArchetypeDigest(archetype: IndustryArchetype): string {
  return `indarch_${fnv1a32([
    archetype.industry,
    archetype.tier,
    archetype.roles.map((r) => `${r.id}>${r.capabilities.join("+")}>${r.responsibilities.join("+")}`).join(";"),
    archetype.policyCeilings.maxConcurrentRolesPerAgent,
    archetype.policyCeilings.maxRoleBudgetUnits,
    archetype.policyCeilings.maxRoleBudgetSpendMinor,
    archetype.policyCeilings.maxAgentsPerTeam,
    archetype.budgetFloors.map((f) => `${f.capability}:${f.minUnits}/${f.minSpendMinor}`).join(";"),
    archetype.goals.costWeightBps,
    archetype.goals.capabilityFitWeightBps,
    archetype.goals.latencyWeightBps,
    archetype.ladderPreference,
    archetype.skillRequirements.join(","),
  ])}`;
}
