/**
 * @fleetos/control-plane — assignment + handoff tests.
 *
 * The full lifecycle: offer → accept/decline/revoke (every illegal
 * transition's rejection code), one-active-assignment-per-command,
 * handoff initiate → acknowledge (assignment rebinds) | expire, and
 * tenant fail-closed access.
 */

import { describe, expect, it } from "vitest";
import { AssignmentRegistry } from "../src/index.js";
import { ctxFor, NOW, TENANT_A, TENANT_B } from "./helpers.js";

const CMD = "cmd_0000000001";

describe("AssignmentRegistry — offer", () => {
  it("offers a command to an agent (state offered)", () => {
    const registry = new AssignmentRegistry();
    const result = registry.offer({
      ctx: ctxFor(TENANT_A),
      commandId: CMD,
      agentId: "act_alice-001",
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.assignment.id).toBe("asg_0000000001");
    expect(result.value.assignment.state).toBe("offered");
    expect(result.value.assignment.agentId).toBe("act_alice-001");
    expect(result.value.assignment.digest).toHaveLength(64);
  });

  it("refuses a second offer while an assignment is ACTIVE: assignment-exists", () => {
    const registry = new AssignmentRegistry();
    registry.offer({ ctx: ctxFor(TENANT_A), commandId: CMD, agentId: "act_alice-001", now: NOW });
    expect(
      registry.offer({ ctx: ctxFor(TENANT_A), commandId: CMD, agentId: "act_bob-002", now: NOW + 1 }),
    ).toEqual({ ok: false, reason: "assignment-exists" });
  });

  it("allows a fresh offer after decline and after revoke", () => {
    const registry = new AssignmentRegistry();
    const first = registry.offer({
      ctx: ctxFor(TENANT_A),
      commandId: CMD,
      agentId: "act_alice-001",
      now: NOW,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    registry.decline({ ctx: ctxFor(TENANT_A), assignmentId: first.value.assignment.id, now: NOW + 1 });
    const second = registry.offer({
      ctx: ctxFor(TENANT_A),
      commandId: CMD,
      agentId: "act_bob-002",
      now: NOW + 2,
    });
    expect(second.ok && second.value.assignment.id).toBe("asg_0000000002");
    if (!second.ok) return;
    registry.revoke({ ctx: ctxFor(TENANT_A), assignmentId: second.value.assignment.id, now: NOW + 3 });
    const third = registry.offer({
      ctx: ctxFor(TENANT_A),
      commandId: CMD,
      agentId: "act_carol-003",
      now: NOW + 4,
    });
    expect(third.ok).toBe(true);
  });

  it("rejects an invalid agent / command id / time", () => {
    const registry = new AssignmentRegistry();
    expect(
      registry.offer({ ctx: ctxFor(TENANT_A), commandId: CMD, agentId: "", now: NOW }),
    ).toEqual({ ok: false, reason: "invalid-agent" });
    expect(
      registry.offer({ ctx: ctxFor(TENANT_A), commandId: "", agentId: "act_alice-001", now: NOW }),
    ).toEqual({ ok: false, reason: "invalid-command-id" });
    expect(
      registry.offer({ ctx: ctxFor(TENANT_A), commandId: CMD, agentId: "act_alice-001", now: 0 }),
    ).toEqual({ ok: false, reason: "invalid-time" });
  });

  it("the same command under another tenant is a separate assignment", () => {
    const registry = new AssignmentRegistry();
    const a = registry.offer({ ctx: ctxFor(TENANT_A), commandId: CMD, agentId: "act_alice-001", now: NOW });
    const b = registry.offer({ ctx: ctxFor(TENANT_B), commandId: CMD, agentId: "act_bob-002", now: NOW });
    expect(a.ok && b.ok).toBe(true);
    expect(a.ok && a.value.assignment.id).toBe("asg_0000000001");
    expect(b.ok && b.value.assignment.id).toBe("asg_0000000001");
  });
});

describe("AssignmentRegistry — accept / decline / revoke", () => {
  function offered() {
    const registry = new AssignmentRegistry();
    const result = registry.offer({
      ctx: ctxFor(TENANT_A),
      commandId: CMD,
      agentId: "act_alice-001",
      now: NOW,
    });
    if (!result.ok) throw new Error("offer failed");
    return { registry, assignmentId: result.value.assignment.id };
  }

  it("accept: offered → accepted with decidedAt", () => {
    const { registry, assignmentId } = offered();
    const result = registry.accept({ ctx: ctxFor(TENANT_A), assignmentId, now: NOW + 1 });
    expect(result.ok && result.value.assignment.state).toBe("accepted");
    expect(result.ok && result.value.assignment.decidedAt).toBe(NOW + 1);
    expect(result.ok && result.value.duplicate).toBe(false);
  });

  it("accept twice is idempotent: already accepted, decidedAt preserved", () => {
    const { registry, assignmentId } = offered();
    registry.accept({ ctx: ctxFor(TENANT_A), assignmentId, now: NOW + 1 });
    const second = registry.accept({ ctx: ctxFor(TENANT_A), assignmentId, now: NOW + 2 });
    expect(second.ok && second.value.duplicate).toBe(true);
    expect(second.ok && second.value.assignment.decidedAt).toBe(NOW + 1);
  });

  it("accept a declined assignment: not-offered", () => {
    const { registry, assignmentId } = offered();
    registry.decline({ ctx: ctxFor(TENANT_A), assignmentId, now: NOW + 1 });
    expect(
      registry.accept({ ctx: ctxFor(TENANT_A), assignmentId, now: NOW + 2 }),
    ).toEqual({ ok: false, reason: "not-offered" });
  });

  it("accept a revoked assignment: not-offered", () => {
    const { registry, assignmentId } = offered();
    registry.revoke({ ctx: ctxFor(TENANT_A), assignmentId, now: NOW + 1 });
    expect(
      registry.accept({ ctx: ctxFor(TENANT_A), assignmentId, now: NOW + 2 }),
    ).toEqual({ ok: false, reason: "not-offered" });
  });

  it("decline: offered → declined (idempotent on declined)", () => {
    const { registry, assignmentId } = offered();
    const result = registry.decline({ ctx: ctxFor(TENANT_A), assignmentId, now: NOW + 1 });
    expect(result.ok && result.value.assignment.state).toBe("declined");
    const again = registry.decline({ ctx: ctxFor(TENANT_A), assignmentId, now: NOW + 2 });
    expect(again.ok && again.value.duplicate).toBe(true);
  });

  it("decline an accepted assignment: already-accepted", () => {
    const { registry, assignmentId } = offered();
    registry.accept({ ctx: ctxFor(TENANT_A), assignmentId, now: NOW + 1 });
    expect(
      registry.decline({ ctx: ctxFor(TENANT_A), assignmentId, now: NOW + 2 }),
    ).toEqual({ ok: false, reason: "already-accepted" });
  });

  it("revoke: accepted → revoked (idempotent on revoked)", () => {
    const { registry, assignmentId } = offered();
    registry.accept({ ctx: ctxFor(TENANT_A), assignmentId, now: NOW + 1 });
    const result = registry.revoke({ ctx: ctxFor(TENANT_A), assignmentId, now: NOW + 2 });
    expect(result.ok && result.value.assignment.state).toBe("revoked");
    const again = registry.revoke({ ctx: ctxFor(TENANT_A), assignmentId, now: NOW + 3 });
    expect(again.ok && again.value.duplicate).toBe(true);
  });

  it("revoke a declined assignment: not-revocable", () => {
    const { registry, assignmentId } = offered();
    registry.decline({ ctx: ctxFor(TENANT_A), assignmentId, now: NOW + 1 });
    expect(
      registry.revoke({ ctx: ctxFor(TENANT_A), assignmentId, now: NOW + 2 }),
    ).toEqual({ ok: false, reason: "not-revocable" });
  });

  it("cross-tenant accept fails closed: assignment-not-found", () => {
    const { registry, assignmentId } = offered();
    expect(
      registry.accept({ ctx: ctxFor(TENANT_B), assignmentId, now: NOW + 1 }),
    ).toEqual({ ok: false, reason: "assignment-not-found" });
    expect(registry.assignmentFor(ctxFor(TENANT_B), CMD)).toEqual({
      ok: false,
      reason: "assignment-not-found",
    });
  });

  it("assignmentFor returns the LATEST assignment for a command", () => {
    const { registry, assignmentId } = offered();
    registry.decline({ ctx: ctxFor(TENANT_A), assignmentId, now: NOW + 1 });
    registry.offer({ ctx: ctxFor(TENANT_A), commandId: CMD, agentId: "act_bob-002", now: NOW + 2 });
    const latest = registry.assignmentFor(ctxFor(TENANT_A), CMD);
    expect(latest.ok && latest.value.agentId).toBe("act_bob-002");
    expect(latest.ok && latest.value.state).toBe("offered");
  });
});

describe("AssignmentRegistry — handoffs", () => {
  function accepted() {
    const registry = new AssignmentRegistry();
    registry.offer({ ctx: ctxFor(TENANT_A), commandId: CMD, agentId: "act_alice-001", now: NOW });
    registry.accept({ ctx: ctxFor(TENANT_A), assignmentId: "asg_0000000001", now: NOW + 1 });
    return registry;
  }

  it("initiates a handoff from the assignee with an ack deadline", () => {
    const registry = accepted();
    const result = registry.initiateHandoff({
      ctx: ctxFor(TENANT_A),
      commandId: CMD,
      fromAgent: "act_alice-001",
      toAgent: "act_bob-002",
      ackDeadlineAt: NOW + 10_000,
      now: NOW + 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.handoff.id).toBe("hdf_0000000002");
    expect(result.value.handoff.state).toBe("initiated");
    expect(result.value.handoff.ackDeadlineAt).toBe(NOW + 10_000);
  });

  it("refuses a handoff when the assignment is merely offered: assignment-not-accepted", () => {
    const registry = new AssignmentRegistry();
    registry.offer({ ctx: ctxFor(TENANT_A), commandId: CMD, agentId: "act_alice-001", now: NOW });
    expect(
      registry.initiateHandoff({
        ctx: ctxFor(TENANT_A),
        commandId: CMD,
        fromAgent: "act_alice-001",
        toAgent: "act_bob-002",
        ackDeadlineAt: NOW + 10_000,
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: "assignment-not-accepted" });
  });

  it("refuses a handoff from a non-assignee: not-assignee", () => {
    const registry = accepted();
    expect(
      registry.initiateHandoff({
        ctx: ctxFor(TENANT_A),
        commandId: CMD,
        fromAgent: "act_bob-002",
        toAgent: "act_carol-003",
        ackDeadlineAt: NOW + 10_000,
        now: NOW + 2,
      }),
    ).toEqual({ ok: false, reason: "not-assignee" });
  });

  it("refuses a self-handoff and an invalid ack deadline: invalid-agent / invalid-ack-deadline", () => {
    const registry = accepted();
    expect(
      registry.initiateHandoff({
        ctx: ctxFor(TENANT_A),
        commandId: CMD,
        fromAgent: "act_alice-001",
        toAgent: "act_alice-001",
        ackDeadlineAt: NOW + 10_000,
        now: NOW + 2,
      }),
    ).toEqual({ ok: false, reason: "invalid-agent" });
    expect(
      registry.initiateHandoff({
        ctx: ctxFor(TENANT_A),
        commandId: CMD,
        fromAgent: "act_alice-001",
        toAgent: "act_bob-002",
        ackDeadlineAt: NOW,
        now: NOW + 2,
      }),
    ).toEqual({ ok: false, reason: "invalid-ack-deadline" });
  });

  it("refuses a second active handoff for the same command: handoff-exists", () => {
    const registry = accepted();
    registry.initiateHandoff({
      ctx: ctxFor(TENANT_A),
      commandId: CMD,
      fromAgent: "act_alice-001",
      toAgent: "act_bob-002",
      ackDeadlineAt: NOW + 10_000,
      now: NOW + 2,
    });
    expect(
      registry.initiateHandoff({
        ctx: ctxFor(TENANT_A),
        commandId: CMD,
        fromAgent: "act_alice-001",
        toAgent: "act_carol-003",
        ackDeadlineAt: NOW + 10_000,
        now: NOW + 3,
      }),
    ).toEqual({ ok: false, reason: "handoff-exists" });
  });

  it("acknowledge → the assignment REBINDS to the receiving agent", () => {
    const registry = accepted();
    registry.initiateHandoff({
      ctx: ctxFor(TENANT_A),
      commandId: CMD,
      fromAgent: "act_alice-001",
      toAgent: "act_bob-002",
      ackDeadlineAt: NOW + 10_000,
      now: NOW + 2,
    });
    const ack = registry.acknowledgeHandoff({
      ctx: ctxFor(TENANT_A),
      handoffId: "hdf_0000000002",
      now: NOW + 3,
    });
    expect(ack.ok && ack.value.handoff.state).toBe("acknowledged");
    expect(ack.ok && ack.value.handoff.acknowledgedAt).toBe(NOW + 3);
    const assignment = registry.assignmentFor(ctxFor(TENANT_A), CMD);
    expect(assignment.ok && assignment.value.agentId).toBe("act_bob-002");
    expect(assignment.ok && assignment.value.state).toBe("accepted");
  });

  it("double acknowledge is idempotent: duplicate marker, no rebind side effects", () => {
    const registry = accepted();
    registry.initiateHandoff({
      ctx: ctxFor(TENANT_A),
      commandId: CMD,
      fromAgent: "act_alice-001",
      toAgent: "act_bob-002",
      ackDeadlineAt: NOW + 10_000,
      now: NOW + 2,
    });
    registry.acknowledgeHandoff({ ctx: ctxFor(TENANT_A), handoffId: "hdf_0000000002", now: NOW + 3 });
    const again = registry.acknowledgeHandoff({
      ctx: ctxFor(TENANT_A),
      handoffId: "hdf_0000000002",
      now: NOW + 4,
    });
    expect(again.ok && again.value.duplicate).toBe(true);
    expect(again.ok && again.value.handoff.acknowledgedAt).toBe(NOW + 3);
    // The assignment stays bound to the receiving agent — one rebind only.
    const assignment = registry.assignmentFor(ctxFor(TENANT_A), CMD);
    expect(assignment.ok && assignment.value.agentId).toBe("act_bob-002");
  });

  it("acknowledging an expired handoff: handoff-expired (assignment unchanged)", () => {
    const registry = accepted();
    registry.initiateHandoff({
      ctx: ctxFor(TENANT_A),
      commandId: CMD,
      fromAgent: "act_alice-001",
      toAgent: "act_bob-002",
      ackDeadlineAt: NOW + 10_000,
      now: NOW + 2,
    });
    registry.expireHandoff({ ctx: ctxFor(TENANT_A), handoffId: "hdf_0000000002", now: NOW + 11_000 });
    expect(
      registry.acknowledgeHandoff({ ctx: ctxFor(TENANT_A), handoffId: "hdf_0000000002", now: NOW + 12_000 }),
    ).toEqual({ ok: false, reason: "handoff-expired" });
    const assignment = registry.assignmentFor(ctxFor(TENANT_A), CMD);
    expect(assignment.ok && assignment.value.agentId).toBe("act_alice-001");
  });

  it("expireHandoff before the deadline: not-expired", () => {
    const registry = accepted();
    registry.initiateHandoff({
      ctx: ctxFor(TENANT_A),
      commandId: CMD,
      fromAgent: "act_alice-001",
      toAgent: "act_bob-002",
      ackDeadlineAt: NOW + 10_000,
      now: NOW + 2,
    });
    expect(
      registry.expireHandoff({ ctx: ctxFor(TENANT_A), handoffId: "hdf_0000000002", now: NOW + 9_000 }),
    ).toEqual({ ok: false, reason: "not-expired" });
  });

  it("expireHandoff at/after the deadline: initiated → expired (idempotent)", () => {
    const registry = accepted();
    registry.initiateHandoff({
      ctx: ctxFor(TENANT_A),
      commandId: CMD,
      fromAgent: "act_alice-001",
      toAgent: "act_bob-002",
      ackDeadlineAt: NOW + 10_000,
      now: NOW + 2,
    });
    const result = registry.expireHandoff({
      ctx: ctxFor(TENANT_A),
      handoffId: "hdf_0000000002",
      now: NOW + 10_000,
    });
    expect(result.ok && result.value.handoff.state).toBe("expired");
    const again = registry.expireHandoff({
      ctx: ctxFor(TENANT_A),
      handoffId: "hdf_0000000002",
      now: NOW + 11_000,
    });
    expect(again.ok && again.value.duplicate).toBe(true);
  });

  it("expiring an acknowledged handoff: illegal-state", () => {
    const registry = accepted();
    registry.initiateHandoff({
      ctx: ctxFor(TENANT_A),
      commandId: CMD,
      fromAgent: "act_alice-001",
      toAgent: "act_bob-002",
      ackDeadlineAt: NOW + 10_000,
      now: NOW + 2,
    });
    registry.acknowledgeHandoff({ ctx: ctxFor(TENANT_A), handoffId: "hdf_0000000002", now: NOW + 3 });
    expect(
      registry.expireHandoff({ ctx: ctxFor(TENANT_A), handoffId: "hdf_0000000002", now: NOW + 20_000 }),
    ).toEqual({ ok: false, reason: "illegal-state" });
  });

  it("cross-tenant handoff access fails closed: handoff-not-found", () => {
    const registry = accepted();
    registry.initiateHandoff({
      ctx: ctxFor(TENANT_A),
      commandId: CMD,
      fromAgent: "act_alice-001",
      toAgent: "act_bob-002",
      ackDeadlineAt: NOW + 10_000,
      now: NOW + 2,
    });
    expect(
      registry.acknowledgeHandoff({ ctx: ctxFor(TENANT_B), handoffId: "hdf_0000000002", now: NOW + 3 }),
    ).toEqual({ ok: false, reason: "handoff-not-found" });
    expect(registry.handoffsFor(ctxFor(TENANT_B))).toHaveLength(0);
  });
});
