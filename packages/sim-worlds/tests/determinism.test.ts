/**
 * @fleetos/sim-worlds — determinism tests (F260A).
 *
 * The entropy law: same seed -> byte-identical sequences; every sampler
 * is pure over (seed, parameters); out-of-bounds parameters refuse.
 */

import { describe, expect, it } from "vitest";
import {
  bernoulliFromBps,
  canonicalJson,
  createPrng,
  fnv1a32,
  jitterInBounds,
  nextRandom,
  pickWeighted,
  randomFromSeed,
} from "../src/determinism.js";

describe("fnv1a32 + canonicalJson — the digest convention", () => {
  it("is pure and stable (same parts -> same digest, forever)", () => {
    expect(fnv1a32(["fleet-world", 1, "abc"])).toBe(fnv1a32(["fleet-world", 1, "abc"]));
    expect(fnv1a32(["a"])).not.toBe(fnv1a32(["b"]));
  });

  it("is order-sensitive and flattens arrays deterministically", () => {
    expect(fnv1a32(["a", "b"])).not.toBe(fnv1a32(["b", "a"]));
    expect(fnv1a32(["a", ["b", "c"]])).toBe(fnv1a32(["a", "b", "c"]));
  });

  it("canonicalJson ignores key order but keeps array order", () => {
    expect(canonicalJson({ a: 1, b: [2, 3] })).toBe(canonicalJson({ b: [2, 3], a: 1 }));
    expect(canonicalJson({ a: [1, 2] })).not.toBe(canonicalJson({ a: [2, 1] }));
  });
});

describe("randomFromSeed — the counter-mode generator", () => {
  it("returns the same real number for the same seed, forever", () => {
    expect(randomFromSeed("seed-alpha")).toBe(randomFromSeed("seed-alpha"));
    expect(randomFromSeed("seed-alpha#0")).toBe(randomFromSeed("seed-alpha#0"));
  });

  it("returns values in [0, 1) across a wide address space", () => {
    for (let i = 0; i < 2_000; i++) {
      const v = randomFromSeed(`probe-${String(i)}`);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("decorrelates consecutive counter addresses (not trivially sequential)", () => {
    const values = new Set<number>();
    for (let i = 0; i < 500; i++) values.add(randomFromSeed(`seed-x#${String(i)}`));
    expect(values.size).toBeGreaterThan(450);
  });
});

describe("nextRandom — same seed -> byte-identical sequences", () => {
  it("replays identical sequences at several lengths", () => {
    for (const len of [1, 10, 100, 1_000]) {
      const a = createPrng("world-seed");
      const b = createPrng("world-seed");
      const as: number[] = [];
      let s = a;
      for (let i = 0; i < len; i++) {
        const r = nextRandom(s);
        as.push(r.value);
        s = r.state;
      }
      let t = b;
      const bs: number[] = [];
      for (let i = 0; i < len; i++) {
        const r = nextRandom(t);
        bs.push(r.value);
        t = r.state;
      }
      expect(JSON.stringify(bs)).toBe(JSON.stringify(as));
    }
  });

  it("different seeds produce different sequences", () => {
    const seq = (seed: string): number[] => {
      let s = createPrng(seed);
      const out: number[] = [];
      for (let i = 0; i < 50; i++) {
        const r = nextRandom(s);
        out.push(r.value);
        s = r.state;
      }
      return out;
    };
    expect(JSON.stringify(seq("seed-one"))).not.toBe(JSON.stringify(seq("seed-two")));
  });

  it("is pure — replaying from a saved state reproduces the tail exactly", () => {
    let s = createPrng("replay");
    const tailFrom: number[] = [];
    for (let i = 0; i < 10; i++) {
      const r = nextRandom(s);
      s = r.state;
    }
    const saved = s;
    for (let i = 0; i < 5; i++) {
      const r = nextRandom(s);
      tailFrom.push(r.value);
      s = r.state;
    }
    let t = saved;
    const tailReplay: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = nextRandom(t);
      tailReplay.push(r.value);
      t = r.state;
    }
    expect(tailReplay).toEqual(tailFrom);
  });
});

describe("bernoulliFromBps — bps rates", () => {
  it("certainty and impossibility are exact", () => {
    for (let i = 0; i < 100; i++) {
      expect(bernoulliFromBps(`c${String(i)}`, 10_000).hit).toBe(true);
      expect(bernoulliFromBps(`z${String(i)}`, 0).hit).toBe(false);
    }
  });

  it("refuses out-of-bounds and non-integer bps (fail-closed)", () => {
    expect(bernoulliFromBps("s", -1)).toMatchObject({ ok: false, reason: "bps-out-of-bounds" });
    expect(bernoulliFromBps("s", 10_001)).toMatchObject({ ok: false, reason: "bps-out-of-bounds" });
    expect(bernoulliFromBps("s", 500.5)).toMatchObject({ ok: false, reason: "bps-out-of-bounds" });
  });

  it("realizes a rate within seeded statistical bounds (3000 bps, 2000 draws)", () => {
    let hits = 0;
    for (let i = 0; i < 2_000; i++) {
      if (bernoulliFromBps(`stat-${String(i)}`, 3_000).hit) hits += 1;
    }
    expect(hits).toBeGreaterThanOrEqual(510); // 600 - ~4.5 sigma
    expect(hits).toBeLessThanOrEqual(690);
  });
});

describe("pickWeighted — discrete weighted picks", () => {
  it("degenerate weights always pick their index", () => {
    for (let i = 0; i < 50; i++) {
      expect(pickWeighted(`p${String(i)}`, [1, 0, 0]).index).toBe(0);
      expect(pickWeighted(`q${String(i)}`, [0, 7, 0]).index).toBe(1);
      expect(pickWeighted(`r${String(i)}`, [0, 0, 9]).index).toBe(2);
    }
  });

  it("picks every positive-weight index across an address sweep", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const r = pickWeighted(`mix-${String(i)}`, [1, 1, 1]);
      expect(r.ok).toBe(true);
      seen.add(r.index);
    }
    expect(seen.has(0) && seen.has(1) && seen.has(2)).toBe(true);
  });

  it("refuses empty, negative and zero-total weights (fail-closed)", () => {
    expect(pickWeighted("s", [])).toMatchObject({ ok: false, reason: "empty-weights" });
    expect(pickWeighted("s", [1, -1])).toMatchObject({ ok: false, reason: "negative-weight" });
    expect(pickWeighted("s", [0, 0])).toMatchObject({ ok: false, reason: "zero-total-weight" });
  });
});

describe("jitterInBounds — bounded deterministic jitter", () => {
  it("always lands inside [base+min, base+max] over a sweep", () => {
    for (let i = 0; i < 500; i++) {
      const r = jitterInBounds(`j-${String(i)}`, 100, -5, 5);
      expect(r.ok).toBe(true);
      expect(r.value).toBeGreaterThanOrEqual(95);
      expect(r.value).toBeLessThanOrEqual(105);
      expect(Number.isInteger(r.value)).toBe(true);
    }
  });

  it("a zero-width band is an exact constant", () => {
    for (let i = 0; i < 50; i++) {
      expect(jitterInBounds(`k-${String(i)}`, 42, 0, 0).value).toBe(42);
    }
  });

  it("refuses inverted or non-integer bounds (fail-closed)", () => {
    expect(jitterInBounds("s", 10, 5, -5)).toMatchObject({ ok: false, reason: "bad-bounds" });
    expect(jitterInBounds("s", 10, 0.5, 1)).toMatchObject({ ok: false, reason: "bad-bounds" });
  });
});
