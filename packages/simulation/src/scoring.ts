/**
 * @fleetos/simulation — deterministic benchmark scoring (Wave 6, F260B).
 *
 * Scores replayed predictions against realized outcomes: hit-rate (realized
 * within the prediction's bounds, inclusive — integer bps); calibration bands
 * (fixed integer-bps buckets of predicted-vs-realized relative deviation —
 * edges exported below, no learned thresholds); staleness-sensitivity
 * (per-class hit-rates over the input staleness classes via the REAL
 * world-model classifier + the fresh→stale degradation in bps); and the
 * aggregate benchmark score under a FIXED deterministic weighting
 * (hit-rate 5000 / calibration 3000 / staleness 2000 bps of 10000 — exported
 * constants, documented, NO learned weights).
 *
 * Fail-closed on tenant mismatch and logical-now mismatch; honest
 * `insufficient-evidence`/`partial-case-set` degraded states for empty or
 * partial case sets. Scoring is EVALUATION EVIDENCE ONLY (A11). Deterministic:
 * no clock, no randomness, no I/O.
 */

import type { StalenessClass, StalenessThresholds, WorldJournalEntry } from "@fleetos/world-model";
import { classifyStaleness } from "@fleetos/world-model";
import type { BenchmarkCase } from "./benchmark-definition.ts";
import type { TenantScopeLike } from "./index.ts";
import { BENCHMARK_ADVISORY_NOTE, canonicalJson, fnv1a } from "./benchmark-definition.ts";
import type { ReplayRun } from "./replay-harness.ts";

/** Fixed calibration bucket edges (integer bps of signed relative deviation). */
export const CALIBRATION_BUCKET_EDGES_BPS: readonly number[] = [
  -5000, -2000, -1000, -500, -100, 100, 500, 1000, 2000, 5000,
];

/** FIXED aggregate weights (bps of 10000) — documented, never learned. */
export const HIT_RATE_WEIGHT_BPS = 5000;
export const CALIBRATION_WEIGHT_BPS = 3000;
export const STALENESS_WEIGHT_BPS = 2000;

export type ScoringDegradedState =
  | "insufficient-evidence"
  | "partial-case-set"
  | "tenant-mismatch"
  | "replay-mismatch"
  | "now-before-realized"
  | "invalid-thresholds"
  | "invalid-now";

export interface CalibrationBand {
  /** Inclusive upper edge in bps; null = the open (+inf) band. */
  readonly upperEdgeBps: number | null;
  readonly count: number;
}

export interface StalenessClassScore {
  readonly staleness: StalenessClass;
  readonly pairCount: number;
  readonly hitCount: number;
  /** Null when pairCount === 0 — honestly unclaimed, never fabricated. */
  readonly hitRateBps: number | null;
}

export interface CaseScore {
  readonly caseId: string;
  readonly tenantId: string;
  readonly matchedPairs: number;
  readonly hitCount: number;
  readonly hitRateBps: number;
  readonly calibrationScoreBps: number;
  readonly calibrationFallback: boolean;
  readonly meanAbsDeviationBps: number | null;
  /** Exact integer sum of |deviationBps| over non-null deviations. */
  readonly absDeviationSum: number;
  /** Count of non-null deviations (matchedPairs - zeroBaselinePairs). */
  readonly deviationCount: number;
  readonly zeroBaselinePairs: number;
  readonly bands: readonly CalibrationBand[];
  readonly stalenessClasses: readonly StalenessClassScore[];
  readonly freshHitRateBps: number | null;
  readonly degradationBps: number | null;
  readonly stalenessFallback: boolean;
  readonly stalenessScoreBps: number;
  readonly aggregateBps: number;
  readonly unscoreableOutcomes: readonly { readonly replaySeq: number; readonly step: number; readonly reason: string }[];
  readonly scoreDigest: string;
}

