/**
 * @fleetos/mission — the outbox seam (law A14 — transactional event
 * publication).
 *
 * Mission state changes emit outbox events through the kernel's
 * `OutboxPort` TYPE with an in-memory reference adapter implemented
 * HERE — the mission package's own deterministic driver. The adapter and
 * the accompanying `MissionTransactionSession` (which implements the
 * kernel's `TransactionalSession` TYPE) are structurally pinned to the
 * kernel contracts via `implements`, so the TL can swap in the real
 * kernel driver at composition time without touching mission code.
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
  AuditEventRef,
  OutboxAckOutcome,
  OutboxAckRejection,
  OutboxEvent,
  OutboxEventState,
  OutboxPort,
  OutboxPublishRejection,
  Savepoint,
  SessionRejection,
  SessionState,
  SessionStage,
  TenantContext,
  TenantId,
  TransactionalSession,
  CommitResult,
  RollbackResult,
} from "@fleetos/kernel";
import { fail, ok, type Result } from "./result.js";
import { digestOf } from "./digest.js";

// ---------------------------------------------------------------------------
// Retry policy — deterministic basis-point backoff (integer math).
// ---------------------------------------------------------------------------

export interface OutboxRetryPolicy {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly backoffBps: number;
}

export const DEFAULT_OUTBOX_RETRY_POLICY: OutboxRetryPolicy = {
  maxAttempts: 5,
  baseDelayMs: 100,
  maxDelayMs: 30_000,
  backoffBps: 20_000,
};

/** Delay before the attempt AFTER the failedAttempt-th (1-indexed). */
export function outboxRetryDelayMs(
  policy: OutboxRetryPolicy,
  failedAttempt: number,
): number | null {
  if (!Number.isInteger(failedAttempt) || failedAttempt < 1) return null;
  if (failedAttempt >= policy.maxAttempts) return null;
  let delay = policy.baseDelayMs;
  for (let i = 1; i < failedAttempt; i++) {
    if (delay > Math.floor(Number.MAX_SAFE_INTEGER / policy.backoffBps)) {
      return policy.maxDelayMs;
    }
    delay = Math.floor((delay * policy.backoffBps) / 10_000);
    if (delay >= policy.maxDelayMs) return policy.maxDelayMs;
  }
  return Math.min(delay, policy.maxDelayMs);
}

// ---------------------------------------------------------------------------
// The store — per-tenant committed state.
// ---------------------------------------------------------------------------

export interface MutableOutboxEvent {
  id: string;
  tenantId: TenantId;
  type: string;
  payload: unknown;
  idempotencyKey: string;
  occurredAt: number;
  recordedAt: number;
  revision: number;
  causationId: string | null;
  correlationId: string | null;
  state: OutboxEventState;
  deliveryAttempts: number;
  lastAttemptedAt: number | null;
  lastFailureReason: string | null;
  nextAttemptAt: number | null;
}

export interface MissionTenantStore {
  readonly tenantId: TenantId;
  readonly collections: Map<string, Map<string, unknown>>;
  readonly outbox: {
    readonly events: Map<string, MutableOutboxEvent>;
    revisions: number;
  };
}

export class MissionStore {
  /**
   * The per-tenant committed stores — exposed so the outbox adapter can be
   * constructed over the SAME committed state (the composition seam the
   * runtime and tests wire together).
   */
  public readonly stores = new Map<string, MissionTenantStore>();
  private sessionCounter = 0;

  /** Returns (creating if absent) the committed store for a tenant. */
  storeFor(tenantId: TenantId): MissionTenantStore {
    const key = String(tenantId);
    let store = this.stores.get(key);
    if (!store) {
      store = {
        tenantId,
        collections: new Map<string, Map<string, unknown>>(),
        outbox: { events: new Map<string, MutableOutboxEvent>(), revisions: 0 },
      };
      this.stores.set(key, store);
    }
    return store;
  }

  /** Committed collection read (tenant-scoped by construction). */
  collection(tenantId: TenantId, name: string): ReadonlyArray<unknown> {
    const store = this.stores.get(String(tenantId));
    if (!store) return [];
    const coll = store.collections.get(name);
    return coll ? [...coll.values()] : [];
  }

  /** Committed value at (collection, id). */
  get(tenantId: TenantId, collection: string, id: string): unknown | null {
    const store = this.stores.get(String(tenantId));
    if (!store) return null;
    const coll = store.collections.get(collection);
    if (!coll) return null;
    return coll.get(id) ?? null;
  }

  /** Open a transactional session bound to a tenant context. */
  openSession(input: {
    readonly ctx: TenantContext;
    readonly now: number;
  }): MissionTransactionSession {
    this.sessionCounter += 1;
    return new MissionTransactionSession({
      id: `msess_${String(this.sessionCounter).padStart(8, "0")}`,
      tenant: input.ctx,
      store: this.storeFor(input.ctx.tenantId),
      now: input.now,
    });
  }
}

