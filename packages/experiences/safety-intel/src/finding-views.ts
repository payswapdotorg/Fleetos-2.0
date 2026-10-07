/**
 * @fleetos/experience-safety-intel — finding-views (F240B deliverable 1).
 *
 * Security findings intake views: severity rollups, triage queues, and
 * remediation progress GATED BY EVIDENCE STATE — remediation is presented as
 * evidence-gated, never auto-done. A domain record that claims a state its
 * evidence does not support is presented as `evidence-inconsistent`, never
 * as verified.
 *
 * Tenant fail-closed (A8): a missing tenant scope or any finding/proposal
 * from another tenant refuses the WHOLE view (no partial state, the offender
 * named in the detail).
 *
 * Determinism: same inputs => byte-identical views including digests; input
 * order is irrelevant (triage order, top kinds and remediation order are all
 * derived orderings, never input order).
 */

import type {
  FindingConfidence,
  FindingKind,
  RemediationProposalRecord,
  SecurityFinding,
  SecuritySeverity,
} from "@fleetos/security";

// ---------------------------------------------------------------------------
// Presentation ordering (local — ordering, not domain triage)
// ---------------------------------------------------------------------------

const SEVERITY_ORDER: readonly SecuritySeverity[] = ["critical", "high", "medium", "low", "info"];
const CONFIDENCE_ORDER: readonly FindingConfidence[] = ["confirmed", "probable", "tentative"];

function severityRank(sev: SecuritySeverity): number {
  return SEVERITY_ORDER.indexOf(sev);
}

