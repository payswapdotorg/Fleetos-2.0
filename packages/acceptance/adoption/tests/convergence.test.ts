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

  it("records BOTH sibling lane extensions with their branch tips", () => {
    expect(LANE_EXTENSIONS.map((r) => r.workItem).sort()).toEqual(["F300A", "F300B"]);
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

  it("the convergence expectation still falls short of the 100/firm target — the threshold is never weakened", () => {
    expect(CONVERGENCE_EXPECTATION.fullyApplicableFirmCap).toBe(58);
    expect(CONVERGENCE_EXPECTATION.targetPerFirm).toBe(100);
    expect(CONVERGENCE_EXPECTATION.shortfallPerFullyApplicableFirm).toBe(42);
    expect(CONVERGENCE_EXPECTATION.shortfallPerFullyApplicableFirm).toBeGreaterThan(0);
  });

  it("the commerce corpus in this tree is the F300C extension (21 distinct journeys — grew from 15)", () => {
    expect(COMMERCE_JOURNEYS.length).toBe(21);
    const ids = COMMERCE_JOURNEYS.map((j) => j.id);
    for (const extension of ["host-surface", "host-intents", "host-tenant-edges", "gateway-routing", "role-assignment-handoff", "work-order-blocking"]) {
      expect(ids).toContain(extension);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });
});
