/**
 * Learning evaluation-summary tests — aggregation determinism, provenance
 * digests, integer-bps bands, STRUCTURAL advisory-only law (Wave 5, F250B).
 */
import { describe, it, expect } from "vitest";
import {
  evaluateCapability,
  summarizeCapabilityEvaluations,
  evaluationDigest,
  isCapabilityEvaluationSummary,
  SUMMARY_BANDS,
  type CapabilityEvaluation,
  type CapabilityVersionRef,
  type EvaluationCase,
  type OutcomeObservation,
  type TenantScopeLike,
} from "../src/index.ts";

const tenant: TenantScopeLike = { tenantId: "t1" };
const cap: CapabilityVersionRef = { capabilityId: "cap.test", version: "1.0.0" };
const otherCap: CapabilityVersionRef = { capabilityId: "cap.other", version: "1.0.0" };

function makeEvaluation(id: string, rate: number, n: number, evaluatedAt: string, capRef = cap): CapabilityEvaluation {
  const cases: EvaluationCase<number>[] = Array.from({ length: n }, (_, i) => ({
    caseId: `${id}-c${i}`,
    tenant,
    capability: capRef,
    inputs: { x: i },
    expected: i,
    description: "case",
    tags: [],
  }));
  const successes = Math.round(rate * n);
  const outcomes: OutcomeObservation<number>[] = cases.map((c, i) => ({
    observationId: `${id}-o${i}`,
    caseId: c.caseId,
    actual: i,
    observedAt: evaluatedAt,
    observationRef: `${id}-ref-${i}`,
    success: i < successes,
  }));
  const evaluation = evaluateCapability(cases, outcomes, tenant, capRef, evaluatedAt);
  return { ...evaluation, evaluationId: id };
}

