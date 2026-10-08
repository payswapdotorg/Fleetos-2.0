/**
 * @fleetos/integrations/arena — Batch evaluation run lifecycle (Wave 5, F250B).
 *
 * `staged -> running -> scored -> reported` (+ `aborted`):
 *   - stageRun: build a run manifest over an assembled case set (case-set
 *     digest + adapter id + run digest + the ordered case membership).
 *   - startRun: staged -> running.
 *   - scoreRun: running -> scored — aggregates caller-supplied case verdicts
 *     with INTEGER-BPS scoring (pass rate + evidence confidence), and emits a
 *     PURE PROPOSAL (kind ARENA_RUN_PROPOSAL, advisory: true). The adapter
 *     NEVER submits — there is no submit/report-to-domain function here.
 *   - reportRun: scored -> reported (results are final, immutable tail).
 *   - abortRun: staged|running|scored -> aborted (reported runs are final —
 *     aborting them would rewrite history; rejected fail-closed).
 *
 * Determinism: pure functions over caller-supplied logical time (integer
 * ms). Re-running the same pipeline produces byte-identical runs (verdict
 * input order never leaks — verdicts are ordered by caseId).
 */

import type { CapabilityVersionRef, TenantScopeLike } from "./index.ts";
import type { ArenaDegradedState } from "./degraded.ts";
import type { CaseSet } from "./case-registry.ts";
import { canonicalJson, fnv1a } from "./case-registry.ts";

/** Run lifecycle states. */
export type RunStatus = "staged" | "running" | "scored" | "reported" | "aborted";

/** Legal transition table (single source of truth for the lifecycle). */
export const RUN_TRANSITIONS: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  staged: ["running", "aborted"],
  running: ["scored", "aborted"],
  scored: ["reported", "aborted"],
  reported: [],
  aborted: [],
};

/** Op-error codes (not degraded states). */
export type RunErrorCode =
  | "illegal-transition"
  | "invalid-now"
  | "missing-abort-reason"
  | "run-tenant-mismatch"
  | "already-scored";

export interface RunOpFailure {
  readonly ok: false;
  readonly code: RunErrorCode;
  readonly reason: string;
}

export type RunOpResult =
  | { readonly ok: true; readonly run: EvaluationRun }
  | RunOpFailure;

/** One case's verdict from executing the capability (caller-supplied input). */
export interface CaseVerdict<T = unknown> {
  readonly caseId: string;
  readonly actual: T;
  readonly passed: boolean;
}

/** Run manifest — identity + provenance of the batch run. */
export interface RunManifest {
  readonly runId: string;
  readonly tenantId: string;
  readonly capability: CapabilityVersionRef;
  readonly caseSetDigest: string;
  /** Ordered case-set membership (caseId asc) — the scoring contract. */
  readonly caseIds: readonly string[];
  readonly caseCount: number;
  readonly adapterId: string;
  readonly stagedAtMs: number;
  /** Digest over the manifest fields (chained identity, FNV-1a). */
  readonly runDigest: string;
}

/** Integer-bps scoring aggregate over a case set. */
export interface RunScoring {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  /** Integer basis points 0..10000 = round(passed / total * 10000). */
  readonly passRateBps: number;
  /**
   * Evidence-sufficiency confidence in integer bps 0..10000 (F230B
   * integer-bps uncertainty convention): a count-scaled base —
   * min(10000, CONFIDENCE_BASE_BPS + CONFIDENCE_PER_CASE_BPS * total).
   * No learned weights; pure integer arithmetic.
   */
  readonly confidenceBps: number;
  /** Verdicts in caseId order (input order never leaks). */
  readonly verdicts: readonly CaseVerdict<unknown>[];
  readonly scoredAtMs: number;
  readonly scoreDigest: string;
}

/** The run's result — a PURE PROPOSAL. The adapter NEVER submits. */
export interface ArenaRunProposal {
  readonly kind: "ARENA_RUN_PROPOSAL";
  /** Machine-carried advisory marker — run results are advisory only. */
  readonly advisory: true;
  readonly proposalId: string;
  readonly runId: string;
  readonly tenantId: string;
  readonly capability: CapabilityVersionRef;
  readonly caseSetDigest: string;
  readonly caseCount: number;
  readonly passRateBps: number;
  readonly confidenceBps: number;
  readonly proposedAtMs: number;
  readonly scoreDigest: string;
}

export interface RunTransition {
  readonly from: RunStatus;
  readonly to: RunStatus;
  readonly atMs: number;
}

export interface EvaluationRun {
  readonly kind: "ARENA_RUN";
  readonly status: RunStatus;
  readonly manifest: RunManifest;
  /** Present once scored. */
  readonly scoring: RunScoring | null;
  /** Present once scored — the PURE proposal carrying the results. */
  readonly proposal: ArenaRunProposal | null;
  readonly aborted: { readonly reason: string; readonly abortedAtMs: number } | null;
  readonly history: readonly RunTransition[];
}

