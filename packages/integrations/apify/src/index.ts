/**
 * @fleetos/apify — Apify adapter seam (Wave 1 kernel-grade).
 *
 * Laws:
 *   A4  — consequential action protocol; scraping/actor jobs are typed as
 *         PROPOSALS, never as Authorizations. The Guardian path (worker B)
 *         is the sole authority for consequential scraping actions. The
 *         Guardian path is OUT OF LANE for worker C — referenced via a
 *         structural LOCAL seam only (no @fleetos/* imports).
 *   A7  — Apify SDK types never leak into domain contracts.
 *   A8  — tenant isolation, fail-closed.
 *   A20 — no cross-boundary implementation imports.
 *
 * Wave 1 kernel-grade additions over Wave 0 (F200C):
 *   - retry/idempotency contracts at the seam;
 *   - honest degraded states (UNAVAILABLE vs DEGRADED vs ACTOR_UNKNOWN);
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
// GuardianDecisionRefLike — LOCAL structural seam.
// ---------------------------------------------------------------------------

export interface GuardianDecisionRefLike {
  readonly decisionId: string;
  readonly authorized: boolean;
  readonly reasonCode: string;
}

// ---------------------------------------------------------------------------
// ActorJobProposal — typed as a PROPOSAL. The adapter refuses to execute
// until authorization is set and authorized=true.
// ---------------------------------------------------------------------------

export interface ActorJobProposal {
  readonly kind: "actor-job-proposal";
  readonly tenant: TenantScope;
  readonly actorId: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly proposedAt: string;
  readonly authorization: GuardianDecisionRefLike | null;
  readonly idempotencyKey: string;
}

export type ActorJobResult =
  | { readonly ok: true; readonly output: Readonly<Record<string, unknown>>; readonly fromCache: boolean }
  | { readonly ok: false; readonly reasonCode: ActorJobReasonCode; readonly attempts: number };

export type ActorJobReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "PROPOSAL_UNAUTHORIZED"
  | "APIFY_UNAVAILABLE"
  | "APIFY_DEGRADED"
  | "ACTOR_UNKNOWN"
  | "IDEMPOTENCY_KEY_EMPTY";

export interface ApifyPort {
  runActorJob(proposal: ActorJobProposal): ActorJobResult;
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

export interface DeterministicApifyAdapterConfig {
  readonly simulateOutage: boolean;
  readonly actors: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly retryPolicy?: RetryPolicy;
}

export function createDeterministicApifyAdapter(
  config: DeterministicApifyAdapterConfig,
): ApifyPort {
  const cache = new Map<string, Readonly<Record<string, unknown>>>();
  const policy = config.retryPolicy ?? DEFAULT_RETRY_POLICY;
  return {
    runActorJob(proposal: ActorJobProposal): ActorJobResult {
      const tenant = validateTenantScope(proposal.tenant);
      if (!tenant.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING", attempts: 0 };
      if (!proposal.authorization || !proposal.authorization.authorized) {
        return { ok: false, reasonCode: "PROPOSAL_UNAUTHORIZED", attempts: 0 };
      }
      if (!proposal.idempotencyKey || proposal.idempotencyKey.trim().length === 0) {
        return { ok: false, reasonCode: "IDEMPOTENCY_KEY_EMPTY", attempts: 0 };
      }
      const cacheKey = `${tenant.scope.tenantId}::${proposal.idempotencyKey}`;
      const cached = cache.get(cacheKey);
      if (cached !== undefined) {
        return { ok: true, output: cached, fromCache: true };
      }
      let attempts = 0;
      let lastReason: ActorJobReasonCode = "APIFY_UNAVAILABLE";
      while (attempts < policy.maxAttempts) {
        attempts++;
        if (config.simulateOutage) {
          lastReason = "APIFY_UNAVAILABLE";
          continue;
        }
        const actorOutput = config.actors[proposal.actorId];
        if (!actorOutput) {
          lastReason = "ACTOR_UNKNOWN";
          continue;
        }
        cache.set(cacheKey, actorOutput);
        return { ok: true, output: actorOutput, fromCache: false };
      }
      return { ok: false, reasonCode: lastReason, attempts };
    },
  };
}

// ---------------------------------------------------------------------------
// Proposal factory — the only way to construct an ActorJobProposal.
// ---------------------------------------------------------------------------

export function proposeActorJob(
  tenant: TenantScope,
  actorId: string,
  input: Readonly<Record<string, unknown>>,
  proposedAt: string,
  idempotencyKey: string,
): ActorJobProposal {
  return {
    kind: "actor-job-proposal",
    tenant,
    actorId,
    input,
    proposedAt,
    authorization: null,
    idempotencyKey,
  };
}

// ---------------------------------------------------------------------------
// Boundary assertion — Apify responses are projections, not domain truth.
// ---------------------------------------------------------------------------

export function isApifyProjection(p: { readonly kind?: string }): boolean {
  return p.kind === "apify-projection";
}
