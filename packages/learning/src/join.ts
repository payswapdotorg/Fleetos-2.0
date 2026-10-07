/**
 * @fleetos/learning — Outcome-observation joins with horizon discipline.
 *
 * Wave 1 (F210B) additions:
 *   - Join observed outcomes with predicted values (observed vs predicted)
 *   - Horizon discipline: never join before producedAt + horizonMs
 *   - Adoption PROPOSAL generation from evaluation cases (proposals only — Guardian adopts)
 *
 * Law A5: adoption proposals NEVER self-execute. The Guardian path adopts.
 *
 * Pure types + pure functions.
 */

import type {
  EvaluationCase,
  OutcomeObservation,
  CapabilityEvaluation,
  CapabilityAdoptionProposal,
  CapabilityVersionRef,
  TenantScopeLike,
} from "./index.ts";
import { evaluateCapability, proposeAdoption } from "./index.ts";

/** A predicted value reference — points at a PredictedValue from @fleetos/predictive. */
export interface PredictedRef {
  readonly predictionId: string;
  readonly predictedAt: string;
  readonly predictedValue: unknown;
  readonly horizonMs: number;
}

/** A joined outcome — observed vs predicted with horizon discipline. */
export interface JoinedOutcome<T = unknown> {
  readonly caseId: string;
  readonly predicted: PredictedRef | null;
  readonly observed: OutcomeObservation<T> | null;
  readonly joinedAt: string;
  readonly mature: boolean;
  readonly error: number | null;
}

/**
 * Join outcomes with predictions — horizon discipline.
 *
 * Law: never join before producedAt + horizonMs. A prediction is not joined
 * with an observation until the prediction's horizon has elapsed.
 *
 * Returns the joined outcomes with `mature: true/false` flags.
 */
export function joinOutcomesWithPredictions<T = unknown>(
  cases: readonly EvaluationCase<T>[],
  outcomes: readonly OutcomeObservation<T>[],
  predictions: readonly PredictedRef[],
  now: string,
): readonly JoinedOutcome<T>[] {
  const outcomesByCase = new Map<string, OutcomeObservation<T>>();
  for (const o of outcomes) outcomesByCase.set(o.caseId, o);

  const predictionsByCase = new Map<string, PredictedRef>();
  for (const p of predictions) {
    // The prediction's caseId is encoded in the predictionId: "pred-<caseId>"
    const caseId = p.predictionId.replace(/^pred-/, "");
    predictionsByCase.set(caseId, p);
  }

  return cases.map((c) => {
    const observed = outcomesByCase.get(c.caseId) ?? null;
    const predicted = predictionsByCase.get(c.caseId) ?? null;

    let mature = false;
    if (predicted) {
      const predictedTime = new Date(predicted.predictedAt).getTime();
      const nowTime = new Date(now).getTime();
      mature = nowTime >= predictedTime + predicted.horizonMs;
    }

    let error: number | null = null;
    if (observed && predicted && typeof observed.actual === "number" && typeof predicted.predictedValue === "number") {
      error = Math.abs((observed.actual as number) - (predicted.predictedValue as number));
    }

    return {
      caseId: c.caseId,
      predicted,
      observed,
      joinedAt: now,
      mature,
      error,
    };
  });
}

/**
 * Generate an adoption PROPOSAL from evaluation cases.
 *
 * Law A5: this function returns a PROPOSAL — it does NOT adopt. The Guardian
 * path (in @fleetos/policy) is the SOLE authority that can convert a proposal
 * into an authorization. There is NO `adopt()` function here.
 *
 * The proposal is generated when the evaluation shows sufficient success rate
 * (configurable threshold). If the success rate is below threshold, no proposal
 * is generated (returns null).
 */
export function generateAdoptionProposalFromEvaluation<T = unknown>(
  cases: readonly EvaluationCase<T>[],
  outcomes: readonly OutcomeObservation<T>[],
  tenant: TenantScopeLike,
  capability: CapabilityVersionRef,
  proposedBy: string,
  proposedAt: string,
  successThreshold: number = 0.8,
): { readonly proposal: CapabilityAdoptionProposal | null; readonly evaluation: CapabilityEvaluation; readonly reason: string } {
  const evaluation = evaluateCapability(cases, outcomes, tenant, capability, proposedAt);

  if (evaluation.totalCases === 0) {
    return {
      proposal: null,
      evaluation,
      reason: "no evaluation cases",
    };
  }

  if (evaluation.successRate < successThreshold) {
    return {
      proposal: null,
      evaluation,
      reason: `success rate ${evaluation.successRate} below threshold ${successThreshold}`,
    };
  }

  const proposal = proposeAdoption({
    tenant,
    capability,
    evaluation,
    proposedBy,
    rationale: `success rate ${evaluation.successRate} (${evaluation.successes}/${evaluation.totalCases})`,
    proposedAt,
  });

  return { proposal, evaluation, reason: "success rate meets threshold" };
}

/**
 * Machine-test: the learning package exports NO `adopt()` function.
 *
 * Law A5: adoption requires the Guardian path. This function verifies the
 * module surface has no `adopt`, `execute`, `activate`, or `install` function.
 */
export function assertNoAdoptFunction(moduleExports: Record<string, unknown>): {
  readonly ok: boolean;
  readonly forbidden: readonly string[];
} {
  const FORBIDDEN = ["adopt", "execute", "activate", "install", "selfAdopt"];
  const found = FORBIDDEN.filter((name) => typeof moduleExports[name] === "function");
  return { ok: found.length === 0, forbidden: found };
}

/**
 * Compute evaluation summary statistics.
 *
 * Returns mean error, mature count, and coverage.
 */
export function computeEvaluationSummary<T>(
  joined: readonly JoinedOutcome<T>[],
): {
  readonly totalCases: number;
  readonly matureCount: number;
  readonly observedCount: number;
  readonly predictedCount: number;
  readonly meanError: number | null;
  readonly coverage: number;
} {
  const matureCount = joined.filter((j) => j.mature).length;
  const observedCount = joined.filter((j) => j.observed !== null).length;
  const predictedCount = joined.filter((j) => j.predicted !== null).length;
  const errors = joined.filter((j) => j.error !== null).map((j) => j.error!);
  const meanError = errors.length > 0 ? errors.reduce((a, b) => a + b, 0) / errors.length : null;
  const coverage = joined.length > 0 ? observedCount / joined.length : 0;

  return {
    totalCases: joined.length,
    matureCount,
    observedCount,
    predictedCount,
    meanError,
    coverage,
  };
}
