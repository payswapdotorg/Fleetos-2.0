/**
 * @fleetos/acceptance-adoption — the deterministic adoption driver.
 *
 * For each firm workspace (30), runs the industry-applicable corpus subsets
 * through the REAL runners:
 *
 *   - FIELD (`@fleetos/acceptance-field`): `runJourneyCorpus` with the
 *     firm's REAL tenant id (`tnt_<industry>-<size>`) + the epoch anchor
 *     `startedAt` (the tenant dimension is REAL — journey digests are
 *     tenant-scoped). The TIME dimension is governed by the F332 counting
 *     gate (./epoch-gate.ts, EPOCH_COUNTING_ACTIVE): while INACTIVE every
 *     declared epoch executes at the fixture anchor T0 and only epoch 1 is
 *     COUNTED (epochs ≥ 2 are byte-identical re-runs, asserted per firm,
 *     never counted — the Wave-12 law persists byte-identically); when
 *     ACTIVE every declared epoch executes at its D9 frozen anchor and the
 *     F331A capability (`runJourneyEpochs`) produces the D10 proofs the
 *     gate consumes — a journey's epoch ≥ 2 counts iff the proof passes
 *     (per-epoch table + pairwise asserted-reading distinctness +
 *     same-epoch byte-identity) and the D13 refusals hold.
 *   - COMMERCE (`@fleetos/acceptance-commerce`): `runAllJourneys` over the
 *     F331C time seam (`{ startedAt }`). While INACTIVE the corpus runs
 *     ONCE per workspace (the no-options run anchors at the commerce
 *     fixture epoch T0 — byte-identical to the pre-seam tree; re-runs are
 *     byte-identical and never counted). When ACTIVE the corpus runs at
 *     every D9 frozen anchor (non-frozen anchors are MISSING_EPOCH-style
 *     refusals, never clamps) and the census-certified responders' epochs
 *     ≥ 2 count iff the D10 proof passes; every other epoch run is a
 *     byte-identical re-run (D13, never counted).
 *   - SECURITY (`@fleetos/acceptance-security`): `runJourney` per journey —
 *     single-parameter by design (packet law: once-per-workspace runs).
 *     TODO-F332-SECURITY: the F331B lane (security time seam + census) is
 *     platform-blocked (capacity crunch; 3 dispatch attempts evidenced) —
 *     security stays single-counted; NEVER assume security responders.
 *
 * Repeatability: every firm's declared epochs ≥ 2 are asserted byte-identical
 * to epoch 1 (INACTIVE) or proven per the D10/D13 laws (ACTIVE — see
 * DeterminismProof); for ONE firm per industry (the large one), the full
 * applicable set (field + commerce + security) is re-run and asserted
 * byte-identical (the packet's determinism proof). Re-runs are NEVER counted
 * in the journey-execution totals.
 *
 * Count honesty law: "100+ repeatable journeys per firm where supported" —
 * the corpora's exact counted cap per fully-applicable firm is machine-
 * measured in the honest-counts ledger (never inflated by counting re-runs;
 * the threshold is NEVER silently weakened — see convergence-delta.ts).
 *
 * Pure deterministic TS; logical `now` only.
 */

import { runJourneyCorpus, type JourneyOutcome as FieldOutcome } from "@fleetos/acceptance-field";
import { runJourney as runSecurityJourney, type JourneyOutcome as SecurityOutcome } from "@fleetos/acceptance-security";
import { runAllJourneys, type JourneyOutcome as CommerceOutcome } from "@fleetos/acceptance-commerce";
import { ADOPTION_T0, WORKSPACE_POPULATION, type FirmWorkspace } from "./firms.js";
import {
  EPOCH_COUNTING_ACTIVE,
  runCommerceEpochSite,
  verifyFieldEpochSite,
  type EpochCountDecision,
} from "./epoch-gate.js";
import { applicableCommerceJourneys, applicableFieldJourneys, applicableSecurityJourneys, INDUSTRIES, industryById, maskedJourneyRationales, type IndustryDefinition } from "./industries.js";
import { type JourneyExecutionFact } from "./verdicts.js";
import { byteIdentical, digestOf } from "./digest.js";

