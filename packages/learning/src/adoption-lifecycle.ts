/**
 * @fleetos/learning — Adoption proposal lifecycle (Wave 5, F250B).
 *
 * `proposed -> guardian-review -> authorized | rejected -> adopted | withdrawn`
 *
 *   - openAdoptionLifecycle: proposed (wraps an EXISTING pending proposal).
 *   - beginGuardianReview: proposed -> guardian-review.
 *   - authorizeAdoption: guardian-review -> authorized. GUARDIAN
 *     AUTHORIZATION IS AN INPUT — the caller (the Guardian path) supplies a
 *     `GuardianAuthorization` record; this module verifies its shape and
 *     applies the existing `markProposalAuthorized` law. Agents, workflows
 *     and models cannot self-authorize.
 *   - rejectAdoption: guardian-review -> rejected, with a reason code
 *     (via the existing `markProposalRejected`). Rejection requires Guardian
 *     review first — rejecting from "proposed" is an illegal transition.
 *   - completeAdoption: authorized -> adopted, evidence-gated.
 *   - withdrawAdoption: proposed|guardian-review|authorized -> withdrawn.
 *   - rejected / adopted / withdrawn are TERMINAL.
 *   - cascadeCertificationRevocation: a revoked certification force-rejects
 *     DEPENDENT adoption proposals that have not completed adoption
 *     (fail-closed, reason code "certification-revoked").
 *
 * Idempotent: re-applying the SAME transition returns an equal record
 * (no duplicate history). Illegal transitions are rejected with codes.
 * Pure deterministic TS; integer logical ms; tenant fail-closed.
 */

import type {
  CapabilityAdoptionProposal,
  CapabilityVersionRef,
  TenantScopeLike,
} from "./index.ts";
import { markProposalAuthorized, markProposalRejected } from "./index.ts";
import { canonicalJson, fnv1a } from "./outcome-intake.ts";

/** Adoption lifecycle stages. */
export type AdoptionStage =
  | "proposed"
  | "guardian-review"
  | "authorized"
  | "rejected"
  | "adopted"
  | "withdrawn";

/** Legal transition table (the cascade exception is separate — see below). */
export const ADOPTION_TRANSITIONS: Readonly<Record<AdoptionStage, readonly AdoptionStage[]>> = {
  proposed: ["guardian-review", "withdrawn"],
  "guardian-review": ["authorized", "rejected", "withdrawn"],
  authorized: ["adopted", "withdrawn"],
  rejected: [],
  adopted: [],
  withdrawn: [],
};

/** Guardian authorization — an INPUT to this module, never produced by it. */
export interface GuardianAuthorization {
  readonly guardianDecisionId: string;
  readonly decidedAtMs: number;
  readonly authorizedBy: string;
  /** Opaque Guardian decision digest (points at the Guardian's record). */
  readonly decisionDigest: string;
}

/** Rejection reason codes — closed vocabulary. */
export type AdoptionRejectionCode =
  | "insufficient-evidence"
  | "policy-violation"
  | "guardian-rejected"
  | "certification-revoked"
  | "duplicate-proposal"
  | "proposer-withdrawal";

export interface AdoptionRejection {
  readonly reasonCode: AdoptionRejectionCode;
  readonly note: string;
  readonly rejectedBy: string;
  readonly rejectedAtMs: number;
}

export interface AdoptionTransition {
  readonly from: AdoptionStage;
  readonly to: AdoptionStage;
  readonly atMs: number;
  readonly note: string;
}

export interface AdoptionLifecycleRecord {
  readonly kind: "ADOPTION_LIFECYCLE";
  readonly proposalId: string;
  readonly tenantId: string;
  readonly capability: CapabilityVersionRef;
  readonly stage: AdoptionStage;
  readonly certificationId: string | null;
  readonly openedAtMs: number;
  readonly proposal: CapabilityAdoptionProposal;
  readonly guardian: GuardianAuthorization | null;
  readonly rejection: AdoptionRejection | null;
  readonly adoptionEvidenceRef: string | null;
  readonly history: readonly AdoptionTransition[];
  readonly recordDigest: string;
}

