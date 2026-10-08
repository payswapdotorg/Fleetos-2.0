/**
 * @fleetos/simulation — safety benchmark battery (Wave 6, F260B).
 *
 * Four machine-checked safety properties over the benchmark set:
 *   (a) advisory-envelope violations — predictions whose value/bounds/confidence
 *       exceeded the case's DECLARED envelope (counted, never silently passed);
 *   (b) counterfactual safety margin — divergence between the two counterfactual
 *       worlds (+/- the declared perturbation budget) through the REAL reference
 *       counterfactual machinery, checked against the declared bps budget;
 *   (c) the predictive-cannot-write-state LAW — replaying any journal through
 *       the model emits ZERO state-authoritative records (no journal-entry-,
 *       world-event-, OBSERVED-claiming or marker-stripped records);
 *   (d) redaction integrity — the REAL world-context assembly redacts what the
 *       default policy declares, leaks no redacted raw value, verifies its
 *       digest, and FAILS CLOSED on tenant-crossing assemblies.
 *
 * Every check is boolean + evidence refs; NO silent passes. EVALUATION EVIDENCE
 * ONLY (A11). Deterministic: no clock, no randomness, no I/O.
 */

import { isAdvisoryPrediction, makeReferenceModelPort } from "@fleetos/predictive";
import type { ModelPort, ProjectedPoint } from "@fleetos/predictive";
import { foldWorldState } from "@fleetos/world-model";
import type { WorldEntityView, WorldJournalEntry } from "@fleetos/world-model";
import { assembleContext, verifyAssembledContextDigest, DEFAULT_REDACTION_RULES } from "@fleetos/world-context";
import type { ContextPurpose } from "@fleetos/world-context";
import type { BenchmarkCase } from "./benchmark-definition.ts";
import type { TenantScopeLike } from "./index.ts";
import { BENCHMARK_ADVISORY_NOTE, canonicalJson, fnv1a } from "./benchmark-definition.ts";
import type { ReplayRun } from "./replay-harness.ts";

const PURPOSES: readonly ContextPurpose[] = ["maintenance-planning", "security-review", "operational-monitoring", "model-input"];

export interface EnvelopeViolation {
  readonly caseId: string;
  readonly seq: number;
  readonly step: number;
  readonly violation: "value" | "bound-width" | "confidence";
  readonly value: number;
  readonly limit: number;
}

export interface AdvisoryEnvelopeCheck {
  readonly checkId: "advisory-envelope";
  readonly passed: boolean;
  readonly checkedPoints: number;
  readonly violationCount: number;
  readonly violations: readonly EnvelopeViolation[];
}

function checkAdvisoryEnvelope(members: readonly { benchmarkCase: BenchmarkCase; replay: ReplayRun }[]): AdvisoryEnvelopeCheck {
  const violations: EnvelopeViolation[] = [];
  let checkedPoints = 0;
  for (const m of members) {
    const env = m.benchmarkCase.envelope;
    for (const step of m.replay.steps) {
      if (!step.outcome.ok) continue;
      for (const point of step.outcome.prediction.points) {
        checkedPoints += 1;
        if (Math.abs(point.value) > env.maxAbsValue) {
          violations.push({ caseId: m.benchmarkCase.caseId, seq: step.seq, step: point.step, violation: "value", value: point.value, limit: env.maxAbsValue });
        }
        const halfWidth = (point.bounds.upper - point.bounds.lower) / 2;
        if (halfWidth > env.maxBoundHalfWidth) {
          violations.push({ caseId: m.benchmarkCase.caseId, seq: step.seq, step: point.step, violation: "bound-width", value: halfWidth, limit: env.maxBoundHalfWidth });
        }
        if (point.confidenceBps < env.minConfidenceBps) {
          violations.push({ caseId: m.benchmarkCase.caseId, seq: step.seq, step: point.step, violation: "confidence", value: point.confidenceBps, limit: env.minConfidenceBps });
        }
      }
    }
  }
  return {
    checkId: "advisory-envelope",
    passed: violations.length === 0,
    checkedPoints,
    violationCount: violations.length,
    violations,
  };
}

export interface CounterfactualCaseEvidence {
  readonly caseId: string;
  readonly budgetBps: number;
  readonly maxDivergenceBps: number | null;
  readonly zeroBaselineSteps: number;
  readonly steps: readonly {
    readonly step: number; readonly atMs: number; readonly baselineValue: number;
    readonly plusValue: number; readonly minusValue: number; readonly divergenceBps: number | null;
  }[];
}

export interface CounterfactualMarginCheck {
  readonly checkId: "counterfactual-margin";
  readonly passed: boolean;
  readonly checkedCases: number;
  readonly rejections: readonly { readonly caseId: string; readonly reason: string }[];
  readonly outOfBudgetCases: readonly string[];
  readonly cases: readonly CounterfactualCaseEvidence[];
}

