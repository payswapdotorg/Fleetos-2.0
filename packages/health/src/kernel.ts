/**
 * @fleetos/health — Wave 1 kernel (F210A).
 *
 * Diagnosis kernel:
 *   - Triage over admitted observations with confidence + insufficient-data
 *     degradation (Wave 0 baseline extended with confidence scoring).
 *   - Diagnosis hypothesis lifecycle (proposed -> corroborated -> resolved/
 *     superseded) with supersession discipline: a superseded diagnosis is
 *     never mutated — a new record supersedes the prior, carrying the
 *     prior's id in `supersedes`.
 *
 * The DiagnosisRegistry helpers live in `kernel-registry.ts`.
 * AuditEventRef + digestOf live in `kernel-audit.ts`.
 *
 * Pure TypeScript over injected PORT interfaces. No I/O, no servers, no
 * databases. Persistence lands at F211 (TL lane).
 */

import type {
  DeviceIdLike,
  EvidenceRefLike,
  Finding,
  ObservationLike,
  Severity,
  TriageDegradation,
} from "./health.js";

// Re-export the audit + registry primitives so consumers have a single entry.
export * from "./kernel-audit.js";
export * from "./kernel-registry.js";
import type { AuditEventRef } from "./kernel-audit.js";
import { digestOf } from "./kernel-audit.js";

// ---------------------------------------------------------------------------
// Enhanced triage with confidence scores.
// ---------------------------------------------------------------------------

export interface FindingWithConfidence extends Finding {
  readonly confidence: number; // 0..1
}

export interface TriageWithConfidenceResult {
  readonly findings: ReadonlyArray<FindingWithConfidence>;
  readonly degradation: TriageDegradation | null;
  readonly triagedAt: number;
  readonly audit: AuditEventRef;
}

const MIN_SIGNALS_PER_DEVICE = 1;
const CRITICAL_THRESHOLD = 3;
const MAX_CONFIDENCE_OBSERVATIONS = 5;

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

function confidenceFromCount(count: number): number {
  if (count <= 0) return 0;
  if (count >= MAX_CONFIDENCE_OBSERVATIONS) return 1;
  return count / MAX_CONFIDENCE_OBSERVATIONS;
}

export function triageWithConfidence(
  observations: ReadonlyArray<ObservationLike>,
  triagedAt: number,
  tenantId: string,
): TriageWithConfidenceResult {
  if (observations.length === 0) {
    const audit: AuditEventRef = {
      actor: "system:triage",
      intent: "triage:degraded:insufficient-data",
      tenant: tenantId,
      timestamp: triagedAt,
      digest: digestOf("triage", triagedAt, "insufficient-data"),
    };
    return { findings: [], degradation: "insufficient-data", triagedAt, audit };
  }

  const groups = new Map<string, { device: DeviceIdLike; kind: string; obs: ObservationLike[] }>();
  for (const o of observations) {
    const key = `${o.deviceId}:${o.kind}`;
    const existing = groups.get(key);
    if (existing) existing.obs.push(o);
    else groups.set(key, { device: o.deviceId, kind: o.kind, obs: [o] });
  }

  const findings: FindingWithConfidence[] = [];
  let degraded = false;

  for (const group of groups.values()) {
    if (group.obs.length < MIN_SIGNALS_PER_DEVICE) {
      degraded = true;
      continue;
    }
    const base = severityFromKind(group.kind);
    if (base === null) {
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
      confidence: confidenceFromCount(group.obs.length),
    });
  }

  const sevRank: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
  findings.sort((a, b) => {
    const s = sevRank[a.severity] - sevRank[b.severity];
    if (s !== 0) return s;
    return a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1 : 0;
  });

  const audit: AuditEventRef = {
    actor: "system:triage",
    intent: degraded ? "triage:degraded:unknown-vocabulary" : "triage:complete",
    tenant: tenantId,
    timestamp: triagedAt,
    digest: digestOf("triage", triagedAt, findings.length, degraded ? 1 : 0),
  };

  return {
    findings,
    degradation: degraded ? "unknown-signal-vocabulary" : null,
    triagedAt,
    audit,
  };
}

// ---------------------------------------------------------------------------
// Diagnosis hypothesis lifecycle: proposed -> corroborated -> resolved/
// superseded.
// ---------------------------------------------------------------------------

export type DiagnosisState =
  | "proposed"
  | "corroborated"
  | "resolved"
  | "superseded";

export type DiagnosisCommandKind =
  | "corroborate"
  | "resolve"
  | "supersede";

export interface DiagnosisCommand {
  readonly kind: DiagnosisCommandKind;
  readonly reason?: string;
  readonly newCandidateCauses?: ReadonlyArray<string>;
  readonly newEvidence?: ReadonlyArray<EvidenceRefLike>;
  readonly at: number;
  readonly actor: string;
}

export type DiagnosisRejectionCode =
  | "illegal-transition"
  | "already-in-target-state"
  | "unknown-command"
  | "missing-reason"
  | "missing-evidence";

export type DiagnosisTransitionResult =
  | {
      readonly ok: true;
      readonly from: DiagnosisState;
      readonly to: DiagnosisState;
      readonly next: DiagnosisHypothesisRecord;
      readonly audit: AuditEventRef;
    }
  | { readonly ok: false; readonly reason: DiagnosisRejectionCode };

const DIAGNOSIS_TRANSITIONS: Readonly<Record<
  DiagnosisState,
  Partial<Record<DiagnosisCommandKind, DiagnosisState>>
>> = {
  proposed: { corroborate: "corroborated", resolve: "resolved", supersede: "superseded" },
  corroborated: { resolve: "resolved", supersede: "superseded" },
  resolved: { supersede: "superseded" },
  superseded: {},
};

