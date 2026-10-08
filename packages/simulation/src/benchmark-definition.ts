/**
 * @fleetos/simulation — benchmark case + set definition (Wave 6, F260B).
 *
 * A benchmark case binds together:
 *   - a world-model journal SEGMENT (digest-chained, single-tenant — the
 *     historical world the case replays over),
 *   - predictive model invocation params (pinned model identity + horizon),
 *   - expected-outcome references (realized values with authoritative
 *     observation refs), and
 *   - safety-envelope constraints (declared limits the benchmark holds the
 *     model to).
 *
 * LAW (A2/A11): benchmarks are EVALUATION EVIDENCE ONLY — never operational
 * truth, never self-adopting. Every artifact built from these definitions
 * carries explicit EXPERIMENTAL markers (see replay-harness/scoring/
 * safety-benchmarks/benchmark-report).
 *
 * Deterministic: no clock, no randomness, no I/O. Logical time is
 * caller-supplied integer milliseconds everywhere. Digests are FNV-1a over a
 * canonical (recursively key-sorted) JSON serialization — the lane's
 * established convention (F230B/F250B).
 */

import type { WorldJournalEntry } from "@fleetos/world-model";
import { foldWorldState } from "@fleetos/world-model";
import type { ProjectionHorizon } from "@fleetos/predictive";
import { MAX_PROJECTION_STEPS } from "@fleetos/predictive";
import type { TenantScopeLike } from "./index.ts";

/** Advisory note carried by every F260B benchmark artifact. */
export const BENCHMARK_ADVISORY_NOTE =
  "BENCHMARK EVIDENCE — EXPERIMENTAL, ADVISORY ONLY, NEVER OPERATIONAL TRUTH" as const;

// ---------------------------------------------------------------------------
// Deterministic digest helpers (shared by the F260B modules; arena precedent)
// ---------------------------------------------------------------------------

