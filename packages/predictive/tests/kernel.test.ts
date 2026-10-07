/**
 * Predictive kernel tests — windowing, widened uncertainty, A2 no-authoritative-write,
 * honest degraded states, A11 type distinctness.
 *
 * Wave 1 (F210B) additions.
 */
import { describe, it, expect, expectTypeOf } from "vitest";
import {
  projectWindowedFeatures,
  toFeatureProjection,
  widenUncertainty,
  buildCounterfactualWithWidenedUncertainty,
  assertNoAuthoritativeWritePath,
  predictWithDegradation,
  referenceUncertainty,
  buildCounterfactual,
  buildObserved,
  isHypothetical,
  isObserved,
  isPredicted,
} from "../src/index.ts";
import type { PredictedValue, ObservedValue, AnyValue } from "../src/index.ts";

const tenant = { tenantId: "t1" };
const asset = { assetId: "a1" };

function makeObservations(): readonly { observationRef: string; observedAt: string; value: number; sensorKind: string }[] {
  return [
    { observationRef: "o1", observedAt: "2026-01-01T00:00:00.000Z", value: 10, sensorKind: "temp" },
    { observationRef: "o2", observedAt: "2026-01-02T00:00:00.000Z", value: 20, sensorKind: "temp" },
    { observationRef: "o3", observedAt: "2026-01-03T00:00:00.000Z", value: 30, sensorKind: "temp" },
    { observationRef: "o4", observedAt: "2026-01-04T00:00:00.000Z", value: 40, sensorKind: "temp" },
    { observationRef: "o5", observedAt: "2026-01-05T00:00:00.000Z", value: 50, sensorKind: "temp" },
  ];
}

// ---------- Feature windowing ----------

describe("projectWindowedFeatures", () => {
  it("computes features over a window of observations", () => {
    const wfs = projectWindowedFeatures(
      tenant, asset, makeObservations(),
      "2026-01-01T00:00:00.000Z",
      "2026-01-05T00:00:00.000Z",
      "2026-01-06T00:00:00.000Z",
    );
    expect(wfs.windowSize).toBe(5);
    expect(wfs.features.mean).toBe(30);
    expect(wfs.features.min).toBe(10);
    expect(wfs.features.max).toBe(50);
    expect(wfs.features.count).toBe(5);
    expect(wfs.features.range).toBe(40);
    expect(wfs.sourceObservationRefs).toHaveLength(5);
  });

  it("excludes observations outside the window", () => {
    const wfs = projectWindowedFeatures(
      tenant, asset, makeObservations(),
      "2026-01-02T00:00:00.000Z",
      "2026-01-04T00:00:00.000Z",
      "2026-01-06T00:00:00.000Z",
    );
    expect(wfs.windowSize).toBe(3);
    expect(wfs.sourceObservationRefs).toEqual(["o2", "o3", "o4"]);
  });

  it("returns empty features for a window with no observations", () => {
    const wfs = projectWindowedFeatures(
      tenant, asset, makeObservations(),
      "2027-01-01T00:00:00.000Z",
      "2027-01-05T00:00:00.000Z",
      "2026-01-06T00:00:00.000Z",
    );
    expect(wfs.windowSize).toBe(0);
    expect(wfs.features).toEqual({});
    expect(wfs.sourceObservationRefs).toEqual([]);
  });

  it("is deterministic — same inputs => same output", () => {
    const w1 = projectWindowedFeatures(tenant, asset, makeObservations(), "2026-01-01T00:00:00.000Z", "2026-01-05T00:00:00.000Z", "2026-01-06T00:00:00.000Z");
    const w2 = projectWindowedFeatures(tenant, asset, makeObservations(), "2026-01-01T00:00:00.000Z", "2026-01-05T00:00:00.000Z", "2026-01-06T00:00:00.000Z");
    expect(w1).toEqual(w2);
  });

  it("carries per-observation provenance refs (law A3)", () => {
    const wfs = projectWindowedFeatures(
      tenant, asset, makeObservations(),
      "2026-01-01T00:00:00.000Z", "2026-01-03T00:00:00.000Z",
      "2026-01-06T00:00:00.000Z",
    );
    expect(wfs.sourceObservationRefs).toEqual(["o1", "o2", "o3"]);
  });
});

describe("toFeatureProjection", () => {
  it("converts WindowedFeatureSet to FeatureProjection", () => {
    const wfs = projectWindowedFeatures(tenant, asset, makeObserv(), "2026-01-01T00:00:00.000Z", "2026-01-03T00:00:00.000Z", "2026-01-06T00:00:00.000Z");
    const fp = toFeatureProjection(wfs);
    expect(fp.tenant).toEqual(tenant);
    expect(fp.asset).toEqual(asset);
    expect(fp.sourceObservationRefs).toEqual(wfs.sourceObservationRefs);
    expect(fp.features.mean).toBe(20);
  });
});

