/**
 * @fleetos/security — Finding-storm hardening (F280B, Wave 8 lane B).
 *
 * Dedupe/correlate/triage under finding-volume stress, built ON the REAL
 * intake primitives (`validateCandidate`, `findingDedupeFingerprint`,
 * `findingCorrelationKey`, `escalateSeverity` — unchanged).
 *
 * Laws:
 *  - Deterministic storms: a duplicate storm dedupes to a canonical survivor
 *    set that is IDENTICAL under any arrival permutation — survivors are
 *    keyed by the content fingerprint, never by arrival order.
 *  - Stable correlation: correlation groups are ordered by correlation key,
 *    members by (detectedAt, findingId) — insert order never leaks.
 *  - Honest triage bounds: a triage queue over its bound REFUSES with the
 *    exact counts (`triage.queue-overflow`) — never silently truncates.
 *  - A8 tenant fail-closed: queue building refuses a finding from another
 *    tenant, naming the offender (`storm.tenant-mismatch`).
 *
 * Determinism: no clock, no randomness, no I/O.
 */

import {
  validateCandidate,
  findingDedupeFingerprint,
  findingCorrelationKey,
  escalateSeverity,
} from "./intake.ts";
import type { FindingIntakeCandidate, AdmittedFinding, EscalationRule } from "./intake.ts";
import type { FindingKind, FindingConfidence, SecuritySeverity } from "./index.ts";
import { DEFAULT_ESCALATION_RULES } from "./intake.ts";

// ---------------------------------------------------------------------------
// Storm dedupe — arrival-order independent
// ---------------------------------------------------------------------------

export type StormRefusalCode =
  | "storm.tenant-mismatch"
  | "triage.queue-overflow"
  | "triage.empty-queue";

export interface StormDedupeAck {
  readonly candidateIndex: number;
  readonly ok: boolean;
  /** Refusal reason when refused (validation codes pass through verbatim). */
  readonly reason: string | null;
  /** For duplicates: the surviving finding's id. */
  readonly duplicateOf: string | null;
  readonly admitted: AdmittedFinding | null;
}

export interface StormDedupeResult {
  /** Canonical survivors — sorted by (detectedAt, fingerprint). */
  readonly survivors: readonly AdmittedFinding[];
  readonly acks: readonly StormDedupeAck[];
  readonly metrics: {
    readonly received: number;
    readonly validated: number;
    readonly duplicates: number;
    readonly invalid: number;
    readonly survived: number;
    /** Distinct fingerprint classes in the storm. */
    readonly distinctClasses: number;
  };
}

/**
 * Deterministic duplicate-storm dedupe.
 *
 * Candidates sharing the REAL dedupe fingerprint are one detection class; the
 * class survivor is sealed content-addressedly (the finding id derives from
 * the fingerprint — identical for every member of the class), so the survivor
 * SET is invariant under any permutation of the input (machine-tested).
 */
export function dedupeFindingStorm(
  candidates: readonly FindingIntakeCandidate[],
): StormDedupeResult {
  const acks: StormDedupeAck[] = [];
  const survivors: AdmittedFinding[] = [];
  const seenFingerprints = new Set<string>();
  let validated = 0;
  let invalid = 0;
  let duplicates = 0;

  candidates.forEach((c, index) => {
    const v = validateCandidate(c);
    if (!v.ok) {
      invalid += 1;
      acks.push({ candidateIndex: index, ok: false, reason: v.reason, duplicateOf: null, admitted: null });
      return;
    }
    validated += 1;
    const fingerprint = findingDedupeFingerprint(c);
    if (seenFingerprints.has(fingerprint)) {
      duplicates += 1;
      acks.push({
        candidateIndex: index,
        ok: false,
        reason: "dedupe.duplicate-finding",
        duplicateOf: `finding-${fingerprint}-${String(c.detectedAt)}`,
        admitted: null,
      });
      return;
    }
    seenFingerprints.add(fingerprint);
    const finding: AdmittedFinding = {
      findingId: `finding-${fingerprint}-${String(c.detectedAt)}`,
      tenantId: c.tenantId,
      kind: c.kind as FindingKind,
      severity: c.declaredSeverity as SecuritySeverity,
      confidence: c.confidence as FindingConfidence,
      detectedAt: c.detectedAt,
      assetIds: [...new Set(c.assetIds)].sort(),
      description: c.description,
      evidenceRefs: [...c.evidenceRefs],
      fingerprint,
      correlationKey: findingCorrelationKey(c),
      occurrences: 1,
      escalated: false,
      declaredSeverity: c.declaredSeverity as SecuritySeverity,
      degraded: false,
    };
    survivors.push(finding);
    acks.push({ candidateIndex: index, ok: true, reason: null, duplicateOf: null, admitted: finding });
  });

  const ordered = [...survivors].sort((a, b) =>
    a.detectedAt - b.detectedAt || (a.fingerprint < b.fingerprint ? -1 : 1),
  );
  return {
    survivors: ordered,
    acks,
    metrics: {
      received: candidates.length,
      validated,
      duplicates,
      invalid,
      survived: ordered.length,
      distinctClasses: seenFingerprints.size,
    },
  };
}