/** FNV-1a 32-bit — deterministic, not cryptographic. */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Canonical JSON: object keys recursively sorted, `undefined` skipped. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return value === undefined ? "null" : JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(",")}]`;
  }
  const rec = value as Record<string, unknown>;
  const keys = Object.keys(rec)
    .filter((k) => rec[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(rec[k])}`).join(",")}}`;
}

// ---------------------------------------------------------------------------
// Case contracts
// ---------------------------------------------------------------------------

/** Predictive model invocation params — the model the case pins. */
export interface PredictiveInvocationParams {
  /** Adapter identity (e.g. "reference.twin.linear-drift"). */
  readonly modelPortName: string;
  /** Pinned model version — the replay fails closed on a mismatch. */
  readonly modelVersion: string;
  readonly metric: string;
  readonly horizon: ProjectionHorizon;
}

/** A realized outcome the replay's predictions are scored against. */
export interface ExpectedOutcomeRef {
  /** 1-based journal seq whose replay-step prediction this outcome scores. */
  readonly replaySeq: number;
  /** 1-based horizon step of the predicted point this outcome scores. */
  readonly step: number;
  /** Must equal journal[replaySeq-1].atMs + step * horizon.stepMs. */
  readonly atMs: number;
  readonly value: number;
  /** Authoritative observation ref for the realized value (caller-supplied). */
  readonly observationRef: string;
}

/** Declared safety envelope the benchmark holds the model to. */
export interface SafetyEnvelope {
  /** |predicted value| ceiling (value units). */
  readonly maxAbsValue: number;
  /** Integer-bps floor for per-point confidence. */
  readonly minConfidenceBps: number;
  /** Bounds half-width ceiling (value units). */
  readonly maxBoundHalfWidth: number;
  /** Integer-bps ceiling on counterfactual-world divergence. */
  readonly maxCounterfactualDeltaBps: number;
  /** Declared perturbation magnitude (value units) applied +/- in the margin check. */
  readonly perturbationOffset: number;
}

export type ContextFieldValue = string | number | boolean | null;

/** One benchmark case — definition only; it executes nothing. */
export interface BenchmarkCase {
  readonly kind: "BENCHMARK_CASE";
  readonly caseId: string;
  readonly tenant: TenantScopeLike;
  readonly entityId: string;
  readonly entityType: "asset" | "agent" | "org";
  readonly journal: readonly WorldJournalEntry[];
  readonly invocation: PredictiveInvocationParams;
  readonly expectedOutcomes: readonly ExpectedOutcomeRef[];
  readonly envelope: SafetyEnvelope;
  /** Entity fields fed to redaction-integrity assemblies (caller-supplied). */
  readonly contextFields: Readonly<Record<string, ContextFieldValue>>;
  readonly caseDigest: string;
}

export type CaseRejection =
  | "missing-tenant"
  | "missing-case-id"
  | "missing-entity"
  | "invalid-invocation"
  | "invalid-horizon"
  | "empty-journal"
  | "journal-invalid"
  | "tenant-mismatch"
  | "unknown-entity"
  | "empty-history"
  | "invalid-context-fields"
  | "invalid-envelope"
  | "missing-expected-outcomes"
  | "invalid-expected-outcome"
  | "expected-time-mismatch"
  | "duplicate-expected-step";

export type BenchmarkCaseResult =
  | { readonly ok: true; readonly benchmarkCase: BenchmarkCase }
  | { readonly ok: false; readonly rejected: CaseRejection; readonly detail: string };

// ---------------------------------------------------------------------------
// Case definition
// ---------------------------------------------------------------------------

/**
 * Define (validate + digest) a benchmark case. Fail-closed on every malformed
 * input; the journal must fold cleanly through the REAL world-model fold.
 */
export function defineBenchmarkCase(input: {
  readonly caseId: string;
  readonly tenant: TenantScopeLike;
  readonly entityId: string;
  readonly journal: readonly WorldJournalEntry[];
  readonly invocation: PredictiveInvocationParams;
  readonly expectedOutcomes: readonly ExpectedOutcomeRef[];
  readonly envelope: SafetyEnvelope;
  readonly contextFields: Readonly<Record<string, ContextFieldValue>>;
}): BenchmarkCaseResult {
  const tenantId = input.tenant.tenantId;
  if (tenantId === "") return reject("missing-tenant", "tenant identifier is empty");
  if (input.caseId === "") return reject("missing-case-id", "caseId is empty");
  if (input.entityId === "") return reject("missing-entity", "entityId is empty");
  const inv = input.invocation;
  if (
    inv.modelPortName === "" || inv.modelVersion === "" || inv.metric === ""
  ) {
    return reject("invalid-invocation", "modelPortName, modelVersion and metric are required");
  }
  if (
    !Number.isInteger(inv.horizon.steps) || inv.horizon.steps < 1 ||
    !Number.isInteger(inv.horizon.stepMs) || inv.horizon.stepMs < 1 ||
    inv.horizon.steps > MAX_PROJECTION_STEPS
  ) {
    return reject(
      "invalid-horizon",
      `horizon requires integer steps in [1, ${MAX_PROJECTION_STEPS}] and integer stepMs >= 1`,
    );
  }
  if (input.journal.length === 0) {
    return reject("empty-journal", "journal segment is empty");
  }
  const folded = foldWorldState(input.journal);
  if (!folded.ok) {
    return reject("journal-invalid", `world fold rejected: ${folded.rejected} (${folded.detail})`);
  }
  const first = input.journal[0] as WorldJournalEntry;
  if (first.tenantId !== tenantId) {
    return reject(
      "tenant-mismatch",
      `journal belongs to tenant ${first.tenantId}, case declares ${tenantId}`,
    );
  }
  const entity = folded.state.entities.find((e) => e.entityId === input.entityId);
  if (!entity) return reject("unknown-entity", `entity ${input.entityId} not in journal state`);
  if (entity.observations.length === 0) {
    return reject("empty-history", `entity ${input.entityId} has no observations`);
  }
  const fieldsOk = Object.keys(input.contextFields).length > 0 &&
    Object.entries(input.contextFields).every(
      ([k, v]) => k !== "" && (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v === null),
    );
  if (!fieldsOk) {
    return reject("invalid-context-fields", "contextFields must be a non-empty record of string|number|boolean|null");
  }
  if (!validEnvelope(input.envelope)) {
    return reject("invalid-envelope", "envelope limits are malformed (see SafetyEnvelope docs)");
  }
  if (input.expectedOutcomes.length === 0) {
    return reject("missing-expected-outcomes", "at least one expected outcome is required");
  }
  const seen = new Set<string>();
  for (const o of input.expectedOutcomes) {
    const key = `${o.replaySeq}#${o.step}`;
    if (seen.has(key)) {
      return reject("duplicate-expected-step", `duplicate expected outcome for seq/step ${key}`);
    }
    seen.add(key);
    if (!Number.isInteger(o.replaySeq) || o.replaySeq < 1 || o.replaySeq > input.journal.length) {
      return reject("invalid-expected-outcome", `replaySeq ${o.replaySeq} outside journal [1, ${input.journal.length}]`);
    }
    if (!Number.isInteger(o.step) || o.step < 1 || o.step > inv.horizon.steps) {
      return reject("invalid-expected-outcome", `step ${o.step} outside horizon [1, ${inv.horizon.steps}]`);
    }
    if (!Number.isInteger(o.atMs) || !Number.isFinite(o.value) || o.observationRef === "") {
      return reject("invalid-expected-outcome", "atMs must be an integer, value finite, observationRef non-empty");
    }
    const entry = input.journal[o.replaySeq - 1] as WorldJournalEntry;
    const expectedAt = entry.atMs + o.step * inv.horizon.stepMs;
    if (o.atMs !== expectedAt) {
      return reject(
        "expected-time-mismatch",
        `outcome atMs ${o.atMs} != journal seq ${o.replaySeq} atMs ${entry.atMs} + ${o.step}x${inv.horizon.stepMs}`,
      );
    }
  }
  const benchmarkCase: Omit<BenchmarkCase, "caseDigest"> = {
    kind: "BENCHMARK_CASE",
    caseId: input.caseId,
    tenant: input.tenant,
    entityId: input.entityId,
    entityType: entity.entityType,
    journal: input.journal,
    invocation: inv,
    expectedOutcomes: [...input.expectedOutcomes],
    envelope: input.envelope,
    contextFields: input.contextFields,
  };
  return { ok: true, benchmarkCase: { ...benchmarkCase, caseDigest: benchmarkCaseDigest(benchmarkCase) } };
}

