/**
 * Reference twin model tests (Wave 3, F230B) — deterministic projection,
 * provenance replay, integer-bps uncertainty, advisory envelope, counterfactual
 * divergence accounting, ModelPort seam, every rejection code.
 */
import { describe, it, expect } from "vitest";
import {
  REFERENCE_MODEL_VERSION,
  MAX_PROJECTION_STEPS,
  isAdvisoryPrediction,
  makeReferenceModelPort,
  projectReferenceTwin,
  runReferenceCounterfactual,
  type CounterfactualInput,
  type CounterfactualIntervention,
  type ModelPort,
  type TwinStateInput,
  type TwinObservation,
} from "../src/index.ts";
import type { ObservedValue } from "../src/index.ts";

const tenant = { tenantId: "t1" };
const asset = { assetId: "a-1" };

function linearHistory(): readonly TwinObservation[] {
  return [
    { observationRef: "o1", atMs: 0, value: 10 },
    { observationRef: "o2", atMs: 1000, value: 20 },
    { observationRef: "o3", atMs: 2000, value: 30 },
    { observationRef: "o4", atMs: 3000, value: 40 },
    { observationRef: "o5", atMs: 4000, value: 50 },
  ];
}

function twinInput(observations: readonly TwinObservation[] = linearHistory()): TwinStateInput {
  return { tenant, asset, metric: "temperature", observations, asOfMs: 4000 };
}

const horizon = { steps: 4, stepMs: 1000 };

// ---------- Deterministic projection ----------

describe("projectReferenceTwin: determinism + drift math", () => {
  it("is deterministic — same inputs produce byte-identical predictions", () => {
    const a = projectReferenceTwin(twinInput(), horizon);
    const b = projectReferenceTwin(twinInput(), horizon);
    expect(a).toEqual(b);
  });

  it("extrapolates the least-squares drift anchored at the last observation", () => {
    const r = projectReferenceTwin(twinInput(), horizon);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.prediction.points.map((p) => p.value)).toEqual([60, 70, 80, 90]);
      expect(r.prediction.points.map((p) => p.atMs)).toEqual([5000, 6000, 7000, 8000]);
      expect(r.prediction.points.map((p) => p.step)).toEqual([1, 2, 3, 4]);
      expect(r.prediction.originMs).toBe(4000);
    }
  });

  it("projects flat (zero drift) from a single observation", () => {
    const r = projectReferenceTwin(
      twinInput([{ observationRef: "o1", atMs: 0, value: 42 }]),
      horizon,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.prediction.points.every((p) => p.value === 42)).toBe(true);
    }
  });
});

describe("projectReferenceTwin: uncertainty", () => {
  it("bounds widen monotonically with the horizon", () => {
    const r = projectReferenceTwin(twinInput(), horizon);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const widths = r.prediction.points.map((p) => p.bounds.upper - p.bounds.lower);
      for (let i = 1; i < widths.length; i += 1) {
        expect(widths[i as number]).toBeGreaterThanOrEqual(widths[i - 1] as number);
      }
      // Perfectly linear history => residual spread 0 => floor half-width 0.5
      // => step-1 bounds exactly [value-1, value+1].
      const first = r.prediction.points[0];
      if (first) {
        expect(first.bounds.lower).toBe(59);
        expect(first.bounds.upper).toBe(61);
      }
    }
  });

  it("confidence is integer bps, decays monotonically, and stays within [0, 10000]", () => {
    const r = projectReferenceTwin(twinInput(), horizon);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const bps = r.prediction.points.map((p) => p.confidenceBps);
      for (const b of bps) {
        expect(Number.isInteger(b)).toBe(true);
        expect(b).toBeGreaterThanOrEqual(0);
        expect(b).toBeLessThanOrEqual(10000);
      }
      for (let i = 1; i < bps.length; i += 1) {
        expect(bps[i as number]).toBeLessThanOrEqual(bps[i - 1] as number);
      }
      // 5 observations => base 5000 bps at step 1.
      expect(bps[0]).toBe(5000);
    }
  });
});