// ---------------------------------------------------------------------------
// MissionTransactionSession — implements the kernel's TransactionalSession.
// ---------------------------------------------------------------------------

const TOMBSTONE = Symbol.for("@fleetos/mission:tombstone");

interface StagedOutboxEvent {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly type: string;
  readonly payload: unknown;
  readonly idempotencyKey: string;
  readonly occurredAt: number;
  readonly causationId: string | null;
  readonly correlationId: string | null;
}

interface SavepointRecord {
  readonly name: string;
  readonly sequence: number;
  readonly createdAt: number;
  readonly writes: Map<string, Map<string, unknown>>;
  readonly events: StagedOutboxEvent[];
}

export class MissionTransactionSession implements TransactionalSession {
  readonly id: string;
  readonly tenant: TenantContext;
  private _state: SessionState = "open";
  private readonly store: MissionTenantStore;
  private readonly stagedWrites = new Map<string, Map<string, unknown>>();
  private readonly stagedEvents: StagedOutboxEvent[] = [];
  private readonly savepointMap = new Map<string, SavepointRecord>();
  private savepointCounter = 0;
  private readonly openedAt: number;

  constructor(input: {
    readonly id: string;
    readonly tenant: TenantContext;
    readonly store: MissionTenantStore;
    readonly now: number;
  }) {
    this.id = input.id;
    this.tenant = input.tenant;
    this.store = input.store;
    this.openedAt = input.now;
  }

  get state(): SessionState {
    return this._state;
  }

  begin(): Result<void, SessionRejection> {
    if (this._state === "committed" || this._state === "rolled-back") {
      return fail({ reason: "illegal-state", state: this._state });
    }
    if (this._state === "active") return ok(undefined);
    this._state = "active";
    return ok(undefined);
  }

  stage<T>(mutate: (stage: SessionStage) => T): Result<T, SessionRejection> {
    if (this._state !== "active") {
      return fail({
        reason: "illegal-state",
        state: this._state,
        detail: "stage requires active session",
      });
    }
    const stage: SessionStage = {
      tenant: this.tenant,
      sessionId: this.id,
      put: (collection, id, value) => this.putInternal(collection, id, value),
      remove: (collection, id) => this.removeInternal(collection, id),
      get: (collection, id) => this.getInternal(collection, id),
      list: (collection) => this.listInternal(collection),
    };
    return ok(mutate(stage));
  }

  commit(): Result<CommitResult, SessionRejection> {
    if (this._state !== "active") {
      return fail({ reason: "illegal-state", state: this._state });
    }
    const now = this.openedAt + 1;
    for (const [collection, writes] of this.stagedWrites) {
      let committed = this.store.collections.get(collection);
      if (!committed) {
        committed = new Map<string, unknown>();
        this.store.collections.set(collection, committed);
      }
      for (const [id, value] of writes) {
        if (value === TOMBSTONE) committed.delete(id);
        else committed.set(id, value);
      }
    }
    for (const staged of this.stagedEvents) {
      this.store.outbox.revisions += 1;
      const event: MutableOutboxEvent = {
        id: staged.id,
        tenantId: staged.tenantId,
        type: staged.type,
        payload: staged.payload,
        idempotencyKey: staged.idempotencyKey,
        occurredAt: staged.occurredAt,
        recordedAt: now,
        revision: this.store.outbox.revisions,
        causationId: staged.causationId,
        correlationId: staged.correlationId,
        state: "PENDING",
        deliveryAttempts: 0,
        lastAttemptedAt: null,
        lastFailureReason: null,
        nextAttemptAt: null,
      };
      this.store.outbox.events.set(event.id, event);
    }
    this._state = "committed";
    const audit: AuditEventRef = {
      actor: this.tenant.actorId,
      intent: "mission-session:commit",
      tenant: this.tenant.tenantId,
      session: this.tenant.sessionId,
      timestamp: now,
      digest: digestOf(
        String(this.tenant.actorId),
        "mission-session:commit",
        String(this.tenant.tenantId),
        String(this.tenant.sessionId),
        now,
      ),
    };
    return ok({
      state: this._state,
      committedAt: now,
      audit,
      stagedWrites: this.countStagedWrites(),
      stagedEvents: this.stagedEvents.length,
    });
  }

  rollback(): Result<RollbackResult, SessionRejection> {
    if (this._state !== "active") {
      return fail({ reason: "illegal-state", state: this._state });
    }
    const discardedWrites = this.countStagedWrites();
    const discardedEvents = this.stagedEvents.length;
    this.stagedWrites.clear();
    this.stagedEvents.length = 0;
    this.savepointMap.clear();
    this._state = "rolled-back";
    const now = this.openedAt + 1;
    const audit: AuditEventRef = {
      actor: this.tenant.actorId,
      intent: "mission-session:rollback",
      tenant: this.tenant.tenantId,
      session: this.tenant.sessionId,
      timestamp: now,
      digest: digestOf(
        String(this.tenant.actorId),
        "mission-session:rollback",
        String(this.tenant.tenantId),
        String(this.tenant.sessionId),
        now,
      ),
    };
    return ok({
      state: this._state,
      rolledBackAt: now,
      audit,
      discardedWrites,
      discardedEvents,
    });
  }

