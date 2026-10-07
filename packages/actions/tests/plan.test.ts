/**
 * Action-plan composition tests (F220B, Wave 2).
 *
 * Behavior under test: plan validation refusals, Guardian-gated emission
 * (BLOCK/WARN refusal, per-action idempotency keys, all-or-nothing
 * emission), plan lifecycle legal-transition enforcement with evidence gates
 * and tenant fail-closed.
 */
import { describe, it, expect } from "vitest";
import {
  validatePlan,
  emitPlanCommands,
  stepIdempotencyKey,
  initPlanLifecycle,
  advancePlanLifecycle,
  legalPlanTransitions,
} from "../src/index.ts";
import type { ActionPlan, PlannedStep, PlanLifecycleRecord, StepDecision } from "../src/index.ts";
import type { Capability, GuardianDecision } from "@fleetos/policy";

function cap(id: string): Capability {
  return {
    id,
    category: "execute.device",
    risk: "medium",
    requiredAuthority: ["asset.owner"],
    tenantScope: "single",
    resourceScope: { assetIds: ["a-1"] },
    sideEffects: [{ kind: "device.command", target: "a-1", reversible: false, description: "noop" }],
    idempotency: { supported: true, keyShape: ["tenantId", "capabilityId"] },
    verification: { kind: "device.ack" },
    inputs: [],
    outputs: [],
    description: "reference capability",
    version: "1.0.0",
  };
}

function decision(overrides: Partial<GuardianDecision> = {}): GuardianDecision {
  return {
    verdict: "ALLOW",
    reasonCode: "allow.matched_rule",
    matchedRuleId: "rule.allow_low_risk_read",
    tenantId: "t1",
    capabilityId: "cap.restart",
    conditions: [],
    decisionDigest: "digest-1",
    ...overrides,
  };
}

function step(stepId: string, capabilityId = "cap.restart", nonce = "n1"): PlannedStep {
  return { stepId, capability: cap(capabilityId), inputs: { assetId: "a-1" }, idempotencyNonce: nonce };
}

function plan(overrides: Partial<ActionPlan> = {}): ActionPlan {
  return {
    planId: "plan-1",
    tenant: { tenantId: "t1" },
    steps: [step("s1"), step("s2", "cap.patch", "n2")],
    ...overrides,
  };
}

function sd(stepId: string, d: GuardianDecision): StepDecision {
  return { stepId, decision: d };
}

// ---------- Plan validation ----------