// ---------------------------------------------------------------------------
// Outcome adapters (REAL outcomes only — failure notes extracted, never invented)
// ---------------------------------------------------------------------------

function fieldFailureNote(outcome: FieldOutcome): string | null {
  const step = outcome.steps.find((s) => !s.ok);
  if (step !== undefined) return `step ${step.id} (${step.kind}) failed${step.note !== null ? `: ${step.note}` : ""}`;
  const assertion = outcome.assertions.find((a) => !a.pass);
  if (assertion !== undefined) {
    return `assertion ${assertion.id} failed: expected ${JSON.stringify(assertion.expected)}, actual ${JSON.stringify(assertion.actual)}`;
  }
  return null;
}

function commerceFailureNote(outcome: CommerceOutcome): string | null {
  const step = outcome.stepOutcomes.find((s) => !s.ok || !s.executed);
  if (step !== undefined) {
    return step.executed ? `step ${step.stepId} (${step.kind}) failed` : `step ${step.stepId} (${step.kind}) not executed`;
  }
  const assertion = outcome.assertionOutcomes.find((a) => !a.ok);
  if (assertion !== undefined) {
    return `assertion ${assertion.assertionId} failed: expected ${JSON.stringify(assertion.expected)}, actual ${JSON.stringify(assertion.actual)}`;
  }
  return null;
}

function securityFailureNote(outcome: SecurityOutcome): string | null {
  const step = outcome.steps.find((s) => !s.ok);
  if (step !== undefined) return `step ${step.stepId} failed: ${step.detail}`;
  const assertion = outcome.assertions.find((a) => !a.pass);
  if (assertion !== undefined) return `assertion ${assertion.assertionId} failed: ${assertion.reason}`;
  return null;
}

// ---------------------------------------------------------------------------
// The per-firm run
// ---------------------------------------------------------------------------

export interface ExecutionCounts {
  /** COUNTED field executions (INACTIVE: epoch 1 only — later epochs are
   * re-runs; ACTIVE: epoch 1 + every D10-proof-passing epoch ≥ 2). */
  readonly field: number;
  /** COUNTED commerce executions (INACTIVE: one pass per workspace; ACTIVE:
   * the T0 pass + the census-certified responders' proof-passing epochs). */
  readonly commerce: number;
  readonly security: number;
  readonly total: number;
}

export interface DeterminismProof {
  readonly firmId: string;
  /** Every declared epoch ≥ 2 byte-identical to epoch 1 (the INACTIVE law;
   * false in ACTIVE whenever a D10-certified journey genuinely varies —
   * the ACTIVE laws are the fields below). */
  readonly fieldEpochsByteIdentical: boolean;
  /** The full-applicable-set re-run (large firms only, per packet). */
  readonly commerceByteIdentical: boolean | null;
  readonly securityByteIdentical: boolean | null;
  readonly verified: boolean;
  /** Digest over the counted epoch-0 (T0) corpus outcomes (per corpus; the
   * counted epoch ≥ 2 executions are evidenced per-fact in executionFacts
   * and per-epoch in fieldEpochDigests). */
  readonly runDigest: string;
  /** F332: the gate mode this proof was produced in (EPOCH_COUNTING_ACTIVE). */
  readonly epochCountingActive: boolean;
  /** F332 (ACTIVE only; null when INACTIVE): every F331A epoch proof
   * re-verified (D10: pass at every anchor, D2(c) same-epoch byte-identity,
   * D2(d) pairwise asserted-reading distinctness, D13 digest distinctness)
   * AND each proof's outcome digests match the driver's own epoch runs. */
  readonly fieldEpochProofsVerified: boolean | null;
  /** F332 (ACTIVE only; null when INACTIVE): every field journey WITHOUT an
   * epoch declaration is byte-identical across ALL declared epochs (the D13
   * never-count evidence — only D10-certified journeys may vary). */
  readonly fieldInvariantsByteIdentical: boolean | null;
  /** F332 (ACTIVE only; null when INACTIVE): every commerce epoch run's
   * same-anchor re-run is byte-identical (D2(c)) and every table-less
   * commerce journey is byte-identical across epochs (D13). */
  readonly commerceEpochsByteIdentical: boolean | null;
}

