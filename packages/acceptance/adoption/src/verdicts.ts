/**
 * @fleetos/acceptance-adoption — the adoption verdict rubric.
 *
 * DETERMINISTIC from the REAL runner outcomes + the incumbent baseline.
 * Nothing here re-runs a journey, weakens a threshold, or hides a failure:
 * every input is a REAL execution fact (or its recorded absence), and a
 * single honest failure surfaces in the verdict inputs.
 *
 * RUBRIC (documented thresholds — never tuned to flatter a result):
 *   coverageRatio = industry-applicable journeys PASSED / industry-applicable
 *   journeys TOTAL (masked or unsupported journeys are EXCLUDED from both
 *   numerator and denominator — never counted as covered, never as failed).
 *   A journey is PASSED when it has ≥1 execution and ZERO failing executions.
 *
 *   RETAIN         — coverageRatio < 0.30, OR any CRITICAL journey fails
 *                    honestly (critical = a journey in a CORE incumbent
 *                    capability's replacement family). Fail-closed first.
 *   SWITCH-ONLY    — coverageRatio = 1.00 AND every incumbent capability
 *                    (core AND adjunct) is "replaced" (full replacement).
 *   MAIN-INTERFACE — coverageRatio ≥ 0.70 AND every CORE capability is
 *                    "replaced" (FleetOS becomes the primary interface).
 *   COMPLEMENT     — coverageRatio ≥ 0.30 (runs alongside the incumbent).
 *
 * Capability mapping status:
 *   "replaced" — ≥1 family journey is industry-applicable AND every
 *                applicable family journey PASSED;
 *   "partial"  — ≥1 family journey applicable, but some applicable family
 *                journey FAILED or was never executed (honest gap, listed);
 *   "unmapped" — the family is empty (incumbent moat) or fully masked out
 *                for this industry (out of scope, rationale recorded).
 */

import { applicableCommerceJourneys, applicableFieldJourneys, applicableSecurityJourneys, type IndustryDefinition } from "./industries.js";
import { incumbentCapabilities, type Criticality } from "./incumbent.js";

export const VERDICT_THRESHOLDS = {
  /** Exact coverage required for SWITCH-ONLY (full replacement). */
  switchOnlyCoverage: 1.0,
  /** Minimum coverage for MAIN-INTERFACE. */
  mainInterfaceMinCoverage: 0.7,
  /** Minimum coverage for COMPLEMENT. */
  complementMinCoverage: 0.3,
} as const;

export type Verdict = "SWITCH-ONLY" | "MAIN-INTERFACE" | "COMPLEMENT" | "RETAIN";

export type CorpusName = "field" | "commerce" | "security";

/** ONE REAL runner execution, normalized (never re-computed). */
export interface JourneyExecutionFact {
  readonly corpus: CorpusName;
  readonly journeyId: string;
  /** Epoch index for the parameterizable field runner (0 otherwise). */
  readonly epoch: number;
  readonly passed: boolean;
  /** First honest failure detail from the REAL outcome; null when passed. */
  readonly failureNote: string | null;
  /** The REAL outcome digest, as stamped by the owning runner. */
  readonly digest: string;
}

export interface FailingJourney {
  readonly corpus: CorpusName;
  readonly journeyId: string;
  /** The first failing execution's REAL note (which journey failed and why). */
  readonly reason: string;
}

export interface CoverageResult {
  /** Industry-applicable journeys TOTAL (the honest denominator). */
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly ratio: number;
  readonly failing: readonly FailingJourney[];
}

export type MappingStatus = "replaced" | "partial" | "unmapped";

export interface CapabilityMappingResult {
  readonly capabilityId: string;
  readonly profileId: string;
  readonly criticality: Criticality;
  readonly family: readonly string[];
  /** family ∩ industry-applicable journey ids. */
  readonly applicableFamilyJourneys: readonly string[];
  readonly status: MappingStatus;
  /** Applicable family journeys that FAILED (or were never executed). */
  readonly notPassing: readonly string[];
}

export interface VerdictInput {
  readonly coverage: CoverageResult;
  readonly mappings: readonly CapabilityMappingResult[];
  /** Failing (or never-executed) journeys inside CORE capability families. */
  readonly criticalFailures: readonly string[];
}

export interface VerdictResult {
  readonly industryId: string;
  readonly verdict: Verdict;
  readonly input: VerdictInput;
  /** Deterministic human-facing one-liner (evidence reports). */
  readonly reason: string;
}

function applicableJourneyIds(industry: IndustryDefinition): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const j of applicableFieldJourneys(industry)) ids.add(j.id);
  for (const j of applicableCommerceJourneys(industry)) ids.add(j.id);
  for (const j of applicableSecurityJourneys(industry)) ids.add(j.journeyId);
  return ids;
}

function formatRatio(ratio: number): string {
  return ratio.toFixed(2);
}

