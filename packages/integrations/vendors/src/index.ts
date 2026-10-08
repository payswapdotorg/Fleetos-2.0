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
 *
 * Wave 5 operational-truth grade (F250C): tenant validation extracted to
 * `./tenant.js`; external vendor catalog sync + capability verification +
 * commercial scorecards. Public surface unchanged — Wave 1 exports are
 * preserved and the additions are purely additive.
 */

export * from "./tenant.js";
import { validateTenantScope, type TenantScope } from "./tenant.js";

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

// ---------------------------------------------------------------------------
// Wave 5 (F250C) — operational-truth grade additions.
// ---------------------------------------------------------------------------

export * from "./digest.js";
export * from "./catalog-sync.js";
export * from "./verification.js";
export * from "./scorecards.js";