describe("projectReferenceTwin: provenance (replayable + auditable)", () => {
  it("carries every input observation ref in order", () => {
    const r = projectReferenceTwin(twinInput(), horizon);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.prediction.provenance.observationRefs).toEqual(["o1", "o2", "o3", "o4", "o5"]);
    }
  });

  it("carries the reference model version and method", () => {
    const r = projectReferenceTwin(twinInput(), horizon);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.prediction.provenance.modelVersion).toBe(REFERENCE_MODEL_VERSION);
      expect(r.prediction.provenance.method).toBe("reference.linear-drift");
    }
  });

  it("inputDigest is replay-stable and horizon-sensitive", () => {
    const a = projectReferenceTwin(twinInput(), horizon);
    const b = projectReferenceTwin(twinInput(), horizon);
    const c = projectReferenceTwin(twinInput(), { steps: 5, stepMs: 1000 });
    expect(a.ok && b.ok && c.ok).toBe(true);
    if (a.ok && b.ok && c.ok) {
      expect(a.prediction.provenance.inputDigest).toBe(b.prediction.provenance.inputDigest);
      expect(a.prediction.provenance.inputDigest).not.toBe(c.prediction.provenance.inputDigest);
    }
  });
});

// ---------- Advisory envelope (A2: advisory, never authoritative) ----------

describe("advisory envelope", () => {
  it("carries the machine-carried advisory:true marker and PREDICTION kind", () => {
    const r = projectReferenceTwin(twinInput(), horizon);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.prediction.kind).toBe("PREDICTION");
      expect(r.prediction.advisory).toBe(true);
    }
  });

  it("isAdvisoryPrediction verifies the marker on untrusted input and rejects stripped copies", () => {
    const r = projectReferenceTwin(twinInput(), horizon);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(isAdvisoryPrediction(r.prediction)).toBe(true);
      expect(isAdvisoryPrediction({ ...r.prediction, advisory: false })).toBe(false);
      expect(isAdvisoryPrediction({ kind: "PREDICTION", points: [] })).toBe(false);
      expect(isAdvisoryPrediction(null)).toBe(false);
      expect(isAdvisoryPrediction("PREDICTION")).toBe(false);
    }
  });

  it("compile-time: advisory outputs can never be fed back as authoritative inputs", () => {
    const r = projectReferenceTwin(twinInput(), horizon);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const prediction = r.prediction;
      // @ts-expect-error — a Prediction is not a TwinStateInput (no observation history)
      const _badState: TwinStateInput = prediction;
      // @ts-expect-error — a Prediction is not an observation (A11)
      const _badObserved: ObservedValue = prediction;
      void _badState;
      void _badObserved;
      expect(prediction.advisory).toBe(true);
    }
  });
});

// ---------- Rejections — every code, illegal inputs ----------

describe("projectReferenceTwin: honest rejections", () => {
  it("rejects missing-tenant", () => {
    const r = projectReferenceTwin({ ...twinInput(), tenant: { tenantId: "" } }, horizon);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejected).toBe("missing-tenant");
  });

  it("rejects empty-history", () => {
    const r = projectReferenceTwin(twinInput([]), horizon);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejected).toBe("empty-history");
  });

  it("rejects invalid-observation-ref", () => {
    const r = projectReferenceTwin(
      twinInput([{ observationRef: "", atMs: 0, value: 1 }]),
      horizon,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejected).toBe("invalid-observation-ref");
  });

  it("rejects non-monotonic-times (duplicate and decreasing atMs)", () => {
    const dup = projectReferenceTwin(
      twinInput([
        { observationRef: "o1", atMs: 0, value: 1 },
        { observationRef: "o2", atMs: 0, value: 2 },
      ]),
      horizon,
    );
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.rejected).toBe("non-monotonic-times");

    const decreasing = projectReferenceTwin(
      twinInput([
        { observationRef: "o1", atMs: 2000, value: 1 },
        { observationRef: "o2", atMs: 1000, value: 2 },
      ]),
      horizon,
    );
    expect(decreasing.ok).toBe(false);
    if (!decreasing.ok) expect(decreasing.rejected).toBe("non-monotonic-times");
  });

  it("rejects invalid-horizon (zero/fractional steps, zero/fractional stepMs)", () => {
    for (const bad of [
      { steps: 0, stepMs: 1000 },
      { steps: 1.5, stepMs: 1000 },
      { steps: 2, stepMs: 0 },
      { steps: 2, stepMs: 1000.5 },
    ]) {
      const r = projectReferenceTwin(twinInput(), bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.rejected).toBe("invalid-horizon");
    }
  });

  it(`rejects horizon-too-large (steps > ${MAX_PROJECTION_STEPS})`, () => {
    const r = projectReferenceTwin(twinInput(), { steps: MAX_PROJECTION_STEPS + 1, stepMs: 1000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejected).toBe("horizon-too-large");
  });
});