/** Confidence convention constants (integer bps — no learned weights). */
export const CONFIDENCE_BASE_BPS = 4000;
export const CONFIDENCE_PER_CASE_BPS = 600;

export type ScoreRunResult =
  | { readonly ok: true; readonly run: EvaluationRun }
  | RunOpFailure
  | { readonly ok: false; readonly degraded: ArenaDegradedState; readonly reason: string };

function requireNow(atMs: number): string | null {
  return Number.isInteger(atMs) && atMs >= 0 ? null : "timestamp must be an integer >= 0 (logical ms)";
}

/** Stage a batch evaluation run over an assembled case set. */
export function stageRun(input: {
  readonly tenant: TenantScopeLike;
  readonly caseSet: CaseSet<unknown>;
  readonly adapterId: string;
  readonly stagedAtMs: number;
}): RunOpResult {
  if (input.tenant.tenantId === "") {
    return { ok: false, code: "run-tenant-mismatch", reason: "tenant identifier is empty" };
  }
  if (input.tenant.tenantId !== input.caseSet.tenantId) {
    return {
      ok: false,
      code: "run-tenant-mismatch",
      reason: `run tenant "${input.tenant.tenantId}" != case-set tenant "${input.caseSet.tenantId}"`,
    };
  }
  if (input.adapterId === "") {
    return { ok: false, code: "run-tenant-mismatch", reason: "adapterId is empty" };
  }
  if (!Number.isInteger(input.stagedAtMs) || input.stagedAtMs < 0) {
    return { ok: false, code: "invalid-now", reason: "stagedAtMs must be an integer >= 0" };
  }
  if (input.caseSet.caseCount === 0) {
    return { ok: false, code: "illegal-transition", reason: "cannot stage a run over an empty case set" };
  }
  const caseIds = input.caseSet.cases.map((c) => c.caseId);
  const base = {
    tenantId: input.tenant.tenantId,
    capability: input.caseSet.capability,
    caseSetDigest: input.caseSet.caseSetDigest,
    caseIds,
    caseCount: input.caseSet.caseCount,
    adapterId: input.adapterId,
    stagedAtMs: input.stagedAtMs,
  };
  const manifest: RunManifest = {
    runId: `run-${base.capability.capabilityId}-${base.capability.version}-${base.tenantId}-${base.caseSetDigest}`,
    ...base,
    runDigest: fnv1a(
      `run|v1|${base.tenantId}|${base.capability.capabilityId}@${base.capability.version}|${base.caseSetDigest}` +
        `|${base.caseCount}|${base.adapterId}|${base.stagedAtMs}`,
    ),
  };
  return {
    ok: true,
    run: { kind: "ARENA_RUN", status: "staged", manifest, scoring: null, proposal: null, aborted: null, history: [] },
  };
}

function legal(from: RunStatus, to: RunStatus): boolean {
  return RUN_TRANSITIONS[from].includes(to);
}

function advance(
  run: EvaluationRun,
  to: RunStatus,
  atMs: number,
  patch: Partial<EvaluationRun>,
  note: string,
): RunOpResult {
  if (!legal(run.status, to)) {
    return { ok: false, code: "illegal-transition", reason: `cannot transition ${run.status} -> ${to} (${note})` };
  }
  return { ok: true, run: { ...run, ...patch, status: to, history: [...run.history, { from: run.status, to, atMs }] } };
}

/** scored -> reported (results final). */
export function reportRun(run: EvaluationRun, atMs: number): RunOpResult {
  const bad = requireNow(atMs);
  if (bad) return { ok: false, code: "invalid-now", reason: bad };
  return advance(run, "reported", atMs, {}, "reportRun");
}

/** staged|running|scored -> aborted. Reported runs are final. */
export function abortRun(run: EvaluationRun, reason: string, abortedAtMs: number): RunOpResult {
  const bad = requireNow(abortedAtMs);
  if (bad) return { ok: false, code: "invalid-now", reason: bad };
  if (reason === "") {
    return { ok: false, code: "missing-abort-reason", reason: "aborting a run requires a non-empty reason" };
  }
  return advance(run, "aborted", abortedAtMs, { aborted: { reason, abortedAtMs } }, "abortRun");
}

/** staged -> running. */
export function startRun(run: EvaluationRun, atMs: number): RunOpResult {
  const bad = requireNow(atMs);
  if (bad) return { ok: false, code: "invalid-now", reason: bad };
  return advance(run, "running", atMs, {}, "startRun");
}