/** Coverage over one industry's applicable journeys, from REAL facts. */
export function computeCoverage(industry: IndustryDefinition, facts: readonly JourneyExecutionFact[]): CoverageResult {
  const applicable = applicableJourneyIds(industry);
  const byJourney = new Map<string, JourneyExecutionFact[]>();
  for (const fact of facts) {
    const list = byJourney.get(fact.journeyId) ?? [];
    list.push(fact);
    byJourney.set(fact.journeyId, list);
  }
  let passed = 0;
  const failing: FailingJourney[] = [];
  for (const journeyId of applicable) {
    const executions = byJourney.get(journeyId) ?? [];
    const failures = executions.filter((e) => !e.passed);
    if (executions.length > 0 && failures.length === 0) {
      passed += 1;
    } else if (failures.length > 0) {
      const first = failures[0] as JourneyExecutionFact;
      failing.push({ corpus: first.corpus, journeyId, reason: first.failureNote ?? "failed" });
    }
  }
  const total = applicable.size;
  const ratio = total === 0 ? 0 : passed / total;
  return { total, passed, failed: failing.length, ratio, failing };
}

/** Incumbent-capability mapping for one industry, from REAL facts. */
export function computeCapabilityMappings(
  industry: IndustryDefinition,
  facts: readonly JourneyExecutionFact[],
): readonly CapabilityMappingResult[] {
  const applicable = applicableJourneyIds(industry);
  // Journey status mirrors the coverage law: PASSING = >=1 execution AND
  // zero failing executions (a never-executed journey is NOT passing).
  const executions = new Map<string, readonly JourneyExecutionFact[]>();
  for (const fact of facts) {
    const list = executions.get(fact.journeyId) ?? [];
    executions.set(fact.journeyId, [...list, fact]);
  }
  const isPassing = (journeyId: string): boolean => {
    const list = executions.get(journeyId);
    return list !== undefined && list.length > 0 && list.every((f) => f.passed);
  };
  return incumbentCapabilities(industry.id).map((cap) => {
    const applicableFamilyJourneys = cap.replacementJourneyFamily.filter((id) => applicable.has(id));
    const notPassing = applicableFamilyJourneys.filter((id) => !isPassing(id));
    let status: MappingStatus;
    if (applicableFamilyJourneys.length === 0) {
      status = "unmapped";
    } else if (notPassing.length === 0) {
      status = "replaced";
    } else {
      status = "partial";
    }
    return {
      capabilityId: cap.id,
      profileId: cap.profileId,
      criticality: cap.criticality,
      family: cap.replacementJourneyFamily,
      applicableFamilyJourneys,
      status,
      notPassing,
    };
  });
}

/** The rubric itself — pure, documented, fail-closed (RETAIN checked first). */
export function applyVerdictRubric(
  coverage: CoverageResult,
  mappings: readonly CapabilityMappingResult[],
): { readonly verdict: Verdict; readonly reason: string } {
  const coreCapabilities = mappings.filter((m) => m.criticality === "core");
  const criticalFailures = coreCapabilities.flatMap((m) => m.notPassing);
  const notReplaced = mappings.filter((m) => m.status !== "replaced");
  const coreNotReplaced = notReplaced.filter((m) => m.criticality === "core");

  let verdict: Verdict;
  let reason: string;
  if (coverage.ratio < VERDICT_THRESHOLDS.complementMinCoverage || criticalFailures.length > 0) {
    verdict = "RETAIN";
    reason = criticalFailures.length > 0
      ? `critical journey(s) [${criticalFailures.join(", ")}] failed or were never executed — retain the incumbent`
      : `coverage ${formatRatio(coverage.ratio)} < ${formatRatio(VERDICT_THRESHOLDS.complementMinCoverage)} — retain the incumbent`;
  } else if (
    coverage.ratio === VERDICT_THRESHOLDS.switchOnlyCoverage &&
    notReplaced.length === 0
  ) {
    verdict = "SWITCH-ONLY";
    reason = `coverage ${coverage.passed}/${coverage.total} = ${formatRatio(coverage.ratio)} and every incumbent capability (core+adjunct) mapped to passing journey families — full replacement`;
  } else if (
    coverage.ratio >= VERDICT_THRESHOLDS.mainInterfaceMinCoverage &&
    coreNotReplaced.length === 0
  ) {
    verdict = "MAIN-INTERFACE";
    reason = `coverage ${coverage.passed}/${coverage.total} = ${formatRatio(coverage.ratio)} with all core capabilities mapped; ${notReplaced.length} adjunct capabilit${notReplaced.length === 1 ? "y" : "ies"} unmapped (${notReplaced.map((m) => m.capabilityId).join(", ")}) — FleetOS becomes the primary interface`;
  } else {
    verdict = "COMPLEMENT";
    reason = `coverage ${coverage.passed}/${coverage.total} = ${formatRatio(coverage.ratio)}; core capabilit${coreNotReplaced.length === 1 ? "y" : "ies"} unmapped (${coreNotReplaced.map((m) => m.capabilityId).join(", ")}) — FleetOS runs alongside the incumbent`;
  }
  return { verdict, reason };
}

/** Full verdict computation for one industry from REAL execution facts. */
export function computeVerdict(industry: IndustryDefinition, facts: readonly JourneyExecutionFact[]): VerdictResult {
  const coverage = computeCoverage(industry, facts);
  const mappings = computeCapabilityMappings(industry, facts);
  const coreCapabilities = mappings.filter((m) => m.criticality === "core");
  const criticalFailures = coreCapabilities.flatMap((m) => m.notPassing);
  const input: VerdictInput = { coverage, mappings, criticalFailures };
  const { verdict, reason } = applyVerdictRubric(coverage, mappings);
  return { industryId: industry.id, verdict, input, reason };
}
