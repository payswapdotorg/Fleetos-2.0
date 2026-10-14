/**
 * @fleetos/acceptance-commerce — the marketplace supplier-verification
 * step drivers (F361C, Wave 17 lane C).
 *
 * Interprets the mver-* typed journey steps against the REAL public
 * entry points of `@fleetos/vendors`:
 *   - openSupplierVerification / transitionSupplierVerification — the
 *     §3.3 machine (pending → verified | expired | suspended): verify
 *     REQUIRES same-tenant evidence + a strictly-later expiry
 *     (VERIFICATION_EVIDENCE_REQUIRED /
 *     VERIFICATION_EVIDENCE_TENANT_MISMATCH / EXPIRY_BEFORE_VERIFICATION
 *     refusals); suspend REQUIRES a reason; expire fires ONLY after the
 *     lapse (NOT_EXPIRED_YET before);
 *   - supplierVerificationGate — VERIFIED-ONLY ENTER MATCHING: only
 *     verified+current suppliers are admitted; every exclusion carries
 *     its reason (SUPPLIER_PENDING / VERIFICATION_EXPIRED /
 *     SUPPLIER_SUSPENDED); a foreign-tenant record refuses the whole
 *     gate fail-closed;
 *   - findSupplierVerification — the tenant fail-closed read;
 *   - importCatalogueBatch — the PLAINLY-LABELLED manually-operated
 *     catalogue import seam (the label travels verbatim on every result;
 *     one malformed or duplicate entry refuses the WHOLE batch with the
 *     per-entry report; source/freshness tracked on every entry).
 *
 * The verification + catalogue populations live in a WeakMap keyed by
 * JourneyState — a fresh world per run keeps every run pure and
 * deterministic.
 */

import type { FactValue } from "./journey-contracts.js";
import type { MarketplaceSupplierStep } from "./journey-contracts-f361c.js";
import type { JourneyState } from "./journey-world.js";
import { OTHER_TENANT, logPush } from "./journey-world.js";
import type { SupplierVerificationRecord, CatalogueEntry } from "@fleetos/vendors";
import {
  openSupplierVerification,
  transitionSupplierVerification,
  supplierVerificationGate,
  findSupplierVerification,
  importCatalogueBatch,
} from "@fleetos/vendors";

export type DriverFacts = Record<string, FactValue>;

interface SupplierSeam {
  verifications: SupplierVerificationRecord[];
  catalogueEntries: CatalogueEntry[];
}

const seams = new WeakMap<JourneyState, SupplierSeam>();

function seamFor(state: JourneyState): SupplierSeam {
  let seam = seams.get(state);
  if (seam === undefined) {
    seam = { verifications: [], catalogueEntries: [] };
    seams.set(state, seam);
  }
  return seam;
}

function replace(seam: SupplierSeam, next: SupplierVerificationRecord): void {
  const index = seam.verifications.findIndex((v) => v.supplierId === next.supplierId);
  if (index === -1) seam.verifications.push(next);
  else seam.verifications[index] = next;
}

