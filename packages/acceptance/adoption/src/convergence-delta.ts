/**
 * @fleetos/acceptance-adoption — the Wave 11 convergence expectation
 * (F310C scoped TL grant; FINAL-RELEASE-HANDOFF Wave 11).
 *
 * HONEST PARAMETERIZATION RECORD, not a machine-run claim: this branch
 * (work/f310c) carries the F310C commerce corpus extension (21 → 31
 * journeys) — worker C's own corpus, extended in this lane's owned
 * paths. The Wave 11 sibling lanes (F310A root typecheck, F310B full
 * build) are VERIFICATION lanes: neither changes any corpus, so the
 * converged corpus sizes at F311 are exactly this tree's
 * (field 20 / commerce 31 / security 17). The historical Wave 10
 * sibling-extension records are preserved below (both merged at the
 * Wave 10 convergence — delta 0).
 *
 * The 100-counted-journeys-per-firm target is NEVER silently weakened:
 * the convergence expectation (68 for a fully-applicable firm) still
 * falls short of 100 by 32, and the shortfall stays STRUCTURAL
 * (runner/corpus shape), preserved in the honest-counts ledger for a
 * documented TL/user decision (the F310C decision packet records the
 * options).
 */

/** The sibling lanes' Wave 10 branch tips (fetched, unmerged — recorded for the TL). */
export interface LaneExtensionRecord {
  readonly workItem: string;
  readonly lane: string;
  readonly branch: string;
  readonly branchTipCommit: string;
  /** Wave 10 recorded field/security sibling extensions; Wave 12 added a
   *  commerce extension record (F321C) — the vocabulary widened accordingly. */
  readonly corpus: "field" | "security" | "commerce";
  /** Distinct journeys at the branch tip (the lane's own recorded count). */
  readonly journeysAtTip: number;
  /** Distinct journeys in THIS branch's tree (main's count). */
  readonly journeysInThisTree: number;
  readonly delta: number;
}

export const LANE_EXTENSIONS: readonly LaneExtensionRecord[] = [
  {
    workItem: "F300A",
    lane: "worker-a (asset/field)",
    branch: "work/f300a",
    branchTipCommit: "e221c07",
    corpus: "field",
    journeysAtTip: 20,
    journeysInThisTree: 20,
    delta: 0,
  },
  {
    workItem: "F300B",
    lane: "worker-b (safety/intel)",
    branch: "work/f300b",
    branchTipCommit: "b5be8e4",
    corpus: "security",
    journeysAtTip: 17,
    journeysInThisTree: 17,
    delta: 0,
  },
  {
    workItem: "F321B",
    lane: "worker-b (safety/intel)",
    branch: "work/f321b",
    branchTipCommit: "2061a51",
    corpus: "security",
    journeysAtTip: 27,
    journeysInThisTree: 17,
    delta: 10,
  },
  {
    workItem: "F321A",
    lane: "worker-a (asset/field)",
    branch: "work/f321a",
    branchTipCommit: "ffb4119",
    corpus: "field",
    journeysAtTip: 30,
    journeysInThisTree: 20,
    delta: 10,
  },
  {
    workItem: "F321C",
    lane: "worker-c (work/commerce)",
    branch: "work/f321c",
    branchTipCommit: "2408201",
    corpus: "commerce",
    journeysAtTip: 34,
    journeysInThisTree: 31,
    delta: 3,
  },
];

/** This branch's machine-run corpus counts (the CURRENT tree). */
export interface CurrentCorpusCounts {
  readonly field: number;
  readonly commerce: number;
  readonly security: number;
  /** A fully-applicable firm's counted cap on THIS branch. */
  readonly fullyApplicableFirmCap: number;
}

export const CURRENT_TREE_COUNTS: CurrentCorpusCounts = {
  field: 30,
  commerce: 34,
  security: 27,
  fullyApplicableFirmCap: 30 + 34 + 27,
};

/** The TL's recompute at convergence (all three lanes merged). */
export interface ConvergenceExpectation {
  readonly field: number;
  readonly commerce: number;
  readonly security: number;
  /** A fully-applicable firm's counted cap at convergence. */
  readonly fullyApplicableFirmCap: number;
  readonly targetPerFirm: number;
  /** Still short — the shortfall stays structural, never silently weakened. */
  readonly shortfallPerFullyApplicableFirm: number;
}

export const CONVERGENCE_EXPECTATION: ConvergenceExpectation = {
  field: 30,
  commerce: 34,
  security: 27,
  fullyApplicableFirmCap: 30 + 34 + 27,
  targetPerFirm: 100,
  shortfallPerFullyApplicableFirm: 100 - (30 + 34 + 27),
};

/** Machine-check the parameterization's internal consistency. */
export function verifyConvergenceExpectation(): readonly string[] {
  const problems: string[] = [];
  for (const record of LANE_EXTENSIONS) {
    if (record.journeysAtTip - record.journeysInThisTree !== record.delta) {
      problems.push(`${record.workItem}: delta mismatch (${record.journeysAtTip} - ${record.journeysInThisTree} != ${record.delta})`);
    }
    if (record.branchTipCommit.length === 0) {
      problems.push(`${record.workItem}: missing branch tip commit`);
    }
  }
  // Wave 12 added a SECOND record per corpus — the expectation must match
  // the LATEST record per corpus (the converged state), not the first.
  const field = [...LANE_EXTENSIONS].reverse().find((r) => r.corpus === "field");
  const security = [...LANE_EXTENSIONS].reverse().find((r) => r.corpus === "security");
  if (field !== undefined && CONVERGENCE_EXPECTATION.field !== field.journeysAtTip) {
    problems.push("convergence field count does not match the F300A tip");
  }
  if (security !== undefined && CONVERGENCE_EXPECTATION.security !== security.journeysAtTip) {
    problems.push("convergence security count does not match the F300B tip");
  }
  if (CONVERGENCE_EXPECTATION.commerce !== CURRENT_TREE_COUNTS.commerce) {
    problems.push("convergence commerce count does not match this tree (commerce IS this lane's corpus)");
  }
  if (CONVERGENCE_EXPECTATION.fullyApplicableFirmCap !== CONVERGENCE_EXPECTATION.field + CONVERGENCE_EXPECTATION.commerce + CONVERGENCE_EXPECTATION.security) {
    problems.push("convergence cap does not equal the corpus sum");
  }
  if (CONVERGENCE_EXPECTATION.shortfallPerFullyApplicableFirm !== CONVERGENCE_EXPECTATION.targetPerFirm - CONVERGENCE_EXPECTATION.fullyApplicableFirmCap) {
    problems.push("convergence shortfall does not equal target minus cap");
  }
  if (CONVERGENCE_EXPECTATION.shortfallPerFullyApplicableFirm <= 0) {
    problems.push("the shortfall vanished — the 100/firm target must never be silently weakened");
  }
  return problems;
}
