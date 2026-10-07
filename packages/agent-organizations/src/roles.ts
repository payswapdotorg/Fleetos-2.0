/**
 * @fleetos/agent-organizations — agent roles + role-assignment lifecycle
 * (F230C, Wave 3 lane C).
 *
 * Laws:
 *   A5/A6 — roles and assignments are UNTRUSTED-actor machinery: a role's
 *           capability allow-list is a CEILING, never an authorization.
 *           Granting/holding a role does not authorize anything by itself
 *           ("Agents and workflows cannot bypass Guardian").
 *   A8    — tenant isolation, fail-closed.
 *   A19   — assignments are digest-stamped records.
 *
 * Pure deterministic TS: time is an explicit logical `number` input; no
 * wall clock, no randomness; refusals are machine-stable reason codes.
 */

import type { TenantScope } from "./contracts.js";
import { validateTenantScope } from "./contracts.js";
import { fnv1a32 } from "./internal-digest.js";

// ---------------------------------------------------------------------------
// Role definitions — capability allow-lists (ceilings) + responsibility
// scopes.
// ---------------------------------------------------------------------------

/** A role definition: what its holders MAY be allowed to do (ceiling). */
export interface AgentRoleDefinition {
  readonly id: string;
  readonly name: string;
  /** Capability allow-list. A ceiling, NOT an authorization (law A5/A6). */
  readonly capabilities: readonly string[];
  /** Responsibility scope descriptors (free-form stable ids). */
  readonly responsibilities: readonly string[];
}

export type RoleDefinitionReasonCode =
  | "ROLE_ID_EMPTY"
  | "ROLE_NAME_EMPTY"
  | "CAPABILITY_ALLOWLIST_EMPTY"
  | "CAPABILITY_DUPLICATED"
  | "RESPONSIBILITY_DUPLICATED";

export type RoleDefinitionValidation =
  | { readonly ok: true; readonly role: AgentRoleDefinition }
  | { readonly ok: false; readonly reasonCode: RoleDefinitionReasonCode; readonly detail: string | null };

/** Pure validation of a role definition. Deterministic; no mutation. */
export function validateRoleDefinition(role: AgentRoleDefinition): RoleDefinitionValidation {
  if (typeof role.id !== "string" || role.id.length === 0) {
    return { ok: false, reasonCode: "ROLE_ID_EMPTY", detail: null };
  }
  if (typeof role.name !== "string" || role.name.length === 0) {
    return { ok: false, reasonCode: "ROLE_NAME_EMPTY", detail: null };
  }
  if (!Array.isArray(role.capabilities) || role.capabilities.length === 0) {
    return { ok: false, reasonCode: "CAPABILITY_ALLOWLIST_EMPTY", detail: null };
  }
  const dupCap = firstDuplicate(role.capabilities);
  if (dupCap !== null) {
    return { ok: false, reasonCode: "CAPABILITY_DUPLICATED", detail: dupCap };
  }
  const dupResp = firstDuplicate(role.responsibilities);
  if (dupResp !== null) {
    return { ok: false, reasonCode: "RESPONSIBILITY_DUPLICATED", detail: dupResp };
  }
  return { ok: true, role };
}

/** Does the role's allow-list cover the capability? Ceiling membership only. */
export function roleAllowsCapability(role: AgentRoleDefinition, capability: string): boolean {
  return role.capabilities.includes(capability);
}

function firstDuplicate(items: readonly string[]): string | null {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item)) return item;
    seen.add(item);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Role-assignment lifecycle: assigned → active → relieved.
// ---------------------------------------------------------------------------

export type RoleAssignmentStatus = "assigned" | "active" | "relieved";

export interface RoleAssignment {
  readonly id: string;
  readonly tenant: TenantScope;
  readonly organizationId: string;
  readonly agentId: string;
  readonly roleId: string;
  readonly status: RoleAssignmentStatus;
  readonly assignedAt: number;
  readonly activatedAt: number | null;
  readonly relievedAt: number | null;
  readonly reliefReason: string | null;
  /** Stable digest over the assignment record (law A19). */
  readonly digest: string;
}

