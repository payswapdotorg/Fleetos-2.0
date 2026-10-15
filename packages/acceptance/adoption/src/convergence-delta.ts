/**
 * @fleetos/acceptance-adoption — the Wave 11 convergence expectation
 * (F310C scoped TL grant; FINAL-RELEASE-HANDOFF Wave 11).
 *
 * HONEST PARAMETERIZATION RECORD, not a machine-run claim: this module
 * records the corpora's convergence state per wave. Wave 13 (F332) updated
 * the tree counts to the merged F331A (field 30→31) + F331C (commerce
 * 34→36) corpora; Wave 14 (F342) updates them to the merged F341A (field
 * 31→35) + F341B (security 27→29) corpora — machine-measured by the F342
 * probe on the converged post-F341B tree (docs/evidence/F342/report.md).
 * The historical lane-extension records are preserved below.
 *
 * The 100-counted-journeys-per-firm target is NEVER silently weakened:
 * the Wave-14 convergence lands the fully-applicable firm's single-counted
 * cap at EXACTLY 100 (the F340 §3 B-3 closure — machine-measured:
 * manufacturing + energy-utilities small firms at 100). A cap that MEETS
 * the target is a measured closure, never an inflation: the cap still must
 * equal the real corpus sum, and every masked-industry shortfall stays
 * STRUCTURAL, preserved in the honest-counts ledger for a documented
 * TL/user decision.
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
  {
    workItem: "F331A",
    lane: "worker-a (asset/field)",
    branch: "work/f331a",
    branchTipCommit: "d902e80",
    corpus: "field",
    journeysAtTip: 31,
    journeysInThisTree: 30,
    delta: 1,
  },
  {
    workItem: "F331C",
    lane: "worker-c (work/commerce)",
    branch: "work/f331c",
    branchTipCommit: "2dfa6e0",
    corpus: "commerce",
    journeysAtTip: 36,
    journeysInThisTree: 34,
    delta: 2,
  },
  {
    workItem: "F341A",
    lane: "worker-a (asset/field)",
    branch: "work/f341a",
    branchTipCommit: "e954ec8",
    corpus: "field",
    journeysAtTip: 35,
    journeysInThisTree: 31,
    delta: 4,
  },
  {
    workItem: "F341B",
    lane: "worker-b (safety/intel)",
    branch: "work/f341b",
    branchTipCommit: "46e948c",
    corpus: "security",
    journeysAtTip: 29,
    journeysInThisTree: 27,
    delta: 2,
  },
  {
    // F353 re-pin (machine-measured at the integrated 10de683 tree): the
    // F351B masked-industry coverage lane — 5 census-certified D14 journeys
    // over the persona-relevant unexercised surface (assets registry
    // lifecycle, work-order shift supersession, project closeout archival,
    // procurement Guardian-law ordering, health threshold escalation).
    workItem: "F351B",
    lane: "worker-a (asset/field)",
    branch: "work/f351b",
    branchTipCommit: "da6a8e9",
    corpus: "field",
    journeysAtTip: 40,
    journeysInThisTree: 35,
    delta: 5,
  },
  {
    // F354 re-pin (machine-measured at the integrated 678c7bf tree): the
    // F351C masked-industry coverage lane tranche 2 — 5 fleet-universal
    // commerce D14 journeys (procurement-order authorization, vendor
    // matching, quote comparison, vendor KPI rollup, idempotent document
    // creation); ZERO industries.ts motion (all universal).
    workItem: "F351C",
    lane: "worker-c (work/commerce)",
    branch: "work/f351c",
    branchTipCommit: "0207559",
    corpus: "commerce",
    journeysAtTip: 41,
    journeysInThisTree: 36,
    delta: 5,
  },
  {
    // F362 partial re-pin (machine-measured at the A+B merge 87fb95b): the
    // F361A marketplace receipt->enrollment lane — 2 fleet-universal D14
    // journeys (receipt enrollment with the duplicate guard; receipt
    // discrepancy with the un-enrolled-until-verified law).
    workItem: "F361A",
    lane: "worker-a (asset/field)",
    branch: "work/f361a",
    branchTipCommit: "ca298ec",
    corpus: "field",
    journeysAtTip: 42,
    journeysInThisTree: 40,
    delta: 2,
  },
  {
    // F362 partial re-pin (machine-measured at the A+B merge 87fb95b): the
    // F361B marketplace trust/Guardian/evidence lane — 2 fleet-universal
    // D14 journeys (order approval discipline; evidence dedup discipline).
    workItem: "F361B",
    lane: "worker-b (safety/intel)",
    branch: "work/f361b",
    branchTipCommit: "c120ae4",
    corpus: "security",
    journeysAtTip: 31,
    journeysInThisTree: 29,
    delta: 2,
  },
  {
    // F362 final re-pin (machine-measured at the integrated 2521cba tree,
    // probe f362-measure): the F361C marketplace supplier/catalogue/request/
    // order lane — 4 fleet-universal D14 journeys (request lifecycle; offer
    // freshness discipline; supplier verification gate; order ack
    // discipline) — commerce 41 -> 45; ZERO industries.ts motion.
    workItem: "F361C",
    lane: "worker-c (work/commerce)",
    branch: "work/f361c",
    branchTipCommit: "c0aae58",
    corpus: "commerce",
    journeysAtTip: 45,
    journeysInThisTree: 41,
    delta: 4,
  },
  {
    // F362 E2E re-pin (machine-measured at the post-E2E merge b6d4411,
    // probe f362e2e-measure): the TL-delegated deterministic transaction-
    // spine journey — 1 fleet-universal D14 journey composing the REAL
    // public APIs of ALL THREE Wave-17 lanes (F361C request->catalogue->
    // offers->comparison->order->ack; F361B Guardian approval with the
    // advisory law; F361A receipt->enrollment with the duplicate-serial
    // guard) — commerce 45 -> 46; ZERO industries.ts motion.
    workItem: "F362",
    lane: "worker-e2e (the TL-delegated §2 grant)",
    branch: "work/f362e2e",
    branchTipCommit: "12392a6",
    corpus: "commerce",
    journeysAtTip: 46,
    journeysInThisTree: 45,
    delta: 1,
  },
  {
    // F370 re-pin (machine-measured at the merged tree a4f412c, probe
    // f370-measure): the Wave-18 production-hardening lanes. F370A —
    // authentication + server-side tenant authorization: 5 census-
    // certified D14 security journeys (credentials; sessions; request-
    // order; approval; receipt-enrollment) — security 31 -> 36.
    workItem: "F370A",
    lane: "worker-a (identity boundary)",
    branch: "work/f370a",
    branchTipCommit: "0d7630d",
    corpus: "security",
    journeysAtTip: 36,
    journeysInThisTree: 31,
    delta: 5,
  },
  {
    // F370B — secret management: 3 census-certified D14 security journeys
    // (keyring rotation; session revocation; secure-random no-leak) —
    // security 36 -> 39. ZERO industries.ts motion.
    workItem: "F370B",
    lane: "worker-b (secret management)",
    branch: "work/f370b",
    branchTipCommit: "1cf51eb",
    corpus: "security",
    journeysAtTip: 39,
    journeysInThisTree: 36,
    delta: 3,
  },
  {
    // F370C — authoritative persistence + verified deployment: 3 census-
    // certified D14 commerce journeys (persistence+crash-restart;
    // authorization at the boundary; backup/restore round-trip) driving
    // the REAL :3107 service over HTTP — commerce 46 -> 49. ZERO
    // industries.ts motion.
    workItem: "F370C",
    lane: "worker-c (persistence + deployment)",
    branch: "work/f370c",
    branchTipCommit: "ca8b22c",
    corpus: "commerce",
    journeysAtTip: 49,
    journeysInThisTree: 46,
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
  field: 42,
  commerce: 49,
  security: 39,
  fullyApplicableFirmCap: 42 + 49 + 39,
};

/** The TL's recompute at convergence (all three lanes merged). */
export interface ConvergenceExpectation {
  readonly field: number;
  readonly commerce: number;
  readonly security: number;
  /** A fully-applicable firm's counted cap at convergence. */
  readonly fullyApplicableFirmCap: number;
  readonly targetPerFirm: number;
  /** The residual to the 100 target. F342 closed B-3 at EXACTLY 100
   * (35+36+29). F351B's sanctioned grow-only corpus expansion (F350 §4 —
   * the binding masked-industry disposition) raises the cap ABOVE the
   * closed target (105 at F353); the never-weaken invariant is now
   * cap >= target (a regression below 100 is refused as loudly as ever),
   * while masked-industry shortfalls live in the ledger. */
  readonly shortfallPerFullyApplicableFirm: number;
}

export const CONVERGENCE_EXPECTATION: ConvergenceExpectation = {
  field: 42,
  commerce: 49,
  security: 39,
  fullyApplicableFirmCap: 42 + 49 + 39,
  targetPerFirm: 100,
  shortfallPerFullyApplicableFirm: 100 - (42 + 49 + 39),
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
  // F353 re-pin: the F342 tripwire refused a NEGATIVE shortfall (count
  // inflation faking the B-3 closure). Post-closure, the binding law is the
  // F350 §4 disposition: grow-only corpus expansion legitimately raises the
  // cap above the closed 100 target. The never-weaken invariant preserved:
  // the cap may never REGRESS below the target, and must always equal the
  // live corpus sum (checked above) — inflation via fake journeys remains
  // impossible because every corpus member is census-certified D14 real.
  if (CONVERGENCE_EXPECTATION.fullyApplicableFirmCap < CONVERGENCE_EXPECTATION.targetPerFirm) {
    problems.push("the fully-applicable cap fell below the 100/firm target — the F342 B-3 closure must never regress (post-closure growth is sanctioned grow-only per F350 §4; weakening is not)");
  }
  return problems;
}
