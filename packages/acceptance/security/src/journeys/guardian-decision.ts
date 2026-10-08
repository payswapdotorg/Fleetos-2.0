/**
 * Journey 3 — guardian decision (persona: tenant-operator).
 *
 * A tenant operator submits rule evaluations through the REAL policy
 * Guardian and opens the REAL ceilings view:
 *   - low-risk read -> ALLOW (matched rule);
 *   - high-risk execution -> REQUIRE_APPROVAL;
 *   - irreversible -> BLOCK: the tenant policy's own rule
 *     `rule.block_irreversible_without_operator` (priority 90) matches the
 *     risk range AND the operator's authority, and its verdict is BLOCK —
 *     this policy refuses irreversible actions outright (re-derived from the
 *     REAL engine: a matching BLOCK rule beats the default, and authority
 *     presence only gates rule MATCHING, never the verdict);
 *   - autonomous agent on high risk -> BLOCK (self-authorization, law A5);
 *   - cross-tenant policy -> BLOCK (law A8);
 *   - the ordered rule engine yields the full adjudication trace + audit ref;
 *   - the capability-ceiling view carries the "ceilings are NOT
 *     authorizations" marker structurally.
 */

import type { AcceptanceJourney } from "../journey-contracts.ts";
import { evaluateCapability, evaluateRulesOrdered, buildDecisionAuditRef, issueGrant } from "@fleetos/policy";
import type { GuardianDecision, GrantRecord } from "@fleetos/policy";
import { buildCapabilityCeilingBoard } from "@fleetos/experience-safety-intel";
import {
  ANALYST_CTX,
  AUTONOMOUS_AGENT_CTX,
  EXECUTE_CAPABILITY,
  IRREVERSIBLE_CAPABILITY,
  NOW_MS,
  OPERATOR_CTX,
  READ_CAPABILITY,
  TENANT,
  FOREIGN_TENANT,
  tenantPolicy,
} from "./fixture-world.ts";

function verdictOf(d: GuardianDecision): string {
  return d.verdict;
}