// ---------- ModelPort seam ----------

describe("ModelPort seam", () => {
  it("the reference model sits behind the port and is deterministic through it", () => {
    const port = makeReferenceModelPort();
    expect(port.name).toBe("reference.twin.linear-drift");
    expect(port.modelVersion).toBe(REFERENCE_MODEL_VERSION);
    const a = port.project(twinInput(), horizon);
    const b = port.project(twinInput(), horizon);
    expect(a).toEqual(b);
    expect(a).toEqual(projectReferenceTwin(twinInput(), horizon));
  });

  it("a custom adapter satisfies ModelPort — the seam is structural", () => {
    const stub: ModelPort = {
      name: "stub.deterministic",
      modelVersion: "stub-1",
      project: (input) => ({
        ok: true,
        prediction: {
          kind: "PREDICTION",
          advisory: true,
          tenant: input.tenant,
          asset: input.asset,
          metric: input.metric,
          originMs: input.asOfMs,
          horizon: { steps: 1, stepMs: 1 },
          points: [{ step: 1, atMs: input.asOfMs + 1, value: 0, bounds: { lower: 0, upper: 0 }, confidenceBps: 1000 }],
          provenance: {
            modelVersion: "stub-1",
            method: "reference.linear-drift",
            observationRefs: input.observations.map((o) => o.observationRef),
            inputDigest: "stub",
          },
        },
      }),
      runCounterfactual: () => ({ ok: false, rejected: "unknown-intervention", detail: "stub" }),
    };
    const r = stub.project(twinInput(), horizon);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.prediction.advisory).toBe(true);
      expect(r.prediction.provenance.observationRefs).toHaveLength(5);
    }
  });
});

// ---------- Counterfactuals ----------

function cfInput(intervention: CounterfactualIntervention, premise = "what-if"): CounterfactualInput {
  return { baseline: twinInput(), horizon, premise, intervention };
}

