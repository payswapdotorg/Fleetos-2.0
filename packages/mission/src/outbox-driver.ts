/**
 * @fleetos/mission — the in-memory outbox driver (law A14 —
 * transactional event publication).
 *
 * `InMemoryMissionOutbox` is the mission package's own deterministic
 * reference adapter implementing the kernel's `OutboxPort` TYPE
 * (structurally pinned via `implements`, so the TL can swap in the real
 * kernel driver at composition time without touching mission code).
 *
 * Dual-write consistency: `publish()` MUST be called within an active
 * session — the event is staged with the state writes and becomes
 * durable ONLY at commit. A rolled-back transaction leaves NO event
 * residue. Drain is at-least-once with idempotency keys; retries follow
 * the deterministic basis-point backoff; exhaustion dead-letters.
 *
 * TYPE imports only from `@fleetos/kernel`. No runtime imports from any
 * @fleetos/* package.
 */

import type {
  OutboxAckOutcome,
  OutboxAckRejection,
  OutboxEvent,
  OutboxEventState,
  OutboxPort,
  OutboxPublishRejection,
  TenantContext,
  TransactionalSession,
} from "@fleetos/kernel";
import { fail, ok, type Result } from "./result.js";
import {
  DEFAULT_OUTBOX_RETRY_POLICY,
  outboxRetryDelayMs,
  type MissionTenantStore,
  type MutableOutboxEvent,
  type OutboxRetryPolicy,
} from "./outbox-contracts.js";
import type { MissionTransactionSession } from "./outbox-store.js";

export class InMemoryMissionOutbox implements OutboxPort {
  private readonly policy: OutboxRetryPolicy;
  private readonly stores: Map<string, MissionTenantStore>;
  private eventCounter = 0;

  constructor(input: {
    readonly stores: Map<string, MissionTenantStore>;
    readonly policy?: OutboxRetryPolicy;
  }) {
    this.stores = input.stores;
    this.policy = input.policy ?? DEFAULT_OUTBOX_RETRY_POLICY;
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
    if (input.session.state !== "active") return fail("session-not-active");
    if (typeof input.event.type !== "string" || input.event.type === "") {
      return fail("missing-type");
    }
    if (
      typeof input.event.idempotencyKey !== "string" ||
      input.event.idempotencyKey === ""
    ) {
      return fail("missing-idempotency-key");
    }
    if (!input.session.tenant.tenantId) return fail("missing-tenant");
    this.eventCounter += 1;
    const id = `mobx_evt_${String(this.eventCounter).padStart(10, "0")}`;
    const missionSession = input.session as unknown as MissionTransactionSession;
    missionSession.stageOutboxEvent({
      id,
      tenantId: input.session.tenant.tenantId,
      type: input.event.type,
      payload: input.event.payload,
      idempotencyKey: input.event.idempotencyKey,
      occurredAt: input.event.occurredAt,
      causationId: input.event.causationId ?? null,
      correlationId: input.event.correlationId ?? null,
    });
    const store = this.stores.get(String(input.session.tenant.tenantId));
    const revision = (store?.outbox.revisions ?? 0) + this.stagedCount(input.session);
    return ok({
      id,
      tenantId: input.session.tenant.tenantId,
      type: input.event.type,
      payload: input.event.payload,
      idempotencyKey: input.event.idempotencyKey,
      occurredAt: input.event.occurredAt,
      recordedAt: -1, // staged — becomes the commit time at commit
      revision,
      causationId: input.event.causationId ?? null,
      correlationId: input.event.correlationId ?? null,
      state: "PENDING",
      deliveryAttempts: 0,
      lastAttemptedAt: null,
      lastFailureReason: null,
      nextAttemptAt: null,
    });
  }

  pending(input: {
    readonly ctx: TenantContext;
    readonly limit?: number;
    readonly now: number;
  }): ReadonlyArray<OutboxEvent> {
    const store = this.stores.get(String(input.ctx.tenantId));
    if (!store) return [];
    const events = [...store.outbox.events.values()]
      .filter(
        (event) =>
          (event.state === "PENDING" || event.state === "FAILED") &&
          (event.nextAttemptAt === null || event.nextAttemptAt <= input.now),
      )
      .sort((a, b) => a.revision - b.revision);
    const limited =
      input.limit !== undefined ? events.slice(0, input.limit) : events;
    return limited;
  }

  ack(input: {
    readonly ctx: TenantContext;
    readonly eventId: string;
    readonly idempotencyKey: string;
    readonly now: number;
  }): Result<
    { readonly event: OutboxEvent; readonly outcome: OutboxAckOutcome },
    OutboxAckRejection
  > {
    const event = this.findEvent(input.ctx, input.eventId);
    if (!event) return fail("event-not-found");
    if (event.state === "DELIVERED") {
      if (event.idempotencyKey !== input.idempotencyKey) {
        return fail("idempotency-key-mismatch");
      }
      return ok({ event, outcome: "already-acknowledged" });
    }
    if (event.idempotencyKey !== input.idempotencyKey) {
      return fail("idempotency-key-mismatch");
    }
    event.state = "DELIVERED";
    event.lastAttemptedAt = input.now;
    return ok({ event, outcome: "newly-acknowledged" });
  }

  markFailed(input: {
    readonly ctx: TenantContext;
    readonly eventId: string;
    readonly reason: string;
    readonly now: number;
  }): Result<OutboxEvent, OutboxAckRejection> {
    const event = this.findEvent(input.ctx, input.eventId);
    if (!event) return fail("event-not-found");
    event.deliveryAttempts += 1;
    event.lastAttemptedAt = input.now;
    event.lastFailureReason = input.reason;
    const delay = outboxRetryDelayMs(this.policy, event.deliveryAttempts);
    if (delay === null) {
      event.state = "DEAD_LETTER";
      event.nextAttemptAt = null;
    } else {
      event.state = "FAILED";
      event.nextAttemptAt = input.now + delay;
    }
    return ok(event);
  }

  state(ctx: TenantContext, eventId: string): OutboxEventState | null {
    const event = this.findEvent(ctx, eventId);
    return event ? event.state : null;
  }

  findById(ctx: TenantContext, eventId: string): OutboxEvent | null {
    const event = this.findEvent(ctx, eventId);
    return event ?? null;
  }

  /** All committed events for a tenant (test/inspection seam). */
  eventsFor(ctx: TenantContext): ReadonlyArray<OutboxEvent> {
    const store = this.stores.get(String(ctx.tenantId));
    if (!store) return [];
    return [...store.outbox.events.values()].sort((a, b) => a.revision - b.revision);
  }

  // --- internals ---

  private findEvent(
    ctx: TenantContext,
    eventId: string,
  ): MutableOutboxEvent | null {
    const store = this.stores.get(String(ctx.tenantId));
    if (!store) return null;
    const event = store.outbox.events.get(eventId);
    if (!event) return null;
    if (event.tenantId !== ctx.tenantId) return null; // cross-tenant fails closed
    return event;
  }

  private stagedCount(session: TransactionalSession): number {
    const missionSession = session as unknown as MissionTransactionSession;
    return missionSession.stagedEventCount();
  }
}
