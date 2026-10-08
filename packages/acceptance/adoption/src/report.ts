/**
 * @fleetos/acceptance-adoption — adoption report assembly.
 *
 * Assembles the deployment-acceptance report from the REAL simulation
 * result: per-industry verdicts with their exact inputs (ratios, failing
 * journeys), the 30-workspace population table with per-firm execution
 * counts, the honest-counts ledger, mobile validation per industry, the
 * cross-role-handoff family per industry, the incumbent-vs-FleetOS
 * capability comparison per industry, plus a FNV-1a-family digest with
 * verify + tamper detection (local copy of the sibling packages'
 * digest convention — see `src/digest.ts`).
 *
 * Every number in the report equals a REAL runner output or a recorded
 * shortfall — nothing is re-computed away, nothing is inflated.
 */

import { digestOf, canonicalJson } from "./digest.js";
import { INDUSTRIES, industryById } from "./industries.js";
import { incumbentCapabilities } from "./incumbent.js";
import { computeVerdict, type JourneyExecutionFact, type Verdict } from "./verdicts.js";
import { TARGET_JOURNEYS_PER_FIRM, type AdoptionSimulationResult } from "./adoption-run.js";

export const ADOPTION_REPORT_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Mobile validation — the field corpus's mobile-shape journey per industry
// ---------------------------------------------------------------------------

export interface MobileValidationRow {
  readonly industryId: string;
  /** Does the industry have field applicability at all (honest when false)? */
  readonly hasFieldApplicability: boolean;
  readonly journeyId: string | null;
  readonly executions: number;
  readonly passed: boolean;
  readonly note: string;
}

// ---------------------------------------------------------------------------
// Cross-role handoff family per industry
// ---------------------------------------------------------------------------

export interface HandoffJourneyRow {
  readonly journeyId: string;
  readonly corpus: "field" | "commerce";
  readonly executions: number;
  readonly passed: boolean;
}

export interface HandoffValidationRow {
  readonly industryId: string;
  readonly journeys: readonly HandoffJourneyRow[];
  readonly allPassed: boolean;
}

// ---------------------------------------------------------------------------
// Population, verdicts, incumbent comparison, ledger
// ---------------------------------------------------------------------------

export interface PopulationRow {
  readonly firmId: string;
  readonly industryId: string;
  readonly size: string;
  readonly tenantId: string;
  readonly devices: number;
  readonly fieldEpochs: number;
  readonly fieldExecutions: number;
  readonly commerceExecutions: number;
  readonly securityExecutions: number;
  readonly totalExecutions: number;
  readonly firmVerdict: Verdict;
  readonly shortfall: number;
}

export interface IndustryVerdictRow {
  readonly industryId: string;
  readonly displayName: string;
  readonly verdict: Verdict;
  readonly coveragePassed: number;
  readonly coverageTotal: number;
  readonly coverageRatio: number;
  readonly failingJourneys: ReadonlyArray<{ readonly corpus: string; readonly journeyId: string; readonly reason: string }>;
  readonly unmappedCapabilities: ReadonlyArray<{ readonly capabilityId: string; readonly criticality: string; readonly profileId: string }>;
  readonly reason: string;
}

export interface IncumbentComparisonCapabilityRow {
  readonly capabilityId: string;
  readonly profileId: string;
  readonly criticality: string;
  readonly incumbentSummary: string;
  readonly incumbentDoesNot: string;
  readonly fleetosStatus: "replaced" | "partial" | "unmapped";
  readonly family: readonly string[];
}

export interface IncumbentComparisonRow {
  readonly industryId: string;
  readonly capabilities: readonly IncumbentComparisonCapabilityRow[];
}

