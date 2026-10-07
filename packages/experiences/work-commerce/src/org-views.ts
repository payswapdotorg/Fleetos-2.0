/**
 * @fleetos/experience-work-commerce — agent-organization views (F240C,
 * Wave 4 lane C).
 *
 * Presentation read-models over the agent-organizations + model-gateway
 * domain surfaces, projected READ-ONLY:
 *   - role assignment board (assigned/active/relieved) with the domain
 *     record digests carried as provenance;
 *   - capability-budget utilization in INTEGER bps with the domain's own
 *     phase classification — ceilings, never authorizations;
 *   - model-gateway usage rollups per agent and per model with chain
 *     integrity surfaced honestly (tampering shows, never hides);
 *   - selection reason-code summaries: every selection decision is
 *     counted with its reason code — never silently dropped.
 *
 * Laws: A4, A5/A6 (budgets/roles are ceilings — they authorize NOTHING;
 * "Agents and workflows cannot bypass Guardian"), A8 (tenant fail-closed),
 * A12 (deterministic; `computedAt` caller-supplied), A19 (digest-stamped).
 * Pure deterministic TS: no clock, no randomness, no I/O.
 */

import type { RoleAssignment, RoleAssignmentStatus, CapabilityBudgetRecord } from "@fleetos/agent-organizations";
import { budgetUtilizationBps, classifyBudget } from "@fleetos/agent-organizations";
import type { UsageLedgerEntry, ModelSelectionDecision } from "@fleetos/model-gateway";
import { verifyUsageLedgerChain } from "@fleetos/model-gateway";
import type { TenantScopeLike, ProvenanceRef, TenantViewReasonCode } from "./internal-view.js";
import { checkTenantScope, failClosedOnRecords, fnv1a32, provenance, bpsOf } from "./internal-view.js";
import { CEILING_NOTE } from "./commerce-views.js";

const ROLE_ASSIGNMENT_STATUSES: readonly RoleAssignmentStatus[] = ["assigned", "active", "relieved"];

// ---------------------------------------------------------------------------
// Role assignment board
// ---------------------------------------------------------------------------

export interface RoleAssignmentCard {
  readonly assignmentId: string;
  readonly agentId: string;
  readonly roleId: string;
  readonly organizationId: string;
  readonly assignedAt: number;
  readonly activatedAt: number | null;
  readonly relievedAt: number | null;
  readonly reliefReason: string | null;
  /** The domain record's audit digest (law A19) — provenance. */
  readonly recordDigest: string;
  readonly provenance: readonly ProvenanceRef[];
}

export interface RoleAssignmentBoard {
  readonly kind: "role-assignment-board";
  readonly tenantId: string;
  readonly computedAt: string;
  readonly columns: readonly { readonly status: RoleAssignmentStatus; readonly cards: readonly RoleAssignmentCard[] }[];
  readonly digest: string;
}

export type RoleAssignmentBoardResult =
  | { readonly ok: true; readonly board: RoleAssignmentBoard }
  | { readonly ok: false; readonly reasonCode: TenantViewReasonCode; readonly detail: string };

export function buildRoleAssignmentBoard(input: {
  readonly tenant: TenantScopeLike;
  readonly assignments: readonly RoleAssignment[];
  readonly computedAt: string;
}): RoleAssignmentBoardResult {
  const tenant = checkTenantScope(input.tenant);
  if (!tenant.ok) return { ok: false, reasonCode: tenant.reasonCode, detail: "tenant" };

  const closed = failClosedOnRecords(
    tenant.tenantId,
    input.assignments.map((a) => ({ id: a.id, tenant: a.tenant })),
  );
  if (!closed.ok) return { ok: false, reasonCode: closed.reasonCode, detail: closed.detail };

  const cards = input.assignments.map((a) => ({
    assignmentId: a.id,
    agentId: a.agentId,
    roleId: a.roleId,
    organizationId: a.organizationId,
    assignedAt: a.assignedAt,
    activatedAt: a.activatedAt,
    relievedAt: a.relievedAt,
    reliefReason: a.reliefReason,
    recordDigest: a.digest,
    provenance: [provenance("role-assignment", a.id)],
  }));

  const columns = ROLE_ASSIGNMENT_STATUSES.map((status) => ({
    status,
    cards: cards
      .filter((c) => input.assignments.find((a) => a.id === c.assignmentId)?.status === status)
      .sort((a, b) => a.assignmentId.localeCompare(b.assignmentId)),
  }));

  const digest = `roleboard_${fnv1a32([
    tenant.tenantId,
    input.computedAt,
    columns.map((col) => `${col.status}:${col.cards.map((c) => c.assignmentId).join(",")}`),
  ])}`;

  return {
    ok: true,
    board: { kind: "role-assignment-board", tenantId: tenant.tenantId, computedAt: input.computedAt, columns, digest },
  };
}

