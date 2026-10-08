/**
 * @fleetos/experience-engineering-lab — benchmark scorecard read-models
 * (F261 deliverable 3).
 *
 * `buildBenchmarkScorecard` presents one benchmark report as a scorecard:
 * the per-case results table, the aggregate scores (calibration bands,
 * staleness classes), the four-check safety battery section with envelope
 * violations surfaced PROMINENTLY at the top level, and the report's own
 * advisory note — every number presented VERBATIM from the REAL lane
 * report (never recomputed here).
 *
 * `buildBenchmarkComparisonView` presents a cross-run comparison over the
 * slice's reports by running the lane's REAL `compareBenchmarkRuns` (the
 * comparison convention this view EXTENDS) and presenting its ranking
 * verbatim.
 *
 * LAW (A2/A11, structural): scorecards carry `kind: "BENCHMARK_REPORT"`,
 * `experimental: true` and the lane's own `advisoryNote` — advisory-only
 * markers that cannot be stripped without breaking the view type. Views
 * only render GUARDED state (the guard's refusal code surfaces verbatim).
 * Deterministic: byte-identical for identical inputs.
 */

import {
  compareBenchmarkRuns,
  type BenchmarkMetric,
  type BenchmarkReport,
  type SafetyCheck,
} from "@fleetos/simulation";
import { ADVISORY_MARKER, LAB_SCHEMA_VERSION, cmpString, labDigestOf } from "./lab-core.js";
import { guardLabState, type LabStateSlice } from "./lab-state.js";

export type BenchmarkViewRefusal =
  | "lab-state-refused"
  | "invalid-now"
  | "unknown-report"
  | "invalid-metric"
  | "invalid-computed-at";

export type BenchmarkViewResult<V> =
  | { readonly ok: true; readonly view: V }
  | {
      readonly ok: false;
      readonly refused: BenchmarkViewRefusal;
      readonly detail: string;
      /** The guard's own code when the slice itself refused (verbatim). */
      readonly guardCode?: string;
    };

function refuse(refused: BenchmarkViewRefusal, detail: string, guardCode?: string): BenchmarkViewResult<never> {
  return guardCode === undefined
    ? { ok: false, refused, detail }
    : { ok: false, refused, detail, guardCode };
}

// ---------------------------------------------------------------------------
// The scorecard
// ---------------------------------------------------------------------------

/** One row of the per-case results table (fields verbatim from the report). */
export interface ScorecardCaseRow {
  readonly caseId: string;
  readonly caseDigest: string;
  readonly replayRunId: string;
  readonly replayDigest: string;
  readonly scoreDigest: string;
  readonly matchedPairs: number;
  readonly hitRateBps: number;
  readonly aggregateBps: number;
  readonly envelopeViolationCount: number;
}

/** The four-check safety battery section (fixed order, per-check metrics). */
export interface ScorecardSafetySection {
  readonly passed: boolean;
  readonly violationCount: number;
  readonly checks: readonly {
    readonly checkId: string;
    readonly passed: boolean;
    readonly metrics: Readonly<Record<string, number>>;
  }[];
}

export interface BenchmarkScorecardView {
  readonly schemaVersion: number;
  readonly tenantId: string;
  readonly asOf: number;
  /** VERBATIM from the REAL report — the evidence kind tag. */
  readonly kind: "BENCHMARK_REPORT";
  readonly experimental: true;
  readonly advisory: true;
  readonly evidenceKind: typeof ADVISORY_MARKER;
  /** The lane's own advisory note, carried verbatim. */
  readonly advisoryNote: string;
  readonly reportId: string;
  readonly setDigest: string;
  readonly caseCount: number;
  readonly modelVersions: readonly string[];
  readonly perCase: readonly ScorecardCaseRow[];
  /** The aggregate scores VERBATIM (calibration bands, staleness classes). */
  readonly aggregate: BenchmarkReport["scoring"]["aggregate"];
  readonly safety: ScorecardSafetySection;
  /** Envelope violations surfaced PROMINENTLY (top level, not buried). */
  readonly envelopeViolations: readonly {
    readonly caseId: string;
    readonly seq: number;
    readonly step: number;
    readonly violation: string;
    readonly value: number;
    readonly limit: number;
  }[];
  readonly digest: string;
}

function safetySection(safety: BenchmarkReport["safety"]): ScorecardSafetySection {
  const checks = safety.checks.map((check: SafetyCheck) => ({
    checkId: check.checkId,
    passed: check.passed,
    metrics: safetyCheckMetrics(check),
  }));
  return {
    passed: safety.passed,
    violationCount: safety.violationCount,
    // Fixed lane order is preserved by construction (checks is never re-sorted).
    checks,
  };
}

function safetyCheckMetrics(check: SafetyCheck): Record<string, number> {
  switch (check.checkId) {
    case "advisory-envelope":
      return { checkedPoints: check.checkedPoints, violationCount: check.violationCount };
    case "counterfactual-margin":
      return {
        checkedCases: check.checkedCases,
        rejections: check.rejections.length,
        outOfBudgetCases: check.outOfBudgetCases.length,
      };
    case "cannot-write-state":
      return {
        emittedCount: check.emittedCount,
        stateAuthoritativeCount: check.stateAuthoritativeCount,
        advisoryMarkerCount: check.advisoryMarkerCount,
      };
    case "redaction-integrity":
      return { cases: check.cases.length };
    default:
      return {};
  }
}

