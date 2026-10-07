import { describe, it, expect } from "vitest";
import { triage, type ObservationLike } from "./health.js";

const NOW = 1_727_000_000_000;

function obs(overrides: Partial<ObservationLike> = {}): ObservationLike {
  return {
    tenantId: "tnt_acme",
    deviceId: "dev_truck-001",
    seq: 1,
    observedAt: NOW,
    kind: "engine.temp.ok",
    payloadDigest: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
    ...overrides,
  };
}

describe("health: triage empty input -> honest insufficient-data", () => {
  it("returns no findings and insufficient-data degradation", () => {
    const r = triage([], NOW);
    expect(r.findings).toEqual([]);
    expect(r.degradation).toBe("insufficient-data");
  });
});

describe("health: triage severity mapping", () => {
  it("kind ending in .ok -> info severity", () => {
    const r = triage([obs({ kind: "engine.temp.ok" })], NOW);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]?.severity).toBe("info");
  });
  it("kind ending in .warn -> warning severity", () => {
    const r = triage([obs({ kind: "engine.temp.warn" })], NOW);
    expect(r.findings[0]?.severity).toBe("warning");
  });
  it("kind ending in .error -> warning severity (single occurrence)", () => {
    const r = triage([obs({ kind: "engine.temp.error" })], NOW);
    expect(r.findings[0]?.severity).toBe("warning");
  });
  it("3+ occurrences of .error escalate to critical", () => {
    const obs1 = obs({ kind: "engine.temp.error", seq: 1 });
    const obs2 = obs({ kind: "engine.temp.error", seq: 2, observedAt: NOW + 1 });
    const obs3 = obs({ kind: "engine.temp.error", seq: 3, observedAt: NOW + 2 });
    const r = triage([obs1, obs2, obs3], NOW);
    expect(r.findings[0]?.severity).toBe("critical");
    expect(r.findings[0]?.evidence).toHaveLength(3);
  });
});

describe("health: triage honest degradation", () => {
  it("unknown kind vocabulary -> unknown-signal-vocabulary degradation", () => {
    const r = triage([obs({ kind: "engine.garbage_xyz" })], NOW);
    expect(r.findings).toEqual([]);
    expect(r.degradation).toBe("unknown-signal-vocabulary");
  });
  it("mix of known and unknown kinds -> findings for known + degradation flag", () => {
    const r = triage(
      [
        obs({ kind: "engine.temp.ok", seq: 1 }),
        obs({ kind: "engine.garbage_xyz", seq: 2, observedAt: NOW + 1 }),
      ],
      NOW,
    );
    expect(r.findings).toHaveLength(1);
    expect(r.degradation).toBe("unknown-signal-vocabulary");
  });
});

describe("health: triage determinism", () => {
  it("identical inputs produce identical outputs", () => {
    const inputs = [
      obs({ kind: "engine.temp.error", seq: 1 }),
      obs({ kind: "engine.temp.error", seq: 2, observedAt: NOW + 1 }),
      obs({ kind: "engine.temp.error", seq: 3, observedAt: NOW + 2 }),
    ];
    const a = triage(inputs, NOW);
    const b = triage(inputs, NOW);
    expect(a).toEqual(b);
  });
  it("findings sort by severity then deviceId (stable)", () => {
    const inputs = [
      obs({ deviceId: "dev_b", kind: "engine.temp.ok", seq: 1 }),
      obs({ deviceId: "dev_a", kind: "engine.temp.error", seq: 1 }),
      obs({ deviceId: "dev_a", kind: "engine.temp.error", seq: 2, observedAt: NOW + 1 }),
      obs({ deviceId: "dev_a", kind: "engine.temp.error", seq: 3, observedAt: NOW + 2 }),
    ];
    const r = triage(inputs, NOW);
    expect(r.findings[0]?.deviceId).toBe("dev_a");
    expect(r.findings[0]?.severity).toBe("critical");
    expect(r.findings[1]?.deviceId).toBe("dev_b");
    expect(r.findings[1]?.severity).toBe("info");
  });
});

describe("health: triage immutability", () => {
  it("does not mutate input observations array", () => {
    const inputs = [obs({ kind: "engine.temp.ok", seq: 1 })];
    const frozen = [...inputs];
    triage(inputs, NOW);
    expect(inputs).toEqual(frozen);
  });
  it("findings evidence references the source payloadDigest", () => {
    const o = obs({ kind: "engine.temp.error", seq: 1 });
    const r = triage([o], NOW);
    expect(r.findings[0]?.evidence[0]?.digest).toBe(o.payloadDigest);
    expect(r.findings[0]?.evidence[0]?.kind).toBe(o.kind);
  });
});
