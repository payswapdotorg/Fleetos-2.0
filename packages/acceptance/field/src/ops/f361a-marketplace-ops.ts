/**
 * @fleetos/acceptance-field — F361A operation executors: the marketplace
 * receipt→asset enrollment discipline (assets package; the F361A census
 * at base `cefd588`, zero corpus coverage).
 *
 * Every executor drives a REAL public API of @fleetos/assets — the
 * ReceiptEnrollmentDirectory (recordReceipt / verifyReceipt /
 * openEnrollment / completeEnrollment / findEnrollment / getReceipt)
 * which itself consumes the EXISTING registry (AssetDirectory
 * admitAsset/transitionAsset/lookupAsset/listAssets + applyTwinRevision
 * through the shared repository port) — and records readings from the
 * REAL outputs, never re-derived. A refused operation surfaces the REAL
 * rejection code so `expectRefusal` steps prove the receipt/enrollment
 * laws fail-closed; the duplicate guard's duplicate=true is an OK result
 * (the ORIGINAL record returns — the readings prove it).
 */

import type { JourneyOperation } from "../journey-contracts.js";
import type { JourneyContext } from "../context.js";
import { opOk, opRefused, type OpExecution } from "./common.js";

export function executeF361AMarketplaceOperation(
  op: JourneyOperation,
  ctx: JourneyContext,
): OpExecution {
  const tenant = "tenantId" in op && op.tenantId !== undefined ? op.tenantId : ctx.tenantId;
  switch (op.kind) {
    case "mre.record": {
      const r = ctx.f361aEnrollment.recordReceipt({
        evidenceRef: op.evidenceRef,
        tenantId: tenant,
        siteId: op.siteId,
        supplierOrderRef: op.supplierOrderRef,
        serial: op.serial,
        assetTag: op.assetTag,
        conditionOnArrival: op.conditionOnArrival,
        warrantyRef: op.warrantyRef,
        capturedAt: op.capturedAt,
        recordedAt: op.recordedAt,
      });
      if (!r.ok) return opRefused(r.reason, { "mre.recOk": false, "mre.recReason": r.reason });
      return opOk({
        "mre.recOk": true,
        "mre.recState": r.evidence.state,
        "mre.recDuplicate": r.duplicate,
        "mre.recSerial": r.evidence.serial,
        "mre.recReason": null,
      });
    }
    case "mre.verify": {
      const r = ctx.f361aEnrollment.verifyReceipt({
        tenantId: tenant,
        evidenceRef: op.evidenceRef,
        expectation: {
          supplierOrderRef: op.supplierOrderRef,
          expectedSerial: op.expectedSerial,
          expectedAssetTag: op.expectedAssetTag,
          expectedCondition: op.expectedCondition,
        },
        decidedAt: op.decidedAt,
      });
      if (!r.ok) {
        return opRefused(r.reason, { "mre.verOk": false, "mre.verReason": r.reason });
      }
      return opOk({
        "mre.verOk": true,
        "mre.verState": r.evidence.state,
        "mre.verReasons": [...r.evidence.discrepancyReasons],
        "mre.verReason": null,
      });
    }
    case "mre.enroll-open": {
      const r = ctx.f361aEnrollment.openEnrollment({
        tenantId: tenant,
        evidenceRef: op.evidenceRef,
        assetId: op.assetId,
        displayName: op.displayName,
        kind: op.assetKind,
        ...(op.deviceId !== undefined ? { deviceId: op.deviceId } : {}),
        at: op.at,
        actor: op.actor,
      });
      if (!r.ok) {
        return opRefused(r.reason, { "mre.openOk": false, "mre.openReason": r.reason });
      }
      return opOk({
        "mre.openOk": true,
        "mre.openState": r.enrollment.state,
        "mre.openDuplicate": r.duplicate,
        "mre.openEnrollmentId": r.enrollment.enrollmentId,
        "mre.openAssetId": r.enrollment.assetId,
        "mre.openSerial": r.enrollment.serial,
        "mre.openCustody": r.enrollment.custodySiteId,
        "mre.openWarranty": r.enrollment.warrantyRef,
        "mre.openReason": null,
      });
    }
    case "mre.enroll-complete": {
      const r = ctx.f361aEnrollment.completeEnrollment({
        tenantId: tenant,
        serial: op.serial,
        ...(op.deviceId !== undefined ? { deviceId: op.deviceId } : {}),
        at: op.at,
        actor: op.actor,
      });
      if (!r.ok) {
        return opRefused(r.reason, { "mre.cmpOk": false, "mre.cmpReason": r.reason });
      }
      return opOk({
        "mre.cmpOk": true,
        "mre.cmpState": r.enrollment.state,
        "mre.cmpDuplicate": r.duplicate,
        "mre.cmpEnrolledAt": r.enrollment.enrolledAt,
        "mre.cmpTwinLinked": r.twinLinked,
        "mre.cmpReason": null,
      });
    }
    case "mre.enrollment-lookup": {
      const record = ctx.f361aEnrollment.findEnrollment(tenant, op.serial);
      // A foreign/unknown read sees NOTHING (fail-closed by construction).
      if (record === null) {
        return opRefused("unknown-enrollment", { "mre.lookupKnown": false });
      }
      return opOk({
        "mre.lookupKnown": true,
        "mre.lookupState": record.state,
        "mre.lookupAssetId": record.assetId,
        "mre.lookupSerial": record.serial,
        "mre.lookupCustody": record.custodySiteId,
        "mre.lookupEnrolledAt": record.enrolledAt,
      });
    }
    case "mre.receipt-lookup": {
      const evidence = ctx.f361aEnrollment.getReceipt(tenant, op.evidenceRef);
      if (evidence === null) {
        return opRefused("unknown-receipt", { "mre.rcpKnown": false });
      }
      return opOk({
        "mre.rcpKnown": true,
        "mre.rcpState": evidence.state,
        "mre.rcpSerial": evidence.serial,
        "mre.rcpReasons": [...evidence.discrepancyReasons],
        "mre.rcpCapturedAt": evidence.capturedAt,
      });
    }
    case "mre.registry-count": {
      // The EXISTING registry's own read side (never a second truth).
      const assets = ctx.assets.listAssets(ctx.tenantId);
      return opOk({
        "mre.registryCount": assets.length,
        "mre.registryLifecycles": assets.map((a) => a.lifecycle),
      });
    }
    case "mre.asset-lifecycle": {
      const asset = ctx.assets.lookupAsset(ctx.tenantId, op.assetId as never);
      if (asset === null) {
        return opRefused("unknown-asset", { "mre.assetKnown": false });
      }
      return opOk({
        "mre.assetKnown": true,
        "mre.assetLifecycle": asset.lifecycle,
        "mre.assetEnrolledAt": asset.enrolledAt,
        "mre.assetDisplayName": asset.displayName,
      });
    }
    default:
      return opRefused("unknown-operation");
  }
}
