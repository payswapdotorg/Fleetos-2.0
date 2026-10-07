/**
 * @fleetos/integrations/arena — Arena adapter seam.
 *
 * Structural port + deterministic reference adapter. Evaluation proposals
 * stay PROPOSALS — the adapter NEVER submits. The boundary is encoded in
 * types + tests:
 *
 *   - `ArenaAdapter.evaluate` returns an EvaluationProposal, never an
 *     OutcomeObservation or CapabilityAdoptionAuthorization.
 *   - There is no `submit()` or `adopt()` method on the adapter.
 *
 * Arena is not yet registered in pnpm-workspace.yaml (TL-owned; stop-the-line
 * gap — see docs/evidence/F200B/report.md). Until the TL adds
 * `packages/integrations/*` to the workspace, arena declares LOCAL STRUCTURAL
 * interfaces for the @fleetos/learning concepts it references. A structural-
 * compatibility test (tests/structural.test.ts) verifies these are compatible
 * with @fleetos/learning's canonical types.
 */

/** LOCAL structural tenant scope (compatible with @fleetos/learning). */
export interface TenantScopeLike {
  readonly tenantId: string;
  readonly workspaceId?: string;
}

/** LOCAL structural capability version ref (compatible with @fleetos/learning). */
export interface CapabilityVersionRef {
  readonly capabilityId: string;
  readonly version: string;
}

/** LOCAL structural evaluation case (compatible with @fleetos/learning). */
export interface EvaluationCase<T = unknown> {
  readonly caseId: string;
  readonly tenant: TenantScopeLike;
  readonly capability: CapabilityVersionRef;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly expected: T;
  readonly description: string;
  readonly tags: readonly string[];
}

/** Arena evaluation request — a request to evaluate a capability. */
export interface ArenaEvaluationRequest<T = unknown> {
  readonly tenant: TenantScopeLike;
  readonly capability: CapabilityVersionRef;
  readonly cases: readonly EvaluationCase<T>[];
  readonly requester: string;
  readonly requestedAt: string;
}

/**
 * Arena evaluation PROPOSAL — never auto-submitted.
 *
 * The adapter returns proposals; a separate Guardian-authorized path is
 * required to convert them into anything operational. The `kind: "ARENA_PROPOSAL"`
 * literal makes this type structurally distinct from outcome observations
 * and authorization records.
 */
export interface ArenaEvaluationProposal {
  readonly kind: "ARENA_PROPOSAL";
  readonly proposalId: string;
  readonly tenant: TenantScopeLike;
  readonly capability: CapabilityVersionRef;
  readonly caseIds: readonly string[];
  readonly requester: string;
  readonly proposedAt: string;
}

/** Arena adapter — STRUCTURAL seam. */
export interface ArenaAdapter {
  readonly name: string;
  readonly evaluate: <T = unknown>(req: ArenaEvaluationRequest<T>) => ArenaEvaluationProposal;
}

/** Deterministic reference adapter — no network, no submissions. */
export function makeReferenceArenaAdapter(): ArenaAdapter {
  return {
    name: "reference.arena",
    evaluate: <T = unknown>(req: ArenaEvaluationRequest<T>) => ({
      kind: "ARENA_PROPOSAL",
      proposalId: `arena-prop-${req.capability.capabilityId}-${req.capability.version}-${req.tenant.tenantId}`,
      tenant: req.tenant,
      capability: req.capability,
      caseIds: req.cases.map((c) => c.caseId),
      requester: req.requester,
      proposedAt: req.requestedAt,
    }),
  };
}

/** Runtime guard — verifies the ARENA_PROPOSAL marker.
 *
 * Uses the `kind` runtime field — structural discrimination only.
 */
export function isArenaEvaluationProposal(v: unknown): v is ArenaEvaluationProposal {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return r.kind === "ARENA_PROPOSAL" &&
    typeof r.proposalId === "string" &&
    typeof r.tenant === "object" && r.tenant !== null;
}
