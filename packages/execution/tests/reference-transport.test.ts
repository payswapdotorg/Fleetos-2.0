/**
 * Reference transport (ack/timeout paths) + queue pump tests (F220B, Wave 2).
 *
 * Behavior under test: scripted transport consumes steps deterministically,
 * the ack path leaves commands in-flight, the timeout path is an honest
 * degraded state feeding the retry policy, the pump composes queue + ledger +
 * transport with idempotent submission and dead-letter after max attempts.
 */
import { describe, it, expect } from "vitest";
import {
  ScriptedReferenceTransport,
  pumpCommandQueue,
  queuedToAuthorized,
} from "../src/index.ts";
import {
  createCommandQueue,
  submitCommand,
  completeCommand,
  dueCommands,
} from "../src/command-queue.ts";
import { appendExecutionLedger, verifyExecutionLedger, replayExecutionLedger } from "../src/ledger.ts";
import type { CommandQueueState } from "../src/command-queue.ts";
import type { ExecutionLedgerEntry } from "../src/ledger.ts";

function freshQueue(retry = { maxAttempts: 3, baseBackoffMs: 1_000, maxBackoffMs: 30_000 }): CommandQueueState {
  const q = createCommandQueue("t1", retry);
  if (!q.ok) throw new Error(q.reason);
  return q.state;
}

function submit(state: CommandQueueState, key: string, at = 100): CommandQueueState {
  const r = submitCommand(state, { idempotencyKey: key, capabilityId: "cap.restart", at, tenantId: "t1", authorizationDigest: "auth-digest", verdict: "ALLOW" });
  if (!r.ok) throw new Error(r.reason);
  return r.state;
}

/** Append a `submitted` ledger entry per queued command — the operational submit trail. */
function submittedLedger(state: CommandQueueState): readonly ExecutionLedgerEntry[] {
  let ledger: readonly ExecutionLedgerEntry[] = [];
  for (const c of state.commands) {
    const r = appendExecutionLedger(ledger, { tenantId: "t1", idempotencyKey: c.idempotencyKey, kind: "submitted", at: c.submittedAt });
    if (!r.ok) throw new Error(r.reason);
    ledger = r.ledger;
  }
  return ledger;
}

// ---------- Scripted reference transport ----------

describe("scripted reference transport", () => {
  it("consumes the script in order — complete, fail, timeout, ack", async () => {
    const transport = new ScriptedReferenceTransport([
      { kind: "complete", outputs: { ok: 1 } },
      { kind: "fail", reason: "device busy" },
      { kind: "timeout" },
      { kind: "ack" },
    ], { baseAt: 1_000 });

    const cmd = queuedToAuthorized({
      idempotencyKey: "k1", tenantId: "t1", capabilityId: "cap.restart", payloadInputs: {},
      authorizationDigest: "d", verdict: "ALLOW", status: "queued", attempts: 1, submittedAt: 0,
      nextAttemptAt: 0, lastFailureReason: null, completedOutputs: null, completedAt: null,
      deadLetteredAt: null, submissionSeq: 1,
    });

    const r1 = await transport.dispatch(cmd);
    expect(r1.state).toBe("succeeded");
    expect(r1.outputs).toEqual({ ok: 1 });
    expect(r1.failureReason).toBeUndefined();

    const r2 = await transport.dispatch(cmd);
    expect(r2.state).toBe("failed");
    expect(r2.failureReason).toBe("device busy");

    const r3 = await transport.dispatch(cmd);
    expect(r3.state).toBe("timeout");
    expect(r3.failureReason).toBe("transport timeout");

    const r4 = await transport.dispatch(cmd);
    expect(r4.state).toBe("dispatched"); // the ack path — in-flight, not succeeded

    expect(transport.dispatchCount()).toBe(4);
    expect(transport.dispatchedKeys()).toEqual(["k1", "k1", "k1", "k1"]);
    expect(transport.remaining()).toBe(0);
  });

  it("an exhausted script fails deterministically with script-exhausted", async () => {
    const transport = new ScriptedReferenceTransport([]);
    const cmd = queuedToAuthorized({
      idempotencyKey: "k9", tenantId: "t1", capabilityId: "c", payloadInputs: {},
      authorizationDigest: "d", verdict: "ALLOW", status: "queued", attempts: 1, submittedAt: 0,
      nextAttemptAt: 0, lastFailureReason: null, completedOutputs: null, completedAt: null,
      deadLetteredAt: null, submissionSeq: 1,
    });
    const r = await transport.dispatch(cmd);
    expect(r.state).toBe("failed");
    expect(r.failureReason).toBe("script-exhausted");
  });

  it("timestamps derive from the explicit baseAt — deterministic, no wall-clock", async () => {
    const a = new ScriptedReferenceTransport([{ kind: "complete" }], { baseAt: 5_000 });
    const b = new ScriptedReferenceTransport([{ kind: "complete" }], { baseAt: 5_000 });
    const cmd = queuedToAuthorized({
      idempotencyKey: "k", tenantId: "t1", capabilityId: "c", payloadInputs: {},
      authorizationDigest: "d", verdict: "ALLOW", status: "queued", attempts: 1, submittedAt: 0,
      nextAttemptAt: 0, lastFailureReason: null, completedOutputs: null, completedAt: null,
      deadLetteredAt: null, submissionSeq: 1,
    });
    const ra = await a.dispatch(cmd);
    const rb = await b.dispatch(cmd);
    expect(ra.startedAt).toBe(rb.startedAt);
    expect(ra.startedAt).toBe("1970-01-01T00:00:06.000Z"); // baseAt + 1 * 1000
  });

  it("queuedToAuthorized rebuilds the AuthorizedCommand view with the carried authorization", () => {
    const cmd = queuedToAuthorized({
      idempotencyKey: "k", tenantId: "t1", capabilityId: "cap.restart", payloadInputs: { a: 1 },
      authorizationDigest: "digest-7", verdict: "REQUIRE_APPROVAL", status: "queued", attempts: 1, submittedAt: 0,
      nextAttemptAt: 0, lastFailureReason: null, completedOutputs: null, completedAt: null,
      deadLetteredAt: null, submissionSeq: 1,
    });
    expect(cmd.authorizationDigest).toBe("digest-7");
    expect(cmd.verdict).toBe("REQUIRE_APPROVAL");
    expect(cmd.tenant.tenantId).toBe("t1");
    expect(cmd.payload.capabilityId).toBe("cap.restart");
  });
});

