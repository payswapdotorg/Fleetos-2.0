/**
 * infrastructure/fleetos-marketplace/pglite-tables.ts — the table specs +
 * the record-parse helpers shared by the pglite adapter (F370C, Wave 18
 * lane C). One TableSpec per record set: the natural-key column + the
 * extractors mapping the kernel record to (tenant, natural key) — the
 * digest order (natural-key order) and the upsert conflict target.
 */

export interface PgExecutor {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

// The natural-key column + extractor per record set (digest order = the
// natural-key order; the JSONB record is the kernel shape verbatim).
export interface TableSpec {
  readonly table: string;
  readonly nkColumn: string;
  /** Extract the natural key from the parsed record (undefined for seq journals). */
  readonly nkOf: (record: Record<string, unknown>) => string;
  /** Extract the tenant id from the parsed record. */
  readonly tenantOf: (record: Record<string, unknown>) => string;
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("stored record is not an object — fail-closed");
  }
  return value as Record<string, unknown>;
}


/** Parse a stored JSONB record (PGlite returns jsonb columns as parsed
 *  objects; plain-text casts arrive as strings — handle both). */
export function parseRecord<T>(value: unknown): T {
  if (typeof value === "string") return JSON.parse(value) as T;
  if (value === null || typeof value !== "object") throw new Error("stored record is not an object — fail-closed");
  return value as T;
}

export function tenantOfString(record: Record<string, unknown>): string {
  return String(asRecord(record["tenant"])["tenantId"]);
}

/** The tenant of a record under its spec (the A8 write check). */
export function specTenant(spec: TableSpec, record: Record<string, unknown>): string {
  return spec.tenantOf(record);
}

export const REQUESTS: TableSpec = {
  table: "requests", nkColumn: "request_id",
  nkOf: (r) => String(r["requestId"]), tenantOf: tenantOfString,
};
export const OFFERS: TableSpec = {
  table: "offers", nkColumn: "offer_id",
  nkOf: (r) => String(r["offerId"]), tenantOf: tenantOfString,
};
export const SHEETS: TableSpec = {
  table: "comparison_sheets", nkColumn: "sheet_id",
  nkOf: (r) => String(r["sheetId"]), tenantOf: (r) => String(r["tenantId"]),
};
export const ORDERS: TableSpec = {
  table: "orders", nkColumn: "order_id",
  nkOf: (r) => String(r["orderId"]), tenantOf: tenantOfString,
};
export const RECEIPTS: TableSpec = {
  table: "receipts", nkColumn: "evidence_ref",
  nkOf: (r) => String(asRecord(r["evidence"])["evidenceRef"]), tenantOf: (r) => String(asRecord(r["evidence"])["tenantId"]),
};
export const ENROLLMENTS: TableSpec = {
  table: "enrollments", nkColumn: "serial",
  nkOf: (r) => String(r["serial"]), tenantOf: (r) => String(r["tenantId"]),
};
export const APPROVALS: TableSpec = {
  // Keyed by the approval REQUEST id (the semantic identity of one
  // evaluation): the kernel's own `approvalId` is a 12-char prefix of the
  // pipe-joined digest inputs (deterministic stability, NOT uniqueness —
  // two different requests share the `mpa-request=…` prefix), so it can
  // never be the record set's natural key. The kernel record itself rides
  // verbatim inside (never re-shaped).
  table: "approvals", nkColumn: "request_id",
  nkOf: (r) => String(r["requestId"]), tenantOf: (r) => String(r["tenantId"]),
};
export const EVIDENCE: TableSpec = {
  table: "evidence", nkColumn: "evidence_id",
  nkOf: (r) => String(r["evidenceId"]), tenantOf: (r) => String(r["tenantId"]),
};
export const ASSETS: TableSpec = {
  table: "assets", nkColumn: "asset_id",
  nkOf: (r) => String(r["id"]), tenantOf: (r) => String(r["tenantId"]),
};
export const TWINS: TableSpec = {
  table: "twins", nkColumn: "device_id",
  nkOf: (r) => String(r["deviceId"]), tenantOf: (r) => String(r["tenantId"]),
};

