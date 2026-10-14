/**
 * @fleetos/acceptance-commerce — the F362 transaction-spine step drivers,
 * part 2 (the F361A segment).
 *
 * Interprets the spn-* receipt/enrollment steps against the REAL public
 * entry points of `@fleetos/assets` (the F361A lane surfaces, driven from
 * the commerce corpus for the first time — the composition site):
 *   - ReceiptEnrollmentDirectory.recordReceipt / verifyReceipt / getReceipt
 *     (recorded → verified | discrepancy; terminal states refuse
 *     re-decision — the append-only law);
 *   - ReceiptEnrollmentDirectory.openEnrollment / completeEnrollment /
 *     findEnrollment — the candidate → enrolled machine over the REAL
 *     registry: the duplicate-serial guard (an existing enrollment for the
 *     same tenant+serial returns the ORIGINAL with duplicate=true, the
 *     registry untouched; a same-serial different-tag attempt refuses
 *     serial-tag-conflict), the first opening consuming the REAL
 *     AssetDirectory.admitAsset, the completion consuming the REAL
 *     AssetDirectory.transitionAsset(activate) + the REAL
 *     applyTwinRevision (the serial/tag + custody + warranty link);
 *   - AssetDirectory.lookupAsset / listAssets — the authoritative asset
 *     record (never a second truth: the enrollment is a typed LINK).
 *
 * The wiring is the F361A field-context precedent verbatim: ONE
 * InMemoryAssetRepository backs the AssetDirectory, the enrollment
 * directory AND the twin port — the receipt-enrollment directory consumes
 * the SAME asset truth (never a second registry).
 *
 * The population lives in a WeakMap keyed by JourneyState — a fresh world
 * per run keeps every run pure and deterministic.
 */

import type { FactValue } from "./journey-contracts.js";
import type { SpineEnrollmentStep, SpineReceiptStep } from "./journey-contracts-f362.js";
import type { JourneyState } from "./journey-world.js";
import { OTHER_TENANT, logPush } from "./journey-world.js";
import {
  AssetDirectory,
  InMemoryAssetRepository,
  ReceiptEnrollmentDirectory,
  type AssetId,
  type AssetLifecycleState,
} from "@fleetos/assets";

export type DriverFacts = Record<string, FactValue>;

interface SpineReceiptSeam {
  readonly repo: InMemoryAssetRepository;
  readonly assets: AssetDirectory;
  readonly directory: ReceiptEnrollmentDirectory;
}

const seams = new WeakMap<JourneyState, SpineReceiptSeam>();

function seamFor(state: JourneyState): SpineReceiptSeam {
  let seam = seams.get(state);
  if (seam === undefined) {
    // The F361A field-context wiring: ONE repository backs the directory,
    // the registry read API and the twin port — the SAME asset truth.
    const repo = new InMemoryAssetRepository();
    const assets = new AssetDirectory(repo);
    seam = { repo, assets, directory: new ReceiptEnrollmentDirectory(assets, undefined, repo) };
    seams.set(state, seam);
  }
  return seam;
}

const LIFECYCLE_ORDER: readonly AssetLifecycleState[] = ["admitted", "active", "retired"];

function lifecycleRank(value: AssetLifecycleState): number {
  const index = LIFECYCLE_ORDER.indexOf(value);
  return index === -1 ? 99 : index;
}

