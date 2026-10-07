/**
 * @fleetos/health — Wave 0 contracts.
 *
 * Pure TypeScript domain contracts ONLY. No I/O, no servers, no databases.
 *
 * Owns (per spec/BOUNDED-CONTEXTS.md "Health"):
 *   - health signals;
 *   - diagnosis hypotheses;
 *   - diagnosis records;
 *   - treatment recommendations (out of scope in Wave 0 — typed here).
 *
 * Architecture laws:
 *   - A3: observations are immutable inputs; derived diagnoses are versioned;
 *   - A11: OBSERVED/PREDICTED/HYPOTHETICAL are distinct;
 *   - A12: deterministic reference path;
 *   - A18: System 1 (fast detection/triage/near-term prediction).
 *
 * The triage() function is a deterministic System-1 reference: it consumes
 * immutable observations and produces Findings with stable severity. It
 * degrades honestly — when there is insufficient data to support a finding,
 * it returns an `insufficient-data` degradation rather than fabricating
 * conclusions.
 *
 * Cross-worker seam: uses structural `ObservationLike`, `DeviceIdLike`,
 * `TenantIdLike`, `EvidenceRefLike` instead of importing sibling packages.
 */

// ---------------------------------------------------------------------------
// Structural seam types
// ---------------------------------------------------------------------------

export type DeviceIdLike = string;
export type TenantIdLike = string;

export interface ObservationLike {
  readonly tenantId: TenantIdLike;
  readonly deviceId: DeviceIdLike;
  readonly seq: number;
  readonly observedAt: number;
  readonly kind: string;
  readonly payloadDigest: string;
}

export interface EvidenceRefLike {
  readonly digest: string;
  readonly kind?: string;
  readonly observedAt?: number;
}

// ---------------------------------------------------------------------------
// HealthSignal — derived (not raw observation), but immutable once emitted.
// ---------------------------------------------------------------------------

export type Severity = "info" | "warning" | "critical";

export interface HealthSignal {
  readonly deviceId: DeviceIdLike;
  readonly observedAt: number;
  readonly kind: string;
  readonly severity: Severity;
  readonly evidence: ReadonlyArray<EvidenceRefLike>;
}

// ---------------------------------------------------------------------------
// Finding — machine-stable, derived from signals; references evidence.
// ---------------------------------------------------------------------------

export interface Finding {
  readonly deviceId: DeviceIdLike;
  readonly code: string;
  readonly severity: Severity;
  readonly observedAt: number;
  readonly evidence: ReadonlyArray<EvidenceRefLike>;
}

// ---------------------------------------------------------------------------
// Diagnosis — hypothesis (A11 HYPOTHETICAL) vs record (A11 OBSERVED).
// ---------------------------------------------------------------------------

export interface DiagnosisHypothesis {
  readonly kind: "hypothesis";
  readonly deviceId: DeviceIdLike;
  readonly candidateCauses: ReadonlyArray<string>;
  readonly confidence: number; // 0..1
  readonly evidence: ReadonlyArray<EvidenceRefLike>;
  readonly emittedAt: number;
}

export interface DiagnosisRecord {
  readonly kind: "record";
  readonly deviceId: DeviceIdLike;
  readonly rootCause: string;
  readonly evidence: ReadonlyArray<EvidenceRefLike>;
  readonly confirmedAt: number;
}

export type Diagnosis = DiagnosisHypothesis | DiagnosisRecord;

// ---------------------------------------------------------------------------
// triage — pure deterministic System-1 reference.
//
// Rules:
//   - kind ending in ".error" or ".fault" -> warning; >=3 occurrences escalates to critical.
//   - kind ending in ".warn"               -> warning.
//   - kind ending in ".ok"                 -> info.
//   - any other kind: insufficient signal vocabulary; returns degradation.
//   - fewer than `MIN_SIGNALS_PER_DEVICE` observations for a device -> degrade.
// ---------------------------------------------------------------------------

export type TriageDegradation = "insufficient-data" | "unknown-signal-vocabulary";

export interface TriageResult {
  readonly findings: ReadonlyArray<Finding>;
  readonly degradation: TriageDegradation | null;
  readonly triagedAt: number;
}

const MIN_SIGNALS_PER_DEVICE = 1;
const CRITICAL_THRESHOLD = 3;

function severityFromKind(kind: string): Severity | null {
  if (kind.endsWith(".error") || kind.endsWith(".fault")) return "warning";
  if (kind.endsWith(".warn")) return "warning";
  if (kind.endsWith(".ok")) return "info";
  return null;
}

function escalate(count: number, base: Severity): Severity {
  if (base === "warning" && count >= CRITICAL_THRESHOLD) return "critical";
  return base;
}

function evidenceFromObs(o: ObservationLike): EvidenceRefLike {
  return { digest: o.payloadDigest, kind: o.kind, observedAt: o.observedAt };
}

export function triage(
  observations: ReadonlyArray<ObservationLike>,
  triagedAt: number,
): TriageResult {
  if (observations.length === 0) {
    return { findings: [], degradation: "insufficient-data", triagedAt };
  }

  // Group by (deviceId, kind) so that we can count occurrences.
  const groups = new Map<string, { device: DeviceIdLike; kind: string; obs: ObservationLike[] }>();
  for (const o of observations) {
    const key = `${o.deviceId}:${o.kind}`;
    const existing = groups.get(key);
    if (existing) existing.obs.push(o);
    else groups.set(key, { device: o.deviceId, kind: o.kind, obs: [o] });
  }

  const findings: Finding[] = [];
  let degraded = false;

  for (const group of groups.values()) {
    if (group.obs.length < MIN_SIGNALS_PER_DEVICE) {
      // Defensive: cannot happen because groups are created from observations
      // of size >= 1, but kept explicit.
      degraded = true;
      continue;
    }
    const base = severityFromKind(group.kind);
    if (base === null) {
      // Unknown vocabulary: degrade honestly rather than fabricate severity.
      degraded = true;
      continue;
    }
    const severity = escalate(group.obs.length, base);
    const evidence: EvidenceRefLike[] = group.obs.map(evidenceFromObs);
    const lastObservedAt = group.obs.reduce((acc, o) => Math.max(acc, o.observedAt), 0);
    findings.push({
      deviceId: group.device,
      code: group.kind,
      severity,
      observedAt: lastObservedAt,
      evidence,
    });
  }

  // Sort findings by (severity priority, deviceId) for determinism.
  const sevRank: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
  findings.sort((a, b) => {
    const s = sevRank[a.severity] - sevRank[b.severity];
    if (s !== 0) return s;
    return a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1 : 0;
  });

  return {
    findings,
    degradation: degraded ? "unknown-signal-vocabulary" : null,
    triagedAt,
  };
}
