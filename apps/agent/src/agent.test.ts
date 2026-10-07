import { describe, it, expect, expectTypeOf } from "vitest";
import {
  createAgentLoop,
  evaluateAgentTransition,
  reconcileAgent,
  step,
  type AgentCommand,
  type AgentLoopState,
  type AgentPorts,
  type AgentState,
  type EnrollmentPort,
  type TelemetryPort,
  type DiagnosticsPort,
  type EvidenceBufferPort,
  type CommandInboxPort,
  type ReconciliationPort,
} from "./agent.js";

const NOW = 1_727_000_000_000;

function cmd(kind: AgentCommand["kind"], overrides: Partial<AgentCommand> = {}): AgentCommand {
  return { kind, at: NOW, ...overrides };
}

function loop(): AgentLoopState {
  return createAgentLoop({ agentId: "agent_edge-001", tenantId: "tnt_acme", now: NOW });
}

function makePorts(overrides: Partial<AgentPorts> = {}): AgentPorts {
  return {
    enrollment: {
      enroll: async () => ({ ok: true, agentId: "agent_edge-001", tenantId: "tnt_acme" }),
    } as EnrollmentPort,
    telemetry: {
      emitTelemetry: () => undefined,
    } as TelemetryPort,
    diagnostics: {
      snapshot: (agentId) => ({
        agentId,
        at: NOW,
        state: "running" as AgentState,
        uptimeMs: 0,
      }),
    } as DiagnosticsPort,
    evidence: {
      append: () => "ev_1" as ReturnType<EvidenceBufferPort["append"]>,
    } as EvidenceBufferPort,
    commandInbox: {
      pollCommands: () => [],
    } as CommandInboxPort,
    reconciliation: {
      reconcile: () => ({ drift: false, remoteHead: 0, diff: 0 }),
    } as ReconciliationPort,
    ...overrides,
  };
}

describe("agent: createAgentLoop bootstrap", () => {
  it("creates an unenrolled agent", () => {
    const s = loop();
    expect(s.state).toBe("unenrolled");
    expect(s.evidenceCount).toBe(0);
  });
  it("rejects missing agentId", () => {
    expect(() =>
      createAgentLoop({ agentId: "", tenantId: "tnt_acme", now: NOW }),
    ).toThrow();
  });
  it("rejects missing tenantId", () => {
    expect(() =>
      createAgentLoop({ agentId: "agent_x", tenantId: "", now: NOW }),
    ).toThrow();
  });
});

describe("agent: pure transition table (no port calls)", () => {
  it("unenrolled -> enrolled via 'enroll'", () => {
    expect(evaluateAgentTransition("unenrolled", cmd("enroll"))).toEqual({
      ok: true,
      from: "unenrolled",
      to: "enrolled",
    });
  });
  it("enrolled -> untrusted via 'establish-trust'", () => {
    expect(evaluateAgentTransition("enrolled", cmd("establish-trust"))).toEqual({
      ok: true,
      from: "enrolled",
      to: "untrusted",
    });
  });
  it("untrusted -> trusted via 'establish-trust' (second stage)", () => {
    expect(evaluateAgentTransition("untrusted", cmd("establish-trust"))).toEqual({
      ok: true,
      from: "untrusted",
      to: "trusted",
    });
  });
  it("trusted -> running via 'start'", () => {
    expect(evaluateAgentTransition("trusted", cmd("start"))).toEqual({
      ok: true,
      from: "trusted",
      to: "running",
    });
  });
  it("running -> degraded via 'degrade' (with reason)", () => {
    expect(evaluateAgentTransition("running", cmd("degrade", { reason: "no-connectivity" }))).toEqual({
      ok: true,
      from: "running",
      to: "degraded",
    });
  });
  it("degraded -> running via 'recover'", () => {
    expect(evaluateAgentTransition("degraded", cmd("recover"))).toEqual({
      ok: true,
      from: "degraded",
      to: "running",
    });
  });
  it("running -> stopped via 'stop' (with reason)", () => {
    expect(evaluateAgentTransition("running", cmd("stop", { reason: "operator-halt" }))).toEqual({
      ok: true,
      from: "running",
      to: "stopped",
    });
  });
  it("stopped -> running via 'resume'", () => {
    expect(evaluateAgentTransition("stopped", cmd("resume"))).toEqual({
      ok: true,
      from: "stopped",
      to: "running",
    });
  });
  it("running -> reconciling via 'reconcile'", () => {
    expect(evaluateAgentTransition("running", cmd("reconcile"))).toEqual({
      ok: true,
      from: "running",
      to: "reconciling",
    });
  });
});