export async function runSpineReceiptStep(
  step: SpineReceiptStep | SpineEnrollmentStep,
  state: JourneyState,
): Promise<DriverFacts> {
  const seam = seamFor(state);
  switch (step.kind) {
    case "spn-receipt-record": {
      const result = seam.directory.recordReceipt({
        evidenceRef: step.evidenceRef,
        tenantId: state.tenant.tenantId,
        siteId: step.siteId,
        supplierOrderRef: step.supplierOrderRef,
        serial: step.serial,
        assetTag: step.assetTag,
        conditionOnArrival: step.conditionOnArrival,
        warrantyRef: step.warrantyRef,
        capturedAt: step.capturedAt,
        recordedAt: step.recordedAt,
      });
      if (!result.ok) {
        logPush(state, "spn.log", `receipt:${step.evidenceRef}:refused:${result.reason}`);
        return { [`spn.receipt.${step.factKey}.ok`]: false, [`spn.receipt.${step.factKey}.reasonCode`]: result.reason };
      }
      logPush(
        state,
        "spn.log",
        `receipt:${step.evidenceRef}:${result.duplicate ? "duplicate" : "recorded"}:${result.evidence.state}:${result.evidence.serial}`,
      );
      return {
        [`spn.receipt.${step.factKey}.ok`]: true,
        [`spn.receipt.${step.factKey}.reasonCode`]: null,
        [`spn.receipt.${step.factKey}.duplicate`]: result.duplicate,
        [`spn.receipt.${step.factKey}.state`]: result.evidence.state,
        [`spn.receipt.${step.factKey}.serial`]: result.evidence.serial,
        [`spn.receipt.${step.factKey}.assetTag`]: result.evidence.assetTag,
        [`spn.receipt.${step.factKey}.supplierOrderRef`]: result.evidence.supplierOrderRef,
        [`spn.receipt.${step.factKey}.warrantyRef`]: result.evidence.warrantyRef,
        [`spn.receipt.${step.factKey}.siteId`]: result.evidence.siteId,
      };
    }
    case "spn-receipt-verify": {
      const result = seam.directory.verifyReceipt({
        tenantId: state.tenant.tenantId,
        evidenceRef: step.evidenceRef,
        expectation: {
          supplierOrderRef: step.expectSupplierOrderRef,
          expectedSerial: step.expectSerial,
          expectedAssetTag: step.expectAssetTag,
          expectedCondition: step.expectCondition,
        },
        decidedAt: step.decidedAt,
      });
      if (!result.ok) {
        logPush(state, "spn.log", `verify:${step.evidenceRef}:refused:${result.reason}`);
        return {
          [`spn.verify.${step.factKey}.ok`]: false,
          [`spn.verify.${step.factKey}.reasonCode`]: result.reason,
          [`spn.verify.${step.factKey}.state`]: null,
          [`spn.verify.${step.factKey}.reasons`]: [],
        };
      }
      logPush(state, "spn.log", `verify:${step.evidenceRef}:${result.evidence.state}:${result.evidence.discrepancyReasons.join(",") || "-"}`);
      return {
        [`spn.verify.${step.factKey}.ok`]: true,
        [`spn.verify.${step.factKey}.reasonCode`]: null,
        [`spn.verify.${step.factKey}.state`]: result.evidence.state,
        [`spn.verify.${step.factKey}.reasons`]: [...result.evidence.discrepancyReasons],
        [`spn.verify.${step.factKey}.decidedAt`]: result.evidence.decidedAt,
      };
    }
    case "spn-receipt-read": {
      const caller = (step.callerTenant ?? "own") === "own" ? state.tenant : OTHER_TENANT;
      const found = seam.directory.getReceipt(caller.tenantId, step.evidenceRef);
      logPush(state, "spn.log", `receipt-read:${step.callerTenant ?? "own"}:${step.evidenceRef}:${found?.state ?? "null"}`);
      return {
        [`spn.receiptRead.${step.factKey}.found`]: found !== null,
        [`spn.receiptRead.${step.factKey}.state`]: found?.state ?? null,
        [`spn.receiptRead.${step.factKey}.serial`]: found?.serial ?? null,
      };
    }
    case "spn-enrollment-open": {
      const result = seam.directory.openEnrollment({
        tenantId: state.tenant.tenantId,
        evidenceRef: step.evidenceRef,
        assetId: step.assetId,
        displayName: step.displayName,
        kind: step.assetKind,
        ...(step.deviceId !== undefined ? { deviceId: step.deviceId } : {}),
        at: step.at,
        actor: step.actor,
      });
      if (!result.ok) {
        logPush(state, "spn.log", `enroll-open:${step.evidenceRef}:refused:${result.reason}`);
        return {
          [`spn.enrollOpen.${step.factKey}.ok`]: false,
          [`spn.enrollOpen.${step.factKey}.reasonCode`]: result.reason,
          [`spn.enrollOpen.${step.factKey}.duplicate`]: false,
        };
      }
      logPush(
        state,
        "spn.log",
        `enroll-open:${step.evidenceRef}:${result.duplicate ? "duplicate" : result.enrollment.state}:${result.enrollment.enrollmentId}:${result.enrollment.assetId}`,
      );
      return {
        [`spn.enrollOpen.${step.factKey}.ok`]: true,
        [`spn.enrollOpen.${step.factKey}.reasonCode`]: null,
        [`spn.enrollOpen.${step.factKey}.duplicate`]: result.duplicate,
        [`spn.enrollOpen.${step.factKey}.state`]: result.enrollment.state,
        [`spn.enrollOpen.${step.factKey}.enrollmentId`]: result.enrollment.enrollmentId,
        [`spn.enrollOpen.${step.factKey}.assetId`]: result.enrollment.assetId,
        [`spn.enrollOpen.${step.factKey}.serial`]: result.enrollment.serial,
        [`spn.enrollOpen.${step.factKey}.assetTag`]: result.enrollment.assetTag,
        [`spn.enrollOpen.${step.factKey}.custodySiteId`]: result.enrollment.custodySiteId,
        [`spn.enrollOpen.${step.factKey}.warrantyRef`]: result.enrollment.warrantyRef,
        [`spn.enrollOpen.${step.factKey}.receiptEvidenceRef`]: result.enrollment.receiptEvidenceRef,
        [`spn.enrollOpen.${step.factKey}.auditPresent`]: result.audit !== null,
      };
    }
    case "spn-enrollment-complete": {
      const result = seam.directory.completeEnrollment({
        tenantId: state.tenant.tenantId,
        serial: step.serial,
        at: step.at,
        actor: step.actor,
      });
      if (!result.ok) {
        logPush(state, "spn.log", `enroll-complete:${step.serial}:refused:${result.reason}`);
        return {
          [`spn.enrollComplete.${step.factKey}.ok`]: false,
          [`spn.enrollComplete.${step.factKey}.reasonCode`]: result.reason,
          [`spn.enrollComplete.${step.factKey}.twinLinked`]: false,
        };
      }
      logPush(state, "spn.log", `enroll-complete:${step.serial}:${result.enrollment.state}:twin=${result.twinLinked ? "linked" : "none"}`);
      return {
        [`spn.enrollComplete.${step.factKey}.ok`]: true,
        [`spn.enrollComplete.${step.factKey}.reasonCode`]: null,
        [`spn.enrollComplete.${step.factKey}.duplicate`]: result.duplicate,
        [`spn.enrollComplete.${step.factKey}.state`]: result.enrollment.state,
        [`spn.enrollComplete.${step.factKey}.enrolledAt`]: result.enrollment.enrolledAt,
        [`spn.enrollComplete.${step.factKey}.twinLinked`]: result.twinLinked,
        [`spn.enrollComplete.${step.factKey}.deviceId`]: result.enrollment.deviceId,
      };
    }
    case "spn-enrollment-read": {
      const caller = (step.callerTenant ?? "own") === "own" ? state.tenant : OTHER_TENANT;
      const record = seam.directory.findEnrollment(caller.tenantId, step.serial);
      logPush(state, "spn.log", `enroll-read:${step.callerTenant ?? "own"}:${step.serial}:${record?.state ?? "null"}`);
      return {
        [`spn.enrollRead.${step.factKey}.found`]: record !== null,
        [`spn.enrollRead.${step.factKey}.state`]: record?.state ?? null,
        [`spn.enrollRead.${step.factKey}.enrollmentId`]: record?.enrollmentId ?? null,
        [`spn.enrollRead.${step.factKey}.assetId`]: record?.assetId ?? null,
      };
    }
    case "spn-registry-read": {
      const caller = (step.callerTenant ?? "own") === "own" ? state.tenant : OTHER_TENANT;
      const list = seam.assets.listAssets(caller.tenantId);
      const sorted = [...list].sort((a, b) => (a.id < b.id ? -1 : 1));
      const asset = seam.assets.lookupAsset(caller.tenantId, step.assetId as AssetId);
      // The twin link is keyed by the ENROLLMENT's device id (the F361A law:
      // the enrollment record is the typed LINK; the twin port is the SAME
      // repository backing the AssetDirectory).
      const enrollment = seam.directory.findEnrollment(caller.tenantId, step.serial);
      const twin = enrollment?.deviceId == null ? null : seam.repo.findTwin(caller.tenantId, enrollment.deviceId);
      const twinLink: Readonly<Record<string, unknown>> = twin === null ? {} : (twin.revisions[twin.revisions.length - 1]?.attributes ?? {});
      logPush(state, "spn.log", `registry:${step.callerTenant ?? "own"}:${list.length}:${asset?.lifecycle ?? "null"}`);
      return {
        [`spn.registry.${step.factKey}.count`]: sorted.length,
        [`spn.registry.${step.factKey}.twinDeviceId`]: enrollment?.deviceId ?? null,
        [`spn.registry.${step.factKey}.lifecycle`]: asset?.lifecycle ?? null,
        [`spn.registry.${step.factKey}.enrolledAt`]: asset?.enrolledAt ?? null,
        [`spn.registry.${step.factKey}.displayName`]: asset?.displayName ?? null,
        [`spn.registry.${step.factKey}.ids`]: sorted.map((a) => a.id),
        [`spn.registry.${step.factKey}.lifecycles`]: sorted.map((a) => `${a.id}:${lifecycleRank(a.lifecycle)}`),
        [`spn.registry.${step.factKey}.twinLastSeq`]: twin?.lastSeq ?? null,
        [`spn.registry.${step.factKey}.twinLink`]: [
          `serial:${String(twinLink["serial"] ?? "-")}`,
          `assetTag:${String(twinLink["assetTag"] ?? "-")}`,
          `custodySiteId:${String(twinLink["custodySiteId"] ?? "-")}`,
          `warrantyRef:${String(twinLink["warrantyRef"] ?? "-")}`,
          `receiptEvidenceRef:${String(twinLink["receiptEvidenceRef"] ?? "-")}`,
        ],
      };
    }
  }
}
