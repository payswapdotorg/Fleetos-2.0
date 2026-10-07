/**
 * @fleetos/security — Findings intake pipeline (F220B, Wave 2 operational grade).
 *
 * Staged admission: validate -> dedupe -> correlate -> triage. Every stage is a
 * pure function with its own typed rejection code. The pipeline threads
 * immutable state — each admitted finding is appended to the intake ledger,
 * never mutated.
 *
 * Laws:
 *  - A8 tenant fail-closed: a candidate without a tenant scope is REFUSED at
 *    validation (`validate.missing-tenant`) — never defaulted.
 *  - A3/A12 determinism: the fingerprint is a pure canonical-string digest;
 *    the same candidate always produces the same fingerprint, the same
 *    correlation key and the same triage outcome. No wall-clock (time is an
 *    explicit `number` input), no randomness.
 *  - Escalation determinism: a `medium` finding repeated within a window
 *    escalates to `high` at the configured repeat threshold — same inputs,
 *    same severity, every time.
 */

import type { FindingConfidence, FindingKind, SecuritySeverity } from "./index.ts";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

const SEVERITIES: readonly SecuritySeverity[] = ["info", "low", "medium", "high", "critical"];
const CONFIDENCES: readonly FindingConfidence[] = ["tentative", "probable", "confirmed"];
const KINDS: readonly FindingKind[] = [
  "auth.weak_credential",
  "auth.exposed_credential",
  "auth.missing_mfa",
  "tenant.cross_tenant_leak",
  "tenant.isolation_gap",
  "device.firmware_outdated",
  "device.unmanaged",
  "device.compromised_indicator",
  "policy.guardian_bypass_attempt",
  "policy.self_authorization_attempt",
  "policy.fail_open",
  "evidence.chain_break",
  "evidence.missing_verification",
  "execution.unauthorized_dispatch",
  "network.open_ingress",
  "supply_chain.unverified_dependency",
];

/** Intake pipeline stages, in admission order. */
export type IntakeStage = "validate" | "dedupe" | "correlate" | "triage";

/** Machine-stable rejection codes — one vocabulary per stage. */
export type IntakeRejectionCode =
  // validate
  | "validate.missing-tenant"
  | "validate.unknown-kind"
  | "validate.invalid-severity"
  | "validate.invalid-confidence"
  | "validate.invalid-detected-at"
  | "validate.invalid-asset-ids"
  | "validate.missing-description"
  // dedupe
  | "dedupe.duplicate-finding"
  // correlate
  | "correlate.tenant-mismatch"
  // triage
  | "triage.insufficient-signals";

/** Raw candidate finding — untrusted boundary input. */
export interface FindingIntakeCandidate {
  readonly tenantId: string;
  readonly kind: string;
  readonly declaredSeverity: string;
  readonly confidence: string;
  /** Epoch milliseconds — explicit time input, never wall-clock. */
  readonly detectedAt: number;
  readonly assetIds: readonly string[];
  readonly description: string;
  readonly evidenceRefs: readonly string[];
  /** Number of independent detector signals — feeds triage honesty. */
  readonly signalCount: number;
}

/** The admitted finding — normalized, fingerprinted, correlated, triaged. */
export interface AdmittedFinding {
  readonly findingId: string;
  readonly tenantId: string;
  readonly kind: FindingKind;
  readonly severity: SecuritySeverity;
  readonly confidence: FindingConfidence;
  readonly detectedAt: number;
  readonly assetIds: readonly string[];
  readonly description: string;
  readonly evidenceRefs: readonly string[];
  /** Deterministic fingerprint digest over the canonical fields. */
  readonly fingerprint: string;
  /** Correlation key — tenant|kind|sorted-assets. */
  readonly correlationKey: string;
  /** Occurrences of this correlation key within the window (incl. this one). */
  readonly occurrences: number;
  /** Severity escalated by repeat pressure (true when > declared). */
  readonly escalated: boolean;
  /** Original declared severity (pre-escalation) — audit honesty. */
  readonly declaredSeverity: SecuritySeverity;
  /** Honest degradation flag from triage. */
  readonly degraded: boolean;
}

