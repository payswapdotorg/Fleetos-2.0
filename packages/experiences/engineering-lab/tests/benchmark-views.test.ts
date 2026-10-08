/**
 * F261 — benchmark scorecard tests: per-case rows + aggregate scores +
 * safety battery presented VERBATIM from the REAL lane reports (never
 * recomputed), envelope violations surfaced prominently, advisory-only
 * markers structural, comparison extends the lane's convention, fail-closed
 * refusals, digest verify + tamper, determinism.
 */

import { describe, expect, it } from "vitest";
import { compareBenchmarkRuns } from "@fleetos/simulation";
import {
  buildBenchmarkComparisonView,
  buildBenchmarkScorecard,
  verifyBenchmarkViewDigest,
  type BenchmarkScorecardView,
} from "../src/benchmark-views.js";
import { guardLabState } from "../src/lab-state.js";
import { LAB_NOW, makeLabState } from "./helpers.js";
import { COMPUTED_AT } from "./fixtures-sim.js";

const NOW = LAB_NOW;

function slice() {
  const guarded = guardLabState(makeLabState());
  if (!guarded.ok) throw new Error(`fixture slice refused: ${guarded.refused}`);
  return guarded.slice;
}

describe("benchmark scorecard", () => {
  it("presents the per-case results table VERBATIM from the REAL report", () => {
    const s = slice();
    const bench = s.benchmarks[0]!;
    const result = buildBenchmarkScorecard(s, { reportId: bench.report.runId, now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.perCase).toEqual(bench.report.perCase);
    expect(result.view.caseCount).toBe(bench.report.caseCount);
    expect(result.view.setDigest).toBe(bench.report.setDigest);
    expect(result.view.modelVersions).toEqual(bench.report.modelVersions);
  });

  it("presents the aggregate scores VERBATIM (calibration bands + staleness classes)", () => {
    const s = slice();
    const bench = s.benchmarks[0]!;
    const result = buildBenchmarkScorecard(s, { reportId: bench.report.runId, now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.aggregate).toEqual(bench.report.scoring.aggregate);
    expect(result.view.aggregate.bands).toEqual(bench.report.scoring.aggregate.bands);
    expect(result.view.aggregate.stalenessClasses).toEqual(bench.report.scoring.aggregate.stalenessClasses);
    expect(result.view.aggregate.degradationBps).toBe(bench.report.scoring.aggregate.degradationBps);
  });

  it("presents numbers by REFERENCE to the report — a source edit surfaces (never recomputed)", () => {
    const s = slice();
    const bench = s.benchmarks[0]!;
    const result = buildBenchmarkScorecard(s, { reportId: bench.report.runId, now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.aggregate).toBe(bench.report.scoring.aggregate);
  });

  it("presents the four-check safety battery in the lane's fixed order with counts", () => {
    const s = slice();
    const bench = s.benchmarks[0]!;
    const result = buildBenchmarkScorecard(s, { reportId: bench.report.runId, now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.safety.checks.map((c) => c.checkId)).toEqual([
      "advisory-envelope",
      "counterfactual-margin",
      "cannot-write-state",
      "redaction-integrity",
    ]);
    expect(result.view.safety.passed).toBe(bench.report.safety.passed);
    expect(result.view.safety.violationCount).toBe(bench.report.safety.violationCount);
    const envelope = result.view.safety.checks[0]!;
    expect(envelope.metrics).toMatchObject({
      checkedPoints: bench.report.safety.checks[0]!.checkId === "advisory-envelope"
        ? bench.report.safety.checks[0]!.checkedPoints
        : -1,
    });
  });

  it("surfaces envelope violations PROMINENTLY on the tight report (top level)", () => {
    const s = slice();
    const tight = s.benchmarks[1]!;
    const result = buildBenchmarkScorecard(s, { reportId: tight.report.runId, now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(tight.report.runId).toBe("bench-run-tight");
    expect(result.view.envelopeViolations.length).toBeGreaterThan(0);
    const laneViolations = tight.report.safety.checks[0]!.checkId === "advisory-envelope"
      ? tight.report.safety.checks[0]!.violations
      : [];
    expect(result.view.envelopeViolations).toEqual(laneViolations);
    expect(result.view.safety.checks[0]!.passed).toBe(false);
  });

  it("carries the advisory-only markers STRUCTURALLY (kind/experimental + the lane's own note)", () => {
    const s = slice();
    const bench = s.benchmarks[0]!;
    const result = buildBenchmarkScorecard(s, { reportId: bench.report.runId, now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.kind).toBe("BENCHMARK_REPORT");
    expect(result.view.experimental).toBe(true);
    expect(result.view.advisory).toBe(true);
    expect(result.view.advisoryNote).toBe(bench.report.advisoryNote);
    // @ts-expect-error — an authoritative claim is not assignable to the advisory literal
    const authoritative: BenchmarkScorecardView["kind"] = "AUTHORITATIVE";
    expect(authoritative).toBe("AUTHORITATIVE");
  });

  it("refuses unknown reports with the exact code; cross-tenant slices surface the guard code", () => {
    expect(buildBenchmarkScorecard(slice(), { reportId: "bench-run-nope", now: NOW })).toMatchObject({
      ok: false,
      refused: "unknown-report",
    });
    const bad = makeLabState();
    const bench = bad.benchmarks[0]!;
    const report = { ...bench.report, tenant: { tenantId: "tenant-other" } };
    const result = buildBenchmarkScorecard({ ...bad, benchmarks: [{ ...bench, report }] }, {
      reportId: bench.report.runId,
      now: NOW,
    });
    expect(result).toMatchObject({ ok: false, refused: "lab-state-refused", guardCode: "cross-tenant-ref" });
  });

  it("digest verifies and detects tampering; byte-identical determinism", () => {
    const a = buildBenchmarkScorecard(slice(), { reportId: "bench-run-clean", now: NOW });
    const b = buildBenchmarkScorecard(slice(), { reportId: "bench-run-clean", now: NOW });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(JSON.stringify(a.view)).toBe(JSON.stringify(b.view));
    expect(verifyBenchmarkViewDigest(a.view)).toBe(true);
    const tampered = { ...a.view, caseCount: a.view.caseCount + 1 };
    expect(verifyBenchmarkViewDigest(tampered)).toBe(false);
  });
});

describe("benchmark comparison view — extends the lane's comparison convention", () => {
  it("presents the REAL compareBenchmarkRuns ranking verbatim", () => {
    const s = slice();
    const reports = [...s.benchmarks].map((b) => b.report).sort((x, y) => (x.runId < y.runId ? -1 : 1));
    const real = compareBenchmarkRuns(reports, "aggregate-bps", COMPUTED_AT);
    expect(real.ok).toBe(true);
    const result = buildBenchmarkComparisonView(slice(), {
      metric: "aggregate-bps",
      computedAt: COMPUTED_AT,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok || !real.ok) return;
    expect(result.view.comparisonId).toBe(real.comparison.comparisonId);
    expect(result.view.ranking).toEqual(real.comparison.ranking);
    expect(result.view.entries).toEqual(real.comparison.entries);
    expect(result.view.bestRunId).toBe(real.comparison.bestRunId);
    expect(result.view.experimental).toBe(true);
    expect(result.view.advisoryNote).toBe(real.comparison.advisoryNote);
  });

  it("ranks the slice's reports deterministically with a stable winner", () => {
    const result = buildBenchmarkComparisonView(slice(), {
      metric: "hit-rate-bps",
      computedAt: COMPUTED_AT,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Ranking is value desc with a runId tiebreak (the lane's convention).
    const values = result.view.ranking.map((r) => r.value);
    expect([...values].sort((a, b) => b - a)).toEqual(values);
    expect(result.view.ranking.map((r) => r.runId)).toEqual(["bench-run-tight", "bench-run-clean"]);
    expect(result.view.bestRunId).toBe(result.view.ranking[0]!.runId);
    // ...and equals a DIRECT call to the REAL lane comparison on this metric.
    const reports = [...slice().benchmarks].map((b) => b.report).sort((x, y) => (x.runId < y.runId ? -1 : 1));
    const real = compareBenchmarkRuns(reports, "hit-rate-bps", COMPUTED_AT);
    expect(real.ok).toBe(true);
    if (!real.ok) return;
    expect(result.view.ranking).toEqual(real.comparison.ranking);
  });

  it("refuses an empty computedAt with the exact code", () => {
    expect(
      buildBenchmarkComparisonView(slice(), { metric: "aggregate-bps", computedAt: "", now: NOW }),
    ).toMatchObject({ ok: false, refused: "invalid-computed-at" });
  });
});
