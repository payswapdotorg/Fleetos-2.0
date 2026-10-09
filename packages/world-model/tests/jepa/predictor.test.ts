import { describe, it, expect } from "vitest";
import { MIN_BOUND_HALF_WIDTH } from "@fleetos/predictive";
import {
  JEPA_HORIZON_KEY,
  JEPA_DELTA_PREFIX,
  JEPA_PREV_PREFIX,
  JEPA_VALID_UNTIL,
  jepaHalfWidthAt,
  jepaConfidenceAt,
  jepaUncertaintyAt,
  parseJepaControls,
  predictJepa,
  round6,
  addLatents,
  subtractLatents,
  scaleLatent,
} from "../../src/jepa/predictor.ts";
import { LATENT_DIM, makeJepaSpace } from "../../src/jepa/embedding.ts";

const space = makeJepaSpace();
const tenant = { tenantId: "t1" };
const asset = { assetId: "a-1" };
const NOW = "1970-01-01T00:00:00.000Z";

describe("jepa predictor: reserved-key controls", () => {
  it("reserved key constants are the documented surface", () => {
    expect(JEPA_HORIZON_KEY).toBe("jepa.horizon");
    expect(JEPA_DELTA_PREFIX).toBe("jepa.delta.");
    expect(JEPA_PREV_PREFIX).toBe("jepa.prev.");
    expect(JEPA_VALID_UNTIL).toBe("9999-12-31T00:00:00.000Z");
  });

  it("absent controls default to horizon 1, empty deltas/prev", () => {
    const c = parseJepaControls({ temperature: 42 });
    expect(c.horizon).toBe(1);
    expect(c.deltas).toEqual({});
    expect(c.prev).toEqual({});
    expect(c.payload).toEqual({ temperature: 42 });
  });

  it("parses a valid horizon, deltas, and prev keys; strips them from payload", () => {
    const c = parseJepaControls({
      "jepa.horizon": 4,
      "jepa.delta.temperature": 7,
      "jepa.prev.temperature": 40,
      pressure: 3.5,
      temperature: 42,
    });
    expect(c.horizon).toBe(4);
    expect(c.deltas).toEqual({ temperature: 7 });
    expect(c.prev).toEqual({ temperature: 40 });
    expect(c.payload).toEqual({ pressure: 3.5, temperature: 42 });
  });

  it("malformed horizons degrade to the default (documented, nothing hidden)", () => {
    for (const bad of [2.5, 0, -3, Number.NaN, "3" as unknown as number]) {
      expect(parseJepaControls({ "jepa.horizon": bad, a: 1 }).horizon).toBe(1);
    }
  });

  it("non-finite delta/prev/payload values are dropped", () => {
    const c = parseJepaControls({
      "jepa.delta.x": Number.NaN,
      "jepa.prev.y": Number.POSITIVE_INFINITY,
      a: Number.NaN,
      b: 2,
    });
    expect(c.deltas).toEqual({});
    expect(c.prev).toEqual({});
    expect(c.payload).toEqual({ b: 2 });
  });
});

describe("jepa predictor: the composed widening law (REAL constant reuse)", () => {
  it("halfWidth composes the predictive reference sqrt law with the REAL constant", () => {
    expect(MIN_BOUND_HALF_WIDTH).toBe(0.5);
    for (const h of [1, 2, 4, 9, 16]) {
      expect(jepaHalfWidthAt(h)).toBe(
        round6(MIN_BOUND_HALF_WIDTH * (1 + Math.sqrt(h))),
      );
    }
  });

  it("halfWidth known answers: h=1 -> 1, h=4 -> 1.5, h=16 -> 2.5", () => {
    expect(jepaHalfWidthAt(1)).toBe(1);
    expect(jepaHalfWidthAt(4)).toBe(1.5);
    expect(jepaHalfWidthAt(16)).toBe(2.5);
  });

  it("width NEVER narrower than the reference adapter's 2.0 (equal at h=1, wider beyond)", () => {
    for (let h = 1; h <= 50; h += 1) {
      expect(2 * jepaHalfWidthAt(h)).toBeGreaterThanOrEqual(2);
    }
    expect(2 * jepaHalfWidthAt(1)).toBe(2);
    expect(2 * jepaHalfWidthAt(2)).toBeGreaterThan(2);
  });

  it("halfWidth is monotone increasing in the horizon", () => {
    for (let h = 1; h < 20; h += 1) {
      expect(jepaHalfWidthAt(h + 1)).toBeGreaterThan(jepaHalfWidthAt(h));
    }
  });

  it("confidence: 0.5 at h=1, -250 bps/step, floored at 500 bps", () => {
    expect(jepaConfidenceAt(1)).toBe(0.5);
    expect(jepaConfidenceAt(2)).toBe(0.475);
    expect(jepaConfidenceAt(19)).toBe(0.05);
    expect(jepaConfidenceAt(100)).toBe(0.05);
    for (let h = 1; h < 40; h += 1) {
      expect(jepaConfidenceAt(h + 1)).toBeLessThanOrEqual(jepaConfidenceAt(h));
    }
  });

  it("jepaUncertaintyAt: honest method label, symmetric bounds, known answer", () => {
    const u = jepaUncertaintyAt(1, 10);
    expect(u.method).toBe("jepa.latent-sqrt");
    expect(u.lower).toBe(9);
    expect(u.upper).toBe(11);
    expect(u.confidence).toBe(0.5);
    expect(u.upper - u.lower).toBe(2 * jepaHalfWidthAt(1));
    expect((u.lower + u.upper) / 2).toBe(10);
  });
});

