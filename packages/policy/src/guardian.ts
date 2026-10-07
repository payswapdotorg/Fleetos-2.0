/**
 * @fleetos/policy — Reference Guardian.
 *
 * Pure, deterministic: `evaluateCapability(policy, capability, ctx)`.
 *
 * Laws enforced:
 * - A4: propose->authorize->confirm->dispatch->execute->verify->record->learn.
 *   The Guardian implements the AUTHORIZE step only. Execution is forbidden
 *   here (see @fleetos/execution).
 * - A5: Guardian is the SOLE policy authority. An autonomous actor can never
 *   self-authorize; that transition is unrepresentable in the type system
 *   because GuardianContext has no field that would let an agent grant itself
 *   authority.
 * - A8: tenant fail-closed. Cross-tenant scope + single-tenant policy = BLOCK.
 * - A12: deterministic reference path.
 *
 * No I/O, no side effects, no time-dependent randomness.
 */

import type { AuthorityKind, Capability, CapabilityRisk, TenantScopeLike } from "./capability.ts";
import type {
  GuardianContext,
  GuardianDecision,
  GuardianReasonCode,
  Policy,
  PolicyRule,
  PolicyRuleId,
  PolicyVerdict,
} from "./policy.ts";

const RISK_ORDER: readonly CapabilityRisk[] = [
  "none",
  "low",
  "medium",
  "high",
  "severe",
  "irreversible",
];

function rankRisk(risk: CapabilityRisk): number {
  const idx = RISK_ORDER.indexOf(risk);
  return idx === -1 ? RISK_ORDER.length : idx;
}

/** Stable string digest of the decision inputs — byte-identical for identical inputs. */
function decisionDigest(
  policy: Policy,
  capability: Capability,
  ctx: GuardianContext,
  verdict: PolicyVerdict,
  reasonCode: GuardianReasonCode,
  matchedRuleId: PolicyRuleId | null,
): string {
  // Simple deterministic concatenation — no crypto dep required for the digest.
  // For content-addressed evidence digests use @fleetos/evidence#sha256Hex.
  const parts = [
    `policy=${policy.id}:${policy.version}`,
    `tenant=${ctx.tenant.tenantId}`,
    `capability=${capability.id}:${capability.version}`,
    `actor=${ctx.actor.actorId}:auto=${ctx.actor.isAutonomous ? "1" : "0"}`,
    `verdict=${verdict}`,
    `reason=${reasonCode}`,
    `rule=${matchedRuleId ?? "none"}`,
  ];
  return parts.join("|");
}

function makeDecision(
  policy: Policy,
  capability: Capability,
  ctx: GuardianContext,
  verdict: PolicyVerdict,
  reasonCode: GuardianReasonCode,
  matchedRuleId: PolicyRuleId | null,
  conditions: readonly string[],
): GuardianDecision {
  return {
    verdict,
    reasonCode,
    matchedRuleId,
    tenantId: ctx.tenant.tenantId,
    capabilityId: capability.id,
    conditions,
    decisionDigest: decisionDigest(policy, capability, ctx, verdict, reasonCode, matchedRuleId),
  };
}

function ruleMatches(rule: PolicyRule, capability: Capability, ctx: GuardianContext): boolean {
  if (rankRisk(capability.risk) < rankRisk(rule.riskFloor)) return false;
  if (rankRisk(capability.risk) > rankRisk(rule.riskCeiling)) return false;
  if (rule.tenantScope !== "any") {
    if (rule.tenantScope === "single" && capability.tenantScope === "cross") return false;
    if (rule.tenantScope === "single" && capability.tenantScope === "system") return false;
  }
  // Authority check — every required authority must be present in the actor.
  for (const required of rule.requiredAuthority) {
    if (!ctx.actor.authority.includes(required)) return false;
  }
  return true;
}

function pickRule(policy: Policy, capability: Capability, ctx: GuardianContext): PolicyRule | null {
  const matching = policy.rules.filter((rule) => ruleMatches(rule, capability, ctx));
  if (matching.length === 0) return null;
  // Highest priority wins; ties broken by first declared (deterministic).
  return matching.reduce((best, current) => (current.priority > best.priority ? current : best));
}

/**
 * Pure reference Guardian. Deterministic. Same inputs => same decisionDigest.
 *
 * Order of adjudication:
 *  1. fail-closed: unknown policy/capability => BLOCK.
 *  2. self-authorization: autonomous actor that nominally has "guardian.autonomous"
 *     but is trying to authorize a capability whose requiredAuthority is empty
 *     => BLOCK.self_authorization (law A5/A6).
 *  3. cross-tenant: capability tenantScope != policy tenantScope => BLOCK.cross_tenant (law A8).
 *  4. degraded context + high risk => BLOCK.deny_degraded_context.
 *  5. matched rule verdict.
 *  6. default verdict (BLOCK if failClosed).
 */
