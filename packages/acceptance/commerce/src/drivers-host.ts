/**
 * @fleetos/acceptance-commerce — host-seam step drivers (F300C).
 *
 * Drives the REAL HostSurface adapter of @fleetos/experience-work-commerce
 * (`./host` seam, WAVE10-HOST-CONTRACT §2) over the journey's REAL composed
 * domain state (the acceptance-suite composition pattern: every slice field
 * is a REAL record accumulated by the other step drivers), and records
 * readings from the REAL outputs: route outcomes, view digests,
 * byte-identical purity, honest limitation markers, inert intent drafts and
 * their presentation role-lens gates.
 *
 * The host context is a REAL HostTenantContext whose establishedAt is the
 * step's logical `now` — never a wall clock.
 *
 * Role lenses are PRESENTATION gating (fail-closed: a role not offered the
 * intent is refused at the seam BEFORE any draft is built). Authorization
 * itself is always the control plane + Guardian's — drafts stay inert (the
 * capability requirement is a REQUEST, never an authorization).
 */

import type { FactValue, HostStep } from "./journey-contracts.js";
import type { JourneyState } from "./journey-world.js";
import { logPush } from "./journey-world.js";
import {
  buildWorkCommerceHostViewModels as buildViewModels,
  verifyHostViewModelsDigest,
  verifyRouteManifest,
  verifyIntentCatalog,
  buildIntentForEvent,
} from "@fleetos/experience-work-commerce/host";
import { validateCommandDraft } from "@fleetos/experience-work-commerce/command-intents";
import type { WorkCommerceSlice, QuoteScoreSheetInput, HostTenantContext } from "@fleetos/experience-work-commerce/host";
import type { Quote } from "@fleetos/procurement";

export type DriverFacts = Record<string, FactValue>;

const HOST_ACTOR = "act-host-01";
const HOST_ROLE = "role-commerce-host";

function composeSlice(
  state: JourneyState,
  foreignQuote: Quote | null,
  quoteScoreInputs?: readonly QuoteScoreSheetInput[],
): WorkCommerceSlice {
  const quotes = foreignQuote === null ? [...state.commerce.quotes.values()] : [foreignQuote];
  return {
    tenantId: state.tenant.tenantId,
    workItems: [...state.work.items.values()],
    projects: state.projectState.project === null ? [] : [state.projectState.project],
    stages: state.projectState.stages,
    milestones: state.projectState.milestones,
    capacities: state.workload.capacities,
    allocations: [
      {
        owner: state.workload.idemLedger.owner,
        tenant: state.tenant,
        allocatedUnits: state.workload.idemLedger.allocatedUnits,
        reservedCost: 0,
      },
    ],
    needs: [state.commerce.need],
    demands: [state.commerce.demand],
    quotes,
    orders: [...state.commerce.orders.values()],
    fulfillments: state.commerce.fulfillment === null ? [] : [state.commerce.fulfillment],
    vendors: [state.vendor.record],
    exposures: [state.vendor.exposure],
    subscriptions: [state.software.subscription],
    entitlements: state.software.entitlements,
    assignments: state.org.assignments,
    budgets: state.org.budgets,
    usage: state.org.usage,
    ...(quoteScoreInputs === undefined ? {} : { quoteScoreInputs }),
  };
}

function hostContext(state: JourneyState, now: number) {
  return {
    tenantId: state.tenant.tenantId,
    actorId: HOST_ACTOR,
    roleId: HOST_ROLE,
    establishedAt: now,
    scope: "self" as const,
  };
}

export async function runHostStep(step: HostStep, state: JourneyState): Promise<DriverFacts> {
  switch (step.kind) {
    case "host-build-view-models":
      return executeHostBuild(step, state);
    case "host-intent-draft":
      return executeHostIntentDraft(step, state);
    case "host-context-probe":
      return executeHostContextProbe(step, state);
  }
}

