/**
 * @fleetos/external-vendors — External vendor/system adapter seam.
 *
 * Wave 0 lane C (F200C). Pure TypeScript domain package.
 *
 * Laws:
 *   A1  — external systems NEVER own domain truth. This adapter is a
 *         projection/translation surface only. Domain truth lives in the
 *         authoritative bounded contexts (procurement, vendors, work).
 *   A7  — external SDKs stay behind the port.
 *   A8  — tenant isolation, fail-closed.
 *   A20 — no cross-boundary implementation imports.
 *
 * The boundary tests in tests/ encode + assert the no-domain-truth rule:
 * every response from the external system is tagged with kind =
 * "external-projection" — never with authoritative domain id kinds
 * ("quote", "order", etc.). The domain must reconstruct authoritative
 * records from the projection; the adapter does not own them.
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
// External projection — a translated snapshot from an external system.
// Tagged kind "external-projection" to assert, in types, that this is NOT
// a domain authoritative record. The authoritative domain record (Quote,
// Order, etc.) lives in @fleetos/procurement and is reconstructed from
// projections by the application layer.
// ---------------------------------------------------------------------------

export interface ExternalProjection {
  readonly kind: "external-projection";
  readonly tenant: TenantScope;
  readonly sourceSystem: string;
  readonly externalRef: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly observedAt: string;
}

// ---------------------------------------------------------------------------
// Structural port — ExternalVendorPort. Adapter implementations satisfy
// this shape; external SDKs never leak into domain contracts (law A7).
// ---------------------------------------------------------------------------

export interface ExternalQuery {
  readonly tenant: TenantScope;
  readonly sourceSystem: string;
  readonly externalRef: string;
}

export type ExternalQueryResult =
  | { ok: true; projection: ExternalProjection }
  | { ok: false; reasonCode: ExternalReasonCode };

export type ExternalReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "EXTERNAL_SYSTEM_UNAVAILABLE"
  | "EXTERNAL_REF_UNKNOWN";

export interface ExternalVendorPort {
  fetchProjection(query: ExternalQuery): ExternalQueryResult;
}

// ---------------------------------------------------------------------------
// Deterministic reference adapter — no network. Returns honest degraded
// states when the external system is unavailable or the ref is unknown.
// ---------------------------------------------------------------------------

export interface DeterministicExternalVendorAdapterConfig {
  readonly simulateOutage: boolean;
  readonly projections: Readonly<
    Record<string, Readonly<Record<string, unknown>>>
  >;
}

export function createDeterministicExternalVendorAdapter(
  config: DeterministicExternalVendorAdapterConfig,
): ExternalVendorPort {
  return {
    fetchProjection(query: ExternalQuery): ExternalQueryResult {
      const tenant = validateTenantScope(query.tenant);
      if (!tenant.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
      if (config.simulateOutage) {
        return { ok: false, reasonCode: "EXTERNAL_SYSTEM_UNAVAILABLE" };
      }
      const payload = config.projections[query.externalRef];
      if (!payload) {
        return { ok: false, reasonCode: "EXTERNAL_REF_UNKNOWN" };
      }
      return {
        ok: true,
        projection: {
          kind: "external-projection",
          tenant: tenant.scope,
          sourceSystem: query.sourceSystem,
          externalRef: query.externalRef,
          payload,
          observedAt: "1970-01-01T00:00:00Z",
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Boundary assertion — external systems never own domain truth. The
// projection's `kind` must NEVER equal any authoritative domain id kind.
// This function asserts the boundary at runtime (used by tests).
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
