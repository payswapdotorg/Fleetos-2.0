/**
 * F261 lab test fixtures — the simulation lane (deterministic, REAL
 * machinery only). World-model journal entries are built with a LOCAL
 * replica of the world-model's public digest convention (`worldEntryDigest`
 * — identical formula; the lab may only import the three Wave-6 lane
 * packages), and every journal is machine-verified by the REAL
 * `foldWorldState` inside `defineBenchmarkCase`. Cases, sets, replays,
 * scoring, the safety battery and reports all come from the REAL lane
 * functions.
 */

import {
  assembleBenchmarkReport,
  assembleBenchmarkSet,
  defineBenchmarkCase,
  replayJournal,
  runSafetyBattery,
  scoreBenchmarkSet,
  type BenchmarkCase,
  type BenchmarkReport,
  type BenchmarkScoring,
  type BenchmarkSet,
  type ExpectedOutcomeRef,
  type PredictiveInvocationParams,
  type ReplayRun,
  type SafetyEnvelope,
  type SafetyReport,
} from "@fleetos/simulation";
import { COMPUTED_AT, LAB_TENANT } from "./fixtures-sim.js";

export const BENCH_TENANT = { tenantId: LAB_TENANT } as const;
export const BENCH_NOW_MS = 800_000;
export const BENCH_THRESHOLDS = { freshWithinMs: 10_000, staleWithinMs: 60_000 } as const;

/** Mirror of @fleetos/predictive's REFERENCE_MODEL_VERSION (cannot be
 * imported under the deps law); machine-verified by the REAL replay's
 * fail-closed model-version check. */
export const REFERENCE_MODEL_VERSION = "reference-twin-1.0.0";

// ---------------------------------------------------------------------------
// World-model journal entries — local replica of the lane's public digest
// convention (verified end-to-end by the REAL fold in defineBenchmarkCase).
// ---------------------------------------------------------------------------

type WorldJournalEntry = BenchmarkCase["journal"][number];
type WorldEvent = WorldJournalEntry["event"];

function wmFnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function serializeWorldEvent(event: WorldEvent): string {
  return [
    event.kind,
    event.entityId,
    event.entityType,
    event.observationRef ?? "",
    event.observedAtMs ?? "",
    event.value ?? "",
    (event.tags ?? []).join(","),
    event.reason ?? "",
  ].join("|");
}

function wmEntryDigest(prevDigest: string | null, entry: Omit<WorldJournalEntry, "digest" | "prevDigest">): string {
  const genesis = wmFnv1a(`world-genesis|${entry.tenantId}`);
  return wmFnv1a(
    `world|${prevDigest ?? genesis}|${String(entry.seq)}|${entry.tenantId}|${serializeWorldEvent(entry.event)}|${String(entry.atMs)}`,
  );
}

function nextWmEntry(input: {
  readonly tenantId: string;
  readonly existing: readonly WorldJournalEntry[];
  readonly event: WorldEvent;
  readonly atMs: number;
}): WorldJournalEntry {
  const last = input.existing.length > 0 ? input.existing[input.existing.length - 1] : undefined;
  const prevDigest = last ? last.digest : null;
  const base = {
    seq: (last ? last.seq : 0) + 1,
    tenantId: input.tenantId,
    event: input.event,
    atMs: input.atMs,
  };
  return { ...base, digest: wmEntryDigest(prevDigest, base), prevDigest };
}

function buildJournal(
  tenantId: string,
  specs: readonly { readonly atMs: number; readonly event: WorldEvent }[],
): WorldJournalEntry[] {
  const entries: WorldJournalEntry[] = [];
  for (const s of specs) {
    entries.push(nextWmEntry({ tenantId, existing: entries, event: s.event, atMs: s.atMs }));
  }
  return entries;
}

function obs(entityId: string, ref: string, atMs: number, value: number): WorldEvent {
  return { kind: "observation-recorded", entityId, entityType: "asset", observationRef: ref, observedAtMs: atMs, value };
}

