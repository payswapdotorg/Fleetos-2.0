/**
 * Journey 11 — benchmark trust (persona: ml-engineer).
 *
 * An ML engineer runs a REAL benchmark battery end-to-end:
 *   - cases defined + assembled through the REAL simulation package with
 *     world journals built by the REAL world-model `nextWorldEntry`;
 *   - the REAL replay harness drives the reference model step-by-step;
 *   - scoring presents REAL numbers; the report carries them VERBATIM
 *     (caseCount, per-case hit rates, model versions, digests);
 *   - the four-check safety battery passes for a satisfied envelope;
 *   - NEGATIVE: a deliberately TIGHT envelope the model violates makes the
 *     safety section FAIL with the envelope violation VISIBLE (checkId,
 *     violation names, counts) — pass/fail honesty, never softened.
 */

import type { AcceptanceJourney } from "../journey-contracts.ts";
import { REFERENCE_MODEL_VERSION } from "@fleetos/predictive";
import {
  assembleBenchmarkReport,
  assembleBenchmarkSet,
  defineBenchmarkCase,
  replayJournal,
  runSafetyBattery,
  scoreBenchmarkSet,
  verifyBenchmarkReport,
} from "@fleetos/simulation";
import type { BenchmarkCase, ExpectedOutcomeRef, SafetyEnvelope } from "@fleetos/simulation";
import type { WorldEvent, WorldJournalEntry } from "@fleetos/world-model";
import { BASE_MS, NOW_MS, STALENESS_THRESHOLDS, TENANT, buildJournal } from "./fixture-world.ts";

const HORIZON = { steps: 3, stepMs: 1_000 } as const;
const INVOCATION = {
  modelPortName: "reference.twin.linear-drift",
  modelVersion: REFERENCE_MODEL_VERSION,
  metric: "vibration",
  horizon: HORIZON,
} as const;

const ENVELOPE: SafetyEnvelope = {
  maxAbsValue: 1000,
  minConfidenceBps: 0,
  maxBoundHalfWidth: 5,
  maxCounterfactualDeltaBps: 2500,
  perturbationOffset: 0.5,
};

/** A deliberately TIGHT envelope the reference model VIOLATES (negative). */
const TIGHT_ENVELOPE: SafetyEnvelope = {
  maxAbsValue: 250,
  minConfidenceBps: 2800,
  maxBoundHalfWidth: 0.4,
  maxCounterfactualDeltaBps: 500,
  perturbationOffset: 50,
};

const CONTEXT_FIELDS = {
  operatorName: "Ada",
  operatorContact: "ada@example",
  location: "bay-7",
  temperature: 41,
} as const;

function journalFor(entityId: string, values: readonly number[]): WorldJournalEntry[] {
  const events: readonly { readonly atMs: number; readonly event: WorldEvent }[] = [
    { atMs: BASE_MS + 1_000, event: { kind: "entity-registered", entityId, entityType: "asset" } },
    ...values.map((value, i) => ({
      atMs: BASE_MS + (i + 1) * 1_000,
      event: {
        kind: "observation-recorded",
        entityId,
        entityType: "asset",
        observationRef: `obs-${entityId}-${i + 1}`,
        observedAtMs: BASE_MS + (i + 1) * 1_000,
        value,
      } as WorldEvent,
    })),
  ];
  return buildJournal(TENANT.tenantId, events);
}

function defineOrThrow(caseId: string, entityId: string, journal: readonly WorldJournalEntry[], expected: readonly ExpectedOutcomeRef[], envelope: SafetyEnvelope): BenchmarkCase {
  const result = defineBenchmarkCase({
    caseId,
    tenant: TENANT,
    entityId,
    journal,
    invocation: INVOCATION,
    expectedOutcomes: expected,
    envelope,
    contextFields: CONTEXT_FIELDS,
  });
  if (!result.ok) throw new Error(`case ${caseId} refused: ${result.rejected} (${result.detail})`);
  return result.benchmarkCase;
}

