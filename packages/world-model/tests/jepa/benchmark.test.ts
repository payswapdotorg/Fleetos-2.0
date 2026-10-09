import { describe, it, expect } from "vitest";
import { makeReferenceWorldModelAdapter, assertHypotheticalMarker } from "../../src/index.ts";
import { canonicalJepaJson, makeJepaSpace } from "../../src/jepa/embedding.ts";
import {
  JEPA_FAMILY_REGISTRY,
  defaultMaskPolicy,
  makeJepaCoreAdapter,
  makeJepaMaskedAdapter,
  makeJepaRolloutAdapter,
} from "../../src/jepa/index.ts";
import {
  runJepaBenchmark,
  JEPA_BENCHMARK_FIXTURES,
  type JepaBenchmarkReport,
} from "../../src/jepa/benchmark.ts";
import type { WorldModelAdapter } from "../../src/index.ts";

const tenant = { tenantId: "t1" };
const asset = { assetId: "a-1" };
const FEATURES = { humidity: 11, temperature: 42 };

describe("jepa family: registry", () => {
  it("registers exactly the three documented members", () => {
    expect(JEPA_FAMILY_REGISTRY.map((e) => e.id)).toEqual(["jepa.core", "jepa.masked", "jepa.rollout"]);
    expect(JEPA_FAMILY_REGISTRY.map((e) => e.variant)).toEqual(["core", "masked", "rollout"]);
  });

  it("every registry entry's make() produces a working seam adapter", () => {
    for (const entry of JEPA_FAMILY_REGISTRY) {
      const adapter = entry.make(makeJepaSpace(), "1970-01-01T00:00:00.000Z");
      const rep = adapter.represent({ tenant, asset, features: FEATURES });
      const p = adapter.predict(rep);
      const cf = adapter.counterfactual(rep, "premise", p.value, p.uncertainty);
      expect(adapter.name).toBe(entry.id);
      expect(p.kind).toBe("PREDICTED");
      expect(cf.value.hypothetical).toBe(true);
    }
  });
});

