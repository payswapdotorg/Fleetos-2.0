import { describe, it, expect } from "vitest";
import {
  applyRecoveryCommand,
  evaluateRecoveryTransition,
  isRecoveryCaseId,
  openRecoveryCase,
  type RecoveryCaseId,
  type RecoveryCommand,
  type EvidenceRefLike,
} from "./recovery.js";

const NOW = 1_727_000_000_000;
const RC1 = "rc_lost-truck-001" as RecoveryCaseId;

function ev(d: string): EvidenceRefLike {
  return { digest: d };
}

function cmd(
  kind: RecoveryCommand["kind"],
  overrides: Partial<RecoveryCommand> = {},
): RecoveryCommand {
  return { kind, initiatedAt: NOW, ...overrides };
}

describe("recovery: isRecoveryCaseId", () => {
  it("accepts well-formed recovery case id", () => {
    expect(isRecoveryCaseId("rc_lost-truck-001")).toBe(true);
  });
  it("rejects id without rc_ prefix", () => {
    expect(isRecoveryCaseId("lost-truck-001")).toBe(false);
  });
  it("rejects id shorter than 6 chars after prefix", () => {
    expect(isRecoveryCaseId("rc_ab")).toBe(false);
  });
});

describe("recovery: legal transitions", () => {
  it("open -> investigating via 'investigate'", () => {
    expect(evaluateRecoveryTransition("open", cmd("investigate", { reason: "gps-loss" }))).toEqual({
      ok: true,
      from: "open",
      to: "investigating",
    });
  });
  it("investigating -> proposal via 'propose'", () => {
    expect(evaluateRecoveryTransition("investigating", cmd("propose", { reason: "theft-suspected" }))).toEqual({
      ok: true,
      from: "investigating",
      to: "proposal",
    });
  });
  it("proposal -> resolved via 'resolve' (with evidence)", () => {
    expect(
      evaluateRecoveryTransition("proposal", cmd("resolve", { evidence: [ev("d1")], reason: "recovered" })),
    ).toEqual({ ok: true, from: "proposal", to: "resolved" });
  });
  it("proposal -> closed via 'close'", () => {
    expect(evaluateRecoveryTransition("proposal", cmd("close", { reason: "no-action" }))).toEqual({
      ok: true,
      from: "proposal",
      to: "closed",
    });
  });
  it("investigating -> closed via 'close'", () => {
    expect(evaluateRecoveryTransition("investigating", cmd("close", { reason: "duplicate" }))).toEqual({
      ok: true,
      from: "investigating",
      to: "closed",
    });
  });
  it("resolved -> closed via 'close'", () => {
    expect(evaluateRecoveryTransition("resolved", cmd("close"))).toEqual({
      ok: true,
      from: "resolved",
      to: "closed",
    });
  });
  it("resolved -> open via 'reopen' (with reason)", () => {
    expect(evaluateRecoveryTransition("resolved", cmd("reopen", { reason: "false-positive" }))).toEqual({
      ok: true,
      from: "resolved",
      to: "open",
    });
  });
  it("closed -> open via 'reopen' (with reason)", () => {
    expect(evaluateRecoveryTransition("closed", cmd("reopen", { reason: "new-evidence" }))).toEqual({
      ok: true,
      from: "closed",
      to: "open",
    });
  });
});

