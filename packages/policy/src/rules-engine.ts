/**
 * @fleetos/policy — Deterministic ordered rule evaluation (F220B, Wave 2).
 *
 * The reference Guardian (guardian.ts) picks the single best matching rule.
 * Operational grade requires the FULL ordered trace: every matching rule is
 * evaluated in DECLARED order, each producing a decision record with a
 * machine-stable reason code; the final verdict is then resolved with
 * deterministic precedence (deny-overrides-allow by default).
 *
 * Laws:
 *  - A5: this module EVALUATES policy; it never executes anything.
 *  - Determinism: same inputs => byte-identical evaluation (inputsDigest).
 *    Outputs contain NO floats — priorities and counts are integers; a policy
 *    carrying a non-integer priority is refused (`evaluate.non-integer-priority`).
 *  - A8: tenant fail-closed — policy/context tenant mismatch refuses.
 */

import type { Capability, CapabilityRisk } from "./capability.ts";
import type { GuardianContext, Policy, PolicyRule, PolicyRuleId, PolicyVerdict } from "./policy.ts";
import type { JustificationFact, PrecedenceResolution } from "./decision-record.ts";
import { resolvePrecedence, fnv1a } from "./decision-record.ts";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** Decision flavor of a rule verdict — machine-stable. */
export type DecisionFlavor = "allow" | "deny" | "escalate" | "soft-allow";

export interface OrderedRuleDecision {
  readonly ruleId: PolicyRuleId;
  readonly verdict: PolicyVerdict;
  /** allow | deny | escalate | soft-allow — the operational reading. */
  readonly flavor: DecisionFlavor;
  readonly priority: number;
  readonly reasonCode: string;
  readonly matchedFacts: readonly JustificationFact[];
}

export interface OrderedRuleEvaluation {
  readonly policyId: string;
  readonly policyVersion: string;
  readonly tenantId: string;
  readonly capabilityId: string;
  /** Every matching rule, in DECLARED order — the full adjudication trace. */
  readonly decisions: readonly OrderedRuleDecision[];
  /** Deterministic precedence resolution over the decisions. */
  readonly resolution: PrecedenceResolution;
  /** Canonical digest over all evaluation inputs. */
  readonly inputsDigest: string;
}

export type RuleEvaluationRefusalCode =
  | "evaluate.missing-tenant"
  | "evaluate.tenant-mismatch"
  | "evaluate.duplicate-rule-id"
  | "evaluate.non-integer-priority";

export type RuleEvaluationResult =
  | { readonly ok: true; readonly evaluation: OrderedRuleEvaluation }
  | { readonly ok: false; readonly reason: RuleEvaluationRefusalCode };

// ---------------------------------------------------------------------------
// Matching — the same semantics as the reference Guardian's matcher
// ---------------------------------------------------------------------------

const RISK_ORDER: readonly CapabilityRisk[] = ["none", "low", "medium", "high", "severe", "irreversible"];

function rankRisk(risk: CapabilityRisk): number {
  const idx = RISK_ORDER.indexOf(risk);
  return idx === -1 ? RISK_ORDER.length : idx;
}

function ruleMatches(rule: PolicyRule, capability: Capability, ctx: GuardianContext): boolean {
  if (rankRisk(capability.risk) < rankRisk(rule.riskFloor)) return false;
  if (rankRisk(capability.risk) > rankRisk(rule.riskCeiling)) return false;
  if (rule.tenantScope !== "any") {
    if (rule.tenantScope === "single" && capability.tenantScope === "cross") return false;
    if (rule.tenantScope === "single" && capability.tenantScope === "system") return false;
  }
  for (const required of rule.requiredAuthority) {
    if (!ctx.actor.authority.includes(required)) return false;
  }
  return true;
}

function flavorOf(verdict: PolicyVerdict): DecisionFlavor {
  switch (verdict) {
    case "ALLOW": return "allow";
    case "BLOCK": return "deny";
    case "REQUIRE_APPROVAL": return "escalate";
    case "WARN": return "soft-allow";
  }
}

function reasonCodeOf(rule: PolicyRule, verdict: PolicyVerdict): string {
  switch (verdict) {
    case "ALLOW": return `allow.rule.${rule.id}`;
    case "BLOCK": return `deny.rule.${rule.id}`;
    case "REQUIRE_APPROVAL": return `escalate.rule.${rule.id}`;
    case "WARN": return `soft-allow.rule.${rule.id}`;
  }
}