function validEnvelope(e: SafetyEnvelope): boolean {
  return (
    Number.isFinite(e.maxAbsValue) && e.maxAbsValue > 0 &&
    Number.isInteger(e.minConfidenceBps) && e.minConfidenceBps >= 0 && e.minConfidenceBps <= 10000 &&
    Number.isFinite(e.maxBoundHalfWidth) && e.maxBoundHalfWidth > 0 &&
    Number.isInteger(e.maxCounterfactualDeltaBps) && e.maxCounterfactualDeltaBps >= 0 &&
    e.maxCounterfactualDeltaBps <= 10000 &&
    Number.isFinite(e.perturbationOffset) && e.perturbationOffset !== 0
  );
}

function setReject(rejected: SetRejection, detail: string): BenchmarkSetResult {
  return { ok: false, rejected, detail };
}

function reject(rejected: CaseRejection, detail: string): BenchmarkCaseResult {
  return { ok: false, rejected, detail };
}

// ---------------------------------------------------------------------------
// Case digest
// ---------------------------------------------------------------------------

/** Deterministic case digest over the journal head (chained) + all params. */
export function benchmarkCaseDigest(c: Omit<BenchmarkCase, "caseDigest">): string {
  const last = c.journal[c.journal.length - 1] as WorldJournalEntry;
  const expected = [...c.expectedOutcomes].sort((a, b) =>
    a.replaySeq - b.replaySeq || a.step - b.step,
  );
  return fnv1a(
    `bench-case|v1|${canonicalJson({
      caseId: c.caseId,
      tenantId: c.tenant.tenantId,
      entityId: c.entityId,
      entityType: c.entityType,
      journalLength: c.journal.length,
      journalHeadDigest: last.digest,
      invocation: c.invocation,
      expectedOutcomes: expected,
      envelope: c.envelope,
      contextFields: c.contextFields,
    })}`,
  );
}