export interface BenchmarkAggregate {
  readonly totalPairs: number;
  readonly hitCount: number;
  readonly hitRateBps: number;
  readonly calibrationScoreBps: number;
  readonly calibrationFallback: boolean;
  readonly meanAbsDeviationBps: number | null;
  readonly zeroBaselinePairs: number;
  readonly bands: readonly CalibrationBand[];
  readonly stalenessClasses: readonly StalenessClassScore[];
  readonly freshHitRateBps: number | null;
  readonly staleHitRateBps: number | null;
  readonly degradationBps: number | null;
  readonly stalenessFallback: boolean;
  readonly stalenessScoreBps: number;
  readonly aggregateBps: number;
}

export interface BenchmarkScoring {
  readonly kind: "BENCHMARK_SCORING";
  readonly experimental: true;
  readonly advisoryNote: typeof BENCHMARK_ADVISORY_NOTE;
  readonly tenant: TenantScopeLike;
  readonly nowMs: number;
  readonly caseCount: number;
  readonly perCase: readonly CaseScore[]; // caseId asc — input order never leaks
  readonly aggregate: BenchmarkAggregate;
  readonly scoringDigest: string;
}

export type CaseScoreResult =
  | { readonly ok: true; readonly score: CaseScore }
  | { readonly ok: false; readonly degraded: ScoringDegradedState; readonly detail: string };

export type SetScoreResult =
  | { readonly ok: true; readonly scoring: BenchmarkScoring }
  | {
      readonly ok: false;
      readonly degraded: ScoringDegradedState;
      readonly detail: string;
      readonly unscored: readonly { readonly caseId: string; readonly degraded: ScoringDegradedState; readonly detail: string }[];
      readonly partialAggregate: BenchmarkAggregate | null;
    };

export function scoreBenchmarkCase(input: {
  readonly benchmarkCase: BenchmarkCase;
  readonly replay: ReplayRun;
  readonly thresholds: StalenessThresholds;
  readonly nowMs: number;
}): CaseScoreResult {
  const c = input.benchmarkCase;
  if (c.tenant.tenantId !== input.replay.tenant.tenantId) {
    return caseFail("tenant-mismatch", `replay tenant ${input.replay.tenant.tenantId} != case tenant ${c.tenant.tenantId}`);
  }
  const head = c.journal[c.journal.length - 1] as WorldJournalEntry;
  if (
    input.replay.entityId !== c.entityId || input.replay.metric !== c.invocation.metric ||
    input.replay.journalHeadDigest !== head.digest || input.replay.fromSeq !== 1 ||
    input.replay.toSeq !== c.journal.length || input.replay.journalLength !== c.journal.length
  ) {
    return caseFail("replay-mismatch", `replay does not cover case ${c.caseId} (entity/metric/head/from/to mismatch)`);
  }
  if (
    !Number.isInteger(input.thresholds.freshWithinMs) || !Number.isInteger(input.thresholds.staleWithinMs) ||
    input.thresholds.freshWithinMs < 0 || input.thresholds.staleWithinMs < input.thresholds.freshWithinMs
  ) {
    return caseFail("invalid-thresholds", "thresholds require integers with 0 <= freshWithinMs <= staleWithinMs");
  }
  if (!Number.isInteger(input.nowMs)) {
    return caseFail("invalid-now", "nowMs must be an integer (logical milliseconds)");
  }
  const maxRealized = Math.max(...c.expectedOutcomes.map((o) => o.atMs));
  if (input.nowMs < maxRealized) {
    return caseFail("now-before-realized", `nowMs ${input.nowMs} precedes realized outcome at ${maxRealized}`);
  }

  const stepBySeq = new Map(input.replay.steps.map((s) => [s.seq, s]));
  const stalenessBySeq = new Map<number, StalenessClass>();
  for (const s of input.replay.steps) {
    const classified = classifyStaleness(s.lastObservedAtMs, s.atMs, input.thresholds);
    stalenessBySeq.set(s.seq, classified.ok ? classified.staleness : "unknown");
  }

  const pairs: {
    replaySeq: number; step: number; atMs: number; predicted: number; realized: number;
    hit: boolean; deviationBps: number | null; confidenceBps: number; staleness: StalenessClass;
  }[] = [];
  const unscoreable: { replaySeq: number; step: number; reason: string }[] = [];
  for (const o of c.expectedOutcomes) {
    const step = stepBySeq.get(o.replaySeq);
    if (!step) {
      unscoreable.push({ replaySeq: o.replaySeq, step: o.step, reason: "replay step missing" });
      continue;
    }
    if (!step.outcome.ok) {
      unscoreable.push({ replaySeq: o.replaySeq, step: o.step, reason: `replay step rejected: ${step.outcome.rejected}` });
      continue;
    }
    const point = step.outcome.prediction.points[o.step - 1];
    if (!point) {
      unscoreable.push({ replaySeq: o.replaySeq, step: o.step, reason: "predicted point missing" });
      continue;
    }
    const hit = o.value >= point.bounds.lower && o.value <= point.bounds.upper;
    const deviationBps = point.value === 0 ? null : Math.round((10000 * (o.value - point.value)) / point.value);
    pairs.push({
      replaySeq: o.replaySeq, step: o.step, atMs: o.atMs, predicted: point.value, realized: o.value,
      hit, deviationBps, confidenceBps: point.confidenceBps, staleness: stalenessBySeq.get(o.replaySeq) ?? "unknown",
    });
  }
  if (pairs.length === 0) {
    return caseFail(
      "insufficient-evidence",
      `no matched pairs for case ${c.caseId}; unscoreable: ${unscoreable.map((u) => `seq ${u.replaySeq}#${u.step} (${u.reason})`).join("; ") || "none"}`,
    );
  }
  const score = buildCaseScore(c.caseId, c.tenant.tenantId, pairs, unscoreable);
  return { ok: true, score };
}

