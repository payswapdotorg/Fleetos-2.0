/**
 * @fleetos/control-plane — deterministic retry schedules (integer math).
 *
 * The retry policy is a PURE deterministic function: the attempt schedule
 * is computed from the attempt number and a backoff multiplier expressed
 * in BASIS POINTS (10000 bps = 1.0x). All arithmetic is integer math —
 * no floats, no jitter, no wall-clock. `now` is always an explicit input
 * at the call sites that consume the schedule.
 *
 * The multiplication path is overflow-safe: before each multiply the
 * guard checks the product stays within Number.MAX_SAFE_INTEGER, and any
 * delay at or above `maxDelayMs` short-circuits to the cap.
 */

import { fail, ok, type Result } from "./result.js";

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

export interface CommandRetryPolicy {
  /** Total attempts allowed (>= 1). After the maxAttempts-th failure the command dead-letters. */
  readonly maxAttempts: number;
  /** Delay (ms) before attempt 2 — the base of the backoff series. */
  readonly baseDelayMs: number;
  /** Per-delay cap (ms). */
  readonly maxDelayMs: number;
  /** Backoff multiplier in basis points. 10000 = 1.0x, 15000 = 1.5x, 20000 = 2.0x. */
  readonly backoffBps: number;
}

export const DEFAULT_COMMAND_RETRY_POLICY: CommandRetryPolicy = {
  maxAttempts: 5,
  baseDelayMs: 1_000,
  maxDelayMs: 60_000,
  backoffBps: 20_000,
};

export type RetryPolicyRejection =
  | "invalid-max-attempts"
  | "invalid-base-delay"
  | "invalid-max-delay"
  | "invalid-backoff-bps"
  | "max-below-base";

const MAX_REASONABLE_MS = 1e12;

/** Pure validation of a retry policy. */
export function validateRetryPolicy(
  policy: CommandRetryPolicy,
): Result<void, RetryPolicyRejection> {
  if (
    !Number.isInteger(policy.maxAttempts) ||
    policy.maxAttempts < 1 ||
    policy.maxAttempts > 100
  ) {
    return fail("invalid-max-attempts");
  }
  if (
    !Number.isInteger(policy.baseDelayMs) ||
    policy.baseDelayMs <= 0 ||
    policy.baseDelayMs > MAX_REASONABLE_MS
  ) {
    return fail("invalid-base-delay");
  }
  if (
    !Number.isInteger(policy.maxDelayMs) ||
    policy.maxDelayMs <= 0 ||
    policy.maxDelayMs > MAX_REASONABLE_MS
  ) {
    return fail("invalid-max-delay");
  }
  if (
    !Number.isInteger(policy.backoffBps) ||
    policy.backoffBps < 1 ||
    policy.backoffBps > 1_000_000_000
  ) {
    return fail("invalid-backoff-bps");
  }
  if (policy.maxDelayMs < policy.baseDelayMs) {
    return fail("max-below-base");
  }
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// attemptDelayMs — the pure retry function.
// ---------------------------------------------------------------------------

/**
 * Delay (ms) before the attempt AFTER the `failedAttempt`-th attempt
 * (1-indexed). Returns null when the policy is exhausted — the caller MUST
 * dead-letter.
 *
 * delay(k) = floor(baseDelayMs * (backoffBps / 10000)^(k-1)), capped at
 * maxDelayMs — computed with exact integer math.
 */
export function attemptDelayMs(
  policy: CommandRetryPolicy,
  failedAttempt: number,
): number | null {
  if (!Number.isInteger(failedAttempt) || failedAttempt < 1) return null;
  if (failedAttempt >= policy.maxAttempts) return null;
  let delay = policy.baseDelayMs;
  for (let i = 1; i < failedAttempt; i++) {
    // Overflow-safe multiply: bail to the cap when the product could leave
    // the safe-integer range.
    if (delay > Math.floor(Number.MAX_SAFE_INTEGER / policy.backoffBps)) {
      return policy.maxDelayMs;
    }
    delay = Math.floor((delay * policy.backoffBps) / 10_000);
    if (delay >= policy.maxDelayMs) return policy.maxDelayMs;
  }
  return Math.min(delay, policy.maxDelayMs);
}

/**
 * The full attempt schedule for a command whose attempts are executed
 * back-to-back (instant execution): attempt 1 at `firstAttemptAt`,
 * attempt k+1 at attempt-k time + delay(k). Exact integer math; the
 * schedule length equals `maxAttempts`.
 */
export function attemptSchedule(
  policy: CommandRetryPolicy,
  firstAttemptAt: number,
): ReadonlyArray<number> {
  const times: number[] = [firstAttemptAt];
  let t = firstAttemptAt;
  for (let failed = 1; failed < policy.maxAttempts; failed++) {
    const delay = attemptDelayMs(policy, failed);
    if (delay === null) break;
    t += delay;
    times.push(t);
  }
  return times;
}
