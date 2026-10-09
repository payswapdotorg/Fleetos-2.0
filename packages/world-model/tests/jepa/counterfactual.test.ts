import { describe, it, expect } from "vitest";
import { isHypothetical, isPredicted, isObserved } from "@fleetos/predictive";
import {
  latentCounterfactual,
  type LatentCounterfactual,
} from "../../src/jepa/counterfactual.ts";
import { jepaDigest, makeJepaSpace } from "../../src/jepa/embedding.ts";
import {
  addLatents,
  jepaConfidenceAt,
  jepaHalfWidthAt,
  scaleLatent,
} from "../../src/jepa/predictor.ts";
import { assertHypotheticalMarker, makeReferenceWorldModelAdapter } from "../../src/index.ts";

const space = makeJepaSpace();
const reference = makeReferenceWorldModelAdapter();
const tenant = { tenantId: "t1" };
const asset = { assetId: "a-1" };
const FEATURES = { humidity: 11, temperature: 42 };
const rep = reference.represent({ tenant, asset, features: FEATURES });

const runCf = (over: Partial<Parameters<typeof latentCounterfactual>[1]> = {}) =>
  latentCounterfactual(space, {
    rep,
    premise: "what if hotter",
    intervention: { kind: "premise-direction", scale: 2 },
    horizon: 3,
    ...over,
  });

const ok = (r: ReturnType<typeof runCf>): LatentCounterfactual => {
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error("unexpected rejection");
  return r.counterfactual;
};

describe("jepa counterfactual: Law A11 (the machine-carried HYPOTHETICAL brand)", () => {
  it("the scenario value is a HYPOTHETICAL with hypothetical === true", () => {
    const cf = ok(runCf());
    expect(cf.scenario.value.kind).toBe("HYPOTHETICAL");
    expect(cf.scenario.value.hypothetical).toBe(true);
    expect(assertHypotheticalMarker(cf.scenario)).toBe(true);
  });

  it("the REAL type guards never confuse it with OBSERVED or PREDICTED", () => {
    const cf = ok(runCf());
    expect(isHypothetical(cf.scenario.value)).toBe(true);
    expect(isPredicted(cf.scenario.value)).toBe(false);
    expect(isObserved(cf.scenario.value)).toBe(false);
  });

  it("uncertainty: the composed sqrt law widened by the EXISTING A11 factor 2", () => {
    const cf = ok(runCf());
    const u = cf.scenario.value.uncertainty;
    expect(u.method).toBe("jepa.latent-sqrt");
    expect(u.upper - u.lower).toBeCloseTo(4 * jepaHalfWidthAt(3), 9); // 2x the sqrt law
    expect(u.upper - u.lower).toBe(5.4641); // known answer at h=3
    expect(u.confidence).toBeCloseTo(jepaConfidenceAt(3) / 2, 12); // halved confidence
    expect(u.confidence).toBe(0.225);
  });
});

describe("jepa counterfactual: scenario shape + provenance", () => {
  it("scenario id, premise, representation ref, logical time, space version", () => {
    const cf = ok(runCf());
    expect(cf.scenario.scenarioId).toBe(`jepa-cf-${rep.representationId}-${jepaDigest("what if hotter")}`);
    expect(cf.scenario.premise).toBe("what if hotter");
    expect(cf.scenario.representationRef).toBe(rep.representationId);
    expect(cf.scenario.value.computedAt).toBe(rep.computedAt);
    expect(cf.scenario.value.premise).toBe("what if hotter");
    expect(cf.scenario.value.provenance.modelVersion).toBe("jepa-1.0.0");
    expect(cf.scenario.value.tenant).toEqual(tenant);
    expect(cf.scenario.value.asset).toEqual(asset);
  });

  it("different premises deterministically select different latent directions", () => {
    const hot = ok(runCf({ premise: "what if hotter" }));
    const cool = ok(runCf({ premise: "what if cooler" }));
    expect(hot.scenario.scenarioId).not.toBe(cool.scenario.scenarioId);
    expect(hot.counterfactualLatent).not.toEqual(cool.counterfactualLatent);
  });
});

