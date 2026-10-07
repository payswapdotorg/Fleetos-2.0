/**
 * @fleetos/experience-work-commerce — shared internal view plumbing.
 *
 * NOT exported from the package index — internal only. Pure deterministic
 * TypeScript: no wall clock, no randomness, no I/O (law A12); every view
 * digest is byte-identical for byte-identical inputs.
 *
 * Tenant law (A8): the experience plane sits ABOVE the domain kernel,
 * projected read-only. Every view assembly is TENANT FAIL-CLOSED — a
 * missing tenant scope refuses, and any domain record from another tenant
 * refuses the WHOLE view naming the offender (no partial boards, no
 * UI-only filtering).
 */

// ---------------------------------------------------------------------------
// Tenant scope (LOCAL structural shape, compatible with the lane's domains).
// ---------------------------------------------------------------------------

export interface TenantScopeLike {
  readonly tenantId: string;
}

export type TenantCheck =
  | { readonly ok: true; readonly tenantId: string }
  | { readonly ok: false; readonly reasonCode: TenantViewReasonCode };

export type TenantViewReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "TENANT_ID_EMPTY"
  | "TENANT_ID_TOO_LONG"
  | "TENANT_ID_INVALID_CHARS"
  | "TENANT_MISMATCH";

const TENANT_PATTERN = /^[A-Za-z0-9_-]+$/;

export function checkTenantScope(scope: unknown): TenantCheck {
  if (scope === null || typeof scope !== "object") {
    return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  }
  const tenantId = (scope as Record<string, unknown>)["tenantId"];
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    return { ok: false, reasonCode: "TENANT_ID_EMPTY" };
  }
  if (tenantId.length > 128) {
    return { ok: false, reasonCode: "TENANT_ID_TOO_LONG" };
  }
  if (!TENANT_PATTERN.test(tenantId)) {
    return { ok: false, reasonCode: "TENANT_ID_INVALID_CHARS" };
  }
  return { ok: true, tenantId };
}

/**
 * failClosedOnRecords — the shared tenant fail-closed fold. Any record
 * whose tenant is missing, invalid, or belongs to another tenant refuses
 * with TENANT_MISMATCH (or the tenant code) and the offender's id in the
 * detail. Records are never silently dropped (law A4).
 */
export function failClosedOnRecords(
  tenantId: string,
  records: readonly { readonly id: string; readonly tenant: { readonly tenantId: string } }[],
): { readonly ok: true } | { readonly ok: false; readonly reasonCode: TenantViewReasonCode; readonly detail: string } {
  for (const record of records) {
    const check = checkTenantScope(record.tenant);
    if (!check.ok) {
      return { ok: false, reasonCode: check.reasonCode, detail: record.id };
    }
    if (check.tenantId !== tenantId) {
      return { ok: false, reasonCode: "TENANT_MISMATCH", detail: record.id };
    }
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// FNV-1a digest (the lane's established private-digest convention).
// ---------------------------------------------------------------------------

type DigestPart = string | number | boolean | null | undefined | readonly DigestPart[];

export function fnv1a32(parts: readonly DigestPart[]): string {
  let hash = 0x811c9dc5;
  const joined = flatten(parts)
    .map((p) => (p === null || p === undefined ? "" : String(p)))
    .join("\u241f");
  for (let i = 0; i < joined.length; i++) {
    hash ^= joined.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function flatten(
  parts: readonly DigestPart[],
): (string | number | boolean | null | undefined)[] {
  const out: (string | number | boolean | null | undefined)[] = [];
  for (const p of parts) {
    if (isDigestPartArray(p)) out.push(...flatten(p));
    else out.push(p);
  }
  return out;
}

function isDigestPartArray(part: DigestPart): part is readonly DigestPart[] {
  return Array.isArray(part);
}

// ---------------------------------------------------------------------------
// Provenance — every view card carries refs back to its domain records.
// ---------------------------------------------------------------------------

export interface ProvenanceRef {
  readonly recordKind: string;
  readonly recordId: string;
}

export function provenance(recordKind: string, recordId: string): ProvenanceRef {
  return { recordKind, recordId };
}

// ---------------------------------------------------------------------------
// Integer basis-point arithmetic (floored division — no floats in outputs).
// ---------------------------------------------------------------------------

/** floor(numerator * 10000 / denominator); 0 when denominator is 0. */
export function bpsOf(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.floor((numerator * 10000) / denominator);
}

// ---------------------------------------------------------------------------
// The redaction sentinel (the world-context lane convention).
// ---------------------------------------------------------------------------

export const REDACTED_VALUE = "[REDACTED]" as const;