function makeObserv() {
  return [
    { observationRef: "o1", observedAt: "2026-01-01T00:00:00.000Z", value: 10, sensorKind: "temp" },
    { observationRef: "o2", observedAt: "2026-01-02T00:00:00.000Z", value: 20, sensorKind: "temp" },
    { observationRef: "o3", observedAt: "2026-01-03T00:00:00.000Z", value: 30, sensorKind: "temp" },
  ];
}

// ---------- Uncertainty widening ----------

describe("widenUncertainty", () => {
  it("widens the interval by the given factor", () => {
    const baseline = { lower: -1, upper: 1, confidence: 0.8, method: "bootstrap" as const };
    const widened = widenUncertainty(baseline, 2);
    expect(widened.lower).toBe(-2);
    expect(widened.upper).toBe(2);
    expect(widened.confidence).toBe(0.4); // halved
  });

  it("widens by default factor of 2", () => {
    const baseline = { lower: 0, upper: 10, confidence: 0.6, method: "conformal" as const };
    const widened = widenUncertainty(baseline);
    expect(widened.lower).toBe(-5);
    expect(widened.upper).toBe(15);
    expect(widened.confidence).toBe(0.3);
  });

  it("is deterministic", () => {
    const baseline = { lower: -1, upper: 1, confidence: 0.8, method: "bootstrap" as const };
    expect(widenUncertainty(baseline, 3)).toEqual(widenUncertainty(baseline, 3));
  });
});

describe("buildCounterfactualWithWidenedUncertainty", () => {
  it("produces a HYPOTHETICAL with wider uncertainty than the baseline", () => {
    const baseline: PredictedValue = {
      kind: "PREDICTED",
      value: 100,
      uncertainty: { lower: 90, upper: 110, confidence: 0.8, method: "bootstrap" },
      predictedAt: "2026-01-01T00:00:00.000Z",
      validUntil: "2026-12-31T00:00:00.000Z",
      provenance: { modelVersion: "1.0", capabilityVersion: "1.0", featureDigest: "fd", inputsDigest: "id" },
      tenant,
      asset,
    };
    const cf = buildCounterfactualWithWidenedUncertainty(baseline, "what if +10%", 110, 2);
    expect(cf.kind).toBe("HYPOTHETICAL");
    expect(cf.hypothetical).toBe(true);
    expect(cf.uncertainty.lower).toBeLessThan(baseline.uncertainty.lower);
    expect(cf.uncertainty.upper).toBeGreaterThan(baseline.uncertainty.upper);
  });

  it("A11 type-distinctness: HYPOTHETICAL is not assignable to OBSERVED", () => {
    const baseline: PredictedValue = {
      kind: "PREDICTED",
      value: 100,
      uncertainty: { lower: 90, upper: 110, confidence: 0.8, method: "bootstrap" },
      predictedAt: "2026-01-01T00:00:00.000Z",
      validUntil: "2026-12-31T00:00:00.000Z",
      provenance: { modelVersion: "1.0", capabilityVersion: "1.0", featureDigest: "fd", inputsDigest: "id" },
      tenant,
      asset,
    };
    const cf = buildCounterfactualWithWidenedUncertainty(baseline, "test", 110, 2);
    // @ts-expect-error — HYPOTHETICAL is not assignable to OBSERVED (A11)
    const _observed: ObservedValue = cf;
    expect(cf.kind).toBe("HYPOTHETICAL");
    expectTypeOf(cf).not.toMatchTypeOf<ObservedValue>();
  });
});

// ---------- A2 no-authoritative-write ----------

describe("assertNoAuthoritativeWritePath (A2)", () => {
  it("returns ok=true for the predictive module surface", () => {
    const moduleExports = {
      referencePredict: () => {},
      buildCounterfactual: () => {},
      widenUncertainty: () => {},
      projectWindowedFeatures: () => {},
    };
    const probe = assertNoAuthoritativeWritePath(moduleExports);
    expect(probe.ok).toBe(true);
    expect(probe.forbidden).toEqual([]);
  });

  it("catches a forbidden writeDevice function", () => {
    const badExports = { writeDevice: () => {} };
    const probe = assertNoAuthoritativeWritePath(badExports);
    expect(probe.ok).toBe(false);
    expect(probe.forbidden).toContain("writeDevice");
  });

  it("catches setDeviceState, updateTwin, mutateAsset", () => {
    const badExports = {
      setDeviceState: () => {},
      updateTwin: () => {},
      mutateAsset: () => {},
    };
    const probe = assertNoAuthoritativeWritePath(badExports);
    expect(probe.ok).toBe(false);
    expect(probe.forbidden).toContain("setDeviceState");
    expect(probe.forbidden).toContain("updateTwin");
    expect(probe.forbidden).toContain("mutateAsset");
  });
});

