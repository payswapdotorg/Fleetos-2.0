/**
 * @fleetos/acceptance-field — F331A epoch-execution tests (Wave 13 lane A):
 * the D10 proof form, mechanically enforced by `runJourneyEpochs` at the
 * D9 frozen schedule. Also pins the census declarations (D8's closed set)
 * and the D13 never-count laws (byte-identical re-runs never count).
 */

import { describe, expect, it } from "vitest";
import { FIELD_JOURNEYS } from "../src/journeys/index.js";
import { executeJourney, runJourneyCorpus, runJourneyEpochs, type EpochExecutionProof } from "../src/runner.js";
import {
  FIRM_EPOCH_SCHEDULES,
  FROZEN_EPOCH_SCHEDULE,
  FIELD_CENSUS,
  EPOCH_ANCHOR_0,
  EPOCH_ANCHOR_1,
  EPOCH_ANCHOR_2,
  censusEntryOf,
} from "../src/epoch-schedule.js";
import type { AcceptanceJourney } from "../src/journey-contracts.js";

const PROOFS: readonly EpochExecutionProof[] = runJourneyEpochs(FIELD_JOURNEYS, {
  schedule: FROZEN_EPOCH_SCHEDULE,
});

function proofOf(journeyId: string): EpochExecutionProof {
  const proof = PROOFS.find((p) => p.journeyId === journeyId);
  if (!proof) throw new Error(`epoch proof not found: ${journeyId}`);
  return proof;
}

function witnessIds(journeyId: string, anchorA: number, anchorB: number): readonly string[] {
  const proof = proofOf(journeyId);
  const witness = proof.distinctnessWitnesses.find((w) => w.pair[0] === anchorA && w.pair[1] === anchorB);
  if (!witness) throw new Error(`witness not found: ${journeyId} ${anchorA}->${anchorB}`);
  return witness.assertionIds;
}

describe("F331A epoch declarations (D8's closed set)", () => {
  // Post-census additions (journeys delivered AFTER the F330 census froze
  // its 30-row table): the F331A OTA journey + the three F341A remainder
  // journeys. They declare NO epochs (D14's single-epoch default; the
  // census set is closed) and carry their own F340 §1 census citations.
  const POST_CENSUS_ADDITIONS = new Set([
    "edge-firmware-ota-campaign", // F331A (row 39)
    "observations-backpressure-discipline", // F341A (candidate A1)
    "observations-retention-projections", // F341A (candidate A2)
    "sim-worlds-checkpoint-determinism", // F341A (candidate A3)
  ]);
  it("the census table covers the 30 census-era journeys with the frozen class law", () => {
    expect(FIELD_CENSUS.length).toBe(30);
    const censusIds = new Set(FIELD_CENSUS.map((e) => e.journeyId));
    for (const journey of FIELD_JOURNEYS) {
      if (POST_CENSUS_ADDITIONS.has(journey.id)) continue;
      expect(censusIds.has(journey.id), `${journey.id} must have a census row`).toBe(true);
    }
    const counts = {
      "count-eligible": FIELD_CENSUS.filter((e) => e.censusClass === "count-eligible").length,
      "rewrite-eligible": FIELD_CENSUS.filter((e) => e.censusClass === "rewrite-eligible").length,
      excluded: FIELD_CENSUS.filter((e) => e.censusClass === "excluded").length,
      invariant: FIELD_CENSUS.filter((e) => e.censusClass === "invariant").length,
    };
    expect(counts).toEqual({ "count-eligible": 4, "rewrite-eligible": 2, excluded: 1, invariant: 23 });
  });

  it("exactly the 4 count-eligible + 2 rewritten journeys declare epochs; every other journey declares none", () => {
    const declaring = FIELD_JOURNEYS.filter((j) => j.epochs !== undefined).map((j) => j.id).sort();
    expect(declaring).toEqual(
      [
        "connectivity-postures",
        "edge-command-lifecycle",
        "host-health-evidence-timeline",
        "host-maintenance-intent-to-verification",
        "maintain-asset-schedule",
        "recover-lost-device",
      ].sort(),
    );
    for (const journey of FIELD_JOURNEYS) {
      if (journey.epochs !== undefined) {
        expect(journey.epochs.censusCitation.length).toBeGreaterThan(0);
        expect(journey.epochs.anchors).toEqual(FROZEN_EPOCH_SCHEDULE);
      }
    }
  });

  it("the D9 frozen schedule values are the TL-owned constants (T0, +30d, +90d)", () => {
    expect(FROZEN_EPOCH_SCHEDULE).toEqual([1_774_000_000_000, 1_774_000_000_000 + 2_592_000_000, 1_774_000_000_000 + 7_776_000_000]);
    expect(FIRM_EPOCH_SCHEDULES.small).toEqual([EPOCH_ANCHOR_0]);
    expect(FIRM_EPOCH_SCHEDULES.medium).toEqual([EPOCH_ANCHOR_0, EPOCH_ANCHOR_1]);
    expect(FIRM_EPOCH_SCHEDULES.large).toEqual([EPOCH_ANCHOR_0, EPOCH_ANCHOR_1, EPOCH_ANCHOR_2]);
  });
});

