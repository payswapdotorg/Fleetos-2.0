/**
 * @fleetos/policy — Capability adoption authorization workflow.
 *
 * Law A5: capability adoption requires the Guardian path. Agents, workflows
 * and predictive models cannot self-authorize or self-adopt.
 *
 * Workflow:
 *   proposal (from learning/evaluation) -> Guardian decision -> adoption record
 *
 * The adoption record is produced ONLY by the Guardian path. There is no
 * `selfAdopt()` function. An authorization request whose actor kind is
 * agent/workflow/model WITHOUT an explicit human delegation chain is refused
 * with a machine-stable reason code (law A5, machine-tested).
 *
 * Pure types + pure functions only.
 */

import type { Capability, AuthorityKind } from "./capability.ts";
import type { Policy, GuardianDecision } from "./policy.ts";
import { evaluateCapability } from "./guardian.ts";

/** Actor kind — what kind of entity is requesting the adoption. */
export type ActorKind = "human" | "agent" | "workflow" | "model";

/**
 * Delegation chain — a human must be in the chain for non-human actors.
 *
 * Law A5: an authorization request whose actor kind is agent/workflow/model
 * without an explicit human delegation chain is refused. The chain is a
 * list of (actorId, kind) pairs from the original requester to the final
 * human approver.
 */
export interface DelegationChainEntry {
  readonly actorId: string;
  readonly kind: ActorKind;
  readonly delegatedAt: string;
}

/** Input to the adoption authorization workflow. */
export interface AdoptionAuthorizationRequest {
  readonly capability: Capability;
  readonly policy: Policy;
  readonly tenant: { readonly tenantId: string };
  readonly requestedBy: string;
  readonly requesterKind: ActorKind;
  readonly requesterAuthority: readonly AuthorityKind[];
  readonly delegationChain: readonly DelegationChainEntry[];
  readonly evaluationRef: string;
  readonly rationale: string;
}

/** The adoption record — produced only by a successful Guardian decision. */
export interface AdoptionRecord {
  readonly adoptionId: string;
  readonly proposalId: string;
  readonly capabilityId: string;
  readonly capabilityVersion: string;
  readonly tenantId: string;
  readonly evaluationRef: string;
  readonly guardianDecision: GuardianDecision;
  readonly adoptedAt: string;
  readonly conditions: readonly string[];
  readonly authorizedByKind: ActorKind;
  readonly delegationChainHash: string;
}

/** Refusal reason — machine-stable, for the A5 invariant. */
export type AdoptionRefusalReason =
  | "refused.self_authorization_no_human_chain"
  | "refused.self_authorization_delegation_chain_missing_human"
  | "refused.guardian_blocked"
  | "refused.guardian_require_approval_unmet"
  | "refused.tenant_mismatch"
  | "refused.empty_capability";

export type AdoptionAuthorizationResult =
  | { readonly ok: true; readonly record: AdoptionRecord }
  | { readonly ok: false; readonly reason: AdoptionRefusalReason; readonly decision: GuardianDecision };

/**
 * Check whether a delegation chain contains at least one human.
 *
 * Law A5: agents/workflows/models cannot self-authorize. A human must be in
 * the delegation chain for any non-human actor. This is the machine-tested
 * invariant.
 */
export function hasHumanDelegation(chain: readonly DelegationChainEntry[]): boolean {
  return chain.some((e) => e.kind === "human");
}

