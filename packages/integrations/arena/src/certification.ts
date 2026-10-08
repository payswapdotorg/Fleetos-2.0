/**
 * @fleetos/integrations/arena — Certification references (Wave 5, F250B).
 *
 * Minting certification REFERENCES from accepted evaluations:
 *   - a certification is minted ONLY from a REPORTED run whose scored
 *     proposal reached the ladder's `high` tier (accepted = reported + high);
 *   - records are IMMUTABLE values with CHAINED digests (per-tenant genesis);
 *   - revocation creates a separate revocation record with a reason code and
 *     PROPAGATES to dependent proposals (blocked, never auto-anything);
 *   - tenant fail-closed everywhere.
 *
 * LAW: a certification is a REFERENCE, not an authorization. Nothing in
 * this module authorizes adoption, execution or deployment — the Guardian
 * path owns that conversion. There is no authorize/execute function here.
 *
 * Note (integer-ms discipline): certification timestamps are integer
 * logical ms (F230B convention). This intentionally diverges from
 * @fleetos/learning's Wave-0 `CertificationRef` string-dated shape — a
 * structural seam recorded for TL adjudication (both live in lane B).
 */

import type { CapabilityVersionRef, TenantScopeLike } from "./index.ts";
import type { ArenaDegradedState } from "./degraded.ts";
import type { EvaluationRun } from "./evaluation-runs.ts";
import type { ScoredProposal } from "./proposal-scoring.ts";
import { fnv1a } from "./case-registry.ts";

/** Certification revocation reason codes — closed vocabulary. */
export type CertificationRevocationReason =
  | "expired"
  | "superseded"
  | "evaluation-fraud"
  | "guardian-directive"
  | "capability-retired";

/** Immutable certification REFERENCE with a chained digest. */
export interface CertificationRef {
  readonly kind: "ARENA_CERTIFICATION";
  readonly certificationId: string;
  readonly tenantId: string;
  readonly capability: CapabilityVersionRef;
  readonly issuedBy: string;
  readonly issuedAtMs: number;
  readonly validUntilMs: number;
  readonly evidenceRef: string;
  readonly runId: string;
  readonly proposalId: string;
  /** Chain: digest of the previous certification in the tenant's registry ("genesis" for the first). */
  readonly prevDigest: string;
  /** FNV-1a over the canonical certification fields incl. prevDigest. */
  readonly digest: string;
}

/** A revocation record — separate from the immutable certification. */
export interface CertificationRevocation {
  readonly kind: "ARENA_CERTIFICATION_REVOCATION";
  readonly certificationId: string;
  readonly tenantId: string;
  readonly reason: CertificationRevocationReason;
  readonly revokedBy: string;
  readonly revokedAtMs: number;
  readonly revocationDigest: string;
}

/** A proposal that depends on a certification (LOCAL structural seam). */
export interface CertificationDependent {
  readonly proposalId: string;
  readonly tenantId: string;
  readonly certificationId: string;
}

/** A dependent proposal blocked by a revocation. */
export interface BlockedDependent {
  readonly proposalId: string;
  readonly status: "blocked";
  readonly reason: "certification-revoked";
  readonly revocationDigest: string;
}

export type MintResult =
  | { readonly ok: true; readonly certification: CertificationRef }
  | { readonly ok: false; readonly degraded: ArenaDegradedState; readonly reason: string };

export type RevokeResult =
  | { readonly ok: true; readonly revocation: CertificationRevocation }
  | { readonly ok: false; readonly degraded: ArenaDegradedState; readonly reason: string };

export type PropagateResult =
  | { readonly ok: true; readonly blocked: readonly BlockedDependent[] }
  | { readonly ok: false; readonly degraded: ArenaDegradedState; readonly reason: string };

/** Per-tenant genesis digest — the chain anchor. */
export function certificationGenesisDigest(tenantId: string): string {
  return fnv1a(`cert-genesis|${tenantId}`);
}

