/**
 * @fleetos/acceptance-field — F351B masked-industry coverage journeys
 * (Wave 16 lane A): the five census-certified journeys over the
 * persona-relevant unexercised surface (assets registry lifecycle,
 * work-order supersession, project closeout, procurement ordering,
 * health threshold escalation).
 *
 * Lives in its own file (the F341A-kernel precedent: the corpus-shape
 * pins in journeys.test.ts are updated in place, nothing removed); the
 * per-journey law is identical — the outcome must PASS with every step
 * ok and every assertion passed, the outcome digest must verify, and
 * semantic anchors are re-checked from the recorded assertion ACTUALS
 * (the REAL outputs the runner read).
 */

import { describe, expect, it } from "vitest";
import { FIELD_JOURNEYS } from "../src/journeys/index.js";
import { runJourneyCorpus } from "../src/runner.js";
import { verifyJourneyOutcome, type JourneyOutcome } from "../src/journey-contracts.js";

const OUTCOMES = new Map<string, JourneyOutcome>();
for (const outcome of runJourneyCorpus(FIELD_JOURNEYS)) {
  OUTCOMES.set(outcome.journeyId, outcome);
}

function outcomeOf(journeyId: string): JourneyOutcome {
  const outcome = OUTCOMES.get(journeyId);
  if (!outcome) throw new Error(`journey outcome not found: ${journeyId}`);
  return outcome;
}

function actualOf(journeyId: string, assertionId: string): unknown {
  const found = outcomeOf(journeyId).assertions.find((a) => a.id === assertionId);
  if (!found) throw new Error(`assertion not found: ${journeyId}/${assertionId}`);
  return found.actual;
}

function expectJourneyPasses(journeyId: string, steps: number, assertions: number): JourneyOutcome {
  const outcome = outcomeOf(journeyId);
  expect(outcome, `journey outcome not found: ${journeyId}`).toBeDefined();
  expect(outcome.passed, `${journeyId} must pass`).toBe(true);
  expect(outcome.steps.length).toBe(steps);
  expect(outcome.steps.every((s) => s.ok), `${journeyId} steps must all be ok`).toBe(true);
  expect(outcome.assertions.length).toBe(assertions);
  expect(outcome.assertions.every((a) => a.pass), `${journeyId} assertions must all pass`).toBe(true);
  expect(verifyJourneyOutcome(outcome)).toBe(true);
  expect(outcome.digest).toMatch(/^[0-9a-f]{8}$/);
  return outcome;
}

