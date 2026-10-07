/**
 * Learning kernel tests — outcome-observation joins, horizon discipline,
 * adoption proposal generation, no-adopt invariant.
 *
 * Wave 1 (F210B) additions.
 */
import { describe, it, expect } from "vitest";
import {
  joinOutcomesWithPredictions,
  generateAdoptionProposalFromEvaluation,
  assertNoAdoptFunction,
  computeEvaluationSummary,
} from "../src/index.ts";
import type { EvaluationCase, OutcomeObservation, TenantScopeLike, CapabilityVersionRef } from "../src/index.ts";

const tenant: TenantScopeLike = { tenantId: "t1" };
const cap: CapabilityVersionRef = { capabilityId: "cap.test", version: "1.0.0" };

function makeCases<T = number>(n: number): EvaluationCase<T>[] {
  return Array.from({ length: n }, (_, i) => ({
    caseId: `case-${i}`,
    tenant,
    capability: cap,
    inputs: { x: i },
    expected: i * 10 as T,
    description: `case ${i}`,
    tags: [],
  }));
}

function makeOutcomes<T = number>(cases: EvaluationCase<T>[], successes: boolean[]): OutcomeObservation<T>[] {
  return cases.map((c, i) => ({
    observationId: `obs-${i}`,
    caseId: c.caseId,
    actual: c.expected,
    observedAt: "2026-01-01T00:00:00.000Z",
    observationRef: `ref-${i}`,
    success: successes[i] ?? true,
  }));
}

function makePredictions<T = number>(cases: EvaluationCase<T>[], horizonMs: number = 86_400_000): { predictionId: string; predictedAt: string; predictedValue: T; horizonMs: number }[] {
  return cases.map((c) => ({
    predictionId: `pred-${c.caseId}`,
    predictedAt: "2026-01-01T00:00:00.000Z",
    predictedValue: c.expected,
    horizonMs,
  }));
}

// ---------- joinOutcomesWithPredictions ----------

describe("joinOutcomesWithPredictions", () => {
  it("joins outcomes with predictions", () => {
    const cases = makeCases(3);
    const outcomes = makeOutcomes(cases, [true, true, true]);
    const predictions = makePredictions(cases);

    const joined = joinOutcomesWithPredictions(cases, outcomes, predictions, "2026-01-03T00:00:00.000Z");
    expect(joined).toHaveLength(3);
    expect(joined[0]!.observed).not.toBeNull();
    expect(joined[0]!.predicted).not.toBeNull();
  });

  it("marks predictions as immature before horizon elapses (horizon discipline)", () => {
    const cases = makeCases(1);
    const outcomes = makeOutcomes(cases, [true]);
    const predictions = makePredictions(cases, 7 * 86_400_000); // 7-day horizon

    // now is only 1 day after prediction — not mature
    const joined = joinOutcomesWithPredictions(cases, outcomes, predictions, "2026-01-02T00:00:00.000Z");
    expect(joined[0]!.mature).toBe(false);
  });

  it("marks predictions as mature after horizon elapses", () => {
    const cases = makeCases(1);
    const outcomes = makeOutcomes(cases, [true]);
    const predictions = makePredictions(cases, 86_400_000); // 1-day horizon

    // now is 2 days after prediction — mature
    const joined = joinOutcomesWithPredictions(cases, outcomes, predictions, "2026-01-03T00:00:00.000Z");
    expect(joined[0]!.mature).toBe(true);
  });

  it("computes error when both observed and predicted are numeric", () => {
    const cases = makeCases(1);
    const outcomes = makeOutcomes(cases, [true]);
    const predictions = makePredictions(cases, 0);

    const joined = joinOutcomesWithPredictions(cases, outcomes, predictions, "2026-01-03T00:00:00.000Z");
    expect(joined[0]!.error).toBe(0); // actual == predicted
  });

  it("computes non-zero error when predicted differs from actual", () => {
    const cases = makeCases(1);
    const outcomes = makeOutcomes(cases, [true]);
    const predictions = [{ predictionId: `pred-${cases[0]!.caseId}`, predictedAt: "2026-01-01T00:00:00.000Z", predictedValue: 999, horizonMs: 0 }];

    const joined = joinOutcomesWithPredictions(cases, outcomes, predictions, "2026-01-03T00:00:00.000Z");
    expect(joined[0]!.error).toBe(999 - 0); // |0 - 999|
  });

  it("handles missing predictions (predicted=null)", () => {
    const cases = makeCases(2);
    const outcomes = makeOutcomes(cases, [true, true]);
    const predictions = makePredictions(cases.slice(0, 1)); // only 1 prediction

    const joined = joinOutcomesWithPredictions(cases, outcomes, predictions, "2026-01-03T00:00:00.000Z");
    expect(joined[0]!.predicted).not.toBeNull();
    expect(joined[1]!.predicted).toBeNull();
  });

  it("handles missing outcomes (observed=null)", () => {
    const cases = makeCases(2);
    const outcomes = makeOutcomes(cases.slice(0, 1), [true]); // only 1 outcome
    const predictions = makePredictions(cases);

    const joined = joinOutcomesWithPredictions(cases, outcomes, predictions, "2026-01-03T00:00:00.000Z");
    expect(joined[0]!.observed).not.toBeNull();
    expect(joined[1]!.observed).toBeNull();
  });
});

