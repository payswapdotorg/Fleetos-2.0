/**
 * @fleetos/acceptance-field — F321A edge-ingestion operation executors
 * (Wave 12 lane A). Every executor drives a REAL public API of
 * @fleetos/observations (store-forward + ingestion-limits) or
 * @fleetos/connectivity (offline-buffer) and records readings from the REAL
 * output (acks, digests, refusals — never re-derived).
 */

import {
  signBundle,
  verifyBundleSignature,
  verifyBundleIntegrity,
  receiveBundle,
  buildSequenceReport,
  type BundleObservation,
  type ObservationBundle,
} from "@fleetos/observations";
import { runPipeline } from "@fleetos/observations";
import type { RawObservationInput } from "@fleetos/observations";
import {
  emptyOfflineBuffer,
  captureOfflineEntry,
  stampPostureTransition,
  replayOfflineBuffer,
  sweepExpiredOfflineEntries,
} from "@fleetos/connectivity";
import {
  emptyIngestionBuffer,
  bufferIngestionEntry,
  withTenantCap,
  checkTenantAdmission,
  admitBatchWithLimits,
} from "@fleetos/observations";
import type { JourneyOperation } from "../journey-contracts.js";
import type { JourneyContext } from "../context.js";
import { digestOf } from "../determinism.js";
import { encodePayload } from "../fixtures.js";
import { opOk, opRefused, type OpExecution } from "./common.js";

const AGENT_KEY = "agent-key-field-01";

function bundleObservationsOf(
  deviceId: string,
  entries: ReadonlyArray<{ readonly seq: number; readonly observedAt: number; readonly observationKind: string; readonly payload: Readonly<Record<string, unknown>> }>,
): BundleObservation[] {
  return entries.map((e) => ({
    deviceId,
    seq: e.seq,
    observedAt: e.observedAt,
    kind: e.observationKind,
    payloadDigest: digestOf("sf-payload", { deviceId, seq: e.seq, payload: e.payload }),
  }));
}