describe("runReferenceCounterfactual: divergence accounting", () => {
  it("offset intervention diverges every step with exact deltas and integer bps", () => {
    const r = runReferenceCounterfactual(cfInput({ kind: "offset", offset: 10 }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      const cf = r.projection;
      expect(cf.kind).toBe("HYPOTHETICAL");
      expect(cf.hypothetical).toBe(true);
      expect(cf.premise).toBe("what-if");
      expect(cf.points.map((p) => p.value)).toEqual([70, 80, 90, 100]);
      expect(cf.divergence.map((d) => d.delta)).toEqual([10, 10, 10, 10]);
      expect(cf.divergence[0]?.deltaBpsOfBaseline).toBe(1667); // round(10000*10/60)
      expect(cf.changedSteps).toEqual([1, 2, 3, 4]);
    }
  });

  it("scale and hold interventions produce exact counterfactual values", () => {
    const scale = runReferenceCounterfactual(cfInput({ kind: "scale", factor: 2 }));
    expect(scale.ok).toBe(true);
    if (scale.ok) {
      expect(scale.projection.points.map((p) => p.value)).toEqual([120, 140, 160, 180]);
      expect(scale.projection.divergence[0]?.deltaBpsOfBaseline).toBe(10000);
    }
    const hold = runReferenceCounterfactual(cfInput({ kind: "hold", value: 5 }));
    expect(hold.ok).toBe(true);
    if (hold.ok) {
      expect(hold.projection.points.map((p) => p.value)).toEqual([5, 5, 5, 5]);
      expect(hold.projection.divergence.every((d) => d.delta < 0)).toBe(true);
    }
  });

  it("set-drift intervention re-anchors the drift rate", () => {
    const r = runReferenceCounterfactual(cfInput({ kind: "set-drift", driftPerStepMs: 0.02 }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.projection.points.map((p) => p.value)).toEqual([70, 90, 110, 130]);
    }
  });

  it("truncate-history re-fits on the kept prefix with honestly lower confidence", () => {
    const r = runReferenceCounterfactual(cfInput({ kind: "truncate-history", dropCount: 2 }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.projection.points.map((p) => p.value)).toEqual([40, 50, 60, 70]);
      expect(r.projection.points[0]?.confidenceBps).toBe(1500); // floor(3000/2): 3 kept obs
      expect(r.projection.divergence[0]?.delta).toBe(-20);
      expect(r.projection.provenance.observationRefs).toEqual(["o1", "o2", "o3"]);
    }
  });

  it("a no-op intervention diverges nowhere (changedSteps empty, deltas zero)", () => {
    const r = runReferenceCounterfactual(cfInput({ kind: "offset", offset: 0 }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.projection.changedSteps).toEqual([]);
      expect(r.projection.divergence.every((d) => d.delta === 0)).toBe(true);
    }
  });

  it("deltaBpsOfBaseline is null when the baseline projects to exactly 0", () => {
    const zeroBaseline = twinInput([
      { observationRef: "z1", atMs: 0, value: 0 },
      { observationRef: "z2", atMs: 1000, value: 0 },
    ]);
    const r = runReferenceCounterfactual({
      baseline: zeroBaseline,
      horizon,
      premise: "lift by 5",
      intervention: { kind: "offset", offset: 5 },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.projection.divergence.every((d) => d.deltaBpsOfBaseline === null)).toBe(true);
      expect(r.projection.divergence.every((d) => d.delta === 5)).toBe(true);
    }
  });

  it("counterfactual bounds are wider and confidence lower than the baseline at every step (A11)", () => {
    const base = projectReferenceTwin(twinInput(), horizon);
    const r = runReferenceCounterfactual(cfInput({ kind: "offset", offset: 10 }));
    expect(base.ok && r.ok).toBe(true);
    if (base.ok && r.ok) {
      for (let k = 0; k < 4; k += 1) {
        const bp = base.prediction.points[k];
        const cp = r.projection.points[k];
        if (bp && cp) {
          const bw = bp.bounds.upper - bp.bounds.lower;
          const cw = cp.bounds.upper - cp.bounds.lower;
          expect(cw).toBeGreaterThan(bw);
          expect(cp.confidenceBps).toBe(Math.floor(bp.confidenceBps / 2));
          expect(Number.isInteger(cp.confidenceBps)).toBe(true);
        }
      }
      // baselineProvenance links the counterfactual to its baseline run.
      expect(r.projection.baselineProvenance).toEqual(base.prediction.provenance);
    }
  });

  it("rejects unknown-intervention", () => {
    const bogus = { kind: "bogus" } as unknown as CounterfactualIntervention;
    const r = runReferenceCounterfactual(cfInput(bogus));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejected).toBe("unknown-intervention");
  });

  it("rejects invalid-intervention (zero/fractional/exhausting dropCount)", () => {
    for (const dropCount of [0, 1.5, 5]) {
      const r = runReferenceCounterfactual(cfInput({ kind: "truncate-history", dropCount }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.rejected).toBe("invalid-intervention");
    }
  });

  it("propagates baseline rejections (empty history) before intervention validation", () => {
    const r = runReferenceCounterfactual({
      baseline: twinInput([]),
      horizon,
      premise: "p",
      intervention: { kind: "offset", offset: 1 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejected).toBe("empty-history");
  });
});
