/**
 * @fleetos/experience-safety-intel — host view models (F300B deliverable 1).
 *
 * `buildViewModels(slice, ctx)` — the HostSurface's pure, deterministic
 * projection of the lane's REAL read-models into the 7 F300B route views.
 * COMPOSITION LAW: the slice is composed by the TL app from the real domain
 * state (the acceptance-suite composition pattern); this adapter never
 * caches, never derives new business truth, and embeds no store (WAVE10
 * contract §2 — "no second business-truth store").
 *
 * Route order is the manifest order (deterministic): findings-board →
 * evidence-chain → guardian-decision → action-authorization →
 * execution-results → inspect-why → advisory-board. The FIRST refusal wins
 * and refuses the WHOLE view (tenant fail-closed, A8 — no partial state;
 * the offending route + code + detail are surfaced verbatim).
 *
 * HONEST NOT-COMPOSED sections: optional slices (plan/lifecycle/queue,
 * action/evaluation/trace) that the TL app did not compose render explicit
 * `composed: false` markers — never fabricated views. `ctx.scope` is carried
 * VERBATIM on the view models (record-level self-scope filtering is the
 * identity domain's read-side concern — the lane's read-models carry no
 * per-record ownership fields; documented residual, TL proposal S-2).
 *
 * Determinism: same slice + ctx ⇒ byte-identical views (machine-tested —
 * JSON.stringify equality + stable `viewModelsDigest`).
 */

import { buildFindingViews } from "../finding-views.ts";
import type { FindingViews } from "../finding-views.ts";
import {
  buildActionPlanBoard,
  buildCapabilityCeilingBoard,
  buildRuleCatalog,
} from "../guardian-views.ts";
import type {
  ActionPlanBoardView,
  CapabilityCeilingBoardView,
  RuleCatalogView,
} from "../guardian-views.ts";
import { buildDecisionProvenance } from "../inspect-views.ts";
import type { DecisionProvenanceView } from "../inspect-views.ts";
import { buildEvidenceChainRouteView } from "./evidence-view.ts";
import type { EvidenceChainRouteView } from "./evidence-view.ts";
import { buildExecutionResultsRouteView } from "./execution-view.ts";
import type { ExecutionResultsRouteView } from "./execution-view.ts";
import { buildAdvisoryBoardRouteView } from "./advisory-route.ts";
import type {
  AdvisoryBoardRouteView,
  AdvisoryRouteNotComposed,
} from "./advisory-route.ts";
import type { HostRouteId, HostTenantContext } from "./contract.ts";
import type {
  ActionAuditEvent,
  ActionPlan,
  ActionRecord,
  PlanLifecycleRecord,
} from "@fleetos/actions";
import type {
  CommandQueueState,
  ExecutionLedgerEntry,
} from "@fleetos/execution";
import type {
  EvidenceChainEntry,
  EvidenceMetadata,
  TraceabilityChain,
} from "@fleetos/evidence";
import type {
  AuthorityKind,
  Capability,
  GrantRecord,
  OrderedRuleEvaluation,
  Policy,
} from "@fleetos/policy";
import type { Prediction } from "@fleetos/predictive";
import type { RemediationProposalRecord, SecurityFinding } from "@fleetos/security";
import type { AssembledContext } from "@fleetos/world-context";
import type { StalenessThresholds } from "@fleetos/world-model";

// ---------------------------------------------------------------------------
// The slice — the lane's REAL read-models (TL-composed, caller-supplied)
// ---------------------------------------------------------------------------

export interface SafetyIntelSlice {
  /** Logical now (epoch ms) — staleness/ceiling evaluation anchor. */
  readonly nowMs: number;
  readonly stalenessThresholds: StalenessThresholds;

  // findings-board
  readonly findings: readonly SecurityFinding[];
  readonly remediations: readonly RemediationProposalRecord[];

  // guardian-decision
  readonly policy: Policy;
  readonly capabilities: readonly Capability[];
  readonly grants: readonly GrantRecord[];
  /** The acting principal's held authority kinds (identity read-side). */
  readonly actorAuthority: readonly AuthorityKind[];

  // action-authorization (optional — honest not-composed marker when absent)
  readonly plan?: ActionPlan;
  readonly lifecycle?: PlanLifecycleRecord;
  readonly queue?: CommandQueueState;

  // execution-results
  readonly ledger: readonly ExecutionLedgerEntry[];
  readonly actionAuditEvents?: readonly ActionAuditEvent[];

  // inspect-why (optional)
  readonly action?: ActionRecord;
  readonly evaluation?: OrderedRuleEvaluation;
  readonly trace?: TraceabilityChain;

