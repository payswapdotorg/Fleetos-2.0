/**
 * @fleetos/acceptance-adoption — the F332 epoch counting gate (D7/D10/D13).
 *
 * The F330 §2 count law, machine-enforced (binding; zero discretion):
 *
 * D7 — Activation. "Until the F332 convergence lands the counting gate, NO
 *   epoch variant counts (the Wave-12 state persists: epoch 1 counted,
 *   later epochs byte-identical re-runs)." EPOCH_COUNTING_ACTIVE is that
 *   gate. PHASE 1 of the F332 delivery lands it INACTIVE (false): the
 *   adoption driver's behavior is byte-identical to the pre-F332 tree
 *   (every declared epoch executes at the fixture anchor T0; only epoch 1
 *   counts). PHASE 2 flips it to true as its own commit — after which a
 *   journey's epoch E counts iff the D10 proof form passes AND the D13
 *   refusals hold.
 *
 * D10 — Proof form (what the gate verifies before any epoch counts):
 *   (1) a per-epoch expectation table present on the journey, covering the
 *       firm's frozen schedule (an uncovered anchor FAILS — the commerce
 *       runner records the MISSING_EPOCH sentinel; the field runner's
 *       table resolution fails closed);
 *   (2) runner-executed distinctness — for EVERY epoch pair the outcomes
 *       differ on >= 1 ASSERTED reading (D2(d) enforced positively), and a
 *       same-epoch re-run is byte-identical (D2(c));
 *   (3) the census citation (D10(3)) — the F330 §1.1 row for field journeys
 *       (carried on their `epochs` declarations, machine-checked by the
 *       F331A capability) and the F331C §5 census row for commerce (the
 *       certified set declared below — D12 census-before-variants: no
 *       census row means no variant, ever).
 *
 * D13 — Never-count (the refusal core): byte-identical epoch outcomes,
 *   synthetic telemetry, duplicated steps, altered labels, timestamp-echo
 *   pins across epochs, and any input change that does not alter an
 *   asserted outcome are NEVER distinct journeys. Byte-identical epochs
 *   NEVER count.
 *
 * SECURITY (F331B) is platform-blocked (Wave-13 lane B: capacity crunch,
 * 3 dispatch attempts evidenced; see the F332 packet's F331B status).
 * The security composition site in adoption-run.ts carries the
 * TODO-F332-SECURITY marker and security stays single-counted (its
 * runner has no time parameter; once-per-workspace per the packet).
 * NEVER assume security responders.
 *
 * Composition-site law: non-frozen anchors are MISSING_EPOCH-style
 * REFUSALS (assertFrozenEpochAnchor throws) — never silent clamps to a
 * frozen value.
 *
 * Pure deterministic TS. The counting decisions are PURE functions of the
 * runners' REAL outcome objects — nothing is re-computed or inferred.
 */

import {
  runJourneyEpochs,
  type AcceptanceJourney as FieldJourney,
  type EpochExecutionProof,
  type JourneyOutcome as FieldOutcome,
} from "@fleetos/acceptance-field";
import {
  MISSING_EPOCH,
  runAllJourneys,
  runJourney,
  type AcceptanceJourney as CommerceJourney,
  type JourneyOutcome as CommerceOutcome,
} from "@fleetos/acceptance-commerce";
import { FIRM_EPOCH_SCHEDULES } from "./firms.js";

// ---------------------------------------------------------------------------
// D7 — the activation switch (the TL flips it at F332 phase 2)
// ---------------------------------------------------------------------------

/**
 * D7 (F330 §2): the counting gate's activation switch. false at the F332
 * phase-1 boundary (the Wave-12 state persisted byte-identically: epoch 1
 * counted; epochs >= 2 asserted byte-identical re-runs, never counted);
 * PHASE 2 flips it to true AS ITS OWN COMMIT. Now ACTIVE: per-epoch
 * distinct journeys count iff the D10 proof form passes and the D13
 * refusals hold. Tests exercise the counting mechanics through the pure
 * decision functions below (test-only switch injection) — NEVER by editing
 * this constant.
 */