/** A certification revocation notice — LOCAL structural input (arena-compatible). */
export interface CertificationRevocationNotice {
  readonly certificationId: string;
  readonly tenantId: string;
  readonly reason: string;
  readonly revokedAtMs: number;
  readonly revocationDigest: string;
}

export interface LifecycleFailure {
  readonly ok: false;
  readonly code:
    | "illegal-transition"
    | "missing-tenant"
    | "cross-tenant-proposal"
    | "invalid-proposal-state"
    | "invalid-input"
    | "already-authorized"
    | "missing-adoption-evidence";
  readonly reason: string;
}

export type LifecycleResult =
  | { readonly ok: true; readonly record: AdoptionLifecycleRecord }
  | LifecycleFailure;

export type CascadeResult =
  | {
      readonly ok: true;
      readonly records: readonly AdoptionLifecycleRecord[];
      readonly rejected: readonly string[];
      readonly skipped: readonly { readonly proposalId: string; readonly stage: AdoptionStage }[];
    }
  | LifecycleFailure;

function recordDigest(r: Omit<AdoptionLifecycleRecord, "recordDigest">): string {
  return fnv1a(
    `adoption|v1|${r.tenantId}|${r.proposalId}|${r.capability.capabilityId}@${r.capability.version}` +
      `|${r.stage}|${r.certificationId ?? "-"}|${r.openedAtMs}|${canonicalJson(r.proposal)}` +
      `|${canonicalJson(r.guardian)}|${canonicalJson(r.rejection)}|${r.adoptionEvidenceRef ?? "-"}` +
      `|${r.history.map((h) => `${h.from}>${h.to}@${h.atMs}:${h.note}`).join(";")}`,
  );
}

function withStage(
  r: AdoptionLifecycleRecord,
  stage: AdoptionStage,
  atMs: number,
  note: string,
  patch: Partial<AdoptionLifecycleRecord>,
): AdoptionLifecycleRecord {
  const next: Omit<AdoptionLifecycleRecord, "recordDigest"> = {
    ...r,
    ...patch,
    stage,
    history: [...r.history, { from: r.stage, to: stage, atMs, note }],
  };
  return { ...next, recordDigest: recordDigest(next) };
}

function validTime(atMs: number): boolean {
  return Number.isInteger(atMs) && atMs >= 0;
}

/**
 * Open a lifecycle for an EXISTING pending adoption proposal.
 * Fail-closed: empty tenant, tenant mismatch with the proposal, or a
 * proposal whose status is not "pending".
 */
export function openAdoptionLifecycle(input: {
  readonly tenant: TenantScopeLike;
  readonly proposal: CapabilityAdoptionProposal;
  readonly certificationId?: string;
  readonly openedAtMs: number;
}): LifecycleResult {
  const tenantId = input.tenant.tenantId;
  if (tenantId === "") {
    return { ok: false, code: "missing-tenant", reason: "tenant identifier is empty" };
  }
  if (!validTime(input.openedAtMs)) {
    return { ok: false, code: "invalid-input", reason: "openedAtMs must be an integer >= 0 (logical ms)" };
  }
  if (input.proposal.tenant.tenantId !== tenantId) {
    return {
      ok: false,
      code: "cross-tenant-proposal",
      reason: `proposal ${input.proposal.proposalId} belongs to tenant "${input.proposal.tenant.tenantId}"`,
    };
  }
  if (input.proposal.status !== "pending") {
    return {
      ok: false,
      code: "invalid-proposal-state",
      reason: `proposal ${input.proposal.proposalId} is "${input.proposal.status}" — only pending proposals can open a lifecycle`,
    };
  }
  const base: Omit<AdoptionLifecycleRecord, "recordDigest"> = {
    kind: "ADOPTION_LIFECYCLE",
    proposalId: input.proposal.proposalId,
    tenantId,
    capability: input.proposal.capability,
    stage: "proposed",
    certificationId: input.certificationId ?? null,
    openedAtMs: input.openedAtMs,
    proposal: input.proposal,
    guardian: null,
    rejection: null,
    adoptionEvidenceRef: null,
    history: [],
  };
  return { ok: true, record: { ...base, recordDigest: recordDigest(base) } };
}

