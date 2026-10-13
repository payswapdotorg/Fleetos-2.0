/**
 * F332 — the counting-gate battery (the F330 §2 law, machine-verified).
 *
 * Four gates (the packet's battery):
 *  1. Mode parity — all 30 firms byte-identical to the pinned numbers of the
 *     gate's CURRENT mode (phase 1: INACTIVE parity — the mechanism moved
 *     NOTHING, machine-proven by the F332 probe; phase 2: the ACTIVE
 *     activation ledger, machine-measured — the epoch-count ledger with the
 *     D8 census citations).
 *  2. The exact D9 frozen schedule values per firm size + every pre-F332
 *     firms.ts export preserved.
 *  3. Non-frozen anchors are MISSING_EPOCH-style refusals — never silent
 *     clamps (composition-site law + the REAL runners' own sentinels).
 *  4. The gate mechanics via TEST-ONLY SWITCH INJECTION: the counting
 *     decisions are pure functions over REAL outcome objects — synthetic
 *     proofs/outcomes are injected directly into them (the EPOCH_COUNTING_ACTIVE
 *     constant is NEVER edited by a test).
 */

import { describe, expect, it } from "vitest";
import {
  COMMERCE_EPOCH_CENSUS,
  EPOCH_COUNTING_ACTIVE,
  FROZEN_EPOCH_ANCHORS,
  assertFrozenEpochAnchor,
  decideCommerceEpochCounting,
  decideFieldEpochCounting,
  isFrozenEpochAnchor,
} from "../src/epoch-gate.js";
import {
  ADOPTION_T0,
  EPOCH_30D_MS,
  EPOCH_90D_MS,
  FIRM_EPOCH_COUNTS,
  FIRM_EPOCH_SCHEDULES,
  FIRM_SIZES,
  WORKSPACE_POPULATION,
  determinismProofFirm,
  firmById,
  firmsOfIndustry,
} from "../src/firms.js";
import { runAdoptionSimulation, runFirm } from "../src/adoption-run.js";
import { applicableCommerceJourneys, applicableFieldJourneys, applicableSecurityJourneys, industryById } from "../src/industries.js";
import { runAllJourneys, runJourney, MISSING_EPOCH, type JourneyOutcome as CommerceOutcome } from "@fleetos/acceptance-commerce";
import { runJourneyEpochs, type EpochExecutionProof, type JourneyOutcome as FieldOutcome } from "@fleetos/acceptance-field";

const T0 = ADOPTION_T0;
const T0_30D = T0 + EPOCH_30D_MS;
const T0_90D = T0 + EPOCH_90D_MS;

// The machine-measured pins. Per-industry counted executions per firm — the
// INACTIVE gate table is the frozen Wave-13 corpora record (unreachable
// while the gate is ACTIVE; kept as the F332 phase-1 parity record). The
// ACTIVE table is the F342 re-pin, machine-measured on the converged
// post-F341B tree (the F342 probe — docs/evidence/F342/report.md): every
// firm +6 counted (the 6 Wave-14 journeys are fully-applicable single-epoch
// T0 per F340 D15); manufacturing/energy-utilities small firms AT 100 —
// the B-3 closure; agriculture large is 82+16=98, healthcare/facilities
// large 85+14=99 / 86+14=100 — 5 field responders there because
// edge-command-lifecycle is masked.
const INACTIVE_PER_FIRM: Record<string, number> = {
  manufacturing: 94,
  construction: 91,
  "energy-utilities": 94,
  "transportation-logistics": 87,
  agriculture: 76,
  "healthcare-facilities": 79,
  "facilities-management": 80,
  telecommunications: 89,
  mining: 92,
  "water-waste": 89,
};

const ACTIVE_PER_FIRM: Record<string, [number, number, number]> = {
  manufacturing: [100, 108, 116],
  construction: [97, 105, 113],
  "energy-utilities": [100, 108, 116],
  "transportation-logistics": [93, 101, 109],
  agriculture: [82, 90, 98],
  "healthcare-facilities": [85, 92, 99],
  "facilities-management": [86, 93, 100],
  telecommunications: [95, 103, 111],
  mining: [98, 106, 114],
  "water-waste": [95, 103, 111],
};

const SIMULATION = await runAdoptionSimulation();

