import { describe, it, expect } from "vitest";
import { projectWindowedWorkload, verifyWindowIntegrity } from "@fleetos/world-context/windowing";
import { rollLatentWindow, type LatentWindowFrame } from "../../src/jepa/rollout.ts";
import { latentL2, latentNorm, makeJepaSpace } from "../../src/jepa/embedding.ts";
import { jepaHalfWidthAt, subtractLatents } from "../../src/jepa/predictor.ts";

const space = makeJepaSpace();
const tenant = { tenantId: "t1" };
const asset = { assetId: "a-1" };
const NOW = "1970-01-01T00:00:00.000Z";
const FRAMES: readonly LatentWindowFrame[] = [
  { step: 0, features: { temperature: 40, pressure: 3.1 } },
  { step: 1, features: { temperature: 42, pressure: 3.5 } },
];
const TRUTH: readonly LatentWindowFrame[] = [
  { step: 1, features: { temperature: 43, pressure: 3.6 } },
  { step: 2, features: { temperature: 44, pressure: 3.7 } },
];

const run = () =>
  rollLatentWindow(space, { tenant, asset, frames: FRAMES, horizon: 2, truth: TRUTH, computedAt: NOW });

describe("jepa rollout (V-JEPA analogue): module surface rejections", () => {
  it("rejects an empty window", () => {
    const r = rollLatentWindow(space, { tenant, asset, frames: [], horizon: 1, computedAt: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejected).toBe("empty-window");
  });

  it("rejects non-monotonic frame steps (equal and decreasing)", () => {
    const equal = rollLatentWindow(space, {
      tenant, asset,
      frames: [
        { step: 0, features: { a: 1 } },
        { step: 0, features: { a: 2 } },
      ],
      horizon: 1, computedAt: NOW,
    });
    expect(equal.ok).toBe(false);
    if (!equal.ok) expect(equal.rejected).toBe("non-monotonic-steps");
    const decreasing = rollLatentWindow(space, {
      tenant, asset,
      frames: [
        { step: 5, features: { a: 1 } },
        { step: 2, features: { a: 2 } },
      ],
      horizon: 1, computedAt: NOW,
    });
    expect(decreasing.ok).toBe(false);
    if (!decreasing.ok) expect(decreasing.rejected).toBe("non-monotonic-steps");
  });

  it("rejects invalid horizons", () => {
    for (const h of [0, -1, 1.5, Number.NaN]) {
      const r = rollLatentWindow(space, { tenant, asset, frames: FRAMES, horizon: h, computedAt: NOW });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.rejected).toBe("invalid-horizon");
    }
  });

  it("rejects truth with the wrong frame count or wrong step numbering", () => {
    const wrongCount = rollLatentWindow(space, {
      tenant, asset, frames: FRAMES, horizon: 2,
      truth: [TRUTH[0] as LatentWindowFrame], computedAt: NOW,
    });
    expect(wrongCount.ok).toBe(false);
    if (!wrongCount.ok) expect(wrongCount.rejected).toBe("invalid-truth-steps");
    const wrongSteps = rollLatentWindow(space, {
      tenant, asset, frames: FRAMES, horizon: 2,
      truth: [
        { step: 1, features: { a: 1 } },
        { step: 3, features: { a: 2 } },
      ],
      computedAt: NOW,
    });
    expect(wrongSteps.ok).toBe(false);
    if (!wrongSteps.ok) expect(wrongSteps.rejected).toBe("invalid-truth-steps");
  });
});

describe("jepa rollout: seeding + the bounded-radius law", () => {
  it("seeds from the LAST frame; velocity is the finite difference of the last two", () => {
    const r = run();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const seed = space.embedFeatures({ temperature: 42, pressure: 3.5 });
    const prev = space.embedFeatures({ temperature: 40, pressure: 3.1 });
    expect(r.rollout.seedLatent).toEqual(seed);
    expect(r.rollout.velocity).toEqual(subtractLatents(seed, prev));
    expect(r.rollout.windowFrameCount).toBe(2);
    expect(r.rollout.velocityNorm).toBeCloseTo(latentNorm(subtractLatents(seed, prev)), 6);
  });

  it("single-frame window: honest zero velocity, radius NON-INCREASING (v=0 law)", () => {
    const r = rollLatentWindow(space, {
      tenant, asset, frames: [{ step: 0, features: { temperature: 42 } }],
      horizon: 6, computedAt: NOW,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rollout.velocity).toEqual(Array.from({ length: space.dim }, () => 0));
    expect(r.rollout.velocityNorm).toBe(0);
    for (let k = 1; k < r.rollout.steps.length; k += 1) {
      const prev = r.rollout.steps[k - 1] as { radius: number };
      const cur = r.rollout.steps[k] as { radius: number };
      expect(cur.radius).toBeLessThanOrEqual(prev.radius + 1e-6);
    }
  });

  it("radius bound law: ||z_k|| <= ||z_0|| + k*||v|| at EVERY step (machine-proved bound)", () => {
    const r = run();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const seedNorm = latentNorm(r.rollout.seedLatent);
    for (const s of r.rollout.steps) {
      const bound = seedNorm + s.step * r.rollout.velocityNorm;
      expect(s.radius).toBeLessThanOrEqual(bound + 1e-6);
    }
    expect(r.rollout.radiusBoundAtFinal).toBeCloseTo(
      seedNorm + r.rollout.horizon * r.rollout.velocityNorm,
      6,
    );
  });

  it("steps are 1..H in order and the final latent is the last step's latent", () => {
    const r = run();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rollout.steps.map((s) => s.step)).toEqual([1, 2]);
    expect(r.rollout.finalLatent).toEqual(r.rollout.steps[r.rollout.steps.length - 1]?.latent);
  });
});

