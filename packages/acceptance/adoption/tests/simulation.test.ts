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

  it("executes 3441 COUNTED journeys over the REAL corpora (plus raw epoch re-runs, never counted)", () => {
    // F353 re-pin (machine-measured at the integrated tree, probe
    // f353-measure): 3027 + 144 = the 5 F351B journeys x the firms where
    // they apply (28 of 30 — transport+agriculture mask the closeout
    // journey); uniqueApplicable 931 -> 979; epochs unchanged (F351B
    // journeys declare no epochs).
    expect(SIMULATION.aggregate.fieldExecutions).toBe(1383);
    expect(SIMULATION.aggregate.commerceExecutions).toBe(1167);
    expect(SIMULATION.aggregate.securityExecutions).toBe(891);
    expect(SIMULATION.aggregate.journeyExecutions).toBe(3441);
    expect(SIMULATION.aggregate.uniqueApplicableJourneys).toBe(1069);
    expect(SIMULATION.aggregate.fieldEpochReRuns).toBe(406);
    expect(SIMULATION.aggregate.commerceEpochReRuns).toBe(1047);
    // F332 ACTIVE (machine-measured, never copied): the INACTIVE gate counted
    // 2613 (Wave-13 corpora: field 31 + commerce 36); activation adds the
    // D10-proof-passing epoch counts — 174 field (6 census-certified journeys
    // x their per-firm epoch counts; edge-command-lifecycle masked in 2
    // industries) + 60 commerce (2 census-certified responders x 3 epochs per
    // industry) = 234. Raw re-runs (field 406 = the capability's D2(c)
    // re-runs + anchor-0 re-executions; commerce 897 = the 34 invariant
    // journeys' epoch runs) are NEVER counted (D13). The Wave-14 journeys
    // declare no epochs (single-epoch T0) — the epoch ledger is UNCHANGED.
  });

  it("journeys > 0; every counted execution PASSED (the F343 fix — the ka6 tenant pin is regime-honest in BOTH regimes)", () => {
    expect(SIMULATION.aggregate.journeyExecutions).toBeGreaterThan(0);
    // F343 re-pin (machine-measured at the fixed tree, never copied): the
    // A-lane D17 journey `observations-kernel-immutability-audit` now
    // exposes the run-context tenant as a kern.admit reading
    // (`k4.kern.ctxTenant`) and ka6 asserts reading-equals against it —
    // green in the field fixture regime (both sides the fixture tenant)
    // AND in the adoption-composition regime (both sides the firm's REAL
    // tenant). Zero failing execution facts; allJourneysPassed=true; the
    // counts are UNCHANGED (3027/1179/1017/831/931 — the fix flips
    // pass/fail states, never counts).
    expect(SIMULATION.aggregate.allJourneysPassed).toBe(true);
    for (const run of SIMULATION.firmRuns) {
      expect(run.executionFacts.length).toBe(run.executionCounts.total);
      const failing = run.executionFacts.filter((f) => !f.passed);
      expect(failing).toHaveLength(0);
      for (const fact of run.executionFacts) {
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
    // F343 re-pin (machine-measured at the fixed tree): zero failing
    // journeys anywhere — every industry's coverage is total/total; the
    // distribution returns to 1 SWITCH-ONLY / 5 MAIN-INTERFACE /
    // 4 COMPLEMENT / 0 RETAIN (manufacturing back to SWITCH-ONLY at ratio
    // 1.0 — the F342 0.99 record is resolved, never silently flipped).
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
      expect(row.coveragePassed).toBe(row.coverageTotal); // zero failing journeys per industry
      expect(row.coverageRatio).toBe(1);
      expect(row.failingJourneys).toHaveLength(0);
    }
    // Verdict distribution: 1 SWITCH-ONLY, 5 MAIN-INTERFACE, 4 COMPLEMENT, 0 RETAIN.
    const verdicts = REPORT.industryVerdicts.map((v) => v.verdict);
    expect(verdicts.filter((v) => v === "SWITCH-ONLY")).toHaveLength(1);
    expect(verdicts.filter((v) => v === "MAIN-INTERFACE")).toHaveLength(5);
    expect(verdicts.filter((v) => v === "COMPLEMENT")).toHaveLength(4);
    expect(verdicts.filter((v) => v === "RETAIN")).toHaveLength(0);
  });

  it("no industry earned RETAIN on the REAL corpora — zero failing journeys anywhere (the F343 fix); the fail-closed RETAIN path stays proven by the negative fixtures", () => {
    // The honest statement: zero journey failures exist on the REAL corpora
    // (the F343 fix resolved the recorded ka6 defect — machine-measured: 30
    // failing facts -> 0); the fail-closed RETAIN path is NOT triggered, and
    // the negative fixtures in verdicts.test.ts prove the rubric fails
    // closed when a real critical failure appears.
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

  it("honest-counts ledger: exact shortfalls + structural reasons; 28 firms at 100+ (F362 A+B measured)", () => {
    const { honestCounts } = REPORT;
    expect(honestCounts.targetPerFirm).toBe(100);
    expect(honestCounts.entries.length).toBe(30);
    // F353 re-pin (machine-measured): 23 firms reach 100+ (17 at F342 +
    // the 5 F351B field journeys closing construction small 97->102 and
    // mining small 98->103 — B-3 closes for both — plus the honest bonus:
    // telecommunications + water-waste small firms land AT 100, and
    // agriculture large crosses at 102); every other firm carries its
    // exact shortfall with reasons.
    const atOrAbove = honestCounts.entries.filter((e) => e.executed >= 100);
    expect(atOrAbove.length).toBe(28);
    for (const entry of atOrAbove) {
      expect(entry.shortfall).toBe(0);
    }
    for (const entry of honestCounts.entries) {
      expect(entry.shortfall).toBe(Math.max(0, entry.target - entry.executed));
    }
    const maxExecuted = Math.max(...honestCounts.entries.map((e) => e.executed));
    expect(maxExecuted).toBe(130); // manufacturing/energy large: 114 + 12 field epochs + 4 commerce epochs
    expect(honestCounts.aggregateShortfall).toBe(6);
    for (const reason of honestCounts.structuralReasons) {
      expect(reason.length).toBeGreaterThan(30);
    }
    // The masked-journey reason varies per firm (per-industry masks).
    const agricultureEntry = honestCounts.entries.find((e) => e.firmId === "firm-agriculture-large");
    expect(agricultureEntry?.reasons.some((r) => r.includes("19 journey(s) masked"))).toBe(true);
  });

  it("the report verifies and renders deterministically", () => {
    expect(verifyAdoptionReport(REPORT)).toBe(true);
    const again = renderReportJson(assembleAdoptionReport(SIMULATION));
    expect(renderReportJson(REPORT)).toBe(again);
    expect(REPORT.digest).toMatch(/^[0-9a-f]{8}$/);
  });
});