// ---------------------------------------------------------------------------
// 1. Mode parity — every firm byte-identical to the pinned numbers of the
//    gate's CURRENT mode (INACTIVE: phase 1's core invariant; ACTIVE: the
//    phase-2 activation ledger, machine-measured by the F332 probe).
// ---------------------------------------------------------------------------

describe("F332 gate 1 — mode parity (all 30 firms exactly the pinned numbers)", () => {
  it("the gate's mode is explicit (D7: the phase-1 boundary was INACTIVE; phase 2 flipped it)", () => {
    expect(EPOCH_COUNTING_ACTIVE).toBe(true); // flipped at phase 2 (its own commit)
  });

  it("every firm's counted executions are exactly the pinned numbers (30/30)", () => {
    expect(SIMULATION.firmRuns.length).toBe(30);
    for (const run of SIMULATION.firmRuns) {
      const expected = EPOCH_COUNTING_ACTIVE
        ? ACTIVE_PER_FIRM[run.firm.industryId]![run.firm.size === "small" ? 0 : run.firm.size === "medium" ? 1 : 2]
        : INACTIVE_PER_FIRM[run.firm.industryId];
      expect(run.executionCounts.total).toBe(expected);
      expect(run.executionCounts.field).toBe(
        applicableFieldJourneys(run.industry).length
        + (EPOCH_COUNTING_ACTIVE ? run.epochDecisions.filter((d) => d.corpus === "field").reduce((a, d) => a + d.countedEpochs.length, 0) : 0),
      );
      expect(run.executionCounts.commerce).toBe(
        applicableCommerceJourneys(run.industry).length
        + (EPOCH_COUNTING_ACTIVE ? run.epochDecisions.filter((d) => d.corpus === "commerce").reduce((a, d) => a + d.countedEpochs.length, 0) : 0),
      );
      expect(run.executionCounts.security).toBe(applicableSecurityJourneys(run.industry).length);
    }
  });

  it("the aggregate is exactly the pinned numbers of the current mode (machine-measured, never copied)", () => {
    if (EPOCH_COUNTING_ACTIVE) {
      // F342 re-pin (machine-measured on the converged tree): 2847 + 180
      // (the 6 Wave-14 journeys x 30 firms — field +120, security +60);
      // raw re-run transparency metrics unchanged (the new journeys declare
      // no epochs — the epoch dimension still executes only the 6 field +
      // 2 commerce census-certified responders).
      expect(SIMULATION.aggregate.journeyExecutions).toBe(3027);
      expect(SIMULATION.aggregate.fieldExecutions).toBe(1179);
      expect(SIMULATION.aggregate.commerceExecutions).toBe(1017);
      expect(SIMULATION.aggregate.securityExecutions).toBe(831);
      expect(SIMULATION.aggregate.fieldEpochReRuns).toBe(406);
      expect(SIMULATION.aggregate.commerceEpochReRuns).toBe(897);
    } else {
      // The frozen Wave-13 INACTIVE record (unreachable while ACTIVE).
      expect(SIMULATION.aggregate.journeyExecutions).toBe(2613);
      expect(SIMULATION.aggregate.fieldExecutions).toBe(885);
      expect(SIMULATION.aggregate.commerceExecutions).toBe(957);
      expect(SIMULATION.aggregate.securityExecutions).toBe(771);
      expect(SIMULATION.aggregate.fieldEpochReRuns).toBe(885);
    }
    expect(SIMULATION.aggregate.uniqueApplicableJourneys).toBe(931);
    expect(SIMULATION.aggregate.determinismVerified).toBe(true);
    // F343 re-pin (machine-measured at the fixed tree): the ka6 tenant pin
    // is regime-honest in BOTH regimes (the kern.admit readings now expose
    // the run-context tenant; ka6 asserts reading-equals against it) —
    // zero failing execution facts, allJourneysPassed=true; determinism
    // holds byte-identically regardless; every count UNCHANGED.
    expect(SIMULATION.aggregate.allJourneysPassed).toBe(true);
  });

  it("the ACTIVE determinism laws hold on every firm (D10 proofs + D13 evidence)", () => {
    for (const run of SIMULATION.firmRuns) {
      expect(run.determinismProof.epochCountingActive).toBe(EPOCH_COUNTING_ACTIVE);
      expect(run.determinismProof.verified).toBe(true);
      if (!EPOCH_COUNTING_ACTIVE) {
        expect(run.determinismProof.fieldEpochsByteIdentical).toBe(true);
        expect(run.epochDecisions).toEqual([]);
        expect(SIMULATION.epochCountLedger).toEqual([]);
        expect(run.executionFacts.every((f) => f.epoch === 0)).toBe(true);
        continue;
      }
      // ACTIVE: the D10 proofs verified + only the declaring journeys vary
      // (D2(d) distinctness makes the raw cross-epoch identity honestly false
      // for medium/large firms; small firms have no epoch dimension).
      expect(run.determinismProof.fieldEpochProofsVerified).toBe(true);
      expect(run.determinismProof.fieldInvariantsByteIdentical).toBe(true);
      expect(run.determinismProof.commerceEpochsByteIdentical).toBe(true);
      expect(run.determinismProof.fieldEpochsByteIdentical).toBe(run.firm.size === "small");
      // Every counted epoch >= 1 belongs to a census-certified journey.
      for (const fact of run.executionFacts.filter((f) => f.epoch > 0)) {
        const decision = run.epochDecisions.find((d) => d.journeyId === fact.journeyId);
        expect(decision?.countedEpochs).toContain(fact.epoch);
        expect(decision?.refusalReason).toBeNull();
      }
    }
  });

  it("the epoch-count ledger: exactly the 8 census-certified journey IDs with their D8 citations", () => {
    if (EPOCH_COUNTING_ACTIVE) {
      expect(SIMULATION.epochCountLedger.map((e) => `${e.corpus}:${e.journeyId}`).sort()).toEqual([
        "commerce:marketplace-transaction-flow",
        "commerce:tenant-billing-invoicing",
        "field:connectivity-postures",
        "field:edge-command-lifecycle",
        "field:host-health-evidence-timeline",
        "field:host-maintenance-intent-to-verification",
        "field:maintain-asset-schedule",
        "field:recover-lost-device",
      ]);
      for (const entry of SIMULATION.epochCountLedger) {
        expect(entry.censusCitation).toMatch(/F330 §1\.1|F331C §5 census row/);
      }
      // Per-journey totals: 30 counted epochs (3 per industry) except
      // edge-command-lifecycle (masked in healthcare + facilities → 24).
      const byJourney = new Map(SIMULATION.epochCountLedger.map((e) => [e.journeyId, e.countedExecutions] as const));
      expect(byJourney.get("edge-command-lifecycle")).toBe(24);
      for (const id of ["recover-lost-device", "maintain-asset-schedule", "connectivity-postures", "host-health-evidence-timeline", "host-maintenance-intent-to-verification", "marketplace-transaction-flow", "tenant-billing-invoicing"]) {
        expect(byJourney.get(id)).toBe(30);
      }
      expect([...byJourney.values()].reduce((a, b) => a + b, 0)).toBe(234);
    } else {
      expect(SIMULATION.epochCountLedger).toEqual([]);
    }
  });

  it("the commerce composition site is byte-identical to the no-options direct run (seam parity at T0)", async () => {
    const firm = firmById("firm-agriculture-large")!;
    const run = await runFirm(firm);
    const direct = await runAllJourneys(applicableCommerceJourneys(run.industry));
    expect(run.commerceOutcomes.map((o) => o.digest)).toEqual(direct.map((o) => o.digest));
  }, 60_000);
});

