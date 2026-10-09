/**
 * The verdict rubric: coverage computation, capability mapping, threshold
 * behavior (exact boundaries), negative fixtures (failing critical journey
 * => RETAIN, never a silent pass), and determinism.
 */

import { describe, expect, it } from "vitest";
import {
  VERDICT_THRESHOLDS,
  applyVerdictRubric,
  computeCapabilityMappings,
  computeCoverage,
  computeVerdict,
  type CapabilityMappingResult,
  type CoverageResult,
  type JourneyExecutionFact,
} from "../src/verdicts.js";
import {
  applicableCommerceJourneys,
  applicableFieldJourneys,
  applicableSecurityJourneys,
  industryById,
} from "../src/industries.js";

// ---------------------------------------------------------------------------
// Fixture fact builders (facts only — verdicts never re-run journeys)
// ---------------------------------------------------------------------------

function fact(corpus: JourneyExecutionFact["corpus"], journeyId: string, passed = true): JourneyExecutionFact {
  return {
    corpus,
    journeyId,
    epoch: 0,
    passed,
    failureNote: passed ? null : `fixture failure note for ${journeyId}`,
    digest: `fx_${corpus}_${journeyId}`,
  };
}

function allPassingFacts(industryId: string): JourneyExecutionFact[] {
  const industry = industryById(industryId);
  if (industry === undefined) throw new Error("unknown industry");
  const facts: JourneyExecutionFact[] = [];
  for (const j of applicableFieldJourneys(industry)) facts.push(fact("field", j.id));
  for (const j of applicableCommerceJourneys(industry)) facts.push(fact("commerce", j.id));
  for (const j of applicableSecurityJourneys(industry)) facts.push(fact("security", j.journeyId));
  return facts;
}

function withFailing(facts: readonly JourneyExecutionFact[], journeyId: string): JourneyExecutionFact[] {
  return facts.map((f) => (f.journeyId === journeyId ? { ...f, passed: false, failureNote: `fixture: ${journeyId} failed honestly` } : f));
}

function withoutJourney(facts: readonly JourneyExecutionFact[], journeyId: string): JourneyExecutionFact[] {
  return facts.filter((f) => f.journeyId !== journeyId);
}

function coverageAt(ratio: number, failing: CoverageResult["failing"] = []): CoverageResult {
  const total = 1000;
  const passed = Math.round(ratio * total);
  return { total, passed, failed: failing.length, ratio: passed / total, failing };
}

function mapping(
  capabilityId: string,
  criticality: "core" | "adjunct",
  status: CapabilityMappingResult["status"],
  notPassing: string[] = [],
): CapabilityMappingResult {
  return {
    capabilityId,
    profileId: "incumbent-fixture",
    criticality,
    family: [],
    applicableFamilyJourneys: [],
    status,
    notPassing,
  };
}

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

describe("coverage computation", () => {
  it("all-passing facts over a full industry give ratio 1.0 with the applicable denominator", () => {
    const coverage = computeCoverage(industryById("manufacturing")!, allPassingFacts("manufacturing"));
    expect(coverage.total).toBe(48);
    expect(coverage.passed).toBe(48);
    expect(coverage.ratio).toBe(1);
    expect(coverage.failing).toHaveLength(0);
  });

  it("masked journeys are EXCLUDED from the denominator (never covered, never failed)", () => {
    const coverage = computeCoverage(industryById("agriculture")!, allPassingFacts("agriculture"));
    expect(coverage.total).toBe(35); // 48 - 13 masked
    expect(coverage.passed).toBe(35);
    expect(coverage.ratio).toBe(1);
  });

  it("a failing journey is visible with its REAL failure note (never hidden)", () => {
    const facts = withFailing(allPassingFacts("manufacturing"), "maintain-asset-schedule");
    const coverage = computeCoverage(industryById("manufacturing")!, facts);
    expect(coverage.passed).toBe(47);
    expect(coverage.failed).toBe(1);
    const failing = coverage.failing[0];
    expect(failing?.journeyId).toBe("maintain-asset-schedule");
    expect(failing?.reason).toContain("maintain-asset-schedule");
    expect(failing?.corpus).toBe("field");
  });

  it("a journey with ZERO executions counts as not-passed but not as failed", () => {
    const facts = withoutJourney(allPassingFacts("construction"), "quote-scoring");
    const coverage = computeCoverage(industryById("construction")!, facts);
    expect(coverage.total).toBe(45);
    expect(coverage.passed).toBe(44);
    expect(coverage.failed).toBe(0);
    expect(coverage.ratio).toBeCloseTo(44 / 45, 10);
  });

  it("multiple executions of one journey: ANY failing execution fails the journey", () => {
    const facts = [...allPassingFacts("agriculture"), fact("field", "mobile-field-shape", false)];
    const coverage = computeCoverage(industryById("agriculture")!, facts);
    expect(coverage.passed).toBe(34);
    expect(coverage.failing[0]?.journeyId).toBe("mobile-field-shape");
  });
});

