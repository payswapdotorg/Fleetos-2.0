/**
 * Actions kernel tests — idempotency ledger, audit events, compensation.
 *
 * Wave 1 (F210B) additions.
 */
import { describe, it, expect } from "vitest";
import {
  InMemoryIdempotencyLedger,
  dispatchWithIdempotency,
  buildIdempotencyKey,
  InMemoryActionAuditSink,
  emitAuditEvent,
  emitAuditTrail,
  verifyAuditTrail,
  stateToEventKind,
  transitionDigest,
  buildCompensationContract,
  cancelAction,
  attemptCompensation,
  advanceActionState,
  proposeAction,
} from "../src/index.ts";
import type { ActionIntent, ActionRecord } from "../src/index.ts";
import type { Capability } from "@fleetos/policy/capability";
import type { GuardianDecision } from "@fleetos/policy/policy";

// ---------- helpers ----------

function cap(overrides: Partial<Capability> = {}): Capability {
  return {
    id: "cap.test",
    category: "execute.device",
    risk: "medium",
    requiredAuthority: ["asset.owner"],
    tenantScope: "single",
    resourceScope: { assetIds: ["a-1"] },
    sideEffects: [{ kind: "device.command", target: "a-1", reversible: false, description: "test" }],
    idempotency: { supported: true, keyShape: ["tenantId"] },
    verification: { kind: "device.ack" },
    inputs: [],
    outputs: [],
    description: "test cap",
    version: "1.0.0",
    ...overrides,
  };
}

function intent(overrides: Partial<ActionIntent> = {}): ActionIntent {
  return {
    intentId: "intent-1",
    tenant: { tenantId: "tenant-1" },
    capability: cap(),
    idempotencyKey: { tenantId: "tenant-1", capabilityId: "cap.test", nonce: "n1" },
    inputs: {},
    proposedAt: "2026-01-01T00:00:00.000Z",
    proposedBy: "user-1",
    ...overrides,
  };
}

function allowDecision(): GuardianDecision {
  return {
    verdict: "ALLOW",
    reasonCode: "allow.matched_rule",
    matchedRuleId: "rule.allow_low_risk_read",
    tenantId: "tenant-1",
    capabilityId: "cap.test",
    conditions: [],
    decisionDigest: "dig1",
  };
}

// ---------- Idempotency Ledger ----------

describe("InMemoryIdempotencyLedger", () => {
  it("check returns null for unseen key", async () => {
    const ledger = new InMemoryIdempotencyLedger();
    expect(await ledger.check("k1")).toBeNull();
  });

  it("record stores and check retrieves the ack", async () => {
    const ledger = new InMemoryIdempotencyLedger();
    await ledger.record({
      idempotencyKey: "k1",
      dispatchReceipt: "r1",
      dispatchedAt: "2026-01-01T00:00:00.000Z",
      duplicate: false,
    });
    const ack = await ledger.check("k1");
    expect(ack).not.toBeNull();
    expect(ack!.dispatchReceipt).toBe("r1");
  });

  it("duplicate recording is a no-op (idempotent)", async () => {
    const ledger = new InMemoryIdempotencyLedger();
    const ack = { idempotencyKey: "k1", dispatchReceipt: "r1", dispatchedAt: "t", duplicate: false };
    await ledger.record(ack);
    await ledger.record({ ...ack, dispatchReceipt: "DIFFERENT" });
    expect(ledger.size()).toBe(1);
    const stored = await ledger.check("k1");
    expect(stored!.dispatchReceipt).toBe("r1"); // first one wins
  });
});

describe("dispatchWithIdempotency", () => {
  it("first dispatch calls the function and records the ack", async () => {
    const ledger = new InMemoryIdempotencyLedger();
    let callCount = 0;
    const ack = await dispatchWithIdempotency(ledger, "k1", async () => {
      callCount += 1;
      return { receipt: "r1", at: "2026-01-01T00:00:00.000Z" };
    });
    expect(ack.duplicate).toBe(false);
    expect(ack.dispatchReceipt).toBe("r1");
    expect(callCount).toBe(1);
  });

  it("duplicate dispatch returns cached ack WITHOUT calling the function (never double execution)", async () => {
    const ledger = new InMemoryIdempotencyLedger();
    let callCount = 0;
    const dispatch = async () => {
      callCount += 1;
      return { receipt: "r1", at: "2026-01-01T00:00:00.000Z" };
    };
    const ack1 = await dispatchWithIdempotency(ledger, "k1", dispatch);
    const ack2 = await dispatchWithIdempotency(ledger, "k1", dispatch);
    expect(callCount).toBe(1); // function called ONCE
    expect(ack1.duplicate).toBe(false);
    expect(ack2.duplicate).toBe(true);
    expect(ack1.dispatchReceipt).toBe(ack2.dispatchReceipt); // identical ack
  });

  it("different keys produce independent dispatches", async () => {
    const ledger = new InMemoryIdempotencyLedger();
    let callCount = 0;
    const dispatch = async () => {
      callCount += 1;
      return { receipt: `r${callCount}`, at: "t" };
    };
    await dispatchWithIdempotency(ledger, "k1", dispatch);
    await dispatchWithIdempotency(ledger, "k2", dispatch);
    expect(callCount).toBe(2);
  });
});