  // evidence-chain
  readonly evidenceChain: readonly EvidenceChainEntry[];
  readonly evidenceRecords: readonly EvidenceMetadata[];
  readonly evidenceTrace?: TraceabilityChain;

  // advisory-board
  readonly predictions: readonly Prediction[];
  readonly worldContexts: readonly AssembledContext[];
}

// ---------------------------------------------------------------------------
// The view models
// ---------------------------------------------------------------------------

export interface GuardianDecisionRouteView {
  readonly ruleCatalog: RuleCatalogView;
  readonly ceilingBoard: CapabilityCeilingBoardView;
}

export type ActionAuthorizationRouteView =
  | { readonly composed: true; readonly planBoard: ActionPlanBoardView }
  | { readonly composed: false; readonly reason: "plan-not-composed" };

export type InspectWhyRouteView =
  | { readonly composed: true; readonly provenance: DecisionProvenanceView }
  | { readonly composed: false; readonly reason: "action-not-composed" };

export interface SafetyIntelHostViewModels {
  readonly tenantId: string;
  /** Carried verbatim from the host context (see module header — residual S-2). */
  readonly scope: HostTenantContext["scope"];
  readonly routes: {
    readonly "findings-board": FindingViews;
    readonly "evidence-chain": EvidenceChainRouteView;
    readonly "guardian-decision": GuardianDecisionRouteView;
    readonly "action-authorization": ActionAuthorizationRouteView;
    readonly "execution-results": ExecutionResultsRouteView;
    readonly "inspect-why": InspectWhyRouteView;
    readonly "advisory-board": AdvisoryBoardRouteView | AdvisoryRouteNotComposed;
  };
  /** FNV-1a over the per-route digests — the byte-determinism proof. */
  readonly viewModelsDigest: string;
}

export interface SafetyIntelHostRefusalDetail {
  /** The route whose builder refused ("host" for context-level validation). */
  readonly route: HostRouteId | "host";
  /** The underlying refusal code, surfaced VERBATIM. */
  readonly code: string;
  readonly detail: string;
}

export type SafetyIntelHostResult =
  | { readonly ok: true; readonly views: SafetyIntelHostViewModels }
  | { readonly ok: false; readonly refused: SafetyIntelHostRefusalDetail };

// ---------------------------------------------------------------------------
// The builder — pure, deterministic, tenant fail-closed
// ---------------------------------------------------------------------------

