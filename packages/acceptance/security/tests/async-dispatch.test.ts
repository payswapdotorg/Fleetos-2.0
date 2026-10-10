/**
 * F321B async-dispatch tests — machine-run support evidence for the
 * async-signature execution/actions APIs that the corpus journeys cannot
 * drive synchronously.
 *
 * WHY THIS FILE EXISTS (documented in docs/evidence/F321B/report.md): the
 * security corpus runner executes synchronous steps by contract — the
 * TL-owned adoption seam (packages/acceptance/adoption/src/adoption-run.ts)
 * consumes `runJourney(j).outcome` synchronously, and worker-b may not
 * modify TL-owned files. `executeWithVerification`, `drainQueue` and
 * `dispatchWithIdempotency` carry Promise signatures over the
 * transport/queue/ledger PORTS, so they cannot be driven from the sync
 * corpus step machinery. They ARE real public entry points of worker-b
 * owned packages, so this test machine-runs them over DETERMINISTIC ports
 * (fixed logical receipts; no wall-clock values are asserted).
 *
 * These runs are SUPPORTING evidence for the lane — they are NOT counted
 * as corpus journeys (the count law: only corpus journey ids executed per
 * applicable workspace count).
 *
 * Determinism discipline: every asserted field is a deterministic domain
 * field (state, degraded, verified, reason, proofRef, receipt, counts);
 * the executor's degraded catch-path emits wall-clock startedAt/endedAt
 * strings, which are deliberately NOT asserted here.
 */

import { describe, expect, it } from "vitest";
import {
  authorizeCommand,
  drainQueue,
  executeWithVerification,
  InMemoryExecutionQueue,
  makeReferenceTransport,
  makeReferenceVerificationHook,
  makeQueueEntry,
} from "@fleetos/execution";
import { InMemoryIdempotencyLedger, dispatchWithIdempotency, buildIdempotencyKey } from "@fleetos/actions";
import type { GuardianDecision } from "@fleetos/policy";

function allowDecision(): GuardianDecision {
  return {
    verdict: "ALLOW",
    reasonCode: "allow.matched_rule",
    matchedRuleId: "rule.allow_low_risk_read",
    tenantId: "acme-ops",
    capabilityId: "cap.test",
    conditions: [],
    decisionDigest: "dig1",
  };
}

function makeCommand(capabilityId = "cap.test", key = "k1") {
  const result = authorizeCommand(
    allowDecision(),
    { capabilityId, inputs: {} },
    { tenantId: "acme-ops" },
    undefined,
    key,
  );
  if (!result.ok) throw new Error("authorizeCommand failed");
  return result.command;
}

describe("F321B executeWithVerification (async-signature support evidence)", () => {
  it("verifies a successful dispatch end-to-end", async () => {
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
    const result = await executeWithVerification(transport, cmd, hook, 60);
    expect(result.verification.verified).toBe(true);
    expect(result.verification.proofRef).toBe(`ack-${cmd.idempotencyKey}`);
    expect(result.verification.verifierKind).toBe("device.ack");
    expect(result.degraded).toBeNull();
    expect(result.result.state).toBe("succeeded");
  });

  it("degrades honestly when the result failed (never claims success)", async () => {
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
    const result = await executeWithVerification(transport, cmd, hook, 60);
    expect(result.verification.verified).toBe(false);
    expect(result.degraded).toBe("unknown_failure");
    expect(result.result.state).toBe("failed");
  });

  it("degrades on an empty capability without dispatching", async () => {
    const cmd = makeCommand("");
    const transport = makeReferenceTransport(async () => {
      throw new Error("must not be called");
    });
    const hook = makeReferenceVerificationHook("reference.in-memory");
    const result = await executeWithVerification(transport, cmd, hook, 60);
    expect(result.degraded).toBe("capability_empty");
    expect(result.verification.verified).toBe(false);
    expect(result.verification.reason).toBe("capability empty — no execution attempted");
    // The empty-capability path is fully deterministic (fixed epoch zero).
    expect(result.result.startedAt).toBe("1970-01-01T00:00:00.000Z");
    expect(result.result.endedAt).toBe("1970-01-01T00:00:00.000Z");
  });

  it("degrades on transport unavailability", async () => {
    const cmd = makeCommand();
    const transport = makeReferenceTransport(async () => {
      throw new Error("connection refused");
    });
    const hook = makeReferenceVerificationHook("reference.in-memory");
    const result = await executeWithVerification(transport, cmd, hook, 60);
    expect(result.degraded).toBe("transport_unavailable");
    expect(result.result.state).toBe("timeout");
    expect(result.verification.verified).toBe(false);
  });

  it("is deterministic over the asserted domain fields", async () => {
    const cmd = makeCommand();
    const mk = () =>
      makeReferenceTransport(async () => ({
        commandId: cmd.idempotencyKey,
        state: "succeeded" as const,
        outputs: { ok: true },
        startedAt: "t1",
        endedAt: "t2",
        transportName: "reference.in-memory",
      }));
    const hook = makeReferenceVerificationHook("reference.in-memory");
    const a = await executeWithVerification(mk(), cmd, hook, 60);
    const b = await executeWithVerification(mk(), cmd, hook, 60);
    const project = (r: typeof a) => ({
      state: r.result.state,
      degraded: r.degraded,
      verified: r.verification.verified,
      proofRef: r.verification.proofRef,
      outputs: r.result.outputs,
    });
    expect(project(a)).toEqual(project(b));
  });
});

