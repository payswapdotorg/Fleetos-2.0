/**
 * @fleetos/simulation — benchmark report assembly (Wave 6, F260B).
 *
 * Assembles a benchmark REPORT from a set's per-case results: per-case
 * digested entries, the full scoring (aggregate + fixed weights), the full
 * safety report, and deterministic provenance. Cross-run comparisons EXTEND
 * the existing `buildComparison` convention (the Wave-0 kernel export is
 * reused for the comparisonId derivation).
 *
 * LAW (A11): a benchmark report is EVALUATION EVIDENCE ONLY — `kind:
 * "BENCHMARK_REPORT"` + machine-carried `experimental: true` on the report,
 * every comparison, and every nested artifact. It is never operational truth
 * and never self-adopts (no submit/adopt/execute exists — see
 * adoption.ts's Guardian path).
 *
 * Deterministic: no clock, no randomness, no I/O; byte-identical for identical
 * inputs; digests verify and detect tampering.
 */

import { buildComparison } from "./index.ts";
import type { TenantScopeLike } from "./index.ts";
import { BENCHMARK_ADVISORY_NOTE, canonicalJson, fnv1a } from "./benchmark-definition.ts";
import type { BenchmarkSet } from "./benchmark-definition.ts";
import type { ReplayRun } from "./replay-harness.ts";
import type { BenchmarkScoring } from "./scoring.ts";
import type { SafetyReport } from "./safety-benchmarks.ts";

export type BenchmarkMetric = "aggregate-bps" | "hit-rate-bps" | "calibration-score-bps";

export const BENCHMARK_METRICS: readonly BenchmarkMetric[] = [
  "aggregate-bps", "hit-rate-bps", "calibration-score-bps",
];