export interface AdoptionReport {
  readonly schemaVersion: typeof ADOPTION_REPORT_SCHEMA_VERSION;
  readonly generatedAt: number;
  readonly industryVerdicts: readonly IndustryVerdictRow[];
  readonly population: readonly PopulationRow[];
  readonly mobileValidation: readonly MobileValidationRow[];
  readonly handoffValidation: readonly HandoffValidationRow[];
  readonly incumbentComparison: readonly IncumbentComparisonRow[];
  readonly honestCounts: {
    readonly targetPerFirm: number;
    readonly aggregateShortfall: number;
    readonly entries: ReadonlyArray<{
      readonly firmId: string;
      readonly executed: number;
      readonly target: number;
      readonly shortfall: number;
      readonly reasons: readonly string[];
    }>;
    readonly structuralReasons: readonly string[];
  };
  readonly aggregate: {
    readonly industries: number;
    readonly workspaces: number;
    readonly journeyExecutions: number;
    readonly fieldExecutions: number;
    readonly commerceExecutions: number;
    readonly securityExecutions: number;
    readonly uniqueApplicableJourneys: number;
    readonly determinismProofs: number;
    readonly determinismVerified: boolean;
    readonly allJourneysPassed: boolean;
  };
  readonly digest: string;
}

const MOBILE_JOURNEY_ID = "mobile-field-shape";
const HANDOFF_FAMILY: ReadonlyArray<{ readonly journeyId: string; readonly corpus: "field" | "commerce" }> = [
  { journeyId: "handoff-field-to-operator-publish", corpus: "field" },
  { journeyId: "handoff-field-to-operator-consume", corpus: "field" },
  { journeyId: "cross-role-handoff", corpus: "commerce" },
];

function executionsOf(facts: readonly JourneyExecutionFact[], journeyId: string): readonly JourneyExecutionFact[] {
  return facts.filter((f) => f.journeyId === journeyId);
}

function verdictOfFacts(industryId: string, facts: readonly JourneyExecutionFact[]): Verdict {
  const industry = industryById(industryId);
  if (industry === undefined) throw new Error(`unknown industry: ${industryId}`);
  return computeVerdict(industry, facts).verdict;
}

