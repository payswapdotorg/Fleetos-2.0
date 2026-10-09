import { describe, it, expect } from "vitest";
import {
  LATENT_DIM,
  JEPA_SPACE_VERSION,
  JEPA_DEFAULT_NAMESPACE,
  fnv1a32,
  jepaDigest,
  canonicalJepaJson,
  latentDot,
  latentNorm,
  latentL2,
  latentCosine,
  makeJepaSpace,
} from "../../src/jepa/embedding.ts";
import { addLatents, scaleLatent } from "../../src/jepa/predictor.ts";

describe("jepa embedding: constants + hash family (known answers)", () => {
  it("documents the latent dimension and space version", () => {
    expect(LATENT_DIM).toBe(32);
    expect(JEPA_SPACE_VERSION).toBe("jepa-1.0.0");
    expect(JEPA_DEFAULT_NAMESPACE).toBe("fleetos.jepa.v1");
  });

  it("fnv1a32 empty string is the FNV offset basis (known answer)", () => {
    expect(fnv1a32("")).toBe(0x811c9dc5);
  });

  it("fnv1a32 pins the lane's additive variant (known answers)", () => {
    expect(fnv1a32("a")).toBe(3826002220);
    expect(fnv1a32("hello")).toBe(1335831723);
  });

  it("jepaDigest is 8-hex and pins known strings", () => {
    expect(jepaDigest("")).toBe("811c9dc5");
    expect(jepaDigest("benchmark-premise")).toBe("e941dff6");
    expect(jepaDigest("x")).toMatch(/^[0-9a-f]{8}$/);
  });

  it("canonicalJepaJson is key-order independent (recursively)", () => {
    expect(canonicalJepaJson({ a: 1, b: 2 })).toBe(canonicalJepaJson({ b: 2, a: 1 }));
    expect(canonicalJepaJson({ z: { y: 1, x: 2 }, w: 3 })).toBe(
      canonicalJepaJson({ w: 3, z: { x: 2, y: 1 } }),
    );
  });

  it("canonicalJepaJson preserves array order and maps undefined to null", () => {
    expect(canonicalJepaJson([1, 2])).not.toBe(canonicalJepaJson([2, 1]));
    expect(canonicalJepaJson({ u: undefined })).toBe('{"u":null}');
    expect(canonicalJepaJson("s")).toBe('"s"');
    expect(canonicalJepaJson(3)).toBe("3");
    expect(canonicalJepaJson(true)).toBe("true");
  });
});

describe("jepa embedding: distance semantics (known answers)", () => {
  it("dot, norm, L2", () => {
    expect(latentDot([1, 2, 3], [4, 5, 6])).toBe(32);
    expect(latentNorm([3, 4])).toBe(5);
    expect(latentL2([0, 0], [3, 4])).toBe(5);
    expect(latentL2([1, 2, 3], [1, 2, 3])).toBe(0);
  });

  it("cosine: parallel 1, anti -1, orthogonal 0", () => {
    expect(latentCosine([2, 0], [5, 0])).toBe(1);
    expect(latentCosine([1, 0], [-1, 0])).toBe(-1);
    expect(latentCosine([1, 0], [0, 1])).toBe(0);
  });

  it("cosine zero-vector convention: 0, never NaN", () => {
    expect(latentCosine([0, 0], [1, 2])).toBe(0);
    expect(latentCosine([0, 0], [0, 0])).toBe(0);
  });
});

describe("jepa embedding: space construction", () => {
  it("rejects invalid dims (fail-loud)", () => {
    expect(() => makeJepaSpace({ dim: 1 })).toThrow(RangeError);
    expect(() => makeJepaSpace({ dim: 1.5 })).toThrow(RangeError);
    expect(() => makeJepaSpace({ dim: 1025 })).toThrow(RangeError);
    expect(() => makeJepaSpace({ dim: -3 })).toThrow(RangeError);
  });

  it("rejects an empty namespace (fail-loud)", () => {
    expect(() => makeJepaSpace({ namespace: "" })).toThrow(RangeError);
  });

  it("feature rows are unit-norm, dim-length, frozen", () => {
    const space = makeJepaSpace();
    for (const name of ["temperature", "pressure", "humidity"]) {
      const row = space.featureRow(name);
      expect(row).toHaveLength(LATENT_DIM);
      expect(latentNorm(row)).toBeCloseTo(1, 9);
      expect(Object.isFrozen(row)).toBe(true);
    }
  });

  it("construction is deterministic: two spaces derive byte-identical rows", () => {
    const a = makeJepaSpace();
    const b = makeJepaSpace();
    for (const name of ["temperature", "pressure", "a", "zzz"]) {
      expect(a.featureRow(name)).toEqual(b.featureRow(name));
    }
  });

  it("different feature names derive different rows", () => {
    const space = makeJepaSpace();
    const r1 = space.featureRow("temperature");
    const r2 = space.featureRow("pressure");
    expect(r1).not.toEqual(r2);
  });

  it("a different namespace derives a different space", () => {
    const s1 = makeJepaSpace();
    const s2 = makeJepaSpace({ namespace: "other.namespace" });
    expect(s1.featureRow("temperature")).not.toEqual(s2.featureRow("temperature"));
  });
});

