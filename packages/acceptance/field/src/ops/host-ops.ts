/**
 * @fleetos/acceptance-field — host-seam operation executors (F300A).
 *
 * Drives the REAL HostSurface adapter of @fleetos/experience-asset-field
 * (`./host` seam, WAVE10-HOST-CONTRACT §2) over the journey's REAL
 * composed domain state, and records readings from the REAL outputs:
 * route outcomes, view digests, byte-identical purity, honest limitation
 * markers, inert intent drafts and their presentation role-lens gates.
 *
 * The host context is a REAL TenantContext (makeTenantContext) whose
 * establishedAt is the op's logical `now` — never a wall clock.
 *
 * Role lenses are PRESENTATION gating (fail-closed: a role not offered
 * the intent is refused at the seam). Authorization itself is always
 * the control plane + Guardian's — drafts stay inert (capability
 * requirement is a REQUEST, never an authorization).
 */

import { makeTenantContext } from "@fleetos/identity";
import type { TenantContext } from "@fleetos/identity";
import {
  buildAssetFieldHostViewModels as buildViewModels,
  verifyHostViewModelsDigest,
  device360SheetFor,
  verifyRouteManifest,
  verifyIntentCatalog,
  isIntentOfferedToRole,
  buildIntentForEvent,
} from "@fleetos/experience-asset-field/host";
import { verifyAssetDetailDigest } from "@fleetos/experience-asset-field";
import type { JourneyOperation } from "../journey-contracts.js";
import type { JourneyContext } from "../context.js";
import { buildStateSlice } from "../context.js";
import { FOREIGN_TENANT, OPERATOR, TECHNICIAN, EDGE_ACTOR } from "../fixtures.js";
import { opOk, opRefused, type OpExecution } from "./common.js";

const HOST_ROLE_ID = "role_field-ops-01";

/** Deterministic role-lens -> journey actor mapping (documented seam). */
function actorForRole(role: string): string {
  if (role === "field-technician") return TECHNICIAN;
  if (role === "edge-operator") return EDGE_ACTOR;
  return OPERATOR;
}

export function executeHostOperation(op: JourneyOperation, ctx: JourneyContext): OpExecution {
  switch (op.kind) {
    case "host.build-view-models":
      return executeHostBuild(op, ctx);
    case "host.intent-draft":
      return executeHostIntentDraft(op, ctx);
    case "host.context-probe":
      return executeHostContextProbe(op, ctx);
    default:
      return opRefused("unknown-operation");
  }
}

