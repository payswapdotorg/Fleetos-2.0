/**
 * Report assembly: coverage matrix, honest zero-inflation, digest + tamper
 * detection, deterministic rendering.
 */

import { describe, expect, it } from "vitest";
import { JOURNEYS } from "../src/journeys/index.js";
import { runJourney, runAllJourneys } from "../src/runner.js";
import {
  assembleJourneyReport,
  computeReportDigest,
  renderReportJson,
  verifyJourneyReport,
} from "../src/report.js";
import { JOURNEY_PERSONAS, JOURNEY_CAPABILITIES } from "../src/journey-contracts.js";

describe("acceptance report", () => {
  it("assembles a full-corpus report with every journey passed", async () => {
    const outcomes = await runAllJourneys(JOURNEYS);
    const report = assembleJourneyReport(outcomes);
    expect(report.totals.journeyCount).toBe(JOURNEYS.length);
    expect(report.totals.passed).toBe(JOURNEYS.length);
    expect(report.totals.failed).toBe(0);
    expect(report.totals.failedAssertions).toBe(0);
  });

  it("counts assertions across the corpus", async () => {
    const outcomes = await runAllJourneys(JOURNEYS);
    const report = assembleJourneyReport(outcomes);
    const expected = JOURNEYS.reduce((sum, j) => sum + j.assertions.length, 0);
    expect(report.totals.assertionCount).toBe(expected);
    expect(expected).toBeGreaterThanOrEqual(60);
  });

  it("has one coverage cell per persona × capability pair", async () => {
    const outcomes = await runAllJourneys(JOURNEYS);
    const report = assembleJourneyReport(outcomes);
    expect(report.coverage.length).toBe(JOURNEY_PERSONAS.length * JOURNEY_CAPABILITIES.length);
    expect(JOURNEY_PERSONAS.length).toBe(7);
    expect(JOURNEY_CAPABILITIES.length).toBe(14);
  });

  it("zero-inflation: a persona/capability pair with no journey is NOT covered", async () => {
    const outcomes = await runAllJourneys(JOURNEYS);
    const report = assembleJourneyReport(outcomes);
    const empty = report.coverage.find(
      (c) => c.persona === "finance-controller" && c.capability === "create-work",
    );
    expect(empty).toBeDefined();
    expect(empty?.passing).toBe(0);
    expect(empty?.failing).toBe(0);
    expect(empty?.covered).toBe(false);
  });

  it("zero-inflation: a capability whose only journey FAILED is not covered", async () => {
    const good = await runJourney(JOURNEYS[0]!);
    const bad = { ...good.outcome, passed: false, journeyId: "broken-twin" };
    const report = assembleJourneyReport([bad]);
    const cell = report.coverage.find(
      (c) => c.persona === bad.persona && c.capability === bad.capability,
    );
    expect(cell?.covered).toBe(false);
    expect(cell?.failing).toBe(1);
  });

  it("a capability with one passing and one failing journey is covered with the failure recorded", async () => {
    const good = await runJourney(JOURNEYS[0]!);
    const bad = { ...good.outcome, passed: false, journeyId: "broken-twin" };
    const report = assembleJourneyReport([good.outcome, bad]);
    const cell = report.coverage.find(
      (c) => c.persona === good.outcome.persona && c.capability === good.outcome.capability,
    );
    expect(cell?.covered).toBe(true);
    expect(cell?.passing).toBe(1);
    expect(cell?.failing).toBe(1);
  });

  it("the report digest verifies", async () => {
    const outcomes = await runAllJourneys(JOURNEYS);
    const report = assembleJourneyReport(outcomes);
    expect(verifyJourneyReport(report)).toBe(true);
  });

  it("tampering with the totals breaks verification", async () => {
    const outcomes = await runAllJourneys(JOURNEYS);
    const report = assembleJourneyReport(outcomes);
    const tampered = { ...report, totals: { ...report.totals, passed: report.totals.passed + 1 } };
    expect(verifyJourneyReport(tampered)).toBe(false);
  });

  it("tampering with an outcome breaks verification", async () => {
    const outcomes = await runAllJourneys(JOURNEYS);
    const report = assembleJourneyReport(outcomes);
    const tamperedOutcomes = outcomes.map((o, i) => (i === 0 ? { ...o, passed: false } : o));
    const tampered = { ...report, outcomes: tamperedOutcomes };
    expect(verifyJourneyReport(tampered)).toBe(false);
  });

  it("tampering with a coverage cell breaks verification", async () => {
    const outcomes = await runAllJourneys(JOURNEYS);
    const report = assembleJourneyReport(outcomes);
    const coverage = report.coverage.map((c, i) => (i === 0 ? { ...c, covered: !c.covered } : c));
    const tampered = { ...report, coverage };
    expect(verifyJourneyReport(tampered)).toBe(false);
  });

  it("renders deterministic JSON (byte-identical re-render)", async () => {
    const outcomes = await runAllJourneys(JOURNEYS);
    const report = assembleJourneyReport(outcomes);
    expect(renderReportJson(report)).toBe(renderReportJson(report));
  });

  it("the digest is a pure function of the report content", async () => {
    const outcomes = await runAllJourneys(JOURNEYS);
    const report = assembleJourneyReport(outcomes);
    const { digest: _d, ...rest } = report;
    expect(computeReportDigest(rest)).toBe(report.digest);
  });

  it("a failing outcome keeps its failing assertions visible in the report", async () => {
    const good = await runJourney(JOURNEYS[0]!);
    const bad = { ...good.outcome, passed: false, journeyId: "broken-twin" };
    const report = assembleJourneyReport([bad]);
    expect(report.totals.failed).toBe(1);
    expect(report.totals.failedAssertions).toBe(
      bad.assertionOutcomes.filter((a) => !a.ok).length,
    );
    expect(report.outcomes[0]?.journeyId).toBe("broken-twin");
  });

  it("every journey outcome in the report carries the vocabulary fields", async () => {
    const outcomes = await runAllJourneys(JOURNEYS);
    const report = assembleJourneyReport(outcomes);
    for (const outcome of report.outcomes) {
      expect(JOURNEY_PERSONAS).toContain(outcome.persona);
      expect(JOURNEY_CAPABILITIES).toContain(outcome.capability);
      expect(outcome.stepOutcomes.length).toBeGreaterThan(0);
    }
  });
});
