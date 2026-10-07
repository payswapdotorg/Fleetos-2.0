import { describe, it, expect } from "vitest";
import {
  ackCommand,
  auditedStep,
  computeDiff,
  emptyAckLog,
  enrollWithToken,
  expireEnrollmentToken,
  issueEnrollmentToken,
  validateEnrollmentToken,
  verifyEnrollmentToken,
  type CommandRecord,
  type EnrollmentToken,
} from "./kernel.js";
import {
  createAgentLoop,
  type AgentCommand,
  type AgentLoopState,
  type AgentPorts,
  type CommandInboxPort,
  type DiagnosticsPort,
  type EnrollmentPort,
  type EvidenceBufferPort,
  type ReconciliationPort,
  type TelemetryPort,
} from "./agent.js";

const NOW = 1_727_000_000_000;
const TENANT_A = "tnt_acme";
const TENANT_B = "tnt_other";
const AGENT_A = "agent_alice-001";
const TOKEN_ID = "tok_abcdef0123456789";

function verifiedToken(tenant: string = TENANT_A, agent: string = AGENT_A, exp: number = NOW + 3600_000): EnrollmentToken {
  const issued = issueEnrollmentToken({ id: TOKEN_ID, tenantId: tenant, agentId: agent, issuedAt: NOW, expiresAt: exp });
  return verifyEnrollmentToken(issued, NOW + 1);
}

function makePorts(): AgentPorts {
  const inbox: CommandRecord[] = [];
  const enrollment: EnrollmentPort = {
    async enroll() {
      return { ok: true, agentId: AGENT_A, tenantId: TENANT_A };
    },
  };
  const telemetry: TelemetryPort = {
    emitTelemetry(_e) {
      // no-op (deterministic test port)
    },
  };
  const diagnostics: DiagnosticsPort = {
    snapshot(agentId) {
      return { agentId, at: NOW, state: "running", uptimeMs: 0 };
    },
  };
  const evidence: EvidenceBufferPort = {
    append(e) {
      return `evd_${e.at}` as never;
    },
  };
  const commandInbox: CommandInboxPort = {
    pollCommands() {
      return inbox;
    },
  };
  const reconciliation: ReconciliationPort = {
    reconcile(input) {
      return { drift: input.localHead < 5, remoteHead: 5, diff: 5 - input.localHead };
    },
  };
  return { enrollment, telemetry, diagnostics, evidence, commandInbox, reconciliation };
}

function loopState(state: AgentLoopState["state"] = "unenrolled"): AgentLoopState {
  const base = createAgentLoop({ agentId: AGENT_A, tenantId: TENANT_A, now: NOW });
  return { ...base, state };
}

describe("agent kernel: EnrollmentToken lifecycle", () => {
  it("issueEnrollmentToken creates a token in the issued state", () => {
    const t = issueEnrollmentToken({ id: TOKEN_ID, tenantId: TENANT_A, agentId: AGENT_A, issuedAt: NOW, expiresAt: NOW + 1000 });
    expect(t.state).toBe("issued");
    expect(t.verifiedAt).toBeNull();
  });

  it("verifyEnrollmentToken transitions issued -> verified", () => {
    const t = issueEnrollmentToken({ id: TOKEN_ID, tenantId: TENANT_A, agentId: AGENT_A, issuedAt: NOW, expiresAt: NOW + 1000 });
    const v = verifyEnrollmentToken(t, NOW + 1);
    expect(v.state).toBe("verified");
    expect(v.verifiedAt).toBe(NOW + 1);
  });

  it("verifyEnrollmentToken is idempotent on already-verified tokens", () => {
    const t = issueEnrollmentToken({ id: TOKEN_ID, tenantId: TENANT_A, agentId: AGENT_A, issuedAt: NOW, expiresAt: NOW + 1000 });
    const v1 = verifyEnrollmentToken(t, NOW + 1);
    const v2 = verifyEnrollmentToken(v1, NOW + 2);
    expect(v2.state).toBe("verified");
    expect(v2.verifiedAt).toBe(NOW + 1);
  });

  it("expireEnrollmentToken transitions to expired", () => {
    const t = issueEnrollmentToken({ id: TOKEN_ID, tenantId: TENANT_A, agentId: AGENT_A, issuedAt: NOW, expiresAt: NOW + 1000 });
    const v = verifyEnrollmentToken(t, NOW + 1);
    const e = expireEnrollmentToken(v);
    expect(e.state).toBe("expired");
  });

  it("expireEnrollmentToken is idempotent on already-expired tokens", () => {
    const t = issueEnrollmentToken({ id: TOKEN_ID, tenantId: TENANT_A, agentId: AGENT_A, issuedAt: NOW, expiresAt: NOW + 1000 });
    const v = verifyEnrollmentToken(t, NOW + 1);
    const e1 = expireEnrollmentToken(v);
    const e2 = expireEnrollmentToken(e1);
    expect(e2.state).toBe("expired");
  });
});