/** proposed -> guardian-review (idempotent). */
export function beginGuardianReview(record: AdoptionLifecycleRecord, atMs: number): LifecycleResult {
  if (!validTime(atMs)) {
    return { ok: false, code: "invalid-input", reason: "atMs must be an integer >= 0 (logical ms)" };
  }
  if (record.stage === "guardian-review") return { ok: true, record }; // idempotent
  if (!ADOPTION_TRANSITIONS[record.stage].includes("guardian-review")) {
    return { ok: false, code: "illegal-transition", reason: `cannot enter guardian-review from ${record.stage}` };
  }
  return { ok: true, record: withStage(record, "guardian-review", atMs, "entered guardian review", {}) };
}

/**
 * guardian-review -> authorized. The Guardian authorization is an INPUT —
 * verified for shape, applied via the existing `markProposalAuthorized` law.
 * Idempotent with the SAME authorization; a different one is rejected.
 */
export function authorizeAdoption(
  record: AdoptionLifecycleRecord,
  authorization: GuardianAuthorization,
  atMs: number,
): LifecycleResult {
  if (authorization.guardianDecisionId === "" || authorization.authorizedBy === "" || authorization.decisionDigest === "") {
    return { ok: false, code: "invalid-input", reason: "guardian authorization requires non-empty id, actor and decision digest" };
  }
  if (!validTime(authorization.decidedAtMs)) {
    return { ok: false, code: "invalid-input", reason: "guardian decision time must be an integer >= 0 (logical ms)" };
  }
  if (!validTime(atMs)) {
    return { ok: false, code: "invalid-input", reason: "atMs must be an integer >= 0 (logical ms)" };
  }
  if (record.stage === "authorized") {
    if (canonicalJson(record.guardian) === canonicalJson(authorization)) return { ok: true, record }; // idempotent
    return { ok: false, code: "already-authorized", reason: "record is already authorized by a different guardian decision" };
  }
  if (!ADOPTION_TRANSITIONS[record.stage].includes("authorized")) {
    return { ok: false, code: "illegal-transition", reason: `cannot authorize from ${record.stage}` };
  }
  return {
    ok: true,
    record: withStage(record, "authorized", atMs, `guardian decision ${authorization.guardianDecisionId}`, {
      guardian: authorization,
      proposal: markProposalAuthorized(record.proposal),
    }),
  };
}

/** guardian-review -> rejected, with a reason code (idempotent). Rejecting
 * from "proposed" is illegal — the packet lifecycle routes every rejection
 * through Guardian review first. */
export function rejectAdoption(record: AdoptionLifecycleRecord, rejection: AdoptionRejection): LifecycleResult {
  if (rejection.note === "" || rejection.rejectedBy === "") {
    return { ok: false, code: "invalid-input", reason: "rejection requires a non-empty note and rejecter" };
  }
  if (!validTime(rejection.rejectedAtMs)) {
    return { ok: false, code: "invalid-input", reason: "rejectedAtMs must be an integer >= 0 (logical ms)" };
  }
  if (record.stage === "rejected") {
    if (canonicalJson(record.rejection) === canonicalJson(rejection)) return { ok: true, record }; // idempotent
    return { ok: false, code: "illegal-transition", reason: "record is already rejected with a different reason" };
  }
  if (!ADOPTION_TRANSITIONS[record.stage].includes("rejected")) {
    return { ok: false, code: "illegal-transition", reason: `cannot reject from ${record.stage}` };
  }
  return {
    ok: true,
    record: withStage(record, "rejected", rejection.rejectedAtMs, `rejected: ${rejection.reasonCode}`, {
      rejection,
      proposal: markProposalRejected(record.proposal),
    }),
  };
}

