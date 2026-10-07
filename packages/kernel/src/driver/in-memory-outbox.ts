/**
 * @fleetos/kernel — InMemoryOutbox (the deterministic outbox reference).
 *
 * Implements the OutboxPort (A14). Events are written in the SAME
 * transaction as the state change: `publish()` MUST be called within an
 * active session; the event is staged in the session, not visible to
 * readers until commit. On rollback, the event is discarded entirely.
 *
 * Drain contract: at-least-once delivery with idempotency keys. A
 * redelivered event is acknowledged identically (the second ack returns
 * `already-acknowledged` and does NOT mutate the event). Pending/Failed/
 * Delivered states with retry policy types (bounded backoff).
 *
 * Pure TypeScript, no I/O, no fs, no network, no global state. The driver
 * is bound to an InMemoryKernelDriver (which owns the per-tenant
 * keyspaces). The driver is the authority for committed events; the
 * session stages them.
 */

import type { TenantContext } from "../tenant.js";
import type {
  OutboxAckOutcome,
  OutboxAckRejection,
  OutboxEvent,
  OutboxPort,
  OutboxPublishRejection,
} from "../outbox.js";
import type { RetryPolicy } from "../outbox.js";
import { DEFAULT_RETRY_POLICY, nextAttemptAt } from "../outbox.js";
import { fail, ok, type Result } from "../result.js";
import type { TransactionalSession } from "../session.js";
import type { InMemoryTransactionalSession } from "./in-memory-session.js";
import type { OutboxCommittedEvent, TenantKeyspace } from "./in-memory-session.js";

// ---------------------------------------------------------------------------
// InMemoryOutbox — implements OutboxPort over an InMemoryKernelDriver.
// ---------------------------------------------------------------------------

export class InMemoryOutbox implements OutboxPort {
  private readonly policy: RetryPolicy;
  private readonly keyspaces: Map<string, TenantKeyspace>;
  private eventCounter = 0;

  constructor(input: {
    readonly keyspaces: Map<string, TenantKeyspace>;
    readonly policy?: RetryPolicy;
  }) {
    this.keyspaces = input.keyspaces;
    this.policy = input.policy ?? DEFAULT_RETRY_POLICY;
  }

  publish(input: {
    readonly session: TransactionalSession;
    readonly event: {
      readonly type: string;
      readonly payload: unknown;
      readonly idempotencyKey: string;
      readonly causationId?: string | null;
      readonly correlationId?: string | null;
      readonly occurredAt: number;
    };
  }): Result<OutboxEvent, OutboxPublishRejection> {
    if (input.session.state !== "active") {
      return fail("session-not-active");
    }
    if (!input.event.type) return fail("missing-type");
    if (!input.event.idempotencyKey) return fail("missing-idempotency-key");
    if (!input.session.tenant.tenantId) return fail("missing-tenant");
    this.eventCounter += 1;
    const id = `obx_evt_${String(this.eventCounter).padStart(10, "0")}`;
    const inMemorySession = input.session as unknown as InMemoryTransactionalSession;
    inMemorySession.stageOutboxEvent({
      id,
      tenantId: input.session.tenant.tenantId,
      type: input.event.type,
      payload: input.event.payload,
      idempotencyKey: input.event.idempotencyKey,
      occurredAt: input.event.occurredAt,
      causationId: input.event.causationId ?? null,
      correlationId: input.event.correlationId ?? null,
    });
    // Return a snapshot of the event as it WILL appear after commit. The
    // state is PENDING (committed events are PENDING until acked).
    const staged: OutboxEvent = {
      id,
      tenantId: input.session.tenant.tenantId,
      type: input.event.type,
      payload: input.event.payload,
      idempotencyKey: input.event.idempotencyKey,
      occurredAt: input.event.occurredAt,
      recordedAt: 0, // filled in at commit time by the session
      revision: 0, // filled in at commit time by the session
      causationId: input.event.causationId ?? null,
      correlationId: input.event.correlationId ?? null,
      state: "PENDING",
      deliveryAttempts: 0,
      lastAttemptedAt: null,
      lastFailureReason: null,
      nextAttemptAt: null,
    };
    return ok(staged);
  }

  pending(input: {
    readonly ctx: TenantContext;
    readonly limit?: number;
    readonly now: number;
  }): ReadonlyArray<OutboxEvent> {
    const ks = this.keyspaces.get(String(input.ctx.tenantId));
    if (!ks) return [];
    const limit = input.limit ?? 100;
    const out: OutboxEvent[] = [];
    const sorted = [...ks.outbox.events.values()].sort((a, b) => a.revision - b.revision);
    for (const ev of sorted) {
      if (out.length >= limit) break;
      // Skip events scheduled for a future retry window.
      if (ev.nextAttemptAt !== null && ev.nextAttemptAt > input.now) continue;
      // Only PENDING and FAILED events are drappable.
      if (ev.state !== "PENDING" && ev.state !== "FAILED") continue;
      out.push(this.toOutboxEvent(ev));
    }
    return out;
  }