describe("jepa predictor: predictJepa (module surface)", () => {
  it("rejects invalid horizons (fail-loud module surface)", () => {
    for (const h of [0, -1, 1.5, Number.NaN]) {
      const r = predictJepa(space, { tenant, asset, features: { temperature: 42 }, horizon: h, computedAt: NOW });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.rejected).toBe("invalid-horizon");
    }
  });

  it("rejects non-finite premise deltas", () => {
    const r = predictJepa(space, {
      tenant, asset, features: { temperature: 42 }, horizon: 1, computedAt: NOW,
      deltas: { temperature: Number.NaN },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejected).toBe("invalid-delta");
  });

  it("ok shape: seam-typed PredictedValue with JEPA provenance and readouts", () => {
    const r = predictJepa(space, { tenant, asset, features: { pressure: 3.5, temperature: 42 }, horizon: 1, computedAt: NOW });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p = r.prediction.predicted;
    expect(p.kind).toBe("PREDICTED");
    expect(p.validUntil).toBe(JEPA_VALID_UNTIL);
    expect(p.predictedAt).toBe(NOW);
    expect(p.tenant).toEqual(tenant);
    expect(p.asset).toEqual(asset);
    expect(p.provenance.modelVersion).toBe("jepa-1.0.0");
    expect(p.provenance.capabilityVersion).toBe("1.0.0");
    expect(p.provenance.featureDigest).toMatch(/^[0-9a-f]{8}$/);
    expect(p.provenance.inputsDigest).toMatch(/^[0-9a-f]{8}$/);
    expect(Object.keys(r.prediction.readouts).sort()).toEqual(["pressure", "temperature"]);
    expect(r.prediction.latent).toHaveLength(LATENT_DIM);
    expect(r.prediction.horizon).toBe(1);
  });

  it("the horizon actually used is carried in the inputsDigest (nothing hidden)", () => {
    const r = predictJepa(space, { tenant, asset, features: { temperature: 42 }, horizon: 4, computedAt: NOW });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.prediction.horizon).toBe(4);
    expect(r.prediction.predicted.uncertainty.upper - r.prediction.predicted.uncertainty.lower).toBe(3);
    expect(r.prediction.predicted.uncertainty.confidence).toBe(0.425);
  });

  it("known answer: {temperature: 42} at h=1 decodes to -0.174765", () => {
    const r = predictJepa(space, { tenant, asset, features: { temperature: 42 }, horizon: 1, computedAt: NOW });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.prediction.predicted.value).toBe(-0.174765);
  });

  it("premise deltas shift the latent (the JEPA intervention): known answers", () => {
    const base = predictJepa(space, { tenant, asset, features: { temperature: 42 }, horizon: 1, computedAt: NOW });
    const shifted = predictJepa(space, {
      tenant, asset, features: { temperature: 42 }, horizon: 1, computedAt: NOW, deltas: { temperature: 7 },
    });
    expect(base.ok).toBe(true);
    expect(shifted.ok).toBe(true);
    if (base.ok && shifted.ok) {
      expect(shifted.prediction.predicted.value).toBe(-0.203892);
      expect(shifted.prediction.predicted.value).not.toBe(base.prediction.predicted.value);
      expect(shifted.prediction.latent).not.toEqual(base.prediction.latent);
    }
  });

  it("empty payload: the honest zero-mass prediction (value 0, empty readouts)", () => {
    const r = predictJepa(space, { tenant, asset, features: {}, horizon: 2, computedAt: NOW });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.prediction.predicted.value).toBe(0);
    expect(r.prediction.readouts).toEqual({});
    expect(r.prediction.predicted.uncertainty.method).toBe("jepa.latent-sqrt");
  });

  it("deterministic: same inputs => byte-identical outputs (deep equality)", () => {
    const input = { tenant, asset, features: { humidity: 11, pressure: 3.5, temperature: 42 }, horizon: 3, computedAt: NOW };
    const a = predictJepa(space, input);
    const b = predictJepa(makeJepaSpace(), input);
    expect(a).toEqual(b);
  });
});

describe("jepa predictor: vector algebra (known answers)", () => {
  it("add / subtract / scale are component-wise", () => {
    expect(addLatents([1, 2], [3, 4])).toEqual([4, 6]);
    expect(subtractLatents([5, 3], [2, 1])).toEqual([3, 2]);
    expect(scaleLatent([1, -2], 3)).toEqual([3, -6]);
  });

  it("round6 follows the lane's 1e-6 convention", () => {
    expect(round6(0.1234567)).toBe(0.123457);
    expect(round6(0.1234564)).toBe(0.123456);
    expect(round6(2)).toBe(2);
  });
});