function buildCaseScore(
  caseId: string,
  tenantId: string,
  pairs: readonly {
    replaySeq: number; step: number; atMs: number; predicted: number; realized: number;
    hit: boolean; deviationBps: number | null; confidenceBps: number; staleness: StalenessClass;
  }[],
  unscoreable: readonly { replaySeq: number; step: number; reason: string }[],
): CaseScore {
  const hitCount = pairs.filter((p) => p.hit).length;
  const hitRateBps = Math.round((10000 * hitCount) / pairs.length);
  const bands = emptyBands();
  let zeroBaselinePairs = 0;
  let absDevSum = 0;
  let devCount = 0;
  for (const p of pairs) {
    const dev = p.deviationBps;
    if (dev === null) {
      zeroBaselinePairs += 1;
      continue;
    }
    absDevSum += Math.abs(dev);
    devCount += 1;
    const bandIndex = CALIBRATION_BUCKET_EDGES_BPS.findIndex((edge) => dev <= edge);
    const idx = bandIndex === -1 ? bands.length - 1 : bandIndex;
    bands[idx] = { ...bands[idx] as CalibrationBand, count: (bands[idx] as CalibrationBand).count + 1 };
  }
  const meanAbs = devCount === 0 ? null : Math.round(absDevSum / devCount);
  const calibrationScoreBps = meanAbs === null ? hitRateBps : clampBps(10000 - meanAbs);
  const stalenessClasses = classScores(pairs);
  const fresh = stalenessClasses.find((s) => s.staleness === "fresh") ?? null;
  const stale = stalenessClasses.find((s) => s.staleness === "stale") ?? null;
  const freshBps = fresh && fresh.pairCount > 0 ? fresh.hitRateBps : null;
  const staleBps = stale && stale.pairCount > 0 ? stale.hitRateBps : null;
  const stalenessFallback = freshBps === null;
  const stalenessScoreBps = freshBps ?? hitRateBps;
  const base = {
    caseId, tenantId,
    matchedPairs: pairs.length, hitCount, hitRateBps,
    calibrationScoreBps,
    calibrationFallback: meanAbs === null,
    meanAbsDeviationBps: meanAbs,
    absDeviationSum: absDevSum,
    deviationCount: devCount,
    zeroBaselinePairs, bands, stalenessClasses,
    freshHitRateBps: freshBps,
    degradationBps: freshBps !== null && staleBps !== null ? freshBps - staleBps : null,
    stalenessFallback, stalenessScoreBps,
    aggregateBps: Math.round(
      (hitRateBps * HIT_RATE_WEIGHT_BPS + calibrationScoreBps * CALIBRATION_WEIGHT_BPS +
        stalenessScoreBps * STALENESS_WEIGHT_BPS) / 10000,
    ),
    unscoreableOutcomes: [...unscoreable].sort((a, b) => a.replaySeq - b.replaySeq || a.step - b.step),
  };
  return { ...base, scoreDigest: fnv1a(`case-score|v1|${canonicalJson(base)}`) };
}

