import { describe, it, expect } from "vitest";
import {
  assertHypotheticalMarker,
  makeReferenceWorldModelAdapter,
  type CounterfactualScenario,
  type HypotheticalValue,
  type PredictedValue,
  type WorldModelAdapter,
} from "../src/index.ts";

const tenant = { tenantId: "t1" };
const asset = { assetId: "a-1" };
const features = { temperature: 42 };

describe("reference adapter: determinism", () => {
  it("produces identical representations for the same input", () => {
    const a = makeReferenceWorldModelAdapter();
    const r1 = a.represent({ tenant, asset, features });
    const r2 = a.represent({ tenant, asset, features });
    expect(r1).toEqual(r2);
  });

  it("produces identical predictions for the same representation", () => {
    const a = makeReferenceWorldModelAdapter();
    const rep = a.represent({ tenant, asset, features });
    const p1 = a.predict(rep);
    const p2 = a.predict(rep);
    expect(p1).toEqual(p2);
  });

  it("produces identical counterfactuals for the same inputs", () => {
    const a = makeReferenceWorldModelAdapter();
    const rep = a.represent({ tenant, asset, features });
    const c1 = a.counterfactual(rep, "what if hotter", 99, { lower: 0, upper: 1, confidence: 0.5, method: "reference.constant" });
    const c2 = a.counterfactual(rep, "what if hotter", 99, { lower: 0, upper: 1, confidence: 0.5, method: "reference.constant" });
    expect(c1).toEqual(c2);
  });
});

describe("A11 type-distinctness: counterfactual marker", () => {
  it("the counterfactual value is HYPOTHETICAL and carries hypothetical:true", () => {
    const a = makeReferenceWorldModelAdapter();
    const rep = a.represent({ tenant, asset, features });
    const cf = a.counterfactual(rep, "p", 1, { lower: 0, upper: 1, confidence: 0.5, method: "reference.constant" });
    expect(cf.value.kind).toBe("HYPOTHETICAL");
    expect(cf.value.hypothetical).toBe(true);
    expect(assertHypotheticalMarker(cf)).toBe(true);
  });

  it("a HYPOTHETICAL value is NOT assignable to a PredictedValue at the type level", () => {
    const a = makeReferenceWorldModelAdapter();
    const rep = a.represent({ tenant, asset, features });
    const cf = a.counterfactual(rep, "p", 1, { lower: 0, upper: 1, confidence: 0.5, method: "reference.constant" });
    // Compile-time: cf.value.kind is "HYPOTHETICAL", incompatible with PredictedValue.
    // @ts-expect-error — HYPOTHETICAL is not a PREDICTED
    const _bad: PredictedValue = cf.value;
    void _bad;
  });

  it("a tampered counterfactual (hypothetical:false) fails the runtime guard", () => {
    const a = makeReferenceWorldModelAdapter();
    const rep = a.represent({ tenant, asset, features });
    const cf = a.counterfactual(rep, "p", 1, { lower: 0, upper: 1, confidence: 0.5, method: "reference.constant" });
    const tampered: CounterfactualScenario<number> = {
      ...cf,
      value: { ...cf.value, hypothetical: false } as unknown as HypotheticalValue<number>,
    };
    expect(assertHypotheticalMarker(tampered)).toBe(false);
  });
});

describe("WorldModelAdapter: cannot authorize or execute", () => {
  it("the adapter interface has no authorize/execute methods", () => {
    const adapter: WorldModelAdapter = makeReferenceWorldModelAdapter();
    // Compile-time: there is no `authorize` or `execute` field.
    expect((adapter as unknown as Record<string, unknown>).authorize).toBeUndefined();
    expect((adapter as unknown as Record<string, unknown>).execute).toBeUndefined();
    expect(typeof adapter.represent).toBe("function");
    expect(typeof adapter.predict).toBe("function");
    expect(typeof adapter.counterfactual).toBe("function");
  });
});

describe("reference adapter: provenance", () => {
  it("representations carry stable feature digests", () => {
    const a = makeReferenceWorldModelAdapter();
    const r1 = a.represent({ tenant, asset, features });
    const r2 = a.represent({ tenant, asset, features: { ...features, extra: 1 } });
    expect(r1.features).not.toEqual(r2.features);
  });

  it("predictions reference their representation's tenant and asset", () => {
    const a = makeReferenceWorldModelAdapter();
    const rep = a.represent({ tenant, asset, features });
    const pred = a.predict(rep);
    expect(pred.tenant.tenantId).toBe("t1");
    expect(pred.asset.assetId).toBe("a-1");
  });
});

describe("reference adapter: stable scenario IDs", () => {
  it("produces stable scenario IDs for the same premise", () => {
    const a = makeReferenceWorldModelAdapter();
    const rep = a.represent({ tenant, asset, features });
    const c1 = a.counterfactual(rep, "premise-A", 1, { lower: 0, upper: 1, confidence: 0.5, method: "reference.constant" });
    const c2 = a.counterfactual(rep, "premise-A", 2, { lower: 0, upper: 1, confidence: 0.5, method: "reference.constant" });
    expect(c1.scenarioId).toBe(c2.scenarioId);
  });

  it("produces different scenario IDs for different premises", () => {
    const a = makeReferenceWorldModelAdapter();
    const rep = a.represent({ tenant, asset, features });
    const c1 = a.counterfactual(rep, "premise-A", 1, { lower: 0, upper: 1, confidence: 0.5, method: "reference.constant" });
    const c2 = a.counterfactual(rep, "premise-B", 1, { lower: 0, upper: 1, confidence: 0.5, method: "reference.constant" });
    expect(c1.scenarioId).not.toBe(c2.scenarioId);
  });
});
