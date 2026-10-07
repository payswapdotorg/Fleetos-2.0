/**
 * Policy kernel tests — repository, decision ledger, adoption workflow,
 * precedence resolution, A5 invariant.
 *
 * Wave 1 (F210B) additions.
 */
import { describe, it, expect } from "vitest";
import {
  InMemoryPolicyRepository,
  buildDecisionRecord,
  resolvePrecedence,
  appendDecision,
  verifyDecisionLedger,
  computeLedgerEntryDigest,
  tamperEntry,
  authorizeAdoptionWorkflow,
  hasHumanDelegation,
  hashDelegationChain,
  assertNoSelfExecutionPath,
  fnv1a,
  computeRecordDigest,
} from "../src/index.ts";
import type {
  Policy,
  PolicyRule,
  GuardianDecision,
} from "../src/policy.ts";
import type { Capability, AuthorityKind } from "../src/capability.ts";
import { evaluateCapability } from "../src/guardian.ts";

const tenant = { tenantId: "tenant-1" };

function lowRiskReadCap(): Capability {
  return {
    id: "cap.read.health",
    category: "read",
    risk: "low",
    requiredAuthority: ["tenant.engineer"],
    tenantScope: "single",
    resourceScope: { assetIds: ["asset-1"] },
    sideEffects: [],
    idempotency: { supported: true, keyShape: ["tenantId", "assetId"] },
    verification: { kind: "domain.read" },
    inputs: ["assetId"],
    outputs: ["healthSummary"],
    description: "Read asset health summary",
    version: "1.0.0",
  };
}

function highRiskCap(): Capability {
  return {
    id: "cap.execute.device.restart",
    category: "execute.device",
    risk: "high",
    requiredAuthority: ["asset.owner", "human.approval"],
    tenantScope: "single",
    resourceScope: { assetIds: ["asset-1"] },
    sideEffects: [{ kind: "device.command", target: "asset-1", reversible: false, description: "restart" }],
    idempotency: { supported: true, keyShape: ["tenantId"] },
    verification: { kind: "device.ack", timeoutMs: 30_000 },
    inputs: ["assetId"],
    outputs: ["restartReceipt"],
    description: "Restart a device",
    version: "2.0.0",
  };
}

function makePolicy(rules: readonly PolicyRule[], tenantId = "tenant-1"): Policy {
  return { id: "pol-1", version: "1.0.0", tenantId, rules, defaultVerdict: "BLOCK", failClosed: true };
}

function allowRule(priority = 10): PolicyRule {
  return {
    id: "rule.allow_low_risk_read",
    description: "allow low-risk reads",
    riskFloor: "none",
    riskCeiling: "low",
    requiredAuthority: ["tenant.engineer"],
    tenantScope: "single",
    verdict: "ALLOW" as const,
    priority,
  };
}

function blockRule(priority = 20): PolicyRule {
  return {
    id: "rule.block_irreversible_without_operator",
    description: "block irreversible without operator",
    riskFloor: "irreversible",
    riskCeiling: "irreversible",
    requiredAuthority: [],
    tenantScope: "single",
    verdict: "BLOCK" as const,
    priority,
  };
}
void blockRule; // retained for potential future use

function makeDecision(verdict: "ALLOW" | "BLOCK" | "REQUIRE_APPROVAL" | "WARN" = "ALLOW"): GuardianDecision {
  return {
    verdict,
    reasonCode: "allow.matched_rule",
    matchedRuleId: "rule.allow_low_risk_read",
    tenantId: "tenant-1",
    capabilityId: "cap.read.health",
    conditions: [],
    decisionDigest: "abc123",
  };
}

// ---------- Repository ----------

