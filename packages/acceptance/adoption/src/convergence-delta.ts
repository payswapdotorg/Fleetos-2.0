/**
 * @fleetos/acceptance-adoption — the Wave 10 convergence expectation
 * (F300C scoped TL grant; WAVE10-HOST-CONTRACT §5).
 *
 * HONEST PARAMETERIZATION RECORD, not a machine-run claim: the sibling
 * lanes' Wave 10 corpus extensions (F300A field, F300B security) were
 * pushed to their branch tips but are NOT merged into this branch — a
 * lane never merges another lane's owned paths. The adoption numbers a
 * machine-run produces on THIS branch therefore count the CURRENT tree's
 * corpora (field 14 / commerce 21 / security 13); this module records
 * the sibling branch tips' counts and the resulting CONVERGENCE
 * EXPECTATION for the TL to recompute at F301/F302 when all three lanes
 * merge.
 *
 * The 100-counted-journeys-per-firm target is NEVER silently weakened:
 * the convergence expectation (58 for a fully-applicable firm) still
 * falls short of 100, and the shortfall stays STRUCTURAL (runner/corpus
 * shape), preserved in the honest-counts ledger for a documented
 * TL/user decision.
 */

/** The sibling lanes' Wave 10 branch tips (fetched, unmerged — recorded for the TL). */
export interface LaneExtensionRecord {
  readonly workItem: string;
  readonly lane: string;
  readonly branch: string;
  readonly branchTipCommit: string;
  readonly corpus: "field" | "security";
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
  field: 20,
  commerce: 21,
  security: 17,
  fullyApplicableFirmCap: 20 + 21 + 17,
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
  field: 20,
  commerce: 21,
  security: 17,
  fullyApplicableFirmCap: 20 + 21 + 17,
  targetPerFirm: 100,
  shortfallPerFullyApplicableFirm: 100 - (20 + 21 + 17),
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
  const field = LANE_EXTENSIONS.find((r) => r.corpus === "field");
  const security = LANE_EXTENSIONS.find((r) => r.corpus === "security");
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