// ---------- Honest degraded states ----------

describe("predictWithDegradation", () => {
  it("returns model_unavailable when model is not available", () => {
    const fp = toFeatureProjection(projectWindowedFeatures(tenant, asset, makeObserv(), "2026-01-01T00:00:00.000Z", "2026-01-03T00:00:00.000Z", "2026-01-06T00:00:00.000Z"));
    const result = predictWithDegradation(fp, {
      value: 42,
      uncertainty: referenceUncertainty(),
      modelVersion: "1.0",
      capabilityVersion: "1.0",
      validUntil: "2026-12-31T00:00:00.000Z",
      modelAvailable: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.degraded).toBe("model_unavailable");
    }
  });

  it("returns insufficient_history when features are empty", () => {
    const fp = toFeatureProjection(projectWindowedFeatures(tenant, asset, [], "2026-01-01T00:00:00.000Z", "2026-01-03T00:00:00.000Z", "2026-01-06T00:00:00.000Z"));
    const result = predictWithDegradation(fp, {
      value: 42,
      uncertainty: referenceUncertainty(),
      modelVersion: "1.0",
      capabilityVersion: "1.0",
      validUntil: "2026-12-31T00:00:00.000Z",
      modelAvailable: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.degraded).toBe("insufficient_history");
    }
  });

  it("returns tenant_isolated when tenantId is empty", () => {
    const fp = toFeatureProjection(projectWindowedFeatures({ tenantId: "" }, asset, makeObserv(), "2026-01-01T00:00:00.000Z", "2026-01-03T00:00:00.000Z", "2026-01-06T00:00:00.000Z"));
    const result = predictWithDegradation(fp, {
      value: 42,
      uncertainty: referenceUncertainty(),
      modelVersion: "1.0",
      capabilityVersion: "1.0",
      validUntil: "2026-12-31T00:00:00.000Z",
      modelAvailable: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.degraded).toBe("tenant_isolated");
    }
  });

  it("returns a value when everything is OK", () => {
    const fp = toFeatureProjection(projectWindowedFeatures(tenant, asset, makeObserv(), "2026-01-01T00:00:00.000Z", "2026-01-03T00:00:00.000Z", "2026-01-06T00:00:00.000Z"));
    const result = predictWithDegradation(fp, {
      value: 42,
      uncertainty: referenceUncertainty(),
      modelVersion: "1.0",
      capabilityVersion: "1.0",
      validUntil: "2026-12-31T00:00:00.000Z",
      modelAvailable: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe("PREDICTED");
      expect(result.value.value).toBe(42);
    }
  });
});

// ---------- A11 type distinctness (compile-time) ----------

describe("A11 type distinctness", () => {
  it("OBSERVED, PREDICTED, HYPOTHETICAL are distinct kinds", () => {
    const obs = buildObserved(1, "2026-01-01T00:00:00.000Z", "o1", tenant, asset);
    const pred: PredictedValue = {
      kind: "PREDICTED",
      value: 2,
      uncertainty: referenceUncertainty(),
      predictedAt: "2026-01-01T00:00:00.000Z",
      validUntil: "2026-12-31T00:00:00.000Z",
      provenance: { modelVersion: "1.0", capabilityVersion: "1.0", featureDigest: "fd", inputsDigest: "id" },
      tenant,
      asset,
    };
    const hyp = buildCounterfactual(pred, "test", 3, referenceUncertainty());

    expect(isObserved(obs)).toBe(true);
    expect(isPredicted(pred)).toBe(true);
    expect(isHypothetical(hyp)).toBe(true);

    // Cross-checks: they are NOT each other
    expect(isPredicted(obs as AnyValue)).toBe(false);
    expect(isHypothetical(pred as AnyValue)).toBe(false);
    expect(isObserved(hyp as AnyValue)).toBe(false);
  });

  it("HYPOTHETICAL carries the machine-carried hypothetical=true marker", () => {
    const pred: PredictedValue = {
      kind: "PREDICTED",
      value: 2,
      uncertainty: referenceUncertainty(),
      predictedAt: "2026-01-01T00:00:00.000Z",
      validUntil: "2026-12-31T00:00:00.000Z",
      provenance: { modelVersion: "1.0", capabilityVersion: "1.0", featureDigest: "fd", inputsDigest: "id" },
      tenant,
      asset,
    };
    const hyp = buildCounterfactual(pred, "test", 3, referenceUncertainty());
    expect(hyp.hypothetical).toBe(true);
  });
});
