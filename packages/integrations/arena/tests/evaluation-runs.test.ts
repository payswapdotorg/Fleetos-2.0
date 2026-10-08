/**
 * Arena evaluation-run lifecycle tests — staged -> running -> scored ->
 * reported (+ aborted), integer-bps scoring, byte-identical determinism,
 * PURE proposals, tenant fail-closed (Wave 5, F250B).
 */
import { describe, it, expect } from "vitest";
import {
  intakeCases,
  assembleCaseSet,
  stageRun,
  startRun,
  scoreRun,
  reportRun,
  abortRun,
  isArenaRunProposal,
  assertNoSubmitOrAdopt,
  CONFIDENCE_BASE_BPS,
  CONFIDENCE_PER_CASE_BPS,
  type CaseVerdict,
  type EvaluationRun,
  type ArenaRunProposal,
} from "../src/index.ts";

const tenant = { tenantId: "t1" };
const cap = { capabilityId: "cap.test", version: "1.0.0" };

function candidate(i: number) {
  return {
    caseId: `c${i}`,
    tenant,
    capability: cap,
    inputs: { x: i },
    expected: i,
    description: `case ${i}`,
    tags: [],
    source: "suite",
    submittedAtMs: 1000 + i,
  };
}

function makeSet(n: number) {
  const intake = intakeCases(Array.from({ length: n }, (_, i) => candidate(i)), tenant);
  if (!intake.ok) throw new Error("fixture intake failed");
  const r = assembleCaseSet([...intake.cases], { tenant, capability: cap, assembledAtMs: 5000 });
  if (!r.ok) throw new Error("fixture set failed");
  return r.caseSet;
}

function stagedRun(n = 5): EvaluationRun {
  const r = stageRun({ tenant, caseSet: makeSet(n), adapterId: "reference.arena", stagedAtMs: 6000 });
  if (!r.ok) throw new Error("fixture stage failed");
  return r.run;
}

function runningRun(n = 5): EvaluationRun {
  const r = startRun(stagedRun(n), 7000);
  if (!r.ok) throw new Error("fixture start failed");
  return r.run;
}

function verdicts(n: number, passed: readonly boolean[] = []): CaseVerdict<number>[] {
  return Array.from({ length: n }, (_, i) => ({ caseId: `c${i}`, actual: i, passed: passed[i] ?? true }));
}