export function scoreBenchmarkSet(input: {
  readonly tenant: TenantScopeLike;
  readonly nowMs: number;
  readonly thresholds: StalenessThresholds;
  readonly members: readonly { readonly benchmarkCase: BenchmarkCase; readonly replay: ReplayRun }[];
}): SetScoreResult {
  const tenantId = input.tenant.tenantId;
  if (tenantId === "") return setFail("insufficient-evidence", "tenant identifier is empty", [], null);
  if (input.members.length === 0) {
    return setFail("insufficient-evidence", "case set is empty", [], null);
  }
  if (!Number.isInteger(input.nowMs)) {
    return setFail("invalid-now", "nowMs must be an integer (logical milliseconds)", [], null);
  }
  const unscored: { caseId: string; degraded: ScoringDegradedState; detail: string }[] = [];
  const scores: CaseScore[] = [];
  for (const m of input.members) {
    if (m.benchmarkCase.tenant.tenantId !== tenantId || m.replay.tenant.tenantId !== tenantId) {
      return setFail("tenant-mismatch", `member ${m.benchmarkCase.caseId} is not tenant ${tenantId}`, [], null);
    }
    const res = scoreBenchmarkCase({
      benchmarkCase: m.benchmarkCase, replay: m.replay, thresholds: input.thresholds, nowMs: input.nowMs,
    });
    if (res.ok) scores.push(res.score);
    else unscored.push({ caseId: m.benchmarkCase.caseId, degraded: res.degraded, detail: res.detail });
  }
  if (unscored.length > 0) {
    return setFail(
      "partial-case-set",
      `${unscored.length} of ${input.members.length} cases unscoreable: ${unscored.map((u) => u.caseId).sort().join(", ")}`,
      unscored,
      scores.length > 0 ? aggregateScores(scores) : null,
    );
  }
  const perCase = [...scores].sort((a, b) => (a.caseId < b.caseId ? -1 : a.caseId > b.caseId ? 1 : 0));
  const base = {
    kind: "BENCHMARK_SCORING" as const,
    experimental: true as const,
    advisoryNote: BENCHMARK_ADVISORY_NOTE,
    tenant: { tenantId },
    nowMs: input.nowMs,
    caseCount: perCase.length,
    perCase,
    aggregate: aggregateScores(perCase),
  };
  return { ok: true, scoring: { ...base, scoringDigest: fnv1a(`bench-scoring|v1|${canonicalJson(base)}`) } };
}

