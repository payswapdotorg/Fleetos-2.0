/**
 * @fleetos/kernel — InMemoryTransactionalSession (the deterministic reference).
 *
 * Implements the TransactionalSession port with REAL rollback semantics:
 * mutations are staged until commit; rollback discards. Savepoints are
 * snapshots of the staged-writes state. Per-tenant keyspaces isolate
 * tenants; cross-tenant access fails closed (A8).
 *
 * The driver backs the SessionStage surface the worker repositories
 * consume. Reads from the stage return the staged value if present,
 * otherwise fall through to the committed keyspace.
 *
 * Pure TypeScript, no I/O, no fs, no network, no global state. Two
 * drivers are independent; same operation sequence on the same driver
 * produces identical state (determinism machine-tested).
 */

import type { TenantContext, TenantId } from "../tenant.js";
import type { AuditEventRef } from "../audit.js";
import { auditEvent } from "../audit.js";
import { fail, ok, type Result } from "../result.js";
import type {
  CommitResult,
  RollbackResult,
  Savepoint,
  SessionRejection,
  SessionStage,
  TransactionalSession,
} from "../session.js";
import type { SessionState } from "../session.js";

// ---------------------------------------------------------------------------
// Tombstone — staged delete sentinel.
// ---------------------------------------------------------------------------

const TOMBSTONE_SENTINEL = Symbol.for("@fleetos/kernel:tombstone");

interface Tombstone {
  readonly __tombstone: typeof TOMBSTONE_SENTINEL;
}

function isTombstone(value: unknown): value is Tombstone {
  return (
    typeof value === "object" &&
    value !== null &&
    "__tombstone" in value &&
    (value as { __tombstone: unknown }).__tombstone === TOMBSTONE_SENTINEL
  );
}

// ---------------------------------------------------------------------------
// Keyspace — the committed durable state for a single tenant.
//
// Structure: Map<collection, Map<id, value>>. Per-tenant isolation is
// enforced at the driver boundary — a session can ONLY stage writes for
// its own tenant. Cross-tenant stage attempts raise a stable rejection.
// ---------------------------------------------------------------------------

export interface TenantKeyspace {
  readonly tenantId: TenantId;
  readonly collections: Map<string, Map<string, unknown>>;
  readonly outbox: OutboxStore;
}

// OutboxStore — committed outbox events for a tenant.
export interface OutboxStore {
  readonly events: Map<string, OutboxCommittedEvent>;
  readonly ackedKeys: Set<string>;
  revisions: number; // monotonic counter for next event revision (mutable on commit)
}

export interface OutboxCommittedEvent {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly type: string;
  readonly payload: unknown;
  readonly idempotencyKey: string;
  readonly occurredAt: number;
  readonly recordedAt: number;
  readonly revision: number;
  readonly causationId: string | null;
  readonly correlationId: string | null;
  state: "PENDING" | "DELIVERED" | "FAILED" | "DEAD_LETTER";
  deliveryAttempts: number;
  lastAttemptedAt: number | null;
  lastFailureReason: string | null;
  nextAttemptAt: number | null;
}

// ---------------------------------------------------------------------------
// InMemoryKernelDriver — owns the per-tenant keyspaces. Produces
// TransactionalSession instances bound to a single tenant.
// ---------------------------------------------------------------------------

export class InMemoryKernelDriver {
  private readonly keyspaces = new Map<string, TenantKeyspace>();
  private sessionCounter = 0;
  private readonly openSessions = new Map<string, InMemoryTransactionalSession>();

  /** Returns (creating if absent) the keyspace for `tenantId`. */
  keyspaceFor(tenantId: TenantId): TenantKeyspace {
    const key = String(tenantId);
    let ks = this.keyspaces.get(key);
    if (!ks) {
      ks = {
        tenantId,
        collections: new Map<string, Map<string, unknown>>(),
        outbox: { events: new Map(), ackedKeys: new Set(), revisions: 0 },
      };
      this.keyspaces.set(key, ks);
    }
    return ks;
  }

  /**
   * Opens a new transactional session bound to the given tenant context.
   * The session carries the immutable TenantContext for its lifetime.
   * The session is NOT active until begin() is called.
   */
  openSession(input: {
    readonly tenant: TenantContext;
    readonly now: number;
  }): InMemoryTransactionalSession {
    this.sessionCounter += 1;
    const id = `sess_${String(this.sessionCounter).padStart(8, "0")}`;
    const keyspace = this.keyspaceFor(input.tenant.tenantId);
    const session = new InMemoryTransactionalSession({
      id,
      tenant: input.tenant,
      keyspace,
      now: input.now,
    });
    this.openSessions.set(id, session);
    return session;
  }

