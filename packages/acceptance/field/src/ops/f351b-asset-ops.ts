/**
 * @fleetos/acceptance-field — F351B operation executors: the asset
 * registry lifecycle discipline (assets package; census §1 rows A1–A4,
 * zero corpus coverage at base `4f59ffe`).
 *
 * Every executor drives a REAL public API of @fleetos/assets
 * (evaluateAssetTransition, applyTwinRevision, latestAttributes,
 * projectTwin) and records readings from the REAL outputs — never
 * re-derived. A refused evaluation/revision is the REAL rejection code:
 * the executor surfaces it as an op refusal so `expectRefusal` steps
 * prove the lifecycle/append-only laws fail-closed.
 */

import {
  applyTwinRevision,
  evaluateAssetTransition,
  latestAttributes,
  projectTwin,
  type TwinRevisionInput,
} from "@fleetos/assets";
import type { JourneyOperation } from "../journey-contracts.js";
import type { JourneyContext } from "../context.js";
import { opOk, opRefused, type OpExecution } from "./common.js";

function twinOf(ctx: JourneyContext, deviceId: string) {
  return ctx.f351bTwins.get(deviceId) ?? null;
}

export function executeF351BAssetOperation(op: JourneyOperation, ctx: JourneyContext): OpExecution {
  switch (op.kind) {
    case "ar.lifecycle-evaluate": {
      const result = evaluateAssetTransition(op.state, op.command);
      if (result.ok) {
        return opOk({
          "ar.evalOk": true,
          "ar.evalFrom": result.from,
          "ar.evalTo": result.to,
          "ar.evalReason": null,
        });
      }
      return opRefused(result.reason, {
        "ar.evalOk": false,
        "ar.evalReason": result.reason,
        "ar.evalFrom": op.state,
        "ar.evalTo": op.state,
      });
    }
    case "ar.twin-revise": {
      const input: TwinRevisionInput = {
        deviceId: op.deviceId as never,
        tenantId: ctx.tenantId,
        seq: op.seq,
        observedAt: op.observedAt,
        appliedAt: op.appliedAt,
        source: op.source,
        attributes: { ...op.attributes },
        ...(op.observationRef != null
          ? {
              observationRef: {
                deviceId: op.observationRef.deviceId as never,
                seq: op.observationRef.seq as never,
                observedAt: op.observationRef.observedAt,
                payloadDigest: op.observationRef.payloadDigest,
              },
            }
          : {}),
      };
      const result = applyTwinRevision(twinOf(ctx, op.deviceId), input);
      if (!result.ok) {
        const current = twinOf(ctx, op.deviceId);
        return opRefused(result.reason, {
          "ar.revOk": false,
          "ar.revReason": result.reason,
          "ar.revLastSeq": current ? current.lastSeq : null,
          "ar.revCount": current ? current.revisions.length : 0,
        });
      }
      ctx.f351bTwins.set(op.deviceId, result.twin);
      return opOk({
        "ar.revOk": true,
        "ar.revReason": null,
        "ar.revLastSeq": result.twin.lastSeq,
        "ar.revCount": result.twin.revisions.length,
        "ar.revLastObservedAt": result.twin.lastObservedAt,
      });
    }
    case "ar.twin-latest": {
      const twin = twinOf(ctx, op.deviceId);
      if (twin === null) return opRefused("unknown-device", { "ar.latestKnown": false });
      const attributes = latestAttributes(twin);
      return opOk({
        "ar.latestKnown": true,
        "ar.latestKeys": Object.keys(attributes).sort(),
        "ar.latestOdometer": (attributes["odometer"] ?? null) as number | null,
      });
    }
    case "ar.twin-project": {
      const twin = twinOf(ctx, op.deviceId);
      if (twin === null) return opRefused("unknown-device", { "ar.projectKnown": false });
      const projection = projectTwin(twin.revisions, twin.deviceId, twin.tenantId);
      return opOk({
        "ar.projectKnown": true,
        "ar.projectState": projection.state,
        "ar.projectLastSeq": projection.lastSeq,
        "ar.projectAttributeCount": Object.keys(projection.attributes).length,
        "ar.projectHeadDigest": projection.headDigest,
        "ar.projectLastObservedAt": projection.lastObservedAt,
      });
    }
    default:
      return opRefused("unknown-operation");
  }
}
