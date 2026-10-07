import { describe, it, expect } from "vitest";
import {
  buildCounterfactual,
  buildObserved,
  isHypothetical,
  isObserved,
  isPredicted,
  referencePredict,
  referenceUncertainty,
  type AnyValue,
  type FeatureProjection,
  type ObservedValue,
  type PredictedValue,
  type TenantScopeLike,
} from "../src/index.ts";

const tenant: TenantScopeLike = { tenantId: "t1" };
const asset = { assetId: "a-1" };

function features(): FeatureProjection {
  return {
    tenant,
    asset,
    features: { temperature: 42, humidity: 60 },
    computedAt: "1970-01-01T00:00:00.000Z",
    sourceObservationRefs: ["obs-1", "obs-2"],
  };
}

describe("A11 type-distinctness (compile-time)", () => {
  it("OBSERVED, PREDICTED, HYPOTHETICAL are mutually incompatible at the type level", () => {
    const obs = buildObserved(1, "0", "obs-1", tenant, asset);
    const pred = referencePredict(features(), {
      value: 2,
      uncertainty: referenceUncertainty(),
      modelVersion: "m-1",
      capabilityVersion: "c-1",
      validUntil: "later",
    });
    const cf = buildCounterfactual(
      pred.ok ? pred.value : ({} as PredictedValue),
      "what if hotter",
      3,
      referenceUncertainty(),
    );

    // Type-level: each carries a distinct `kind` literal.
    expect(obs.kind).toBe("OBSERVED");
    expect(cf.kind).toBe("HYPOTHETICAL");
    if (pred.ok) expect(pred.value.kind).toBe("PREDICTED");

    // Compile-time: a counterfactual is NOT assignable to ObservedValue.
    // @ts-expect-error — HypotheticalValue is not an ObservedValue
    const _badAssign: ObservedValue = cf;
    void _badAssign;

    // Compile-time: a counterfactual is NOT assignable to PredictedValue.
    // @ts-expect-error — HypotheticalValue is not a PredictedValue
    const _badAssign2: PredictedValue = cf;
    void _badAssign2;

    // Compile-time: an observation is NOT assignable to PredictedValue.
    // @ts-expect-error — ObservedValue is not a PredictedValue
    const _badAssign3: PredictedValue = obs;
    void _badAssign3;
  });
});

describe("A11 runtime guards", () => {
  it("isHypothetical returns true only for counterfactuals", () => {
    const pred = referencePredict(features(), {
      value: 2, uncertainty: referenceUncertainty(), modelVersion: "m", capabilityVersion: "c", validUntil: "later",
    });
    const cf = buildCounterfactual(pred.ok ? pred.value : ({} as PredictedValue), "premise", 3, referenceUncertainty());
    expect(isHypothetical(cf)).toBe(true);
    expect(isHypothetical(pred.ok ? pred.value : ({} as PredictedValue))).toBe(false);
  });

  it("isObserved returns true only for observations", () => {
    const obs = buildObserved(1, "0", "obs-1", tenant, asset);
    expect(isObserved(obs)).toBe(true);
  });

  it("isPredicted returns true only for predictions", () => {
    const pred = referencePredict(features(), {
      value: 2, uncertainty: referenceUncertainty(), modelVersion: "m", capabilityVersion: "c", validUntil: "later",
    });
    expect(isPredicted(pred.ok ? pred.value : ({} as PredictedValue))).toBe(true);
  });

  it("a HypotheticalValue always carries the hypothetical:true marker", () => {
    const pred = referencePredict(features(), {
      value: 2, uncertainty: referenceUncertainty(), modelVersion: "m", capabilityVersion: "c", validUntil: "later",
    });
    const cf = buildCounterfactual(pred.ok ? pred.value : ({} as PredictedValue), "premise", 3, referenceUncertainty());
    expect(cf.hypothetical).toBe(true);
    expect(cf.kind).toBe("HYPOTHETICAL");
  });
});

describe("referencePredict: determinism", () => {
  it("returns the same value for the same inputs", () => {
    const a = referencePredict(features(), {
      value: 42, uncertainty: referenceUncertainty(), modelVersion: "m", capabilityVersion: "c", validUntil: "later",
    });
    const b = referencePredict(features(), {
      value: 42, uncertainty: referenceUncertainty(), modelVersion: "m", capabilityVersion: "c", validUntil: "later",
    });
    expect(a).toEqual(b);
  });

  it("produces stable featureDigest and inputsDigest", () => {
    const a = referencePredict(features(), {
      value: 1, uncertainty: referenceUncertainty(), modelVersion: "m", capabilityVersion: "c", validUntil: "later",
    });
    const b = referencePredict(features(), {
      value: 99, uncertainty: referenceUncertainty(), modelVersion: "m", capabilityVersion: "c", validUntil: "later",
    });
    if (a.ok && b.ok) {
      expect(a.value.provenance.featureDigest).toBe(b.value.provenance.featureDigest);
      expect(a.value.provenance.inputsDigest).toBe(b.value.provenance.inputsDigest);
    }
  });
});

describe("referencePredict: honest degradation", () => {
  it("returns degraded=insufficient_history when features are empty", () => {
    const empty: FeatureProjection = { ...features(), features: {} };
    const r = referencePredict(empty, {
      value: 1, uncertainty: referenceUncertainty(), modelVersion: "m", capabilityVersion: "c", validUntil: "later",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.degraded).toBe("insufficient_history");
  });

  it("returns degraded=feature_missing when tenantId is empty", () => {
    const noTenant: FeatureProjection = { ...features(), tenant: { tenantId: "" } };
    const r = referencePredict(noTenant, {
      value: 1, uncertainty: referenceUncertainty(), modelVersion: "m", capabilityVersion: "c", validUntil: "later",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.degraded).toBe("feature_missing");
  });
});

describe("referencePredict: never writes device state", () => {
  it("returns a value with no setter / no write-effect field", () => {
    const r = referencePredict(features(), {
      value: 1, uncertainty: referenceUncertainty(), modelVersion: "m", capabilityVersion: "c", validUntil: "later",
    });
    if (r.ok) {
      // The PredictedValue type has no field that would mutate device state.
      // Sanity-check the keys are read-only semantic fields.
      const keys = Object.keys(r.value).sort();
      expect(keys).toEqual([
        "asset", "kind", "predictedAt", "provenance", "tenant", "uncertainty", "validUntil", "value",
      ]);
    }
  });
});

describe("AnyValue union exhaustiveness", () => {
  it("handles all three kinds", () => {
    const obs = buildObserved(1, "0", "obs-1", tenant, asset);
    const pred = referencePredict(features(), {
      value: 2, uncertainty: referenceUncertainty(), modelVersion: "m", capabilityVersion: "c", validUntil: "later",
    });
    const cf = buildCounterfactual(pred.ok ? pred.value : ({} as PredictedValue), "p", 3, referenceUncertainty());
    const all: AnyValue[] = [obs, pred.ok ? pred.value : ({} as PredictedValue), cf];
    expect(all.filter(isObserved)).toHaveLength(1);
    expect(all.filter(isPredicted)).toHaveLength(1);
    expect(all.filter(isHypothetical)).toHaveLength(1);
  });
});

describe("referenceUncertainty", () => {
  it("returns a deterministic constant interval", () => {
    expect(referenceUncertainty()).toEqual(referenceUncertainty());
    expect(referenceUncertainty().method).toBe("reference.constant");
  });
});