export interface BenchmarkReportCaseEntry {
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

export interface BenchmarkReport {
  readonly kind: "BENCHMARK_REPORT";
  readonly experimental: true;
  readonly advisoryNote: typeof BENCHMARK_ADVISORY_NOTE;
  readonly runId: string;
  readonly tenant: TenantScopeLike;
  readonly nowMs: number;
  readonly computedAt: string;
  readonly setDigest: string;
  readonly caseCount: number;
  readonly modelVersions: readonly string[];
  readonly journalHeadDigests: readonly { readonly caseId: string; readonly headDigest: string }[];
  readonly perCase: readonly BenchmarkReportCaseEntry[]; // caseId asc
  readonly scoring: BenchmarkScoring;
  readonly safety: SafetyReport;
  readonly reportDigest: string;
}

export type ReportRejection =
  | "missing-tenant"
  | "tenant-mismatch"
  | "empty-set"
  | "invalid-now"
  | "now-before-scoring"
  | "invalid-computed-at"
  | "replay-mismatch"
  | "scoring-mismatch"
  | "safety-mismatch";

export type BenchmarkReportResult =
  | { readonly ok: true; readonly report: BenchmarkReport }
  | { readonly ok: false; readonly rejected: ReportRejection; readonly detail: string };

/** Assemble the benchmark report — tenant/now fail-closed, deterministic order. */
export function assembleBenchmarkReport(input: {
  readonly runId: string;
  readonly tenant: TenantScopeLike;
  readonly nowMs: number;
  readonly computedAt: string;
  readonly set: BenchmarkSet;
  readonly replays: readonly ReplayRun[];
  readonly scoring: BenchmarkScoring;
  readonly safety: SafetyReport;
}): BenchmarkReportResult {
  const tenantId = input.tenant.tenantId;
  if (tenantId === "") return reportFail("missing-tenant", "tenant identifier is empty");
  if (input.runId === "") return reportFail("scoring-mismatch", "runId is empty");
  if (input.computedAt === "") return reportFail("invalid-computed-at", "computedAt is empty");
  if (input.set.cases.length === 0) return reportFail("empty-set", "benchmark set is empty");
  if (input.set.tenant.tenantId !== tenantId || input.scoring.tenant.tenantId !== tenantId || input.safety.tenant.tenantId !== tenantId) {
    return reportFail("tenant-mismatch", "set/scoring/safety tenant does not match the report tenant");
  }
  if (!Number.isInteger(input.nowMs)) return reportFail("invalid-now", "nowMs must be an integer (logical milliseconds)");
  if (input.nowMs < input.scoring.nowMs) {
    return reportFail("now-before-scoring", `nowMs ${input.nowMs} precedes scoring time ${input.scoring.nowMs}`);
  }
  if (input.replays.length !== input.set.cases.length) {
    return reportFail("replay-mismatch", `expected ${input.set.cases.length} replays, got ${input.replays.length}`);
  }
  for (const r of input.replays) {
    if (r.tenant.tenantId !== tenantId) return reportFail("tenant-mismatch", `replay ${r.runId} is not tenant ${tenantId}`);
    const c = input.set.cases.find(
      (x) => x.entityId === r.entityId && x.invocation.metric === r.metric &&
        x.journal[x.journal.length - 1]?.digest === r.journalHeadDigest,
    );
    if (!c) return reportFail("replay-mismatch", `replay ${r.runId} does not match any set case`);
  }
  const setIds = input.set.cases.map((c) => c.caseId).sort();
  const scoringIds = input.scoring.perCase.map((s) => s.caseId).sort();
  if (input.scoring.caseCount !== input.set.cases.length || setIds.join(",") !== scoringIds.join(",")) {
    return reportFail("scoring-mismatch", "scoring does not cover exactly the set's cases");
  }
  const envelopeCheck = input.safety.checks[0];
  if (!envelopeCheck || envelopeCheck.checkId !== "advisory-envelope") {
    return reportFail("safety-mismatch", "safety report's first check is not advisory-envelope");
  }
  const perCase: BenchmarkReportCaseEntry[] = input.set.cases
    .map((c) => {
      const replay = input.replays.find((r) => r.entityId === c.entityId && r.metric === c.invocation.metric && r.journalHeadDigest === c.journal[c.journal.length - 1]?.digest);
      const score = input.scoring.perCase.find((s) => s.caseId === c.caseId);
      if (!replay || !score) return null;
      return {
        caseId: c.caseId,
        caseDigest: c.caseDigest,
        replayRunId: replay.runId,
        replayDigest: replay.replayDigest,
        scoreDigest: score.scoreDigest,
        matchedPairs: score.matchedPairs,
        hitRateBps: score.hitRateBps,
        aggregateBps: score.aggregateBps,
        envelopeViolationCount: envelopeCheck.violations.filter((v) => v.caseId === c.caseId).length,
      };
    })
    .filter((e): e is BenchmarkReportCaseEntry => e !== null)
    .sort((a, b) => (a.caseId < b.caseId ? -1 : a.caseId > b.caseId ? 1 : 0));
  if (perCase.length !== input.set.cases.length) {
    return reportFail("replay-mismatch", "not every set case has a matching replay + score");
  }
  const base = {
    kind: "BENCHMARK_REPORT" as const,
    experimental: true as const,
    advisoryNote: BENCHMARK_ADVISORY_NOTE,
    runId: input.runId,
    tenant: { tenantId },
    nowMs: input.nowMs,
    computedAt: input.computedAt,
    setDigest: input.set.setDigest,
    caseCount: input.set.cases.length,
    modelVersions: input.set.modelVersions,
    journalHeadDigests: input.set.cases.map((c) => ({
      caseId: c.caseId,
      headDigest: c.journal[c.journal.length - 1]?.digest ?? "",
    })).sort((a, b) => (a.caseId < b.caseId ? -1 : a.caseId > b.caseId ? 1 : 0)),
    perCase,
    scoring: input.scoring,
    safety: input.safety,
  };
  return { ok: true, report: { ...base, reportDigest: fnv1a(`bench-report|v1|${canonicalJson(base)}`) } };
}

// ---------------------------------------------------------------------------
// Verification — every boolean named; NO silent passes
// ---------------------------------------------------------------------------

export interface ReportVerification {
  readonly ok: boolean;
  readonly checks: {
    readonly reportDigest: boolean;
    readonly safetyDigest: boolean;
    readonly scoringDigest: boolean;
    readonly totalsConsistent: boolean;
    readonly setDigest: boolean | null;
    readonly replayDigests: boolean | null;
  };
}

/** Verify a report — recomputes digests; optionally verifies the set + replays. */
export function verifyBenchmarkReport(
  report: BenchmarkReport,
  evidence?: { readonly set?: BenchmarkSet; readonly replays?: readonly ReplayRun[] },
): ReportVerification {
  const { reportDigest, ...content } = report;
  const checks = {
    reportDigest: fnv1a(`bench-report|v1|${canonicalJson(content)}`) === reportDigest,
    safetyDigest: verifySafetyDigest(report.safety),
    scoringDigest: scoringDigestOf(report.scoring) === report.scoring.scoringDigest,
    totalsConsistent:
      report.caseCount === report.perCase.length &&
      report.scoring.aggregate.totalPairs === report.perCase.reduce((a, c) => a + c.matchedPairs, 0) &&
      report.scoring.perCase.length === report.perCase.length,
    setDigest: evidence?.set ? evidence.set.setDigest === report.setDigest : null,
    replayDigests: evidence?.replays
      ? evidence.replays.every((r) => replayDigestOf(r) === r.replayDigest) &&
        report.perCase.every((entry) => {
          const r = evidence.replays?.find((x) => x.runId === entry.replayRunId);
          return r !== undefined && r.replayDigest === entry.replayDigest;
        })
      : null,
  };
  const hardChecks = [checks.reportDigest, checks.safetyDigest, checks.scoringDigest, checks.totalsConsistent];
  if (checks.setDigest !== null) hardChecks.push(checks.setDigest);
  if (checks.replayDigests !== null) hardChecks.push(checks.replayDigests);
  return { ok: hardChecks.every(Boolean), checks };
}

function verifySafetyDigest(safety: SafetyReport): boolean {
  const { safetyDigest, ...content } = safety;
  return fnv1a(`safety-report|v1|${canonicalJson(content)}`) === safetyDigest;
}

function scoringDigestOf(scoring: BenchmarkScoring): string {
  const { scoringDigest: _omit, ...content } = scoring;
  return fnv1a(`bench-scoring|v1|${canonicalJson(content)}`);
}

function replayDigestOf(run: ReplayRun): string {
  const { replayDigest: _omit, ...content } = run;
  return fnv1a(`replay|v1|${canonicalJson(content)}`);
}

// ---------------------------------------------------------------------------
// Cross-run comparison — EXTENDS the existing buildComparison convention
// ---------------------------------------------------------------------------

export interface BenchmarkRunComparison {
  readonly kind: "BENCHMARK_COMPARISON";
  readonly experimental: true;
  readonly advisoryNote: typeof BENCHMARK_ADVISORY_NOTE;
  readonly comparisonId: string; // derived via the REAL buildComparison
  readonly metric: BenchmarkMetric;
  readonly computedAt: string;
  readonly tenantId: string;
  readonly entries: readonly { readonly runId: string; readonly value: number }[]; // runId asc
  readonly ranking: readonly { readonly rank: number; readonly runId: string; readonly value: number }[];
  readonly bestRunId: string;
  readonly digest: string;
}

export type ComparisonRejection = "missing-tenant" | "empty-reports" | "tenant-mismatch" | "duplicate-run-id" | "invalid-computed-at";

export type BenchmarkComparisonResult =
  | { readonly ok: true; readonly comparison: BenchmarkRunComparison }
  | { readonly ok: false; readonly rejected: ComparisonRejection; readonly detail: string };

/** Compare multiple benchmark runs on one metric — deterministic ranking. */
export function compareBenchmarkRuns(
  reports: readonly BenchmarkReport[],
  metric: BenchmarkMetric,
  computedAt: string,
): BenchmarkComparisonResult {
  if (reports.length === 0) return comparisonFail("empty-reports", "no reports to compare");
  if (computedAt === "") return comparisonFail("invalid-computed-at", "computedAt is empty");
  const tenantId = reports[0]?.tenant.tenantId ?? "";
  if (tenantId === "") return comparisonFail("missing-tenant", "report tenant identifier is empty");
  const ids = new Set<string>();
  for (const r of reports) {
    if (r.tenant.tenantId !== tenantId) {
      return comparisonFail("tenant-mismatch", `report ${r.runId} is not tenant ${tenantId}`);
    }
    if (ids.has(r.runId)) return comparisonFail("duplicate-run-id", `duplicate runId ${r.runId}`);
    ids.add(r.runId);
  }
  const entries = reports
    .map((r) => ({ runId: r.runId, value: metricValue(r, metric) }))
    .sort((a, b) => (a.runId < b.runId ? -1 : a.runId > b.runId ? 1 : 0));
  const ranking = [...entries]
    .sort((a, b) => b.value - a.value || (a.runId < b.runId ? -1 : 1))
    .map((e, i) => ({ rank: i + 1, runId: e.runId, value: e.value }));
  const base = {
    kind: "BENCHMARK_COMPARISON" as const,
    experimental: true as const,
    advisoryNote: BENCHMARK_ADVISORY_NOTE,
    comparisonId: buildComparison(reports.map((r) => r.runId), metric, computedAt).comparisonId,
    metric,
    computedAt,
    tenantId,
    entries,
    ranking,
    bestRunId: (ranking[0] as { runId: string }).runId,
  };
  return { ok: true, comparison: { ...base, digest: fnv1a(`bench-comparison|v1|${canonicalJson(base)}`) } };
}

function metricValue(report: BenchmarkReport, metric: BenchmarkMetric): number {
  const agg = report.scoring.aggregate;
  if (metric === "hit-rate-bps") return agg.hitRateBps;
  if (metric === "calibration-score-bps") return agg.calibrationScoreBps;
  return agg.aggregateBps;
}

// ---------------------------------------------------------------------------
// Runtime guards — markers must survive transit
// ---------------------------------------------------------------------------

export function isBenchmarkReport(v: unknown): v is BenchmarkReport {
  if (typeof v !== "object" || v === null) return false;
  const r = v as { kind?: unknown; experimental?: unknown; reportDigest?: unknown; perCase?: unknown };
  return r.kind === "BENCHMARK_REPORT" && r.experimental === true && typeof r.reportDigest === "string" && Array.isArray(r.perCase);
}

export function isBenchmarkComparison(v: unknown): v is BenchmarkRunComparison {
  if (typeof v !== "object" || v === null) return false;
  const r = v as { kind?: unknown; experimental?: unknown; digest?: unknown; ranking?: unknown };
  return r.kind === "BENCHMARK_COMPARISON" && r.experimental === true && typeof r.digest === "string" && Array.isArray(r.ranking);
}

function reportFail(rejected: ReportRejection, detail: string): BenchmarkReportResult {
  return { ok: false, rejected, detail };
}

function comparisonFail(rejected: ComparisonRejection, detail: string): BenchmarkComparisonResult {
  return { ok: false, rejected, detail };
}
