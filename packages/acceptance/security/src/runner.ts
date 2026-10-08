/**
 * @fleetos/acceptance-security — deterministic journey runner (F270B).
 *
 * Executes a journey's steps against the REAL lane packages (caller-threaded
 * state — each `run` receives a fresh recorder; journeys hold no mutable
 * shared state), then evaluates the journey's DECLARATIVE assertions against
 * the recorded facts:
 *
 *   - a step that throws FAILS the journey (the message is captured as the
 *     step detail — the runner never swallows domain errors);
 *   - a FAILING assertion fails the journey — no soft passes;
 *   - re-running the same journey is byte-identical (same facts, same
 *     outcomes, same digest) — machine-tested.
 *
 * The runner records `null` actuals as MISSING facts (distinct from a
 * recorded `null` value) so an assertion against a path nobody recorded is
 * an honest failure, never a silent pass.
 */

import type {
  AcceptanceJourney,
  JourneyAssertionResult,
  JourneyFactMap,
  JourneyFactValue,
  JourneyOutcome,
  JourneyRecorder,
  JourneyStepResult,
} from "./journey-contracts.ts";
import { canonicalEquals, journeyOutcomeDigest } from "./journey-contracts.ts";

export interface JourneyRunResult {
  readonly outcome: JourneyOutcome;
  /** The facts recorded by the steps (assertion evaluation input). */
  readonly facts: JourneyFactMap;
}

function recordFact(facts: Record<string, JourneyFactValue>, path: string, value: JourneyFactValue): void {
  if (path === "") {
    throw new Error("journey step recorded a fact under an empty path");
  }
  if (Object.prototype.hasOwnProperty.call(facts, path)) {
    // Deterministic fail-loud: a step overwriting another step's fact is a
    // journey-authoring bug — the runner surfaces it instead of hiding it.
    throw new Error(`journey step recorded a duplicate fact path: ${path}`);
  }
  facts[path] = value;
}

/**
 * Run one journey. Deterministic: identical journey definition => identical
 * outcome (including digest). The journey's steps are executed in declared
 * order; every step runs to completion even after an earlier one failed
 * (honest full-trail outcomes), but any failed step fails the journey.
 */
export function runJourney(journey: AcceptanceJourney): JourneyRunResult {
  const facts: Record<string, JourneyFactValue> = {};
  const recorder: JourneyRecorder = { record: (path, value) => recordFact(facts, path, value) };

  const stepResults: JourneyStepResult[] = journey.steps.map((step) => {
    try {
      step.run(recorder);
      return { stepId: step.stepId, ok: true, detail: "ok" };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { stepId: step.stepId, ok: false, detail: message };
    }
  });

  const assertionResults: JourneyAssertionResult[] = journey.assertions.map((a) => {
    const actual = Object.prototype.hasOwnProperty.call(facts, a.path) ? facts[a.path]! : null;
    if (!Object.prototype.hasOwnProperty.call(facts, a.path)) {
      return {
        assertionId: a.assertionId,
        path: a.path,
        expected: a.expected,
        actual: null,
        pass: false,
        reason: `no fact recorded at path "${a.path}"`,
      };
    }
    const pass = canonicalEquals(actual, a.expected);
    return {
      assertionId: a.assertionId,
      path: a.path,
      expected: a.expected,
      actual,
      pass,
      reason: pass
        ? "actual equals expected"
        : `actual ${JSON.stringify(actual)} != expected ${JSON.stringify(a.expected)}`,
    };
  });

  const passedStepCount = stepResults.filter((s) => s.ok).length;
  const failedAssertionCount = assertionResults.filter((a) => !a.pass).length;
  const pass = stepResults.every((s) => s.ok) && failedAssertionCount === 0;
  const withoutDigest = {
    journeyId: journey.journeyId,
    persona: journey.persona,
    capabilities: journey.capabilities,
    goal: journey.goal,
    pass,
    steps: stepResults,
    assertions: assertionResults,
    passedStepCount,
    failedAssertionCount,
  };
  return { outcome: { ...withoutDigest, digest: journeyOutcomeDigest(withoutDigest) }, facts };
}

/** Run every journey in a corpus, in the declared order. */
export function runAllJourneys(journeys: readonly AcceptanceJourney[]): readonly JourneyOutcome[] {
  return journeys.map((j) => runJourney(j).outcome);
}

/**
 * Runner determinism machine test: two runs of the same journey MUST be
 * byte-identical (canonical serialization equality of the outcomes).
 */
export function verifyRunnerDeterminism(journey: AcceptanceJourney): {
  readonly deterministic: boolean;
  readonly digest1: string;
  readonly digest2: string;
} {
  const a = runJourney(journey).outcome;
  const b = runJourney(journey).outcome;
  return {
    deterministic: JSON.stringify(a) === JSON.stringify(b),
    digest1: a.digest,
    digest2: b.digest,
  };
}
