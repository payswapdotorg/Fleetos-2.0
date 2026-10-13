/**
 * @fleetos/acceptance-field — F341A D17 sixth-slot executor: the observations
 * kernel admitted-log + immutability-audit law (Wave 14 lane A; TL-adjudicated
 * per F340 §2 D17).
 *
 * CENSUS EVIDENCE (machine-verified at base 81be8e7): the Wave 1
 * `packages/observations/src/kernel.ts` family — admitToLog /
 * emptyAdmittedLog / listObservationsForDevice / assertObservationImmutable —
 * is public through @fleetos/observations' root index and had ZERO
 * acceptance-corpus coverage (grep over packages/acceptance/field/** =
 * zero matches). Every executor below drives those REAL APIs and records
 * readings from their REAL outputs: the kernel's typed admission refusals
 * (e.g. non-monotonic-seq) and the three immutability mismatch reasons
 * surface as op refusals so `expectRefusal` steps prove them end-to-end.
 */

import {
  admitToLog,
  assertObservationImmutable,
  emptyAdmittedLog,
  listObservationsForDevice,
  type AdmittedObservationLog,
} from "@fleetos/observations";
import type { JourneyOperation } from "../journey-contracts.js";
import type { JourneyContext } from "../context.js";
import { opOk, opRefused, type OpExecution } from "./common.js";
import { encodePayload } from "../fixtures.js";

function logOf(ctx: JourneyContext, logId: string): AdmittedObservationLog | undefined {
  return ctx.admittedLogs.get(logId);
}

export function executeF341AKernelOperation(op: JourneyOperation, ctx: JourneyContext): OpExecution {
  switch (op.kind) {
    case "kern.log-open": {
      // The REAL empty admitted log (the kernel's authoritative read side).
      const log = emptyAdmittedLog();
      ctx.admittedLogs.set(op.logId, log);
      return opOk({
        "kern.logEmpty": log.byKey.size === 0,
        "kern.logSize": log.byKey.size,
        "kern.lastSeq": 0,
      });
    }
    case "kern.admit": {
      const log = logOf(ctx, op.logId);
      if (!log) return opRefused("unknown-log", { "kern.admitRefused": "unknown-log", "kern.admitted": false });
      const input = {
        tenantId: ctx.tenantId,
        deviceId: op.deviceId,
        seq: op.seq,
        observedAt: op.observedAt,
        kind: op.observationKind,
        payload: encodePayload(op.payload),
        admittedAt: op.admittedAt,
      };
      const r = admitToLog(log, input);
      if (!r.ok) {
        // The REAL typed admission refusal — honest, never a silent drop.
        return opRefused(r.reason, { "kern.admitRefused": r.reason, "kern.admitted": false });
      }
      ctx.admittedLogs.set(op.logId, r.log);
      return opOk({
        "kern.admitted": true,
        "kern.ackId": r.ack.id,
        "kern.ackDuplicate": r.ack.duplicate,
        "kern.obsId": r.observation.id,
        "kern.payloadDigest": r.ack.payloadDigest,
        "kern.logSize": r.log.byKey.size,
        "kern.lastSeq": r.log.lastSeqByDevice.get(op.deviceId) ?? 0,
        // The idempotent duplicate path returns the log UNTOUCHED (the same
        // object reference); a new admission returns an immutably-extended log.
        "kern.sameLogReference": r.log === log,
        "kern.auditIntent": r.audit.intent,
        "kern.auditActor": r.audit.actor,
        "kern.auditTenant": r.audit.tenant,
        "kern.auditDigest": r.audit.digest,
      });
    }
    case "kern.list-device": {
      const log = logOf(ctx, op.logId);
      if (!log) return opRefused("unknown-log", { "kern.listRefused": "unknown-log" });
      const tenantId = op.tenantId ?? ctx.tenantId;
      // The REAL fail-closed per-device listing: a foreign tenant's call
      // filters to an empty list (tenant isolation by construction).
      const listing = listObservationsForDevice(log, tenantId, op.deviceId);
      const foreign = tenantId !== ctx.tenantId;
      return opOk({
        "kern.listCount": listing.length,
        "kern.listSeqs": listing.map((o) => o.seq as number),
        "kern.listIds": listing.map((o) => o.id),
        "kern.lastSeq": log.lastSeqByDevice.get(op.deviceId) ?? 0,
        "kern.foreignTenant": foreign,
        "kern.foreignListEmpty": foreign && listing.length === 0,
        "kern.listTenantMismatched": listing.some((o) => o.tenantId !== tenantId),
      });
    }
    case "kern.immutability-probe": {
      const log = logOf(ctx, op.logId);
      if (!log) return opRefused("unknown-log", { "kern.checkRefused": "unknown-log" });
      const stored = log.byKey.get(`${op.deviceId}:${op.seq}`);
      if (!stored) return opRefused("no-admitted-observation", { "kern.checkRefused": "no-admitted-observation" });
      // The candidate re-presents the stored identity; each tamper mode
      // mutates EXACTLY one field so each of the kernel's three REAL
      // mismatch reasons fires in isolation.
      const candidate = {
        deviceId: op.tamper === "device" ? `${stored.deviceId}-forged` : stored.deviceId,
        seq: op.tamper === "seq" ? (stored.seq as number) + 1 : (stored.seq as number),
        payloadDigest: op.tamper === "digest" ? "0".repeat(64) : stored.payloadDigest,
      };
      const check = assertObservationImmutable(stored, candidate);
      if (!check.ok) {
        // The REAL typed tamper refusal (device-mismatch / seq-mismatch /
        // digest-mismatch): the stored record is the source of truth.
        return opRefused(check.reason, { "kern.checkRefused": check.reason, "kern.checkOk": false });
      }
      return opOk({
        "kern.checkOk": true,
        "kern.immutableOk": true,
        "kern.checkedId": check.observation.id,
        "kern.checkedSeq": check.observation.seq as number,
        "kern.checkDigest": check.digest,
      });
    }
    default:
      return opRefused("unknown-operation");
  }
}
