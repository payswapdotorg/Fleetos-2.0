/**
 * @fleetos/recovery — Wave 8 case-volume pagination laws (F280A).
 *
 * At fleet scale a tenant's recovery-case volume makes unbounded listing
 * unusable; this module pins the pagination LAWS as pure, deterministic
 * functions:
 *
 *   - **Deterministic ordering** — cases sort by `(openedAt DESC, id ASC)`.
 *     The tie-break makes the order TOTAL, so the same input array (in any
 *     permutation) yields byte-identical pages.
 *   - **Keyset pagination (stable pages under inserts between reads)** —
 *     the cursor is the last returned item's sort key, not an offset.
 *     Snapshot semantics (documented): `paginateRecoveryCases` paginates
 *     the array the CALLER passes; the caller controls whether that array
 *     is a stable snapshot or a fresh live read. With keyset cursors:
 *       (a) cases that existed at the first read are never SKIPPED and
 *           never DUPLICATED across pages, regardless of later inserts;
 *       (b) cases inserted with a sort key BEHIND the cursor (older, or
 *           same openedAt with a later id... i.e. sorting after the cursor
 *           boundary) MAY appear on later pages when the caller re-reads a
 *           live view — they were never seen before, so no invariant is
 *           broken;
 *       (c) cases inserted AHEAD of the cursor (newer) are NOT visible to
 *           the current walk — a new walk must be started to see them.
 *     All three laws are machine-tested.
 *   - **Fail-closed validation** — invalid limit (0 / negative / above the
 *     max) refuses `invalid-limit`; a malformed cursor refuses
 *     `invalid-cursor`; the tenant-scoped entry point additionally refuses
 *     a missing tenant (`missing-tenant-id`) and a cursor minted by
 *     ANOTHER tenant (`cursor-tenant-mismatch`) — cross-tenant cursors
 *     fail closed, they never silently walk a foreign tenant's cases.
 *
 * Pure deterministic TypeScript; no Date.now, no Math.random, no I/O.
 */

import { createHash } from "node:crypto";
import type { RecoveryCase, RecoveryCaseId, TenantIdLike } from "./recovery.js";

// ---------------------------------------------------------------------------
// Sort law + cursor encoding.
// ---------------------------------------------------------------------------

/** Max page size — the documented bound; larger limits fail closed. */
export const MAX_PAGE_LIMIT = 256;

/** Total deterministic order: newest first; ties broken by caseId ASC. */
export function compareRecoveryCases(a: RecoveryCase, b: RecoveryCase): number {
  if (a.openedAt !== b.openedAt) return b.openedAt - a.openedAt; // DESC
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; // ASC tie-break
}

export interface RecoveryCaseCursor {
  readonly tenantId: TenantIdLike;
  readonly openedAt: number;
  readonly caseId: string;
}

export function encodeRecoveryCaseCursor(cursor: RecoveryCaseCursor): string {
  // Canonical field order (tenantId, openedAt, caseId) — deterministic bytes.
  const json = `{"tenantId":${JSON.stringify(cursor.tenantId)},"openedAt":${cursor.openedAt},"caseId":${JSON.stringify(cursor.caseId)}}`;
  return Buffer.from(json, "utf8").toString("base64");
}

export function decodeRecoveryCaseCursor(encoded: string): RecoveryCaseCursor | null {
  try {
    const json = Buffer.from(encoded, "base64").toString("utf8");
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null) return null;
    const c = parsed as Record<string, unknown>;
    if (typeof c.tenantId !== "string") return null;
    if (!Number.isFinite(c.openedAt) || typeof c.openedAt !== "number") return null;
    if (typeof c.caseId !== "string") return null;
    return { tenantId: c.tenantId, openedAt: c.openedAt, caseId: c.caseId };
  } catch {
    return null; // malformed base64/JSON — fail closed
  }
}

// ---------------------------------------------------------------------------
// Pure pagination over a caller-supplied array (snapshot semantics).
// ---------------------------------------------------------------------------

