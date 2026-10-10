/**
 * F321B journey — outcome evaluation and adoption (persona: ml-engineer).
 *
 * An ML engineer drives the REAL learning surface from observed outcomes to
 * an adoption decision (@fleetos/learning outcome-intake/join/
 * adoption-lifecycle — Wave 5):
 *   - intakeOutcomes validates + dedupes by deterministic digest; an
 *     observationId submitted twice with DIFFERENT content rejects the whole
 *     batch (identity conflict, never silently overwritten);
 *   - joinOutcomesWithPredictions enforces the horizon discipline: a
 *     prediction is not joined as mature before predictedAt + horizonMs,
 *     and numeric errors are computed exactly;
 *   - computeEvaluationSummary aggregates mature/observed/predicted counts,
 *     mean error and coverage;
 *   - generateAdoptionProposalFromEvaluation emits a PROPOSAL only when the
 *     success threshold is met — below threshold it returns null with the
 *     honest reason (law A5: the Guardian path adopts, never the model);
 *   - the honest refusal paths of the adoption lifecycle: rejecting from
 *     "proposed" is an ILLEGAL transition (Guardian review first), and a
 *     withdrawn proposal is terminal.
 *
 * Determinism: fixed logical epochs (BASE_MS offsets via pure isoOfEpochMs);
 * no clock, no randomness, no network. Distinct from security.learn-from-
 * outcomes (which drives evaluateCapability/proposeAdoption/authorize/
 * complete/cascade): this journey drives the intake/join/summary surface
 * and the reject/withdraw arms.
 */

import type { AcceptanceJourney } from "../journey-contracts.ts";
import {
  beginGuardianReview,
  computeEvaluationSummary,
  generateAdoptionProposalFromEvaluation,
  intakeOutcomes,
  joinOutcomesWithPredictions,
  openAdoptionLifecycle,
  rejectAdoption,
  withdrawAdoption,
} from "@fleetos/learning";
import type { EvaluationCase, OutcomeIntakeCandidate, OutcomeObservation, PredictedRef } from "@fleetos/learning";
import { BASE_MS, TENANT, isoOfEpochMs } from "./fixture-world.ts";

const CAPABILITY = { capabilityId: "fleetos.asset.read-state", version: "1.0.0" } as const;
const OBSERVED_AT = isoOfEpochMs(BASE_MS + 600_000);
const JOINED_AT = isoOfEpochMs(BASE_MS + 900_000);
const PROPOSED_AT = isoOfEpochMs(BASE_MS + 1_000_000);

function caseOf(caseId: string, expected: number): EvaluationCase<number> {
  return {
    caseId,
    tenant: TENANT,
    capability: CAPABILITY,
    inputs: { assetId: "pump-7" },
    expected,
    description: `evaluation case ${caseId}`,
    tags: ["f321b"],
  };
}

function observation(observationId: string, caseId: string, actual: number, success: boolean): OutcomeObservation<number> {
  return {
    observationId,
    caseId,
    actual,
    observedAt: OBSERVED_AT,
    observationRef: `obs-${observationId}`,
    success,
  };
}

function candidate(observationId: string, caseId: string, actual: number, success: boolean, observedAtMs: number): OutcomeIntakeCandidate<number> {
  return {
    observationId,
    caseId,
    capability: CAPABILITY,
    actual,
    observedAtMs,
    observationRef: `obs-${observationId}`,
    success,
  };
}

const CASES: readonly EvaluationCase<number>[] = [
  caseOf("case-ea-1", 40),
  caseOf("case-ea-2", 50),
  caseOf("case-ea-3", 60),
  caseOf("case-ea-4", 70),
  caseOf("case-ea-5", 80),
];

/** 4 of 5 succeed (0.8 — exactly at threshold); case 3 fails. */
const OUTCOMES: readonly OutcomeObservation<number>[] = [
  observation("ea-obs-1", "case-ea-1", 41, true),
  observation("ea-obs-2", "case-ea-2", 49, true),
  observation("ea-obs-3", "case-ea-3", 12, false),
  observation("ea-obs-4", "case-ea-4", 72, true),
  observation("ea-obs-5", "case-ea-5", 79, true),
];

/** Predictions: two mature at JOINED_AT (long horizons), one not yet. */
const PREDICTIONS: readonly PredictedRef[] = [
  { predictionId: "pred-case-ea-1", predictedAt: isoOfEpochMs(BASE_MS + 100_000), predictedValue: 40, horizonMs: 300_000 },
  { predictionId: "pred-case-ea-2", predictedAt: isoOfEpochMs(BASE_MS + 100_000), predictedValue: 48, horizonMs: 800_000 },
  { predictionId: "pred-case-ea-4", predictedAt: isoOfEpochMs(BASE_MS + 100_000), predictedValue: 75, horizonMs: 1_000_000 },
];

