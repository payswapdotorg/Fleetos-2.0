/**
 * Execution kernel tests — queue, at-least-once + idempotency,
 * verification hooks, degraded states, type-encoded boundary.
 *
 * Wave 1 (F210B) additions.
 */
import { describe, it, expect } from "vitest";
import {
  InMemoryExecutionQueue,
  makeQueueEntry,
  drainQueue,
  assertExecutionNeverAuthorizes,
  executeWithVerification,
  makeReferenceVerificationHook,
  verifyAtLeastOnceIdempotencyIntersection,
  authorizeCommand,
  makeReferenceTransport,
} from "../src/index.ts";
import type { GuardianDecision } from "@fleetos/policy/policy";

function allowDecision(): GuardianDecision {
  return {
    verdict: "ALLOW",
    reasonCode: "allow.matched_rule",
    matchedRuleId: "rule.allow_low_risk_read",
    tenantId: "tenant-1",
    capabilityId: "cap.test",
    conditions: [],
    decisionDigest: "dig1",
  };
}

function makeCommand(capabilityId = "cap.test") {
  const decision = allowDecision();
  const result = authorizeCommand(
    decision,
    { capabilityId, inputs: {} },
    { tenantId: "tenant-1" },
    undefined,
    "k1",
  );
  if (!result.ok) throw new Error("authorizeCommand failed");
  return result.command;
}

// ---------- Queue ----------

describe("InMemoryExecutionQueue", () => {
  it("enqueue and dequeue in FIFO order", async () => {
    const q = new InMemoryExecutionQueue();
    const cmd = makeCommand();
    await q.enqueue(makeQueueEntry(cmd, "t1"));
    await q.enqueue(makeQueueEntry(cmd, "t2"));
    expect(await q.size()).toBe(2);
    const first = await q.dequeue();
    expect(first).not.toBeNull();
    expect(first!.enqueuedAt).toBe("t1");
    const second = await q.dequeue();
    expect(second!.enqueuedAt).toBe("t2");
    expect(await q.size()).toBe(0);
  });

  it("dequeue returns null on empty queue", async () => {
    const q = new InMemoryExecutionQueue();
    expect(await q.dequeue()).toBeNull();
  });
});

describe("makeQueueEntry", () => {
  it("builds an entry with default maxAttempts", () => {
    const entry = makeQueueEntry(makeCommand(), "t1");
    expect(entry.maxAttempts).toBe(3);
    expect(entry.attempts).toBe(0);
    expect(entry.queueId).toContain("q-");
  });

  it("respects custom maxAttempts", () => {
    const entry = makeQueueEntry(makeCommand(), "t1", 5);
    expect(entry.maxAttempts).toBe(5);
  });
});

// ---------- Drain ----------

describe("drainQueue", () => {
  it("drains all entries and returns results", async () => {
    const q = new InMemoryExecutionQueue();
    const cmd = makeCommand();
    await q.enqueue(makeQueueEntry(cmd, "t1"));
    await q.enqueue(makeQueueEntry(cmd, "t2"));

    const transport = makeReferenceTransport(async () => ({
      commandId: "c1",
      state: "succeeded" as const,
      outputs: {},
      startedAt: "t1",
      endedAt: "t1",
      transportName: "reference.in-memory",
    }));

    const result = await drainQueue(q, transport);
    expect(result.drained).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.remaining).toBe(0);
    expect(result.results).toHaveLength(2);
  });

  it("re-enqueues failed entries up to maxAttempts (at-least-once)", async () => {
    const q = new InMemoryExecutionQueue();
    const cmd = makeCommand();
    await q.enqueue(makeQueueEntry(cmd, "t1", 2));

    let attemptCount = 0;
    const transport = makeReferenceTransport(async () => {
      attemptCount += 1;
      return {
        commandId: "c1",
        state: "failed" as const,
        outputs: {},
        failureReason: "transient",
        startedAt: "t1",
        endedAt: "t1",
        transportName: "reference.in-memory",
      };
    });

    // drain processes everything until empty — including retries within the same drain.
    // With maxAttempts=2, the entry is attempted twice (initial + 1 retry) and then
    // the queue is empty.
    const r1 = await drainQueue(q, transport);
    expect(r1.drained).toBe(2); // initial attempt + 1 retry
    expect(r1.remaining).toBe(0); // maxAttempts reached — no more re-enqueues
    expect(attemptCount).toBe(2);
    expect(await q.size()).toBe(0); // queue is empty
  });

  it("calls onResult callback for each entry", async () => {
    const q = new InMemoryExecutionQueue();
    await q.enqueue(makeQueueEntry(makeCommand(), "t1"));

    const transport = makeReferenceTransport(async () => ({
      commandId: "c1",
      state: "succeeded" as const,
      outputs: {},
      startedAt: "t1",
      endedAt: "t1",
      transportName: "reference.in-memory",
    }));

    const seen: string[] = [];
    await drainQueue(q, transport, (entry) => {
      seen.push(entry.queueId);
    });
    expect(seen).toHaveLength(1);
  });
});

