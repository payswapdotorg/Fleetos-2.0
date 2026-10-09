/**
 * The adoption driver: per-firm runs through the REAL runners, execution
 * counting (re-runs never counted), determinism proofs, honest-counts
 * ledger. Uses SMALL industry subsets for speed; the FULL simulation lives
 * in simulation.test.ts.
 */

import { describe, expect, it } from "vitest";
import { runFirm, TARGET_JOURNEYS_PER_FIRM, runAdoptionSimulation } from "../src/adoption-run.js";
import { applicableCommerceJourneys, applicableFieldJourneys, applicableSecurityJourneys, industryById } from "../src/industries.js";
import { firmById, firmsOfIndustry } from "../src/firms.js";

describe("adoption driver (per-firm)", () => {
  it("runs one firm through the REAL runners with exact counted executions", async () => {
    const firm = firmById("firm-agriculture-small")!;
    const run = await runFirm(firm);
    const industry = industryById("agriculture")!;
    expect(run.executionCounts.field).toBe(applicableFieldJourneys(industry).length);
    expect(run.executionCounts.commerce).toBe(applicableCommerceJourneys(industry).length);
    expect(run.executionCounts.security).toBe(applicableSecurityJourneys(industry).length);
    expect(run.executionCounts.total).toBe(
      applicableFieldJourneys(industry).length + applicableCommerceJourneys(industry).length + applicableSecurityJourneys(industry).length,
    );
    expect(run.executionFacts.length).toBe(run.executionCounts.total);
  }, 60_000);

  it("every counted execution PASSED on the REAL corpora (T0-anchored, valid tenant)", async () => {
    const run = await runFirm(firmById("firm-healthcare-facilities-medium")!);
    expect(run.executionFacts.length).toBeGreaterThan(0);
    expect(run.executionFacts.every((f) => f.passed)).toBe(true);
    expect(run.executionFacts.every((f) => f.failureNote === null)).toBe(true);
  }, 60_000);

  it("COUNT HONESTY: only epoch 1 counts — later declared epochs are byte-identical re-runs", async () => {
    const firm = firmById("firm-agriculture-large")!; // 3 declared epochs
    const run = await runFirm(firm);
    const industry = industryById("agriculture")!;
    expect(firm.epochCount).toBe(3);
    expect(run.fieldEpochDigests.length).toBe(3);
    expect(run.executionCounts.field).toBe(applicableFieldJourneys(industry).length); // ONE epoch counted
    expect(run.determinismProof.fieldEpochsByteIdentical).toBe(true);
  }, 60_000);

  it("COUNT HONESTY: commerce and security run ONCE per workspace (never per epoch)", async () => {
    const run = await runFirm(firmById("firm-manufacturing-large")!);
    const industry = industryById("manufacturing")!;
    expect(run.executionCounts.commerce).toBe(applicableCommerceJourneys(industry).length);
    expect(run.executionCounts.security).toBe(applicableSecurityJourneys(industry).length);
    expect(run.commerceOutcomes.length).toBe(run.executionCounts.commerce);
    expect(run.securityOutcomes.length).toBe(run.executionCounts.security);
  }, 60_000);

  it("DETERMINISM PROOF (large firm): the full applicable set re-runs byte-identical", async () => {
    const run = await runFirm(firmById("firm-construction-large")!);
    expect(run.determinismProof.verified).toBe(true);
    expect(run.determinismProof.commerceByteIdentical).toBe(true);
    expect(run.determinismProof.securityByteIdentical).toBe(true);
    expect(run.determinismProof.fieldEpochsByteIdentical).toBe(true);
    expect(run.determinismProof.runDigest).toMatch(/^[0-9a-f]{8}$/);
  }, 60_000);

  it("medium firms prove epoch repeatability; small firms carry the proof structure", async () => {
    const medium = await runFirm(firmById("firm-mining-medium")!);
    expect(medium.firm.epochCount).toBe(2);
    expect(medium.fieldEpochDigests.length).toBe(2);
    expect(medium.determinismProof.fieldEpochsByteIdentical).toBe(true);
    expect(medium.determinismProof.commerceByteIdentical).toBeNull(); // full re-run proof is large-firm-only

    const small = await runFirm(firmById("firm-mining-small")!);
    expect(small.firm.epochCount).toBe(1);
    expect(small.determinismProof.verified).toBe(true);
  }, 60_000);

  it("the REAL tenant dimension is threaded (tenant-scoped journeys digest per firm)", async () => {
    const a = await runFirm(firmById("firm-telecommunications-small")!);
    const b = await runFirm(firmById("firm-water-waste-small")!);
    const digestOfJourney = (run: typeof a, journeyId: string) =>
      run.executionFacts.find((f) => f.journeyId === journeyId)?.digest;
    // Machine-verified: edge-command-lifecycle digests are tenant-scoped.
    expect(digestOfJourney(a, "edge-command-lifecycle")).not.toBe(digestOfJourney(b, "edge-command-lifecycle"));
    expect(a.firm.tenantId).not.toBe(b.firm.tenantId);
  }, 60_000);

  it("honest-counts ledger: every firm records its exact shortfall with reasons", async () => {
    const simulation = await runAdoptionSimulation({ industryIds: ["agriculture"] });
    expect(simulation.honestCounts.targetPerFirm).toBe(TARGET_JOURNEYS_PER_FIRM);
    expect(simulation.honestCounts.entries.length).toBe(3);
    for (const entry of simulation.honestCounts.entries) {
      expect(entry.executed).toBeLessThan(TARGET_JOURNEYS_PER_FIRM);
      expect(entry.shortfall).toBe(TARGET_JOURNEYS_PER_FIRM - entry.executed);
      expect(entry.reasons.length).toBeGreaterThanOrEqual(5);
      expect(entry.reasons.some((r) => r.includes("T0-anchored"))).toBe(true);
      expect(entry.reasons.some((r) => r.includes("not tenant/time-parameterizable"))).toBe(true);
      expect(entry.reasons.some((r) => r.includes("masked out"))).toBe(true);
    }
    expect(simulation.honestCounts.aggregateShortfall).toBe(
      simulation.honestCounts.entries.reduce((acc, e) => acc + e.shortfall, 0),
    );
  }, 120_000);

  it("aggregate counts never include re-runs (raw re-runs reported separately)", async () => {
    const simulation = await runAdoptionSimulation({ industryIds: ["construction", "mining"] });
    const { aggregate } = simulation;
    expect(aggregate.workspaces).toBe(6);
    expect(aggregate.journeyExecutions).toBe(aggregate.fieldExecutions + aggregate.commerceExecutions + aggregate.securityExecutions);
    // construction (55 applicable) + mining (56 applicable), 3 firms each (converged Wave 10 corpora).
    expect(aggregate.journeyExecutions).toBe((55 + 56) * 3);
    expect(aggregate.fieldEpochReRuns).toBeGreaterThan(0); // transparency, never counted
    expect(aggregate.determinismVerified).toBe(true);
    expect(aggregate.allJourneysPassed).toBe(true);
    expect(aggregate.uniqueApplicableJourneys).toBe(111);
  }, 120_000);

  it("firms of an industry share the verdict inputs (per-industry consistency)", async () => {
    const runs = await Promise.all(firmsOfIndustry("water-waste").map((f) => runFirm(f)));
    const counted = runs.map((r) => r.executionCounts.total);
    // All three sizes execute the SAME counted journeys (the epoch schedule
    // changes re-run counts, never counted coverage).
    expect(new Set(counted).size).toBe(1);
    expect(runs.every((r) => r.executionFacts.every((f) => f.passed))).toBe(true);
  }, 120_000);
});