// ---------- generateAdoptionProposalFromEvaluation ----------

describe("generateAdoptionProposalFromEvaluation", () => {
  it("generates a proposal when success rate meets threshold", () => {
    const cases = makeCases(5);
    const outcomes = makeOutcomes(cases, [true, true, true, true, true]); // 100% success

    const result = generateAdoptionProposalFromEvaluation(
      cases, outcomes, tenant, cap, "user-1", "2026-01-01T00:00:00.000Z", 0.8,
    );
    expect(result.proposal).not.toBeNull();
    expect(result.proposal!.status).toBe("pending");
    expect(result.evaluation.successRate).toBe(1);
    expect(result.reason).toContain("meets threshold");
  });

  it("does NOT generate a proposal when success rate is below threshold", () => {
    const cases = makeCases(5);
    const outcomes = makeOutcomes(cases, [true, false, false, false, false]); // 20% success

    const result = generateAdoptionProposalFromEvaluation(
      cases, outcomes, tenant, cap, "user-1", "2026-01-01T00:00:00.000Z", 0.8,
    );
    expect(result.proposal).toBeNull();
    expect(result.reason).toContain("below threshold");
  });

  it("does NOT generate a proposal when there are no cases", () => {
    const result = generateAdoptionProposalFromEvaluation(
      [], [], tenant, cap, "user-1", "2026-01-01T00:00:00.000Z", 0.8,
    );
    expect(result.proposal).toBeNull();
    expect(result.reason).toContain("no evaluation cases");
  });

  it("proposal status is always 'pending' — never auto-adopted", () => {
    const cases = makeCases(3);
    const outcomes = makeOutcomes(cases, [true, true, true]);
    const result = generateAdoptionProposalFromEvaluation(
      cases, outcomes, tenant, cap, "user-1", "2026-01-01T00:00:00.000Z", 0.8,
    );
    expect(result.proposal).not.toBeNull();
    expect(result.proposal!.status).toBe("pending");
  });
});

// ---------- assertNoAdoptFunction ----------

describe("assertNoAdoptFunction", () => {
  it("returns ok=true for the learning module surface", () => {
    const moduleExports = { evaluateCapability: () => {}, proposeAdoption: () => {}, generateAdoptionProposalFromEvaluation: () => {} };
    const probe = assertNoAdoptFunction(moduleExports);
    expect(probe.ok).toBe(true);
    expect(probe.forbidden).toEqual([]);
  });

  it("catches a forbidden 'adopt' function", () => {
    const badExports = { adopt: () => {} };
    const probe = assertNoAdoptFunction(badExports);
    expect(probe.ok).toBe(false);
    expect(probe.forbidden).toContain("adopt");
  });
});

// ---------- computeEvaluationSummary ----------

describe("computeEvaluationSummary", () => {
  it("computes summary statistics", () => {
    const cases = makeCases(3);
    const outcomes = makeOutcomes(cases, [true, true, true]);
    const predictions = makePredictions(cases, 0);

    const joined = joinOutcomesWithPredictions(cases, outcomes, predictions, "2026-01-03T00:00:00.000Z");
    const summary = computeEvaluationSummary(joined);
    expect(summary.totalCases).toBe(3);
    expect(summary.matureCount).toBe(3);
    expect(summary.observedCount).toBe(3);
    expect(summary.predictedCount).toBe(3);
    expect(summary.meanError).toBe(0);
    expect(summary.coverage).toBe(1);
  });

  it("returns meanError=null when no errors", () => {
    const cases = makeCases(1);
    const joined = joinOutcomesWithPredictions(cases, [], [], "2026-01-03T00:00:00.000Z");
    const summary = computeEvaluationSummary(joined);
    expect(summary.meanError).toBeNull();
    expect(summary.coverage).toBe(0);
  });
});
