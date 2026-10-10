/**
 * Report assembly: structure, mobile + handoff validation, incumbent
 * comparison, honest counts, digest + tamper detection, deterministic
 * rendering. Uses a 2-industry simulation for speed; the FULL report is
 * asserted in simulation.test.ts.
 */

import { describe, expect, it } from "vitest";
import { runAdoptionSimulation } from "../src/adoption-run.js";
import { assembleAdoptionReport, renderReportJson, verifyAdoptionReport } from "../src/report.js";

const SIM = await runAdoptionSimulation({ industryIds: ["manufacturing", "agriculture"] });
const REPORT = assembleAdoptionReport(SIM);

describe("adoption report (2-industry simulation)", () => {
  it("assembles the population table with one row per firm workspace", () => {
    expect(REPORT.population.length).toBe(6);
    const manufacturingRows = REPORT.population.filter((r) => r.industryId === "manufacturing");
    expect(manufacturingRows.length).toBe(3);
    for (const row of manufacturingRows) {
      expect(row.tenantId).toMatch(/^tnt_manufacturing-(small|medium|large)$/);
      expect(row.fieldEpochs).toBe(row.size === "small" ? 1 : row.size === "medium" ? 2 : 3);
      expect(row.totalExecutions).toBe(row.fieldExecutions + row.commerceExecutions + row.securityExecutions);
      expect(row.devices).toBeGreaterThan(0);
    }
  });

  it("carries per-industry verdicts with their exact inputs", () => {
    expect(REPORT.industryVerdicts.length).toBe(2);
    const manufacturing = REPORT.industryVerdicts.find((v) => v.industryId === "manufacturing");
    expect(manufacturing?.verdict).toBe("SWITCH-ONLY");
    expect(manufacturing?.coverageTotal).toBe(68);
    expect(manufacturing?.coveragePassed).toBe(68);
    expect(manufacturing?.coverageRatio).toBe(1);
    expect(manufacturing?.unmappedCapabilities).toHaveLength(0);
    const agriculture = REPORT.industryVerdicts.find((v) => v.industryId === "agriculture");
    expect(agriculture?.verdict).toBe("COMPLEMENT");
    expect(agriculture?.unmappedCapabilities.map((u) => u.capabilityId)).toContain("agronomy-prescriptive-analytics");
  });

  it("mobile validation: applicable + passing for every industry with field applicability", () => {
    expect(REPORT.mobileValidation.length).toBe(2);
    for (const row of REPORT.mobileValidation) {
      expect(row.hasFieldApplicability).toBe(true);
      expect(row.journeyId).toBe("mobile-field-shape");
      expect(row.passed).toBe(true);
      expect(row.executions).toBe(3); // one counted execution per firm
    }
  });

  it("cross-role handoff family validated per industry (all three journeys)", () => {
    expect(REPORT.handoffValidation.length).toBe(2);
    for (const row of REPORT.handoffValidation) {
      expect(row.journeys.map((j) => j.journeyId)).toEqual([
        "handoff-field-to-operator-publish",
        "handoff-field-to-operator-consume",
        "cross-role-handoff",
      ]);
      expect(row.allPassed).toBe(true);
      for (const journey of row.journeys) {
        expect(journey.executions).toBe(3);
      }
    }
  });

  it("incumbent-vs-FleetOS comparison rows carry both honest sides", () => {
    expect(REPORT.incumbentComparison.length).toBe(2);
    const agriculture = REPORT.incumbentComparison.find((c) => c.industryId === "agriculture");
    expect(agriculture?.capabilities.length).toBeGreaterThan(10);
    const moat = agriculture?.capabilities.find((c) => c.capabilityId === "agronomy-prescriptive-analytics");
    expect(moat?.fleetosStatus).toBe("unmapped");
    expect(moat?.family).toHaveLength(0);
    expect(moat?.incumbentSummary.length).toBeGreaterThan(10);
    expect(moat?.incumbentDoesNot.length).toBeGreaterThan(10);
    const replaced = agriculture?.capabilities.find((c) => c.capabilityId === "maintenance-planning");
    expect(replaced?.fleetosStatus).toBe("replaced");
  });

  it("honest-counts ledger is complete and exact", () => {
    expect(REPORT.honestCounts.targetPerFirm).toBe(100);
    expect(REPORT.honestCounts.entries.length).toBe(6);
    for (const entry of REPORT.honestCounts.entries) {
      expect(entry.shortfall).toBe(entry.target - entry.executed);
      expect(entry.executed).toBeLessThan(100);
    }
    expect(REPORT.honestCounts.structuralReasons.length).toBe(5);
    expect(REPORT.honestCounts.aggregateShortfall).toBe(
      REPORT.honestCounts.entries.reduce((acc, e) => acc + e.shortfall, 0),
    );
  });

  it("aggregate block mirrors the simulation result", () => {
    expect(REPORT.aggregate.workspaces).toBe(6);
    expect(REPORT.aggregate.industries).toBe(2);
    expect(REPORT.aggregate.journeyExecutions).toBe(SIM.aggregate.journeyExecutions);
    expect(REPORT.aggregate.determinismVerified).toBe(true);
    expect(REPORT.aggregate.allJourneysPassed).toBe(true);
    expect(REPORT.schemaVersion).toBe(1);
    expect(REPORT.generatedAt).toBe(SIM.startedAt);
  });

  it("digest verifies over the whole report", () => {
    expect(REPORT.digest).toMatch(/^[0-9a-f]{8}$/);
    expect(verifyAdoptionReport(REPORT)).toBe(true);
  });

  it("TAMPER DETECTION: mutating any presented field fails verify", () => {
    const tamperVerdict = { ...REPORT, industryVerdicts: [...REPORT.industryVerdicts] };
    tamperVerdict.industryVerdicts[0] = { ...tamperVerdict.industryVerdicts[0]!, verdict: "SWITCH-ONLY", coveragePassed: 41 };
    expect(verifyAdoptionReport(tamperVerdict)).toBe(false);

    const tamperPopulation = { ...REPORT, population: [...REPORT.population] };
    tamperPopulation.population[0] = { ...tamperPopulation.population[0]!, totalExecutions: 999 };
    expect(verifyAdoptionReport(tamperPopulation)).toBe(false);

    const tamperLedger = { ...REPORT, honestCounts: { ...REPORT.honestCounts, aggregateShortfall: 0 } };
    expect(verifyAdoptionReport(tamperLedger)).toBe(false);

    const tamperAggregate = { ...REPORT, aggregate: { ...REPORT.aggregate, journeyExecutions: 9999 } };
    expect(verifyAdoptionReport(tamperAggregate)).toBe(false);

    const tamperMobile = { ...REPORT, mobileValidation: [...REPORT.mobileValidation] };
    tamperMobile.mobileValidation[0] = { ...tamperMobile.mobileValidation[0]!, passed: false };
    expect(verifyAdoptionReport(tamperMobile)).toBe(false);
  });

  it("deterministic rendering: two assemblies are byte-identical; different facts change the digest", () => {
    const again = assembleAdoptionReport(SIM);
    expect(renderReportJson(REPORT)).toBe(renderReportJson(again));
    const other = assembleAdoptionReport(SIM2);
    expect(other.digest).not.toBe(REPORT.digest);
    expect(verifyAdoptionReport(other)).toBe(true);
  });
});

const SIM2 = await runAdoptionSimulation({ industryIds: ["construction"] });
