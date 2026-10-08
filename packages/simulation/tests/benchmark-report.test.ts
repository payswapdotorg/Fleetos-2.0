/**
 * F260B — benchmark-report tests: report assembly over the full REAL pipeline
 * (define → set → replay → score → safety), per-case entries, digests + tamper
 * detection, cross-run comparisons (buildComparison convention), runtime
 * guards, tenant/now fail-closed, honest carry of a FAILING safety report.
 */
import { describe, it, expect } from "vitest";
import {
  BENCHMARK_METRICS,
  assembleBenchmarkReport,
  compareBenchmarkRuns,
  isBenchmarkComparison,
  isBenchmarkReport,
  verifyBenchmarkReport,
} from "../src/benchmark-report.ts";
import type { BenchmarkReport, BenchmarkReportCaseEntry } from "../src/benchmark-report.ts";
import { assembleBenchmarkSet } from "../src/benchmark-definition.ts";
import type { BenchmarkSet } from "../src/benchmark-definition.ts";
import { replayJournal } from "../src/replay-harness.ts";
import { scoreBenchmarkSet } from "../src/scoring.ts";
import { runSafetyBattery } from "../src/safety-benchmarks.ts";
import {
  COMPUTED_AT,
  NOW_MS,
  OTHER_TENANT,
  TENANT,
  THRESHOLDS,
  shortCase,
  standardCase,
  steepCase,
} from "./benchmark-fixtures.ts";
import type { BenchmarkCase } from "../src/benchmark-definition.ts";

function replayOf(c: BenchmarkCase) {
  const res = replayJournal({ tenant: TENANT, entityId: c.entityId, journal: c.journal, invocation: c.invocation });
  if (!res.ok) throw new Error(`replay failed: ${res.rejected} ${res.detail}`);
  return res.run;
}

/** Full REAL pipeline: define → set → replay → score → safety. */
function buildPipeline(cases: readonly BenchmarkCase[], runId = "bench-run-1") {
  const setRes = assembleBenchmarkSet({ tenant: TENANT, cases, assembledAtMs: 1000 });
  if (!setRes.ok) throw new Error(setRes.detail);
  const set = setRes.set;
  const members = set.cases.map((c) => ({ benchmarkCase: c, replay: replayOf(c) }));
  const scoringRes = scoreBenchmarkSet({ tenant: TENANT, nowMs: NOW_MS, thresholds: THRESHOLDS, members });
  if (!scoringRes.ok) throw new Error(scoringRes.detail);
  const safetyRes = runSafetyBattery({ tenant: TENANT, members, computedAt: COMPUTED_AT });
  if (!safetyRes.ok) throw new Error(safetyRes.detail);
  const replays = members.map((m) => m.replay);
  const reportRes = assembleBenchmarkReport({
    runId, tenant: TENANT, nowMs: NOW_MS, computedAt: COMPUTED_AT,
    set, replays, scoring: scoringRes.scoring, safety: safetyRes.report,
  });
  if (!reportRes.ok) throw new Error(reportRes.detail);
  return { set, replays, members, scoring: scoringRes.scoring, safety: safetyRes.report, report: reportRes.report };
}

