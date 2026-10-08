/**
 * @fleetos/acceptance-field — recovery / maintenance / connectivity operation
 * executors. Every executor drives a REAL public API of @fleetos/recovery,
 * @fleetos/maintenance or @fleetos/connectivity and records readings from
 * the REAL output (states, refusals, digests — never re-derived).
 */

import { openRecoveryCase, applyRecoveryCommand } from "@fleetos/recovery";
import type { RecoveryCommand } from "@fleetos/recovery";
import { createMaintenanceOrder, applyMaintenanceCommand, nextRun } from "@fleetos/maintenance";
import type { ServicePlan } from "@fleetos/maintenance";
import { proposeIntent, transitionRegistryIntent, activeIntentForDevice, rollupFleetPosture, verifyFleetPostureDigest } from "@fleetos/connectivity";
import type { JourneyOperation } from "../journey-contracts.js";
import type { JourneyContext } from "../context.js";
import { OPERATOR } from "../fixtures.js";
import { opOk, opRefused, type OpExecution } from "./common.js";

export function executeCareOperation(op: JourneyOperation, ctx: JourneyContext): OpExecution {
  switch (op.kind) {
    case "recovery.open": {
      const rc = openRecoveryCase({
        id: op.caseId as never,
        tenantId: ctx.tenantId,
        deviceId: op.deviceId,
        openedAt: ctx.clock,
      });
      ctx.recoveryCases.set(op.caseId, rc);
      return opOk({ "case.state": rc.state, "case.openedAt": rc.openedAt, "case.evidenceCount": rc.evidence.length });
    }
    case "recovery.command": {
      const rc = ctx.recoveryCases.get(op.caseId);
      if (!rc) return opRefused("unknown-case", { "case.refused": "unknown-case" });
      const command: RecoveryCommand = {
        kind: op.command,
        reason: op.reason,
        initiatedAt: ctx.clock,
        evidence: op.withEvidence ? ctx.findings.map((f) => ({ digest: f.evidence[0]?.digest ?? "no-digest", kind: f.code, observedAt: f.observedAt })) : undefined,
      };
      const r = applyRecoveryCommand(rc, command);
      if (!r.ok) return opRefused(r.reason, { "case.refused": r.reason });
      ctx.recoveryCases.set(op.caseId, r.case);
      return opOk({
        "case.state": r.case.state,
        "case.historyLength": r.case.history.length,
        "case.evidenceCount": r.case.evidence.length,
        ...(r.case.resolution ? { "case.resolutionRootCause": r.case.resolution.rootCause } : {}),
      });
    }
    case "maintenance.plan": {
      if (!ctx.assets.lookupAsset(ctx.tenantId, op.assetId as never)) {
        return opRefused("unknown-asset", { "plan.refused": "unknown-asset" });
      }
      const plan: ServicePlan = {
        id: op.planId as never,
        tenantId: ctx.tenantId,
        assetId: op.assetId,
        kind: op.planKind,
        schedule: op.schedule,
        createdAt: ctx.clock,
      };
      ctx.plans = [...ctx.plans, plan];
      return opOk({ "plan.id": plan.id, "plan.nextRunAt": nextRun(plan.schedule, ctx.clock) });
    }
    case "maintenance.order": {
      if (!ctx.plans.some((p) => p.id === op.planId)) {
        return opRefused("unknown-plan", { "order.refused": "unknown-plan" });
      }
      const order = createMaintenanceOrder({
        id: op.orderId as never,
        tenantId: ctx.tenantId,
        planId: op.planId as never,
        createdAt: ctx.clock,
        assignedTo: op.assignedTo,
      });
      ctx.orders.set(op.orderId, order);
      return opOk({ "order.state": order.state, "order.createdAt": order.createdAt });
    }
    case "maintenance.command": {
      const order = ctx.orders.get(op.orderId);
      if (!order) return opRefused("unknown-order", { "order.refused": "unknown-order" });
      const r = applyMaintenanceCommand(order, { kind: op.command, reason: op.reason, initiatedAt: ctx.clock });
      if (!r.ok) return opRefused(r.reason, { "order.refused": r.reason });
      ctx.orders.set(op.orderId, r.order);
      const cancelled = r.order.cancelledReason;
      return opOk({ "order.state": r.order.state, ...(cancelled !== undefined ? { "order.cancelledReason": cancelled } : {}) });
    }
    case "connectivity.record": {
      const r = ctx.connectivity.recordStatus({
        tenantId: ctx.tenantId,
        deviceId: op.deviceId,
        state: op.state,
        observedAt: op.observedAt,
        actor: OPERATOR,
      });
      if (!r.ok) return opRefused(r.reason, { "conn.refused": r.reason });
      return opOk({ "conn.state": r.record.state, "conn.observedAt": r.record.observedAt, "conn.auditIntent": r.audit.intent });
    }
    case "connectivity.propose-intent": {
      const r = proposeIntent(ctx.intentRegistry, {
        tenantId: ctx.tenantId,
        deviceId: op.deviceId,
        desiredState: op.desiredState,
        idempotencyKey: op.idempotencyKey,
        at: ctx.clock,
        actor: OPERATOR,
      });
      if (!r.ok) return opRefused(r.reason, { "intent.refused": r.reason });
      ctx.intentRegistry = r.state;
      return opOk({ "intent.id": r.intentId, "intent.duplicate": r.duplicate });
    }
    case "connectivity.transition-intent": {
      const intentId = ctx.intentRegistry.byIdempotencyKey.get(`${ctx.tenantId}|${op.idempotencyKey}`);
      if (intentId === undefined) {
        return opRefused("unknown-intent", { "intent.refused": "unknown-intent" });
      }
      const r = transitionRegistryIntent(ctx.intentRegistry, {
        tenantId: ctx.tenantId,
        intentId,
        eventKind: op.eventKind,
        now: ctx.clock,
        actor: OPERATOR,
        reason: op.reason,
        ...(op.grant
          ? {
              authorization: {
                grantedBy: op.grant.grantedBy,
                authorizationDigest: op.grant.authorizationDigest,
                grantedAt: op.grant.grantedAt,
                expiresAt: op.grant.expiresAt,
              },
            }
          : {}),
        ...(op.ceiling ? { ceiling: { effect: op.ceiling.effect, reason: op.ceiling.reason } } : {}),
      });
      if (!r.ok) return opRefused(r.reason, { "intent.refused": r.reason });
      ctx.intentRegistry = r.state;
      return opOk({ "intent.state": r.record.state, "intent.event": r.event.kind });
    }
    case "connectivity.rollup-posture": {
      const rollup = rollupFleetPosture({
        tenantId: ctx.tenantId,
        records: ctx.connectivity.listStatuses(ctx.tenantId),
        registry: ctx.intentRegistry,
        ttl: { staleMs: 30_000, deadMs: 120_000 },
        now: ctx.clock,
      });
      const first = ctx.devices.size > 0 ? [...ctx.devices.keys()].sort()[0] : null;
      const firstRollup = first ? rollup.assets.find((a) => a.deviceId === first) : undefined;
      const active = first ? activeIntentForDevice(ctx.intentRegistry, ctx.tenantId, first) : null;
      return opOk({
        "rollup.total": rollup.counts.total,
        "rollup.aligned": rollup.counts.aligned,
        "rollup.divergent": rollup.counts.divergent,
        "rollup.unknown": rollup.counts.unknown,
        "rollup.observedOnline": rollup.counts.observedOnline,
        "rollup.observedDegraded": rollup.counts.observedDegraded,
        "rollup.observedOffline": rollup.counts.observedOffline,
        "rollup.observedUnknown": rollup.counts.observedUnknown,
        "rollup.digest": rollup.digest,
        "rollup.digestVerified": verifyFleetPostureDigest(rollup),
        "rollup.firstDevice": first ?? null,
        "rollup.firstDesired": firstRollup ? firstRollup.desired : null,
        "rollup.firstObserved": firstRollup ? firstRollup.observed : null,
        "rollup.firstAlignment": firstRollup ? firstRollup.alignment : null,
        "rollup.firstIntentState": active ? active.state : "none",
      });
    }
    default:
      return opRefused("unknown-operation");
  }
}