  checkpoint(name: string): Result<Savepoint, SessionRejection> {
    if (this._state !== "active") {
      return fail({ reason: "illegal-state", state: this._state });
    }
    if (this.savepointMap.has(name)) {
      return fail({ reason: "duplicate-savepoint", state: this._state, detail: name });
    }
    this.savepointCounter += 1;
    const writesCopy = new Map<string, Map<string, unknown>>();
    for (const [collection, writes] of this.stagedWrites) {
      writesCopy.set(collection, new Map(writes));
    }
    const record: SavepointRecord = {
      name,
      sequence: this.savepointCounter,
      createdAt: this.openedAt,
      writes: writesCopy,
      events: [...this.stagedEvents],
    };
    this.savepointMap.set(name, record);
    return ok({ name, createdAt: record.createdAt, sequence: record.sequence });
  }

  release(name: string): Result<void, SessionRejection> {
    if (this._state !== "active") {
      return fail({ reason: "illegal-state", state: this._state });
    }
    if (!this.savepointMap.has(name)) {
      return fail({ reason: "savepoint-not-found", state: this._state, detail: name });
    }
    this.savepointMap.delete(name);
    return ok(undefined);
  }

  rollbackTo(name: string): Result<Savepoint, SessionRejection> {
    if (this._state !== "active") {
      return fail({ reason: "illegal-state", state: this._state });
    }
    const record = this.savepointMap.get(name);
    if (!record) {
      return fail({ reason: "savepoint-not-found", state: this._state, detail: name });
    }
    this.stagedWrites.clear();
    for (const [collection, writes] of record.writes) {
      this.stagedWrites.set(collection, new Map(writes));
    }
    this.stagedEvents.length = 0;
    for (const ev of record.events) this.stagedEvents.push(ev);
    for (const sp of this.savepointMap.values()) {
      if (sp.sequence > record.sequence) this.savepointMap.delete(sp.name);
    }
    return ok({
      name: record.name,
      createdAt: record.createdAt,
      sequence: record.sequence,
    });
  }

  savepoints(): ReadonlyArray<Savepoint> {
    return [...this.savepointMap.values()]
      .sort((a, b) => a.sequence - b.sequence)
      .map((r) => ({ name: r.name, createdAt: r.createdAt, sequence: r.sequence }));
  }

  /** Called by InMemoryMissionOutbox.publish — stages the event in THIS session. */
  stageOutboxEvent(event: StagedOutboxEvent): void {
    if (this._state !== "active") {
      throw new Error(`mission: cannot stage outbox event in state ${this._state}`);
    }
    this.stagedEvents.push(event);
  }

  /** Number of staged events (visible only after commit). */
  stagedEventCount(): number {
    return this.stagedEvents.length;
  }

  // --- internals ---

  private putInternal(collection: string, id: string, value: unknown): void {
    let writes = this.stagedWrites.get(collection);
    if (!writes) {
      writes = new Map<string, unknown>();
      this.stagedWrites.set(collection, writes);
    }
    writes.set(id, value);
  }

  private removeInternal(collection: string, id: string): void {
    let writes = this.stagedWrites.get(collection);
    if (!writes) {
      writes = new Map<string, unknown>();
      this.stagedWrites.set(collection, writes);
    }
    writes.set(id, TOMBSTONE);
  }

  private getInternal(collection: string, id: string): unknown | null {
    const writes = this.stagedWrites.get(collection);
    if (writes) {
      const staged = writes.get(id);
      if (staged !== undefined) {
        return staged === TOMBSTONE ? null : staged;
      }
    }
    const committed = this.store.collections.get(collection);
    if (!committed) return null;
    return committed.get(id) ?? null;
  }

  private listInternal(collection: string): ReadonlyArray<unknown> {
    const merged = new Map<string, unknown>();
    const committed = this.store.collections.get(collection);
    if (committed) {
      for (const [id, value] of committed) merged.set(id, value);
    }
    const writes = this.stagedWrites.get(collection);
    if (writes) {
      for (const [id, value] of writes) {
        if (value === TOMBSTONE) merged.delete(id);
        else merged.set(id, value);
      }
    }
    return [...merged.values()];
  }

  private countStagedWrites(): number {
    let count = 0;
    for (const writes of this.stagedWrites.values()) count += writes.size;
    return count;
  }
}

// ---------------------------------------------------------------------------
// InMemoryMissionOutbox — implements the kernel's OutboxPort.
// ---------------------------------------------------------------------------

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