/** Per-candidate ack from the pipeline — independent, never batch-aborts. */
export interface IntakeAck {
  readonly candidateIndex: number;
  readonly ok: boolean;
  /** Stage where the candidate was refused (null when admitted). */
  readonly refusedAt: IntakeStage | null;
  readonly reason: IntakeRejectionCode | null;
  readonly admitted: AdmittedFinding | null;
}

/** Intake pipeline metrics — pure values, per-stage counters. */
export interface IntakeMetrics {
  readonly received: number;
  readonly validated: number;
  readonly deduped: number;
  readonly correlated: number;
  readonly admitted: number;
  readonly failedByStage: Readonly<Record<IntakeStage, number>>;
}

export interface IntakePipelineOptions {
  /** Correlation window in ms — repeats within it count toward escalation. */
  readonly correlationWindowMs: number;
  /** Escalation rules — deterministic, applied stepwise. */
  readonly escalationRules?: readonly EscalationRule[];
}

// ---------------------------------------------------------------------------
// Deterministic fingerprints + correlation keys
// ---------------------------------------------------------------------------

/** FNV-1a 32-bit over a string — deterministic, no deps, no wall-clock. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}

/**
 * Dedupe fingerprint — canonical string over (tenant, kind, assets, detectedAt,
 * description). Two candidates with the identical fingerprint are the SAME
 * detection event re-reported and the second is refused as a duplicate.
 */
export function findingDedupeFingerprint(c: {
  readonly tenantId: string;
  readonly kind: string;
  readonly assetIds: readonly string[];
  readonly detectedAt: number;
  readonly description: string;
}): string {
  const canonical = [
    c.tenantId,
    c.kind,
    sortedUnique(c.assetIds).join(","),
    String(c.detectedAt),
    c.description,
  ].join("|");
  return fnv1a(canonical);
}

/**
 * Correlation key — tenant|kind|sorted-assets. Deliberately WITHOUT detectedAt
 * and description: repeats of the same problem on the same assets carry a
 * different fingerprint (new detection) but the SAME correlation key.
 */
export function findingCorrelationKey(c: {
  readonly tenantId: string;
  readonly kind: string;
  readonly assetIds: readonly string[];
}): string {
  return [c.tenantId, c.kind, sortedUnique(c.assetIds).join(",")].join("|");
}

// ---------------------------------------------------------------------------
// Severity escalation — deterministic, stepwise, repeat-pressure driven
// ---------------------------------------------------------------------------

export interface EscalationRule {
  readonly from: SecuritySeverity;
  readonly to: SecuritySeverity;
  /** Minimum occurrences within the correlation window to fire. */
  readonly repeatThreshold: number;
}

/**
 * Default escalation rules — a `medium` finding repeated 3x within the window
 * escalates to `high`; a `high` finding repeated 5x escalates to `critical`.
 */
export const DEFAULT_ESCALATION_RULES: readonly EscalationRule[] = [
  { from: "medium", to: "high", repeatThreshold: 3 },
  { from: "high", to: "critical", repeatThreshold: 5 },
];

/**
 * Escalate a severity by repeat pressure. Deterministic and stepwise: rules
 * are applied repeatedly (loop-guarded at the severity-rank span) so a burst
 * of 5 mediums escalates medium -> high -> critical only if the `high` rule
 * threshold is also met. Unknown rules (from >= to rank) are ignored.
 */
export function escalateSeverity(
  base: SecuritySeverity,
  occurrences: number,
  rules: readonly EscalationRule[] = DEFAULT_ESCALATION_RULES,
): SecuritySeverity {
  let current = base;
  const rank = (s: SecuritySeverity): number => SEVERITIES.indexOf(s);
  // Loop guard: at most one pass per severity rank — deterministic termination.
  for (let guard = 0; guard <= SEVERITIES.length; guard += 1) {
    const fired = rules.find(
      (r) => r.from === current && rank(r.to) > rank(r.from) && occurrences >= r.repeatThreshold,
    );
    if (!fired) return current;
    current = fired.to;
  }
  return current;
}

