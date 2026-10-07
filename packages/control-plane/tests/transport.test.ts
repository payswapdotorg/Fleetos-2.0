/**
 * @fleetos/control-plane — reference transport tests.
 *
 * The ack/timeout paths: normal dispatch (queued + ledger + sink), the
 * deterministic transport-ack-timeout fault (exact retry time, ledger
 * entry, sink event), duplicate dispatch after a timeout (no second
 * attempt), dead-lettering with a maxAttempts=1 policy, sink idempotency,
 * and determinism.
 */

import { describe, expect, it } from "vitest";
import {
  CommandQueue,
  ExecutionLedger,
  InMemoryCommandTransport,
  InMemoryTransportEventSink,
} from "../src/index.js";
import { ctxFor, NOW, TENANT_A } from "./helpers.js";

const command = {
  kind: "work-order",
  payload: { stageId: "s1" },
  idempotencyKey: "key-001",
  issuedAt: NOW,
};

describe("InMemoryCommandTransport — dispatch (ack path)", () => {
  it("dispatches: ack receipt, command queued, ledger entry, sink event", () => {
    const queue = new CommandQueue();
    const ledger = new ExecutionLedger();
    const sink = new InMemoryTransportEventSink();
    const transport = new InMemoryCommandTransport({ queue, ledger, sink });
    const receipt = transport.dispatch({ ctx: ctxFor(TENANT_A), command, now: NOW });
    expect(receipt.ok).toBe(true);
    if (!receipt.ok) return;
    expect(receipt.value.status).toBe("ack");
    expect(receipt.value.commandId).toBe("cmd_0000000001");
    expect(receipt.value.retryAt).toBeNull();
    expect(receipt.value.deadLettered).toBe(false);
    const record = queue.findById(ctxFor(TENANT_A), "cmd_0000000001");
    expect(record.ok && record.value.state).toBe("queued");
    const entries = ledger.entriesFor(ctxFor(TENANT_A));
    expect(entries).toHaveLength(1);
    expect(entries[0]?.kind).toBe("submitted");
    expect(sink.eventsEmitted()).toHaveLength(1);
    expect(sink.eventsEmitted()[0]?.type).toBe("command.dispatched");
  });

  it("duplicate dispatch: the ORIGINAL command, ledger duplicate-suppressed, no double execution", () => {
    const queue = new CommandQueue();
    const ledger = new ExecutionLedger();
    const sink = new InMemoryTransportEventSink();
    const transport = new InMemoryCommandTransport({ queue, ledger, sink });
    transport.dispatch({ ctx: ctxFor(TENANT_A), command, now: NOW });
    const second = transport.dispatch({ ctx: ctxFor(TENANT_A), command, now: NOW + 5 });
    expect(second.ok && second.value.duplicate).toBe(true);
    expect(second.ok && second.value.status).toBe("ack");
    expect(queue.listByTenant(ctxFor(TENANT_A))).toHaveLength(1);
    const kinds = ledger.entriesFor(ctxFor(TENANT_A)).map((e) => e.kind);
    expect(kinds).toEqual(["submitted", "duplicate-suppressed"]);
    // The sink dedupes on the idempotency key: one dispatch event.
    expect(sink.eventsEmitted()).toHaveLength(1);
  });
});

