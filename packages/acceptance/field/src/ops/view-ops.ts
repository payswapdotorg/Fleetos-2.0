/**
 * @fleetos/acceptance-field — experience view / handoff / mission-replay
 * operation executors. Views are assembled through the REAL public
 * assemblies of @fleetos/experience-asset-field over the slice built from
 * the journey's REAL domain state; refusals are recorded as REAL outcomes.
 * The mission ops drive the LOCAL structural mirror over REAL observation
 * batches (documented seam — see mission-mirror.ts).
 */

import {
  assembleFleetOverview,
  verifyFleetOverviewDigest,
  assembleAssetDetail,
  verifyAssetDetailDigest,
  assembleFieldView,
  verifyFieldViewDigest,
  assembleHealthBoard,
  verifyHealthBoardDigest,
  assembleRecoveryTimeline,
  verifyRecoveryTimelineDigest,
  assembleMaintenanceBoard,
  verifyMaintenanceBoardDigest,
} from "@fleetos/experience-asset-field";
import type { BoundedSection } from "@fleetos/experience-asset-field";
import type { Severity } from "@fleetos/health";
import type { JourneyOperation } from "../journey-contracts.js";
import type { JourneyContext } from "../context.js";
import { buildStateSlice } from "../context.js";
import { makeHandoffCarrier, verifyHandoffCarrier } from "../handoff.js";
import { foldMirrorMission, verifyMirrorJournal } from "../mission-mirror.js";
import { EDGE_ACTOR, OPERATOR } from "../fixtures.js";
import { assertSameTenant } from "@fleetos/tenancy";
import { makeTenantContext } from "@fleetos/identity";
import { checkEnrollment } from "@fleetos/assets";
import { issueAdcosCommand } from "@fleetos/adcos";
import { opOk, opRefused, type OpExecution } from "./common.js";
import { executeMissionOperation } from "./mission-ops.js";

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

function sectionIsBounded<E>(section: BoundedSection<E>, limit: number): boolean {
  return section.entries.length <= limit;
}