function confidenceRank(c: FindingConfidence): number {
  return CONFIDENCE_ORDER.indexOf(c);
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface SeverityRollupView {
  readonly tenantId: string;
  readonly totalFindings: number;
  readonly bySeverity: Readonly<Record<SecuritySeverity, number>>;
  readonly byConfidence: Readonly<Record<FindingConfidence, number>>;
  /** Most frequent finding kinds: count desc, then kind asc. Top 5. */
  readonly topKinds: readonly { readonly kind: FindingKind; readonly count: number }[];
  readonly digest: string;
}

export interface FindingQueueItemView {
  readonly queueRank: number;
  readonly findingId: string;
  readonly kind: FindingKind;
  readonly severity: SecuritySeverity;
  readonly confidence: FindingConfidence;
  readonly evidenceRefCount: number;
  readonly assetCount: number;
  readonly detectedAt: string;
}

export interface TriageQueueView {
  readonly tenantId: string;
  /** Ordered: severity desc, then confidence desc, then findingId asc. */
  readonly items: readonly FindingQueueItemView[];
  readonly digest: string;
}

/** Remediation progress stage — the evidence-gated presentation. */
export type RemediationProgressStage =
  | "evidence-inconsistent"
  | "proposed-awaiting-approval"
  | "approved-awaiting-verification-evidence"
  | "applied-awaiting-verification-outcome"
  | "applied-verification-failed"
  | "verified";

export interface RemediationEvidenceGateView {
  readonly gate: "approval-evidence" | "verification-evidence" | "verification-outcome";
  readonly satisfied: boolean;
  readonly evidenceRef: string | null;
}

export interface RemediationProgressView {
  readonly proposalId: string;
  readonly remediationKind: RemediationProposalRecord["remediationKind"];
  readonly findingCount: number;
  readonly lifecycleState: RemediationProposalRecord["state"];
  readonly gates: readonly RemediationEvidenceGateView[];
  readonly stage: RemediationProgressStage;
  /** True ONLY when the domain record itself is evidence-complete. */
  readonly remediated: boolean;
}

export interface RemediationSummaryView {
  readonly tenantId: string;
  readonly totalProposals: number;
  readonly remediatedCount: number;
  readonly inconsistentCount: number;
  readonly byStage: Readonly<Record<RemediationProgressStage, number>>;
  /** Ordered by proposalId asc. */
  readonly proposals: readonly RemediationProgressView[];
  readonly digest: string;
}

export interface FindingViews {
  readonly rollup: SeverityRollupView;
  readonly triageQueue: TriageQueueView;
  readonly remediation: RemediationSummaryView;
}

export type FindingViewRefusal =
  | "views.missing-tenant"
  | "views.cross-tenant-finding"
  | "views.cross-tenant-proposal"
  | "views.duplicate-finding-id"
  | "views.duplicate-proposal-id";

export type FindingViewsResult =
  | { readonly ok: true; readonly views: FindingViews }
  | { readonly ok: false; readonly refused: FindingViewRefusal; readonly detail: string };

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export function buildFindingViews(input: {
  readonly tenantId: string;
  readonly findings: readonly SecurityFinding[];
  readonly remediations: readonly RemediationProposalRecord[];
}): FindingViewsResult {
  const tenantId = input.tenantId;
  if (tenantId === "") {
    return { ok: false, refused: "views.missing-tenant", detail: "tenant identifier is empty" };
  }
  const seenFindings = new Set<string>();
  for (const f of input.findings) {
    if (f.tenantId !== tenantId) {
      return {
        ok: false,
        refused: "views.cross-tenant-finding",
        detail: `finding ${f.findingId} belongs to tenant ${f.tenantId}, not ${tenantId}`,
      };
    }
    if (seenFindings.has(f.findingId)) {
      return { ok: false, refused: "views.duplicate-finding-id", detail: `finding ${f.findingId} appears twice` };
    }
    seenFindings.add(f.findingId);
  }
  const seenProposals = new Set<string>();
  for (const r of input.remediations) {
    if (r.tenantId !== tenantId) {
      return {
        ok: false,
        refused: "views.cross-tenant-proposal",
        detail: `remediation proposal ${r.proposalId} belongs to tenant ${r.tenantId}, not ${tenantId}`,
      };
    }
    if (seenProposals.has(r.proposalId)) {
      return { ok: false, refused: "views.duplicate-proposal-id", detail: `proposal ${r.proposalId} appears twice` };
    }
    seenProposals.add(r.proposalId);
  }

  const rollup = rollupOf(tenantId, input.findings);
  const triageQueue = triageQueueOf(tenantId, input.findings);
  const remediation = remediationSummaryOf(tenantId, input.remediations);
  return { ok: true, views: { rollup, triageQueue, remediation } };
}

// ---------------------------------------------------------------------------
// Sub-builders (private)
// ---------------------------------------------------------------------------

function rollupOf(tenantId: string, findings: readonly SecurityFinding[]): SeverityRollupView {
  const bySeverity: Record<SecuritySeverity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  const byConfidence: Record<FindingConfidence, number> = { tentative: 0, probable: 0, confirmed: 0 };
  const kindCounts = new Map<FindingKind, number>();
  for (const f of findings) {
    bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
    byConfidence[f.confidence] = (byConfidence[f.confidence] ?? 0) + 1;
    kindCounts.set(f.kind, (kindCounts.get(f.kind) ?? 0) + 1);
  }
  const topKinds = [...kindCounts.entries()]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => (a.count !== b.count ? b.count - a.count : a.kind < b.kind ? -1 : 1))
    .slice(0, 5);
  const digest = fnv1a(
    `fv|v1|${tenantId}|t=${findings.length}|s=${SEVERITY_ORDER.map((s) => bySeverity[s]).join(",")}` +
      `|c=${CONFIDENCE_ORDER.map((c) => byConfidence[c]).join(",")}` +
      `|k=${topKinds.map((t) => `${t.kind}:${t.count}`).join(",")}`,
  );
  return { tenantId, totalFindings: findings.length, bySeverity, byConfidence, topKinds, digest };
}

