/**
 * Staleness-propagation tests (F280B, Wave 8 lane B).
 *
 * Behavior under test: worst-of aggregation of upstream-classified inputs
 * (no classification happens here — structurally no clock), deterministic
 * canonical ordering, integrity verification (forged headline + digest
 * tamper), and A8 cross-tenant fail-closed refusals.
 */
import { describe, it, expect } from "vitest";
import {
  propagateStaleness,
  verifyStalenessPropagation,
} from "../src/index.ts";
import type { ClassifiedInput } from "../src/index.ts";

const TENANT = "tnt_staleness";
const T0 = 1_774_000_000_000;

function input(overrides: Partial<ClassifiedInput> = {}): ClassifiedInput {
  return {
    ref: "obs-1",
    tenantId: TENANT,
    staleness: "fresh",
    ageMs: 1_000,
    classifiedAtMs: T0,
    ...overrides,
  };
}

describe("propagateStaleness — aggregation without re-scoring", () => {
  it("propagates a single fresh input verbatim", () => {
    const r = propagateStaleness([input()], TENANT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.propagation.headline).toBe("fresh");
    expect(r.propagation.headlineRef).toBe("obs-1");
    expect(r.propagation.headlineAgeMs).toBe(1_000);
    expect(r.propagation.rescored).toBe(false);
  });

  it("worst-of aggregation: stale beats fresh, unknown beats stale", () => {
    const stale = propagateStaleness(
      [input({ ref: "a", staleness: "fresh" }), input({ ref: "b", staleness: "stale", ageMs: 30_000 })],
      TENANT,
    );
    expect(stale.ok && stale.propagation.headline).toBe("stale");
    const unknown = propagateStaleness(
      [
        input({ ref: "a", staleness: "fresh" }),
        input({ ref: "b", staleness: "stale" }),
        input({ ref: "c", staleness: "unknown", ageMs: null }),
      ],
      TENANT,
    );
    expect(unknown.ok && unknown.propagation.headline).toBe("unknown");
    if (unknown.ok) {
      expect(unknown.propagation.headlineAgeMs).toBeNull(); // never-observed input
    }
  });

  it("the headline input is the CANONICAL FIRST among the worst class (order-independent)", () => {
    const inputs = [
      input({ ref: "z-input", staleness: "stale", ageMs: 31_000 }),
      input({ ref: "a-input", staleness: "stale", ageMs: 30_000 }),
      input({ ref: "m-input", staleness: "fresh" }),
    ];
    const a = propagateStaleness(inputs, TENANT);
    const b = propagateStaleness([...inputs].reverse(), TENANT);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    if (a.ok) {
      expect(a.propagation.headlineRef).toBe("a-input"); // lowest ref among 'stale'
      expect(a.propagation.inputs.map((i) => i.ref)).toEqual(["a-input", "m-input", "z-input"]);
    }
  });

  it("NO RE-SCORING, structurally: the propagated class is frozen at classification time", () => {
    // An input classified 'fresh' at T0. A naive re-score at a MUCH later
    // logical now would call it unknown — but the propagation never sees a
    // clock, so the class stays what it was classified as.
    const classified = input({ ref: "obs-old", staleness: "fresh", ageMs: 5_000, classifiedAtMs: T0 });
    const r = propagateStaleness([classified], TENANT);
    expect(r.ok && r.propagation.headline).toBe("fresh");
    // Propagating again (any number of times) never changes it.
    const again = propagateStaleness([classified], TENANT);
    expect(JSON.stringify(r)).toBe(JSON.stringify(again));
  });

  it("is deterministic: identical inputs produce byte-identical propagations", () => {
    const inputs = [input(), input({ ref: "obs-2", staleness: "stale" })];
    expect(JSON.stringify(propagateStaleness(inputs, TENANT))).toBe(
      JSON.stringify(propagateStaleness(inputs, TENANT)),
    );
  });
});

describe("propagateStaleness — refusals", () => {
  it("refuses an empty input set", () => {
    expect(propagateStaleness([], TENANT)).toMatchObject({
      ok: false, reason: "staleness.no-inputs",
    });
  });

  it("refuses an input with an empty ref", () => {
    expect(propagateStaleness([input({ ref: "" })], TENANT)).toMatchObject({
      ok: false, reason: "staleness.missing-ref",
    });
  });

  it("A8: refuses a cross-tenant input, naming the offender ref", () => {
    const r = propagateStaleness(
      [input(), input({ ref: "obs-foreign", tenantId: "tnt_other" })],
      TENANT,
    );
    expect(r).toMatchObject({ ok: false, reason: "staleness.tenant-mismatch", offender: "obs-foreign" });
  });

  it("refuses an empty tenant scope", () => {
    expect(propagateStaleness([input()], "")).toMatchObject({
      ok: false, reason: "staleness.tenant-mismatch",
    });
  });
});

describe("verifyStalenessPropagation — integrity", () => {
  it("verifies a genuine propagation", () => {
    const r = propagateStaleness([input(), input({ ref: "b", staleness: "stale" })], TENANT);
    if (!r.ok) throw new Error("propagation refused");
    expect(verifyStalenessPropagation(r.propagation)).toMatchObject({ verified: true, reason: null });
  });

  it("a FORGED headline (fresh stamped over stale inputs) fails", () => {
    const r = propagateStaleness(
      [input({ ref: "a", staleness: "stale" }), input({ ref: "b", staleness: "stale" })],
      TENANT,
    );
    if (!r.ok) throw new Error("propagation refused");
    const forged = { ...r.propagation, headline: "fresh" as const };
    expect(verifyStalenessPropagation(forged)).toMatchObject({
      verified: false, reason: "staleness.headline-mismatch",
    });
  });

  it("a tampered digest fails", () => {
    const r = propagateStaleness([input()], TENANT);
    if (!r.ok) throw new Error("propagation refused");
    const tampered = { ...r.propagation, propagationDigest: "deadbeef" };
    expect(verifyStalenessPropagation(tampered)).toMatchObject({
      verified: false, reason: "staleness.digest-mismatch",
    });
  });

  it("a tampered input vector fails (the digest covers every input)", () => {
    const r = propagateStaleness([input({ ref: "a" }), input({ ref: "b", staleness: "stale" })], TENANT);
    if (!r.ok) throw new Error("propagation refused");
    const tampered = {
      ...r.propagation,
      inputs: r.propagation.inputs.map((i) =>
        i.ref === "b" ? { ...i, staleness: "fresh" as const } : i,
      ),
    };
    expect(verifyStalenessPropagation(tampered).verified).toBe(false);
  });
});