describe("InMemoryPolicyRepository", () => {
  it("saves and loads a policy by tenant+id", async () => {
    const repo = new InMemoryPolicyRepository();
    const policy = makePolicy([allowRule()]);
    await repo.save(policy);
    const loaded = await repo.load("pol-1", "tenant-1");
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe("pol-1");
    expect(loaded!.tenantId).toBe("tenant-1");
  });

  it("returns null for cross-tenant load (fail-closed, law A8)", async () => {
    const repo = new InMemoryPolicyRepository();
    await repo.save(makePolicy([allowRule()]));
    const loaded = await repo.load("pol-1", "tenant-OTHER");
    expect(loaded).toBeNull();
  });

  it("lists policies scoped by tenant", async () => {
    const repo = new InMemoryPolicyRepository();
    await repo.save(makePolicy([allowRule()], "tenant-1"));
    await repo.save({ ...makePolicy([allowRule()], "tenant-2"), id: "pol-2" });
    const list1 = await repo.list("tenant-1");
    const list2 = await repo.list("tenant-2");
    expect(list1).toHaveLength(1);
    expect(list2).toHaveLength(1);
    expect(list1[0]!.tenantId).toBe("tenant-1");
  });

  it("deletes a policy and returns true", async () => {
    const repo = new InMemoryPolicyRepository();
    await repo.save(makePolicy([allowRule()]));
    expect(await repo.delete("pol-1", "tenant-1")).toBe(true);
    expect(await repo.load("pol-1", "tenant-1")).toBeNull();
  });

  it("returns false for cross-tenant delete", async () => {
    const repo = new InMemoryPolicyRepository();
    await repo.save(makePolicy([allowRule()]));
    expect(await repo.delete("pol-1", "tenant-OTHER")).toBe(false);
  });
});

// ---------- Decision Record ----------

describe("DecisionRecord", () => {
  it("builds a record with full justification chain", () => {
    const cap = lowRiskReadCap();
    const decision = makeDecision("ALLOW");
    const record = buildDecisionRecord(decision, {
      policyId: "pol-1",
      policyVersion: "1.0.0",
      capability: cap,
      actorId: "user-1",
      actorIsAutonomous: false,
      actorAuthority: ["tenant.engineer"],
      evaluatedAt: "2026-01-01T00:00:00.000Z",
      matchedFacts: [{ fact: "rule.matched", value: "rule.allow_low_risk_read" }],
    });
    expect(record.recordId).toContain("rec-");
    expect(record.policyId).toBe("pol-1");
    expect(record.capabilityId).toBe("cap.read.health");
    expect(record.capabilityVersion).toBe("1.0.0");
    expect(record.matchedFacts).toHaveLength(1);
    expect(record.recordDigest).toHaveLength(8);
  });

  it("produces identical digests for identical inputs (deterministic)", () => {
    const cap = lowRiskReadCap();
    const decision = makeDecision("ALLOW");
    const ctx = {
      policyId: "pol-1",
      policyVersion: "1.0.0",
      capability: cap,
      actorId: "user-1",
      actorIsAutonomous: false,
      actorAuthority: ["tenant.engineer"] as readonly string[],
      evaluatedAt: "2026-01-01T00:00:00.000Z",
      matchedFacts: [] as readonly { fact: string; value: string }[],
    };
    const d1 = computeRecordDigest(decision, ctx);
    const d2 = computeRecordDigest(decision, ctx);
    expect(d1).toBe(d2);
  });

  it("produces different digests when actor authority differs", () => {
    const cap = lowRiskReadCap();
    const decision = makeDecision("ALLOW");
    const base = {
      policyId: "pol-1",
      policyVersion: "1.0.0",
      capability: cap,
      actorId: "user-1",
      actorIsAutonomous: false,
      evaluatedAt: "2026-01-01T00:00:00.000Z",
    };
    const d1 = computeRecordDigest(decision, { ...base, actorAuthority: ["tenant.engineer"] });
    const d2 = computeRecordDigest(decision, { ...base, actorAuthority: ["tenant.admin"] });
    expect(d1).not.toBe(d2);
  });
});