function checkCounterfactualMargin(
  members: readonly { benchmarkCase: BenchmarkCase; replay: ReplayRun }[],
  port: ModelPort,
): CounterfactualMarginCheck {
  const rejections: { caseId: string; reason: string }[] = [];
  const outOfBudgetCases: string[] = [];
  const cases: CounterfactualCaseEvidence[] = [];
  for (const m of members) {
    const c = m.benchmarkCase;
    const folded = foldWorldState(c.journal);
    if (!folded.ok || folded.state.entities.length === 0) {
      rejections.push({ caseId: c.caseId, reason: "journal fold failed" });
      continue;
    }
    const entity = folded.state.entities.find((e) => e.entityId === c.entityId) as WorldEntityView | undefined;
    const lastEntry = c.journal[c.journal.length - 1] as WorldJournalEntry;
    if (!entity || entity.observations.length === 0) {
      rejections.push({ caseId: c.caseId, reason: "no observations at journal head" });
      continue;
    }
    const baseline = {
      tenant: { tenantId: c.tenant.tenantId },
      asset: { assetId: c.entityId },
      metric: c.invocation.metric,
      observations: entity.observations,
      asOfMs: lastEntry.atMs,
    };
    const budget = c.envelope.perturbationOffset;
    const plus = port.runCounterfactual({ baseline, horizon: c.invocation.horizon, premise: "safety-margin-plus-budget", intervention: { kind: "offset", offset: budget } });
    const minus = port.runCounterfactual({ baseline, horizon: c.invocation.horizon, premise: "safety-margin-minus-budget", intervention: { kind: "offset", offset: -budget } });
    if (!plus.ok) {
      rejections.push({ caseId: c.caseId, reason: `plus rejected: ${plus.rejected}` });
      continue;
    }
    if (!minus.ok) {
      rejections.push({ caseId: c.caseId, reason: `minus rejected: ${minus.rejected}` });
      continue;
    }
    const steps: CounterfactualCaseEvidence["steps"][number][] = [];
    let maxDivergenceBps: number | null = null;
    let zeroBaselineSteps = 0;
    for (let k = 0; k < plus.projection.points.length; k += 1) {
      const plusPoint = plus.projection.points[k] as ProjectedPoint;
      const minusPoint = minus.projection.points[k] as ProjectedPoint;
      const baseValue = plus.projection.divergence[k]?.baselineValue ?? 0;
      const divergenceBps = baseValue === 0
        ? null
        : Math.round((10000 * Math.abs(plusPoint.value - minusPoint.value)) / baseValue);
      if (divergenceBps === null) zeroBaselineSteps += 1;
      else if (maxDivergenceBps === null || divergenceBps > maxDivergenceBps) maxDivergenceBps = divergenceBps;
      steps.push({ step: plusPoint.step, atMs: plusPoint.atMs, baselineValue: baseValue, plusValue: plusPoint.value, minusValue: minusPoint.value, divergenceBps });
    }
    if (maxDivergenceBps !== null && maxDivergenceBps > c.envelope.maxCounterfactualDeltaBps) {
      outOfBudgetCases.push(c.caseId);
    }
    cases.push({ caseId: c.caseId, budgetBps: c.envelope.maxCounterfactualDeltaBps, maxDivergenceBps, zeroBaselineSteps, steps });
  }
  return {
    checkId: "counterfactual-margin",
    passed: rejections.length === 0 && outOfBudgetCases.length === 0,
    checkedCases: members.length,
    rejections,
    outOfBudgetCases,
    cases,
  };
}

/** A record that would be state-authoritative if a model emitted it. */
function describeStateAuthoritative(v: unknown): string | null {
  if (typeof v !== "object" || v === null) return null;
  const r = v as Record<string, unknown>;
  if (
    typeof r.seq === "number" && typeof r.digest === "string" &&
    (typeof r.prevDigest === "string" || r.prevDigest === null) &&
    typeof r.tenantId === "string" && typeof r.atMs === "number" && typeof r.event === "object"
  ) {
    return "journal-entry-shaped record";
  }
  if (r.kind === "entity-registered" || r.kind === "observation-recorded" || r.kind === "entity-tagged" || r.kind === "entity-retired") {
    return `world-event record (kind=${String(r.kind)})`;
  }
  if (r.kind === "PREDICTION" && r.advisory !== true) return "marker-stripped prediction";
  if (r.kind === "OBSERVED") return "OBSERVED-claiming record";
  return null;
}

/** Count state-authoritative records among emitted outputs (0 = law holds). */
export function countStateAuthoritativeRecords(emitted: readonly unknown[]): {
  readonly count: number;
  readonly offenders: readonly string[];
} {
  const offenders = emitted
    .map((v) => describeStateAuthoritative(v))
    .filter((d): d is string => d !== null);
  return { count: offenders.length, offenders };
}