export type AssignmentCommand =
  | { readonly kind: "activate"; readonly at: number }
  | { readonly kind: "relieve"; readonly at: number; readonly reason: string };

export type AssignmentTransitionReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "ILLEGAL_TRANSITION"
  | "TERMINAL_STATE"
  | "RELIEF_REASON_REQUIRED"
  | "RELIEF_REASON_EMPTY"
  | "NEGATIVE_TIME"
  | "ASSIGNMENT_ID_EMPTY"
  | "ASSIGNMENT_AGENT_EMPTY"
  | "ASSIGNMENT_ROLE_EMPTY"
  | "ASSIGNMENT_ORG_EMPTY";

export type AssignmentTransitionResult =
  | { readonly ok: true; readonly assignment: RoleAssignment }
  | { readonly ok: false; readonly reasonCode: AssignmentTransitionReasonCode };

/** Legal-transition table for the role-assignment lifecycle. */
const LEGAL_ASSIGNMENT_TRANSITIONS: Readonly<Record<RoleAssignmentStatus, readonly AssignmentCommand["kind"][]>> = {
  assigned: ["activate", "relieve"],
  active: ["relieve"],
  relieved: [],
};

export function legalAssignmentTransitions(status: RoleAssignmentStatus): readonly AssignmentCommand["kind"][] {
  return LEGAL_ASSIGNMENT_TRANSITIONS[status];
}

/**
 * Apply a lifecycle command to an assignment. PURE: returns a NEW record,
 * never mutates the input. Every illegal path is a typed refusal.
 */