// ---------- Precedence Resolution ----------

describe("resolvePrecedence", () => {
  it("deny-overrides-allow: BLOCK wins over ALLOW", () => {
    const result = resolvePrecedence([
      { ruleId: "rule.allow", verdict: "ALLOW" as const, priority: 10 },
      { ruleId: "rule.block", verdict: "BLOCK" as const, priority: 5 },
    ]);
    expect(result.verdict).toBe("BLOCK");
    expect(result.winningRuleId).toBe("rule.block");
    expect(result.mode).toBe("deny_overrides_allow");
  });

  it("REQUIRE_APPROVAL wins over ALLOW", () => {
    const result = resolvePrecedence([
      { ruleId: "rule.allow", verdict: "ALLOW" as const, priority: 10 },
      { ruleId: "rule.require", verdict: "REQUIRE_APPROVAL" as const, priority: 5 },
    ]);
    expect(result.verdict).toBe("REQUIRE_APPROVAL");
  });

  it("explicit_override wins over deny rules", () => {
    const result = resolvePrecedence([
      { ruleId: "rule.allow", verdict: "ALLOW" as const, priority: 10 },
      { ruleId: "rule.block", verdict: "BLOCK" as const, priority: 20 },
      { ruleId: "rule.override", verdict: "ALLOW" as const, priority: 30, explicitOverride: true },
    ]);
    expect(result.verdict).toBe("ALLOW");
    expect(result.winningRuleId).toBe("rule.override");
    expect(result.mode).toBe("explicit_override");
  });

  it("highest priority explicit override wins among multiple overrides", () => {
    const result = resolvePrecedence([
      { ruleId: "rule.ov1", verdict: "ALLOW" as const, priority: 10, explicitOverride: true },
      { ruleId: "rule.ov2", verdict: "BLOCK" as const, priority: 30, explicitOverride: true },
    ]);
    expect(result.verdict).toBe("BLOCK");
    expect(result.winningRuleId).toBe("rule.ov2");
  });

  it("unanimous verdicts return the single verdict", () => {
    const result = resolvePrecedence([
      { ruleId: "rule.a", verdict: "ALLOW" as const, priority: 10 },
      { ruleId: "rule.b", verdict: "ALLOW" as const, priority: 5 },
    ]);
    expect(result.verdict).toBe("ALLOW");
    expect(result.conflictingVerdicts).toEqual(["ALLOW", "ALLOW"]);
  });

  it("empty matched verdicts fail-closed to BLOCK", () => {
    const result = resolvePrecedence([]);
    expect(result.verdict).toBe("BLOCK");
    expect(result.winningRuleId).toBeNull();
  });

  it("is deterministic — same inputs always produce same output", () => {
    const input = [
      { ruleId: "rule.allow", verdict: "ALLOW" as const, priority: 10 },
      { ruleId: "rule.block", verdict: "BLOCK" as const, priority: 5 },
    ];
    const r1 = resolvePrecedence(input);
    const r2 = resolvePrecedence(input);
    expect(r1).toEqual(r2);
  });
});

// ---------- Decision Ledger ----------

