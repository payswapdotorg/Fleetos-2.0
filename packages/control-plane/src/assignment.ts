/**
 * @fleetos/control-plane — assignment + handoff records.
 *
 * The assignment lifecycle binds an agent/actor to a command:
 * offered → accepted | declined | revoked (terminal). One ACTIVE
 * (offered/accepted) assignment per command — a second offer while one is
 * active is refused with `assignment-exists`.
 *
 * A handoff transfers an accepted assignment between agents WITH
 * acknowledgment: initiated → acknowledged (the assignment rebinds to the
 * receiving agent) | expired (the acknowledgment deadline passed — the
 * assignment stays with the original agent).
 *
 * Tenant fail-closed: cross-tenant access returns
 * `assignment-not-found` / `handoff-not-found` (no existence leak).
 */

import type { TenantContext, TenantId } from "@fleetos/kernel";
import { fail, ok, type Result } from "./result.js";
import { digestOf } from "./digest.js";

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

export type AssignmentState = "offered" | "accepted" | "declined" | "revoked";

export interface Assignment {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly commandId: string;
  readonly agentId: string;
  readonly state: AssignmentState;
  readonly offeredAt: number;
  readonly decidedAt: number | null;
  readonly digest: string;
}

export type HandoffState = "initiated" | "acknowledged" | "expired";

export interface Handoff {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly commandId: string;
  readonly fromAgent: string;
  readonly toAgent: string;
  readonly state: HandoffState;
  readonly initiatedAt: number;
  readonly ackDeadlineAt: number;
  readonly acknowledgedAt: number | null;
  readonly digest: string;
}

export type AssignmentRejection =
  | "assignment-not-found"
  | "handoff-not-found"
  | "invalid-agent"
  | "invalid-command-id"
  | "invalid-time"
  | "invalid-ack-deadline"
  | "assignment-exists"
  | "handoff-exists"
  | "already-accepted"
  | "already-revoked"
  | "not-offered"
  | "not-revocable"
  | "assignment-not-accepted"
  | "not-assignee"
  | "handoff-expired"
  | "not-expired"
  | "illegal-state";

export interface AssignmentResult {
  readonly assignment: Assignment;
  /** True when the call was an idempotent re-application of the current state. */
  readonly duplicate: boolean;
}

export interface HandoffResult {
  readonly handoff: Handoff;
  readonly duplicate: boolean;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface MutableAssignment {
  id: string;
  tenantId: TenantId;
  commandId: string;
  agentId: string;
  state: AssignmentState;
  offeredAt: number;
  decidedAt: number | null;
  digest: string;
}

interface MutableHandoff {
  id: string;
  tenantId: TenantId;
  commandId: string;
  fromAgent: string;
  toAgent: string;
  state: HandoffState;
  initiatedAt: number;
  ackDeadlineAt: number;
  acknowledgedAt: number | null;
  digest: string;
}

interface TenantAssignmentState {
  assignments: MutableAssignment[];
  handoffs: MutableHandoff[];
  /** commandId → the assignment id superseded most recently. */
  latestByCommand: Map<string, string>;
  counter: number;
}

// ---------------------------------------------------------------------------
// AssignmentRegistry
// ---------------------------------------------------------------------------

export class AssignmentRegistry {
  private readonly tenants = new Map<string, TenantAssignmentState>();

  /** Offer a command to an agent. Refused while an ACTIVE assignment exists. */
  offer(input: {
    readonly ctx: TenantContext;
    readonly commandId: string;
    readonly agentId: string;
    readonly now: number;
  }): Result<AssignmentResult, AssignmentRejection> {
    if (typeof input.commandId !== "string" || input.commandId === "") {
      return fail("invalid-command-id");
    }
    if (typeof input.agentId !== "string" || input.agentId === "") {
      return fail("invalid-agent");
    }
    if (!Number.isFinite(input.now) || input.now <= 0) {
      return fail("invalid-time");
    }
    const state = this.tenantState(String(input.ctx.tenantId));
    const active = state.assignments.find(
      (a) =>
        a.commandId === input.commandId &&
        (a.state === "offered" || a.state === "accepted"),
    );
    if (active) return fail("assignment-exists");
    state.counter += 1;
    const id = `asg_${String(state.counter).padStart(10, "0")}`;
    const assignment: MutableAssignment = {
      id,
      tenantId: input.ctx.tenantId,
      commandId: input.commandId,
      agentId: input.agentId,
      state: "offered",
      offeredAt: input.now,
      decidedAt: null,
      digest: digestOf(
        String(input.ctx.tenantId),
        id,
        input.commandId,
        input.agentId,
        input.now,
      ),
    };
    state.assignments.push(assignment);
    state.latestByCommand.set(input.commandId, id);
    return ok({ assignment, duplicate: false });
  }

