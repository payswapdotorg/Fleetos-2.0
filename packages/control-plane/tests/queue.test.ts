/**
 * @fleetos/control-plane — CommandQueue tests.
 *
 * The behavioral core of the command bus: idempotency (double-submit,
 * the 100-submit storm), the submit → ack → complete/fail lifecycle,
 * exact retry schedules, dead-letter paths, drain semantics, and tenant
 * fail-closed access.
 */

import { describe, expect, it } from "vitest";
import {
  CommandQueue,
  queueAsSubmitPort,
  type CommandSubmitPortShape,
  type Result,
  type SubmitCommandInput,
} from "../src/index.js";
import { ctxFor, NOW, TENANT_A, TENANT_B } from "./helpers.js";

function command(overrides: Partial<SubmitCommandInput> = {}): SubmitCommandInput {
  return {
    kind: "work-order",
    payload: { stageId: "s1" },
    idempotencyKey: "key-001",
    issuedAt: NOW,
    ...overrides,
  };
}

describe("CommandQueue — submit", () => {
  it("submits a command: generated id, queued state, audit digest", () => {
    const queue = new CommandQueue();
    const ack = queue.submit({ ctx: ctxFor(TENANT_A), command: command(), now: NOW });
    expect(ack.ok).toBe(true);
    if (!ack.ok) return;
    expect(ack.value.command.id).toBe("cmd_0000000001");
    expect(ack.value.command.kind).toBe("work-order");
    expect(ack.value.command.tenantId).toBe(TENANT_A);
    expect(ack.value.command.idempotencyKey).toBe("key-001");
    expect(ack.value.command.availableAt).toBe(NOW);
    expect(ack.value.command.auditDigest).toHaveLength(64);
    expect(ack.value.duplicate).toBe(false);
    const record = queue.findById(ctxFor(TENANT_A), "cmd_0000000001");
    expect(record.ok).toBe(true);
    if (record.ok) expect(record.value.state).toBe("queued");
  });

  it("rejects a submit with a missing kind", () => {
    const queue = new CommandQueue();
    const ack = queue.submit({
      ctx: ctxFor(TENANT_A),
      command: command({ kind: "" }),
      now: NOW,
    });
    expect(ack).toEqual({ ok: false, reason: "missing-kind" });
  });

  it("rejects a submit with a missing idempotency key", () => {
    const queue = new CommandQueue();
    const ack = queue.submit({
      ctx: ctxFor(TENANT_A),
      command: command({ idempotencyKey: "" }),
      now: NOW,
    });
    expect(ack).toEqual({ ok: false, reason: "missing-idempotency-key" });
  });

  it("rejects a submit with an invalid issuedAt (zero / negative / NaN)", () => {
    const queue = new CommandQueue();
    expect(
      queue.submit({ ctx: ctxFor(TENANT_A), command: command({ issuedAt: 0 }), now: NOW }),
    ).toEqual({ ok: false, reason: "invalid-issued-at" });
    expect(
      queue.submit({ ctx: ctxFor(TENANT_A), command: command({ issuedAt: -5 }), now: NOW }),
    ).toEqual({ ok: false, reason: "invalid-issued-at" });
    expect(
      queue.submit({
        ctx: ctxFor(TENANT_A),
        command: command({ issuedAt: Number.NaN }),
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: "invalid-issued-at" });
  });

  it("rejects a submit with an invalid notBefore", () => {
    const queue = new CommandQueue();
    const ack = queue.submit({
      ctx: ctxFor(TENANT_A),
      command: command({ notBefore: Number.NaN }),
      now: NOW,
    });
    expect(ack).toEqual({ ok: false, reason: "invalid-not-before" });
  });

  it("double-submit returns the ORIGINAL ack with duplicate=true", () => {
    const queue = new CommandQueue();
    const first = queue.submit({ ctx: ctxFor(TENANT_A), command: command(), now: NOW });
    const second = queue.submit({ ctx: ctxFor(TENANT_A), command: command(), now: NOW + 500 });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.value.command.id).toBe(first.value.command.id);
    expect(second.value.command).toEqual(first.value.command);
    expect(second.value.duplicate).toBe(true);
    expect(queue.listByTenant(ctxFor(TENANT_A))).toHaveLength(1);
  });

  it("THE DUPLICATE-SUBMIT STORM — 100 identical submits → exactly ONE command", () => {
    const queue = new CommandQueue();
    const ids = new Set<string>();
    let duplicates = 0;
    for (let i = 0; i < 100; i++) {
      const ack = queue.submit({
        ctx: ctxFor(TENANT_A),
        command: command({ payload: { i } }), // payload varies; key does not
        now: NOW + i,
      });
      expect(ack.ok).toBe(true);
      if (!ack.ok) return;
      ids.add(String(ack.value.command.id));
      if (ack.value.duplicate) duplicates += 1;
    }
    expect(ids.size).toBe(1);
    expect(duplicates).toBe(99);
    expect(queue.listByTenant(ctxFor(TENANT_A))).toHaveLength(1);
  });

  it("the same idempotency key under a DIFFERENT tenant is a distinct command", () => {
    const queue = new CommandQueue();
    const a = queue.submit({ ctx: ctxFor(TENANT_A), command: command(), now: NOW });
    const b = queue.submit({ ctx: ctxFor(TENANT_B), command: command(), now: NOW });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    // Command ids are per-tenant namespaced (like the ledger chains);
    // the dedupe key is tenant-scoped, so tenant B's submit is NOT a
    // duplicate of tenant A's.
    expect(b.value.duplicate).toBe(false);
    expect(b.value.command.tenantId).toBe(TENANT_B);
    expect(queue.listByTenant(ctxFor(TENANT_A))).toHaveLength(1);
    expect(queue.listByTenant(ctxFor(TENANT_B))).toHaveLength(1);
    // And the records are isolated: a second tenant-A command is invisible
    // to tenant B even though B's own cmd_0000000001 exists.
    queue.submit({
      ctx: ctxFor(TENANT_A),
      command: command({ idempotencyKey: "key-002" }),
      now: NOW,
    });
    expect(queue.findById(ctxFor(TENANT_B), "cmd_0000000002")).toEqual({
      ok: false,
      reason: "command-not-found",
    });
    expect(queue.findById(ctxFor(TENANT_A), "cmd_0000000002").ok).toBe(true);
  });

  it("audit digests are deterministic: two queues, same submits → identical digests", () => {
    const queueA = new CommandQueue();
    const queueB = new CommandQueue();
    const a = queueA.submit({ ctx: ctxFor(TENANT_A), command: command(), now: NOW });
    const b = queueB.submit({ ctx: ctxFor(TENANT_A), command: command(), now: NOW });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.value.command.auditDigest).toBe(b.value.command.auditDigest);
  });

  it("notBefore delays availability (availableAt = max(issuedAt, notBefore))", () => {
    const queue = new CommandQueue();
    const ack = queue.submit({
      ctx: ctxFor(TENANT_A),
      command: command({ notBefore: NOW + 5_000 }),
      now: NOW,
    });
    expect(ack.ok).toBe(true);
    if (!ack.ok) return;
    expect(ack.value.command.availableAt).toBe(NOW + 5_000);
  });
});

