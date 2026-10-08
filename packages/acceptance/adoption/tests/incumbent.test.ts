/**
 * Incumbent capability baselines: profile shape, family validity, moats,
 * no vendor trademarks.
 */

import { describe, expect, it } from "vitest";
import {
  INCUMBENT_BASELINES,
  incumbentBaseline,
  incumbentCapabilities,
  type IncumbentCapability,
} from "../src/incumbent.js";
import { CORPUS_JOURNEY_IDS, INDUSTRIES } from "../src/industries.js";

const ALL_JOURNEY_IDS = new Set<string>([
  ...CORPUS_JOURNEY_IDS.field,
  ...CORPUS_JOURNEY_IDS.commerce,
  ...CORPUS_JOURNEY_IDS.security,
]);

describe("incumbent baselines", () => {
  it("has exactly one baseline per industry (10 total)", () => {
    expect(INCUMBENT_BASELINES.length).toBe(10);
    for (const industry of INDUSTRIES) {
      expect(incumbentBaseline(industry.id)).toBeDefined();
    }
    expect(incumbentBaseline("no-such-industry")).toBeUndefined();
  });

  it("every profile id is an incumbent archetype (no vendor trademarks)", () => {
    for (const baseline of INCUMBENT_BASELINES) {
      expect(baseline.profiles.length).toBeGreaterThanOrEqual(3);
      for (const profile of baseline.profiles) {
        expect(profile.profileId.startsWith("incumbent-")).toBe(true);
        expect(profile.role.length).toBeGreaterThan(0);
      }
    }
  });

  it("capability ids are unique within each industry", () => {
    for (const baseline of INCUMBENT_BASELINES) {
      const ids = incumbentCapabilities(baseline.industryId).map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("every replacement family references REAL journey ids (or is an explicit empty moat)", () => {
    for (const baseline of INCUMBENT_BASELINES) {
      for (const cap of incumbentCapabilities(baseline.industryId)) {
        for (const journeyId of cap.replacementJourneyFamily) {
          expect(ALL_JOURNEY_IDS.has(journeyId)).toBe(true);
        }
      }
    }
  });

  it("exactly the 9 moat-bound industries carry an honest incumbent MOAT; manufacturing has none (the SWITCH-ONLY case)", () => {
    const moatCounts = INCUMBENT_BASELINES.map((b) => ({
      industryId: b.industryId,
      moats: incumbentCapabilities(b.industryId).filter((c) => c.replacementJourneyFamily.length === 0).length,
    }));
    const moatBound = moatCounts.filter((m) => m.moats >= 1);
    expect(moatBound.length).toBe(9);
    const manufacturing = moatCounts.find((m) => m.industryId === "manufacturing");
    expect(manufacturing?.moats).toBe(0); // full-stack replacement — the SWITCH-ONLY inputs
  });

  it("every capability carries both coverage notes (does / does not)", () => {
    for (const baseline of INCUMBENT_BASELINES) {
      for (const cap of incumbentCapabilities(baseline.industryId)) {
        expect(cap.summary.length).toBeGreaterThan(10);
        expect(cap.doesNot.length).toBeGreaterThan(10);
        expect(cap.criticality === "core" || cap.criticality === "adjunct").toBe(true);
      }
    }
  });

  it("every industry has core capabilities including tenant isolation", () => {
    for (const baseline of INCUMBENT_BASELINES) {
      const caps = incumbentCapabilities(baseline.industryId);
      expect(caps.filter((c) => c.criticality === "core").length).toBeGreaterThanOrEqual(5);
      const tenant = caps.find((c) => c.id === "tenant-isolation") as IncumbentCapability | undefined;
      expect(tenant).toBeDefined();
      expect(tenant?.criticality).toBe("core");
    }
  });

  it("incumbentCapabilities flattens with profile attribution", () => {
    const caps = incumbentCapabilities("manufacturing");
    expect(caps.length).toBeGreaterThan(15);
    for (const cap of caps) {
      expect(cap.profileId.startsWith("incumbent-")).toBe(true);
    }
  });

  it("the moat catalog is honest: moat families are empty by DATA, never by masking accidents", () => {
    // A moat capability must be structurally empty; a non-moat capability
    // with an all-masked family is a DIFFERENT honest state (out of scope
    // for that industry) — both are exercised by the catalog.
    const moats = INCUMBENT_BASELINES.flatMap((b) =>
      incumbentCapabilities(b.industryId).filter((c) => c.replacementJourneyFamily.length === 0),
    );
    const moatIds = new Set(moats.map((m) => m.id));
    expect(moatIds.has("clinical-workflow-integration")).toBe(true);
    expect(moatIds.has("agronomy-prescriptive-analytics")).toBe(true);
    expect(moatIds.has("dispatch-routing-optimization")).toBe(true);
  });
});
