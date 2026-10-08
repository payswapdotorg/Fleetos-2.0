/**
 * Runner semantics: determinism, honest failure detection, missing facts,
 * thrown steps, and tenancy fail-closed inside the journeys.
 */

import { describe, expect, it } from "vitest";
import { JOURNEYS } from "../src/journeys/index.js";
import { runJourney, runAllJourneys } from "../src/runner.js";
import {
  MISSING_FACT,
  canonicalJson,
  type AcceptanceJourney,
  type JourneyStep,
} from "../src/journey-contracts.js";

const createWork = JOURNEYS[0]!;

/** A deliberately-broken journey: the assertion expects the wrong count. */
function brokenJourney(): AcceptanceJourney {
  return {
    ...createWork,
    id: "broken-create-work-order",
    assertions: [
      { id: "b1", description: "deliberately wrong", fact: "workBoard.todoCount", op: "eq", expected: 7 },
    ],
  };
}

describe("journey runner", () => {
  it("re-runs byte-identically (same journey, fresh world)", async () => {
    const first = await runJourney(createWork);
    const second = await runJourney(createWork);
    expect(canonicalJson(first.outcome)).toBe(canonicalJson(second.outcome));
  });

  it("re-runs the full corpus byte-identically", async () => {
    const first = await runAllJourneys(JOURNEYS);
    const second = await runAllJourneys(JOURNEYS);
    expect(canonicalJson(first)).toBe(canonicalJson(second));
  });

  it("produces a journey digest of the FNV-1a lane shape", async () => {
    const { outcome } = await runJourney(createWork);
    expect(outcome.digest).toMatch(/^journey_[0-9a-f]{8}$/);
  });

  it("a deliberately-broken journey FAILS (no soft passes)", async () => {
    const { outcome } = await runJourney(brokenJourney());
    expect(outcome.passed).toBe(false);
    expect(outcome.assertionOutcomes[0]?.ok).toBe(false);
  });

  it("the failing assertion reports the ACTUAL vs EXPECTED values", async () => {
    const { outcome } = await runJourney(brokenJourney());
    const failing = outcome.assertionOutcomes[0]!;
    expect(failing.actual).toBe(1);
    expect(failing.expected).toBe(7);
    expect(failing.op).toBe("eq");
  });

  it("a broken journey has a different digest than the healthy one", async () => {
    const healthy = await runJourney(createWork);
    const broken = await runJourney(brokenJourney());
    expect(broken.outcome.digest).not.toBe(healthy.outcome.digest);
  });

  it("an assertion on a fact that was never produced fails with the MISSING_FACT sentinel", async () => {
    const journey: AcceptanceJourney = {
      ...createWork,
      id: "missing-fact-journey",
      assertions: [
        { id: "m1", description: "no driver produces this fact", fact: "no.such.fact", op: "eq", expected: 1 },
      ],
    };
    const { outcome } = await runJourney(journey);
    expect(outcome.passed).toBe(false);
    expect(outcome.assertionOutcomes[0]?.actual).toBe(MISSING_FACT);
  });

  it("a step whose driver throws marks the step not-executed and fails the journey", async () => {
    const bogus = { stepId: "s1", kind: "not-a-real-kind" } as unknown as JourneyStep;
    const journey: AcceptanceJourney = {
      ...createWork,
      id: "throwing-step-journey",
      steps: [bogus],
      assertions: [],
    };
    const { outcome } = await runJourney(journey);
    expect(outcome.passed).toBe(false);
    expect(outcome.stepOutcomes[0]?.executed).toBe(false);
    expect(outcome.stepOutcomes[0]?.ok).toBe(false);
  });

  it("keeps step execution order (declared order, not lexical)", async () => {
    const journey = JOURNEYS[4]!;
    const { outcome } = await runJourney(journey);
    const ids = outcome.stepOutcomes.map((s) => s.stepId);
    expect(ids).toEqual(journey.steps.map((s) => s.stepId));
  });

  it("exposes the observed facts for independent inspection", async () => {
    const { facts } = await runJourney(createWork);
    expect(facts.get("workBoard.todoCount")).toBe(1);
    expect(facts.has("work.create.wo-1.status")).toBe(true);
  });

  it("tenancy fail-closed inside journeys: the cross-tenant spine view refuses", async () => {
    const journey = JOURNEYS.find((j) => j.id === "tenant-fail-closed")!;
    const { facts, outcome } = await runJourney(journey);
    expect(outcome.passed).toBe(true);
    expect(facts.get("spine.ok")).toBe(false);
    expect(facts.get("spine.reasonCode")).toBe("TENANT_MISMATCH");
  });

  it("the tenant-fail-closed journey still completes its in-tenant chain after the refusals", async () => {
    const journey = JOURNEYS.find((j) => j.id === "tenant-fail-closed")!;
    const { facts } = await runJourney(journey);
    expect(facts.get("fulfillment.status")).toBe("verified");
    expect(facts.get("flow.status")).toBe("solicited");
  });

  it("running a journey in isolation matches running it after another journey (fresh world per run)", async () => {
    const isolated = await runJourney(JOURNEYS[6]!);
    await runJourney(JOURNEYS[0]!);
    const after = await runJourney(JOURNEYS[6]!);
    expect(isolated.outcome.digest).toBe(after.outcome.digest);
  });

  it("the corpus exercises a broad typed step vocabulary", () => {
    const kinds = new Set(JOURNEYS.flatMap((j) => j.steps.map((s) => s.kind)));
    expect(kinds.size).toBeGreaterThanOrEqual(25);
  });
});
