/**
 * @fleetos/kernel — public entry.
 *
 * The transactional kernel for FleetOS 2.0. Sits BELOW every domain
 * context. Pure TypeScript: types + ports + deterministic in-memory
 * reference implementations. Imports nothing from any @fleetos/* or
 * @zcode/* package.
 *
 * Public surface inventory:
 *   - TenantContext (law A8)
 *   - AuditEventRef + digestOf (law A19)
 *   - Result<T,E> + ok/fail/unwrap helpers
 *   - Entity + RevisionGuard + nextRevision/revisionMatches (A1)
 *   - TransactionalSession port + SessionStage + Savepoint + states
 *   - Outbox port + OutboxEvent + RetryPolicy + nextAttemptAt (A14)
 *   - RepositoryPort base + ReadableRepository + WritableRepository + QuerySpec
 *   - UnitOfWork + UnitOfWorkFactory + unitOfWorkFactory (A1, A14)
 *   - InMemoryKernelDriver — deterministic per-tenant transactional driver
 *   - InMemoryTransactionalSession — REAL rollback + savepoints + per-tenant
 *   - InMemoryOutbox — dual-write-gap killer + idempotent drain
 *   - InMemoryRepository — RepositoryPort base reference
 */

// ---- contracts ----
export * from "./tenant.js";
export * from "./audit.js";
export * from "./result.js";
export * from "./entity.js";
export * from "./session.js";
export * from "./outbox.js";
export * from "./repository-port.js";
export * from "./unit-of-work.js";

// ---- in-memory reference driver ----
export * from "./driver/in-memory-session.js";
export * from "./driver/in-memory-outbox.js";
export * from "./driver/in-memory-repository.js";
