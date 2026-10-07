/**
 * @fleetos/external-vendors — External vendor/system adapter seam.
 *
 * Wave 1 lane C (F210C) kernel-grade.
 *
 * Laws:
 *   A1  — external systems NEVER own domain truth. This adapter is a
 *         projection/translation surface only.
 *   A7  — external SDKs stay behind the port.
 *   A8  — tenant isolation, fail-closed.
 *   A20 — no cross-boundary implementation imports.
 *
 * Wave 1 kernel-grade additions over Wave 0 (F200C):
 *   - retry/idempotency contracts at the seam;
 *   - honest degraded states (UNAVAILABLE vs REF_UNKNOWN);
 *   - idempotency-key-based deduplication;
 *   - boundary machine-tests (external systems never own domain truth).
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

// ---------------------------------------------------------------------------
// ExternalProjection — tagged kind "external-projection" to assert in
// types that this is NOT a domain authoritative record.
// ---------------------------------------------------------------------------

export interface ExternalProjection {
  readonly kind: "external-projection";
  readonly tenant: TenantScope;
  readonly sourceSystem: string;
  readonly externalRef: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly observedAt: string;
}

export interface ExternalQuery {
  readonly tenant: TenantScope;
  readonly sourceSystem: string;
  readonly externalRef: string;
  readonly idempotencyKey: string;
}

export type ExternalQueryResult =
  | { readonly ok: true; readonly projection: ExternalProjection; readonly fromCache: boolean }
  | { readonly ok: false; readonly reasonCode: ExternalReasonCode; readonly attempts: number };

export type ExternalReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "EXTERNAL_SYSTEM_UNAVAILABLE"
  | "EXTERNAL_REF_UNKNOWN"
  | "IDEMPOTENCY_KEY_EMPTY";

export interface ExternalVendorPort {
  fetchProjection(query: ExternalQuery): ExternalQueryResult;
}

// ---------------------------------------------------------------------------
// Retry policy contract.
// ---------------------------------------------------------------------------

export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly backoffMillis: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  backoffMillis: 100,
};

// ---------------------------------------------------------------------------
// Deterministic reference adapter — no network.
// ---------------------------------------------------------------------------

export interface DeterministicExternalVendorAdapterConfig {
  readonly simulateOutage: boolean;
  readonly projections: Readonly<
    Record<string, Readonly<Record<string, unknown>>>
  >;
  readonly retryPolicy?: RetryPolicy;
}

export function createDeterministicExternalVendorAdapter(
  config: DeterministicExternalVendorAdapterConfig,
): ExternalVendorPort {
  const cache = new Map<string, ExternalProjection>();
  const policy = config.retryPolicy ?? DEFAULT_RETRY_POLICY;
  return {
    fetchProjection(query: ExternalQuery): ExternalQueryResult {
      const tenant = validateTenantScope(query.tenant);
      if (!tenant.ok) {
        return { ok: false, reasonCode: "TENANT_SCOPE_MISSING", attempts: 0 };
      }
      if (!query.idempotencyKey || query.idempotencyKey.trim().length === 0) {
        return { ok: false, reasonCode: "IDEMPOTENCY_KEY_EMPTY", attempts: 0 };
      }
      const cacheKey = `${tenant.scope.tenantId}::${query.idempotencyKey}`;
      const cached = cache.get(cacheKey);
      if (cached !== undefined) {
        return { ok: true, projection: cached, fromCache: true };
      }
      let attempts = 0;
      let lastReason: ExternalReasonCode = "EXTERNAL_SYSTEM_UNAVAILABLE";
      while (attempts < policy.maxAttempts) {
        attempts++;
        if (config.simulateOutage) {
          lastReason = "EXTERNAL_SYSTEM_UNAVAILABLE";
          continue;
        }
        const payload = config.projections[query.externalRef];
        if (!payload) {
          lastReason = "EXTERNAL_REF_UNKNOWN";
          continue;
        }
        const projection: ExternalProjection = {
          kind: "external-projection",
          tenant: tenant.scope,
          sourceSystem: query.sourceSystem,
          externalRef: query.externalRef,
          payload,
          observedAt: "1970-01-01T00:00:00Z",
        };
        cache.set(cacheKey, projection);
        return { ok: true, projection, fromCache: false };
      }
      return { ok: false, reasonCode: lastReason, attempts };
    },
  };
}

// ---------------------------------------------------------------------------
// Boundary assertions — external systems never own domain truth.
// ---------------------------------------------------------------------------

const DOMAIN_ID_KINDS = new Set([
  "need",
  "procurement-demand",
  "quote",
  "order",
  "fulfillment",
  "vendor",
  "subscription",
  "entitlement",
  "organization",
]);

export function isExternalProjection(p: { readonly kind: string }): boolean {
  return p.kind === "external-projection";
}

export function projectionDoesNotOwnDomainTruth(
  p: { readonly kind: string },
): boolean {
  return !DOMAIN_ID_KINDS.has(p.kind);
}
