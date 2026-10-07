/**
 * @fleetos/agent — Wave 3 command inbox lifecycle tests (F230A).
 *
 * Covers:
 *   - receiveCommand: initial receipt + idempotent re-receipt (duplicate)
 *   - applyCommand: trust-gated execution; low-trust refused (trust-too-low)
 *   - Idempotency: re-applying an applied command returns duplicate=true (NOT re-executed)
 *   - verifyCommand: emits verification evidence ref back to sender
 *   - Refusal reasons: trust-too-low, command-malformed, apply-failed, verify-failed
 *   - Tenant isolation: commands are tenant-scoped
 *   - Audit determinism
 */

import { describe, it, expect } from "vitest";
import {
  applyCommand,
  emptyCommandInboxLog,
  receiveCommand,
  verifyCommand,
  type ApplyResult,
  type InboxCommand,
} from "./command-inbox-lifecycle.js";
import type { TrustLevel } from "./trust-ladder.js";

const NOW = 1_727_000_000_000;
const AGENT = "agent-001";
const TENANT = "tnt_acme";

function mkCmd(id: string, kind = "routine.action", requiredCapability: InboxCommand["requiredCapability"] = "execute-routine"): InboxCommand {
  return { id, tenantId: TENANT, agentId: AGENT, kind, requiredCapability, at: NOW, payload: {} };
}

// An applyFn that always succeeds with a deterministic digest.
function okApply(_cmd: InboxCommand): ApplyResult {
  return { ok: true, resultDigest: "d-" + _cmd.id, at: NOW + 1 };
}

function failApply(_cmd: InboxCommand): ApplyResult {
  return { ok: false, resultDigest: "", at: NOW + 1, error: "boom" };
}

// ---------------------------------------------------------------------------
// receiveCommand
// ---------------------------------------------------------------------------

describe("agent command-inbox: receive", () => {
  it("receives a new command with state=received", () => {
    const r = receiveCommand(emptyCommandInboxLog(), mkCmd("c1"), NOW);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.record.state).toBe("received");
      expect(r.duplicate).toBe(false);
      expect(r.audit.intent).toBe("agent:inbox:receive");
    }
  });

  it("re-receiving the same command id is idempotent (duplicate=true)", () => {
    const r1 = receiveCommand(emptyCommandInboxLog(), mkCmd("c1"), NOW);
    if (!r1.ok) return;
    const r2 = receiveCommand(r1.log, mkCmd("c1"), NOW + 1);
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      expect(r2.duplicate).toBe(true);
      expect(r2.audit.intent).toBe("agent:inbox:receive:duplicate");
    }
  });

  it("refuses malformed command (missing id)", () => {
    const r = receiveCommand(emptyCommandInboxLog(), mkCmd("", "k"), NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("command-malformed");
  });

  it("refuses malformed command (missing kind)", () => {
    const r = receiveCommand(emptyCommandInboxLog(), mkCmd("c1", ""), NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("command-malformed");
  });
});

// ---------------------------------------------------------------------------
// applyCommand — trust gating + idempotency
// ---------------------------------------------------------------------------

describe("agent command-inbox: apply trust gating", () => {
  it("low-trust agent CANNOT execute-routine (trust-too-low)", () => {
    const log0 = emptyCommandInboxLog();
    const r1 = receiveCommand(log0, mkCmd("c1"), NOW);
    if (!r1.ok) return;
    const r2 = applyCommand(r1.log, "c1", "low" as TrustLevel, okApply, NOW + 1);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toBe("trust-too-low");
  });

  it("standard-trust agent CAN execute-routine", () => {
    const log0 = emptyCommandInboxLog();
    const r1 = receiveCommand(log0, mkCmd("c1"), NOW);
    if (!r1.ok) return;
    const r2 = applyCommand(r1.log, "c1", "standard" as TrustLevel, okApply, NOW + 1);
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      expect(r2.record.state).toBe("applied");
      expect(r2.duplicate).toBe(false);
      expect(r2.applyResult.resultDigest).toBe("d-c1");
    }
  });

  it("elevated-trust agent CAN execute-destructive", () => {
    const log0 = emptyCommandInboxLog();
    const cmd = mkCmd("c1", "destructive.action", "execute-destructive");
    const r1 = receiveCommand(log0, cmd, NOW);
    if (!r1.ok) return;
    const r2 = applyCommand(r1.log, "c1", "elevated" as TrustLevel, okApply, NOW + 1);
    expect(r2.ok).toBe(true);
  });

  it("standard-trust agent CANNOT execute-destructive (trust-too-low)", () => {
    const log0 = emptyCommandInboxLog();
    const cmd = mkCmd("c1", "destructive.action", "execute-destructive");
    const r1 = receiveCommand(log0, cmd, NOW);
    if (!r1.ok) return;
    const r2 = applyCommand(r1.log, "c1", "standard" as TrustLevel, okApply, NOW + 1);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toBe("trust-too-low");
  });
});