describe("summarizeCapabilityEvaluations: aggregation", () => {
  it("aggregates totals with an integer-bps success rate", () => {
    const evals = [makeEvaluation("e1", 1, 10, "2026-01-01T00:00:00.000Z"), makeEvaluation("e2", 0.5, 10, "2026-01-02T00:00:00.000Z")];
    const r = summarizeCapabilityEvaluations(evals, { tenant, summarizedAtMs: 1000 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const s = r.summary;
      expect(s.evaluationCount).toBe(2);
      expect(s.totalCases).toBe(20);
      expect(s.successes).toBe(15);
      expect(s.failures).toBe(5);
      expect(s.successRateBps).toBe(7500);
      expect(s.tenantId).toBe("t1");
    }
  });

  it("carries per-evaluation provenance digests and a chained provenance digest", () => {
    const evals = [makeEvaluation("e1", 1, 5, "2026-01-01T00:00:00.000Z"), makeEvaluation("e2", 1, 5, "2026-01-02T00:00:00.000Z")];
    const r = summarizeCapabilityEvaluations(evals, { tenant, summarizedAtMs: 1000 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.summary.evaluations).toHaveLength(2);
      expect(r.summary.evaluations[0]!.evaluationDigest).toBe(evaluationDigest(evals[0]!));
      expect(r.summary.provenanceDigest).toMatch(/^[0-9a-f]{8}$/);
    }
  });

  it("classifies the trend from the ordered evaluation sequence", () => {
    const improving = [makeEvaluation("e1", 0.2, 10, "2026-01-01T00:00:00.000Z"), makeEvaluation("e2", 0.9, 10, "2026-01-02T00:00:00.000Z")];
    const degrading = [makeEvaluation("e1", 0.9, 10, "2026-01-01T00:00:00.000Z"), makeEvaluation("e2", 0.2, 10, "2026-01-02T00:00:00.000Z")];
    const a = summarizeCapabilityEvaluations(improving, { tenant, summarizedAtMs: 1 });
    const b = summarizeCapabilityEvaluations(degrading, { tenant, summarizedAtMs: 1 });
    if (a.ok) expect(a.summary.trend).toBe("improving");
    if (b.ok) expect(b.summary.trend).toBe("degrading");
  });

  it("orders by evaluatedAt asc regardless of input order (reversed == identical)", () => {
    const evals = [makeEvaluation("e1", 1, 5, "2026-01-03T00:00:00.000Z"), makeEvaluation("e2", 1, 5, "2026-01-01T00:00:00.000Z"), makeEvaluation("e3", 1, 5, "2026-01-02T00:00:00.000Z")];
    const a = summarizeCapabilityEvaluations(evals, { tenant, summarizedAtMs: 7 });
    const b = summarizeCapabilityEvaluations([...evals].reverse(), { tenant, summarizedAtMs: 7 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    if (a.ok) expect(a.summary.evaluations.map((e) => e.evaluationId)).toEqual(["e2", "e3", "e1"]);
  });

  it("is byte-identical on re-run with identical inputs", () => {
    const evals = [makeEvaluation("e1", 0.8, 10, "2026-01-01T00:00:00.000Z"), makeEvaluation("e2", 0.6, 10, "2026-01-02T00:00:00.000Z")];
    const a = summarizeCapabilityEvaluations(evals, { tenant, summarizedAtMs: 42 });
    const b = summarizeCapabilityEvaluations(evals, { tenant, summarizedAtMs: 42 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("integer-bps score bands", () => {
  it("strong >= 9000, adequate >= 7500, weak below, insufficient below the case floor", () => {
    expect(SUMMARY_BANDS.strongBps).toBe(9000);
    expect(SUMMARY_BANDS.adequateBps).toBe(7500);
    expect(SUMMARY_BANDS.minCasesForEvidence).toBe(5);
    const strong = summarizeCapabilityEvaluations([makeEvaluation("e1", 1, 10, "2026-01-01T00:00:00.000Z")], { tenant, summarizedAtMs: 1 });
    const adequate = summarizeCapabilityEvaluations([makeEvaluation("e1", 0.8, 10, "2026-01-01T00:00:00.000Z")], { tenant, summarizedAtMs: 1 });
    const weak = summarizeCapabilityEvaluations([makeEvaluation("e1", 0.5, 10, "2026-01-01T00:00:00.000Z")], { tenant, summarizedAtMs: 1 });
    const insufficient = summarizeCapabilityEvaluations([makeEvaluation("e1", 1, 4, "2026-01-01T00:00:00.000Z")], { tenant, summarizedAtMs: 1 });
    if (strong.ok) expect(strong.summary.band).toBe("strong");
    if (adequate.ok) expect(adequate.summary.band).toBe("adequate");
    if (weak.ok) expect(weak.summary.band).toBe("weak");
    if (insufficient.ok) expect(insufficient.summary.band).toBe("insufficient-evidence");
  });
});

describe("fail-closed rejections", () => {
  it("rejects empty tenant, empty list, invalid time", () => {
    const evals = [makeEvaluation("e1", 1, 5, "2026-01-01T00:00:00.000Z")];
    expect(summarizeCapabilityEvaluations(evals, { tenant: { tenantId: "" }, summarizedAtMs: 1 })).toMatchObject({ ok: false, code: "missing-tenant" });
    expect(summarizeCapabilityEvaluations([], { tenant, summarizedAtMs: 1 })).toMatchObject({ ok: false, code: "no-evaluations" });
    expect(summarizeCapabilityEvaluations(evals, { tenant, summarizedAtMs: -1 })).toMatchObject({ ok: false, code: "invalid-summarized-at" });
  });

  it("rejects cross-tenant evaluations naming the offender", () => {
    const foreign = { ...makeEvaluation("e1", 1, 5, "2026-01-01T00:00:00.000Z"), evaluationId: "e1", tenant: { tenantId: "t2" } };
    const r = summarizeCapabilityEvaluations([foreign], { tenant, summarizedAtMs: 1 });
    expect(r).toMatchObject({ ok: false, code: "cross-tenant-evaluation" });
    if (!r.ok) expect(r.reason).toContain("e1");
  });

  it("rejects mixed capabilities", () => {
    const r = summarizeCapabilityEvaluations(
      [makeEvaluation("e1", 1, 5, "2026-01-01T00:00:00.000Z"), makeEvaluation("e2", 1, 5, "2026-01-02T00:00:00.000Z", otherCap)],
      { tenant, summarizedAtMs: 1 },
    );
    expect(r).toMatchObject({ ok: false, code: "capability-mismatch" });
  });
});

describe("the advisory-only law is STRUCTURAL", () => {
  it("summaries machine-carry advisory: true + the kind marker", () => {
    const r = summarizeCapabilityEvaluations([makeEvaluation("e1", 1, 5, "2026-01-01T00:00:00.000Z")], { tenant, summarizedAtMs: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.summary.advisory).toBe(true);
      expect(r.summary.kind).toBe("LEARNING_EVALUATION_SUMMARY");
    }
  });

  it("the runtime guard accepts a real summary and rejects stripped copies", () => {
    const r = summarizeCapabilityEvaluations([makeEvaluation("e1", 1, 5, "2026-01-01T00:00:00.000Z")], { tenant, summarizedAtMs: 1 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const json = JSON.parse(JSON.stringify(r.summary)) as Record<string, unknown>;
    expect(isCapabilityEvaluationSummary(json)).toBe(true);
    expect(isCapabilityEvaluationSummary({ ...json, advisory: false })).toBe(false);
    expect(isCapabilityEvaluationSummary({ kind: "OBSERVED" })).toBe(false);
    expect(isCapabilityEvaluationSummary(null)).toBe(false);
  });

  it("a summary is NOT assignable to an authoritative CapabilityEvaluation (compile-pinned)", () => {
    const r = summarizeCapabilityEvaluations([makeEvaluation("e1", 1, 5, "2026-01-01T00:00:00.000Z")], { tenant, summarizedAtMs: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // @ts-expect-error — an advisory summary can never become authoritative state
      const _bad: CapabilityEvaluation = r.summary;
      void _bad;
      // @ts-expect-error — an authoritative evaluation lacks the advisory marker + brand
      const _bad2: { advisory: true } = makeEvaluation("e2", 1, 5, "2026-01-01T00:00:00.000Z");
      void _bad2;
    }
  });

  it("a summary cannot be constructed outside the module (compile-pinned brand)", () => {
    // @ts-expect-error — the module-private brand is not nameable outside
    const _forged: import("../src/index.ts").CapabilityEvaluationSummary = {
      kind: "LEARNING_EVALUATION_SUMMARY",
      advisory: true,
      tenantId: "t1",
      capability: cap,
      evaluationCount: 1,
      totalCases: 1,
      successes: 1,
      failures: 0,
      successRateBps: 10000,
      band: "strong",
      trend: "stable",
      provenanceDigest: "00000000",
      evaluations: [],
      summarizedAtMs: 1,
    };
    void _forged;
  });

  it("evaluationDigest is deterministic and content-sensitive", () => {
    const a = makeEvaluation("e1", 1, 5, "2026-01-01T00:00:00.000Z");
    const b = makeEvaluation("e1", 1, 5, "2026-01-01T00:00:00.000Z");
    const c = makeEvaluation("e1", 0.8, 5, "2026-01-01T00:00:00.000Z");
    expect(evaluationDigest(a)).toBe(evaluationDigest(b));
    expect(evaluationDigest(a)).not.toBe(evaluationDigest(c));
  });
});
