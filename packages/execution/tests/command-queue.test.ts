/**
 * Command queue at truth grade tests (F220B, Wave 2).
 *
 * Behavior under test: idempotent submit (dedupe), ack/complete/fail
 * lifecycle, deterministic backoff schedule, dead-letter after max attempts,
 * tenant fail-closed, due-command ordering.
 */
import { describe, it, expect } from "vitest";
import {
  createCommandQueue,
  submitCommand,
  ackCommand,
  completeCommand,
  failCommand,
  dueCommands,
  deadLetteredCommands,
  readCommand,
  backoffDelayMs,
  DEFAULT_RETRY_POLICY,
} from "../src/index.ts";
import type { CommandQueueState, QueuedCommand } from "../src/index.ts";

function queue(retryPolicy = DEFAULT_RETRY_POLICY): CommandQueueState {
  const q = createCommandQueue("t1", retryPolicy);
  if (!q.ok) throw new Error(q.reason);
  return q.state;
}

function submit(state: CommandQueueState, key = "k1", at = 100): { state: CommandQueueState; command: QueuedCommand } {
  const r = submitCommand(state, { idempotencyKey: key, capabilityId: "cap.restart", at, tenantId: "t1" });
  if (!r.ok) throw new Error(r.reason);
  return { state: r.state, command: r.command };
}

// ---------- Deterministic backoff ----------

describe("deterministic backoff schedule", () => {
  it("computes base * 2^(attempt-1), capped at maxBackoffMs — all integers", () => {
    expect(backoffDelayMs(1)).toBe(1_000);
    expect(backoffDelayMs(2)).toBe(2_000);
    expect(backoffDelayMs(3)).toBe(4_000);
    expect(backoffDelayMs(4)).toBe(8_000);
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      expect(Number.isInteger(backoffDelayMs(attempt))).toBe(true);
      expect(backoffDelayMs(attempt)).toBeLessThanOrEqual(DEFAULT_RETRY_POLICY.maxBackoffMs);
    }
  });

  it("caps at maxBackoffMs", () => {
    expect(backoffDelayMs(6)).toBe(30_000); // 32000 -> capped
    expect(backoffDelayMs(50)).toBe(30_000);
  });

  it("is pure — the same attempt always yields the same delay", () => {
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      expect(backoffDelayMs(attempt)).toBe(backoffDelayMs(attempt));
    }
  });

  it("honors a custom policy", () => {
    const policy = { maxAttempts: 5, baseBackoffMs: 100, maxBackoffMs: 500 };
    expect(backoffDelayMs(1, policy)).toBe(100);
    expect(backoffDelayMs(2, policy)).toBe(200);
    expect(backoffDelayMs(4, policy)).toBe(500); // 800 -> capped
  });

  it("degenerate attempt numbers fall back to the base delay deterministically", () => {
    expect(backoffDelayMs(0)).toBe(DEFAULT_RETRY_POLICY.baseBackoffMs);
    expect(backoffDelayMs(-3)).toBe(DEFAULT_RETRY_POLICY.baseBackoffMs);
    expect(backoffDelayMs(1.5)).toBe(DEFAULT_RETRY_POLICY.baseBackoffMs);
  });
});

// ---------- Submit + idempotency dedupe ----------

