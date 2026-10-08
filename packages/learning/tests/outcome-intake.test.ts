/**
 * Learning outcome-intake tests — validate, dedupe, correlate by capability
 * + window, trend classification boundaries (Wave 5, F250B).
 */
import { describe, it, expect } from "vitest";
import {
  intakeOutcomes,
  observationDigest,
  correlateOutcomes,
  classifyOutcomeTrend,
  classifyGroupTrend,
  TREND_DELTA_BPS,
  type OutcomeIntakeCandidate,
} from "../src/index.ts";

const tenant = { tenantId: "t1" };
const cap = { capabilityId: "cap.test", version: "1.0.0" };

function obs(i: number, overrides: Partial<OutcomeIntakeCandidate<number>> = {}): OutcomeIntakeCandidate<number> {
  return {
    observationId: `o${i}`,
    caseId: `c${i % 3}`,
    capability: cap,
    actual: i,
    observedAtMs: 1000 + i * 10,
    observationRef: `ref-${i}`,
    success: true,
    ...overrides,
  };
}

describe("outcome intake: validation (fail-closed)", () => {
  it("accepts valid candidates, stamps the tenant and a digest", () => {
    const r = intakeOutcomes([obs(0), obs(1)], tenant);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.observations).toHaveLength(2);
      expect(r.observations[0]!.tenantId).toBe("t1");
      expect(r.observations[0]!.observationDigest).toMatch(/^[0-9a-f]{8}$/);
    }
  });

  it("rejects an empty intake tenant", () => {
    const r = intakeOutcomes([obs(0)], { tenantId: "" });
    expect(r).toMatchObject({ ok: false, code: "missing-tenant" });
  });

  it("rejects empty ids/refs and invalid logical times", () => {
    expect(intakeOutcomes([obs(0, { observationId: "" })], tenant)).toMatchObject({ ok: false, code: "empty-observation-id" });
    expect(intakeOutcomes([obs(0, { caseId: "" })], tenant)).toMatchObject({ ok: false, code: "empty-case-id" });
    expect(intakeOutcomes([obs(0, { observationRef: "" })], tenant)).toMatchObject({ ok: false, code: "empty-observation-ref" });
    expect(intakeOutcomes([obs(0, { observedAtMs: -1 })], tenant)).toMatchObject({ ok: false, code: "invalid-observed-at" });
    expect(intakeOutcomes([obs(0, { observedAtMs: 1.5 })], tenant)).toMatchObject({ ok: false, code: "invalid-observed-at" });
  });

  it("rejects the same observationId with different content", () => {
    const r = intakeOutcomes([obs(0), obs(0, { actual: 999 })], tenant);
    expect(r).toMatchObject({ ok: false, code: "duplicate-observation-id" });
    if (!r.ok) expect(r.reason).toContain("o0");
  });
});

describe("outcome intake: dedupe + determinism", () => {
  it("dedupes exact duplicates by digest and reports them", () => {
    const r = intakeOutcomes([obs(0), obs(1), obs(0)], tenant);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.observations.map((o) => o.observationId)).toEqual(["o0", "o1"]);
      expect(r.duplicates).toEqual(["o0"]);
    }
  });

  it("is order-independent — reversed input gives the identical result", () => {
    const list = [obs(0), obs(1), obs(2), obs(0)];
    expect(intakeOutcomes(list, tenant)).toEqual(intakeOutcomes([...list].reverse(), tenant));
  });

  it("orders by (observedAtMs, observationId) regardless of input order", () => {
    const r = intakeOutcomes([obs(5), obs(1), obs(3)], tenant);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.observations.map((o) => o.observationId)).toEqual(["o1", "o3", "o5"]);
  });

  it("observation digest is deterministic and content-sensitive", () => {
    expect(observationDigest(obs(0))).toBe(observationDigest(obs(0)));
    expect(observationDigest(obs(0))).not.toBe(observationDigest(obs(0, { success: false })));
  });
});