// ---------------------------------------------------------------------------
// Storm correlation — insert-order-stable groups
// ---------------------------------------------------------------------------

export interface CorrelationGroup {
  readonly correlationKey: string;
  readonly tenantId: string;
  readonly kind: FindingKind;
  readonly occurrences: number;
  readonly firstDetectedAt: number;
  readonly lastDetectedAt: number;
  /** Highest severity in the group (post escalation). */
  readonly peakSeverity: SecuritySeverity;
  /** Severity escalated by repeat pressure inside the storm. */
  readonly escalatedTo: SecuritySeverity | null;
  readonly findingIds: readonly string[];
}

/**
 * Correlate admitted findings into groups — stable under insert order.
 *
 * Groups are keyed by the REAL correlation key, ordered by key ascending;
 * members are ordered by (detectedAt, findingId). Repeat-pressure escalation
 * applies the REAL stepwise `escalateSeverity` over the group's occurrence
 * count, so a burst inside the storm escalates exactly as the intake
 * pipeline would — deterministically, regardless of arrival order.
 */
export function correlateFindingStorm(
  findings: readonly AdmittedFinding[],
  options?: {
    readonly escalationRules?: readonly EscalationRule[];
    readonly correlationWindowMs?: number;
  },
): readonly CorrelationGroup[] {
  const rules = options?.escalationRules ?? DEFAULT_ESCALATION_RULES;
  const byKey = new Map<string, AdmittedFinding[]>();
  for (const f of findings) {
    const list = byKey.get(f.correlationKey) ?? [];
    list.push(f);
    byKey.set(f.correlationKey, list);
  }
  const groups: CorrelationGroup[] = [];
  const severityRank = (s: SecuritySeverity): number =>
    ["info", "low", "medium", "high", "critical"].indexOf(s);
  for (const key of [...byKey.keys()].sort()) {
    const members = [...byKey.get(key)!].sort((a, b) =>
      a.detectedAt - b.detectedAt || (a.findingId < b.findingId ? -1 : 1),
    );
    // Window discipline (matches the REAL correlate stage): only occurrences
    // within the window behind the latest detection count toward escalation.
    const windowMs = options?.correlationWindowMs;
    const counted = windowMs === undefined
      ? members
      : members.filter(
          (m) => members[members.length - 1]!.detectedAt - m.detectedAt <= windowMs,
        );
    const occurrences = counted.length;
    const escalated = escalateSeverity(members[0]!.declaredSeverity, occurrences, rules);
    const peak = members.reduce(
      (acc, m) => (severityRank(m.severity) > severityRank(acc) ? m.severity : acc),
      "info" as SecuritySeverity,
    );
    groups.push({
      correlationKey: key,
      tenantId: members[0]!.tenantId,
      kind: members[0]!.kind,
      occurrences,
      firstDetectedAt: members[0]!.detectedAt,
      lastDetectedAt: members[members.length - 1]!.detectedAt,
      peakSeverity: severityRank(escalated) > severityRank(peak) ? escalated : peak,
      escalatedTo: escalated !== members[0]!.declaredSeverity ? escalated : null,
      findingIds: members.map((m) => m.findingId),
    });
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Storm triage — bounded, honest overflow
// ---------------------------------------------------------------------------

export type TriageQueueResult =
  | {
      readonly ok: true;
      /** Ordered by (severity desc, escalated first, detectedAt asc, findingId). */
      readonly queue: readonly AdmittedFinding[];
      readonly depth: number;
    }
  | { readonly ok: false; readonly refused: "triage.queue-overflow"; readonly received: number; readonly limit: number }
  | { readonly ok: false; readonly refused: "triage.empty-queue"; readonly received: 0 }
  | { readonly ok: false; readonly refused: "storm.tenant-mismatch"; readonly offenderFindingId: string; readonly offenderTenantId: string };

/**
 * Build the storm triage queue under an explicit bound.
 *
 * Over-bound input REFUSES with the exact counts — honest overflow, never
 * silent truncation. A finding from another tenant REFUSES naming the
 * offender (A8 fail-closed).
 */
export function buildStormTriageQueue(
  findings: readonly AdmittedFinding[],
  input: { readonly tenantId: string; readonly limit: number },
): TriageQueueResult {
  if (input.tenantId === "") {
    return { ok: false, refused: "storm.tenant-mismatch", offenderFindingId: "", offenderTenantId: "" };
  }
  for (const f of findings) {
    if (f.tenantId !== input.tenantId) {
      return {
        ok: false,
        refused: "storm.tenant-mismatch",
        offenderFindingId: f.findingId,
        offenderTenantId: f.tenantId,
      };
    }
  }
  if (findings.length === 0) return { ok: false, refused: "triage.empty-queue", received: 0 };
  if (findings.length > input.limit) {
    return { ok: false, refused: "triage.queue-overflow", received: findings.length, limit: input.limit };
  }
  const rank = (s: SecuritySeverity): number => ["info", "low", "medium", "high", "critical"].indexOf(s);
  const queue = [...findings].sort((a, b) => {
    const bySeverity = rank(b.severity) - rank(a.severity);
    if (bySeverity !== 0) return bySeverity;
    const byEscalated = Number(b.escalated) - Number(a.escalated);
    if (byEscalated !== 0) return byEscalated;
    const byAt = a.detectedAt - b.detectedAt;
    if (byAt !== 0) return byAt;
    return a.findingId < b.findingId ? -1 : 1;
  });
  return { ok: true, queue, depth: queue.length };
}

// ---------------------------------------------------------------------------
// The full storm pipeline — validate → dedupe → correlate → bounded triage
// ---------------------------------------------------------------------------

export interface StormIntakeResult {
  readonly dedupe: StormDedupeResult;
  readonly groups: readonly CorrelationGroup[];
  readonly triage: TriageQueueResult;
}

/**
 * Run the hardened storm pipeline over a finding storm.
 *
 * The triage queue carries the GROUP-ESCALATED severity: a survivor whose
 * correlation group escalated by repeat pressure enters the queue at the
 * escalated severity with `escalated: true` (the storm's honest aggregate
 * view; the per-occurrence stepwise view remains the intake pipeline's).
 */
export function runStormIntake(
  candidates: readonly FindingIntakeCandidate[],
  options: {
    readonly tenantId: string;
    readonly triageLimit: number;
    readonly correlationWindowMs?: number;
    readonly escalationRules?: readonly EscalationRule[];
  },
): StormIntakeResult {
  const dedupe = dedupeFindingStorm(candidates);
  const groups = correlateFindingStorm(dedupe.survivors, {
    escalationRules: options.escalationRules,
    correlationWindowMs: options.correlationWindowMs,
  });
  const byKey = new Map(groups.map((g) => [g.correlationKey, g]));
  const escalatedSurvivors = dedupe.survivors.map((f) => {
    const group = byKey.get(f.correlationKey);
    if (group === undefined || group.escalatedTo === null) return f;
    return { ...f, severity: group.escalatedTo, escalated: true };
  });
  const triage = buildStormTriageQueue(escalatedSurvivors, {
    tenantId: options.tenantId,
    limit: options.triageLimit,
  });
  return { dedupe, groups, triage };
}