export interface DiagnosisHypothesisRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly deviceId: DeviceIdLike;
  readonly state: DiagnosisState;
  readonly candidateCauses: ReadonlyArray<string>;
  readonly confidence: number;
  readonly evidence: ReadonlyArray<EvidenceRefLike>;
  readonly emittedAt: number;
  readonly supersededBy: string | null;
  readonly supersedes: string | null;
  readonly transitionSeq: number;
}

export function proposeDiagnosis(input: {
  readonly id: string;
  readonly tenantId: string;
  readonly deviceId: DeviceIdLike;
  readonly candidateCauses: ReadonlyArray<string>;
  readonly confidence: number;
  readonly evidence: ReadonlyArray<EvidenceRefLike>;
  readonly emittedAt: number;
  readonly actor: string;
  readonly supersedes?: string | null;
}):
  | { readonly ok: true; readonly hypothesis: DiagnosisHypothesisRecord; readonly audit: AuditEventRef }
  | { readonly ok: false; readonly reason: DiagnosisRejectionCode } {
  if (input.id === "") return { ok: false, reason: "unknown-command" };
  if (input.tenantId === "") return { ok: false, reason: "unknown-command" };
  if (input.candidateCauses.length === 0) return { ok: false, reason: "missing-reason" };
  if (input.evidence.length === 0) return { ok: false, reason: "missing-evidence" };
  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
    return { ok: false, reason: "unknown-command" };
  }
  const hypothesis: DiagnosisHypothesisRecord = {
    id: input.id,
    tenantId: input.tenantId,
    deviceId: input.deviceId,
    state: "proposed",
    candidateCauses: input.candidateCauses,
    confidence: input.confidence,
    evidence: input.evidence,
    emittedAt: input.emittedAt,
    supersededBy: null,
    supersedes: input.supersedes ?? null,
    transitionSeq: 1,
  };
  const audit: AuditEventRef = {
    actor: input.actor,
    intent: "diagnosis:propose",
    tenant: input.tenantId,
    timestamp: input.emittedAt,
    digest: digestOf(input.id, "propose", 1, input.emittedAt),
  };
  return { ok: true, hypothesis, audit };
}

export function applyDiagnosisCommand(
  current: DiagnosisHypothesisRecord,
  command: DiagnosisCommand,
): DiagnosisTransitionResult {
  const known: ReadonlyArray<DiagnosisCommandKind> = ["corroborate", "resolve", "supersede"];
  if (!known.includes(command.kind)) return { ok: false, reason: "unknown-command" };

  if (command.kind === "resolve") {
    if (!command.newEvidence || command.newEvidence.length === 0) {
      return { ok: false, reason: "missing-evidence" };
    }
  }

  const next = DIAGNOSIS_TRANSITIONS[current.state]?.[command.kind];
  if (next === undefined) {
    if (
      (command.kind === "resolve" && current.state === "resolved") ||
      (command.kind === "supersede" && current.state === "superseded")
    ) {
      return { ok: false, reason: "already-in-target-state" };
    }
    return { ok: false, reason: "illegal-transition" };
  }

  const nextSeq = current.transitionSeq + 1;
  const updated: DiagnosisHypothesisRecord = {
    ...current,
    state: next,
    evidence: command.newEvidence && command.newEvidence.length > 0 ? [...current.evidence, ...command.newEvidence] : current.evidence,
    emittedAt: command.at,
    transitionSeq: nextSeq,
  };
  const audit: AuditEventRef = {
    actor: command.actor,
    intent: `diagnosis:${command.kind}`,
    tenant: current.tenantId,
    timestamp: command.at,
    digest: digestOf(current.id, command.kind, nextSeq, command.at),
  };
  return { ok: true, from: current.state, to: next, next: updated, audit };
}

// ---------------------------------------------------------------------------
// Supersession — a new diagnosis record supersedes the prior. The prior
// record is NEVER mutated; only its `supersededBy` pointer is set (which is
// a separate, audited transition).
// ---------------------------------------------------------------------------

export type SupersessionResult =
  | {
      readonly ok: true;
      readonly prior: DiagnosisHypothesisRecord;
      readonly successor: DiagnosisHypothesisRecord;
      readonly audit: AuditEventRef;
    }
  | { readonly ok: false; readonly reason: DiagnosisRejectionCode };

export function supersedeDiagnosis(input: {
  readonly prior: DiagnosisHypothesisRecord;
  readonly successorId: string;
  readonly candidateCauses: ReadonlyArray<string>;
  readonly confidence: number;
  readonly evidence: ReadonlyArray<EvidenceRefLike>;
  readonly at: number;
  readonly actor: string;
}): SupersessionResult {
  if (input.prior.state === "superseded") {
    return { ok: false, reason: "already-in-target-state" };
  }
  const propose = proposeDiagnosis({
    id: input.successorId,
    tenantId: input.prior.tenantId,
    deviceId: input.prior.deviceId,
    candidateCauses: input.candidateCauses,
    confidence: input.confidence,
    evidence: input.evidence,
    emittedAt: input.at,
    actor: input.actor,
    supersedes: input.prior.id,
  });
  if (!propose.ok) return { ok: false, reason: "missing-evidence" };

  const priorNext: DiagnosisHypothesisRecord = {
    ...input.prior,
    state: "superseded",
    supersededBy: input.successorId,
    transitionSeq: input.prior.transitionSeq + 1,
  };
  const audit: AuditEventRef = {
    actor: input.actor,
    intent: "diagnosis:supersede",
    tenant: input.prior.tenantId,
    timestamp: input.at,
    digest: digestOf(input.prior.id, input.successorId, "supersede", input.at),
  };
  return { ok: true, prior: priorNext, successor: propose.hypothesis, audit };
}