export interface FirmRunResult {
  readonly firm: FirmWorkspace;
  readonly industry: IndustryDefinition;
  /** The COUNTED field outcomes (epoch 0) — REAL runner outputs. */
  readonly fieldOutcomes: readonly FieldOutcome[];
  /** REAL commerce runner outputs (the epoch-0/T0 pass; one pass per
   * workspace while INACTIVE). */
  readonly commerceOutcomes: readonly CommerceOutcome[];
  /** REAL security runner outputs (once per workspace — TODO-F332-SECURITY). */
  readonly securityOutcomes: readonly SecurityOutcome[];
  /** Outcome digests of every declared field epoch (raw runs, incl. re-runs). */
  readonly fieldEpochDigests: readonly (readonly string[])[];
  readonly executionCounts: ExecutionCounts;
  readonly executionFacts: readonly JourneyExecutionFact[];
  readonly determinismProof: DeterminismProof;
  /** F332: the per-journey epoch counting decisions (D10 proof + D13
   * refusals, with the D8 census citations); empty while the gate is
   * INACTIVE (no epoch ever counts then). */
  readonly epochDecisions: readonly EpochCountDecision[];
  /** F332: raw commerce epoch runs EXECUTED (every declared anchor beyond
   * epoch 0; 0 while INACTIVE — the corpus runs once per workspace then). */
  readonly commerceEpochRunCount: number;
}

function proofDigest(field: readonly FieldOutcome[], commerce: readonly CommerceOutcome[], security: readonly SecurityOutcome[]): string {
  return digestOf("adoption-determinism", {
    field: field.map((o) => o.digest),
    commerce: commerce.map((o) => o.digest),
    security: security.map((o) => o.digest),
  });
}