export const evaluationAdoptionJourney: AcceptanceJourney = {
  journeyId: "security.outcome-evaluation-adoption",
  persona: "ml-engineer",
  capabilities: ["learning-from-outcomes"],
  goal: "Turn observed outcomes into an honest evaluation, an adoption proposal and an honest rejection",
  steps: [
    {
      stepId: "outcome-intake",
      kind: "intake",
      description: "Intake outcome observations: dedupe by digest; reject identity conflicts and invalid times fail-closed",
      packages: ["@fleetos/learning"],
      operations: ["intakeOutcomes"],
      run: (ctx) => {
        const accepted = intakeOutcomes(
          [
            candidate("ea-obs-1", "case-ea-1", 41, true, BASE_MS + 600_000),
            candidate("ea-obs-2", "case-ea-2", 49, true, BASE_MS + 610_000),
            // Exact duplicate (same digest) — dropped, reported.
            candidate("ea-obs-1", "case-ea-1", 41, true, BASE_MS + 600_000),
            candidate("ea-obs-3", "case-ea-3", 12, false, BASE_MS + 620_000),
            candidate("ea-obs-4", "case-ea-4", 72, true, BASE_MS + 630_000),
            candidate("ea-obs-5", "case-ea-5", 79, true, BASE_MS + 640_000),
          ],
          TENANT,
        );
        if (!accepted.ok) throw new Error(`intake refused: ${accepted.code}`);
        ctx.record("intake.acceptedCount", accepted.observations.length);
        ctx.record("intake.duplicates", accepted.duplicates);
        ctx.record("intake.tenantId", accepted.tenantId);
        const first = accepted.observations[0];
        ctx.record("intake.first.observationId", first?.observationId ?? "none");
        ctx.record("intake.first.digestLength", (first?.observationDigest ?? "").length);
        ctx.record("intake.sortedByTime", accepted.observations.map((o) => o.observationId));

        // NEGATIVE: the same observationId with DIFFERENT content rejects
        // the whole batch (identity conflict — never silently overwritten).
        const conflict = intakeOutcomes(
          [
            candidate("ea-obs-1", "case-ea-1", 41, true, BASE_MS + 600_000),
            candidate("ea-obs-1", "case-ea-1", 99, true, BASE_MS + 600_000),
          ],
          TENANT,
        );
        ctx.record("intake.conflictOk", conflict.ok);
        ctx.record("intake.conflictCode", conflict.ok ? "unexpected-accept" : conflict.code);

        // NEGATIVE: an invalid observedAtMs rejects the batch.
        const invalidTime = intakeOutcomes([candidate("ea-obs-9", "case-ea-9", 1, true, -5)], TENANT);
        ctx.record("intake.invalidTimeOk", invalidTime.ok);
        ctx.record("intake.invalidTimeCode", invalidTime.ok ? "unexpected-accept" : invalidTime.code);

        // NEGATIVE: an empty tenant rejects the batch.
        const noTenant = intakeOutcomes([candidate("ea-obs-1", "case-ea-1", 41, true, BASE_MS)], { tenantId: "" });
        ctx.record("intake.noTenantOk", noTenant.ok);
        ctx.record("intake.noTenantCode", noTenant.ok ? "unexpected-accept" : noTenant.code);
      },
    },
    {
      stepId: "join-and-summarize",
      kind: "evaluation",
      description: "Join outcomes with predictions under horizon discipline and compute the evaluation summary",
      packages: ["@fleetos/learning"],
      operations: ["joinOutcomesWithPredictions", "computeEvaluationSummary"],
      run: (ctx) => {
        const joined = joinOutcomesWithPredictions(CASES, OUTCOMES, PREDICTIONS, JOINED_AT);
        ctx.record("join.caseCount", joined.length);
        const j1 = joined.find((j) => j.caseId === "case-ea-1");
        const j2 = joined.find((j) => j.caseId === "case-ea-2");
        const j3 = joined.find((j) => j.caseId === "case-ea-3");
        const j4 = joined.find((j) => j.caseId === "case-ea-4");
        if (j1 === undefined || j2 === undefined || j3 === undefined || j4 === undefined) {
          throw new Error("joined cases missing");
        }
        // case-ea-1: horizon 300s from +100s => mature at +900s.
        ctx.record("join.case1.mature", j1.mature);
        ctx.record("join.case1.error", j1.error);
        ctx.record("join.case1.predictedValue", j1.predicted === null || typeof j1.predicted.predictedValue !== "number" ? null : j1.predicted.predictedValue);
        // case-ea-2: horizon 800s from +100s => matures at +900s — NOT at JOINED_AT (+900s)?
        ctx.record("join.case2.mature", j2.mature);
        // case-ea-3: NO prediction — never mature, no error.
        ctx.record("join.case3.mature", j3.mature);
        ctx.record("join.case3.error", j3.error);
        ctx.record("join.case3.predicted", j3.predicted === null ? null : "unexpected-prediction");
        // case-ea-4: horizon 1000s => not mature yet.
        ctx.record("join.case4.mature", j4.mature);
        ctx.record("join.case4.error", j4.error);
        ctx.record("join.joinedAt", j1.joinedAt);

        const summary = computeEvaluationSummary(joined);
        ctx.record("summary.totalCases", summary.totalCases);
        ctx.record("summary.matureCount", summary.matureCount);
        ctx.record("summary.observedCount", summary.observedCount);
        ctx.record("summary.predictedCount", summary.predictedCount);
        ctx.record("summary.meanError", summary.meanError);
        ctx.record("summary.coverage", summary.coverage);
      },
    },
    {
      stepId: "proposal-and-refusals",
      kind: "lifecycle",
      description: "Generate the adoption proposal at threshold, refuse below threshold, and drive the honest reject/withdraw arms",
      packages: ["@fleetos/learning"],
      operations: ["generateAdoptionProposalFromEvaluation", "openAdoptionLifecycle", "beginGuardianReview", "rejectAdoption", "withdrawAdoption"],
      run: (ctx) => {
        // AT threshold (0.8): the proposal is emitted — a PROPOSAL, never an adoption.
        const atThreshold = generateAdoptionProposalFromEvaluation(
          CASES, OUTCOMES, TENANT, CAPABILITY, "ml-engineer-riley", PROPOSED_AT, 0.8,
        );
        if (atThreshold.proposal === null) throw new Error(`threshold proposal refused: ${atThreshold.reason}`);
        ctx.record("proposal.status", atThreshold.proposal.status);
        ctx.record("proposal.proposalId", atThreshold.proposal.proposalId);
        ctx.record("proposal.rationale", atThreshold.proposal.rationale);
        ctx.record("proposal.reason", atThreshold.reason);
        ctx.record("proposal.evaluation.successRate", atThreshold.evaluation.successRate);
        ctx.record("proposal.evaluation.totalCases", atThreshold.evaluation.totalCases);
        ctx.record("proposal.evaluation.successes", atThreshold.evaluation.successes);

        // BELOW threshold: no proposal, the honest reason stands.
        const below = generateAdoptionProposalFromEvaluation(
          CASES, OUTCOMES, TENANT, CAPABILITY, "ml-engineer-riley", PROPOSED_AT, 0.9,
        );
        ctx.record("proposal.belowThreshold", below.proposal === null ? null : "unexpected-proposal");
        ctx.record("proposal.belowReason", below.reason);

        // The proposal opens a lifecycle (Guardian review first — law A5).
        const opened = openAdoptionLifecycle({ tenant: TENANT, proposal: atThreshold.proposal, openedAtMs: BASE_MS + 1_100_000 });
        if (!opened.ok) throw new Error(`lifecycle refused: ${opened.code}`);
        let record = opened.record;
        ctx.record("lifecycle.initialStage", record.stage);
        ctx.record("lifecycle.certification", record.certificationId);

        // NEGATIVE: rejecting from "proposed" is ILLEGAL — Guardian review first.
        const premature = rejectAdoption(record, {
          reasonCode: "insufficient-evidence",
          note: "premature rejection",
          rejectedBy: "guardian",
          rejectedAtMs: BASE_MS + 1_200_000,
        });
        ctx.record("reject.fromProposedOk", premature.ok);
        ctx.record("reject.fromProposedCode", premature.ok ? "unexpected-accept" : premature.code);

        // guardian-review -> REJECTED with a reason code.
        const reviewed = beginGuardianReview(record, BASE_MS + 1_250_000);
        if (!reviewed.ok) throw new Error(`review refused: ${reviewed.code}`);
        record = reviewed.record;
        ctx.record("reject.reviewStage", record.stage);
        const rejected = rejectAdoption(record, {
          reasonCode: "insufficient-evidence",
          note: "evidence too thin for adoption",
          rejectedBy: "guardian-analyst",
          rejectedAtMs: BASE_MS + 1_300_000,
        });
        if (!rejected.ok) throw new Error(`rejection refused: ${rejected.code}`);
        record = rejected.record;
        ctx.record("reject.finalStage", record.stage);
        ctx.record("reject.proposalStatus", record.proposal.status);
        ctx.record("reject.reasonCode", record.rejection?.reasonCode ?? "none");
        ctx.record("reject.rejectedBy", record.rejection?.rejectedBy ?? "none");
        ctx.record("reject.history", record.history.map((h) => `${h.from}>${h.to}`));

        // A SECOND proposal: guardian-review -> WITHDRAWN (the proposer's arm).
        const second = openAdoptionLifecycle({
          tenant: TENANT,
          proposal: { ...atThreshold.proposal, proposalId: "prop-withdraw-case" },
          openedAtMs: BASE_MS + 1_100_000,
        });
        if (!second.ok) throw new Error(`second lifecycle refused: ${second.code}`);
        const secondReviewed = beginGuardianReview(second.record, BASE_MS + 1_250_000);
        if (!secondReviewed.ok) throw new Error(`second review refused: ${secondReviewed.code}`);
        const withdrawn = withdrawAdoption(secondReviewed.record, "operator changed direction", BASE_MS + 1_400_000);
        if (!withdrawn.ok) throw new Error(`withdrawal refused: ${withdrawn.code}`);
        ctx.record("withdraw.finalStage", withdrawn.record.stage);
        ctx.record("withdraw.history", withdrawn.record.history.map((h) => `${h.from}>${h.to}`));
        // Withdrawing from a TERMINAL record is idempotent (same record).
        const reWithdraw = withdrawAdoption(withdrawn.record, "again", BASE_MS + 1_500_000);
        ctx.record("withdraw.terminalIdempotent", reWithdraw.ok && reWithdraw.record === withdrawn.record);
        // An empty note refuses the withdrawal.
        const emptyNote = withdrawAdoption(secondReviewed.record, "", BASE_MS + 1_400_000);
        ctx.record("withdraw.emptyNoteOk", emptyNote.ok);
        ctx.record("withdraw.emptyNoteCode", emptyNote.ok ? "unexpected-accept" : emptyNote.code);
      },
    },
  ],
  assertions: [
    { assertionId: "ea-1", description: "5 observations accepted after dedupe", path: "intake.acceptedCount", expected: 5 },
    { assertionId: "ea-2", description: "The exact duplicate is reported, not silently dropped", path: "intake.duplicates", expected: ["ea-obs-1"] },
    { assertionId: "ea-3", description: "Intake stamps the tenant", path: "intake.tenantId", expected: "acme-ops" },
    { assertionId: "ea-4", description: "Observations keep their ids", path: "intake.first.observationId", expected: "ea-obs-1" },
    { assertionId: "ea-5", description: "Every observation carries an 8-hex digest", path: "intake.first.digestLength", expected: 8 },
    { assertionId: "ea-6", description: "Deterministic ordering (observedAt asc)", path: "intake.sortedByTime", expected: ["ea-obs-1", "ea-obs-2", "ea-obs-3", "ea-obs-4", "ea-obs-5"] },
    { assertionId: "ea-7", description: "An identity conflict rejects the whole batch", path: "intake.conflictOk", expected: false },
    { assertionId: "ea-8", description: "Identity conflict code", path: "intake.conflictCode", expected: "duplicate-observation-id" },
    { assertionId: "ea-9", description: "Invalid observed time rejects the batch", path: "intake.invalidTimeOk", expected: false },
    { assertionId: "ea-10", description: "Invalid time code", path: "intake.invalidTimeCode", expected: "invalid-observed-at" },
    { assertionId: "ea-11", description: "An empty tenant rejects the batch (A8)", path: "intake.noTenantOk", expected: false },
    { assertionId: "ea-12", description: "Empty tenant code", path: "intake.noTenantCode", expected: "missing-tenant" },
    { assertionId: "ea-13", description: "Every case joined", path: "join.caseCount", expected: 5 },
    { assertionId: "ea-14", description: "Horizon elapsed => mature", path: "join.case1.mature", expected: true },
    { assertionId: "ea-15", description: "Numeric error computed exactly |41-40|", path: "join.case1.error", expected: 1 },
    { assertionId: "ea-16", description: "The joined prediction's value carried", path: "join.case1.predictedValue", expected: 40 },
    { assertionId: "ea-17", description: "Horizon exactly at the boundary is mature (>=)", path: "join.case2.mature", expected: true },
    { assertionId: "ea-18", description: "A case without a prediction is never mature", path: "join.case3.mature", expected: false },
    { assertionId: "ea-19", description: "No prediction => no error", path: "join.case3.error", expected: null },
    { assertionId: "ea-20", description: "No prediction carried for the unprediated case", path: "join.case3.predicted", expected: null },
    { assertionId: "ea-21", description: "Horizon not yet elapsed => not mature", path: "join.case4.mature", expected: false },
    { assertionId: "ea-22", description: "Immature joins still carry the error", path: "join.case4.error", expected: 3 },
    { assertionId: "ea-23", description: "The join time is stamped", path: "join.joinedAt", expected: "2026-10-12T18:55:00.000Z" },
    { assertionId: "ea-24", description: "Summary counts every case", path: "summary.totalCases", expected: 5 },
    { assertionId: "ea-25", description: "Two mature joins", path: "summary.matureCount", expected: 2 },
    { assertionId: "ea-26", description: "Five observed outcomes", path: "summary.observedCount", expected: 5 },
    { assertionId: "ea-27", description: "Three predictions joined", path: "summary.predictedCount", expected: 3 },
    { assertionId: "ea-28", description: "Mean error over the numeric joins (|1|+|1|+|3|)/3", path: "summary.meanError", expected: 1.6666666666666667 },
    { assertionId: "ea-29", description: "Coverage: all cases observed", path: "summary.coverage", expected: 1 },
    { assertionId: "ea-30", description: "The proposal is pending, never pre-authorized", path: "proposal.status", expected: "pending" },
    { assertionId: "ea-31", description: "The proposal id derives from capability+tenant", path: "proposal.proposalId", expected: "prop-fleetos.asset.read-state-1.0.0-acme-ops" },
    { assertionId: "ea-32", description: "The rationale carries the real success numbers", path: "proposal.rationale", expected: "success rate 0.8 (4/5)" },
    { assertionId: "ea-33", description: "Threshold-meeting reason", path: "proposal.reason", expected: "success rate meets threshold" },
    { assertionId: "ea-34", description: "The evaluation's success rate is exact", path: "proposal.evaluation.successRate", expected: 0.8 },
    { assertionId: "ea-35", description: "Five evaluation cases", path: "proposal.evaluation.totalCases", expected: 5 },
    { assertionId: "ea-36", description: "Four successes", path: "proposal.evaluation.successes", expected: 4 },
    { assertionId: "ea-37", description: "Below threshold: NO proposal (honest null)", path: "proposal.belowThreshold", expected: null },
    { assertionId: "ea-38", description: "Below-threshold reason names the numbers", path: "proposal.belowReason", expected: "success rate 0.8 below threshold 0.9" },
    { assertionId: "ea-39", description: "The lifecycle opens at proposed", path: "lifecycle.initialStage", expected: "proposed" },
    { assertionId: "ea-40", description: "No certification cited by default", path: "lifecycle.certification", expected: null },
    { assertionId: "ea-41", description: "Rejecting from proposed is ILLEGAL (Guardian review first)", path: "reject.fromProposedOk", expected: false },
    { assertionId: "ea-42", description: "Illegal-transition code", path: "reject.fromProposedCode", expected: "illegal-transition" },
    { assertionId: "ea-43", description: "Review entered", path: "reject.reviewStage", expected: "guardian-review" },
    { assertionId: "ea-44", description: "The rejection lands at rejected (terminal)", path: "reject.finalStage", expected: "rejected" },
    { assertionId: "ea-45", description: "The underlying proposal is marked rejected", path: "reject.proposalStatus", expected: "rejected" },
    { assertionId: "ea-46", description: "The rejection reason code carried", path: "reject.reasonCode", expected: "insufficient-evidence" },
    { assertionId: "ea-47", description: "The rejecter carried", path: "reject.rejectedBy", expected: "guardian-analyst" },
    { assertionId: "ea-48", description: "The full lifecycle history recorded", path: "reject.history", expected: ["proposed>guardian-review", "guardian-review>rejected"] },
    { assertionId: "ea-49", description: "Withdrawal lands at withdrawn (terminal)", path: "withdraw.finalStage", expected: "withdrawn" },
    { assertionId: "ea-50", description: "The withdrawal history recorded", path: "withdraw.history", expected: ["proposed>guardian-review", "guardian-review>withdrawn"] },
    { assertionId: "ea-51", description: "Withdrawing a withdrawn record is idempotent", path: "withdraw.terminalIdempotent", expected: true },
    { assertionId: "ea-52", description: "An empty note refuses the withdrawal", path: "withdraw.emptyNoteOk", expected: false },
    { assertionId: "ea-53", description: "Empty-note refusal code", path: "withdraw.emptyNoteCode", expected: "invalid-input" },
  ],
};
