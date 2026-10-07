/**
 * guardian-views tests (F240B) — rule catalog, capability-ceiling views
 * (ceilings are NOT authorizations — structural), action-plan board with
 * dead-letter visibility, tenant fail-closed, determinism.
 */
import { describe, it, expect } from "vitest";
import {
  buildActionPlanBoard,
  buildCapabilityCeilingBoard,
  buildRuleCatalog,
} from "../src/guardian-views.ts";
import type { CapabilityCeilingEntryView } from "../src/guardian-views.ts";
import type {
  ActionPlan,
  PlanLifecycleRecord,
  PlannedStep,
} from "@fleetos/actions";
import type {
  CommandQueueState,
  QueuedCommand,
} from "@fleetos/execution";
import type {
  Capability,
  GrantRecord,
  GuardianDecision,
  Policy,
  PolicyRule,
} from "@fleetos/policy";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function capability(over: Partial<Capability> = {}): Capability {
  return {
    id: "cap.device.reboot",
    category: "execute.device",
    risk: "high",
    requiredAuthority: ["asset.owner", "tenant.engineer"],
    tenantScope: "single",
    resourceScope: { assetIds: ["a-1"] },
    sideEffects: [{ kind: "device.command", target: "a-1", reversible: false, description: "reboot" }],
    idempotency: { supported: true, keyShape: ["tenantId", "capabilityId"] },
    verification: { kind: "device.ack" },
    inputs: [],
    outputs: [],
    description: "reboot a device",
    version: "1.2.0",
    ...over,
  };
}

function rule(over: Partial<PolicyRule> = {}): PolicyRule {
  return {
    id: "rule.require_asset_owner_for_device",
    description: "device capabilities require the asset owner",
    riskFloor: "low",
    riskCeiling: "high",
    requiredAuthority: ["asset.owner"],
    tenantScope: "single",
    verdict: "REQUIRE_APPROVAL",
    priority: 40,
    ...over,
  };
}

function policy(rules: readonly PolicyRule[], tenantId = "t1"): Policy {
  return {
    id: "pol-1",
    version: "3.0.0",
    tenantId,
    rules,
    defaultVerdict: "BLOCK",
    failClosed: true,
  };
}

function grant(over: Partial<GrantRecord> = {}): GrantRecord {
  return {
    grantId: "g-1",
    tenantId: "t1",
    capabilityId: "cap.device.reboot",
    granteeActorId: "actor-7",
    grantedByActorId: "guardian",
    grantedAt: 100,
    expiresAt: null,
    parentGrantId: null,
    status: "active",
    revokedAt: null,
    revokedBy: null,
    revocationReason: null,
    ...over,
  };
}

function step(over: Partial<PlannedStep> = {}): PlannedStep {
  return {
    stepId: "s-1",
    capability: capability(),
    inputs: { assetId: "a-1" },
    idempotencyNonce: "n1",
    ...over,
  };
}

function plan(steps: readonly PlannedStep[]): ActionPlan {
  return { planId: "plan-1", tenant: { tenantId: "t1" }, steps };
}

function lifecycle(over: Partial<PlanLifecycleRecord> = {}): PlanLifecycleRecord {
  return {
    planId: "plan-1",
    tenantId: "t1",
    state: "authorized",
    stepCount: 2,
    authorizedStepCount: 2,
    dispatchRef: null,
    completionRef: null,
    failureReason: null,
    transitions: [],
    lastTransitionAt: 500,
    ...over,
  };
}

function queued(over: Partial<QueuedCommand> = {}): QueuedCommand {
  return {
    idempotencyKey: "plan-1|s-1|n1",
    tenantId: "t1",
    capabilityId: "cap.device.reboot",
    payloadInputs: {},
    authorizationDigest: "digest-1",
    verdict: "ALLOW",
    status: "completed",
    attempts: 1,
    submittedAt: 600,
    nextAttemptAt: 600,
    lastFailureReason: null,
    completedOutputs: {},
    completedAt: 900,
    deadLetteredAt: null,
    submissionSeq: 1,
    ...over,
  };
}

function queue(commands: readonly QueuedCommand[], tenantId = "t1"): CommandQueueState {
  return {
    tenantId,
    retryPolicy: { maxAttempts: 3, baseBackoffMs: 1000, maxBackoffMs: 30000 },
    nextSeq: commands.length + 1,
    commands,
  };
}

