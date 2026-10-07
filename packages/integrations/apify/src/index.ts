/**
 * @fleetos/apify — Apify adapter seam.
 *
 * Wave 0 lane C (F200C). Pure TypeScript domain package.
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
 * Types encode the untrusted nature of scraping proposals: there is no
 * `RunActor` capability here — only `ProposeActorJob` that yields a
 * proposal requiring Guardian authorization outside this package.
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
// Guardian authorization seam — LOCAL structural type. Worker B owns the
// authoritative GuardianDecision; this package only references its shape.
// ---------------------------------------------------------------------------

export interface GuardianDecisionRefLike {
  readonly decisionId: string;
  readonly authorized: boolean;
  readonly reasonCode: string;
}

// ---------------------------------------------------------------------------
// Structural port — ApifyPort. Adapter implementations satisfy this shape;
// Apify SDK types never leak into domain contracts (law A7).
// ---------------------------------------------------------------------------

export interface ActorJobProposal {
  readonly kind: "actor-job-proposal";
  readonly tenant: TenantScope;
  readonly actorId: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly proposedAt: string;
  /** Guardian authorization for this proposal; the adapter refuses to
   * execute the job until authorized is true. */
  readonly authorization: GuardianDecisionRefLike | null;
}

export type ActorJobResult =
  | { ok: true; output: Readonly<Record<string, unknown>> }
  | { ok: false; reasonCode: ActorJobReasonCode };

export type ActorJobReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "PROPOSAL_UNAUTHORIZED"
  | "APIFY_UNAVAILABLE"
  | "APIFY_DEGRADED"
  | "ACTOR_UNKNOWN";

export interface ApifyPort {
  runActorJob(proposal: ActorJobProposal): ActorJobResult;
}

// ---------------------------------------------------------------------------
// Deterministic reference adapter — no network. Honors the proposal/authorization
// boundary: refuses any proposal whose authorization is null or not authorized.
// ---------------------------------------------------------------------------

export interface DeterministicApifyAdapterConfig {
  readonly simulateOutage: boolean;
  readonly actors: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

export function createDeterministicApifyAdapter(
  config: DeterministicApifyAdapterConfig,
): ApifyPort {
  return {
    runActorJob(proposal: ActorJobProposal): ActorJobResult {
      const tenant = validateTenantScope(proposal.tenant);
      if (!tenant.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
      if (proposal.authorization === null || !proposal.authorization.authorized) {
        return { ok: false, reasonCode: "PROPOSAL_UNAUTHORIZED" };
      }
      if (config.simulateOutage) {
        return { ok: false, reasonCode: "APIFY_UNAVAILABLE" };
      }
      const actorOutput = config.actors[proposal.actorId];
      if (!actorOutput) {
        return { ok: false, reasonCode: "ACTOR_UNKNOWN" };
      }
      return { ok: true, output: actorOutput };
    },
  };
}

// ---------------------------------------------------------------------------
// Proposal factory — the only way to construct an ActorJobProposal. Starts
// unauthorized; the Guardian path (out-of-lane) MUST set authorization
// before the adapter will execute the job.
// ---------------------------------------------------------------------------

export function proposeActorJob(
  tenant: TenantScope,
  actorId: string,
  input: Readonly<Record<string, unknown>>,
  proposedAt: string,
): ActorJobProposal {
  return {
    kind: "actor-job-proposal",
    tenant,
    actorId,
    input,
    proposedAt,
    authorization: null,
  };
}
