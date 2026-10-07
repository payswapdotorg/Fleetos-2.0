/**
 * @fleetos/agent-organizations — organization configuration: org → teams →
 * agents, membership lifecycle, and org-level policy CEILINGS (F230C).
 *
 * Laws:
 *   A5/A6 — org policy ceilings (max concurrent roles, budget ceilings)
 *           are CEILINGS, NOT authorizations. Satisfying a ceiling
 *           authorizes nothing; Guardian adjudicates every consequential
 *           capability. This module encodes that in its vocabulary:
 *           every function here VALIDATES or REFUSES — none GRANTS.
 *   A8    — tenant isolation, fail-closed.
 *
 * Pure deterministic TS; logical time as explicit number input; integer
 * minor units and integer unit counts only.
 */

import type { TenantScope } from "./contracts.js";
import { validateTenantScope } from "./contracts.js";
import type { AgentRoleDefinition } from "./roles.js";
import { validateRoleDefinition } from "./roles.js";

// ---------------------------------------------------------------------------
// Org records: org → teams → agents.
// ---------------------------------------------------------------------------

export interface OrganizationAgentRecord {
  readonly id: string;
  readonly displayName: string;
}

export interface OrganizationTeamRecord {
  readonly id: string;
  readonly name: string;
  readonly memberAgentIds: readonly string[];
}

/** Org-level policy CEILINGS — never authorizations (law A5/A6). */
export interface OrganizationPolicyCeilings {
  readonly maxConcurrentRolesPerAgent: number;
  readonly maxRoleBudgetUnits: number;
  readonly maxRoleBudgetSpendMinor: number;
  readonly maxAgentsPerTeam: number;
}

export interface OrganizationRecord {
  readonly id: string;
  readonly tenant: TenantScope;
  readonly name: string;
  readonly agents: readonly OrganizationAgentRecord[];
  readonly teams: readonly OrganizationTeamRecord[];
  readonly roles: readonly AgentRoleDefinition[];
  readonly policyCeilings: OrganizationPolicyCeilings;
}

export type OrgValidationReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "ORG_ID_EMPTY"
  | "ORG_NAME_EMPTY"
  | "AGENT_ID_EMPTY"
  | "AGENT_ID_DUPLICATED"
  | "AGENT_NAME_EMPTY"
  | "TEAM_ID_EMPTY"
  | "TEAM_ID_DUPLICATED"
  | "TEAM_NAME_EMPTY"
  | "UNKNOWN_TEAM_AGENT"
  | "TEAM_AGENT_DUPLICATED"
  | "TEAM_SIZE_CEILING_EXCEEDED"
  | "ROLE_ID_DUPLICATED"
  | "ROLE_DEFINITION_INVALID"
  | "POLICY_MAX_CONCURRENT_ROLES_BELOW_ONE"
  | "POLICY_NEGATIVE_CEILING"
  | "ROLE_BUDGET_UNITS_CEILING_EXCEEDED"
  | "ROLE_BUDGET_SPEND_CEILING_EXCEEDED"
  | "NON_INTEGER_CEILING";

export type OrgValidation =
  | { readonly ok: true; readonly organization: OrganizationRecord }
  | {
      readonly ok: false;
      readonly reasonCode: OrgValidationReasonCode;
      readonly subjectId: string | null;
      readonly overshoot: number | null;
    };

/**
 * Deterministic validation of an organization record with reason codes:
 * id/name presence, unique agents, unique teams, team members must be
 * declared agents, team-size ceiling, unique + valid roles, and policy
 * ceilings (positive integers; per-role budgets bounded by the org
 * ceiling — the ceiling is enforced here because it is structural, not
 * an authorization).
 */
