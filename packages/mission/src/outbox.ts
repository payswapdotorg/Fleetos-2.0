/**
 * @fleetos/mission — the outbox seam (law A14 — transactional event
 * publication).
 *
 * Mission state changes emit outbox events through the kernel's
 * `OutboxPort` TYPE with an in-memory reference adapter implemented in
 * THIS package — the mission package's own deterministic driver. The
 * adapter and the accompanying `MissionTransactionSession` (which
 * implements the kernel's `TransactionalSession` TYPE) are structurally
 * pinned to the kernel contracts via `implements`, so the TL can swap
 * in the real kernel driver at composition time without touching
 * mission code.
 *
 * Dual-write consistency: `publish()` MUST be called within an active
 * session — the event is staged with the state writes and becomes
 * durable ONLY at commit. A rolled-back transaction leaves NO event
 * residue. Drain is at-least-once with idempotency keys; retries follow
 * the deterministic basis-point backoff; exhaustion dead-letters.
 *
 * Module map (split under the max-lines lint budget; public surface
 * unchanged):
 * - `outbox-contracts.ts` — the retry policy + the committed-state
 *   shapes (`OutboxRetryPolicy`, `MutableOutboxEvent`,
 *   `MissionTenantStore`).
 * - `outbox-store.ts` — the staging/commit logic: `MissionStore` and
 *   `MissionTransactionSession`.
 * - `outbox-driver.ts` — `InMemoryMissionOutbox`, the kernel
 *   `OutboxPort` in-memory reference adapter.
 *
 * This file remains the `./outbox` subpath entry: it re-exports exactly
 * the symbols the seam has always published — nothing more, nothing
 * less.
 *
 * TYPE imports only from `@fleetos/kernel`. No runtime imports from any
 * @fleetos/* package.
 */

export {
  DEFAULT_OUTBOX_RETRY_POLICY,
  outboxRetryDelayMs,
  type MissionTenantStore,
  type MutableOutboxEvent,
  type OutboxRetryPolicy,
} from "./outbox-contracts.js";
export { MissionStore, MissionTransactionSession } from "./outbox-store.js";
export { InMemoryMissionOutbox } from "./outbox-driver.js";
