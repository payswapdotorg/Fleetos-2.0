/**
 * The Wave 10 convergence expectation (F300C scoped TL grant): the honest
 * parameterization of the sibling lanes' pushed-but-unmerged corpus
 * extensions, and the structural-preservation law — the 100-per-firm
 * target is never silently weakened.
 */

import { describe, expect, it } from "vitest";
import {
  LANE_EXTENSIONS,
  CURRENT_TREE_COUNTS,
  CONVERGENCE_EXPECTATION,
  verifyConvergenceExpectation,
} from "../src/convergence-delta.js";
import { JOURNEYS as COMMERCE_JOURNEYS } from "@fleetos/acceptance-commerce/journeys";
import { FIELD_JOURNEYS } from "@fleetos/acceptance-field/journeys";
import { SECURITY_JOURNEYS } from "@fleetos/acceptance-security/journeys";

describe("convergence expectation (honest parameterization)", () => {
  it("machine-verifies: deltas add up, tips recorded, cap = corpus sum, shortfall preserved", () => {
    expect(verifyConvergenceExpectation()).toEqual([]);
  });

  it("records ALL lane extensions (Wave 10 + 12 + 13 + 14) with their branch tips", () => {
    expect(LANE_EXTENSIONS.map((r) => r.workItem).sort()).toEqual(["F300A", "F300B", "F321A", "F321B", "F321C", "F331A", "F331C", "F341A", "F341B", "F351B", "F351C"]);
    expect(LANE_EXTENSIONS.every((r) => r.branchTipCommit.length > 0)).toBe(true);
    expect(LANE_EXTENSIONS.every((r) => r.branch.startsWith("work/"))).toBe(true);
  });

  it("CURRENT_TREE_COUNTS reflect THIS branch's REAL corpora (machine-checked, not asserted prose)", () => {
    expect(CURRENT_TREE_COUNTS.commerce).toBe(COMMERCE_JOURNEYS.length);
    expect(CURRENT_TREE_COUNTS.field).toBe(FIELD_JOURNEYS.length);
    expect(CURRENT_TREE_COUNTS.security).toBe(SECURITY_JOURNEYS.length);
    expect(CURRENT_TREE_COUNTS.fullyApplicableFirmCap).toBe(
      CURRENT_TREE_COUNTS.field + CURRENT_TREE_COUNTS.commerce + CURRENT_TREE_COUNTS.security,
    );
  });

  it("the convergence expectation EXCEEDS the closed 100/firm target for fully-applicable firms via sanctioned grow-only corpus growth (F353 — never weakened)", () => {
    expect(CONVERGENCE_EXPECTATION.fullyApplicableFirmCap).toBe(110);
    expect(CONVERGENCE_EXPECTATION.targetPerFirm).toBe(100);
    expect(CONVERGENCE_EXPECTATION.shortfallPerFullyApplicableFirm).toBe(-10);
    // F342 closed B-3 at EXACTLY 100 (field 35 + commerce 36 + security 29).
    // F351B's 5 census-certified journeys (F350 §4 — the binding masked-
    // industry disposition) raise the cap to 105: grow-only corpus expansion
    // above the closed target, machine-checked against the real corpus
    // lengths above. verifyConvergenceExpectation refuses any REGRESSION
    // below the 100 target as loudly as it refuses a weakened target;
    // fake-journey inflation remains impossible (D14 census certification
    // is the corpus admission law).
    expect(CONVERGENCE_EXPECTATION.fullyApplicableFirmCap).toBeGreaterThanOrEqual(100);
  });

  it("the commerce corpus in this tree is the Wave-16 converged extension (41 distinct journeys — 15 via F300C, 21 via F310C, 34 via F321C, 36 via F331C, 41 via F351C)", () => {
    expect(COMMERCE_JOURNEYS.length).toBe(41);
    const ids = COMMERCE_JOURNEYS.map((j) => j.id);
    for (const extension of ["host-surface", "host-intents", "host-tenant-edges", "gateway-routing", "role-assignment-handoff", "work-order-blocking"]) {
      expect(ids).toContain(extension);
    }
    for (const f310c of ["assignment-supersession", "deadline-escalation", "workload-release-rebalance", "project-completion-portfolio", "sla-scorecard-credit", "batched-order-reconciliation", "cost-allocation-exact-sums", "renewal-window-sweep", "provider-fallback-ladder", "budget-rebalance-proposal"]) {
      expect(ids).toContain(f310c);
    }
    for (const f321c of ["marketplace-publication-lifecycle", "vendor-directory-service-relationship", "actor-job-failure-expiry"]) {
      expect(ids).toContain(f321c);
    }
    for (const f331c of ["marketplace-transaction-flow", "tenant-billing-invoicing"]) {
      expect(ids).toContain(f331c);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });
});