export function executeViewOperation(op: JourneyOperation, ctx: JourneyContext): OpExecution {
  const slice = buildStateSlice(ctx);
  switch (op.kind) {
    case "view.fleet-overview": {
      const r = assembleFleetOverview(slice, { now: op.now });
      if (!r.ok) return opOk({ "overview.ok": false, "overview.rejected": r.rejected });
      const first = r.view.cards[0] ?? null;
      return opOk({
        "overview.ok": true,
        "overview.digestVerified": verifyFleetOverviewDigest(r.view),
        "overview.assets": r.view.counters.assets,
        "overview.active": r.view.counters.active,
        "overview.cards": r.view.cards.map((c) => c.assetId),
        "overview.card0.assetId": first?.assetId ?? null,
        "overview.card0.lifecycle": first?.lifecycle ?? null,
        "overview.card0.posture": first?.posture ?? null,
        "overview.card0.deviceCount": first?.deviceCount ?? 0,
        "overview.card0.lastObservedStaleness": first?.lastObservedStaleness ?? null,
        "overview.card0.connectivityUnknown": first?.connectivity.unknown ?? 0,
        "overview.card0.redactedFields": first?.redactedFields ?? [],
        "overview.digest": r.view.digest,
      });
    }
    case "view.asset-detail": {
      const r = assembleAssetDetail(slice, { now: op.now, assetId: op.assetId });
      if (!r.ok) return opOk({ "detail.ok": false, "detail.rejected": r.rejected });
      const d0 = r.view.devices[0] ?? null;
      return opOk({
        "detail.ok": true,
        "detail.digestVerified": verifyAssetDetailDigest(r.view),
        "detail.posture": r.view.posture,
        "detail.deviceCount": r.view.devices.length,
        "detail.device0.staleness": d0?.staleness ?? null,
        "detail.device0.ageMs": d0?.ageMs ?? null,
        "detail.device0.connectivity": d0?.connectivity ?? null,
        "detail.device0.revisionCount": d0?.revisionCount ?? 0,
        "detail.device0.lastSeq": d0?.lastSeq ?? null,
        "detail.device0.headDigest": d0?.headDigest ?? null,
        "detail.device0.observationCount": d0?.observationCount ?? 0,
        "detail.device0.lastObservationKind": d0?.lastObservationKind ?? null,
        "detail.device0.serial": d0?.serial ?? null,
        "detail.findingsCount": r.view.findings.length,
        "detail.severityCounts": { critical: r.view.severityCounts.critical, warning: r.view.severityCounts.warning, info: r.view.severityCounts.info },
        "detail.redactedFields": r.view.redactedFields,
      });
    }
    case "view.field-mode": {
      const r = assembleFieldView(slice, { now: op.now, ...(op.limits !== undefined ? { limits: op.limits } : {}) });
      if (!r.ok) return opOk({ "field.ok": false, "field.rejected": r.rejected });
      const alerts = r.view.topAlerts;
      const alertLimit = op.limits?.alerts ?? 5;
      const recoveryLimit = op.limits?.recoveries ?? 5;
      const maintenanceLimit = op.limits?.maintenance ?? 5;
      const connectivityLimit = op.limits?.connectivity ?? 12;
      const attributeLimit = op.limits?.attributeKeys ?? 4;
      return opOk({
        "field.ok": true,
        "field.digestVerified": verifyFieldViewDigest(r.view),
        "field.alerts": alerts.entries.length,
        "field.alert0.severity": alerts.entries[0]?.severity ?? null,
        "field.alert0.code": alerts.entries[0]?.code ?? null,
        "field.alert0.lastKnownStaleness": alerts.entries[0]?.lastKnown.staleness ?? null,
        "field.alertOrderSeverities": alerts.entries.map((a) => a.severity),
        "field.alertOrderIsPriority": alerts.entries.every((a, i) => i === 0 || SEVERITY_ORDER[a.severity] >= SEVERITY_ORDER[alerts.entries[i - 1]!.severity]),
        "field.recoveries": r.view.recoveryInProgress.entries.length,
        "field.maintenance": r.view.nextMaintenance.entries.length,
        "field.connectivity": r.view.connectivityStatus.entries.length,
        "field.lastKnownSections": r.view.lastKnownSections,
        "field.sectionsBounded":
          sectionIsBounded(alerts, alertLimit) &&
          sectionIsBounded(r.view.recoveryInProgress, recoveryLimit) &&
          sectionIsBounded(r.view.nextMaintenance, maintenanceLimit) &&
          sectionIsBounded(r.view.connectivityStatus, connectivityLimit),
        "field.connectivityTruncated": r.view.connectivityStatus.truncated,
        "field.connectivityPostures": r.view.connectivityStatus.entries.map((c) => c.posture),
        "field.connectivityLastKnown": r.view.connectivityStatus.entries.map((c) => c.lastKnown.staleness),
        "field.connectivityAttributesBounded": r.view.connectivityStatus.entries.every(
          (c) => Object.keys(c.attributes).length <= attributeLimit,
        ),
        "field.digest": r.view.digest,
      });
    }
    case "view.health-board": {
      const r = assembleHealthBoard(slice, { now: op.now });
      if (!r.ok) return opOk({ "board.ok": false, "board.rejected": r.rejected });
      return opOk({
        "board.ok": true,
        "board.digestVerified": verifyHealthBoardDigest(r.view),
        "board.rows": r.view.rows.length,
        "board.row0.assetId": r.view.rows[0]?.assetId ?? null,
        "board.row0.posture": r.view.rows[0]?.posture ?? null,
        "board.row0.worstFindingCode": r.view.rows[0]?.worstFinding?.code ?? null,
        "board.fleetCritical": r.view.fleet.critical,
        "board.fleetWarning": r.view.fleet.warning,
        "board.fleetClear": r.view.fleet.clear,
        "board.devicesWithNoFindings": r.view.fleet.devicesWithNoFindings,
      });
    }
    case "view.recovery-timeline": {
      const r = assembleRecoveryTimeline(slice, { now: op.now });
      if (!r.ok) return opOk({ "timeline.ok": false, "timeline.rejected": r.rejected });
      const c0 = r.view.cases[0] ?? null;
      return opOk({
        "timeline.ok": true,
        "timeline.digestVerified": verifyRecoveryTimelineDigest(r.view),
        "timeline.open": r.view.open,
        "timeline.case0.caseId": c0?.caseId ?? null,
        "timeline.case0.state": c0?.state ?? null,
        "timeline.case0.steps": c0?.steps.length ?? 0,
        "timeline.case0.stepCommands": c0?.steps.map((s) => s.command) ?? [],
        "timeline.case0.ageMs": c0?.ageMs ?? null,
        "timeline.caseIds": r.view.cases.map((c) => c.caseId),
      });
    }
    case "view.maintenance-board": {
      const r = assembleMaintenanceBoard(slice, { now: op.now });
      if (!r.ok) return opOk({ "mboard.ok": false, "mboard.rejected": r.rejected });
      return opOk({
        "mboard.ok": true,
        "mboard.digestVerified": verifyMaintenanceBoardDigest(r.view),
        "mboard.scheduled": r.view.scheduled.length,
        "mboard.inProgress": r.view.inProgress.length,
        "mboard.completed": r.view.completed.length,
        "mboard.cancelled": r.view.cancelled.length,
        "mboard.upcoming": r.view.upcoming.map((u) => u.planId),
        "mboard.upcoming0.nextRunAt": r.view.upcoming[0]?.nextRunAt ?? null,
        "mboard.scheduled0.orderId": r.view.scheduled[0]?.orderId ?? null,
      });
    }
    case "handoff.publish": {
      const field = assembleFieldView(slice, { now: ctx.clock });
      if (!field.ok) return opRefused(field.rejected, { "handoff.refused": field.rejected });
      const openCases = [...ctx.recoveryCases.values()]
        .filter((c) => c.state !== "resolved" && c.state !== "closed")
        .map((c) => c.id)
        .sort();
      const carrier = makeHandoffCarrier({
        handoffId: op.handoffId,
        fromRole: op.fromRole,
        toRole: op.toRole,
        tenantId: ctx.tenantId,
        producedAt: ctx.clock,
        summary: {
          findings: ctx.findings.length,
          openCaseIds: openCases,
          deviceIds: [...ctx.devices.keys()].sort(),
          intentIdempotencyKey: ctx.lastDraft ? ctx.lastDraft.idempotencyKey : "",
          intentDigest: ctx.lastDraft ? ctx.lastDraft.intentDigest : "",
          fieldViewDigest: field.view.digest,
        },
      });
      ctx.handoff = carrier;
      return opOk({
        "handoff.id": carrier.handoffId,
        "handoff.digestVerified": verifyHandoffCarrier(carrier),
        "handoff.findings": carrier.summary.findings,
        "handoff.openCases": carrier.summary.openCaseIds,
        "handoff.intentKey": carrier.summary.intentIdempotencyKey,
        "handoff.fieldDigest": carrier.summary.fieldViewDigest,
      });
    }
    case "handoff.consume": {
      const carrier = ctx.handoff;
      if (!carrier) return opRefused("no-carrier", { "handoff.received": false, "handoff.reason": "no-carrier" });
      const field = assembleFieldView(buildStateSlice(ctx), { now: ctx.clock });
      const openCases = [...ctx.recoveryCases.values()]
        .filter((c) => c.state !== "resolved" && c.state !== "closed")
        .map((c) => c.id)
        .sort();
      const verified = verifyHandoffCarrier(carrier);
      const idMatches = carrier.handoffId === op.handoffId;
      const findingsMatch = carrier.summary.findings === ctx.findings.length;
      const casesMatch =
        JSON.stringify(carrier.summary.openCaseIds) === JSON.stringify(openCases);
      const fieldMatches = field.ok && field.view.digest === carrier.summary.fieldViewDigest;
      const keyMatches = ctx.lastDraft !== null && ctx.lastDraft.idempotencyKey === carrier.summary.intentIdempotencyKey;
      return opOk({
        "handoff.received": true,
        "handoff.expectedId": op.handoffId,
        "handoff.receivedId": carrier.handoffId,
        "handoff.verified": verified,
        "handoff.idMatches": idMatches,
        "handoff.findingsMatch": findingsMatch,
        "handoff.casesMatch": casesMatch,
        "handoff.fieldDigestMatches": fieldMatches,
        "handoff.intentKeyMatches": keyMatches,
        "handoff.caseStates": openCases.map((id) => ctx.recoveryCases.get(id)?.state ?? null),
      });
    }
    case "mission.run-stages":
    case "mission.resume": {
      return executeMissionOperation(op, ctx);
    }
    case "mission.fold": {
      const journal = ctx.missions.get(op.missionId);
      if (!journal) return opRefused("unknown-mission", { "mission.refused": "unknown-mission" });
      const view = foldMirrorMission(journal);
      const foldTwice = foldMirrorMission(journal);
      return opOk({
        "mission.state": view.state,
        "mission.journalVerified": verifyMirrorJournal(journal),
        "mission.stageStates": view.stages.map((s) => s.state),
        "mission.stageWorkOrderCounts": view.stages.map((s) => s.workOrders.length),
        "mission.stageFirstKeys": view.stages.map((s) => s.workOrders[0]?.idempotencyKey ?? null),
        "mission.stageKeys": view.stages.map((st) => st.workOrders.map((w) => w.idempotencyKey)),
        "mission.lastCheckpointStage": view.lastCheckpoint?.stageId ?? null,
        "mission.foldPure": JSON.stringify(view) === JSON.stringify(foldTwice),
        "mission.journalLength": view.journalLength,
      });
    }
    case "slice.taint-foreign-asset": {
      ctx.foreignAsset = { id: op.assetId, tenantId: op.tenantId };
      return opOk({ "taint.assetId": op.assetId, "taint.tenantId": op.tenantId });
    }
    case "tenancy.probe": {
      return executeTenancyProbe(op, ctx);
    }
    default:
      return opRefused("unknown-operation");
  }
}

