/**
 * @fleetos/kernel — RepositoryPort binding contracts (law A1, A8).
 *
 * The typed base surfaces every domain RepositoryPort extends: entity
 * read/write by id, tenant-scoped query contracts, optimistic
 * concurrency via revision guards. A stale revision write is refused
 * with a machine-stable reason code.
 *
 * The existing worker RepositoryPorts (ActorRepositoryPort,
 * AssetRepositoryPort, …) are structural seams with their own shape —
 * the kernel's RepositoryPort is the BASE contract the composition
 * layer will bind to when wiring domain contexts to a driver. Domain
 * contexts consume the kernel's public entry only.
 *
 * Pure TypeScript port. The deterministic in-memory reference lives in
 * `./driver/in-memory-repository.ts`.
 */

import type { TenantContext, TenantId } from "./tenant.js";
import type { TransactionalSession } from "./session.js";
import type { Entity, OptimisticConcurrencyRefusal, RevisionGuard } from "./entity.js";
import type { Result } from "./result.js";

// ---------------------------------------------------------------------------
// Query contracts — the shape of tenant-scoped reads. The kernel defines
// the BASE query vocabulary; worker repositories extend with their own
// domain-specific predicates. Reads are tenant-scoped — cross-tenant
// reads return empty results (fail closed).
// ---------------------------------------------------------------------------

export interface QuerySpec<T extends Entity> {
  readonly filter?: (entity: T) => boolean;
  readonly limit?: number;
  readonly orderBy?: (
    a: T,
    b: T,
  ) => number;
}

export type RepositoryReadRejection = "tenant-mismatch" | "session-not-active";

export type RepositoryWriteRejection =
  | OptimisticConcurrencyRefusal
  | { readonly reason: "tenant-mismatch" }
  | { readonly reason: "session-not-active" };

// ---------------------------------------------------------------------------
// ReadableRepository — entity read-by-id + tenant-scoped list/query.
// ---------------------------------------------------------------------------

export interface ReadableRepository<T extends Entity> {
  findById(ctx: TenantContext, id: string): Result<T | null, RepositoryReadRejection>;
  listByTenant(ctx: TenantContext): ReadonlyArray<T>;
  query(ctx: TenantContext, spec: QuerySpec<T>): ReadonlyArray<T>;
}

// ---------------------------------------------------------------------------
// WritableRepository — entity write/remove with optimistic concurrency.
//
// `save` MUST be called within an active session — the write is staged
// in the session and only becomes durable on commit. The `expected`
// revision guard is compared to the recorded revision; a stale revision
// is refused with `STALE_REVISION` and the recorded revision is returned
// so the caller can re-read and retry.
// ---------------------------------------------------------------------------

export interface WritableRepository<T extends Entity> {
  save(input: {
    readonly ctx: TenantContext;
    readonly session: TransactionalSession;
    readonly entity: T;
    readonly expected: RevisionGuard;
  }): Result<T, RepositoryWriteRejection>;

  remove(input: {
    readonly ctx: TenantContext;
    readonly session: TransactionalSession;
    readonly id: string;
    readonly expected: RevisionGuard;
  }): Result<void, RepositoryWriteRejection>;
}

// ---------------------------------------------------------------------------
// RepositoryPort — the BASE contract. Domain-specific worker ports
// (ActorRepositoryPort, AssetRepositoryPort, …) extend this contract.
// The composition layer binds a worker RepositoryPort to a driver at
// runtime; the kernel is the structural authority.
// ---------------------------------------------------------------------------

export type RepositoryPort<T extends Entity> = ReadableRepository<T> &
  WritableRepository<T>;

// ---------------------------------------------------------------------------
// Tenant-scoped helpers. Pure predicates used by every driver's read/
// write paths.
// ---------------------------------------------------------------------------

export function assertTenant(
  ctx: TenantContext,
  record: { readonly tenantId: TenantId },
): boolean {
  return ctx.tenantId === record.tenantId;
}
