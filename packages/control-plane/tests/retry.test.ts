/**
 * @fleetos/control-plane — retry policy tests.
 *
 * The retry schedule is a pure deterministic function: exact attempt
 * times from basis-point backoff with integer math, the maxDelayMs cap,
 * exhaustion → null (dead-letter), and overflow safety for extreme
 * multipliers.
 */

import { describe, expect, it } from "vitest";
import {
  attemptDelayMs,
  attemptSchedule,
  DEFAULT_COMMAND_RETRY_POLICY,
  validateRetryPolicy,
} from "../src/index.js";

describe("attemptDelayMs — exact integer backoff", () => {
  it("the first failure schedules the base delay", () => {
    const policy = { maxAttempts: 5, baseDelayMs: 1_000, maxDelayMs: 25_000, backoffBps: 15_000 };
    expect(attemptDelayMs(policy, 1)).toBe(1_000);
  });

  it("15000 bps (1.5x): delays are 1000 / 1500 / 2250 / 3375", () => {
    const policy = { maxAttempts: 5, baseDelayMs: 1_000, maxDelayMs: 25_000, backoffBps: 15_000 };
    expect(attemptDelayMs(policy, 1)).toBe(1_000);
    expect(attemptDelayMs(policy, 2)).toBe(1_500);
    expect(attemptDelayMs(policy, 3)).toBe(2_250);
    expect(attemptDelayMs(policy, 4)).toBe(3_375);
  });

  it("20000 bps (2x) — the default policy: 1000 / 2000 / 4000 / 8000", () => {
    expect(attemptDelayMs(DEFAULT_COMMAND_RETRY_POLICY, 1)).toBe(1_000);
    expect(attemptDelayMs(DEFAULT_COMMAND_RETRY_POLICY, 2)).toBe(2_000);
    expect(attemptDelayMs(DEFAULT_COMMAND_RETRY_POLICY, 3)).toBe(4_000);
    expect(attemptDelayMs(DEFAULT_COMMAND_RETRY_POLICY, 4)).toBe(8_000);
  });

  it("10000 bps (1.0x) is a constant-delay series", () => {
    const policy = { maxAttempts: 6, baseDelayMs: 500, maxDelayMs: 10_000, backoffBps: 10_000 };
    expect(attemptDelayMs(policy, 1)).toBe(500);
    expect(attemptDelayMs(policy, 2)).toBe(500);
    expect(attemptDelayMs(policy, 5)).toBe(500);
  });

  it("backoff below 1.0x decays: 5000 bps → 1000 / 500 / 250 / 125", () => {
    const policy = { maxAttempts: 6, baseDelayMs: 1_000, maxDelayMs: 10_000, backoffBps: 5_000 };
    expect(attemptDelayMs(policy, 1)).toBe(1_000);
    expect(attemptDelayMs(policy, 2)).toBe(500);
    expect(attemptDelayMs(policy, 3)).toBe(250);
    expect(attemptDelayMs(policy, 4)).toBe(125);
  });

  it("caps each delay at maxDelayMs", () => {
    const policy = { maxAttempts: 6, baseDelayMs: 1_000, maxDelayMs: 2_500, backoffBps: 20_000 };
    expect(attemptDelayMs(policy, 1)).toBe(1_000);
    expect(attemptDelayMs(policy, 2)).toBe(2_000);
    expect(attemptDelayMs(policy, 3)).toBe(2_500); // 4000 capped
    expect(attemptDelayMs(policy, 4)).toBe(2_500);
  });

  it("returns null when the policy is exhausted (dead-letter)", () => {
    const policy = { maxAttempts: 3, baseDelayMs: 1_000, maxDelayMs: 10_000, backoffBps: 20_000 };
    expect(attemptDelayMs(policy, 3)).toBeNull();
    expect(attemptDelayMs(policy, 4)).toBeNull();
  });

  it("returns null for degenerate attempt numbers", () => {
    expect(attemptDelayMs(DEFAULT_COMMAND_RETRY_POLICY, 0)).toBeNull();
    expect(attemptDelayMs(DEFAULT_COMMAND_RETRY_POLICY, -1)).toBeNull();
    expect(attemptDelayMs(DEFAULT_COMMAND_RETRY_POLICY, 1.5)).toBeNull();
  });

  it("overflow-safe: a 30000 bps multiplier over 30 attempts caps exactly at maxDelayMs", () => {
    const policy = { maxAttempts: 40, baseDelayMs: 1_000, maxDelayMs: 60_000, backoffBps: 30_000 };
    for (let attempt = 1; attempt < 40; attempt++) {
      const delay = attemptDelayMs(policy, attempt);
      expect(delay).not.toBeNull();
      expect(delay as number).toBeLessThanOrEqual(60_000);
      expect(Number.isSafeInteger(delay)).toBe(true);
    }
    expect(attemptDelayMs(policy, 39)).toBe(60_000);
  });
});