describe("agent kernel: validateEnrollmentToken (fail-closed)", () => {
  it("rejects token-tenant-mismatch when token tenant != expected", () => {
    const t = verifiedToken(TENANT_B);
    const r = validateEnrollmentToken(t, TENANT_A, AGENT_A, NOW + 100);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("token-tenant-mismatch");
  });

  it("rejects token-agent-mismatch when token agent != expected", () => {
    const t = verifiedToken(TENANT_A, "agent_other");
    const r = validateEnrollmentToken(t, TENANT_A, AGENT_A, NOW + 100);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("token-agent-mismatch");
  });

  it("rejects token-not-verified when token is still issued", () => {
    const t = issueEnrollmentToken({ id: TOKEN_ID, tenantId: TENANT_A, agentId: AGENT_A, issuedAt: NOW, expiresAt: NOW + 1000 });
    const r = validateEnrollmentToken(t, TENANT_A, AGENT_A, NOW + 100);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("token-not-verified");
  });

  it("rejects token-expired when token is past expiresAt", () => {
    const t = verifiedToken(TENANT_A, AGENT_A, NOW - 1000);
    const r = validateEnrollmentToken(t, TENANT_A, AGENT_A, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("token-expired");
  });

  it("accepts a verified token within expiresAt", () => {
    const t = verifiedToken(TENANT_A, AGENT_A, NOW + 1000);
    const r = validateEnrollmentToken(t, TENANT_A, AGENT_A, NOW + 100);
    expect(r.ok).toBe(true);
  });
});

describe("agent kernel: command-inbox ack contracts (idempotent)", () => {
  it("ackCommand on a fresh command returns state=received", () => {
    const log = emptyAckLog();
    const r = ackCommand(log, { id: "cmd_001", kind: "reboot", at: NOW }, NOW + 1);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.ack.state).toBe("received");
      expect(r.ack.commandId).toBe("cmd_001");
      expect(r.audit.intent).toBe("agent:inbox:ack:received");
    }
  });

  it("ackCommand on an already-acked command returns state=duplicate (idempotent)", () => {
    const log = emptyAckLog();
    const r1 = ackCommand(log, { id: "cmd_001", kind: "reboot", at: NOW }, NOW + 1);
    if (!r1.ok) throw new Error("first ack failed");
    const r2 = ackCommand(r1.log, { id: "cmd_001", kind: "reboot", at: NOW }, NOW + 2);
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      expect(r2.ack.state).toBe("duplicate");
      expect(r2.ack.commandId).toBe("cmd_001");
      expect(r2.audit.intent).toBe("agent:inbox:ack:duplicate");
    }
  });

  it("ackCommand on missing command id -> missing-command-id", () => {
    const log = emptyAckLog();
    const r = ackCommand(log, { id: "", kind: "reboot", at: NOW }, NOW + 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing-command-id");
  });

  it("ackCommand on missing kind -> missing-kind", () => {
    const log = emptyAckLog();
    const r = ackCommand(log, { id: "cmd_001", kind: "", at: NOW }, NOW + 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing-kind");
  });

  it("audit digest is deterministic for identical ack inputs", () => {
    const log = emptyAckLog();
    const r1 = ackCommand(log, { id: "cmd_001", kind: "reboot", at: NOW }, NOW + 1);
    const r2 = ackCommand(log, { id: "cmd_001", kind: "reboot", at: NOW }, NOW + 1);
    if (!r1.ok || !r2.ok) throw new Error("expected ok");
    expect(r1.audit.digest).toBe(r2.audit.digest);
  });

  it("log size grows by 1 on a fresh ack and stays unchanged on duplicate", () => {
    const log = emptyAckLog();
    const r1 = ackCommand(log, { id: "cmd_001", kind: "reboot", at: NOW }, NOW + 1);
    if (!r1.ok) throw new Error("first ack failed");
    expect(r1.log.acked.size).toBe(1);
    const r2 = ackCommand(r1.log, { id: "cmd_001", kind: "reboot", at: NOW }, NOW + 2);
    if (!r2.ok) throw new Error("second ack failed");
    expect(r2.log.acked.size).toBe(1);
  });
});

