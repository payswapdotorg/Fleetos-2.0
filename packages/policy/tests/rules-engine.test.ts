/**
 * Ordered rules-engine tests (F220B, Wave 2).
 *
 * Behavior under test: ordered evaluation trace, allow/deny/escalate flavors,
 * precedence resolution, decision audit refs, input-validation refusals,
 * determinism, no-floats discipline.
 */
import { describe, it, expect } from "vitest";
import {
  evaluateRulesOrdered,
  buildDecisionAuditRef,
  verifyOrderedEvaluationDeterminism,
} from "../src/index.ts";
import type { Policy, PolicyRule, GuardianContext } from "../src/index.ts";
import type { Capability, TenantScopeLike } from "../src/index.ts";

const tenant: TenantScopeLike = { tenantId: "tenant-1" };

function readCap(): Capability {
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

function midRiskCap(): Capability {
  return {
    ...readCap(),
    id: "cap.execute.device.restart",
    category: "execute.device",
    risk: "medium",
    requiredAuthority: ["asset.owner"],
  };
}

function basePolicy(rules: readonly PolicyRule[]): Policy {
  return {
    id: "pol-1",
    version: "1.0.0",
    tenantId: "tenant-1",
    rules,
    defaultVerdict: "BLOCK",
    failClosed: true,
  };
}

function rule(id: PolicyRule["id"], verdict: PolicyRule["verdict"], priority: number, floor: PolicyRule["riskFloor"] = "none", ceiling: PolicyRule["riskCeiling"] = "irreversible"): PolicyRule {
  return {
    id,
    description: `rule ${id}`,
    riskFloor: floor,
    riskCeiling: ceiling,
    requiredAuthority: [],
    tenantScope: "any",
    verdict,
    priority,
  };
}

function ctx(overrides: Partial<GuardianContext["actor"]> = {}): GuardianContext {
  return {
    tenant,
    capability: midRiskCap(),
    actor: { actorId: "actor-1", authority: ["asset.owner", "tenant.engineer"], isAutonomous: false, ...overrides },
    degraded: false,
  };
}

describe("ordered evaluation — trace and ordering", () => {
  it("records EVERY matching rule in DECLARED order (not just the winner)", () => {
    const policy = basePolicy([
      rule("rule.allow_low_risk_read", "ALLOW", 10),
      rule("rule.block_cross_tenant", "BLOCK", 50),
      rule("rule.deny_degraded_context", "WARN", 5),
    ]);
    const result = evaluateRulesOrdered(policy, midRiskCap(), ctx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.evaluation.decisions.map((d) => d.ruleId)).toEqual([
      "rule.allow_low_risk_read",
      "rule.block_cross_tenant",
      "rule.deny_degraded_context",
    ]);
  });

  it("skips non-matching rules entirely (risk range filtering)", () => {
    const policy = basePolicy([
      rule("rule.allow_low_risk_read", "ALLOW", 10, "none", "low"),   // medium cap does NOT match
      rule("rule.require_human_approval_for_high_risk", "ALLOW", 20, "medium", "high"),
    ]);
    const result = evaluateRulesOrdered(policy, midRiskCap(), ctx());
    if (!result.ok) throw new Error(result.reason);
    expect(result.evaluation.decisions.map((d) => d.ruleId)).toEqual(["rule.require_human_approval_for_high_risk"]);
  });

  it("flavors map allow/deny/escalate/soft-allow deterministically", () => {
    const policy = basePolicy([
      rule("rule.allow_low_risk_read", "ALLOW", 10),
      rule("rule.block_cross_tenant", "BLOCK", 50),
      rule("rule.require_human_approval_for_high_risk", "REQUIRE_APPROVAL", 30),
      rule("rule.deny_degraded_context", "WARN", 5),
    ]);
    const result = evaluateRulesOrdered(policy, midRiskCap(), ctx());
    if (!result.ok) throw new Error(result.reason);
    expect(result.evaluation.decisions.map((d) => d.flavor)).toEqual(["allow", "deny", "escalate", "soft-allow"]);
  });

  it("reason codes are machine-stable and embed the rule id", () => {
    const policy = basePolicy([rule("rule.block_cross_tenant", "BLOCK", 50)]);
    const result = evaluateRulesOrdered(policy, midRiskCap(), ctx());
    if (!result.ok) throw new Error(result.reason);
    expect(result.evaluation.decisions[0]!.reasonCode).toBe("deny.rule.rule.block_cross_tenant");
  });

  it("matched facts carry the rule, the risk window and the verdict", () => {
    const policy = basePolicy([rule("rule.allow_low_risk_read", "ALLOW", 10, "none", "low")]);
    const result = evaluateRulesOrdered(policy, readCap(), ctx());
    if (!result.ok) throw new Error(result.reason);
    const facts = result.evaluation.decisions[0]!.matchedFacts;
    expect(facts.map((f) => f.fact)).toEqual(["rule.matched", "risk.within_range", "verdict"]);
  });
});

describe("ordered evaluation — precedence resolution", () => {
  it("deny-overrides-allow: a BLOCK beats an ALLOW regardless of priority", () => {
    const policy = basePolicy([
      rule("rule.allow_low_risk_read", "ALLOW", 100),
      rule("rule.block_cross_tenant", "BLOCK", 1),
    ]);
    const result = evaluateRulesOrdered(policy, midRiskCap(), ctx());
    if (!result.ok) throw new Error(result.reason);
    expect(result.evaluation.resolution.verdict).toBe("BLOCK");
    expect(result.evaluation.resolution.winningRuleId).toBe("rule.block_cross_tenant");
    expect(result.evaluation.resolution.mode).toBe("deny_overrides_allow");
  });

  it("escalate beats allow: REQUIRE_APPROVAL wins over ALLOW", () => {
    const policy = basePolicy([
      rule("rule.allow_low_risk_read", "ALLOW", 10),
      rule("rule.require_human_approval_for_high_risk", "REQUIRE_APPROVAL", 10),
    ]);
    const result = evaluateRulesOrdered(policy, midRiskCap(), ctx());
    if (!result.ok) throw new Error(result.reason);
    expect(result.evaluation.resolution.verdict).toBe("REQUIRE_APPROVAL");
  });

  it("no matching rules resolves fail-closed to BLOCK", () => {
    const policy = basePolicy([]);
    const result = evaluateRulesOrdered(policy, midRiskCap(), ctx());
    if (!result.ok) throw new Error(result.reason);
    expect(result.evaluation.decisions).toHaveLength(0);
    expect(result.evaluation.resolution.verdict).toBe("BLOCK");
    expect(result.evaluation.resolution.winningRuleId).toBeNull();
  });

  it("conflicting verdicts are all reported in conflictingVerdicts (audit honesty)", () => {
    const policy = basePolicy([
      rule("rule.allow_low_risk_read", "ALLOW", 10),
      rule("rule.block_cross_tenant", "BLOCK", 20),
      rule("rule.deny_degraded_context", "WARN", 30),
    ]);
    const result = evaluateRulesOrdered(policy, midRiskCap(), ctx());
    if (!result.ok) throw new Error(result.reason);
    expect(result.evaluation.resolution.conflictingVerdicts).toEqual(["ALLOW", "BLOCK", "WARN"]);
  });
});

describe("ordered evaluation — refusals (fail-closed)", () => {
  it("refuses an empty tenant scope", () => {
    const result = evaluateRulesOrdered(basePolicy([rule("rule.allow_low_risk_read", "ALLOW", 10)]), midRiskCap(), {
      ...ctx(),
      tenant: { tenantId: "" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("evaluate.missing-tenant");
  });

  it("refuses a policy/context tenant mismatch (A8)", () => {
    const result = evaluateRulesOrdered(
      { ...basePolicy([rule("rule.allow_low_risk_read", "ALLOW", 10)]), tenantId: "tenant-2" },
      midRiskCap(),
      ctx(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("evaluate.tenant-mismatch");
  });

  it("refuses a malformed policy with duplicate rule ids", () => {
    const r = rule("rule.allow_low_risk_read", "ALLOW", 10);
    const result = evaluateRulesOrdered(basePolicy([r, r]), midRiskCap(), ctx());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("evaluate.duplicate-rule-id");
  });

  it("refuses a malformed policy with a float priority (no-floats law)", () => {
    const result = evaluateRulesOrdered(basePolicy([rule("rule.allow_low_risk_read", "ALLOW", 10.5)]), midRiskCap(), ctx());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("evaluate.non-integer-priority");
  });

  it("outputs never contain floats — all priorities and counts are integers", () => {
    const policy = basePolicy([
      rule("rule.allow_low_risk_read", "ALLOW", 10),
      rule("rule.block_cross_tenant", "BLOCK", 50),
    ]);
    const result = evaluateRulesOrdered(policy, midRiskCap(), ctx());
    if (!result.ok) throw new Error(result.reason);
    for (const d of result.evaluation.decisions) {
      expect(Number.isInteger(d.priority)).toBe(true);
    }
    expect(Number.isInteger(result.evaluation.decisions.length)).toBe(true);
  });
});

describe("ordered evaluation — determinism + audit refs", () => {
  it("same inputs => byte-identical evaluation (machine-tested)", () => {
    const policy = basePolicy([
      rule("rule.allow_low_risk_read", "ALLOW", 10),
      rule("rule.block_cross_tenant", "BLOCK", 50),
    ]);
    const check = verifyOrderedEvaluationDeterminism(policy, midRiskCap(), ctx());
    expect(check.deterministic).toBe(true);
    expect(check.digest1).toBe(check.digest2);
  });

  it("inputsDigest changes when the actor authority set changes", () => {
    const policy = basePolicy([rule("rule.allow_low_risk_read", "ALLOW", 10)]);
    const a = evaluateRulesOrdered(policy, midRiskCap(), ctx({ authority: ["asset.owner"] }));
    const b = evaluateRulesOrdered(policy, midRiskCap(), ctx({ authority: ["asset.owner", "tenant.engineer"] }));
    if (!a.ok || !b.ok) throw new Error("eval failed");
    expect(a.evaluation.inputsDigest).not.toBe(b.evaluation.inputsDigest);
  });

  it("buildDecisionAuditRef derives a deterministic, content-addressed ref id", () => {
    const policy = basePolicy([rule("rule.allow_low_risk_read", "ALLOW", 10)]);
    const result = evaluateRulesOrdered(policy, midRiskCap(), ctx());
    if (!result.ok) throw new Error(result.reason);
    const refA = buildDecisionAuditRef(result.evaluation, 5_000);
    const refB = buildDecisionAuditRef(result.evaluation, 5_000);
    if (!refA.ok || !refB.ok) throw new Error("audit ref failed");
    expect(refA.ref.auditRefId).toBe(refB.ref.auditRefId);
    expect(refA.ref.inputsDigest).toBe(result.evaluation.inputsDigest);
    expect(refA.ref.decisionCount).toBe(1);
    expect(refA.ref.resolvedVerdict).toBe("ALLOW");
    expect(refA.ref.evaluatedAt).toBe(5_000);
  });

  it("buildDecisionAuditRef refuses a negative or non-integer evaluatedAt (time is an integer input)", () => {
    const policy = basePolicy([rule("rule.allow_low_risk_read", "ALLOW", 10)]);
    const result = evaluateRulesOrdered(policy, midRiskCap(), ctx());
    if (!result.ok) throw new Error(result.reason);
    expect(buildDecisionAuditRef(result.evaluation, -1).ok).toBe(false);
    expect(buildDecisionAuditRef(result.evaluation, 1.5).ok).toBe(false);
  });

  it("property-style loop: authority subsets never change the DECISION ORDER (declared order is stable)", () => {
    const policy = basePolicy([
      rule("rule.allow_low_risk_read", "ALLOW", 10),
      rule("rule.block_cross_tenant", "BLOCK", 50),
      rule("rule.deny_degraded_context", "WARN", 5),
    ]);
    const authoritySets: readonly (readonly import("../src/index.ts").AuthorityKind[])[] = [
      [],
      ["asset.owner"],
      ["tenant.engineer"],
      ["asset.owner", "tenant.engineer"],
      ["human.approval"],
    ];
    for (const authority of authoritySets) {
      const result = evaluateRulesOrdered(policy, midRiskCap(), ctx({ authority }));
      if (!result.ok) throw new Error(result.reason);
      expect(result.evaluation.decisions.map((d) => d.ruleId)).toEqual([
        "rule.allow_low_risk_read",
        "rule.block_cross_tenant",
        "rule.deny_degraded_context",
      ]);
    }
  });
});