/** Run ONE firm workspace through the REAL runners. */
export async function runFirm(firm: FirmWorkspace): Promise<FirmRunResult> {
  const industry = industryById(firm.industryId);
  if (industry === undefined) throw new Error(`unknown industry: ${firm.industryId}`);
  const fieldJourneys = applicableFieldJourneys(industry);
  const commerceJourneys = applicableCommerceJourneys(industry);
  const countingActive = EPOCH_COUNTING_ACTIVE;

  // FIELD composition site (F332): the D9 schedule + the counting gate.
  // INACTIVE (D7: "Until the F332 convergence lands the counting gate, NO
  // epoch variant counts" — the Wave-12 state persists byte-identically):
  // every declared epoch executes at the fixture anchor (epoch 0's anchor)
  // as an asserted byte-identical re-run, never counted. ACTIVE: every
  // declared epoch executes at its D9 anchor (raw runs — transparency +
  // D13 evidence), and the F331A capability produces the D10 proofs the
  // gate consumes for counting.
  const epochOutcomes: FieldOutcome[][] = [];
  for (let epoch = 0; epoch < firm.epochs.length; epoch += 1) {
    const anchor = countingActive ? (firm.epochs[epoch] as number) : (firm.epochs[0] as number);
    epochOutcomes.push([
      ...runJourneyCorpus(fieldJourneys, { tenantId: firm.tenantId, startedAt: anchor }),
    ]);
  }
  const fieldOutcomes = epochOutcomes[0] as readonly FieldOutcome[];
  const fieldEpochsByteIdentical = epochOutcomes.every((o) => byteIdentical(o, fieldOutcomes));

  const fieldSite = countingActive
    ? verifyFieldEpochSite(fieldJourneys, firm.tenantId, firm.epochs, epochOutcomes)
    : null;

  // COMMERCE composition site (F332, the F331C seam): pass `{ startedAt }`
  // from the firm schedule into runAllJourneys at FROZEN anchors only
  // (non-frozen anchors are MISSING_EPOCH-style refusals, never clamps).
  // INACTIVE: the corpus runs ONCE per workspace — the no-options run
  // (byte-identical to today's law). ACTIVE: the corpus runs at every
  // declared D9 anchor; the census-certified responders' epochs ≥ 2 count
  // iff the D10 proof passes; every other epoch run is a byte-identical
  // re-run (D13, never counted).
  let commerceOutcomes: readonly CommerceOutcome[];
  const commerceSite = countingActive
    ? await runCommerceEpochSite(commerceJourneys, firm.epochs)
    : null;
  if (commerceSite === null) {
    commerceOutcomes = await runAllJourneys(commerceJourneys);
  } else {
    commerceOutcomes = commerceSite.runs[0] as readonly CommerceOutcome[];
  }

  // SECURITY composition site: TODO-F332-SECURITY — the F331B lane
  // (security time seam + census) is platform-blocked; security runs
  // once per workspace through its single-parameter REAL runner and
  // stays single-counted. NEVER assume security responders.
  const securityOutcomes = applicableSecurityJourneys(industry).map((j) => runSecurityJourney(j).outcome);

  const epochDecisions: EpochCountDecision[] = [
    ...(fieldSite?.decisions ?? []),
    ...(commerceSite?.decisions ?? []),
  ];

  const executionFacts: JourneyExecutionFact[] = fieldOutcomes.map((o) => ({
    corpus: "field",
    journeyId: o.journeyId,
    epoch: 0,
    passed: o.passed,
    failureNote: fieldFailureNote(o),
    digest: o.digest,
  }));
  for (const o of commerceOutcomes) {
    executionFacts.push({
      corpus: "commerce",
      journeyId: o.journeyId,
      epoch: 0,
      passed: o.passed,
      failureNote: commerceFailureNote(o),
      digest: o.digest,
    });
  }
  for (const o of securityOutcomes) {
    executionFacts.push({
      corpus: "security",
      journeyId: o.journeyId,
      epoch: 0,
      passed: o.pass,
      failureNote: securityFailureNote(o),
      digest: o.digest,
    });
  }
  // The counted epoch executions (ACTIVE only — D10 proof + D13 refusals
  // decided; the facts carry the REAL outcome digests of the counted runs).
  for (const decision of epochDecisions) {
    for (const epochIdx of decision.countedEpochs) {
      if (decision.corpus === "field") {
        const outcome = (epochOutcomes[epochIdx] ?? []).find((o) => o.journeyId === decision.journeyId);
        if (outcome === undefined) throw new Error(`counted field epoch missing its run: ${decision.journeyId} @ ${epochIdx}`);
        executionFacts.push({
          corpus: "field",
          journeyId: decision.journeyId,
          epoch: epochIdx,
          passed: outcome.passed,
          failureNote: fieldFailureNote(outcome),
          digest: outcome.digest,
        });
      } else {
        const outcome = (commerceSite?.runs[epochIdx] ?? []).find((o) => o.journeyId === decision.journeyId);
        if (outcome === undefined) throw new Error(`counted commerce epoch missing its run: ${decision.journeyId} @ ${epochIdx}`);
        executionFacts.push({
          corpus: "commerce",
          journeyId: decision.journeyId,
          epoch: epochIdx,
          passed: outcome.passed,
          failureNote: commerceFailureNote(outcome),
          digest: outcome.digest,
        });
      }
    }
  }

  const countedFieldEpochs = epochDecisions
    .filter((d) => d.corpus === "field")
    .reduce((acc, d) => acc + d.countedEpochs.length, 0);
  const countedCommerceEpochs = epochDecisions
    .filter((d) => d.corpus === "commerce")
    .reduce((acc, d) => acc + d.countedEpochs.length, 0);

  // The packet's determinism proof: the LARGE firm re-runs the FULL
  // applicable set (field + commerce + security) and asserts byte-identity
  // (the field epochs ≥ 2 above already re-run the field set at the
  // fixture anchor while INACTIVE).
  const needsFullProof = firm.size === "large";
  const reRunCommerce = needsFullProof ? await runAllJourneys(commerceJourneys) : null;
  const reRunSecurity = needsFullProof
    ? applicableSecurityJourneys(industry).map((j) => runSecurityJourney(j).outcome)
    : null;
  const commerceByteIdentical = reRunCommerce === null ? null : byteIdentical(commerceOutcomes, reRunCommerce);
  const securityByteIdentical = reRunSecurity === null ? null : byteIdentical(securityOutcomes, reRunSecurity);

  const determinismProof: DeterminismProof = {
    firmId: firm.id,
    fieldEpochsByteIdentical,
    commerceByteIdentical,
    securityByteIdentical,
    verified: countingActive
      ? (fieldSite?.proofsVerified ?? true) === true
        && (fieldSite?.invariantsByteIdentical ?? true) === true
        && (commerceSite?.epochsByteIdentical ?? true) === true
        && (commerceByteIdentical === null || commerceByteIdentical)
        && (securityByteIdentical === null || securityByteIdentical)
      : fieldEpochsByteIdentical
        && (commerceByteIdentical === null || commerceByteIdentical)
        && (securityByteIdentical === null || securityByteIdentical),
    runDigest: proofDigest(fieldOutcomes, commerceOutcomes, securityOutcomes),
    epochCountingActive: countingActive,
    fieldEpochProofsVerified: countingActive ? (fieldSite?.proofsVerified ?? true) : null,
    fieldInvariantsByteIdentical: countingActive ? (fieldSite?.invariantsByteIdentical ?? true) : null,
    commerceEpochsByteIdentical: countingActive ? (commerceSite?.epochsByteIdentical ?? true) : null,
  };

  return {
    firm,
    industry,
    fieldOutcomes,
    commerceOutcomes,
    securityOutcomes,
    fieldEpochDigests: epochOutcomes.map((o) => o.map((x) => x.digest)),
    executionCounts: {
      field: fieldOutcomes.length + countedFieldEpochs,
      commerce: commerceOutcomes.length + countedCommerceEpochs,
      security: securityOutcomes.length,
      total: fieldOutcomes.length + countedFieldEpochs
        + commerceOutcomes.length + countedCommerceEpochs
        + securityOutcomes.length,
    },
    executionFacts,
    determinismProof,
    epochDecisions,
    commerceEpochRunCount: commerceSite === null ? 0 : Math.max(0, commerceSite.runs.length - 1) * commerceOutcomes.length,
  };
}