describe("stageRun", () => {
  it("builds a manifest with case-set digest, adapter id, run digest and case membership", () => {
    const run = stagedRun(3);
    expect(run.status).toBe("staged");
    expect(run.manifest.caseSetDigest).toMatch(/^[0-9a-f]{8}$/);
    expect(run.manifest.adapterId).toBe("reference.arena");
    expect(run.manifest.runDigest).toMatch(/^[0-9a-f]{8}$/);
    expect(run.manifest.caseIds).toEqual(["c0", "c1", "c2"]);
    expect(run.manifest.caseCount).toBe(3);
    expect(run.scoring).toBeNull();
    expect(run.proposal).toBeNull();
  });

  it("rejects a tenant mismatch between run tenant and case set", () => {
    const r = stageRun({ tenant: { tenantId: "t2" }, caseSet: makeSet(2), adapterId: "a", stagedAtMs: 1 });
    expect(r).toMatchObject({ ok: false, code: "run-tenant-mismatch" });
  });

  it("rejects an empty adapter id and an invalid stagedAtMs", () => {
    expect(stageRun({ tenant, caseSet: makeSet(1), adapterId: "", stagedAtMs: 1 })).toMatchObject({ ok: false, code: "run-tenant-mismatch" });
    expect(stageRun({ tenant, caseSet: makeSet(1), adapterId: "a", stagedAtMs: -5 })).toMatchObject({ ok: false, code: "invalid-now" });
    expect(stageRun({ tenant, caseSet: makeSet(1), adapterId: "a", stagedAtMs: 1.5 })).toMatchObject({ ok: false, code: "invalid-now" });
  });

  it("staging the same case set twice yields byte-identical runs", () => {
    const a = stageRun({ tenant, caseSet: makeSet(3), adapterId: "a", stagedAtMs: 42 });
    const b = stageRun({ tenant, caseSet: makeSet(3), adapterId: "a", stagedAtMs: 42 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("run lifecycle: legal + illegal transitions", () => {
  it("staged -> running records history", () => {
    const r = startRun(stagedRun(2), 7000);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.run.status).toBe("running");
      expect(r.run.history).toEqual([{ from: "staged", to: "running", atMs: 7000 }]);
    }
  });

  it("rejects starting an already-running run", () => {
    const r = startRun(runningRun(2), 8000);
    expect(r).toMatchObject({ ok: false, code: "illegal-transition" });
  });

  it("rejects scoring a staged run", () => {
    const r = scoreRun(stagedRun(2), verdicts(2), 8000);
    expect(r).toMatchObject({ ok: false, code: "illegal-transition" });
  });

  it("scores a running run with integer-bps aggregation", () => {
    const r = scoreRun(runningRun(5), verdicts(5, [true, true, true, false, false]), 9000);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.run.status).toBe("scored");
      expect(r.run.scoring!.total).toBe(5);
      expect(r.run.scoring!.passed).toBe(3);
      expect(r.run.scoring!.failed).toBe(2);
      expect(r.run.scoring!.passRateBps).toBe(6000);
      expect(r.run.scoring!.confidenceBps).toBe(CONFIDENCE_BASE_BPS + CONFIDENCE_PER_CASE_BPS * 5);
    }
  });

  it("caps confidence at 10000 bps", () => {
    const r = scoreRun(runningRun(20), verdicts(20), 9000);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.run.scoring!.confidenceBps).toBe(10000);
  });

  it("rejects missing verdicts as a partial_case_set degraded state", () => {
    const r = scoreRun(runningRun(3), verdicts(2), 9000);
    expect(r.ok).toBe(false);
    if (!r.ok && "degraded" in r) {
      expect(r.degraded).toBe("partial_case_set");
      expect(r.reason).toContain("c2");
    }
  });

  it("rejects foreign and duplicate verdicts as foreign_case_result", () => {
    const foreign = [...verdicts(2), { caseId: "zz", actual: 0, passed: true }];
    expect(scoreRun(runningRun(2), foreign, 9000)).toMatchObject({ ok: false });
    const dup = [...verdicts(2), verdicts(2)[0]!];
    const r = scoreRun(runningRun(2), dup, 9000);
    expect(r.ok).toBe(false);
    if (!r.ok && "degraded" in r) expect(r.degraded).toBe("foreign_case_result");
  });

  it("verdict input order never leaks (reversed verdicts -> identical scoring)", () => {
    const a = scoreRun(runningRun(4), verdicts(4, [true, false, true, false]), 9000);
    const b = scoreRun(runningRun(4), [...verdicts(4, [true, false, true, false])].reverse(), 9000);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("the full pipeline is byte-identical on re-run", () => {
    const pipeline = () => {
      const staged = stageRun({ tenant, caseSet: makeSet(4), adapterId: "a", stagedAtMs: 1 });
      if (!staged.ok) throw new Error("staged");
      const started = startRun(staged.run, 2);
      if (!started.ok) throw new Error("started");
      const scored = scoreRun(started.run, verdicts(4, [true, true, true, false]), 3);
      if (!scored.ok) throw new Error("scored");
      return JSON.stringify(reportRun(scored.run, 4));
    };
    expect(pipeline()).toBe(pipeline());
  });

  it("re-scoring with identical inputs is idempotent (no duplicate history)", () => {
    const a = scoreRun(runningRun(3), verdicts(3), 9000);
    expect(a.ok).toBe(true);
    if (a.ok) {
      const again = scoreRun(a.run, verdicts(3), 9000);
      expect(again.ok).toBe(true);
      if (again.ok) expect(again.run).toEqual(a.run);
    }
  });

  it("re-scoring with different content is rejected (history never rewritten)", () => {
    const a = scoreRun(runningRun(3), verdicts(3), 9000);
    expect(a.ok).toBe(true);
    if (a.ok) {
      const again = scoreRun(a.run, verdicts(3, [true, true, false]), 9000);
      expect(again).toMatchObject({ ok: false, code: "already-scored" });
    }
  });

  it("scored -> reported; reported is terminal", () => {
    const s = scoreRun(runningRun(2), verdicts(2), 1);
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    const rep = reportRun(s.run, 2);
    expect(rep.ok).toBe(true);
    if (rep.ok) {
      expect(rep.run.status).toBe("reported");
      expect(rep.run.proposal).not.toBeNull();
      expect(reportRun(rep.run, 3)).toMatchObject({ ok: false, code: "illegal-transition" });
      expect(scoreRun(rep.run, verdicts(2), 4)).toMatchObject({ ok: false, code: "illegal-transition" });
      expect(abortRun(rep.run, "late", 5)).toMatchObject({ ok: false, code: "illegal-transition" });
    }
  });

  it("aborts a running run with a reason; empty reason is rejected", () => {
    const a = abortRun(runningRun(2), "flaky harness", 9500);
    expect(a.ok).toBe(true);
    if (a.ok) {
      expect(a.run.status).toBe("aborted");
      expect(a.run.aborted).toEqual({ reason: "flaky harness", abortedAtMs: 9500 });
      expect(a.run.scoring).toBeNull();
    }
    expect(abortRun(runningRun(2), "", 9500)).toMatchObject({ ok: false, code: "missing-abort-reason" });
  });

  it("aborts a staged run; aborted is terminal", () => {
    const a = abortRun(stagedRun(2), "cancelled", 1);
    expect(a.ok).toBe(true);
    if (a.ok) {
      expect(a.run.status).toBe("aborted");
      expect(startRun(a.run, 2)).toMatchObject({ ok: false, code: "illegal-transition" });
    }
  });

  it("rejects non-integer / negative logical times on every transition", () => {
    expect(startRun(stagedRun(2), -1)).toMatchObject({ ok: false, code: "invalid-now" });
    expect(startRun(stagedRun(2), 1.25)).toMatchObject({ ok: false, code: "invalid-now" });
    expect(reportRun(runningRun(2), -1)).toMatchObject({ ok: false, code: "invalid-now" });
  });
});

describe("run results are PURE PROPOSALS (never submits)", () => {
  it("the scored run emits an ARENA_RUN_PROPOSAL carrying advisory: true", () => {
    const s = scoreRun(runningRun(2), verdicts(2), 1);
    expect(s.ok).toBe(true);
    if (s.ok) {
      const p: ArenaRunProposal = s.run.proposal!;
      expect(p.kind).toBe("ARENA_RUN_PROPOSAL");
      expect(p.advisory).toBe(true);
      expect(p.passRateBps).toBe(10000);
      expect(p.caseSetDigest).toBe(s.run.manifest.caseSetDigest);
      expect(isArenaRunProposal(p)).toBe(true);
      // stripped advisory marker is rejected by the runtime guard
      expect(isArenaRunProposal({ ...p, advisory: false })).toBe(false);
      expect(isArenaRunProposal(null)).toBe(false);
    }
  });

  it("a run proposal is NOT an outcome observation (compile-pinned)", () => {
    const s = scoreRun(runningRun(2), verdicts(2), 1);
    expect(s.ok).toBe(true);
    if (s.ok) {
      const p = s.run.proposal!;
      // @ts-expect-error — an ARENA_RUN_PROPOSAL is not a Wave-0 outcome shape
      const _bad: { kind: "OBSERVED" } = p;
      void _bad;
    }
  });

  it("the evaluation-runs module surface exposes no submit/adopt/authorize", async () => {
    const mod = await import("../src/evaluation-runs.ts");
    const probe = assertNoSubmitOrAdopt(mod as unknown as Record<string, unknown>);
    expect(probe.ok).toBe(true);
  });
});