// ---------------------------------------------------------------------------
// Capability mappings
// ---------------------------------------------------------------------------

describe("capability mappings", () => {
  it("all-passing facts replace every non-moat capability for manufacturing (SWITCH inputs)", () => {
    const mappings = computeCapabilityMappings(industryById("manufacturing")!, allPassingFacts("manufacturing"));
    expect(mappings.length).toBeGreaterThan(20);
    expect(mappings.filter((m) => m.status === "replaced").length).toBe(mappings.length);
  });

  it("an empty-family moat is unmapped, with the family recorded", () => {
    const mappings = computeCapabilityMappings(industryById("healthcare-facilities")!, allPassingFacts("healthcare-facilities"));
    const clinical = mappings.find((m) => m.capabilityId === "clinical-workflow-integration");
    expect(clinical?.status).toBe("unmapped");
    expect(clinical?.family).toHaveLength(0);
    expect(clinical?.criticality).toBe("core");
  });

  it("a fully-masked family is unmapped (out of scope, not a failure)", () => {
    // construction masks mission-replay-resume — mission-continuity unmapped.
    const mappings = computeCapabilityMappings(industryById("construction")!, allPassingFacts("construction"));
    const mission = mappings.find((m) => m.capabilityId === "mission-continuity");
    expect(mission?.status).toBe("unmapped");
    expect(mission?.applicableFamilyJourneys).toHaveLength(0);
    expect(mission?.family).toEqual(["mission-replay-resume"]);
  });

  it("a REAL failure inside a family makes the capability partial with the journey listed", () => {
    const facts = withFailing(allPassingFacts("manufacturing"), "create-work-order");
    const mappings = computeCapabilityMappings(industryById("manufacturing")!, facts);
    const workOrders = mappings.find((m) => m.capabilityId === "work-order-management");
    expect(workOrders?.status).toBe("partial");
    expect(workOrders?.notPassing).toContain("create-work-order");
  });
});

// ---------------------------------------------------------------------------
// The rubric — exact threshold boundaries (documented contract)
// ---------------------------------------------------------------------------

describe("verdict rubric thresholds", () => {
  it("thresholds are the documented contract (1.0 / 0.7 / 0.3)", () => {
    expect(VERDICT_THRESHOLDS.switchOnlyCoverage).toBe(1);
    expect(VERDICT_THRESHOLDS.mainInterfaceMinCoverage).toBe(0.7);
    expect(VERDICT_THRESHOLDS.complementMinCoverage).toBe(0.3);
  });

  it("coverage exactly 0.70 with core replaced is MAIN-INTERFACE", () => {
    const result = applyVerdictRubric(coverageAt(0.7), [mapping("c1", "core", "replaced"), mapping("a1", "adjunct", "partial")]);
    expect(result.verdict).toBe("MAIN-INTERFACE");
  });

  it("coverage 0.69 with core replaced falls to COMPLEMENT (below the line)", () => {
    const result = applyVerdictRubric(coverageAt(0.69), [mapping("c1", "core", "replaced"), mapping("a1", "adjunct", "partial")]);
    expect(result.verdict).toBe("COMPLEMENT");
  });

  it("coverage exactly 0.30 with core replaced is COMPLEMENT", () => {
    const result = applyVerdictRubric(coverageAt(0.3), [mapping("c1", "core", "replaced"), mapping("a1", "adjunct", "unmapped")]);
    expect(result.verdict).toBe("COMPLEMENT");
  });

  it("coverage 0.29 is RETAIN even with core replaced (fail-closed)", () => {
    const result = applyVerdictRubric(coverageAt(0.29), [mapping("c1", "core", "replaced")]);
    expect(result.verdict).toBe("RETAIN");
    expect(result.reason).toContain("0.29");
  });

  it("coverage 1.0 + everything replaced is SWITCH-ONLY", () => {
    const result = applyVerdictRubric(coverageAt(1), [mapping("c1", "core", "replaced"), mapping("a1", "adjunct", "replaced")]);
    expect(result.verdict).toBe("SWITCH-ONLY");
  });

  it("coverage 1.0 + one adjunct unmapped is MAIN-INTERFACE, and the reason names it", () => {
    const result = applyVerdictRubric(coverageAt(1), [
      mapping("c1", "core", "replaced"),
      mapping("moat", "adjunct", "unmapped"),
    ]);
    expect(result.verdict).toBe("MAIN-INTERFACE");
    expect(result.reason).toContain("moat");
  });

  it("coverage 1.0 + a CORE capability unmapped is COMPLEMENT", () => {
    const result = applyVerdictRubric(coverageAt(1), [
      mapping("c1", "core", "replaced"),
      mapping("moat", "core", "unmapped"),
    ]);
    expect(result.verdict).toBe("COMPLEMENT");
    expect(result.reason).toContain("moat");
  });

  it("a core capability PARTIAL (real failure) is RETAIN — never a silent pass", () => {
    const result = applyVerdictRubric(coverageAt(1), [
      mapping("c1", "core", "replaced"),
      mapping("c2", "core", "partial", ["journey-x"]),
    ]);
    expect(result.verdict).toBe("RETAIN");
    expect(result.reason).toContain("journey-x");
  });

  it("RETAIN beats everything (fail-closed ordering)", () => {
    const result = applyVerdictRubric(coverageAt(1), [
      mapping("c1", "core", "partial", ["j1"]),
      mapping("c2", "core", "replaced"),
      mapping("a1", "adjunct", "replaced"),
    ]);
    expect(result.verdict).toBe("RETAIN");
  });
});