export function executeF321AEdgeOperation(op: JourneyOperation, ctx: JourneyContext): OpExecution {
  switch (op.kind) {
    // -------------------------------------------------------------------------
    // Slot 14 — store-and-forward redelivery (@fleetos/observations).
    // -------------------------------------------------------------------------
    case "storeforward.sign": {
      const unsigned = {
        id: op.bundleId,
        tenantId: ctx.tenantId,
        deviceId: op.deviceId,
        seq: op.seq,
        observations: bundleObservationsOf(op.deviceId, op.entries),
        createdAt: ctx.clock,
      };
      const bundle = signBundle(unsigned, op.agentKey);
      ctx.storeForward.bundles.set(op.bundleId, {
        bundle,
        agentKey: op.agentKey,
        payloads: op.entries.map((e) => ({ seq: e.seq, payload: e.payload })),
      });
      return opOk({
        "sf.digest": bundle.digest,
        "sf.signatureVerified": verifyBundleSignature(bundle, op.agentKey),
        "sf.integrityVerified": verifyBundleIntegrity(bundle),
        "sf.observationCount": bundle.observations.length,
      });
    }
    case "storeforward.receive": {
      const stored = ctx.storeForward.bundles.get(op.bundleId);
      if (!stored) return opRefused("unknown-bundle", { "sf.refused": "unknown-bundle" });
      const r = receiveBundle(
        ctx.storeForward.log,
        stored.bundle,
        op.agentKey,
        ctx.clock,
        (obs) => ctx.admission.known.has(`${obs.deviceId}:${obs.seq}`),
      );
      if (!r.ok) return opRefused(r.reason, { "sf.refused": r.reason });
      ctx.storeForward.log = r.log;
      // The receiving side's per-observation verdict becomes REAL admission:
      // every non-duplicate observation runs the REAL pipeline.
      let pipelineAdmitted = 0;
      let pipelineRefused = 0;
      for (const obs of stored.bundle.observations) {
        if (ctx.admission.known.has(`${obs.deviceId}:${obs.seq}`)) continue;
        const source = stored.payloads.find((p) => p.seq === obs.seq);
        if (!source) continue;
        const input: RawObservationInput = {
          tenantId: ctx.tenantId,
          deviceId: obs.deviceId,
          seq: obs.seq,
          observedAt: obs.observedAt,
          kind: obs.kind,
          payload: encodePayload(source.payload),
          receivedAt: ctx.clock,
        };
        const p = runPipeline(ctx.admission, ctx.metrics, input);
        ctx.metrics = p.metrics;
        if (p.ok) {
          ctx.admission = p.store;
          ctx.observations.push(p.observation);
          pipelineAdmitted += 1;
        } else {
          pipelineRefused += 1;
        }
      }
      return opOk({
        "sf.ack.duplicate": r.ack.duplicate,
        "sf.ack.admittedCount": r.ack.admittedCount,
        "sf.ack.duplicateCount": r.ack.duplicateCount,
        "sf.ack.gapSeqs": r.ack.gaps.map((g) => g.missingSeq),
        "sf.ack.firstMissingSeq": r.ack.gaps[0]?.missingSeq ?? null,
        "sf.auditIntent": r.audit.intent,
        "sf.pipelineAdmitted": pipelineAdmitted,
        "sf.pipelineRefused": pipelineRefused,
      });
    }
    case "storeforward.receive-forged": {
      const stored = ctx.storeForward.bundles.get(op.bundleId);
      if (!stored) return opRefused("unknown-bundle", { "sf.refused": "unknown-bundle" });
      const r = receiveBundle(ctx.storeForward.log, stored.bundle, `${stored.agentKey}-forged`, ctx.clock, () => false);
      if (!r.ok) return opRefused(r.reason, { "sf.refused": r.reason });
      return opOk({ "sf.refused": "unexpectedly-admitted" });
    }
    case "storeforward.receive-tampered": {
      const stored = ctx.storeForward.bundles.get(op.bundleId);
      if (!stored) return opRefused("unknown-bundle", { "sf.refused": "unknown-bundle" });
      const tampered: ObservationBundle = {
        ...stored.bundle,
        observations: stored.bundle.observations.map((o, i) =>
          i === op.observationIndex ? { ...o, payloadDigest: digestOf("tampered", { seq: o.seq }) } : o,
        ),
      };
      const r = receiveBundle(ctx.storeForward.log, tampered, stored.agentKey, ctx.clock, () => false);
      if (!r.ok) return opRefused(r.reason, { "sf.refused": r.reason });
      return opOk({ "sf.refused": "unexpectedly-admitted" });
    }
    case "storeforward.sequence-report": {
      const report = buildSequenceReport(ctx.storeForward.log, ctx.tenantId, op.deviceId);
      return opOk({
        "seq.lastReceived": report.lastReceivedSeq,
        "seq.expectedNext": report.expectedNextSeq,
        "seq.knownGaps": report.knownGaps,
      });
    }
    // -------------------------------------------------------------------------
    // Slot 15 — offline buffer capture/replay (@fleetos/connectivity).
    // -------------------------------------------------------------------------
    case "offline.open-buffer": {
      const buffer = emptyOfflineBuffer(ctx.tenantId, op.deviceId, {
        maxEntries: op.maxEntries,
        ttlMs: op.ttlMs,
        overflow: op.overflow,
        maxPostureTransitions: 8,
      });
      ctx.offlineBuffers.set(op.deviceId, buffer);
      return opOk({ "buffer.deviceId": buffer.deviceId, "buffer.count": 0, "buffer.maxEntries": buffer.policy.maxEntries });
    }
    case "offline.capture": {
      const buffer = ctx.offlineBuffers.get(op.deviceId);
      if (!buffer) return opRefused("unknown-buffer", { "offline.refused": "unknown-buffer" });
      const r = captureOfflineEntry(buffer, {
        entryId: op.entryId,
        kind: op.entryKind,
        payload: op.payload,
        at: op.at,
        posture: op.posture,
        ...(op.tenantId !== undefined ? { tenantId: op.tenantId } : {}),
      });
      if (!r.ok) return opRefused(r.reason, { "offline.refused": r.reason });
      ctx.offlineBuffers.set(op.deviceId, r.buffer);
      return opOk({
        "entry.sequence": r.entry.sequence,
        "entry.capturedPosture": r.entry.capturedPosture,
        "buffer.count": r.buffer.entries.length,
        "buffer.droppedOldest": r.buffer.droppedOldest,
        "buffer.evictedId": r.evicted ? r.evicted.entryId : null,
      });
    }
    case "offline.stamp-posture": {
      const buffer = ctx.offlineBuffers.get(op.deviceId);
      if (!buffer) return opRefused("unknown-buffer", { "offline.refused": "unknown-buffer" });
      const next = stampPostureTransition(buffer, { from: op.from, to: op.to, at: op.at });
      ctx.offlineBuffers.set(op.deviceId, next);
      return opOk({
        "posture.transitions": next.postureLog.length,
        "posture.truncated": next.postureLogTruncated,
        "posture.lastTo": next.postureLog[next.postureLog.length - 1]?.to ?? null,
      });
    }
    case "offline.replay": {
      const buffer = ctx.offlineBuffers.get(op.deviceId);
      if (!buffer) return opRefused("unknown-buffer", { "offline.refused": "unknown-buffer" });
      const report = replayOfflineBuffer(buffer, op.posture, op.now);
      return opOk({
        "replay.count": report.entries.length,
        "replay.order": report.entries.map((e) => e.entryId),
        "replay.divergenceIds": report.divergences.map((d) => d.entryId),
        "replay.divergenceReason": report.divergences[0]?.reason ?? null,
        "replay.replayedPosture": report.replayedPosture,
        "replay.digest": report.replayDigest,
        "replay.auditIntent": report.audit.intent,
      });
    }
    case "offline.sweep": {
      const buffer = ctx.offlineBuffers.get(op.deviceId);
      if (!buffer) return opRefused("unknown-buffer", { "offline.refused": "unknown-buffer" });
      const r = sweepExpiredOfflineEntries(buffer, op.now);
      ctx.offlineBuffers.set(op.deviceId, r.buffer);
      return opOk({
        "sweep.evictedIds": r.evicted.map((e) => e.entry.entryId),
        "sweep.evictedReasons": r.evicted.map((e) => e.reason),
        "sweep.remaining": r.buffer.entries.length,
      });
    }
    // -------------------------------------------------------------------------
    // Slot 21 (substitute) — ingestion admission discipline
    // (@fleetos/observations ingestion-limits — the F310C §3.6 public surface).
    // -------------------------------------------------------------------------
    case "limits.open-buffer": {
      const buffer = emptyIngestionBuffer(ctx.tenantId, {
        maxEntries: op.maxEntries,
        maxTotalPayloadBytes: op.maxTotalPayloadBytes,
        overflow: op.overflow,
      });
      ctx.ingestionBuffer = buffer;
      return opOk({ "ibuf.overflow": buffer.policy.overflow, "ibuf.maxEntries": buffer.policy.maxEntries, "ibuf.count": 0 });
    }
    case "limits.buffer": {
      if (!ctx.ingestionBuffer) return opRefused("unknown-buffer", { "ibuf.refused": "unknown-buffer" });
      const r = bufferIngestionEntry(ctx.ingestionBuffer, {
        deviceId: op.deviceId,
        payload: new Uint8Array(op.payloadBytes),
        at: op.at,
      });
      if (!r.ok) return opRefused(r.reason, { "ibuf.refused": r.reason, "ibuf.rejectedNewest": r.buffer.rejectedNewest });
      ctx.ingestionBuffer = r.buffer;
      return opOk({
        "ibuf.sequence": r.entry.sequence,
        "ibuf.count": r.buffer.entries.length,
        "ibuf.totalPayloadBytes": r.buffer.totalPayloadBytes,
        "ibuf.droppedOldest": r.buffer.droppedOldest,
        "ibuf.evictedSequence": r.evicted ? r.evicted.sequence : null,
        "ibuf.rejectedNewest": r.buffer.rejectedNewest,
      });
    }
    case "limits.admission-cap": {
      ctx.admissionCaps = withTenantCap(ctx.admissionCaps, ctx.tenantId, op.cap);
      const entry = ctx.admissionCaps.tenants.get(ctx.tenantId);
      return opOk({ "caps.tenant": ctx.tenantId, "caps.cap": entry ? entry.cap : null, "caps.used": entry ? entry.used : 0 });
    }
    case "limits.check-admission": {
      const r = checkTenantAdmission(ctx.admissionCaps, ctx.tenantId, op.requested);
      if (!r.ok) {
        return opRefused(r.reason, {
          "admission.refused": r.reason,
          "admission.cap": r.cap,
          "admission.used": r.used,
          "admission.requested": r.requested,
        });
      }
      return opOk({ "admission.cap": r.cap, "admission.used": r.used, "admission.remaining": r.remaining });
    }
    case "limits.batch": {
      const inputs: RawObservationInput[] = [];
      for (let i = 0; i < op.count; i++) {
        const seq = op.fromSeq + i;
        inputs.push({
          tenantId: ctx.tenantId,
          deviceId: op.deviceId,
          seq,
          observedAt: op.firstObservedAt + i * op.stepMs,
          kind: op.observationKind,
          payload: encodePayload({ batchIndex: i, seq }),
          receivedAt: ctx.clock,
        });
      }
      const r = admitBatchWithLimits(ctx.admission, ctx.metrics, ctx.admissionCaps, inputs, {
        maxBatchSize: op.maxBatchSize,
        maxPayloadBytesPerItem: op.maxPayloadBytesPerItem,
      });
      if (!r.ok) {
        return opRefused(r.reason, { "batch.refused": r.reason, "batch.size": r.size, "batch.maxBatchSize": r.maxBatchSize });
      }
      ctx.admission = r.store;
      ctx.metrics = r.metrics;
      ctx.admissionCaps = r.caps;
      const firstRefused = r.acks.find((a) => !a.ok);
      const capRefused = r.acks.find((a): a is (typeof r.acks)[number] & { readonly reason: "tenant-cap-exceeded"; readonly cap?: number; readonly used?: number; readonly requested?: number } => !a.ok && a.reason === "tenant-cap-exceeded");
      return opOk({
        "batch.admitted": r.admittedCount,
        "batch.duplicates": r.duplicateCount,
        "batch.refusedCount": r.refusedCount,
        "batch.firstRefusalReason": firstRefused ? (firstRefused.reason ?? null) : null,
        "batch.capExceededUsed": capRefused?.used ?? null,
        "batch.capExceededCap": capRefused?.cap ?? null,
      });
    }
    default:
      return opRefused("unknown-operation");
  }
}

/** Re-exported for the runner's dispatch sets (F321A edge family). */
export const F321A_EDGE_OP_KINDS: ReadonlySet<string> = new Set([
  "storeforward.sign",
  "storeforward.receive",
  "storeforward.receive-forged",
  "storeforward.receive-tampered",
  "storeforward.sequence-report",
  "offline.open-buffer",
  "offline.capture",
  "offline.stamp-posture",
  "offline.replay",
  "offline.sweep",
  "limits.open-buffer",
  "limits.buffer",
  "limits.admission-cap",
  "limits.check-admission",
  "limits.batch",
]);

/** The agent key the store-forward journeys sign with (fixed fixture). */
export const STORE_FORWARD_AGENT_KEY = AGENT_KEY;