describe("F331A epoch execution at the frozen schedule (D10 proof form)", () => {
  it("runJourneyEpochs proves all six parameterized journeys at the large-firm schedule", () => {
    expect(PROOFS.length).toBe(6);
    for (const proof of PROOFS) {
      expect(proof.anchors).toEqual([...FROZEN_EPOCH_SCHEDULE]);
      expect(proof.outcomes.length).toBe(3);
      expect(proof.outcomes.every((o) => o.passed), `${proof.journeyId} must pass at every anchor`).toBe(true);
      expect(proof.sameEpochByteIdentical, `${proof.journeyId} D2(c) same-epoch re-run byte-identity`).toBe(true);
      expect(proof.tablesAnchor0Consistent, `${proof.journeyId} D10(1) anchor-0 table consistency`).toBe(true);
      expect(proof.distinctnessWitnesses.length).toBe(3); // all three epoch pairs
    }
  });

  it("maintain-asset-schedule: the domain next-run boundary is the distinctness witness (maintenance window/deadline family)", () => {
    expect(witnessIds("maintain-asset-schedule", EPOCH_ANCHOR_0, EPOCH_ANCHOR_1)).toContain("m1");
    expect(witnessIds("maintain-asset-schedule", EPOCH_ANCHOR_0, EPOCH_ANCHOR_2)).toContain("m1");
    expect(witnessIds("maintain-asset-schedule", EPOCH_ANCHOR_1, EPOCH_ANCHOR_2)).toContain("m1");
    const m1 = proofOf("maintain-asset-schedule").outcomes.map((o) => o.assertions.find((a) => a.id === "m1")!.actual);
    expect(m1).toEqual([EPOCH_ANCHOR_0 + 86_400_000, EPOCH_ANCHOR_1 + 86_400_000, EPOCH_ANCHOR_2 + 86_400_000]);
  });

  it("connectivity-postures: posture-window staleness classes witness every epoch pair", () => {
    expect(witnessIds("connectivity-postures", EPOCH_ANCHOR_0, EPOCH_ANCHOR_1)).toEqual(expect.arrayContaining(["c11", "c11b"]));
    expect(witnessIds("connectivity-postures", EPOCH_ANCHOR_0, EPOCH_ANCHOR_2)).toEqual(expect.arrayContaining(["c11", "c11b", "c19", "c20"]));
    expect(witnessIds("connectivity-postures", EPOCH_ANCHOR_1, EPOCH_ANCHOR_2)).toEqual(expect.arrayContaining(["c19", "c20"]));
    const c19 = proofOf("connectivity-postures").outcomes.map((o) => o.assertions.find((a) => a.id === "c19")!.actual);
    const c20 = proofOf("connectivity-postures").outcomes.map((o) => o.assertions.find((a) => a.id === "c20")!.actual);
    expect(c19).toEqual([1, 1, 0]);
    expect(c20).toEqual([0, 0, 1]);
  });

  it("edge-command-lifecycle: the command-evidence windows witness every epoch pair", () => {
    expect(witnessIds("edge-command-lifecycle", EPOCH_ANCHOR_0, EPOCH_ANCHOR_1)).toEqual(expect.arrayContaining(["a11", "a13"]));
    expect(witnessIds("edge-command-lifecycle", EPOCH_ANCHOR_0, EPOCH_ANCHOR_2)).toEqual(expect.arrayContaining(["a11", "a13"]));
    expect(witnessIds("edge-command-lifecycle", EPOCH_ANCHOR_1, EPOCH_ANCHOR_2)).toEqual(expect.arrayContaining(["a23", "a24"]));
    const a23 = proofOf("edge-command-lifecycle").outcomes.map((o) => o.assertions.find((a) => a.id === "a23")!.actual);
    expect(a23).toEqual(["degraded", "healthy", "degraded"]);
  });

  it("host-maintenance-intent-to-verification: the scheduled-verification boundary is the witness", () => {
    for (const [a, b] of [[EPOCH_ANCHOR_0, EPOCH_ANCHOR_1], [EPOCH_ANCHOR_0, EPOCH_ANCHOR_2], [EPOCH_ANCHOR_1, EPOCH_ANCHOR_2]] as const) {
      expect(witnessIds("host-maintenance-intent-to-verification", a, b)).toContain("w5");
    }
  });

  it("recover-lost-device (rewritten): as-of window + late-quarter staleness classes witness every pair — no timestamp pins", () => {
    expect(witnessIds("recover-lost-device", EPOCH_ANCHOR_0, EPOCH_ANCHOR_1)).toEqual(expect.arrayContaining(["r3", "r8", "r9", "r10", "r21"]));
    expect(witnessIds("recover-lost-device", EPOCH_ANCHOR_1, EPOCH_ANCHOR_2)).toEqual(expect.arrayContaining(["r19", "r20", "r21"]));
    expect(witnessIds("recover-lost-device", EPOCH_ANCHOR_0, EPOCH_ANCHOR_2)).toEqual(expect.arrayContaining(["r3", "r10", "r21"]));
    const r21 = proofOf("recover-lost-device").outcomes.map((o) => o.assertions.find((a) => a.id === "r21")!.actual);
    expect(r21).toEqual(["unknown", "stale", null]);
    // The former echo pin (ageMs arithmetic) is gone from the assertion set.
    const r10 = proofOf("recover-lost-device").outcomes[0]!.assertions.find((a) => a.id === "r10")!;
    expect(r10.reading).toBe("t8.timeline.case0.staleness");
  });

  it("host-health-evidence-timeline (rewritten): the host route witnesses every pair — no timestamp pins", () => {
    expect(witnessIds("host-health-evidence-timeline", EPOCH_ANCHOR_0, EPOCH_ANCHOR_1)).toEqual(expect.arrayContaining(["e6", "e7", "e8", "e9", "e18"]));
    expect(witnessIds("host-health-evidence-timeline", EPOCH_ANCHOR_1, EPOCH_ANCHOR_2)).toEqual(expect.arrayContaining(["e17", "e18", "e19"]));
    const e18 = proofOf("host-health-evidence-timeline").outcomes.map((o) => o.assertions.find((a) => a.id === "e18")!.actual);
    expect(e18).toEqual(["unknown", "stale", null]);
    const e9 = proofOf("host-health-evidence-timeline").outcomes[0]!.assertions.find((a) => a.id === "e9")!;
    expect(e9.reading).toBe("t7.host.recoveryTimeline.case0.staleness");
  });

  it("the medium-firm schedule (2 anchors) proves as a prefix of the frozen schedule", () => {
    const proofs = runJourneyEpochs(FIELD_JOURNEYS, { schedule: FIRM_EPOCH_SCHEDULES.medium });
    expect(proofs.length).toBe(6);
    for (const proof of proofs) {
      expect(proof.outcomes.length).toBe(2);
      expect(proof.distinctnessWitnesses.length).toBe(1); // the single medium pair
      expect(proof.distinctnessWitnesses[0]!.assertionIds.length).toBeGreaterThan(0);
    }
  });

  it("the T0 corpus outcome is unchanged by the parameterization (grow-only at T0)", () => {
    const outcomes = runJourneyCorpus(FIELD_JOURNEYS);
    expect(outcomes.every((o) => o.passed)).toBe(true);
    // Each parameterized journey's T0 outcome equals its epoch-0 outcome.
    for (const proof of PROOFS) {
      const corpus = outcomes.find((o) => o.journeyId === proof.journeyId)!;
      expect(corpus.digest).toBe(proof.outcomes[0]!.digest);
    }
  });
});

