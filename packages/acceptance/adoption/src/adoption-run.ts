/**
 * @fleetos/acceptance-adoption — the deterministic adoption driver.
 *
 * For each firm workspace (30), runs the industry-applicable corpus subsets
 * through the REAL runners:
 *
 *   - FIELD (`@fleetos/acceptance-field`): `runJourneyCorpus` with the
 *     firm's REAL tenant id (`tnt_<industry>-<size>`) + the epoch anchor
 *     `startedAt`. The runner IS parameterizable, and the tenant dimension
 *     is REAL (journey digests are tenant-scoped for edge-command + the
 *     handoff pair — machine-verified). The TIME dimension is NOT: the
 *     corpus pins T0-anchored expectations (machine-verified: +1s offset
 *     fails 1 journey, +1h fails 3, multi-day fails 12), so every declared
 *     epoch executes at the fixture epoch T0 and only epoch 1 is COUNTED;
 *     epochs ≥ 2 are byte-identical re-runs, asserted identical per firm
 *     (repeatability evidence) and never counted.
 *   - COMMERCE (`@fleetos/acceptance-commerce`): `runAllJourneys` — the
 *     corpus-family runner. It is NOT tenant/time-parameterizable (fixed
 *     deterministic world), so the corpus runs ONCE per workspace: re-runs
 *     would be byte-identical and are never counted (honesty law).
 *   - SECURITY (`@fleetos/acceptance-security`): `runJourney` per journey —
 *     single-parameter by design (packet law: once-per-workspace runs).
 *
 * Repeatability: every firm's declared epochs ≥ 2 are asserted byte-identical
 * to epoch 1; for ONE firm per industry (the large one), the full applicable
 * set (field + commerce + security) is re-run and asserted byte-identical
 * (the packet's determinism proof). Re-runs are NEVER counted in the
 * journey-execution totals.
 *
 * Count honesty law: "100+ repeatable journeys per firm where supported" —
 * on THIS branch's tree a fully-applicable firm's COUNTED executions cap
 * at 14 + 21 + 13 = 48 (field 14 + commerce 21 — the F300C Wave 10
 * extension — + security 13); even under the packet's assumed full
 * parameterization the cap would be 14×3 + 21×3 + 13 = 118 for a large
 * firm — the assumption is machine-disproven for the REAL corpora — so
 * every firm's exact shortfall is recorded in the honest-counts ledger
 * with its structural reasons. The sibling lanes' Wave 10 extensions
 * (F300A field 14→20, F300B security 13→17) are pushed but unmerged;
 * the CONVERGENCE EXPECTATION (20 + 21 + 17 = 58 for a fully-applicable
 * firm, still short of the 100 target) is recorded honestly in
 * ./convergence-delta.ts for the TL to recompute at F301/F302.
 * NEVER inflated by counting re-runs; the threshold is NEVER silently
 * weakened.
 *
 * Pure deterministic TS; logical `now` only.
 */

import { runJourneyCorpus, type JourneyOutcome as FieldOutcome } from "@fleetos/acceptance-field";
import { runJourney as runSecurityJourney, type JourneyOutcome as SecurityOutcome } from "@fleetos/acceptance-security";
import { runAllJourneys, type JourneyOutcome as CommerceOutcome } from "@fleetos/acceptance-commerce";
import { ADOPTION_T0, WORKSPACE_POPULATION, type FirmWorkspace } from "./firms.js";
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
  /** COUNTED field executions (epoch 1 only — later epochs are re-runs). */
  readonly field: number;
  readonly commerce: number;
  readonly security: number;
  readonly total: number;
}

export interface DeterminismProof {
  readonly firmId: string;
  /** Every declared epoch ≥ 2 byte-identical to epoch 1. */
  readonly fieldEpochsByteIdentical: boolean;
  /** The full-applicable-set re-run (large firms only, per packet). */
  readonly commerceByteIdentical: boolean | null;
  readonly securityByteIdentical: boolean | null;
  readonly verified: boolean;
  /** Digest over the counted run's outcome digests (per corpus). */
  readonly runDigest: string;
}

export interface FirmRunResult {
  readonly firm: FirmWorkspace;
  readonly industry: IndustryDefinition;
  /** The COUNTED field outcomes (epoch 1) — REAL runner outputs. */
  readonly fieldOutcomes: readonly FieldOutcome[];
  /** REAL commerce runner outputs (one pass per workspace). */
  readonly commerceOutcomes: readonly CommerceOutcome[];
  /** REAL security runner outputs (once per workspace). */
  readonly securityOutcomes: readonly SecurityOutcome[];
  /** Outcome digests of every declared field epoch (raw runs, incl. re-runs). */
  readonly fieldEpochDigests: readonly (readonly string[])[];
  readonly executionCounts: ExecutionCounts;
  readonly executionFacts: readonly JourneyExecutionFact[];
  readonly determinismProof: DeterminismProof;
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

