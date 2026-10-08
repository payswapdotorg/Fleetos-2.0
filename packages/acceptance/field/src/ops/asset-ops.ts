/**
 * @fleetos/acceptance-field — asset / enrollment / twin / observation / health
 * operation executors. Every executor drives a REAL public API of
 * @fleetos/assets, @fleetos/observations or @fleetos/health and records
 * readings from the REAL output (ids, digests, refusals — never re-derived).
 */

import { admitTwinRevision } from "@fleetos/assets";
import type { Device } from "@fleetos/assets";
import { runPipeline } from "@fleetos/observations";
import type { RawObservationInput } from "@fleetos/observations";
import { triage } from "@fleetos/health";
import type { JourneyOperation } from "../journey-contracts.js";
import type { JourneyContext } from "../context.js";
import { encodePayload, OPERATOR, TECHNICIAN } from "../fixtures.js";
import { opOk, opRefused, type OpExecution } from "./common.js";

function lastObservationFor(ctx: JourneyContext, deviceId: string) {
  let last = null;
  for (const o of ctx.observations) if (o.deviceId === deviceId) last = o;
  return last;
}

export function executeAssetOperation(op: JourneyOperation, ctx: JourneyContext): OpExecution {
  switch (op.kind) {
    case "asset.admit": {
      const r = ctx.assets.admitAsset({
        assetId: op.assetId,
        tenantId: ctx.tenantId,
        kind: op.assetKind,
        displayName: op.displayName,
        createdAt: ctx.clock,
        actor: OPERATOR,
      });
      if (!r.ok) return opRefused(r.reason, { "asset.admitted": false, "asset.refused": r.reason });
      return opOk({ "asset.admitted": true, "asset.lifecycle": r.asset.lifecycle, "asset.auditIntent": r.audit.intent });
    }
    case "asset.activate": {
      const r = ctx.assets.transitionAsset({
        tenantId: ctx.tenantId,
        assetId: op.assetId as never,
        command: "activate",
        at: ctx.clock,
        actor: OPERATOR,
      });
      if (!r.ok) return opRefused(r.reason, { "asset.refused": r.reason });
      return opOk({ "asset.lifecycle": r.asset.lifecycle, "asset.enrolledAt": r.asset.enrolledAt });
    }
    case "device.enroll": {
      if (!ctx.assets.lookupAsset(ctx.tenantId, op.assetId as never)) {
        return opRefused("unknown-asset", { "enroll.refused": "unknown-asset" });
      }
      const r = ctx.enrollment.enroll({
        deviceId: op.deviceId,
        tenantId: ctx.tenantId,
        enrolledAt: ctx.clock,
        actor: TECHNICIAN,
      });
      if (!r.ok) return opRefused(r.reason, { "enroll.refused": r.reason });
      const device: Device = {
        id: op.deviceId as never,
        tenantId: ctx.tenantId,
        assetId: op.assetId as never,
        serial: op.serial,
        enrolledAt: r.enrollment.enrolledAt,
      };
      ctx.devices.set(op.deviceId, device);
      ctx.lastEnrollment = r.enrollment;
      return opOk({
        "enroll.enrolled": true,
        "enroll.auditIntent": r.audit.intent,
        "enroll.auditDigest": r.audit.digest,
        "enroll.deviceSerial": device.serial,
      });
    }
    case "enrollment.check": {
      const tenant = op.tenantId ?? ctx.tenantId;
      const r = ctx.enrollment.check(tenant, op.deviceId as never);
      if (!r.ok) return opOk({ "enrollment.ok": false, "enrollment.reason": r.reason });
      return opOk({ "enrollment.ok": true, "enrollment.enrolledAt": r.enrollment.enrolledAt });
    }
    case "twin.admit": {
      const current = ctx.twins.get(op.deviceId) ?? null;
      const parent = current ? current.revisions[current.revisions.length - 1] : null;
      const parentDigest = (parent as { revisionDigest?: string } | null)?.revisionDigest ?? undefined;
      const observation = lastObservationFor(ctx, op.deviceId);
      const r = admitTwinRevision(current, {
        deviceId: op.deviceId as never,
        tenantId: ctx.tenantId,
        seq: op.seq,
        observedAt: op.observedAt,
        appliedAt: ctx.clock,
        source: "observation",
        attributes: op.attributes,
        observationRef: observation
          ? {
              deviceId: observation.deviceId,
              seq: observation.seq as number,
              observedAt: observation.observedAt,
              payloadDigest: observation.payloadDigest,
            }
          : undefined,
        parentDigest,
        actor: OPERATOR,
      });
      if (!r.ok) return opRefused(r.reason, { "twin.refused": r.reason });
      ctx.twins.set(op.deviceId, r.twin);
      return opOk({
        "twin.lastSeq": r.twin.lastSeq as number,
        "twin.revisionCount": r.twin.revisions.length,
        "twin.headDigest": r.revision.revisionDigest,
        "twin.lastObservedAt": r.twin.lastObservedAt,
        "twin.auditIntent": r.audit.intent,
      });
    }
    case "observation.ingest": {
      const input: RawObservationInput = {
        tenantId: ctx.tenantId,
        deviceId: op.deviceId,
        seq: op.seq,
        observedAt: op.observedAt,
        kind: op.observationKind,
        payload: encodePayload(op.payload),
        receivedAt: ctx.clock,
      };
      const r = runPipeline(ctx.admission, ctx.metrics, input);
      ctx.metrics = r.metrics;
      if (!r.ok) {
        return opRefused(`${r.stage}:${r.reason}`, {
          "obs.admitted": false,
          "obs.stage": r.stage,
          "obs.reason": r.reason,
        });
      }
      ctx.admission = r.store;
      ctx.observations.push(r.observation);
      return opOk({
        "obs.admitted": true,
        "obs.id": r.observation.id,
        "obs.duplicate": r.ack.duplicate,
        "obs.payloadDigest": r.ack.payloadDigest,
        "obs.auditIntent": r.audit.intent,
      });
    }
    case "observation.ingest-batch": {
      let admitted = 0;
      let duplicates = 0;
      let lastReason: string | null = null;
      for (let i = 0; i < op.count; i++) {
        const seq = op.fromSeq + i;
        const observedAt = op.firstObservedAt + i * op.stepMs;
        const input: RawObservationInput = {
          tenantId: ctx.tenantId,
          deviceId: op.deviceId,
          seq,
          observedAt,
          kind: op.observationKind,
          payload: encodePayload({ batchIndex: i, seq }),
          receivedAt: ctx.clock,
        };
        const r = runPipeline(ctx.admission, ctx.metrics, input);
        ctx.metrics = r.metrics;
        if (!r.ok) {
          lastReason = `${r.stage}:${r.reason}`;
          continue;
        }
        ctx.admission = r.store;
        ctx.observations.push(r.observation);
        if (r.ack.duplicate) duplicates += 1;
        else admitted += 1;
      }
      return opOk({
        "batch.admitted": admitted,
        "batch.duplicates": duplicates,
        "batch.lastSeq": op.fromSeq + op.count - 1,
        "batch.failures": lastReason === null ? 0 : 1,
        "batch.failureDetail": lastReason,
      });
    }
    case "health.triage": {
      const r = triage(ctx.observations, ctx.clock);
      ctx.findings = [...r.findings];
      return opOk({
        "triage.count": r.findings.length,
        "triage.degradation": r.degradation,
        "triage.findings": r.findings.map((f) => ({ deviceId: f.deviceId, code: f.code, severity: f.severity })),
        "triage.severities": r.findings.map((f) => f.severity),
        "triage.evidenceDigests": r.findings.flatMap((f) => f.evidence.map((e) => e.digest)),
      });
    }
    default:
      return opRefused("unknown-operation");
  }
}