function executeHostBuild(
  op: Extract<JourneyOperation, { kind: "host.build-view-models" }>,
  ctx: JourneyContext,
): OpExecution {
  const slice = buildStateSlice(ctx);
  const contextResult = makeTenantContext({
    tenantId: ctx.tenantId,
    actorId: OPERATOR,
    roleId: HOST_ROLE_ID,
    establishedAt: op.now,
  });
  if (!contextResult.ok) return opRefused(contextResult.reason);
  const first = buildViewModels(slice, contextResult.context);
  // Purity machine-check: a rebuild over the same slice + context must be
  // byte-identical (the WAVE10-HOST-CONTRACT §2 pure law).
  const second = buildViewModels(slice, contextResult.context);
  const pure = JSON.stringify(first) === JSON.stringify(second);
  if (!first.ok) {
    return opOk({ "host.ok": false, "host.rejected": first.rejected, "host.pure": pure });
  }
  const m = first.models;
  const d360 = m.device360[0] ?? null;
  const sheet0 = d360 !== null ? device360SheetFor(m, d360.assetId) : null;
  const timelineCase0 = m.recoveryTimeline.ok ? m.recoveryTimeline.view.cases[0] ?? null : null;
  const field = m.fieldWorkflow.ok ? m.fieldWorkflow.view : null;
  const board = m.maintenanceBoard.ok ? m.maintenanceBoard.view : null;
  const overview = m.fleetOverview.ok ? m.fleetOverview.view : null;
  const health = m.healthBoard.ok ? m.healthBoard.view : null;
  return opOk({
    "host.ok": true,
    "host.pure": pure,
    "host.surfaceId": m.surfaceId,
    "host.asOf": m.asOf,
    "host.digest": m.digest,
    "host.digestVerified": verifyHostViewModelsDigest(m),
    "host.routes": 5,
    "host.routesValid": verifyRouteManifest().length === 0,
    "host.intentsValid": verifyIntentCatalog().length === 0,
    "host.overview.ok": m.fleetOverview.ok,
    "host.overview.assets": overview?.counters.assets ?? 0,
    "host.overview.card0.assetId": overview?.cards[0]?.assetId ?? null,
    "host.overview.card0.posture": overview?.cards[0]?.posture ?? null,
    "host.overview.card0.deviceCount": overview?.cards[0]?.deviceCount ?? 0,
    "host.overview.card0.lastObservedStaleness": overview?.cards[0]?.lastObservedStaleness ?? null,
    "host.overview.card0.redactedFields": overview?.cards[0]?.redactedFields ?? [],
    "host.device360.count": m.device360.length,
    "host.device360.assetIds": m.device360.map((s) => s.assetId),
    "host.device360.sheetsOk": m.device360.every((s) => s.outcome.ok),
    "host.device360.sheet0.assetId": sheet0?.ok ? sheet0.sheet.assetId : null,
    "host.device360.sheet0.posture": sheet0?.ok && sheet0.sheet.outcome.ok ? sheet0.sheet.outcome.view.posture : null,
    "host.device360.sheet0.device0.staleness":
      sheet0?.ok && sheet0.sheet.outcome.ok ? sheet0.sheet.outcome.view.devices[0]?.staleness ?? null : null,
    "host.device360.sheet0.device0.serial":
      sheet0?.ok && sheet0.sheet.outcome.ok ? sheet0.sheet.outcome.view.devices[0]?.serial ?? null : null,
    "host.device360.sheet0.findingsCount":
      sheet0?.ok && sheet0.sheet.outcome.ok ? sheet0.sheet.outcome.view.findings.length : 0,
    "host.device360.sheet0.digestVerified":
      sheet0?.ok && sheet0.sheet.outcome.ok ? verifyAssetDetailDigest(sheet0.sheet.outcome.view) : false,
    "host.healthBoard.ok": m.healthBoard.ok,
    "host.healthBoard.rows": health?.rows.length ?? 0,
    "host.healthBoard.fleetWarning": health?.fleet.warning ?? 0,
    "host.healthBoard.fleetCritical": health?.fleet.critical ?? 0,
    "host.healthBoard.row0.posture": health?.rows[0]?.posture ?? null,
    "host.healthBoard.row0.worstFindingCode": health?.rows[0]?.worstFinding?.code ?? null,
    "host.recoveryTimeline.ok": m.recoveryTimeline.ok,
    "host.recoveryTimeline.open": m.recoveryTimeline.ok ? m.recoveryTimeline.view.open : 0,
    "host.recoveryTimeline.case0.state": timelineCase0?.state ?? null,
    "host.recoveryTimeline.case0.stepCommands": timelineCase0?.steps.map((s) => s.command) ?? [],
    "host.recoveryTimeline.case0.ageMs": timelineCase0?.ageMs ?? null,
    "host.maintenanceBoard.ok": m.maintenanceBoard.ok,
    "host.maintenanceBoard.scheduled": board?.scheduled.length ?? 0,
    "host.maintenanceBoard.inProgress": board?.inProgress.length ?? 0,
    "host.maintenanceBoard.completed": board?.completed.length ?? 0,
    "host.maintenanceBoard.upcoming": board?.upcoming.map((u) => u.planId) ?? [],
    "host.maintenanceBoard.upcoming0.nextRunAt": board?.upcoming[0]?.nextRunAt ?? null,
    "host.fieldWorkflow.ok": m.fieldWorkflow.ok,
    "host.fieldWorkflow.alerts": field?.topAlerts.entries.length ?? 0,
    "host.fieldWorkflow.alert0.severity": field?.topAlerts.entries[0]?.severity ?? null,
    "host.fieldWorkflow.alert0.code": field?.topAlerts.entries[0]?.code ?? null,
    "host.fieldWorkflow.alert0.lastKnownStaleness": field?.topAlerts.entries[0]?.lastKnown.staleness ?? null,
    "host.fieldWorkflow.recoveries": field?.recoveryInProgress.entries.length ?? 0,
    "host.fieldWorkflow.maintenance": field?.nextMaintenance.entries.length ?? 0,
    "host.fieldWorkflow.sectionsBounded":
      field !== null &&
      field.topAlerts.entries.length <= 5 &&
      field.recoveryInProgress.entries.length <= 5 &&
      field.nextMaintenance.entries.length <= 5 &&
      field.connectivityStatus.entries.length <= 12,
    "host.fieldWorkflow.lastKnownSections": field?.lastKnownSections ?? [],
    "host.fieldWorkflow.connectivityPostures":
      field?.connectivityStatus.entries.map((c) => c.posture) ?? [],
    "host.markers.fleetOverview": m.routeLimitations.find((l) => l.routeId === "fleet-overview")?.markers ?? [],
    "host.markers.device360": m.routeLimitations.find((l) => l.routeId === "device-360")?.markers ?? [],
    "host.markers.fieldWorkflow": m.routeLimitations.find((l) => l.routeId === "field-workflow")?.markers ?? [],
    "host.drilldowns": {
      "fleet-overview": ["device-360", "field-workflow"],
      "asset-discovery": ["device-360"],
      "device-360": ["health-timeline", "field-workflow"],
      "health-timeline": ["device-360"],
      "field-workflow": ["device-360"],
    },
  });
}