describe("agent kernel: reconciliation diff types", () => {
  it("computeDiff returns drift=false when heads are equal", () => {
    const d = computeDiff(5, 5);
    expect(d.drift).toBe(false);
    expect(d.diff).toBe(0);
  });

  it("computeDiff returns drift=true with positive diff when remote is ahead", () => {
    const d = computeDiff(3, 8);
    expect(d.drift).toBe(true);
    expect(d.diff).toBe(5);
  });

  it("computeDiff returns drift=true with negative diff when local is ahead", () => {
    const d = computeDiff(10, 4);
    expect(d.drift).toBe(true);
    expect(d.diff).toBe(-6);
  });
});

describe("agent kernel: enrollWithToken (REAL transitions with token lifecycle)", () => {
  it("enrolls with a verified token and emits audit", async () => {
    const ports = makePorts();
    const current = loopState("unenrolled");
    const token = verifiedToken(TENANT_A, AGENT_A, NOW + 3600_000);
    const command: AgentCommand = { kind: "enroll", at: NOW };
    const r = await enrollWithToken({ current, token, command, ports });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.state).toBe("enrolled");
      expect(r.audit.intent).toBe("agent:enroll:verified");
    }
  });

  it("rejects enrollment when token is not verified", async () => {
    const ports = makePorts();
    const current = loopState("unenrolled");
    const token = issueEnrollmentToken({ id: TOKEN_ID, tenantId: TENANT_A, agentId: AGENT_A, issuedAt: NOW, expiresAt: NOW + 1000 });
    const r = await enrollWithToken({ current, token, command: { kind: "enroll", at: NOW }, ports });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("token-not-verified");
  });

  it("rejects enrollment when token is expired", async () => {
    const ports = makePorts();
    const current = loopState("unenrolled");
    const token = verifiedToken(TENANT_A, AGENT_A, NOW - 1000);
    const r = await enrollWithToken({ current, token, command: { kind: "enroll", at: NOW }, ports });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("token-expired");
  });

  it("rejects enrollment with token-tenant-mismatch", async () => {
    const ports = makePorts();
    const current = loopState("unenrolled");
    const token = verifiedToken(TENANT_B, AGENT_A, NOW + 1000);
    const r = await enrollWithToken({ current, token, command: { kind: "enroll", at: NOW }, ports });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("token-tenant-mismatch");
  });
});

describe("agent kernel: auditedStep emits audit on every step", () => {
  it("emits audit with agent:step:<command> intent on successful transition", async () => {
    const ports = makePorts();
    const enrolled = { ...loopState("enrolled"), state: "enrolled" as const };
    const r = await auditedStep(enrolled, { kind: "establish-trust", at: NOW + 1 }, ports);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.audit.intent).toBe("agent:step:establish-trust");
      expect(r.state.state).toBe("untrusted");
    }
  });

  it("returns failure without audit on illegal transitions", async () => {
    const ports = makePorts();
    const enrolled = { ...loopState("enrolled"), state: "enrolled" as const };
    // Stop requires a reason; missing reason -> missing-reason rejection.
    const r = await auditedStep(enrolled, { kind: "stop", at: NOW + 1 }, ports);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing-reason");
  });
});