// ---------- Type-encoded boundary ----------

describe("assertExecutionNeverAuthorizes", () => {
  it("returns ok=true for the execution module surface", () => {
    const moduleExports = {
      executeCommand: () => {},
      authorizeCommand: () => {}, // this is the COMMAND constructor, NOT authorization
      drainQueue: () => {},
    };
    // authorizeCommand constructs an AuthorizedCommand from a GuardianDecision,
    // but the FORBIDDEN list checks for "authorize" — which is NOT in the list.
    // The forbidden list is: authorize, evaluateCapability, authorizeAdoption, etc.
    const probe = assertExecutionNeverAuthorizes(moduleExports);
    expect(probe.ok).toBe(true);
    expect(probe.forbidden).toEqual([]);
  });

  it("catches a forbidden 'authorize' function", () => {
    const badExports = { authorize: () => {} };
    const probe = assertExecutionNeverAuthorizes(badExports);
    expect(probe.ok).toBe(false);
    expect(probe.forbidden).toContain("authorize");
  });

  it("catches 'evaluateCapability' — a Guardian function", () => {
    const badExports = { evaluateCapability: () => {} };
    const probe = assertExecutionNeverAuthorizes(badExports);
    expect(probe.ok).toBe(false);
    expect(probe.forbidden).toContain("evaluateCapability");
  });
});

// ---------- Verification + degraded states ----------

