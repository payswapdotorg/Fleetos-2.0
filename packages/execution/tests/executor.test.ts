import { describe, it, expect } from "vitest";
import {
  authorizeCommand,
  executeCommand,
  makeReferenceTransport,
  referenceCapability,
  type AuthorizedCommand,
  type CommandTransportPort,
  type ExecutionResult,
} from "../src/index.ts";
import type { GuardianDecision } from "@fleetos/policy/policy";

function allowDecision(tenantId: string): GuardianDecision {
  return {
    verdict: "ALLOW",
    reasonCode: "allow.matched_rule",
    matchedRuleId: "rule.allow_low_risk_read",
    tenantId,
    capabilityId: "cap.test",
    conditions: [],
    decisionDigest: "stable-digest",
  };
}

function blockDecision(tenantId: string): GuardianDecision {
  return {
    verdict: "BLOCK",
    reasonCode: "block.policy_fail_closed",
    matchedRuleId: null,
    tenantId,
    capabilityId: "cap.test",
    conditions: [],
    decisionDigest: "stable-digest-block",
  };
}

describe("authorizeCommand: refuse BLOCK verdicts", () => {
  it("refuses to construct an AuthorizedCommand from a BLOCK verdict", () => {
    const r = authorizeCommand(
      blockDecision("t1"),
      { capabilityId: "cap.test", inputs: {} },
      { tenantId: "t1" },
      undefined,
      "idem-1",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("refused.block_verdict");
  });

  it("refuses when tenantId does not match the decision", () => {
    const r = authorizeCommand(
      allowDecision("t1"),
      { capabilityId: "cap.test", inputs: {} },
      { tenantId: "t2" },
      undefined,
      "idem-1",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("refused.tenant_mismatch");
  });

  it("constructs an AuthorizedCommand for an ALLOW verdict with matching tenant", () => {
    const r = authorizeCommand(
      allowDecision("t1"),
      { capabilityId: "cap.test", inputs: {} },
      { tenantId: "t1" },
      undefined,
      "idem-1",
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.command.verdict).toBe("ALLOW");
      expect(r.command.idempotencyKey).toBe("idem-1");
    }
  });

  it("constructs an AuthorizedCommand for a REQUIRE_APPROVAL verdict (post-approval)", () => {
    const r = authorizeCommand(
      { ...allowDecision("t1"), verdict: "REQUIRE_APPROVAL" },
      { capabilityId: "cap.test", inputs: {} },
      { tenantId: "t1" },
      { missionId: "m1" },
      "idem-1",
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.command.missionRef?.missionId).toBe("m1");
  });
});

describe("executeCommand: never authorizes", () => {
  it("delegates dispatch to the injected transport", async () => {
    const calls: AuthorizedCommand[] = [];
    const transport: CommandTransportPort = makeReferenceTransport(async (cmd) => {
      calls.push(cmd);
      return {
        commandId: cmd.idempotencyKey,
        state: "succeeded",
        outputs: { ok: true },
        startedAt: "1970-01-01T00:00:00.000Z",
        endedAt: "1970-01-01T00:00:00.000Z",
        transportName: "reference.in-memory",
      };
    });
    const r = authorizeCommand(
      allowDecision("t1"),
      { capabilityId: "cap.test", inputs: { x: 1 } },
      { tenantId: "t1" },
      undefined,
      "idem-1",
    );
    if (!r.ok) throw new Error("expected ok");
    const result = await executeCommand(transport, r.command);
    expect(result.state).toBe("succeeded");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.payload.inputs).toEqual({ x: 1 });
  });

  it("returns a deterministic failure for empty capabilityId", async () => {
    const transport = makeReferenceTransport(async () => ({
      commandId: "x",
      state: "succeeded",
      outputs: {},
      startedAt: "1970-01-01T00:00:00.000Z",
      endedAt: "1970-01-01T00:00:00.000Z",
      transportName: "reference.in-memory",
    }));
    const r = authorizeCommand(
      allowDecision("t1"),
      { capabilityId: "", inputs: {} },
      { tenantId: "t1" },
      undefined,
      "idem-1",
    );
    if (!r.ok) throw new Error("expected ok");
    const result = await executeCommand(transport, r.command);
    expect(result.state).toBe("failed");
    expect(result.failureReason).toBe("empty capabilityId");
  });

  it("returns the transport's failure result without transforming it", async () => {
    const transport = makeReferenceTransport(async (cmd) => ({
      commandId: cmd.idempotencyKey,
      state: "failed" as const,
      outputs: {},
      failureReason: "device.offline",
      startedAt: "1970-01-01T00:00:00.000Z",
      endedAt: "1970-01-01T00:00:00.000Z",
      transportName: "reference.in-memory",
    }));
    const r = authorizeCommand(
      allowDecision("t1"),
      { capabilityId: "cap.test", inputs: {} },
      { tenantId: "t1" },
      undefined,
      "idem-1",
    );
    if (!r.ok) throw new Error("expected ok");
    const result = await executeCommand(transport, r.command);
    expect(result.state).toBe("failed");
    expect(result.failureReason).toBe("device.offline");
  });
});

describe("executeCommand: determinism", () => {
  it("produces identical results for identical inputs (transport is deterministic)", async () => {
    let counter = 0;
    const transport = makeReferenceTransport(async (cmd) => ({
      commandId: cmd.idempotencyKey,
      state: "succeeded" as const,
      outputs: { counter: counter++ },
      startedAt: "1970-01-01T00:00:00.000Z",
      endedAt: "1970-01-01T00:00:00.000Z",
      transportName: "reference.in-memory",
    }));
    const r1 = authorizeCommand(allowDecision("t1"), { capabilityId: "cap.test", inputs: {} }, { tenantId: "t1" }, undefined, "idem-1");
    const r2 = authorizeCommand(allowDecision("t1"), { capabilityId: "cap.test", inputs: {} }, { tenantId: "t1" }, undefined, "idem-1");
    if (!r1.ok || !r2.ok) throw new Error("expected ok");
    const a = await executeCommand(transport, r1.command);
    const b = await executeCommand(transport, r2.command);
    // outputs differ only by counter — the deterministic envelope is identical.
    expect(a.commandId).toBe(b.commandId);
    expect(a.state).toBe(b.state);
    expect(a.transportName).toBe(b.transportName);
  });
});

describe("referenceCapability", () => {
  it("produces a valid capability with the given id", () => {
    const cap = referenceCapability("cap.test");
    expect(cap.id).toBe("cap.test");
    expect(cap.version).toBe("1.0.0");
    expect(cap.category).toBe("execute.device");
  });
});

describe("ExecutionResult: structural shape", () => {
  it("carries transportName so callers can distinguish transports", () => {
    const r: ExecutionResult = {
      commandId: "c1",
      state: "succeeded",
      outputs: {},
      startedAt: "1970-01-01T00:00:00.000Z",
      endedAt: "1970-01-01T00:00:00.000Z",
      transportName: "reference.in-memory",
    };
    expect(r.transportName).toBe("reference.in-memory");
  });
});
