/**
 * @fleetos/acceptance-field — acceptance report tests: aggregates, the
 * persona × capability coverage matrix, honest zero-inflation, digest +
 * tamper detection.
 */

import { describe, expect, it } from "vitest";
import { FIELD_JOURNEYS, enrollNewAssetJourney } from "../src/journeys/index.js";
import { assembleAcceptanceReport, summarizeOutcome, verifyAcceptanceReport } from "../src/report.js";
import { CAPABILITIES, PERSONAS } from "../src/journey-contracts.js";

describe("acceptance report assembly", () => {
  const report = assembleAcceptanceReport(FIELD_JOURNEYS);

  it("aggregates the corpus honestly: 20 journeys (14 + 6 F300A host-integration), 0 failures", () => {
    expect(report.schemaVersion).toBe(1);
    expect(report.aggregate.journeys).toBe(20);
    expect(report.aggregate.passed).toBe(20);
    expect(report.aggregate.failed).toBe(0);
    expect(report.aggregate.failedSteps).toBe(0);
    expect(report.aggregate.failedAssertions).toBe(0);
    expect(report.aggregate.steps).toBe(
      FIELD_JOURNEYS.reduce((acc, j) => acc + j.steps.length, 0),
    );
    expect(report.aggregate.assertions).toBe(
      FIELD_JOURNEYS.reduce((acc, j) => acc + j.assertions.length, 0),
    );
    expect(report.aggregate.passedAssertions).toBe(report.aggregate.assertions);
  });

  it("the coverage matrix is the full fixed persona × capability grid", () => {
    expect(report.coverage.length).toBe(PERSONAS.length * CAPABILITIES.length);
    for (const persona of PERSONAS) {
      for (const capability of CAPABILITIES) {
        const cell = report.coverage.find((c) => c.persona === persona && c.capability === capability);
        expect(cell, `cell ${persona}/${capability}`).toBeDefined();
      }
    }
  });

  it("covered cells equal the passing journeys' persona × capability pairs", () => {
    const covered = report.coverage.filter((c) => c.covered);
    const pairs = new Set(FIELD_JOURNEYS.map((j) => `${j.persona}|${j.capability}`));
    expect(covered.length).toBe(pairs.size);
    for (const cell of covered) {
      expect(pairs.has(`${cell.persona}|${cell.capability}`)).toBe(true);
      // A cell may hold MORE than one distinct journey (F300A adds a second
      // field-technician host-integration journey); every journey in a
      // covered cell must pass.
      expect(cell.journeys).toBeGreaterThanOrEqual(1);
      expect(cell.passing).toBe(cell.journeys);
    }
  });

  it("every capability is covered by at least one passing journey (no gaps)", () => {
    expect(report.coveredCapabilities.length).toBe(CAPABILITIES.length);
    for (const capability of CAPABILITIES) {
      expect(report.coveredCapabilities).toContain(capability);
    }
  });

  it("the report digest verifies; tampering any part breaks it", () => {
    expect(verifyAcceptanceReport(report)).toBe(true);
    const tamperedAggregate = { ...report, aggregate: { ...report.aggregate, failed: 3 } };
    expect(verifyAcceptanceReport(tamperedAggregate)).toBe(false);
    const tamperedOutcome = {
      ...report,
      outcomes: report.outcomes.map((o) => (o.journeyId === "enroll-new-asset" ? { ...o, passed: false } : o)),
    };
    expect(verifyAcceptanceReport(tamperedOutcome)).toBe(false);
  });

  it("zero-inflation: a failing journey NEVER marks its capability covered", () => {
    const broken = {
      ...enrollNewAssetJourney,
      assertions: [
        ...enrollNewAssetJourney.assertions,
        { id: "e-broken", description: "deliberately wrong expectation", reading: "t7.overview.assets", op: "number-gte" as const, expected: 99 },
      ],
    };
    const brokenReport = assembleAcceptanceReport([broken]);
    expect(brokenReport.aggregate.journeys).toBe(1);
    expect(brokenReport.aggregate.passed).toBe(0);
    expect(brokenReport.aggregate.failed).toBe(1);
    expect(brokenReport.coveredCapabilities).toEqual([]);
    const cell = brokenReport.coverage.find(
      (c) => c.persona === broken.persona && c.capability === broken.capability,
    );
    expect(cell?.journeys).toBe(1);
    expect(cell?.passing).toBe(0);
    expect(cell?.covered).toBe(false);
  });

  it("summarizeOutcome renders PASS and FAIL lines with the failing ids", () => {
    const passing = report.outcomes[0]!;
    expect(summarizeOutcome(passing)).toBe(
      `PASS ${passing.journeyId} [${passing.persona}/${passing.capability}] steps=${passing.steps.length} assertions=${passing.assertions.length}`,
    );
    const failing = runFailingJourney();
    const line = summarizeOutcome(failing);
    expect(line.startsWith("FAIL")).toBe(true);
    expect(line).toContain("failedSteps=[t1]");
    expect(line).toContain("failedAssertions=[e1]");
  });

  it("the report is deterministic (byte-identical digest on re-assembly)", () => {
    const again = assembleAcceptanceReport(FIELD_JOURNEYS);
    expect(again.digest).toBe(report.digest);
  });
});

/** A deliberately-broken journey (refused step + missing reading) for the FAIL summary line. */
function runFailingJourney() {
  const broken = {
    ...enrollNewAssetJourney,
    steps: [
      { id: "t1", summary: "activate an asset that was never admitted (must refuse)", op: { kind: "asset.activate" as const, assetId: "ast_never-admitted" } },
    ],
    assertions: [
      { id: "e1", description: "reading that will never exist", reading: "t9.nothing.here", op: "not-null" as const },
    ],
  };
  const report = assembleAcceptanceReport([broken]);
  const outcome = report.outcomes[0]!;
  expect(outcome.passed).toBe(false);
  return outcome;
}
