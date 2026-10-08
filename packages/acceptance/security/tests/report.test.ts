/**
 * F270B report tests — coverage matrix honesty (zero-inflation), aggregate
 * counts, digest verify + tamper detection, determinism.
 */

import { describe, expect, it } from "vitest";
import {
  assembleAcceptanceReport,
  coverageCellsBackedByPassingJourneys,
  verifyAcceptanceReport,
} from "../src/report.ts";
import type { AcceptanceReport } from "../src/report.ts";
import { runAllJourneys, runJourney } from "../src/runner.ts";
import type { AcceptanceJourney, JourneyOutcome } from "../src/journey-contracts.ts";
import { SECURITY_JOURNEYS } from "../src/journeys/index.ts";

/** A genuinely-broken journey (real runner evaluation, honest failure). */
const broken: AcceptanceJourney = {
  journeyId: "fixture.failing",
  persona: "security-analyst",
  capabilities: ["investigate-findings"],
  goal: "A deliberately broken journey for report-level failure presentation",
  steps: [
    {
      stepId: "record",
      kind: "intake",
      description: "Records a fact",
      packages: ["@fleetos/security"],
      operations: ["runFindingIntake"],
      run: (ctx) => {
        ctx.record("fact", "real");
      },
    },
  ],
  assertions: [
    { assertionId: "broken-1", description: "Wrong expectation", path: "fact", expected: "wrong" },
    { assertionId: "broken-2", description: "Also wrong", path: "fact", expected: "also-wrong" },
  ],
};

function failingOutcome(): JourneyOutcome {
  const { outcome } = runJourney(broken);
  if (outcome.pass) throw new Error("broken fixture unexpectedly passed");
  return outcome;
}

describe("F270B acceptance report", () => {
  const outcomes = runAllJourneys(SECURITY_JOURNEYS);
  const report = assembleAcceptanceReport(outcomes);

  it("aggregates every journey in the corpus", () => {
    expect(report.totalJourneys).toBe(SECURITY_JOURNEYS.length);
    expect(report.passedJourneys).toBe(SECURITY_JOURNEYS.length);
    expect(report.failedJourneys).toBe(0);
    expect(report.journeys.length).toBe(SECURITY_JOURNEYS.length);
  });

  it("carries the persona x capability coverage matrix", () => {
    expect(report.coverage.personas.length).toBe(7);
    expect(report.coverage.capabilities.length).toBe(13);
    const cells = Object.values(report.coverage.matrix).flatMap((row) => Object.values(row));
    expect(cells.every((c) => c >= 0)).toBe(true);
    expect(cells.some((c) => c > 0)).toBe(true);
  });

  it("zero-inflation: every nonzero cell is backed by a passing journey", () => {
    expect(coverageCellsBackedByPassingJourneys(report, outcomes)).toBe(true);
  });

  it("zero-inflation: a failing journey contributes NOTHING to coverage", () => {
    const failing = failingOutcome();
    const mixed = assembleAcceptanceReport([...outcomes, failing]);
    const passRow = mixed.coverage.matrix["security-analyst"];
    const good = report.coverage.matrix["security-analyst"];
    expect(mixed.failedJourneys).toBe(1);
    for (const capability of Object.keys(good!)) {
      expect(passRow![capability]).toBe(good![capability]);
    }
    expect(coverageCellsBackedByPassingJourneys(mixed, [...outcomes, failing])).toBe(true);
  });

  it("every capability in the vocabulary is covered by at least one passing journey", () => {
    expect(report.uncoveredCapabilities).toEqual([]);
  });

  it("every persona in the vocabulary is covered by at least one passing journey", () => {
    expect(report.uncoveredPersonas).toEqual([]);
  });

  it("honest gap lists appear when a capability has no passing journey", () => {
    const empty = assembleAcceptanceReport([]);
    expect(empty.uncoveredCapabilities.length).toBe(13);
    expect(empty.uncoveredPersonas.length).toBe(7);
    expect(empty.totalJourneys).toBe(0);
  });

  it("verify recomputes the report digest", () => {
    expect(verifyAcceptanceReport(report)).toBe(true);
  });

  it("tampering with any presented field breaks verification", () => {
    const tampered: AcceptanceReport = { ...report, passedJourneys: report.passedJourneys + 5 };
    expect(verifyAcceptanceReport(tampered)).toBe(false);
    const tamperedCell: AcceptanceReport = {
      ...report,
      coverage: {
        ...report.coverage,
        matrix: { ...report.coverage.matrix, "ml-engineer": { ...report.coverage.matrix["ml-engineer"]!, "benchmark-trust": 99 } },
      },
    };
    expect(verifyAcceptanceReport(tamperedCell)).toBe(false);
    const tamperedJourney: AcceptanceReport = {
      ...report,
      journeys: report.journeys.map((j) => (j.journeyId === report.journeys[0]!.journeyId ? { ...j, pass: false } : j)),
    };
    expect(verifyAcceptanceReport(tamperedJourney)).toBe(false);
  });

  it("a tampered digest is detected", () => {
    const forged: AcceptanceReport = { ...report, digest: "deadbeef" };
    expect(verifyAcceptanceReport(forged)).toBe(false);
  });

  it("report assembly is deterministic (byte-identical re-assembly)", () => {
    const again = assembleAcceptanceReport(runAllJourneys(SECURITY_JOURNEYS));
    expect(again.digest).toBe(report.digest);
    expect(JSON.stringify(again)).toBe(JSON.stringify(report));
  });

  it("a failing journey is summarized with its failed assertions and steps", () => {
    const mixed = assembleAcceptanceReport([...outcomes, failingOutcome()]);
    const failing = mixed.journeys.find((j) => !j.pass);
    expect(failing).toBeDefined();
    expect(failing?.failedAssertionIds).toEqual(["broken-1", "broken-2"]);
    expect(failing?.failedStepIds).toEqual([]);
  });

  it("the corpus report claims only real lane capabilities", () => {
    const claimed = new Set(report.journeys.flatMap((j) => j.capabilities));
    for (const capability of claimed) {
      expect(report.coverage.capabilities).toContain(capability);
    }
  });
});
