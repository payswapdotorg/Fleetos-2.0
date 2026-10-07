/**
 * @fleetos/mission — outbox contracts (law A14 — transactional event
 * publication).
 *
 * The shapes shared across the outbox seam: the deterministic retry
 * policy (basis-point backoff in integer math), the committed event
 * record as stored per tenant, and the per-tenant committed store shape
 * that the store, the transactional sessions and the reference adapter
 * all operate on.
 *
 * TYPE imports only from `@fleetos/kernel`. No runtime imports from any
 * @fleetos/* package.
 */

import type { OutboxEventState, TenantId } from "@fleetos/kernel";

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