// ---------------------------------------------------------------------------
// Rule catalog
// ---------------------------------------------------------------------------

describe("rule catalog", () => {
  it("orders entries by priority desc then ruleId asc and summarizes applicability", () => {
    const r = buildRuleCatalog({
      tenantId: "t1",
      policy: policy([
        rule({ id: "rule.allow_low_risk_read", verdict: "ALLOW", priority: 10, riskFloor: "none", riskCeiling: "low", requiredAuthority: [] }),
        rule({ id: "rule.block_cross_tenant", verdict: "BLOCK", priority: 90 }),
        rule({ id: "rule.block_unknown_capability", verdict: "BLOCK", priority: 90 }),
      ]),
    });
    if (!r.ok) throw new Error("expected ok");
    expect(r.view.entries.map((e) => e.ruleId)).toEqual([
      "rule.block_cross_tenant",
      "rule.block_unknown_capability",
      "rule.allow_low_risk_read",
    ]);
    expect(r.view.entries[2]?.applicability).toBe(
      "risks none..low, tenant-scope single, authority none",
    );
    expect(r.view.entries[0]?.applicability).toBe(
      "risks low..high, tenant-scope single, authority asset.owner",
    );
  });

  it("maps verdicts to flavors and counts them", () => {
    const r = buildRuleCatalog({
      tenantId: "t1",
      policy: policy([
        rule({ verdict: "ALLOW" }),
        rule({ id: "rule.deny_degraded_context", verdict: "WARN" }),
      ]),
    });
    if (!r.ok) throw new Error("expected ok");
    expect(r.view.counts).toEqual({ allow: 1, deny: 0, escalate: 0, "soft-allow": 1 });
  });

  it("refuses an empty tenant and a cross-tenant policy", () => {
    expect(buildRuleCatalog({ tenantId: "", policy: policy([]) })).toMatchObject({
      ok: false,
      refused: "views.missing-tenant",
    });
    const cross = buildRuleCatalog({ tenantId: "t1", policy: policy([rule()], "t2") });
    expect(cross.ok).toBe(false);
    if (cross.ok) return;
    expect(cross.refused).toBe("views.cross-tenant-policy");
    expect(cross.detail).toContain("t2");
  });

  it("is deterministic — same policy => identical catalog digest", () => {
    const p = policy([rule(), rule({ id: "rule.block_cross_tenant", verdict: "BLOCK", priority: 99 })]);
    const a = buildRuleCatalog({ tenantId: "t1", policy: p });
    const b = buildRuleCatalog({ tenantId: "t1", policy: p });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

// ---------------------------------------------------------------------------
// Capability ceilings — structurally NOT authorizations
// ---------------------------------------------------------------------------

describe("capability ceilings", () => {
  it("covers required authority the actor holds and reports the missing kinds", () => {
    const r = buildCapabilityCeilingBoard({
      tenantId: "t1",
      capabilities: [capability()],
      grants: [grant()],
      actorAuthority: ["asset.owner"],
      nowMs: 1000,
    });
    if (!r.ok) throw new Error("expected ok");
    const e = r.view.entries[0]!;
    expect(e.coveredAuthority).toEqual(["asset.owner"]);
    expect(e.missingAuthority).toEqual(["tenant.engineer"]);
    expect(e.ceilingSatisfied).toBe(false);
    expect(e.activeGrantCount).toBe(1);
  });

  it("satisfies the ceiling when every required authority is held", () => {
    const r = buildCapabilityCeilingBoard({
      tenantId: "t1",
      capabilities: [capability()],
      grants: [grant()],
      actorAuthority: ["asset.owner", "tenant.engineer", "human.approval"],
      nowMs: 1000,
    });
    if (!r.ok) throw new Error("expected ok");
    const e = r.view.entries[0]!;
    expect(e.ceilingSatisfied).toBe(true);
    expect(e.missingAuthority).toEqual([]);
    expect(r.view.satisfiedCount).toBe(1);
  });

  it("counts only active, unexpired grants for the capability", () => {
    const r = buildCapabilityCeilingBoard({
      tenantId: "t1",
      capabilities: [capability()],
      grants: [
        grant({ grantId: "g-active" }),
        grant({ grantId: "g-revoked", status: "revoked", revokedAt: 50 }),
        grant({ grantId: "g-expired", expiresAt: 500 }),
        grant({ grantId: "g-other-cap", capabilityId: "cap.other" }),
      ],
      actorAuthority: ["asset.owner", "tenant.engineer"],
      nowMs: 1000,
    });
    if (!r.ok) throw new Error("expected ok");
    expect(r.view.entries[0]?.activeGrantCount).toBe(1);
  });

  it("carries the machine-carried NOT-an-authorization marker on every entry", () => {
    const r = buildCapabilityCeilingBoard({
      tenantId: "t1",
      capabilities: [capability()],
      grants: [],
      actorAuthority: [],
      nowMs: 0,
    });
    if (!r.ok) throw new Error("expected ok");
    for (const e of r.view.entries) {
      expect(e.ceilingSatisfiedIsNotAuthorization).toBe(true);
      expect("authorized" in e).toBe(false);
      expect("verdict" in e).toBe(false);
    }
  });

  it("STRUCTURAL LAW (A5): a ceiling view is NOT a GuardianDecision — compile-pinned", () => {
    const entry: CapabilityCeilingEntryView = {
      capabilityId: "cap.device.reboot",
      version: "1.2.0",
      risk: "high",
      requiredAuthority: ["asset.owner"],
      activeGrantCount: 3,
      coveredAuthority: ["asset.owner"],
      missingAuthority: [],
      ceilingSatisfied: true,
      ceilingSatisfiedIsNotAuthorization: true,
    };
    // A satisfied ceiling is NOT an authorization (AGENTS.md law). This
    // assignment must remain a compile error — pinned with @ts-expect-error.
    // @ts-expect-error — no verdict / reasonCode / decisionDigest on a ceiling
    const notAnAuthorization: GuardianDecision = entry;
    expect(notAnAuthorization).toBeDefined();
  });

  it("refuses an empty tenant and cross-tenant grants, offender named", () => {
    expect(
      buildCapabilityCeilingBoard({ tenantId: "", capabilities: [], grants: [], actorAuthority: [], nowMs: 0 }),
    ).toMatchObject({ ok: false, refused: "views.missing-tenant" });
    const cross = buildCapabilityCeilingBoard({
      tenantId: "t1",
      capabilities: [],
      grants: [grant({ grantId: "g-evil", tenantId: "t2" })],
      actorAuthority: [],
      nowMs: 0,
    });
    expect(cross.ok).toBe(false);
    if (cross.ok) return;
    expect(cross.refused).toBe("views.cross-tenant-grant");
    expect(cross.detail).toContain("g-evil");
  });

  it("orders entries by capabilityId asc and is deterministic", () => {
    const caps = [capability({ id: "cap.b" }), capability({ id: "cap.a" })];
    const input = {
      tenantId: "t1",
      capabilities: caps,
      grants: [grant()],
      actorAuthority: ["asset.owner", "tenant.engineer"] as const,
      nowMs: 1000,
    };
    const a = buildCapabilityCeilingBoard(input);
    const b = buildCapabilityCeilingBoard({
      ...input,
      capabilities: [...caps].reverse(),
    });
    if (!a.ok || !b.ok) throw new Error("expected ok");
    expect(a.view.entries.map((e) => e.capabilityId)).toEqual(["cap.a", "cap.b"]);
    expect(a.view.digest).toBe(b.view.digest);
  });
});

// ---------------------------------------------------------------------------
// Action-plan board + dead-letter visibility
// ---------------------------------------------------------------------------

describe("action-plan board", () => {
  const steps2 = [step(), step({ stepId: "s-2", idempotencyNonce: "n2" })];

  it("joins steps to queue commands by the domain idempotency key", () => {
    const r = buildActionPlanBoard({
      tenantId: "t1",
      plan: plan(steps2),
      lifecycle: lifecycle(),
      queue: queue([
        queued(),
        queued({
          idempotencyKey: "plan-1|s-2|n2",
          status: "dead-lettered",
          attempts: 3,
          lastFailureReason: "max-attempts-exceeded",
          completedAt: null,
          deadLetteredAt: 4000,
          submissionSeq: 2,
        }),
      ]),
    });
    if (!r.ok) throw new Error("expected ok");
    expect(r.view.planState).toBe("authorized");
    expect(r.view.authorizedStepCount).toBe(2);
    expect(r.view.steps.map((s) => s.stepId)).toEqual(["s-1", "s-2"]);
    expect(r.view.steps[0]?.queueStatus).toBe("completed");
    expect(r.view.steps[0]?.idempotencyKey).toBe("plan-1|s-1|n1");
    expect(r.view.deadLetterCount).toBe(1);
    const dead = r.view.steps[1]!;
    expect(dead.deadLettered).toBe(true);
    expect(dead.deadLetteredAt).toBe(4000);
    expect(dead.lastFailureReason).toBe("max-attempts-exceeded");
    expect(dead.attempts).toBe(3);
  });

  it("presents unsubmitted steps as not-submitted", () => {
    const r = buildActionPlanBoard({
      tenantId: "t1",
      plan: plan(steps2),
      lifecycle: lifecycle({ state: "draft", authorizedStepCount: 0 }),
      queue: queue([]),
    });
    if (!r.ok) throw new Error("expected ok");
    expect(r.view.steps.every((s) => s.queueStatus === "not-submitted")).toBe(true);
    expect(r.view.steps.every((s) => s.deadLettered === false)).toBe(true);
  });

  it("refuses a queue command that does not belong to the plan (fail-closed, no partial state)", () => {
    const r = buildActionPlanBoard({
      tenantId: "t1",
      plan: plan(steps2),
      lifecycle: lifecycle(),
      queue: queue([queued({ idempotencyKey: "other-plan|s-9|n9" })]),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refused).toBe("views.queue-command-foreign");
    expect(r.detail).toContain("other-plan|s-9|n9");
  });

  it("refuses duplicate queue idempotency keys", () => {
    const r = buildActionPlanBoard({
      tenantId: "t1",
      plan: plan([step()]),
      lifecycle: lifecycle({ stepCount: 1, authorizedStepCount: 1 }),
      queue: queue([queued(), queued()]),
    });
    expect(r).toMatchObject({ ok: false, refused: "views.duplicate-queue-key" });
  });

  it("refuses lifecycle/plan mismatches (id and step count)", () => {
    const badId = buildActionPlanBoard({
      tenantId: "t1",
      plan: plan(steps2),
      lifecycle: lifecycle({ planId: "plan-OTHER" }),
      queue: queue([]),
    });
    expect(badId).toMatchObject({ ok: false, refused: "views.plan-lifecycle-mismatch" });
    const badCount = buildActionPlanBoard({
      tenantId: "t1",
      plan: plan(steps2),
      lifecycle: lifecycle({ stepCount: 5 }),
      queue: queue([]),
    });
    expect(badCount).toMatchObject({ ok: false, refused: "views.plan-step-count-mismatch" });
  });

  it("refuses empty tenant and every cross-tenant input, offender named", () => {
    expect(
      buildActionPlanBoard({ tenantId: "", plan: plan(steps2), lifecycle: lifecycle(), queue: queue([]) }),
    ).toMatchObject({ ok: false, refused: "views.missing-tenant" });
    const crossPlan = buildActionPlanBoard({
      tenantId: "t1",
      plan: { planId: "plan-1", tenant: { tenantId: "t2" }, steps: steps2 },
      lifecycle: lifecycle(),
      queue: queue([]),
    });
    expect(crossPlan.ok).toBe(false);
    if (crossPlan.ok) return;
    expect(crossPlan.refused).toBe("views.cross-tenant-plan");
    expect(crossPlan.detail).toContain("t2");
    const crossLifecycle = buildActionPlanBoard({
      tenantId: "t1",
      plan: plan(steps2),
      lifecycle: lifecycle({ tenantId: "t2" }),
      queue: queue([]),
    });
    expect(crossLifecycle).toMatchObject({ ok: false, refused: "views.cross-tenant-lifecycle" });
    const crossQueue = buildActionPlanBoard({
      tenantId: "t1",
      plan: plan(steps2),
      lifecycle: lifecycle(),
      queue: queue([queued({ tenantId: "t2" })], "t2"),
    });
    expect(crossQueue.ok).toBe(false);
    if (crossQueue.ok) return;
    expect(crossQueue.refused).toBe("views.cross-tenant-queue");
    expect(crossQueue.detail).toContain("t2");
  });

  it("is deterministic — same inputs => identical board digest", () => {
    const input = {
      tenantId: "t1",
      plan: plan(steps2),
      lifecycle: lifecycle(),
      queue: queue([queued()]),
    };
    const a = buildActionPlanBoard(input);
    const b = buildActionPlanBoard(input);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