export const EPOCH_COUNTING_ACTIVE = true;

// ---------------------------------------------------------------------------
// D9 — the frozen anchors (composition-site refusal law)
// ---------------------------------------------------------------------------

/** The D9 frozen anchor values (the union of every firm-size schedule). */
export const FROZEN_EPOCH_ANCHORS: readonly number[] = FIRM_EPOCH_SCHEDULES.large;

/** Is `anchor` one of the D9 frozen schedule values? */
export function isFrozenEpochAnchor(anchor: number): boolean {
  return FROZEN_EPOCH_ANCHORS.includes(anchor);
}

/**
 * Composition-site refusal (fail-closed): an anchor outside the D9 frozen
 * schedule is a MISSING_EPOCH-style refusal — the run NEVER silently
 * clamps to a frozen value. Every composition site (field + commerce)
 * calls this before threading `startedAt` into a REAL runner.
 */
export function assertFrozenEpochAnchor(anchor: number): void {
  if (!isFrozenEpochAnchor(anchor)) {
    throw new Error(
      `epoch anchor ${anchor} is not one of the D9 frozen schedule values [${FROZEN_EPOCH_ANCHORS.join(", ")}] — MISSING_EPOCH-style refusal, never a silent clamp`,
    );
  }
}

// ---------------------------------------------------------------------------
// D8/D12 — the commerce census bound (certified responders only)
// ---------------------------------------------------------------------------

/** One certified commerce responder: the census row citation verbatim. */
export interface CommerceEpochCensusEntry {
  readonly journeyId: string;
  /** The F331C §5 census table row (D10(3) citation, verbatim). */
  readonly censusCitation: string;
}

/**
 * The D12 census bound for commerce (F331C §5 — census-before-variants):
 * EXACTLY two certified transition-class responders. A journey outside
 * this set NEVER earns epoch counts (no census row = no variant), even if
 * it carried per-epoch tables.
 */
export const COMMERCE_EPOCH_CENSUS: readonly CommerceEpochCensusEntry[] = [
  {
    journeyId: "marketplace-transaction-flow",
    censusCitation:
      "F331C §5 census row 35: marketplace-transaction-flow | −1h, +1d, +30d, +90d, +365d | transition (bidirectional)",
  },
  {
    journeyId: "tenant-billing-invoicing",
    censusCitation:
      "F331C §5 census row 36: tenant-billing-invoicing | +1d, +30d, +90d, +365d | transition (forward-only)",
  },
];

function commerceCensusOf(journeyId: string): CommerceEpochCensusEntry | undefined {
  return COMMERCE_EPOCH_CENSUS.find((e) => e.journeyId === journeyId);
}

// ---------------------------------------------------------------------------
// The counting decision (the gate's output per journey)
// ---------------------------------------------------------------------------

/** The gate's decision for one journey's epochs (beyond epoch 0). */
export interface EpochCountDecision {
  readonly corpus: "field" | "commerce";
  readonly journeyId: string;
  /** The D8 census citation (D10(3)) — verbatim row from the census of record. */
  readonly censusCitation: string;
  /** Counted epoch indexes >= 1 (epoch 0 always counts as the base run). */
  readonly countedEpochs: readonly number[];
  /** The honest refusal reason when epochs were refused; null when none were. */
  readonly refusalReason: string | null;
}

// ---------------------------------------------------------------------------
// Field counting — consumes the F331A capability's D10 proofs
// ---------------------------------------------------------------------------

/**
 * The counting decision for one field journey from its F331A epoch proof
 * (`runJourneyEpochs` mechanically enforces the D10 proof: per-epoch table
 * evaluation, pass at every anchor, D2(c) same-epoch byte-identity, D2(d)
 * pairwise asserted-reading distinctness — a violation THROWS). The gate
 * re-verifies the proof's own fields before counting (defense in depth)
 * and refuses any epoch whose outcome digest is byte-identical to another
 * epoch's (D13).
 */