describe("jepa counterfactual: interventions", () => {
  it("feature-shift: the intervened latent is A^h(embed(payload) + embed(deltas))", () => {
    const cf = ok(runCf({ intervention: { kind: "feature-shift", deltas: { temperature: 7 } } }));
    const base = space.embedFeatures(FEATURES);
    const shift = space.embedFeatures({ temperature: 7 });
    expect(cf.counterfactualLatent).toEqual(space.applyDynamics(addLatents(base, shift), 3));
    expect(cf.baselineLatent).toEqual(space.applyDynamics(base, 3));
  });

  it("premise-direction: the shift is scale * row(premise#<premise>)", () => {
    const cf = ok(runCf());
    const expectedShift = scaleLatent(space.featureRow("premise#what if hotter"), 2);
    expect(cf.counterfactualLatent).toEqual(
      space.applyDynamics(addLatents(space.embedFeatures(FEATURES), expectedShift), 3),
    );
  });

  it("premise-direction scale 0: the counterfactual equals the baseline exactly", () => {
    const cf = ok(runCf({ intervention: { kind: "premise-direction", scale: 0 } }));
    expect(cf.counterfactualLatent).toEqual(cf.baselineLatent);
    for (const d of cf.divergence) expect(d.delta).toBe(0);
  });

  it("rejects invalid horizons and invalid interventions (fail-loud)", () => {
    expect(runCf({ horizon: 0 }).ok).toBe(false);
    expect(
      runCf({ intervention: { kind: "feature-shift", deltas: { x: Number.NaN } } }).ok,
    ).toBe(false);
    expect(
      runCf({ intervention: { kind: "premise-direction", scale: Number.NaN } }).ok,
    ).toBe(false);
    expect(
      runCf({ intervention: { kind: "unknown" as unknown as "feature-shift", deltas: {} } }).ok,
    ).toBe(false);
  });
});

describe("jepa counterfactual: divergence accounting (recorded, never hidden)", () => {
  it("every payload feature carries baseline vs counterfactual + delta + bps", () => {
    const cf = ok(runCf());
    expect(cf.divergence.map((d) => d.feature)).toEqual(["humidity", "temperature"]);
    for (const d of cf.divergence) {
      expect(d.delta).toBeCloseTo(d.counterfactualValue - d.baselineValue, 6);
      expect(d.deltaBpsOfBaseline).toBe(
        Math.round((10000 * (d.counterfactualValue - d.baselineValue)) / d.baselineValue),
      );
    }
  });

  it("known answer: premise-direction scale 2 at h=3 over the single-feature seam fixture", () => {
    const singleRep = reference.represent({ tenant, asset, features: { temperature: 42 } });
    const r = latentCounterfactual(space, {
      rep: singleRep,
      premise: "what if hotter",
      intervention: { kind: "premise-direction", scale: 2 },
      horizon: 3,
    });
    const cf = ok(r);
    const t = cf.divergence.find((d) => d.feature === "temperature");
    expect(t).toBeDefined();
    if (t) {
      expect(t.baselineValue).toBe(0.036398);
      expect(t.counterfactualValue).toBe(0.037016);
      expect(t.delta).toBe(0.000618);
      expect(t.deltaBpsOfBaseline).toBe(170);
    }
  });

  it("the primary hypothetical value is the smallest payload key's decode", () => {
    const cf = ok(runCf());
    expect(cf.scenario.value.value).toBe(
      Math.round(space.decode(cf.counterfactualLatent, "humidity") * 1e6) / 1e6,
    );
  });

  it("deterministic: same inputs => identical counterfactual (deep equality)", () => {
    expect(runCf()).toEqual(runCf());
    const fresh = latentCounterfactual(makeJepaSpace(), {
      rep,
      premise: "what if hotter",
      intervention: { kind: "premise-direction", scale: 2 },
      horizon: 3,
    });
    expect(runCf()).toEqual(fresh);
  });
});