describe("F321B drainQueue (async-signature support evidence)", () => {
  it("drains FIFO with at-least-once retries until success", async () => {
    const queue = new InMemoryExecutionQueue();
    const cmdOk = makeCommand("cap.ok", "k-ok");
    const cmdFlaky = makeCommand("cap.flaky", "k-flaky");
    await queue.enqueue(makeQueueEntry(cmdOk, "t1"));
    await queue.enqueue(makeQueueEntry(cmdFlaky, "t2"));

    // The flaky command fails twice, then succeeds (maxAttempts 3).
    let flakyAttempts = 0;
    const transport = makeReferenceTransport(async (c) => {
      if (c.idempotencyKey === cmdFlaky.idempotencyKey) {
        flakyAttempts += 1;
        if (flakyAttempts < 3) {
          return {
            commandId: c.idempotencyKey,
            state: "failed" as const,
            outputs: {},
            failureReason: `flaky failure ${flakyAttempts}`,
            startedAt: "t1",
            endedAt: "t2",
            transportName: "reference.in-memory",
          };
        }
      }
      return {
        commandId: c.idempotencyKey,
        state: "succeeded" as const,
        outputs: { ok: true },
        startedAt: "t1",
        endedAt: "t2",
        transportName: "reference.in-memory",
      };
    });

    const drain = await drainQueue(queue, transport);
    expect(drain.drained).toBe(4); // 1 (ok) + 3 (flaky attempts)
    expect(drain.failed).toBe(0);
    expect(drain.remaining).toBe(0);
    expect(drain.results.filter((r) => r.state === "succeeded")).toHaveLength(2);
    expect(drain.results.filter((r) => r.state === "failed")).toHaveLength(2);
    expect(flakyAttempts).toBe(3);
  });

  it("stops retrying after maxAttempts (dead-letter by exhaustion)", async () => {
    const queue = new InMemoryExecutionQueue();
    const cmdDoomed = makeCommand("cap.doomed", "k-doomed");
    await queue.enqueue(makeQueueEntry(cmdDoomed, "t1"));
    const transport = makeReferenceTransport(async (c) => ({
      commandId: c.idempotencyKey,
      state: "failed" as const,
      outputs: {},
      failureReason: "always fails",
      startedAt: "t1",
      endedAt: "t2",
      transportName: "reference.in-memory",
    }));
    const drain = await drainQueue(queue, transport);
    expect(drain.drained).toBe(3); // maxAttempts 3, then not re-enqueued
    expect(drain.remaining).toBe(0);
    expect(drain.results.every((r) => r.state === "failed")).toBe(true);
  });
});

describe("F321B dispatchWithIdempotency (async-signature support evidence)", () => {
  it("duplicate dispatch returns the cached ack — never double execution", async () => {
    const ledger = new InMemoryIdempotencyLedger();
    const key = buildIdempotencyKey({ tenantId: "acme-ops", capabilityId: "cap.test", nonce: "n1" });
    let executions = 0;
    const dispatch = async () => {
      executions += 1;
      return { receipt: "receipt-1", at: "2026-10-12T18:41:00.000Z" };
    };
    const first = await dispatchWithIdempotency(ledger, key, dispatch);
    const second = await dispatchWithIdempotency(ledger, key, dispatch);
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.dispatchReceipt).toBe(first.dispatchReceipt);
    expect(second.dispatchedAt).toBe(first.dispatchedAt);
    expect(executions).toBe(1); // the dispatch function ran ONCE
    expect(ledger.size()).toBe(1);
    expect(ledger.keys()).toEqual([key]);
  });

  it("distinct keys execute independently", async () => {
    const ledger = new InMemoryIdempotencyLedger();
    const keyA = buildIdempotencyKey({ tenantId: "acme-ops", capabilityId: "cap.test", nonce: "n1" });
    const keyB = buildIdempotencyKey({ tenantId: "acme-ops", capabilityId: "cap.test", nonce: "n2" });
    let executions = 0;
    const dispatch = async () => {
      executions += 1;
      return { receipt: `receipt-${executions}`, at: "2026-10-12T18:41:00.000Z" };
    };
    await dispatchWithIdempotency(ledger, keyA, dispatch);
    await dispatchWithIdempotency(ledger, keyB, dispatch);
    expect(executions).toBe(2);
    expect(ledger.size()).toBe(2);
    expect([...ledger.keys()].sort()).toEqual([keyA, keyB].sort());
  });
});
