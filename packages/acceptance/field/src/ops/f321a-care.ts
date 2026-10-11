/**
 * @fleetos/acceptance-field — F321A care operation executors (Wave 12 lane
 * A). Every executor drives a REAL public API of @fleetos/health (diagnosis
 * + anomaly signals), @fleetos/recovery (evidence-gated commands +
 * pagination) or @fleetos/maintenance (scheduling-scale) and records
 * readings from the REAL output (states, rules, acks, refusals).
 */

import {
  proposeDiagnosis,
  applyDiagnosisCommand,
  supersedeDiagnosis,
  buildRollingWindowFromObservations,
  windowStats,
  runAnomalyDetection,
  evaluateAnomaly,
  propagateConfidence,
  emptyAnomalyState,
  defaultConfidenceRules,
  type EvidenceWithKind,
} from "@fleetos/health";
import {
  applyRecoveryCommandWithEvidenceChain,
  verifyCaseEvidenceChainPostMortem,
  paginateRecoveryCases,
  paginateCasesForTenant,
  encodeRecoveryCaseCursor,
  type EvidenceChainRule,
} from "@fleetos/recovery";
import type { RecoveryCommand, EvidenceRefLike } from "@fleetos/recovery";
import {
  buildMaintenanceCalendar,
  checkCalendarConflict,
  findNextFreeSlot,
  scheduleWindowsBatch,
  type CalendarWindow,
} from "@fleetos/maintenance";
import type { JourneyOperation } from "../journey-contracts.js";
import type { JourneyContext } from "../context.js";
import { TECHNICIAN } from "../fixtures.js";
import { digestOf } from "../determinism.js";
import { opOk, opRefused, type OpExecution } from "./common.js";

/** Evidence refs drawn from the REAL triage findings (provenance-honest). */
function findingsEvidence(ctx: JourneyContext, count: number, kindPrefix: string): EvidenceRefLike[] {
  const out: EvidenceRefLike[] = [];
  for (const f of ctx.findings) {
    for (const e of f.evidence) {
      if (out.length >= count) return out;
      out.push({ digest: e.digest, kind: `${kindPrefix}.finding`, observedAt: f.observedAt });
    }
  }
  return out;
}

