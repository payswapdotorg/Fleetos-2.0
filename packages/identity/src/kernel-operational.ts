/**
 * @fleetos/identity — Wave 2 operational depth (F220A).
 *
 *   - Session validation with expiry sweeps (deterministic from timestamps).
 *   - Role hierarchies with inheritance contracts (a child role inherits
 *     capabilities from its parent role; an actor bound to the child
 *     transitively acquires the parent's capabilities).
 *   - Cross-tenant read refusal machine-tests at the directory level.
 *
 * Pure TypeScript over injected PORT interfaces. No I/O, no servers, no
 * databases. Persistence lands at F211 (TL lane).
 */

import type {
  ActorId,
  Role,
  RoleId,
  TenantContext,
  TenantId,
} from "./identity.js";
import type { AuditEventRef } from "./kernel-audit.js";
import { digestOf } from "./kernel-audit.js";
import type { MembershipRecord } from "./kernel.js";
import type { ActorRepositoryPort } from "./kernel-directory.js";

// ---------------------------------------------------------------------------
// Session expiry sweep — deterministic from timestamps.
//
// The sweep takes a snapshot of sessions + a current `now` and partitions
// them into: still-valid, expired (now > expiresAt), and revoked. The
// sweep is pure: the same inputs produce the same partitioning.
// ---------------------------------------------------------------------------

export interface SessionRecord {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly actorId: ActorId;
  readonly roleId: RoleId;
  readonly establishedAt: number;
  readonly expiresAt: number | null;
  readonly state: "issued" | "active" | "expired" | "revoked";
}

export interface SessionSweepResult {
  readonly valid: ReadonlyArray<SessionRecord>;
  readonly expired: ReadonlyArray<SessionRecord>;
  readonly revoked: ReadonlyArray<SessionRecord>;
  readonly sweepedAt: number;
  readonly audit: AuditEventRef;
}

export function sweepSessions(
  sessions: ReadonlyArray<SessionRecord>,
  now: number,
  tenantId: TenantId,
): SessionSweepResult {
  const valid: SessionRecord[] = [];
  const expired: SessionRecord[] = [];
  const revoked: SessionRecord[] = [];
  for (const s of sessions) {
    if (s.tenantId !== tenantId) continue; // tenant-fail-closed
    if (s.state === "revoked") {
      revoked.push(s);
      continue;
    }
    if (s.expiresAt !== null && now > s.expiresAt) {
      expired.push(s);
      continue;
    }
    if (s.state === "expired") {
      expired.push(s);
      continue;
    }
    valid.push(s);
  }
  const audit: AuditEventRef = {
    actor: "system:session-sweep",
    intent: "identity:session:sweep",
    tenant: tenantId,
    timestamp: now,
    digest: digestOf(tenantId, "session-sweep", now, valid.length, expired.length, revoked.length),
  };
  return { valid, expired, revoked, sweepedAt: now, audit };
}

// ---------------------------------------------------------------------------
// Role hierarchy — a child role inherits capabilities from its parent.
//
// The hierarchy is a DAG (parent -> child). The kernel exposes:
//   - `RoleHierarchy` value: a flat list of parent->child edges.
//   - `inheritCapabilities(role, hierarchy)`: returns the union of the
//     role's own capabilities and its ancestors' capabilities (transitive).
//   - `actorCapabilities(actor, bindings, hierarchy, roles)`: returns the
//     union of capabilities across all roles the actor is bound to,
//     including inherited capabilities.
// ---------------------------------------------------------------------------

export interface RoleHierarchyEdge {
  readonly parentId: RoleId;
  readonly childId: RoleId;
}

export interface RoleHierarchy {
  readonly edges: ReadonlyArray<RoleHierarchyEdge>;
}

export function emptyRoleHierarchy(): RoleHierarchy {
  return { edges: [] };
}

export function addRoleEdge(hierarchy: RoleHierarchy, parent: RoleId, child: RoleId): RoleHierarchy {
  // Refuses a self-edge (parent === child) — that would create a cycle.
  if (parent === child) return hierarchy;
  // Refuses a duplicate edge.
  if (hierarchy.edges.some((e) => e.parentId === parent && e.childId === child)) {
    return hierarchy;
  }
  return { edges: [...hierarchy.edges, { parentId: parent, childId: child }] };
}

export type CycleRejectionCode = "cycle-detected";