describe("jepa rollout: divergence accounting (the stated + proved laws)", () => {
  it("cumulative truth divergence is MONOTONE non-decreasing in k (law 1)", () => {
    const r = run();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const cums = r.rollout.steps.map((s) => s.cumulativeTruthDivergence ?? 0);
    for (let k = 1; k < cums.length; k += 1) {
      expect(cums[k] as number).toBeGreaterThanOrEqual(cums[k - 1] as number);
    }
    expect(cums.every((c) => c >= 0)).toBe(true);
  });

  it("per-step truth divergence = ||embed(truth_k) - z_k|| (nothing hidden)", () => {
    const r = run();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const s of r.rollout.steps) {
      const truthLatent = space.embedFeatures((TRUTH[s.step - 1] as LatentWindowFrame).features);
      expect(s.truthLatent).toEqual(truthLatent);
      expect(s.truthDivergence).toBeCloseTo(latentL2(truthLatent, s.latent), 6);
    }
  });

  it("without truth, steps carry the self-divergence view (radius + stepDelta)", () => {
    const r = rollLatentWindow(space, { tenant, asset, frames: FRAMES, horizon: 3, computedAt: NOW });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const s of r.rollout.steps) {
      expect(s.truthLatent).toBeUndefined();
      expect(s.truthDivergence).toBeUndefined();
      expect(s.cumulativeTruthDivergence).toBeUndefined();
      expect(s.radius).toBeGreaterThanOrEqual(0);
      expect(s.stepDelta).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("jepa rollout: seam-shaped decode + determinism", () => {
  it("predicted is a PREDICTED value with the widening law at the horizon", () => {
    const r = run();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p = r.rollout.predicted;
    expect(p.kind).toBe("PREDICTED");
    expect(p.uncertainty.method).toBe("jepa.latent-sqrt");
    expect(p.uncertainty.upper - p.uncertainty.lower).toBeCloseTo(2 * jepaHalfWidthAt(2), 6);
    expect(p.predictedAt).toBe(NOW);
    expect(p.tenant).toEqual(tenant);
    expect(p.provenance.modelVersion).toBe("jepa-1.0.0");
  });

  it("predicted value is the final latent decoded at the last frame's primary feature", () => {
    const r = run();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const primary = "pressure"; // smallest key of the last frame's payload
    expect(r.rollout.predicted.value).toBeCloseTo(
      Math.round(space.decode(r.rollout.finalLatent, primary) * 1e6) / 1e6,
      6,
    );
  });

  it("deterministic: same window => byte-identical rollout (deep equality)", () => {
    expect(run()).toEqual(run());
    const fresh = rollLatentWindow(makeJepaSpace(), {
      tenant, asset, frames: FRAMES, horizon: 2, truth: TRUTH, computedAt: NOW,
    });
    expect(run()).toEqual(fresh);
  });
});

describe("jepa rollout: REAL world-context window seeding (composition binding)", () => {
  it("seeds the rollout from REAL windowed workload projections (public windowing surface)", () => {
    const observations = [
      { observationRef: "obs-1", observedAt: "2026-10-01T00:30:00.000Z", observer: "sensor-1", sensorKind: "telemetry" },
      { observationRef: "obs-2", observedAt: "2026-10-01T12:30:00.000Z", observer: "sensor-1", sensorKind: "telemetry" },
      { observationRef: "obs-3", observedAt: "2026-10-02T00:30:00.000Z", observer: "sensor-1", sensorKind: "telemetry" },
      { observationRef: "obs-4", observedAt: "2026-10-02T12:30:00.000Z", observer: "sensor-1", sensorKind: "telemetry" },
    ];
    const base = {
      tenant: { tenantId: "t1" },
      workloadId: "wl-1",
      assetIds: ["a-1"],
      workItemRefs: [],
      projectRefs: [],
      observations,
    };
    const w1 = projectWindowedWorkload({
      ...base, utilization: 0.6, computedAt: "2026-10-01T23:59:59.000Z",
      windowStart: "2026-10-01T00:00:00.000Z", windowEnd: "2026-10-01T23:59:59.000Z",
    });
    const w2 = projectWindowedWorkload({
      ...base, utilization: 0.8, computedAt: "2026-10-02T23:59:59.000Z",
      windowStart: "2026-10-02T00:00:00.000Z", windowEnd: "2026-10-02T23:59:59.000Z",
    });
    // REAL windowing outputs: integrity verified, per-window provenance counts.
    expect(verifyWindowIntegrity(w1)).toEqual({ ok: true, outOfWindow: 0 });
    expect(verifyWindowIntegrity(w2)).toEqual({ ok: true, outOfWindow: 0 });
    expect(w1.provenance).toHaveLength(2);
    expect(w2.provenance).toHaveLength(2);
    expect(w1.utilization).not.toBe(w2.utilization);

    // Frames derived from the REAL projection outputs (utilization, obs count).
    const frameOf = (w: typeof w1, step: number): LatentWindowFrame => ({
      step,
      features: {
        observationCount: w.provenance.length,
        utilizationBps: Math.round(w.utilization * 10000),
      },
    });
    const r = rollLatentWindow(space, {
      tenant, asset,
      frames: [frameOf(w1, 0), frameOf(w2, 1)],
      horizon: 2, computedAt: NOW,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rollout.windowFrameCount).toBe(2);
    expect(r.rollout.velocityNorm).toBeGreaterThan(0); // windows differ => real velocity
    expect(Number.isFinite(r.rollout.predicted.value)).toBe(true);
    expect(r.rollout.steps).toHaveLength(2);
  });
});