describe("Decision Ledger", () => {
  function makeRecord(actorId = "user-1", index = 0): ReturnType<typeof buildDecisionRecord> {
    const cap = lowRiskReadCap();
    const decision: GuardianDecision = {
      verdict: "ALLOW" as const,
      reasonCode: "allow.matched_rule",
      matchedRuleId: "rule.allow_low_risk_read",
      tenantId: "tenant-1",
      capabilityId: cap.id,
      conditions: [],
      decisionDigest: `digest-${index}`,
    };
    return buildDecisionRecord(decision, {
      policyId: "pol-1",
      policyVersion: "1.0.0",
      capability: cap,
      actorId,
      actorIsAutonomous: false,
      actorAuthority: ["tenant.engineer"],
      evaluatedAt: "2026-01-01T00:00:00.000Z",
      matchedFacts: [],
    });
  }

  it("appends first entry with previousDigest=null", () => {
    const ledger = appendDecision([], makeRecord("user-1", 0));
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.index).toBe(0);
    expect(ledger[0]!.previousDigest).toBeNull();
    expect(ledger[0]!.entryDigest).toHaveLength(64);
  });

  it("appends second entry linked to first", () => {
    const r0 = makeRecord("user-1", 0);
    const r1 = makeRecord("user-2", 1);
    const ledger = appendDecision(appendDecision([], r0), r1);
    expect(ledger).toHaveLength(2);
    expect(ledger[1]!.previousDigest).toBe(ledger[0]!.entryDigest);
    expect(ledger[1]!.index).toBe(1);
  });

  it("throws on cross-tenant append (law A8)", () => {
    const r0 = makeRecord("user-1", 0);
    const ledger = appendDecision([], r0);
    const r1: ReturnType<typeof makeRecord> = { ...makeRecord("user-2", 1), tenantId: "tenant-OTHER" };
    expect(() => appendDecision(ledger, r1)).toThrow(/tenant mismatch/);
  });

  it("verifies a well-formed ledger", () => {
    const l1 = appendDecision([], makeRecord("u1", 0));
    const l2 = appendDecision(l1, makeRecord("u2", 1));
    const l3 = appendDecision(l2, makeRecord("u3", 2));
    const result = verifyDecisionLedger(l3);
    expect(result.verified).toBe(true);
    expect(result.checkedEntries).toBe(3);
    expect(result.brokenAt).toBeNull();
  });

  it("detects tampered entry digest (law A19)", () => {
    const l1 = appendDecision([], makeRecord("u1", 0));
    const l2 = appendDecision(l1, makeRecord("u2", 1));
    const tampered = tamperEntry(l2, 1, "deadbeef".repeat(8));
    const result = verifyDecisionLedger(tampered);
    expect(result.verified).toBe(false);
    expect(result.brokenAt).toBe(1);
    expect(result.reason).toBe("ledger.entry_digest_mismatch");
  });

  it("detects index gap", () => {
    const l1 = appendDecision([], makeRecord("u1", 0));
    const l2 = appendDecision(l1, makeRecord("u2", 1));
    const broken = l2.map((e, i) => (i === 1 ? { ...e, index: 5 } : e));
    const result = verifyDecisionLedger(broken);
    expect(result.verified).toBe(false);
    expect(result.reason).toBe("ledger.index_gap");
  });

  it("detects first entry with non-null previousDigest", () => {
    const ledger = appendDecision([], makeRecord("u1", 0));
    const broken = [{ ...ledger[0]!, previousDigest: "not-null" }];
    const result = verifyDecisionLedger(broken);
    expect(result.verified).toBe(false);
    expect(result.reason).toBe("ledger.first_entry_has_previous");
  });

  it("empty ledger verifies as true with 0 checked", () => {
    const result = verifyDecisionLedger([]);
    expect(result.verified).toBe(true);
    expect(result.checkedEntries).toBe(0);
    expect(result.reason).toBe("ledger.empty");
  });

  it("computeLedgerEntryDigest is deterministic", () => {
    const d1 = computeLedgerEntryDigest(null, "rec-1", "t1", "dig1", 0);
    const d2 = computeLedgerEntryDigest(null, "rec-1", "t1", "dig1", 0);
    expect(d1).toBe(d2);
    expect(d1).toHaveLength(64);
  });
});

// ---------- Adoption Workflow (A5 invariant) ----------