describe("jepa family: the WorldModelAdapter CONTRACT (every member)", () => {
  const adapters: readonly WorldModelAdapter[] = [
    makeJepaCoreAdapter(),
    makeJepaMaskedAdapter(),
    makeJepaRolloutAdapter(),
  ];

  it("represent is deterministic and carries the JEPA version", () => {
    for (const adapter of adapters) {
      const r1 = adapter.represent({ tenant, asset, features: FEATURES });
      const r2 = adapter.represent({ tenant, asset, features: FEATURES });
      expect(r1).toEqual(r2);
      expect(r1.version).toBe("jepa-1.0.0");
      expect(r1.representationId).toBe(`jepa-${adapter.name.slice(5)}-${tenant.tenantId}-${asset.assetId}`);
      expect(r1.features).toEqual(FEATURES);
    }
  });

  it("predict is TOTAL: never throws over a malformed-input battery", () => {
    const battery: readonly Readonly<Record<string, number>>[] = [
      {},
      { temperature: Number.NaN },
      { temperature: Number.POSITIVE_INFINITY },
      { temperature: 42, "jepa.horizon": Number.NaN },
      { temperature: 42, "jepa.horizon": 0 },
      { temperature: 42, "jepa.horizon": 2.5 },
      { temperature: 42, "jepa.delta.x": Number.NaN },
      { "jepa.horizon": 4 },
    ];
    for (const adapter of adapters) {
      for (const features of battery) {
        const rep = adapter.represent({ tenant, asset, features });
        expect(() => adapter.predict(rep)).not.toThrow();
      }
    }
  });

  it("predict is deterministic: same representation => byte-identical outputs", () => {
    for (const adapter of adapters) {
      const rep = adapter.represent({ tenant, asset, features: FEATURES });
      expect(adapter.predict(rep)).toEqual(adapter.predict(rep));
    }
  });

  it("the widening law holds vs the reference adapter: never narrower at equal horizon", () => {
    const reference = makeReferenceWorldModelAdapter();
    for (const fixture of JEPA_BENCHMARK_FIXTURES) {
      const refRep = reference.represent({ tenant, asset, features: fixture.features });
      const refWidth =
        reference.predict(refRep).uncertainty.upper - reference.predict(refRep).uncertainty.lower;
      for (const adapter of adapters) {
        const rep = adapter.represent({ tenant, asset, features: fixture.features });
        const p = adapter.predict(rep);
        const width = p.uncertainty.upper - p.uncertainty.lower;
        expect(width).toBeGreaterThanOrEqual(refWidth - 1e-9);
        expect(p.uncertainty.method).toBe("jepa.latent-sqrt");
        expect(p.uncertainty.confidence).toBeLessThanOrEqual(0.5 + 1e-12); // never MORE certain
      }
    }
  });

  it("counterfactual enforces A11: a narrow provided interval is widened 2x by the EXISTING law", () => {
    for (const adapter of adapters) {
      const rep = adapter.represent({ tenant, asset, features: FEATURES });
      const baseline = adapter.predict(rep);
      const narrow = { lower: 0, upper: 0.5, confidence: 0.5, method: "jepa.latent-sqrt" as const };
      const cf = adapter.counterfactual(rep, "premise", 1, narrow);
      const providedWidth = 0.5;
      const cfWidth = cf.value.uncertainty.upper - cf.value.uncertainty.lower;
      expect(cfWidth).toBeCloseTo(2 * providedWidth, 9);
      expect(cfWidth).toBeGreaterThan(providedWidth);
      expect(cf.value.uncertainty.confidence).toBeCloseTo(0.25, 12);
      expect(assertHypotheticalMarker(cf)).toBe(true);
      expect(baseline.kind).toBe("PREDICTED"); // baseline stays a prediction
    }
  });

  it("counterfactual keeps an already-wider provided interval unchanged", () => {
    for (const adapter of adapters) {
      const rep = adapter.represent({ tenant, asset, features: FEATURES });
      const wide = { lower: -10, upper: 30, confidence: 0.9, method: "bootstrap" as const };
      const cf = adapter.counterfactual(rep, "premise", 1, wide);
      expect(cf.value.uncertainty).toEqual(wide);
    }
  });

  it("the adapters never surface an ActionIntent or GuardianDecision (the seam's law)", () => {
    // The WorldModelAdapter seam has exactly name/represent/predict/counterfactual —
    // there is no authorize/execute method to call. Structural check:
    for (const adapter of adapters) {
      expect(Object.keys(adapter).sort()).toEqual(["counterfactual", "name", "predict", "represent"]);
    }
  });
});