describe("CommandQueue — ack (claim)", () => {
  it("ack transitions queued → executing and increments attempts", () => {
    const queue = new CommandQueue();
    queue.submit({ ctx: ctxFor(TENANT_A), command: command(), now: NOW });
    const ack = queue.ack({ ctx: ctxFor(TENANT_A), commandId: "cmd_0000000001", now: NOW });
    expect(ack.ok).toBe(true);
    if (!ack.ok) return;
    expect(ack.value.record.state).toBe("executing");
    expect(ack.value.record.attempts).toBe(1);
    expect(ack.value.duplicate).toBe(false);
  });

  it("ack is idempotent — a second ack does NOT increment attempts", () => {
    const queue = new CommandQueue();
    queue.submit({ ctx: ctxFor(TENANT_A), command: command(), now: NOW });
    queue.ack({ ctx: ctxFor(TENANT_A), commandId: "cmd_0000000001", now: NOW });
    const second = queue.ack({ ctx: ctxFor(TENANT_A), commandId: "cmd_0000000001", now: NOW + 1 });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.duplicate).toBe(true);
    expect(second.value.record.attempts).toBe(1);
  });

  it("ack on a completed command is illegal-state", () => {
    const queue = new CommandQueue();
    queue.submit({ ctx: ctxFor(TENANT_A), command: command(), now: NOW });
    queue.ack({ ctx: ctxFor(TENANT_A), commandId: "cmd_0000000001", now: NOW });
    queue.complete({ ctx: ctxFor(TENANT_A), commandId: "cmd_0000000001", now: NOW + 1 });
    expect(
      queue.ack({ ctx: ctxFor(TENANT_A), commandId: "cmd_0000000001", now: NOW + 2 }),
    ).toEqual({ ok: false, reason: "illegal-state" });
  });

  it("ack on a dead-lettered command is illegal-state", () => {
    const queue = new CommandQueue({ policy: { maxAttempts: 1, baseDelayMs: 100, maxDelayMs: 1_000, backoffBps: 20_000 } });
    queue.submit({ ctx: ctxFor(TENANT_A), command: command(), now: NOW });
    queue.ack({ ctx: ctxFor(TENANT_A), commandId: "cmd_0000000001", now: NOW });
    queue.fail({ ctx: ctxFor(TENANT_A), commandId: "cmd_0000000001", reason: "boom", now: NOW });
    expect(
      queue.ack({ ctx: ctxFor(TENANT_A), commandId: "cmd_0000000001", now: NOW + 1 }),
    ).toEqual({ ok: false, reason: "illegal-state" });
  });

  it("cross-tenant ack fails closed: command-not-found (no existence leak)", () => {
    const queue = new CommandQueue();
    queue.submit({ ctx: ctxFor(TENANT_A), command: command(), now: NOW });
    expect(
      queue.ack({ ctx: ctxFor(TENANT_B), commandId: "cmd_0000000001", now: NOW }),
    ).toEqual({ ok: false, reason: "command-not-found" });
  });

  it("an unknown command id is command-not-found", () => {
    const queue = new CommandQueue();
    expect(
      queue.ack({ ctx: ctxFor(TENANT_A), commandId: "cmd_9999999999", now: NOW }),
    ).toEqual({ ok: false, reason: "command-not-found" });
  });
});