// ---------------------------------------------------------------------------
// Capability budget board — integer bps utilization, ceilings not authorizations
// ---------------------------------------------------------------------------

export interface BudgetUtilizationRow {
  readonly budgetId: string;
  readonly scopeKind: string;
  readonly scopeRefId: string;
  readonly capability: string;
  readonly allocatedUnits: number;
  readonly consumedUnits: number;
  readonly remainingUnits: number;
  /** Domain computation: floor(consumedUnits * 10000 / allocatedUnits). */
  readonly unitUtilizationBps: number;
  readonly allocatedSpendMinor: number;
  readonly consumedSpendMinor: number;
  readonly remainingSpendMinor: number;
  readonly spendUtilizationBps: number;
  readonly generation: number;
  readonly phase: "allocated" | "consumed" | "exhausted";
  readonly ceilingNote: typeof CEILING_NOTE;
}

export type BudgetBoardResult =
  | {
      readonly ok: true;
      readonly rows: readonly BudgetUtilizationRow[];
      readonly totals: { readonly budgetCount: number; readonly exhaustedCount: number };
      readonly digest: string;
    }
  | { readonly ok: false; readonly reasonCode: TenantViewReasonCode; readonly detail: string };

export function buildCapabilityBudgetBoard(input: {
  readonly tenant: TenantScopeLike;
  readonly budgets: readonly CapabilityBudgetRecord[];
  readonly computedAt: string;
}): BudgetBoardResult {
  const tenant = checkTenantScope(input.tenant);
  if (!tenant.ok) return { ok: false, reasonCode: tenant.reasonCode, detail: "tenant" };

  const closed = failClosedOnRecords(
    tenant.tenantId,
    input.budgets.map((b) => ({ id: b.id, tenant: b.tenant })),
  );
  if (!closed.ok) return { ok: false, reasonCode: closed.reasonCode, detail: closed.detail };

  const rows = [...input.budgets]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((b) => ({
      budgetId: b.id,
      scopeKind: b.scope.kind,
      scopeRefId: b.scope.refId,
      capability: b.capability,
      allocatedUnits: b.allocatedUnits,
      consumedUnits: b.consumedUnits,
      remainingUnits: b.allocatedUnits - b.consumedUnits,
      unitUtilizationBps: budgetUtilizationBps(b),
      allocatedSpendMinor: b.allocatedSpendMinor,
      consumedSpendMinor: b.consumedSpendMinor,
      remainingSpendMinor: b.allocatedSpendMinor - b.consumedSpendMinor,
      spendUtilizationBps: bpsOf(b.consumedSpendMinor, b.allocatedSpendMinor),
      generation: b.generation,
      phase: classifyBudget(b),
      ceilingNote: CEILING_NOTE,
    }));

  const digest = `budgetboard_${fnv1a32([
    tenant.tenantId,
    input.computedAt,
    rows.map((r) => `${r.budgetId}:${r.unitUtilizationBps}:${r.phase}`),
  ])}`;

  return {
    ok: true,
    rows,
    totals: {
      budgetCount: rows.length,
      exhaustedCount: rows.filter((r) => r.phase === "exhausted").length,
    },
    digest,
  };
}

// ---------------------------------------------------------------------------
// Model-gateway usage rollup — chain integrity surfaced honestly
// ---------------------------------------------------------------------------

export interface UsageTotals {
  readonly entries: number;
  readonly totalUnits: number;
  readonly totalCostMinor: number;
}

export interface ModelUsageRollup {
  readonly kind: "model-usage-rollup";
  readonly tenantId: string;
  readonly computedAt: string;
  readonly totals: UsageTotals;
  readonly byAgent: readonly { readonly agentId: string; readonly requests: number; readonly units: number; readonly costMinor: number }[];
  readonly byModel: readonly { readonly modelId: string; readonly providerId: string; readonly requests: number; readonly units: number; readonly costMinor: number }[];
  /** The DOMAIN's own chain verification, surfaced — tampering shows. */
  readonly chain: { readonly ok: boolean; readonly reasonCode: string | null; readonly brokenAtSeq: number | null };
  readonly digest: string;
}

export type ModelUsageRollupResult =
  | { readonly ok: true; readonly rollup: ModelUsageRollup }
  | { readonly ok: false; readonly reasonCode: TenantViewReasonCode; readonly detail: string };