export function validateOrganization(org: OrganizationRecord): OrgValidation {
  const tenantCheck = validateTenantScope(org.tenant);
  if (!tenantCheck.ok) return failOrg("TENANT_SCOPE_MISSING", null, null);
  if (typeof org.id !== "string" || org.id.length === 0) return failOrg("ORG_ID_EMPTY", null, null);
  if (typeof org.name !== "string" || org.name.length === 0) return failOrg("ORG_NAME_EMPTY", null, null);

  const agentIds = new Set<string>();
  for (const agent of org.agents) {
    if (typeof agent.id !== "string" || agent.id.length === 0) {
      return failOrg("AGENT_ID_EMPTY", null, null);
    }
    if (typeof agent.displayName !== "string" || agent.displayName.length === 0) {
      return failOrg("AGENT_NAME_EMPTY", agent.id, null);
    }
    if (agentIds.has(agent.id)) return failOrg("AGENT_ID_DUPLICATED", agent.id, null);
    agentIds.add(agent.id);
  }

  const policy = org.policyCeilings;
  if (
    !Number.isInteger(policy.maxConcurrentRolesPerAgent) ||
    !Number.isInteger(policy.maxRoleBudgetUnits) ||
    !Number.isInteger(policy.maxRoleBudgetSpendMinor) ||
    !Number.isInteger(policy.maxAgentsPerTeam)
  ) {
    return failOrg("NON_INTEGER_CEILING", null, null);
  }
  if (policy.maxConcurrentRolesPerAgent < 1) {
    return failOrg("POLICY_MAX_CONCURRENT_ROLES_BELOW_ONE", null, null);
  }
  if (
    policy.maxRoleBudgetUnits < 0 ||
    policy.maxRoleBudgetSpendMinor < 0 ||
    policy.maxAgentsPerTeam < 0
  ) {
    return failOrg("POLICY_NEGATIVE_CEILING", null, null);
  }

  const teamIds = new Set<string>();
  for (const team of org.teams) {
    if (typeof team.id !== "string" || team.id.length === 0) {
      return failOrg("TEAM_ID_EMPTY", null, null);
    }
    if (typeof team.name !== "string" || team.name.length === 0) {
      return failOrg("TEAM_NAME_EMPTY", team.id, null);
    }
    if (teamIds.has(team.id)) return failOrg("TEAM_ID_DUPLICATED", team.id, null);
    teamIds.add(team.id);
    const members = new Set<string>();
    for (const memberId of team.memberAgentIds) {
      if (!agentIds.has(memberId)) return failOrg("UNKNOWN_TEAM_AGENT", memberId, null);
      if (members.has(memberId)) return failOrg("TEAM_AGENT_DUPLICATED", memberId, null);
      members.add(memberId);
    }
    if (team.memberAgentIds.length > policy.maxAgentsPerTeam) {
      return failOrg(
        "TEAM_SIZE_CEILING_EXCEEDED",
        team.id,
        team.memberAgentIds.length - policy.maxAgentsPerTeam,
      );
    }
  }

  const roleIds = new Set<string>();
  for (const role of org.roles) {
    // Role-definition validity is delegated to the roles module's pure
    // validator (in-package — no cross-context import).
    const roleCheck = validateRoleDefinition(role);
    if (!roleCheck.ok) {
      return failOrg("ROLE_DEFINITION_INVALID", role.id, null);
    }
    if (roleIds.has(role.id)) return failOrg("ROLE_ID_DUPLICATED", role.id, null);
    roleIds.add(role.id);
  }

  return { ok: true, organization: org };
}

function failOrg(
  reasonCode: OrgValidationReasonCode,
  subjectId: string | null,
  overshoot: number | null,
): OrgValidation {
  return { ok: false, reasonCode, subjectId, overshoot };
}

// ---------------------------------------------------------------------------
// Membership lifecycle: pending → active → removed (terminal).
// ---------------------------------------------------------------------------

export type MembershipStatus = "pending" | "active" | "removed";

export interface TeamMembershipRecord {
  readonly id: string;
  readonly tenant: TenantScope;
  readonly organizationId: string;
  readonly teamId: string;
  readonly agentId: string;
  readonly status: MembershipStatus;
  readonly joinedAt: number | null;
  readonly removedAt: number | null;
}

export type MembershipCommand =
  | { readonly kind: "approve"; readonly at: number }
  | { readonly kind: "remove"; readonly at: number };

export type MembershipTransitionReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "ILLEGAL_TRANSITION"
  | "TERMINAL_STATE"
  | "NEGATIVE_TIME"
  | "MEMBERSHIP_ID_EMPTY";

export type MembershipTransitionResult =
  | { readonly ok: true; readonly membership: TeamMembershipRecord }
  | { readonly ok: false; readonly reasonCode: MembershipTransitionReasonCode };

const LEGAL_MEMBERSHIP_TRANSITIONS: Readonly<Record<MembershipStatus, readonly MembershipCommand["kind"][]>> = {
  pending: ["approve", "remove"],
  active: ["remove"],
  removed: [],
};

export function legalMembershipTransitions(status: MembershipStatus): readonly MembershipCommand["kind"][] {
  return LEGAL_MEMBERSHIP_TRANSITIONS[status];
}

