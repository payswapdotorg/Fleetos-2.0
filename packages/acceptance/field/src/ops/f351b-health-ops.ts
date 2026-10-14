/**
 * @fleetos/acceptance-field — F351B operation executors: the equipment
 * health threshold escalation + diagnosis registry discipline (health
 * package; census §1 rows H1–H6, zero corpus coverage at base `4f59ffe`).
 *
 * Every executor drives a REAL public API of @fleetos/health
 * (triageWithConfidence — the count-based escalation threshold law with
 * honest degradation; emptyDiagnosisRegistry, registerDiagnosis,
 * lookupDiagnosis, listDiagnosesForDevice, currentDiagnosisForDevice —
 * the tenant-scoped registry) and records readings from the REAL
 * outputs — never re-derived. A foreign-tenant registry read is the REAL
 * fail-closed null/empty: the executor surfaces it as an op refusal so
 * `expectRefusal` steps prove the tenant law.
 */

import {
  currentDiagnosisForDevice,
  emptyDiagnosisRegistry,
  listDiagnosesForDevice,
  lookupDiagnosis,
  registerDiagnosis,
  triageWithConfidence,
  type DiagnosisHypothesisRecord,
  type ObservationLike,
} from "@fleetos/health";
import type { JourneyOperation } from "../journey-contracts.js";
import type { JourneyContext } from "../context.js";
import { opOk, opRefused, type OpExecution } from "./common.js";

function observationsOf(op: Extract<JourneyOperation, { kind: "hx.triage" }>, tenantId: string): ObservationLike[] {
  return op.observations.map((o) => ({
    tenantId,
    deviceId: o.deviceId as never,
    seq: 0,
    observedAt: o.observedAt,
    kind: o.kind,
    payloadDigest: o.payloadDigest,
  }));
}

export function executeF351BHealthOperation(op: JourneyOperation, ctx: JourneyContext): OpExecution {
  switch (op.kind) {
    case "hx.triage": {
      const result = triageWithConfidence(observationsOf(op, ctx.tenantId), op.triagedAt, ctx.tenantId);
      return opOk({
        "hx.findingCount": result.findings.length,
        "hx.firstSeverity": result.findings.length > 0 ? result.findings[0]!.severity : null,
        "hx.firstConfidence": result.findings.length > 0 ? result.findings[0]!.confidence : null,
        "hx.firstDeviceId": result.findings.length > 0 ? result.findings[0]!.deviceId : null,
        "hx.severities": result.findings.map((f) => f.severity),
        "hx.degradation": result.degradation,
        "hx.auditIntent": result.audit.intent,
        "hx.auditDigest": result.audit.digest,
      });
    }
    case "hx.triage-empty": {
      const result = triageWithConfidence([], op.triagedAt, ctx.tenantId);
      return opOk({
        "hx.findingCount": result.findings.length,
        "hx.degradation": result.degradation,
        "hx.auditIntent": result.audit.intent,
      });
    }
    case "hx.registry-open": {
      ctx.f351bDiagnosisRegistry = emptyDiagnosisRegistry();
      return opOk({ "hx.registryCount": 0 });
    }
    case "hx.diagnosis-register": {
      const record: DiagnosisHypothesisRecord = {
        id: op.hypothesisId,
        tenantId: ctx.tenantId,
        deviceId: op.deviceId as never,
        state: op.state,
        candidateCauses: [...op.candidateCauses],
        confidence: op.confidence,
        evidence: op.evidence.map((e) => ({ digest: e.digest, kind: e.kind, observedAt: e.observedAt })),
        emittedAt: op.emittedAt,
        supersededBy: op.supersededBy ?? null,
        supersedes: op.supersedes ?? null,
        transitionSeq: op.transitionSeq,
      };
      ctx.f351bDiagnosisRegistry = registerDiagnosis(ctx.f351bDiagnosisRegistry, record);
      return opOk({ "hx.registryCount": ctx.f351bDiagnosisRegistry.byId.size });
    }
    case "hx.diagnosis-lookup": {
      const tenantId = op.tenantId ?? ctx.tenantId;
      const found = lookupDiagnosis(ctx.f351bDiagnosisRegistry, tenantId, op.hypothesisId);
      if (found === null) {
        // The REAL fail-closed lookup: foreign tenant or unknown id —
        // honest absence, never a fabricated record.
        const foreign = tenantId !== ctx.tenantId;
        return opRefused(foreign ? "tenant-fail-closed" : "unknown-diagnosis", {
          "hx.lookupRefused": foreign ? "tenant-fail-closed" : "unknown-diagnosis",
          "hx.lookupState": null,
        });
      }
      return opOk({ "hx.lookupState": found.state, "hx.lookupSupersededBy": found.supersededBy, "hx.lookupTransitionSeq": found.transitionSeq });
    }
    case "hx.diagnosis-list": {
      const tenantId = op.tenantId ?? ctx.tenantId;
      const list = listDiagnosesForDevice(ctx.f351bDiagnosisRegistry, tenantId, op.deviceId as never);
      if (tenantId !== ctx.tenantId) {
        // The REAL fail-closed listing: a foreign tenant sees NOTHING.
        return opRefused("tenant-fail-closed", {
          "hx.listRefused": "tenant-fail-closed",
          "hx.listCount": list.length,
        });
      }
      return opOk({
        "hx.listCount": list.length,
        "hx.listStates": list.map((h) => h.state),
        "hx.listIds": list.map((h) => h.id),
      });
    }
    case "hx.diagnosis-current": {
      const current = currentDiagnosisForDevice(ctx.f351bDiagnosisRegistry, ctx.tenantId, op.deviceId as never);
      return opOk({
        "hx.currentId": current ? current.id : null,
        "hx.currentState": current ? current.state : null,
        "hx.currentTransitionSeq": current ? current.transitionSeq : null,
      });
    }
    default:
      return opRefused("unknown-operation");
  }
}