export function buildModelUsageRollup(input: {
  readonly tenant: TenantScopeLike;
  readonly usage: readonly UsageLedgerEntry[];
  readonly computedAt: string;
}): ModelUsageRollupResult {
  const tenant = checkTenantScope(input.tenant);
  if (!tenant.ok) return { ok: false, reasonCode: tenant.reasonCode, detail: "tenant" };

  for (const entry of input.usage) {
    if (entry.tenantId !== tenant.tenantId) {
      return { ok: false, reasonCode: "TENANT_MISMATCH", detail: entry.requestRef };
    }
  }

  const chain = verifyUsageLedgerChain(input.usage);

  const byAgentMap = new Map<string, { requests: number; units: number; costMinor: number }>();
  const byModelMap = new Map<string, { providerId: string; requests: number; units: number; costMinor: number }>();
  let totalUnits = 0;
  let totalCostMinor = 0;
  for (const entry of input.usage) {
    const agent = byAgentMap.get(entry.agentId) ?? { requests: 0, units: 0, costMinor: 0 };
    byAgentMap.set(entry.agentId, {
      requests: agent.requests + 1,
      units: agent.units + entry.units,
      costMinor: agent.costMinor + entry.costMinor,
    });
    const model = byModelMap.get(entry.modelId) ?? { providerId: entry.providerId, requests: 0, units: 0, costMinor: 0 };
    byModelMap.set(entry.modelId, {
      providerId: entry.providerId,
      requests: model.requests + 1,
      units: model.units + entry.units,
      costMinor: model.costMinor + entry.costMinor,
    });
    totalUnits += entry.units;
    totalCostMinor += entry.costMinor;
  }

  const byAgent = [...byAgentMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([agentId, v]) => ({ agentId, ...v }));
  const byModel = [...byModelMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([modelId, v]) => ({ modelId, ...v }));

  const digest = `usagerollup_${fnv1a32([
    tenant.tenantId,
    input.computedAt,
    input.usage.length,
    totalUnits,
    totalCostMinor,
    byAgent.map((a) => `${a.agentId}:${a.requests}:${a.costMinor}`),
    byModel.map((m) => `${m.modelId}:${m.requests}:${m.costMinor}`),
  ])}`;

  return {
    ok: true,
    rollup: {
      kind: "model-usage-rollup",
      tenantId: tenant.tenantId,
      computedAt: input.computedAt,
      totals: { entries: input.usage.length, totalUnits, totalCostMinor },
      byAgent,
      byModel,
      chain: chain.ok
        ? { ok: true, reasonCode: null, brokenAtSeq: null }
        : { ok: false, reasonCode: chain.reasonCode, brokenAtSeq: chain.brokenAtSeq },
      digest,
    },
  };
}

// ---------------------------------------------------------------------------
// Selection reason-code summary — every decision counted, none silent
// ---------------------------------------------------------------------------

export interface ReasonCodeCount {
  readonly code: string;
  readonly count: number;
}

export interface SelectionReasonSummary {
  readonly kind: "selection-reason-summary";
  readonly decisions: number;
  readonly selected: number;
  /** Selections grouped by their recorded ordering rule. */
  readonly selectedByOrderingRule: readonly ReasonCodeCount[];
  /** Refusals grouped by the domain's reason code. */
  readonly refusedByReasonCode: readonly ReasonCodeCount[];
  /** selections + refusals === decisions (the nothing-silent invariant). */
  readonly accountedFor: number;
}

export function summarizeSelectionReasonCodes(
  decisions: readonly ModelSelectionDecision[],
): SelectionReasonSummary {
  const ordering = new Map<string, number>();
  const refusals = new Map<string, number>();
  let selected = 0;
  for (const decision of decisions) {
    if (decision.ok) {
      selected += 1;
      ordering.set(decision.orderingRule, (ordering.get(decision.orderingRule) ?? 0) + 1);
    } else {
      refusals.set(decision.reasonCode, (refusals.get(decision.reasonCode) ?? 0) + 1);
    }
  }
  return {
    kind: "selection-reason-summary",
    decisions: decisions.length,
    selected,
    selectedByOrderingRule: countsOf(ordering),
    refusedByReasonCode: countsOf(refusals),
    accountedFor: selected + [...refusals.values()].reduce((sum, n) => sum + n, 0),
  };
}

function countsOf(map: Map<string, number>): ReasonCodeCount[] {
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([code, count]) => ({ code, count }));
}
