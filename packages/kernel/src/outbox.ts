/**
 * @fleetos/kernel — Outbox port (law A14 — transactional event publication).
 *
 * The Outbox is the dual-write-gap killer. Events are written in the SAME
 * transaction as the state change. A committed state change with a lost
 * event is IMPOSSIBLE (machine-tested). A rolled-back transaction leaves
 * NO events (machine-tested).
 *
 * Drain contract: at-least-once delivery with idempotency keys. A
 * redelivered event is acknowledged identically, never re-applied twice
 * at the reader seam. Pending/Failed/Delivered states with retry policy
 * types (bounded backoff).
 *
 * Pure TypeScript port. The deterministic in-memory reference lives in
 * `./driver/in-memory-outbox.ts`; the Postgres live binding is a later
 * deployment work item.
 */

import type { TenantContext, TenantId } from "./tenant.js";
import type { TransactionalSession } from "./session.js";
import type { Result } from "./result.js";

// ---------------------------------------------------------------------------
// OutboxEvent — the durable event record. Written in-tx, drained out-of-tx.
// ---------------------------------------------------------------------------

export type OutboxEventState = "PENDING" | "DELIVERED" | "FAILED" | "DEAD_LETTER";

export interface OutboxEvent {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly type: string;
  readonly payload: unknown;
  readonly idempotencyKey: string;
  readonly occurredAt: number;
  readonly recordedAt: number;
  readonly revision: number; // monotonic per-tenant outbox revision
  readonly causationId: string | null;
  readonly correlationId: string | null;
  readonly state: OutboxEventState;
  readonly deliveryAttempts: number;
  readonly lastAttemptedAt: number | null;
  readonly lastFailureReason: string | null;
  readonly nextAttemptAt: number | null;
}

// ---------------------------------------------------------------------------
// OutboxPort — the structural seam every driver implements.
// ---------------------------------------------------------------------------

export type OutboxPublishRejection =
  | "session-not-active"
  | "missing-type"
  | "missing-idempotency-key"
  | "missing-tenant";

export type OutboxAckRejection =
  | "event-not-found"
  | "tenant-mismatch"
  | "idempotency-key-mismatch";

export type OutboxAckOutcome = "newly-acknowledged" | "already-acknowledged";

export interface OutboxPort {
  /**
   * Publish an event in the SAME transaction as the state change.
   *
   * MUST be called within an active session — the event is staged in the
   * session's stage, NOT visible to readers until commit. On commit, the
   * event becomes PENDING in the durable outbox. On rollback, the event
   * is discarded entirely (no PENDING/DELIVERED/FAILED residue).
   *
   * The idempotencyKey is required — at-least-once delivery is enforced
   * by the drain contract, and the reader's seam MUST deduplicate on
   * this key. The kernel never re-applies a side-effect.
   */
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
  }): Result<OutboxEvent, OutboxPublishRejection>;

  /**
   * Read pending events for a tenant — the drain entrypoint. Returns at
   * most `limit` events in (revision ASC) order. Events with a
   * `nextAttemptAt` in the future are skipped until their retry window
   * opens. Cross-tenant reads return an empty array.
   */
  pending(input: {
    readonly ctx: TenantContext;
    readonly limit?: number;
    readonly now: number;
  }): ReadonlyArray<OutboxEvent>;

  /**
   * Acknowledge an event. Idempotent: calling ack with the same eventId
   * and idempotencyKey twice returns "already-acknowledged" on the
   * second call and does NOT mutate the event. The reader's seam MUST
   * use the idempotencyKey to deduplicate the side-effect itself; the
   * kernel's responsibility is to make ack idempotent at the kernel
   * boundary.
   *
   * Returns the new state of the event after ack.
   */
  ack(input: {
    readonly ctx: TenantContext;
    readonly eventId: string;
    readonly idempotencyKey: string;
    readonly now: number;
  }): Result<{ readonly event: OutboxEvent; readonly outcome: OutboxAckOutcome }, OutboxAckRejection>;

  /**
   * Mark an event as FAILED and schedule a retry per the retry policy.
   * After exhausting the retry policy's attempts, the event moves to
   * DEAD_LETTER (still readable, no longer retried).
   */
  markFailed(input: {
    readonly ctx: TenantContext;
    readonly eventId: string;
    readonly reason: string;
    readonly now: number;
  }): Result<OutboxEvent, OutboxAckRejection>;

  /** Read the current state of an event. Cross-tenant reads return null. */
  state(ctx: TenantContext, eventId: string): OutboxEventState | null;

  /** Read a single event by id (cross-tenant returns null). */
  findById(ctx: TenantContext, eventId: string): OutboxEvent | null;
}

// ---------------------------------------------------------------------------
// RetryPolicy — bounded backoff. The driver computes `nextAttemptAt` from
// the policy and the current attempt count; the policy is bounded so
// retry storms cannot exhaust the outbox.
// ---------------------------------------------------------------------------

export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly backoffFactor: number; // multiplier applied per attempt
  readonly jitterMs: number; // deterministic in-memory (zero for the reference)
}

/**
 * The default retry policy used by the in-memory reference. 5 attempts,
 * exponential backoff with base 100ms, factor 2, max 30s, no jitter.
 * Real drivers MAY use jitter; the in-memory reference is deterministic.
 */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 5,
  baseDelayMs: 100,
  maxDelayMs: 30_000,
  backoffFactor: 2,
  jitterMs: 0,
};

/**
 * Computes the next attempt time for a retry, given the policy and the
 * attempt count (1-indexed: the first failure schedules the second
 * attempt). Returns null if the policy is exhausted — the event must
 * move to DEAD_LETTER.
 */
export function nextAttemptAt(
  policy: RetryPolicy,
  attemptCount: number,
  now: number,
): number | null {
  if (attemptCount >= policy.maxAttempts) return null;
  // attempt N schedules attempt N+1 with backoff (N-1) — the first retry
  // has just the base delay (factor^0); subsequent retries multiply by
  // `backoffFactor`.
  const exponent = attemptCount - 1;
  const raw = policy.baseDelayMs * Math.pow(policy.backoffFactor, exponent);
  const bounded = Math.min(raw, policy.maxDelayMs);
  return now + bounded + policy.jitterMs;
}