  ack(input: {
    readonly ctx: TenantContext;
    readonly eventId: string;
    readonly idempotencyKey: string;
    readonly now: number;
  }): Result<{ readonly event: OutboxEvent; readonly outcome: OutboxAckOutcome }, OutboxAckRejection> {
    const ks = this.keyspaces.get(String(input.ctx.tenantId));
    if (!ks) return fail("event-not-found");
    const ev = ks.outbox.events.get(input.eventId);
    if (!ev) return fail("event-not-found");
    if (ev.tenantId !== input.ctx.tenantId) return fail("tenant-mismatch");
    // Idempotency: the SAME idempotency key must be presented on every ack.
    // The reader's seam MUST use the idempotencyKey for its own dedup; the
    // kernel's responsibility is to make ack idempotent at the boundary.
    if (ev.idempotencyKey !== input.idempotencyKey) {
      return fail("idempotency-key-mismatch");
    }
    // Already acknowledged — return the same event, no mutation.
    if (ev.state === "DELIVERED") {
      return ok({
        event: this.toOutboxEvent(ev),
        outcome: "already-acknowledged",
      });
    }
    // Acknowledge.
    ev.state = "DELIVERED";
    ev.lastAttemptedAt = input.now;
    ev.nextAttemptAt = null;
    ks.outbox.ackedKeys.add(ev.idempotencyKey);
    return ok({
      event: this.toOutboxEvent(ev),
      outcome: "newly-acknowledged",
    });
  }

  markFailed(input: {
    readonly ctx: TenantContext;
    readonly eventId: string;
    readonly reason: string;
    readonly now: number;
  }): Result<OutboxEvent, OutboxAckRejection> {
    const ks = this.keyspaces.get(String(input.ctx.tenantId));
    if (!ks) return fail("event-not-found");
    const ev = ks.outbox.events.get(input.eventId);
    if (!ev) return fail("event-not-found");
    if (ev.tenantId !== input.ctx.tenantId) return fail("tenant-mismatch");
    // Dead events cannot be retried.
    if (ev.state === "DEAD_LETTER") return ok(this.toOutboxEvent(ev));
    if (ev.state === "DELIVERED") return ok(this.toOutboxEvent(ev));
    ev.deliveryAttempts += 1;
    ev.lastAttemptedAt = input.now;
    ev.lastFailureReason = input.reason;
    const next = nextAttemptAt(this.policy, ev.deliveryAttempts, input.now);
    if (next === null) {
      // Policy exhausted — dead-letter.
      ev.state = "DEAD_LETTER";
      ev.nextAttemptAt = null;
    } else {
      ev.state = "FAILED";
      ev.nextAttemptAt = next;
    }
    return ok(this.toOutboxEvent(ev));
  }

  state(ctx: TenantContext, eventId: string): OutboxEvent["state"] | null {
    const ks = this.keyspaces.get(String(ctx.tenantId));
    if (!ks) return null;
    const ev = ks.outbox.events.get(eventId);
    if (!ev) return null;
    if (ev.tenantId !== ctx.tenantId) return null;
    return ev.state;
  }

  findById(ctx: TenantContext, eventId: string): OutboxEvent | null {
    const ks = this.keyspaces.get(String(ctx.tenantId));
    if (!ks) return null;
    const ev = ks.outbox.events.get(eventId);
    if (!ev) return null;
    if (ev.tenantId !== ctx.tenantId) return null;
    return this.toOutboxEvent(ev);
  }

  // --- helpers ---

  private toOutboxEvent(ev: OutboxCommittedEvent): OutboxEvent {
    return {
      id: ev.id,
      tenantId: ev.tenantId,
      type: ev.type,
      payload: ev.payload,
      idempotencyKey: ev.idempotencyKey,
      occurredAt: ev.occurredAt,
      recordedAt: ev.recordedAt,
      revision: ev.revision,
      causationId: ev.causationId,
      correlationId: ev.correlationId,
      state: ev.state,
      deliveryAttempts: ev.deliveryAttempts,
      lastAttemptedAt: ev.lastAttemptedAt,
      lastFailureReason: ev.lastFailureReason,
      nextAttemptAt: ev.nextAttemptAt,
    };
  }
}