describe("assembleBenchmarkReport: full pipeline assembly", () => {
  it("assembles per-case entries + aggregate scoring + safety with digests", () => {
    const { report } = buildPipeline([standardCase()]);
    expect(report.kind).toBe("BENCHMARK_REPORT");
    expect(report.experimental).toBe(true);
    expect(report.advisoryNote).toContain("NEVER OPERATIONAL TRUTH");
    expect(report.runId).toBe("bench-run-1");
    expect(report.caseCount).toBe(1);
    expect(report.perCase.map((c) => c.caseId)).toEqual(["case-standard"]);
    expect(report.modelVersions).toEqual([standardCase().invocation.modelVersion]);
    expect(report.journalHeadDigests.map((h) => h.caseId)).toEqual(["case-standard"]);
    expect(report.setDigest).toMatch(/^[0-9a-f]{8}$/);
    expect(report.reportDigest).toMatch(/^[0-9a-f]{8}$/);
    const standard = report.perCase[0] as BenchmarkReportCaseEntry;
    expect(standard.matchedPairs).toBe(4);
    expect(standard.hitRateBps).toBe(5000);
    expect(standard.aggregateBps).toBe(6093);
    expect(standard.envelopeViolationCount).toBe(0);
    expect(report.scoring.aggregate.totalPairs).toBe(4);
    expect(report.safety.passed).toBe(true);
  });

  it("is byte-identical for identical inputs; replay input order never leaks", () => {
    const a = buildPipeline([standardCase(), shortCase()]);
    const b = buildPipeline([shortCase(), standardCase()]);
    expect(JSON.stringify(a.report)).toBe(JSON.stringify(b.report));
    const reversedReplays = assembleBenchmarkReport({
      runId: "bench-run-1", tenant: TENANT, nowMs: NOW_MS, computedAt: COMPUTED_AT,
      set: a.set, replays: [...a.replays].reverse(), scoring: a.scoring, safety: a.safety,
    });
    expect(reversedReplays.ok).toBe(true);
    if (reversedReplays.ok) expect(JSON.stringify(reversedReplays.report)).toBe(JSON.stringify(a.report));
  });

  it("carries a FAILING safety report honestly (no silent drops)", () => {
    const { report } = buildPipeline([standardCase(), steepCase()], "bench-fail");
    expect(report.safety.passed).toBe(false);
    expect(report.safety.violationCount).toBeGreaterThan(0);
    const steep = report.perCase.find((c) => c.caseId === "case-steep");
    expect(steep?.envelopeViolationCount).toBe(22);
    expect(verifyBenchmarkReport(report).ok).toBe(true);
  });
});

describe("assembleBenchmarkReport: fail-closed rejections", () => {
  const p = buildPipeline([standardCase()]);

  it("rejects missing tenant, empty set, invalid now/computedAt", () => {
    const base = {
      runId: "r", tenant: TENANT, nowMs: NOW_MS, computedAt: COMPUTED_AT,
      set: p.set, replays: p.replays, scoring: p.scoring, safety: p.safety,
    };
    expect(assembleBenchmarkReport({ ...base, tenant: { tenantId: "" } }))
      .toMatchObject({ ok: false, rejected: "missing-tenant" });
    const emptySet: BenchmarkSet = { ...p.set, cases: [], caseDigests: [] };
    expect(assembleBenchmarkReport({ ...base, set: emptySet }))
      .toMatchObject({ ok: false, rejected: "empty-set" });
    expect(assembleBenchmarkReport({ ...base, nowMs: NOW_MS + 0.5 }))
      .toMatchObject({ ok: false, rejected: "invalid-now" });
    expect(assembleBenchmarkReport({ ...base, computedAt: "" }))
      .toMatchObject({ ok: false, rejected: "invalid-computed-at" });
  });

  it("rejects tenant mismatches across set/scoring/safety/replays", () => {
    const res = assembleBenchmarkReport({
      runId: "r", tenant: OTHER_TENANT, nowMs: NOW_MS, computedAt: COMPUTED_AT,
      set: p.set, replays: p.replays, scoring: p.scoring, safety: p.safety,
    });
    expect(res).toMatchObject({ ok: false, rejected: "tenant-mismatch" });
  });

  it("rejects nowMs before the scoring time", () => {
    const res = assembleBenchmarkReport({
      runId: "r", tenant: TENANT, nowMs: NOW_MS - 1, computedAt: COMPUTED_AT,
      set: p.set, replays: p.replays, scoring: p.scoring, safety: p.safety,
    });
    expect(res).toMatchObject({ ok: false, rejected: "now-before-scoring" });
  });

  it("rejects replay mismatches (count + foreign replay)", () => {
    const base = {
      runId: "r", tenant: TENANT, nowMs: NOW_MS, computedAt: COMPUTED_AT,
      set: p.set, scoring: p.scoring, safety: p.safety,
    };
    expect(assembleBenchmarkReport({ ...base, replays: [] }))
      .toMatchObject({ ok: false, rejected: "replay-mismatch" });
    expect(assembleBenchmarkReport({ ...base, replays: [replayOf(shortCase())] }))
      .toMatchObject({ ok: false, rejected: "replay-mismatch" });
  });

  it("rejects scoring that does not cover exactly the set's cases", () => {
    const wider = buildPipeline([standardCase(), shortCase()]);
    const res = assembleBenchmarkReport({
      runId: "r", tenant: TENANT, nowMs: NOW_MS, computedAt: COMPUTED_AT,
      set: p.set, replays: p.replays, scoring: wider.scoring, safety: p.safety,
    });
    expect(res).toMatchObject({ ok: false, rejected: "scoring-mismatch" });
  });

  it("rejects a safety report whose first check is not advisory-envelope", () => {
    const reordered = { ...p.safety, checks: [...p.safety.checks].reverse() };
    const res = assembleBenchmarkReport({
      runId: "r", tenant: TENANT, nowMs: NOW_MS, computedAt: COMPUTED_AT,
      set: p.set, replays: p.replays, scoring: p.scoring, safety: reordered,
    });
    expect(res).toMatchObject({ ok: false, rejected: "safety-mismatch" });
  });
});

