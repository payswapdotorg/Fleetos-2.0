/**
 * @fleetos/kernel — Entity base + Revision guard (law A1, A8).
 *
 * Pure TypeScript contracts that the worker RepositoryPorts (and the
 * kernel's own in-memory driver) implement. An Entity is a tenant-scoped
 * durable record with a monotonically increasing `revision` used for
 * optimistic concurrency. A stale-revision write is refused with a
 * machine-stable reason code.
 *
 * The kernel does NOT own the worker-specific entity shapes (Actor,
 * ManagedAsset, WorkItem, …); it owns the BASE shape every domain entity
 * must satisfy. Worker ports extend this base.
 */

import type { TenantId } from "./tenant.js";

// ---------------------------------------------------------------------------
// Entity — the base shape every durable domain record must satisfy.
//
// `id` is the per-collection stable identifier (the kernel keys on
// `${tenantId}:${collection}:${id}`). `revision` is monotonic per
// record; the kernel rejects a write whose `revision` is less than the
// recorded revision with `STALE_REVISION`. `recordedAt` is the kernel-
// managed commit timestamp.
// ---------------------------------------------------------------------------

export interface Entity {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly revision: number;
  readonly recordedAt: number;
}

// ---------------------------------------------------------------------------
// CollectionKey — the structural keyspace locator the in-memory driver
// uses. Worker repositories choose the collection name; the kernel
// namespaces by tenant. Cross-tenant access fails closed (A8).
// ---------------------------------------------------------------------------

export interface CollectionKey {
  readonly collection: string;
  readonly id: string;
}

// ---------------------------------------------------------------------------
// Revision guard — optimistic concurrency helper.
//
// `expectRevision` is the revision the caller observed before staging
// the write. The driver compares it to the recorded revision; a stale
// revision is refused with `STALE_REVISION` and the recorded revision
// is returned so the caller can re-read and retry.
// ---------------------------------------------------------------------------

export interface RevisionGuard {
  readonly id: string;
  readonly expectRevision: number;
}

export type OptimisticConcurrencyRefusalReason = "STALE_REVISION" | "UNKNOWN_RECORD";

export interface OptimisticConcurrencyRefusal {
  readonly reason: OptimisticConcurrencyRefusalReason;
  readonly id: string;
  readonly expectedRevision: number;
  readonly recordedRevision: number | null;
}

/**
 * Bumps the revision monotonically. Refuses to bump to a non-positive or
 * non-finite value. Returns the new revision or null if the input is
 * degenerate. The recorded revision is bumped from `recorded` to
 * `recorded + 1` on every successful write — the caller cannot choose
 * the next revision.
 */
export function nextRevision(recorded: number): number | null {
  if (!Number.isFinite(recorded) || recorded < 0) return null;
  if (recorded >= Number.MAX_SAFE_INTEGER) return null;
  return recorded + 1;
}

/**
 * Returns true iff the caller's expected revision matches the recorded
 * revision (or the record is being created for the first time and the
 * caller expects revision 0).
 */
export function revisionMatches(
  expected: number,
  recorded: number | null,
): boolean {
  if (recorded === null) return expected === 0;
  return expected === recorded;
}