// ---------------------------------------------------------------------------
// Tenancy fail-closed probes — every check drives a REAL public API.
// ---------------------------------------------------------------------------

function executeTenancyProbe(
  op: Extract<JourneyOperation, { kind: "tenancy.probe" }>,
  ctx: JourneyContext,
): OpExecution {
  const foreignAssets = ctx.assets.listAssets(op.foreignTenantId).length;
  const enrollment = ctx.enrollment.check(op.foreignTenantId, op.deviceId as never);
  const isolation = assertSameTenant(ctx.tenantId, op.foreignTenantId);
  // Tenant-scoped idempotency separation: the SAME key issued under a
  // foreign tenant creates a SEPARATE command (never a cross-tenant dedup).
  const foreignIssue = issueAdcosCommand(ctx.adcos, {
    tenantId: op.foreignTenantId,
    deviceId: op.deviceId,
    kind: "ping",
    idempotencyKey: op.idempotencyKey,
    actor: EDGE_ACTOR,
    at: ctx.clock,
  });
  // The discarded state is intentional: this is a probe, not a mutation.
  const keySeparated = foreignIssue.ok && !foreignIssue.duplicate;
  // The mismatch probe: the REAL checkEnrollment boundary re-checks the
  // home-tenant enrollment record against the FOREIGN tenant (same device).
  const mismatch = checkEnrollment(ctx.lastEnrollment, op.foreignTenantId, op.deviceId as never);
  const contextCheck = makeTenantContext({
    tenantId: "not-a-tenant",
    actorId: OPERATOR,
    roleId: "role_ops-01",
    establishedAt: ctx.clock,
  });
  return opOk({
    "tenancy.foreignAssets": foreignAssets,
    "tenancy.enrollmentOk": enrollment.ok,
    "tenancy.enrollmentReason": enrollment.ok ? null : enrollment.reason,
    "tenancy.mismatchOk": mismatch.ok,
    "tenancy.mismatchReason": mismatch.ok ? null : mismatch.reason,
    "tenancy.isolationOk": isolation.ok,
    "tenancy.isolationReason": isolation.ok ? null : isolation.reason,
    "tenancy.adcosKeySeparated": keySeparated,
    "tenancy.tenantContextOk": contextCheck.ok,
    "tenancy.tenantContextReason": contextCheck.ok ? null : contextCheck.reason,
  });
}
