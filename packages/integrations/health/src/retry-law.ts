/**
 * @fleetos/integration-health — the unified retry law (F251 deliverable 2).
 *
 * ONE deterministic backoff-ladder spec shared across the adapter seams:
 *   - integer-bps multipliers (`multiplierBps >= 10000` — the ladder never
 *     decreases: the non-decreasing-delay law);
 *   - bounded attempts (`maxAttempts >= 1` — attempt-count positivity) and a
 *     bounded cap (`maxDelayMs >= baseDelayMs >= 0`);
 *   - monotonic non-decreasing delays, ZERO jitter (determinism law — no
 *     randomness anywhere);
 *   - all arithmetic in integers (no floats — the Wave-5 lane convention).
 *
 * Retry classification vocabulary: `transient | permanent`, ALIGNED with the
 * adcos `EdgeAdcosErrorClass` (the lane's own classifier is the authority for
 * adcos codes; the shared operational table extends the same vocabulary to
 * the aurum/apify/vendors transport codes).
 *
 * Per-adapter retry-budget ledger: logical windows, integer-bps accounting,
 * `ceiling-not-authorization` marker machine-carried on every accounting
 * result (staying inside a retry budget NEVER authorizes anything).
 *
 * `proveRetryLawConsistency` machine-checks a set of lane retry policies
 * against the law and reports violations deterministically; a NEGATIVE
 * fixture (an intentionally-law-violating policy) must be detected.
 *
 * Pure deterministic TypeScript; logical `now` is caller-supplied.
 */

import { classifyAdcosError, type AdcosRejectionCode, type EdgeAdcosErrorClass } from "@fleetos/adcos";
import { DEFAULT_RETRY_POLICY as aurumDefaultPolicy } from "@fleetos/aurum";
import { DEFAULT_RETRY_POLICY as apifyDefaultPolicy } from "@fleetos/apify";
import { defaultRetryPolicy as adcosDefaultPolicy } from "@fleetos/adcos";
import { CEILING_NOT_AUTHORIZATION, type HealthAdapterId } from "./health-core.js";

// ---------------------------------------------------------------------------
// The retry classification vocabulary — aligned with adcos EdgeAdcosErrorClass.
// ---------------------------------------------------------------------------

/** transient = environmental (MAY retry); permanent = structural (MUST NOT). */
export type RetryClass = EdgeAdcosErrorClass;

/** The adcos binding: the LANE's own classifier is the authority. */
export function adcosRetryClass(code: AdcosRejectionCode): RetryClass {
  return classifyAdcosError(code).class;
}

/**
 * The shared operational classification table for the transport-capable lanes
 * (aurum/apify/vendors). Connectivity/arena/learning carry no retryable
 * transport codes (domain/advisory surfaces — documented, not classified).
 */
export const OPERATIONAL_RETRY_CLASSES: Readonly<Record<string, RetryClass>> = {
  "aurum:TENANT_SCOPE_MISSING": "permanent",
  "aurum:AURUM_UNAVAILABLE": "transient",
  "aurum:AURUM_DEGRADED": "transient",
  "aurum:AURUM_REFUSED": "permanent",
  "aurum:IDEMPOTENCY_KEY_EMPTY": "permanent",
  "apify:TENANT_SCOPE_MISSING": "permanent",
  "apify:PROPOSAL_UNAUTHORIZED": "permanent",
  "apify:APIFY_UNAVAILABLE": "transient",
  "apify:APIFY_DEGRADED": "transient",
  "apify:ACTOR_UNKNOWN": "permanent",
  "apify:IDEMPOTENCY_KEY_EMPTY": "permanent",
  "vendors:TENANT_SCOPE_MISSING": "permanent",
  "vendors:TENANT_MISMATCH": "permanent",
  "vendors:EMPTY_BATCH": "permanent",
  "vendors:LOGICAL_TIME_INVALID": "permanent",
};

export function operationalRetryClass(lane: "aurum" | "apify" | "vendors", code: string): RetryClass | null {
  return OPERATIONAL_RETRY_CLASSES[`${lane}:${code}`] ?? null;
}

// ---------------------------------------------------------------------------
// The backoff ladder — ONE deterministic spec shared across the seams.
// ---------------------------------------------------------------------------

export interface RetryBackoffLadder {
  /** Bounded attempts: >= 1 (attempt-count positivity). */
  readonly maxAttempts: number;
  /** >= 0. */
  readonly baseDelayMs: number;
  /** Cap bound: >= baseDelayMs. */
  readonly maxDelayMs: number;
  /** Integer-bps growth: >= 10000 (10000 = constant; 20000 = ×2). */
  readonly multiplierBps: number;
}

