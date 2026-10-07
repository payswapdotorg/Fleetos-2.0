/**
 * World-model kernel tests — counterfactual uncertainty widening, A11.
 *
 * Wave 1 (F210B) additions.
 */
import { describe, it, expect } from "vitest";
import {
  widenUncertaintyForCounterfactual,
  buildCounterfactualWithWidenedUncertainty,
  counterfactualUncertaintyIsWider,
  makeWideningReferenceAdapter,
  makeReferenceWorldModelAdapter,
  assertHypotheticalMarker,
} from "../src/index.ts";

const tenant = { tenantId: "t1" };
const asset = { assetId: "a1" };
const features = { temp: 25, humidity: 60 };

describe("widenUncertaintyForCounterfactual", () => {
  it("widens the interval by the given factor", () => {
    const baseline = { lower: -1, upper: 1, confidence: 0.8, method: "reference.constant" as const };
    const widened = widenUncertaintyForCounterfactual(baseline, 2);
    expect(widened.lower).toBe(-2);
    expect(widened.upper).toBe(2);
    expect(widened.confidence).toBe(0.4);
  });

  it("is deterministic", () => {
    const baseline = { lower: -1, upper: 1, confidence: 0.8, method: "reference.constant" as const };
    expect(widenUncertaintyForCounterfactual(baseline, 3)).toEqual(widenUncertaintyForCounterfactual(baseline, 3));
  });
});

describe("buildCounterfactualWithWidenedUncertainty", () => {
  it("produces a counterfactual with wider uncertainty than baseline", () => {
    const adapter = makeReferenceWorldModelAdapter("2026-01-01T00:00:00.000Z");
    const rep = adapter.represent({ tenant, asset, features });
    const baseline = adapter.predict(rep);
    const cf = buildCounterfactualWithWidenedUncertainty(adapter, rep, "what if temp +5?", 30, 2);

    expect(cf.value.kind).toBe("HYPOTHETICAL");
    expect(assertHypotheticalMarker(cf)).toBe(true);
    expect(counterfactualUncertaintyIsWider(baseline, cf.value)).toBe(true);
  });

  it("is deterministic — same inputs => same scenarioId", () => {
    const adapter = makeReferenceWorldModelAdapter("2026-01-01T00:00:00.000Z");
    const rep = adapter.represent({ tenant, asset, features });
    const cf1 = buildCounterfactualWithWidenedUncertainty(adapter, rep, "test", 30, 2);
    const cf2 = buildCounterfactualWithWidenedUncertainty(adapter, rep, "test", 30, 2);
    expect(cf1.scenarioId).toBe(cf2.scenarioId);
  });
});

describe("counterfactualUncertaintyIsWider", () => {
  it("returns true when counterfactual is wider", () => {
    const baseline = {
      kind: "PREDICTED" as const,
      value: 100,
      uncertainty: { lower: 90, upper: 110, confidence: 0.8, method: "bootstrap" as const },
      predictedAt: "t",
      validUntil: "t",
      provenance: { modelVersion: "1.0", capabilityVersion: "1.0", featureDigest: "fd", inputsDigest: "id" },
      tenant,
      asset,
    };
    const cf = {
      kind: "HYPOTHETICAL" as const,
      value: 110,
      uncertainty: { lower: 80, upper: 120, confidence: 0.4, method: "bootstrap" as const },
      premise: "test",
      computedAt: "t",
      provenance: baseline.provenance,
      tenant,
      asset,
      hypothetical: true as const,
    };
    expect(counterfactualUncertaintyIsWider(baseline, cf)).toBe(true);
  });

  it("returns false when counterfactual is NOT wider", () => {
    const baseline = {
      kind: "PREDICTED" as const,
      value: 100,
      uncertainty: { lower: 90, upper: 110, confidence: 0.8, method: "bootstrap" as const },
      predictedAt: "t",
      validUntil: "t",
      provenance: { modelVersion: "1.0", capabilityVersion: "1.0", featureDigest: "fd", inputsDigest: "id" },
      tenant,
      asset,
    };
    const cf = {
      kind: "HYPOTHETICAL" as const,
      value: 110,
      uncertainty: { lower: 95, upper: 105, confidence: 0.4, method: "bootstrap" as const }, // NARROWER
      premise: "test",
      computedAt: "t",
      provenance: baseline.provenance,
      tenant,
      asset,
      hypothetical: true as const,
    };
    expect(counterfactualUncertaintyIsWider(baseline, cf)).toBe(false);
  });
});

describe("makeWideningReferenceAdapter", () => {
  it("produces counterfactuals with widened uncertainty", () => {
    const adapter = makeWideningReferenceAdapter("2026-01-01T00:00:00.000Z", 2);
    const rep = adapter.represent({ tenant, asset, features });
    const baseline = adapter.predict(rep);
    const cf = adapter.counterfactual(rep, "test", 30, baseline.uncertainty);

    expect(cf.value.kind).toBe("HYPOTHETICAL");
    expect(counterfactualUncertaintyIsWider(baseline, cf.value)).toBe(true);
  });

  it("does NOT widen if the provided uncertainty is already wider", () => {
    const adapter = makeWideningReferenceAdapter("2026-01-01T00:00:00.000Z", 2);
    const rep = adapter.represent({ tenant, asset, features });
    const baseline = adapter.predict(rep);
    const alreadyWide = {
      lower: baseline.uncertainty.lower - 100,
      upper: baseline.uncertainty.upper + 100,
      confidence: 0.1,
      method: "bootstrap" as const,
    };
    const cf = adapter.counterfactual(rep, "test", 30, alreadyWide);
    // Should NOT be widened further — already wide enough
    expect(cf.value.uncertainty).toEqual(alreadyWide);
  });
});