export const benchmarkTrustJourney: AcceptanceJourney = {
  journeyId: "security.benchmark-trust",
  persona: "ml-engineer",
  capabilities: ["benchmark-trust"],
  goal: "Trust benchmark numbers: REAL scorecards + honest safety pass/fail",
  steps: [
    {
      stepId: "battery-run",
      kind: "benchmark",
      description: "Define cases, replay through the REAL harness, score and run the safety battery",
      packages: ["@fleetos/simulation", "@fleetos/world-model", "@fleetos/predictive"],
      operations: ["nextWorldEntry", "defineBenchmarkCase", "assembleBenchmarkSet", "replayJournal", "scoreBenchmarkSet", "runSafetyBattery"],
      run: (ctx) => {
        const standard = defineOrThrow(
          "case-standard",
          "pump-7",
          journalFor("pump-7", [10, 20, 30]),
          [
            { replaySeq: 4, step: 1, atMs: BASE_MS + 4_000, value: 40.5, observationRef: "real-1" },
            { replaySeq: 4, step: 2, atMs: BASE_MS + 5_000, value: 51.5, observationRef: "real-2" },
          ],
          ENVELOPE,
        );
        const short = defineOrThrow(
          "case-short",
          "pump-8",
          journalFor("pump-8", [5, 6, 7]),
          [{ replaySeq: 4, step: 1, atMs: BASE_MS + 4_000, value: 8.2, observationRef: "real-8" }],
          ENVELOPE,
        );
        const set = assembleBenchmarkSet({ tenant: TENANT, cases: [standard, short], assembledAtMs: NOW_MS });
        if (!set.ok) throw new Error(`set refused: ${set.rejected}`);
        ctx.record("bench.caseCount", set.set.cases.length);
        ctx.record("bench.modelVersions", set.set.modelVersions);
        ctx.record("bench.caseIds", set.set.cases.map((c) => c.caseId));

        const members = set.set.cases.map((c) => ({
          benchmarkCase: c,
          replay: replayJournal({ tenant: TENANT, entityId: c.entityId, journal: c.journal, invocation: INVOCATION }),
        }));
        const replayRuns = members.map((m) => {
          if (!m.replay.ok) throw new Error(`replay refused: ${m.replay.rejected} (${m.replay.detail})`);
          return m.replay.run;
        });
        ctx.record("bench.replayStepCount", replayRuns[0]!.steps.length);
        ctx.record("bench.replayExperimental", replayRuns[0]!.experimental);

        const scoring = scoreBenchmarkSet({
          tenant: TENANT,
          nowMs: NOW_MS,
          thresholds: STALENESS_THRESHOLDS,
          members: members.map((m, i) => ({ benchmarkCase: m.benchmarkCase, replay: replayRuns[i]! })),
        });
        if (!scoring.ok) throw new Error(`scoring degraded: ${scoring.degraded} (${scoring.detail})`);
        const standardScore = scoring.scoring.perCase.find((c) => c.caseId === "case-standard");
        const shortScore = scoring.scoring.perCase.find((c) => c.caseId === "case-short");
        if (standardScore === undefined || shortScore === undefined) throw new Error("per-case scores missing");
        ctx.record("scoring.caseCount", scoring.scoring.caseCount);
        ctx.record("scoring.perCaseIds", scoring.scoring.perCase.map((c) => c.caseId));
        ctx.record("scoring.standardHitRateBps", standardScore.hitRateBps);
        ctx.record("scoring.shortHitRateBps", shortScore.hitRateBps);
        ctx.record("scoring.aggregateBps", scoring.scoring.aggregate.aggregateBps);
        ctx.record("scoring.digestLength", scoring.scoring.scoringDigest.length);

        const safety = runSafetyBattery({
          tenant: TENANT,
          members: members.map((m, i) => ({ benchmarkCase: m.benchmarkCase, replay: replayRuns[i]! })),
          computedAt: "2026-10-12T18:50:00.000Z",
        });
        if (!safety.ok) throw new Error(`safety battery rejected: ${safety.rejected} (${safety.detail})`);
        ctx.record("safety.passed", safety.report.passed);
        ctx.record("safety.violationCount", safety.report.violationCount);
        ctx.record(
          "safety.checkIds",
          safety.report.checks.map((c) => c.checkId),
        );
        ctx.record("safety.advisoryNotePresent", safety.report.advisoryNote.length > 0);

        const report = assembleBenchmarkReport({
          runId: "bench-run-j11",
          tenant: TENANT,
          nowMs: NOW_MS,
          computedAt: "2026-10-12T18:50:00.000Z",
          set: set.set,
          replays: replayRuns,
          scoring: scoring.scoring,
          safety: safety.report,
        });
        if (!report.ok) throw new Error(`report refused: ${report.rejected} (${report.detail})`);
        ctx.record("report.caseCount", report.report.caseCount);
        ctx.record("report.perCaseCount", report.report.perCase.length);
        ctx.record("report.verbatimHitRates", report.report.perCase.map((c) => c.hitRateBps));
        ctx.record("report.scoringHitRates", scoring.scoring.perCase.map((c) => c.hitRateBps));
        ctx.record(
          "report.hitRatesMatchScoring",
          JSON.stringify(report.report.perCase.map((c) => c.hitRateBps)) === JSON.stringify(scoring.scoring.perCase.map((c) => c.hitRateBps)),
        );
        ctx.record("report.safetyPassed", report.report.safety.passed);
        ctx.record("report.verified", verifyBenchmarkReport(report.report).ok);
        ctx.record("report.experimental", report.report.experimental);
      },
    },
    {
      stepId: "envelope-violation-honesty",
      kind: "negative-check",
      description: "A TIGHT envelope the model violates FAILS the safety section visibly",
      packages: ["@fleetos/simulation"],
      operations: ["defineBenchmarkCase", "replayJournal", "runSafetyBattery"],
      run: (ctx) => {
        const tight = defineOrThrow(
          "case-tight",
          "pump-9",
          journalFor("pump-9", [0, 100, 200]),
          [{ replaySeq: 4, step: 1, atMs: BASE_MS + 4_000, value: 300, observationRef: "real-9" }],
          TIGHT_ENVELOPE,
        );
        const replay = replayJournal({ tenant: TENANT, entityId: tight.entityId, journal: tight.journal, invocation: INVOCATION });
        if (!replay.ok) throw new Error(`replay refused: ${replay.rejected}`);
        const safety = runSafetyBattery({
          tenant: TENANT,
          members: [{ benchmarkCase: tight, replay: replay.run }],
          computedAt: "2026-10-12T18:50:00.000Z",
        });
        if (!safety.ok) throw new Error(`safety battery rejected: ${safety.rejected}`);
        const envelopeCheck = safety.report.checks.find((c) => c.checkId === "advisory-envelope");
        if (envelopeCheck === undefined || !("violations" in envelopeCheck)) throw new Error("advisory-envelope check missing");
        ctx.record("tight.passed", safety.report.passed);
        ctx.record("tight.violationCount", safety.report.violationCount);
        ctx.record("tight.envelopePassed", envelopeCheck.passed);
        ctx.record("tight.envelopeViolationCount", envelopeCheck.violationCount);
        ctx.record(
          "tight.violationKinds",
          [...new Set(envelopeCheck.violations.map((v) => v.violation))].sort(),
        );
        ctx.record("tight.firstViolationCase", envelopeCheck.violations[0]?.caseId ?? "none");
        ctx.record("tight.firstViolationLimit", envelopeCheck.violations[0]?.limit ?? -1);
      },
    },
  ],
  assertions: [
    { assertionId: "bt-1", description: "Set carries both cases", path: "bench.caseCount", expected: 2 },
    { assertionId: "bt-2", description: "Model versions pinned verbatim", path: "bench.modelVersions", expected: [REFERENCE_MODEL_VERSION] },
    { assertionId: "bt-3", description: "Case ids in deterministic order", path: "bench.caseIds", expected: ["case-short", "case-standard"] },
    { assertionId: "bt-4", description: "Replay walks every journal seq", path: "bench.replayStepCount", expected: 4 },
    { assertionId: "bt-5", description: "Replay carries the EXPERIMENTAL marker (A11)", path: "bench.replayExperimental", expected: true },
    { assertionId: "bt-6", description: "Scoring covers the set", path: "scoring.caseCount", expected: 2 },
    { assertionId: "bt-7", description: "Per-case ids in caseId asc order", path: "scoring.perCaseIds", expected: ["case-short", "case-standard"] },
    { assertionId: "bt-8", description: "Standard case hit rate presented (REAL number)", path: "scoring.standardHitRateBps", expected: 5000 },
    { assertionId: "bt-9", description: "Short case hit rate presented (REAL number)", path: "scoring.shortHitRateBps", expected: 10000 },
    { assertionId: "bt-10", description: "Set aggregate score presented (fixed weights)", path: "scoring.aggregateBps", expected: 7599 },
    { assertionId: "bt-11", description: "Scoring digest is FNV-1a 8-hex", path: "scoring.digestLength", expected: 8 },
    { assertionId: "bt-12", description: "Satisfied envelope: safety battery PASSES", path: "safety.passed", expected: true },
    { assertionId: "bt-13", description: "Zero violations for the satisfied envelope", path: "safety.violationCount", expected: 0 },
    { assertionId: "bt-14", description: "All four safety checks run in fixed order", path: "safety.checkIds", expected: ["advisory-envelope", "counterfactual-margin", "cannot-write-state", "redaction-integrity"] },
    { assertionId: "bt-15", description: "Advisory note carried on the safety report", path: "safety.advisoryNotePresent", expected: true },
    { assertionId: "bt-16", description: "Report case count matches the set", path: "report.caseCount", expected: 2 },
    { assertionId: "bt-17", description: "Report per-case entries present", path: "report.perCaseCount", expected: 2 },
    { assertionId: "bt-18", description: "Report presents REAL hit rates verbatim", path: "report.verbatimHitRates", expected: [10000, 5000] },
    { assertionId: "bt-19", description: "Report hit rates are the scoring's hit rates", path: "report.hitRatesMatchScoring", expected: true },
    { assertionId: "bt-20", description: "Report safety section passes for the satisfied envelope", path: "report.safetyPassed", expected: true },
    { assertionId: "bt-21", description: "Report verification passes", path: "report.verified", expected: true },
    { assertionId: "bt-22", description: "Report carries the EXPERIMENTAL marker", path: "report.experimental", expected: true },
    { assertionId: "bt-23", description: "TIGHT envelope: the safety section FAILS", path: "tight.passed", expected: false },
    { assertionId: "bt-24", description: "Violations are counted, not softened", path: "tight.violationCount", expected: 23 },
    { assertionId: "bt-25", description: "The advisory-envelope check itself fails", path: "tight.envelopePassed", expected: false },
    { assertionId: "bt-26", description: "Envelope violations visible with counts", path: "tight.envelopeViolationCount", expected: 22 },
    { assertionId: "bt-27", description: "Violation kinds named (bound-width + confidence + value)", path: "tight.violationKinds", expected: ["bound-width", "confidence", "value"] },
    { assertionId: "bt-28", description: "The violating case is named", path: "tight.firstViolationCase", expected: "case-tight" },
    { assertionId: "bt-29", description: "The violated limit is presented", path: "tight.firstViolationLimit", expected: 0.4 },
  ],
};
