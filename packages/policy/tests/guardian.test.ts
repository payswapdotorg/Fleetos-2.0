import { describe, it, expect } from "vitest";
import {
  evaluateCapability,
  authorizeAdoption,
} from "../src/guardian.ts";
import type {
  Policy,
  PolicyRule,
} from "../src/policy.ts";
import type { Capability, TenantScopeLike } from "../src/capability.ts";

const tenant: TenantScopeLike = { tenantId: "tenant-1" };

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

function highRiskExecCap(): Capability {
  return {
    id: "cap.execute.device.restart",
    category: "execute.device",
    risk: "high",
    requiredAuthority: ["asset.owner", "human.approval"],
    tenantScope: "single",
    resourceScope: { assetIds: ["asset-1"] },
    sideEffects: [
      { kind: "device.command", target: "asset-1", reversible: false, description: "restart device" },
    ],
    idempotency: { supported: true, keyShape: ["tenantId", "assetId"], replayWindowSeconds: 60 },
    verification: { kind: "device.ack", timeoutMs: 30_000 },
    inputs: ["assetId"],
    outputs: ["restartReceipt"],
    description: "Restart a managed device",
    version: "1.0.0",
  };
}

function irreversibleCap(): Capability {
  return {
    id: "cap.mutate.policy.delete",
    category: "mutate.policy",
    risk: "irreversible",
    requiredAuthority: ["tenant.operator", "human.approval"],
    tenantScope: "single",
    resourceScope: {},
    sideEffects: [
      { kind: "domain.write", target: "policy", reversible: false, description: "delete policy" },
    ],
    idempotency: { supported: false, keyShape: [] },
    verification: { kind: "domain.read" },
    inputs: ["policyId"],
    outputs: [],
    description: "Permanently delete a policy",
    version: "1.0.0",
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

const allowReadRule: PolicyRule = {
  id: "rule.allow_low_risk_read",
  description: "allow low-risk reads for engineers",
  riskFloor: "none",
  riskCeiling: "low",
  requiredAuthority: ["tenant.engineer"],
  tenantScope: "single",
  verdict: "ALLOW",
  priority: 10,
};

const allowExecRule: PolicyRule = {
  id: "rule.require_human_approval_for_high_risk",
  description: "high-risk execution requires human approval",
  riskFloor: "medium",
  riskCeiling: "high",
  requiredAuthority: ["asset.owner", "human.approval"],
  tenantScope: "single",
  verdict: "ALLOW",
  priority: 20,
};

describe("Guardian: determinism", () => {
  it("returns byte-identical decisionDigest for identical inputs", () => {
    const policy = basePolicy([allowReadRule]);
    const cap = lowRiskReadCap();
    const ctx = {
      tenant,
      capability: cap,
      actor: { actorId: "u1", authority: ["tenant.engineer"] as readonly ["tenant.engineer"], isAutonomous: false },
      degraded: false,
    };
    const a = evaluateCapability(policy, cap, ctx);
    const b = evaluateCapability(policy, cap, ctx);
    expect(a).toEqual(b);
    expect(a.decisionDigest).toBe(b.decisionDigest);
  });

  it("produces different digests when actor authority differs", () => {
    const policy = basePolicy([allowReadRule]);
    const cap = lowRiskReadCap();
    const a = evaluateCapability(policy, cap, {
      tenant, capability: cap,
      actor: { actorId: "u1", authority: ["tenant.engineer"] as readonly ["tenant.engineer"], isAutonomous: false },
      degraded: false,
    });
    const b = evaluateCapability(policy, cap, {
      tenant, capability: cap,
      actor: { actorId: "u1", authority: ["tenant.operator"] as readonly ["tenant.operator"], isAutonomous: false },
      degraded: false,
    });
    expect(a.decisionDigest).not.toBe(b.decisionDigest);
  });
});

describe("Guardian: machine-stable reason codes", () => {
  it("returns allow.matched_rule for a satisfied low-risk read", () => {
    const policy = basePolicy([allowReadRule]);
    const decision = evaluateCapability(policy, lowRiskReadCap(), {
      tenant,
      capability: lowRiskReadCap(),
      actor: { actorId: "u1", authority: ["tenant.engineer"] as readonly ["tenant.engineer"], isAutonomous: false },
      degraded: false,
    });
    expect(decision.verdict).toBe("ALLOW");
    expect(decision.reasonCode).toBe("allow.matched_rule");
    expect(decision.matchedRuleId).toBe("rule.allow_low_risk_read");
  });

  it("returns block.no_matching_rule for an unknown capability class in a fail-closed policy", () => {
    const policy = basePolicy([]);
    const decision = evaluateCapability(policy, lowRiskReadCap(), {
      tenant,
      capability: lowRiskReadCap(),
      actor: { actorId: "u1", authority: ["tenant.engineer"] as readonly ["tenant.engineer"], isAutonomous: false },
      degraded: false,
    });
    expect(decision.verdict).toBe("BLOCK");
    expect(decision.reasonCode).toBe("block.no_matching_rule");
  });

  it("escalates ALLOW to REQUIRE_APPROVAL for high-risk capabilities", () => {
    const policy = basePolicy([allowExecRule]);
    const decision = evaluateCapability(policy, highRiskExecCap(), {
      tenant,
      capability: highRiskExecCap(),
      actor: { actorId: "u1", authority: ["asset.owner", "human.approval"] as readonly ["asset.owner", "human.approval"], isAutonomous: false },
      degraded: false,
    });
    expect(decision.verdict).toBe("REQUIRE_APPROVAL");
    expect(decision.reasonCode).toBe("require_approval.high_risk");
  });

  it("always returns REQUIRE_APPROVAL for irreversible risk even with an ALLOW rule", () => {
    const rule: PolicyRule = {
      id: "rule.allow_irreversible",
      description: "would-allow irreversible",
      riskFloor: "irreversible",
      riskCeiling: "irreversible",
      requiredAuthority: ["tenant.operator", "human.approval"],
      tenantScope: "single",
      verdict: "ALLOW",
      priority: 30,
    };
    const policy = basePolicy([rule]);
    const decision = evaluateCapability(policy, irreversibleCap(), {
      tenant,
      capability: irreversibleCap(),
      actor: { actorId: "u1", authority: ["tenant.operator", "human.approval"] as readonly ["tenant.operator", "human.approval"], isAutonomous: false },
      degraded: false,
    });
    expect(decision.verdict).toBe("REQUIRE_APPROVAL");
    expect(decision.reasonCode).toBe("require_approval.high_risk");
  });
});

describe("Guardian: tenant fail-closed (law A8)", () => {
  it("blocks when policy tenantId != context tenantId", () => {
    const policy: Policy = { ...basePolicy([allowReadRule]), tenantId: "tenant-2" };
    const decision = evaluateCapability(policy, lowRiskReadCap(), {
      tenant: { tenantId: "tenant-1" },
      capability: lowRiskReadCap(),
      actor: { actorId: "u1", authority: ["tenant.engineer"] as readonly ["tenant.engineer"], isAutonomous: false },
      degraded: false,
    });
    expect(decision.verdict).toBe("BLOCK");
    expect(decision.reasonCode).toBe("block.cross_tenant");
  });
});

describe("Guardian: anti-self-authorization (law A5/A6)", () => {
  it("blocks autonomous actors trying to authorize non-low risk without human approval", () => {
    const policy = basePolicy([allowExecRule]);
    const decision = evaluateCapability(policy, highRiskExecCap(), {
      tenant,
      capability: highRiskExecCap(),
      actor: { actorId: "agent-1", authority: ["asset.owner"] as readonly ["asset.owner"], isAutonomous: true },
      degraded: false,
    });
    expect(decision.verdict).toBe("BLOCK");
    expect(decision.reasonCode).toBe("block.self_authorization");
  });

  it("still allows autonomous actors to authorize low-risk reads", () => {
    const policy = basePolicy([allowReadRule]);
    const decision = evaluateCapability(policy, lowRiskReadCap(), {
      tenant,
      capability: lowRiskReadCap(),
      actor: { actorId: "agent-1", authority: ["tenant.engineer"] as readonly ["tenant.engineer"], isAutonomous: true },
      degraded: false,
    });
    expect(decision.verdict).toBe("ALLOW");
  });
});

describe("Guardian: degraded context (law A12 honest degradation)", () => {
  it("blocks any non-none risk in a degraded context", () => {
    const policy = basePolicy([allowExecRule]);
    const decision = evaluateCapability(policy, highRiskExecCap(), {
      tenant,
      capability: highRiskExecCap(),
      actor: { actorId: "u1", authority: ["asset.owner", "human.approval"] as readonly ["asset.owner", "human.approval"], isAutonomous: false },
      degraded: true,
    });
    expect(decision.verdict).toBe("BLOCK");
    expect(decision.reasonCode).toBe("block.policy_fail_closed");
  });

  it("still permits none-risk reads in degraded context", () => {
    const rule: PolicyRule = {
      id: "rule.allow_observed_only",
      description: "allow observed-only reads",
      riskFloor: "none",
      riskCeiling: "none",
      requiredAuthority: [],
      tenantScope: "single",
      verdict: "ALLOW",
      priority: 5,
    };
    const policy = basePolicy([rule]);
    const cap: Capability = { ...lowRiskReadCap(), risk: "none" };
    const decision = evaluateCapability(policy, cap, {
      tenant,
      capability: cap,
      actor: { actorId: "u1", authority: [] as readonly [], isAutonomous: false },
      degraded: true,
    });
    expect(decision.verdict).toBe("ALLOW");
  });
});

describe("authorizeAdoption", () => {
  it("never returns an unauthorized ALLOW for high risk without approval", () => {
    const policy = basePolicy([allowExecRule]);
    const evaluation = authorizeAdoption(
      policy,
      { capability: highRiskExecCap(), requestedBy: "agent-1", isAutonomous: true },
      tenant,
      ["asset.owner"],
    );
    expect(evaluation.decision.verdict).toBe("BLOCK");
  });

  it("returns ALLOW for a properly authorized low-risk capability", () => {
    const policy = basePolicy([allowReadRule]);
    const evaluation = authorizeAdoption(
      policy,
      { capability: lowRiskReadCap(), requestedBy: "u1", isAutonomous: false },
      tenant,
      ["tenant.engineer"],
    );
    expect(evaluation.decision.verdict).toBe("ALLOW");
    expect(evaluation.tenantId).toBe("tenant-1");
    expect(evaluation.policyId).toBe("pol-1");
  });
});
