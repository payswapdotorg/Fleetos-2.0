/**
 * @fleetos/acceptance-security — acceptance report assembly (F270B).
 *
 * Aggregates journey outcomes into an acceptance report:
 *   - per-journey summary (pass, failed assertion ids, digest);
 *   - totals (pass count, fail count);
 *   - the coverage matrix persona x capability, counting ONLY PASSING
 *     journeys — zero-inflation by construction (a capability is never
 *     claimed covered without a passing journey; a failing journey appears
 *     in the failures list instead);
 *   - report digest + verify (tampering with any presented field is
 *     detected by recomputation).
 */

import type { JourneyCapability, JourneyOutcome, JourneyPersona } from "./journey-contracts.ts";
import { JOURNEY_CAPABILITIES, JOURNEY_PERSONAS, canonicalJson, fnv1a } from "./journey-contracts.ts";

export interface JourneySummary {
  readonly journeyId: string;
  readonly persona: JourneyPersona;
  readonly capabilities: readonly JourneyCapability[];
  readonly pass: boolean;
  readonly failedAssertionIds: readonly string[];
  readonly failedStepIds: readonly string[];
  readonly digest: string;
}

export interface CoverageMatrix {
  readonly personas: readonly JourneyPersona[];
  readonly capabilities: readonly JourneyCapability[];
  /** matrix[persona][capability] = count of PASSING journeys covering it. */
  readonly matrix: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

export interface AcceptanceReport {
  readonly reportId: string;
  readonly totalJourneys: number;
  readonly passedJourneys: number;
  readonly failedJourneys: number;
  readonly journeys: readonly JourneySummary[];
  readonly coverage: CoverageMatrix;
  /** Capabilities with ZERO passing journeys — the honest gap list. */
  readonly uncoveredCapabilities: readonly JourneyCapability[];
  /** Personas with ZERO passing journeys — the honest gap list. */
  readonly uncoveredPersonas: readonly JourneyPersona[];
  readonly digest: string;
}

export type ReportDigestInput = Omit<AcceptanceReport, "digest">;

/** The digest over a report's semantic content (excludes the digest itself). */
export function acceptanceReportDigest(report: ReportDigestInput): string {
  return fnv1a(`acceptance|v1|${canonicalJson(report)}`);
}

/** Assemble the acceptance report from journey outcomes. Deterministic. */
export function assembleAcceptanceReport(outcomes: readonly JourneyOutcome[]): AcceptanceReport {
  const journeys: JourneySummary[] = outcomes.map((o) => ({
    journeyId: o.journeyId,
    persona: o.persona,
    capabilities: [...o.capabilities],
    pass: o.pass,
    failedAssertionIds: o.assertions.filter((a) => !a.pass).map((a) => a.assertionId),
    failedStepIds: o.steps.filter((s) => !s.ok).map((s) => s.stepId),
    digest: o.digest,
  }));

  const matrix: Record<string, Record<string, number>> = {};
  for (const persona of JOURNEY_PERSONAS) {
    matrix[persona] = {};
    for (const capability of JOURNEY_CAPABILITIES) {
      matrix[persona]![capability] = 0;
    }
  }
  for (const summary of journeys) {
    if (!summary.pass) continue;
    for (const capability of summary.capabilities) {
      const row = matrix[summary.persona];
      if (row === undefined) continue;
      row[capability] = (row[capability] ?? 0) + 1;
    }
  }

  const coverage: CoverageMatrix = {
    personas: [...JOURNEY_PERSONAS],
    capabilities: [...JOURNEY_CAPABILITIES],
    matrix,
  };

  const uncoveredCapabilities = JOURNEY_CAPABILITIES.filter(
    (c) => journeys.filter((j) => j.pass && j.capabilities.includes(c)).length === 0,
  );
  const uncoveredPersonas = JOURNEY_PERSONAS.filter(
    (p) => journeys.filter((j) => j.pass && j.persona === p).length === 0,
  );

  const withoutDigest: ReportDigestInput = {
    reportId: "fleetos-acceptance-security-w7b",
    totalJourneys: journeys.length,
    passedJourneys: journeys.filter((j) => j.pass).length,
    failedJourneys: journeys.filter((j) => !j.pass).length,
    journeys,
    coverage,
    uncoveredCapabilities,
    uncoveredPersonas,
  };
  return { ...withoutDigest, digest: acceptanceReportDigest(withoutDigest) };
}

/** Verify an acceptance report — recomputes the digest over the presented content. */
export function verifyAcceptanceReport(report: AcceptanceReport): boolean {
  const { digest, ...rest } = report;
  return acceptanceReportDigest(rest) === digest;
}

/** Honest zero-inflation check: every nonzero matrix cell has a passing journey. */
export function coverageCellsBackedByPassingJourneys(
  report: AcceptanceReport,
  outcomes: readonly JourneyOutcome[],
): boolean {
  const byId = new Map(outcomes.map((o) => [o.journeyId, o]));
  for (const [persona, row] of Object.entries(report.coverage.matrix)) {
    for (const [capability, count] of Object.entries(row)) {
      if (count === 0) continue;
      const backed = outcomes.some(
        (o) =>
          o.pass &&
          o.persona === persona &&
          o.capabilities.includes(capability as JourneyCapability) &&
          byId.get(o.journeyId) !== undefined,
      );
      if (!backed) return false;
    }
  }
  return true;
}
