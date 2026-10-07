/**
 * @fleetos/agent-organizations — F230C roles + role-assignment lifecycle tests.
 */
import { describe, expect, it } from "vitest";
import {
  assignRole,
  computeAssignmentDigest,
  countConcurrentAssignments,
  legalAssignmentTransitions,
  roleAllowsCapability,
  transitionRoleAssignment,
  validateRoleDefinition,
  type AgentRoleDefinition,
  type RoleAssignment,
  type TenantScope,
} from "../src/index.js";

const TENANT: TenantScope = { tenantId: "acme" };

function baseRole(): AgentRoleDefinition {
  return {
    id: "role-ops",
    name: "Operator",
    capabilities: ["read_asset", "command_asset"],
    responsibilities: ["fleet-ops", "reporting"],
  };
}

function baseAssignment(overrides: Partial<RoleAssignment> = {}): RoleAssignment {
  const base = {
    id: "asg-1",
    tenant: TENANT,
    organizationId: "org-1",
    agentId: "agent-1",
    roleId: "role-ops",
    status: "assigned" as const,
    assignedAt: 100,
    activatedAt: null as number | null,
    relievedAt: null as number | null,
    reliefReason: null as string | null,
  };
  return { ...base, ...overrides, digest: computeAssignmentDigest(base) };
}

// ---------------------------------------------------------------------------
// Role definitions.
// ---------------------------------------------------------------------------

