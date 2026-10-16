/**
 * F361C (Wave 17 lane C) machine battery — the four marketplace
 * journeys delivered by the supplier/catalogue/request/order contract
 * lane:
 *   1. CENSUS BOUND: the four journeys drive ONLY their own F361C step
 *      kinds (the census-certified public APIs — no other surface).
 *   2. REFUSAL LAW: each journey carries >= 1 asserted refusal (D14).
 *   3. DETERMINISM: same-journey re-runs are byte-identical (D14); the
 *      full four-journey set re-runs byte-identically; the FULL 45-
 *      journey corpus re-runs byte-identically (grow-only, nothing
 *      pre-existing disturbed).
 *   4. D13 INVARIANCE: the four journeys carry NO epoch tables and are
 *      invariant across the census offsets (single-epoch T0 journeys —
 *      nothing outside the D8/D12-certified responder set may ever
 *      earn counted epochs; machine-checked at every offset).
 *   5. DEEP FACTS: the refusal logs, the idempotency semantics (the
 *      natural-key replay and the provider-ack replay), the freshness
 *      verdicts, the gate memberships, the plainly-labelled catalogue
 *      seam and the composed work gate are pinned verbatim.
 */

import { describe, expect, it } from "vitest";
import { JOURNEYS } from "../src/journeys/index.js";
import { runJourney, runAllJourneys } from "../src/runner.js";
import { COMMERCE_T0 } from "../src/journey-world.js";
import { canonicalJson } from "../src/journey-contracts.js";

const F361C_IDS = [
  "marketplace-request-lifecycle",
  "marketplace-offer-freshness-discipline",
  "marketplace-supplier-verification-gate",
  "marketplace-order-ack-discipline",
] as const;

const F361C_STEP_KINDS = new Set([
  "mreq-submit", "mreq-transition", "mreq-read", "mreq-board",
  "moff-capture", "moff-sheet", "moff-compare",
  "mver-open", "mver-verify", "mver-suspend", "mver-expire", "mver-gate", "mver-read", "mver-catalogue-import",
  "mord-draft", "mord-place", "mord-ack", "mord-transition", "mord-read", "mord-board",
  "mord-work-create", "mord-work-assign", "mord-work-transition", "mord-work-link", "mord-work-gate", "mord-accept",
]);

const CENSUS_OFFSETS = [-3_600_000, 1_000, 3_600_000, 86_400_000, 2_592_000_000, 7_776_000_000, 31_536_000_000] as const;

function byId(id: string) {
  const journey = JOURNEYS.find((j) => j.id === id);
  if (journey === undefined) throw new Error(`unknown journey ${id}`);
  return journey;
}

const f361cJourneys = () => F361C_IDS.map((id) => byId(id));

describe("F361C — census bound + corpus laws", () => {
  it("the four journeys exist with unique ids in the corpus (41 -> 45 at F361C, 46 after F362, grow-only)", () => {
    expect(JOURNEYS.length).toBe(52);
    const ids = JOURNEYS.map((j) => j.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of F361C_IDS) expect(ids).toContain(id);
  });

  it("the four journeys drive ONLY their census-certified F361C step kinds", () => {
    for (const journey of f361cJourneys()) {
      for (const step of journey.steps) {
        expect(F361C_STEP_KINDS.has(step.kind), `${journey.id}:${step.kind}`).toBe(true);
      }
    }
  });

  it("every journey carries >= 5 assertions and >= 1 asserted refusal (D14)", () => {
    for (const journey of f361cJourneys()) {
      expect(journey.assertions.length, journey.id).toBeGreaterThanOrEqual(5);
      const refusals = journey.assertions.filter((a) =>
        a.description.startsWith("REFUSAL") || a.description.includes("fail-closed") || a.description.includes("refuses") || a.description.includes("refusal"));
      expect(refusals.length, journey.id).toBeGreaterThanOrEqual(1);
    }
    expect(byId("marketplace-request-lifecycle").assertions.length).toBe(27);
    expect(byId("marketplace-offer-freshness-discipline").assertions.length).toBe(29);
    expect(byId("marketplace-supplier-verification-gate").assertions.length).toBe(29);
    expect(byId("marketplace-order-ack-discipline").assertions.length).toBe(39);
  });

  it("the four journeys carry NO epoch tables (D13 — single-epoch T0 by construction)", () => {
    for (const journey of f361cJourneys()) {
      const tables = journey.assertions.filter((a) => a.expectedByEpoch !== undefined);
      expect(tables.length, journey.id).toBe(0);
    }
  });

  it("all four journeys pass end to end", async () => {
    for (const journey of f361cJourneys()) {
      const { outcome } = await runJourney(journey);
      expect(outcome.passed, journey.id).toBe(true);
      expect(outcome.stepOutcomes.every((s) => s.executed && s.ok), journey.id).toBe(true);
      expect(outcome.assertionOutcomes.every((a) => a.ok), journey.id).toBe(true);
    }
  });

  it("same-journey re-runs are byte-identical (D14 determinism)", async () => {
    for (const journey of f361cJourneys()) {
      const first = await runJourney(journey);
      const second = await runJourney(journey);
      expect(second.outcome.digest).toBe(first.outcome.digest);
      expect(canonicalJson(second.facts)).toBe(canonicalJson(first.facts));
    }
  });

  it("the full four-journey set re-runs byte-identically", async () => {
    const journeys = f361cJourneys();
    const first = await runAllJourneys(journeys);
    const second = await runAllJourneys(journeys);
    expect(canonicalJson(second)).toBe(canonicalJson(first));
    expect(first.every((o) => o.passed)).toBe(true);
  });

  it("the FULL corpus re-runs byte-identically (grow-only — nothing pre-existing disturbed; 52 at F372)", async () => {
    const first = await runAllJourneys(JOURNEYS);
    const second = await runAllJourneys(JOURNEYS);
    expect(canonicalJson(second)).toBe(canonicalJson(first));
    expect(first.every((o) => o.passed)).toBe(true);
    expect(first.length).toBe(52);
  });

  it("D13 INVARIANCE: the four journeys are invariant at every census offset (no epoch ever counts)", async () => {
    for (const delta of CENSUS_OFFSETS) {
      const outcomes = await runAllJourneys(f361cJourneys(), { startedAt: COMMERCE_T0 + delta });
      for (const outcome of outcomes) {
        expect(outcome.passed, `${outcome.journeyId} @ ${delta}ms`).toBe(true);
        expect(outcome.assertionOutcomes.some((a) => a.expected === "__missing-epoch__"), outcome.journeyId).toBe(false);
      }
    }
  });

  it("tenant fail-closed reads are asserted in every journey that reads (A8)", async () => {
    const requestJourney = await runJourney(byId("marketplace-request-lifecycle"));
    expect(requestJourney.facts.get("mreq.read.foreign.found")).toBe(false);
    const offerJourney = await runJourney(byId("marketplace-offer-freshness-discipline"));
    expect(offerJourney.facts.get("moff.sheet.foreignInInput.reasonCode")).toBe("TENANT_MISMATCH");
    const supplierJourney = await runJourney(byId("marketplace-supplier-verification-gate"));
    expect(supplierJourney.facts.get("mver.read.foreign.found")).toBe(false);
    const orderJourney = await runJourney(byId("marketplace-order-ack-discipline"));
    expect(orderJourney.facts.get("mord.read.foreign.found")).toBe(false);
  });
});

