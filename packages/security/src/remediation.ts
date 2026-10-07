/**
 * @fleetos/security — Remediation proposal lifecycle (F220B, Wave 2).
 *
 * proposed -> approved -> applied -> verified, with EVIDENCE-GATED
 * transitions:
 *  - `approved` requires a Guardian approval ref (the authorization leg).
 *  - `applied` requires a verification evidence ref — a proposal is NEVER
 *    applied without verification evidence attached.
 *  - `verified` requires a verification outcome; an outcome of
 *    `verified: false` REFUSES the transition (honest failure — the record
 *    stays `applied`, it is never marked verified on a failed check).
 *
 * Laws:
 *  - A4/A5: approval is evidence-gated; this module never authorizes anything
 *    itself — the approvalRef must come from the Guardian path.
 *  - A8 tenant fail-closed: advancing a record under a different (or missing)
 *    tenant scope REFUSES with a machine-stable reason.
 *  - Determinism: time is an explicit `number` input; no wall-clock.
 */

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export type RemediationLifecycleState = "proposed" | "approved" | "applied" | "verified";

export interface RemediationTransition {
  readonly from: RemediationLifecycleState;
  readonly to: RemediationLifecycleState;
  readonly at: number;
  readonly reason: string;
  readonly actorId: string;
}

export interface RemediationProposalRecord {
  readonly proposalId: string;
  readonly tenantId: string;
  readonly findingIds: readonly string[];
  readonly remediationKind: "patch" | "rotate_credential" | "isolate" | "enforce_mfa" | "revoke_authority" | "manual_review";
  readonly state: RemediationLifecycleState;
  /** Guardian approval evidence ref — required to reach `approved`. */
  readonly approvalRef: string | null;
  /** Verification evidence ref — required to reach `applied`. */
  readonly verificationEvidenceRef: string | null;
  /** Verification outcome — required to reach `verified`. */
  readonly verificationOutcome: { readonly verified: boolean; readonly evidenceRef: string } | null;
  readonly transitions: readonly RemediationTransition[];
  readonly lastTransitionAt: number;
}

export type RemediationRefusalCode =
  | "remediation.missing-tenant"
  | "remediation.missing-proposal-id"
  | "remediation.empty-findings"
  | "remediation.tenant-mismatch"
  | "remediation.unknown-proposal"
  | "remediation.illegal-transition"
  | "remediation.missing-approval-ref"
  | "remediation.missing-verification-evidence"
  | "remediation.missing-verification-outcome"
  | "remediation.verification-failed"
  | "remediation.invalid-at";

export type RemediationAdvanceResult =
  | { readonly ok: true; readonly record: RemediationProposalRecord }
  | { readonly ok: false; readonly reason: RemediationRefusalCode; readonly record: RemediationProposalRecord };

// ---------------------------------------------------------------------------
// Legal transitions
// ---------------------------------------------------------------------------

const LEGAL_TRANSITIONS: Readonly<Record<RemediationLifecycleState, readonly RemediationLifecycleState[]>> = {
  proposed: ["approved"],
  approved: ["applied"],
  applied: ["verified"],
  verified: [],
};