function aggregateScores(scores: readonly CaseScore[]): BenchmarkAggregate {
  const totalPairs = scores.reduce((a, s) => a + s.matchedPairs, 0);
  const hitCount = scores.reduce((a, s) => a + s.hitCount, 0);
  const hitRateBps = Math.round((10000 * hitCount) / totalPairs);
  const bands = emptyBands();
  let zeroBaselinePairs = 0;
  let absDevSum = 0;
  let devCount = 0;
  const classTotals = new Map<StalenessClass, { pairs: number; hits: number }>([
    ["fresh", { pairs: 0, hits: 0 }], ["stale", { pairs: 0, hits: 0 }], ["unknown", { pairs: 0, hits: 0 }],
  ]);
  for (const s of scores) {
    zeroBaselinePairs += s.zeroBaselinePairs;
    absDevSum += s.absDeviationSum;
    devCount += s.deviationCount;
    for (let i = 0; i < bands.length; i += 1) {
      bands[i] = { ...(bands[i] as CalibrationBand), count: (bands[i] as CalibrationBand).count + (s.bands[i] as CalibrationBand).count };
    }
    for (const cls of s.stalenessClasses) {
      const tot = classTotals.get(cls.staleness);
      if (tot) { tot.pairs += cls.pairCount; tot.hits += cls.hitCount; }
    }
  }
  const meanAbs = devCount === 0 ? null : Math.round(absDevSum / devCount);
  const calibrationScoreBps = meanAbs === null ? hitRateBps : clampBps(10000 - meanAbs);
  const stalenessClasses = [...classTotals.entries()].map(([staleness, t]) => ({
    staleness, pairCount: t.pairs, hitCount: t.hits, hitRateBps: t.pairs === 0 ? null : Math.round((10000 * t.hits) / t.pairs),
  }));
  const freshBps = stalenessClasses.find((s) => s.staleness === "fresh")?.hitRateBps ?? null;
  const staleBps = stalenessClasses.find((s) => s.staleness === "stale")?.hitRateBps ?? null;
  const stalenessFallback = freshBps === null;
  const stalenessScoreBps = freshBps ?? hitRateBps;
  return {
    totalPairs, hitCount, hitRateBps,
    calibrationScoreBps, calibrationFallback: meanAbs === null, meanAbsDeviationBps: meanAbs,
    zeroBaselinePairs, bands, stalenessClasses,
    freshHitRateBps: freshBps, staleHitRateBps: staleBps,
    degradationBps: freshBps !== null && staleBps !== null ? freshBps - staleBps : null,
    stalenessFallback, stalenessScoreBps,
    aggregateBps: Math.round(
      (hitRateBps * HIT_RATE_WEIGHT_BPS + calibrationScoreBps * CALIBRATION_WEIGHT_BPS +
        stalenessScoreBps * STALENESS_WEIGHT_BPS) / 10000,
    ),
  };
}

function emptyBands(): CalibrationBand[] {
  return [...CALIBRATION_BUCKET_EDGES_BPS.map((edge) => ({ upperEdgeBps: edge, count: 0 })), { upperEdgeBps: null, count: 0 }];
}

function classScores(pairs: readonly { staleness: StalenessClass; hit: boolean }[]): StalenessClassScore[] {
  const order: StalenessClass[] = ["fresh", "stale", "unknown"];
  return order.map((staleness) => {
    const subset = pairs.filter((p) => p.staleness === staleness);
    const hitCount = subset.filter((p) => p.hit).length;
    return {
      staleness,
      pairCount: subset.length,
      hitCount,
      hitRateBps: subset.length === 0 ? null : Math.round((10000 * hitCount) / subset.length),
    };
  });
}

function clampBps(n: number): number {
  return Math.min(10000, Math.max(0, n));
}

function caseFail(degraded: ScoringDegradedState, detail: string): CaseScoreResult {
  return { ok: false, degraded, detail };
}

function setFail(
  degraded: ScoringDegradedState,
  detail: string,
  unscored: readonly { caseId: string; degraded: ScoringDegradedState; detail: string }[],
  partialAggregate: BenchmarkAggregate | null,
): SetScoreResult {
  return { ok: false, degraded, detail, unscored, partialAggregate };
}
