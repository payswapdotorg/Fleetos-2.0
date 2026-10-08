/**
 * @fleetos/learning — Multi-case evaluation summaries (Wave 5, F250B).
 *
 * Extends the summary concept of `computeEvaluationSummary` (join.ts, which
 * summarizes JOINED OUTCOMES) to aggregate whole CAPABILITY EVALUATIONS:
 *   - provenance digests per evaluation + a chained provenance digest;
 *   - trend classification over the evaluation sequence (integer bps);
 *   - integer-bps score bands;
 *   - the ADVISORY-ONLY LAW is STRUCTURAL: summaries machine-carry
 *     `advisory: true` plus a module-private unique-symbol brand, so a
 *     summary can neither be constructed outside this module nor be used as
 *     authoritative state (compile-pinned non-assignability to
 *     `CapabilityEvaluation`).
 *
 * Deterministic: evaluations are ordered by (evaluatedAt asc, evaluationId
 * asc) — ISO-8601 strings sort chronologically; input order never leaks.
 * Pure TS: integer logical ms, no clock, no randomness, no I/O.
 */

import type { CapabilityEvaluation, CapabilityVersionRef, TenantScopeLike } from "./index.ts";
import { classifyOutcomeTrend, fnv1a, canonicalJson, type OutcomeTrend } from "./outcome-intake.ts";

/** Module-private brand — summaries are only constructible in this module. */
const advisoryBrand = Symbol("fleetos.learning.advisory");

/** Integer-bps score bands (fixed, deterministic — no learned weights). */
export const SUMMARY_BANDS = {
  /** Below this aggregated case count the band is insufficient-evidence. */
  minCasesForEvidence: 5,
  strongBps: 9000,
  adequateBps: 7500,
} as const;

export type SummaryBand = "strong" | "adequate" | "weak" | "insufficient-evidence";

/** Per-evaluation provenance reference. */
export interface EvaluationProvenanceRef {
  readonly evaluationId: string;
  readonly evaluatedAt: string;
  readonly evaluationDigest: string;
}

/** The advisory multi-evaluation summary — NEVER authoritative state. */
export interface CapabilityEvaluationSummary {
  readonly [advisoryBrand]: true;
  readonly kind: "LEARNING_EVALUATION_SUMMARY";
  readonly advisory: true;
  readonly tenantId: string;
  readonly capability: CapabilityVersionRef;
  readonly evaluationCount: number;
  readonly totalCases: number;
  readonly successes: number;
  readonly failures: number;
  /** Integer bps 0..10000 = round(successes / totalCases * 10000). */
  readonly successRateBps: number;
  readonly band: SummaryBand;
  readonly trend: OutcomeTrend;
  readonly provenanceDigest: string;
  readonly evaluations: readonly EvaluationProvenanceRef[];
  readonly summarizedAtMs: number;
}

export type SummaryRejectionCode =
  | "missing-tenant"
  | "no-evaluations"
  | "cross-tenant-evaluation"
  | "capability-mismatch"
  | "invalid-summarized-at";

export interface SummaryRejection {
  readonly ok: false;
  readonly code: SummaryRejectionCode;
  readonly reason: string;
}

export type SummaryResult =
  | { readonly ok: true; readonly summary: CapabilityEvaluationSummary }
  | SummaryRejection;

/** Deterministic digest over one capability evaluation's full content. */
export function evaluationDigest(e: CapabilityEvaluation): string {
  return fnv1a(
    `eval|v1|${e.tenant.tenantId}|${e.capability.capabilityId}@${e.capability.version}` +
      `|${e.evaluationId}|${e.caseIds.join(",")}|${e.totalCases}|${e.successes}|${e.failures}` +
      `|${canonicalJson(e.successRate)}|${e.evaluatedAt}|${e.outcomeRefs.join(",")}`,
  );
}

/**
 * Aggregate capability evaluations into an advisory summary.
 *
 * Fail-closed: empty tenant, empty evaluation list, a cross-tenant evaluation
 * (offender named), mixed capabilities, invalid logical time. A summary is
 * ALWAYS advisory — it carries no authority anywhere in its shape.
 */