// ---------------------------------------------------------------------------
// Full verdict computation over real industries with fixture facts
// ---------------------------------------------------------------------------

describe("industry verdicts (fixture facts)", () => {
  it("manufacturing: coverage 1.0 + full mapping => SWITCH-ONLY", () => {
    const result = computeVerdict(industryById("manufacturing")!, allPassingFacts("manufacturing"));
    expect(result.verdict).toBe("SWITCH-ONLY");
    expect(result.input.coverage.ratio).toBe(1);
  });

  it("construction: core mapped + adjunct moats => MAIN-INTERFACE", () => {
    const result = computeVerdict(industryById("construction")!, allPassingFacts("construction"));
    expect(result.verdict).toBe("MAIN-INTERFACE");
    const unmappedIds = result.input.mappings.filter((m) => m.status !== "replaced").map((m) => m.capabilityId);
    expect(unmappedIds).toContain("bid-exchange");
    expect(unmappedIds).toContain("mission-continuity");
  });

  it("healthcare: clinical core moat => COMPLEMENT", () => {
    const result = computeVerdict(industryById("healthcare-facilities")!, allPassingFacts("healthcare-facilities"));
    expect(result.verdict).toBe("COMPLEMENT");
    expect(result.reason).toContain("clinical-workflow-integration");
  });

  it("NEGATIVE FIXTURE: a failing CORE journey forces RETAIN and stays visible", () => {
    // maintain-asset-schedule sits in maintenance-planning (CORE) everywhere.
    const facts = withFailing(allPassingFacts("mining"), "maintain-asset-schedule");
    const result = computeVerdict(industryById("mining")!, facts);
    expect(result.verdict).toBe("RETAIN");
    expect(result.input.criticalFailures).toContain("maintain-asset-schedule");
    expect(result.input.coverage.failing[0]?.journeyId).toBe("maintain-asset-schedule");
    expect(result.reason).toContain("maintain-asset-schedule");
  });

  it("NEGATIVE FIXTURE: a failing ADJUNCT-only journey does NOT force RETAIN, but is visible", () => {
    // security.learn-from-outcomes sits in learning-loop (ADJUNCT) for construction.
    const facts = withFailing(allPassingFacts("construction"), "security.learn-from-outcomes");
    const result = computeVerdict(industryById("construction")!, facts);
    expect(result.verdict).toBe("MAIN-INTERFACE"); // core intact, coverage 44/45
    expect(result.input.coverage.failing[0]?.journeyId).toBe("security.learn-from-outcomes");
    const learning = result.input.mappings.find((m) => m.capabilityId === "learning-loop");
    expect(learning?.status).toBe("partial");
  });

  it("NEGATIVE FIXTURE: a never-executed core journey is fail-closed RETAIN", () => {
    const facts = withoutJourney(allPassingFacts("telecommunications"), "create-work-order");
    const result = computeVerdict(industryById("telecommunications")!, facts);
    expect(result.verdict).toBe("RETAIN");
    expect(result.input.criticalFailures).toContain("create-work-order");
  });

  it("deterministic: identical facts produce identical verdicts and reasons", () => {
    const facts = allPassingFacts("water-waste");
    const a = computeVerdict(industryById("water-waste")!, facts);
    const b = computeVerdict(industryById("water-waste")!, [...facts]);
    expect(a.verdict).toBe(b.verdict);
    expect(a.reason).toBe(b.reason);
    expect(a.input.coverage.ratio).toBe(b.input.coverage.ratio);
  });
});