export interface RecoveryCasePage {
  readonly items: ReadonlyArray<RecoveryCase>; // in deterministic order
  readonly nextCursor: string | null; // null on the last page
  readonly hasMore: boolean;
}

export type PaginationRejectionCode =
  | "invalid-limit"
  | "invalid-cursor";

export type PaginationResult =
  | { readonly ok: false; readonly reason: PaginationRejectionCode }
  | { readonly ok: true; readonly page: RecoveryCasePage };

export function paginateRecoveryCases(
  cases: ReadonlyArray<RecoveryCase>,
  input: { readonly limit: number; readonly cursor?: string },
): PaginationResult {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > MAX_PAGE_LIMIT) {
    return { ok: false, reason: "invalid-limit" };
  }
  let cursor: RecoveryCaseCursor | null = null;
  if (input.cursor !== undefined) {
    cursor = decodeRecoveryCaseCursor(input.cursor);
    if (cursor === null) return { ok: false, reason: "invalid-cursor" };
  }

  const sorted = [...cases].sort(compareRecoveryCases);
  // Keyset: strictly AFTER the cursor in the total order (a case equal to
  // the cursor key was already returned — never duplicated).
  const afterCursor = cursor
    ? sorted.filter(
        (c) =>
          c.openedAt < cursor!.openedAt ||
          (c.openedAt === cursor!.openedAt && c.id > cursor!.caseId),
      )
    : sorted;
  const items = afterCursor.slice(0, input.limit);
  const hasMore = afterCursor.length > input.limit;
  const last = items[items.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeRecoveryCaseCursor({ tenantId: last.tenantId, openedAt: last.openedAt, caseId: last.id })
      : null;
  return { ok: true, page: { items, nextCursor, hasMore } };
}

// ---------------------------------------------------------------------------
// Tenant-scoped paged listing — fail-closed cursor binding.
// ---------------------------------------------------------------------------

export type TenantPaginationRejectionCode =
  | PaginationRejectionCode
  | "missing-tenant-id"
  | "cursor-tenant-mismatch";

export type TenantPaginationResult =
  | { readonly ok: false; readonly reason: TenantPaginationRejectionCode }
  | { readonly ok: true; readonly page: RecoveryCasePage };

/**
 * Tenant-scoped pagination over a tenant's case list. The list itself is
 * caller-supplied (typically `RecoveryCaseDirectory.listByTenant`, which is
 * already fail-closed tenant-scoped); this entry point ADDITIONALLY binds
 * the cursor to the tenant — a cursor minted by another tenant refuses
 * `cursor-tenant-mismatch` instead of walking foreign data.
 */
export function paginateCasesForTenant(
  cases: ReadonlyArray<RecoveryCase>,
  tenantId: TenantIdLike,
  input: { readonly limit: number; readonly cursor?: string },
): TenantPaginationResult {
  if (tenantId === "") return { ok: false, reason: "missing-tenant-id" };
  if (input.cursor !== undefined) {
    const cursor = decodeRecoveryCaseCursor(input.cursor);
    if (cursor === null) return { ok: false, reason: "invalid-cursor" };
    if (cursor.tenantId !== tenantId) {
      // Fail-closed: a foreign tenant's cursor never walks this tenant's cases.
      return { ok: false, reason: "cursor-tenant-mismatch" };
    }
  }
  const tenantScoped = cases.filter((c) => c.tenantId === tenantId);
  const r = paginateRecoveryCases(tenantScoped, input);
  if (!r.ok) return r;
  return { ok: true, page: r.page };
}

/** Deterministic page digest — machine-checkable pagination identity. */
export function recoveryCasePageDigest(page: RecoveryCasePage): string {
  const text = page.items.map((c) => `${c.tenantId}|${c.id}|${c.openedAt}`).join("|");
  return createHash("sha256").update(`page|${text}|${page.hasMore}`).digest("hex");
}

export type { RecoveryCase, RecoveryCaseId, TenantIdLike };