// ---------------------------------------------------------------------------
// Benchmark set
// ---------------------------------------------------------------------------

/** A benchmark set — deterministic ordering + set digest; executes nothing. */
export interface BenchmarkSet {
  readonly kind: "BENCHMARK_SET";
  readonly tenant: TenantScopeLike;
  readonly cases: readonly BenchmarkCase[]; // caseId asc — input order never leaks
  readonly caseDigests: readonly string[];
  readonly modelVersions: readonly string[]; // sorted unique
  readonly assembledAtMs: number;
  readonly setDigest: string;
}

export type SetRejection =
  | "missing-tenant"
  | "empty-set"
  | "cross-tenant-case"
  | "duplicate-case-id"
  | "invalid-assembled-at";

export type BenchmarkSetResult =
  | { readonly ok: true; readonly set: BenchmarkSet }
  | { readonly ok: false; readonly rejected: SetRejection; readonly detail: string };

/** Assemble a benchmark set — deterministic ordering + digest, tenant fail-closed. */
export function assembleBenchmarkSet(input: {
  readonly tenant: TenantScopeLike;
  readonly cases: readonly BenchmarkCase[];
  readonly assembledAtMs: number;
}): BenchmarkSetResult {
  const tenantId = input.tenant.tenantId;
  if (tenantId === "") return setReject("missing-tenant", "tenant identifier is empty");
  if (!Number.isInteger(input.assembledAtMs) || input.assembledAtMs < 0) {
    return setReject("invalid-assembled-at", "assembledAtMs must be a non-negative integer");
  }
  if (input.cases.length === 0) return setReject("empty-set", "case set is empty");
  for (const c of input.cases) {
    if (c.tenant.tenantId !== tenantId) {
      return setReject(
        "cross-tenant-case",
        `case ${c.caseId} belongs to tenant ${c.tenant.tenantId}, set declares ${tenantId}`,
      );
    }
  }
  const sorted = [...input.cases].sort((a, b) => (a.caseId < b.caseId ? -1 : a.caseId > b.caseId ? 1 : 0));
  const ids = new Set<string>();
  for (const c of sorted) {
    if (ids.has(c.caseId)) return setReject("duplicate-case-id", `duplicate caseId ${c.caseId}`);
    ids.add(c.caseId);
  }
  const digests = sorted.map((c) => c.caseDigest);
  const modelVersions = [...new Set(sorted.map((c) => c.invocation.modelVersion))].sort();
  const base = {
    kind: "BENCHMARK_SET" as const,
    tenant: input.tenant,
    cases: sorted,
    caseDigests: digests,
    modelVersions,
    assembledAtMs: input.assembledAtMs,
  };
  return { ok: true, set: { ...base, setDigest: benchmarkSetDigestOf(base) } };
}

function benchmarkSetDigestOf(s: Omit<BenchmarkSet, "setDigest">): string {
  return fnv1a(
    `bench-set|v1|${canonicalJson({
      tenantId: s.tenant.tenantId,
      caseDigests: s.caseDigests,
      modelVersions: s.modelVersions,
      assembledAtMs: s.assembledAtMs,
    })}`,
  );
}

/**
 * Two-level set verification: every member's digest recomputed from stored
 * content (case tampering), then the set digest (addition/removal/reorder/
 * tenant/time edits). `true` only if BOTH levels verify.
 */
export function verifyBenchmarkSetDigest(set: BenchmarkSet): boolean {
  if (set.cases.length !== set.caseDigests.length) return false;
  for (let i = 0; i < set.cases.length; i += 1) {
    const c = set.cases[i] as BenchmarkCase;
    if (c.caseDigest !== (set.caseDigests[i] as string)) return false;
    if (benchmarkCaseDigest(c) !== c.caseDigest) return false;
  }
  return benchmarkSetDigestOf(set) === set.setDigest;
}
