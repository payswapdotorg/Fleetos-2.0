/**
 * @fleetos/acceptance-field — F361A marketplace receipt→asset enrollment
 * journeys (Wave 17 lane A): the two census-certified journeys over the
 * REAL receipt-evidence + enrollment contract of @fleetos/assets (the
 * F360 freeze §3.5 state machines).
 *
 * Lives in its own file (the F341A-kernel/F351B precedent: the corpus-
 * shape pins in journeys.test.ts are updated in place, nothing removed);
 * the per-journey law is identical — the outcome must PASS with every
 * step ok and every assertion passed, the outcome digest must verify,
 * and semantic anchors are re-checked from the recorded assertion
 * ACTUALS (the REAL outputs the runner read). The lane-specific laws:
 * the duplicate-serial guard returns the ORIGINAL record while the REAL
 * registry never gains a second asset, the discrepancy path leaves the
 * asset un-enrolled until a verified re-record, and foreign tenants see
 * NOTHING (fail-closed by construction).
 */

import { describe, expect, it } from "vitest";
import { FIELD_JOURNEYS, marketplaceReceiptEnrollmentJourney, marketplaceReceiptDiscrepancyJourney } from "../src/journeys/index.js";
import { executeJourney, runJourneyCorpus } from "../src/runner.js";
import { verifyJourneyOutcome, type JourneyOutcome } from "../src/journey-contracts.js";

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

function expectJourneyPasses(journeyId: string, steps: number, assertions: number): JourneyOutcome {
  const outcome = outcomeOf(journeyId);
  expect(outcome, `journey outcome not found: ${journeyId}`).toBeDefined();
  expect(outcome.passed, `${journeyId} must pass`).toBe(true);
  expect(outcome.steps.length).toBe(steps);
  expect(outcome.steps.every((s) => s.ok), `${journeyId} steps must all be ok`).toBe(true);
  expect(outcome.assertions.length).toBe(assertions);
  expect(outcome.assertions.every((a) => a.pass), `${journeyId} assertions must all pass`).toBe(true);
  expect(verifyJourneyOutcome(outcome)).toBe(true);
  expect(outcome.digest).toMatch(/^[0-9a-f]{8}$/);
  return outcome;
}

describe("F361A marketplace receipt→asset enrollment journeys (census-certified, D14 form)", () => {
  it("marketplace-receipt-enrollment — verified receipt enrolls through the REAL registry, the duplicate guard returns the ORIGINAL, foreign tenants see NOTHING", () => {
    expectJourneyPasses("marketplace-receipt-enrollment", 15, 23);
    // Refusal anchors (REAL reason codes from @fleetos/assets).
    expect(actualOf("marketplace-receipt-enrollment", "r3")).toBe("receipt-not-verified");
    expect(actualOf("marketplace-receipt-enrollment", "r22")).toBe(false);
    expect(actualOf("marketplace-receipt-enrollment", "r23")).toBe(false);
    // The expectRefusal steps themselves (fail-closed verification).
    const outcome = outcomeOf("marketplace-receipt-enrollment");
    expect(outcome.steps.find((s) => s.id === "a3")?.ok).toBe(true);
    expect(outcome.steps.find((s) => s.id === "a14")?.ok).toBe(true);
    expect(outcome.steps.find((s) => s.id === "a15")?.ok).toBe(true);
    // The duplicate-serial guard: the ORIGINAL record, never a second asset.
    expect(actualOf("marketplace-receipt-enrollment", "r17")).toBe(true);
    expect(actualOf("marketplace-receipt-enrollment", "r18")).toBe("ast_mkt-lt-7710");
    expect(actualOf("marketplace-receipt-enrollment", "r20")).toBe(1);
    expect(actualOf("marketplace-receipt-enrollment", "r21")).toEqual(["active"]);
    // The enrollment id returned by the duplicate attempt IS the original's
    // (the deterministic tenant+serial idempotency key; the journey's
    // reading-equals assertion r19 proved it against a7's own reading).
    expect(actualOf("marketplace-receipt-enrollment", "r19")).toBe("enr_tnt_field-accept-01_SN-LT-7710-001");
    // Semantic anchors re-checked from the recorded ACTUALS.
    expect(actualOf("marketplace-receipt-enrollment", "r1")).toBe("recorded");
    expect(actualOf("marketplace-receipt-enrollment", "r5")).toBe("verified");
    expect(actualOf("marketplace-receipt-enrollment", "r7")).toBe("candidate");
    expect(actualOf("marketplace-receipt-enrollment", "r10")).toBe("admitted");
    expect(actualOf("marketplace-receipt-enrollment", "r11")).toBe("enrolled");
    expect(actualOf("marketplace-receipt-enrollment", "r13")).toBe("active");
    expect(actualOf("marketplace-receipt-enrollment", "r14")).toBe(1_774_000_000_000 + 5_000_000);
  });

  it("marketplace-receipt-discrepancy — mismatch records discrepancy with reasons, enrollment refused, asset un-enrolled until the verified re-record", () => {
    expectJourneyPasses("marketplace-receipt-discrepancy", 13, 18);
    // Refusal anchors (REAL reason codes from @fleetos/assets).
    expect(actualOf("marketplace-receipt-discrepancy", "s6")).toBe("receipt-discrepancy");
    expect(actualOf("marketplace-receipt-discrepancy", "s8")).toBe("illegal-transition");
    const outcome = outcomeOf("marketplace-receipt-discrepancy");
    expect(outcome.steps.find((s) => s.id === "b4")?.ok).toBe(true);
    expect(outcome.steps.find((s) => s.id === "b6")?.ok).toBe(true);
    // The discrepancy path: asset stays un-enrolled (registry zero)...
    expect(actualOf("marketplace-receipt-discrepancy", "s7")).toBe(0);
    // ...until the corrected re-record verifies and enrolls exactly one.
    expect(actualOf("marketplace-receipt-discrepancy", "s2")).toBe("discrepancy");
    expect(actualOf("marketplace-receipt-discrepancy", "s3")).toEqual(["serial-mismatch", "condition-mismatch"]);
    expect(actualOf("marketplace-receipt-discrepancy", "s11")).toBe("verified");
    expect(actualOf("marketplace-receipt-discrepancy", "s13")).toBe("enrolled");
    expect(actualOf("marketplace-receipt-discrepancy", "s15")).toBe("active");
    expect(actualOf("marketplace-receipt-discrepancy", "s18")).toBe(1);
  });

  it("both F361A journeys are byte-identical on re-run (determinism, D2(c) form)", () => {
    for (const journey of [marketplaceReceiptEnrollmentJourney, marketplaceReceiptDiscrepancyJourney]) {
      const first = executeJourney(journey);
      const second = executeJourney(journey);
      expect(second.outcome.digest, `${journey.id} re-run must be byte-identical`).toBe(first.outcome.digest);
      expect(first.outcome.passed).toBe(true);
    }
  });

  it("the two journey ids name THIS lane's angle and are unique in the corpus (the F354 lesson)", () => {
    const ids = FIELD_JOURNEYS.map((j) => j.id);
    expect(ids.filter((id) => id === "marketplace-receipt-enrollment").length).toBe(1);
    expect(ids.filter((id) => id === "marketplace-receipt-discrepancy").length).toBe(1);
    // The F361A journeys exercise ONLY the mre.* op family.
    for (const journey of [marketplaceReceiptEnrollmentJourney, marketplaceReceiptDiscrepancyJourney]) {
      for (const step of journey.steps) {
        expect(step.op.kind.startsWith("mre."), `${journey.id}/${step.id} must use the mre.* family`).toBe(true);
      }
    }
  });
});