export function buildViewModels(
  slice: SafetyIntelSlice,
  ctx: HostTenantContext,
): SafetyIntelHostResult {
  if (ctx.tenantId === "") {
    return { ok: false, refused: { route: "host", code: "host.missing-tenant", detail: "tenant identifier is empty" } };
  }
  if (ctx.actorId === "" || ctx.sessionId === "") {
    return { ok: false, refused: { route: "host", code: "host.invalid-context", detail: "actorId and sessionId must be non-empty" } };
  }
  if (!Number.isInteger(ctx.establishedAt) || ctx.establishedAt <= 0) {
    return { ok: false, refused: { route: "host", code: "host.invalid-context", detail: `establishedAt ${ctx.establishedAt} is not a positive integer` } };
  }

  // --- findings-board (REAL builder; refuses cross-tenant itself) ---
  const findings = buildFindingViews({
    tenantId: ctx.tenantId,
    findings: slice.findings,
    remediations: slice.remediations,
  });
  if (!findings.ok) {
    return { ok: false, refused: { route: "findings-board", code: findings.refused, detail: findings.detail } };
  }

  // --- evidence-chain (REAL verification outcome, verbatim) ---
  const evidence = buildEvidenceChainRouteView({
    tenantId: ctx.tenantId,
    chain: slice.evidenceChain,
    records: slice.evidenceRecords,
    trace: slice.evidenceTrace,
  });
  if (!evidence.ok) {
    return { ok: false, refused: { route: "evidence-chain", code: evidence.refused, detail: evidence.detail } };
  }

  // --- guardian-decision (REAL rule catalog + ceiling board) ---
  const ruleCatalog = buildRuleCatalog({ tenantId: ctx.tenantId, policy: slice.policy });
  if (!ruleCatalog.ok) {
    return { ok: false, refused: { route: "guardian-decision", code: ruleCatalog.refused, detail: ruleCatalog.detail } };
  }
  const ceilingBoard = buildCapabilityCeilingBoard({
    tenantId: ctx.tenantId,
    capabilities: slice.capabilities,
    grants: slice.grants,
    actorAuthority: slice.actorAuthority,
    nowMs: slice.nowMs,
  });
  if (!ceilingBoard.ok) {
    return { ok: false, refused: { route: "guardian-decision", code: ceilingBoard.refused, detail: ceilingBoard.detail } };
  }

  // --- action-authorization (honest not-composed when the plan is absent) ---
  let actionAuthorization: ActionAuthorizationRouteView;
  if (slice.plan !== undefined && slice.lifecycle !== undefined && slice.queue !== undefined) {
    const planBoard = buildActionPlanBoard({
      tenantId: ctx.tenantId,
      plan: slice.plan,
      lifecycle: slice.lifecycle,
      queue: slice.queue,
    });
    if (!planBoard.ok) {
      return { ok: false, refused: { route: "action-authorization", code: planBoard.refused, detail: planBoard.detail } };
    }
    actionAuthorization = { composed: true, planBoard: planBoard.view };
  } else {
    actionAuthorization = { composed: false, reason: "plan-not-composed" };
  }

  // --- execution-results (REAL ledger verification + replay, verbatim) ---
  const executionResults = buildExecutionResultsRouteView({
    tenantId: ctx.tenantId,
    ledger: slice.ledger,
    queue: slice.queue,
    auditEvents: slice.actionAuditEvents,
  });
  if (!executionResults.ok) {
    return { ok: false, refused: { route: "execution-results", code: executionResults.refused, detail: executionResults.detail } };
  }

  // --- inspect-why (honest not-composed when the action is absent) ---
  let inspectWhy: InspectWhyRouteView;
  if (slice.action !== undefined) {
    const provenance = buildDecisionProvenance({
      tenantId: ctx.tenantId,
      action: slice.action,
      evaluation: slice.evaluation,
      grants: slice.grants,
      journal: slice.ledger,
      trace: slice.trace,
    });
    if (!provenance.ok) {
      return { ok: false, refused: { route: "inspect-why", code: provenance.refused, detail: provenance.detail } };
    }
    inspectWhy = { composed: true, provenance: provenance.view };
  } else {
    inspectWhy = { composed: false, reason: "action-not-composed" };
  }

  // --- advisory-board (predictive honesty join) ---
  const advisory = buildAdvisoryBoardRouteView({
    tenantId: ctx.tenantId,
    nowMs: slice.nowMs,
    thresholds: slice.stalenessThresholds,
    predictions: slice.predictions,
    worldContexts: slice.worldContexts,
  });
  if (!advisory.ok) {
    return { ok: false, refused: { route: "advisory-board", code: advisory.refused, detail: advisory.detail } };
  }

  const views: SafetyIntelHostViewModels = {
    tenantId: ctx.tenantId,
    scope: ctx.scope,
    routes: {
      "findings-board": findings.views,
      "evidence-chain": evidence.view,
      "guardian-decision": { ruleCatalog: ruleCatalog.view, ceilingBoard: ceilingBoard.view },
      "action-authorization": actionAuthorization,
      "execution-results": executionResults.view,
      "inspect-why": inspectWhy,
      "advisory-board": advisory.view,
    },
    viewModelsDigest: hostViewsDigest({
      tenantId: ctx.tenantId,
      scope: ctx.scope,
      findings: findings.views,
      evidence: evidence.view,
      ruleCatalog: ruleCatalog.view,
      ceilingBoard: ceilingBoard.view,
      actionAuthorization,
      executionResults: executionResults.view,
      inspectWhy,
      advisory: advisory.view,
    }),
  };
  return { ok: true, views };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function hostViewsDigest(parts: {
  readonly tenantId: string;
  readonly scope: string;
  readonly findings: FindingViews;
  readonly evidence: EvidenceChainRouteView;
  readonly ruleCatalog: RuleCatalogView;
  readonly ceilingBoard: CapabilityCeilingBoardView;
  readonly actionAuthorization: ActionAuthorizationRouteView;
  readonly executionResults: ExecutionResultsRouteView;
  readonly inspectWhy: InspectWhyRouteView;
  readonly advisory: AdvisoryBoardRouteView | AdvisoryRouteNotComposed;
}): string {
  const actionAuth = parts.actionAuthorization.composed
    ? parts.actionAuthorization.planBoard.digest
    : `not-composed:${parts.actionAuthorization.reason}`;
  const inspect = parts.inspectWhy.composed
    ? parts.inspectWhy.provenance.chainDigest
    : `not-composed:${parts.inspectWhy.reason}`;
  const advisory = parts.advisory.composed ? parts.advisory.board.digest : `not-composed:${parts.advisory.reason}`;
  return fnv1a(
    `hostvm|v1|${parts.tenantId}|${parts.scope}` +
      `|fb=${parts.findings.rollup.digest}` +
      `|ec=${parts.evidence.digest}` +
      `|rc=${parts.ruleCatalog.digest}` +
      `|cb=${parts.ceilingBoard.digest}` +
      `|aa=${actionAuth}` +
      `|er=${parts.executionResults.digest}` +
      `|iw=${inspect}` +
      `|ab=${advisory}`,
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
