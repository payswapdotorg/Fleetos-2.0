/**
 * @fleetos/model-gateway — quota/rate enforcement over deterministic
 * logical-time windows (F230C, Wave 3 lane C).
 *
 * Quota windows are explicit `(windowStartAt, windowEndAt)` number
 * inputs — no wall clock. Requests inside a window consume integer
 * request-count and unit quotas; exhaustion is REFUSED with typed reason
 * codes and the exact overshoot — never a silent drop (law A4).
 * Utilization is reported in integer basis points (floored).
 *
 * Laws: A4, A12 (deterministic reference path), A19 (digest optional at
 * the composing boundary — the window state is the truth here). Pure.
 */

// ---------------------------------------------------------------------------
// Quota window policy + state.
// ---------------------------------------------------------------------------

export interface QuotaWindowPolicy {
  readonly maxRequestsPerWindow: number;
  readonly maxUnitsPerWindow: number;
}

export interface QuotaWindowState {
  readonly windowStartAt: number;
  readonly windowEndAt: number;
  readonly requestsAccepted: number;
  readonly unitsConsumed: number;
}

export interface QuotaRequest {
  readonly at: number;
  readonly units: number;
}

export type QuotaDecisionReasonCode =
  | "QUOTA_WINDOW_INVALID"
  | "QUOTA_POLICY_INVALID"
  | "REQUEST_OUTSIDE_WINDOW"
  | "NEGATIVE_UNITS"
  | "NON_INTEGER_UNITS"
  | "NEGATIVE_TIME"
  | "QUOTA_REQUESTS_EXHAUSTED"
  | "QUOTA_UNITS_EXHAUSTED";

export type QuotaDecision =
  | { readonly ok: true; readonly state: QuotaWindowState; readonly remainingRequests: number; readonly remainingUnits: number }
  | {
      readonly ok: false;
      readonly reasonCode: QuotaDecisionReasonCode;
      readonly overshootRequests: number | null;
      readonly overshootUnits: number | null;
    };

/**
 * Apply one request to a quota window. PURE: a new state is returned;
 * the input state is never mutated. Rules, in order:
 *   1. window validity — start < end;
 *   2. policy validity — non-negative integer ceilings;
 *   3. request time within [start, end) — outside refuses
 *      REQUEST_OUTSIDE_WINDOW (the caller opens the next window);
 *   4. request-count quota — exhaustion refuses with the exact overshoot;
 *   5. unit quota — exhaustion refuses with the exact overshoot.
 * Refusals never consume quota (the state is untouched on refusal).
 */
export function applyQuotaRequest(
  policy: QuotaWindowPolicy,
  state: QuotaWindowState,
  request: QuotaRequest,
): QuotaDecision {
  if (state.windowStartAt < 0 || state.windowEndAt <= state.windowStartAt) {
    return failQuota("QUOTA_WINDOW_INVALID", null, null);
  }
  if (
    !Number.isInteger(policy.maxRequestsPerWindow) ||
    !Number.isInteger(policy.maxUnitsPerWindow) ||
    policy.maxRequestsPerWindow < 0 ||
    policy.maxUnitsPerWindow < 0
  ) {
    return failQuota("QUOTA_POLICY_INVALID", null, null);
  }
  if (!Number.isInteger(request.units)) {
    return failQuota("NON_INTEGER_UNITS", null, null);
  }
  if (request.at < 0) {
    return failQuota("NEGATIVE_TIME", null, null);
  }
  if (request.units < 0) {
    return failQuota("NEGATIVE_UNITS", null, null);
  }
  if (request.at < state.windowStartAt || request.at >= state.windowEndAt) {
    return failQuota("REQUEST_OUTSIDE_WINDOW", null, null);
  }
  const nextRequests = state.requestsAccepted + 1;
  if (nextRequests > policy.maxRequestsPerWindow) {
    return failQuota("QUOTA_REQUESTS_EXHAUSTED", nextRequests - policy.maxRequestsPerWindow, null);
  }
  const nextUnits = state.unitsConsumed + request.units;
  if (nextUnits > policy.maxUnitsPerWindow) {
    return failQuota("QUOTA_UNITS_EXHAUSTED", null, nextUnits - policy.maxUnitsPerWindow);
  }
  const nextState: QuotaWindowState = {
    windowStartAt: state.windowStartAt,
    windowEndAt: state.windowEndAt,
    requestsAccepted: nextRequests,
    unitsConsumed: nextUnits,
  };
  return {
    ok: true,
    state: nextState,
    remainingRequests: policy.maxRequestsPerWindow - nextRequests,
    remainingUnits: policy.maxUnitsPerWindow - nextUnits,
  };
}

function failQuota(
  reasonCode: QuotaDecisionReasonCode,
  overshootRequests: number | null,
  overshootUnits: number | null,
): QuotaDecision {
  return { ok: false, reasonCode, overshootRequests, overshootUnits };
}

// ---------------------------------------------------------------------------
// Window arithmetic + utilization (pure helpers).
// ---------------------------------------------------------------------------

/**
 * Open a fresh window state for the interval [startAt, startAt + length).
 * Refuses non-positive length / negative start. Pure.
 */
export function openQuotaWindow(
  startAt: number,
  length: number,
): { readonly ok: true; readonly state: QuotaWindowState } | { readonly ok: false; readonly reasonCode: "QUOTA_WINDOW_INVALID" } {
  if (startAt < 0 || !Number.isInteger(length) || length <= 0) {
    return { ok: false, reasonCode: "QUOTA_WINDOW_INVALID" };
  }
  return {
    ok: true,
    state: {
      windowStartAt: startAt,
      windowEndAt: startAt + length,
      requestsAccepted: 0,
      unitsConsumed: 0,
    },
  };
}

/** Next window's start — pure arithmetic on logical time. */
export function nextWindowStart(current: QuotaWindowState): number {
  return current.windowEndAt;
}

/** Utilization in integer basis points, floored. 0 when the ceiling is 0. */
export function quotaUtilizationBps(
  policy: QuotaWindowPolicy,
  state: QuotaWindowState,
): { readonly requestsBps: number; readonly unitsBps: number } {
  const requestsBps =
    policy.maxRequestsPerWindow === 0
      ? 0
      : Math.floor((state.requestsAccepted * 10000) / policy.maxRequestsPerWindow);
  const unitsBps =
    policy.maxUnitsPerWindow === 0
      ? 0
      : Math.floor((state.unitsConsumed * 10000) / policy.maxUnitsPerWindow);
  return { requestsBps, unitsBps };
}
