/**
 * @fleetos/mission — the mission store and its transactional sessions
 * (the staging/commit half of the outbox seam, law A14).
 *
 * `MissionStore` holds the per-tenant committed state; `openSession`
 * binds a `MissionTransactionSession` to it. The session implements the
 * kernel's `TransactionalSession` TYPE (structurally pinned via
 * `implements`, so the TL can swap in the real kernel driver at
 * composition time without touching mission code): writes and outbox
 * events are STAGED in the session and become durable ONLY at commit —
 * a rolled-back transaction leaves NO state residue and NO event
 * residue. Savepoints give nested-rollback semantics over the staged
 * writes and events.
 *
 * TYPE imports only from `@fleetos/kernel`. No runtime imports from any
 * @fleetos/* package.
 */

import type {
  AuditEventRef,
  CommitResult,
  RollbackResult,
  Savepoint,
  SessionRejection,
  SessionState,
  SessionStage,
  TenantContext,
  TenantId,
  TransactionalSession,
} from "@fleetos/kernel";
import { fail, ok, type Result } from "./result.js";
import { digestOf } from "./digest.js";
import type { MissionTenantStore, MutableOutboxEvent } from "./outbox-contracts.js";

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