describe("jepa embedding: embed + decode", () => {
  it("empty feature map embeds to the zero vector", () => {
    const space = makeJepaSpace();
    expect(space.embedFeatures({})).toEqual(Array.from({ length: LATENT_DIM }, () => 0));
  });

  it("embedding is insertion-order independent (sorted-key accumulation)", () => {
    const space = makeJepaSpace();
    const z1 = space.embedFeatures({ a: 1, b: 2, c: 3 });
    const z2 = space.embedFeatures({ c: 3, a: 1, b: 2 });
    expect(z1).toEqual(z2);
  });

  it("non-finite feature values are excluded, never poison the latent", () => {
    const space = makeJepaSpace();
    expect(space.embedFeatures({ a: Number.NaN, b: 1 })).toEqual(space.embedFeatures({ b: 1 }));
    expect(space.embedFeatures({ a: Number.POSITIVE_INFINITY, b: 1 })).toEqual(
      space.embedFeatures({ b: 1 }),
    );
  });

  it("embedding is linear: embed(a+b) = embed(a) + embed(b) exactly", () => {
    const space = makeJepaSpace();
    const both = space.embedFeatures({ a: 1, b: 1 });
    const sum = addLatents(space.embedFeatures({ a: 1 }), space.embedFeatures({ b: 1 }));
    expect(both).toEqual(sum);
  });

  it("embedding scales: embed({a: 2.5}) = 2.5 * embed({a: 1})", () => {
    const space = makeJepaSpace();
    expect(space.embedFeatures({ a: 2.5 })).toEqual(scaleLatent(space.embedFeatures({ a: 1 }), 2.5));
  });

  it("single-feature decode is the identity (unit-norm row projection)", () => {
    const space = makeJepaSpace();
    expect(space.decode(space.embedFeatures({ temperature: 7.25 }), "temperature")).toBeCloseTo(
      7.25,
      12,
    );
    expect(space.decode(space.embedFeatures({ temperature: 42 }), "temperature")).toBeCloseTo(
      42,
      12,
    );
  });
});

describe("jepa embedding: latent dynamics (non-expansion)", () => {
  it("steps 0 (and non-integer steps) are the identity", () => {
    const space = makeJepaSpace();
    const z = space.embedFeatures({ temperature: 42, pressure: 3.5 });
    expect(space.applyDynamics(z, 0)).toEqual(z);
    expect(space.applyDynamics(z, 1.5)).toEqual(z);
    expect(space.applyDynamics(z, -2)).toEqual(z);
  });

  it("a wrong-length vector is returned unchanged (defensive identity)", () => {
    const space = makeJepaSpace();
    const z = [1, 2, 3];
    expect(space.applyDynamics(z, 5)).toEqual(z);
  });

  it("||A z|| <= ||z|| — the Cauchy-Schwarz non-expansion proof, machine-tested", () => {
    const space = makeJepaSpace();
    const vectors = [
      space.embedFeatures({ temperature: 42 }),
      space.embedFeatures({ humidity: 11, pressure: 3.5, temperature: 42 }),
      space.embedFeatures({ a: 1, b: -2, c: 3.75, d: 0.5 }),
    ];
    for (const z of vectors) {
      const az = space.applyDynamics(z, 1);
      expect(latentNorm(az)).toBeLessThanOrEqual(latentNorm(z) + 1e-12);
    }
  });

  it("applyDynamics(z, n) equals n single-step applications", () => {
    const space = makeJepaSpace();
    const z = space.embedFeatures({ temperature: 42 });
    const twice = space.applyDynamics(space.applyDynamics(z, 1), 1);
    expect(space.applyDynamics(z, 2)).toEqual(twice);
  });
});

describe("jepa embedding: latent digest", () => {
  it("is stable across calls and construction re-runs", () => {
    const a = makeJepaSpace();
    const b = makeJepaSpace();
    const z = a.embedFeatures({ temperature: 42 });
    expect(a.digest(z)).toBe(a.digest(z));
    expect(a.digest(z)).toBe(b.digest(z));
  });

  it("changes when a coordinate changes", () => {
    const space = makeJepaSpace();
    const z = space.embedFeatures({ temperature: 42 });
    const z2 = space.embedFeatures({ temperature: 43 });
    expect(space.digest(z)).not.toBe(space.digest(z2));
  });
});
