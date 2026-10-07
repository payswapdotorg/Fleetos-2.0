/**
 * @fleetos/aurum — Aurum adapter seam (Wave 1 kernel-grade).
 *
 * Laws:
 *   A1  — no business truth in adapter.
 *   A7  — provider SDK stays behind the port.
 *   A8  — tenant isolation, fail-closed.
 *   A20 — no cross-boundary implementation imports.
 *
 * Wave 1 kernel-grade additions over Wave 0 (F200C):
 *   - retry/idempotency contracts at the seam;
 *   - honest degraded states (UNAVAILABLE vs DEGRADED vs REFUSED);
 *   - idempotency-key-based deduplication.
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
// Structural port — AurumPort.
// ---------------------------------------------------------------------------

export interface AurumRequest {
  readonly tenant: TenantScope;
  readonly intent: string;
  readonly payload: Readonly<Record<string, unknown>>;
  /** Idempotency key — the adapter MUST dedupe requests with the same key. */
  readonly idempotencyKey: string;
}

export type AurumResponse =
  | { readonly ok: true; readonly result: Readonly<Record<string, unknown>>; readonly fromCache: boolean }
  | { readonly ok: false; readonly reasonCode: AurumReasonCode; readonly attempts: number };

export type AurumReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "AURUM_UNAVAILABLE"
  | "AURUM_DEGRADED"
  | "AURUM_REFUSED"
  | "IDEMPOTENCY_KEY_EMPTY";

export interface AurumPort {
  invoke(request: AurumRequest): AurumResponse;
}

// ---------------------------------------------------------------------------
// Retry policy contract — pure configuration.
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
// Deterministic reference adapter — no network. Honors idempotency:
// requests with the same (tenant, idempotencyKey) return the cached
// response with fromCache=true. Honest degraded states when the
// simulateOutage flag is set or the intent is unknown.
// ---------------------------------------------------------------------------

export interface DeterministicAurumAdapterConfig {
  readonly simulateOutage: boolean;
  readonly responses: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly retryPolicy?: RetryPolicy;
}

export function createDeterministicAurumAdapter(
  config: DeterministicAurumAdapterConfig,
): AurumPort {
  const cache = new Map<string, Readonly<Record<string, unknown>>>();
  const policy = config.retryPolicy ?? DEFAULT_RETRY_POLICY;
  return {
    invoke(request: AurumRequest): AurumResponse {
      const tenant = validateTenantScope(request.tenant);
      if (!tenant.ok) {
        return { ok: false, reasonCode: "TENANT_SCOPE_MISSING", attempts: 0 };
      }
      if (!request.idempotencyKey || request.idempotencyKey.trim().length === 0) {
        return { ok: false, reasonCode: "IDEMPOTENCY_KEY_EMPTY", attempts: 0 };
      }
      const cacheKey = `${tenant.scope.tenantId}::${request.idempotencyKey}`;
      const cached = cache.get(cacheKey);
      if (cached !== undefined) {
        return { ok: true, result: cached, fromCache: true };
      }
      // Retry loop: deterministic; same inputs produce same outputs.
      let attempts = 0;
      let lastReason: AurumReasonCode = "AURUM_UNAVAILABLE";
      while (attempts < policy.maxAttempts) {
        attempts++;
        if (config.simulateOutage) {
          lastReason = "AURUM_UNAVAILABLE";
          continue;
        }
        const response = config.responses[request.intent];
        if (!response) {
          lastReason = "AURUM_DEGRADED";
          continue;
        }
        cache.set(cacheKey, response);
        return { ok: true, result: response, fromCache: false };
      }
      return { ok: false, reasonCode: lastReason, attempts };
    },
  };
}

// ---------------------------------------------------------------------------
// Boundary assertion — the adapter never owns domain truth. The
// response payload is opaque (Record<string, unknown>); the composing
// application reconstructs authoritative domain records from it.
// ---------------------------------------------------------------------------

export function isAurumProjection(p: { readonly kind?: string }): boolean {
  return p.kind === "aurum-projection";
}

export function aurumDoesNotOwnDomainTruth(
  p: { readonly kind?: string },
  domainKinds: readonly string[],
): boolean {
  if (typeof p.kind !== "string") return true;
  return !domainKinds.includes(p.kind);
}
