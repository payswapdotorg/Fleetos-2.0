/**
 * @fleetos/policy — Policy + PolicyEvaluation + GuardianDecision contracts.
 *
 * Law A5: Contract Guardian is the SOLE policy authority for consequential
 * actions and capability adoption. Agents, workflows and predictive models
 * cannot authorize themselves.
 *
 * Law A4: every consequential action follows
 *   propose -> authorize -> confirm -> dispatch -> execute -> verify -> record -> learn
 *
 * The reference Guardian is a pure, deterministic function — see guardian.ts.
 */

import type {
  AuthorityKind,
  Capability,
  CapabilityRisk,
  TenantScopeLike,
} from "./capability.ts";

/** Stable rule identifiers — machine-stable, never localized. */
export type PolicyRuleId =
  | "rule.allow_low_risk_read"
  | "rule.allow_observed_only"
  | "rule.allow_irreversible"
  | "rule.require_human_approval_for_high_risk"
  | "rule.block_irreversible_without_operator"
  | "rule.block_cross_tenant"
  | "rule.block_unknown_capability"
  | "rule.block_autonomous_self_authorize"
  | "rule.require_mission_owner_for_work"
  | "rule.require_asset_owner_for_device"
  | "rule.deny_degraded_context";

/** A single declarative policy rule. */
export interface PolicyRule {
  readonly id: PolicyRuleId;
  readonly description: string;
  readonly riskFloor: CapabilityRisk;
  readonly riskCeiling: CapabilityRisk;
  readonly requiredAuthority: readonly AuthorityKind[];
  readonly tenantScope: "single" | "cross" | "system" | "any";
  readonly verdict: PolicyVerdict;
  readonly priority: number;
}

/** A versioned policy bundle. */
export interface Policy {
  readonly id: string;
  readonly version: string;
  readonly tenantId: string;
  readonly rules: readonly PolicyRule[];
  readonly defaultVerdict: PolicyVerdict;
  /** If true, all unknown capabilities are blocked. */
  readonly failClosed: true;
}

/** Guardian verdict — machine-stable. */
export type PolicyVerdict = "ALLOW" | "WARN" | "REQUIRE_APPROVAL" | "BLOCK";

/** Reason codes are machine-stable strings — never localized, never reordered. */
export type GuardianReasonCode =
  | "allow.matched_rule"
  | "allow.low_risk_read"
  | "warn.degraded_context"
  | "warn.soft_policy"
  | "require_approval.high_risk"
  | "require_approval.missing_authority"
  | "require_approval.cross_tenant"
  | "block.irreversible"
  | "block.cross_tenant"
  | "block.unknown_capability"
  | "block.self_authorization"
  | "block.policy_fail_closed"
  | "block.no_matching_rule";

/** Context the Guardian consumes to render a decision. */
export interface GuardianContext {
  readonly tenant: TenantScopeLike;
  readonly capability: Capability;
  readonly actor: {
    readonly actorId: string;
    readonly authority: readonly AuthorityKind[];
    readonly isAutonomous: boolean;
  };
  readonly missionRef?: { readonly missionId: string; readonly runId?: string };
  readonly degraded: boolean;
}

/** Decision returned by the reference Guardian. */
export interface GuardianDecision {
  readonly verdict: PolicyVerdict;
  readonly reasonCode: GuardianReasonCode;
  readonly matchedRuleId: PolicyRuleId | null;
  readonly tenantId: string;
  readonly capabilityId: string;
  readonly conditions: readonly string[];
  /** Stable digest of inputs — byte-identical for byte-identical inputs. */
  readonly decisionDigest: string;
}

/**
 * PolicyEvaluation — the full record of evaluating a capability against a policy.
 * Persisted as evidence (law A13, A19).
 */
export interface PolicyEvaluation {
  readonly evaluationId: string;
  readonly policyId: string;
  readonly policyVersion: string;
  readonly tenantId: string;
  readonly capabilityId: string;
  readonly decision: GuardianDecision;
  readonly evaluatedAt: string;
  readonly inputsDigest: string;
}
