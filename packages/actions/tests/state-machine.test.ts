import { describe, it, expect } from "vitest";
import { advanceActionState, proposeAction, type ActionIntent, type ActionRecord } from "../src/index.ts";
import type { GuardianDecision } from "@fleetos/policy/policy";
import type { Capability, TenantScopeLike } from "@fleetos/policy/capability";

const tenant: TenantScopeLike = { tenantId: "tenant-1" };

function cap(): Capability {
  return {
    id: "cap.execute.device.restart",
    category: "execute.device",
    risk: "high",
    requiredAuthority: ["asset.owner"],
    tenantScope: "single",
    resourceScope: { assetIds: ["a-1"] },
    sideEffects: [{ kind: "device.command", target: "a-1", reversible: false, description: "restart" }],
    idempotency: { supported: true, keyShape: ["tenantId", "assetId"] },
    verification: { kind: "device.ack" },
    inputs: ["assetId"],
    outputs: ["restartReceipt"],
    description: "restart",
    version: "1.0.0",
  };
}

function intent(): ActionIntent {
  return {
    intentId: "intent-1",
    tenant,
    capability: cap(),
    idempotencyKey: { tenantId: "tenant-1", capabilityId: cap().id, nonce: "n-1" },
    inputs: { assetId: "a-1" },
    proposedAt: "1970-01-01T00:00:00.000Z",
    proposedBy: "u-1",
  };
}

function allowDecision(): GuardianDecision {
  return {
    verdict: "ALLOW",
    reasonCode: "allow.matched_rule",
    matchedRuleId: "rule.allow_low_risk_read",
    tenantId: "tenant-1",
    capabilityId: cap().id,
    conditions: [],
    decisionDigest: "stable-digest",
  };
}

const at = "1970-01-01T00:00:01.000Z";

describe("advanceActionState: full forward path", () => {
  it("advances proposed -> authorized -> confirmed -> dispatched -> executing -> executed -> verified -> recorded -> learned", () => {
    let rec: ActionRecord = proposeAction(intent());
    expect(rec.state).toBe("proposed");

    let r = advanceActionState(rec, "authorized", { at, authorization: allowDecision(), tenantId: "tenant-1" });
    expect(r.ok).toBe(true);
    if (r.ok) rec = r.record;
    expect(rec.state).toBe("authorized");

    r = advanceActionState(rec, "confirmed", { at, confirmedBy: "u-1", tenantId: "tenant-1" });
    expect(r.ok).toBe(true);
    if (r.ok) rec = r.record;
    expect(rec.state).toBe("confirmed");

    r = advanceActionState(rec, "dispatched", { at, dispatchReceipt: "disp-1", tenantId: "tenant-1" });
    expect(r.ok).toBe(true);
    if (r.ok) rec = r.record;
    expect(rec.state).toBe("dispatched");

    r = advanceActionState(rec, "executing", { at, tenantId: "tenant-1" });
    expect(r.ok).toBe(true);
    if (r.ok) rec = r.record;
    expect(rec.state).toBe("executing");

    r = advanceActionState(rec, "executed", {
      at,
      executionResult: { succeeded: true, outputs: {}, executedAt: at },
      tenantId: "tenant-1",
    });
    expect(r.ok).toBe(true);
    if (r.ok) rec = r.record;
    expect(rec.state).toBe("executed");

    r = advanceActionState(rec, "verified", {
      at,
      verificationRecord: { verified: true, verifierKind: "device.ack", verifiedAt: at, proofRef: "p-1" },
      tenantId: "tenant-1",
    });
    expect(r.ok).toBe(true);
    if (r.ok) rec = r.record;
    expect(rec.state).toBe("verified");

    r = advanceActionState(rec, "recorded", { at, evidenceRef: "ev-1", tenantId: "tenant-1" });
    expect(r.ok).toBe(true);
    if (r.ok) rec = r.record;
    expect(rec.state).toBe("recorded");

    r = advanceActionState(rec, "learned", { at, learningRef: "learn-1", tenantId: "tenant-1" });
    expect(r.ok).toBe(true);
    if (r.ok) rec = r.record;
    expect(rec.state).toBe("learned");
    expect(rec.stateHistory).toHaveLength(8);
  });
});

