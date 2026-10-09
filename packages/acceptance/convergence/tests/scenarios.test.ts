/**
 * @fleetos/acceptance-convergence — per-industry scenario assembly tests.
 *
 * Every industry scenario is assembled END-TO-END over the REAL Wave-9
 * surfaces (REAL archetype + policy guard, REAL asset directory + lineage
 * builders, REAL observation anchor, REAL JEPA family adapters) and the
 * record is verified field-by-field against the REAL artifacts it carries
 * by reference. Tenant fail-closed, world validation, digest determinism
 * and post-hoc tamper detection are machine-tested.
 */

import { describe, expect, it } from "vitest";
import { computeArchetypeDigest, getArchetype, policyForArchetype } from "@fleetos/agent-organizations";
import { verifyOptimizationProblemDigest } from "@fleetos/agent-organizations";
import { ACCEPTANCE_RELEASE_SCHEMA_VERSION } from "@fleetos/acceptance-release";
import { FIELD_JOURNEYS } from "@fleetos/acceptance-field/journeys";
import { SECURITY_JOURNEYS } from "@fleetos/acceptance-security/journeys";
import { JOURNEYS as COMMERCE_JOURNEYS } from "@fleetos/acceptance-commerce/journeys";
import { assembleScenario, verifyScenarioDigest } from "../src/scenarios.js";
import { adoptionIndustryIdFor } from "../src/scenario-acceptance.js";
import { ALL_INDUSTRIES, freshScenario, scenarioFor, worldWithRealAnchor } from "./fixtures.js";