export function decideFieldEpochCounting(proof: EpochExecutionProof): EpochCountDecision {
  const anchors = proof.anchors;
  const pairCount = (anchors.length * (anchors.length - 1)) / 2;
  const digests = proof.outcomes.map((o) => o.digest);
  const byteIdenticalPairs: number[] = [];
  for (let i = 0; i < digests.length; i += 1) {
    for (let j = i + 1; j < digests.length; j += 1) {
      if (digests[i] === digests[j]) byteIdenticalPairs.push(j);
    }
  }
  const failures: string[] = [];
  if (!proof.outcomes.every((o) => o.passed)) failures.push("an epoch run did not pass");
  if (!proof.sameEpochByteIdentical) failures.push("D2(c): a same-epoch re-run is not byte-identical");
  if (!proof.tablesAnchor0Consistent) failures.push("D10(1): a per-epoch table's anchor-0 entry differs from the single-valued expected");
  if (proof.distinctnessWitnesses.length !== pairCount || proof.distinctnessWitnesses.some((w) => w.assertionIds.length === 0)) {
    failures.push("D2(d): an epoch pair agrees on every asserted reading");
  }
  if (byteIdenticalPairs.length > 0) failures.push(`D13: byte-identical epoch outcome(s) at index(es) ${byteIdenticalPairs.join(",")}`);
  const proofPasses = failures.length === 0;
  return {
    corpus: "field",
    journeyId: proof.journeyId,
    censusCitation: proof.censusCitation,
    countedEpochs: proofPasses && anchors.length >= 2
      ? anchors.slice(1).map((_, i) => i + 1)
      : [],
    refusalReason: proofPasses
      ? null
      : `D10 proof did not pass: ${failures.join("; ")} — the epochs never count`,
  };
}

// ---------------------------------------------------------------------------
// Commerce counting — verifies the D10 proof form over the seam's runs
// ---------------------------------------------------------------------------

/**
 * The counting decision for one commerce journey from its per-anchor runs
 * (the F331C seam). The gate verifies the D10 proof form itself:
 * (1) a per-epoch table present (expectedByEpoch) — a run at an uncovered
 *     anchor fails with the MISSING_EPOCH sentinel, which the gate treats
 *     as a refusal (the journey is certified only at the frozen epochs);
 * (2) pairwise distinctness on ASSERTED readings for EVERY epoch pair +
 *     same-epoch re-run byte-identity (the digests are passed in);
 * (3) the census bound (COMMERCE_EPOCH_CENSUS — D12: no census row means
 *     no variant, ever).
 * D13: a byte-identical epoch pair NEVER counts.
 */
export function decideCommerceEpochCounting(
  journey: CommerceJourney,
  outcomesByAnchor: readonly CommerceOutcome[],
  rerunDigestsByAnchor: readonly string[],
): EpochCountDecision {
  const census = commerceCensusOf(journey.id);
  const hasTable = journey.assertions.some((a) => a.expectedByEpoch !== undefined);
  const failures: string[] = [];
  if (census === undefined) {
    failures.push("D12 census bound: no F331C §5 census row for this journey — no variant, ever");
  }
  if (!hasTable) {
    failures.push("D10(1): no per-epoch expectation table on any assertion");
  }
  if (!outcomesByAnchor.every((o) => o.passed)) {
    const missingEpoch = outcomesByAnchor.some((o) =>
      o.assertionOutcomes.some((a) => a.expected === MISSING_EPOCH),
    );
    failures.push(missingEpoch
      ? "MISSING_EPOCH: an anchor is not covered by the per-epoch table (certified only at the D9 frozen epochs)"
      : "an epoch run did not pass");
  }
  if (!outcomesByAnchor.every((o, i) => o.digest === rerunDigestsByAnchor[i])) {
    failures.push("D2(c): a same-epoch re-run is not byte-identical");
  }
  for (let i = 0; i < outcomesByAnchor.length; i += 1) {
    for (let j = i + 1; j < outcomesByAnchor.length; j += 1) {
      const differing = outcomesByAnchor[i]!.assertionOutcomes.some(
        (a, k) => a.actual !== outcomesByAnchor[j]!.assertionOutcomes[k]?.actual,
      );
      if (!differing) {
        failures.push(`D2(d)/D13: epochs at indexes ${i},${j} agree on every asserted reading (byte-identical — never a distinct journey)`);
      }
    }
  }
  const proofPasses = failures.length === 0;
  return {
    corpus: "commerce",
    journeyId: journey.id,
    censusCitation: census?.censusCitation
      ?? "no census row (the F331C §5 certified set is exactly the 2 responders)",
    countedEpochs: proofPasses && outcomesByAnchor.length >= 2
      ? outcomesByAnchor.slice(1).map((_, i) => i + 1)
      : [],
    refusalReason: proofPasses
      ? null
      : `D10 proof did not pass: ${failures.join("; ")} — the epochs never count`,
  };
}