/**
 * running|scored -> scored. Aggregates verdicts into integer-bps scoring and
 * emits the PURE result proposal. Re-scoring with identical verdicts +
 * logical time is IDEMPOTENT (returns the byte-identical run, no duplicate
 * history entry); different content on an already-scored run is rejected —
 * history is never rewritten.
 */
export function scoreRun(
  run: EvaluationRun,
  verdicts: readonly CaseVerdict<unknown>[],
  scoredAtMs: number,
): ScoreRunResult {
  const bad = requireNow(scoredAtMs);
  if (bad) return { ok: false, code: "invalid-now", reason: bad };
  if (run.status === "staged" || run.status === "reported" || run.status === "aborted") {
    return { ok: false, code: "illegal-transition", reason: `cannot score a ${run.status} run` };
  }
  const built = buildScoring(run.manifest, verdicts, scoredAtMs);
  if (!built.ok) return built;
  if (run.status === "scored" && run.scoring && run.proposal) {
    if (built.scoring.scoreDigest === run.scoring.scoreDigest && built.proposal.proposalId === run.proposal.proposalId) {
      return { ok: true, run }; // idempotent re-score — byte-identical
    }
    return {
      ok: false,
      code: "already-scored",
      reason: "run is already scored with different content — history is never rewritten",
    };
  }
  return {
    ok: true,
    run: {
      ...run,
      status: "scored",
      scoring: built.scoring,
      proposal: built.proposal,
      history: [...run.history, { from: run.status, to: "scored", atMs: scoredAtMs }],
    },
  };
}

function buildScoring(
  manifest: RunManifest,
  verdicts: readonly CaseVerdict<unknown>[],
  scoredAtMs: number,
):
  | { readonly ok: true; readonly scoring: RunScoring; readonly proposal: ArenaRunProposal }
  | { readonly ok: false; readonly degraded: ArenaDegradedState; readonly reason: string } {
  const expected = manifest.caseIds;
  if (expected.length === 0) {
    return { ok: false, degraded: "empty_case_set", reason: "run carries no case ids — stage it over a non-empty case set" };
  }
  const ordered = [...verdicts].sort((a, b) => (a.caseId < b.caseId ? -1 : a.caseId > b.caseId ? 1 : 0));
  const seen = new Set<string>();
  for (const v of ordered) {
    if (v.caseId === "") {
      return { ok: false, degraded: "foreign_case_result", reason: "a verdict has an empty caseId" };
    }
    if (!expected.includes(v.caseId)) {
      return { ok: false, degraded: "foreign_case_result", reason: `verdict for case "${v.caseId}" is not in the run's case set` };
    }
    if (seen.has(v.caseId)) {
      return { ok: false, degraded: "foreign_case_result", reason: `duplicate verdict for case "${v.caseId}"` };
    }
    seen.add(v.caseId);
  }
  const missing = expected.filter((id) => !seen.has(id));
  if (missing.length > 0) {
    return {
      ok: false,
      degraded: "partial_case_set",
      reason: `missing verdicts for ${missing.length} case(s): ${missing.join(",")}`,
    };
  }
  const total = ordered.length;
  const passed = ordered.filter((v) => v.passed).length;
  const passRateBps = Math.round((passed / total) * 10000);
  const confidenceBps = Math.min(10000, CONFIDENCE_BASE_BPS + CONFIDENCE_PER_CASE_BPS * total);
  const verdictsCanonical = ordered.map((v) => `${v.caseId}:${canonicalJson(v.actual)}:${v.passed ? 1 : 0}`).join(",");
  const scoreDigest = fnv1a(`score|v1|${manifest.runDigest}|${verdictsCanonical}|${scoredAtMs}`);
  const scoring: RunScoring = {
    total,
    passed,
    failed: total - passed,
    passRateBps,
    confidenceBps,
    verdicts: ordered,
    scoredAtMs,
    scoreDigest,
  };
  const proposal: ArenaRunProposal = {
    kind: "ARENA_RUN_PROPOSAL",
    advisory: true,
    proposalId: `arena-run-prop-${manifest.runId}-${scoreDigest}`,
    runId: manifest.runId,
    tenantId: manifest.tenantId,
    capability: manifest.capability,
    caseSetDigest: manifest.caseSetDigest,
    caseCount: manifest.caseCount,
    passRateBps,
    confidenceBps,
    proposedAtMs: scoredAtMs,
    scoreDigest,
  };
  return { ok: true, scoring, proposal };
}

/** Runtime guard — verifies the ARENA_RUN_PROPOSAL + advisory markers. */
export function isArenaRunProposal(v: unknown): v is ArenaRunProposal {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return r.kind === "ARENA_RUN_PROPOSAL" && r.advisory === true && typeof r.proposalId === "string" && typeof r.runId === "string";
}