function certificationDigest(c: Omit<CertificationRef, "certificationId" | "digest">): string {
  return fnv1a(
    `cert|v1|${c.tenantId}|${c.capability.capabilityId}@${c.capability.version}|${c.issuedBy}|${c.issuedAtMs}` +
      `|${c.validUntilMs}|${c.evidenceRef}|${c.runId}|${c.proposalId}|${c.prevDigest}`,
  );
}

/**
 * Mint a certification reference from an accepted evaluation.
 *
 * Fail-closed (honest degraded states, the extended vocabulary):
 *   - missing-tenant / tenant_mismatch: empty tenant or run tenant mismatch;
 *   - run_not_scored: the run is not reported, or carries no scored proposal;
 *   - insufficient_evidence: the scored proposal is below the `high` tier —
 *     only accepted evaluations mint certifications;
 *   - invalid validity window (validUntilMs <= issuedAtMs) and empty
 *     issuer/evidence refs are rejected.
 */
export function mintCertification(input: {
  readonly tenant: TenantScopeLike;
  readonly run: EvaluationRun;
  readonly scored: ScoredProposal;
  readonly issuedBy: string;
  readonly issuedAtMs: number;
  readonly validUntilMs: number;
  readonly evidenceRef: string;
  readonly previous?: CertificationRef;
}): MintResult {
  const tenantId = input.tenant.tenantId;
  if (tenantId === "") {
    return { ok: false, degraded: "tenant_mismatch", reason: "tenant identifier is empty" };
  }
  if (input.run.manifest.tenantId !== tenantId || input.scored.tenantId !== tenantId) {
    return {
      ok: false,
      degraded: "tenant_mismatch",
      reason: `run/scored-proposal tenant does not match the minting tenant "${tenantId}"`,
    };
  }
  if (input.run.status !== "reported") {
    return { ok: false, degraded: "run_not_scored", reason: `run status is "${input.run.status}" — only reported runs can certify` };
  }
  if (input.run.proposal === null) {
    return { ok: false, degraded: "run_not_scored", reason: "run carries no result proposal" };
  }
  if (input.scored.runId !== input.run.manifest.runId) {
    return { ok: false, degraded: "run_not_scored", reason: "scored proposal belongs to a different run" };
  }
  if (input.scored.confidence !== "high") {
    return {
      ok: false,
      degraded: "insufficient_evidence",
      reason: `scored proposal tier is "${input.scored.confidence}" — certifications require "high"`,
    };
  }
  if (input.issuedBy === "" || input.evidenceRef === "") {
    return { ok: false, degraded: "insufficient_evidence", reason: "issuer and evidence reference must be non-empty" };
  }
  if (!Number.isInteger(input.issuedAtMs) || input.issuedAtMs < 0 || !Number.isInteger(input.validUntilMs)) {
    return { ok: false, degraded: "insufficient_evidence", reason: "certification times must be integer logical ms" };
  }
  if (input.validUntilMs <= input.issuedAtMs) {
    return { ok: false, degraded: "insufficient_evidence", reason: "validUntilMs must be strictly after issuedAtMs" };
  }
  if (input.previous && input.previous.tenantId !== tenantId) {
    return {
      ok: false,
      degraded: "tenant_mismatch",
      reason: `previous certification belongs to tenant "${input.previous.tenantId}"`,
    };
  }
  const prevDigest = input.previous ? input.previous.digest : certificationGenesisDigest(tenantId);
  const base = {
    kind: "ARENA_CERTIFICATION" as const,
    tenantId,
    capability: input.run.manifest.capability,
    issuedBy: input.issuedBy,
    issuedAtMs: input.issuedAtMs,
    validUntilMs: input.validUntilMs,
    evidenceRef: input.evidenceRef,
    runId: input.run.manifest.runId,
    proposalId: input.scored.proposalId,
    prevDigest,
  };
  const digest = certificationDigest(base);
  return {
    ok: true,
    certification: {
      ...base,
      certificationId: `cert-${base.capability.capabilityId}-${base.capability.version}-${tenantId}-${digest}`,
      digest,
    },
  };
}

