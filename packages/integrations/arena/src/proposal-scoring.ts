/**
 * @fleetos/integrations/arena — Proposal scoring over run results (Wave 5, F250B).
 *
 * A FIXED deterministic ladder — no learned weights, no thresholds from
 * data. Classifies an evaluation-run proposal's confidence as
 * `high | medium | low | insufficient-evidence` from integer-bps scoring:
 *
 *   - insufficient-evidence: caseCount < MIN_CASES_FOR_EVIDENCE
 *                            or confidenceBps < MIN_CONFIDENCE_BPS
 *   - high:   passRateBps >= 9000 AND confidenceBps >= 8000
 *   - medium: passRateBps >= 7500 AND confidenceBps >= 6000
 *   - low:    everything above the evidence floor
 *
 * Fail-closed on empty/partial case sets via the HONEST DEGRADED vocabulary
 * (`ArenaDegradedState` — extended in this work item, never duplicated):
 * runs that were never scored, or scored over an empty set, degrade rather
 * than producing a made-up tier.
 *
 * Tie-breaks are stable and total: tier rank -> passRateBps desc ->
 * confidenceBps desc -> proposalId asc.
 */

import type { CapabilityVersionRef } from "./index.ts";
import type { ArenaDegradedState } from "./degraded.ts";
import type { EvaluationRun } from "./evaluation-runs.ts";
import { fnv1a } from "./case-registry.ts";

/** Fixed deterministic ladder constants (integer bps — no learned weights). */
export const SCORING_LADDER = {
  /** Below this case count there is insufficient evidence for any tier. */
  minCasesForEvidence: 5,
  minConfidenceBps: 6000,
  highPassRateBps: 9000,
  highConfidenceBps: 8000,
  mediumPassRateBps: 7500,
  mediumConfidenceBps: 6000,
} as const;

export type ProposalConfidence = "high" | "medium" | "low" | "insufficient-evidence";

/** The scored proposal — the arena's advisory evaluation of a capability. */
export interface ScoredProposal {
  readonly kind: "ARENA_SCORED_PROPOSAL";
  readonly advisory: true;
  readonly proposalId: string;
  readonly runId: string;
  readonly tenantId: string;
  readonly capability: CapabilityVersionRef;
  readonly caseCount: number;
  readonly passRateBps: number;
  readonly confidenceBps: number;
  readonly confidence: ProposalConfidence;
  readonly rationale: string;
  readonly scoredAtMs: number;
  /** Deterministic digest over the scored identity (FNV-1a). */
  readonly scoreDigest: string;
}

export type ScoreProposalResult =
  | { readonly ok: true; readonly scored: ScoredProposal }
  | { readonly ok: false; readonly degraded: ArenaDegradedState; readonly reason: string };

export interface RankFailure {
  readonly ok: false;
  readonly code: "duplicate-proposal-id" | "empty-ranking";
  readonly reason: string;
}

export type RankResult =
  | { readonly ok: true; readonly ranked: readonly ScoredProposal[] }
  | RankFailure;

const TIER_RANK: Readonly<Record<ProposalConfidence, number>> = {
  high: 0,
  medium: 1,
  low: 2,
  "insufficient-evidence": 3,
};

/**
 * Score ONE run's proposal against the fixed ladder.
 *
 * Fail-closed (honest degraded states, extended vocabulary):
 *   - run_not_scored: the run has no scoring yet (null).
 *   - empty_case_set: scored over zero cases.
 *   - insufficient_evidence: below the evidence floor (still a scored
 *     proposal — classified, not an error).
 */
export function scoreRunProposal(run: EvaluationRun, scoredAtMs: number): ScoreProposalResult {
  if (run.proposal === null || run.scoring === null) {
    return { ok: false, degraded: "run_not_scored", reason: "run has not been scored — nothing to rank" };
  }
  if (!Number.isInteger(scoredAtMs) || scoredAtMs < 0) {
    return { ok: false, degraded: "run_not_scored", reason: "scoredAtMs must be an integer >= 0 (logical ms)" };
  }
  const { total, passRateBps, confidenceBps } = run.scoring;
  if (total === 0) {
    return { ok: false, degraded: "empty_case_set", reason: "run was scored over an empty case set" };
  }
  let confidence: ProposalConfidence;
  let rationale: string;
  if (total < SCORING_LADDER.minCasesForEvidence || confidenceBps < SCORING_LADDER.minConfidenceBps) {
    confidence = "insufficient-evidence";
    rationale = `insufficient evidence: ${total} case(s) (< ${SCORING_LADDER.minCasesForEvidence}) or confidence ${confidenceBps}bps (< ${SCORING_LADDER.minConfidenceBps})`;
  } else if (passRateBps >= SCORING_LADDER.highPassRateBps && confidenceBps >= SCORING_LADDER.highConfidenceBps) {
    confidence = "high";
    rationale = `pass ${passRateBps}bps >= ${SCORING_LADDER.highPassRateBps} and confidence ${confidenceBps}bps >= ${SCORING_LADDER.highConfidenceBps} over ${total} cases`;
  } else if (passRateBps >= SCORING_LADDER.mediumPassRateBps && confidenceBps >= SCORING_LADDER.mediumConfidenceBps) {
    confidence = "medium";
    rationale = `pass ${passRateBps}bps >= ${SCORING_LADDER.mediumPassRateBps} and confidence ${confidenceBps}bps >= ${SCORING_LADDER.mediumConfidenceBps} over ${total} cases`;
  } else {
    confidence = "low";
    rationale = `pass ${passRateBps}bps / confidence ${confidenceBps}bps over ${total} cases below medium thresholds`;
  }
  const proposal = run.proposal;
  return {
    ok: true,
    scored: {
      kind: "ARENA_SCORED_PROPOSAL",
      advisory: true,
      proposalId: proposal.proposalId,
      runId: proposal.runId,
      tenantId: proposal.tenantId,
      capability: proposal.capability,
      caseCount: proposal.caseCount,
      passRateBps,
      confidenceBps,
      confidence,
      rationale,
      scoredAtMs,
      scoreDigest: fnv1a(`propscore|v1|${proposal.proposalId}|${confidence}|${scoredAtMs}`),
    },
  };
}

/**
 * Rank scored proposals with STABLE tie-breaks. The order is total and
 * deterministic: confidence tier -> passRateBps desc -> confidenceBps desc
 * -> proposalId asc. Duplicate proposalIds are rejected fail-closed (a
 * ranking must never silently merge identities).
 */
export function rankProposals(proposals: readonly ScoredProposal[]): RankResult {
  if (proposals.length === 0) {
    return { ok: false, code: "empty-ranking", reason: "no scored proposals to rank" };
  }
  const ids = new Set<string>();
  for (const p of proposals) {
    if (ids.has(p.proposalId)) {
      return { ok: false, code: "duplicate-proposal-id", reason: `proposalId "${p.proposalId}" appears twice` };
    }
    ids.add(p.proposalId);
  }
  const ranked = [...proposals].sort((a, b) => {
    const tr = TIER_RANK[a.confidence] - TIER_RANK[b.confidence];
    if (tr !== 0) return tr;
    if (a.passRateBps !== b.passRateBps) return b.passRateBps - a.passRateBps;
    if (a.confidenceBps !== b.confidenceBps) return b.confidenceBps - a.confidenceBps;
    return a.proposalId < b.proposalId ? -1 : a.proposalId > b.proposalId ? 1 : 0;
  });
  return { ok: true, ranked };
}