// ---------------------------------------------------------------------------
// The honest-counts ledger
// ---------------------------------------------------------------------------

export const TARGET_JOURNEYS_PER_FIRM = 100;

export interface FirmShortfall {
  readonly firmId: string;
  readonly industryId: string;
  readonly size: string;
  readonly executed: number;
  readonly target: number;
  readonly shortfall: number;
  readonly reasons: readonly string[];
}

export interface HonestCountsLedger {
  readonly targetPerFirm: number;
  readonly entries: readonly FirmShortfall[];
  readonly aggregateShortfall: number;
  readonly structuralReasons: readonly string[];
}

const STRUCTURAL_REASONS = [
  "field corpus (F270A) is the only parameterizable runner (runJourneyCorpus takes tenantId + startedAt), but its journeys pin T0-anchored expectations — machine-verified: a +1s startedAt offset fails 1 journey, +1h fails 3, multi-day offsets fail 12 — so every declared epoch executes at the corpus fixture epoch 1774000000000 and only epoch 1 is counted (epochs ≥ 2 are byte-identical re-runs, proven per firm, never counted)",
  "commerce corpus runner (runAllJourneys) is not tenant/time-parameterizable — the corpus runs ONCE per workspace; re-runs are byte-identical and counting them would inflate (count-honesty law)",
  "security corpus runner (runJourney) is single-parameter (journey only) — once-per-workspace per the packet; re-runs are byte-identical and are not counted",
  "even under the packet's assumed full parameterization (field + commerce × 3 epochs + security), a fully-applicable large firm would reach 20×3 + 31×3 + 17 = 170 counted executions on this tree; the REAL corpora support 20 + 31 + 17 = 68 — the shortfall is structural (runner/corpus shape), not a coverage gap",
  "the F310C Wave 11 commerce extension (21 → 31 distinct journeys, this tree) grows the fully-applicable cap to 20 + 31 + 17 = 68 counted journeys, still 32 short of the 100 target; the Wave 11 sibling lanes (F310A/F310B) are verification lanes with no corpus changes, so the converged cap at F311 is this tree's 68; the expectation is recorded in convergence-delta.ts and the TL recomputes at F311 — the threshold is never silently weakened",
] as const;

