/**
 * @fleetos/work — Tenant scope structural local type (cross-worker seam).
 *
 * Laws: A8 (tenant isolation, fail-closed), A20 (no cross-boundary imports).
 *
 * This is a LOCAL structural type. Sibling-lane concepts (worker A's
 * identity/tenancy packages) are referenced through this shape, never
 * imported at runtime. Structural-compatibility tests in tests/ prove the
 * shapes align without import-time coupling.
 */

export interface TenantScope {
  readonly tenantId: string;
}

/**
 * Sibling-lane compatibility shape (law A8). Used by structural-compatibility
 * tests only; never imported across package boundaries at runtime.
 */
export interface TenantScopeLike {
  readonly tenantId: string;
}

const TENANT_PATTERN = /^[A-Za-z0-9_-]+$/;

export type TenantValidation =
  | { ok: true; scope: TenantScope }
  | { ok: false; reasonCode: TenantReasonCode };

export type TenantReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "TENANT_ID_EMPTY"
  | "TENANT_ID_TOO_LONG"
  | "TENANT_ID_INVALID_CHARS";

/**
 * validateTenantScope — fail-closed tenant validation.
 *
 * Returns `ok` for a non-empty, syntactically valid tenant id; otherwise
 * returns a refusal with a machine-stable reason code. NEVER silently
 * coerces an invalid scope to a default tenant. Determinism: identical
 * inputs always produce identical outputs (no clock, no random, no I/O).
 */
export function validateTenantScope(scope: unknown): TenantValidation {
  if (scope === null || typeof scope !== "object") {
    return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  }
  const candidate = scope as Record<string, unknown>;
  const tenantId = candidate["tenantId"];
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    return { ok: false, reasonCode: "TENANT_ID_EMPTY" };
  }
  if (tenantId.length > 128) {
    return { ok: false, reasonCode: "TENANT_ID_TOO_LONG" };
  }
  if (!TENANT_PATTERN.test(tenantId)) {
    return { ok: false, reasonCode: "TENANT_ID_INVALID_CHARS" };
  }
  return { ok: true, scope: { tenantId } };
}