describe("correlateOutcomes (capability + logical-time windows)", () => {
  function taken(n: number) {
    const r = intakeOutcomes(Array.from({ length: n }, (_, i) => obs(i)), tenant);
    if (!r.ok) throw new Error("fixture intake failed");
    return [...r.observations];
  }

  it("buckets by floor(observedAtMs / windowMs) and orders groups deterministically", () => {
    const observations = taken(4);
    const r = correlateOutcomes(observations, { tenant, windowMs: 40 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // obs at 1000,1010,1020,1030 with windowMs 40 -> windows 25,25,25,25
      expect(r.groups).toHaveLength(1);
      expect(r.groups[0]!.windowStartMs).toBe(1000);
      expect(r.groups[0]!.windowEndMs).toBe(1040);
      expect(r.groups[0]!.count).toBe(4);
      expect(r.groups[0]!.successes).toBe(4);
      expect(r.groups[0]!.successRateBps).toBe(10000);
    }
  });

  it("splits windows and computes integer-bps success rates", () => {
    const r = intakeOutcomes(
      [obs(0, { observedAtMs: 0, success: true }), obs(1, { observedAtMs: 10, success: false }), obs(2, { observedAtMs: 100, success: true })],
      tenant,
    );
    if (!r.ok) throw new Error("fixture intake failed");
    const c = correlateOutcomes([...r.observations], { tenant, windowMs: 100 });
    expect(c.ok).toBe(true);
    if (c.ok) {
      expect(c.groups).toHaveLength(2);
      expect(c.groups[0]!.windowIndex).toBe(0);
      expect(c.groups[0]!.successRateBps).toBe(5000);
      expect(c.groups[1]!.windowIndex).toBe(1);
      expect(c.groups[1]!.successRateBps).toBe(10000);
    }
  });

  it("correlates by capability version (separate groups)", () => {
    const other = { capabilityId: "cap.other", version: "1.0.0" };
    const r = intakeOutcomes([obs(0), obs(1, { capability: other })], tenant);
    if (!r.ok) throw new Error("fixture intake failed");
    const c = correlateOutcomes([...r.observations], { tenant, windowMs: 100 });
    expect(c.ok).toBe(true);
    if (c.ok) expect(c.groups.map((g) => g.capability.capabilityId)).toEqual(["cap.other", "cap.test"]);
  });

  it("rejects invalid window sizes and empty tenants", () => {
    expect(correlateOutcomes(taken(2), { tenant, windowMs: 0 })).toMatchObject({ ok: false, code: "invalid-observed-at" });
    expect(correlateOutcomes(taken(2), { tenant, windowMs: 1.5 })).toMatchObject({ ok: false, code: "invalid-observed-at" });
    expect(correlateOutcomes(taken(2), { tenant: { tenantId: "" }, windowMs: 10 })).toMatchObject({ ok: false, code: "missing-tenant" });
  });
});

describe("classifyOutcomeTrend (deterministic boundaries)", () => {
  it("classifies improving / degrading / stable", () => {
    expect(classifyOutcomeTrend([2000, 8000])).toBe("improving");
    expect(classifyOutcomeTrend([8000, 2000])).toBe("degrading");
    expect(classifyOutcomeTrend([6000, 6500])).toBe("stable");
  });

  it("treats exactly +/-TREND_DELTA_BPS as stable (strict inequality)", () => {
    expect(TREND_DELTA_BPS).toBe(500);
    expect(classifyOutcomeTrend([5000, 5500])).toBe("stable"); // +500 exactly
    expect(classifyOutcomeTrend([5500, 5000])).toBe("stable"); // -500 exactly
    expect(classifyOutcomeTrend([5000, 5501])).toBe("improving"); // +501
    expect(classifyOutcomeTrend([5501, 5000])).toBe("degrading"); // -501
  });

  it("compares half-means (odd counts weight the second half heavier)", () => {
    // first half [0] = 0bps, second half [5000, 10000] mean 7500 -> improving
    expect(classifyOutcomeTrend([0, 5000, 10000])).toBe("improving");
    // first half [10000] = 10000, second half [5000, 0] mean 2500 -> degrading
    expect(classifyOutcomeTrend([10000, 5000, 0])).toBe("degrading");
  });

  it("defaults to stable with fewer than 2 points", () => {
    expect(classifyOutcomeTrend([])).toBe("stable");
    expect(classifyOutcomeTrend([10000])).toBe("stable");
  });

  it("classifies a correlated group sequence directly", () => {
    const mk = (success: boolean, at: number): OutcomeIntakeCandidate<number>[] => [
      { observationId: `a${at}`, caseId: "c", capability: cap, actual: 1, observedAtMs: at, observationRef: `r${at}`, success },
    ];
    const earlyIntake = intakeOutcomes(mk(false, 0), tenant); // window 0: 0 bps
    const lateIntake = intakeOutcomes(mk(true, 10_000), tenant); // window 2 (windowMs 5000): 10000 bps
    if (!earlyIntake.ok || !lateIntake.ok) throw new Error("fixture intake failed");
    const c = correlateOutcomes([...earlyIntake.observations, ...lateIntake.observations], { tenant, windowMs: 5000 });
    expect(c.ok).toBe(true);
    if (c.ok) {
      expect(c.groups.map((g) => g.successRateBps)).toEqual([0, 10000]);
      expect(classifyGroupTrend(c.groups)).toBe("improving");
    }
  });
});