function firmShortfall(run: FirmRunResult): FirmShortfall {
  const maskedCount = maskedJourneyRationales(run.industry).length;
  const reasons = [
    ...STRUCTURAL_REASONS,
    `${maskedCount} journey(s) masked out as not industry-applicable (rationale recorded per masked journey)`,
  ];
  return {
    firmId: run.firm.id,
    industryId: run.firm.industryId,
    size: run.firm.size,
    executed: run.executionCounts.total,
    target: TARGET_JOURNEYS_PER_FIRM,
    shortfall: Math.max(0, TARGET_JOURNEYS_PER_FIRM - run.executionCounts.total),
    reasons,
  };
}

// ---------------------------------------------------------------------------
// The full simulation
// ---------------------------------------------------------------------------

export interface AdoptionSimulationOptions {
  /** Restrict to a subset of industries (stable ids). Default: all ten. */
  readonly industryIds?: readonly string[];
}

export interface AdoptionAggregate {
  readonly industries: number;
  readonly workspaces: number;
  /** COUNTED journey executions (re-runs never counted). */
  readonly journeyExecutions: number;
  readonly fieldExecutions: number;
  readonly commerceExecutions: number;
  readonly securityExecutions: number;
  /** Raw declared-epoch field re-runs executed but NOT counted (transparency). */
  readonly fieldEpochReRuns: number;
  /** F332: raw commerce epoch runs executed but NOT counted (transparency;
   * 0 while the gate is INACTIVE — the corpus runs once per workspace). */
  readonly commerceEpochReRuns: number;
  readonly uniqueApplicableJourneys: number;
  readonly determinismProofs: number;
  readonly determinismVerified: boolean;
  readonly allJourneysPassed: boolean;
}

/** One ledger row: the journeys whose epochs EARNED counted executions. */
export interface EpochCountLedgerEntry {
  readonly corpus: "field" | "commerce";
  readonly journeyId: string;
  /** The D8 census citation (D10(3)) — verbatim from the census of record. */
  readonly censusCitation: string;
  /** Total counted epoch executions across the simulated firms. */
  readonly countedExecutions: number;
}

export interface AdoptionSimulationResult {
  readonly startedAt: number;
  readonly firmRuns: readonly FirmRunResult[];
  readonly aggregate: AdoptionAggregate;
  readonly honestCounts: HonestCountsLedger;
  /** F332: the epoch-count ledger (empty while the gate is INACTIVE —
   * the exact journey IDs earning epoch counts + their census citations). */
  readonly epochCountLedger: readonly EpochCountLedgerEntry[];
}

