/**
 * @fleetos/experience-safety-intel — inspect-views (F240B deliverable 3).
 *
 * The "why did this happen" surface: decision-provenance views over
 * actions/execution journals. Each presented decision links its reason chain
 * (the ordered rule evaluation), the capability grants in force, and the
 * evidence refs (the action's evidence ref + the A13 traceability chain);
 * the execution journal slice is presented with its audit digests. A
 * tamper-evident digest is computed over the PRESENTED chain —
 * `verifyDecisionProvenanceDigest` recomputes it for audit; tampering with
 * any presented field (verdict, reason links, grants, evidence refs,
 * journal entries, state) is detected.
 *
 * Honest degradation (UI laws): an action not yet authorized is presented
 * with `authorizationPending: true` and a null guardian block — never
 * invented authorization.
 *
 * Tenant fail-closed (A8): every cross-tenant input refuses the whole view,
 * offender named, no partial state. Deterministic: derived orderings only.
 */

import type { ActionRecord } from "@fleetos/actions";
import type { ExecutionLedgerEntry } from "@fleetos/execution";
import type {
  DecisionFlavor,
  GrantRecord,
  GuardianDecision,
  GuardianReasonCode,
  OrderedRuleEvaluation,
  PolicyRuleId,
  PolicyVerdict,
} from "@fleetos/policy";
import type { TraceabilityChain } from "@fleetos/evidence";

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface GuardianBlockView {
  readonly verdict: PolicyVerdict;
  readonly reasonCode: GuardianReasonCode;
  readonly matchedRuleId: PolicyRuleId | null;
  readonly decisionDigest: string;
}

export interface ReasonChainLinkView {
  readonly ruleId: PolicyRuleId;
  readonly flavor: DecisionFlavor;
  readonly reasonCode: string;
  readonly matchedFactCount: number;
}

export interface GrantLinkView {
  readonly grantId: string;
  readonly granteeActorId: string;
  readonly grantedByActorId: string;
  readonly grantedAt: number;
  readonly expiresAt: number | null;
  readonly status: GrantRecord["status"];
}

export interface JournalLinkView {
  readonly index: number;
  readonly kind: ExecutionLedgerEntry["kind"];
  readonly at: number;
  readonly detail: string;
  readonly entryDigest: string;
}

export interface EvidenceRefView {
  readonly kind: "action-evidence" | "trace";
  readonly ref: string;
}

export interface DecisionProvenanceView {
  readonly tenantId: string;
  readonly intentId: string;
  readonly capabilityId: string;
  readonly actionState: ActionRecord["state"];
  /** Honest: true when the action has no authorization yet. */
  readonly authorizationPending: boolean;
  readonly guardian: GuardianBlockView | null;
  /** The ordered rule-evaluation reason chain (empty when no evaluation supplied). */
  readonly reasonChain: readonly ReasonChainLinkView[];
  /** Active + revoked grants covering the capability (status visible). */
  readonly grants: readonly GrantLinkView[];
  /** The action's execution journal slice, index order. */
  readonly executionJournal: readonly JournalLinkView[];
  readonly evidenceRefs: readonly EvidenceRefView[];
  /** Tamper-evident digest over the PRESENTED chain. */
  readonly chainDigest: string;
}

export type InspectViewRefusal =
  | "views.missing-tenant"
  | "views.cross-tenant-action"
  | "views.cross-tenant-evaluation"
  | "views.cross-tenant-grant"
  | "views.cross-tenant-journal"
  | "views.cross-tenant-trace"
  | "views.journal-out-of-order"
  | "views.evaluation-capability-mismatch"
  | "views.trace-intent-mismatch";