// ---------------------------------------------------------------------------
// Journals + cases (the lane's proven linear series)
// ---------------------------------------------------------------------------

export function standardJournal(): WorldJournalEntry[] {
  return buildJournal(LAB_TENANT, [
    { atMs: 1000, event: { kind: "entity-registered", entityId: "e1", entityType: "asset" } },
    { atMs: 1000, event: obs("e1", "obs-1", 1000, 10) },
    { atMs: 2000, event: obs("e1", "obs-2", 2000, 20) },
    { atMs: 3000, event: obs("e1", "obs-3", 3000, 30) },
    { atMs: 40_000, event: { kind: "entity-tagged", entityId: "e1", entityType: "asset", tags: ["beta"] } },
    { atMs: 700_000, event: { kind: "entity-tagged", entityId: "e1", entityType: "asset", tags: ["gamma"] } },
  ]);
}

export function shortJournal(): WorldJournalEntry[] {
  return buildJournal(LAB_TENANT, [
    { atMs: 1000, event: { kind: "entity-registered", entityId: "e2", entityType: "asset" } },
    { atMs: 1000, event: obs("e2", "e2-1", 1000, 5) },
    { atMs: 2000, event: obs("e2", "e2-2", 2000, 6) },
    { atMs: 3000, event: obs("e2", "e2-3", 3000, 7) },
  ]);
}

export function steepJournal(): WorldJournalEntry[] {
  return buildJournal(LAB_TENANT, [
    { atMs: 1000, event: { kind: "entity-registered", entityId: "e3", entityType: "asset" } },
    { atMs: 1000, event: obs("e3", "e3-1", 1000, 0) },
    { atMs: 2000, event: obs("e3", "e3-2", 2000, 100) },
    { atMs: 3000, event: obs("e3", "e3-3", 3000, 200) },
  ]);
}

export const INVOCATION: PredictiveInvocationParams = {
  modelPortName: "reference.twin.linear-drift",
  modelVersion: REFERENCE_MODEL_VERSION,
  metric: "temperature",
  horizon: { steps: 3, stepMs: 1000 },
};

export const ENVELOPE: SafetyEnvelope = {
  maxAbsValue: 1000,
  minConfidenceBps: 0,
  maxBoundHalfWidth: 5,
  maxCounterfactualDeltaBps: 500,
  perturbationOffset: 0.5,
};

/** A deliberately TIGHT envelope the REAL model violates (violations fixture). */
export const TIGHT_ENVELOPE: SafetyEnvelope = {
  maxAbsValue: 250,
  minConfidenceBps: 2800,
  maxBoundHalfWidth: 0.4,
  maxCounterfactualDeltaBps: 500,
  perturbationOffset: 50,
};

export const CONTEXT_FIELDS = {
  operatorName: "Ada",
  operatorContact: "ada@example",
  location: "bay-7",
  temperature: 41,
} as const;

function defineOrThrow(input: {
  readonly caseId: string;
  readonly entityId: string;
  readonly journal: readonly WorldJournalEntry[];
  readonly expectedOutcomes: readonly ExpectedOutcomeRef[];
  readonly envelope: SafetyEnvelope;
}): BenchmarkCase {
  const res = defineBenchmarkCase({
    caseId: input.caseId,
    tenant: BENCH_TENANT,
    entityId: input.entityId,
    journal: input.journal,
    invocation: INVOCATION,
    expectedOutcomes: input.expectedOutcomes,
    envelope: input.envelope,
    contextFields: CONTEXT_FIELDS,
  });
  if (!res.ok) throw new Error(`fixture case ${input.caseId} failed to define: ${res.rejected} (${res.detail})`);
  return res.benchmarkCase;
}