// ---------------------------------------------------------------------------
// The ACTIVE composition sites (both re-verify + refuse; never clamp)
// ---------------------------------------------------------------------------

/** The field epoch site's outcome (consumed by the adoption driver). */
export interface FieldEpochSiteResult {
  /** The F331A D10 proofs (null when the schedule has < 2 anchors — no
   * epoch pairs exist to prove; small firms). */
  readonly proofs: readonly EpochExecutionProof[] | null;
  readonly decisions: readonly EpochCountDecision[];
  /** The proofs re-verified AND each proof's anchor-0 outcome digest matches
   * the driver's own epoch-0 corpus run for that journey (execution
   * consistency at T0). */
  readonly proofsVerified: boolean;
  /** D8 rerun supremacy (D13 evidence): the epoch dimension executed ONLY
   * the epoch-declaring (census-certified) journeys — a non-certified
   * journey NEVER executes an epoch >= 2 (its expectations are
   * T0-anchored; the epoch dimension is not its domain). */
  readonly invariantsByteIdentical: boolean;
  /** The epoch dimension's per-anchor digest vectors (index-aligned with
   * the schedule, anchors >= 1): the DECLARING journeys' proof outcome
   * digests at each anchor. */
  readonly epochDimension: readonly (readonly { readonly journeyId: string; readonly digest: string }[])[];
  /** Raw epoch-dimension executions NOT counted (each declaring journey runs
   * TWICE per anchor — the run + its D2(c) same-epoch re-run — including at
   * anchor 0, which re-executes the epoch-0 run: all re-runs by D13). */
  readonly rawEpochExecutions: number;
}

/**
 * The ACTIVE field composition site: run the F331A capability
 * (`runJourneyEpochs`) at the firm's D9 schedule and consume its outcomes
 * (the capability enforces the D10 proof mechanically — a violation
 * throws); the gate re-verifies and decides counting. The epoch dimension
 * (anchors >= 1) executes ONLY the epoch-declaring journeys — D8 rerun
 * supremacy: non-certified journeys never execute an epoch >= 2 (their
 * expectations are T0-anchored single-valued tables; the F330 §1.2 corpus
 * law). `epoch0Outcomes` are the driver's full-corpus epoch-0 run (the
 * counted epoch-1 base + the T0 consistency check).
 */
export function verifyFieldEpochSite(
  journeys: readonly FieldJourney[],
  tenantId: string,
  epochs: readonly number[],
  epoch0Outcomes: readonly FieldOutcome[],
): FieldEpochSiteResult {
  for (const anchor of epochs) assertFrozenEpochAnchor(anchor);
  if (epochs.length < 2) {
    return {
      proofs: null,
      decisions: [],
      proofsVerified: true,
      invariantsByteIdentical: true,
      epochDimension: [],
      rawEpochExecutions: 0,
    };
  }
  const proofs = runJourneyEpochs(journeys, { tenantId, schedule: epochs });
  const decisions = proofs.map(decideFieldEpochCounting);
  const declaringIds = new Set(journeys.filter((j) => j.epochs !== undefined).map((j) => j.id));
  const epochDimension = epochs.slice(1).map((_, k) =>
    proofs.map((p) => ({ journeyId: p.journeyId, digest: (p.outcomes[k + 1] as FieldOutcome).digest })));
  const proofsVerified =
    decisions.every((d) => d.refusalReason === null) &&
    proofs.every((p) => {
      const epoch0 = epoch0Outcomes.find((o) => o.journeyId === p.journeyId);
      return epoch0 !== undefined && (p.outcomes[0] as FieldOutcome).digest === epoch0.digest;
    });
  const invariantsByteIdentical = proofs.every((p) => declaringIds.has(p.journeyId));
  const counted = decisions.reduce((acc, d) => acc + d.countedEpochs.length, 0);
  return {
    proofs,
    decisions,
    proofsVerified,
    invariantsByteIdentical,
    epochDimension,
    rawEpochExecutions: Math.max(0, proofs.length * epochs.length * 2 - counted),
  };
}

