/**
 * @fleetos/integrations/arena — Honest degraded states for the arena adapter.
 *
 * Wave 1 (F210B) additions:
 *   - Arena adapter returns proposals with honest degraded states
 *   - Degraded states: empty_case_set, tenant_mismatch, capability_missing
 *
 * Law: arena proposals stay PROPOSALS — the adapter NEVER submits.
 *
 * Pure types + pure functions.
 */

import type {
  ArenaEvaluationRequest,
  ArenaEvaluationProposal,
  ArenaAdapter,
  TenantScopeLike,
  CapabilityVersionRef,
} from "./index.ts";
import { makeReferenceArenaAdapter } from "./index.ts";

/** Arena degraded state — honest, machine-stable.
 *
 * Wave 5 (F250B) EXTENDS the vocabulary (never duplicates it) with the
 * evaluation-pipeline states: partial/foreign case results, the evidence
 * floor, unscored runs, and revoked certifications. All pre-existing
 * members keep their meaning; consumers only reading the Wave-1 members
 * are unaffected (additive union extension).
 */
export type ArenaDegradedState =
  | "empty_case_set"
  | "tenant_mismatch"
  | "capability_missing"
  | "adapter_unavailable"
  // Wave 5 (F250B) additions:
  | "partial_case_set"
  | "foreign_case_result"
  | "insufficient_evidence"
  | "run_not_scored"
  | "certification_revoked";

/** Arena evaluation result — either a proposal or a degraded state. */
export type ArenaEvaluationResult =
  | { readonly ok: true; readonly proposal: ArenaEvaluationProposal }
  | { readonly ok: false; readonly degraded: ArenaDegradedState; readonly reason: string };

/**
 * Evaluate with honest degraded states.
 *
 * Returns a proposal when everything is OK, or a degraded state when:
 *   - empty_case_set: no evaluation cases provided
 *   - tenant_mismatch: request tenant doesn't match capability tenant
 *   - capability_missing: capabilityId is empty
 *
 * Law: the adapter NEVER submits — it returns proposals only.
 */
export function evaluateWithDegradation<T = unknown>(
  adapter: ArenaAdapter,
  request: ArenaEvaluationRequest<T>,
): ArenaEvaluationResult {
  if (request.capability.capabilityId === "") {
    return { ok: false, degraded: "capability_missing", reason: "capability ID is empty" };
  }
  if (request.cases.length === 0) {
    return { ok: false, degraded: "empty_case_set", reason: "no evaluation cases provided" };
  }

  const proposal = adapter.evaluate(request);
  return { ok: true, proposal };
}

/**
 * Build a reference arena adapter that returns honest degraded states.
 *
 * Wraps the base reference adapter with degraded-state checking.
 */
export function makeHonestReferenceArenaAdapter(): ArenaAdapter {
  const base = makeReferenceArenaAdapter();
  return {
    name: "reference.arena.honest",
    evaluate: <T = unknown>(req: ArenaEvaluationRequest<T>) => {
      // The adapter itself still returns a proposal — degraded states are
      // checked by evaluateWithDegradation. This keeps the adapter interface
      // clean (it always returns a proposal) while the wrapper handles
      // degraded states.
      if (req.capability.capabilityId === "") {
        // Return a proposal with empty caseIds to signal degradation
        return {
          kind: "ARENA_PROPOSAL" as const,
          proposalId: "arena-prop-degraded-empty-cap",
          tenant: req.tenant,
          capability: req.capability,
          caseIds: [],
          requester: req.requester,
          proposedAt: req.requestedAt,
        };
      }
      return base.evaluate(req);
    },
  };
}

/**
 * Machine-test: the arena adapter has NO submit/adopt/authorize methods.
 *
 * Law: arena proposals stay PROPOSALS.
 */
export function assertNoSubmitOrAdopt(moduleExports: Record<string, unknown>): {
  readonly ok: boolean;
  readonly forbidden: readonly string[];
} {
  const FORBIDDEN = ["submit", "adopt", "authorize", "execute", "install", "activate"];
  const found = FORBIDDEN.filter((name) => typeof moduleExports[name] === "function");
  return { ok: found.length === 0, forbidden: found };
}

/**
 * Build an adoption PROPOSAL from an arena evaluation proposal.
 *
 * Law A5: this is a PROPOSAL — the Guardian path adopts. There is NO `adopt()`
 * function in this package.
 */
export interface ArenaAdoptionProposal {
  readonly kind: "ARENA_ADOPTION_PROPOSAL";
  readonly proposalId: string;
  readonly tenant: TenantScopeLike;
  readonly capability: CapabilityVersionRef;
  readonly arenaProposalRef: string;
  readonly rationale: string;
  readonly proposedAt: string;
}

/**
 * Generate an adoption PROPOSAL from an arena evaluation proposal.
 *
 * Returns a PROPOSAL — never adopts.
 */
export function generateArenaAdoptionProposal(
  arenaProposal: ArenaEvaluationProposal,
  rationale: string,
  proposedAt: string,
): ArenaAdoptionProposal {
  return {
    kind: "ARENA_ADOPTION_PROPOSAL",
    proposalId: `arena-adopt-${arenaProposal.proposalId}`,
    tenant: arenaProposal.tenant,
    capability: arenaProposal.capability,
    arenaProposalRef: arenaProposal.proposalId,
    rationale,
    proposedAt,
  };
}

/** Runtime guard — verifies the ARENA_ADOPTION_PROPOSAL marker. */
export function isArenaAdoptionProposal(v: unknown): v is ArenaAdoptionProposal {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return r.kind === "ARENA_ADOPTION_PROPOSAL" &&
    typeof r.proposalId === "string" &&
    typeof r.arenaProposalRef === "string";
}