describe("F351B masked-industry coverage journeys (census-certified, D14 form)", () => {
  it("asset-registry-lifecycle-audit — REAL lifecycle transition law, append-only twin revisions, pending-vs-current projection, refusal paths pinned", () => {
    expectJourneyPasses("asset-registry-lifecycle-audit", 14, 21);
    // Refusal anchors (REAL reason codes from @fleetos/assets).
    expect(actualOf("asset-registry-lifecycle-audit", "r3")).toBe("illegal-transition");
    expect(actualOf("asset-registry-lifecycle-audit", "r4")).toBe("already-in-target-state");
    expect(actualOf("asset-registry-lifecycle-audit", "r8")).toBe("non-monotonic-seq");
    expect(actualOf("asset-registry-lifecycle-audit", "r9")).toBe("stale-observed-at");
    // Semantic anchors re-checked from the recorded ACTUALS.
    expect(actualOf("asset-registry-lifecycle-audit", "r1")).toBe("active");
    expect(actualOf("asset-registry-lifecycle-audit", "r13")).toBe("current");
    expect(actualOf("asset-registry-lifecycle-audit", "r15")).toBe(3);
    expect(actualOf("asset-registry-lifecycle-audit", "r17")).toBe("pending");
    expect(actualOf("asset-registry-lifecycle-audit", "r19")).toBe(2);
    expect(actualOf("asset-registry-lifecycle-audit", "r20")).toBe(2);
  });

  it("work-order-shift-supersession — REAL advance law, SUPERSESSION closes the old record (never mutated), idempotent no-ops, stable progress digests", () => {
    expectJourneyPasses("work-order-shift-supersession", 14, 25);
    expect(actualOf("work-order-shift-supersession", "s4")).toBe("ASSIGNEE_REQUIRED_FOR_COMPLETION");
    expect(actualOf("work-order-shift-supersession", "s7")).toBe("ALREADY_ASSIGNED");
    expect(actualOf("work-order-shift-supersession", "s10")).toBe("BLOCK_REASON_REQUIRED");
    expect(actualOf("work-order-shift-supersession", "s23")).toBe("ILLEGAL_TRANSITION");
    expect(actualOf("work-order-shift-supersession", "s15")).toBe(2);
    expect(actualOf("work-order-shift-supersession", "s16")).toBe("asg_shift-0001-a");
    expect(actualOf("work-order-shift-supersession", "s17")).toBe("reassigned");
    expect(actualOf("work-order-shift-supersession", "s18")).toBe("asg_shift-0001-c");
    expect(actualOf("work-order-shift-supersession", "s9")).toBeNull();
    expect(actualOf("work-order-shift-supersession", "s21")).toBeNull();
    expect(actualOf("work-order-shift-supersession", "s25")).toBe(6);
    // The recomputed completion digest (runner-proved equal to the emitted
    // event's digest via the reading-equals assertion s24) is a stable digest.
    expect(String(actualOf("work-order-shift-supersession", "s24"))).toMatch(/^progress_[0-9a-f]+$/);
  });

  it("project-closeout-archival — REAL terminal-state archival law, double archival refused, tenant-fail-closed reads with no existence leak", () => {
    expectJourneyPasses("project-closeout-archival", 15, 16);
    expect(actualOf("project-closeout-archival", "c2")).toBe("PROJECT_NOT_TERMINAL");
    expect(actualOf("project-closeout-archival", "c3")).toBe("ILLEGAL_TRANSITION");
    expect(actualOf("project-closeout-archival", "c5")).toBe("PROJECT_NOT_TERMINAL");
    expect(actualOf("project-closeout-archival", "c9")).toBe("ALREADY_ARCHIVED");
    expect(actualOf("project-closeout-archival", "c11")).toBe("tenant-fail-closed");
    expect(actualOf("project-closeout-archival", "c12")).toBe("CANCEL_REASON_REQUIRED");
    expect(actualOf("project-closeout-archival", "c7")).toBe("completed");
    expect(actualOf("project-closeout-archival", "c14")).toBe("cancelled");
    expect(actualOf("project-closeout-archival", "c15")).toBe(2);
    expect(actualOf("project-closeout-archival", "c16")).toBe("unknown-project");
  });

  it("procurement-order-authorization — REAL matcher with recorded tie-breaks and tenant filtering, the Guardian law A5 (never self-authorizes), the honest order lifecycle", () => {
    expectJourneyPasses("procurement-order-authorization", 10, 16);
    expect(actualOf("procurement-order-authorization", "v8")).toBe("AUTHORIZATION_REQUIRED");
    expect(actualOf("procurement-order-authorization", "v9")).toBe("AUTHORIZATION_DENIED");
    expect(actualOf("procurement-order-authorization", "v12")).toBe("ILLEGAL_TRANSITION");
    expect(actualOf("procurement-order-authorization", "v16")).toBe("ILLEGAL_TRANSITION");
    expect(actualOf("procurement-order-authorization", "v1")).toBe(2);
    expect(actualOf("procurement-order-authorization", "v2")).toBe("ven_north-supply");
    expect(actualOf("procurement-order-authorization", "v4")).toEqual(["ven_north-supply", "ven_harbor-parts"]);
    expect(actualOf("procurement-order-authorization", "v5")).toEqual(["higher_coverage"]);
    expect(actualOf("procurement-order-authorization", "v6")).toBe("ven_juliet-parts");
    expect(actualOf("procurement-order-authorization", "v7")).toEqual(["lexicographic_vendor_id"]);
    expect(actualOf("procurement-order-authorization", "v15")).toBe("received");
  });

  it("equipment-health-threshold-escalation — REAL escalation threshold (warning -> critical at 3), confidence caps at 1, honest degradation, supersession-aware registry, fail-closed foreign reads", () => {
    expectJourneyPasses("equipment-health-threshold-escalation", 14, 22);
    expect(actualOf("equipment-health-threshold-escalation", "t1")).toBe("insufficient-data");
    expect(actualOf("equipment-health-threshold-escalation", "t3")).toBe("warning");
    expect(actualOf("equipment-health-threshold-escalation", "t5")).toBe("critical");
    expect(actualOf("equipment-health-threshold-escalation", "t6")).toBe(0.6);
    expect(actualOf("equipment-health-threshold-escalation", "t7")).toBe(1);
    expect(actualOf("equipment-health-threshold-escalation", "t9")).toBe(2);
    expect(actualOf("equipment-health-threshold-escalation", "t10")).toBe("unknown-signal-vocabulary");
    expect(actualOf("equipment-health-threshold-escalation", "t11")).toEqual(["critical", "warning"]);
    expect(actualOf("equipment-health-threshold-escalation", "t17")).toBe("tenant-fail-closed");
    expect(actualOf("equipment-health-threshold-escalation", "t18")).toBe("tenant-fail-closed");
    expect(actualOf("equipment-health-threshold-escalation", "t20")).toBe("dx_haul-0002");
    expect(actualOf("equipment-health-threshold-escalation", "t22")).not.toBeNull();
  });
});