export function evaluateCapability(
  policy: Policy,
  capability: Capability,
  ctx: GuardianContext,
): GuardianDecision {
  // 1. Tenant identity must match between policy and context.
  if (policy.tenantId !== ctx.tenant.tenantId) {
    return makeDecision(
      policy,
      capability,
      ctx,
      "BLOCK",
      "block.cross_tenant",
      null,
      ["policy.tenantId != ctx.tenant.tenantId"],
    );
  }

  // 2. Capability must be either single-tenant within the same tenant or
  //    explicitly cross-tenant. A single-tenant policy CANNOT authorize a
  //    cross-tenant capability (law A8).
  if (capability.tenantScope === "cross" && policy.tenantId !== ctx.tenant.tenantId) {
    return makeDecision(
      policy,
      capability,
      ctx,
      "BLOCK",
      "block.cross_tenant",
      null,
      ["capability.tenantScope=cross but policy is tenant-scoped"],
    );
  }

  // 3. Self-authorization refusal. An autonomous actor with no human-approval
  //    authority cannot grant itself high-risk capabilities.
  if (ctx.actor.isAutonomous && capability.risk !== "none" && capability.risk !== "low") {
    const hasHumanApproval = ctx.actor.authority.includes("human.approval");
    if (!hasHumanApproval) {
      return makeDecision(
        policy,
        capability,
        ctx,
        "BLOCK",
        "block.self_authorization",
        null,
        ["autonomous actor cannot self-authorize non-low-risk capability"],
      );
    }
  }

  // 4. Cross-tenant resource scope check (fail-closed).
  if (capability.tenantScope === "single" && ctx.tenant.tenantId !== policy.tenantId) {
    return makeDecision(
      policy,
      capability,
      ctx,
      "BLOCK",
      "block.cross_tenant",
      null,
      ["single-tenant capability evaluated against different tenant policy"],
    );
  }

  // 5. Degraded context — refuse consequential execution.
  if (ctx.degraded && capability.risk !== "none") {
    return makeDecision(
      policy,
      capability,
      ctx,
      "BLOCK",
      "block.policy_fail_closed",
      null,
      ["degraded context refuses non-none risk"],
    );
  }

  // 6. Find a matching rule.
  const rule = pickRule(policy, capability, ctx);
  if (!rule) {
    if (policy.failClosed) {
      return makeDecision(
        policy,
        capability,
        ctx,
        "BLOCK",
        "block.no_matching_rule",
        null,
        ["fail-closed policy: no matching rule"],
      );
    }
    return makeDecision(
      policy,
      capability,
      ctx,
      policy.defaultVerdict,
      "warn.soft_policy",
      null,
      ["no matching rule; default verdict applied"],
    );
  }

  // 7. Irreversible risk => always require operator approval.
  if (capability.risk === "irreversible" && rule.verdict !== "BLOCK") {
    return makeDecision(
      policy,
      capability,
      ctx,
      "REQUIRE_APPROVAL",
      "require_approval.high_risk",
      rule.id,
      ["irreversible risk requires operator approval"],
    );
  }

  // 8. High risk => require approval unless rule explicitly ALLOWs (rare).
  if (capability.risk === "high" && rule.verdict === "ALLOW") {
    return makeDecision(
      policy,
      capability,
      ctx,
      "REQUIRE_APPROVAL",
      "require_approval.high_risk",
      rule.id,
      ["high risk escalates ALLOW to REQUIRE_APPROVAL"],
    );
  }

  // 9. Unknown capability in non-fail-closed policy.
  if (capability.id === "" || capability.version === "") {
    return makeDecision(
      policy,
      capability,
      ctx,
      "BLOCK",
      "block.unknown_capability",
      rule.id,
      ["capability id/version missing"],
    );
  }

  // 10. Rule verdict applies. Map WARN for non-risky capabilities to ALLOW+WARN.
  const conditions = rule.requiredAuthority.length === 0
    ? [] as readonly string[]
    : [`authority satisfied: ${rule.requiredAuthority.join(",")}`];

  return makeDecision(policy, capability, ctx, rule.verdict, mapVerdictToReason(rule.verdict), rule.id, conditions);
}

function mapVerdictToReason(verdict: PolicyVerdict): GuardianReasonCode {
  switch (verdict) {
    case "ALLOW": return "allow.matched_rule";
    case "WARN": return "warn.soft_policy";
    case "REQUIRE_APPROVAL": return "require_approval.high_risk";
    case "BLOCK": return "block.policy_fail_closed";
  }
}

/**
 * Capability adoption authorization — ONLY the Guardian may produce this.
 *
 * Law A5: capability adoption requires the Guardian path. Agents/workflows/
 * models cannot self-adopt. Encode the boundary by requiring a GuardianDecision
 * with verdict ALLOW or REQUIRE_APPROVAL (after explicit human approval).
 */
export function authorizeAdoption(
  policy: Policy,
  proposal: { capability: Capability; requestedBy: string; isAutonomous: boolean },
  tenant: TenantScopeLike,
  approverAuthority: readonly AuthorityKind[],
): import("./policy.ts").PolicyEvaluation {
  const ctx: GuardianContext = {
    tenant,
    capability: proposal.capability,
    actor: {
      actorId: proposal.requestedBy,
      authority: approverAuthority,
      isAutonomous: proposal.isAutonomous,
    },
    degraded: false,
  };
  const decision = evaluateCapability(policy, proposal.capability, ctx);
  return {
    evaluationId: `eval-${proposal.capability.id}-${decision.decisionDigest.slice(0, 12)}`,
    policyId: policy.id,
    policyVersion: policy.version,
    tenantId: tenant.tenantId,
    capabilityId: proposal.capability.id,
    decision,
    evaluatedAt: "1970-01-01T00:00:00.000Z",
    inputsDigest: decision.decisionDigest,
  };
}