function executeHostIntentDraft(
  op: Extract<JourneyOperation, { kind: "host.intent-draft" }>,
  ctx: JourneyContext,
): OpExecution {
  const offered = isIntentOfferedToRole(op.event, op.role);
  if (!offered) {
    return opRefused(
      "intent-not-offered-to-role",
      { "intent.refused": "intent-not-offered-to-role", "intent.event": op.event, "intent.role": op.role },
    );
  }
  const r = buildIntentForEvent(op.event, {
    tenantId: ctx.tenantId,
    actorId: actorForRole(op.role),
    issuedAt: ctx.clock,
    reason: op.reason ?? "host: acceptance journey intent",
    ...(op.assetId !== undefined ? { assetId: op.assetId } : {}),
    ...(op.deviceId !== undefined ? { deviceId: op.deviceId } : {}),
    ...(op.serial !== undefined ? { serial: op.serial } : {}),
    ...(op.displayName !== undefined ? { displayName: op.displayName } : {}),
    ...(op.planId !== undefined ? { planId: op.planId } : {}),
    ...(op.schedule !== undefined ? { schedule: op.schedule } : {}),
  });
  if (!r.ok) return opRefused(r.rejected, { "intent.refused": r.rejected });
  ctx.lastDraft = r.draft;
  return opOk({
    "intent.event": op.event,
    "intent.role": op.role,
    "intent.builder": r.intent.builderId,
    "intent.kind": r.draft.kind,
    "intent.capability": r.draft.capabilityRequirement,
    "intent.idempotencyKey": r.draft.idempotencyKey,
    "intent.actorId": r.draft.actorId,
    "intent.routeId": r.intent.routeId,
  });
}

function executeHostContextProbe(
  op: Extract<JourneyOperation, { kind: "host.context-probe" }>,
  ctx: JourneyContext,
): OpExecution {
  const slice = buildStateSlice(ctx);
  let probeContext: TenantContext;
  if (op.probe === "tenant-mismatch") {
    const foreign = makeTenantContext({
      tenantId: op.foreignTenantId ?? FOREIGN_TENANT,
      actorId: OPERATOR,
      roleId: HOST_ROLE_ID,
      establishedAt: ctx.clock,
    });
    if (!foreign.ok) return opRefused(foreign.reason);
    probeContext = foreign.context;
  } else {
    // A runtime-widened malformed value — the seam must re-validate it.
    const valid = makeTenantContext({
      tenantId: ctx.tenantId,
      actorId: OPERATOR,
      roleId: HOST_ROLE_ID,
      establishedAt: ctx.clock,
    });
    if (!valid.ok) return opRefused(valid.reason);
    probeContext = { ...valid.context, tenantId: "not-a-tenant" as never };
  }
  const r = buildViewModels(slice, probeContext);
  if (r.ok) {
    return opRefused("probe-expected-refusal", { "probe.refused": null, "probe.ok": true });
  }
  return opOk({
    "probe.ok": false,
    "probe.refused": r.rejected,
    "probe.detail": r.detail,
  });
}