export function transitionRoleAssignment(
  assignment: RoleAssignment,
  command: AssignmentCommand,
): AssignmentTransitionResult {
  const tenantCheck = validateTenantScope(assignment.tenant);
  if (!tenantCheck.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  if (command.at < 0) return { ok: false, reasonCode: "NEGATIVE_TIME" };
  if (command.kind === "relieve") {
    if (typeof command.reason !== "string" || command.reason.length === 0) {
      return { ok: false, reasonCode: "RELIEF_REASON_REQUIRED" };
    }
  }
  const legal = LEGAL_ASSIGNMENT_TRANSITIONS[assignment.status];
  if (!legal.includes(command.kind)) {
    // A relieved assignment is TERMINAL — the richer code wins.
    return {
      ok: false,
      reasonCode: assignment.status === "relieved" ? "TERMINAL_STATE" : "ILLEGAL_TRANSITION",
    };
  }
  const next: RoleAssignment =
    command.kind === "activate"
      ? stamp({
          ...assignment,
          status: "active",
          activatedAt: command.at,
        })
      : stamp({
          ...assignment,
          status: "relieved",
          relievedAt: command.at,
          reliefReason: command.reason,
        });
  return { ok: true, assignment: next };
}

// ---------------------------------------------------------------------------
// Assignment creation + the N-concurrent-roles invariant.
// ---------------------------------------------------------------------------

export type AssignRoleReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "TENANT_MISMATCH"
  | "UNKNOWN_ROLE"
  | "ROLE_DEFINITION_INVALID"
  | "ASSIGNMENT_ID_EMPTY"
  | "ASSIGNMENT_AGENT_EMPTY"
  | "ASSIGNMENT_ORG_EMPTY"
  | "NEGATIVE_TIME"
  | "MAX_CONCURRENT_ROLES_EXCEEDED"
  | "DUPLICATE_ASSIGNMENT_ID";

export type AssignRoleResult =
  | { readonly ok: true; readonly assignment: RoleAssignment }
  | {
      readonly ok: false;
      readonly reasonCode: AssignRoleReasonCode;
      readonly activeRoleCount: number | null;
      readonly maxConcurrentRoles: number | null;
      readonly detail: string | null;
    };

/**
 * Create a role assignment, enforcing the INVARIANT: an agent holds at
 * most `maxConcurrentRoles` concurrent (assigned or active) roles. The
 * ceiling is a structural limit, NOT an authorization (law A5/A6).
 * `existing` = the agent's other assignments in the same org.
 */
export function assignRole(input: {
  readonly tenant: TenantScope;
  readonly organizationId: string;
  readonly agentId: string;
  readonly role: AgentRoleDefinition;
  readonly assignmentId: string;
  readonly at: number;
  readonly maxConcurrentRoles: number;
  readonly existing: readonly RoleAssignment[];
}): AssignRoleResult {
  const tenantCheck = validateTenantScope(input.tenant);
  if (!tenantCheck.ok) {
    return failAssign("TENANT_SCOPE_MISSING", null, null, null);
  }
  if (typeof input.assignmentId !== "string" || input.assignmentId.length === 0) {
    return failAssign("ASSIGNMENT_ID_EMPTY", null, null, null);
  }
  if (typeof input.agentId !== "string" || input.agentId.length === 0) {
    return failAssign("ASSIGNMENT_AGENT_EMPTY", null, null, null);
  }
  if (typeof input.organizationId !== "string" || input.organizationId.length === 0) {
    return failAssign("ASSIGNMENT_ORG_EMPTY", null, null, null);
  }
  if (input.at < 0) return failAssign("NEGATIVE_TIME", null, null, null);
  const roleCheck = validateRoleDefinition(input.role);
  if (!roleCheck.ok) {
    return failAssign("ROLE_DEFINITION_INVALID", null, null, roleCheck.reasonCode);
  }
  if (input.maxConcurrentRoles < 1) {
    // A ceiling below 1 makes the invariant unsatisfiable — refuse rather
    // than silently clamp.
    return failAssign("MAX_CONCURRENT_ROLES_EXCEEDED", 0, input.maxConcurrentRoles, "ceiling-below-1");
  }
  for (const other of input.existing) {
    const otherTenant = validateTenantScope(other.tenant);
    if (otherTenant.ok && otherTenant.scope.tenantId !== tenantCheck.scope.tenantId) {
      return failAssign("TENANT_MISMATCH", null, null, other.id);
    }
    if (other.id === input.assignmentId) {
      return failAssign("DUPLICATE_ASSIGNMENT_ID", null, null, input.assignmentId);
    }
  }
  const concurrent = countConcurrentAssignments(input.existing, input.agentId, input.organizationId);
  if (concurrent + 1 > input.maxConcurrentRoles) {
    return failAssign(
      "MAX_CONCURRENT_ROLES_EXCEEDED",
      concurrent,
      input.maxConcurrentRoles,
      "exact-overshoot-1",
    );
  }
  const assignment = stamp({
    id: input.assignmentId,
    tenant: input.tenant,
    organizationId: input.organizationId,
    agentId: input.agentId,
    roleId: input.role.id,
    status: "assigned",
    assignedAt: input.at,
    activatedAt: null,
    relievedAt: null,
    reliefReason: null,
  });
  return { ok: true, assignment };
}

/**
 * Count an agent's concurrent (assigned or active — relieved does NOT
 * count) assignments within one organization. Pure.
 */
export function countConcurrentAssignments(
  assignments: readonly RoleAssignment[],
  agentId: string,
  organizationId: string,
): number {
  let count = 0;
  for (const a of assignments) {
    if (a.agentId === agentId && a.organizationId === organizationId && a.status !== "relieved") {
      count++;
    }
  }
  return count;
}

function failAssign(
  reasonCode: AssignRoleReasonCode,
  activeRoleCount: number | null,
  maxConcurrentRoles: number | null,
  detail: string | null,
): AssignRoleResult {
  return { ok: false, reasonCode, activeRoleCount, maxConcurrentRoles, detail };
}

function stamp(assignment: Omit<RoleAssignment, "digest">): RoleAssignment {
  return { ...assignment, digest: computeAssignmentDigest(assignment) };
}

/** Stable digest over the assignment record — byte-identical inputs → same digest. */
export function computeAssignmentDigest(assignment: Omit<RoleAssignment, "digest">): string {
  return `assign_${fnv1a32([
    assignment.tenant.tenantId,
    assignment.organizationId,
    assignment.agentId,
    assignment.roleId,
    assignment.status,
    assignment.assignedAt,
    assignment.activatedAt,
    assignment.relievedAt,
    assignment.reliefReason,
  ])}`;
}
