/**
 * Arena proposal-scoring tests — the fixed deterministic ladder, stable
 * tie-breaks, honest degraded states (Wave 5, F250B).
 */
import { describe, it, expect } from "vitest";
import {
  intakeCases,
  assembleCaseSet,
  stageRun,
  startRun,
  scoreRun,
  reportRun,
  scoreRunProposal,
  rankProposals,
  SCORING_LADDER,
  type EvaluationRun,
  type ScoredProposal,
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

/** Build a fully scored run over n cases with the given pass pattern. */
function scoredRun(n: number, passed: readonly boolean[], adapterId = "reference.arena"): EvaluationRun {
  const intake = intakeCases(Array.from({ length: n }, (_, i) => candidate(i)), tenant);
  if (!intake.ok) throw new Error("fixture intake failed");
  const set = assembleCaseSet([...intake.cases], { tenant, capability: cap, assembledAtMs: 5000 });
  if (!set.ok) throw new Error("fixture set failed");
  const staged = stageRun({ tenant, caseSet: set.caseSet, adapterId, stagedAtMs: 6000 });
  if (!staged.ok) throw new Error("fixture stage failed");
  const started = startRun(staged.run, 7000);
  if (!started.ok) throw new Error("fixture start failed");
  const scored = scoreRun(
    started.run,
    Array.from({ length: n }, (_, i) => ({ caseId: `c${i}`, actual: i, passed: passed[i] ?? true })),
    8000,
  );
  if (!scored.ok) throw new Error("fixture score failed");
  return scored.run;
}

describe("the fixed ladder (no learned weights)", () => {
  it("classifies a 10-case all-pass run as high", () => {
    const r = scoreRunProposal(scoredRun(10, [true, true, true, true, true, true, true, true, true, true]), 9000);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scored.confidence).toBe("high");
      expect(r.scored.passRateBps).toBe(10000);
      expect(r.scored.confidenceBps).toBe(10000);
      expect(r.scored.rationale).toContain("9000");
      expect(r.scored.rationale).toContain("8000");
    }
  });

  it("classifies a 7500bps pass rate as medium (boundary: >= 7500)", () => {
    // 8 cases, 6 passed => 7500 bps exactly; confidence 8800 bps.
    const r = scoreRunProposal(scoredRun(8, [true, true, true, true, true, true, false, false]), 9000);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scored.passRateBps).toBe(7500);
      expect(r.scored.confidence).toBe("medium");
    }
  });

  it("classifies below the medium pass threshold as low", () => {
    // 8 cases, 5 passed => 6250 bps, confidence 8800 bps.
    const r = scoreRunProposal(scoredRun(8, [true, true, true, true, true, false, false, false]), 9000);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.scored.confidence).toBe("low");
  });

  it("classifies a 4-case run as insufficient-evidence (below the case floor)", () => {
    const r = scoreRunProposal(scoredRun(4, [true, true, true, true]), 9000);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scored.confidence).toBe("insufficient-evidence");
      expect(r.scored.rationale).toContain("insufficient evidence");
    }
  });

  it("the ladder constants are the documented fixed values", () => {
    expect(SCORING_LADDER.minCasesForEvidence).toBe(5);
    expect(SCORING_LADDER.minConfidenceBps).toBe(6000);
    expect(SCORING_LADDER.highPassRateBps).toBe(9000);
    expect(SCORING_LADDER.highConfidenceBps).toBe(8000);
    expect(SCORING_LADDER.mediumPassRateBps).toBe(7500);
    expect(SCORING_LADDER.mediumConfidenceBps).toBe(6000);
  });

  it("scoring is deterministic — identical runs score identically", () => {
    const a = scoreRunProposal(scoredRun(6, [true, true, true, true, true, false]), 123);
    const b = scoreRunProposal(scoredRun(6, [true, true, true, true, true, false]), 123);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("honest degraded states (fail-closed)", () => {
  it("an unscored run degrades as run_not_scored", () => {
    const r = scoreRunProposal(stagedOnly(), 9000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.degraded).toBe("run_not_scored");
  });

  it("a run scored over an empty case set degrades as empty_case_set", () => {
    // Hand-built defensive input: a scored run whose case set was empty.
    // The public pipeline refuses to stage empty sets — this guards the
    // scoring boundary against forged/legacy inputs.
    const empty: EvaluationRun = {
      kind: "ARENA_RUN",
      status: "scored",
      manifest: {
        runId: "run-x",
        tenantId: "t1",
        capability: cap,
        caseSetDigest: "00000000",
        caseIds: [],
        caseCount: 0,
        adapterId: "a",
        stagedAtMs: 1,
        runDigest: "00000000",
      },
      scoring: {
        total: 0,
        passed: 0,
        failed: 0,
        passRateBps: 0,
        confidenceBps: 0,
        verdicts: [],
        scoredAtMs: 2,
        scoreDigest: "00000000",
      },
      proposal: {
        kind: "ARENA_RUN_PROPOSAL",
        advisory: true,
        proposalId: "p",
        runId: "run-x",
        tenantId: "t1",
        capability: cap,
        caseSetDigest: "00000000",
        caseCount: 0,
        passRateBps: 0,
        confidenceBps: 0,
        proposedAtMs: 2,
        scoreDigest: "00000000",
      },
      aborted: null,
      history: [],
    };
    const r = scoreRunProposal(empty, 9000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.degraded).toBe("empty_case_set");
  });

  it("an invalid scoredAtMs degrades as run_not_scored", () => {
    const r = scoreRunProposal(scoredRun(6, [true, true, true, true, true, true]), -1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.degraded).toBe("run_not_scored");
  });
});

function stagedOnly(): EvaluationRun {
  const intake = intakeCases([candidate(0)], tenant);
  if (!intake.ok) throw new Error("fixture intake failed");
  const set = assembleCaseSet([...intake.cases], { tenant, capability: cap, assembledAtMs: 5000 });
  if (!set.ok) throw new Error("fixture set failed");
  const staged = stageRun({ tenant, caseSet: set.caseSet, adapterId: "a", stagedAtMs: 6000 });
  if (!staged.ok) throw new Error("fixture stage failed");
  return staged.run;
}

describe("rankProposals: stable tie-breaks", () => {
  function fake(id: string, confidence: ScoredProposal["confidence"], pass: number, conf: number): ScoredProposal {
    return {
      kind: "ARENA_SCORED_PROPOSAL",
      advisory: true,
      proposalId: id,
      runId: `run-${id}`,
      tenantId: "t1",
      capability: cap,
      caseCount: 10,
      passRateBps: pass,
      confidenceBps: conf,
      confidence,
      rationale: "fixture",
      scoredAtMs: 1,
      scoreDigest: "00000000",
    };
  }

  it("orders by tier, then passRateBps desc, then confidenceBps desc, then proposalId asc", () => {
    const ranked = rankProposals([
      fake("p-low", "low", 5000, 9000),
      fake("p-med-a", "medium", 7500, 9000),
      fake("p-high-b", "high", 9500, 8000),
      fake("p-med-b", "medium", 8000, 7000),
      fake("p-high-a", "high", 9500, 8500),
      fake("p-tie", "high", 9500, 8500),
    ]);
    expect(ranked.ok).toBe(true);
    if (ranked.ok) {
      expect(ranked.ranked.map((p) => p.proposalId)).toEqual([
        "p-high-a",
        "p-tie", // full tie -> proposalId asc
        "p-high-b",
        "p-med-b", // 8000 > 7500 pass rate
        "p-med-a",
        "p-low",
      ]);
    }
  });

  it("is order-independent (reversed input, same ranking)", () => {
    const list = [fake("a", "high", 9000, 8000), fake("b", "medium", 8000, 7000), fake("c", "low", 6000, 6000)];
    const x = rankProposals(list);
    const y = rankProposals([...list].reverse());
    expect(x).toEqual(y);
  });

  it("rejects duplicate proposalIds fail-closed", () => {
    const r = rankProposals([fake("dup", "high", 9000, 8000), fake("dup", "low", 5000, 5000)]);
    expect(r).toMatchObject({ ok: false, code: "duplicate-proposal-id" });
  });

  it("rejects an empty ranking", () => {
    expect(rankProposals([])).toMatchObject({ ok: false, code: "empty-ranking" });
  });
});

describe("scored proposals stay advisory", () => {
  it("carries the machine marker and is not an authorization record (compile-pinned)", async () => {
    const mod = await import("../src/proposal-scoring.ts");
    const probe = (await import("../src/index.ts")).assertNoSubmitOrAdopt(
      mod as unknown as Record<string, unknown>,
    );
    expect(probe.ok).toBe(true);
    const r = scoreRunProposal(scoredRun(6, [true, true, true, true, true, true]), 1);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scored.advisory).toBe(true);
      expect(r.scored.kind).toBe("ARENA_SCORED_PROPOSAL");
      // @ts-expect-error — a scored proposal is not an authorization record
      const _bad: { verdict: "authorized" } = r.scored;
      void _bad;
    }
  });

  it("a reported run's scored proposal is unchanged by reporting", () => {
    const scored = scoredRun(4, [true, true, true, true]);
    const rep = reportRun(scored, 9999);
    expect(rep.ok).toBe(true);
    if (rep.ok) expect(rep.run.proposal).toEqual(scored.proposal);
  });
});