  /** Accept: offered → accepted. Idempotent on accepted. */
  accept(input: {
    readonly ctx: TenantContext;
    readonly assignmentId: string;
    readonly now: number;
  }): Result<AssignmentResult, AssignmentRejection> {
    const assignment = this.findAssignment(input.ctx, input.assignmentId);
    if (!assignment) return fail("assignment-not-found");
    if (assignment.state === "accepted") {
      return ok({ assignment, duplicate: true });
    }
    if (assignment.state !== "offered") return fail("not-offered");
    assignment.state = "accepted";
    assignment.decidedAt = input.now;
    return ok({ assignment, duplicate: false });
  }

  /** Decline: offered → declined. Idempotent on declined. */
  decline(input: {
    readonly ctx: TenantContext;
    readonly assignmentId: string;
    readonly now: number;
  }): Result<AssignmentResult, AssignmentRejection> {
    const assignment = this.findAssignment(input.ctx, input.assignmentId);
    if (!assignment) return fail("assignment-not-found");
    if (assignment.state === "declined") {
      return ok({ assignment, duplicate: true });
    }
    if (assignment.state === "accepted") return fail("already-accepted");
    if (assignment.state === "revoked") return fail("not-offered");
    assignment.state = "declined";
    assignment.decidedAt = input.now;
    return ok({ assignment, duplicate: false });
  }

  /** Revoke: offered|accepted → revoked. Idempotent on revoked. */
  revoke(input: {
    readonly ctx: TenantContext;
    readonly assignmentId: string;
    readonly now: number;
  }): Result<AssignmentResult, AssignmentRejection> {
    const assignment = this.findAssignment(input.ctx, input.assignmentId);
    if (!assignment) return fail("assignment-not-found");
    if (assignment.state === "revoked") {
      return ok({ assignment, duplicate: true });
    }
    if (assignment.state === "declined") return fail("not-revocable");
    assignment.state = "revoked";
    assignment.decidedAt = input.now;
    return ok({ assignment, duplicate: false });
  }

  /** The latest assignment for a command (any state). Cross-tenant fails closed. */
  assignmentFor(
    ctx: TenantContext,
    commandId: string,
  ): Result<Assignment, AssignmentRejection> {
    const state = this.tenants.get(String(ctx.tenantId));
    if (!state) return fail("assignment-not-found");
    const id = state.latestByCommand.get(commandId);
    if (!id) return fail("assignment-not-found");
    const assignment = state.assignments.find((a) => a.id === id);
    if (!assignment) return fail("assignment-not-found");
    return ok(assignment);
  }

  assignmentsFor(ctx: TenantContext): ReadonlyArray<Assignment> {
    const state = this.tenants.get(String(ctx.tenantId));
    return state ? [...state.assignments] : [];
  }

  // --- handoffs ---