export function standardCase(): BenchmarkCase {
  return defineOrThrow({
    caseId: "case-standard",
    entityId: "e1",
    journal: standardJournal(),
    expectedOutcomes: [
      { replaySeq: 4, step: 1, atMs: 4000, value: 40.5, observationRef: "real-1" },
      { replaySeq: 4, step: 2, atMs: 5000, value: 51.5, observationRef: "real-2" },
      { replaySeq: 5, step: 1, atMs: 41_000, value: 60, observationRef: "real-3" },
      { replaySeq: 6, step: 1, atMs: 701_000, value: 40, observationRef: "real-4" },
    ],
    envelope: ENVELOPE,
  });
}

export function shortCase(): BenchmarkCase {
  return defineOrThrow({
    caseId: "case-short",
    entityId: "e2",
    journal: shortJournal(),
    expectedOutcomes: [{ replaySeq: 4, step: 1, atMs: 4000, value: 8.2, observationRef: "real-e2-1" }],
    envelope: ENVELOPE,
  });
}

export function steepCase(): BenchmarkCase {
  return defineOrThrow({
    caseId: "case-steep",
    entityId: "e3",
    journal: steepJournal(),
    expectedOutcomes: [{ replaySeq: 4, step: 1, atMs: 4000, value: 300, observationRef: "real-e3-1" }],
    envelope: TIGHT_ENVELOPE,
  });
}

// ---------------------------------------------------------------------------
// The full bundle: set → replays → scoring → safety → report (all REAL)
// ---------------------------------------------------------------------------

export interface LabBenchmarkFixture {
  readonly set: BenchmarkSet;
  readonly replays: readonly ReplayRun[];
  readonly scoring: BenchmarkScoring;
  readonly safety: SafetyReport;
  readonly report: BenchmarkReport;
}

export function buildBenchmark(
  cases: readonly BenchmarkCase[],
  runId: string,
  assembledAtMs: number,
): LabBenchmarkFixture {
  const set = assembleBenchmarkSet({ tenant: BENCH_TENANT, cases, assembledAtMs });
  if (!set.ok) throw new Error(`fixture set refused: ${set.rejected} (${set.detail})`);
  const replays = cases.map((c) => {
    const replay = replayJournal({
      tenant: BENCH_TENANT,
      entityId: c.entityId,
      journal: c.journal,
      invocation: c.invocation,
    });
    if (!replay.ok) throw new Error(`fixture replay refused: ${replay.rejected} (${replay.detail})`);
    return replay.run;
  });
  const scoring = scoreBenchmarkSet({
    tenant: BENCH_TENANT,
    nowMs: BENCH_NOW_MS,
    thresholds: BENCH_THRESHOLDS,
    members: cases.map((benchmarkCase, i) => ({ benchmarkCase, replay: replays[i] as ReplayRun })),
  });
  if (!scoring.ok) throw new Error(`fixture scoring refused: ${scoring.degraded} (${scoring.detail})`);
  const safety = runSafetyBattery({
    tenant: BENCH_TENANT,
    members: cases.map((benchmarkCase, i) => ({ benchmarkCase, replay: replays[i] as ReplayRun })),
    computedAt: COMPUTED_AT,
  });
  if (!safety.ok) throw new Error(`fixture safety refused: ${safety.rejected} (${safety.detail})`);
  const report = assembleBenchmarkReport({
    runId,
    tenant: BENCH_TENANT,
    nowMs: BENCH_NOW_MS,
    computedAt: COMPUTED_AT,
    set: set.set,
    replays,
    scoring: scoring.scoring,
    safety: safety.report,
  });
  if (!report.ok) throw new Error(`fixture report refused: ${report.rejected} (${report.detail})`);
  return { set: set.set, replays, scoring: scoring.scoring, safety: safety.report, report: report.report };
}

/** The standard (clean) benchmark bundle. */
export function cleanBenchmark(): LabBenchmarkFixture {
  return buildBenchmark([standardCase(), shortCase()], "bench-run-clean", BENCH_NOW_MS);
}

/** The tight-envelope benchmark bundle (surfaces envelope violations). */
export function tightBenchmark(): LabBenchmarkFixture {
  return buildBenchmark([steepCase()], "bench-run-tight", BENCH_NOW_MS + 1_000);
}
