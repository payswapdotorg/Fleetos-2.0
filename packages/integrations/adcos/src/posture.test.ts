/**
 * @fleetos/adcos — Wave 2 posture tests (F220A).
 */

import { describe, it, expect } from "vitest";
import {
  circuitBreakerDecide,
  classifyPosture,
  defaultPostureThresholds,
  emptyProviderPosture,
  honestAdcosHealth,
  recordFailure,
  recordSuccess,
  type ProviderPostureState,
} from "./posture.js";

const NOW = 1_727_000_000_000;

describe("adcos posture: classification", () => {
  const thresholds = defaultPostureThresholds();

  it("classifies an empty posture as healthy", () => {
    expect(classifyPosture(emptyProviderPosture(), thresholds, NOW)).toBe("healthy");
  });

  it("classifies a posture with 2 failures as degraded", () => {
    let s: ProviderPostureState = emptyProviderPosture();
    s = recordFailure(s, NOW);
    s = recordFailure(s, NOW + 1);
    expect(classifyPosture(s, thresholds, NOW + 2)).toBe("degraded");
  });

  it("classifies a posture with 5 failures as unavailable", () => {
    let s: ProviderPostureState = emptyProviderPosture();
    for (let i = 0; i < 5; i++) s = recordFailure(s, NOW + i);
    expect(classifyPosture(s, thresholds, NOW + 100)).toBe("unavailable");
  });

  it("classifies a posture with 1 failure as healthy (still under degradedAfterFailures)", () => {
    let s: ProviderPostureState = emptyProviderPosture();
    s = recordFailure(s, NOW);
    expect(classifyPosture(s, thresholds, NOW + 1)).toBe("healthy");
  });

  it("recordSuccess resets consecutive failures", () => {
    let s: ProviderPostureState = emptyProviderPosture();
    s = recordFailure(s, NOW);
    s = recordFailure(s, NOW + 1);
    s = recordSuccess(s, NOW + 2);
    expect(s.consecutiveFailures).toBe(0);
    expect(s.consecutiveSuccesses).toBe(1);
  });

  it("recordFailure resets consecutive successes", () => {
    let s: ProviderPostureState = emptyProviderPosture();
    s = recordSuccess(s, NOW);
    s = recordSuccess(s, NOW + 1);
    s = recordFailure(s, NOW + 2);
    expect(s.consecutiveSuccesses).toBe(0);
    expect(s.consecutiveFailures).toBe(1);
  });

  it("classifies a posture as unavailable when lastSuccess is too old AND lastFailure exists", () => {
    let s: ProviderPostureState = emptyProviderPosture();
    s = recordSuccess(s, NOW - 70_000); // 70 seconds ago — beyond 60s threshold
    s = recordFailure(s, NOW - 50_000); // recent failure
    // 70s since lastSuccess, recent failure — should be unavailable.
    expect(classifyPosture(s, thresholds, NOW, 60_000)).toBe("unavailable");
  });

  it("does not classify as unavailable if lastSuccess is recent (no failures)", () => {
    let s: ProviderPostureState = emptyProviderPosture();
    s = recordSuccess(s, NOW - 1000); // 1 second ago
    expect(classifyPosture(s, thresholds, NOW, 60_000)).toBe("healthy");
  });
});

describe("adcos posture: honest health vocabulary", () => {
  it("maps postures to health without exaggeration", () => {
    expect(honestAdcosHealth("healthy")).toBe("healthy");
    expect(honestAdcosHealth("degraded")).toBe("degraded");
    expect(honestAdcosHealth("unavailable")).toBe("unavailable");
  });
});

describe("adcos posture: circuit breaker", () => {
  it("opens the circuit when posture is unavailable", () => {
    const r = circuitBreakerDecide("unavailable");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("circuit-open");
    expect(r.posture).toBe("unavailable");
  });

  it("allows when posture is healthy", () => {
    expect(circuitBreakerDecide("healthy").ok).toBe(true);
  });

  it("allows when posture is degraded (degraded is allowed — caller may attempt)", () => {
    expect(circuitBreakerDecide("degraded").ok).toBe(true);
  });

  it("returns the posture in the decision so callers can record it", () => {
    const r = circuitBreakerDecide("degraded");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.posture).toBe("degraded");
  });
});

describe("adcos posture: thresholds", () => {
  it("defaultPostureThresholds has degradedAfterFailures < unavailableAfterFailures", () => {
    const t = defaultPostureThresholds();
    expect(t.degradedAfterFailures).toBeGreaterThan(0);
    expect(t.unavailableAfterFailures).toBeGreaterThan(t.degradedAfterFailures);
  });
});

describe("adcos posture: deterministic", () => {
  it("classifyPosture is deterministic for identical inputs", () => {
    const t = defaultPostureThresholds();
    let s = emptyProviderPosture();
    s = recordFailure(s, NOW);
    s = recordFailure(s, NOW + 1);
    const a = classifyPosture(s, t, NOW + 2);
    const b = classifyPosture(s, t, NOW + 2);
    expect(a).toBe(b);
  });

  it("recordSuccess and recordFailure are deterministic", () => {
    let a = emptyProviderPosture();
    let b = emptyProviderPosture();
    a = recordFailure(a, NOW);
    a = recordSuccess(a, NOW + 1);
    b = recordFailure(b, NOW);
    b = recordSuccess(b, NOW + 1);
    expect(a).toEqual(b);
  });
});
