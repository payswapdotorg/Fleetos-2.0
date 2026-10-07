/**
 * @fleetos/agent-organizations — F230C org configuration tests: org →
 * teams → agents validation, membership lifecycle, policy CEILINGS.
 */
import { describe, expect, it } from "vitest";
import {
  countActiveMembers,
  enforceMaxConcurrentRoles,
  enforceRoleBudgetCeiling,
  legalMembershipTransitions,
  transitionMembership,
  validateOrganization,
  type OrganizationRecord,
  type TeamMembershipRecord,
  type TenantScope,
} from "../src/index.js";

const TENANT: TenantScope = { tenantId: "acme" };

function baseOrg(overrides: Partial<OrganizationRecord> = {}): OrganizationRecord {
  return {
    id: "org-1",
    tenant: TENANT,
    name: "Fleet Ops Org",
    agents: [
      { id: "agent-1", displayName: "Alpha" },
      { id: "agent-2", displayName: "Beta" },
    ],
    teams: [{ id: "team-1", name: "Field Team", memberAgentIds: ["agent-1"] }],
    roles: [
      {
        id: "role-ops",
        name: "Operator",
        capabilities: ["read_asset"],
        responsibilities: ["fleet-ops"],
      },
    ],
    policyCeilings: {
      maxConcurrentRolesPerAgent: 2,
      maxRoleBudgetUnits: 10000,
      maxRoleBudgetSpendMinor: 500000,
      maxAgentsPerTeam: 5,
    },
    ...overrides,
  };
}

