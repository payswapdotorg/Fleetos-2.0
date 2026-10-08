/**
 * @fleetos/acceptance-commerce — deterministic journey runner.
 *
 * Executes a journey's typed steps against the REAL lane packages (the
 * step drivers), evaluates the declared assertions against the observed
 * facts, and produces a `JourneyOutcome` with per-step and per-assertion
 * pass/fail plus the ACTUAL vs EXPECTED values. A FAILING assertion
 * fails the journey — no soft passes. Re-runs are byte-identical.
 *
 * Determinism: no clock, no randomness; the world is built once per run
 * from the pure `buildJourneyWorld`. Refusal-aware: a domain refusal is
 * recorded as facts (the journey's assertions decide whether that is the
 * expected behavior); a step the drivers cannot execute marks the step
 * not-executed and the journey FAILS.
 */

import {
  type AcceptanceJourney,
  type AssertionOutcome,
  type FactValue,
  type JourneyOutcome,
  type StepOutcome,
  MISSING_FACT,
  computeJourneyDigest,
} from "./journey-contracts.js";
import { buildJourneyWorld, type JourneyState } from "./journey-world.js";
import { runWorkStep } from "./drivers-work.js";
import { runCommerceStep } from "./drivers-commerce.js";
import { runOrgStep } from "./drivers-org.js";
import type { CommerceStep, OrgStep, WorkStep } from "./journey-contracts.js";

const WORK_KINDS: ReadonlySet<string> = new Set([
  "work-create", "work-assign", "work-transition", "work-board",
  "project-create", "stage-create", "stage-checkpoint", "stage-transition", "stage-gate-view",
  "milestone-create", "milestone-gate", "ledger-post", "budget-position",
  "workload-apply", "workload-lifecycle", "workload-window-check", "workload-rollup-view",
]);

const COMMERCE_KINDS: ReadonlySet<string> = new Set([
  "demand-flow", "quote-create", "quote-transition", "quote-supersede", "quote-score-view",
  "award-quote", "order-transition", "fulfillment-transition", "spine-board", "reconcile",
  "vendor-lifecycle", "vendor-verify-capability", "vendor-exposure", "vendor-kpi-view",
  "entitlement-check", "grant-assign", "grant-revoke", "seat-view",
  "catalog-import", "catalog-verify", "catalog-metrics", "catalog-scorecards", "catalog-revoke",
  "apify-job-create", "apify-job-authorize", "apify-job-schedule", "apify-job-transition",
  "apify-ingest-result", "apify-attach-evidence",
]);

export async function executeStep(
  step: WorkStep | CommerceStep | OrgStep,
  state: JourneyState,
): Promise<Record<string, FactValue>> {
  if (WORK_KINDS.has(step.kind)) return runWorkStep(step as WorkStep, state);
  if (COMMERCE_KINDS.has(step.kind)) return runCommerceStep(step as CommerceStep, state);
  return runOrgStep(step as OrgStep, state);
}

function evaluateAssertion(
  assertion: { readonly id: string; readonly description: string; readonly fact: string; readonly op: "eq" | "deepEq" | "gt" | "gte" | "lt" | "includes" | "uniform"; readonly expected: FactValue },
  facts: ReadonlyMap<string, FactValue>,
): AssertionOutcome {
  const actual = facts.get(assertion.fact);
  if (actual === undefined) {
    return {
      assertionId: assertion.id,
      description: assertion.description,
      ok: false,
      op: assertion.op,
      actual: MISSING_FACT,
      expected: assertion.expected,
    };
  }
  let ok = false;
  const expected = assertion.expected;
  switch (assertion.op) {
    case "eq":
      ok = actual === expected;
      break;
    case "deepEq": {
      const actualArray = Array.isArray(actual) ? actual : null;
      const expectedArray = Array.isArray(expected) ? expected : null;
      ok =
        actualArray !== null && expectedArray !== null
          ? actualArray.length === expectedArray.length &&
            actualArray.every((v, i) => v === expectedArray[i])
          : actual === expected;
      break;
    }
    case "gt":
      ok = typeof actual === "number" && typeof assertion.expected === "number" && actual > assertion.expected;
      break;
    case "gte":
      ok = typeof actual === "number" && typeof assertion.expected === "number" && actual >= assertion.expected;
      break;
    case "lt":
      ok = typeof actual === "number" && typeof assertion.expected === "number" && actual < assertion.expected;
      break;
    case "includes":
      ok = Array.isArray(actual) && actual.includes(assertion.expected);
      break;
    case "uniform":
      ok = Array.isArray(actual) && actual.length >= 2 && actual.every((v) => v === actual[0]);
      break;
  }
  return {
    assertionId: assertion.id,
    description: assertion.description,
    ok,
    op: assertion.op,
    actual,
    expected: assertion.expected,
  };
}

export interface RunJourneyResult {
  readonly outcome: JourneyOutcome;
  /** All facts observed (stable keys, latest write wins — deterministic). */
  readonly facts: ReadonlyMap<string, FactValue>;
}

/** Execute one journey against a fresh deterministic world. */
export async function runJourney(journey: AcceptanceJourney): Promise<RunJourneyResult> {
  const state = buildJourneyWorld();
  const facts = new Map<string, FactValue>();
  const stepOutcomes: StepOutcome[] = [];
  for (const step of journey.steps) {
    try {
      const stepFacts = await executeStep(step, state);
      for (const [key, value] of Object.entries(stepFacts)) facts.set(key, value);
      for (const [key, log] of Object.entries(state.logs)) facts.set(key, [...log]);
      stepOutcomes.push({ stepId: step.stepId, kind: step.kind, executed: true, ok: true });
    } catch (error) {
      stepOutcomes.push({
        stepId: step.stepId,
        kind: step.kind,
        executed: false,
        ok: false,
      });
      facts.set(`step.${step.stepId}.error`, error instanceof Error ? error.message : "unknown-error");
    }
  }
  const assertionOutcomes = journey.assertions.map((a) => evaluateAssertion(a, facts));
  const passed =
    assertionOutcomes.every((a) => a.ok) && stepOutcomes.every((s) => s.executed && s.ok);
  const base = {
    journeyId: journey.id,
    persona: journey.persona,
    capability: journey.capability,
    goal: journey.goal,
    stepOutcomes,
    assertionOutcomes,
    passed,
  };
  return { outcome: { ...base, digest: computeJourneyDigest(base) }, facts };
}

/** Execute every journey against its own fresh world (deterministic order). */
export async function runAllJourneys(
  journeys: readonly AcceptanceJourney[],
): Promise<readonly JourneyOutcome[]> {
  const outcomes: JourneyOutcome[] = [];
  for (const journey of journeys) {
    const { outcome } = await runJourney(journey);
    outcomes.push(outcome);
  }
  return outcomes;
}