  /** Snapshot the committed keyspace state for determinism tests. */
  snapshot(tenantId: TenantId): {
    readonly collections: ReadonlyMap<string, ReadonlyMap<string, unknown>>;
    readonly outboxCount: number;
  } {
    const ks = this.keyspaces.get(String(tenantId));
    if (!ks) return { collections: new Map(), outboxCount: 0 };
    return {
      collections: new Map(ks.collections),
      outboxCount: ks.outbox.events.size,
    };
  }

  /** Returns the number of distinct tenants with keyspaces. */
  tenantCount(): number {
    return this.keyspaces.size;
  }
}

// ---------------------------------------------------------------------------
// InMemoryTransactionalSession — implements TransactionalSession.
//
// Staged writes are a Map<collection, Map<id, value | tombstone>>. A
// tombstone means "delete this id at commit". A real value means "put
// this id at commit". The session sees staged-or-committed values via
// the SessionStage surface.
//
// Savepoints snapshot the staged-writes map (shallow per-collection, deep
// per-id — copy the Map). rollbackTo restores the snapshot. release
// discards the snapshot (the writes become part of the session's stage).
// ---------------------------------------------------------------------------

interface SavepointRecord {
  readonly name: string;
  readonly sequence: number;
  readonly createdAt: number;
  // Snapshot of staged writes at checkpoint time. Keyed by collection.
  readonly writes: Map<string, Map<string, unknown>>;
  // Snapshot of staged events at checkpoint time.
  readonly events: OutboxStagedEvent[];
}

interface OutboxStagedEvent {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly type: string;
  readonly payload: unknown;
  readonly idempotencyKey: string;
  readonly occurredAt: number;
  readonly causationId: string | null;
  readonly correlationId: string | null;
}

export class InMemoryTransactionalSession implements TransactionalSession {
  readonly id: string;
  readonly tenant: TenantContext;
  private _state: SessionState = "open";
  private readonly keyspace: TenantKeyspace;
  private readonly stagedWrites = new Map<string, Map<string, unknown>>();
  private readonly stagedEvents: OutboxStagedEvent[] = [];
  private readonly _savepoints = new Map<string, SavepointRecord>();
  private savepointCounter = 0;
  private readonly openedAt: number;

  constructor(input: {
    readonly id: string;
    readonly tenant: TenantContext;
    readonly keyspace: TenantKeyspace;
    readonly now: number;
  }) {
    this.id = input.id;
    this.tenant = input.tenant;
    this.keyspace = input.keyspace;
    this.openedAt = input.now;
  }

  get state(): SessionState {
    return this._state;
  }

  begin(): Result<void, SessionRejection> {
    if (this._state === "committed" || this._state === "rolled-back") {
      return fail({ reason: "illegal-state", state: this._state });
    }
    if (this._state === "active") {
      return ok(undefined); // idempotent
    }
    this._state = "active";
    return ok(undefined);
  }