describe("InMemoryCommandTransport — the timeout path", () => {
  it("a timeout-keyed dispatch claims + fails the command with the EXACT retry time", () => {
    const queue = new CommandQueue({
      policy: { maxAttempts: 5, baseDelayMs: 1_000, maxDelayMs: 60_000, backoffBps: 20_000 },
    });
    const ledger = new ExecutionLedger();
    const sink = new InMemoryTransportEventSink();
    const transport = new InMemoryCommandTransport({
      queue,
      ledger,
      sink,
      timeoutKeys: new Set(["key-001"]),
    });
    const receipt = transport.dispatch({ ctx: ctxFor(TENANT_A), command, now: NOW });
    expect(receipt.ok).toBe(true);
    if (!receipt.ok) return;
    expect(receipt.value.status).toBe("timeout");
    expect(receipt.value.retryAt).toBe(NOW + 1_000);
    expect(receipt.value.deadLettered).toBe(false);
    const record = queue.findById(ctxFor(TENANT_A), "cmd_0000000001");
    expect(record.ok && record.value.state).toBe("retry-scheduled");
    expect(record.ok && record.value.failures).toBe(1);
    expect(record.ok && record.value.lastFailureReason).toBe("transport-ack-timeout");
    const kinds = ledger.entriesFor(ctxFor(TENANT_A)).map((e) => e.kind);
    expect(kinds).toEqual(["submitted", "transport-timeout"]);
    expect(sink.eventsEmitted().map((e) => e.type)).toEqual([
      "command.dispatched",
      "command.transport-timeout",
    ]);
  });

  it("re-dispatch of a timed-out key: duplicate, NO second timeout attempt", () => {
    const queue = new CommandQueue({
      policy: { maxAttempts: 5, baseDelayMs: 1_000, maxDelayMs: 60_000, backoffBps: 20_000 },
    });
    const ledger = new ExecutionLedger();
    const transport = new InMemoryCommandTransport({
      queue,
      ledger,
      timeoutKeys: new Set(["key-001"]),
    });
    transport.dispatch({ ctx: ctxFor(TENANT_A), command, now: NOW });
    const second = transport.dispatch({ ctx: ctxFor(TENANT_A), command, now: NOW + 1 });
    expect(second.ok && second.value.duplicate).toBe(true);
    expect(second.ok && second.value.status).toBe("ack");
    const record = queue.findById(ctxFor(TENANT_A), "cmd_0000000001");
    // Still exactly ONE failed attempt — the duplicate did not retry.
    expect(record.ok && record.value.failures).toBe(1);
    const timeouts = ledger
      .entriesFor(ctxFor(TENANT_A))
      .filter((e) => e.kind === "transport-timeout");
    expect(timeouts).toHaveLength(1);
  });

  it("a maxAttempts=1 policy dead-letters the timed-out command immediately", () => {
    const queue = new CommandQueue({
      policy: { maxAttempts: 1, baseDelayMs: 1_000, maxDelayMs: 60_000, backoffBps: 20_000 },
    });
    const ledger = new ExecutionLedger();
    const transport = new InMemoryCommandTransport({
      queue,
      ledger,
      timeoutKeys: new Set(["key-001"]),
    });
    const receipt = transport.dispatch({ ctx: ctxFor(TENANT_A), command, now: NOW });
    expect(receipt.ok).toBe(true);
    if (!receipt.ok) return;
    expect(receipt.value.status).toBe("timeout");
    expect(receipt.value.deadLettered).toBe(true);
    expect(receipt.value.retryAt).toBeNull();
    const record = queue.findById(ctxFor(TENANT_A), "cmd_0000000001");
    expect(record.ok && record.value.state).toBe("dead-lettered");
    expect(record.ok && record.value.lastFailureReason).toBe("transport-ack-timeout");
    const kinds = ledger.entriesFor(ctxFor(TENANT_A)).map((e) => e.kind);
    expect(kinds).toEqual(["submitted", "transport-timeout"]);
  });

  it("commands not in timeoutKeys never take the timeout path", () => {
    const queue = new CommandQueue();
    const ledger = new ExecutionLedger();
    const transport = new InMemoryCommandTransport({
      queue,
      ledger,
      timeoutKeys: new Set(["other-key"]),
    });
    const receipt = transport.dispatch({
      ctx: ctxFor(TENANT_A),
      command: { ...command, idempotencyKey: "healthy-key" },
      now: NOW,
    });
    expect(receipt.ok && receipt.value.status).toBe("ack");
    const record = queue.findById(ctxFor(TENANT_A), "cmd_0000000001");
    expect(record.ok && record.value.state).toBe("queued");
  });
});

describe("InMemoryTransportEventSink — idempotent emission", () => {
  it("dedupes on the idempotency key and returns the ORIGINAL eventId", () => {
    const sink = new InMemoryTransportEventSink();
    const first = sink.emit({
      type: "command.dispatched",
      payload: {},
      idempotencyKey: "dispatch::tnt::key-001",
      occurredAt: NOW,
      causationId: "cmd_0000000001",
    });
    const second = sink.emit({
      type: "command.dispatched",
      payload: {},
      idempotencyKey: "dispatch::tnt::key-001",
      occurredAt: NOW + 1,
      causationId: "cmd_0000000001",
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.value.eventId).toBe(first.value.eventId);
    expect(second.value.duplicate).toBe(true);
    expect(sink.count()).toBe(1);
  });

  it("rejects an event with a missing type or idempotency key", () => {
    const sink = new InMemoryTransportEventSink();
    expect(
      sink.emit({ type: "", payload: {}, idempotencyKey: "k", occurredAt: NOW, causationId: null }),
    ).toEqual({ ok: false, reason: "sink-rejected" });
    expect(
      sink.emit({ type: "t", payload: {}, idempotencyKey: "", occurredAt: NOW, causationId: null }),
    ).toEqual({ ok: false, reason: "sink-rejected" });
  });
});

describe("InMemoryCommandTransport — determinism", () => {
  it("two transports with the same inputs produce identical receipts and digests", () => {
    const build = () => {
      const queue = new CommandQueue({
        policy: { maxAttempts: 3, baseDelayMs: 1_000, maxDelayMs: 60_000, backoffBps: 20_000 },
      });
      const ledger = new ExecutionLedger();
      const transport = new InMemoryCommandTransport({
        queue,
        ledger,
        timeoutKeys: new Set(["key-001"]),
      });
      const receipt = transport.dispatch({ ctx: ctxFor(TENANT_A), command, now: NOW });
      return { receipt, digests: ledger.entriesFor(ctxFor(TENANT_A)).map((e) => e.digest) };
    };
    const a = build();
    const b = build();
    expect(a.receipt).toEqual(b.receipt);
    expect(a.digests).toEqual(b.digests);
  });
});
