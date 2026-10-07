/**
 * @fleetos/kernel — InMemoryRepository (the deterministic reference for
 * the RepositoryPort base contract).
 *
 * Implements the kernel's RepositoryPort<T> base surface over an
 * InMemoryKernelDriver. Reads return committed state from the driver's
 * per-tenant keyspace; writes are staged in the session the caller
 * provides, and the revision guard reads staged-or-committed so a
 * within-session re-save sees the prior staged value. On commit, the
 * staged write becomes durable.
 *
 * Per-tenant isolation is enforced by the keyspace boundary — the
 * session is bound to one tenant. Cross-tenant reads return null (fail
 * closed).
 *
 * Pure TypeScript, no I/O, no fs, no network, no global state.
 */

import type { TenantContext } from "../tenant.js";
import type { Entity, RevisionGuard } from "../entity.js";
import { nextRevision, revisionMatches } from "../entity.js";
import { fail, ok, unwrap, type Result } from "../result.js";
import type {
  QuerySpec,
  RepositoryPort,
  RepositoryReadRejection,
  RepositoryWriteRejection,
} from "../repository-port.js";
import type { SessionStage, TransactionalSession } from "../session.js";
import type { InMemoryKernelDriver, InMemoryTransactionalSession } from "./in-memory-session.js";

// ---------------------------------------------------------------------------
// InMemoryRepository — the reference implementation. The collection name
// is provided at construction time; multiple repositories share a single
// driver (and thus a single transactional boundary per session).
// ---------------------------------------------------------------------------

export class InMemoryRepository<T extends Entity>
  implements RepositoryPort<T>
{
  constructor(
    private readonly collection: string,
    private readonly driver: InMemoryKernelDriver,
    private readonly now: () => number,
  ) {}

  // -- ReadableRepository (reads from committed state) --

  findById(ctx: TenantContext, id: string): Result<T | null, RepositoryReadRejection> {
    const ks = this.driver.keyspaceFor(ctx.tenantId);
    const coll = ks.collections.get(this.collection);
    if (!coll) return ok(null);
    const raw = coll.get(id);
    if (raw === undefined) return ok(null);
    const entity = raw as T;
    // Tenant isolation: cross-tenant reads return null.
    if (entity.tenantId !== ctx.tenantId) return ok(null);
    return ok(entity);
  }

  listByTenant(ctx: TenantContext): ReadonlyArray<T> {
    const ks = this.driver.keyspaceFor(ctx.tenantId);
    const coll = ks.collections.get(this.collection);
    if (!coll) return [];
    const out: T[] = [];
    for (const v of coll.values()) {
      const e = v as T;
      if (e.tenantId === ctx.tenantId) out.push(e);
    }
    return out;
  }

  query(ctx: TenantContext, spec: QuerySpec<T>): ReadonlyArray<T> {
    const all = this.listByTenant(ctx);
    let filtered = spec.filter ? all.filter(spec.filter) : all;
    if (spec.orderBy) filtered = [...filtered].sort(spec.orderBy);
    if (spec.limit !== undefined && spec.limit >= 0) {
      filtered = filtered.slice(0, spec.limit);
    }
    return filtered;
  }

  // -- WritableRepository (writes stage in a session) --

  save(input: {
    readonly ctx: TenantContext;
    readonly session: TransactionalSession;
    readonly entity: T;
    readonly expected: RevisionGuard;
  }): Result<T, RepositoryWriteRejection> {
    const inMemorySession = this.activeSession(input.session, input.ctx);
    if (!inMemorySession) {
      return fail({ reason: "session-not-active" });
    }
    // Read staged-or-committed current value via the session's stage so
    // a within-session re-save sees the prior staged value.
    const stage = this.stageOf(inMemorySession);
    const raw = stage.get(this.collection, input.entity.id);
    let currentRevision: number | null = null;
    if (raw !== null) {
      const existing = raw as T;
      if (existing.tenantId !== input.ctx.tenantId) {
        return fail({ reason: "tenant-mismatch" });
      }
      currentRevision = existing.revision;
    }
    // Tenant-mismatch: the entity being written belongs to a different tenant.
    if (input.entity.tenantId !== input.ctx.tenantId) {
      return fail({ reason: "tenant-mismatch" });
    }
    // Optimistic concurrency: the expected revision must match the recorded.
    if (!revisionMatches(input.expected.expectRevision, currentRevision)) {
      return fail({
        reason: "STALE_REVISION",
        id: input.entity.id,
        expectedRevision: input.expected.expectRevision,
        recordedRevision: currentRevision,
      });
    }
    const next = nextRevision(currentRevision ?? 0);
    if (next === null) {
      // Degenerate — the recorded revision exhausted Number.MAX_SAFE_INTEGER.
      return fail({
        reason: "STALE_REVISION",
        id: input.entity.id,
        expectedRevision: input.expected.expectRevision,
        recordedRevision: currentRevision,
      });
    }
    const toWrite: T = {
      ...input.entity,
      revision: next,
      recordedAt: this.now(),
    };
    inMemorySession.stage((s) => {
      s.put(this.collection, toWrite.id, toWrite);
    });
    return ok(toWrite);
  }

  remove(input: {
    readonly ctx: TenantContext;
    readonly session: TransactionalSession;
    readonly id: string;
    readonly expected: RevisionGuard;
  }): Result<void, RepositoryWriteRejection> {
    const inMemorySession = this.activeSession(input.session, input.ctx);
    if (!inMemorySession) {
      return fail({ reason: "session-not-active" });
    }
    const stage = this.stageOf(inMemorySession);
    const raw = stage.get(this.collection, input.id);
    if (raw === null) {
      // Removing a non-existent record: if caller expected revision 0, ok
      // (idempotent remove); otherwise refuse with UNKNOWN_RECORD.
      if (input.expected.expectRevision === 0) {
        inMemorySession.stage((s) => s.remove(this.collection, input.id));
        return ok(undefined);
      }
      return fail({
        reason: "UNKNOWN_RECORD",
        id: input.id,
        expectedRevision: input.expected.expectRevision,
        recordedRevision: null,
      });
    }
    const existing = raw as T;
    if (existing.tenantId !== input.ctx.tenantId) {
      return fail({ reason: "tenant-mismatch" });
    }
    if (!revisionMatches(input.expected.expectRevision, existing.revision)) {
      return fail({
        reason: "STALE_REVISION",
        id: input.id,
        expectedRevision: input.expected.expectRevision,
        recordedRevision: existing.revision,
      });
    }
    inMemorySession.stage((s) => s.remove(this.collection, input.id));
    return ok(undefined);
  }

  // -- helpers --

  private activeSession(
    session: TransactionalSession,
    ctx: TenantContext,
  ): InMemoryTransactionalSession | null {
    if (session.state !== "active") return null;
    if (session.tenant.tenantId !== ctx.tenantId) return null;
    return session as unknown as InMemoryTransactionalSession;
  }

  private stageOf(session: InMemoryTransactionalSession): SessionStage {
    return unwrap(session.stage((s) => s));
  }
}

// ---------------------------------------------------------------------------
// Convenience: factory for an InMemoryRepository bound to a collection +
// driver.
// ---------------------------------------------------------------------------

export function inMemoryRepository<T extends Entity>(
  collection: string,
  driver: InMemoryKernelDriver,
  now: () => number,
): InMemoryRepository<T> {
  return new InMemoryRepository<T>(collection, driver, now);
}