/** Run the full industry adoption simulation over the REAL corpora. */
export async function runAdoptionSimulation(
  options: AdoptionSimulationOptions = {},
): Promise<AdoptionSimulationResult> {
  const industryFilter = options.industryIds !== undefined ? new Set(options.industryIds) : null;
  const selectedIndustries = industryFilter === null
    ? INDUSTRIES
    : INDUSTRIES.filter((i) => industryFilter.has(i.id));
  const firms = WORKSPACE_POPULATION.filter(
    (f) => selectedIndustries.some((i) => i.id === f.industryId),
  );

  const firmRuns: FirmRunResult[] = [];
  for (const firm of firms) {
    firmRuns.push(await runFirm(firm));
  }

  const journeyExecutions = firmRuns.reduce((acc, r) => acc + r.executionCounts.total, 0);
  const fieldExecutions = firmRuns.reduce((acc, r) => acc + r.executionCounts.field, 0);
  const commerceExecutions = firmRuns.reduce((acc, r) => acc + r.executionCounts.commerce, 0);
  const securityExecutions = firmRuns.reduce((acc, r) => acc + r.executionCounts.security, 0);
  // Raw declared-epoch field runs NOT counted: every epoch ≥ 2 run minus the
  // counted ones (INACTIVE: all of them — the Wave-12 law; ACTIVE: only the
  // D13-refused ones, e.g. the invariant journeys' byte-identical re-runs).
  const fieldEpochReRuns = firmRuns.reduce(
    (acc, r) =>
      acc + r.fieldEpochDigests.slice(1).reduce((a, d) => a + d.length, 0)
      - (r.executionCounts.field - r.fieldOutcomes.length),
    0,
  );
  // Raw commerce epoch runs NOT counted (ACTIVE only — the INACTIVE law runs
  // the corpus once per workspace, so there are none).
  const commerceEpochReRuns = firmRuns.reduce(
    (acc, r) =>
      acc + r.commerceEpochRunCount
      - (r.executionCounts.commerce - r.commerceOutcomes.length),
    0,
  );
  const uniqueApplicableJourneys = selectedIndustries.reduce(
    (acc, i) =>
      acc + applicableFieldJourneys(i).length + applicableCommerceJourneys(i).length + applicableSecurityJourneys(i).length,
    0,
  );
  const proofs = firmRuns.map((r) => r.determinismProof);
  const allPassed = firmRuns.every((r) => r.executionFacts.length > 0 && r.executionFacts.every((f) => f.passed));

  // The epoch-count ledger: the exact journey IDs earning counted epoch
  // executions + their D8 census citations (empty while INACTIVE).
  const ledger = new Map<string, EpochCountLedgerEntry>();
  for (const run of firmRuns) {
    for (const decision of run.epochDecisions) {
      if (decision.countedEpochs.length === 0) continue;
      const key = `${decision.corpus}:${decision.journeyId}`;
      const current = ledger.get(key);
      if (current === undefined) {
        ledger.set(key, {
          corpus: decision.corpus,
          journeyId: decision.journeyId,
          censusCitation: decision.censusCitation,
          countedExecutions: decision.countedEpochs.length,
        });
      } else {
        ledger.set(key, { ...current, countedExecutions: current.countedExecutions + decision.countedEpochs.length });
      }
    }
  }
  const epochCountLedger = [...ledger.values()];

  const entries = firmRuns.map(firmShortfall);
  const honestCounts: HonestCountsLedger = {
    targetPerFirm: TARGET_JOURNEYS_PER_FIRM,
    entries,
    aggregateShortfall: entries.reduce((acc, e) => acc + e.shortfall, 0),
    structuralReasons: STRUCTURAL_REASONS,
  };

  return {
    startedAt: ADOPTION_T0,
    firmRuns,
    aggregate: {
      industries: selectedIndustries.length,
      workspaces: firmRuns.length,
      journeyExecutions,
      fieldExecutions,
      commerceExecutions,
      securityExecutions,
      fieldEpochReRuns,
      commerceEpochReRuns,
      uniqueApplicableJourneys,
      determinismProofs: proofs.length,
      determinismVerified: proofs.length > 0 && proofs.every((p) => p.verified),
      allJourneysPassed: allPassed,
    },
    honestCounts,
    epochCountLedger,
  };
}