export function executeF321ACareOperation(op: JourneyOperation, ctx: JourneyContext): OpExecution {
  switch (op.kind) {
    // -------------------------------------------------------------------------
    // Slot 16 — diagnosis lifecycle (@fleetos/health kernel).
    // -------------------------------------------------------------------------
    case "diagnosis.propose": {
      const evidence = op.fromFindings ? findingsEvidence(ctx, 1, "observation") : [{ digest: digestOf("dx", { hypothesisId: op.hypothesisId }), kind: "observation.manual", observedAt: ctx.clock }];
      const r = proposeDiagnosis({
        id: op.hypothesisId,
        tenantId: ctx.tenantId,
        deviceId: op.deviceId,
        candidateCauses: op.candidateCauses,
        confidence: op.confidence,
        evidence,
        emittedAt: ctx.clock,
        actor: TECHNICIAN,
        supersedes: null,
      });
      if (!r.ok) return opRefused(r.reason, { "dx.refused": r.reason });
      ctx.diagnoses.set(op.hypothesisId, r.hypothesis);
      return opOk({
        "dx.state": r.hypothesis.state,
        "dx.transitionSeq": r.hypothesis.transitionSeq,
        "dx.evidenceCount": r.hypothesis.evidence.length,
        "dx.supersedes": r.hypothesis.supersedes,
        "dx.auditIntent": r.audit.intent,
      });
    }
    case "diagnosis.command": {
      const current = ctx.diagnoses.get(op.hypothesisId);
      if (!current) return opRefused("unknown-hypothesis", { "dx.refused": "unknown-hypothesis" });
      const newEvidence =
        op.newEvidenceCount !== undefined && op.newEvidenceCount > 0
          ? findingsEvidence(ctx, op.newEvidenceCount, "verification")
          : undefined;
      const r = applyDiagnosisCommand(current, {
        kind: op.command,
        reason: op.reason,
        newEvidence,
        at: ctx.clock,
        actor: TECHNICIAN,
      });
      if (!r.ok) return opRefused(r.reason, { "dx.refused": r.reason });
      ctx.diagnoses.set(op.hypothesisId, r.next);
      return opOk({
        "dx.from": r.from,
        "dx.to": r.to,
        "dx.transitionSeq": r.next.transitionSeq,
        "dx.evidenceCount": r.next.evidence.length,
        "dx.auditIntent": r.audit.intent,
      });
    }
    case "diagnosis.supersede": {
      const prior = ctx.diagnoses.get(op.hypothesisId);
      if (!prior) return opRefused("unknown-hypothesis", { "dx.refused": "unknown-hypothesis" });
      const r = supersedeDiagnosis({
        prior,
        successorId: op.successorId,
        candidateCauses: op.candidateCauses,
        confidence: op.confidence,
        evidence: findingsEvidence(ctx, 1, "observation"),
        at: ctx.clock,
        actor: TECHNICIAN,
      });
      if (!r.ok) return opRefused(r.reason, { "dx.refused": r.reason });
      ctx.diagnoses.set(op.hypothesisId, r.prior);
      ctx.diagnoses.set(op.successorId, r.successor);
      return opOk({
        "sup.priorState": r.prior.state,
        "sup.priorSupersededBy": r.prior.supersededBy,
        "sup.successorState": r.successor.state,
        "sup.successorSupersedes": r.successor.supersedes,
        "sup.successorConfidence": r.successor.confidence,
        "sup.auditIntent": r.audit.intent,
      });
    }
    // -------------------------------------------------------------------------
    // Slot 17 — anomaly detection + confidence propagation (@fleetos/health
    // kernel-signals).
    // -------------------------------------------------------------------------
    case "anomaly.window": {
      const deviceObservations = ctx.observations.filter((o) => o.deviceId === op.deviceId);
      const window = buildRollingWindowFromObservations(deviceObservations, op.maxSize, (o) => {
        // The extractor's parameter is the health kernel's ObservationLike
        // (payload-free); the REAL observations we feed carry the raw payload.
        const payload = (o as { readonly payload?: Readonly<Uint8Array> }).payload;
        if (!payload) return null;
        try {
          const parsed: unknown = JSON.parse(new TextDecoder().decode(payload));
          if (typeof parsed !== "object" || parsed === null) return null;
          const v = (parsed as Record<string, unknown>)[op.field];
          return typeof v === "number" ? v : null;
        } catch {
          return null;
        }
      });
      const stats = windowStats(window);
      return opOk({
        "window.count": stats.count,
        "window.mean": stats.mean,
        "window.min": stats.min,
        "window.max": stats.max,
        "window.first": stats.first,
        "window.last": stats.last,
      });
    }
    case "anomaly.run": {
      const r = runAnomalyDetection(op.values, {
        enterThreshold: op.enterThreshold,
        exitThreshold: op.exitThreshold,
      });
      return opOk({
        "anomaly.finalFlag": r.finalState.anomaly,
        "anomaly.flapCount": r.flapCount,
        "anomaly.lastValue": r.finalState.lastValue,
        "anomaly.enteredAt": r.finalState.enteredAt,
        "anomaly.exitedAt": r.finalState.exitedAt,
      });
    }
    case "anomaly.evaluate": {
      const state = ctx.anomalyStates.get(op.deviceId) ?? emptyAnomalyState();
      const next = evaluateAnomaly(state, op.value, { enterThreshold: op.enterThreshold, exitThreshold: op.exitThreshold }, op.at);
      ctx.anomalyStates.set(op.deviceId, next);
      return opOk({
        "anomaly.anomaly": next.anomaly,
        "anomaly.transitionCount": next.transitionCount,
        "anomaly.lastValue": next.lastValue,
      });
    }
    case "anomaly.propagate": {
      const current = ctx.diagnoses.get(op.hypothesisId);
      if (!current) return opRefused("unknown-hypothesis", { "dx.refused": "unknown-hypothesis" });
      const evidence: EvidenceWithKind[] = [
        ...Array.from({ length: op.corroborations }, (_, i) => ({
          digest: digestOf("corr", { hypothesisId: op.hypothesisId, index: i }),
          kind: "observation.corroborating",
          observedAt: ctx.clock,
          evidenceKind: "corroborating" as const,
        })),
        ...Array.from({ length: op.contradictions }, (_, i) => ({
          digest: digestOf("contr", { hypothesisId: op.hypothesisId, index: i }),
          kind: "observation.contradicting",
          observedAt: ctx.clock,
          evidenceKind: "contradicting" as const,
        })),
      ];
      const r = propagateConfidence(current, evidence, defaultConfidenceRules());
      return opOk({
        "conf.confidence": r.confidence,
        "conf.corroborations": r.corroborations,
        "conf.contradictions": r.contradictions,
      });
    }
    // -------------------------------------------------------------------------
    // Slot 18 — evidence-gated recovery (@fleetos/recovery).
    // -------------------------------------------------------------------------
    case "recovery.command-gated": {
      const rc = ctx.recoveryCases.get(op.caseId);
      if (!rc) return opRefused("unknown-case", { "gated.refused": "unknown-case" });
      const evidence: EvidenceRefLike[] = op.evidence.map((e) => ({
        digest: digestOf("gated-evidence", { caseId: op.caseId, kind: e.kind, observedAt: e.observedAt }),
        kind: e.kind,
        observedAt: e.observedAt,
      }));
      const command: RecoveryCommand = {
        kind: op.command,
        reason: op.reason,
        evidence,
        initiatedAt: ctx.clock,
      };
      const r = applyRecoveryCommandWithEvidenceChain(rc, command);
      if (!r.ok) return opRefused(r.reason, { "gated.refused": r.reason });
      ctx.recoveryCases.set(op.caseId, r.case);
      const chain = r.evidenceChain;
      const rule: EvidenceChainRule | undefined = chain.ok ? chain.rule : undefined;
      return opOk({
        "gated.from": r.from,
        "gated.to": r.to,
        "gated.requiredKinds": rule ? rule.required.map((q) => q.kind) : [],
        "gated.evidenceCount": r.case.evidence.length,
        "gated.auditIntent": r.audit.intent,
      });
    }
    case "recovery.postmortem": {
      const rc = ctx.recoveryCases.get(op.caseId);
      if (!rc) return opRefused("unknown-case", { "gated.refused": "unknown-case" });
      const r = verifyCaseEvidenceChainPostMortem(rc);
      return opOk({
        "pm.transitionsChecked": r.transitionsChecked,
        "pm.rulesSatisfied": r.rulesSatisfied,
        "pm.failedCount": r.failedTransitions.length,
        "pm.failedReasons": r.failedTransitions.map((f) => f.reason),
      });
    }
    case "recovery.paginate": {
      const cases = [...ctx.recoveryCases.values()];
      let cursor = op.cursor;
      if (cursor === undefined && op.afterCaseId !== undefined) {
        const anchor = ctx.recoveryCases.get(op.afterCaseId);
        if (!anchor) return opRefused("unknown-case", { "page.refused": "unknown-case" });
        cursor = encodeRecoveryCaseCursor({ tenantId: anchor.tenantId, openedAt: anchor.openedAt, caseId: anchor.id });
      }
      const r = paginateRecoveryCases(cases, { limit: op.limit, ...(cursor !== undefined ? { cursor } : {}) });
      if (!r.ok) return opRefused(r.reason, { "page.refused": r.reason });
      return opOk({
        "page.count": r.page.items.length,
        "page.ids": r.page.items.map((c) => c.id),
        "page.hasMore": r.page.hasMore,
        "page.nextCursorNonNull": r.page.nextCursor !== null,
      });
    }
    case "recovery.paginate-tenant": {
      const cases = [...ctx.recoveryCases.values()];
      const tenantId = op.asTenant ?? ctx.tenantId;
      const cursor =
        op.foreignCursorFrom !== undefined
          ? encodeRecoveryCaseCursor({ tenantId: op.foreignCursorFrom, openedAt: ctx.startedAt, caseId: "rc_foreign-cursor" })
          : op.cursor;
      const r = paginateCasesForTenant(cases, tenantId, { limit: op.limit, ...(cursor !== undefined ? { cursor } : {}) });
      if (!r.ok) return opRefused(r.reason, { "page.refused": r.reason });
      return opOk({
        "page.count": r.page.items.length,
        "page.ids": r.page.items.map((c) => c.id),
        "page.hasMore": r.page.hasMore,
      });
    }
    // -------------------------------------------------------------------------
    // Slot 19 — maintenance calendar scale (@fleetos/maintenance).
    // -------------------------------------------------------------------------
    case "calendar.build": {
      const windows: CalendarWindow[] = op.windows.map((w) => ({
        id: w.id,
        tenantId: ctx.tenantId,
        assetId: w.assetId,
        startsAt: w.startsAt,
        endsAt: w.endsAt,
      }));
      const r = buildMaintenanceCalendar(windows);
      if (!r.ok) return opRefused(r.reason, { "cal.refused": r.reason });
      ctx.calendar = r.calendar;
      const firstKey = [...r.calendar.slots.keys()].sort()[0] ?? null;
      const firstWindows = firstKey ? (r.calendar.slots.get(firstKey) ?? []) : [];
      const firstWindow = firstWindows[0] ?? null;
      return opOk({
        "cal.slotCount": r.calendar.slots.size,
        "cal.firstSlot": firstKey,
        "cal.firstSlotWindows": firstWindows.map((w) => w.id),
        // The executing tenant (the real input the windows were stamped with)
        // + the REAL stored window's own ids — tenant-scoping is asserted
        // real-vs-real (reading-equals), never against a fixture literal, so
        // the journey holds under ANY workspace tenant (adoption seam).
        "cal.runtimeTenantId": ctx.tenantId,
        "cal.firstWindowTenantId": firstWindow?.tenantId ?? null,
        "cal.firstWindowAssetId": firstWindow?.assetId ?? null,
      });
    }
    case "calendar.conflict": {
      const proposed: CalendarWindow = {
        id: op.window.id,
        tenantId: op.tenantId ?? ctx.tenantId,
        assetId: op.window.assetId,
        startsAt: op.window.startsAt,
        endsAt: op.window.endsAt,
      };
      const conflict = checkCalendarConflict(ctx.calendar, proposed);
      return opOk({
        "conflict.existingId": conflict ? conflict.existingId : null,
        "conflict.reason": conflict ? conflict.reason : null,
        "conflict.overlapStart": conflict ? conflict.overlapStart : null,
        "conflict.overlapEnd": conflict ? conflict.overlapEnd : null,
      });
    }
    case "calendar.next-free": {
      const r = findNextFreeSlot(ctx.calendar, {
        tenantId: ctx.tenantId,
        assetId: op.assetId,
        durationMs: op.durationMs,
        notBefore: op.notBefore,
        horizonMs: op.horizonMs,
      });
      if (!r.ok) return opRefused(r.reason, { "slot.refused": r.reason, "slot.searchedUntil": r.searchedUntil });
      return opOk({ "slot.startsAt": r.startsAt, "slot.endsAt": r.endsAt, "slot.searchedUntil": r.searchedUntil });
    }
    case "calendar.batch": {
      const proposals: CalendarWindow[] = op.proposals.map((w) => ({
        id: w.id,
        tenantId: ctx.tenantId,
        assetId: w.assetId,
        startsAt: w.startsAt,
        endsAt: w.endsAt,
      }));
      const r = scheduleWindowsBatch(ctx.calendar, proposals, {
        policy: {
          maxProposalsPerBatch: op.maxProposalsPerBatch,
          resolution: op.resolution,
          reallocationHorizonMs: op.reallocationHorizonMs,
        },
        now: op.now,
      });
      if (!r.ok) {
        return opRefused(r.reason, {
          "batch.refused": r.reason,
          "batch.size": r.size,
          "batch.maxProposalsPerBatch": r.maxProposalsPerBatch,
        });
      }
      ctx.calendar = r.calendar;
      const reallocatedAck = r.acks.find((a): a is (typeof r.acks)[number] & { readonly outcome: "reallocated"; readonly window: CalendarWindow } => a.ok && a.outcome === "reallocated");
      const conflictAck = r.acks.find((a): a is (typeof r.acks)[number] & { readonly conflict: { readonly overlapStart: number } } => !a.ok && a.conflict !== undefined);
      return opOk({
        "batch.scheduled": r.scheduledCount,
        "batch.reallocated": r.reallocatedCount,
        "batch.refusedCount": r.refusedCount,
        "batch.outcomes": r.acks.map((a) => (a.ok ? a.outcome : (a.reason ?? "refused"))),
        "batch.reallocatedStartsAt": reallocatedAck ? reallocatedAck.window.startsAt : null,
        "batch.firstConflictOverlapStart": conflictAck ? conflictAck.conflict.overlapStart : null,
      });
    }
    default:
      return opRefused("unknown-operation");
  }
}

/** Re-exported for the runner's dispatch sets (F321A care family). */
export const F321A_CARE_OP_KINDS: ReadonlySet<string> = new Set([
  "diagnosis.propose",
  "diagnosis.command",
  "diagnosis.supersede",
  "anomaly.window",
  "anomaly.run",
  "anomaly.evaluate",
  "anomaly.propagate",
  "recovery.command-gated",
  "recovery.postmortem",
  "recovery.paginate",
  "recovery.paginate-tenant",
  "calendar.build",
  "calendar.conflict",
  "calendar.next-free",
  "calendar.batch",
]);