/** PURE transition: new record returned; illegal paths refuse with codes. */
export function transitionMembership(
  membership: TeamMembershipRecord,
  command: MembershipCommand,
): MembershipTransitionResult {
  const tenantCheck = validateTenantScope(membership.tenant);
  if (!tenantCheck.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  if (typeof membership.id !== "string" || membership.id.length === 0) {
    return { ok: false, reasonCode: "MEMBERSHIP_ID_EMPTY" };
  }
  if (command.at < 0) return { ok: false, reasonCode: "NEGATIVE_TIME" };
  const legal = LEGAL_MEMBERSHIP_TRANSITIONS[membership.status];
  if (!legal.includes(command.kind)) {
    return {
      ok: false,
      reasonCode: membership.status === "removed" ? "TERMINAL_STATE" : "ILLEGAL_TRANSITION",
    };
  }
  const next: TeamMembershipRecord =
    command.kind === "approve"
      ? { ...membership, status: "active", joinedAt: command.at }
      : { ...membership, status: "removed", removedAt: command.at };
  return { ok: true, membership: next };
}

/** Active member count for a team — relieved/removed members do NOT count. */
export function countActiveMembers(
  memberships: readonly TeamMembershipRecord[],
  teamId: string,
): number {
  let count = 0;
  for (const m of memberships) {
    if (m.teamId === teamId && m.status === "active") count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Ceiling enforcement — structural limits, never authorizations.
// ---------------------------------------------------------------------------

export type PolicyEnforcementReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "TENANT_MISMATCH"
  | "ORG_ID_MISMATCH"
  | "MAX_CONCURRENT_ROLES_EXCEEDED"
  | "ROLE_BUDGET_UNITS_CEILING_EXCEEDED"
  | "ROLE_BUDGET_SPEND_CEILING_EXCEEDED"
  | "NON_INTEGER_AMOUNT"
  | "NEGATIVE_AMOUNT";

export type PolicyEnforcementResult =
  | { readonly ok: true; readonly note: "ceiling-satisfied-not-authorization" }
  | {
      readonly ok: false;
      readonly reasonCode: PolicyEnforcementReasonCode;
      readonly subjectId: string | null;
      readonly currentCount: number | null;
      readonly ceiling: number | null;
      readonly overshoot: number | null;
    };

/**
 * Enforce the org's max-concurrent-roles ceiling for one agent given the
 * agent's CURRENT concurrent assignment count and a proposed delta.
 * Refusal carries the exact overshoot. Satisfying the ceiling is NOT an
 * authorization (law A5/A6) — the success note says so explicitly.
 */
export function enforceMaxConcurrentRoles(
  org: OrganizationRecord,
  agentId: string,
  currentConcurrentRoles: number,
  proposedDelta: number,
): PolicyEnforcementResult {
  const tenantCheck = validateTenantScope(org.tenant);
  if (!tenantCheck.ok) return failPolicy("TENANT_SCOPE_MISSING", null, null, null, null);
  if (currentConcurrentRoles < 0 || proposedDelta < 0) {
    return failPolicy("NEGATIVE_AMOUNT", agentId, null, null, null);
  }
  const ceiling = org.policyCeilings.maxConcurrentRolesPerAgent;
  const next = currentConcurrentRoles + proposedDelta;
  if (next > ceiling) {
    return failPolicy(
      "MAX_CONCURRENT_ROLES_EXCEEDED",
      agentId,
      currentConcurrentRoles,
      ceiling,
      next - ceiling,
    );
  }
  return { ok: true, note: "ceiling-satisfied-not-authorization" };
}

/**
 * Enforce the org's per-role budget ceilings against an F230C capability
 * budget allocation (units + integer minor-unit spend). Refusal carries
 * the exact overshoot; never clamped.
 */
export function enforceRoleBudgetCeiling(
  org: OrganizationRecord,
  input: {
    readonly roleId: string;
    readonly units: number;
    readonly spendMinor: number;
  },
): PolicyEnforcementResult {
  const tenantCheck = validateTenantScope(org.tenant);
  if (!tenantCheck.ok) return failPolicy("TENANT_SCOPE_MISSING", null, null, null, null);
  if (!Number.isInteger(input.units) || !Number.isInteger(input.spendMinor)) {
    return failPolicy("NON_INTEGER_AMOUNT", input.roleId, null, null, null);
  }
  if (input.units < 0 || input.spendMinor < 0) {
    return failPolicy("NEGATIVE_AMOUNT", input.roleId, null, null, null);
  }
  if (input.units > org.policyCeilings.maxRoleBudgetUnits) {
    return failPolicy(
      "ROLE_BUDGET_UNITS_CEILING_EXCEEDED",
      input.roleId,
      input.units,
      org.policyCeilings.maxRoleBudgetUnits,
      input.units - org.policyCeilings.maxRoleBudgetUnits,
    );
  }
  if (input.spendMinor > org.policyCeilings.maxRoleBudgetSpendMinor) {
    return failPolicy(
      "ROLE_BUDGET_SPEND_CEILING_EXCEEDED",
      input.roleId,
      input.spendMinor,
      org.policyCeilings.maxRoleBudgetSpendMinor,
      input.spendMinor - org.policyCeilings.maxRoleBudgetSpendMinor,
    );
  }
  return { ok: true, note: "ceiling-satisfied-not-authorization" };
}

function failPolicy(
  reasonCode: PolicyEnforcementReasonCode,
  subjectId: string | null,
  currentCount: number | null,
  ceiling: number | null,
  overshoot: number | null,
): PolicyEnforcementResult {
  return { ok: false, reasonCode, subjectId, currentCount, ceiling, overshoot };
}
