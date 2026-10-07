/**
 * @fleetos/control-plane — the reference transport.
 *
 * An in-memory port implementation modeling the ACK and TIMEOUT paths of
 * command dispatch, control-plane-grade: every dispatch is recorded in the
 * execution ledger (append-only, hash-chained) and emitted through a
 * TransportEventSink shaped after the kernel outbox event record
 * (type / payload / idempotencyKey / occurredAt / causationId) — the seam
 * the TL binds to the kernel's OutboxPort at composition time.
 *
 * Deterministic fault injection: the `timeoutKeys` set names the
 * idempotency keys whose dispatch experiences a transport-level ack
 * timeout (the command was claimed but the executor never acknowledged
 * within the window). A timed-out command consumes an attempt and follows
 * the queue's deterministic retry schedule — eventually dead-lettering.
 * A duplicate dispatch of a timed-out key is deduped by the queue (no
 * second timeout attempt, no double execution).
 */

import type { TenantContext } from "@fleetos/kernel";
import { fail, ok, type Result } from "./result.js";
import type {
  CommandQueue,
  CommandSubmitRejection,
  SubmitCommandInput,
} from "./queue.js";
import type { CommandId } from "./ids.js";
import type { ExecutionLedger } from "./ledger.js";

// ---------------------------------------------------------------------------
// TransportEventSink — the outbox-shaped event seam.
// ---------------------------------------------------------------------------

export interface TransportEventSink {
  emit(input: {
    readonly type: string;
    readonly payload: unknown;
    readonly idempotencyKey: string;
    readonly occurredAt: number;
    readonly causationId: string | null;
  }): Result<{ readonly eventId: string; readonly duplicate: boolean }, "sink-rejected">;
}

export interface TransportEventRecord {
  readonly eventId: string;
  readonly tenantId: string;
  readonly type: string;
  readonly payload: unknown;
  readonly idempotencyKey: string;
  readonly occurredAt: number;
  readonly causationId: string | null;
}

/**
 * In-memory sink: at-least-once emission with idempotency-key dedupe — a
 * re-emitted event returns the ORIGINAL eventId with duplicate: true and
 * is NOT recorded twice.
 */
export class InMemoryTransportEventSink implements TransportEventSink {
  private readonly events = new Map<string, TransportEventRecord>();
  private readonly byKey = new Map<string, string>();
  private counter = 0;

  emit(input: {
    readonly type: string;
    readonly payload: unknown;
    readonly idempotencyKey: string;
    readonly occurredAt: number;
    readonly causationId: string | null;
  }): Result<{ readonly eventId: string; readonly duplicate: boolean }, "sink-rejected"> {
    if (typeof input.type !== "string" || input.type === "") {
      return fail("sink-rejected");
    }
    if (typeof input.idempotencyKey !== "string" || input.idempotencyKey === "") {
      return fail("sink-rejected");
    }
    const existing = this.byKey.get(input.idempotencyKey);
    if (existing) {
      const record = this.events.get(existing);
      if (record) {
        return ok({ eventId: record.eventId, duplicate: true });
      }
    }
    this.counter += 1;
    const eventId = `tevt_${String(this.counter).padStart(10, "0")}`;
    const record: TransportEventRecord = {
      eventId,
      tenantId: input.idempotencyKey.split("::")[0] ?? "",
      type: input.type,
      payload: input.payload,
      idempotencyKey: input.idempotencyKey,
      occurredAt: input.occurredAt,
      causationId: input.causationId,
    };
    this.events.set(eventId, record);
    this.byKey.set(input.idempotencyKey, eventId);
    return ok({ eventId, duplicate: false });
  }

  eventsEmitted(): ReadonlyArray<TransportEventRecord> {
    return [...this.events.values()];
  }

  count(): number {
    return this.events.size;
  }
}

// ---------------------------------------------------------------------------
// The transport.
// ---------------------------------------------------------------------------

export interface TransportReceipt {
  readonly commandId: CommandId;
  /** "ack" — the transport accepted the dispatch; "timeout" — the deterministic fault path fired. */
  readonly status: "ack" | "timeout";
  readonly duplicate: boolean;
  /** Retry time for the timeout path (null when dead-lettered or ack). */
  readonly retryAt: number | null;
  readonly deadLettered: boolean;
}