/** Revoke a certification — a separate immutable record, with a reason. */
export function revokeCertification(
  certification: CertificationRef,
  input: { readonly reason: CertificationRevocationReason; readonly revokedBy: string; readonly revokedAtMs: number },
): RevokeResult {
  if (input.revokedBy === "") {
    return { ok: false, degraded: "certification_revoked", reason: "revoker identity must be non-empty" };
  }
  if (!Number.isInteger(input.revokedAtMs) || input.revokedAtMs < 0) {
    return { ok: false, degraded: "certification_revoked", reason: "revokedAtMs must be an integer >= 0 (logical ms)" };
  }
  if (input.revokedAtMs < certification.issuedAtMs) {
    return { ok: false, degraded: "certification_revoked", reason: "revocation cannot precede issuance (logical time)" };
  }
  return {
    ok: true,
    revocation: {
      kind: "ARENA_CERTIFICATION_REVOCATION",
      certificationId: certification.certificationId,
      tenantId: certification.tenantId,
      reason: input.reason,
      revokedBy: input.revokedBy,
      revokedAtMs: input.revokedAtMs,
      revocationDigest: fnv1a(`cert-revoke|v1|${certification.digest}|${input.reason}|${input.revokedBy}|${input.revokedAtMs}`),
    },
  };
}

/**
 * Propagate a revocation to dependent proposals: each dependent citing the
 * revoked certification is returned BLOCKED (status marker + reason +
 * revocation digest) — never auto-executed, never deleted. Fail-closed on
 * tenant: an empty revocation tenant or a dependent from another tenant
 * rejects the whole propagation (offender named).
 */
export function propagateRevocation(
  revocation: CertificationRevocation,
  dependents: readonly CertificationDependent[],
): PropagateResult {
  if (revocation.tenantId === "") {
    return { ok: false, degraded: "certification_revoked", reason: "revocation carries no tenant" };
  }
  for (const d of dependents) {
    if (d.tenantId !== revocation.tenantId) {
      return {
        ok: false,
        degraded: "certification_revoked",
        reason: `dependent "${d.proposalId}" belongs to tenant "${d.tenantId}" (revocation tenant "${revocation.tenantId}")`,
      };
    }
    if (d.proposalId === "" || d.certificationId === "") {
      return { ok: false, degraded: "certification_revoked", reason: "dependents must carry non-empty ids" };
    }
  }
  const blocked = dependents
    .filter((d) => d.certificationId === revocation.certificationId)
    .map((d) => ({
      proposalId: d.proposalId,
      status: "blocked" as const,
      reason: "certification-revoked" as const,
      revocationDigest: revocation.revocationDigest,
    }));
  return { ok: true, blocked };
}

/**
 * Verify a certification CHAIN (audit): each record's digest recomputes, each
 * prevDigest links to its predecessor, and the first anchors on the
 * per-tenant genesis. Tampering with any field breaks the chain.
 */
export function verifyCertificationChain(
  chain: readonly CertificationRef[],
  tenant: TenantScopeLike,
): { readonly ok: boolean; readonly reason: string } {
  if (tenant.tenantId === "") {
    return { ok: false, reason: "tenant identifier is empty" };
  }
  let prev = certificationGenesisDigest(tenant.tenantId);
  for (const c of chain) {
    if (c.tenantId !== tenant.tenantId) {
      return { ok: false, reason: `certification ${c.certificationId} belongs to tenant "${c.tenantId}"` };
    }
    if (c.prevDigest !== prev) {
      return { ok: false, reason: `certification ${c.certificationId} breaks the chain (prevDigest mismatch)` };
    }
    const { certificationId: _ignored, digest, ...rest } = c;
    void _ignored;
    if (certificationDigest(rest) !== digest) {
      return { ok: false, reason: `certification ${c.certificationId} digest does not recompute (tampered)` };
    }
    prev = digest;
  }
  return { ok: true, reason: "chain verified" };
}