  // Every declared epoch executes at the corpus fixture anchor (see module
  // doc): epoch 1 is COUNTED; epochs ≥ 2 are asserted byte-identical re-runs.
  const epochOutcomes: FieldOutcome[][] = [];
  for (let epoch = 0; epoch < firm.epochs.length; epoch += 1) {
    epochOutcomes.push([
      ...runJourneyCorpus(fieldJourneys, { tenantId: firm.tenantId, startedAt: firm.epochs[epoch] as number }),
    ]);
  }
  const fieldOutcomes = epochOutcomes[0] as readonly FieldOutcome[];
  const fieldEpochsByteIdentical = epochOutcomes.every((o) => byteIdentical(o, fieldOutcomes));

  const commerceOutcomes = await runAllJourneys(applicableCommerceJourneys(industry));
  const securityOutcomes = applicableSecurityJourneys(industry).map((j) => runSecurityJourney(j).outcome);

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

  // The packet's determinism proof: the LARGE firm re-runs the FULL
  // applicable set (field + commerce + security) and asserts byte-identity.
  // (The field epochs ≥ 2 above already re-run the field set.)
  const needsFullProof = firm.size === "large";
  const reRunCommerce = needsFullProof ? await runAllJourneys(applicableCommerceJourneys(industry)) : null;
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
    verified:
      fieldEpochsByteIdentical &&
      (commerceByteIdentical === null || commerceByteIdentical) &&
      (securityByteIdentical === null || securityByteIdentical),
    runDigest: proofDigest(fieldOutcomes, commerceOutcomes, securityOutcomes),
  };

  return {
    firm,
    industry,
    fieldOutcomes,
    commerceOutcomes,
    securityOutcomes,
    fieldEpochDigests: epochOutcomes.map((o) => o.map((x) => x.digest)),
    executionCounts: {
      field: fieldOutcomes.length,
      commerce: commerceOutcomes.length,
      security: securityOutcomes.length,
      total: fieldOutcomes.length + commerceOutcomes.length + securityOutcomes.length,
    },
    executionFacts,
    determinismProof,
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
  "even under the packet's assumed full parameterization (field + commerce × 3 epochs + security), a fully-applicable large firm would reach 14×3 + 21×3 + 13 = 118 counted executions on this tree; the REAL corpora support 14 + 21 + 13 = 48 — the shortfall is structural (runner/corpus shape), not a coverage gap",
  "the sibling lanes' Wave 10 extensions (F300A field 14→20 at e221c07, F300B security 13→17 at b5be8e4) are pushed but unmerged — at convergence a fully-applicable firm reaches 20 + 21 + 17 = 58 counted journeys, still 42 short of the 100 target; the expectation is recorded in convergence-delta.ts and the TL recomputes at F301/F302 — the threshold is never silently weakened",
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
  readonly uniqueApplicableJourneys: number;
  readonly determinismProofs: number;
  readonly determinismVerified: boolean;
  readonly allJourneysPassed: boolean;
}

export interface AdoptionSimulationResult {
  readonly startedAt: number;
  readonly firmRuns: readonly FirmRunResult[];
  readonly aggregate: AdoptionAggregate;
  readonly honestCounts: HonestCountsLedger;
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
  const fieldEpochReRuns = firmRuns.reduce(
    (acc, r) => acc + r.fieldEpochDigests.slice(1).reduce((a, d) => a + d.length, 0),
    0,
  );
  const uniqueApplicableJourneys = selectedIndustries.reduce(
    (acc, i) =>
      acc + applicableFieldJourneys(i).length + applicableCommerceJourneys(i).length + applicableSecurityJourneys(i).length,
    0,
  );
  const proofs = firmRuns.map((r) => r.determinismProof);
  const allPassed = firmRuns.every((r) => r.executionFacts.length > 0 && r.executionFacts.every((f) => f.passed));

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
      uniqueApplicableJourneys,
      determinismProofs: proofs.length,
      determinismVerified: proofs.length > 0 && proofs.every((p) => p.verified),
      allJourneysPassed: allPassed,
    },
    honestCounts,
  };
}