function executeHostBuild(
  step: Extract<HostStep, { kind: "host-build-view-models" }>,
  state: JourneyState,
): DriverFacts {
  const scoreInputs: QuoteScoreSheetInput[] | undefined =
    step.quoteScoreInputs === undefined
      ? undefined
      : step.quoteScoreInputs.map((sheet) => ({
          demandId: sheet.demandId,
          requiredCapabilityTags: sheet.requiredCapabilityTags,
          quotes: sheet.quotes.map((q) => ({ ...q, tenant: state.tenant })),
        }));
  const slice = composeSlice(state, null, scoreInputs);
  const ctx = hostContext(state, step.now);
  const first = buildViewModels(slice, ctx);
  // Purity machine-check: a rebuild over the same slice + context must be
  // byte-identical (the WAVE10-HOST-CONTRACT §2 pure law).
  const second = buildViewModels(slice, ctx);
  const pure = JSON.stringify(first) === JSON.stringify(second);
  if (!first.ok) {
    return { "host.ok": false, "host.rejected": first.rejected, "host.pure": pure };
  }
  const m = first.models;
  const workTotals = m.workBoard.ok ? m.workBoard.board.totals : [];
  const todoCount = workTotals.find((t) => t.status === "todo")?.count ?? 0;
  const doneCount = workTotals.find((t) => t.status === "done")?.count ?? 0;
  const blockedCount = workTotals.find((t) => t.status === "blocked")?.count ?? 0;
  const gate0 = m.stageGates[0] ?? null;
  const frontier = gate0 !== null && gate0.outcome.ok ? gate0.outcome.view.frontierStageId : null;
  const unlock = gate0 !== null && gate0.outcome.ok ? gate0.outcome.view.nextUnlock : null;
  const spineQuoteStatuses = m.spineBoard.ok
    ? m.spineBoard.board.counts.filter((c) => c.stage === "quote").map((c) => `${c.key}:${c.count}`).sort()
    : [];
  const seat0 = m.seatView.ok ? (m.seatView.rows[0] ?? null) : null;
  const roleActive = m.roleBoard.ok ? m.roleBoard.board.columns.find((c) => c.status === "active")?.cards.map((c) => c.assignmentId) ?? [] : [];
  const budget0 = m.budgetBoard.ok ? (m.budgetBoard.rows[0] ?? null) : null;
  const scoreSheet0 = m.quoteScore.composed ? (m.quoteScore.sheets[0] ?? null) : null;
  const markers = m.routeLimitations.find((l) => l.routeId === "procurement-spine")?.markers ?? [];
  const buildCount = (state.logs["host.build.log"]?.length ?? 0) + 1;
  logPush(
    state,
    "host.build.log",
    `#${buildCount}:todo=${todoCount}:usedUnits=${m.workloadRollup.ok ? m.workloadRollup.view.totals.usedUnits : -1}:active=${roleActive.length}:scoreComposed=${m.quoteScore.composed}`,
  );
  return {
    "host.ok": true,
    "host.pure": pure,
    "host.surfaceId": m.surfaceId,
    "host.asOf": m.asOf,
    "host.digest": m.digest,
    "host.digestVerified": verifyHostViewModelsDigest(m),
    "host.routes": 5,
    "host.routesValid": verifyRouteManifest().length === 0,
    "host.intentsValid": verifyIntentCatalog().length === 0,
    "host.workBoard.ok": m.workBoard.ok,
    "host.workBoard.todoCount": todoCount,
    "host.workBoard.blockedCount": blockedCount,
    "host.workBoard.doneCount": doneCount,
    "host.stageGates.count": m.stageGates.length,
    "host.stageGates.frontierStageId": frontier,
    "host.stageGates.nextUnlockRequires": unlock === null ? null : unlock.requires,
    "host.workloadRollup.ok": m.workloadRollup.ok,
    "host.workloadRollup.usedUnits": m.workloadRollup.ok ? m.workloadRollup.view.totals.usedUnits : -1,
    "host.workloadRollup.utilizationBps": m.workloadRollup.ok ? m.workloadRollup.view.totals.utilizationBps : -1,
    "host.spineBoard.ok": m.spineBoard.ok,
    "host.spineBoard.quoteStatuses": spineQuoteStatuses,
    "host.vendorKpi.ok": m.vendorKpi.ok,
    "host.vendorKpi.vendorIds": m.vendorKpi.ok ? m.vendorKpi.rows.map((r) => r.vendorId) : [],
    "host.quoteScore.composed": m.quoteScore.composed,
    "host.quoteScore.ranked0QuoteId":
      scoreSheet0 !== null && scoreSheet0.outcome.ok ? (scoreSheet0.outcome.view.ranked[0]?.quoteId ?? null) : null,
    "host.seatView.ok": m.seatView.ok,
    "host.seatView.seatsAllocated": seat0?.seatsAllocated ?? -1,
    "host.seatView.seatsTotal": seat0?.seatsTotal ?? -1,
    "host.roleBoard.ok": m.roleBoard.ok,
    "host.roleBoard.activeIds": roleActive,
    "host.budgetBoard.ok": m.budgetBoard.ok,
    "host.budgetBoard.phase0": budget0?.phase ?? null,
    "host.budgetBoard.unitUtilizationBps0": budget0?.unitUtilizationBps ?? -1,
    "host.budgetBoard.ceilingNote0": budget0?.ceilingNote ?? null,
    "host.usageRollup.ok": m.usageRollup.ok,
    "host.usageRollup.chainOk": m.usageRollup.ok ? m.usageRollup.rollup.chain.ok : false,
    "host.markers.procurementSpine": markers,
  };
}

