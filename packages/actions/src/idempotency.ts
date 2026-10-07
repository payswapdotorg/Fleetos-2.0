/**
 * @fleetos/actions — Idempotency ledger for the action protocol.
 *
 * Law A4: every consequential action follows
 *   propose -> authorize -> confirm -> dispatch -> execute -> verify -> record -> learn
 *
 * Idempotency (law A4 + A14): duplicate dispatch = identical ack, NEVER
 * double execution. The idempotency ledger tracks dispatched idempotency keys
 * and their ack results. A second dispatch with the same key returns the same
 * ack without re-executing.
 *
 * Pure types + a deterministic in-memory reference. Production uses a
 * PostgreSQL-backed ledger (injected via the port).
 */

/** The ack returned for a dispatch — cached for duplicate detection. */
export interface DispatchAck {
  readonly idempotencyKey: string;
  readonly dispatchReceipt: string;
  readonly dispatchedAt: string;
  readonly duplicate: boolean;
}

/**
 * Idempotency ledger port — production injects a durable store.
 *
 * The ledger MUST be durable across process restarts (law A14). The in-memory
 * reference is for tests and deterministic reference paths only.
 */
export interface IdempotencyLedgerPort {
  readonly check: (key: string) => Promise<DispatchAck | null>;
  readonly record: (ack: DispatchAck) => Promise<void>;
}

/**
 * Deterministic in-memory idempotency ledger.
 *
 * `check` returns the cached ack if the key was already dispatched.
 * `record` stores the ack. Duplicate recording is a no-op (idempotent).
 */
export class InMemoryIdempotencyLedger implements IdempotencyLedgerPort {
  private readonly store = new Map<string, DispatchAck>();

  async check(key: string): Promise<DispatchAck | null> {
    return this.store.get(key) ?? null;
  }

  async record(ack: DispatchAck): Promise<void> {
    if (!this.store.has(ack.idempotencyKey)) {
      this.store.set(ack.idempotencyKey, ack);
    }
  }

  /** Test-only — returns the number of unique keys recorded. */
  size(): number {
    return this.store.size;
  }

  /** Test-only — returns a sorted snapshot of keys. */
  keys(): readonly string[] {
    return [...this.store.keys()].sort();
  }
}

/**
 * Dispatch with idempotency — if the key was already dispatched, return the
 * cached ack (duplicate=true); otherwise execute the dispatch function, record
 * the ack, and return it (duplicate=false).
 *
 * Law A4: duplicate dispatch = identical ack, never double execution.
 *
 * Deterministic: the dispatch function receives the same inputs both times,
 * but is only CALLED ONCE. The second call returns the cached ack.
 */
export async function dispatchWithIdempotency(
  ledger: IdempotencyLedgerPort,
  key: string,
  dispatch: () => Promise<{ readonly receipt: string; readonly at: string }>,
): Promise<DispatchAck> {
  const existing = await ledger.check(key);
  if (existing !== null) {
    return { ...existing, duplicate: true };
  }
  const result = await dispatch();
  const ack: DispatchAck = {
    idempotencyKey: key,
    dispatchReceipt: result.receipt,
    dispatchedAt: result.at,
    duplicate: false,
  };
  await ledger.record(ack);
  return ack;
}

/**
 * Build a stable idempotency key from an IdempotencyKey.
 *
 * The key is `${tenantId}|${capabilityId}|${nonce}` — stable across calls
 * with the same inputs. The nonce is caller-provided (typically a hash of
 * the action inputs).
 */
export function buildIdempotencyKey(input: {
  readonly tenantId: string;
  readonly capabilityId: string;
  readonly nonce: string;
}): string {
  return `${input.tenantId}|${input.capabilityId}|${input.nonce}`;
}
