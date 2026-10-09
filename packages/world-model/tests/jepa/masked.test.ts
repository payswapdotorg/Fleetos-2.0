import { describe, it, expect } from "vitest";
import {
  maskedLatentPrediction,
  decodeMaskedPrimary,
} from "../../src/jepa/masked.ts";
import { makeJepaSpace, latentL2 } from "../../src/jepa/embedding.ts";
import { JEPA_VALID_UNTIL, jepaHalfWidthAt } from "../../src/jepa/predictor.ts";

const space = makeJepaSpace();
const tenant = { tenantId: "t1" };
const asset = { assetId: "a-1" };
const NOW = "1970-01-01T00:00:00.000Z";
const FIXTURE = { humidity: 11, pressure: 3.5, temperature: 42 };

describe("jepa masked (I-JEPA analogue): module surface", () => {
  it("rejects unknown mask targets, naming the offender", () => {
    const r = maskedLatentPrediction(space, { features: FIXTURE, mask: ["nonexistent"] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.rejected).toBe("unknown-mask-target");
      expect(r.detail).toContain("nonexistent");
    }
  });

  it("reserved jepa.* keys cannot be masked", () => {
    const r = maskedLatentPrediction(space, {
      features: { temperature: 42, "jepa.horizon": 4 },
      mask: ["jepa.horizon"],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejected).toBe("unknown-mask-target");
  });

  it("empty mask: the honest zero-divergence result (masked === full)", () => {
    const r = maskedLatentPrediction(space, { features: FIXTURE, mask: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.masked.maskedFeatures).toEqual([]);
    expect(r.masked.maskedDivergenceTotal).toBe(0);
    expect(r.masked.predictedLatent).toEqual(r.masked.fullLatent);
    expect(r.masked.contextLatent).not.toEqual(r.masked.fullLatent); // context != full payload
  });

  it("known answer: masking 'temperature' records the honest divergence", () => {
    const r = maskedLatentPrediction(space, { features: FIXTURE, mask: ["temperature"] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const m = r.masked;
    expect(m.maskedFeatures).toEqual(["temperature"]);
    expect(m.contextFeatures).toEqual(["humidity", "pressure"]);
    expect(m.perTarget).toHaveLength(1);
    const t = m.perTarget[0] as { feature: string; maskedValue: number; fullValue: number; delta: number; divergence: number; deltaBpsOfFull: number | null };
    expect(t.feature).toBe("temperature");
    expect(t.maskedValue).toBe(-0.018891);
    expect(t.fullValue).toBe(-0.193655);
    expect(t.delta).toBe(0.174764);
    expect(t.divergence).toBe(Math.abs(t.delta));
    expect(t.deltaBpsOfFull).toBe(-9025);
    expect(m.maskedDivergenceTotal).toBe(0.174764);
  });

  it("accounting law: divergence = |delta| and total = sum of divergences", () => {
    const r = maskedLatentPrediction(space, {
      features: FIXTURE,
      mask: ["pressure", "temperature"],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    let sum = 0;
    for (const t of r.masked.perTarget) {
      expect(t.divergence).toBe(Math.abs(t.delta));
      sum += t.divergence;
    }
    expect(r.masked.maskedDivergenceTotal).toBe(sum);
  });

  it("masked features are excluded from the context embedding", () => {
    const r = maskedLatentPrediction(space, { features: FIXTURE, mask: ["temperature", "pressure"] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.masked.contextFeatures).toEqual(["humidity"]);
    // Context latent == the embedding of the context-only feature map.
    expect(r.masked.contextLatent).toEqual(space.embedFeatures({ humidity: 11 }));
  });

  it("prediction in latent space: the context-only latent is advanced ONE step", () => {
    const r = maskedLatentPrediction(space, { features: FIXTURE, mask: ["temperature"] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.masked.predictedLatent).toEqual(
      space.applyDynamics(space.embedFeatures({ humidity: 11, pressure: 3.5 }), 1),
    );
    expect(r.masked.fullLatent).toEqual(space.applyDynamics(space.embedFeatures(FIXTURE), 1));
  });

  it("masked-vs-full latents diverge when the masked signal carries mass", () => {
    const r = maskedLatentPrediction(space, { features: FIXTURE, mask: ["temperature"] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(latentL2(r.masked.predictedLatent, r.masked.fullLatent)).toBeGreaterThan(0);
    expect(r.masked.maskedDivergenceTotal).toBeGreaterThan(0);
  });

  it("deterministic: same inputs => identical accounting (deep equality)", () => {
    const a = maskedLatentPrediction(space, { features: FIXTURE, mask: ["temperature"] });
    const b = maskedLatentPrediction(makeJepaSpace(), { features: FIXTURE, mask: ["temperature"] });
    expect(a).toEqual(b);
  });
});

describe("jepa masked: seam-shaped decode with A11-widened uncertainty", () => {
  it("decodeMaskedPrimary returns null for an empty mask", () => {
    const r = maskedLatentPrediction(space, { features: FIXTURE, mask: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(decodeMaskedPrimary(space, r.masked, { tenant, asset, computedAt: NOW })).toBeNull();
  });

  it("widens the composed law by the EXISTING A11 factor 2 (less evidence, wider interval)", () => {
    const r = maskedLatentPrediction(space, { features: FIXTURE, mask: ["temperature"] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p = decodeMaskedPrimary(space, r.masked, { tenant, asset, computedAt: NOW });
    expect(p).not.toBeNull();
    if (p === null) return;
    expect(p.kind).toBe("PREDICTED");
    expect(p.predictedAt).toBe(NOW);
    expect(p.validUntil).toBe(JEPA_VALID_UNTIL);
    expect(p.uncertainty.method).toBe("jepa.latent-sqrt");
    const half = jepaHalfWidthAt(1);
    expect(p.uncertainty.upper - p.uncertainty.lower).toBeCloseTo(4 * half, 9); // 2x the h=1 law
    expect(p.uncertainty.confidence).toBeCloseTo(0.25, 12); // halved by the A11 law
    expect(p.value).toBe(-0.018891);
  });
});
