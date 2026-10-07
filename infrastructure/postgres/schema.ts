/**
 * FleetOS 2.0 — Postgres schema contract.
 *
 * DDL shapes for the outbox table + optimistic-concurrency columns,
 * as TypeScript string constants + a migration contract type. These
 * are NOT executed by this skeleton — they document the contract the
 * live Postgres binding will adopt when it lands. The in-memory driver
 * in `@fleetos/kernel` is the deterministic reference for tests.
 *
 * Laws enforced structurally:
 *   A1  — Postgres is authoritative business truth
 *   A8  — tenant_id is a partition key on every table; cross-tenant
 *         queries are scoped at the connection level
 *   A14 — the outbox table is in the SAME transaction as the state
 *         change (no separate event-publish step); the drain contract
 *         is at-least-once with idempotency_key dedup
 *   A19 — audit rows are append-only, tenant-scoped, hash-verifiable
 */

// ---------------------------------------------------------------------------
// Outbox table — the A14 dual-write-gap killer.
//
// The state-change write and the outbox-event write happen in the SAME
// transaction. On commit, both are durable atomically. On rollback,
// neither is. The drain contract reads PENDING events for a tenant,
// applies the side-effect at the reader, and acks the event with the
// idempotency_key — a redelivered event acks identically, never
// re-applies the side-effect at the reader seam.
// ---------------------------------------------------------------------------

export const OUTBOX_DDL = `
CREATE TABLE IF NOT EXISTS fleetos_outbox (
  id              TEXT        PRIMARY KEY,
  tenant_id       TEXT        NOT NULL,
  type            TEXT        NOT NULL,
  payload         JSONB      NOT NULL,
  idempotency_key TEXT        NOT NULL,
  occurred_at     BIGINT      NOT NULL,
  recorded_at     BIGINT      NOT NULL,
  revision        BIGINT      NOT NULL,
  causation_id    TEXT,
  correlation_id  TEXT,
  state           TEXT        NOT NULL DEFAULT 'PENDING'
                  CHECK (state IN ('PENDING', 'DELIVERED', 'FAILED', 'DEAD_LETTER')),
  delivery_attempts   INT     NOT NULL DEFAULT 0,
  last_attempted_at   BIGINT,
  last_failure_reason TEXT,
  next_attempt_at     BIGINT
);
CREATE INDEX IF NOT EXISTS fleetos_outbox_tenant_state_revision_idx
  ON fleetos_outbox (tenant_id, state, revision)
  WHERE state IN ('PENDING', 'FAILED');
CREATE INDEX IF NOT EXISTS fleetos_outbox_tenant_idempotency_idx
  ON fleetos_outbox (tenant_id, idempotency_key)
  WHERE state = 'DELIVERED';
CREATE UNIQUE INDEX IF NOT EXISTS fleetos_outbox_tenant_revision_uniq
  ON fleetos_outbox (tenant_id, revision);
`;

// ---------------------------------------------------------------------------
// Audit table — A19. Append-only, tenant-scoped, hash-verifiable.
// ---------------------------------------------------------------------------

export const AUDIT_DDL = `
CREATE TABLE IF NOT EXISTS fleetos_audit (
  id           BIGSERIAL PRIMARY KEY,
  actor        TEXT     NOT NULL,
  intent       TEXT     NOT NULL,
  tenant_id    TEXT     NOT NULL,
  session_id   TEXT     NOT NULL,
  ts           BIGINT   NOT NULL,
  digest       TEXT     NOT NULL,
  -- Append-only: no UPDATE, no DELETE (enforced by GRANT).
  -- Tenant-scoped: queries filter by tenant_id at the connection level.
  -- Hash-verifiable: digest = sha256(actor|intent|tenant|session|ts|...).
  CHECK (length(digest) = 64)
);
CREATE INDEX IF NOT EXISTS fleetos_audit_tenant_ts_idx
  ON fleetos_audit (tenant_id, ts);
`;

// ---------------------------------------------------------------------------
// Optimistic-concurrency columns — every domain table adopts these via
// the migration contract below. The kernel's RepositoryPort checks the
// recorded `revision` against the caller's expected `revision`; a stale
// revision is refused with `STALE_REVISION` and the recorded revision
// is returned.
// ---------------------------------------------------------------------------

export const OPTIMISTIC_CONCURRENCY_COLUMNS = `
  revision   BIGINT NOT NULL DEFAULT 1,
  recorded_at BIGINT NOT NULL,
  CHECK (revision > 0)
`;

// ---------------------------------------------------------------------------
// Migration contract — every domain table that extends the kernel's
// RepositoryPort base must carry the tenant_id partition key + the
// optimistic-concurrency columns. The migration contract documents the
// shape; the live binding will enforce it at migration time.
// ---------------------------------------------------------------------------

export interface MigrationContract {
  readonly tableName: string;
  readonly tenantIdColumn: "tenant_id";
  readonly entityIdColumn: "id";
  readonly optimisticConcurrencyColumns: {
    readonly revision: "revision";
    readonly recordedAt: "recorded_at";
  };
  readonly ddl: string;
}

// ---------------------------------------------------------------------------
// Helper — builds a migration contract for a domain table. Pure, no I/O.
// ---------------------------------------------------------------------------

export function migrationFor(input: {
  readonly tableName: string;
  readonly columns?: string;
}): MigrationContract {
  const columns = input.columns ?? "";
  const ddl = `
CREATE TABLE IF NOT EXISTS ${input.tableName} (
  id          TEXT    NOT NULL,
  tenant_id   TEXT    NOT NULL,
  ${columns ? columns + ",\n  " : ""}${OPTIMISTIC_CONCURRENCY_COLUMNS.trim().replace(/^  /, "")}
);
CREATE UNIQUE INDEX IF NOT EXISTS ${input.tableName}_tenant_id_uniq
  ON ${input.tableName} (tenant_id, id);
CREATE INDEX IF NOT EXISTS ${input.tableName}_tenant_idx
  ON ${input.tableName} (tenant_id);
`;
  return {
    tableName: input.tableName,
    tenantIdColumn: "tenant_id",
    entityIdColumn: "id",
    optimisticConcurrencyColumns: {
      revision: "revision",
      recordedAt: "recorded_at",
    },
    ddl,
  };
}