// ---------------------------------------------------------------------------
// Ordered evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate EVERY matching rule in declared order, then resolve precedence.
 *
 * Deterministic: the decisions array follows the policy's declared rule order
 * (never sorted, never shuffled); ties in precedence are broken by priority
 * then first-declared (resolvePrecedence's contract).
 *
 * Refuses (fail-closed):
 *  - `evaluate.missing-tenant`    — empty tenant scope on the context.
 *  - `evaluate.tenant-mismatch`   — policy tenant != context tenant (A8).
 *  - `evaluate.duplicate-rule-id` — malformed policy with a repeated rule id.
 *  - `evaluate.non-integer-priority` — malformed policy with a float priority
 *    (the no-floats law: outputs must be integer-only).
 */
export function evaluateRulesOrdered(
  policy: Policy,
  capability: Capability,
  ctx: GuardianContext,
): RuleEvaluationResult {
  if (ctx.tenant.tenantId === "") return { ok: false, reason: "evaluate.missing-tenant" };
  if (policy.tenantId !== ctx.tenant.tenantId) {
    return { ok: false, reason: "evaluate.tenant-mismatch" };
  }

  const seenRuleIds = new Set<string>();
  for (const rule of policy.rules) {
    if (seenRuleIds.has(rule.id)) return { ok: false, reason: "evaluate.duplicate-rule-id" };
    seenRuleIds.add(rule.id);
    if (!Number.isInteger(rule.priority)) return { ok: false, reason: "evaluate.non-integer-priority" };
  }

  const decisions: OrderedRuleDecision[] = [];
  for (const rule of policy.rules) {
    if (!ruleMatches(rule, capability, ctx)) continue;
    decisions.push({
      ruleId: rule.id,
      verdict: rule.verdict,
      flavor: flavorOf(rule.verdict),
      priority: rule.priority,
      reasonCode: reasonCodeOf(rule, rule.verdict),
      matchedFacts: [
        { fact: "rule.matched", value: rule.id },
        { fact: "risk.within_range", value: `${rule.riskFloor}..${rule.riskCeiling}` },
        { fact: "verdict", value: rule.verdict },
      ],
    });
  }

  const resolution = resolvePrecedence(
    decisions.map((d) => ({
      ruleId: d.ruleId as string,
      verdict: d.verdict,
      priority: d.priority,
    })),
  );

  return {
    ok: true,
    evaluation: {
      policyId: policy.id,
      policyVersion: policy.version,
      tenantId: ctx.tenant.tenantId,
      capabilityId: capability.id,
      decisions,
      resolution,
      inputsDigest: orderedInputsDigest(policy, capability, ctx, decisions),
    },
  };
}

/** Canonical digest over the evaluation inputs — byte-identical for identical inputs. */
export function orderedInputsDigest(
  policy: Policy,
  capability: Capability,
  ctx: GuardianContext,
  decisions: readonly OrderedRuleDecision[],
): string {
  const parts = [
    `policy=${policy.id}:${policy.version}`,
    `tenant=${ctx.tenant.tenantId}`,
    `capability=${capability.id}:${capability.version}`,
    `actor=${ctx.actor.actorId}:auto=${ctx.actor.isAutonomous ? "1" : "0"}`,
    `authority=${[...ctx.actor.authority].sort().join(",")}`,
    `rules=${decisions.map((d) => `${d.ruleId}:${d.verdict}:${d.priority}`).join(",")}`,
  ];
  return fnv1a(parts.join("|"));
}

// ---------------------------------------------------------------------------
// Decision audit refs — digest of inputs (law A13/A19)
// ---------------------------------------------------------------------------

export interface DecisionAuditRef {
  readonly auditRefId: string;
  readonly inputsDigest: string;
  readonly decisionCount: number;
  readonly resolvedVerdict: PolicyVerdict;
  readonly winningRuleId: string | null;
  /** Explicit time input — never wall-clock. */
  readonly evaluatedAt: number;
}

/**
 * Build the decision audit ref — the evidence pointer for a Guardian
 * adjudication. Deterministic: identical evaluation + identical `evaluatedAt`
 * => identical auditRefId.
 */
export function buildDecisionAuditRef(
  evaluation: OrderedRuleEvaluation,
  evaluatedAt: number,
): { readonly ok: true; readonly ref: DecisionAuditRef } | { readonly ok: false; reason: "audit.invalid-evaluated-at" } {
  if (!Number.isInteger(evaluatedAt) || evaluatedAt < 0) {
    return { ok: false, reason: "audit.invalid-evaluated-at" };
  }
  return {
    ok: true,
    ref: {
      auditRefId: `audit-${evaluation.inputsDigest}-${String(evaluatedAt)}`,
      inputsDigest: evaluation.inputsDigest,
      decisionCount: evaluation.decisions.length,
      resolvedVerdict: evaluation.resolution.verdict,
      winningRuleId: evaluation.resolution.winningRuleId,
      evaluatedAt,
    },
  };
}

/**
 * Determinism machine-test: two evaluations of the same inputs MUST produce
 * byte-identical evaluations (canonical serialization equality).
 */
export function verifyOrderedEvaluationDeterminism(
  policy: Policy,
  capability: Capability,
  ctx: GuardianContext,
): { readonly deterministic: boolean; readonly digest1: string; readonly digest2: string } {
  const a = evaluateRulesOrdered(policy, capability, ctx);
  const b = evaluateRulesOrdered(policy, capability, ctx);
  if (!a.ok || !b.ok) {
    const d1: string = !a.ok ? a.reason : "";
    const d2: string = !b.ok ? b.reason : "";
    return { deterministic: d1 === d2, digest1: d1, digest2: d2 };
  }
  return {
    deterministic: JSON.stringify(a.evaluation) === JSON.stringify(b.evaluation),
    digest1: a.evaluation.inputsDigest,
    digest2: b.evaluation.inputsDigest,
  };
}