function baseMembership(overrides: Partial<TeamMembershipRecord> = {}): TeamMembershipRecord {
  return {
    id: "mem-1",
    tenant: TENANT,
    organizationId: "org-1",
    teamId: "team-1",
    agentId: "agent-1",
    status: "pending",
    joinedAt: null,
    removedAt: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Organization validation.
// ---------------------------------------------------------------------------

describe("validateOrganization", () => {
  it("accepts a well-formed org with teams, agents, roles and ceilings", () => {
    expect(validateOrganization(baseOrg()).ok).toBe(true);
  });

  it("refuses empty org id / name with ORG_ID_EMPTY / ORG_NAME_EMPTY", () => {
    expect(validateOrganization(baseOrg({ id: "" }))).toMatchObject({ ok: false, reasonCode: "ORG_ID_EMPTY" });
    expect(validateOrganization(baseOrg({ name: "" }))).toMatchObject({ ok: false, reasonCode: "ORG_NAME_EMPTY" });
  });

  it("refuses duplicated agent ids with AGENT_ID_DUPLICATED and the id as subject", () => {
    const org = baseOrg({
      agents: [
        { id: "agent-1", displayName: "Alpha" },
        { id: "agent-1", displayName: "Alpha-2" },
      ],
    });
    expect(validateOrganization(org)).toMatchObject({ ok: false, reasonCode: "AGENT_ID_DUPLICATED", subjectId: "agent-1" });
  });

  it("refuses a team referencing an unknown agent with UNKNOWN_TEAM_AGENT", () => {
    const org = baseOrg({
      teams: [{ id: "team-1", name: "T", memberAgentIds: ["agent-9"] }],
    });
    expect(validateOrganization(org)).toMatchObject({ ok: false, reasonCode: "UNKNOWN_TEAM_AGENT", subjectId: "agent-9" });
  });

  it("refuses team size above the ceiling with the exact overshoot", () => {
    const org = baseOrg({
      policyCeilings: { maxConcurrentRolesPerAgent: 2, maxRoleBudgetUnits: 10000, maxRoleBudgetSpendMinor: 500000, maxAgentsPerTeam: 1 },
      teams: [{ id: "team-1", name: "T", memberAgentIds: ["agent-1", "agent-2"] }],
    });
    expect(validateOrganization(org)).toMatchObject({
      ok: false,
      reasonCode: "TEAM_SIZE_CEILING_EXCEEDED",
      subjectId: "team-1",
      overshoot: 1,
    });
  });

  it("refuses a maxConcurrentRolesPerAgent ceiling below one (unsatisfiable invariant)", () => {
    const org = baseOrg({
      policyCeilings: { maxConcurrentRolesPerAgent: 0, maxRoleBudgetUnits: 1, maxRoleBudgetSpendMinor: 1, maxAgentsPerTeam: 5 },
    });
    expect(validateOrganization(org)).toMatchObject({ ok: false, reasonCode: "POLICY_MAX_CONCURRENT_ROLES_BELOW_ONE" });
  });

  it("refuses negative or non-integer policy ceilings", () => {
    const neg = baseOrg({
      policyCeilings: { maxConcurrentRolesPerAgent: 2, maxRoleBudgetUnits: -1, maxRoleBudgetSpendMinor: 1, maxAgentsPerTeam: 5 },
    });
    expect(validateOrganization(neg)).toMatchObject({ ok: false, reasonCode: "POLICY_NEGATIVE_CEILING" });
    const frac = baseOrg({
      policyCeilings: { maxConcurrentRolesPerAgent: 2.5, maxRoleBudgetUnits: 1, maxRoleBudgetSpendMinor: 1, maxAgentsPerTeam: 5 },
    });
    expect(validateOrganization(frac)).toMatchObject({ ok: false, reasonCode: "NON_INTEGER_CEILING" });
  });

  it("refuses an invalid role definition with ROLE_DEFINITION_INVALID", () => {
    const org = baseOrg({
      roles: [{ id: "role-bad", name: "Bad", capabilities: [], responsibilities: [] }],
    });
    expect(validateOrganization(org)).toMatchObject({ ok: false, reasonCode: "ROLE_DEFINITION_INVALID", subjectId: "role-bad" });
  });

  it("refuses duplicated team ids and duplicated team membership", () => {
    const dupTeam = baseOrg({
      teams: [
        { id: "team-1", name: "A", memberAgentIds: ["agent-1"] },
        { id: "team-1", name: "B", memberAgentIds: ["agent-2"] },
      ],
    });
    expect(validateOrganization(dupTeam)).toMatchObject({ ok: false, reasonCode: "TEAM_ID_DUPLICATED" });
    const dupMember = baseOrg({
      teams: [{ id: "team-1", name: "A", memberAgentIds: ["agent-1", "agent-1"] }],
    });
    expect(validateOrganization(dupMember)).toMatchObject({ ok: false, reasonCode: "TEAM_AGENT_DUPLICATED" });
  });
});

// ---------------------------------------------------------------------------
// Membership lifecycle: pending → active → removed.
// ---------------------------------------------------------------------------

describe("membership lifecycle", () => {
  it("approves a pending membership and records joinedAt", () => {
    const result = transitionMembership(baseMembership(), { kind: "approve", at: 50 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.membership.status).toBe("active");
      expect(result.membership.joinedAt).toBe(50);
    }
  });

  it("removes an active membership and records removedAt", () => {
    const active = baseMembership({ status: "active", joinedAt: 50 });
    const result = transitionMembership(active, { kind: "remove", at: 90 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.membership.status).toBe("removed");
  });

  it("removes a pending membership directly (never approved)", () => {
    const result = transitionMembership(baseMembership(), { kind: "remove", at: 20 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.membership.status).toBe("removed");
  });

  it("refuses approving an active membership with ILLEGAL_TRANSITION", () => {
    const active = baseMembership({ status: "active", joinedAt: 50 });
    expect(transitionMembership(active, { kind: "approve", at: 60 })).toMatchObject({
      ok: false,
      reasonCode: "ILLEGAL_TRANSITION",
    });
  });

  it("refuses every command on a removed membership with TERMINAL_STATE", () => {
    const removed = baseMembership({ status: "removed", removedAt: 90 });
    expect(transitionMembership(removed, { kind: "approve", at: 100 })).toMatchObject({ ok: false, reasonCode: "TERMINAL_STATE" });
    expect(transitionMembership(removed, { kind: "remove", at: 100 })).toMatchObject({ ok: false, reasonCode: "TERMINAL_STATE" });
  });

  it("the legal-transition table is pending→{approve,remove}, active→{remove}, removed→{}", () => {
    expect(legalMembershipTransitions("pending")).toEqual(["approve", "remove"]);
    expect(legalMembershipTransitions("active")).toEqual(["remove"]);
    expect(legalMembershipTransitions("removed")).toEqual([]);
  });

  it("countActiveMembers counts only active memberships of that team", () => {
    const all = [
      baseMembership({ id: "m1", status: "active", joinedAt: 1 }),
      baseMembership({ id: "m2", status: "pending" }),
      baseMembership({ id: "m3", status: "removed", removedAt: 2 }),
      baseMembership({ id: "m4", teamId: "team-2", status: "active", joinedAt: 1 }),
    ];
    expect(countActiveMembers(all, "team-1")).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Policy ceilings — CEILINGS, never authorizations (AGENTS.md law).
// ---------------------------------------------------------------------------

describe("enforceMaxConcurrentRoles", () => {
  it("satisfying the ceiling is explicitly NOT an authorization (note on success)", () => {
    const result = enforceMaxConcurrentRoles(baseOrg(), "agent-1", 1, 1);
    expect(result).toEqual({ ok: true, note: "ceiling-satisfied-not-authorization" });
  });

  it("refuses above the ceiling with the exact overshoot", () => {
    const result = enforceMaxConcurrentRoles(baseOrg(), "agent-1", 2, 1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("MAX_CONCURRENT_ROLES_EXCEEDED");
      expect(result.currentCount).toBe(2);
      expect(result.ceiling).toBe(2);
      expect(result.overshoot).toBe(1);
    }
  });

  it("refuses negative counts with NEGATIVE_AMOUNT", () => {
    expect(enforceMaxConcurrentRoles(baseOrg(), "agent-1", -1, 1)).toMatchObject({
      ok: false,
      reasonCode: "NEGATIVE_AMOUNT",
    });
  });
});

describe("enforceRoleBudgetCeiling", () => {
  it("accepts a role budget within the org ceiling (not an authorization)", () => {
    const result = enforceRoleBudgetCeiling(baseOrg(), { roleId: "role-ops", units: 9999, spendMinor: 499999 });
    expect(result).toEqual({ ok: true, note: "ceiling-satisfied-not-authorization" });
  });

  it("refuses unit ceiling overshoot with the exact overshoot", () => {
    const result = enforceRoleBudgetCeiling(baseOrg(), { roleId: "role-ops", units: 10001, spendMinor: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("ROLE_BUDGET_UNITS_CEILING_EXCEEDED");
      expect(result.overshoot).toBe(1);
      expect(result.ceiling).toBe(10000);
    }
  });

  it("refuses spend ceiling overshoot with the exact overshoot in minor units", () => {
    const result = enforceRoleBudgetCeiling(baseOrg(), { roleId: "role-ops", units: 0, spendMinor: 500001 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("ROLE_BUDGET_SPEND_CEILING_EXCEEDED");
      expect(result.overshoot).toBe(1);
    }
  });

  it("refuses non-integer and negative amounts", () => {
    expect(enforceRoleBudgetCeiling(baseOrg(), { roleId: "r", units: 1.5, spendMinor: 0 })).toMatchObject({
      ok: false,
      reasonCode: "NON_INTEGER_AMOUNT",
    });
    expect(enforceRoleBudgetCeiling(baseOrg(), { roleId: "r", units: -1, spendMinor: 0 })).toMatchObject({
      ok: false,
      reasonCode: "NEGATIVE_AMOUNT",
    });
  });
});