describe("verifyBenchmarkReport", () => {
  const p = buildPipeline([standardCase(), shortCase()]);

  it("verifies with full evidence (set + replays) — every boolean named", () => {
    const v = verifyBenchmarkReport(p.report, { set: p.set, replays: p.replays });
    expect(v.ok).toBe(true);
    expect(v.checks).toEqual({
      reportDigest: true,
      safetyDigest: true,
      scoringDigest: true,
      totalsConsistent: true,
      setDigest: true,
      replayDigests: true,
    });
  });

  it("verifies without evidence — setDigest/replayDigests honestly null", () => {
    const v = verifyBenchmarkReport(p.report);
    expect(v.ok).toBe(true);
    expect(v.checks.setDigest).toBeNull();
    expect(v.checks.replayDigests).toBeNull();
  });

  it("detects report tampering (perCase edits, digest forgery, set swap)", () => {
    const tamperedPerCase: BenchmarkReport = {
      ...p.report,
      perCase: p.report.perCase.map((c, i) => (i === 0 ? { ...c, hitRateBps: 9999 } : c)),
    };
    expect(verifyBenchmarkReport(tamperedPerCase, { set: p.set, replays: p.replays }).ok).toBe(false);
    expect(verifyBenchmarkReport({ ...p.report, reportDigest: "deadbeef" }).ok).toBe(false);
    expect(verifyBenchmarkReport({ ...p.report, caseCount: 99 }).ok).toBe(false);
    const wrongSet: BenchmarkSet = { ...p.set, setDigest: "cafebabe" };
    expect(verifyBenchmarkReport(p.report, { set: wrongSet, replays: p.replays }).checks.setDigest).toBe(false);
  });
});

