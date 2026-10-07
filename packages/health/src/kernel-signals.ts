/**
 * @fleetos/health — Wave 2 signal-grade health (F220A).
 *
 *   - Rolling windows over admitted observations — a fixed-size window that
 *     slides over the observation timeline and maintains aggregate stats
 *     (count, mean, min, max) without buffering the entire history.
 *   - Deterministic anomaly thresholds with hysteresis — the threshold to
 *     ENTER anomaly state is higher than the threshold to EXIT. This
 *     prevents flap-flopping: a value hovering near the threshold does not
 *     cause the anomaly flag to oscillate.
 *   - Diagnosis confidence propagation rules — when new evidence is added
 *     to a diagnosis, the confidence is updated according to typed rules.
 *
 * Pure TypeScript. No I/O, no servers, no databases. Persistence lands at
 * F211 (TL lane).
 */

import type { DeviceIdLike, EvidenceRefLike, ObservationLike } from "./health.js";
import type { DiagnosisHypothesisRecord } from "./kernel.js";
import type { AuditEventRef } from "./kernel-audit.js";
import { digestOf } from "./kernel-audit.js";

// ---------------------------------------------------------------------------
// Rolling window — a fixed-size sliding window over a numeric time series.
// The window evicts the oldest values when it exceeds `maxSize`. Pure
// value type — operations return new windows.
// ---------------------------------------------------------------------------

export interface RollingWindow {
  readonly maxSize: number;
  readonly values: ReadonlyArray<number>;
  readonly timestamps: ReadonlyArray<number>;
}

export function emptyRollingWindow(maxSize: number): RollingWindow {
  if (maxSize < 1) throw new RangeError("maxSize must be >= 1");
  return { maxSize, values: [], timestamps: [] };
}

export function pushToWindow(window: RollingWindow, value: number, timestamp: number): RollingWindow {
  const values = [...window.values, value];
  const timestamps = [...window.timestamps, timestamp];
  if (values.length <= window.maxSize) {
    return { ...window, values, timestamps };
  }
  // Evict oldest.
  return { ...window, values: values.slice(values.length - window.maxSize), timestamps: timestamps.slice(timestamps.length - window.maxSize) };
}

export interface WindowStats {
  readonly count: number;
  readonly mean: number;
  readonly min: number;
  readonly max: number;
  readonly first: number | null;
  readonly last: number | null;
}

export function windowStats(window: RollingWindow): WindowStats {
  if (window.values.length === 0) {
    return { count: 0, mean: 0, min: 0, max: 0, first: null, last: null };
  }
  const sum = window.values.reduce((a, b) => a + b, 0);
  const mean = sum / window.values.length;
  const min = window.values.reduce((a, b) => Math.min(a, b), window.values[0]!);
  const max = window.values.reduce((a, b) => Math.max(a, b), window.values[0]!);
  return {
    count: window.values.length,
    mean,
    min,
    max,
    first: window.values[0]!,
    last: window.values[window.values.length - 1]!,
  };
}

// Build a rolling window from a list of observations by extracting a
// numeric field from the observation's payload (the caller provides the
// extractor). The window is ordered by observedAt ascending.
export function buildRollingWindowFromObservations(
  observations: ReadonlyArray<ObservationLike>,
  maxSize: number,
  extractValue: (o: ObservationLike) => number | null,
): RollingWindow {
  const sorted = [...observations].sort((a, b) => a.observedAt - b.observedAt);
  let w = emptyRollingWindow(maxSize);
  for (const o of sorted) {
    const v = extractValue(o);
    if (v === null) continue;
    w = pushToWindow(w, v, o.observedAt);
  }
  return w;
}

// ---------------------------------------------------------------------------
// Anomaly detection with hysteresis — enter threshold > exit threshold.
//
// Without hysteresis, a value that hovers near the threshold causes the
// anomaly flag to flap (on/off/on/off). With hysteresis, the flag transitions
// to ON only when the value exceeds `enterThreshold` AND it transitions to
// OFF only when the value falls below `exitThreshold`. Between the two
// thresholds, the flag holds its current state.
// ---------------------------------------------------------------------------

export interface HysteresisThreshold {
  readonly enterThreshold: number;
  readonly exitThreshold: number;
}

export interface AnomalyState {
  readonly anomaly: boolean;
  readonly lastValue: number | null;
  readonly transitionCount: number;
  readonly enteredAt: number | null;
  readonly exitedAt: number | null;
}

export function emptyAnomalyState(): AnomalyState {
  return { anomaly: false, lastValue: null, transitionCount: 0, enteredAt: null, exitedAt: null };
}

