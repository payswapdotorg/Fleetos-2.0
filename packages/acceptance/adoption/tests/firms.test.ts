/**
 * The 30-workspace population: sizing laws, tenancy scoping, epoch
 * schedule, device-population record fields.
 */

import { describe, expect, it } from "vitest";
import {
  ADOPTION_T0,
  FIRM_EPOCH_COUNTS,
  FIRM_SIZES,
  WORKSPACE_POPULATION,
  determinismProofFirm,
  firmById,
  firmsOfIndustry,
} from "../src/firms.js";
import { INDUSTRIES } from "../src/industries.js";

/** The identity package's REAL tenant-id format law (F271 seam finding #1). */
const TENANT_ID_PATTERN = /^tnt_[A-Za-z0-9_-]{4,128}$/;

describe("workspace population", () => {
  it("is exactly 30 workspaces: 10 industries × 3 sizes", () => {
    expect(WORKSPACE_POPULATION.length).toBe(30);
    for (const industry of INDUSTRIES) {
      const firms = firmsOfIndustry(industry.id);
      expect(firms.length).toBe(3);
      expect(firms.map((f) => f.size)).toEqual(["small", "medium", "large"]);
    }
  });

  it("has unique firm ids and unique tenant ids (tenancy-scoped)", () => {
    const ids = WORKSPACE_POPULATION.map((f) => f.id);
    expect(new Set(ids).size).toBe(30);
    const tenants = WORKSPACE_POPULATION.map((f) => f.tenantId);
    expect(new Set(tenants).size).toBe(30);
  });

  it("tenant ids satisfy the REAL identity format law (tnt_ prefix)", () => {
    for (const firm of WORKSPACE_POPULATION) {
      expect(firm.tenantId).toMatch(TENANT_ID_PATTERN);
    }
  });

  it("tenant ids are derived deterministically from industry + size", () => {
    const firm = firmById("firm-healthcare-facilities-large");
    expect(firm?.tenantId).toBe("tnt_healthcare-facilities-large");
    expect(firmById("firm-agriculture-small")?.tenantId).toBe("tnt_agriculture-small");
  });

  it("the packet's example shape would FAIL the REAL validator (documented seam)", () => {
    // The packet suggested `tenant-<industry>-<size>`; the identity package
    // only accepts `tnt_*` — machine-verified. This test pins the law so the
    // deviation stays documented, not silent.
    expect("tenant-manufacturing-small").not.toMatch(TENANT_ID_PATTERN);
    expect("tnt_manufacturing-small").toMatch(TENANT_ID_PATTERN);
  });

  it("declared epoch schedule: small 1, medium 2, large 3", () => {
    expect(FIRM_EPOCH_COUNTS).toEqual({ small: 1, medium: 2, large: 3 });
    for (const firm of WORKSPACE_POPULATION) {
      expect(firm.epochCount).toBe(FIRM_EPOCH_COUNTS[firm.size]);
      expect(firm.epochs.length).toBe(firm.epochCount);
    }
  });

  it("every declared epoch anchors at the corpus fixture epoch (T0 calibration law)", () => {
    expect(ADOPTION_T0).toBe(1_774_000_000_000);
    for (const firm of WORKSPACE_POPULATION) {
      for (const startedAt of firm.epochs) {
        expect(startedAt).toBe(ADOPTION_T0);
      }
    }
  });

  it("device-population scale records 10s / 100s / 1000s (informational, never telemetry)", () => {
    for (const firm of WORKSPACE_POPULATION) {
      if (firm.size === "small") {
        expect(firm.devicePopulation.devices).toBeGreaterThanOrEqual(10);
        expect(firm.devicePopulation.devices).toBeLessThan(100);
      } else if (firm.size === "medium") {
        expect(firm.devicePopulation.devices).toBeGreaterThanOrEqual(100);
        expect(firm.devicePopulation.devices).toBeLessThan(1000);
      } else {
        expect(firm.devicePopulation.devices).toBeGreaterThanOrEqual(1000);
      }
      expect(firm.devicePopulation.scaleNote.length).toBeGreaterThan(0);
    }
  });

  it("firm ids follow the stable `firm-<industry>-<size>` shape", () => {
    for (const firm of WORKSPACE_POPULATION) {
      expect(firm.id).toBe(`firm-${firm.industryId}-${firm.size}`);
    }
  });

  it("determinism-proof firm is the LARGE firm of each industry", () => {
    for (const industry of INDUSTRIES) {
      const proof = determinismProofFirm(industry.id);
      expect(proof?.size).toBe("large");
      expect(proof?.id).toBe(`firm-${industry.id}-large`);
    }
    expect(determinismProofFirm("no-such-industry")).toBeUndefined();
  });

  it("firmById resolves and round-trips", () => {
    const firm = firmById("firm-water-waste-medium");
    expect(firm?.industryId).toBe("water-waste");
    expect(firm?.size).toBe("medium");
    expect(firmById("nope")).toBeUndefined();
  });

  it("FIRM_SIZES vocabulary is exactly small/medium/large", () => {
    expect(FIRM_SIZES).toEqual(["small", "medium", "large"]);
  });
});