function triageQueueOf(tenantId: string, findings: readonly SecurityFinding[]): TriageQueueView {
  const ordered = [...findings].sort((a, b) => {
    // Lower rank = more severe / more confident (rank 0 = critical/confirmed).
    const bySeverity = severityRank(a.severity) - severityRank(b.severity);
    if (bySeverity !== 0) return bySeverity;
    const byConfidence = confidenceRank(a.confidence) - confidenceRank(b.confidence);
    if (byConfidence !== 0) return byConfidence;
    return a.findingId < b.findingId ? -1 : 1;
  });
  const items: FindingQueueItemView[] = ordered.map((f, idx) => ({
    queueRank: idx + 1,
    findingId: f.findingId,
    kind: f.kind,
    severity: f.severity,
    confidence: f.confidence,
    evidenceRefCount: f.evidenceRefs.length,
    assetCount: f.assetIds.length,
    detectedAt: f.detectedAt,
  }));
  const digest = fnv1a(
    `fq|v1|${tenantId}|${items.map((i) => `${i.findingId}@${i.severity}/${i.confidence}`).join(",")}`,
  );
  return { tenantId, items, digest };
}

function remediationSummaryOf(tenantId: string, records: readonly RemediationProposalRecord[]): RemediationSummaryView {
  const proposals = [...records]
    .sort((a, b) => (a.proposalId < b.proposalId ? -1 : 1))
    .map(remediationProgressOf);
  const byStage: Record<RemediationProgressStage, number> = {
    "evidence-inconsistent": 0,
    "proposed-awaiting-approval": 0,
    "approved-awaiting-verification-evidence": 0,
    "applied-awaiting-verification-outcome": 0,
    "applied-verification-failed": 0,
    "verified": 0,
  };
  for (const p of proposals) byStage[p.stage] = (byStage[p.stage] ?? 0) + 1;
  const digest = fnv1a(
    `fr|v1|${tenantId}|${proposals.map((p) => `${p.proposalId}:${p.stage}${p.remediated ? "*" : ""}`).join(",")}`,
  );
  return {
    tenantId,
    totalProposals: proposals.length,
    remediatedCount: proposals.filter((p) => p.remediated).length,
    inconsistentCount: byStage["evidence-inconsistent"],
    byStage,
    proposals,
    digest,
  };
}

/** The evidence-gated presentation of ONE remediation record. */
function remediationProgressOf(r: RemediationProposalRecord): RemediationProgressView {
  const gates: RemediationEvidenceGateView[] = [
    {
      gate: "approval-evidence",
      satisfied: r.approvalRef !== null,
      evidenceRef: r.approvalRef,
    },
    {
      gate: "verification-evidence",
      satisfied: r.verificationEvidenceRef !== null,
      evidenceRef: r.verificationEvidenceRef,
    },
    {
      gate: "verification-outcome",
      satisfied: r.verificationOutcome !== null && r.verificationOutcome.verified,
      evidenceRef: r.verificationOutcome?.evidenceRef ?? null,
    },
  ];
  // Evidence-gated law: remediation is NEVER presented as done on the
  // domain record's word alone — the stage follows the EVIDENCE.
  const consistent = evidenceConsistentWith(r);
  const stage: RemediationProgressStage = !consistent
    ? "evidence-inconsistent"
    : r.state === "proposed"
      ? "proposed-awaiting-approval"
      : r.state === "approved"
        ? "approved-awaiting-verification-evidence"
        : r.state === "applied"
          ? r.verificationOutcome !== null && !r.verificationOutcome.verified
            ? "applied-verification-failed"
            : "applied-awaiting-verification-outcome"
          : "verified";
  return {
    proposalId: r.proposalId,
    remediationKind: r.remediationKind,
    findingCount: r.findingIds.length,
    lifecycleState: r.state,
    gates,
    stage,
    remediated: consistent && r.state === "verified" && r.verificationOutcome !== null && r.verificationOutcome.verified,
  };
}

/** A domain state that exceeds its evidence is inconsistent — never auto-done. */
function evidenceConsistentWith(r: RemediationProposalRecord): boolean {
  if (r.state === "approved" && r.approvalRef === null) return false;
  if (r.state === "applied" && r.verificationEvidenceRef === null) return false;
  if (r.state === "verified" && (r.verificationOutcome === null || !r.verificationOutcome.verified)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Deterministic digest (private FNV-1a — the lane's presentation convention)
// ---------------------------------------------------------------------------

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
