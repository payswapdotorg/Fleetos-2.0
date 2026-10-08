/**
 * @fleetos/acceptance-field — acceptance report assembly.
 *
 * Runs the journey corpus (deterministic, handoff-threaded) and assembles
 * the aggregate acceptance report: per-journey outcomes, pass/fail counts,
 * and the persona × capability coverage matrix with HONEST ZERO-INFLATION —
 * a capability (or persona) is only marked covered when at least one
 * PASSING journey claims it. A capability whose journeys all fail shows
 * `covered: false`, never a claimed pass.
 *
 * Pure deterministic TS; digest + verify over the whole report.
 */

import { digestOf } from "./determinism.js";
import type { AcceptanceJourney, Capability, JourneyOutcome, Persona } from "./journey-contracts.js";
import { CAPABILITIES, PERSONAS } from "./journey-contracts.js";
import { runJourneyCorpus } from "./runner.js";

export interface AcceptanceAggregate {
  readonly journeys: number;
  readonly passed: number;
  readonly failed: number;
  readonly steps: number;
  readonly failedSteps: number;
  readonly assertions: number;
  readonly passedAssertions: number;
  readonly failedAssertions: number;
}

export interface CoverageCell {
  readonly persona: Persona;
  readonly capability: Capability;
  readonly journeys: number;
  readonly passing: number;
  /** True ONLY when at least one PASSING journey claims this cell. */
  readonly covered: boolean;
}

export interface AcceptanceReport {
  readonly schemaVersion: 1;
  readonly tenantId: string;
  readonly generatedAt: number;
  readonly outcomes: readonly JourneyOutcome[];
  readonly aggregate: AcceptanceAggregate;
  readonly coverage: readonly CoverageCell[];
  /** Capabilities covered by at least one passing journey (zero-inflated: a
   * capability with no passing journey is ABSENT from this list). */
  readonly coveredCapabilities: readonly Capability[];
  readonly digest: string;
}

export interface AssembleReportOptions {
  readonly tenantId?: string;
  readonly startedAt?: number;
}

function reportDigestOf(report: Omit<AcceptanceReport, "digest">): string {
  return digestOf("acceptance-report", report as unknown as object);
}

/** Recompute the report's digest; false means tampered content. */
export function verifyAcceptanceReport(report: AcceptanceReport): boolean {
  const { digest, ...rest } = report;
  return reportDigestOf(rest) === digest;
}

export function assembleAcceptanceReport(
  journeys: readonly AcceptanceJourney[],
  options: AssembleReportOptions = {},
): AcceptanceReport {
  const outcomes = runJourneyCorpus(journeys, options);
  const aggregate: AcceptanceAggregate = {
    journeys: outcomes.length,
    passed: outcomes.filter((o) => o.passed).length,
    failed: outcomes.filter((o) => !o.passed).length,
    steps: outcomes.reduce((acc, o) => acc + o.steps.length, 0),
    failedSteps: outcomes.reduce((acc, o) => acc + o.steps.filter((s) => !s.ok).length, 0),
    assertions: outcomes.reduce((acc, o) => acc + o.assertions.length, 0),
    passedAssertions: outcomes.reduce((acc, o) => acc + o.assertions.filter((a) => a.pass).length, 0),
    failedAssertions: outcomes.reduce((acc, o) => acc + o.assertions.filter((a) => !a.pass).length, 0),
  };

  const coverage: CoverageCell[] = [];
  for (const persona of PERSONAS) {
    for (const capability of CAPABILITIES) {
      const cellOutcomes = outcomes.filter((o) => o.persona === persona && o.capability === capability);
      const passing = cellOutcomes.filter((o) => o.passed).length;
      coverage.push({
        persona,
        capability,
        journeys: cellOutcomes.length,
        passing,
        covered: passing > 0,
      });
    }
  }

  const coveredCapabilities = CAPABILITIES.filter((capability) =>
    outcomes.some((o) => o.capability === capability && o.passed),
  );

  const base: Omit<AcceptanceReport, "digest"> = {
    schemaVersion: 1,
    tenantId: options.tenantId ?? "tnt_field-accept-01",
    generatedAt: options.startedAt ?? 1_774_000_000_000,
    outcomes,
    aggregate,
    coverage,
    coveredCapabilities,
  };
  return { ...base, digest: reportDigestOf(base) };
}

/** Human-facing one-line summary per journey (for evidence reports). */
export function summarizeOutcome(outcome: JourneyOutcome): string {
  const failedSteps = outcome.steps.filter((s) => !s.ok).map((s) => s.id);
  const failedAssertions = outcome.assertions.filter((a) => !a.pass).map((a) => a.id);
  return `${outcome.passed ? "PASS" : "FAIL"} ${outcome.journeyId} [${outcome.persona}/${outcome.capability}] ` +
    `steps=${outcome.steps.length}${failedSteps.length > 0 ? ` failedSteps=[${failedSteps.join(",")}]` : ""} ` +
    `assertions=${outcome.assertions.length}${failedAssertions.length > 0 ? ` failedAssertions=[${failedAssertions.join(",")}]` : ""}`;
}