describe("plan validation", () => {
  it("accepts a well-formed plan", () => {
    expect(validatePlan(plan()).ok).toBe(true);
  });

  it("refuses a missing plan id", () => {
    const r = validatePlan(plan({ planId: "" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("plan.missing-plan-id");
  });

  it("refuses a missing tenant scope (fail-closed, A8)", () => {
    const r = validatePlan(plan({ tenant: { tenantId: "" } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("plan.missing-tenant");
  });

  it("refuses an empty step list", () => {
    const r = validatePlan(plan({ steps: [] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("plan.empty-steps");
  });

  it("refuses a missing step id", () => {
    const r = validatePlan(plan({ steps: [step("")] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("plan.missing-step-id");
  });

  it("refuses duplicate step ids", () => {
    const r = validatePlan(plan({ steps: [step("s1"), step("s1", "cap.other", "n9")] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("plan.duplicate-step-id");
  });

  it("refuses an empty capability id", () => {
    const s = step("s1");
    const r = validatePlan(plan({ steps: [{ ...s, capability: cap("") }] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("plan.empty-capability-id");
  });

  it("refuses a missing idempotency nonce (per-action idempotency contract)", () => {
    const r = validatePlan(plan({ steps: [step("s1", "cap.restart", "")] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("plan.missing-idempotency-nonce");
  });
});

// ---------- Guardian-gated emission ----------

describe("plan command emission", () => {
  it("emits one authorized command per step with per-action idempotency keys", () => {
    const decisions = [
      sd("s1", decision()),
      sd("s2", decision({ capabilityId: "cap.patch", decisionDigest: "digest-2" })),
    ];
    const r = emitPlanCommands(plan(), decisions);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.commands).toHaveLength(2);
    expect(r.commands[0]!.idempotencyKey).toBe("plan-1|s1|n1");
    expect(r.commands[1]!.idempotencyKey).toBe("plan-1|s2|n2");
    expect(r.commands[0]!.capabilityId).toBe("cap.restart");
    expect(r.commands[0]!.authorizationDigest).toBe("digest-1");
    expect(r.commands[0]!.verdict).toBe("ALLOW");
  });

  it("REQUIRE_APPROVAL decisions also emit (they are the authorized-after-approval path)", () => {
    const r = emitPlanCommands(plan(), [sd("s1", decision({ verdict: "REQUIRE_APPROVAL" })), sd("s2", decision({ verdict: "REQUIRE_APPROVAL", capabilityId: "cap.patch" }))]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.commands.every((c) => c.verdict === "REQUIRE_APPROVAL")).toBe(true);
  });

  it("idempotency keys are deterministic and plan-scoped (no cross-plan collision)", () => {
    expect(stepIdempotencyKey("plan-1", "s1", "n1")).toBe(stepIdempotencyKey("plan-1", "s1", "n1"));
    expect(stepIdempotencyKey("plan-1", "s1", "n1")).not.toBe(stepIdempotencyKey("plan-2", "s1", "n1"));
    expect(stepIdempotencyKey("plan-1", "s1", "n1")).not.toBe(stepIdempotencyKey("plan-1", "s2", "n1"));
    expect(stepIdempotencyKey("plan-1", "s1", "n1")).not.toBe(stepIdempotencyKey("plan-1", "s1", "n2"));
  });

  it("refuses a BLOCKed step — plans cannot bypass Guardian (A5)", () => {
    const r = emitPlanCommands(plan(), [
      sd("s1", decision()),
      sd("s2", decision({ verdict: "BLOCK", capabilityId: "cap.patch", reasonCode: "block.cross_tenant" })),
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("emission.step-blocked");
      expect(r.stepId).toBe("s2");
    }
  });

  it("refuses a WARNed step — WARN means human approval is still pending", () => {
    const r = emitPlanCommands(plan(), [sd("s1", decision({ verdict: "WARN" })), sd("s2", decision({ capabilityId: "cap.patch" }))]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("emission.step-warn");
      expect(r.stepId).toBe("s1");
    }
  });

  it("refuses a decision bound to the wrong capability", () => {
    const r = emitPlanCommands(plan(), [sd("s1", decision({ capabilityId: "cap.wrong" })), sd("s2", decision({ capabilityId: "cap.patch" }))]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("emission.step-capability-mismatch");
  });

  it("refuses a decision from another tenant (A8 fail-closed)", () => {
    const r = emitPlanCommands(plan(), [
      sd("s1", decision({ tenantId: "t2" })),
      sd("s2", decision({ capabilityId: "cap.patch" })),
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("emission.step-tenant-mismatch");
  });

  it("refuses when a step has NO decision", () => {
    const r = emitPlanCommands(plan(), [sd("s2", decision({ capabilityId: "cap.patch" }))]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("emission.step-missing-decision");
      expect(r.stepId).toBe("s1");
    }
  });

  it("refuses an invalid plan outright", () => {
    const r = emitPlanCommands(plan({ planId: "" }), []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("emission.plan-invalid");
  });

  it("refuses a decision for a step that does not exist in the plan", () => {
    const r = emitPlanCommands(plan(), [sd("s-nope", decision())]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("emission.unknown-step-decision");
      expect(r.stepId).toBe("s-nope");
    }
  });

  it("refuses duplicate decisions for the same step", () => {
    const r = emitPlanCommands(plan(), [sd("s1", decision()), sd("s1", decision({ decisionDigest: "d2" }))]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("emission.duplicate-step-decision");
  });

  it("emission is all-or-nothing: a refused step emits NOTHING", () => {
    const r = emitPlanCommands(plan(), [
      sd("s1", decision()),
      sd("s2", decision({ verdict: "BLOCK", capabilityId: "cap.patch" })),
    ]);
    expect(r.ok).toBe(false);
    // The refusal branch carries no commands — a plan never partially executes.
    if (!r.ok) expect("commands" in r).toBe(false);
  });

  it("emission is deterministic — same inputs yield byte-identical commands", () => {
    const decisions = [sd("s1", decision()), sd("s2", decision({ capabilityId: "cap.patch", decisionDigest: "d2" }))];
    const a = emitPlanCommands(plan(), decisions);
    const b = emitPlanCommands(plan(), decisions);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

// ---------- Plan lifecycle ----------

describe("plan lifecycle", () => {
  function draft(authorized = 2): PlanLifecycleRecord {
    const r = initPlanLifecycle(plan(), authorized);
    if (!r.ok) throw new Error(String(r.reason));
    return r.record;
  }

  function ctx(overrides: Partial<{ tenantId: string; dispatchRef: string; completionRef: string; failureReason: string; at: number }> = {}) {
    return { tenantId: "t1", actorId: "actor-1", at: 1_000, ...overrides };
  }

  it("the legal transition table settles only via completed/failed/voided", () => {
    expect(legalPlanTransitions("draft")).toEqual(["authorized", "voided"]);
    expect(legalPlanTransitions("authorized")).toEqual(["dispatched", "voided"]);
    expect(legalPlanTransitions("dispatched")).toEqual(["completed", "failed"]);
    expect(legalPlanTransitions("completed")).toEqual([]);
    expect(legalPlanTransitions("failed")).toEqual([]);
    expect(legalPlanTransitions("voided")).toEqual([]);
  });

  it("draft -> authorized requires EVERY step authorized", () => {
    const partial = draft(1); // 1 of 2 steps
    const r = advancePlanLifecycle(partial, "authorized", ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("plan-refused.steps-not-authorized");
  });

  it("draft -> authorized succeeds when all steps are authorized", () => {
    const r = advancePlanLifecycle(draft(2), "authorized", ctx());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.record.state).toBe("authorized");
      expect(r.record.transitions).toHaveLength(1);
      expect(r.record.transitions[0]!.reason).toBe("all-steps-authorized");
    }
  });

  it("authorized -> dispatched requires a dispatch ref", () => {
    const authorized = advancePlanLifecycle(draft(2), "authorized", ctx()).record;
    const r = advancePlanLifecycle(authorized, "dispatched", ctx({}));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("plan-refused.missing-dispatch-ref");
  });

  it("dispatched -> completed requires completion evidence (evidence-gated settlement)", () => {
    const dispatched = advancePlanLifecycle(
      advancePlanLifecycle(draft(2), "authorized", ctx()).record,
      "dispatched",
      ctx({ dispatchRef: "disp-1" }),
    ).record;
    const r = advancePlanLifecycle(dispatched, "completed", ctx({}));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("plan-refused.missing-settlement");
  });

  it("dispatched -> completed carries the completion ref", () => {
    const dispatched = advancePlanLifecycle(
      advancePlanLifecycle(draft(2), "authorized", ctx()).record,
      "dispatched",
      ctx({ dispatchRef: "disp-1" }),
    ).record;
    const r = advancePlanLifecycle(dispatched, "completed", ctx({ completionRef: "ev-42" }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.record.completionRef).toBe("ev-42");
  });

  it("dispatched -> failed requires an honest failure reason", () => {
    const dispatched = advancePlanLifecycle(
      advancePlanLifecycle(draft(2), "authorized", ctx()).record,
      "dispatched",
      ctx({ dispatchRef: "disp-1" }),
    ).record;
    const refused = advancePlanLifecycle(dispatched, "failed", ctx({}));
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reason).toBe("plan-refused.missing-settlement");
    const r = advancePlanLifecycle(dispatched, "failed", ctx({ failureReason: "transport timeout" }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.record.failureReason).toBe("transport timeout");
  });

  it("refuses skipping draft -> dispatched (illegal even with a dispatch ref)", () => {
    const r = advancePlanLifecycle(draft(2), "dispatched", ctx({ dispatchRef: "disp-1" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("plan-refused.illegal-transition");
  });

  it("refuses settling a plan that was never dispatched", () => {
    const authorized = advancePlanLifecycle(draft(2), "authorized", ctx()).record;
    for (const target of ["completed", "failed"] as const) {
      const r = advancePlanLifecycle(authorized, target, ctx({ completionRef: "ev", failureReason: "f" }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("plan-refused.illegal-transition");
    }
  });

  it("void is allowed from draft and authorized, NEVER after dispatch", () => {
    const voidedFromDraft = advancePlanLifecycle(draft(2), "voided", ctx());
    expect(voidedFromDraft.ok).toBe(true);
    const authorized = advancePlanLifecycle(draft(2), "authorized", ctx()).record;
    expect(advancePlanLifecycle(authorized, "voided", ctx()).ok).toBe(true);
    const dispatched = advancePlanLifecycle(authorized, "dispatched", ctx({ dispatchRef: "d" })).record;
    const r = advancePlanLifecycle(dispatched, "voided", ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("plan-refused.illegal-transition");
  });

  it("terminal states refuse every further transition", () => {
    const completed = advancePlanLifecycle(
      advancePlanLifecycle(
        advancePlanLifecycle(draft(2), "authorized", ctx()).record,
        "dispatched",
        ctx({ dispatchRef: "d" }),
      ).record,
      "completed",
      ctx({ completionRef: "ev" }),
    ).record;
    for (const target of ["draft", "authorized", "dispatched", "completed", "failed", "voided"] as const) {
      const r = advancePlanLifecycle(completed, target, ctx({}));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("plan-refused.illegal-transition");
    }
  });

  it("refuses advancing under a missing or different tenant scope (A8)", () => {
    const r1 = advancePlanLifecycle(draft(2), "authorized", ctx({ tenantId: "" }));
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.reason).toBe("plan-refused.missing-tenant");
    const r2 = advancePlanLifecycle(draft(2), "authorized", ctx({ tenantId: "t2" }));
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toBe("plan-refused.tenant-mismatch");
  });

  it("refuses an invalid at (time is an explicit integer input)", () => {
    const r = advancePlanLifecycle(draft(2), "authorized", ctx({ at: -1 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("plan-refused.invalid-at");
  });

  it("initPlanLifecycle refuses an out-of-range authorized count and invalid plans", () => {
    expect(initPlanLifecycle(plan(), 3).ok).toBe(false);
    expect(initPlanLifecycle(plan(), -1).ok).toBe(false);
    expect(initPlanLifecycle(plan(), 1.5).ok).toBe(false);
    expect(initPlanLifecycle(plan({ planId: "" }), 0).ok).toBe(false);
  });

  it("the full happy path appends one transition per step with the evidence refs", () => {
    let rec = draft(2);
    rec = advancePlanLifecycle(rec, "authorized", ctx({ at: 1_000 })).record;
    rec = advancePlanLifecycle(rec, "dispatched", ctx({ dispatchRef: "disp-1", at: 2_000 })).record;
    rec = advancePlanLifecycle(rec, "completed", ctx({ completionRef: "ev-9", at: 3_000 })).record;
    expect(rec.state).toBe("completed");
    expect(rec.dispatchRef).toBe("disp-1");
    expect(rec.completionRef).toBe("ev-9");
    expect(rec.transitions.map((t) => t.to)).toEqual(["authorized", "dispatched", "completed"]);
    expect(rec.lastTransitionAt).toBe(3_000);
  });
});