describe("CommandQueue — complete", () => {
  it("complete transitions executing → completed with the result", () => {
    const queue = new CommandQueue();
    queue.submit({ ctx: ctxFor(TENANT_A), command: command(), now: NOW });
    queue.ack({ ctx: ctxFor(TENANT_A), commandId: "cmd_0000000001", now: NOW });
    const done = queue.complete({
      ctx: ctxFor(TENANT_A),
      commandId: "cmd_0000000001",
      result: { ok: true },
      now: NOW + 10,
    });
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.value.outcome.state).toBe("completed");
    expect(done.value.outcome.reason).toBeNull();
    expect(done.value.outcome.at).toBe(NOW + 10);
    expect(done.value.duplicate).toBe(false);
  });

  it("complete is idempotent — the second complete returns the original outcome", () => {
    const queue = new CommandQueue();
    queue.submit({ ctx: ctxFor(TENANT_A), command: command(), now: NOW });
    queue.ack({ ctx: ctxFor(TENANT_A), commandId: "cmd_0000000001", now: NOW });
    queue.complete({ ctx: ctxFor(TENANT_A), commandId: "cmd_0000000001", now: NOW + 10 });
    const again = queue.complete({
      ctx: ctxFor(TENANT_A),
      commandId: "cmd_0000000001",
      now: NOW + 20,
    });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.value.duplicate).toBe(true);
    expect(again.value.outcome.at).toBe(NOW + 10); // original completion time
  });

  it("complete without a claim (queued) is illegal-state", () => {
    const queue = new CommandQueue();
    queue.submit({ ctx: ctxFor(TENANT_A), command: command(), now: NOW });
    expect(
      queue.complete({ ctx: ctxFor(TENANT_A), commandId: "cmd_0000000001", now: NOW }),
    ).toEqual({ ok: false, reason: "illegal-state" });
  });

  it("cross-tenant complete fails closed: command-not-found", () => {
    const queue = new CommandQueue();
    queue.submit({ ctx: ctxFor(TENANT_A), command: command(), now: NOW });
    queue.ack({ ctx: ctxFor(TENANT_A), commandId: "cmd_0000000001", now: NOW });
    expect(
      queue.complete({ ctx: ctxFor(TENANT_B), commandId: "cmd_0000000001", now: NOW }),
    ).toEqual({ ok: false, reason: "command-not-found" });
  });
});