function executeHostIntentDraft(
  step: Extract<HostStep, { kind: "host-intent-draft" }>,
  state: JourneyState,
): DriverFacts {
  const result = buildIntentForEvent(
    step.event,
    {
      tenantId: state.tenant.tenantId,
      issuedAt: step.issuedAt ?? 1_774_000_000_000,
      reason: step.reason ?? "host journey intent",
      ...(step.title === undefined ? {} : { title: step.title }),
      ...(step.projectId === undefined ? {} : { projectId: step.projectId }),
      ...(step.assigneeId === undefined ? {} : { assigneeId: step.assigneeId }),
      ...(step.quoteId === undefined ? {} : { quoteId: step.quoteId }),
      ...(step.demandId === undefined ? {} : { demandId: step.demandId }),
      ...(step.vendorId === undefined ? {} : { vendorId: step.vendorId }),
      ...(step.totalCostMinor === undefined ? {} : { totalCostMinor: step.totalCostMinor }),
      ...(step.budgetId === undefined ? {} : { budgetId: step.budgetId }),
      ...(step.additionalUnits === undefined ? {} : { additionalUnits: step.additionalUnits }),
      ...(step.additionalSpendMinor === undefined ? {} : { additionalSpendMinor: step.additionalSpendMinor }),
    },
    step.role,
  );
  logPush(
    state,
    "host.draft.log",
    result.ok
      ? `ok:${result.draft.command.kind}:${result.draft.requiredCapability}`
      : `refused:${result.rejected}:${result.detail}`,
  );
  const successCount = (state.logs["host.draft.log"] ?? []).filter((e) => e.startsWith("ok:")).length;
  if (!result.ok) {
    return {
      "host.draft.ok": false,
      "host.draft.rejected": result.rejected,
      "host.draft.detail": result.detail,
      "host.draft.successCount": successCount,
    };
  }
  return {
    "host.draft.ok": true,
    "host.draft.rejected": null,
    "host.draft.detail": null,
    "host.draft.kind": result.draft.command.kind,
    "host.draft.capability": result.draft.requiredCapability,
    "host.draft.idempotencyKey": result.draft.command.idempotencyKey,
    "host.draft.draftDigest": result.draft.draftDigest,
    "host.draft.validated": validateCommandDraft(result.draft).ok,
    "host.draft.recordType": result.draft.recordType,
    "host.draft.successCount": successCount,
  };
}

function executeHostContextProbe(
  step: Extract<HostStep, { kind: "host-context-probe" }>,
  state: JourneyState,
): DriverFacts {
  const baseCtx = hostContext(state, 1_774_000_000_000);
  const slice = composeSlice(state, null);
  if (step.probe === "foreign-record-in-slice") {
    const foreign: Quote = {
      id: { kind: "quote", value: "q-foreign" },
      tenant: state.otherTenant,
      demandId: state.commerce.demand.id,
      vendorId: "ven-1",
      unitCost: 10_00,
      totalCost: 100_00,
      status: "submitted",
      submittedAt: "2026-10-02T00:00:00Z",
      expiresAt: null,
      supersedes: null,
      superseded: false,
    };
    const result = buildViewModels(composeSlice(state, foreign), baseCtx);
    if (!result.ok) {
      logPush(state, "host.probe.log", `foreign-record-in-slice:bundle:${result.rejected}`);
      return { "host.probe.ok": true, "host.probe.bundleRefused": true, "host.probe.rejected": result.rejected };
    }
    logPush(
      state,
      "host.probe.log",
      `foreign-record-in-slice:per-assembly:${result.models.spineBoard.ok ? "-" : result.models.spineBoard.reasonCode}`,
    );
    return {
      "host.probe.ok": true,
      "host.probe.bundleRefused": false,
      "host.probe.spineRefused": !result.models.spineBoard.ok,
      "host.probe.spineReasonCode": result.models.spineBoard.ok ? null : result.models.spineBoard.reasonCode,
      "host.probe.spineDetail": result.models.spineBoard.ok ? null : result.models.spineBoard.detail,
      "host.probe.vendorKpiRefused": !result.models.vendorKpi.ok,
    };
  }
  const probes: Record<string, { ctx: HostTenantContext; slice: WorkCommerceSlice }> = {
    "tenant-mismatch": {
      ctx: { ...baseCtx, tenantId: state.otherTenant.tenantId },
      slice,
    },
    "malformed-context": { ctx: { ...baseCtx, tenantId: "" }, slice },
    "invalid-established-at": { ctx: { ...baseCtx, establishedAt: 0 }, slice },
    "forbidden-scope": { ctx: { ...baseCtx, scope: "cross-tenant-forbidden" }, slice },
  };
  const probe = probes[step.probe];
  if (probe === undefined) {
    return { "host.probe.ok": false, "host.probe.rejected": "unknown-probe" };
  }
  const result = buildViewModels(probe.slice, probe.ctx);
  logPush(
    state,
    "host.probe.log",
    `${step.probe}:${result.ok ? "accepted" : result.rejected}`,
  );
  return {
    "host.probe.ok": true,
    "host.probe.rejected": result.ok ? null : result.rejected,
    "host.probe.refused": !result.ok,
  };
}
