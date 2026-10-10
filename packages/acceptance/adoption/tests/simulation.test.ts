/**
 * THE REAL-RUN INTEGRATION TEST: the full simulation over the REAL corpora
 * (all 10 industries, all 30 workspaces) — run ONCE, asserted end-to-end.
 * Every number here is a REAL runner output or a recorded shortfall.
 */

import { describe, expect, it } from "vitest";
import { runAdoptionSimulation } from "../src/adoption-run.js";
import { assembleAdoptionReport, renderReportJson, verifyAdoptionReport } from "../src/report.js";
import { INDUSTRIES, industryById } from "../src/industries.js";
import { computeVerdict } from "../src/verdicts.js";

const SIMULATION = await runAdoptionSimulation();
const REPORT = assembleAdoptionReport(SIMULATION);

describe("full industry adoption simulation (REAL corpora)", () => {
  it("runs 10 industries × 3 firms = 30 workspaces", () => {
    expect(SIMULATION.aggregate.industries).toBe(10);
    expect(SIMULATION.aggregate.workspaces).toBe(30);
    expect(SIMULATION.firmRuns.length).toBe(30);
    expect(INDUSTRIES.length).toBe(10);
  });

  it("executes 1848 COUNTED journeys over the REAL corpora (plus 555 raw epoch re-runs, never counted)", () => {
    expect(SIMULATION.aggregate.fieldExecutions).toBe(555);
    expect(SIMULATION.aggregate.commerceExecutions).toBe(822);
    expect(SIMULATION.aggregate.securityExecutions).toBe(471);
    expect(SIMULATION.aggregate.journeyExecutions).toBe(1848);
    expect(SIMULATION.aggregate.uniqueApplicableJourneys).toBe(616);
    expect(SIMULATION.aggregate.fieldEpochReRuns).toBe(555);
  });

  it("journeys > 0 and every counted execution PASSED (REAL outcomes, never re-computed)", () => {
    expect(SIMULATION.aggregate.journeyExecutions).toBeGreaterThan(0);
    expect(SIMULATION.aggregate.allJourneysPassed).toBe(true);
    for (const run of SIMULATION.firmRuns) {
      expect(run.executionFacts.length).toBe(run.executionCounts.total);
      for (const fact of run.executionFacts) {
        expect(fact.passed).toBe(true);
        expect(fact.failureNote).toBeNull();
        // Digest shapes are the owning runner's REAL conventions (field: 8
        // hex chars; security/commerce: `journey_`-prefixed hex).
        expect(fact.digest).toMatch(/^(journey_)?[0-9a-f]{8}$/);
      }
    }
  });

  it("ALL deterministic: every firm's re-runs are byte-identical (30 proofs)", () => {
    expect(SIMULATION.aggregate.determinismProofs).toBe(30);
    expect(SIMULATION.aggregate.determinismVerified).toBe(true);
    for (const run of SIMULATION.firmRuns) {
      expect(run.determinismProof.verified).toBe(true);
    }
  });

  it("the per-industry verdict table is exactly the honest computation", () => {
    const expected: Record<string, string> = {
      manufacturing: "SWITCH-ONLY",
      construction: "MAIN-INTERFACE",
      "energy-utilities": "MAIN-INTERFACE",
      "transportation-logistics": "COMPLEMENT",
      agriculture: "COMPLEMENT",
      "healthcare-facilities": "COMPLEMENT",
      "facilities-management": "MAIN-INTERFACE",
      telecommunications: "COMPLEMENT",
      mining: "MAIN-INTERFACE",
      "water-waste": "MAIN-INTERFACE",
    };
    expect(REPORT.industryVerdicts.length).toBe(10);
    for (const row of REPORT.industryVerdicts) {
      expect(row.verdict).toBe(expected[row.industryId]);
      expect(row.coverageRatio).toBe(1); // all applicable journeys passed — honestly
      expect(row.coveragePassed).toBe(row.coverageTotal);
    }
    // Verdict distribution: 1 SWITCH-ONLY, 5 MAIN-INTERFACE, 4 COMPLEMENT, 0 RETAIN.
    const verdicts = REPORT.industryVerdicts.map((v) => v.verdict);
    expect(verdicts.filter((v) => v === "SWITCH-ONLY")).toHaveLength(1);
    expect(verdicts.filter((v) => v === "MAIN-INTERFACE")).toHaveLength(5);
    expect(verdicts.filter((v) => v === "COMPLEMENT")).toHaveLength(4);
    expect(verdicts.filter((v) => v === "RETAIN")).toHaveLength(0);
  });

  it("no industry earned RETAIN on the REAL corpora — RETAIN is machine-proven by negative fixtures (verdicts.test.ts)", () => {
    // The honest statement: zero real failures existed to trigger RETAIN;
    // the negative fixtures prove the rubric fails closed when one appears.
    expect(REPORT.industryVerdicts.every((v) => v.failingJourneys.length === 0)).toBe(true);
    const mining = computeVerdict(industryById("mining")!, SIMULATION.firmRuns
      .filter((r) => r.industry.id === "mining")
      .flatMap((r) => r.executionFacts));
    expect(mining.verdict).toBe("MAIN-INTERFACE");
  });

  it("mobile validation passes for all 10 industries; handoff families all pass", () => {
    expect(REPORT.mobileValidation.length).toBe(10);
    for (const row of REPORT.mobileValidation) {
      expect(row.hasFieldApplicability).toBe(true);
      expect(row.journeyId).toBe("mobile-field-shape");
      expect(row.passed).toBe(true);
      expect(row.executions).toBe(3);
    }
    expect(REPORT.handoffValidation.length).toBe(10);
    for (const row of REPORT.handoffValidation) {
      expect(row.allPassed).toBe(true);
      for (const journey of row.journeys) {
        expect(journey.passed).toBe(true);
        expect(journey.executions).toBe(3);
      }
    }
  });

  it("the population table mirrors every firm's counted executions", () => {
    expect(REPORT.population.length).toBe(30);
    for (const run of SIMULATION.firmRuns) {
      const row = REPORT.population.find((p) => p.firmId === run.firm.id);
      expect(row).toBeDefined();
      expect(row?.totalExecutions).toBe(run.executionCounts.total);
      expect(row?.fieldExecutions).toBe(run.executionCounts.field);
      expect(row?.commerceExecutions).toBe(run.executionCounts.commerce);
      expect(row?.securityExecutions).toBe(run.executionCounts.security);
      expect(row?.tenantId).toBe(run.firm.tenantId);
      expect(row?.fieldEpochs).toBe(run.firm.epochCount);
    }
  });

  it("honest-counts ledger: every firm below 100 with exact shortfalls + structural reasons", () => {
    const { honestCounts } = REPORT;
    expect(honestCounts.targetPerFirm).toBe(100);
    expect(honestCounts.entries.length).toBe(30);
    expect(honestCounts.entries.every((e) => e.executed < 100)).toBe(true);
    const maxExecuted = Math.max(...honestCounts.entries.map((e) => e.executed));
    expect(maxExecuted).toBe(68); // manufacturing/energy fully applicable: 20+31+17 (F310C commerce extension)
    expect(honestCounts.aggregateShortfall).toBe(30 * 100 - SIMULATION.aggregate.journeyExecutions);
    for (const reason of honestCounts.structuralReasons) {
      expect(reason.length).toBeGreaterThan(30);
    }
    // The masked-journey reason varies per firm (per-industry masks).
    const agricultureEntry = honestCounts.entries.find((e) => e.firmId === "firm-agriculture-large");
    expect(agricultureEntry?.reasons.some((r) => r.includes("17 journey(s) masked"))).toBe(true);
  });

  it("the report verifies and renders deterministically", () => {
    expect(verifyAdoptionReport(REPORT)).toBe(true);
    const again = renderReportJson(assembleAdoptionReport(SIMULATION));
    expect(renderReportJson(REPORT)).toBe(again);
    expect(REPORT.digest).toMatch(/^[0-9a-f]{8}$/);
  });
});