/** Present one benchmark report as a scorecard (READ-ONLY, verbatim numbers). */
export function buildBenchmarkScorecard(
  slice: LabStateSlice,
  options: { readonly reportId: string; readonly now: number },
): BenchmarkViewResult<BenchmarkScorecardView> {
  const guarded = guardLabState(slice);
  if (!guarded.ok) {
    return refuse("lab-state-refused", `lab state refused: ${guarded.detail}`, guarded.refused);
  }
  if (!Number.isInteger(options.now) || options.now <= 0) {
    return refuse("invalid-now", `logical now must be a positive integer, got ${String(options.now)}`);
  }
  const s = guarded.slice;
  const bench = s.benchmarks.find((b) => b.report.runId === options.reportId);
  if (!bench) return refuse("unknown-report", `unknown benchmark report ${options.reportId}`);
  const report = bench.report;
  const view: BenchmarkScorecardView = {
    schemaVersion: LAB_SCHEMA_VERSION,
    tenantId: s.tenantId,
    asOf: options.now,
    kind: report.kind,
    experimental: true,
    advisory: true,
    evidenceKind: ADVISORY_MARKER,
    advisoryNote: report.advisoryNote,
    reportId: report.runId,
    setDigest: report.setDigest,
    caseCount: report.caseCount,
    modelVersions: report.modelVersions,
    perCase: report.perCase.map((entry) => ({ ...entry })),
    aggregate: report.scoring.aggregate,
    safety: safetySection(report.safety),
    envelopeViolations: report.safety.checks
      .flatMap((check) => (check.checkId === "advisory-envelope" ? [...check.violations] : []))
      .map((v) => ({ ...v })),
    digest: "",
  };
  return { ok: true, view: { ...view, digest: labDigestOf("benchmark-scorecard", omitDigest(view)) } };
}

// ---------------------------------------------------------------------------
// The cross-run comparison view — extends the lane's comparison convention
// ---------------------------------------------------------------------------

export interface BenchmarkComparisonView {
  readonly schemaVersion: number;
  readonly tenantId: string;
  readonly asOf: number;
  readonly kind: "BENCHMARK_COMPARISON";
  readonly experimental: true;
  readonly advisory: true;
  readonly evidenceKind: typeof ADVISORY_MARKER;
  readonly advisoryNote: string;
  readonly metric: BenchmarkMetric;
  readonly comparisonId: string;
  readonly computedAt: string;
  readonly entries: readonly { readonly runId: string; readonly value: number }[];
  readonly ranking: readonly { readonly rank: number; readonly runId: string; readonly value: number }[];
  readonly bestRunId: string;
  readonly digest: string;
}

/**
 * Compare the slice's benchmark reports on one metric. The ranking comes
 * from the lane's REAL `compareBenchmarkRuns` — presented verbatim, never
 * re-derived here.
 */
export function buildBenchmarkComparisonView(
  slice: LabStateSlice,
  options: { readonly metric: BenchmarkMetric; readonly computedAt: string; readonly now: number },
): BenchmarkViewResult<BenchmarkComparisonView> {
  const guarded = guardLabState(slice);
  if (!guarded.ok) {
    return refuse("lab-state-refused", `lab state refused: ${guarded.detail}`, guarded.refused);
  }
  if (!Number.isInteger(options.now) || options.now <= 0) {
    return refuse("invalid-now", `logical now must be a positive integer, got ${String(options.now)}`);
  }
  const s = guarded.slice;
  if (options.computedAt === "") {
    return refuse("invalid-computed-at", "computedAt is required");
  }
  const reports = [...s.benchmarks].map((b) => b.report).sort((a, b) => cmpString(a.runId, b.runId));
  const comparison = compareBenchmarkRuns(reports, options.metric, options.computedAt);
  if (!comparison.ok) {
    return refuse("invalid-metric", `comparison refused: ${comparison.rejected} (${comparison.detail})`);
  }
  const c = comparison.comparison;
  const view: BenchmarkComparisonView = {
    schemaVersion: LAB_SCHEMA_VERSION,
    tenantId: s.tenantId,
    asOf: options.now,
    kind: c.kind,
    experimental: true,
    advisory: true,
    evidenceKind: ADVISORY_MARKER,
    advisoryNote: c.advisoryNote,
    metric: c.metric,
    comparisonId: c.comparisonId,
    computedAt: c.computedAt,
    entries: c.entries.map((e) => ({ ...e })),
    ranking: c.ranking.map((r) => ({ ...r })),
    bestRunId: c.bestRunId,
    digest: "",
  };
  return { ok: true, view: { ...view, digest: labDigestOf("benchmark-comparison", omitDigest(view)) } };
}

/** Recompute a benchmark-view digest; false means tampered view content. */
export function verifyBenchmarkViewDigest(
  view: BenchmarkScorecardView | BenchmarkComparisonView,
): boolean {
  const kind = "perCase" in view ? "benchmark-scorecard" : "benchmark-comparison";
  const { digest: _omit, ...rest } = view as unknown as Record<string, unknown> & { digest: string };
  return labDigestOf(kind, rest) === view.digest;
}

function omitDigest(view: object): unknown {
  const { digest: _omit, ...rest } = view as Record<string, unknown>;
  return rest;
}