/** The delay ladder for attempts 1..maxAttempts (pure integer arithmetic). */
export function ladderDelays(ladder: RetryBackoffLadder): readonly number[] {
  const delays: number[] = [];
  let current = ladder.baseDelayMs;
  for (let attempt = 1; attempt <= ladder.maxAttempts; attempt++) {
    if (attempt > 1) current = Math.floor((current * ladder.multiplierBps) / 10_000);
    delays.push(Math.min(current, ladder.maxDelayMs));
  }
  return delays;
}

/** Adcos-ladder conversion (`backoffFactor: 2` -> `multiplierBps: 20000`). */
export function ladderFromAdcosPolicy(
  policy: { readonly maxAttempts: number; readonly baseDelayMs: number; readonly maxDelayMs: number; readonly backoffFactor: number },
): RetryBackoffLadder {
  return {
    maxAttempts: policy.maxAttempts,
    baseDelayMs: policy.baseDelayMs,
    maxDelayMs: policy.maxDelayMs,
    multiplierBps: Math.round(policy.backoffFactor * 10_000),
  };
}

/** Constant-delay ladder conversion (aurum/apify `RetryPolicy` shape). */
export function ladderFromConstantPolicy(
  policy: { readonly maxAttempts: number; readonly backoffMillis: number },
): RetryBackoffLadder {
  return {
    maxAttempts: policy.maxAttempts,
    baseDelayMs: policy.backoffMillis,
    maxDelayMs: policy.backoffMillis,
    multiplierBps: 10_000,
  };
}

/** The REAL lane default policies, expressed as law-checked ladders. */
export function laneRetryPolicyRecords(): readonly LaneRetryPolicyRecord[] {
  return [
    { adapter: "adcos", source: "adcos:defaultRetryPolicy", ladder: ladderFromAdcosPolicy(adcosDefaultPolicy()) },
    { adapter: "aurum", source: "aurum:DEFAULT_RETRY_POLICY", ladder: ladderFromConstantPolicy(aurumDefaultPolicy) },
    { adapter: "apify", source: "apify:DEFAULT_RETRY_POLICY", ladder: ladderFromConstantPolicy(apifyDefaultPolicy) },
  ];
}

// ---------------------------------------------------------------------------
// Per-adapter retry-budget ledger — logical windows, integer-bps accounting.
// ---------------------------------------------------------------------------

export interface RetryBudgetSpend {
  readonly attempt: number;
  readonly at: number;
}

export interface RetryBudgetLedger {
  readonly adapter: HealthAdapterId;
  readonly window: string;
  readonly maxRetryAttempts: number;
  readonly attemptsSpent: number;
  readonly spends: readonly RetryBudgetSpend[];
}

export interface RetryBudgetAccounting {
  readonly adapter: HealthAdapterId;
  readonly window: string;
  readonly utilizationBps: number;
  readonly remainingAttempts: number;
  readonly note: typeof CEILING_NOT_AUTHORIZATION;
}

export type RetryBudgetResult =
  | { readonly ok: true; readonly ledger: RetryBudgetLedger; readonly accounting: RetryBudgetAccounting }
  | { readonly ok: false; readonly reason: "ADAPTER_INVALID" | "WINDOW_EMPTY" | "BUDGET_INVALID" | "RETRY_BUDGET_EXCEEDED"; readonly detail: string };

export function openRetryBudget(adapter: HealthAdapterId, window: string, maxRetryAttempts: number): RetryBudgetResult {
  if (adapter !== "adcos" && adapter !== "connectivity" && adapter !== "arena" && adapter !== "learning" && adapter !== "aurum" && adapter !== "apify" && adapter !== "vendors") {
    return { ok: false, reason: "ADAPTER_INVALID", detail: `unknown adapter "${String(adapter)}"` };
  }
  if (window.trim().length === 0) return { ok: false, reason: "WINDOW_EMPTY", detail: "window is empty" };
  if (!Number.isInteger(maxRetryAttempts) || maxRetryAttempts < 1) {
    return { ok: false, reason: "BUDGET_INVALID", detail: "maxRetryAttempts must be an integer >= 1" };
  }
  const ledger: RetryBudgetLedger = { adapter, window, maxRetryAttempts, attemptsSpent: 0, spends: [] };
  return { ok: true, ledger, accounting: accountRetryBudget(ledger) };
}

