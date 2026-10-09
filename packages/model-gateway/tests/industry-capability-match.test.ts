/**
 * F290C — model-gateway industry capability matching tests. Maps industry
 * skill requirements to model-option capability tags through the EXISTING
 * `findModelsByCapabilities` + `validateModelRegistry`; unmatched
 * requirements are honest refusals with reason codes.
 */
import { describe, expect, it } from "vitest";
import {
  matchIndustryCapabilities,
  computeCapabilityMatchDigest,
  type ModelDescriptor,
} from "../src/index.js";
import { validateModelRegistry } from "../src/index.js";

const REGISTRY: ModelDescriptor[] = [
  { id: "mdl-invoke", providerId: "p1", capabilityTags: ["model_invoke", "summarize"], costPerUnitMinor: 20, maxContextUnits: 80000 },
  { id: "mdl-telemetry", providerId: "p2", capabilityTags: ["model_invoke", "analyze-telemetry"], costPerUnitMinor: 35, maxContextUnits: 120000 },
  { id: "mdl-forecast", providerId: "p1", capabilityTags: ["forecast", "model_invoke"], costPerUnitMinor: 50, maxContextUnits: 100000 },
  { id: "mdl-route", providerId: "p3", capabilityTags: ["route-opt"], costPerUnitMinor: 15, maxContextUnits: 60000 },
];

describe("F290C capability match — full coverage", () => {
  it("matches every required capability through findModelsByCapabilities and returns a digest", () => {
    const result = matchIndustryCapabilities(REGISTRY, ["model_invoke", "forecast"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.matches).toHaveLength(2);
      const invoke = result.matches.find((m) => m.capability === "model_invoke")!;
      expect(invoke.unmatched).toBe(false);
      // findModelsByCapabilities returns models having the tag, lexically sorted by id
      expect(invoke.matched.map((m) => m.id).sort()).toEqual(["mdl-forecast", "mdl-invoke", "mdl-telemetry"]);
      expect(result.digest).toMatch(/^indcap_[0-9a-f]{8}$/);
    }
  });

  it("validates the registry with the REAL validateModelRegistry first", () => {
    expect(validateModelRegistry(REGISTRY).ok).toBe(true);
  });

  it("the matcher is deterministic — byte-identical on re-run", () => {
    const a = matchIndustryCapabilities(REGISTRY, ["model_invoke", "route-opt"]);
    const b = matchIndustryCapabilities(REGISTRY, ["model_invoke", "route-opt"]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("F290C capability match — honest refusals", () => {
  it("refuses when a required capability is matched by NO model (NO_MODEL_MATCHES_REQUIREMENT)", () => {
    const result = matchIndustryCapabilities(REGISTRY, ["model_invoke", "grid-balance"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("NO_MODEL_MATCHES_REQUIREMENT");
      expect(result.unmatchedCapabilities).toEqual(["grid-balance"]);
      expect(result.detail).toBe("grid-balance");
      // partial matches are still surfaced (model_invoke WAS satisfiable)
      const partial = result.partialMatches.find((m) => m.capability === "model_invoke");
      expect(partial?.unmatched).toBe(false);
    }
  });

  it("refuses an empty requirements list (REQUIREMENTS_EMPTY)", () => {
    const result = matchIndustryCapabilities(REGISTRY, []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe("REQUIREMENTS_EMPTY");
  });

  it("refuses an empty capability tag within requirements (REQUIREMENT_CAPABILITY_EMPTY)", () => {
    const result = matchIndustryCapabilities(REGISTRY, ["model_invoke", ""]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe("REQUIREMENT_CAPABILITY_EMPTY");
  });

  it("refuses a duplicated capability (REQUIREMENT_CAPABILITY_DUPLICATED)", () => {
    const result = matchIndustryCapabilities(REGISTRY, ["model_invoke", "model_invoke"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("REQUIREMENT_CAPABILITY_DUPLICATED");
      expect(result.detail).toBe("model_invoke");
    }
  });

  it("refuses an invalid registry (REGISTRY_INVALID) with the REAL registry reason code", () => {
    const badRegistry: ModelDescriptor[] = [
      { id: "", providerId: "p1", capabilityTags: ["model_invoke"], costPerUnitMinor: 10, maxContextUnits: 1000 },
    ];
    const result = matchIndustryCapabilities(badRegistry, ["model_invoke"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("REGISTRY_INVALID");
      expect(result.detail).toBe("MODEL_ID_EMPTY");
    }
  });
});

describe("F290C capability match — digest", () => {
  it("computeCapabilityMatchDigest is indcap_<8hex> and deterministic", () => {
    const result = matchIndustryCapabilities(REGISTRY, ["model_invoke", "summarize"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const d = computeCapabilityMatchDigest(result.matches);
    expect(d).toMatch(/^indcap_[0-9a-f]{8}$/);
    expect(computeCapabilityMatchDigest(result.matches)).toBe(d);
  });
});