describe("jepa family: variant-specific adapter behavior", () => {
  it("defaultMaskPolicy: the lexicographically later ceil(n/2) keys (known answers)", () => {
    expect(defaultMaskPolicy([])).toEqual([]);
    expect(defaultMaskPolicy(["a"])).toEqual(["a"]);
    expect(defaultMaskPolicy(["b", "a"])).toEqual(["b"]);
    expect(defaultMaskPolicy(["c", "a", "b"])).toEqual(["b", "c"]);
    expect(defaultMaskPolicy(["d", "c", "b", "a"])).toEqual(["c", "d"]);
  });

  it("masked adapter: known answer + widened (2x) uncertainty vs the core path", () => {
    const space = makeJepaSpace();
    const masked = makeJepaMaskedAdapter(space);
    const core = makeJepaCoreAdapter(space);
    const rep = masked.represent({ tenant, asset, features: FEATURES });
    const p = masked.predict(rep);
    expect(p.value).toBe(0.149902);
    expect(p.uncertainty.upper - p.uncertainty.lower).toBeCloseTo(4, 9);
    expect(p.uncertainty.confidence).toBeCloseTo(0.25, 12);
    expect(core.predict(rep).value).not.toBe(p.value); // masked != full decode
  });

  it("masked adapter with no maskable payload falls back to the core path", () => {
    const space = makeJepaSpace();
    const masked = makeJepaMaskedAdapter(space);
    const core = makeJepaCoreAdapter(space);
    const features = { "jepa.horizon": 4 } as const;
    const rep = masked.represent({ tenant, asset, features });
    expect(masked.predict(rep)).toEqual(core.predict(core.represent({ tenant, asset, features })));
  });

  it("rollout adapter: prev-key seeding changes the trajectory (known answers)", () => {
    const space = makeJepaSpace();
    const rollout = makeJepaRolloutAdapter(space);
    const noPrev = rollout.predict(rollout.represent({ tenant, asset, features: { temperature: 42 } }));
    const withPrev = rollout.predict(
      rollout.represent({ tenant, asset, features: { temperature: 42, "jepa.prev.temperature": 40 } }),
    );
    expect(noPrev.value).toBe(-0.174765);
    expect(withPrev.value).toBe(1.825235);
    expect(withPrev.value).not.toBe(noPrev.value);
  });

  it("core adapter: reserved-key horizon control widens the interval (h=4 vs h=1)", () => {
    const core = makeJepaCoreAdapter();
    const h1 = core.predict(core.represent({ tenant, asset, features: { temperature: 42 } }));
    const h4 = core.predict(
      core.represent({ tenant, asset, features: { temperature: 42, "jepa.horizon": 4 } }),
    );
    expect(h4.uncertainty.upper - h4.uncertainty.lower).toBe(3);
    expect(h4.uncertainty.upper - h4.uncertainty.lower).toBeGreaterThan(
      h1.uncertainty.upper - h1.uncertainty.lower,
    );
  });
});

describe("jepa benchmark: byte-identical determinism proof", () => {
  const first: JepaBenchmarkReport = runJepaBenchmark();
  const second: JepaBenchmarkReport = runJepaBenchmark();
  const thirdOnFreshSpace: JepaBenchmarkReport = runJepaBenchmark(makeJepaSpace());

  it("report shape: 3 family sections x 5 fixtures, digests everywhere", () => {
    expect(first.spaceVersion).toBe("jepa-1.0.0");
    expect(first.fixtureCount).toBe(5);
    expect(first.family.map((f) => f.adapterId)).toEqual(["jepa.core", "jepa.masked", "jepa.rollout"]);
    for (const section of first.family) {
      expect(section.rows).toHaveLength(5);
      expect(section.adapterDigest).toMatch(/^[0-9a-f]{8}$/);
      for (const row of section.rows) {
        expect(row.rowDigest).toMatch(/^[0-9a-f]{8}$/);
        expect(row.hypothetical).toBe(true);
        expect(Number.isFinite(row.predictedValue)).toBe(true);
        expect(row.predictedConfidence).toBeLessThanOrEqual(0.5 + 1e-12);
      }
    }
    expect(first.aggregateDigest).toMatch(/^[0-9a-f]{8}$/);
  });

  it("BYTE-IDENTICAL re-run: canonical serializations equal, digests equal", () => {
    expect(canonicalJepaJson(second)).toBe(canonicalJepaJson(first));
    expect(second.aggregateDigest).toBe(first.aggregateDigest);
    for (let i = 0; i < first.family.length; i += 1) {
      expect(second.family[i]?.adapterDigest).toBe(first.family[i]?.adapterDigest);
    }
  });

  it("construction determinism: a FRESHLY-CONSTRUCTED space reproduces the report", () => {
    expect(canonicalJepaJson(thirdOnFreshSpace)).toBe(canonicalJepaJson(first));
    expect(thirdOnFreshSpace.aggregateDigest).toBe(first.aggregateDigest);
  });

  it("sensitivity: a different space (namespace) changes the aggregate digest", () => {
    const other = runJepaBenchmark(makeJepaSpace({ namespace: "other.space" }));
    expect(other.aggregateDigest).not.toBe(first.aggregateDigest);
  });
});
