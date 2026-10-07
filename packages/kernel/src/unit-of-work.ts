/**
 * @fleetos/kernel — UnitOfWork (law A1, A14).
 *
 * Groups repository read/write operations into ONE atomic boundary.
 * Commit applies all writes or none; a failed operation inside the unit
 * rolls the whole unit back. The UnitOfWork owns exactly one
 * TransactionalSession (created at open time, committed or rolled back
 * at close time).
 *
 * Pure TypeScript. The UnitOfWork delegates to a TransactionalSession +
 * the OutboxPort (so events written through the unit ARE in the same
 * atomic boundary as the state changes). Real rollback semantics come
 * from the underlying driver.
 */

import type { TransactionalSession, SessionRejection } from "./session.js";
import type { OutboxPort, OutboxEvent } from "./outbox.js";
import type { Result } from "./result.js";
import type { AuditEventRef } from "./audit.js";
import { ok, fail } from "./result.js";
import type { TenantContext } from "./tenant.js";

// ---------------------------------------------------------------------------
// UnitOfWorkRejection — stable reason codes the caller can branch on.
// ---------------------------------------------------------------------------

export type UnitOfWorkRejection =
  | SessionRejection
  | { readonly reason: "already-closed" }
  | { readonly reason: "operation-failed"; readonly cause: string }
  | { readonly reason: "publish-rejected"; readonly cause: string };

// ---------------------------------------------------------------------------
// UnitOfWork — the atomic boundary. Owns one session.
//
// Usage:
//   const uow = factory.open(ctx);
//   uow.execute(session => { ... });                  // stages writes
//   uow.publish({ type, payload, idempotencyKey });   // stages an event
//   uow.commit();                                     // applies all writes or none
//
// On any failure inside `execute`, the unit captures the error and rolls
// back the session. The caller SHOULD branch on `ok: false` with reason
// `operation-failed`. The unit refuses to commit after a rollback.
// ---------------------------------------------------------------------------

export interface UnitOfWork {
  readonly sessionId: string;
  readonly tenant: TenantContext;

  /**
   * Execute an operation within the unit's atomic boundary. The
   * operation receives the session so it can stage writes via the bound
   * repositories. The operation MUST be deterministic.
   *
   * If the operation throws, the unit captures the error and rolls back
   * the session. The caller SHOULD branch on `ok: false` with reason
   * `operation-failed`.
   */
  execute<T>(operation: (session: TransactionalSession) => T): Result<T, UnitOfWorkRejection>;

  /**
   * Publish an event through the outbox — staged in the same transaction
   * as the state changes. The event is NOT visible to readers until
   * `commit()` succeeds. On rollback, the event is discarded entirely.
   */
  publish(event: {
    readonly type: string;
    readonly payload: unknown;
    readonly idempotencyKey: string;
    readonly causationId?: string | null;
    readonly correlationId?: string | null;
    readonly occurredAt: number;
  }): Result<OutboxEvent, UnitOfWorkRejection>;

  /** Commit the unit — applies all staged writes or none. */
  commit(): Result<UnitOfWorkCommit, UnitOfWorkRejection>;

  /** Rollback the unit — discards all staged writes and events. */
  rollback(): Result<UnitOfWorkRollback, UnitOfWorkRejection>;

  /** Whether the unit is closed (committed or rolled back). */
  readonly closed: boolean;
}

export interface UnitOfWorkCommit {
  readonly committedAt: number;
  readonly audit: AuditEventRef;
  readonly stagedWrites: number;
  readonly stagedEvents: number;
}

export interface UnitOfWorkRollback {
  readonly rolledBackAt: number;
  readonly audit: AuditEventRef;
  readonly discardedWrites: number;
  readonly discardedEvents: number;
}

// ---------------------------------------------------------------------------
// UnitOfWorkFactory — the composition-layer seam. The TL's composition
// sites (apps/web, control-plane, application services) build a factory
// that produces units bound to the active driver + outbox.
// ---------------------------------------------------------------------------

export interface UnitOfWorkFactory {
  open(tenant: TenantContext): Result<UnitOfWork, UnitOfWorkRejection>;
}

/**
 * Default UnitOfWorkFactory — binds a session factory + the outbox port.
 * Pure, no I/O.
 */
export function unitOfWorkFactory(input: {
  readonly createSession: (
    tenant: TenantContext,
  ) => Result<TransactionalSession, SessionRejection>;
  readonly outbox: OutboxPort;
}): UnitOfWorkFactory {
  const { createSession, outbox } = input;
  return {
    open(tenant: TenantContext): Result<UnitOfWork, UnitOfWorkRejection> {
      const sessionResult = createSession(tenant);
      if (!sessionResult.ok) return fail(sessionResult.reason);
      const session = sessionResult.value;
      const begin = session.begin();
      if (!begin.ok) return fail(begin.reason);
      return ok({
        sessionId: session.id,
        tenant,
        get closed() {
          return session.state === "committed" || session.state === "rolled-back";
        },
        execute<T>(
          operation: (session: TransactionalSession) => T,
        ): Result<T, UnitOfWorkRejection> {
          if (session.state === "committed" || session.state === "rolled-back") {
            return fail({ reason: "already-closed" });
          }
          try {
            return ok(operation(session));
          } catch (error) {
            const rollback = session.rollback();
            if (!rollback.ok) return fail(rollback.reason);
            return fail({
              reason: "operation-failed",
              cause: error instanceof Error ? error.message : String(error),
            });
          }
        },
        publish(event): Result<OutboxEvent, UnitOfWorkRejection> {
          if (session.state === "committed" || session.state === "rolled-back") {
            return fail({ reason: "already-closed" });
          }
          const pub = outbox.publish({ session, event });
          if (!pub.ok) {
            return fail({ reason: "publish-rejected", cause: String(pub.reason) });
          }
          return ok(pub.value);
        },
        commit() {
          if (session.state === "committed" || session.state === "rolled-back") {
            return fail({ reason: "already-closed" });
          }
          const commitResult = session.commit();
          if (!commitResult.ok) return fail(commitResult.reason);
          return ok({
            committedAt: commitResult.value.committedAt,
            audit: commitResult.value.audit,
            stagedWrites: commitResult.value.stagedWrites,
            stagedEvents: commitResult.value.stagedEvents,
          });
        },
        rollback() {
          if (session.state === "committed" || session.state === "rolled-back") {
            return fail({ reason: "already-closed" });
          }
          const rollbackResult = session.rollback();
          if (!rollbackResult.ok) return fail(rollbackResult.reason);
          return ok({
            rolledBackAt: rollbackResult.value.rolledBackAt,
            audit: rollbackResult.value.audit,
            discardedWrites: rollbackResult.value.discardedWrites,
            discardedEvents: rollbackResult.value.discardedEvents,
          });
        },
      });
    },
  };
}
