/**
 * The adoption driver: per-firm runs through the REAL runners, execution
 * counting (re-runs never counted), determinism proofs, honest-counts
 * ledger. Uses SMALL industry subsets for speed; the FULL simulation lives
 * in simulation.test.ts.
 */

import { describe, expect, it } from "vitest";
import { runFirm, TARGET_JOURNEYS_PER_FIRM, runAdoptionSimulation, type FirmRunResult } from "../src/adoption-run.js";
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
  }, 900_000);

  it("every counted execution PASSED (the F343 fix — the ka6 tenant pin is regime-honest in the adoption-composition regime too)", async () => {
    const run = await runFirm(firmById("firm-healthcare-facilities-medium")!);
    expect(run.executionFacts.length).toBeGreaterThan(0);
    // F343 re-pin (machine-measured at the fixed tree): zero failing
    // facts — the A-lane D17 journey's ka6 assertion now compares the
    // audit ref tenant against the run-context tenant reading
    // (`k4.kern.ctxTenant`), so it passes with this driver's REAL tenant
    // (tnt_healthcare-facilities-medium) exactly as it passes in the
    // field fixture regime (102/102).
    const failing = run.executionFacts.filter((f) => !f.passed);
    expect(failing).toHaveLength(0);
    for (const fact of run.executionFacts) {
      expect(fact.failureNote).toBeNull();
    }
  }, 900_000);

  it("COUNT HONESTY (F332 ACTIVE): epoch 1 + D10-proof-passing epochs count — non-certified journeys never earn epochs", async () => {
    const firm = firmById("firm-agriculture-large")!; // 3 declared epochs
    const run = await runFirm(firm);
    const industry = industryById("agriculture")!;
    const applicable = applicableFieldJourneys(industry).length;
    expect(firm.epochCount).toBe(3);
    expect(run.fieldEpochDigests.length).toBe(3); // epoch 0 vector + 2 epoch-dimension vectors
    // 6 census-certified field journeys x 2 epochs = 12 counted beyond epoch 1.
    expect(run.executionCounts.field).toBe(applicable + 12);
    // Only the certified journeys' epochs count (D8/D10); the D2(d) distinctness
    // makes the epoch dimension's digests differ from epoch 0 — honestly false.
    expect(run.determinismProof.fieldEpochsByteIdentical).toBe(false);
    expect(run.determinismProof.fieldEpochProofsVerified).toBe(true);
    expect(run.determinismProof.verified).toBe(true);
    const certifiedField = run.epochDecisions.filter((d) => d.corpus === "field");
    expect(certifiedField.map((d) => d.journeyId).sort()).toEqual([
      "connectivity-postures",
      "edge-command-lifecycle",
      "host-health-evidence-timeline",
      "host-maintenance-intent-to-verification",
      "maintain-asset-schedule",
      "recover-lost-device",
    ]);
    for (const decision of certifiedField) {
      expect(decision.countedEpochs).toEqual([1, 2]);
      expect(decision.refusalReason).toBeNull();
      expect(decision.censusCitation).toContain("F330 §1.1");
    }
  }, 900_000);

  it("COUNT HONESTY (F332 ACTIVE): commerce epochs count ONLY for the 2 certified responders; security stays once-per-workspace", async () => {
    const run = await runFirm(firmById("firm-manufacturing-large")!);
    const industry = industryById("manufacturing")!;
    const applicable = applicableCommerceJourneys(industry).length;
    // The epoch-0 (T0) corpus pass + 2 certified responders x 2 epochs.
    expect(run.executionCounts.commerce).toBe(applicable + 4);
    expect(run.commerceOutcomes.length).toBe(applicable); // the epoch-0 pass
    expect(run.commerceEpochRunCount).toBe(2 * applicable); // epochs >= 2 run the full applicable set (raw)
    const commerceDecisions = run.epochDecisions.filter((d) => d.corpus === "commerce");
    expect(commerceDecisions.map((d) => d.journeyId).sort()).toEqual([
      "marketplace-transaction-flow",
      "tenant-billing-invoicing",
    ]);
    for (const decision of commerceDecisions) {
      expect(decision.countedEpochs).toEqual([1, 2]);
      expect(decision.censusCitation).toContain("F331C §5 census row");
    }
    // TODO-F332-SECURITY: security never earns epochs (F331B platform-blocked).
    expect(run.executionCounts.security).toBe(applicableSecurityJourneys(industry).length);
    expect(run.securityOutcomes.length).toBe(run.executionCounts.security);
  }, 900_000);

  it("DETERMINISM PROOF (large firm): the ACTIVE laws hold (D10 proofs + D13 evidence + full-set re-runs)", async () => {
    const run = await runFirm(firmById("firm-construction-large")!);
    expect(run.determinismProof.verified).toBe(true);
    expect(run.determinismProof.epochCountingActive).toBe(true);
    expect(run.determinismProof.fieldEpochProofsVerified).toBe(true);
    expect(run.determinismProof.fieldInvariantsByteIdentical).toBe(true);
    expect(run.determinismProof.commerceEpochsByteIdentical).toBe(true);
    expect(run.determinismProof.commerceByteIdentical).toBe(true); // the full-set T0 re-run
    expect(run.determinismProof.securityByteIdentical).toBe(true);
    expect(run.determinismProof.runDigest).toMatch(/^[0-9a-f]{8}$/);
  }, 900_000);

  it("medium firms carry one epoch-dimension vector; small firms carry the epoch-0 proof only", async () => {
    const medium = await runFirm(firmById("firm-mining-medium")!);
    expect(medium.firm.epochCount).toBe(2);
    expect(medium.fieldEpochDigests.length).toBe(2);
    expect(medium.fieldEpochDigests[0]!.length).toBe(applicableFieldJourneys(medium.industry).length);
    expect(medium.fieldEpochDigests[1]!.length).toBe(6); // the declaring journeys only
    expect(medium.determinismProof.fieldEpochsByteIdentical).toBe(false);
    expect(medium.determinismProof.verified).toBe(true);
    expect(medium.determinismProof.commerceByteIdentical).toBeNull(); // full re-run proof is large-firm-only

    const small = await runFirm(firmById("firm-mining-small")!);
    expect(small.firm.epochCount).toBe(1);
    expect(small.fieldEpochDigests.length).toBe(1); // epoch 0 only — no epoch dimension
    expect(small.epochDecisions).toEqual([]);
    expect(small.determinismProof.verified).toBe(true);
  }, 900_000);

  it("the REAL tenant dimension is threaded (tenant-scoped journeys digest per firm)", async () => {
    const a = await runFirm(firmById("firm-telecommunications-small")!);
    const b = await runFirm(firmById("firm-water-waste-small")!);
    const digestOfJourney = (run: typeof a, journeyId: string) =>
      run.executionFacts.find((f) => f.journeyId === journeyId)?.digest;
    // Machine-verified: edge-command-lifecycle digests are tenant-scoped.
    expect(digestOfJourney(a, "edge-command-lifecycle")).not.toBe(digestOfJourney(b, "edge-command-lifecycle"));
    expect(a.firm.tenantId).not.toBe(b.firm.tenantId);
  }, 900_000);

  it("honest-counts ledger: every firm records its exact shortfall with the ACTIVE structural reasons", async () => {
    const simulation = await runAdoptionSimulation({ industryIds: ["agriculture"] });
    expect(simulation.honestCounts.targetPerFirm).toBe(TARGET_JOURNEYS_PER_FIRM);
    expect(simulation.honestCounts.entries.length).toBe(3);
    // F362 A+B re-pin (machine-measured): agriculture SMALL alone stayed
    // below 100 (95 — the masked subset); medium crossed at 103 and large
    // at 111 (114 cap - 19 masked + epochs for large).
    // F362 E2E re-pin (probe f362e2e-measure at the post-E2E merge): the
    // universal spine +1 every firm — small crosses to 100; ZERO firms
    // below target now (the honest last gap CLOSED).
    const below = simulation.honestCounts.entries.filter((e) => e.executed < TARGET_JOURNEYS_PER_FIRM);
    expect(below.length).toBe(0);
    for (const entry of below) {
      expect(entry.shortfall).toBe(TARGET_JOURNEYS_PER_FIRM - entry.executed);
      expect(entry.reasons.length).toBeGreaterThanOrEqual(5);
      expect(entry.reasons.some((r) => r.includes("T0-anchored"))).toBe(true);
      expect(entry.reasons.some((r) => r.includes("census-certified"))).toBe(true);
      expect(entry.reasons.some((r) => r.includes("TODO-F332-SECURITY"))).toBe(true);
      expect(entry.reasons.some((r) => r.includes("masked out"))).toBe(true);
    }
    const atOrAbove = simulation.honestCounts.entries.filter((e) => e.executed >= TARGET_JOURNEYS_PER_FIRM);
    // F362 E2E re-pin: all THREE agriculture firms now meet the target (the
    // universal spine carried small across 99 -> 100 — the honest last gap).
    expect(atOrAbove.length).toBe(3);
    for (const entry of atOrAbove) {
      expect(entry.shortfall).toBe(0);
    }
    expect(simulation.honestCounts.aggregateShortfall).toBe(
      simulation.honestCounts.entries.reduce((acc, e) => acc + e.shortfall, 0),
    );
  }, 900_000);

  it("aggregate counts never include re-runs (raw re-runs reported separately)", async () => {
    const simulation = await runAdoptionSimulation({ industryIds: ["construction", "mining"] });
    const { aggregate } = simulation;
    expect(aggregate.workspaces).toBe(6);
    expect(aggregate.journeyExecutions).toBe(aggregate.fieldExecutions + aggregate.commerceExecutions + aggregate.securityExecutions);
    // F353 re-pin (machine-measured at the integrated tree, probe
    // f353-measure): construction 102/110/118 + mining 103/111/119 (the
    // F342 pins + the 5 F351B journeys — zero construction/mining masks on
    // the new journey ids).
    // F362 E2E re-pin (probe f362e2e-measure at the post-E2E merge):
    // construction 103/111/119 + mining 104/112/120 (the universal E2E
    // transaction-spine journey +1 per firm).
    // F370 re-pin (probe f370-measure at the merged tree a4f412c): the 11
    // fleet-universal Wave-18 journeys (8 F370A/B security + 3 F370C
    // commerce) +11 per firm — construction 114/122/130 + mining
    // 115/123/131 (no construction/mining masks on the Wave-18 ids).
    expect(aggregate.journeyExecutions).toBe(405 + 408);
    expect(aggregate.fieldEpochReRuns).toBeGreaterThan(0); // transparency, never counted
    expect(aggregate.commerceEpochReRuns).toBeGreaterThan(0); // transparency, never counted
    expect(aggregate.determinismVerified).toBe(true);
    // F343 re-pin (machine-measured at the fixed tree): the ka6 tenant pin
    // is regime-honest — zero failing facts, allJourneysPassed=true.
    expect(aggregate.allJourneysPassed).toBe(true);
    expect(aggregate.uniqueApplicableJourneys).toBe(255); // journey-level (journey x industry pairs): 233 at the F362 final + the 8 F370A/F370B security ids x 2 industries + the 3 F370C commerce ids x 2
  }, 900_000);

  it("firms of an industry share the verdict inputs (per-industry consistency)", async () => {
    // F370 re-pin law (observed live at run 4, 2026-10-15): the firms run
    // SEQUENTIALLY — the F370C commerce journeys boot the REAL :3107
    // deployment service (pglite) per firm, and the previous Promise.all
    // form ran 3 firms x 3 service-driving journeys concurrently, exhausting
    // sockets/memory (the ErrnoError-51 class) — a resource failure the
    // journeys honestly record as a failing execution. runAdoptionSimulation
    // has always been sequential (the same doctrine); this test now matches.
    const runs: FirmRunResult[] = [];
    for (const firm of firmsOfIndustry("water-waste")) {
      runs.push(await runFirm(firm));
    }
    const counted = runs.map((r) => r.executionCounts.total);
    // All three sizes share the SAME epoch-0 counted set (125 epoch-0
    // facts — the 114 at the F362 E2E final + the 8 F370A/F370B security
    // journeys + the 3 F370C commerce journeys, all applicable to
    // water-waste); the epoch dimension grows counted
    // executions by size only — the certified responders' D9 epochs
    // (never the verdict denominator).
    expect(counted).toEqual([125, 125 + 8, 125 + 16]);
    for (const run of runs) {
      expect(run.executionFacts.filter((f) => f.epoch === 0).length).toBe(125);
      // F343 re-pin (machine-measured at the fixed tree): zero failing
      // facts per firm (the ka6 tenant pin resolved by the fix).
      expect(run.executionFacts.filter((f) => !f.passed)).toHaveLength(0);
    }
  }, 900_000);
});
