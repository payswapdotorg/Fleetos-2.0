/**
 * @fleetos/aurum — Aurum adapter seam.
 *
 * Wave 0 lane C (F200C). Pure TypeScript domain package: structural port
 * + deterministic reference adapter (no network), with honest degraded
 * states. The reference adapter NEVER touches the network and NEVER owns
 * business truth (law A1). It is a deterministic, replayable seam.
 *
 * Laws:
 *   A1  — no business truth in adapter.
 *   A7  — provider SDK stays behind the port.
 *   A8  — tenant isolation, fail-closed.
 *   A20 — no cross-boundary implementation imports.
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
// Structural port — AurumPort. Adapter implementations satisfy this shape;
// Aurum SDK types never leak into domain contracts (law A7).
// ---------------------------------------------------------------------------

export interface AurumRequest {
  readonly tenant: TenantScope;
  readonly intent: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export type AurumResponse =
  | { ok: true; result: Readonly<Record<string, unknown>> }
  | { ok: false; reasonCode: AurumReasonCode };

export type AurumReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "AURUM_UNAVAILABLE"
  | "AURUM_DEGRADED"
  | "AURUM_REFUSED";

export interface AurumPort {
  invoke(request: AurumRequest): AurumResponse;
}

// ---------------------------------------------------------------------------
// Deterministic reference adapter — no network, no real provider. Returns
// honest degraded states. Used by tests and as a wiring fallback.
// ---------------------------------------------------------------------------

export interface DeterministicAurumAdapterConfig {
  /** When true, the adapter refuses with AURUM_UNAVAILABLE on every call. */
  readonly simulateOutage: boolean;
  /** Map from intent to a deterministic response payload. */
  readonly responses: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

export function createDeterministicAurumAdapter(
  config: DeterministicAurumAdapterConfig,
): AurumPort {
  return {
    invoke(request: AurumRequest): AurumResponse {
      const tenant = validateTenantScope(request.tenant);
      if (!tenant.ok) {
        return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
      }
      if (config.simulateOutage) {
        return { ok: false, reasonCode: "AURUM_UNAVAILABLE" };
      }
      const response = config.responses[request.intent];
      if (!response) {
        return { ok: false, reasonCode: "AURUM_DEGRADED" };
      }
      return { ok: true, result: response };
    },
  };
}
