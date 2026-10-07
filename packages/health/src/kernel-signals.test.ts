/**
 * @fleetos/health — Wave 2 signal-grade tests (F220A).
 *
 * Covers:
 *   - Rolling windows over admitted observations (count, mean, min, max)
 *   - Anomaly thresholds with hysteresis (no flap-flopping)
 *   - Diagnosis confidence propagation rules
 */

import { describe, it, expect } from "vitest";
import type { ObservationLike } from "./health.js";
import type { DiagnosisHypothesisRecord } from "./kernel.js";
import {
  anomalyTransitionAudit,
  buildRollingWindowFromObservations,
  defaultConfidenceRules,
  emptyAnomalyState,
  emptyRollingWindow,
  evaluateAnomaly,
  propagateConfidence,
  pushToWindow,
  runAnomalyDetection,
  windowStats,
  type EvidenceWithKind,
  type HysteresisThreshold,
} from "./kernel-signals.js";

const NOW = 1_727_000_000_000;
const DEV1 = "dev_truck-001";
const TENANT_A = "tnt_acme";

function obs(seq: number, kind: string, payload: Record<string, unknown>, observedAt?: number): ObservationLike {
  return {
    tenantId: TENANT_A,
    deviceId: DEV1,
    seq,
    observedAt: observedAt ?? NOW + seq * 1000,
    kind,
    payloadDigest: `dg_${seq}`,
  };
}

// ---------------------------------------------------------------------------
// Rolling window.
// ---------------------------------------------------------------------------