  /**
   * Initiate a handoff of an ACCEPTED assignment from its current agent to
   * `toAgent`, with an explicit acknowledgment deadline.
   */
  initiateHandoff(input: {
    readonly ctx: TenantContext;
    readonly commandId: string;
    readonly fromAgent: string;
    readonly toAgent: string;
    readonly ackDeadlineAt: number;
    readonly now: number;
  }): Result<HandoffResult, AssignmentRejection> {
    if (typeof input.toAgent !== "string" || input.toAgent === "") {
      return fail("invalid-agent");
    }
    if (input.fromAgent === input.toAgent) return fail("invalid-agent");
    if (!Number.isFinite(input.ackDeadlineAt) || input.ackDeadlineAt <= input.now) {
      return fail("invalid-ack-deadline");
    }
    const state = this.tenantState(String(input.ctx.tenantId));
    const assignmentResult = this.assignmentFor(input.ctx, input.commandId);
    if (!assignmentResult.ok) return fail("assignment-not-found");
    const assignment = this.findAssignment(input.ctx, assignmentResult.value.id);
    if (!assignment) return fail("assignment-not-found");
    if (assignment.state !== "accepted") return fail("assignment-not-accepted");
    if (assignment.agentId !== input.fromAgent) return fail("not-assignee");
    const activeHandoff = state.handoffs.find(
      (h) => h.commandId === input.commandId && h.state === "initiated",
    );
    if (activeHandoff) return fail("handoff-exists");
    state.counter += 1;
    const id = `hdf_${String(state.counter).padStart(10, "0")}`;
    const handoff: MutableHandoff = {
      id,
      tenantId: input.ctx.tenantId,
      commandId: input.commandId,
      fromAgent: input.fromAgent,
      toAgent: input.toAgent,
      state: "initiated",
      initiatedAt: input.now,
      ackDeadlineAt: input.ackDeadlineAt,
      acknowledgedAt: null,
      digest: digestOf(
        String(input.ctx.tenantId),
        id,
        input.commandId,
        input.fromAgent,
        input.toAgent,
        input.now,
        input.ackDeadlineAt,
      ),
    };
    state.handoffs.push(handoff);
    return ok({ handoff, duplicate: false });
  }

  /**
   * Acknowledge a handoff: initiated → acknowledged AND the assignment
   * rebinds to the receiving agent.
   */
  acknowledgeHandoff(input: {
    readonly ctx: TenantContext;
    readonly handoffId: string;
    readonly now: number;
  }): Result<HandoffResult, AssignmentRejection> {
    const handoff = this.findHandoff(input.ctx, input.handoffId);
    if (!handoff) return fail("handoff-not-found");
    if (handoff.state === "acknowledged") {
      return ok({ handoff, duplicate: true });
    }
    if (handoff.state === "expired") return fail("handoff-expired");
    handoff.state = "acknowledged";
    handoff.acknowledgedAt = input.now;
    const assignment = this.latestAssignmentByCommand(input.ctx, handoff.commandId);
    if (assignment && assignment.state === "accepted") {
      assignment.agentId = handoff.toAgent;
      assignment.decidedAt = input.now;
    }
    return ok({ handoff, duplicate: false });
  }

  /** Expire an unacknowledged handoff whose deadline has passed at `now`. */
  expireHandoff(input: {
    readonly ctx: TenantContext;
    readonly handoffId: string;
    readonly now: number;
  }): Result<HandoffResult, AssignmentRejection> {
    const handoff = this.findHandoff(input.ctx, input.handoffId);
    if (!handoff) return fail("handoff-not-found");
    if (handoff.state === "expired") {
      return ok({ handoff, duplicate: true });
    }
    if (handoff.state === "acknowledged") return fail("illegal-state");
    if (input.now < handoff.ackDeadlineAt) return fail("not-expired");
    handoff.state = "expired";
    return ok({ handoff, duplicate: false });
  }

  handoffsFor(ctx: TenantContext): ReadonlyArray<Handoff> {
    const state = this.tenants.get(String(ctx.tenantId));
    return state ? [...state.handoffs] : [];
  }

  // --- internals ---

  private tenantState(tenantKey: string): TenantAssignmentState {
    let state = this.tenants.get(tenantKey);
    if (!state) {
      state = {
        assignments: [],
        handoffs: [],
        latestByCommand: new Map<string, string>(),
        counter: 0,
      };
      this.tenants.set(tenantKey, state);
    }
    return state;
  }

  private findAssignment(
    ctx: TenantContext,
    assignmentId: string,
  ): MutableAssignment | null {
    const state = this.tenants.get(String(ctx.tenantId));
    if (!state) return null;
    return state.assignments.find((a) => a.id === assignmentId) ?? null;
  }

  private findHandoff(
    ctx: TenantContext,
    handoffId: string,
  ): MutableHandoff | null {
    const state = this.tenants.get(String(ctx.tenantId));
    if (!state) return null;
    return state.handoffs.find((h) => h.id === handoffId) ?? null;
  }

  private latestAssignmentByCommand(
    ctx: TenantContext,
    commandId: string,
  ): MutableAssignment | null {
    const state = this.tenants.get(String(ctx.tenantId));
    if (!state) return null;
    const id = state.latestByCommand.get(commandId);
    if (!id) return null;
    return state.assignments.find((a) => a.id === id) ?? null;
  }
}