// ---------- The pump — queue + ledger + transport ----------

describe("queue pump", () => {
  it("pumps a happy-path command to completion and appends the ledger trail", async () => {
    let state = freshQueue();
    state = submit(state, "k1", 100);
    const transport = new ScriptedReferenceTransport([{ kind: "complete", outputs: { done: true } }]);
    const pump = await pumpCommandQueue(state, [], 200, transport);
    expect(pump.ok).toBe(true);
    if (!pump.ok) return;
    expect(pump.acked).toBe(1);
    expect(pump.completed).toBe(1);
    expect(pump.state.commands[0]!.status).toBe("completed");
    const kinds = pump.ledger.map((e) => e.kind);
    expect(kinds).toEqual(["acked", "completed"]);
    expect(verifyExecutionLedger(pump.ledger).verified).toBe(true);
  });

  it("the ack path leaves the command in-flight; completion arrives via completeCommand", async () => {
    let state = freshQueue();
    state = submit(state, "k1", 100);
    const transport = new ScriptedReferenceTransport([{ kind: "ack" }]);
    const pump = await pumpCommandQueue(state, [], 200, transport);
    if (!pump.ok) throw new Error(pump.reason);
    expect(pump.state.commands[0]!.status).toBe("in-flight");
    // The caller later completes it — the queue stays consistent.
    const done = completeCommand(pump.state, "k1", { late: true }, 300, "t1");
    expect(done.ok).toBe(true);
    if (done.ok) expect(done.command.status).toBe("completed");
  });

  it("a failed attempt re-queues with the backoff schedule and appends a retried entry", async () => {
    const retry = { maxAttempts: 3, baseBackoffMs: 1_000, maxBackoffMs: 30_000 };
    let state = freshQueue(retry);
    state = submit(state, "k1", 100);
    const transport = new ScriptedReferenceTransport([{ kind: "fail", reason: "device busy" }]);
    const pump = await pumpCommandQueue(state, [], 200, transport);
    if (!pump.ok) throw new Error(pump.reason);
    expect(pump.retried).toBe(1);
    expect(pump.state.commands[0]!.status).toBe("queued");
    expect(pump.state.commands[0]!.attempts).toBe(2);
    expect(pump.state.commands[0]!.nextAttemptAt).toBe(200 + 2_000);
    expect(pump.ledger.map((e) => e.kind)).toEqual(["acked", "retried"]);
    expect(dueCommands(pump.state, 2_199)).toHaveLength(0);
    expect(dueCommands(pump.state, 2_200)).toHaveLength(1);
  });

  it("a timeout is an honest degraded failure that feeds the SAME retry policy", async () => {
    let state = freshQueue();
    state = submit(state, "k1", 100);
    const transport = new ScriptedReferenceTransport([{ kind: "timeout" }]);
    const pump = await pumpCommandQueue(state, [], 200, transport);
    if (!pump.ok) throw new Error(pump.reason);
    expect(pump.state.commands[0]!.status).toBe("queued");
    expect(pump.state.commands[0]!.lastFailureReason).toBe("transport timeout");
    expect(pump.ledger[pump.ledger.length - 1]!.detail).toBe("transport timeout");
  });

  it("dead-letters after exhausting attempts — the ledger names the failure", async () => {
    const retry = { maxAttempts: 1, baseBackoffMs: 100, maxBackoffMs: 1_000 };
    let state = freshQueue(retry);
    state = submit(state, "k1", 100);
    const transport = new ScriptedReferenceTransport([{ kind: "fail", reason: "hard failure" }]);
    const pump = await pumpCommandQueue(state, [], 200, transport);
    if (!pump.ok) throw new Error(pump.reason);
    expect(pump.deadLettered).toBe(1);
    expect(pump.state.commands[0]!.status).toBe("dead-lettered");
    expect(pump.state.commands[0]!.lastFailureReason).toBe("hard failure");
    expect(pump.ledger.map((e) => e.kind)).toEqual(["acked", "dead-lettered"]);
    expect(pump.ledger[1]!.detail).toBe("hard failure");
  });

  it("pumps multiple due commands in arrival order and logs every dispatch", async () => {
    let state = freshQueue();
    state = submit(state, "a", 100);
    state = submit(state, "b", 100);
    state = submit(state, "c", 500); // not due at t=200
    const transport = new ScriptedReferenceTransport([
      { kind: "complete" },
      { kind: "fail", reason: "nope" },
    ]);
    const pump = await pumpCommandQueue(state, submittedLedger(state), 200, transport);
    if (!pump.ok) throw new Error(pump.reason);
    expect(transport.dispatchedKeys()).toEqual(["a", "b"]);
    expect(pump.acked).toBe(2);
    expect(pump.completed).toBe(1);
    expect(pump.retried).toBe(1);
    // The ledger replays to the same view the queue state holds ("c" was
    // submitted but never due — it replays to its queued state).
    const replay = replayExecutionLedger(pump.ledger);
    if (!replay.ok) throw new Error(String(replay.reason));
    expect(replay.commands.map((c) => c.idempotencyKey).sort()).toEqual(["a", "b", "c"]);
    expect(replay.commands.find((c) => c.idempotencyKey === "a")!.status).toBe("completed");
    expect(replay.commands.find((c) => c.idempotencyKey === "b")!.status).toBe("queued");
    expect(replay.commands.find((c) => c.idempotencyKey === "c")!.status).toBe("queued");
  });

  it("retried commands are pumped again once due — end-to-end retry round-trip", async () => {
    const retry = { maxAttempts: 2, baseBackoffMs: 100, maxBackoffMs: 1_000 };
    let state = freshQueue(retry);
    state = submit(state, "k1", 100);
    const transport = new ScriptedReferenceTransport([
      { kind: "fail", reason: "first" },
      { kind: "complete", outputs: { recovered: true } },
    ]);
    const pump1 = await pumpCommandQueue(state, submittedLedger(state), 100, transport);
    if (!pump1.ok) throw new Error(pump1.reason);
    expect(pump1.retried).toBe(1);
    const pump2 = await pumpCommandQueue(pump1.state, pump1.ledger, 300, transport);
    if (!pump2.ok) throw new Error(pump2.reason);
    expect(pump2.completed).toBe(1);
    expect(pump2.state.commands[0]!.status).toBe("completed");
    expect(pump2.ledger.map((e) => e.kind)).toEqual(["submitted", "acked", "retried", "acked", "completed"]);
    expect(verifyExecutionLedger(pump2.ledger).verified).toBe(true);
    // Full end-to-end replay determinism.
    const a = replayExecutionLedger(pump2.ledger);
    const b = replayExecutionLedger(pump2.ledger);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("the pump is deterministic — same inputs produce byte-identical state + ledger", async () => {
    const run = async () => {
      let state = freshQueue();
      state = submit(state, "k1", 100);
      state = submit(state, "k2", 100);
      const transport = new ScriptedReferenceTransport([
        { kind: "complete", outputs: { x: 1 } },
        { kind: "fail", reason: "y" },
      ], { baseAt: 1_000 });
      const pump = await pumpCommandQueue(state, [], 200, transport);
      if (!pump.ok) throw new Error(pump.reason);
      return JSON.stringify({ state: pump.state, ledger: pump.ledger });
    };
    expect(await run()).toBe(await run());
  });

  it("nothing due => the pump is a no-op that appends nothing", async () => {
    let state = freshQueue();
    state = submit(state, "k1", 100);
    const transport = new ScriptedReferenceTransport([{ kind: "complete" }]);
    const pump = await pumpCommandQueue(state, [], 50, transport);
    if (!pump.ok) throw new Error(pump.reason);
    expect(pump.acked).toBe(0);
    expect(pump.ledger).toHaveLength(0);
    expect(transport.dispatchCount()).toBe(0);
  });
});
