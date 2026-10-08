/**
 * @fleetos/apify — shared local structural seams (Wave 5).
 *
 * Tenant validation (fail-closed, law A8) and the Guardian decision
 * reference seam, extracted verbatim from the Wave 1 index so the Wave 5
 * modules share ONE definition without an index re-export cycle. The
 * public surface is unchanged — `src/index.ts` re-exports this module.
 */

export interface TenantScope {
  readonly tenantId: string;
}

export type TenantValidation =
  | { ok: true; scope: TenantScope }
  | { ok: false; reasonCode: TenantReasonCode };

export type TenantReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "TENANT_ID_EMPTY"
  | "TENANT_ID_TOO_LONG"
  | "TENANT_ID_INVALID_CHARS";

const TENANT_PATTERN = /^[A-Za-z0-9_-]+$/;

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

/**
 * GuardianDecisionRefLike — LOCAL structural seam (law A4/A20).
 *
 * A Guardian decision is an INPUT from the worker-B Guardian context and is
 * NEVER minted here. No function in this package constructs one; the only
 * way a decision enters the job lifecycle is as a caller-supplied argument
 * (machine-tested).
 */
export interface GuardianDecisionRefLike {
  readonly decisionId: string;
  readonly authorized: boolean;
  readonly reasonCode: string;
}