export function accountRetryBudget(ledger: RetryBudgetLedger): RetryBudgetAccounting {
  return {
    adapter: ledger.adapter,
    window: ledger.window,
    utilizationBps: Math.floor((ledger.attemptsSpent * 10_000) / ledger.maxRetryAttempts),
    remainingAttempts: ledger.maxRetryAttempts - ledger.attemptsSpent,
    note: CEILING_NOT_AUTHORIZATION,
  };
}

export function spendRetryAttempt(ledger: RetryBudgetLedger, now: number): RetryBudgetResult {
  if (!Number.isInteger(now) || now < 0) {
    return { ok: false, reason: "BUDGET_INVALID", detail: "now must be a non-negative integer" };
  }
  const next = ledger.attemptsSpent + 1;
  if (next > ledger.maxRetryAttempts) {
    return { ok: false, reason: "RETRY_BUDGET_EXCEEDED", detail: `retry budget for ${ledger.adapter} window "${ledger.window}" exhausted (${String(ledger.attemptsSpent)}/${String(ledger.maxRetryAttempts)})` };
  }
  const updated: RetryBudgetLedger = {
    ...ledger,
    attemptsSpent: next,
    spends: [...ledger.spends, { attempt: next, at: now }],
  };
  return { ok: true, ledger: updated, accounting: accountRetryBudget(updated) };
}

// ---------------------------------------------------------------------------
// proveRetryLawConsistency — the machine proof over lane retry policies.
// ---------------------------------------------------------------------------

export interface LaneRetryPolicyRecord {
  readonly adapter: HealthAdapterId;
  /** Provenance label (e.g. "adcos:defaultRetryPolicy"). */
  readonly source: string;
  readonly ladder: RetryBackoffLadder;
}

export type RetryLawViolationKind =
  | "attempts-not-positive"
  | "base-delay-negative"
  | "cap-below-base"
  | "multiplier-below-unity"
  | "delays-not-monotonic";

export interface RetryLawViolation {
  readonly adapter: HealthAdapterId;
  readonly source: string;
  readonly violation: RetryLawViolationKind;
  readonly detail: string;
}

export type RetryLawProof =
  | { readonly ok: true; readonly checked: number }
  | { readonly ok: false; readonly checked: number; readonly violations: readonly RetryLawViolation[] };

/** Machine-check lane retry policies against the unified retry law. */
export function proveRetryLawConsistency(policies: readonly LaneRetryPolicyRecord[]): RetryLawProof {
  const violations: RetryLawViolation[] = [];
  for (const record of policies) {
    const ladder = record.ladder;
    if (!Number.isInteger(ladder.maxAttempts) || ladder.maxAttempts < 1) {
      violations.push({ adapter: record.adapter, source: record.source, violation: "attempts-not-positive", detail: `maxAttempts ${String(ladder.maxAttempts)} is not an integer >= 1` });
    }
    if (!Number.isInteger(ladder.baseDelayMs) || ladder.baseDelayMs < 0) {
      violations.push({ adapter: record.adapter, source: record.source, violation: "base-delay-negative", detail: `baseDelayMs ${String(ladder.baseDelayMs)} is not an integer >= 0` });
    }
    if (!Number.isInteger(ladder.maxDelayMs) || ladder.maxDelayMs < ladder.baseDelayMs) {
      violations.push({ adapter: record.adapter, source: record.source, violation: "cap-below-base", detail: `maxDelayMs ${String(ladder.maxDelayMs)} is below baseDelayMs ${String(ladder.baseDelayMs)}` });
    }
    if (!Number.isInteger(ladder.multiplierBps) || ladder.multiplierBps < 10_000) {
      violations.push({ adapter: record.adapter, source: record.source, violation: "multiplier-below-unity", detail: `multiplierBps ${String(ladder.multiplierBps)} is not an integer >= 10000 (non-decreasing-delay law)` });
    }
    const delays = ladderDelays(ladder);
    for (let i = 1; i < delays.length; i++) {
      if (delays[i]! < delays[i - 1]!) {
        violations.push({ adapter: record.adapter, source: record.source, violation: "delays-not-monotonic", detail: `delay ${String(i + 1)} (${String(delays[i])}) is below delay ${String(i)} (${String(delays[i - 1])})` });
        break;
      }
    }
  }
  const sorted = [...violations].sort((a, b) =>
    a.adapter !== b.adapter ? (a.adapter < b.adapter ? -1 : 1) : a.source !== b.source ? (a.source < b.source ? -1 : 1) : a.violation < b.violation ? -1 : 1,
  );
  return sorted.length === 0 ? { ok: true, checked: policies.length } : { ok: false, checked: policies.length, violations: sorted };
}