// ---------------------------------------------------------------------------
// 2. The exact D9 frozen schedule (F330 §2 — TL-owned values)
// ---------------------------------------------------------------------------

describe("F332 gate 2 — the D9 frozen schedule values + preserved exports", () => {
  it("the D9 values are EXACT (T0, 30d, 90d; per-size schedules)", () => {
    expect(T0).toBe(1_774_000_000_000);
    expect(EPOCH_30D_MS).toBe(2_592_000_000);
    expect(EPOCH_90D_MS).toBe(7_776_000_000);
    expect(FIRM_EPOCH_SCHEDULES).toEqual({
      small: [T0],
      medium: [T0, T0_30D],
      large: [T0, T0_30D, T0_90D],
    });
    expect(FROZEN_EPOCH_ANCHORS).toEqual([T0, T0_30D, T0_90D]);
  });

  it("every firm carries its size's frozen schedule; epoch counts unchanged (1/2/3)", () => {
    for (const firm of WORKSPACE_POPULATION) {
      expect(firm.epochs).toEqual(FIRM_EPOCH_SCHEDULES[firm.size]);
      expect(firm.epochCount).toBe(FIRM_EPOCH_COUNTS[firm.size]);
    }
  });

  it("every pre-F332 firms.ts export is preserved (the D9 landing is additive)", () => {
    // The exports exercised here + by firms.test.ts cover the full pre-F332
    // surface: ADOPTION_T0, FIRM_EPOCH_COUNTS, FIRM_SIZES, WORKSPACE_POPULATION,
    // determinismProofFirm, firmsOfIndustry, firmById (+ the FirmWorkspace type).
    expect(FIRM_SIZES).toEqual(["small", "medium", "large"]);
    expect(WORKSPACE_POPULATION.length).toBe(30);
    expect(firmsOfIndustry("mining").length).toBe(3);
    expect(determinismProofFirm("mining")?.size).toBe("large");
    expect(firmById("firm-mining-medium")?.epochCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 3. Non-frozen anchors are refusals — never silent clamps
// ---------------------------------------------------------------------------

describe("F332 gate 3 — non-frozen anchors refused (MISSING_EPOCH-style)", () => {
  it("only the three D9 anchors are frozen", () => {
    expect(isFrozenEpochAnchor(T0)).toBe(true);
    expect(isFrozenEpochAnchor(T0_30D)).toBe(true);
    expect(isFrozenEpochAnchor(T0_90D)).toBe(true);
    for (const anchor of [T0 + 1_000, T0 + 3_600_000, T0 + 86_400_000, T0 + 60 * 86_400_000, T0_30D + 1, 0, T0_90D + 1]) {
      expect(isFrozenEpochAnchor(anchor)).toBe(false);
    }
  });

  it("the composition sites refuse non-frozen anchors (fail-closed, never clamped)", () => {
    for (const anchor of [T0 + 3_600_000, T0 + 60 * 86_400_000]) {
      expect(() => assertFrozenEpochAnchor(anchor)).toThrow(/MISSING_EPOCH-style refusal, never a silent clamp/);
    }
    expect(() => assertFrozenEpochAnchor(T0_30D)).not.toThrow();
  });

  it("the REAL commerce runner fails census-certified journeys at a non-frozen anchor with the MISSING_EPOCH sentinel (never a soft pass)", async () => {
    for (const journeyId of COMMERCE_EPOCH_CENSUS.map((e) => e.journeyId)) {
      const journey = applicableCommerceJourneys(industryById("manufacturing")!).find((j) => j.id === journeyId);
      expect(journey).toBeDefined();
      const { outcome } = await runJourney(journey!, { startedAt: T0 + 3_600_000 });
      expect(outcome.passed).toBe(false);
      expect(outcome.assertionOutcomes.some((a) => a.expected === MISSING_EPOCH)).toBe(true);
    }
  }, 60_000);

  it("the REAL field epoch capability refuses a non-frozen schedule (D9 anchors only)", () => {
    const journeys = applicableFieldJourneys(industryById("manufacturing")!);
    expect(() => runJourneyEpochs(journeys, { schedule: [T0, T0 + 3_600_000] })).toThrow(/not one of the D9 frozen schedule values/);
  });
});

// ---------------------------------------------------------------------------
// 4. Gate mechanics via test-only switch injection (the constant is NEVER
//    edited — the pure decision functions are exercised directly)
// ---------------------------------------------------------------------------

/** A minimal synthetic field outcome (digest + asserted actuals are the gate's inputs). */
function fieldOutcome(journeyId: string, digest: string, actuals: unknown[]): FieldOutcome {
  return {
    journeyId,
    persona: "field-technician",
    capability: "maintenance",
    goal: "synthetic proof fixture",
    steps: [],
    assertions: actuals.map((actual, i) => ({ id: `a${i}`, description: "synthetic", reading: "r", op: "deep-equals" as const, expected: null, actual, pass: true })),
    passed: true,
    handoff: null,
    digest,
  } as unknown as FieldOutcome;
}

/** A minimal synthetic commerce outcome (assertion actuals + digest). */
function commerceOutcome(journeyId: string, digest: string, actuals: unknown[], passed = true): CommerceOutcome {
  return {
    journeyId,
    persona: "procurement-lead",
    capability: "marketplace-transactions",
    goal: "synthetic proof fixture",
    stepOutcomes: [],
    assertionOutcomes: actuals.map((actual, i) => ({ assertionId: `a${i}`, description: "synthetic", ok: true, op: "eq" as const, actual, expected: actual })),
    passed,
    digest,
  } as unknown as CommerceOutcome;
}

function fieldProof(outcomes: readonly FieldOutcome[], overrides: Partial<EpochExecutionProof> = {}): EpochExecutionProof {
  const anchors = [T0, T0_30D, T0_90D].slice(0, outcomes.length);
  const pairCount = (outcomes.length * (outcomes.length - 1)) / 2;
  const witnesses: { pair: readonly [number, number]; assertionIds: string[] }[] = [];
  for (let i = 0; i < outcomes.length; i += 1) {
    for (let j = i + 1; j < outcomes.length; j += 1) {
      witnesses.push({ pair: [anchors[i]!, anchors[j]!], assertionIds: ["a0"] });
    }
  }
  return {
    journeyId: outcomes[0]?.journeyId ?? "synthetic-field-journey",
    censusCitation: "F330 §1.1: synthetic | transition | fixture",
    anchors,
    outcomes: [...outcomes],
    sameEpochByteIdentical: true,
    distinctnessWitnesses: witnesses.slice(0, pairCount),
    tablesAnchor0Consistent: true,
    ...overrides,
  };
}

describe("F332 gate 4 — the counting decisions (pure switch injection)", () => {
  it("FIELD: a passing D10 proof counts every epoch >= 2", () => {
    const proof = fieldProof([
      fieldOutcome("j", "d0", [1]),
      fieldOutcome("j", "d1", [2]),
      fieldOutcome("j", "d2", [3]),
    ]);
    const decision = decideFieldEpochCounting(proof);
    expect(decision.countedEpochs).toEqual([1, 2]);
    expect(decision.refusalReason).toBeNull();
    expect(decision.censusCitation).toContain("F330 §1.1");
  });

  it("FIELD: D13 — byte-identical epoch outcomes NEVER count", () => {
    const proof = fieldProof([
      fieldOutcome("j", "same", [1]),
      fieldOutcome("j", "same", [1]),
    ]);
    const decision = decideFieldEpochCounting(proof);
    expect(decision.countedEpochs).toEqual([]);
    expect(decision.refusalReason).toContain("D13");
  });

  it("FIELD: a missing distinctness witness (D2(d)) refuses the epochs", () => {
    const proof = fieldProof(
      [fieldOutcome("j", "d0", [1]), fieldOutcome("j", "d1", [2])],
      { distinctnessWitnesses: [] },
    );
    const decision = decideFieldEpochCounting(proof);
    expect(decision.countedEpochs).toEqual([]);
    expect(decision.refusalReason).toContain("D2(d)");
  });

  it("FIELD: a same-epoch re-run that is not byte-identical (D2(c)) refuses the epochs", () => {
    const proof = fieldProof(
      [fieldOutcome("j", "d0", [1]), fieldOutcome("j", "d1", [2])],
      { sameEpochByteIdentical: false },
    );
    const decision = decideFieldEpochCounting(proof);
    expect(decision.countedEpochs).toEqual([]);
    expect(decision.refusalReason).toContain("D2(c)");
  });

  it("FIELD: a single-anchor schedule has no epochs >= 2 to count (small firms)", () => {
    const decision = decideFieldEpochCounting(fieldProof([fieldOutcome("j", "d0", [1])]));
    expect(decision.countedEpochs).toEqual([]);
    expect(decision.refusalReason).toBeNull();
  });

  it("COMMERCE: the certified-set bound is EXACTLY the two F331C census responders", () => {
    expect(COMMERCE_EPOCH_CENSUS.map((e) => e.journeyId)).toEqual([
      "marketplace-transaction-flow",
      "tenant-billing-invoicing",
    ]);
    for (const entry of COMMERCE_EPOCH_CENSUS) {
      expect(entry.censusCitation).toContain("F331C §5 census row");
    }
  });

  it("COMMERCE: a passing D10 proof (table + distinctness + same-epoch re-runs) counts every epoch >= 2", () => {
    const journey = {
      id: "marketplace-transaction-flow",
      persona: "procurement-lead",
      goal: "synthetic",
      capability: "marketplace-transactions",
      steps: [],
      assertions: [{ id: "a0", description: "synthetic", fact: "f", op: "eq", expected: true, expectedByEpoch: [{ epoch: T0, expected: true }, { epoch: T0_30D, expected: false }] }],
    } as never;
    const outcomes = [commerceOutcome("marketplace-transaction-flow", "d0", [true]), commerceOutcome("marketplace-transaction-flow", "d1", [false])];
    const decision = decideCommerceEpochCounting(journey, outcomes, ["d0", "d1"]);
    expect(decision.countedEpochs).toEqual([1]);
    expect(decision.refusalReason).toBeNull();
    expect(decision.censusCitation).toContain("F331C §5 census row 35");
  });

  it("COMMERCE: D13 — byte-identical asserted readings across epochs NEVER count", () => {
    const journey = {
      id: "tenant-billing-invoicing",
      persona: "finance-controller",
      goal: "synthetic",
      capability: "tenant-billing",
      steps: [],
      assertions: [{ id: "a0", description: "synthetic", fact: "f", op: "eq", expected: 1, expectedByEpoch: [{ epoch: T0, expected: 1 }, { epoch: T0_30D, expected: 1 }] }],
    } as never;
    const outcomes = [commerceOutcome("tenant-billing-invoicing", "d0", [1]), commerceOutcome("tenant-billing-invoicing", "d1", [1])];
    const decision = decideCommerceEpochCounting(journey, outcomes, ["d0", "d1"]);
    expect(decision.countedEpochs).toEqual([]);
    expect(decision.refusalReason).toContain("D2(d)/D13");
  });

  it("COMMERCE: MISSING_EPOCH at an uncovered anchor refuses (certified only at the frozen epochs)", () => {
    const journey = {
      id: "marketplace-transaction-flow",
      persona: "procurement-lead",
      goal: "synthetic",
      capability: "marketplace-transactions",
      steps: [],
      assertions: [{ id: "a0", description: "synthetic", fact: "f", op: "eq", expected: true, expectedByEpoch: [{ epoch: T0, expected: true }] }],
    } as never;
    const bad = { ...commerceOutcome("marketplace-transaction-flow", "d1", [false], false) };
    (bad.assertionOutcomes as unknown as { expected: unknown }[])[0]!.expected = MISSING_EPOCH;
    const decision = decideCommerceEpochCounting(journey, [commerceOutcome("marketplace-transaction-flow", "d0", [true]), bad], ["d0", "d1"]);
    expect(decision.countedEpochs).toEqual([]);
    expect(decision.refusalReason).toContain("MISSING_EPOCH");
  });

  it("COMMERCE: a NON-certified journey is refused even with tables + distinctness (D12 census bound)", () => {
    const journey = {
      id: "create-work-order",
      persona: "operations-manager",
      goal: "synthetic",
      capability: "create-work",
      steps: [],
      assertions: [{ id: "a0", description: "synthetic", fact: "f", op: "eq", expected: 1, expectedByEpoch: [{ epoch: T0, expected: 1 }, { epoch: T0_30D, expected: 2 }] }],
    } as never;
    const outcomes = [commerceOutcome("create-work-order", "d0", [1]), commerceOutcome("create-work-order", "d1", [2])];
    const decision = decideCommerceEpochCounting(journey, outcomes, ["d0", "d1"]);
    expect(decision.countedEpochs).toEqual([]);
    expect(decision.refusalReason).toContain("D12 census bound");
  });

  it("COMMERCE: no per-epoch table on any assertion refuses (D10(1))", () => {
    const journey = {
      id: "tenant-billing-invoicing",
      persona: "finance-controller",
      goal: "synthetic",
      capability: "tenant-billing",
      steps: [],
      assertions: [{ id: "a0", description: "synthetic", fact: "f", op: "eq", expected: 1 }],
    } as never;
    const outcomes = [commerceOutcome("tenant-billing-invoicing", "d0", [1]), commerceOutcome("tenant-billing-invoicing", "d1", [2])];
    const decision = decideCommerceEpochCounting(journey, outcomes, ["d0", "d1"]);
    expect(decision.countedEpochs).toEqual([]);
    expect(decision.refusalReason).toContain("no per-epoch expectation table");
  });

  it("SECURITY: the TODO-F332-SECURITY marker holds — security stays single-counted at exactly its applicable set", () => {
    // F331B is platform-blocked; no security epoch variant exists. Every
    // firm's security executions equal its industry's applicable set —
    // INACTIVE and ACTIVE alike (the marker stands until the TL amends).
    for (const run of SIMULATION.firmRuns) {
      expect(run.executionCounts.security).toBe(applicableSecurityJourneys(run.industry).length);
      expect(run.executionFacts.filter((f) => f.corpus === "security").every((f) => f.epoch === 0)).toBe(true);
    }
  });
});
