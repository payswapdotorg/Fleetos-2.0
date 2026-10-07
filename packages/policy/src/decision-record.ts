/**
 * @fleetos/policy — Decision records with full justification chains.
 *
 * Law A13: every consequential operation is traceable through evidence to
 * actor, intent, authorization, execution, verification, capability/model
 * version. DecisionRecord carries the authorization leg of that chain.
 *
 * Law A19: append-only, tenant-scoped, hash-verifiable.
 *
 * Pure types + pure functions only.
 */

import type { GuardianDecision, PolicyVerdict } from "./policy.ts";
import type { Capability } from "./capability.ts";

/** A single matched fact that contributed to the decision. */
export interface JustificationFact {
  /** Machine-stable fact key — e.g. "rule.matched", "risk.within_range". */
  readonly fact: string;
  /** Stringified value — e.g. "rule.allow_low_risk_read", "medium". */
  readonly value: string;
}

/**
 * Decision record — the full, self-contained authorization record.
 *
 * Carries: rule id, matched facts, tenant scope, capability version — the
 * complete justification chain for a Guardian decision. Persisted as evidence
 * (law A13) and appended to the decision ledger (law A19).
 */
export interface DecisionRecord {
  readonly recordId: string;
  readonly decision: GuardianDecision;
  readonly policyId: string;
  readonly policyVersion: string;
  readonly tenantId: string;
  readonly capabilityId: string;
  readonly capabilityVersion: string;
  readonly actorId: string;
  readonly actorIsAutonomous: boolean;
  readonly actorAuthority: readonly string[];
  readonly matchedFacts: readonly JustificationFact[];
  readonly evaluatedAt: string;
  /** Stable digest over the canonical record fields — for dedup/ledger. */
  readonly recordDigest: string;
}

/** Build a DecisionRecord from a Guardian decision + context. Pure. */
export function buildDecisionRecord(
  decision: GuardianDecision,
  context: {
    readonly policyId: string;
    readonly policyVersion: string;
    readonly capability: Capability;
    readonly actorId: string;
    readonly actorIsAutonomous: boolean;
    readonly actorAuthority: readonly string[];
    readonly evaluatedAt: string;
    readonly matchedFacts: readonly JustificationFact[];
  },
): DecisionRecord {
  return {
    recordId: `rec-${decision.capabilityId}-${decision.decisionDigest.slice(0, 16)}`,
    decision,
    policyId: context.policyId,
    policyVersion: context.policyVersion,
    tenantId: decision.tenantId,
    capabilityId: decision.capabilityId,
    capabilityVersion: context.capability.version,
    actorId: context.actorId,
    actorIsAutonomous: context.actorIsAutonomous,
    actorAuthority: context.actorAuthority,
    matchedFacts: context.matchedFacts,
    evaluatedAt: context.evaluatedAt,
    recordDigest: computeRecordDigest(decision, context),
  };
}

/**
 * Stable digest of a decision record — FNV-1a over canonical fields.
 * Same inputs => same digest, byte-identical. NOT cryptographically secure;
 * for content-addressed evidence digests use @fleetos/evidence#sha256Hex.
 */
export function computeRecordDigest(
  decision: GuardianDecision,
  context: {
    readonly policyId: string;
    readonly policyVersion: string;
    readonly capability: Capability;
    readonly actorId: string;
    readonly actorIsAutonomous: boolean;
    readonly actorAuthority: readonly string[];
    readonly evaluatedAt: string;
  },
): string {
  const parts = [
    `policy=${context.policyId}:${context.policyVersion}`,
    `tenant=${decision.tenantId}`,
    `capability=${decision.capabilityId}:${context.capability.version}`,
    `actor=${context.actorId}:auto=${context.actorIsAutonomous ? "1" : "0"}`,
    `verdict=${decision.verdict}`,
    `reason=${decision.reasonCode}`,
    `rule=${decision.matchedRuleId ?? "none"}`,
    `at=${context.evaluatedAt}`,
    `auth=${[...context.actorAuthority].sort().join(",")}`,
  ];
  return fnv1a(parts.join("|"));
}

/** FNV-1a 32-bit — deterministic, no crypto dep. */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * Verdict precedence — the core of deterministic rule evaluation.
 *
 * Deny-overrides-allow is the default: if ANY matching rule produces BLOCK
 * or REQUIRE_APPROVAL, that verdict wins over ALLOW/WARN. A rule may declare
 * explicit precedence to override this (rare, e.g. an operator override that
 * explicitly allows despite a deny rule).
 */
export type PrecedenceMode = "deny_overrides_allow" | "explicit_override";

/** The outcome of a precedence-resolved evaluation. */
export interface PrecedenceResolution {
  readonly verdict: PolicyVerdict;
  readonly winningRuleId: string | null;
  readonly mode: PrecedenceMode;
  readonly conflictingVerdicts: readonly PolicyVerdict[];
  readonly reason: string;
}

/**
 * Resolve conflicting rule verdicts with deterministic precedence.
 *
 * Default mode (deny_overrides_allow):
 *   - BLOCK > REQUIRE_APPROVAL > WARN > ALLOW (most restrictive wins).
 *
 * Explicit override mode:
 *   - The rule with `explicitOverride: true` and highest priority wins,
 *     regardless of deny rules. This is the escape hatch for operator
 *     overrides. It is intentionally rare and audited.
 *
 * Deterministic: same inputs => same output. No time/random.
 */
export function resolvePrecedence(
  matchedVerdicts: readonly {
    readonly ruleId: string;
    readonly verdict: PolicyVerdict;
    readonly priority: number;
    readonly explicitOverride?: boolean;
  }[],
): PrecedenceResolution {
  if (matchedVerdicts.length === 0) {
    return {
      verdict: "BLOCK",
      winningRuleId: null,
      mode: "deny_overrides_allow",
      conflictingVerdicts: [],
      reason: "no matching rules; fail-closed default",
    };
  }

  // Check for explicit override — highest priority override wins.
  const overrides = matchedVerdicts.filter((m) => m.explicitOverride === true);
  if (overrides.length > 0) {
    const winner = overrides.reduce((best, cur) =>
      cur.priority > best.priority ? cur : best,
    );
    return {
      verdict: winner.verdict,
      winningRuleId: winner.ruleId,
      mode: "explicit_override",
      conflictingVerdicts: matchedVerdicts.map((m) => m.verdict),
      reason: `explicit override by ${winner.ruleId} (priority ${winner.priority})`,
    };
  }

  // Deny-overrides-allow: most restrictive verdict wins.
  const VERDICT_RANK: Record<PolicyVerdict, number> = {
    BLOCK: 3,
    REQUIRE_APPROVAL: 2,
    WARN: 1,
    ALLOW: 0,
  };

  const sorted = [...matchedVerdicts].sort((a, b) => {
    const vr = VERDICT_RANK[b.verdict] - VERDICT_RANK[a.verdict];
    if (vr !== 0) return vr;
    return b.priority - a.priority;
  });

  const winner = sorted[0]!;
  const conflicting = matchedVerdicts.map((m) => m.verdict);
  const hasConflict = new Set(conflicting).size > 1;

  return {
    verdict: winner.verdict,
    winningRuleId: winner.ruleId,
    mode: "deny_overrides_allow",
    conflictingVerdicts: conflicting,
    reason: hasConflict
      ? `deny-overrides-allow: ${winner.verdict} from ${winner.ruleId} (most restrictive)`
      : `unanimous ${winner.verdict} from ${winner.ruleId}`,
  };
}