describe("F361C — the deep-fact pins (idempotency + freshness + the manual seams)", () => {
  it("the natural-key replay is idempotent and the conflict is typed", async () => {
    const { facts } = await runJourney(byId("marketplace-request-lifecycle"));
    expect(facts.get("mreq.submit.replay.duplicate")).toBe(true);
    expect(facts.get("mreq.submit.replay.requestId")).toBe("req-7710");
    expect(facts.get("mreq.submit.replay.population")).toBe(1);
    expect(facts.get("mreq.submit.conflict.reasonCode")).toBe("NATURAL_KEY_CONFLICT");
  });

  it("the provider-ack replay is idempotent (the ORIGINAL evidence wins) and duplicate events refuse", async () => {
    const { facts } = await runJourney(byId("marketplace-order-ack-discipline"));
    expect(facts.get("mord.ack.replay.duplicate")).toBe(true);
    expect(facts.get("mord.ack.replay.evidenceId")).toBe("inv-2026-7710");
    expect(facts.get("mord.ack.duplicateEvent.reasonCode")).toBe("ALREADY_ACKNOWLEDGED");
    expect(facts.get("mord.ack.ack.channel")).toBe("manual-invoice-reference");
  });

  it("THE FRESHNESS LAW: the expired offer is excluded with its verdict; after the lapse the sheet is EMPTY", async () => {
    const { facts } = await runJourney(byId("marketplace-offer-freshness-discipline"));
    expect(facts.get("moff.sheet.atT0.expiredCount")).toBe(1);
    expect(facts.get("moff.sheet.afterLapse.freshCount")).toBe(0);
    expect(facts.get("moff.sheet.afterLapse.expiredCount")).toBe(5);
    expect(facts.get("moff.capture.staleArrival.reasonCode")).toBe("CAPTURE_AFTER_WINDOW_END");
  });

  it("the supplier gate admits only verified+current suppliers (the lapsed verification never silently enters)", async () => {
    const { facts } = await runJourney(byId("marketplace-supplier-verification-gate"));
    expect(facts.get("mver.gate.early.admittedCount")).toBe(2);
    expect(facts.get("mver.gate.late.admittedCount")).toBe(1);
    expect(facts.get("mver.expire.notYet.reasonCode")).toBe("NOT_EXPIRED_YET");
  });

  it("the catalogue import seam is PLAINLY LABELLED (never a live-API claim)", async () => {
    const { facts } = await runJourney(byId("marketplace-supplier-verification-gate"));
    const label = facts.get("mver.catalogue.first.label");
    expect(typeof label === "string" && label.includes("NOT a live supplier API")).toBe(true);
    expect(facts.get("mver.catalogue.first.entryCount")).toBe(2);
    expect(facts.get("mver.catalogue.duplicate.reasonCode")).toBe("DUPLICATE_CATALOGUE_ENTRY");
  });

  it("the composed work gate refuses WORK_NOT_COMPLETED before the service work is done", async () => {
    const { facts } = await runJourney(byId("marketplace-order-ack-discipline"));
    expect(facts.get("mord.accept.gateRefused.reasonCode")).toBe("WORK_NOT_COMPLETED");
    expect(facts.get("mord.workGate.open.ok")).toBe(true);
    expect(facts.get("mord.accept.accept.status")).toBe("accepted");
  });
});