describe("agent: illegal transitions refused with stable reason codes", () => {
  it("unenrolled -> start is illegal", () => {
    expect(evaluateAgentTransition("unenrolled", cmd("start"))).toEqual({
      ok: false,
      reason: "illegal-transition",
    });
  });
  it("running -> start -> already-in-target-state", () => {
    expect(evaluateAgentTransition("running", cmd("start"))).toEqual({
      ok: false,
      reason: "already-in-target-state",
    });
  });
  it("degrade without reason -> missing-reason", () => {
    expect(evaluateAgentTransition("running", cmd("degrade"))).toEqual({
      ok: false,
      reason: "missing-reason",
    });
  });
  it("stop without reason -> missing-reason", () => {
    expect(evaluateAgentTransition("running", cmd("stop"))).toEqual({
      ok: false,
      reason: "missing-reason",
    });
  });
  it("unknown command kind -> unknown-command", () => {
    expect(
      evaluateAgentTransition("running", { kind: "nope" as never, at: NOW }),
    ).toEqual({ ok: false, reason: "unknown-command" });
  });
  it("rejected state is terminal — no transitions out", () => {
    expect(evaluateAgentTransition("rejected", cmd("enroll"))).toEqual({
      ok: false,
      reason: "illegal-transition",
    });
  });
});

describe("agent: step (port-driven transitions)", () => {
  it("step enroll with port success moves to 'enrolled'", async () => {
    const s = loop();
    const r = await step(s, cmd("enroll"), makePorts());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.state).toBe("enrolled");
  });
  it("step enroll with port failure moves to 'rejected' (honest degradation)", async () => {
    const s = loop();
    const r = await step(
      s,
      cmd("enroll"),
      makePorts({
        enrollment: {
          enroll: async () => ({ ok: false, reason: "invalid-token" as const }),
        } as EnrollmentPort,
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.state).toBe("rejected");
  });
  it("step into running emits telemetry + appends evidence", async () => {
    const s: AgentLoopState = { ...loop(), state: "trusted" };
    let telemetryCalled = 0;
    let evidenceAppended = 0;
    const r = await step(
      s,
      cmd("start"),
      makePorts({
        telemetry: { emitTelemetry: () => { telemetryCalled += 1; } } as TelemetryPort,
        evidence: {
          append: () => {
            evidenceAppended += 1;
            return "ev_1" as ReturnType<EvidenceBufferPort["append"]>;
          },
        } as EvidenceBufferPort,
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.state).toBe("running");
      expect(r.state.evidenceCount).toBe(1);
      expect(telemetryCalled).toBe(1);
      expect(evidenceAppended).toBe(1);
    }
  });
  it("step degrade stores the degradation reason", async () => {
    const s: AgentLoopState = { ...loop(), state: "running" };
    const r = await step(s, cmd("degrade", { reason: "lost-gps" }), makePorts());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.state).toBe("degraded");
      expect(r.state.degradationReason).toBe("lost-gps");
    }
  });
});

describe("agent: reconcileAgent (pure consumer)", () => {
  it("no drift -> state unchanged", () => {
    const s = loop();
    const r = reconcileAgent(s, makePorts(), NOW + 1);
    expect(r.drift).toBe(false);
    expect(r.state.state).toBe(s.state);
  });
  it("drift -> state moves to 'reconciling'", () => {
    const s = loop();
    const r = reconcileAgent(
      s,
      makePorts({
        reconciliation: {
          reconcile: () => ({ drift: true, remoteHead: 5, diff: 5 }),
        } as ReconciliationPort,
      }),
      NOW + 1,
    );
    expect(r.drift).toBe(true);
    expect(r.state.state).toBe("reconciling");
  });
});

describe("agent: structural port shape (cross-worker seam)", () => {
  it("AgentPorts is structurally assignable to its individual port interfaces", () => {
    const p = makePorts();
    expectTypeOf(p.enrollment).toMatchTypeOf<EnrollmentPort>();
    expectTypeOf(p.telemetry).toMatchTypeOf<TelemetryPort>();
    expectTypeOf(p.diagnostics).toMatchTypeOf<DiagnosticsPort>();
    expectTypeOf(p.evidence).toMatchTypeOf<EvidenceBufferPort>();
    expectTypeOf(p.commandInbox).toMatchTypeOf<CommandInboxPort>();
    expectTypeOf(p.reconciliation).toMatchTypeOf<ReconciliationPort>();
  });
});