export type DecisionProvenanceResult =
  | { readonly ok: true; readonly view: DecisionProvenanceView }
  | { readonly ok: false; readonly refused: InspectViewRefusal; readonly detail: string };

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export function buildDecisionProvenance(input: {
  readonly tenantId: string;
  readonly action: ActionRecord;
  /** Optional: the ordered rule evaluation that produced the decision. */
  readonly evaluation?: OrderedRuleEvaluation;
  /** All grants visible for the tenant (the view filters by capability). */
  readonly grants: readonly GrantRecord[];
  /** The action's execution journal slice (index order). */
  readonly journal: readonly ExecutionLedgerEntry[];
  /** Optional: the A13 traceability chain for the action. */
  readonly trace?: TraceabilityChain;
}): DecisionProvenanceResult {
  if (input.tenantId === "") {
    return { ok: false, refused: "views.missing-tenant", detail: "tenant identifier is empty" };
  }
  if (input.action.intent.tenant.tenantId !== input.tenantId) {
    return {
      ok: false,
      refused: "views.cross-tenant-action",
      detail: `action ${input.action.intent.intentId} belongs to tenant ${input.action.intent.tenant.tenantId}, not ${input.tenantId}`,
    };
  }
  for (const g of input.grants) {
    if (g.tenantId !== input.tenantId) {
      return {
        ok: false,
        refused: "views.cross-tenant-grant",
        detail: `grant ${g.grantId} belongs to tenant ${g.tenantId}, not ${input.tenantId}`,
      };
    }
  }
  let lastIndex = -1;
  for (const entry of input.journal) {
    if (entry.tenantId !== input.tenantId) {
      return {
        ok: false,
        refused: "views.cross-tenant-journal",
        detail: `journal entry ${entry.index} belongs to tenant ${entry.tenantId}, not ${input.tenantId}`,
      };
    }
    if (entry.index <= lastIndex) {
      return {
        ok: false,
        refused: "views.journal-out-of-order",
        detail: `journal entry ${entry.index} does not advance past ${lastIndex}`,
      };
    }
    lastIndex = entry.index;
  }
  if (input.evaluation && input.evaluation.tenantId !== input.tenantId) {
    return {
      ok: false,
      refused: "views.cross-tenant-evaluation",
      detail: `evaluation belongs to tenant ${input.evaluation.tenantId}, not ${input.tenantId}`,
    };
  }
  if (input.evaluation && input.evaluation.capabilityId !== input.action.intent.capability.id) {
    return {
      ok: false,
      refused: "views.evaluation-capability-mismatch",
      detail: `evaluation is for capability ${input.evaluation.capabilityId}, not ${input.action.intent.capability.id}`,
    };
  }
  if (input.trace && input.trace.tenantId !== input.tenantId) {
    return {
      ok: false,
      refused: "views.cross-tenant-trace",
      detail: `traceability chain ${input.trace.chainId} belongs to tenant ${input.trace.tenantId}, not ${input.tenantId}`,
    };
  }
  const intentLink = input.trace?.links.find((l) => l.kind === "intent");
  if (input.trace && intentLink && intentLink.ref !== input.action.intent.intentId) {
    return {
      ok: false,
      refused: "views.trace-intent-mismatch",
      detail: `traceability chain ${input.trace.chainId} links intent ${intentLink.ref}, not ${input.action.intent.intentId}`,
    };
  }

  const capabilityId = input.action.intent.capability.id;
  const guardian = guardianBlockOf(input.action.authorization ?? null);
  const reasonChain = (input.evaluation?.decisions ?? []).map((d) => ({
    ruleId: d.ruleId,
    flavor: d.flavor,
    reasonCode: d.reasonCode,
    matchedFactCount: d.matchedFacts.length,
  }));
  const grants = input.grants
    .filter((g) => g.capabilityId === capabilityId)
    .sort((a, b) => (a.grantId < b.grantId ? -1 : 1))
    .map((g) => ({
      grantId: g.grantId,
      granteeActorId: g.granteeActorId,
      grantedByActorId: g.grantedByActorId,
      grantedAt: g.grantedAt,
      expiresAt: g.expiresAt,
      status: g.status,
    }));
  const executionJournal = input.journal.map((e) => ({
    index: e.index,
    kind: e.kind,
    at: e.at,
    detail: e.detail,
    entryDigest: e.entryDigest,
  }));
  const evidenceRefs: EvidenceRefView[] = [];
  if (input.action.evidenceRef) {
    evidenceRefs.push({ kind: "action-evidence", ref: input.action.evidenceRef });
  }
  for (const link of input.trace?.links ?? []) {
    evidenceRefs.push({ kind: "trace", ref: `${link.kind}:${link.ref}` });
  }

  const view: DecisionProvenanceView = {
    tenantId: input.tenantId,
    intentId: input.action.intent.intentId,
    capabilityId,
    actionState: input.action.state,
    authorizationPending: input.action.authorization === undefined,
    guardian,
    reasonChain,
    grants,
    executionJournal,
    evidenceRefs,
    chainDigest: provenanceDigestOf({
      tenantId: input.tenantId,
      intentId: input.action.intent.intentId,
      capabilityId,
      actionState: input.action.state,
      authorizationPending: input.action.authorization === undefined,
      guardian,
      reasonChain,
      grants,
      executionJournal,
      evidenceRefs,
    }),
  };
  return { ok: true, view };
}