/** The commerce epoch site's outcome (consumed by the adoption driver). */
export interface CommerceEpochSiteResult {
  /** The corpus run at every declared epoch anchor (index-aligned with the
   * schedule; epoch 0 is the T0 run — byte-identical to the no-options run). */
  readonly runs: readonly (readonly CommerceOutcome[])[];
  /** Counting decisions for every table-bearing journey when the schedule
   * has >= 2 anchors (certified or not — a non-certified table-bearing
   * journey is REFUSED, honestly recorded; no epoch pairs => no decisions). */
  readonly decisions: readonly EpochCountDecision[];
  /** D2(c)/D13 evidence: every table-bearing journey's same-anchor re-run
   * is byte-identical AND every table-less journey is byte-identical
   * across all epochs (only D10-certified journeys may vary). */
  readonly epochsByteIdentical: boolean;
}

/**
 * The ACTIVE commerce composition site: pass `{ startedAt }` from the firm
 * schedule into `runAllJourneys` at FROZEN anchors only (non-frozen
 * anchors are refused up-front — and the runner's own MISSING_EPOCH
 * sentinel fails uncovered anchors); re-run every table-bearing journey at
 * each anchor for the D2(c) same-epoch byte-identity proof; verify the D13
 * evidence for the table-less journeys.
 */
export async function runCommerceEpochSite(
  journeys: readonly CommerceJourney[],
  epochs: readonly number[],
): Promise<CommerceEpochSiteResult> {
  for (const anchor of epochs) assertFrozenEpochAnchor(anchor);
  const runs: (readonly CommerceOutcome[])[] = [];
  for (let e = 0; e < epochs.length; e += 1) {
    runs.push(await runAllJourneys(journeys, { startedAt: epochs[e] as number }));
  }
  const tableJourneys = epochs.length >= 2
    ? journeys.filter((j) => j.assertions.some((a) => a.expectedByEpoch !== undefined))
    : [];
  const tableIds = new Set(tableJourneys.map((j) => j.id));
  const decisions: EpochCountDecision[] = [];
  let sameAnchorRerunsIdentical = true;
  for (const journey of tableJourneys) {
    const outcomesByAnchor = runs.map((r) => {
      const outcome = r.find((o) => o.journeyId === journey.id);
      if (outcome === undefined) {
        throw new Error(`commerce journey ${journey.id} is missing from an epoch run it must appear in`);
      }
      return outcome;
    });
    const rerunDigests: string[] = [];
    for (let e = 0; e < epochs.length; e += 1) {
      const { outcome } = await runJourney(journey, { startedAt: epochs[e] as number });
      rerunDigests.push(outcome.digest);
      if (outcome.digest !== (outcomesByAnchor[e] as CommerceOutcome).digest) {
        sameAnchorRerunsIdentical = false;
      }
    }
    decisions.push(decideCommerceEpochCounting(journey, outcomesByAnchor, rerunDigests));
  }
  const epoch0 = runs[0] ?? [];
  const epoch0Digests = new Map(epoch0.map((o) => [o.journeyId, o.digest] as const));
  const tablelessIdentical = runs.every((r, e) =>
    e === 0 || r.every((o) => tableIds.has(o.journeyId) || o.digest === epoch0Digests.get(o.journeyId)));
  return {
    runs,
    decisions,
    epochsByteIdentical: sameAnchorRerunsIdentical && tablelessIdentical,
  };
}
