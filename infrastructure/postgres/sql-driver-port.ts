/**
 * FleetOS 2.0 — SqlDriverPort (the Postgres driver seam).
 *
 * Structural interface shaping connection/transaction primitives for
 * `node-postgres`/`pg`-style drivers. The kernel's
 * `TransactionalSession` port binds to this surface; the live
 * implementation will translate session semantics into `BEGIN`,
 * `SAVEPOINT`, `RELEASE SAVEPOINT`, `ROLLBACK TO SAVEPOINT`, `COMMIT`,
 * `ROLLBACK`.
 *
 * Pure TypeScript interface — no `pg` dependency, no network, no
 * credentials. The live binding is a later deployment work item (see
 * `infrastructure/README.md`).
 */

// ---------------------------------------------------------------------------
// Connection / pool primitives — shaped for node-postgres/pg-style drivers.
//
// A real driver implementation will receive a `pg.Pool` and adapt it to
// this interface. The interface intentionally exposes the smallest
// surface the kernel needs — connection acquisition + a SQL execution
// primitive that returns rows.
// ---------------------------------------------------------------------------

export interface SqlRow {
  readonly [column: string]: unknown;
}

export interface SqlConnection {
  /** Execute a parameterized SQL statement. Returns the affected row count. */
  execute(sql: SqlStatement): Promise<SqlExecutionResult>;
  /** Query rows from a parameterized SQL statement. */
  query(sql: SqlStatement): Promise<ReadonlyArray<SqlRow>>;
  /** Release the connection back to the pool (no-op for transaction-bound connections). */
  release(): Promise<void>;
}

export interface SqlStatement {
  /** The SQL text with `$1`, `$2`, … placeholders for parameters. */
  readonly text: string;
  /** The bound parameters, in placeholder order. */
  readonly values: ReadonlyArray<unknown>;
}

export interface SqlExecutionResult {
  readonly affectedRowCount: number;
}

// ---------------------------------------------------------------------------
// SqlTransaction — the transactional primitive. The kernel's
// TransactionalSession port binds to this surface: begin/commit/rollback
// + savepoint/checkpoint/release/rollback-to.
//
// A real driver will wrap a `pg.Client` (or a `pg.Pool` connection in
// `BEGIN` mode) and translate the kernel's session state machine into
// SQL statements.
// ---------------------------------------------------------------------------

export interface SqlTransaction extends SqlConnection {
  /** BEGIN — open the transaction. */
  beginTransaction(): Promise<void>;
  /** COMMIT — finalize the transaction atomically. */
  commitTransaction(): Promise<void>;
  /** ROLLBACK — discard the transaction entirely. */
  rollbackTransaction(): Promise<void>;

  // --- savepoints (named checkpoints within the transaction) ---

  /** SAVEPOINT <name> — create a named checkpoint. */
  savepoint(name: string): Promise<void>;
  /** RELEASE SAVEPOINT <name> — discard the checkpoint (writes are kept). */
  releaseSavepoint(name: string): Promise<void>;
  /** ROLLBACK TO SAVEPOINT <name> — discard writes after the checkpoint. */
  rollbackToSavepoint(name: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// SqlDriverPort — the structural seam. The kernel's composition layer
// binds a SqlDriverPort implementation to a TransactionalSession at
// runtime.
// ---------------------------------------------------------------------------

export interface SqlDriverPort {
  /** Acquire a connection from the pool (autocommit mode). */
  acquire(): Promise<SqlConnection>;
  /** Open a transaction (BEGIN mode). The returned connection is bound to a transaction. */
  beginTransaction(): Promise<SqlTransaction>;
  /** The current driver state — used for health checks and degraded-mode signalling. */
  state(): SqlDriverState;
}

export type SqlDriverState = "unimplemented" | "ready" | "degraded" | "offline";
