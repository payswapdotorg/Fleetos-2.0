/**
 * @fleetos/acceptance-commerce — acceptance report assembly.
 *
 * Aggregates journey outcomes into a deterministic report: per-journey
 * outcomes, pass/fail totals, and the coverage matrix (persona ×
 * capability). ZERO-INFLATION: a cell is only marked covered when at
 * least one PASSING journey claims that capability+persona; a capability
 * with only failing journeys is listed as failing, never covered. The
 * report carries an FNV-1a digest and a verify function that recomputes
 * it (tamper detection).
 */

import {
  type JourneyOutcome,
  type JourneyPersona,
  type JourneyCapability,
  canonicalJson,
  fnv1a32,
} from "./journey-contracts.js";
import { JOURNEY_PERSONAS, JOURNEY_CAPABILITIES } from "./journey-contracts.js";

export interface CoverageCell {
  readonly persona: JourneyPersona;
  readonly capability: JourneyCapability;
  /** Number of PASSING journeys claiming this cell. */
  readonly passing: number;
  /** Number of failing journeys claiming this cell. */
  readonly failing: number;
  readonly covered: boolean;
}

export interface JourneyReport {
  readonly kind: "acceptance-report";
  readonly totals: {
    readonly journeyCount: number;
    readonly passed: number;
    readonly failed: number;
    readonly assertionCount: number;
    readonly failedAssertions: number;
  };
  readonly coverage: readonly CoverageCell[];
  readonly outcomes: readonly JourneyOutcome[];
  readonly digest: string;
}

export type ReportDigestInput = Omit<JourneyReport, "digest">;

export function computeReportDigest(report: ReportDigestInput): string {
  return `report_${fnv1a32([
    report.kind,
    report.totals.journeyCount,
    report.totals.passed,
    report.totals.failed,
    report.totals.assertionCount,
    report.totals.failedAssertions,
    report.coverage.map((c) => `${c.persona}>${c.capability}:${c.passing}/${c.failing}:${c.covered}`),
    report.outcomes.map((o) => `${o.journeyId}:${o.passed}:${o.digest}`),
  ])}`;
}

export function verifyJourneyReport(report: JourneyReport): boolean {
  const { digest, ...rest } = report;
  return computeReportDigest(rest) === digest;
}

/** Assemble the report from outcomes (deterministic; input order kept). */
export function assembleJourneyReport(outcomes: readonly JourneyOutcome[]): JourneyReport {
  const cells = new Map<string, CoverageCell>();
  for (const persona of JOURNEY_PERSONAS) {
    for (const capability of JOURNEY_CAPABILITIES) {
      const key = `${persona}>${capability}`;
      cells.set(key, { persona, capability, passing: 0, failing: 0, covered: false });
    }
  }
  for (const outcome of outcomes) {
    const key = `${outcome.persona}>${outcome.capability}`;
    const cell = cells.get(key);
    if (cell === undefined) continue;
    if (outcome.passed) {
      cells.set(key, { ...cell, passing: cell.passing + 1, covered: true });
    } else {
      cells.set(key, { ...cell, failing: cell.failing + 1 });
    }
  }
  const coverage = [...cells.values()];
  const base: ReportDigestInput = {
    kind: "acceptance-report",
    totals: {
      journeyCount: outcomes.length,
      passed: outcomes.filter((o) => o.passed).length,
      failed: outcomes.filter((o) => !o.passed).length,
      assertionCount: outcomes.reduce((sum, o) => sum + o.assertionOutcomes.length, 0),
      failedAssertions: outcomes.reduce(
        (sum, o) => sum + o.assertionOutcomes.filter((a) => !a.ok).length,
        0,
      ),
    },
    coverage,
    outcomes,
  };
  return { ...base, digest: computeReportDigest(base) };
}

/** Stable JSON rendering (deterministic; used by evidence + tests). */
export function renderReportJson(report: JourneyReport): string {
  return canonicalJson(report);
}