describe("compareBenchmarkRuns: cross-run comparison (buildComparison convention)", () => {
  it("ranks runs deterministically and derives comparisonId via the kernel export", () => {
    const a = buildPipeline([standardCase()], "run-a").report;
    const b = buildPipeline([standardCase(), shortCase()], "run-b").report;
    const res = compareBenchmarkRuns([b, a], "aggregate-bps", "t0");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const cmp = res.comparison;
    expect(cmp.kind).toBe("BENCHMARK_COMPARISON");
    expect(cmp.experimental).toBe(true);
    expect(cmp.comparisonId).toBe("cmp-run-a,run-b"); // buildComparison sorts ids
    expect(cmp.metric).toBe("aggregate-bps");
    expect(cmp.entries.map((e) => e.runId)).toEqual(["run-a", "run-b"]);
    expect(cmp.ranking[0]?.rank).toBe(1);
    expect(cmp.bestRunId).toBe(cmp.ranking[0]?.runId);
    expect(cmp.digest).toMatch(/^[0-9a-f]{8}$/);
    // metric projection: hit-rate/calibration read from the aggregate
    const hr = compareBenchmarkRuns([a], "hit-rate-bps", "t0");
    const cal = compareBenchmarkRuns([a], "calibration-score-bps", "t0");
    expect(hr.ok && hr.comparison.entries[0]?.value).toBe(a.scoring.aggregate.hitRateBps);
    expect(cal.ok && cal.comparison.entries[0]?.value).toBe(a.scoring.aggregate.calibrationScoreBps);
    expect(BENCHMARK_METRICS).toContain("aggregate-bps");
  });

  it("is byte-identical for identical inputs (determinism)", () => {
    const a = buildPipeline([standardCase()], "run-a").report;
    const b = buildPipeline([standardCase(), shortCase()], "run-b").report;
    const c1 = compareBenchmarkRuns([a, b], "aggregate-bps", "t0");
    const c2 = compareBenchmarkRuns([b, a], "aggregate-bps", "t0");
    expect(JSON.stringify(c1)).toBe(JSON.stringify(c2));
  });

  it("is fail-closed: empty, tenant mismatch, duplicate ids, bad computedAt", () => {
    const a = buildPipeline([standardCase()], "run-a").report;
    expect(compareBenchmarkRuns([], "aggregate-bps", "t0")).toMatchObject({ ok: false, rejected: "empty-reports" });
    expect(compareBenchmarkRuns([a], "aggregate-bps", "")).toMatchObject({ ok: false, rejected: "invalid-computed-at" });
    expect(compareBenchmarkRuns([a, { ...a }], "aggregate-bps", "t0")).toMatchObject({ ok: false, rejected: "duplicate-run-id" });
    const foreign: BenchmarkReport = { ...a, tenant: OTHER_TENANT, runId: "run-x" };
    expect(compareBenchmarkRuns([a, foreign], "aggregate-bps", "t0")).toMatchObject({ ok: false, rejected: "tenant-mismatch" });
  });
});

describe("runtime guards + A11 compile-pins", () => {
  it("isBenchmarkReport verifies markers; rejects stripped/foreign copies", () => {
    const { report } = buildPipeline([standardCase()]);
    expect(isBenchmarkReport(report)).toBe(true);
    expect(isBenchmarkReport(JSON.parse(JSON.stringify(report)))).toBe(true);
    expect(isBenchmarkReport({ ...report, experimental: false })).toBe(false);
    expect(isBenchmarkReport({ kind: "BENCHMARK_REPORT" })).toBe(false);
    expect(isBenchmarkReport(null)).toBe(false);
  });

  it("isBenchmarkComparison verifies markers; rejects stripped copies", () => {
    const a = buildPipeline([standardCase()], "run-a").report;
    const res = compareBenchmarkRuns([a], "aggregate-bps", "t0");
    if (!res.ok) return;
    expect(isBenchmarkComparison(res.comparison)).toBe(true);
    expect(isBenchmarkComparison({ ...res.comparison, experimental: false })).toBe(false);
    expect(isBenchmarkComparison({ kind: "BENCHMARK_COMPARISON" })).toBe(false);
    expect(isBenchmarkComparison(null)).toBe(false);
  });

  it("A11 compile-pin: a benchmark report is not assignable to authoritative shapes", () => {
    const { report } = buildPipeline([standardCase()]);
    // @ts-expect-error — a benchmark report is not a world journal entry (authoritative state)
    const _badJournal: { seq: number; digest: string; prevDigest: string | null } = report;
    // @ts-expect-error — a benchmark report is not an experimental run output
    const _badRun: { kind: "EXPERIMENTAL" } = report;
    // @ts-expect-error — a benchmark report is not an OBSERVED value
    const _badObserved: { kind: "OBSERVED" } = report;
    void _badJournal; void _badRun; void _badObserved;
  });
});