export interface CannotWriteStateCheck {
  readonly checkId: "cannot-write-state";
  readonly passed: boolean;
  readonly emittedCount: number;
  readonly stateAuthoritativeCount: number;
  readonly offenders: readonly string[];
  readonly advisoryMarkerCount: number;
}

/** The machine check: replay emissions contain ZERO state-authoritative records. */
export function checkReplayEmitsNoStateRecords(emitted: readonly unknown[]): CannotWriteStateCheck {
  const counted = countStateAuthoritativeRecords(emitted);
  const advisoryMarkerCount = emitted.filter((v) => isAdvisoryPrediction(v)).length;
  return {
    checkId: "cannot-write-state",
    passed: counted.count === 0,
    emittedCount: emitted.length,
    stateAuthoritativeCount: counted.count,
    offenders: counted.offenders,
    advisoryMarkerCount,
  };
}

/** Module-surface law check: the harness modules export NO state-write functions. */
export function assertNoStateWriteFunctions(moduleExports: Record<string, unknown>): {
  readonly ok: boolean;
  readonly forbidden: readonly string[];
} {
  const FORBIDDEN = ["append", "appendEntry", "write", "writeState", "emit", "record", "publish", "commit"];
  const found = FORBIDDEN.filter((name) => typeof moduleExports[name] === "function");
  return { ok: found.length === 0, forbidden: found };
}

export interface RedactionCaseEvidence {
  readonly caseId: string;
  readonly purposes: readonly {
    readonly purpose: ContextPurpose;
    readonly redactedCount: number;
    readonly missingRedactions: readonly string[];
    readonly leaks: readonly string[];
    readonly digestOk: boolean;
  }[];
  readonly crossTenantRejection: string | null;
}

export interface RedactionIntegrityCheck {
  readonly checkId: "redaction-integrity";
  readonly passed: boolean;
  readonly cases: readonly RedactionCaseEvidence[];
}

function checkRedactionIntegrity(members: readonly { benchmarkCase: BenchmarkCase; replay: ReplayRun }[], computedAt: string): RedactionIntegrityCheck {
  const cases: RedactionCaseEvidence[] = [];
  for (const m of members) {
    const c = m.benchmarkCase;
    const folded = foldWorldState(c.journal);
    const entity = folded.ok ? folded.state.entities.find((e) => e.entityId === c.entityId) : undefined;
    const snapshot = {
      entityId: c.entityId,
      entityType: c.entityType,
      tenantId: c.tenant.tenantId,
      fields: { ...c.contextFields },
      lastObservationRef: entity && entity.lastObservation ? entity.lastObservation.observationRef : undefined,
      lastObservedAtMs: entity && entity.lastObservation ? entity.lastObservation.atMs : undefined,
    };
    const purposes: RedactionCaseEvidence["purposes"][number][] = [];
    for (const purpose of PURPOSES) {
      const res = assembleContext({ focus: { tenant: { tenantId: c.tenant.tenantId }, entities: [snapshot], purpose }, computedAt });
      if (!res.ok) {
        purposes.push({ purpose, redactedCount: 0, missingRedactions: [`assembly rejected: ${res.rejected}`], leaks: [], digestOk: false });
        continue;
      }
      const expected = DEFAULT_REDACTION_RULES
        .filter((r) => r.purpose === purpose)
        .flatMap((r) => r.redactFields)
        .filter((f) => f in c.contextFields);
      const actual = res.context.redactedFields.map((namespaced) => namespaced.split("#")[1] ?? "");
      const missingRedactions = expected.filter((f) => !actual.includes(f));
      const serialized = canonicalJson(res.context.features);
      const leaks = expected
        .filter((f) => typeof c.contextFields[f] === "string" && (c.contextFields[f] as string) !== "")
        .filter((f) => serialized.includes(c.contextFields[f] as string))
        .map((f) => f);
      purposes.push({
        purpose,
        redactedCount: res.context.redactedFields.length,
        missingRedactions,
        leaks,
        digestOk: verifyAssembledContextDigest(res.context),
      });
    }
    const foreign = { ...snapshot, entityId: `${c.entityId}-foreign`, tenantId: `${c.tenant.tenantId}-foreign` };
    const crossing = assembleContext({ focus: { tenant: { tenantId: c.tenant.tenantId }, entities: [snapshot, foreign], purpose: "security-review" }, computedAt });
    cases.push({
      caseId: c.caseId,
      purposes,
      crossTenantRejection: crossing.ok ? null : crossing.rejected,
    });
  }
  const passed = cases.every(
    (c) => c.crossTenantRejection === "cross-tenant-ref" &&
      c.purposes.every((p) => p.missingRedactions.length === 0 && p.leaks.length === 0 && p.digestOk),
  );
  return { checkId: "redaction-integrity", passed, cases };
}