describe("recovery: illegal transitions refused with stable reason codes", () => {
  it("open -> resolve is illegal (must investigate + propose first)", () => {
    expect(evaluateRecoveryTransition("open", cmd("resolve", { evidence: [ev("d1")] }))).toEqual({
      ok: false,
      reason: "illegal-transition",
    });
  });
  it("investigating -> resolve is illegal", () => {
    expect(evaluateRecoveryTransition("investigating", cmd("resolve", { evidence: [ev("d1")] }))).toEqual({
      ok: false,
      reason: "illegal-transition",
    });
  });
  it("resolve without evidence -> missing-evidence", () => {
    expect(evaluateRecoveryTransition("proposal", cmd("resolve"))).toEqual({
      ok: false,
      reason: "missing-evidence",
    });
  });
  it("reopen without reason -> missing-reason", () => {
    expect(evaluateRecoveryTransition("resolved", cmd("reopen"))).toEqual({
      ok: false,
      reason: "missing-reason",
    });
  });
  it("resolved -> resolve -> already-resolved", () => {
    expect(evaluateRecoveryTransition("resolved", cmd("resolve", { evidence: [ev("d1")] }))).toEqual({
      ok: false,
      reason: "already-resolved",
    });
  });
  it("closed -> close -> already-closed", () => {
    expect(evaluateRecoveryTransition("closed", cmd("close"))).toEqual({
      ok: false,
      reason: "already-closed",
    });
  });
  it("unknown command kind -> unknown-command", () => {
    expect(
      evaluateRecoveryTransition("open", { kind: "nope" as never, initiatedAt: NOW }),
    ).toEqual({ ok: false, reason: "unknown-command" });
  });
});

describe("recovery: RecoveryCase aggregate", () => {
  it("openRecoveryCase creates a case in 'open' state with empty history", () => {
    const c = openRecoveryCase({
      id: RC1,
      tenantId: "tnt_acme",
      deviceId: "dev_truck-001",
      openedAt: NOW,
    });
    expect(c.state).toBe("open");
    expect(c.history).toEqual([]);
    expect(c.evidence).toEqual([]);
  });
  it("openRecoveryCase rejects malformed id", () => {
    expect(() =>
      openRecoveryCase({
        id: "bad" as RecoveryCaseId,
        tenantId: "tnt_acme",
        deviceId: "dev_x",
        openedAt: NOW,
      }),
    ).toThrow();
  });
  it("applyRecoveryCommand produces a new case with appended history (immutable)", () => {
    const c0 = openRecoveryCase({
      id: RC1,
      tenantId: "tnt_acme",
      deviceId: "dev_truck-001",
      openedAt: NOW,
    });
    const r = applyRecoveryCommand(c0, cmd("investigate", { reason: "gps-loss" }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.case.state).toBe("investigating");
      expect(r.case.history).toHaveLength(1);
      expect(c0.history).toHaveLength(0); // immutable: original untouched
    }
  });
  it("applyRecoveryCommand 'resolve' accumulates evidence", () => {
    const opened = openRecoveryCase({
      id: RC1,
      tenantId: "tnt_acme",
      deviceId: "dev_truck-001",
      openedAt: NOW,
    });
    const investigating = applyRecoveryCommand(
      opened,
      cmd("investigate", { reason: "gps-loss", initiatedAt: NOW + 1 }),
    );
    if (!investigating.ok) throw new Error("investigate failed");
    const proposing = applyRecoveryCommand(
      investigating.case,
      cmd("propose", { reason: "theft", initiatedAt: NOW + 2 }),
    );
    if (!proposing.ok) throw new Error("propose failed");
    const resolved = applyRecoveryCommand(
      proposing.case,
      cmd("resolve", { evidence: [ev("d1"), ev("d2")], initiatedAt: NOW + 3 }),
    );
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.case.evidence).toHaveLength(2);
      expect(resolved.case.resolution?.rootCause).toBe("unspecified");
    }
  });
});

describe("recovery: structural EvidenceRefLike seam", () => {
  it("EvidenceRefLike is structurally satisfied by { digest: string }", () => {
    const ref: EvidenceRefLike = { digest: "sha-abc" };
    expect(ref.digest).toBe("sha-abc");
  });
  it("EvidenceRefLike accepts optional kind/observedAt", () => {
    const ref: EvidenceRefLike = { digest: "sha-abc", kind: "gps", observedAt: NOW };
    expect(ref.kind).toBe("gps");
    expect(ref.observedAt).toBe(NOW);
  });
});