export type TransportRejection =
  | CommandSubmitRejection
  | "ledger-rejected"
  | "sink-rejected";

export class InMemoryCommandTransport {
  private readonly queue: CommandQueue;
  private readonly ledger: ExecutionLedger;
  private readonly sink: TransportEventSink | null;
  private readonly timeoutKeys: ReadonlySet<string>;

  constructor(input: {
    readonly queue: CommandQueue;
    readonly ledger: ExecutionLedger;
    readonly sink?: TransportEventSink;
    readonly timeoutKeys?: ReadonlySet<string>;
  }) {
    this.queue = input.queue;
    this.ledger = input.ledger;
    this.sink = input.sink ?? null;
    this.timeoutKeys = input.timeoutKeys ?? new Set<string>();
  }

  /**
   * Dispatch a command through the transport:
   *  1. submit to the queue (idempotency-key dedupe — a duplicate returns
   *     the ORIGINAL command; the queue never double-executes);
   *  2. append the ledger entry (submitted / duplicate-suppressed);
   *  3. emit the outbox-shaped dispatch event through the sink;
   *  4. when the key is in timeoutKeys (and this is not a duplicate): the
   *     ack-timeout path — claim + fail with reason "transport-ack-timeout"
   *     → deterministic retry schedule or dead-letter; ledger + sink record it.
   */
  dispatch(input: {
    readonly ctx: TenantContext;
    readonly command: SubmitCommandInput;
    readonly now: number;
  }): Result<TransportReceipt, TransportRejection> {
    const submit = this.queue.submit({
      ctx: input.ctx,
      command: input.command,
      now: input.now,
    });
    if (!submit.ok) return fail(submit.reason);
    const { command: envelope, duplicate } = submit.value;
    const commandId = envelope.id;

    const appended = this.ledger.append({
      ctx: input.ctx,
      commandId: String(commandId),
      kind: duplicate ? "duplicate-suppressed" : "submitted",
      attempt: 0,
      at: input.now,
      reason: duplicate ? "idempotency-key-dedupe" : undefined,
    });
    if (!appended.ok) return fail("ledger-rejected");

    if (this.sink) {
      const emitted = this.sink.emit({
        type: "command.dispatched",
        payload: {
          commandId: String(commandId),
          kind: envelope.kind,
          idempotencyKey: envelope.idempotencyKey,
          duplicate,
        },
        idempotencyKey: `dispatch::${String(input.ctx.tenantId)}::${envelope.idempotencyKey}`,
        occurredAt: input.now,
        causationId: String(commandId),
      });
      if (!emitted.ok) return fail("sink-rejected");
    }

    if (!duplicate && this.timeoutKeys.has(input.command.idempotencyKey)) {
      const claim = this.queue.ack({ ctx: input.ctx, commandId, now: input.now });
      if (claim.ok) {
        const failure = this.queue.fail({
          ctx: input.ctx,
          commandId,
          reason: "transport-ack-timeout",
          now: input.now,
        });
        if (failure.ok) {
          const failedLedger = this.ledger.append({
            ctx: input.ctx,
            commandId: String(commandId),
            kind: "transport-timeout",
            attempt: failure.value.failures,
            at: input.now,
            reason: "transport-ack-timeout",
          });
          if (!failedLedger.ok) return fail("ledger-rejected");
          if (this.sink) {
            const emitted = this.sink.emit({
              type: "command.transport-timeout",
              payload: {
                commandId: String(commandId),
                reason: "transport-ack-timeout",
                nextAttemptAt: failure.value.nextAttemptAt,
                deadLettered: failure.value.state === "dead-lettered",
              },
              idempotencyKey: `timeout::${String(input.ctx.tenantId)}::${envelope.idempotencyKey}::${failure.value.failures}`,
              occurredAt: input.now,
              causationId: String(commandId),
            });
            if (!emitted.ok) return fail("sink-rejected");
          }
          return ok({
            commandId,
            status: "timeout",
            duplicate: false,
            retryAt: failure.value.nextAttemptAt,
            deadLettered: failure.value.state === "dead-lettered",
          });
        }
      }
    }

    return ok({
      commandId,
      status: "ack",
      duplicate,
      retryAt: null,
      deadLettered: false,
    });
  }
}