// ---------------------------------------------------------------------------
// Idempotency — re-applying is a no-op (reports once)
// ---------------------------------------------------------------------------

describe("agent command-inbox: apply idempotency", () => {
  it("re-applying an already-applied command returns duplicate=true (NOT re-executed)", () => {
    const log0 = emptyCommandInboxLog();
    const r1 = receiveCommand(log0, mkCmd("c1"), NOW);
    if (!r1.ok) return;
    let applyCount = 0;
    const countingApply = (cmd: InboxCommand) => {
      applyCount++;
      return okApply(cmd);
    };
    const r2 = applyCommand(r1.log, "c1", "standard" as TrustLevel, countingApply, NOW + 1);
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.duplicate).toBe(false);
    expect(applyCount).toBe(1);
    // Re-apply — should NOT call countingApply.
    const r3 = applyCommand(r2.ok ? r2.log : r1.log, "c1", "standard" as TrustLevel, countingApply, NOW + 2);
    expect(r3.ok).toBe(true);
    if (r3.ok) expect(r3.duplicate).toBe(true);
    expect(applyCount).toBe(1); // NOT incremented
  });

  it("apply-failed: applyFn returns ok=false -> state=refused", () => {
    const log0 = emptyCommandInboxLog();
    const r1 = receiveCommand(log0, mkCmd("c1"), NOW);
    if (!r1.ok) return;
    const r2 = applyCommand(r1.log, "c1", "standard" as TrustLevel, failApply, NOW + 1);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toBe("apply-failed");
    // The record should be in 'refused' state.
    const r3 = receiveCommand(r2.log, mkCmd("c1"), NOW + 2);
    if (r3.ok) expect(r3.record.state).toBe("refused");
  });
});

// ---------------------------------------------------------------------------
// verifyCommand
// ---------------------------------------------------------------------------

describe("agent command-inbox: verify", () => {
  it("verifies an applied command and emits evidence ref", () => {
    const log0 = emptyCommandInboxLog();
    const r1 = receiveCommand(log0, mkCmd("c1"), NOW);
    if (!r1.ok) return;
    const r2 = applyCommand(r1.log, "c1", "standard" as TrustLevel, okApply, NOW + 1);
    if (!r2.ok) return;
    const r3 = verifyCommand(r2.log, "c1", NOW + 2);
    expect(r3.ok).toBe(true);
    if (r3.ok) {
      expect(r3.record.state).toBe("verified");
      expect(r3.evidence.commandId).toBe("c1");
      expect(r3.evidence.appliedResultDigest).toBe("d-c1");
      expect(r3.evidence.evidenceDigest).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("refuses to verify a non-applied command (verify-failed)", () => {
    const log0 = emptyCommandInboxLog();
    const r1 = receiveCommand(log0, mkCmd("c1"), NOW);
    if (!r1.ok) return;
    const r2 = verifyCommand(r1.log, "c1", NOW + 1);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toBe("verify-failed");
  });

  it("refuses to verify an unknown command (command-malformed)", () => {
    const r = verifyCommand(emptyCommandInboxLog(), "no-such-cmd", NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("command-malformed");
  });
});

// ---------------------------------------------------------------------------
// Tenant isolation
// ---------------------------------------------------------------------------

describe("agent command-inbox: tenant isolation", () => {
  it("audit.tenant matches the command's tenantId", () => {
    const r = receiveCommand(emptyCommandInboxLog(), mkCmd("c1"), NOW);
    if (r.ok) expect(r.audit.tenant).toBe(TENANT);
  });

  it("commands from different tenants have disjoint logs (caller constructs one per tenant)", () => {
    const logA = emptyCommandInboxLog();
    const logB = emptyCommandInboxLog();
    const cmdA = mkCmd("cA");
    const cmdB: InboxCommand = { ...mkCmd("cB"), tenantId: "tnt_other" };
    const rA = receiveCommand(logA, cmdA, NOW);
    const rB = receiveCommand(logB, cmdB, NOW);
    expect(rA.ok).toBe(true);
    expect(rB.ok).toBe(true);
    if (rA.ok && rB.ok) {
      expect(rA.log.records.has("cB")).toBe(false);
      expect(rB.log.records.has("cA")).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Audit determinism
// ---------------------------------------------------------------------------

describe("agent command-inbox: audit determinism", () => {
  it("identical receive produces identical audit digest", () => {
    const r1 = receiveCommand(emptyCommandInboxLog(), mkCmd("c1"), NOW);
    const r2 = receiveCommand(emptyCommandInboxLog(), mkCmd("c1"), NOW);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (r1.ok && r2.ok) expect(r1.audit.digest).toBe(r2.audit.digest);
  });
});