// ---------------------------------------------------------------------------
// Stage 1 — validate
// ---------------------------------------------------------------------------

export type ValidateOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: Extract<IntakeRejectionCode, `validate.${string}`> };

/** Validate a raw candidate — every field is checked, tenant first. */
export function validateCandidate(c: FindingIntakeCandidate): ValidateOutcome {
  if (typeof c.tenantId !== "string" || c.tenantId === "") {
    return { ok: false, reason: "validate.missing-tenant" };
  }
  if (!KINDS.includes(c.kind as FindingKind)) {
    return { ok: false, reason: "validate.unknown-kind" };
  }
  if (!SEVERITIES.includes(c.declaredSeverity as SecuritySeverity)) {
    return { ok: false, reason: "validate.invalid-severity" };
  }
  if (!CONFIDENCES.includes(c.confidence as FindingConfidence)) {
    return { ok: false, reason: "validate.invalid-confidence" };
  }
  if (!Number.isFinite(c.detectedAt) || c.detectedAt < 0 || !Number.isInteger(c.detectedAt)) {
    return { ok: false, reason: "validate.invalid-detected-at" };
  }
  if (c.assetIds.some((a) => typeof a !== "string" || a === "")) {
    return { ok: false, reason: "validate.invalid-asset-ids" };
  }
  if (typeof c.description !== "string" || c.description.trim() === "") {
    return { ok: false, reason: "validate.missing-description" };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Stage 2 — dedupe
// ---------------------------------------------------------------------------

export type DedupeOutcome =
  | { readonly ok: true; readonly fingerprint: string }
  | { readonly ok: false; readonly reason: "dedupe.duplicate-finding"; readonly duplicateOf: string };

/** Dedupe a validated candidate against the admitted set (same fingerprint). */
export function dedupeCandidate(
  c: FindingIntakeCandidate,
  admitted: readonly AdmittedFinding[],
): DedupeOutcome {
  const fingerprint = findingDedupeFingerprint(c);
  const existing = admitted.find((f) => f.fingerprint === fingerprint);
  if (existing) {
    return { ok: false, reason: "dedupe.duplicate-finding", duplicateOf: existing.findingId };
  }
  return { ok: true, fingerprint };
}

// ---------------------------------------------------------------------------
// Stage 3 — correlate
// ---------------------------------------------------------------------------

export interface CorrelateOutcome {
  readonly correlationKey: string;
  /** Occurrences within the window, INCLUDING the candidate itself. */
  readonly occurrences: number;
}

/**
 * Correlate a validated candidate with prior admitted findings.
 *
 * A prior finding correlates when it shares the correlation key AND its
 * detectedAt is within `windowMs` BEFORE the candidate's detectedAt
 * (repeats are new detections — they arrive later; out-of-order arrivals do
 * not retroactively correlate).
 */
export function correlateCandidate(
  c: FindingIntakeCandidate,
  admitted: readonly AdmittedFinding[],
  windowMs: number,
): CorrelateOutcome {
  const key = findingCorrelationKey(c);
  const priors = admitted.filter(
    (f) =>
      f.correlationKey === key &&
      c.detectedAt >= f.detectedAt &&
      c.detectedAt - f.detectedAt <= windowMs,
  );
  return { correlationKey: key, occurrences: priors.length + 1 };
}

// ---------------------------------------------------------------------------
// Stage 4 — triage
// ---------------------------------------------------------------------------

export interface TriageOutcome {
  readonly severity: SecuritySeverity;
  readonly degraded: boolean;
  readonly escalated: boolean;
}

/**
 * Triage a correlated candidate. Deterministic composition of:
 *  1. repeat-pressure escalation (correlate stage output), then
 *  2. confidence triage — tentative signals degrade honestly (law A12).
 *
 * Precondition: the caller has already refused zero-signal candidates at the
 * triage stage (`triage.insufficient-signals`); this function assumes
 * `signalCount >= 1`.
 */
export function triageCandidate(
  c: FindingIntakeCandidate,
  occurrences: number,
  rules: readonly EscalationRule[] = DEFAULT_ESCALATION_RULES,
): TriageOutcome {
  const declared = c.declaredSeverity as SecuritySeverity;
  const escalated = escalateSeverity(declared, occurrences, rules);
  if (c.confidence === "tentative" && c.signalCount < 2) {
    return { severity: "info", degraded: true, escalated: false };
  }
  return { severity: escalated, degraded: c.confidence === "tentative", escalated: escalated !== declared };
}

// ---------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------

/**
 * Run the full intake pipeline over a batch of candidates.
 *
 * Each candidate is acked independently — a refused candidate never aborts
 * the batch (same discipline as F220A's observation admission). Admitted
 * findings become visible to subsequent candidates (in-batch correlation),
 * which is what makes burst escalation deterministic.
 */
export function runFindingIntake(
  candidates: readonly FindingIntakeCandidate[],
  options: IntakePipelineOptions,
): { readonly acks: readonly IntakeAck[]; readonly admitted: readonly AdmittedFinding[]; readonly metrics: IntakeMetrics } {
  const rules = options.escalationRules ?? DEFAULT_ESCALATION_RULES;
  const admitted: AdmittedFinding[] = [];
  const acks: IntakeAck[] = [];
  const failedByStage: Record<IntakeStage, number> = { validate: 0, dedupe: 0, correlate: 0, triage: 0 };
  let validated = 0;
  let deduped = 0;
  let correlated = 0;

  candidates.forEach((c, index) => {
    // Stage 1 — validate.
    const v = validateCandidate(c);
    if (!v.ok) {
      failedByStage.validate += 1;
      acks.push({ candidateIndex: index, ok: false, refusedAt: "validate", reason: v.reason, admitted: null });
      return;
    }
    validated += 1;

    // Stage 2 — dedupe.
    const d = dedupeCandidate(c, admitted);
    if (!d.ok) {
      failedByStage.dedupe += 1;
      acks.push({ candidateIndex: index, ok: false, refusedAt: "dedupe", reason: d.reason, admitted: null });
      return;
    }
    deduped += 1;

    // Stage 3 — correlate.
    const corr = correlateCandidate(c, admitted, options.correlationWindowMs);
    correlated += 1;
    // Cross-tenant leakage guard: correlation key embeds the tenant, so a
    // cross-tenant "match" is impossible; the stage still fails closed if a
    // caller hand-builds a mismatched state.
    if (!corr.correlationKey.startsWith(`${c.tenantId}|`)) {
      failedByStage.correlate += 1;
      acks.push({ candidateIndex: index, ok: false, refusedAt: "correlate", reason: "correlate.tenant-mismatch", admitted: null });
      return;
    }

    // Stage 4 — triage (+ escalation).
    if (c.signalCount <= 0) {
      failedByStage.triage += 1;
      acks.push({ candidateIndex: index, ok: false, refusedAt: "triage", reason: "triage.insufficient-signals", admitted: null });
      return;
    }
    const triage = triageCandidate(c, corr.occurrences, rules);

    const finding: AdmittedFinding = {
      findingId: `finding-${d.fingerprint}-${String(c.detectedAt)}`,
      tenantId: c.tenantId,
      kind: c.kind as FindingKind,
      severity: triage.severity,
      confidence: c.confidence as FindingConfidence,
      detectedAt: c.detectedAt,
      assetIds: sortedUnique(c.assetIds),
      description: c.description,
      evidenceRefs: [...c.evidenceRefs],
      fingerprint: d.fingerprint,
      correlationKey: corr.correlationKey,
      occurrences: corr.occurrences,
      escalated: triage.escalated,
      declaredSeverity: c.declaredSeverity as SecuritySeverity,
      degraded: triage.degraded,
    };
    admitted.push(finding);
    acks.push({ candidateIndex: index, ok: true, refusedAt: null, reason: null, admitted: finding });
  });

  return {
    acks,
    admitted,
    metrics: {
      received: candidates.length,
      validated,
      deduped,
      correlated,
      admitted: admitted.length,
      failedByStage,
    },
  };
}