export function evaluateAnomaly(
  state: AnomalyState,
  value: number,
  threshold: HysteresisThreshold,
  at: number,
): AnomalyState {
  if (threshold.enterThreshold <= threshold.exitThreshold) {
    // Misconfiguration: enter must be > exit. Treat as no-op (preserve state).
    return { ...state, lastValue: value };
  }
  if (state.anomaly) {
    // Currently in anomaly — exit only when value falls below exitThreshold.
    if (value < threshold.exitThreshold) {
      return {
        anomaly: false,
        lastValue: value,
        transitionCount: state.transitionCount + 1,
        enteredAt: state.enteredAt,
        exitedAt: at,
      };
    }
    return { ...state, lastValue: value };
  }
  // Not in anomaly — enter only when value exceeds enterThreshold.
  if (value > threshold.enterThreshold) {
    return {
      anomaly: true,
      lastValue: value,
      transitionCount: state.transitionCount + 1,
      enteredAt: at,
      exitedAt: null,
    };
  }
  return { ...state, lastValue: value };
}

// Run anomaly detection over a series of values and return the final state
// + the count of transitions (flap count). A high flap count without
// hysteresis indicates the threshold is poorly calibrated.
export function runAnomalyDetection(
  values: ReadonlyArray<{ readonly value: number; readonly at: number }>,
  threshold: HysteresisThreshold,
): { readonly finalState: AnomalyState; readonly flapCount: number } {
  let state = emptyAnomalyState();
  for (const v of values) {
    state = evaluateAnomaly(state, v.value, threshold, v.at);
  }
  return { finalState: state, flapCount: state.transitionCount };
}

// ---------------------------------------------------------------------------
// Diagnosis confidence propagation — when new evidence is added to a
// diagnosis, the confidence is updated according to typed rules.
//
// Rules:
//   - Each new piece of corroborating evidence increases confidence by a
//     `corroborationStep` (capped at 1.0).
//   - Each new piece of contradicting evidence decreases confidence by a
//     `contradictionStep` (floored at 0.0).
//   - The minimum number of corroborating pieces required before confidence
//     can rise above `baseline` is `minCorroboration`.
// ---------------------------------------------------------------------------

export interface ConfidencePropagationRules {
  readonly baseline: number; // initial confidence (e.g., 0.3)
  readonly corroborationStep: number; // e.g., 0.15
  readonly contradictionStep: number; // e.g., 0.2
  readonly minCorroboration: number; // e.g., 2
  readonly maxConfidence: number; // 1.0
  readonly minConfidence: number; // 0.0
}

export function defaultConfidenceRules(): ConfidencePropagationRules {
  return {
    baseline: 0.3,
    corroborationStep: 0.15,
    contradictionStep: 0.2,
    minCorroboration: 2,
    maxConfidence: 1,
    minConfidence: 0,
  };
}

export type EvidenceKind = "corroborating" | "contradicting" | "neutral";

export interface EvidenceWithKind extends EvidenceRefLike {
  readonly evidenceKind: EvidenceKind;
}

export function propagateConfidence(
  current: DiagnosisHypothesisRecord,
  newEvidence: ReadonlyArray<EvidenceWithKind>,
  rules: ConfidencePropagationRules,
): { readonly confidence: number; readonly corroborations: number; readonly contradictions: number } {
  let corroborations = 0;
  let contradictions = 0;
  for (const e of newEvidence) {
    if (e.evidenceKind === "corroborating") corroborations++;
    else if (e.evidenceKind === "contradicting") contradictions++;
  }
  // Confidence floor: baseline + (corroborations - contradictions) * step,
  // capped at [minConfidence, maxConfidence]. The minCorroboration rule
  // suppresses confidence rise until enough corroboration has accumulated.
  const totalCorroboration = current.evidence.length + corroborations;
  let next = current.confidence;
  if (totalCorroboration >= rules.minCorroboration) {
    next = next + corroborations * rules.corroborationStep;
  }
  next = next - contradictions * rules.contradictionStep;
  if (next > rules.maxConfidence) next = rules.maxConfidence;
  if (next < rules.minConfidence) next = rules.minConfidence;
  return { confidence: next, corroborations, contradictions };
}

// ---------------------------------------------------------------------------
// Health signal-grade audit emission — emits an audit event for an anomaly
// transition. Pure function over the transition pair.
// ---------------------------------------------------------------------------

export function anomalyTransitionAudit(
  deviceId: DeviceIdLike,
  tenantId: string,
  from: AnomalyState,
  to: AnomalyState,
  at: number,
): AuditEventRef | null {
  if (from.anomaly === to.anomaly) return null; // no transition
  const intent = to.anomaly ? "health:anomaly:entered" : "health:anomaly:exited";
  return {
    actor: `system:anomaly:${deviceId}`,
    intent,
    tenant: tenantId,
    timestamp: at,
    digest: digestOf(deviceId, intent, at, to.lastValue ?? 0),
  };
}