describe("advanceActionState: illegal jumps refused", () => {
  it("refuses execute (dispatched -> executing) when starting from proposed", () => {
    const rec = proposeAction(intent());
    const r = advanceActionState(rec, "executing", { at, tenantId: "tenant-1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("refused.execute_without_authorization");
  });

  it("refuses execute (dispatched -> executing) when starting from authorized", () => {
    let rec = proposeAction(intent());
    const r1 = advanceActionState(rec, "authorized", { at, authorization: allowDecision(), tenantId: "tenant-1" });
    if (r1.ok) rec = r1.record;
    const r2 = advanceActionState(rec, "executing", { at, tenantId: "tenant-1" });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toBe("refused.execute_without_authorization");
  });

  it("refuses dispatch without confirmation", () => {
    let rec = proposeAction(intent());
    const r1 = advanceActionState(rec, "authorized", { at, authorization: allowDecision(), tenantId: "tenant-1" });
    if (r1.ok) rec = r1.record;
    const r2 = advanceActionState(rec, "dispatched", { at, dispatchReceipt: "d-1", tenantId: "tenant-1" });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toBe("refused.dispatch_without_confirmation");
  });

  it("refuses verify without execution", () => {
    let rec = proposeAction(intent());
    const r1 = advanceActionState(rec, "authorized", { at, authorization: allowDecision(), tenantId: "tenant-1" });
    if (r1.ok) rec = r1.record;
    const r2 = advanceActionState(rec, "verified", {
      at,
      verificationRecord: { verified: true, verifierKind: "device.ack", verifiedAt: at, proofRef: "p-1" },
      tenantId: "tenant-1",
    });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toBe("refused.verify_without_execution");
  });

  it("refuses record without verification", () => {
    let rec = proposeAction(intent());
    const r1 = advanceActionState(rec, "authorized", { at, authorization: allowDecision(), tenantId: "tenant-1" });
    if (r1.ok) rec = r1.record;
    const r2 = advanceActionState(rec, "recorded", { at, evidenceRef: "e-1", tenantId: "tenant-1" });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toBe("refused.record_without_verification");
  });

  it("refuses learn without record", () => {
    let rec = proposeAction(intent());
    const r1 = advanceActionState(rec, "authorized", { at, authorization: allowDecision(), tenantId: "tenant-1" });
    if (r1.ok) rec = r1.record;
    const r2 = advanceActionState(rec, "learned", { at, learningRef: "l-1", tenantId: "tenant-1" });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toBe("refused.learn_without_record");
  });

  it("refuses authorized when authorization is missing", () => {
    const rec = proposeAction(intent());
    const r = advanceActionState(rec, "authorized", { at, tenantId: "tenant-1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("refused.execute_without_authorization");
  });

  it("refuses authorized when authorization verdict is BLOCK", () => {
    const rec = proposeAction(intent());
    const r = advanceActionState(rec, "authorized", {
      at,
      authorization: { ...allowDecision(), verdict: "BLOCK", reasonCode: "block.policy_fail_closed" },
      tenantId: "tenant-1",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("refused.execute_without_authorization");
  });
});

describe("advanceActionState: tenant fail-closed", () => {
  it("refuses transitions when tenantId does not match", () => {
    const rec = proposeAction(intent());
    const r = advanceActionState(rec, "authorized", {
      at,
      authorization: allowDecision(),
      tenantId: "tenant-2",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("refused.tenant_mismatch");
  });
});

describe("advanceActionState: terminal states", () => {
  it("refuses any forward transition from learned", () => {
    let rec = proposeAction(intent());
    const steps = [
      { target: "authorized", ctx: { authorization: allowDecision() } },
      { target: "confirmed", ctx: { confirmedBy: "u-1" } },
      { target: "dispatched", ctx: { dispatchReceipt: "d" } },
      { target: "executing", ctx: {} },
      { target: "executed", ctx: { executionResult: { succeeded: true, outputs: {}, executedAt: at } } },
      { target: "verified", ctx: { verificationRecord: { verified: true, verifierKind: "device.ack" as const, verifiedAt: at, proofRef: "p" } } },
      { target: "recorded", ctx: { evidenceRef: "e" } },
      { target: "learned", ctx: { learningRef: "l" } },
    ] as const;
    for (const step of steps) {
      const r = advanceActionState(rec, step.target, { at, tenantId: "tenant-1", ...step.ctx });
      if (r.ok) rec = r.record; else throw new Error(`unexpected refusal at ${step.target}`);
    }
    const r = advanceActionState(rec, "executed", { at, tenantId: "tenant-1" });
    expect(r.ok).toBe(false);
  });
});