describe("health signals: rolling window", () => {
  it("empty window returns zero-count stats", () => {
    const w = emptyRollingWindow(5);
    const s = windowStats(w);
    expect(s.count).toBe(0);
    expect(s.mean).toBe(0);
    expect(s.first).toBeNull();
    expect(s.last).toBeNull();
  });

  it("push adds a value and updates stats", () => {
    const w = pushToWindow(emptyRollingWindow(5), 10, NOW);
    const s = windowStats(w);
    expect(s.count).toBe(1);
    expect(s.mean).toBe(10);
    expect(s.min).toBe(10);
    expect(s.max).toBe(10);
    expect(s.first).toBe(10);
    expect(s.last).toBe(10);
  });

  it("window evicts oldest when full (sliding window)", () => {
    let w = emptyRollingWindow(3);
    w = pushToWindow(w, 1, NOW);
    w = pushToWindow(w, 2, NOW + 1);
    w = pushToWindow(w, 3, NOW + 2);
    w = pushToWindow(w, 4, NOW + 3); // evicts 1
    expect(w.values).toEqual([2, 3, 4]);
    expect(w.timestamps).toEqual([NOW + 1, NOW + 2, NOW + 3]);
  });

  it("windowStats computes mean, min, max correctly over a populated window", () => {
    let w = emptyRollingWindow(10);
    for (const v of [10, 20, 30, 40, 50]) w = pushToWindow(w, v, NOW + v);
    const s = windowStats(w);
    expect(s.count).toBe(5);
    expect(s.mean).toBe(30);
    expect(s.min).toBe(10);
    expect(s.max).toBe(50);
    expect(s.first).toBe(10);
    expect(s.last).toBe(50);
  });

  it("buildRollingWindowFromObservations extracts values via the provided extractor", () => {
    const observations: ObservationLike[] = [
      obs(1, "telemetry.temp", { temp: 90 }),
      obs(2, "telemetry.temp", { temp: 95 }),
      obs(3, "telemetry.temp", { temp: 92 }),
    ];
    const w = buildRollingWindowFromObservations(observations, 10, (o) => {
      // Extractor returns null for non-temp observations.
      if (!o.kind.startsWith("telemetry.temp")) return null;
      // The observation's payload is not part of the ObservationLike shape
      // (it lives in the Observation from @fleetos/observations). The
      // health kernel reads only the digest. For testing, we use the seq
      // as a stand-in for "the extracted value" — verifying the window
      // mechanics, not the extraction itself.
      return o.seq;
    });
    expect(windowStats(w).count).toBe(3);
    expect(windowStats(w).mean).toBe(2);
  });

  it("buildRollingWindowFromObservations orders by observedAt ascending", () => {
    const observations: ObservationLike[] = [
      obs(3, "telemetry.temp", {}, NOW + 3000),
      obs(1, "telemetry.temp", {}, NOW + 1000),
      obs(2, "telemetry.temp", {}, NOW + 2000),
    ];
    const w = buildRollingWindowFromObservations(observations, 10, (o) => o.seq);
    expect(w.values).toEqual([1, 2, 3]);
  });

  it("buildRollingWindowFromObservations skips null extractions", () => {
    const observations: ObservationLike[] = [
      obs(1, "telemetry.temp", {}),
      obs(2, "telemetry.humid", {}),
      obs(3, "telemetry.temp", {}),
    ];
    const w = buildRollingWindowFromObservations(observations, 10, (o) => {
      if (!o.kind.startsWith("telemetry.temp")) return null;
      return o.seq;
    });
    expect(windowStats(w).count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Anomaly detection with hysteresis — no flap-flopping.
// ---------------------------------------------------------------------------

describe("health signals: anomaly hysteresis", () => {
  const threshold: HysteresisThreshold = { enterThreshold: 100, exitThreshold: 90 };

  it("enters anomaly when value exceeds enterThreshold", () => {
    const s = evaluateAnomaly(emptyAnomalyState(), 110, threshold, NOW);
    expect(s.anomaly).toBe(true);
    expect(s.transitionCount).toBe(1);
    expect(s.enteredAt).toBe(NOW);
  });

  it("does NOT enter anomaly when value is between exit and enter thresholds", () => {
    const s = evaluateAnomaly(emptyAnomalyState(), 95, threshold, NOW);
    expect(s.anomaly).toBe(false);
    expect(s.transitionCount).toBe(0);
  });

  it("does NOT exit anomaly when value is between exit and enter thresholds (no flap)", () => {
    // First, enter anomaly.
    let s = evaluateAnomaly(emptyAnomalyState(), 110, threshold, NOW);
    expect(s.anomaly).toBe(true);
    // Then, value falls to 95 (between exit=90 and enter=100). Anomaly holds.
    s = evaluateAnomaly(s, 95, threshold, NOW + 1);
    expect(s.anomaly).toBe(true); // still in anomaly — no flap
    expect(s.transitionCount).toBe(1); // only the original enter transition
  });

  it("exits anomaly when value falls below exitThreshold", () => {
    let s = evaluateAnomaly(emptyAnomalyState(), 110, threshold, NOW);
    s = evaluateAnomaly(s, 85, threshold, NOW + 1);
    expect(s.anomaly).toBe(false);
    expect(s.transitionCount).toBe(2); // enter + exit
    expect(s.exitedAt).toBe(NOW + 1);
  });

  it("does not flap when value oscillates between 95 and 105 (between thresholds)", () => {
    let s = emptyAnomalyState();
    // 95 (no anomaly) -> 105 (enter) -> 95 (still in anomaly) -> 105 (still in) -> 95 (still in)
    // Without hysteresis: 95 (no), 105 (yes), 95 (no), 105 (yes), 95 (no) -> 4 transitions.
    // With hysteresis: 95 (no), 105 (yes), 95 (yes), 105 (yes), 95 (yes) -> 1 transition.
    s = evaluateAnomaly(s, 95, threshold, NOW);
    s = evaluateAnomaly(s, 105, threshold, NOW + 1);
    s = evaluateAnomaly(s, 95, threshold, NOW + 2);
    s = evaluateAnomaly(s, 105, threshold, NOW + 3);
    s = evaluateAnomaly(s, 95, threshold, NOW + 4);
    expect(s.anomaly).toBe(true);
    expect(s.transitionCount).toBe(1); // ONLY the enter — no flap-flopping
  });

  it("flap count without hysteresis (synthetic) is higher than with hysteresis", () => {
    // Run the same series with and without hysteresis (synthetic comparison).
    const values = [
      { value: 95, at: NOW },
      { value: 105, at: NOW + 1 },
      { value: 95, at: NOW + 2 },
      { value: 105, at: NOW + 3 },
      { value: 95, at: NOW + 4 },
      { value: 105, at: NOW + 5 },
    ];
    // With hysteresis (enter=100, exit=90).
    const withHyst = runAnomalyDetection(values, threshold);
    // Without hysteresis — tight 1-unit band (enter=100, exit=99) so every
    // oscillation across 100/99 is a transition.
    const noHyst = runAnomalyDetection(values, { enterThreshold: 100, exitThreshold: 99 });
    expect(withHyst.flapCount).toBeLessThan(noHyst.flapCount);
    expect(withHyst.flapCount).toBe(1);
    expect(noHyst.flapCount).toBeGreaterThan(1);
  });

  it("misconfigured threshold (enter <= exit) is treated as no-op", () => {
    const bad: HysteresisThreshold = { enterThreshold: 90, exitThreshold: 100 };
    const s = evaluateAnomaly(emptyAnomalyState(), 95, bad, NOW);
    expect(s.anomaly).toBe(false);
    expect(s.transitionCount).toBe(0);
  });

  it("lastValue is updated even when no transition occurs", () => {
    let s = emptyAnomalyState();
    s = evaluateAnomaly(s, 50, threshold, NOW);
    expect(s.lastValue).toBe(50);
    s = evaluateAnomaly(s, 60, threshold, NOW + 1);
    expect(s.lastValue).toBe(60);
    expect(s.anomaly).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Diagnosis confidence propagation.
// ---------------------------------------------------------------------------

describe("health signals: diagnosis confidence propagation", () => {
  function hypothesis(confidence: number, evidenceCount: number = 0): DiagnosisHypothesisRecord {
    return {
      id: "hyp_test",
      tenantId: TENANT_A,
      deviceId: DEV1,
      state: "proposed",
      candidateCauses: ["cause-a"],
      confidence,
      evidence: Array.from({ length: evidenceCount }, (_, i) => ({
        digest: `dg_${i}`,
        kind: "telemetry.temp",
        observedAt: NOW + i,
      })),
      emittedAt: NOW,
      supersededBy: null,
      supersedes: null,
      transitionSeq: 1,
    };
  }

  it("corroborating evidence increases confidence (above minCorroboration)", () => {
    const rules = defaultConfidenceRules();
    const h = hypothesis(0.3, 2); // already past minCorroboration=2
    const newEvidence: EvidenceWithKind[] = [
      { digest: "dg_new1", evidenceKind: "corroborating" },
      { digest: "dg_new2", evidenceKind: "corroborating" },
    ];
    const r = propagateConfidence(h, newEvidence, rules);
    expect(r.confidence).toBeCloseTo(0.3 + 2 * rules.corroborationStep, 5);
    expect(r.corroborations).toBe(2);
    expect(r.contradictions).toBe(0);
  });

  it("confidence is capped at maxConfidence (1.0)", () => {
    const rules = defaultConfidenceRules();
    const h = hypothesis(0.95, 5);
    const newEvidence: EvidenceWithKind[] = [
      { digest: "dg_new1", evidenceKind: "corroborating" },
      { digest: "dg_new2", evidenceKind: "corroborating" },
    ];
    const r = propagateConfidence(h, newEvidence, rules);
    expect(r.confidence).toBe(1.0);
  });

  it("contradicting evidence decreases confidence", () => {
    const rules = defaultConfidenceRules();
    const h = hypothesis(0.7, 3);
    const newEvidence: EvidenceWithKind[] = [
      { digest: "dg_new1", evidenceKind: "contradicting" },
    ];
    const r = propagateConfidence(h, newEvidence, rules);
    expect(r.confidence).toBeCloseTo(0.7 - rules.contradictionStep, 5);
    expect(r.contradictions).toBe(1);
  });

  it("confidence is floored at minConfidence (0.0)", () => {
    const rules = defaultConfidenceRules();
    const h = hypothesis(0.1, 0);
    const newEvidence: EvidenceWithKind[] = [
      { digest: "dg_new1", evidenceKind: "contradicting" },
      { digest: "dg_new2", evidenceKind: "contradicting" },
    ];
    const r = propagateConfidence(h, newEvidence, rules);
    expect(r.confidence).toBe(0.0);
  });

  it("corroboration does NOT increase confidence below minCorroboration threshold", () => {
    const rules = defaultConfidenceRules();
    const h = hypothesis(0.3, 0); // 0 prior evidence; minCorroboration=2
    const newEvidence: EvidenceWithKind[] = [
      { digest: "dg_new1", evidenceKind: "corroborating" },
    ];
    const r = propagateConfidence(h, newEvidence, rules);
    // Only 1 corroborating piece — below minCorroboration=2.
    expect(r.confidence).toBe(0.3); // unchanged
    expect(r.corroborations).toBe(1);
  });

  it("neutral evidence does not change confidence", () => {
    const rules = defaultConfidenceRules();
    const h = hypothesis(0.5, 3);
    const newEvidence: EvidenceWithKind[] = [
      { digest: "dg_new1", evidenceKind: "neutral" },
    ];
    const r = propagateConfidence(h, newEvidence, rules);
    expect(r.confidence).toBe(0.5);
    expect(r.corroborations).toBe(0);
    expect(r.contradictions).toBe(0);
  });

  it("mixed evidence (corroborating + contradicting) yields a net change", () => {
    const rules = defaultConfidenceRules();
    const h = hypothesis(0.5, 3);
    const newEvidence: EvidenceWithKind[] = [
      { digest: "dg_new1", evidenceKind: "corroborating" },
      { digest: "dg_new2", evidenceKind: "corroborating" },
      { digest: "dg_new3", evidenceKind: "contradicting" },
    ];
    const r = propagateConfidence(h, newEvidence, rules);
    expect(r.corroborations).toBe(2);
    expect(r.contradictions).toBe(1);
    // Net: +2*0.15 - 1*0.2 = +0.1
    expect(r.confidence).toBeCloseTo(0.5 + 2 * rules.corroborationStep - rules.contradictionStep, 5);
  });
});

// ---------------------------------------------------------------------------
// Anomaly transition audit.
// ---------------------------------------------------------------------------

describe("health signals: anomaly transition audit", () => {
  const threshold: HysteresisThreshold = { enterThreshold: 100, exitThreshold: 90 };

  it("returns null when no transition occurs", () => {
    const s1 = emptyAnomalyState();
    const s2 = evaluateAnomaly(s1, 95, threshold, NOW); // no transition
    const a = anomalyTransitionAudit(DEV1, TENANT_A, s1, s2, NOW);
    expect(a).toBeNull();
  });

  it("emits an audit when the anomaly flag transitions to true (entered)", () => {
    const s1 = emptyAnomalyState();
    const s2 = evaluateAnomaly(s1, 110, threshold, NOW);
    const a = anomalyTransitionAudit(DEV1, TENANT_A, s1, s2, NOW);
    expect(a).not.toBeNull();
    expect(a!.intent).toBe("health:anomaly:entered");
    expect(a!.tenant).toBe(TENANT_A);
  });

  it("emits an audit when the anomaly flag transitions to false (exited)", () => {
    let s = emptyAnomalyState();
    s = evaluateAnomaly(s, 110, threshold, NOW);
    const s2 = evaluateAnomaly(s, 80, threshold, NOW + 1);
    const a = anomalyTransitionAudit(DEV1, TENANT_A, s, s2, NOW + 1);
    expect(a).not.toBeNull();
    expect(a!.intent).toBe("health:anomaly:exited");
  });
});