/** authorized -> adopted, evidence-gated (idempotent). */
export function completeAdoption(
  record: AdoptionLifecycleRecord,
  adoptionEvidenceRef: string,
  atMs: number,
): LifecycleResult {
  if (adoptionEvidenceRef === "") {
    return { ok: false, code: "missing-adoption-evidence", reason: "completing an adoption requires a non-empty evidence reference" };
  }
  if (!validTime(atMs)) {
    return { ok: false, code: "invalid-input", reason: "atMs must be an integer >= 0 (logical ms)" };
  }
  if (record.stage === "adopted") {
    if (record.adoptionEvidenceRef === adoptionEvidenceRef) return { ok: true, record }; // idempotent
    return { ok: false, code: "illegal-transition", reason: "record is already adopted with different evidence" };
  }
  if (!ADOPTION_TRANSITIONS[record.stage].includes("adopted")) {
    return { ok: false, code: "illegal-transition", reason: `cannot complete adoption from ${record.stage} — Guardian authorization required first` };
  }
  return {
    ok: true,
    record: withStage(record, "adopted", atMs, `adoption evidence ${adoptionEvidenceRef}`, {
      adoptionEvidenceRef,
    }),
  };
}

/** proposed|guardian-review|authorized -> withdrawn (idempotent). */
export function withdrawAdoption(record: AdoptionLifecycleRecord, note: string, atMs: number): LifecycleResult {
  if (note === "") {
    return { ok: false, code: "invalid-input", reason: "withdrawal requires a non-empty note" };
  }
  if (!validTime(atMs)) {
    return { ok: false, code: "invalid-input", reason: "atMs must be an integer >= 0 (logical ms)" };
  }
  if (record.stage === "withdrawn") return { ok: true, record }; // idempotent
  if (!ADOPTION_TRANSITIONS[record.stage].includes("withdrawn")) {
    return { ok: false, code: "illegal-transition", reason: `cannot withdraw from ${record.stage}` };
  }
  return { ok: true, record: withStage(record, "withdrawn", atMs, `withdrawn: ${note}`, {}) };
}

/**
 * Certification revocation CASCADE (fail-closed): every dependent adoption
 * proposal that cites the revoked certification AND has not completed
 * adoption is force-rejected with reasonCode "certification-revoked".
 * Records already terminal (adopted/rejected/withdrawn) are returned
 * UNCHANGED and listed in `skipped` — history is never rewritten.
 *
 * Fail-closed: an empty notice tenant or a record from another tenant
 * rejects the WHOLE cascade (offender named) — no partial application.
 */
export function cascadeCertificationRevocation(
  records: readonly AdoptionLifecycleRecord[],
  notice: CertificationRevocationNotice,
): CascadeResult {
  if (notice.tenantId === "") {
    return { ok: false, code: "missing-tenant", reason: "revocation notice carries no tenant" };
  }
  if (notice.certificationId === "") {
    return { ok: false, code: "invalid-input", reason: "revocation notice carries no certification id" };
  }
  if (!validTime(notice.revokedAtMs)) {
    return { ok: false, code: "invalid-input", reason: "revokedAtMs must be an integer >= 0 (logical ms)" };
  }
  for (const r of records) {
    if (r.tenantId !== notice.tenantId) {
      return {
        ok: false,
        code: "cross-tenant-proposal",
        reason: `record ${r.proposalId} belongs to tenant "${r.tenantId}" (notice tenant "${notice.tenantId}")`,
      };
    }
  }
  const rejected: string[] = [];
  const skipped: { readonly proposalId: string; readonly stage: AdoptionStage }[] = [];
  const out = records.map((r) => {
    if (r.certificationId !== notice.certificationId) return r;
    if (r.stage === "adopted" || r.stage === "rejected" || r.stage === "withdrawn") {
      skipped.push({ proposalId: r.proposalId, stage: r.stage });
      return r;
    }
    rejected.push(r.proposalId);
    const cascadeRejection: AdoptionRejection = {
      reasonCode: "certification-revoked",
      note: `certification ${notice.certificationId} revoked (${notice.revocationDigest})`,
      rejectedBy: "certification-revocation-cascade",
      rejectedAtMs: notice.revokedAtMs,
    };
    return withStage(
      r,
      "rejected",
      notice.revokedAtMs,
      `cascade: certification ${notice.certificationId} revoked`,
      { rejection: cascadeRejection, proposal: markProposalRejected(r.proposal) },
    );
  });
  return { ok: true, records: out, rejected, skipped };
}
