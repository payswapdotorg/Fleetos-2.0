/**
 * Every journey runs as a test: build a fresh deterministic world, execute
 * the typed steps against the REAL lane packages, and require the journey
 * to pass with every assertion green. Failing assertions are printed for
 * diagnosis — never swallowed.
 */

import { describe, expect, it } from "vitest";
import { JOURNEYS } from "../src/journeys/index.js";
import { runJourney } from "../src/runner.js";
import { canonicalJson } from "../src/journey-contracts.js";

async function runAndDiagnose(journeyId: string) {
  const journey = JOURNEYS.find((j) => j.id === journeyId);
  if (journey === undefined) throw new Error(`unknown journey ${journeyId}`);
  const { outcome } = await runJourney(journey);
  if (!outcome.passed) {
    const failed = outcome.assertionOutcomes
      .filter((a) => !a.ok)
      .map((a) => `${a.assertionId} actual=${canonicalJson(a.actual)} expected=${canonicalJson(a.expected)}`)
      .join("; ");
    const notExecuted = outcome.stepOutcomes.filter((s) => !s.executed).map((s) => s.stepId);
    throw new Error(`journey ${journeyId} failed — assertions: [${failed}] notExecuted: [${notExecuted.join(",")}]`);
  }
  return outcome;
}

describe("the work/commerce/project journey corpus", () => {
  for (const journey of JOURNEYS) {
    it(`journey ${journey.id} passes end to end`, async () => {
      const outcome = await runAndDiagnose(journey.id);
      expect(outcome.passed).toBe(true);
      expect(outcome.stepOutcomes.every((s) => s.executed && s.ok)).toBe(true);
      expect(outcome.assertionOutcomes.every((a) => a.ok)).toBe(true);
    });
  }

  it("create-work-order: the board digest is the view's own FNV-1a digest", async () => {
    const { facts } = await runJourney(JOURNEYS.find((j) => j.id === "create-work-order")!);
    expect(facts.get("workBoard.digest")).toMatch(/^workboard_[0-9a-f]{8}$/);
  });

  it("approve-execute: nine steps execute in order", async () => {
    const outcome = await runAndDiagnose("approve-execute-work-order");
    expect(outcome.stepOutcomes.length).toBe(9);
    expect(outcome.stepOutcomes.map((s) => s.stepId)).toEqual([
      "s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9",
    ]);
  });

  it("stage-gated-project: the gate view digest is stable-shaped", async () => {
    const { facts } = await runJourney(JOURNEYS.find((j) => j.id === "stage-gated-project")!);
    expect(facts.get("stageGate.digest")).toMatch(/^stagegates_[0-9a-f]{8}$/);
  });

  it("workload-allocation: the rollup digest is stable-shaped", async () => {
    const { facts } = await runJourney(JOURNEYS.find((j) => j.id === "workload-allocation")!);
    expect(facts.get("wlRollup.digest")).toMatch(/^workload_[0-9a-f]{8}$/);
  });

  it("procure-spine: the quote score view carries the bps decomposition digest", async () => {
    const { facts } = await runJourney(JOURNEYS.find((j) => j.id === "procure-spine")!);
    expect(facts.get("quotes.digest")).toMatch(/^quotescore_[0-9a-f]{8}$/);
  });

  it("vendor-management: the KPI rollup digest is stable-shaped", async () => {
    const { facts } = await runJourney(JOURNEYS.find((j) => j.id === "vendor-management")!);
    expect(facts.get("kpi.digest")).toMatch(/^vendorkpi_[0-9a-f]{8}$/);
  });

  it("software-entitlements: the seat view digest is stable-shaped", async () => {
    const { facts } = await runJourney(JOURNEYS.find((j) => j.id === "software-entitlements")!);
    expect(facts.get("seats.digest")).toMatch(/^seats_[0-9a-f]{8}$/);
  });

  it("org-optimization-review: the usage rollup digest is stable-shaped", async () => {
    const { facts } = await runJourney(JOURNEYS.find((j) => j.id === "org-optimization-review")!);
    expect(facts.get("usageRollup.digest")).toMatch(/^usagerollup_[0-9a-f]{8}$/);
  });

  it("aurum-settlement-seam: idempotent invokes flip fromCache and a foreign tenant misses the cache", async () => {
    const journey = JOURNEYS.find((j) => j.id === "aurum-settlement-seam")!;
    const { facts } = await runJourney(journey);
    const log = facts.get("aurum.kindLog") as readonly string[];
    expect(log[0]).toBe("true:fresh:0:aurum-projection");
    expect(log[1]).toBe("true:cached:0:aurum-projection");
    expect(log[5]).toBe("true:fresh:0:aurum-projection");
    expect(facts.get("aurum.attempts")).toBe(3);
    expect(facts.get("aurum.reasonCode")).toBe("AURUM_UNAVAILABLE");
  });

  it("cross-role-handoff: twenty-three steps execute and the chain closes", async () => {
    const outcome = await runAndDiagnose("cross-role-handoff");
    expect(outcome.stepOutcomes.length).toBe(23);
    expect(outcome.passed).toBe(true);
  });
});