describe("buildIdempotencyKey", () => {
  it("produces a stable key from tenant+capability+nonce", () => {
    const k1 = buildIdempotencyKey({ tenantId: "t1", capabilityId: "c1", nonce: "n1" });
    const k2 = buildIdempotencyKey({ tenantId: "t1", capabilityId: "c1", nonce: "n1" });
    expect(k1).toBe(k2);
    expect(k1).toBe("t1|c1|n1");
  });

  it("different inputs produce different keys", () => {
    const k1 = buildIdempotencyKey({ tenantId: "t1", capabilityId: "c1", nonce: "n1" });
    const k2 = buildIdempotencyKey({ tenantId: "t2", capabilityId: "c1", nonce: "n1" });
    expect(k1).not.toBe(k2);
  });
});

// ---------- Audit Events ----------

describe("Audit events", () => {
  it("stateToEventKind maps every state", () => {
    expect(stateToEventKind("proposed")).toBe("action.proposed");
    expect(stateToEventKind("authorized")).toBe("action.authorized");
    expect(stateToEventKind("dispatched")).toBe("action.dispatched");
    expect(stateToEventKind("executed")).toBe("action.executed");
    expect(stateToEventKind("verified")).toBe("action.verified");
    expect(stateToEventKind("recorded")).toBe("action.recorded");
    expect(stateToEventKind("learned")).toBe("action.learned");
    expect(stateToEventKind("rejected")).toBe("action.rejected");
    expect(stateToEventKind("cancelled")).toBe("action.cancelled");
  });

  it("transitionDigest is deterministic", () => {
    const t = { from: "proposed" as const, to: "authorized" as const, at: "t1", reason: "r" };
    expect(transitionDigest(t)).toBe(transitionDigest(t));
    expect(transitionDigest(t)).toHaveLength(8);
  });

  it("emitAuditEvent produces a well-formed event", () => {
    const rec = proposeAction(intent());
    const transition = { from: "proposed" as const, to: "authorized" as const, at: "t1", reason: "guardian.authorized" };
    const event = emitAuditEvent(rec, transition, "user-1", "tenant-1");
    expect(event.kind).toBe("action.authorized");
    expect(event.fromState).toBe("proposed");
    expect(event.toState).toBe("authorized");
    expect(event.tenantId).toBe("tenant-1");
    expect(event.intentId).toBe("intent-1");
    expect(event.transitionDigest).toHaveLength(8);
  });

  it("InMemoryActionAuditSink appends and lists by intentId", async () => {
    const sink = new InMemoryActionAuditSink();
    const rec = proposeAction(intent());
    const event = emitAuditEvent(rec, { from: "proposed", to: "authorized", at: "t1", reason: "r" }, "user-1", "tenant-1");
    await sink.append(event);
    const events = await sink.list("intent-1");
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe("action.authorized");
  });

  it("emitAuditTrail produces an event for every transition in history", () => {
    let rec: ActionRecord = proposeAction(intent());
    const r1 = advanceActionState(rec, "authorized", { at: "t1", authorization: allowDecision(), tenantId: "tenant-1" });
    if (r1.ok) rec = r1.record;
    const r2 = advanceActionState(rec, "confirmed", { at: "t2", confirmedBy: "user-1", tenantId: "tenant-1" });
    if (r2.ok) rec = r2.record;

    const trail = emitAuditTrail(rec, "user-1");
    expect(trail).toHaveLength(2);
    expect(trail[0]!.kind).toBe("action.authorized");
    expect(trail[1]!.kind).toBe("action.confirmed");
  });

  it("verifyAuditTrail returns verified=true when all transitions have events", async () => {
    const sink = new InMemoryActionAuditSink();
    let rec: ActionRecord = proposeAction(intent());
    const r1 = advanceActionState(rec, "authorized", { at: "t1", authorization: allowDecision(), tenantId: "tenant-1" });
    if (r1.ok) rec = r1.record;

    const trail = emitAuditTrail(rec, "user-1");
    for (const e of trail) await sink.append(e);

    const events = await sink.list("intent-1");
    const result = verifyAuditTrail(rec, events);
    expect(result.verified).toBe(true);
    expect(result.missingTransitions).toBe(0);
  });

  it("verifyAuditTrail returns verified=false when events are missing", async () => {
    const sink = new InMemoryActionAuditSink();
    let rec: ActionRecord = proposeAction(intent());
    const r1 = advanceActionState(rec, "authorized", { at: "t1", authorization: allowDecision(), tenantId: "tenant-1" });
    if (r1.ok) rec = r1.record;
    const r2 = advanceActionState(rec, "confirmed", { at: "t2", confirmedBy: "user-1", tenantId: "tenant-1" });
    if (r2.ok) rec = r2.record;

    // Only emit one of two events
    const trail = emitAuditTrail(rec, "user-1");
    await sink.append(trail[0]!);

    const events = await sink.list("intent-1");
    const result = verifyAuditTrail(rec, events);
    expect(result.verified).toBe(false);
    expect(result.missingTransitions).toBe(1);
  });
});