/** Assemble the adoption report from a REAL simulation result. Deterministic. */
export function assembleAdoptionReport(simulation: AdoptionSimulationResult): AdoptionReport {
  const industryVerdicts: IndustryVerdictRow[] = [];
  const population: PopulationRow[] = [];
  const mobileValidation: MobileValidationRow[] = [];
  const handoffValidation: HandoffValidationRow[] = [];
  const incumbentComparison: IncumbentComparisonRow[] = [];

  for (const industry of INDUSTRIES) {
    const industryRuns = simulation.firmRuns.filter((r) => r.industry.id === industry.id);
    if (industryRuns.length === 0) continue;
    const allFacts = industryRuns.flatMap((r) => r.executionFacts);
    const verdictResult = computeVerdict(industry, allFacts);

    industryVerdicts.push({
      industryId: industry.id,
      displayName: industry.displayName,
      verdict: verdictResult.verdict,
      coveragePassed: verdictResult.input.coverage.passed,
      coverageTotal: verdictResult.input.coverage.total,
      coverageRatio: verdictResult.input.coverage.ratio,
      failingJourneys: verdictResult.input.coverage.failing.map((f) => ({
        corpus: f.corpus,
        journeyId: f.journeyId,
        reason: f.reason,
      })),
      unmappedCapabilities: verdictResult.input.mappings
        .filter((m) => m.status !== "replaced")
        .map((m) => ({ capabilityId: m.capabilityId, criticality: m.criticality, profileId: m.profileId })),
      reason: verdictResult.reason,
    });

    // Mobile validation: applicable + passing for every industry with field
    // applicability; industries without it record that honestly.
    const hasFieldApplicability = industryRuns.some((r) => r.executionFacts.some((f) => f.corpus === "field"));
    const mobileExecutions = executionsOf(allFacts, MOBILE_JOURNEY_ID);
    if (!hasFieldApplicability) {
      mobileValidation.push({
        industryId: industry.id,
        hasFieldApplicability: false,
        journeyId: null,
        executions: 0,
        passed: false,
        note: "no field applicability for this industry — mobile-shape validation not applicable (recorded honestly, not counted as covered)",
      });
    } else {
      mobileValidation.push({
        industryId: industry.id,
        hasFieldApplicability: true,
        journeyId: MOBILE_JOURNEY_ID,
        executions: mobileExecutions.length,
        passed: mobileExecutions.length > 0 && mobileExecutions.every((f) => f.passed),
        note: mobileExecutions.length > 0 && mobileExecutions.every((f) => f.passed)
          ? "mobile-shape journey applicable and passing across the industry's firms and epochs"
          : "mobile-shape journey applicable but NOT passing (or never executed) — visible failure",
      });
    }

    // Cross-role handoff family per industry.
    const handoffJourneys: HandoffJourneyRow[] = HANDOFF_FAMILY.map((h) => {
      const facts = executionsOf(allFacts, h.journeyId);
      return {
        journeyId: h.journeyId,
        corpus: h.corpus,
        executions: facts.length,
        passed: facts.length > 0 && facts.every((f) => f.passed),
      };
    });
    handoffValidation.push({
      industryId: industry.id,
      journeys: handoffJourneys,
      allPassed: handoffJourneys.every((j) => j.passed),
    });

    // Incumbent vs FleetOS capability comparison per industry.
    incumbentComparison.push({
      industryId: industry.id,
      capabilities: incumbentCapabilities(industry.id).map((cap) => {
        const mapping = verdictResult.input.mappings.find((m) => m.capabilityId === cap.id);
        return {
          capabilityId: cap.id,
          profileId: cap.profileId,
          criticality: cap.criticality,
          incumbentSummary: cap.summary,
          incumbentDoesNot: cap.doesNot,
          fleetosStatus: mapping !== undefined ? mapping.status : "unmapped",
          family: cap.replacementJourneyFamily,
        };
      }),
    });
  }

  for (const run of simulation.firmRuns) {
    population.push({
      firmId: run.firm.id,
      industryId: run.firm.industryId,
      size: run.firm.size,
      tenantId: run.firm.tenantId,
      devices: run.firm.devicePopulation.devices,
      fieldEpochs: run.firm.epochs.length,
      fieldExecutions: run.executionCounts.field,
      commerceExecutions: run.executionCounts.commerce,
      securityExecutions: run.executionCounts.security,
      totalExecutions: run.executionCounts.total,
      firmVerdict: verdictOfFacts(run.firm.industryId, run.executionFacts),
      shortfall: Math.max(0, TARGET_JOURNEYS_PER_FIRM - run.executionCounts.total),
    });
  }

  const base: Omit<AdoptionReport, "digest"> = {
    schemaVersion: ADOPTION_REPORT_SCHEMA_VERSION,
    generatedAt: simulation.startedAt,
    industryVerdicts,
    population,
    mobileValidation,
    handoffValidation,
    incumbentComparison,
    honestCounts: {
      targetPerFirm: simulation.honestCounts.targetPerFirm,
      aggregateShortfall: simulation.honestCounts.aggregateShortfall,
      entries: simulation.honestCounts.entries.map((e) => ({
        firmId: e.firmId,
        executed: e.executed,
        target: e.target,
        shortfall: e.shortfall,
        reasons: e.reasons,
      })),
      structuralReasons: simulation.honestCounts.structuralReasons,
    },
    aggregate: simulation.aggregate,
  };
  return { ...base, digest: digestOf("adoption-report", base as unknown as object) };
}

/** Recompute the report's digest; false means tampered content. */
export function verifyAdoptionReport(report: AdoptionReport): boolean {
  const { digest, ...rest } = report;
  return digestOf("adoption-report", rest as unknown as object) === digest;
}

/** Stable JSON rendering (deterministic; used by evidence + tests). */
export function renderReportJson(report: AdoptionReport): string {
  return canonicalJson(report);
}