export const guardianDecisionJourney: AcceptanceJourney = {
  journeyId: "security.guardian-decision",
  persona: "tenant-operator",
  capabilities: ["guardian-decision"],
  goal: "Authorize work through the Guardian and see the ceilings-not-authorizations board",
  steps: [
    {
      stepId: "guardian-verdicts",
      kind: "guardian-decision",
      description: "Evaluate four REAL Guardian decisions across risk tiers and actors",
      packages: ["@fleetos/policy"],
      operations: ["evaluateCapability"],
      run: (ctx) => {
        const policy = tenantPolicy();
        const read = evaluateCapability(policy, READ_CAPABILITY, ANALYST_CTX(READ_CAPABILITY));
        const execute = evaluateCapability(policy, EXECUTE_CAPABILITY, OPERATOR_CTX(EXECUTE_CAPABILITY));
        const irreversible = evaluateCapability(policy, IRREVERSIBLE_CAPABILITY, OPERATOR_CTX(IRREVERSIBLE_CAPABILITY));
        const agent = evaluateCapability(policy, EXECUTE_CAPABILITY, AUTONOMOUS_AGENT_CTX(EXECUTE_CAPABILITY));
        const cross = evaluateCapability(tenantPolicy(FOREIGN_TENANT.tenantId), READ_CAPABILITY, ANALYST_CTX(READ_CAPABILITY));
        ctx.record("guardian.read.verdict", verdictOf(read));
        ctx.record("guardian.read.reason", read.reasonCode);
        ctx.record("guardian.read.rule", read.matchedRuleId);
        ctx.record("guardian.execute.verdict", verdictOf(execute));
        ctx.record("guardian.execute.reason", execute.reasonCode);
        ctx.record("guardian.execute.rule", execute.matchedRuleId);
        ctx.record("guardian.irreversible.verdict", verdictOf(irreversible));
        ctx.record("guardian.irreversible.reason", irreversible.reasonCode);
        ctx.record("guardian.irreversible.rule", irreversible.matchedRuleId);
        ctx.record("guardian.agent.verdict", verdictOf(agent));
        ctx.record("guardian.agent.reason", agent.reasonCode);
        ctx.record("guardian.cross.verdict", verdictOf(cross));
        ctx.record("guardian.cross.reason", cross.reasonCode);
        const again = evaluateCapability(policy, EXECUTE_CAPABILITY, OPERATOR_CTX(EXECUTE_CAPABILITY));
        ctx.record("guardian.digestStable", again.decisionDigest === execute.decisionDigest);
        ctx.record("guardian.tenant", execute.tenantId);
        ctx.record("guardian.capability", execute.capabilityId);
      },
    },
    {
      stepId: "ordered-trace",
      kind: "guardian-decision",
      description: "Run the ordered rule engine for the full adjudication trace + audit ref",
      packages: ["@fleetos/policy"],
      operations: ["evaluateRulesOrdered", "buildDecisionAuditRef"],
      run: (ctx) => {
        const policy = tenantPolicy();
        const result = evaluateRulesOrdered(policy, EXECUTE_CAPABILITY, OPERATOR_CTX(EXECUTE_CAPABILITY));
        if (!result.ok) throw new Error(`ordered evaluation refused: ${result.reason}`);
        ctx.record("ordered.decisionCount", result.evaluation.decisions.length);
        ctx.record("ordered.resolution.verdict", result.evaluation.resolution.verdict);
        ctx.record("ordered.resolution.winningRule", result.evaluation.resolution.winningRuleId);
        const digestLength = result.evaluation.inputsDigest.length;
        ctx.record("ordered.inputsDigestLength", digestLength);
        const audit = buildDecisionAuditRef(result.evaluation, NOW_MS);
        if (!audit.ok) throw new Error("audit ref refused");
        ctx.record("ordered.audit.decisionCount", audit.ref.decisionCount);
        ctx.record("ordered.audit.resolvedVerdict", audit.ref.resolvedVerdict);
        ctx.record("ordered.audit.evaluatedAt", audit.ref.evaluatedAt);
        const mismatch = evaluateRulesOrdered(policy, EXECUTE_CAPABILITY, ANALYST_CTX(EXECUTE_CAPABILITY));
        if (!mismatch.ok) throw new Error(`analyst evaluation refused: ${mismatch.reason}`);
        ctx.record("ordered.analystDecisionCount", mismatch.evaluation.decisions.length);
        ctx.record("ordered.analystResolution", mismatch.evaluation.resolution.verdict);
        ctx.record("ordered.analystWinningRule", mismatch.evaluation.resolution.winningRuleId);
      },
    },
    {
      stepId: "ceilings-view",
      kind: "view-read",
      description: "Open the REAL capability-ceiling board with active grants",
      packages: ["@fleetos/policy", "@fleetos/experience-safety-intel"],
      operations: ["issueGrant", "buildCapabilityCeilingBoard"],
      run: (ctx) => {
        let grants: readonly GrantRecord[] = [];
        const root = issueGrant(grants, {
          grantId: "grant-root",
          tenantId: TENANT.tenantId,
          capabilityId: READ_CAPABILITY.id,
          granteeActorId: "analyst-kim",
          grantedByActorId: "operator-ada",
          grantedAt: NOW_MS - 10_000,
          expiresAt: null,
        });
        if (!root.ok) throw new Error(`root grant refused: ${root.reason}`);
        grants = root.grants;
        const board = buildCapabilityCeilingBoard({
          tenantId: TENANT.tenantId,
          capabilities: [READ_CAPABILITY, EXECUTE_CAPABILITY, IRREVERSIBLE_CAPABILITY],
          grants,
          actorAuthority: ["tenant.operator", "human.approval", "asset.owner"],
          nowMs: NOW_MS,
        });
        if (!board.ok) throw new Error(`ceiling board refused: ${board.refused} (${board.detail})`);
        const readEntry = board.view.entries.find((e) => e.capabilityId === READ_CAPABILITY.id);
        const executeEntry = board.view.entries.find((e) => e.capabilityId === EXECUTE_CAPABILITY.id);
        if (readEntry === undefined || executeEntry === undefined) throw new Error("ceiling entries missing");
        ctx.record("ceiling.read.satisfied", readEntry.ceilingSatisfied);
        ctx.record("ceiling.read.marker", readEntry.ceilingSatisfiedIsNotAuthorization);
        ctx.record("ceiling.read.activeGrants", readEntry.activeGrantCount);
        ctx.record("ceiling.read.hasAuthorizedField", "authorized" in readEntry);
        ctx.record("ceiling.read.hasVerdictField", "verdict" in readEntry);
        ctx.record("ceiling.execute.satisfied", executeEntry.ceilingSatisfied);
        ctx.record("ceiling.execute.missingAuthority", executeEntry.missingAuthority);
        ctx.record("ceiling.execute.coveredAuthority", executeEntry.coveredAuthority);
        ctx.record("ceiling.satisfiedCount", board.view.satisfiedCount);
      },
    },
  ],
  assertions: [
    { assertionId: "gd-1", description: "Low-risk read allowed", path: "guardian.read.verdict", expected: "ALLOW" },
    { assertionId: "gd-2", description: "Allow reason names the matched rule", path: "guardian.read.reason", expected: "allow.matched_rule" },
    { assertionId: "gd-3", description: "Matched rule id surfaced", path: "guardian.read.rule", expected: "rule.allow_low_risk_read" },
    { assertionId: "gd-4", description: "High-risk execution escalates to approval", path: "guardian.execute.verdict", expected: "REQUIRE_APPROVAL" },
    { assertionId: "gd-5", description: "Approval reason code", path: "guardian.execute.reason", expected: "require_approval.high_risk" },
    { assertionId: "gd-6", description: "Approval rule surfaced", path: "guardian.execute.rule", expected: "rule.require_human_approval_for_high_risk" },
    { assertionId: "gd-7", description: "Irreversible risk is BLOCKED by the operator-facing rule (the policy refuses it outright)", path: "guardian.irreversible.verdict", expected: "BLOCK" },
    { assertionId: "gd-8", description: "The block names the fail-closed policy rule", path: "guardian.irreversible.reason", expected: "block.policy_fail_closed" },
    { assertionId: "gd-7b", description: "The matched rule is the irreversible-without-operator block", path: "guardian.irreversible.rule", expected: "rule.block_irreversible_without_operator" },
    { assertionId: "gd-9", description: "Autonomous agent cannot self-authorize", path: "guardian.agent.verdict", expected: "BLOCK" },
    { assertionId: "gd-10", description: "Self-authorization refusal reason (A5)", path: "guardian.agent.reason", expected: "block.self_authorization" },
    { assertionId: "gd-11", description: "Cross-tenant policy blocked (A8)", path: "guardian.cross.verdict", expected: "BLOCK" },
    { assertionId: "gd-12", description: "Cross-tenant refusal reason", path: "guardian.cross.reason", expected: "block.cross_tenant" },
    { assertionId: "gd-13", description: "Same inputs -> same decision digest", path: "guardian.digestStable", expected: true },
    { assertionId: "gd-14", description: "Decision carries tenant scope", path: "guardian.tenant", expected: "acme-ops" },
    { assertionId: "gd-15", description: "Decision names the capability", path: "guardian.capability", expected: "fleetos.device.execute-command" },
    { assertionId: "gd-16", description: "Operator satisfies the high-risk rule — one decision in trace", path: "ordered.decisionCount", expected: 1 },
    { assertionId: "gd-17", description: "Resolution escalates", path: "ordered.resolution.verdict", expected: "REQUIRE_APPROVAL" },
    { assertionId: "gd-18", description: "Winning rule surfaced", path: "ordered.resolution.winningRule", expected: "rule.require_human_approval_for_high_risk" },
    { assertionId: "gd-19", description: "Inputs digest is FNV-1a 8-hex", path: "ordered.inputsDigestLength", expected: 8 },
    { assertionId: "gd-20", description: "Audit ref carries the decision count", path: "ordered.audit.decisionCount", expected: 1 },
    { assertionId: "gd-21", description: "Audit ref carries the resolved verdict", path: "ordered.audit.resolvedVerdict", expected: "REQUIRE_APPROVAL" },
    { assertionId: "gd-22", description: "Audit ref time is the caller-supplied logical now", path: "ordered.audit.evaluatedAt", expected: 1791831000000 },
    { assertionId: "gd-23", description: "Analyst (no human.approval) matches no rule — honest empty trace", path: "ordered.analystDecisionCount", expected: 0 },
    { assertionId: "gd-24", description: "Empty trace resolves fail-closed BLOCK", path: "ordered.analystResolution", expected: "BLOCK" },
    { assertionId: "gd-24b", description: "No winning rule claimed", path: "ordered.analystWinningRule", expected: null },
    { assertionId: "gd-25", description: "Read ceiling satisfied (no authority required)", path: "ceiling.read.satisfied", expected: true },
    { assertionId: "gd-26", description: "Ceiling marker machine-carried", path: "ceiling.read.marker", expected: true },
    { assertionId: "gd-27", description: "Active grant counted", path: "ceiling.read.activeGrants", expected: 1 },
    { assertionId: "gd-28", description: "No 'authorized' field on ceiling entries", path: "ceiling.read.hasAuthorizedField", expected: false },
    { assertionId: "gd-29", description: "No 'verdict' field on ceiling entries", path: "ceiling.read.hasVerdictField", expected: false },
    { assertionId: "gd-30", description: "Execute ceiling satisfied by operator authority", path: "ceiling.execute.satisfied", expected: true },
    { assertionId: "gd-31", description: "No missing authority for the operator", path: "ceiling.execute.missingAuthority", expected: [] },
    { assertionId: "gd-32", description: "Covered authority projected in declared order", path: "ceiling.execute.coveredAuthority", expected: ["asset.owner", "human.approval"] },
    { assertionId: "gd-33", description: "Board counts satisfied ceilings", path: "ceiling.satisfiedCount", expected: 3 },
  ],
};