// ---------- Compensation ----------

describe("Compensation contracts", () => {
  it("cancelled before dispatch with no side effects => kind=none", () => {
    const i = intent({ capability: cap({ sideEffects: [] }) });
    const rec = proposeAction(i);
    const { record, contract } = cancelAction(rec, "2026-01-01T00:00:00.000Z");
    expect(record.state).toBe("cancelled");
    expect(contract.kind).toBe("none");
    expect(contract.requiresGuardianAuthorization).toBe(false);
  });

  it("cancelled after dispatch with reversible side effects => kind=revert_command", () => {
    const i = intent({
      capability: cap({
        sideEffects: [{ kind: "device.command", target: "a-1", reversible: true, description: "reversible" }],
      }),
    });
    let rec = proposeAction(i);
    const r1 = advanceActionState(rec, "authorized", { at: "t1", authorization: allowDecision(), tenantId: "tenant-1" });
    if (r1.ok) rec = r1.record;
    const r2 = advanceActionState(rec, "confirmed", { at: "t2", confirmedBy: "user-1", tenantId: "tenant-1" });
    if (r2.ok) rec = r2.record;
    const r3 = advanceActionState(rec, "dispatched", { at: "t3", dispatchReceipt: "r1", tenantId: "tenant-1" });
    if (r3.ok) rec = r3.record;

    const { record: cancelled, contract } = cancelAction(rec, "2026-01-01T00:00:00.000Z");
    expect(cancelled.state).toBe("cancelled");
    expect(contract.kind).toBe("revert_command");
    expect(contract.requiresGuardianAuthorization).toBe(true);
    expect(contract.compensatingCapabilityId).toBe("cap.test.revert");
  });

  it("executed with irreversible side effects => kind=manual_intervention", () => {
    const i = intent({
      capability: cap({
        sideEffects: [{ kind: "domain.write", target: "db", reversible: false, description: "irreversible write" }],
      }),
    });
    let rec = proposeAction(i);
    const r1 = advanceActionState(rec, "authorized", { at: "t1", authorization: allowDecision(), tenantId: "tenant-1" });
    if (r1.ok) rec = r1.record;
    const r2 = advanceActionState(rec, "confirmed", { at: "t2", confirmedBy: "u", tenantId: "tenant-1" });
    if (r2.ok) rec = r2.record;
    const r3 = advanceActionState(rec, "dispatched", { at: "t3", dispatchReceipt: "r", tenantId: "tenant-1" });
    if (r3.ok) rec = r3.record;
    const r4 = advanceActionState(rec, "executing", { at: "t4", tenantId: "tenant-1" });
    if (r4.ok) rec = r4.record;
    const r5 = advanceActionState(rec, "executed", {
      at: "t5",
      executionResult: { succeeded: true, outputs: {}, executedAt: "t5" },
      tenantId: "tenant-1",
    });
    if (r5.ok) rec = r5.record;

    const contract = buildCompensationContract(rec);
    expect(contract.kind).toBe("manual_intervention");
    expect(contract.reversible).toBe(false);
  });

  it("cancelAction on terminal state returns no-op contract", () => {
    const rec = proposeAction(intent());
    const r1 = advanceActionState(rec, "rejected", { at: "t1", tenantId: "tenant-1" });
    if (!r1.ok) throw new Error("reject failed");
    const { record, contract } = cancelAction(r1.record, "2026-01-01T00:00:00.000Z");
    expect(record.state).toBe("rejected"); // unchanged
    expect(contract.kind).toBe("none");
  });

  it("attemptCompensation with no side effects succeeds", () => {
    const contract: ReturnType<typeof buildCompensationContract> = {
      contractId: "c1",
      intentId: "i1",
      tenantId: "t1",
      kind: "none",
      description: "none",
      requiresGuardianAuthorization: false,
      compensatingCapabilityId: null,
      reversible: true,
    };
    const result = attemptCompensation(contract, false);
    expect(result.ok).toBe(true);
    expect(result.reasonCode).toBe("compensated.no_side_effects");
  });

  it("attemptCompensation with manual_intervention fails", () => {
    const contract = {
      contractId: "c1",
      intentId: "i1",
      tenantId: "t1",
      kind: "manual_intervention" as const,
      description: "manual",
      requiresGuardianAuthorization: true,
      compensatingCapabilityId: null,
      reversible: false,
    };
    const result = attemptCompensation(contract, true);
    expect(result.ok).toBe(false);
    expect(result.reasonCode).toBe("compensated.requires_manual_intervention");
  });

  it("attemptCompensation with revert_command requires Guardian authorization", () => {
    const contract = {
      contractId: "c1",
      intentId: "i1",
      tenantId: "t1",
      kind: "revert_command" as const,
      description: "revert",
      requiresGuardianAuthorization: true,
      compensatingCapabilityId: "cap.revert",
      reversible: true,
    };
    // Without Guardian authorization
    const r1 = attemptCompensation(contract, false);
    expect(r1.ok).toBe(false);
    expect(r1.reasonCode).toBe("compensated.guardian_refused");
    // With Guardian authorization
    const r2 = attemptCompensation(contract, true);
    expect(r2.ok).toBe(true);
    expect(r2.reasonCode).toBe("compensated.successfully");
  });

  it("attemptCompensation with irreversible action fails", () => {
    const contract = {
      contractId: "c1",
      intentId: "i1",
      tenantId: "t1",
      kind: "revert_command" as const,
      description: "revert",
      requiresGuardianAuthorization: true,
      compensatingCapabilityId: "cap.revert",
      reversible: false,
    };
    const result = attemptCompensation(contract, true);
    expect(result.ok).toBe(false);
    expect(result.reasonCode).toBe("compensated.irreversible_action");
  });
});

