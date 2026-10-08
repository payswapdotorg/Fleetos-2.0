/**
 * F260B benchmark test fixtures — shared, deterministic, REAL-machinery-based.
 *
 * Journals are built with the REAL `nextWorldEntry` (digest-chained); cases
 * through the REAL `defineBenchmarkCase`. The standard journal gives the
 * reference model a perfectly linear series (10,20,30 @ 1000,2000,3000ms →
 * drift 0.01/ms → step values 40/50/60), with journal-time gaps at seq 5/6
 * producing STALE and UNKNOWN input staleness classes.
 */

import type { WorldEvent, WorldJournalEntry } from "@fleetos/world-model";
import { nextWorldEntry } from "@fleetos/world-model";
import { REFERENCE_MODEL_VERSION } from "@fleetos/predictive";
import { defineBenchmarkCase } from "../src/benchmark-definition.ts";
import type {
  BenchmarkCase,
  ExpectedOutcomeRef,
  PredictiveInvocationParams,
  SafetyEnvelope,
} from "../src/benchmark-definition.ts";

export const TENANT = { tenantId: "bench-t1" } as const;
export const OTHER_TENANT = { tenantId: "bench-t2" } as const;
export const THRESHOLDS = { freshWithinMs: 10_000, staleWithinMs: 60_000 } as const;
export const NOW_MS = 800_000;
export const COMPUTED_AT = "2026-10-09T00:00:00.000Z";

export function buildJournal(tenantId: string, specs: readonly { readonly atMs: number; readonly event: WorldEvent }[]): WorldJournalEntry[] {
  const entries: WorldJournalEntry[] = [];
  for (const s of specs) {
    entries.push(nextWorldEntry({ tenantId, existing: entries, event: s.event, atMs: s.atMs }));
  }
  return entries;
}

function obs(entityId: string, ref: string, atMs: number, value: number): WorldEvent {
  return { kind: "observation-recorded", entityId, entityType: "asset", observationRef: ref, observedAtMs: atMs, value };
}

/** seq1-4: entity e1 with linear observations; seq5/6: time gaps (stale/unknown). */
export function standardJournal(): WorldJournalEntry[] {
  return buildJournal(TENANT.tenantId, [
    { atMs: 1000, event: { kind: "entity-registered", entityId: "e1", entityType: "asset" } },
    { atMs: 1000, event: obs("e1", "obs-1", 1000, 10) },
    { atMs: 2000, event: obs("e1", "obs-2", 2000, 20) },
    { atMs: 3000, event: obs("e1", "obs-3", 3000, 30) },
    { atMs: 40_000, event: { kind: "entity-tagged", entityId: "e1", entityType: "asset", tags: ["beta"] } },
    { atMs: 700_000, event: { kind: "entity-tagged", entityId: "e1", entityType: "asset", tags: ["gamma"] } },
  ]);
}

/** A short single-entity journal (e2) with values 5,6,7 → drift 0.001/ms. */
export function shortJournal(): WorldJournalEntry[] {
  return buildJournal(TENANT.tenantId, [
    { atMs: 1000, event: { kind: "entity-registered", entityId: "e2", entityType: "asset" } },
    { atMs: 1000, event: obs("e2", "e2-1", 1000, 5) },
    { atMs: 2000, event: obs("e2", "e2-2", 2000, 6) },
    { atMs: 3000, event: obs("e2", "e2-3", 3000, 7) },
  ]);
}

/** Steep-drift journal (e3): 0,100,200 → step values 300/400/500. */
export function steepJournal(): WorldJournalEntry[] {
  return buildJournal(TENANT.tenantId, [
    { atMs: 1000, event: { kind: "entity-registered", entityId: "e3", entityType: "asset" } },
    { atMs: 1000, event: obs("e3", "e3-1", 1000, 0) },
    { atMs: 2000, event: obs("e3", "e3-2", 2000, 100) },
    { atMs: 3000, event: obs("e3", "e3-3", 3000, 200) },
  ]);
}

/** Single-observation journal (e4, value 10) — flat prediction with known bounds. */
export function singleObservationJournal(): WorldJournalEntry[] {
  return buildJournal(TENANT.tenantId, [
    { atMs: 1000, event: { kind: "entity-registered", entityId: "e4", entityType: "asset" } },
    { atMs: 1000, event: obs("e4", "e4-1", 1000, 10) },
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

/** A deliberately TIGHT envelope the REAL model violates (negative fixture). */
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

export function standardCase(): BenchmarkCase {
  const expected: ExpectedOutcomeRef[] = [
    { replaySeq: 4, step: 1, atMs: 4000, value: 40.5, observationRef: "real-1" },
    { replaySeq: 4, step: 2, atMs: 5000, value: 51.5, observationRef: "real-2" },
    { replaySeq: 5, step: 1, atMs: 41_000, value: 60, observationRef: "real-3" },
    { replaySeq: 6, step: 1, atMs: 701_000, value: 40, observationRef: "real-4" },
  ];
  return defineOrThrow({
    caseId: "case-standard",
    entityId: "e1",
    journal: standardJournal(),
    expectedOutcomes: expected,
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

export function singleObservationCase(expected: readonly ExpectedOutcomeRef[], caseId = "case-single"): BenchmarkCase {
  return defineOrThrow({
    caseId,
    entityId: "e4",
    journal: singleObservationJournal(),
    expectedOutcomes: expected,
    envelope: ENVELOPE,
  });
}

export function defineOrThrow(input: {
  readonly caseId: string;
  readonly entityId: string;
  readonly journal: readonly WorldJournalEntry[];
  readonly expectedOutcomes: readonly ExpectedOutcomeRef[];
  readonly envelope: SafetyEnvelope;
  readonly tenant?: { readonly tenantId: string };
  readonly invocation?: PredictiveInvocationParams;
  readonly contextFields?: Readonly<Record<string, string | number | boolean | null>>;
}): BenchmarkCase {
  const res = defineBenchmarkCase({
    caseId: input.caseId,
    tenant: input.tenant ?? TENANT,
    entityId: input.entityId,
    journal: input.journal,
    invocation: input.invocation ?? INVOCATION,
    expectedOutcomes: input.expectedOutcomes,
    envelope: input.envelope,
    contextFields: input.contextFields ?? CONTEXT_FIELDS,
  });
  if (!res.ok) throw new Error(`fixture case ${input.caseId} failed to define: ${res.rejected} (${res.detail})`);
  return res.benchmarkCase;
}
