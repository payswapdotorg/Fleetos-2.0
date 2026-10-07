/**
 * @fleetos/learning — EvaluationCase, outcome observations, capability
 * evaluation, adoption PROPOSALS (never auto-adoption — adoption requires
 * the Guardian path), certification references.
 *
 * Law A5: capability adoption requires the Guardian path. `proposeAdoption`
 * returns a PROPOSAL — there is no `adopt()` function in this package. The
 * Guardian in @fleetos/policy converts proposals into authorizations.
 */

/** LOCAL structural tenant scope (compatible with Worker A). */
export interface TenantScopeLike {
  readonly tenantId: string;
}

/** LOCAL structural capability ref. */
export interface CapabilityVersionRef {
  readonly capabilityId: string;
  readonly version: string;
}

/** Evaluation case — a labeled input/expected-output pair. */
export interface EvaluationCase<T = unknown> {
  readonly caseId: string;
  readonly tenant: TenantScopeLike;
  readonly capability: CapabilityVersionRef;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly expected: T;
  readonly description: string;
  readonly tags: readonly string[];
}

/** Observed outcome — what actually happened. */
export interface OutcomeObservation<T = unknown> {
  readonly observationId: string;
  readonly caseId: string;
  readonly actual: T;
  readonly observedAt: string;
  readonly observationRef: string; // points at immutable observation (law A3)
  readonly success: boolean;
}

/** Capability evaluation — aggregates outcomes across cases. */
export interface CapabilityEvaluation {
  readonly evaluationId: string;
  readonly tenant: TenantScopeLike;
  readonly capability: CapabilityVersionRef;
  readonly caseIds: readonly string[];
  readonly totalCases: number;
  readonly successes: number;
  readonly failures: number;
  readonly successRate: number; // 0..1
  readonly evaluatedAt: string;
  readonly outcomeRefs: readonly string[];
}

/** Certification reference — points at an external certification artifact. */
export interface CertificationRef {
  readonly certificationId: string;
  readonly tenant: TenantScopeLike;
  readonly capability: CapabilityVersionRef;
  readonly issuedBy: string;
  readonly issuedAt: string;
  readonly evidenceRef: string;
  readonly validUntil: string;
}

/**
 * Adoption PROPOSAL — never auto-adopts.
 *
 * Law A5: capability adoption requires the Guardian path. This package
 * returns proposals; the Guardian (in @fleetos/policy) is the SOLE authority
 * that can convert a proposal into an authorization. There is NO `adopt()`
 * function exported from this package.
 */
export interface CapabilityAdoptionProposal {
  readonly proposalId: string;
  readonly tenant: TenantScopeLike;
  readonly capability: CapabilityVersionRef;
  readonly evaluationRef: string;
  readonly proposedAt: string;
  readonly proposedBy: string;
  readonly rationale: string;
  readonly status: "pending" | "rejected" | "authorized";
}

/** Run an evaluation — pure, deterministic over inputs. */
export function evaluateCapability<T = unknown>(
  cases: readonly EvaluationCase<T>[],
  outcomes: readonly OutcomeObservation<T>[],
  tenant: TenantScopeLike,
  capability: CapabilityVersionRef,
  evaluatedAt: string = "1970-01-01T00:00:00.000Z",
): CapabilityEvaluation {
  const outcomesByCase = new Map<string, OutcomeObservation<T>>();
  for (const o of outcomes) outcomesByCase.set(o.caseId, o);
  let successes = 0;
  let failures = 0;
  const outcomeRefs: string[] = [];
  for (const c of cases) {
    const o = outcomesByCase.get(c.caseId);
    if (!o) {
      failures += 1;
      continue;
    }
    outcomeRefs.push(o.observationRef);
    if (o.success) successes += 1;
    else failures += 1;
  }
  const total = cases.length;
  return {
    evaluationId: `eval-${capability.capabilityId}-${capability.version}-${tenant.tenantId}`,
    tenant,
    capability,
    caseIds: cases.map((c) => c.caseId),
    totalCases: total,
    successes,
    failures,
    successRate: total === 0 ? 0 : successes / total,
    evaluatedAt,
    outcomeRefs,
  };
}

/**
 * Propose adoption of a capability based on an evaluation.
 *
 * Returns a proposal with status="pending" — NEVER authorizes.
 */
export function proposeAdoption(input: {
  readonly tenant: TenantScopeLike;
  readonly capability: CapabilityVersionRef;
  readonly evaluation: CapabilityEvaluation;
  readonly proposedBy: string;
  readonly rationale: string;
  readonly proposedAt: string;
}): CapabilityAdoptionProposal {
  return {
    proposalId: `prop-${input.capability.capabilityId}-${input.capability.version}-${input.tenant.tenantId}`,
    tenant: input.tenant,
    capability: input.capability,
    evaluationRef: input.evaluation.evaluationId,
    proposedAt: input.proposedAt,
    proposedBy: input.proposedBy,
    rationale: input.rationale,
    status: "pending",
  };
}

/**
 * Mark a proposal as authorized — ONLY callable by the Guardian path.
 *
 * This is intentionally a separate, named function — it does NOT exist as a
 * setter on the proposal object. The Guardian's authorizeAdoption() (in
 * @fleetos/policy) is the canonical caller; agents/workflows/models cannot
 * call this directly to bypass Guardian review (law A5).
 */
export function markProposalAuthorized(proposal: CapabilityAdoptionProposal): CapabilityAdoptionProposal {
  return { ...proposal, status: "authorized" };
}

/** Mark a proposal as rejected. */
export function markProposalRejected(proposal: CapabilityAdoptionProposal): CapabilityAdoptionProposal {
  return { ...proposal, status: "rejected" };
}