describe("executeWithVerification", () => {
  it("returns verified=true when transport succeeds and hook verifies", async () => {
    const cmd = makeCommand();
    const transport = makeReferenceTransport(async () => ({
      commandId: cmd.idempotencyKey,
      state: "succeeded" as const,
      outputs: { ok: true },
      startedAt: "t1",
      endedAt: "t2",
      transportName: "reference.in-memory",
    }));
    const hook = makeReferenceVerificationHook("reference.in-memory");

    const result = await executeWithVerification(transport, cmd, hook);
    expect(result.verification.verified).toBe(true);
    expect(result.degraded).toBeNull();
    expect(result.result.state).toBe("succeeded");
  });

  it("returns verified=false when transport fails", async () => {
    const cmd = makeCommand();
    const transport = makeReferenceTransport(async () => ({
      commandId: cmd.idempotencyKey,
      state: "failed" as const,
      outputs: {},
      failureReason: "device error",
      startedAt: "t1",
      endedAt: "t2",
      transportName: "reference.in-memory",
    }));
    const hook = makeReferenceVerificationHook("reference.in-memory");

    const result = await executeWithVerification(transport, cmd, hook);
    expect(result.verification.verified).toBe(false);
    expect(result.degraded).toBe("unknown_failure");
  });

  it("returns degraded=capability_empty for empty capabilityId", async () => {
    const cmd = makeCommand("");
    const transport = makeReferenceTransport(async () => ({
      commandId: cmd.idempotencyKey,
      state: "succeeded" as const,
      outputs: {},
      startedAt: "t1",
      endedAt: "t2",
      transportName: "reference.in-memory",
    }));
    const hook = makeReferenceVerificationHook("reference.in-memory");

    const result = await executeWithVerification(transport, cmd, hook);
    expect(result.degraded).toBe("capability_empty");
    expect(result.verification.verified).toBe(false);
  });

  it("returns degraded=timeout when transport throws", async () => {
    const cmd = makeCommand();
    const transport = makeReferenceTransport(async () => {
      throw new Error("timeout after 30000ms");
    });
    const hook = makeReferenceVerificationHook("reference.in-memory");

    const result = await executeWithVerification(transport, cmd, hook, 100);
    expect(result.degraded).toBe("timeout");
    expect(result.result.state).toBe("timeout");
    expect(result.verification.verified).toBe(false);
  });

  it("returns degraded=transport_unavailable for non-timeout errors", async () => {
    const cmd = makeCommand();
    const transport = makeReferenceTransport(async () => {
      throw new Error("connection refused");
    });
    const hook = makeReferenceVerificationHook("reference.in-memory");

    const result = await executeWithVerification(transport, cmd, hook, 100);
    expect(result.degraded).toBe("transport_unavailable");
  });
});

// ---------- At-least-once + idempotency intersection ----------

describe("verifyAtLeastOnceIdempotencyIntersection", () => {
  it("all unique keys => intersection holds", () => {
    const result = verifyAtLeastOnceIdempotencyIntersection([
      { idempotencyKey: "k1", executed: true },
      { idempotencyKey: "k2", executed: true },
      { idempotencyKey: "k3", executed: true },
    ]);
    expect(result.totalDispatches).toBe(3);
    expect(result.uniqueKeys).toBe(3);
    expect(result.effectiveExecutions).toBe(3);
    expect(result.intersectionHolds).toBe(true);
  });

  it("duplicates are deduplicated — intersection holds", () => {
    const result = verifyAtLeastOnceIdempotencyIntersection([
      { idempotencyKey: "k1", executed: true },
      { idempotencyKey: "k1", executed: true }, // duplicate
      { idempotencyKey: "k2", executed: true },
    ]);
    expect(result.totalDispatches).toBe(3);
    expect(result.uniqueKeys).toBe(2);
    expect(result.effectiveExecutions).toBe(2);
    expect(result.intersectionHolds).toBe(true);
  });

  it("intersection VIOLATED if a key was never executed", () => {
    const result = verifyAtLeastOnceIdempotencyIntersection([
      { idempotencyKey: "k1", executed: true },
      { idempotencyKey: "k2", executed: false }, // not executed!
    ]);
    expect(result.uniqueKeys).toBe(2);
    expect(result.effectiveExecutions).toBe(1);
    expect(result.intersectionHolds).toBe(false);
  });
});

// ---------- Integration ----------

describe("Queue + drain + verification integration", () => {
  it("enqueues, drains, and verifies with honest degradation", async () => {
    const q = new InMemoryExecutionQueue();
    const cmd = makeCommand();
    await q.enqueue(makeQueueEntry(cmd, "t1"));

    const transport = makeReferenceTransport(async (c) => ({
      commandId: c.idempotencyKey,
      state: "succeeded" as const,
      outputs: { result: "ok" },
      startedAt: "t1",
      endedAt: "t2",
      transportName: "reference.in-memory",
    }));

    const drainResult = await drainQueue(q, transport);
    expect(drainResult.drained).toBe(1);
    expect(drainResult.results[0]!.state).toBe("succeeded");

    const hook = makeReferenceVerificationHook("reference.in-memory");
    const verified = await executeWithVerification(transport, cmd, hook);
    expect(verified.verification.verified).toBe(true);
  });
});
