/**
 * @fleetos/kernel — TransactionalSession port + savepoints (law A1, A8, A14).
 *
 * The TransactionalSession is the approved shared primitive for every
 * persistence boundary in FleetOS. It carries an immutable TenantContext
 * established at the boundary (A8); a session without tenant context
 * fails closed. It supports begin/commit/rollback plus savepoints
 * (checkpoint/release/rollbackTo).
 *
 * Pure TypeScript port. The deterministic in-memory driver lives in
 * `./driver/in-memory-session.ts`; the Postgres live binding is a later
 * deployment work item (see `infrastructure/postgres/`).
 */

import type { TenantContext } from "./tenant.js";
import type { Result } from "./result.js";
import type { AuditEventRef } from "./audit.js";

// ---------------------------------------------------------------------------
// Session state machine.
//
//   open ---begin--> active ---commit--> committed (terminal)
//                       \
//                        +-rollback--> rolled-back (terminal)
//
//   Within `active`, savepoints can be checkpointed, released, and
//   rolled-back-to. After commit/rollback the session is terminal —
//   any further operation is refused with `illegal-state`.
// ---------------------------------------------------------------------------

export type SessionState = "open" | "active" | "committed" | "rolled-back";

export type SessionRejectionCode =
  | "illegal-state"
  | "savepoint-not-found"
  | "duplicate-savepoint"
  | "session-closed";

export interface SessionRejection {
  readonly reason: SessionRejectionCode;
  readonly state: SessionState;
  readonly detail?: string;
}

// ---------------------------------------------------------------------------
// Savepoint — a named checkpoint within an active session. A savepoint
// captures the staged-writes snapshot at the time of `checkpoint()`. A
// rollback-to-savepoint discards all writes staged after the savepoint
// but preserves writes staged before it. Releasing a savepoint discards
// the snapshot (the writes become part of the session's permanent stage
// until commit/rollback).
// ---------------------------------------------------------------------------

export interface Savepoint {
  readonly name: string;
  readonly createdAt: number;
  readonly sequence: number; // monotonic per-session counter
}

// ---------------------------------------------------------------------------
// TransactionalSession port — the structural seam every driver implements.
//
// Every method receives the immutable TenantContext (carried at session
// open). Cross-tenant operations fail closed. The audit field on commit/
// rollback is the A19 record for the session boundary itself.
// ---------------------------------------------------------------------------

export interface TransactionalSession {
  readonly id: string;
  readonly tenant: TenantContext;
  readonly state: SessionState;

  /** Begin the transaction. Idempotent if already active; refused if terminal. */
  begin(): Result<void, SessionRejection>;

  /**
   * Stage a write (mutation) in this transaction. The write is NOT visible
   * to other sessions until commit. The driver is the authority for what
   * "stage" means (in-memory: a staged-writes map; postgres: a BEGIN …
   * transaction). The stage function MUST be deterministic.
   *
   * The driver invokes the stage function with a private Stage context
   * that exposes the staged-writes snapshot for the current session —
   * this is what makes the in-memory driver a REAL transactional engine
   * (mutations staged until commit; rollback discards).
   */
  stage<T>(mutate: (stage: SessionStage) => T): Result<T, SessionRejection>;

  /**
   * Commit the transaction. All staged writes become durable atomically
   * (in-memory: applied to the keyspace; postgres: COMMIT). If commit
   * fails, the session is rolled back (no partial commit).
   */
  commit(): Result<CommitResult, SessionRejection>;

  /** Rollback the transaction. All staged writes are discarded. */
  rollback(): Result<RollbackResult, SessionRejection>;

  // --- savepoints ---

  /** Create a named savepoint within an active session. */
  checkpoint(name: string): Result<Savepoint, SessionRejection>;

  /** Release a named savepoint (the snapshot is discarded; writes are kept). */
  release(name: string): Result<void, SessionRejection>;

  /** Roll back to a named savepoint (writes staged after it are discarded). */
  rollbackTo(name: string): Result<Savepoint, SessionRejection>;

  /** Returns the names of all live savepoints (in checkpoint order). */
  savepoints(): ReadonlyArray<Savepoint>;
}

// ---------------------------------------------------------------------------
// SessionStage — the in-session staged-writes surface the driver hands to
// `stage(mutate)`. Worker repositories consume this through the kernel's
// RepositoryPort binding contracts; the in-memory driver implements it
// directly. Reads from the stage return the staged value if present,
// otherwise fall through to the committed keyspace (within the same
// tenant's keyspace — cross-tenant reads fail closed).
// ---------------------------------------------------------------------------

export interface SessionStage {
  readonly tenant: TenantContext;
  readonly sessionId: string;

  /** Stage a write at (collection, id). Replaces any prior staged value. */
  put(collection: string, id: string, value: unknown): void;

  /** Stage a delete at (collection, id). A subsequent get returns null. */
  remove(collection: string, id: string): void;

  /**
   * Read the staged-or-committed value at (collection, id). Cross-tenant
   * reads fail closed (returns null — the driver enforces tenant scope).
   */
  get(collection: string, id: string): unknown | null;

  /**
   * Enumerate the staged-or-committed values in a collection for this
   * session's tenant. Cross-tenant enumeration returns an empty array.
   */
  list(collection: string): ReadonlyArray<unknown>;
}

// ---------------------------------------------------------------------------
// CommitResult / RollbackResult — include the audit refs for the session
// boundary itself (A19).
// ---------------------------------------------------------------------------

export interface CommitResult {
  readonly state: SessionState;
  readonly committedAt: number;
  readonly audit: AuditEventRef;
  readonly stagedWrites: number;
  readonly stagedEvents: number;
}

export interface RollbackResult {
  readonly state: SessionState;
  readonly rolledBackAt: number;
  readonly audit: AuditEventRef;
  readonly discardedWrites: number;
  readonly discardedEvents: number;
}