export async function runMarketplaceSupplierStep(
  step: MarketplaceSupplierStep,
  state: JourneyState,
): Promise<DriverFacts> {
  const seam = seamFor(state);
  switch (step.kind) {
    case "mver-open": {
      const result = openSupplierVerification(state.tenant, step.supplierId);
      if (!result.ok) {
        logPush(state, "mver.log", `open:${step.supplierId}:refused:${result.reasonCode}`);
        return { [`mver.open.${step.factKey}.ok`]: false, [`mver.open.${step.factKey}.reasonCode`]: result.reasonCode };
      }
      replace(seam, result.next);
      logPush(state, "mver.log", `open:${step.supplierId}:pending`);
      return {
        [`mver.open.${step.factKey}.ok`]: true,
        [`mver.open.${step.factKey}.reasonCode`]: null,
        [`mver.open.${step.factKey}.status`]: result.next.status,
      };
    }
    case "mver-verify": {
      const current = seam.verifications.find((v) => v.supplierId === step.supplierId);
      if (current === undefined) {
        return { [`mver.verify.${step.factKey}.ok`]: false, [`mver.verify.${step.factKey}.reasonCode`]: "SUPPLIER_ID_REQUIRED" };
      }
      const result = transitionSupplierVerification(current, {
        type: "verify",
        evidence: { evidenceId: step.evidenceId, tenantId: step.evidenceTenantId },
        verifiedAt: step.verifiedAt,
        expiresAt: step.expiresAt,
      });
      if (!result.ok) {
        logPush(state, "mver.log", `verify:${step.supplierId}:refused:${result.reasonCode}`);
        return {
          [`mver.verify.${step.factKey}.ok`]: false,
          [`mver.verify.${step.factKey}.reasonCode`]: result.reasonCode,
          [`mver.verify.${step.factKey}.status`]: null,
        };
      }
      replace(seam, result.next);
      logPush(state, "mver.log", `verify:${step.supplierId}:verified`);
      return {
        [`mver.verify.${step.factKey}.ok`]: true,
        [`mver.verify.${step.factKey}.reasonCode`]: null,
        [`mver.verify.${step.factKey}.status`]: result.next.status,
        [`mver.verify.${step.factKey}.evidenceId`]: result.next.evidence?.evidenceId ?? null,
        [`mver.verify.${step.factKey}.verifiedAt`]: result.next.verifiedAt,
        [`mver.verify.${step.factKey}.expiresAt`]: result.next.expiresAt,
      };
    }
    case "mver-suspend": {
      const current = seam.verifications.find((v) => v.supplierId === step.supplierId);
      if (current === undefined) {
        return { [`mver.suspend.${step.factKey}.ok`]: false, [`mver.suspend.${step.factKey}.reasonCode`]: "SUPPLIER_ID_REQUIRED" };
      }
      const result = transitionSupplierVerification(current, { type: "suspend", reason: step.reason });
      if (!result.ok) {
        logPush(state, "mver.log", `suspend:${step.supplierId}:refused:${result.reasonCode}`);
        return {
          [`mver.suspend.${step.factKey}.ok`]: false,
          [`mver.suspend.${step.factKey}.reasonCode`]: result.reasonCode,
        };
      }
      replace(seam, result.next);
      logPush(state, "mver.log", `suspend:${step.supplierId}:suspended`);
      return {
        [`mver.suspend.${step.factKey}.ok`]: true,
        [`mver.suspend.${step.factKey}.reasonCode`]: null,
        [`mver.suspend.${step.factKey}.status`]: result.next.status,
        [`mver.suspend.${step.factKey}.suspendedReason`]: result.next.suspendedReason,
      };
    }
    case "mver-expire": {
      const current = seam.verifications.find((v) => v.supplierId === step.supplierId);
      if (current === undefined) {
        return { [`mver.expire.${step.factKey}.ok`]: false, [`mver.expire.${step.factKey}.reasonCode`]: "SUPPLIER_ID_REQUIRED" };
      }
      const result = transitionSupplierVerification(current, { type: "expire", at: step.at });
      if (!result.ok) {
        logPush(state, "mver.log", `expire:${step.supplierId}:refused:${result.reasonCode}`);
        return {
          [`mver.expire.${step.factKey}.ok`]: false,
          [`mver.expire.${step.factKey}.reasonCode`]: result.reasonCode,
        };
      }
      replace(seam, result.next);
      logPush(state, "mver.log", `expire:${step.supplierId}:expired`);
      return {
        [`mver.expire.${step.factKey}.ok`]: true,
        [`mver.expire.${step.factKey}.reasonCode`]: null,
        [`mver.expire.${step.factKey}.status`]: result.next.status,
      };
    }
    case "mver-gate": {
      const result = supplierVerificationGate(state.tenant, seam.verifications, step.at);
      if (!result.ok) {
        logPush(state, "mver.log", `gate:${step.factKey}:refused:${result.reasonCode}`);
        return {
          [`mver.gate.${step.factKey}.ok`]: false,
          [`mver.gate.${step.factKey}.reasonCode`]: result.reasonCode,
          [`mver.gate.${step.factKey}.admittedCount`]: 0,
        };
      }
      logPush(
        state,
        "mver.log",
        `gate:${step.factKey}:admitted:${result.admittedSupplierIds.join(",") || "-"}:excluded:${result.excluded.map((e) => `${e.supplierId}:${e.exclusionReason}`).join(",") || "-"}`,
      );
      return {
        [`mver.gate.${step.factKey}.ok`]: true,
        [`mver.gate.${step.factKey}.reasonCode`]: null,
        [`mver.gate.${step.factKey}.admitted`]: result.admittedSupplierIds,
        [`mver.gate.${step.factKey}.admittedCount`]: result.admittedCount,
        [`mver.gate.${step.factKey}.excluded`]: result.excluded.map((e) => `${e.supplierId}:${e.exclusionReason}`),
      };
    }
    case "mver-read": {
      const caller = (step.callerTenant ?? "own") === "own" ? state.tenant : OTHER_TENANT;
      const found = findSupplierVerification(caller, seam.verifications, step.supplierId);
      logPush(state, "mver.readLog", `${step.callerTenant ?? "own"}:${step.supplierId}:${found?.status ?? "null"}`);
      return {
        [`mver.read.${step.factKey}.found`]: found !== null,
        [`mver.read.${step.factKey}.status`]: found?.status ?? null,
      };
    }
    case "mver-catalogue-import": {
      const result = importCatalogueBatch(
        state.tenant,
        {
          kind: "manual-operator-export",
          operatorId: step.operatorId,
          exportId: step.exportId,
          capturedAt: step.exportCapturedAt,
        },
        step.entries.map((e) => ({
          supplierId: e.supplierId,
          sku: e.sku,
          unitCostMinor: e.unitCostMinor,
          currency: e.currency,
          condition: e.condition,
          warrantyMonths: e.warrantyMonths,
          deliveryEstimateDays: e.deliveryEstimateDays,
        })),
        seam.catalogueEntries,
      );
      if (!result.ok) {
        logPush(state, "mver.log", `catalogue:${step.factKey}:refused:${result.reasonCode}`);
        return {
          [`mver.catalogue.${step.factKey}.ok`]: false,
          [`mver.catalogue.${step.factKey}.reasonCode`]: result.reasonCode,
          [`mver.catalogue.${step.factKey}.label`]: result.label,
          [`mver.catalogue.${step.factKey}.entryCount`]: 0,
        };
      }
      for (const entry of result.entries) seam.catalogueEntries.push(entry);
      logPush(state, "mver.log", `catalogue:${step.factKey}:imported:${result.entryCount}`);
      return {
        [`mver.catalogue.${step.factKey}.ok`]: true,
        [`mver.catalogue.${step.factKey}.reasonCode`]: null,
        [`mver.catalogue.${step.factKey}.label`]: result.label,
        [`mver.catalogue.${step.factKey}.entryCount`]: result.entryCount,
        [`mver.catalogue.${step.factKey}.entryIds`]: result.entries.map((e) => e.entryId),
        [`mver.catalogue.${step.factKey}.provenance`]: result.entries.map(
          (e) => `${e.supplierId}:${e.sku}:${e.importSource.operatorId}:${e.importSource.exportId}:${e.capturedAt}`,
        ),
      };
    }
  }
}
