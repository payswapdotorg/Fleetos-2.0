/**
 * infrastructure/fleetos-marketplace/schema.ts — the PostgreSQL schema DDL
 * (F370C, Wave 18 lane C).
 *
 * Tenant-scoped tables (law A8: every business table carries tenant_id as
 * a leading key — cross-tenant queries find nothing through the scoped
 * port). Natural keys + idempotency EXACTLY as the in-process contracts:
 *   - requests: PK (tenant_id, request_id) + UNIQUE (tenant_id,
 *     natural_key) — the F361C idempotent create/submit law made
 *     structural (a tenant's natural key never creates twice);
 *   - evidence: PK (tenant_id, evidence_id) + UNIQUE (tenant_id,
 *     provider_event_id) — the F361B duplicate-provider-event law (the
 *     first write wins, never a second conclusion);
 *   - enrollments: PK (tenant_id, serial) — the REAL F361A registry
 *     port's key;
 *   - orders/requests/receipts: upsert the latest kernel record verbatim
 *     (the kernel state machine's current state IS the record);
 *   - approvals: keyed by the approval request id (the kernel's own
 *     approvalId is a digest-input prefix — stable, never unique; the
 *     kernel record rides verbatim inside, never re-shaped);
 *   - journals (provider_acks, audit, revocations, backups): append-only
 *     with a monotonic seq (law A19); digests are defined over seq order.
 *
 * The kernel records live in a `record JSONB` column — the EXACT kernel
 * shapes serialized canonically, never re-shaped (the packet's law).
 */

export const MARKETPLACE_SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS requests (
  tenant_id   TEXT NOT NULL,
  request_id  TEXT NOT NULL,
  natural_key TEXT NOT NULL,
  record      JSONB NOT NULL,
  PRIMARY KEY (tenant_id, request_id),
  UNIQUE (tenant_id, natural_key)
);
CREATE INDEX IF NOT EXISTS requests_tenant_idx ON requests (tenant_id);

CREATE TABLE IF NOT EXISTS offers (
  tenant_id TEXT NOT NULL,
  offer_id  TEXT NOT NULL,
  record    JSONB NOT NULL,
  PRIMARY KEY (tenant_id, offer_id)
);

CREATE TABLE IF NOT EXISTS comparison_sheets (
  tenant_id TEXT NOT NULL,
  sheet_id  TEXT NOT NULL,
  record    JSONB NOT NULL,
  PRIMARY KEY (tenant_id, sheet_id)
);

CREATE TABLE IF NOT EXISTS orders (
  tenant_id TEXT NOT NULL,
  order_id  TEXT NOT NULL,
  record    JSONB NOT NULL,
  PRIMARY KEY (tenant_id, order_id)
);

CREATE TABLE IF NOT EXISTS provider_acks (
  seq       BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  record    JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS receipts (
  tenant_id    TEXT NOT NULL,
  evidence_ref TEXT NOT NULL,
  record       JSONB NOT NULL,
  PRIMARY KEY (tenant_id, evidence_ref)
);

CREATE TABLE IF NOT EXISTS enrollments (
  tenant_id TEXT NOT NULL,
  serial    TEXT NOT NULL,
  record    JSONB NOT NULL,
  PRIMARY KEY (tenant_id, serial)
);

CREATE TABLE IF NOT EXISTS approvals (
  tenant_id  TEXT NOT NULL,
  request_id TEXT NOT NULL,
  record     JSONB NOT NULL,
  PRIMARY KEY (tenant_id, request_id)
);

CREATE TABLE IF NOT EXISTS evidence (
  tenant_id         TEXT NOT NULL,
  evidence_id       TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  record            JSONB NOT NULL,
  PRIMARY KEY (tenant_id, evidence_id),
  UNIQUE (tenant_id, provider_event_id)
);

CREATE TABLE IF NOT EXISTS assets (
  tenant_id TEXT NOT NULL,
  asset_id  TEXT NOT NULL,
  record    JSONB NOT NULL,
  PRIMARY KEY (tenant_id, asset_id)
);

CREATE TABLE IF NOT EXISTS twins (
  tenant_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  record    JSONB NOT NULL,
  PRIMARY KEY (tenant_id, device_id)
);

CREATE TABLE IF NOT EXISTS credentials (
  credential_id TEXT NOT NULL PRIMARY KEY,
  record        JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS audit (
  seq       BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  record    JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS revocations (
  seq    BIGSERIAL PRIMARY KEY,
  record JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS backups (
  seq    BIGSERIAL PRIMARY KEY,
  record JSONB NOT NULL
);
`;
