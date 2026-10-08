/**
 * @fleetos/acceptance-field — the journey corpus tests (F270A).
 *
 * Every journey of the device/field corpus runs as its own test: the outcome
 * must PASS with every step ok and every assertion passed, the outcome digest
 * must verify, and one semantic anchor per journey is re-checked from the
 * recorded assertion ACTUALS (the REAL outputs the runner read).
 */

import { describe, expect, it } from "vitest";
import { FIELD_JOURNEYS } from "../src/journeys/index.js";
import { runJourneyCorpus } from "../src/runner.js";
import { verifyJourneyOutcome, type AssertionOutcome, type JourneyOutcome } from "../src/journey-contracts.js";

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

function expectJourneyPasses(journeyId: string): JourneyOutcome {
  const outcome = outcomeOf(journeyId);
  expect(outcome.passed, `journey ${journeyId} must pass`).toBe(true);
  expect(outcome.steps.length).toBeGreaterThan(0);
  expect(outcome.steps.every((s) => s.ok), `journey ${journeyId} steps must all be ok`).toBe(true);
  expect(outcome.assertions.length).toBeGreaterThan(0);
  expect(outcome.assertions.every((a) => a.pass), `journey ${journeyId} assertions must all pass`).toBe(true);
  expect(verifyJourneyOutcome(outcome)).toBe(true);
  expect(outcome.digest).toMatch(/^[0-9a-f]{8}$/);
  return outcome;
}

describe("F270A device/field acceptance journeys", () => {
  it("corpus shape: 14 journeys, fixed ids, no duplicates", () => {
    expect(FIELD_JOURNEYS.length).toBe(14);
    const ids = FIELD_JOURNEYS.map((j) => j.id);
    expect(new Set(ids).size).toBe(14);
    expect([...OUTCOMES.keys()].sort()).toEqual([...ids].sort());
  });

  it("enrollment — new asset appears in the fleet overview with status + identity refs", () => {
    const outcome = expectJourneyPasses("enroll-new-asset");
    expect(outcome.persona).toBe("fleet-operator");
    expect(actualOf("enroll-new-asset", "e11")).toBe(1);
    expect(actualOf("enroll-new-asset", "e16")).toBe("fresh");
    expect(actualOf("enroll-new-asset", "e19")).toEqual(["location", "operatorContact"]);
  });

  it("trustworthy state — recency windows + honest staleness classification + idempotent ingestion", () => {
    expectJourneyPasses("trustworthy-state-recency");
    expect(actualOf("trustworthy-state-recency", "s2")).toBe("fresh");
    expect(actualOf("trustworthy-state-recency", "s10")).toBe("stale");
    expect(actualOf("trustworthy-state-recency", "s12")).toBe("unknown");
  });

  it("investigation — injected sim fault surfaces as the top field priority-queue alert", () => {
    expectJourneyPasses("investigate-injected-fault");
    expect(actualOf("investigate-injected-fault", "i11")).toBe("critical");
    expect(actualOf("investigate-injected-fault", "i12")).toBe("event.fault");
  });

  it("recovery — open case moves through the timeline and completes with evidence", () => {
    expectJourneyPasses("recover-lost-device");
    expect(actualOf("recover-lost-device", "r15")).toBe(0);
    expect(actualOf("recover-lost-device", "r18")).toBe("closed");
  });

  it("maintenance — the order crosses every board column to completion", () => {
    expectJourneyPasses("maintain-asset-schedule");
    expect(actualOf("maintain-asset-schedule", "m12")).toBe(1);
    expect(actualOf("maintain-asset-schedule", "m13")).toBe(1);
  });

  it("field mode — offline tolerance: last-known provenance, bounded sections, priority order", () => {
    expectJourneyPasses("field-mode-offline-tolerance");
    expect(actualOf("field-mode-offline-tolerance", "f6")).toBe("stale");
    expect(actualOf("field-mode-offline-tolerance", "f7")).toEqual(["top-alerts", "connectivity-status"]);
  });

  it("connectivity — intent lifecycle + honest aligned/divergent/unknown rollups", () => {
    expectJourneyPasses("connectivity-postures");
    expect(actualOf("connectivity-postures", "c13")).toBe(1);
    expect(actualOf("connectivity-postures", "c17")).toBe("divergent");
  });

  it("edge command — full ADCOS lifecycle, journal verification, honest health degradation", () => {
    expectJourneyPasses("edge-command-lifecycle");
    expect(actualOf("edge-command-lifecycle", "a9")).toBe("reconciled");
    expect(actualOf("edge-command-lifecycle", "a18")).toBe("degraded");
  });

  it("simulation-driven — EXPERIMENTAL markers, world/scenario digests, byte-identical replay", () => {
    expectJourneyPasses("simulation-driven-experiment");
    expect(actualOf("simulation-driven-experiment", "x3")).toBe("EXPERIMENTAL");
    expect(actualOf("simulation-driven-experiment", "x7")).toBe(true);
  });

  it("mission replay — suspended mission resumes without re-executing completed stages", () => {
    expectJourneyPasses("mission-replay-resume");
    expect(actualOf("mission-replay-resume", "n8")).toEqual(["stage-3", "stage-4"]);
    expect(actualOf("mission-replay-resume", "n17")).toEqual([1, 1, 1, 1]);
  });

  it("handoff publish — the technician's carrier holds the real shift state", () => {
    const outcome = expectJourneyPasses("handoff-field-to-operator-publish");
    expect(outcome.handoff?.handoffId).toBe("hd_field-to-ops-01");
    expect(actualOf("handoff-field-to-operator-publish", "h10")).toEqual(["rc_handoff-0001"]);
  });

  it("handoff consume — the operator verifies the SAME state and acts on the case", () => {
    expectJourneyPasses("handoff-field-to-operator-consume");
    expect(actualOf("handoff-field-to-operator-consume", "k4")).toBe(true);
    expect(actualOf("handoff-field-to-operator-consume", "k8")).toBe("investigating");
  });

  it("mobile — the field view is machine-checked phone-shaped (bounded, priority-ordered)", () => {
    expectJourneyPasses("mobile-field-shape");
    expect(actualOf("mobile-field-shape", "p4")).toBe(true);
    expect(actualOf("mobile-field-shape", "p9")).toEqual(["critical", "warning", "info"]);
  });

  it("tenant isolation — every read-model and lookup fails closed on a foreign-tenant record", () => {
    expectJourneyPasses("tenant-isolation-fail-closed");
    expect(actualOf("tenant-isolation-fail-closed", "o3")).toBe("cross-tenant-ref");
    expect(actualOf("tenant-isolation-fail-closed", "o7c")).toBe("device-tenant-mismatch");
  });

  it("every journey's assertions cover its full chain (>= 10 assertions each)", () => {
    for (const journey of FIELD_JOURNEYS) {
      const outcome = outcomeOf(journey.id);
      expect(
        outcome.assertions.length,
        `${journey.id} must assert its full chain`,
      ).toBeGreaterThanOrEqual(10);
    }
  });

  it("assertion outcomes record expected vs actual (never silent)", () => {
    const outcome = outcomeOf("enroll-new-asset");
    for (const a of outcome.assertions as readonly AssertionOutcome[]) {
      expect(a.id).toBeTruthy();
      expect(a.description).toBeTruthy();
      expect(a.reading).toBeTruthy();
      expect(typeof a.pass).toBe("boolean");
      expect("expected" in a && "actual" in a).toBe(true);
    }
  });
});