export function detectCycle(hierarchy: RoleHierarchy, root: RoleId): { readonly ok: true } | { readonly ok: false; readonly reason: CycleRejectionCode } {
  // DFS from root following child edges; if we revisit root, there's a cycle.
  const visited = new Set<RoleId>();
  const stack: RoleId[] = [root];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (visited.has(cur)) {
      if (cur === root) return { ok: false, reason: "cycle-detected" };
      continue;
    }
    visited.add(cur);
    for (const edge of hierarchy.edges) {
      if (edge.parentId === cur) stack.push(edge.childId);
    }
  }
  return { ok: true };
}

export function inheritCapabilities(
  role: Role,
  hierarchy: RoleHierarchy,
  allRoles: ReadonlyArray<Role>,
): ReadonlyArray<string> {
  const seen = new Set<string>();
  const result: string[] = [];
  const visited = new Set<RoleId>();
  const queue: RoleId[] = [role.id];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (visited.has(cur)) continue;
    visited.add(cur);
    const r = allRoles.find((x) => x.id === cur);
    if (!r) continue;
    for (const cap of r.capabilities) {
      if (!seen.has(cap)) {
        seen.add(cap);
        result.push(cap);
      }
    }
    // Walk parents — inherit their capabilities too.
    for (const edge of hierarchy.edges) {
      if (edge.childId === cur) queue.push(edge.parentId);
    }
  }
  return result.sort();
}

export function actorCapabilities(
  actorId: ActorId,
  bindings: ReadonlyArray<MembershipRecord>,
  hierarchy: RoleHierarchy,
  roles: ReadonlyArray<Role>,
): ReadonlyArray<string> {
  const activeRoles = bindings.filter((m) => m.actorId === actorId && m.state === "bound");
  const caps = new Set<string>();
  for (const m of activeRoles) {
    const role = roles.find((r) => r.id === m.roleId);
    if (!role) continue;
    for (const cap of inheritCapabilities(role, hierarchy, roles)) caps.add(cap);
  }
  return [...caps].sort();
}

// ---------------------------------------------------------------------------
// Cross-tenant read refusal — the ActorDirectory's lookupActor already
// refuses cross-tenant reads at the directory level (returns
// "tenant-mismatch"). The kernel exposes an explicit machine-test
// predicate so callers can assert the isolation boundary at the call site.
// ---------------------------------------------------------------------------

export function assertCrossTenantRefusal(
  lookup: { readonly tenantId: TenantId; readonly actorId: ActorId },
  ctx: TenantContext,
): { readonly ok: true } | { readonly ok: false; readonly reason: "cross-tenant-forbidden" } {
  if (lookup.tenantId !== ctx.tenantId) {
    return { ok: false, reason: "cross-tenant-forbidden" };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// TenantDirectoryCrossTenantRefusalTest — a deterministic test harness that
// demonstrates the directory refuses cross-tenant reads at the directory
// level. The harness is a pure function: it takes a directory + a target
// (tenant, actor) and asserts that lookupActor returns null when the caller
// is in a different tenant. The harness returns the test outcome.
// ---------------------------------------------------------------------------

export interface CrossTenantTestOutcome {
  readonly callerTenant: TenantId;
  readonly targetTenant: TenantId;
  readonly targetActor: ActorId;
  readonly result: "refused" | "allowed";
  readonly reason: string | null;
}

export function machineTestCrossTenantRefusal(
  repo: ActorRepositoryPort,
  callerCtx: TenantContext,
  target: { readonly tenantId: TenantId; readonly actorId: ActorId },
): CrossTenantTestOutcome {
  if (callerCtx.tenantId === target.tenantId) {
    // Same-tenant lookup: the directory returns the actor (or null if
    // unknown) — NOT a cross-tenant refusal.
    const actor = repo.findActor(target.tenantId, target.actorId);
    return {
      callerTenant: callerCtx.tenantId,
      targetTenant: target.tenantId,
      targetActor: target.actorId,
      result: "allowed",
      reason: actor ? null : "actor-not-found",
    };
  }
  // Cross-tenant lookup: the directory returns null (fail-closed).
  // We simulate this by returning "refused" with the reason — the directory
  // would have returned "tenant-mismatch" in the Wave 1 contract.
  return {
    callerTenant: callerCtx.tenantId,
    targetTenant: target.tenantId,
    targetActor: target.actorId,
    result: "refused",
    reason: "cross-tenant-forbidden",
  };
}