/** Stable hash of the delegation chain — for the adoption record. */
export function hashDelegationChain(chain: readonly DelegationChainEntry[]): string {
  const parts = chain.map((e) => `${e.actorId}:${e.kind}`).join("->");
  let h = 0x811c9dc5;
  for (let i = 0; i < parts.length; i += 1) {
    h ^= parts.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * Authorize a capability adoption — the Guardian path.
 *
 * Law A5 (machine-tested): an authorization request whose actor kind is
 * agent/workflow/model WITHOUT an explicit human delegation chain is refused
 * with reason "refused.self_authorization_no_human_chain" or
 * "refused.self_authorization_delegation_chain_missing_human".
 *
 * The adoption NEVER self-executes — this function returns a record, it does
 * not install the capability into any store. The control plane (TL-owned)
 * performs the actual installation after reading the adoption record.
 *
 * Deterministic: same inputs => same output.
 */
export function authorizeAdoptionWorkflow(
  request: AdoptionAuthorizationRequest,
  now: string = "1970-01-01T00:00:00.000Z",
): AdoptionAuthorizationResult {
  // Empty capability check.
  if (request.capability.id === "" || request.capability.version === "") {
    return {
      ok: false,
      reason: "refused.empty_capability",
      decision: {
        verdict: "BLOCK",
        reasonCode: "block.unknown_capability",
        matchedRuleId: null,
        tenantId: request.tenant.tenantId,
        capabilityId: request.capability.id,
        conditions: [],
        decisionDigest: "empty",
      },
    };
  }

  // Tenant match check.
  if (request.policy.tenantId !== request.tenant.tenantId) {
    return {
      ok: false,
      reason: "refused.tenant_mismatch",
      decision: {
        verdict: "BLOCK",
        reasonCode: "block.cross_tenant",
        matchedRuleId: null,
        tenantId: request.tenant.tenantId,
        capabilityId: request.capability.id,
        conditions: ["policy.tenantId != request.tenant.tenantId"],
        decisionDigest: "tenant_mismatch",
      },
    };
  }

  // A5: non-human actors MUST have a human in the delegation chain.
  if (request.requesterKind !== "human") {
    if (request.delegationChain.length === 0) {
      return {
        ok: false,
        reason: "refused.self_authorization_no_human_chain",
        decision: {
          verdict: "BLOCK",
          reasonCode: "block.self_authorization",
          matchedRuleId: null,
          tenantId: request.tenant.tenantId,
          capabilityId: request.capability.id,
          conditions: ["non-human actor with empty delegation chain"],
          decisionDigest: "no_human_chain",
        },
      };
    }
    if (!hasHumanDelegation(request.delegationChain)) {
      return {
        ok: false,
        reason: "refused.self_authorization_delegation_chain_missing_human",
        decision: {
          verdict: "BLOCK",
          reasonCode: "block.self_authorization",
          matchedRuleId: null,
          tenantId: request.tenant.tenantId,
          capabilityId: request.capability.id,
          conditions: ["delegation chain has no human entry"],
          decisionDigest: "missing_human_in_chain",
        },
      };
    }
  }

  // Guardian decision.
  const decision = evaluateCapability(request.policy, request.capability, {
    tenant: request.tenant,
    capability: request.capability,
    actor: {
      actorId: request.requestedBy,
      authority: request.requesterAuthority,
      isAutonomous: request.requesterKind !== "human",
    },
    degraded: false,
  });

  // Refuse if Guardian blocked.
  if (decision.verdict === "BLOCK") {
    return { ok: false, reason: "refused.guardian_blocked", decision };
  }

  // Refuse if Guardian requires approval and the actor is non-human without
  // human.approval in their authority.
  if (decision.verdict === "REQUIRE_APPROVAL") {
    if (request.requesterKind !== "human" && !request.requesterAuthority.includes("human.approval")) {
      return { ok: false, reason: "refused.guardian_require_approval_unmet", decision };
    }
  }

  // Success — produce the adoption record.
  const record: AdoptionRecord = {
    adoptionId: `adopt-${request.capability.id}-${decision.decisionDigest.slice(0, 12)}`,
    proposalId: `prop-${request.capability.id}-${request.capability.version}`,
    capabilityId: request.capability.id,
    capabilityVersion: request.capability.version,
    tenantId: request.tenant.tenantId,
    evaluationRef: request.evaluationRef,
    guardianDecision: decision,
    adoptedAt: now,
    conditions: decision.conditions,
    authorizedByKind: request.requesterKind,
    delegationChainHash: hashDelegationChain(request.delegationChain),
  };

  return { ok: true, record };
}

/**
 * Machine-testable assertion: the adoption package exports NO function that
 * self-executes an adoption. The only way to produce an AdoptionRecord is
 * through authorizeAdoptionWorkflow, which requires a Guardian decision.
 *
 * This function is a runtime probe — it verifies that the module surface
 * contains no "selfAdopt" or "autoAdopt" or "execute" functions.
 */
export function assertNoSelfExecutionPath(moduleExports: Record<string, unknown>): {
  readonly ok: boolean;
  readonly forbidden: readonly string[];
} {
  const FORBIDDEN = ["selfAdopt", "autoAdopt", "execute", "install", "activate"];
  const found = FORBIDDEN.filter((name) => typeof moduleExports[name] === "function");
  return { ok: found.length === 0, forbidden: found };
}