describe("CommandQueue — fail / retry / dead-letter", () => {
  const policy = {
    maxAttempts: 4,
    baseDelayMs: 1_000,
    maxDelayMs: 25_000,
    backoffBps: 15_000,
  };

  it("fail schedules the retry at EXACTLY now + delay(failures)", () => {
    const queue = new CommandQueue({ policy });
    queue.submit({ ctx: ctxFor(TENANT_A), command: command(), now: NOW });
    queue.ack({ ctx: ctxFor(TENANT_A), commandId: "cmd_0000000001", now: NOW });
    const failure = queue.fail({
      ctx: ctxFor(TENANT_A),
      commandId: "cmd_0000000001",
      reason: "executor-error",
      now: NOW,
    });
    expect(failure.ok).toBe(true);
    if (!failure.ok) return;
    expect(failure.value.state).toBe("retry-scheduled");
    expect(failure.value.failures).toBe(1);
    // delay(1) = base = 1000 → retry at NOW + 1000
    expect(failure.value.nextAttemptAt).toBe(NOW + 1_000);
    expect(failure.value.reason).toBe("executor-error");
  });

  it("the full retry ladder is exact: 1000 / 1500 / 2250 delays", () => {
    const queue = new CommandQueue({ policy });
    queue.submit({ ctx: ctxFor(TENANT_A), command: command(), now: NOW });
    let now = NOW;
    const retryTimes: Array<number | null> = [];
    for (let attempt = 1; attempt <= 3; attempt++) {
      queue.ack({ ctx: ctxFor(TENANT_A), commandId: "cmd_0000000001", now });
      const failure = queue.fail({
        ctx: ctxFor(TENANT_A),
        commandId: "cmd_0000000001",
        reason: "executor-error",
        now,
      });
      expect(failure.ok).toBe(true);
      if (!failure.ok) return;
      retryTimes.push(failure.value.nextAttemptAt);
      now = failure.value.nextAttemptAt ?? now;
    }
    // t1 = NOW + 1000; t2 = t1 + 1500; t3 = t2 + 2250
    expect(retryTimes).toEqual([NOW + 1_000, NOW + 2_500, NOW + 4_750]);
  });

  it("dead-letters after maxAttempts with reason max-attempts-exceeded", () => {
    const queue = new CommandQueue({ policy });
    queue.submit({ ctx: ctxFor(TENANT_A), command: command(), now: NOW });
    let now = NOW;
    let last;
    for (let attempt = 1; attempt <= 4; attempt++) {
      queue.ack({ ctx: ctxFor(TENANT_A), commandId: "cmd_0000000001", now });
      last = queue.fail({
        ctx: ctxFor(TENANT_A),
        commandId: "cmd_0000000001",
        reason: "executor-error",
        now,
      });
      expect(last.ok).toBe(true);
      if (!last.ok) return;
      now = last.value.nextAttemptAt ?? now;
    }
    expect(last).toBeDefined();
    if (!last || !last.ok) return;
    expect(last.value.state).toBe("dead-lettered");
    expect(last.value.reason).toBe("max-attempts-exceeded");
    expect(last.value.nextAttemptAt).toBeNull();
    const record = queue.findById(ctxFor(TENANT_A), "cmd_0000000001");
    expect(record.ok && record.value.lastFailureReason).toBe("executor-error");
    expect(record.ok && record.value.failures).toBe(4);
  });

  it("fail from the queued state (unclaimed) is illegal-state", () => {
    const queue = new CommandQueue({ policy });
    queue.submit({ ctx: ctxFor(TENANT_A), command: command(), now: NOW });
    expect(
      queue.fail({ ctx: ctxFor(TENANT_A), commandId: "cmd_0000000001", reason: "x", now: NOW }),
    ).toEqual({ ok: false, reason: "illegal-state" });
  });

  it("fail on a completed command is illegal-state", () => {
    const queue = new CommandQueue({ policy });
    queue.submit({ ctx: ctxFor(TENANT_A), command: command(), now: NOW });
    queue.ack({ ctx: ctxFor(TENANT_A), commandId: "cmd_0000000001", now: NOW });
    queue.complete({ ctx: ctxFor(TENANT_A), commandId: "cmd_0000000001", now: NOW });
    expect(
      queue.fail({ ctx: ctxFor(TENANT_A), commandId: "cmd_0000000001", reason: "x", now: NOW }),
    ).toEqual({ ok: false, reason: "illegal-state" });
  });
});

