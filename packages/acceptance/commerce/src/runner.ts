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
import { runProcurementStep } from "./drivers-procurement.js";
import { runVendorStep } from "./drivers-vendors.js";
import { runExternalStep } from "./drivers-external.js";
import { runOrgStep } from "./drivers-org.js";
import { runAurumStep } from "./drivers-aurum.js";
import { runHostStep } from "./drivers-host.js";
import { runGatewayStep } from "./drivers-gateway.js";
import { runLifecycleStep } from "./drivers-lifecycle.js";
import { runFinanceStep } from "./drivers-finance.js";
import { runResilienceStep } from "./drivers-resilience.js";
import { runMarketplaceStep } from "./drivers-marketplace.js";
import { runVendorDirectoryStep } from "./drivers-vendor-directory.js";
import { runActorJobStep } from "./drivers-actor-jobs.js";
import type { ActorJobStep, AurumStep, CommerceStep, FinanceStep, GatewayStep, HostStep, LifecycleStep, MarketplaceStep, OrgStep, ResilienceStep, VendorDirectoryStep, WorkStep } from "./journey-contracts.js";

const WORK_KINDS: ReadonlySet<string> = new Set([
  "work-create", "work-assign", "work-transition", "work-board",
  "project-create", "stage-create", "stage-checkpoint", "stage-transition", "stage-gate-view",
  "milestone-create", "milestone-gate", "ledger-post", "budget-position",
  "workload-apply", "workload-lifecycle", "workload-window-check", "workload-rollup-view",
]);

const PROCUREMENT_KINDS: ReadonlySet<string> = new Set([
  "demand-flow", "quote-create", "quote-transition", "quote-supersede", "quote-score-view",
  "award-quote", "order-transition", "fulfillment-transition", "spine-board", "reconcile",
]);

const VENDOR_KINDS: ReadonlySet<string> = new Set([
  "vendor-lifecycle", "vendor-verify-capability", "vendor-exposure", "vendor-kpi-view",
  "entitlement-check", "grant-assign", "grant-revoke", "seat-view",
]);

const EXTERNAL_KINDS: ReadonlySet<string> = new Set([
  "catalog-import", "catalog-verify", "catalog-metrics", "catalog-scorecards", "catalog-revoke",
  "apify-job-create", "apify-job-authorize", "apify-job-schedule", "apify-job-transition",
  "apify-ingest-result", "apify-attach-evidence",
]);

const AURUM_KINDS: ReadonlySet<string> = new Set([
  "aurum-invoke", "aurum-outage-invoke", "aurum-boundary",
]);

const HOST_KINDS: ReadonlySet<string> = new Set([
  "host-build-view-models", "host-intent-draft", "host-context-probe",
]);

const GATEWAY_KINDS: ReadonlySet<string> = new Set([
  "gw-select-model", "gw-quota-request", "gw-burn-projection", "gw-cost-comparison",
  "org-assign-role", "org-transition-role", "org-role-board",
]);

// F310C (Wave 11 lane C) step-kind families.
const LIFECYCLE_KINDS: ReadonlySet<string> = new Set([
  "work-reassign", "work-remove-assignee", "work-integrity-holds", "work-deadline",
  "project-directory-seed", "project-directory-transition", "project-milestone-verify",
  "project-complete", "project-portfolio", "workload-rebalance",
]);

const FINANCE_KINDS: ReadonlySet<string> = new Set([
  "vendor-sla-evaluate", "vendor-sla-scorecard", "vendor-sla-credit",
  "order-reconcile-batch", "cost-allocate", "cost-allocate-partial", "cost-alloc-verify",
  "software-renewal-sweep", "software-seat-projection",
]);

const RESILIENCE_KINDS: ReadonlySet<string> = new Set([
  "gw-fallback-ladder", "gw-degraded-mode", "org-budgets-seed", "org-budget-rebalance",
]);

// F321C (Wave 12 lane C) step-kind families.
const MARKETPLACE_KINDS: ReadonlySet<string> = new Set([
  "marketplace-capabilities-seed", "marketplace-publish", "marketplace-revoke-cascade", "marketplace-search",
]);

const VENDOR_DIRECTORY_KINDS: ReadonlySet<string> = new Set([
  "vendor-directory-seed", "vendor-relationship-transition", "vendor-scorecard-aggregate",
  "vendor-capability-feed", "vendor-directory-read",
]);

const ACTOR_JOB_KINDS: ReadonlySet<string> = new Set([
  "apify-job-create-idempotent", "apify-job-fail", "apify-job-expire-at",
]);

export async function executeStep(
  step: WorkStep | CommerceStep | OrgStep | AurumStep | HostStep | GatewayStep | LifecycleStep | FinanceStep | ResilienceStep | MarketplaceStep | VendorDirectoryStep | ActorJobStep,
  state: JourneyState,
): Promise<Record<string, FactValue>> {
  if (WORK_KINDS.has(step.kind)) return runWorkStep(step as WorkStep, state);
  if (PROCUREMENT_KINDS.has(step.kind)) return runProcurementStep(step as CommerceStep, state);
  if (VENDOR_KINDS.has(step.kind)) return runVendorStep(step as CommerceStep, state);
  if (EXTERNAL_KINDS.has(step.kind)) return runExternalStep(step as CommerceStep, state);
  if (AURUM_KINDS.has(step.kind)) return runAurumStep(step as AurumStep, state);
  if (HOST_KINDS.has(step.kind)) return runHostStep(step as HostStep, state);
  if (GATEWAY_KINDS.has(step.kind)) return runGatewayStep(step as GatewayStep, state);
  if (LIFECYCLE_KINDS.has(step.kind)) return runLifecycleStep(step as LifecycleStep, state);
  if (FINANCE_KINDS.has(step.kind)) return runFinanceStep(step as FinanceStep, state);
  if (RESILIENCE_KINDS.has(step.kind)) return runResilienceStep(step as ResilienceStep, state);
  if (MARKETPLACE_KINDS.has(step.kind)) return runMarketplaceStep(step as MarketplaceStep, state);
  if (VENDOR_DIRECTORY_KINDS.has(step.kind)) return runVendorDirectoryStep(step as VendorDirectoryStep, state);
  if (ACTOR_JOB_KINDS.has(step.kind)) return runActorJobStep(step as ActorJobStep, state);
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
export async function runJourney(journey: AcceptanceJourney, options: RunOptions = {}): Promise<RunJourneyResult> {
  const state = buildJourneyWorld({ ...(options.startedAt !== undefined ? { startedAt: options.startedAt } : {}) });
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

/**
 * F331C time seam (D12): the run options. `startedAt` is the run anchor
 * (epoch ms); absent = COMMERCE_T0 — the pre-seam default, so a no-options
 * call is byte-identical to the pre-seam tree (ZERO behavior change at
 * T0, machine-verified by the suite).
 */
export interface RunOptions {
  readonly startedAt?: number;
}

/** Execute every journey against its own fresh world (deterministic order). */
export async function runAllJourneys(
  journeys: readonly AcceptanceJourney[],
  options: RunOptions = {},
): Promise<readonly JourneyOutcome[]> {
  const outcomes: JourneyOutcome[] = [];
  for (const journey of journeys) {
    const { outcome } = await runJourney(journey, options);
    outcomes.push(outcome);
  }
  return outcomes;
}