describe("submit with idempotency dedupe", () => {
  it("submits a command in queued state with attempt 1 due immediately", () => {
    const { state, command } = submit(queue());
    expect(command.status).toBe("queued");
    expect(command.attempts).toBe(1);
    expect(command.nextAttemptAt).toBe(100);
    expect(command.submissionSeq).toBe(1);
    expect(state.commands).toHaveLength(1);
  });

  it("a duplicate idempotency key returns the ORIGINAL command with duplicate=true and NO state change", () => {
    const first = submit(queue());
    const r = submitCommand(first.state, { idempotencyKey: "k1", capabilityId: "cap.restart", at: 999, tenantId: "t1" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.duplicate).toBe(true);
      expect(r.command).toBe(first.command); // identical ack — never double execution
      expect(r.state).toBe(first.state);     // state unchanged
    }
  });

  it("refuses a missing idempotency key", () => {
    const r = submitCommand(queue(), { idempotencyKey: "", capabilityId: "c", at: 1, tenantId: "t1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("submit.missing-idempotency-key");
  });

  it("refuses a missing capability id", () => {
    const r = submitCommand(queue(), { idempotencyKey: "k", capabilityId: "", at: 1, tenantId: "t1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("submit.missing-capability-id");
  });

  it("refuses a cross-tenant submit (A8 fail-closed)", () => {
    const r = submitCommand(queue(), { idempotencyKey: "k", capabilityId: "c", at: 1, tenantId: "t2" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("submit.tenant-mismatch");
  });

  it("refuses a missing tenant scope on submit", () => {
    const r = submitCommand(queue(), { idempotencyKey: "k", capabilityId: "c", at: 1, tenantId: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("submit.missing-tenant");
  });

  it("refuses an invalid at (negative / non-integer)", () => {
    expect(submitCommand(queue(), { idempotencyKey: "k", capabilityId: "c", at: -1, tenantId: "t1" }).ok).toBe(false);
    expect(submitCommand(queue(), { idempotencyKey: "k", capabilityId: "c", at: 1.5, tenantId: "t1" }).ok).toBe(false);
  });

  it("createCommandQueue refuses an empty tenant scope", () => {
    expect(createCommandQueue("").ok).toBe(false);
  });

  it("submission order is preserved deterministically", () => {
    const s1 = submit(queue(), "a");
    const s2 = submit(s1.state, "b");
    const s3 = submit(s2.state, "c");
    expect(s3.state.commands.map((c) => c.idempotencyKey)).toEqual(["a", "b", "c"]);
    expect(s3.state.commands.map((c) => c.submissionSeq)).toEqual([1, 2, 3]);
  });
});

// ---------- Ack / complete / fail ----------

describe("ack -> complete/fail lifecycle", () => {
  it("ack moves a queued command to in-flight", () => {
    const s = submit(queue());
    const r = ackCommand(s.state, "k1", 150, "t1");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.command.status).toBe("in-flight");
  });

  it("ack refuses unknown keys, non-queued commands, cross-tenant and invalid at", () => {
    const s = submit(queue());
    expect(ackCommand(s.state, "nope", 150, "t1").ok).toBe(false);
    const acked = ackCommand(s.state, "k1", 150, "t1");
    if (!acked.ok) throw new Error(acked.reason);
    expect(ackCommand(acked.state, "k1", 160, "t1").ok).toBe(false); // not queued anymore
    expect(ackCommand(s.state, "k1", 150, "t2").ok).toBe(false);
    expect(ackCommand(s.state, "k1", -1, "t1").ok).toBe(false);
    expect(ackCommand(s.state, "k1", 150, "").ok).toBe(false);
  });

  it("complete settles an in-flight command with outputs", () => {
    const s = submit(queue());
    const acked = ackCommand(s.state, "k1", 150, "t1");
    if (!acked.ok) throw new Error(acked.reason);
    const r = completeCommand(acked.state, "k1", { ok: true }, 200, "t1");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.command.status).toBe("completed");
      expect(r.command.completedOutputs).toEqual({ ok: true });
      expect(r.command.completedAt).toBe(200);
    }
  });

  it("complete refuses unknown keys, non-in-flight commands, cross-tenant, invalid at", () => {
    const s = submit(queue());
    expect(completeCommand(s.state, "k1", {}, 200, "t1").ok).toBe(false); // queued, not in-flight
    expect(completeCommand(s.state, "nope", {}, 200, "t1").ok).toBe(false);
    const acked = ackCommand(s.state, "k1", 150, "t1");
    if (!acked.ok) throw new Error(acked.reason);
    expect(completeCommand(acked.state, "k1", {}, 200, "t2").ok).toBe(false);
    expect(completeCommand(acked.state, "k1", {}, -5, "t1").ok).toBe(false);
  });

  it("fail re-queues with the deterministic backoff schedule", () => {
    const s = submit(queue());
    const acked = ackCommand(s.state, "k1", 150, "t1");
    if (!acked.ok) throw new Error(acked.reason);
    const r = failCommand(acked.state, "k1", "device busy", 200, "t1");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.command.status).toBe("queued");
      expect(r.command.attempts).toBe(2);
      expect(r.command.nextAttemptAt).toBe(200 + backoffDelayMs(2)); // 200 + 2000
      expect(r.command.lastFailureReason).toBe("device busy");
    }
  });

  it("the retried command is NOT due until nextAttemptAt", () => {
    let state = submit(queue()).state;
    const acked = ackCommand(state, "k1", 150, "t1");
    if (!acked.ok) throw new Error(acked.reason);
    const failed = failCommand(acked.state, "k1", "x", 200, "t1");
    if (!failed.ok) throw new Error(failed.reason);
    expect(dueCommands(failed.state, 2_199)).toHaveLength(0);
    expect(dueCommands(failed.state, 2_200)).toHaveLength(1);
  });

  it("dead-letters after maxAttempts with the failure reason preserved", () => {
    const policy = { maxAttempts: 2, baseBackoffMs: 100, maxBackoffMs: 1_000 };
    let state = submit(queue(policy), "k1", 100).state;
    const ack1 = ackCommand(state, "k1", 110, "t1");
    if (!ack1.ok) throw new Error(ack1.reason);
    const failedOnce = failCommand(ack1.state, "k1", "first failure", 120, "t1");
    if (!failedOnce.ok) throw new Error(failedOnce.reason);
    // attempt 2 becomes due at 120 + 200 = 320
    state = failedOnce.state;
    const ack2 = ackCommand(state, "k1", 320, "t1");
    if (!ack2.ok) throw new Error(ack2.reason);
    state = ack2.state;
    const failedTwice = failCommand(state, "k1", "second failure", 330, "t1");
    if (!failedTwice.ok) throw new Error(failedTwice.reason);
    expect(failedTwice.command.status).toBe("dead-lettered");
    expect(failedTwice.command.attempts).toBe(2); // attempts started, not more
    expect(failedTwice.command.lastFailureReason).toBe("second failure");
    expect(failedTwice.command.deadLetteredAt).toBe(330);
    expect(deadLetteredCommands(failedTwice.state).map((c) => c.idempotencyKey)).toEqual(["k1"]);
  });

  it("fail refuses unknown keys, non-in-flight commands, cross-tenant, invalid at", () => {
    const s = submit(queue());
    expect(failCommand(s.state, "nope", "r", 200, "t1").ok).toBe(false);
    expect(failCommand(s.state, "k1", "r", 200, "t1").ok).toBe(false); // queued not in-flight
    const acked = ackCommand(s.state, "k1", 150, "t1");
    if (!acked.ok) throw new Error(acked.reason);
    expect(failCommand(acked.state, "k1", "r", 200, "t2").ok).toBe(false);
    expect(failCommand(acked.state, "k1", "r", 2.5, "t1").ok).toBe(false);
  });
});

// ---------- Due ordering + reads ----------

describe("due commands and tenant fail-closed reads", () => {
  it("due commands are ordered by arrival (submissionSeq), not by key", () => {
    let state = queue();
    state = submit(state, "z-key", 100).state;
    state = submit(state, "a-key", 100).state;
    state = submit(state, "m-key", 100).state;
    expect(dueCommands(state, 100).map((c) => c.idempotencyKey)).toEqual(["z-key", "a-key", "m-key"]);
  });

  it("commands not yet due are excluded", () => {
    let state = queue();
    state = submit(state, "now", 100).state;
    state = submit(state, "later", 500).state;
    expect(dueCommands(state, 100).map((c) => c.idempotencyKey)).toEqual(["now"]);
    expect(dueCommands(state, 500).map((c) => c.idempotencyKey)).toEqual(["now", "later"]);
  });

  it("readCommand refuses cross-tenant and missing-tenant scopes (A8)", () => {
    const s = submit(queue());
    expect(readCommand(s.state, "k1", "t2").ok).toBe(false);
    expect(readCommand(s.state, "k1", "").ok).toBe(false);
    expect(readCommand(s.state, "nope", "t1").ok).toBe(false);
    const r = readCommand(s.state, "k1", "t1");
    expect(r.ok).toBe(true);
  });

  it("property-style loop: repeated submit/ack/fail cycles are byte-identical", () => {
    const run = () => {
      let state = queue({ maxAttempts: 3, baseBackoffMs: 10, maxBackoffMs: 100 });
      for (let i = 0; i < 3; i += 1) {
        state = submit(state, `k${i}`, 100 + i).state;
      }
      let round = state;
      for (let cycle = 0; cycle < 2; cycle += 1) {
        for (const c of dueCommands(round, 10_000)) {
          const ack = ackCommand(round, c.idempotencyKey, 10_000, "t1");
          if (ack.ok) round = ack.state;
          const fail = failCommand(round, c.idempotencyKey, "synthetic", 10_000, "t1");
          if (fail.ok) round = fail.state;
        }
      }
      return JSON.stringify(round);
    };
    expect(run()).toBe(run());
  });
});