describe("CommandQueue — due / drain semantics", () => {
  it("due() lists queued commands whose availableAt has arrived", () => {
    const queue = new CommandQueue();
    queue.submit({
      ctx: ctxFor(TENANT_A),
      command: command({ idempotencyKey: "k1", notBefore: NOW + 1_000 }),
      now: NOW,
    });
    queue.submit({ ctx: ctxFor(TENANT_A), command: command({ idempotencyKey: "k2" }), now: NOW });
    expect(queue.due({ ctx: ctxFor(TENANT_A), now: NOW })).toHaveLength(1);
    expect(queue.due({ ctx: ctxFor(TENANT_A), now: NOW + 1_000 })).toHaveLength(2);
  });

  it("due() excludes retry-scheduled commands until their retry window opens", () => {
    const queue = new CommandQueue({
      policy: { maxAttempts: 5, baseDelayMs: 1_000, maxDelayMs: 60_000, backoffBps: 20_000 },
    });
    queue.submit({ ctx: ctxFor(TENANT_A), command: command(), now: NOW });
    queue.ack({ ctx: ctxFor(TENANT_A), commandId: "cmd_0000000001", now: NOW });
    queue.fail({ ctx: ctxFor(TENANT_A), commandId: "cmd_0000000001", reason: "x", now: NOW });
    expect(queue.due({ ctx: ctxFor(TENANT_A), now: NOW + 999 })).toHaveLength(0);
    expect(queue.due({ ctx: ctxFor(TENANT_A), now: NOW + 1_000 })).toHaveLength(1);
  });

  it("drain claims everything due at `now`; a second drain at the same now is empty", () => {
    const queue = new CommandQueue();
    for (let i = 1; i <= 3; i++) {
      queue.submit({
        ctx: ctxFor(TENANT_A),
        command: command({ idempotencyKey: `k${i}` }),
        now: NOW,
      });
    }
    const claimed = queue.drain({ ctx: ctxFor(TENANT_A), now: NOW });
    expect(claimed).toHaveLength(3);
    for (const record of claimed) {
      expect(record.state).toBe("executing");
      expect(record.attempts).toBe(1);
    }
    expect(queue.drain({ ctx: ctxFor(TENANT_A), now: NOW })).toHaveLength(0);
    expect(queue.due({ ctx: ctxFor(TENANT_A), now: NOW })).toHaveLength(0);
  });

  it("a retried command becomes due at the exact retry time and drains with attempts=2", () => {
    const queue = new CommandQueue({
      policy: { maxAttempts: 5, baseDelayMs: 1_000, maxDelayMs: 60_000, backoffBps: 20_000 },
    });
    queue.submit({ ctx: ctxFor(TENANT_A), command: command(), now: NOW });
    queue.ack({ ctx: ctxFor(TENANT_A), commandId: "cmd_0000000001", now: NOW });
    queue.fail({ ctx: ctxFor(TENANT_A), commandId: "cmd_0000000001", reason: "x", now: NOW });
    const claimed = queue.drain({ ctx: ctxFor(TENANT_A), now: NOW + 1_000 });
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.attempts).toBe(2);
    expect(claimed[0]?.state).toBe("executing");
  });

  it("drain is tenant-scoped: tenant B's drain never sees tenant A's commands", () => {
    const queue = new CommandQueue();
    queue.submit({ ctx: ctxFor(TENANT_A), command: command(), now: NOW });
    expect(queue.drain({ ctx: ctxFor(TENANT_B), now: NOW })).toHaveLength(0);
    expect(queue.drain({ ctx: ctxFor(TENANT_A), now: NOW })).toHaveLength(1);
  });
});