describe("F331A D13 never-count laws (machine checks)", () => {
  it("a census-non-certified journey declaring epochs is refused by the epoch runner", () => {
    const rogue: AcceptanceJourney = {
      id: "enroll-new-asset", // invariant class — must not declare epochs
      persona: "fleet-operator",
      capability: "enrollment",
      goal: "rogue epoch declaration",
      steps: [],
      assertions: [],
      epochs: { censusCitation: "forged", anchors: [...FROZEN_EPOCH_SCHEDULE] },
    };
    expect(() => runJourneyEpochs([rogue], { schedule: FROZEN_EPOCH_SCHEDULE })).toThrow(/census does not certify/);
  });

  it("the F341A remainder journeys declare NO epochs (single-epoch mechanics, D14 default)", () => {
    for (const journeyId of ["observations-backpressure-discipline", "observations-retention-projections", "sim-worlds-checkpoint-determinism"]) {
      const journey = FIELD_JOURNEYS.find((j) => j.id === journeyId)!;
      expect(journey.epochs, `${journeyId} must not declare epochs (post-census, D14 single-epoch)`).toBeUndefined();
      const digests = FROZEN_EPOCH_SCHEDULE.map((anchor) => executeJourney(journey, { startedAt: anchor }).outcome.digest);
      expect(new Set(digests).size, `${journeyId} must be epoch-invariant (queueing/storage/determinism mechanics)`).toBe(1);
    }
  });

  it("the past-only exclusion is honest: evidence-gated-recovery is byte-identical across the frozen FORWARD schedule", () => {
    const anchors = FROZEN_EPOCH_SCHEDULE;
    const digests = anchors.map((anchor) => executeJourney(FIELD_JOURNEYS.find((j) => j.id === "evidence-gated-recovery")!, { startedAt: anchor }).outcome.digest);
    expect(new Set(digests).size).toBe(1);
    expect(censusEntryOf("evidence-gated-recovery")?.censusClass).toBe("excluded");
  });

  it("an anchor outside the D9 frozen schedule is refused (no lane-chosen spacing)", () => {
    expect(() => runJourneyEpochs(FIELD_JOURNEYS, { schedule: [EPOCH_ANCHOR_0, EPOCH_ANCHOR_0 + 123] })).toThrow(/not one of the D9 frozen schedule values/);
  });

  it("a per-epoch table with no entry for the executed anchor fails closed", () => {
    const journey = FIELD_JOURNEYS.find((j) => j.id === "maintain-asset-schedule")!;
    expect(() => executeJourney(journey, { startedAt: EPOCH_ANCHOR_1 + 1 })).toThrow(/no entry for anchor/);
  });

  it("invariant journeys stay byte-identical across the frozen schedule (D2(d) rerun supremacy)", () => {
    for (const journeyId of ["enroll-new-asset", "tenant-lifecycle-gating", "store-and-forward-redelivery"]) {
      const journey = FIELD_JOURNEYS.find((j) => j.id === journeyId)!;
      const digests = FROZEN_EPOCH_SCHEDULE.map((anchor) => executeJourney(journey, { startedAt: anchor }).outcome.digest);
      expect(new Set(digests).size, `${journeyId} must be epoch-invariant`).toBe(1);
    }
  });
});