describe("validateRoleDefinition", () => {
  it("accepts a well-formed role with allow-list and responsibilities", () => {
    const result = validateRoleDefinition(baseRole());
    expect(result.ok).toBe(true);
  });

  it("refuses an empty role id with ROLE_ID_EMPTY", () => {
    const result = validateRoleDefinition({ ...baseRole(), id: "" });
    expect(result).toMatchObject({ ok: false, reasonCode: "ROLE_ID_EMPTY" });
  });

  it("refuses an empty capability allow-list with CAPABILITY_ALLOWLIST_EMPTY", () => {
    const result = validateRoleDefinition({ ...baseRole(), capabilities: [] });
    expect(result).toMatchObject({ ok: false, reasonCode: "CAPABILITY_ALLOWLIST_EMPTY" });
  });

  it("refuses duplicated capabilities with CAPABILITY_DUPLICATED and the duplicate as detail", () => {
    const result = validateRoleDefinition({ ...baseRole(), capabilities: ["read_asset", "read_asset"] });
    expect(result).toMatchObject({ ok: false, reasonCode: "CAPABILITY_DUPLICATED", detail: "read_asset" });
  });

  it("refuses duplicated responsibilities with RESPONSIBILITY_DUPLICATED", () => {
    const result = validateRoleDefinition({ ...baseRole(), responsibilities: ["fleet-ops", "fleet-ops"] });
    expect(result).toMatchObject({ ok: false, reasonCode: "RESPONSIBILITY_DUPLICATED", detail: "fleet-ops" });
  });

  it("roleAllowsCapability answers allow-list membership (a ceiling, not an authorization)", () => {
    expect(roleAllowsCapability(baseRole(), "read_asset")).toBe(true);
    expect(roleAllowsCapability(baseRole(), "inventory_write")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Role-assignment lifecycle.
// ---------------------------------------------------------------------------

describe("transitionRoleAssignment", () => {
  it("activates an assigned assignment and records activatedAt", () => {
    const result = transitionRoleAssignment(baseAssignment(), { kind: "activate", at: 150 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.assignment.status).toBe("active");
      expect(result.assignment.activatedAt).toBe(150);
    }
  });

  it("relieves an active assignment with a reason and records relievedAt", () => {
    const active = baseAssignment({ status: "active", activatedAt: 150 });
    const result = transitionRoleAssignment(active, { kind: "relieve", at: 200, reason: "rotation" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.assignment.status).toBe("relieved");
      expect(result.assignment.relievedAt).toBe(200);
      expect(result.assignment.reliefReason).toBe("rotation");
    }
  });

  it("relieves an assigned assignment directly (never activated)", () => {
    const result = transitionRoleAssignment(baseAssignment(), { kind: "relieve", at: 120, reason: "withdrawn" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.assignment.status).toBe("relieved");
  });

  it("refuses relieving without a reason with RELIEF_REASON_REQUIRED", () => {
    const result = transitionRoleAssignment(baseAssignment(), {
      kind: "relieve",
      at: 200,
      reason: "",
    });
    expect(result).toMatchObject({ ok: false, reasonCode: "RELIEF_REASON_REQUIRED" });
  });

  it("refuses activating an active assignment with ILLEGAL_TRANSITION", () => {
    const active = baseAssignment({ status: "active", activatedAt: 150 });
    const result = transitionRoleAssignment(active, { kind: "activate", at: 160 });
    expect(result).toMatchObject({ ok: false, reasonCode: "ILLEGAL_TRANSITION" });
  });

  it("refuses every command on a relieved assignment with TERMINAL_STATE", () => {
    const relieved = baseAssignment({ status: "relieved", relievedAt: 200, reliefReason: "done" });
    expect(transitionRoleAssignment(relieved, { kind: "activate", at: 210 })).toMatchObject({
      ok: false,
      reasonCode: "TERMINAL_STATE",
    });
    expect(transitionRoleAssignment(relieved, { kind: "relieve", at: 210, reason: "again" })).toMatchObject({
      ok: false,
      reasonCode: "TERMINAL_STATE",
    });
  });

  it("refuses negative logical time with NEGATIVE_TIME", () => {
    const result = transitionRoleAssignment(baseAssignment(), { kind: "activate", at: -1 });
    expect(result).toMatchObject({ ok: false, reasonCode: "NEGATIVE_TIME" });
  });

  it("never mutates the input assignment (pure transition)", () => {
    const original = baseAssignment();
    transitionRoleAssignment(original, { kind: "activate", at: 150 });
    expect(original.status).toBe("assigned");
    expect(original.activatedAt).toBeNull();
  });

  it("the legal-transition table is exactly assigned→{activate,relieve}, active→{relieve}, relieved→{}", () => {
    expect(legalAssignmentTransitions("assigned")).toEqual(["activate", "relieve"]);
    expect(legalAssignmentTransitions("active")).toEqual(["relieve"]);
    expect(legalAssignmentTransitions("relieved")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// N-concurrent-roles invariant.
// ---------------------------------------------------------------------------

describe("assignRole — concurrent-roles invariant", () => {
  it("creates an assigned record within the ceiling", () => {
    const result = assignRole({
      tenant: TENANT,
      organizationId: "org-1",
      agentId: "agent-1",
      role: baseRole(),
      assignmentId: "asg-9",
      at: 100,
      maxConcurrentRoles: 3,
      existing: [],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.assignment.status).toBe("assigned");
      expect(result.assignment.digest).toMatch(/^assign_[0-9a-f]{8}$/);
    }
  });

  it("refuses the (N+1)-th concurrent role with MAX_CONCURRENT_ROLES_EXCEEDED and exact counts", () => {
    const existing = [
      baseAssignment({ id: "asg-a", roleId: "r1" }),
      baseAssignment({ id: "asg-b", roleId: "r2" }),
    ];
    const result = assignRole({
      tenant: TENANT,
      organizationId: "org-1",
      agentId: "agent-1",
      role: baseRole(),
      assignmentId: "asg-c",
      at: 100,
      maxConcurrentRoles: 2,
      existing,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("MAX_CONCURRENT_ROLES_EXCEEDED");
      expect(result.activeRoleCount).toBe(2);
      expect(result.maxConcurrentRoles).toBe(2);
      expect(result.detail).toBe("exact-overshoot-1");
    }
  });

  it("relieved assignments do NOT count toward the concurrency ceiling (invariant recovers)", () => {
    const existing = [
      baseAssignment({ id: "asg-a", status: "relieved", relievedAt: 90, reliefReason: "done" }),
      baseAssignment({ id: "asg-b", status: "active", activatedAt: 95 }),
    ];
    const result = assignRole({
      tenant: TENANT,
      organizationId: "org-1",
      agentId: "agent-1",
      role: baseRole(),
      assignmentId: "asg-c",
      at: 100,
      maxConcurrentRoles: 2,
      existing,
    });
    expect(result.ok).toBe(true);
  });

  it("refuses a ceiling below 1 rather than silently clamping", () => {
    const result = assignRole({
      tenant: TENANT,
      organizationId: "org-1",
      agentId: "agent-1",
      role: baseRole(),
      assignmentId: "asg-x",
      at: 100,
      maxConcurrentRoles: 0,
      existing: [],
    });
    expect(result).toMatchObject({ ok: false, reasonCode: "MAX_CONCURRENT_ROLES_EXCEEDED" });
  });

  it("refuses an invalid role definition with ROLE_DEFINITION_INVALID", () => {
    const result = assignRole({
      tenant: TENANT,
      organizationId: "org-1",
      agentId: "agent-1",
      role: { ...baseRole(), capabilities: [] },
      assignmentId: "asg-9",
      at: 100,
      maxConcurrentRoles: 3,
      existing: [],
    });
    expect(result).toMatchObject({ ok: false, reasonCode: "ROLE_DEFINITION_INVALID", detail: "CAPABILITY_ALLOWLIST_EMPTY" });
  });

  it("refuses duplicate assignment ids with DUPLICATE_ASSIGNMENT_ID", () => {
    const result = assignRole({
      tenant: TENANT,
      organizationId: "org-1",
      agentId: "agent-1",
      role: baseRole(),
      assignmentId: "asg-1",
      at: 100,
      maxConcurrentRoles: 3,
      existing: [baseAssignment()],
    });
    expect(result).toMatchObject({ ok: false, reasonCode: "DUPLICATE_ASSIGNMENT_ID", detail: "asg-1" });
  });

  it("refuses a cross-tenant existing assignment with TENANT_MISMATCH (fail-closed)", () => {
    const result = assignRole({
      tenant: TENANT,
      organizationId: "org-1",
      agentId: "agent-1",
      role: baseRole(),
      assignmentId: "asg-9",
      at: 100,
      maxConcurrentRoles: 3,
      existing: [baseAssignment({ tenant: { tenantId: "other" } })],
    });
    expect(result).toMatchObject({ ok: false, reasonCode: "TENANT_MISMATCH" });
  });

  it("countConcurrentAssignments counts only same-org non-relieved assignments", () => {
    const all = [
      baseAssignment({ id: "a1", agentId: "agent-1", status: "active", activatedAt: 1 }),
      baseAssignment({ id: "a2", agentId: "agent-1", status: "assigned" }),
      baseAssignment({ id: "a3", agentId: "agent-1", status: "relieved", relievedAt: 2, reliefReason: "x" }),
      baseAssignment({ id: "a4", agentId: "agent-2", status: "active", activatedAt: 1 }),
      baseAssignment({ id: "a5", agentId: "agent-1", organizationId: "org-2", status: "active", activatedAt: 1 }),
    ];
    expect(countConcurrentAssignments(all, "agent-1", "org-1")).toBe(2);
  });

  it("the assignment digest is deterministic and status-sensitive", () => {
    const a = baseAssignment();
    const b = baseAssignment();
    expect(a.digest).toBe(b.digest);
    const activated = transitionRoleAssignment(a, { kind: "activate", at: 150 });
    if (activated.ok) expect(activated.assignment.digest).not.toBe(a.digest);
  });
});