describe("CommandQueue — reads + tenant fail-closed", () => {
  it("findById cross-tenant fails closed: command-not-found", () => {
    const queue = new CommandQueue();
    queue.submit({ ctx: ctxFor(TENANT_A), command: command(), now: NOW });
    expect(queue.findById(ctxFor(TENANT_B), "cmd_0000000001")).toEqual({
      ok: false,
      reason: "command-not-found",
    });
  });

  it("listByTenant only ever returns the caller's tenant records", () => {
    const queue = new CommandQueue();
    queue.submit({ ctx: ctxFor(TENANT_A), command: command({ idempotencyKey: "a1" }), now: NOW });
    queue.submit({ ctx: ctxFor(TENANT_B), command: command({ idempotencyKey: "b1" }), now: NOW });
    const a = queue.listByTenant(ctxFor(TENANT_A));
    const b = queue.listByTenant(ctxFor(TENANT_B));
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0]?.envelope.tenantId).toBe(TENANT_A);
    expect(b[0]?.envelope.tenantId).toBe(TENANT_B);
  });
});

describe("queueAsSubmitPort — the mission composition seam", () => {
  it("satisfies the mission CommandSubmitPort structural mirror (compile-pinned)", () => {
    const queue = new CommandQueue();
    const port: CommandSubmitPortShape = queueAsSubmitPort(queue);
    const ack = port.submit({
      ctx: ctxFor(TENANT_A),
      command: { kind: "work-order", payload: {}, idempotencyKey: "wo:msn_1:s1", issuedAt: NOW },
    });
    expect(ack.ok).toBe(true);
    if (!ack.ok) return;
    expect(ack.value.commandId).toBe("cmd_0000000001");
    expect(ack.value.duplicate).toBe(false);
    const dup = port.submit({
      ctx: ctxFor(TENANT_A),
      command: { kind: "work-order", payload: {}, idempotencyKey: "wo:msn_1:s1", issuedAt: NOW },
    });
    expect(dup.ok && dup.value.duplicate).toBe(true);
    expect(dup.ok && dup.value.commandId).toBe("cmd_0000000001");
  });

  it("rejections pass through as machine-stable strings", () => {
    const queue = new CommandQueue();
    const port: CommandSubmitPortShape = queueAsSubmitPort(queue);
    const rejection: Result<{ commandId: string; duplicate: boolean }, string> = port.submit({
      ctx: ctxFor(TENANT_A),
      command: { kind: "", payload: {}, idempotencyKey: "k", issuedAt: NOW },
    });
    expect(rejection).toEqual({ ok: false, reason: "missing-kind" });
  });
});