describe("authorizeAdoptionWorkflow — A5 no-self-authorization invariant", () => {
  function request(overrides: Partial<{
    requesterKind: "human" | "agent" | "workflow" | "model";
    delegationChain: readonly { actorId: string; kind: "human" | "agent" | "workflow" | "model"; delegatedAt: string }[];
    capability: Capability;
    requesterAuthority: readonly AuthorityKind[];
  }> = {}) {
    return {
      capability: overrides.capability ?? lowRiskReadCap(),
      policy: makePolicy([allowRule()]),
      tenant,
      requestedBy: "agent-1",
      requesterKind: overrides.requesterKind ?? "agent",
      requesterAuthority: overrides.requesterAuthority ?? ["tenant.engineer"],
      delegationChain: overrides.delegationChain ?? [],
      evaluationRef: "eval-1",
      rationale: "test",
    };
  }

  it("REFUSES agent with empty delegation chain (A5)", () => {
    const result = authorizeAdoptionWorkflow(request({ requesterKind: "agent", delegationChain: [] }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("refused.self_authorization_no_human_chain");
      expect(result.decision.reasonCode).toBe("block.self_authorization");
    }
  });

  it("REFUSES agent with delegation chain that has NO human (A5)", () => {
    const result = authorizeAdoptionWorkflow(request({
      requesterKind: "agent",
      delegationChain: [{ actorId: "agent-2", kind: "agent", delegatedAt: "2026-01-01T00:00:00.000Z" }],
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("refused.self_authorization_delegation_chain_missing_human");
    }
  });

  it("REFUSES workflow with no human chain (A5)", () => {
    const result = authorizeAdoptionWorkflow(request({ requesterKind: "workflow", delegationChain: [] }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("refused.self_authorization_no_human_chain");
    }
  });

  it("REFUSES model with no human chain (A5)", () => {
    const result = authorizeAdoptionWorkflow(request({ requesterKind: "model", delegationChain: [] }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("refused.self_authorization_no_human_chain");
    }
  });

  it("ALLOWS agent WITH human delegation chain (A5 positive path)", () => {
    const result = authorizeAdoptionWorkflow(request({
      requesterKind: "agent",
      delegationChain: [
        { actorId: "agent-1", kind: "agent", delegatedAt: "2026-01-01T00:00:00.000Z" },
        { actorId: "user-1", kind: "human", delegatedAt: "2026-01-01T00:01:00.000Z" },
      ],
      requesterAuthority: ["tenant.engineer", "human.approval"],
    }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.authorizedByKind).toBe("agent");
      expect(result.record.guardianDecision.verdict).not.toBe("BLOCK");
    }
  });

  it("ALLOWS human requester without delegation chain (A5 positive path)", () => {
    const result = authorizeAdoptionWorkflow(request({
      requesterKind: "human",
      delegationChain: [],
      requesterAuthority: ["tenant.engineer"],
    }));
    expect(result.ok).toBe(true);
  });

  it("REFUSES empty capability id", () => {
    const emptyCap: Capability = { ...lowRiskReadCap(), id: "" };
    const result = authorizeAdoptionWorkflow(request({ capability: emptyCap, requesterKind: "human" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("refused.empty_capability");
    }
  });

  it("REFUSES tenant mismatch", () => {
    const wrongTenantPolicy = makePolicy([allowRule()], "tenant-OTHER");
    const result = authorizeAdoptionWorkflow({
      ...request({ requesterKind: "human" }),
      policy: wrongTenantPolicy,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("refused.tenant_mismatch");
    }
  });

  it("REFUSES when Guardian blocks (high risk, no matching allow rule)", () => {
    const result = authorizeAdoptionWorkflow({
      ...request({
        requesterKind: "human",
        capability: highRiskCap(),
        requesterAuthority: ["tenant.engineer"],
      }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("refused.guardian_blocked");
    }
  });

  it("adoption record is deterministic — same inputs => same adoptionId", () => {
    const req = request({
      requesterKind: "agent",
      delegationChain: [{ actorId: "user-1", kind: "human", delegatedAt: "2026-01-01T00:00:00.000Z" }],
      requesterAuthority: ["tenant.engineer"],
    });
    const r1 = authorizeAdoptionWorkflow(req);
    const r2 = authorizeAdoptionWorkflow(req);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (r1.ok && r2.ok) {
      expect(r1.record.adoptionId).toBe(r2.record.adoptionId);
    }
  });

  it("adoption NEVER self-executes — assertNoSelfExecutionPath", () => {
    const moduleExports = { authorizeAdoptionWorkflow, hasHumanDelegation };
    const probe = assertNoSelfExecutionPath(moduleExports);
    expect(probe.ok).toBe(true);
    expect(probe.forbidden).toEqual([]);
  });

  it("assertNoSelfExecutionPath catches forbidden function names", () => {
    const badExports = { selfAdopt: () => {}, autoAdopt: () => {} };
    const probe = assertNoSelfExecutionPath(badExports);
    expect(probe.ok).toBe(false);
    expect(probe.forbidden).toContain("selfAdopt");
    expect(probe.forbidden).toContain("autoAdopt");
  });
});

// ---------- Helpers ----------

describe("adoption helpers", () => {
  it("hasHumanDelegation returns true when a human is in the chain", () => {
    const chain = [
      { actorId: "a1", kind: "agent" as const, delegatedAt: "2026-01-01T00:00:00.000Z" },
      { actorId: "u1", kind: "human" as const, delegatedAt: "2026-01-01T00:01:00.000Z" },
    ];
    expect(hasHumanDelegation(chain)).toBe(true);
  });

  it("hasHumanDelegation returns false when no human is in the chain", () => {
    const chain = [
      { actorId: "a1", kind: "agent" as const, delegatedAt: "2026-01-01T00:00:00.000Z" },
      { actorId: "a2", kind: "workflow" as const, delegatedAt: "2026-01-01T00:01:00.000Z" },
    ];
    expect(hasHumanDelegation(chain)).toBe(false);
  });

  it("hashDelegationChain is deterministic", () => {
    const chain = [{ actorId: "u1", kind: "human" as const, delegatedAt: "2026-01-01T00:00:00.000Z" }];
    expect(hashDelegationChain(chain)).toBe(hashDelegationChain(chain));
  });

  it("hashDelegationChain differs for different chains", () => {
    const c1 = [{ actorId: "u1", kind: "human" as const, delegatedAt: "2026-01-01T00:00:00.000Z" }];
    const c2 = [{ actorId: "u2", kind: "human" as const, delegatedAt: "2026-01-01T00:00:00.000Z" }];
    expect(hashDelegationChain(c1)).not.toBe(hashDelegationChain(c2));
  });

  it("fnv1a is deterministic", () => {
    expect(fnv1a("hello")).toBe(fnv1a("hello"));
    expect(fnv1a("hello")).not.toBe(fnv1a("world"));
  });
});

// ---------- Integration: Guardian + Ledger ----------

describe("Guardian + Ledger integration", () => {
  it("evaluates a capability, builds a record, appends to ledger, verifies", () => {
    const policy = makePolicy([allowRule()]);
    const cap = lowRiskReadCap();
    const decision = evaluateCapability(policy, cap, {
      tenant,
      capability: cap,
      actor: { actorId: "user-1", authority: ["tenant.engineer"], isAutonomous: false },
      degraded: false,
    });
    expect(decision.verdict).toBe("ALLOW");

    const record = buildDecisionRecord(decision, {
      policyId: policy.id,
      policyVersion: policy.version,
      capability: cap,
      actorId: "user-1",
      actorIsAutonomous: false,
      actorAuthority: ["tenant.engineer"],
      evaluatedAt: "2026-01-01T00:00:00.000Z",
      matchedFacts: [{ fact: "rule.matched", value: decision.matchedRuleId ?? "none" }],
    });

    const ledger = appendDecision([], record);
    const verification = verifyDecisionLedger(ledger);
    expect(verification.verified).toBe(true);
    expect(verification.checkedEntries).toBe(1);
  });
});