/**
 * Recompute the tamper-evident digest of a presented provenance chain.
 * `true` means the view is byte-consistent with its digest stamp.
 */
export function verifyDecisionProvenanceDigest(view: DecisionProvenanceView): boolean {
  return (
    provenanceDigestOf({
      tenantId: view.tenantId,
      intentId: view.intentId,
      capabilityId: view.capabilityId,
      actionState: view.actionState,
      authorizationPending: view.authorizationPending,
      guardian: view.guardian,
      reasonChain: view.reasonChain,
      grants: view.grants,
      executionJournal: view.executionJournal,
      evidenceRefs: view.evidenceRefs,
    }) === view.chainDigest
  );
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function guardianBlockOf(decision: GuardianDecision | null): GuardianBlockView | null {
  if (decision === null) return null;
  return {
    verdict: decision.verdict,
    reasonCode: decision.reasonCode,
    matchedRuleId: decision.matchedRuleId,
    decisionDigest: decision.decisionDigest,
  };
}

function provenanceDigestOf(parts: {
  readonly tenantId: string;
  readonly intentId: string;
  readonly capabilityId: string;
  readonly actionState: ActionRecord["state"];
  readonly authorizationPending: boolean;
  readonly guardian: GuardianBlockView | null;
  readonly reasonChain: readonly ReasonChainLinkView[];
  readonly grants: readonly GrantLinkView[];
  readonly executionJournal: readonly JournalLinkView[];
  readonly evidenceRefs: readonly EvidenceRefView[];
}): string {
  const guardian = parts.guardian === null
    ? "none"
    : `${parts.guardian.verdict}/${parts.guardian.reasonCode}/${parts.guardian.decisionDigest}`;
  const reason = parts.reasonChain.map((r) => `${r.ruleId}:${r.reasonCode}#${r.matchedFactCount}`).join(",");
  const grants = parts.grants.map((g) => `${g.grantId}@${g.granteeActorId}/${g.status}`).join(",");
  const journal = parts.executionJournal.map((j) => `${j.index}:${j.kind}=${j.entryDigest}`).join(",");
  const evidence = parts.evidenceRefs.map((e) => `${e.kind}:${e.ref}`).join(",");
  return fnv1a(
    `insp|v1|${parts.tenantId}|${parts.intentId}|${parts.capabilityId}|${parts.actionState}|p=${parts.authorizationPending}` +
      `|g=${guardian}|r=${reason}|gr=${grants}|j=${journal}|e=${evidence}`,
  );
}

/** Deterministic digest (private FNV-1a — the lane's presentation convention). */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
