/**
 * @fleetos/acceptance-commerce — vendor-performance step drivers (F351C,
 * Wave 15 lane C).
 *
 * Interprets typed journey steps against the REAL public entry points of
 * `@fleetos/vendors` capability-catalog.ts:
 *   - `rollupVendorKpis` — deterministic KPI rollups over a vendor's
 *     fulfillment outcomes: on-time means deliveredAt <= promisedAt (the
 *     inclusive boundary is on-time), every ratio is an integer number of
 *     basis points (floored), outcomes from other tenants are ignored
 *     (tenant-scoped read model — never counted), EMPTY_PERFORMANCE_HISTORY
 *     refuses a vendor with no outcomes, and a malformed (negative)
 *     quantity refuses NEGATIVE_QUANTITY;
 *   - `capabilityCatalogSummary` — the declared/verified counts per
 *     vendor, tenant-scoped (foreign-tenant records never counted).
 *
 * The outcome records and capability records are literal step data; the
 * driver maps them onto the REAL record shapes untouched. Pure and
 * deterministic.
 */

import type { FactValue } from "./journey-contracts.js";
import type { VendorKpiStep } from "./journey-contracts-f351c.js";
import type { JourneyState } from "./journey-world.js";
import { OTHER_TENANT, logPush } from "./journey-world.js";
import type { FulfillmentOutcomeRecord, VendorCapabilityRecord } from "@fleetos/vendors";
import { rollupVendorKpis, capabilityCatalogSummary } from "@fleetos/vendors";

export type DriverFacts = Record<string, FactValue>;

interface KpiSeam {
  outcomes: FulfillmentOutcomeRecord[];
}

const seams = new WeakMap<JourneyState, KpiSeam>();

function seamFor(state: JourneyState): KpiSeam {
  let seam = seams.get(state);
  if (seam === undefined) {
    seam = { outcomes: [] };
    seams.set(state, seam);
  }
  return seam;
}

export async function runVendorKpiStep(
  step: VendorKpiStep,
  state: JourneyState,
): Promise<DriverFacts> {
  switch (step.kind) {
    case "vkpi-outcome-seed": {
      const seam = seamFor(state);
      seam.outcomes = step.outcomes.map((o) => ({
        vendorId: o.vendorId,
        tenant: (o.tenant ?? "own") === "own" ? state.tenant : OTHER_TENANT,
        orderId: o.orderId,
        promisedAt: o.promisedAt,
        deliveredAt: o.deliveredAt,
        quantityOrdered: o.quantityOrdered,
        quantityReceived: o.quantityReceived,
      }));
      logPush(state, "vkpi.seedLog", seam.outcomes.map((o) => `${o.vendorId}:${o.orderId}`).join("|"));
      return {
        [`vkpi.seed.${step.factKey}.count`]: seam.outcomes.length,
        [`vkpi.seed.${step.factKey}.foreignCount`]: step.outcomes.filter((o) => o.tenant === "foreign").length,
      };
    }
    case "vkpi-rollup": {
      const seam = seamFor(state);
      const records = step.records === "empty" ? [] : [...seam.outcomes];
      if (step.malformed !== undefined) {
        records.push({
          vendorId: step.malformed.vendorId,
          tenant: state.tenant,
          orderId: "ord-malformed",
          promisedAt: 1_000,
          deliveredAt: 900,
          quantityOrdered: 4,
          quantityReceived: step.malformed.quantityReceived,
        });
      }
      const result = rollupVendorKpis(state.tenant, records, step.vendorId);
      if (!result.ok) {
        logPush(state, "vkpi.rollupLog", `${step.vendorId}:refused:${result.reasonCode}`);
        return {
          [`vkpi.rollup.${step.factKey}.ok`]: false,
          [`vkpi.rollup.${step.factKey}.reasonCode`]: result.reasonCode,
        };
      }
      const r = result.rollup;
      logPush(state, "vkpi.rollupLog", `${step.vendorId}:${r.onTimeRatioBps}:${r.fillRateBps}`);
      return {
        [`vkpi.rollup.${step.factKey}.ok`]: true,
        [`vkpi.rollup.${step.factKey}.reasonCode`]: null,
        [`vkpi.rollup.${step.factKey}.outcomeCount`]: r.outcomeCount,
        [`vkpi.rollup.${step.factKey}.onTimeCount`]: r.onTimeCount,
        [`vkpi.rollup.${step.factKey}.onTimeRatioBps`]: r.onTimeRatioBps,
        [`vkpi.rollup.${step.factKey}.quantityOrderedTotal`]: r.quantityOrderedTotal,
        [`vkpi.rollup.${step.factKey}.quantityReceivedTotal`]: r.quantityReceivedTotal,
        [`vkpi.rollup.${step.factKey}.fillRateBps`]: r.fillRateBps,
      };
    }
    case "vkpi-catalog-summary": {
      const records: VendorCapabilityRecord[] = step.capabilities.map((c) => ({
        vendorId: c.vendorId,
        tenant: (c.tenant ?? "own") === "own" ? state.tenant : OTHER_TENANT,
        tag: c.tag,
        status: c.status,
        verifiedAt: c.status === "verified" ? 1 : null,
        evidence: c.status === "verified" ? { evidenceId: `ev-${c.vendorId}-${c.tag}`, tenantId: state.tenant.tenantId } : null,
      }));
      const summary = capabilityCatalogSummary(state.tenant, records, step.vendorId);
      logPush(state, "vkpi.catalogLog", `${step.vendorId}:${summary.declaredCount}d:${summary.verifiedCount}v`);
      return {
        [`vkpi.catalog.${step.factKey}.declaredCount`]: summary.declaredCount,
        [`vkpi.catalog.${step.factKey}.verifiedCount`]: summary.verifiedCount,
      };
    }
  }
}