export function summarizeCapabilityEvaluations(
  evaluations: readonly CapabilityEvaluation[],
  input: { readonly tenant: TenantScopeLike; readonly summarizedAtMs: number },
): SummaryResult {
  const tenantId = input.tenant.tenantId;
  if (tenantId === "") {
    return { ok: false, code: "missing-tenant", reason: "summary tenant identifier is empty" };
  }
  if (!Number.isInteger(input.summarizedAtMs) || input.summarizedAtMs < 0) {
    return { ok: false, code: "invalid-summarized-at", reason: "summarizedAtMs must be an integer >= 0 (logical ms)" };
  }
  if (evaluations.length === 0) {
    return { ok: false, code: "no-evaluations", reason: "a summary requires at least one evaluation" };
  }
  const ordered = [...evaluations].sort((a, b) =>
    a.evaluatedAt !== b.evaluatedAt ? (a.evaluatedAt < b.evaluatedAt ? -1 : 1) : a.evaluationId < b.evaluationId ? -1 : a.evaluationId > b.evaluationId ? 1 : 0,
  );
  const capability = ordered[0]!.capability;
  for (const e of ordered) {
    if (e.tenant.tenantId !== tenantId) {
      return {
        ok: false,
        code: "cross-tenant-evaluation",
        reason: `evaluation ${e.evaluationId} belongs to tenant "${e.tenant.tenantId}" (summary tenant "${tenantId}")`,
      };
    }
    if (e.capability.capabilityId !== capability.capabilityId || e.capability.version !== capability.version) {
      return {
        ok: false,
        code: "capability-mismatch",
        reason: `evaluation ${e.evaluationId} targets ${e.capability.capabilityId}@${e.capability.version}, summary is ${capability.capabilityId}@${capability.version}`,
      };
    }
  }
  const totalCases = ordered.reduce((a, e) => a + e.totalCases, 0);
  const successes = ordered.reduce((a, e) => a + e.successes, 0);
  const failures = ordered.reduce((a, e) => a + e.failures, 0);
  const successRateBps = totalCases === 0 ? 0 : Math.round((successes / totalCases) * 10000);
  const band: SummaryBand =
    totalCases < SUMMARY_BANDS.minCasesForEvidence
      ? "insufficient-evidence"
      : successRateBps >= SUMMARY_BANDS.strongBps
        ? "strong"
        : successRateBps >= SUMMARY_BANDS.adequateBps
          ? "adequate"
          : "weak";
  const provenance = ordered.map((e) => ({
    evaluationId: e.evaluationId,
    evaluatedAt: e.evaluatedAt,
    evaluationDigest: evaluationDigest(e),
  }));
  const provenanceDigest = provenance.reduce(
    (acc, p) => fnv1a(`sumchain|v1|${acc}|${p.evaluationDigest}`),
    fnv1a(`sumgen|v1|${tenantId}|${capability.capabilityId}@${capability.version}`),
  );
  const trend = classifyOutcomeTrend(ordered.map((e) => Math.round(e.successRate * 10000)));
  return {
    ok: true,
    summary: {
      [advisoryBrand]: true,
      kind: "LEARNING_EVALUATION_SUMMARY",
      advisory: true,
      tenantId,
      capability,
      evaluationCount: ordered.length,
      totalCases,
      successes,
      failures,
      successRateBps,
      band,
      trend,
      provenanceDigest,
      evaluations: provenance,
      summarizedAtMs: input.summarizedAtMs,
    },
  };
}

/** Runtime guard — verifies the advisory marker + shape on untrusted input. */
export function isCapabilityEvaluationSummary(v: unknown): v is CapabilityEvaluationSummary {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    r.kind === "LEARNING_EVALUATION_SUMMARY" &&
    r.advisory === true &&
    typeof r.provenanceDigest === "string" &&
    typeof r.successRateBps === "number"
  );
}