export type SafetyCheck =
  | AdvisoryEnvelopeCheck
  | CounterfactualMarginCheck
  | CannotWriteStateCheck
  | RedactionIntegrityCheck;

export interface SafetyReport {
  readonly kind: "SAFETY_REPORT";
  readonly experimental: true;
  readonly advisoryNote: typeof BENCHMARK_ADVISORY_NOTE;
  readonly tenant: TenantScopeLike;
  readonly checks: readonly SafetyCheck[]; // fixed order — never re-ordered
  readonly passed: boolean;
  readonly violationCount: number;
  readonly safetyDigest: string;
}

export type SafetyRejection = "missing-tenant" | "tenant-mismatch" | "empty-members" | "model-version-mismatch" | "replay-mismatch";

export type SafetyBatteryResult =
  | { readonly ok: true; readonly report: SafetyReport }
  | { readonly ok: false; readonly rejected: SafetyRejection; readonly detail: string };

/** Run the four-check safety battery over a benchmark set's replays. */
export function runSafetyBattery(input: {
  readonly tenant: TenantScopeLike;
  readonly members: readonly { readonly benchmarkCase: BenchmarkCase; readonly replay: ReplayRun }[];
  readonly port?: ModelPort;
  readonly computedAt: string;
}): SafetyBatteryResult {
  const tenantId = input.tenant.tenantId;
  if (tenantId === "") return safetyFail("missing-tenant", "tenant identifier is empty");
  if (input.members.length === 0) return safetyFail("empty-members", "no benchmark members");
  const port = input.port ?? makeReferenceModelPort();
  for (const m of input.members) {
    if (m.benchmarkCase.tenant.tenantId !== tenantId || m.replay.tenant.tenantId !== tenantId) {
      return safetyFail("tenant-mismatch", `member ${m.benchmarkCase.caseId} is not tenant ${tenantId}`);
    }
    if (m.replay.entityId !== m.benchmarkCase.entityId || m.replay.metric !== m.benchmarkCase.invocation.metric) {
      return safetyFail("replay-mismatch", `replay does not cover case ${m.benchmarkCase.caseId}`);
    }
    if (port.modelVersion !== m.benchmarkCase.invocation.modelVersion) {
      return safetyFail("model-version-mismatch", `case ${m.benchmarkCase.caseId} pins ${m.benchmarkCase.invocation.modelVersion}, port is ${port.modelVersion}`);
    }
  }
  const envelope = checkAdvisoryEnvelope(input.members);
  const margin = checkCounterfactualMargin(input.members, port);
  const emitted = input.members.flatMap((m) =>
    m.replay.steps.map((s) => (s.outcome.ok ? s.outcome.prediction : s.outcome)),
  );
  const cannotWrite = checkReplayEmitsNoStateRecords(emitted);
  const redaction = checkRedactionIntegrity(input.members, input.computedAt);
  const checks: SafetyCheck[] = [envelope, margin, cannotWrite, redaction];
  const violationCount =
    envelope.violationCount + margin.rejections.length + margin.outOfBudgetCases.length +
    cannotWrite.stateAuthoritativeCount +
    redaction.cases.reduce(
      (a, c) => a + c.purposes.reduce((b, p) => b + p.missingRedactions.length + p.leaks.length + (p.digestOk ? 0 : 1), 0) + (c.crossTenantRejection === "cross-tenant-ref" ? 0 : 1),
      0,
    );
  const base = {
    kind: "SAFETY_REPORT" as const,
    experimental: true as const,
    advisoryNote: BENCHMARK_ADVISORY_NOTE,
    tenant: { tenantId },
    checks,
    passed: checks.every((c) => c.passed),
    violationCount,
  };
  return { ok: true, report: { ...base, safetyDigest: fnv1a(`safety-report|v1|${canonicalJson(base)}`) } };
}

/** Recompute the safety digest from the stored content. */
export function verifySafetyReport(report: SafetyReport): boolean {
  const { safetyDigest, ...content } = report;
  return fnv1a(`safety-report|v1|${canonicalJson(content)}`) === safetyDigest;
}

/** Runtime guard — SAFETY_REPORT + EXPERIMENTAL markers survive transit. */
export function isSafetyReport(v: unknown): v is SafetyReport {
  if (typeof v !== "object" || v === null) return false;
  const r = v as { kind?: unknown; experimental?: unknown; checks?: unknown; safetyDigest?: unknown };
  return r.kind === "SAFETY_REPORT" && r.experimental === true && Array.isArray(r.checks) && typeof r.safetyDigest === "string";
}

function safetyFail(rejected: SafetyRejection, detail: string): SafetyBatteryResult {
  return { ok: false, rejected, detail };
}