describe("attemptSchedule — the full deterministic schedule", () => {
  it("computes exact cumulative attempt times", () => {
    const policy = { maxAttempts: 4, baseDelayMs: 1_000, maxDelayMs: 25_000, backoffBps: 15_000 };
    const schedule = attemptSchedule(policy, 1_000_000);
    expect(schedule).toEqual([1_000_000, 1_001_000, 1_002_500, 1_004_750]);
  });

  it("maxAttempts=1 → a single attempt, no retries", () => {
    const policy = { maxAttempts: 1, baseDelayMs: 1_000, maxDelayMs: 25_000, backoffBps: 15_000 };
    expect(attemptSchedule(policy, 5)).toEqual([5]);
  });

  it("same inputs → byte-identical schedules (determinism)", () => {
    const policy = { maxAttempts: 5, baseDelayMs: 700, maxDelayMs: 9_999, backoffBps: 17_321 };
    expect(attemptSchedule(policy, 42)).toEqual(attemptSchedule(policy, 42));
  });

  it("the schedule length equals maxAttempts", () => {
    const policy = { maxAttempts: 7, baseDelayMs: 100, maxDelayMs: 1_000_000, backoffBps: 20_000 };
    expect(attemptSchedule(policy, 0)).toHaveLength(7);
  });
});

describe("validateRetryPolicy", () => {
  it("accepts the default policy", () => {
    expect(validateRetryPolicy(DEFAULT_COMMAND_RETRY_POLICY)).toEqual({ ok: true, value: undefined });
  });

  it("rejects maxAttempts < 1 / non-integer", () => {
    expect(
      validateRetryPolicy({ maxAttempts: 0, baseDelayMs: 100, maxDelayMs: 1_000, backoffBps: 10_000 }),
    ).toEqual({ ok: false, reason: "invalid-max-attempts" });
    expect(
      validateRetryPolicy({ maxAttempts: 1.5, baseDelayMs: 100, maxDelayMs: 1_000, backoffBps: 10_000 }),
    ).toEqual({ ok: false, reason: "invalid-max-attempts" });
  });

  it("rejects non-positive delays", () => {
    expect(
      validateRetryPolicy({ maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 1_000, backoffBps: 10_000 }),
    ).toEqual({ ok: false, reason: "invalid-base-delay" });
    expect(
      validateRetryPolicy({ maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 0, backoffBps: 10_000 }),
    ).toEqual({ ok: false, reason: "invalid-max-delay" });
  });

  it("rejects an out-of-range backoff multiplier", () => {
    expect(
      validateRetryPolicy({ maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 1_000, backoffBps: 0 }),
    ).toEqual({ ok: false, reason: "invalid-backoff-bps" });
    expect(
      validateRetryPolicy({ maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 1_000, backoffBps: 2_000_000_000 }),
    ).toEqual({ ok: false, reason: "invalid-backoff-bps" });
  });

  it("rejects maxDelayMs below baseDelayMs", () => {
    expect(
      validateRetryPolicy({ maxAttempts: 3, baseDelayMs: 5_000, maxDelayMs: 1_000, backoffBps: 10_000 }),
    ).toEqual({ ok: false, reason: "max-below-base" });
  });
});