describe("scenarios — per-industry end-to-end assembly over the REAL surfaces", () => {
  for (const industry of ALL_INDUSTRIES) {
    it(`${industry}: REAL archetype + policy + problem + fleet + lineage + forecasts + anchor`, () => {
      const scenario = scenarioFor(industry);
      const archetype = getArchetype(industry, "medium");
      if (archetype === null) throw new Error("archetype missing");
      // The archetype artifact is the REAL record; its digest is the lane's own.
      expect(scenario.archetype).toEqual(archetype);
      expect(scenario.archetypeDigest).toBe(computeArchetypeDigest(archetype));
      // The policy is the REAL policyForArchetype output.
      expect(scenario.org.policy).toEqual(policyForArchetype(archetype));
      // The org problem is kernel-valid AND the policy overlay happened.
      expect(verifyOptimizationProblemDigest(scenario.org.problem)).toBe(true);
      expect(scenario.org.problem.goals).toEqual(archetype.goals);
      expect(scenario.org.problem.constraints.policyCeilings).toEqual(archetype.policyCeilings);
      expect(scenario.org.problem.constraints.budgetFloors).toEqual(archetype.budgetFloors);
      // The fleet: three REAL active assets.
      expect(scenario.fleet).toHaveLength(3);
      for (const asset of scenario.fleet) expect(asset.lifecycle).toBe("active");
      // The lineage chain: 5 edges, all 4 kinds, tenant-scoped.
      expect(scenario.graph.edgeCount).toBe(5);
      const kinds = new Set(scenario.graph.edges.map((e) => e.payload.kind));
      expect(kinds.has("asset-consumed-lot")).toBe(true);
      expect(kinds.has("method-applied-to-asset")).toBe(true);
      expect(kinds.has("lot-transformed-into-lot")).toBe(true);
      expect(kinds.has("asset-replaced-by-asset")).toBe(true);
      for (const edge of scenario.graph.edges) expect(edge.tenantId).toBe(scenario.tenantId);
      // The forecasts: 3 family adapters x 2 windows, REAL seam outputs.
      expect(scenario.forecasts).toHaveLength(6);
      const adapterIds = new Set(scenario.forecasts.map((f) => f.adapterId));
      expect(adapterIds).toEqual(new Set(["jepa.core", "jepa.masked", "jepa.rollout"]));
      for (const forecast of scenario.forecasts) {
        expect(forecast.predicted.kind).toBe("PREDICTED");
        expect(forecast.predicted.tenant.tenantId).toBe(scenario.tenantId);
        expect(typeof forecast.predicted.value).toBe("number");
      }
      // The REAL observation anchor bound and validated.
      expect(scenario.anchorResults).toHaveLength(1);
      expect(scenario.anchorResults[0]?.ok).toBe(true);
      // The digest verifies over the referenced REAL artifacts.
      expect(verifyScenarioDigest(scenario)).toBe(true);
      // Composition lineage carries the REAL release schema version.
      expect(scenario.compositionLineage.releaseSchemaVersion).toBe(ACCEPTANCE_RELEASE_SCHEMA_VERSION);
    });
  }

  it("the record carries the documented defaults (kind, ids, logical clock)", () => {
    const scenario = scenarioFor("manufacturing");
    expect(scenario.kind).toBe("convergence-scenario");
    expect(scenario.scenarioId).toBe("conv-manufacturing-medium");
    expect(scenario.tenantId).toBe("tnt_conv_manufacturing");
    expect(scenario.profile.sectorSignal).toBe("manufacturing");
    expect(scenario.profile.orgSizeHint).toBe("medium");
    expect(scenario.journeyApplicability.adoptionIndustryId).toBe("manufacturing");
  });

  it("tenant fail-closed: an empty tenant refuses the assembly", () => {
    const result = assembleScenario({ industry: "manufacturing", world: { tenantId: "" } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe("TENANT_ID_EMPTY");
  });

  it("unknown archetype: a bogus tier refuses with UNKNOWN_ARCHETYPE", () => {
    const result = assembleScenario({ industry: "manufacturing", tier: "gigantic" as never });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("UNKNOWN_ARCHETYPE");
      expect(result.detail).toBe("manufacturing/gigantic");
    }
  });

  it("world validation: a non-positive / non-integer horizon refuses", () => {
    for (const horizon of [0, -1, 1.5]) {
      const result = assembleScenario({
        industry: "logistics",
        world: { windows: [{ assetIndex: 0, horizon, current: { temperature: 20 } }] },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reasonCode).toBe("INVALID_WORLD");
    }
  });

  it("world validation: an out-of-range asset index refuses", () => {
    const result = assembleScenario({
      industry: "logistics",
      world: { windows: [{ assetIndex: 9, horizon: 2, current: { temperature: 20 } }] },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe("INVALID_WORLD");
  });

  it("world validation: a non-finite prev feature refuses", () => {
    const result = assembleScenario({
      industry: "logistics",
      world: { windows: [{ assetIndex: 0, horizon: 2, current: { temperature: 20 }, prev: { temperature: Number.NaN } }] },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe("INVALID_WORLD");
  });

  it("caller-supplied windows + computedAt are honored end-to-end", () => {
    const result = assembleScenario({
      industry: "facilities",
      world: {
        forecastComputedAt: "2026-11-02T08:00:00.000Z",
        windows: [{ assetIndex: 1, horizon: 3, current: { pressure: 2.2 }, prev: { pressure: 2.0 } }],
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scenario.forecasts).toHaveLength(3);
    for (const forecast of result.scenario.forecasts) {
      expect(forecast.predicted.predictedAt).toBe("2026-11-02T08:00:00.000Z");
      expect(forecast.assetId).toBe("ast_conv_fac_0002");
    }
  });

  it("byte-identical determinism: re-assembly reproduces the same digest", () => {
    const first = scenarioFor("construction");
    const second = assembleScenario({ industry: "construction", world: worldWithRealAnchor("construction") });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.scenario.scenarioDigest).toBe(first.scenarioDigest);
    expect(second.scenario.anchorResults[0]?.observation?.id).toBe(first.anchorResults[0]?.observation?.id);
  });

  it("post-hoc mutation of a referenced lot is DETECTED by the digest", () => {
    const scenario = freshScenario("manufacturing");
    const lot = scenario.lots[0];
    if (lot === undefined) throw new Error("lot missing");
    (lot as unknown as { remainingQuantity: number }).remainingQuantity = 0;
    expect(verifyScenarioDigest(scenario)).toBe(false);
  });

  it("post-hoc mutation of a referenced forecast is DETECTED by the digest", () => {
    const scenario = freshScenario("energy-utilities");
    const forecast = scenario.forecasts[0];
    if (forecast === undefined) throw new Error("forecast missing");
    (forecast.predicted as unknown as { value: number }).value = 999;
    expect(verifyScenarioDigest(scenario)).toBe(false);
  });

  it("post-hoc mutation of a referenced lineage edge is DETECTED by the digest", () => {
    const scenario = freshScenario("field-services");
    const edge = scenario.graph.edges[0];
    if (edge === undefined) throw new Error("edge missing");
    (edge.payload as unknown as { quantity: number }).quantity = 41;
    expect(verifyScenarioDigest(scenario)).toBe(false);
  });

  it("journey applicability: mapped industries carry the REAL split; totals are the REAL corpus lengths", () => {
    for (const industry of ["manufacturing", "logistics", "energy-utilities", "facilities", "construction"] as const) {
      const applicability = scenarioFor(industry).journeyApplicability;
      expect(applicability.adoptionIndustryId).toBe(adoptionIndustryIdFor(industry));
      expect(applicability.field).toEqual({
        status: "mapped", total: FIELD_JOURNEYS.length,
        applicable: expect.any(Number), masked: expect.any(Number),
      });
      if (applicability.field.status === "mapped") {
        expect(applicability.field.applicable + applicability.field.masked).toBe(FIELD_JOURNEYS.length);
      }
      if (applicability.security.status === "mapped") {
        expect(applicability.security.applicable + applicability.security.masked).toBe(SECURITY_JOURNEYS.length);
      }
      if (applicability.commerce.status === "mapped") {
        expect(applicability.commerce.applicable + applicability.commerce.masked).toBe(COMMERCE_JOURNEYS.length);
      }
    }
  });

  it("journey applicability: field-services is HONESTLY unmapped (no adoption counterpart)", () => {
    const applicability = scenarioFor("field-services").journeyApplicability;
    expect(adoptionIndustryIdFor("field-services")).toBeNull();
    expect(applicability.adoptionIndustryId).toBeNull();
    expect(applicability.field).toEqual({ status: "unmapped", total: FIELD_JOURNEYS.length });
    expect(applicability.security).toEqual({ status: "unmapped", total: SECURITY_JOURNEYS.length });
    expect(applicability.commerce).toEqual({ status: "unmapped", total: COMMERCE_JOURNEYS.length });
    expect(applicability.maskedCount).toBe(0);
  });

  it("honest assembly refusal: the deprecated-method attempt is RECORDED, never hidden", () => {
    for (const industry of ALL_INDUSTRIES) {
      const scenario = scenarioFor(industry);
      expect(scenario.refusals).toHaveLength(1);
      const refusal = scenario.refusals[0];
      if (refusal === undefined) throw new Error("refusal missing");
      expect(refusal.surface).toBe("applyMethodToAsset");
      expect(refusal.reasonCode).toBe("method-deprecated");
      // The deprecated definition stays READABLE in the history (append-only).
      const legacy = scenario.methodDefinitions.find((d) => d.version === "1.0.0");
      expect(legacy?.status).toBe("deprecated");
      expect(legacy?.deprecatedAt).not.toBeNull();
    }
  });

  it("parameter coercion is the REAL lane's: defaults applied, enums validated", () => {
    const scenario = scenarioFor("manufacturing");
    const service = scenario.applications.find((a) => a.methodVersion === "2.0.0");
    if (service === undefined) throw new Error("service application missing");
    expect(service.parameters).toEqual({ torque: 42, grease: "synthetic" });
    const inspect = scenario.applications.find((a) => a.methodVersion === "1.2.0");
    if (inspect === undefined) throw new Error("inspect application missing");
    expect(inspect.parameters).toEqual({ intensity: "standard", notes: "routine convergence pass" });
  });
});