/** The legal transition table — exported for tests and tooling. */
export function legalRemediationTransitions(from: RemediationLifecycleState): readonly RemediationLifecycleState[] {
  return LEGAL_TRANSITIONS[from];
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/**
 * Propose a remediation record — starts at `proposed`.
 *
 * Refuses: missing tenant scope (fail-closed, law A8), missing proposal id,
 * empty finding set, invalid `at`.
 */
export function proposeRemediationRecord(input: {
  readonly proposalId: string;
  readonly tenantId: string;
  readonly findingIds: readonly string[];
  readonly remediationKind: RemediationProposalRecord["remediationKind"];
  readonly at: number;
}): { readonly ok: true; readonly record: RemediationProposalRecord } | { readonly ok: false; readonly reason: RemediationRefusalCode } {
  if (input.tenantId === "") return { ok: false, reason: "remediation.missing-tenant" };
  if (input.proposalId === "") return { ok: false, reason: "remediation.missing-proposal-id" };
  if (input.findingIds.length === 0) return { ok: false, reason: "remediation.empty-findings" };
  if (!Number.isInteger(input.at) || input.at < 0) return { ok: false, reason: "remediation.invalid-at" };
  return {
    ok: true,
    record: {
      proposalId: input.proposalId,
      tenantId: input.tenantId,
      findingIds: [...input.findingIds],
      remediationKind: input.remediationKind,
      state: "proposed",
      approvalRef: null,
      verificationEvidenceRef: null,
      verificationOutcome: null,
      transitions: [],
      lastTransitionAt: input.at,
    },
  };
}

// ---------------------------------------------------------------------------
// Lifecycle advance — evidence-gated, tenant fail-closed
// ---------------------------------------------------------------------------

export interface RemediationAdvanceContext {
  /** The tenant scope under which the advance is attempted. */
  readonly tenantId: string;
  readonly actorId: string;
  /** Epoch ms — explicit time input. */
  readonly at: number;
  /** Guardian approval evidence ref (required for `approved`). */
  readonly approvalRef?: string;
  /** Verification evidence ref (required for `applied`). */
  readonly verificationEvidenceRef?: string;
  /** Verification outcome (required for `verified`). */
  readonly verificationOutcome?: { readonly verified: boolean; readonly evidenceRef: string };
}

/**
 * Advance a remediation proposal. Every transition is legal-transition
 * checked AND evidence-gated:
 *
 *  - proposed -> approved : requires `approvalRef` (Guardian decision ref).
 *  - approved -> applied  : requires `verificationEvidenceRef` — a proposal
 *                           cannot be applied without verification evidence.
 *  - applied -> verified : requires `verificationOutcome` with
 *                          `verified: true`; a failed outcome REFUSES with
 *                          `remediation.verification-failed`.
 *
 * All other transitions refuse with `remediation.illegal-transition`.
 * Cross-tenant advance refuses with `remediation.tenant-mismatch`; a missing
 * tenant scope refuses with `remediation.missing-tenant`.
 */
export function advanceRemediation(
  record: RemediationProposalRecord,
  target: RemediationLifecycleState,
  ctx: RemediationAdvanceContext,
): RemediationAdvanceResult {
  if (ctx.tenantId === "") {
    return { ok: false, reason: "remediation.missing-tenant", record };
  }
  if (ctx.tenantId !== record.tenantId) {
    return { ok: false, reason: "remediation.tenant-mismatch", record };
  }
  if (!Number.isInteger(ctx.at) || ctx.at < 0) {
    return { ok: false, reason: "remediation.invalid-at", record };
  }
  if (!(LEGAL_TRANSITIONS[record.state] ?? []).includes(target)) {
    return { ok: false, reason: "remediation.illegal-transition", record };
  }

  if (target === "approved") {
    if (!ctx.approvalRef || ctx.approvalRef === "") {
      return { ok: false, reason: "remediation.missing-approval-ref", record };
    }
    return { ok: true, record: applyTransition(record, "approved", ctx, { approvalRef: ctx.approvalRef }, "guardian-approval-attached") };
  }

  if (target === "applied") {
    if (!ctx.verificationEvidenceRef || ctx.verificationEvidenceRef === "") {
      return { ok: false, reason: "remediation.missing-verification-evidence", record };
    }
    return {
      ok: true,
      record: applyTransition(record, "applied", ctx, { verificationEvidenceRef: ctx.verificationEvidenceRef }, "verification-evidence-attached"),
    };
  }

  // target === "verified"
  if (!ctx.verificationOutcome) {
    return { ok: false, reason: "remediation.missing-verification-outcome", record };
  }
  if (!ctx.verificationOutcome.verified) {
    return { ok: false, reason: "remediation.verification-failed", record };
  }
  return {
    ok: true,
    record: applyTransition(record, "verified", ctx, { verificationOutcome: ctx.verificationOutcome }, "verification-passed"),
  };
}

function applyTransition(
  record: RemediationProposalRecord,
  to: RemediationLifecycleState,
  ctx: RemediationAdvanceContext,
  patch: Partial<RemediationProposalRecord>,
  reason: string,
): RemediationProposalRecord {
  const transition: RemediationTransition = {
    from: record.state,
    to,
    at: ctx.at,
    reason,
    actorId: ctx.actorId,
  };
  return {
    ...record,
    ...patch,
    state: to,
    transitions: [...record.transitions, transition],
    lastTransitionAt: ctx.at,
  };
}

// ---------------------------------------------------------------------------
// Post-mortem verification — audit the evidence gating after the fact
// ---------------------------------------------------------------------------

export interface RemediationPostMortemFinding {
  readonly proposalId: string;
  readonly ok: boolean;
  readonly reason: RemediationRefusalCode | null;
}

/**
 * Post-mortem walk of a settled remediation history: every transition in the
 * record's history must have carried its required evidence at the time it
 * happened. This reconstructs the gating from the appended transition list —
 * a record whose history is missing the evidence fields flags the exact
 * refusal code.
 */
export function verifyRemediationHistory(
  record: RemediationProposalRecord,
): RemediationPostMortemFinding {
  let state: RemediationLifecycleState = "proposed";
  for (const t of record.transitions) {
    if (t.from !== state) {
      return { proposalId: record.proposalId, ok: false, reason: "remediation.illegal-transition" };
    }
    if (t.to === "approved" && (record.approvalRef === null || record.approvalRef === "")) {
      return { proposalId: record.proposalId, ok: false, reason: "remediation.missing-approval-ref" };
    }
    if (t.to === "applied" && (record.verificationEvidenceRef === null || record.verificationEvidenceRef === "")) {
      return { proposalId: record.proposalId, ok: false, reason: "remediation.missing-verification-evidence" };
    }
    if (t.to === "verified" && record.verificationOutcome === null) {
      return { proposalId: record.proposalId, ok: false, reason: "remediation.missing-verification-outcome" };
    }
    if (t.to === "verified" && record.verificationOutcome !== null && !record.verificationOutcome.verified) {
      return { proposalId: record.proposalId, ok: false, reason: "remediation.verification-failed" };
    }
    state = t.to;
  }
  if (state !== record.state) {
    return { proposalId: record.proposalId, ok: false, reason: "remediation.illegal-transition" };
  }
  return { proposalId: record.proposalId, ok: true, reason: null };
}