  stage<T>(mutate: (stage: SessionStage) => T): Result<T, SessionRejection> {
    if (this._state !== "active") {
      return fail({ reason: "illegal-state", state: this._state, detail: "stage requires active session" });
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
    // Apply staged writes to the committed keyspace.
    for (const [collection, writes] of this.stagedWrites) {
      let committed = this.keyspace.collections.get(collection);
      if (!committed) {
        committed = new Map<string, unknown>();
        this.keyspace.collections.set(collection, committed);
      }
      for (const [id, value] of writes) {
        if (isTombstone(value)) {
          committed.delete(id);
        } else {
          committed.set(id, value);
        }
      }
    }
    // Apply staged events to the committed outbox. Atomic with writes.
    for (const staged of this.stagedEvents) {
      this.keyspace.outbox.revisions += 1;
      const event: OutboxCommittedEvent = {
        id: staged.id,
        tenantId: staged.tenantId,
        type: staged.type,
        payload: staged.payload,
        idempotencyKey: staged.idempotencyKey,
        occurredAt: staged.occurredAt,
        recordedAt: now,
        revision: this.keyspace.outbox.revisions,
        causationId: staged.causationId,
        correlationId: staged.correlationId,
        state: "PENDING",
        deliveryAttempts: 0,
        lastAttemptedAt: null,
        lastFailureReason: null,
        nextAttemptAt: null,
      };
      this.keyspace.outbox.events.set(event.id, event);
    }
    this._state = "committed";
    const audit: AuditEventRef = auditEvent({
      actor: this.tenant.actorId,
      intent: "session:commit",
      tenant: this.tenant.tenantId,
      session: this.tenant.sessionId,
      timestamp: now,
    });
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
    // Discard staged writes and events — they are NEVER applied to the
    // committed keyspace. This is the dual-write-gap impossibility proof:
    // no committed state can have a lost event, and no rolled-back tx
    // leaves residue.
    this.stagedWrites.clear();
    this.stagedEvents.length = 0;
    this._savepoints.clear();
    this._state = "rolled-back";
    const now = this.openedAt + 1;
    const audit: AuditEventRef = auditEvent({
      actor: this.tenant.actorId,
      intent: "session:rollback",
      tenant: this.tenant.tenantId,
      session: this.tenant.sessionId,
      timestamp: now,
    });
    return ok({
      state: this._state,
      rolledBackAt: now,
      audit,
      discardedWrites,
      discardedEvents,
    });
  }

  // --- savepoints ---

  checkpoint(name: string): Result<Savepoint, SessionRejection> {
    if (this._state !== "active") {
      return fail({ reason: "illegal-state", state: this._state });
    }
    if (this._savepoints.has(name)) {
      return fail({ reason: "duplicate-savepoint", state: this._state, detail: name });
    }
    this.savepointCounter += 1;
    const writesCopy = new Map<string, Map<string, unknown>>();
    for (const [collection, writes] of this.stagedWrites) {
      writesCopy.set(collection, new Map(writes));
    }
    const eventsCopy = [...this.stagedEvents];
    const record: SavepointRecord = {
      name,
      sequence: this.savepointCounter,
      createdAt: this.openedAt,
      writes: writesCopy,
      events: eventsCopy,
    };
    this._savepoints.set(name, record);
    return ok({ name, createdAt: record.createdAt, sequence: record.sequence });
  }

  release(name: string): Result<void, SessionRejection> {
    if (this._state !== "active") {
      return fail({ reason: "illegal-state", state: this._state });
    }
    if (!this._savepoints.has(name)) {
      return fail({ reason: "savepoint-not-found", state: this._state, detail: name });
    }
    this._savepoints.delete(name);
    return ok(undefined);
  }

  rollbackTo(name: string): Result<Savepoint, SessionRejection> {
    if (this._state !== "active") {
      return fail({ reason: "illegal-state", state: this._state });
    }
    const record = this._savepoints.get(name);
    if (!record) {
      return fail({ reason: "savepoint-not-found", state: this._state, detail: name });
    }
    // Restore staged writes to the snapshot.
    this.stagedWrites.clear();
    for (const [collection, writes] of record.writes) {
      this.stagedWrites.set(collection, new Map(writes));
    }
    // Restore staged events to the snapshot.
    this.stagedEvents.length = 0;
    for (const ev of record.events) this.stagedEvents.push(ev);
    // Drop savepoints created AFTER this one (they reference a state we
    // just discarded).
    for (const sp of this._savepoints.values()) {
      if (sp.sequence > record.sequence) this._savepoints.delete(sp.name);
    }
    return ok({
      name: record.name,
      createdAt: record.createdAt,
      sequence: record.sequence,
    });
  }

  savepoints(): ReadonlyArray<Savepoint> {
    return [...this._savepoints.values()]
      .sort((a, b) => a.sequence - b.sequence)
      .map((r) => ({ name: r.name, createdAt: r.createdAt, sequence: r.sequence }));
  }

  // --- outbox staging (called by InMemoryOutbox.publish) ---

  stageOutboxEvent(event: OutboxStagedEvent): void {
    if (this._state !== "active") {
      throw new Error(`kernel: cannot stage outbox event in state ${this._state}`);
    }
    this.stagedEvents.push(event);
  }

  /** Number of staged events in this session (visible only after commit). */
  stagedEventCount(): number {
    return this.stagedEvents.length;
  }

  // --- internal stage ops ---

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
    writes.set(id, { __tombstone: TOMBSTONE_SENTINEL });
  }

  private getInternal(collection: string, id: string): unknown | null {
    const writes = this.stagedWrites.get(collection);
    if (writes) {
      const staged = writes.get(id);
      if (staged !== undefined) {
        if (isTombstone(staged)) return null;
        return staged;
      }
    }
    // Fall through to committed keyspace.
    const committed = this.keyspace.collections.get(collection);
    if (!committed) return null;
    return committed.get(id) ?? null;
  }

  private listInternal(collection: string): ReadonlyArray<unknown> {
    // Merge committed + staged (staged overrides committed; tombstones
    // remove committed).
    const committed = this.keyspace.collections.get(collection);
    const merged = new Map<string, unknown>();
    if (committed) {
      for (const [id, value] of committed) {
        // Tenant isolation: the keyspace is per-tenant, so every value
        // here belongs to this session's tenant.
        merged.set(id, value);
      }
    }
    const writes = this.stagedWrites.get(collection);
    if (writes) {
      for (const [id, value] of writes) {
        if (isTombstone(value)) {
          merged.delete(id);
        } else {
          merged.set(id, value);
        }
      }
    }
    return [...merged.values()];
  }

  private countStagedWrites(): number {
    let count = 0;
    for (const writes of this.stagedWrites.values()) {
      count += writes.size;
    }
    return count;
  }
}
