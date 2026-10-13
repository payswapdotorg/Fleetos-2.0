/**
 * @fleetos/acceptance-field — F341A D17 sixth-slot journey test
 * (TL-adjudicated): the observations kernel immutability-audit journey.
 *
 * Lives in its own file because journeys.test.ts sits at the 400-line
 * file-law ceiling (grow-only: the corpus-shape pins there are updated in
 * place, nothing removed); the per-journey law is identical — the outcome
 * must PASS with every step ok and every assertion passed, the outcome
 * digest must verify, and semantic anchors are re-checked from the recorded
 * assertion ACTUALS (the REAL outputs the runner read).
 */

import { describe, expect, it } from "vitest";
import { FIELD_JOURNEYS } from "../src/journeys/index.js";
import { runJourneyCorpus } from "../src/runner.js";
import { verifyJourneyOutcome, type JourneyOutcome } from "../src/journey-contracts.js";

const JOURNEY_ID = "observations-kernel-immutability-audit";
const outcome = runJourneyCorpus(FIELD_JOURNEYS).find((o) => o.journeyId === JOURNEY_ID) as JourneyOutcome;

function actualOf(assertionId: string): unknown {
  const found = outcome.assertions.find((a) => a.id === assertionId);
  if (!found) throw new Error(`assertion not found: ${JOURNEY_ID}/${assertionId}`);
  return found.actual;
}

describe("F341A D17 sixth slot — observations kernel immutability audit", () => {
  it("kernel audit — idempotent admitToLog with digest-backed audit refs, monotonic-seq refusal, fail-closed listing, three REAL tamper refusals, log unchanged after every probe", () => {
    expect(outcome, `journey outcome not found: ${JOURNEY_ID}`).toBeDefined();
    expect(outcome.passed, `${JOURNEY_ID} must pass`).toBe(true);
    expect(outcome.steps.length).toBe(15);
    expect(outcome.steps.every((s) => s.ok), `${JOURNEY_ID} steps must all be ok`).toBe(true);
    expect(outcome.assertions.length).toBe(28);
    expect(outcome.assertions.every((a) => a.pass), `${JOURNEY_ID} assertions must all pass`).toBe(true);
    expect(verifyJourneyOutcome(outcome)).toBe(true);
    expect(outcome.digest).toMatch(/^[0-9a-f]{8}$/);
    // Anchors re-checked from the recorded assertion ACTUALS (REAL outputs).
    expect(actualOf("ka1")).toBe(true); // the fresh REAL admitted log is empty
    expect(actualOf("ka4")).toBe("observation:admit");
    expect(actualOf("ka13")).toBe(true); // the re-presentation is a duplicate
    expect(actualOf("ka14")).toBe(true); // the duplicate returns the log untouched
    // The duplicate ack and the immutability check both resolve to the SAME
    // admitted observation (ka16/ka22 reading-equals; compare the actuals).
    expect(actualOf("ka16")).toBe(actualOf("ka22"));
    expect(actualOf("ka17")).toBe("observation:admit:idempotent");
    expect(actualOf("ka18")).toBe("non-monotonic-seq");
    expect(actualOf("ka19")).toBe(true); // the foreign listing is fail-closed
    expect(actualOf("ka20")).toBe(0);
    expect(actualOf("ka21")).toBe(true); // the untampered re-presentation verifies
    expect(actualOf("ka24")).toBe("device-mismatch");
    expect(actualOf("ka25")).toBe("seq-mismatch");
    expect(actualOf("ka26")).toBe("digest-mismatch");
    expect(actualOf("ka27")).toBe(3); // nothing mutated the log
    expect(actualOf("ka28")).toBe(3);
  });
});