// ---------- Integration: full protocol + audit + idempotency ----------

describe("Full protocol integration with audit and idempotency", () => {
  it("advances through the full protocol emitting audit events at each step", async () => {
    const auditSink = new InMemoryActionAuditSink();
    const idemLedger = new InMemoryIdempotencyLedger();
    let rec = proposeAction(intent());

    const advanceAndAudit = async (
      target: Parameters<typeof advanceActionState>[1],
      ctx: Parameters<typeof advanceActionState>[2],
    ) => {
      const r = advanceActionState(rec, target, ctx);
      if (r.ok) {
        const t = r.record.stateHistory[r.record.stateHistory.length - 1]!;
        const event = emitAuditEvent(r.record, t, "user-1", "tenant-1");
        await auditSink.append(event);
        rec = r.record;
      }
      return r;
    };

    await advanceAndAudit("authorized", { at: "t1", authorization: allowDecision(), tenantId: "tenant-1" });
    await advanceAndAudit("confirmed", { at: "t2", confirmedBy: "user-1", tenantId: "tenant-1" });

    // Dispatch with idempotency
    const ack = await dispatchWithIdempotency(idemLedger, "tenant-1|cap.test|n1", async () => ({
      receipt: "receipt-1",
      at: "t3",
    }));
    expect(ack.duplicate).toBe(false);

    await advanceAndAudit("dispatched", { at: "t3", dispatchReceipt: ack.dispatchReceipt, tenantId: "tenant-1" });
    await advanceAndAudit("executing", { at: "t4", tenantId: "tenant-1" });
    await advanceAndAudit("executed", {
      at: "t5",
      executionResult: { succeeded: true, outputs: {}, executedAt: "t5" },
      tenantId: "tenant-1",
    });
    await advanceAndAudit("verified", {
      at: "t6",
      verificationRecord: { verified: true, verifierKind: "device.ack", verifiedAt: "t6", proofRef: "p1" },
      tenantId: "tenant-1",
    });
    await advanceAndAudit("recorded", { at: "t7", evidenceRef: "ev1", tenantId: "tenant-1" });
    await advanceAndAudit("learned", { at: "t8", learningRef: "lr1", tenantId: "tenant-1" });

    expect(rec.state).toBe("learned");

    // Verify audit trail
    const events = await auditSink.list("intent-1");
    const verification = verifyAuditTrail(rec, events);
    expect(verification.verified).toBe(true);
    expect(verification.missingTransitions).toBe(0);

    // Verify idempotency
    const dupAck = await dispatchWithIdempotency(idemLedger, "tenant-1|cap.test|n1", async () => ({
      receipt: "SHOULD-NOT-APPEAR",
      at: "t9",
    }));
    expect(dupAck.duplicate).toBe(true);
    expect(dupAck.dispatchReceipt).toBe("receipt-1");
  });
});
