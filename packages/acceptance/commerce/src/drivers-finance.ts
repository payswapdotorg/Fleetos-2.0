/**
 * @fleetos/acceptance-commerce — finance step drivers (F310C, Wave 11
 * lane C).
 *
 * Interprets typed journey steps against the REAL public entry points of
 * @fleetos/vendors (SLA contract math: evaluateSla → buildSlaScorecard),
 * @fleetos/procurement (applySlaPenaltyCredit over the vendors evaluation
 * seam, reconcileOrdersBatched, the exact-sum cost-allocation laws) and
 * @fleetos/software (renewal-window sweeps, seat-utilization projections).
 *
 * Cross-context composition happens HERE (the acceptance lane is the
 * documented composition site): the vendors SLA evaluation's penalty
 * summary flows into procurement's SlaPenaltyRefLike seam verbatim — the
 * structural ref the domain packages document for the TL to bind.
 *
 * Facts are namespaced per `factKey`; refusals are honest facts.
 */

import type { FactValue, FinanceStep } from "./journey-contracts.js";
import type { JourneyState } from "./journey-world.js";
import type { SlaEvaluation } from "@fleetos/vendors";
import { evaluateSla, buildSlaScorecard } from "@fleetos/vendors";
import {
  applySlaPenaltyCredit,
  reconcileOrdersBatched,
  allocateCostAcrossWorkOrders,
  allocatePartialFulfillmentAmounts,
  verifyPartialFulfillmentSums,
} from "@fleetos/procurement";
import { sweepRenewalWindows, projectSeatUtilization } from "@fleetos/software";

export type DriverFacts = Record<string, FactValue>;

/** The last SLA evaluation (per journey state — the scorecard/credit seam). */
const lastEvaluations = new WeakMap<JourneyState, SlaEvaluation>();

export async function runFinanceStep(step: FinanceStep, state: JourneyState): Promise<DriverFacts> {
  switch (step.kind) {
    case "vendor-sla-evaluate": {
      const definition = {
        slaId: "sla-ven-1",
        tenant: state.tenant,
        vendorId: "ven-1",
        availabilityTargetBps: step.availabilityTargetBps,
        responseBands: step.bands.map((b) => ({ ...b })),
        creditCapBps: step.creditCapBps,
        effectiveFrom: null,
        effectiveTo: null,
      };
      const outcomes = step.outcomes.map((o) => ({
        vendorId: "ven-1",
        tenant: o.foreignTenant === true ? state.otherTenant : state.tenant,
        orderId: o.orderId,
        promisedAt: o.promisedAt,
        deliveredAt: o.deliveredAt,
        quantityOrdered: o.quantityOrdered,
        quantityReceived: o.quantityReceived,
      }));
      const result = evaluateSla(state.tenant, definition, outcomes, 1_791_200_000);
      if (!result.ok) {
        return {
          [`sla.evaluate.${step.factKey}.ok`]: false,
          [`sla.evaluate.${step.factKey}.reasonCode`]: result.reasonCode,
        };
      }
      lastEvaluations.set(state, result.evaluation);
      return {
        [`sla.evaluate.${step.factKey}.ok`]: true,
        [`sla.evaluate.${step.factKey}.outcomeCount`]: result.evaluation.outcomeCount,
        [`sla.evaluate.${step.factKey}.onTimeCount`]: result.evaluation.onTimeCount,
        [`sla.evaluate.${step.factKey}.availabilityBps`]: result.evaluation.availabilityBps,
        [`sla.evaluate.${step.factKey}.availabilityMet`]: result.evaluation.availabilityMet,
        [`sla.evaluate.${step.factKey}.breachCount`]: result.evaluation.breaches.length,
        [`sla.evaluate.${step.factKey}.breachBands`]: result.evaluation.breaches.map((b) => b.bandId),
        [`sla.evaluate.${step.factKey}.totalPenaltyBpsUncapped`]: result.evaluation.totalPenaltyBpsUncapped,
        [`sla.evaluate.${step.factKey}.totalPenaltyBps`]: result.evaluation.totalPenaltyBps,
        [`sla.evaluate.${step.factKey}.capApplied`]: result.evaluation.capApplied,
        [`sla.evaluate.${step.factKey}.digest`]: result.evaluation.digest,
        [`sla.evaluate.${step.factKey}.reasonCode`]: null,
      };
    }
    case "vendor-sla-scorecard": {
      const evaluation = lastEvaluations.get(state);
      if (evaluation === undefined) {
        return { "sla.scorecard.ok": false, "sla.scorecard.reasonCode": "EVALUATION_NOT_RUN" };
      }
      const result = buildSlaScorecard(state.tenant, evaluation);
      if (!result.ok) {
        return { "sla.scorecard.ok": false, "sla.scorecard.reasonCode": result.reasonCode };
      }
      return {
        "sla.scorecard.ok": true,
        "sla.scorecard.status": result.scorecard.status,
        "sla.scorecard.breachCount": result.scorecard.breachCount,
        "sla.scorecard.totalPenaltyBps": result.scorecard.totalPenaltyBps,
        "sla.scorecard.capApplied": result.scorecard.capApplied,
        "sla.scorecard.availabilityBps": result.scorecard.availabilityBps,
        "sla.scorecard.availabilityMet": result.scorecard.availabilityMet,
        "sla.scorecard.evaluationDigest": result.scorecard.evaluationDigest,
        "sla.scorecard.evidenceIsReference":
          result.scorecard.breachEvidence === evaluation.breaches,
      };
    }
    case "vendor-sla-credit": {
      const evaluation = lastEvaluations.get(state);
      if (evaluation === undefined) {
        return { [`sla.credit.${step.factKey}.ok`]: false, [`sla.credit.${step.factKey}.reasonCode`]: "EVALUATION_NOT_RUN" };
      }
      const order = {
        orderId: "ord-sla-1",
        tenant: step.foreignTenant === true ? state.otherTenant : state.tenant,
        orderedQuantity: step.orderedQuantity,
        unitCostMinor: step.unitCostMinor,
      };
      const penalty = {
        evaluationDigest: evaluation.digest,
        tenantId: evaluation.tenant.tenantId,
        penaltyBps: evaluation.totalPenaltyBps,
        creditCapBps: evaluation.creditCapBps,
      };
      const result = applySlaPenaltyCredit(order, penalty);
      if (!result.ok) {
        return {
          [`sla.credit.${step.factKey}.ok`]: false,
          [`sla.credit.${step.factKey}.reasonCode`]: result.reasonCode,
        };
      }
      return {
        [`sla.credit.${step.factKey}.ok`]: true,
        [`sla.credit.${step.factKey}.orderValueMinor`]: result.credit.orderValueMinor,
        [`sla.credit.${step.factKey}.creditMinorUnits`]: result.credit.creditMinorUnits,
        [`sla.credit.${step.factKey}.evaluationDigest`]: result.credit.evaluationDigest,
        [`sla.credit.${step.factKey}.digestTracePreserved`]: result.credit.evaluationDigest === evaluation.digest,
        [`sla.credit.${step.factKey}.penaltyBps`]: result.credit.penaltyBps,
        [`sla.credit.${step.factKey}.reasonCode`]: null,
      };
    }
    case "order-reconcile-batch": {
      const orders = step.orders.map((o) => ({
        orderId: o.orderId,
        tenant: o.foreignTenant === true ? state.otherTenant : state.tenant,
        orderedQuantity: o.orderedQuantity,
        unitCostMinor: o.unitCostMinor,
      }));
      const receipts = step.receipts.map((r) => ({
        orderId: r.orderId,
        tenant: state.tenant,
        receivedQuantity: r.receivedQuantity,
        receivedAt: 1_791_000_000,
      }));
      const result = reconcileOrdersBatched(state.tenant, orders, receipts, step.batchSize);
      if (!result.ok) {
        return {
          [`recon.batch.${step.factKey}.ok`]: false,
          [`recon.batch.${step.factKey}.reasonCode`]: result.reasonCode,
        };
      }
      return {
        [`recon.batch.${step.factKey}.ok`]: true,
        [`recon.batch.${step.factKey}.orderCount`]: result.report.orderCount,
        [`recon.batch.${step.factKey}.batchCount`]: result.report.batchCount,
        [`recon.batch.${step.factKey}.ordering`]: result.report.ordering,
        [`recon.batch.${step.factKey}.firstBatchIds`]: result.report.batches[0]?.orderIds ?? [],
        [`recon.batch.${step.factKey}.lastBatchIds`]: result.report.batches[result.report.batches.length - 1]?.orderIds ?? [],
        [`recon.batch.${step.factKey}.exactCount`]: result.report.exactCount,
        [`recon.batch.${step.factKey}.shortCount`]: result.report.shortCount,
        [`recon.batch.${step.factKey}.overCount`]: result.report.overCount,
        [`recon.batch.${step.factKey}.reasonCode`]: null,
      };
    }
    case "cost-allocate": {
      const result = allocateCostAcrossWorkOrders({
        tenant: state.tenant,
        orderId: step.orderId,
        totalMinorUnits: step.totalMinorUnits,
        shares: step.shares.map((s) => ({ workOrderId: s.workOrderId, shareBps: s.shareBps, tenant: state.tenant })),
      });
      if (!result.ok) {
        return {
          [`cost.alloc.${step.factKey}.ok`]: false,
          [`cost.alloc.${step.factKey}.reasonCode`]: result.reasonCode,
        };
      }
      return {
        [`cost.alloc.${step.factKey}.ok`]: true,
        [`cost.alloc.${step.factKey}.amounts`]: result.allocations.map((a) => `${a.workOrderId}:${a.amountMinorUnits}`),
        [`cost.alloc.${step.factKey}.totalAllocated`]: result.totalAllocatedMinorUnits,
        [`cost.alloc.${step.factKey}.law`]: result.law,
        [`cost.alloc.${step.factKey}.reasonCode`]: null,
      };
    }
    case "cost-allocate-partial": {
      const result = allocatePartialFulfillmentAmounts(
        state.tenant,
        { orderId: step.orderId, totalMinorUnits: step.totalMinorUnits },
        step.partials.map((p) => ({ fulfillmentId: p.fulfillmentId, quantity: p.quantity, tenant: state.tenant })),
      );
      if (!result.ok) {
        return {
          [`cost.partial.${step.factKey}.ok`]: false,
          [`cost.partial.${step.factKey}.reasonCode`]: result.reasonCode,
        };
      }
      return {
        [`cost.partial.${step.factKey}.ok`]: true,
        [`cost.partial.${step.factKey}.rows`]: result.rows.map((r) => `${r.fulfillmentId}:${r.amountMinorUnits}`),
        [`cost.partial.${step.factKey}.totalAllocated`]: result.totalAllocatedMinorUnits,
        [`cost.partial.${step.factKey}.law`]: result.law,
      };
    }
    case "cost-alloc-verify": {
      const result = verifyPartialFulfillmentSums(
        { orderId: step.orderId, totalMinorUnits: step.totalMinorUnits },
        step.rows.map((r) => ({ fulfillmentId: r.fulfillmentId, amountMinorUnits: r.amountMinorUnits })),
      );
      if (!result.ok) {
        return {
          [`cost.verify.${step.factKey}.ok`]: false,
          [`cost.verify.${step.factKey}.reasonCode`]: result.reasonCode,
          [`cost.verify.${step.factKey}.driftMinorUnits`]: result.driftMinorUnits,
        };
      }
      return {
        [`cost.verify.${step.factKey}.ok`]: true,
        [`cost.verify.${step.factKey}.sumMinorUnits`]: result.sumMinorUnits,
      };
    }
    case "software-renewal-sweep": {
      const subscriptions = step.subscriptions.map((s) => ({
        id: { kind: "subscription" as const, value: s.subscriptionId },
        tenant: s.foreignTenant === true ? state.otherTenant : state.tenant,
        sku: "FLEET-OPS-PRO",
        seatsTotal: 5,
        status: s.status,
        validFrom: "2026-01-01T00:00:00Z",
        validUntil: s.validUntil,
      }));
      const result = sweepRenewalWindows(state.tenant, subscriptions, step.graceMs, step.now);
      if (!result.ok) {
        return {
          [`renewal.sweep.${step.factKey}.ok`]: false,
          [`renewal.sweep.${step.factKey}.reasonCode`]: result.reasonCode,
        };
      }
      const byId = new Map(result.report.windows.map((w) => [w.subscriptionId, w.status] as const));
      return {
        [`renewal.sweep.${step.factKey}.ok`]: true,
        [`renewal.sweep.${step.factKey}.activeCount`]: result.report.activeCount,
        [`renewal.sweep.${step.factKey}.inGraceCount`]: result.report.inGraceCount,
        [`renewal.sweep.${step.factKey}.expiredCount`]: result.report.expiredCount,
        [`renewal.sweep.${step.factKey}.ordering`]: result.report.ordering,
        [`renewal.sweep.${step.factKey}.statuses`]: result.report.windows.map((w) => `${w.subscriptionId}:${byId.get(w.subscriptionId) ?? "?"}`),
        [`renewal.sweep.${step.factKey}.graceEnds`]: result.report.windows
          .filter((w) => w.graceEndsAtMs !== null)
          .map((w) => `${w.subscriptionId}:${w.graceEndsAtMs}`),
        [`renewal.sweep.${step.factKey}.reasonCode`]: null,
      };
    }
    case "software-seat-projection": {
      const subscription = state.software.subscription;
      const result = projectSeatUtilization(
        state.tenant,
        subscription,
        state.software.grants,
        step.planned.map((p) => ({ requestId: p.requestId, seats: p.seats, assumption: p.assumption })),
      );
      if (!result.ok) {
        return {
          [`seats.project.${step.factKey}.ok`]: false,
          [`seats.project.${step.factKey}.reasonCode`]: result.reasonCode,
        };
      }
      return {
        [`seats.project.${step.factKey}.ok`]: true,
        [`seats.project.${step.factKey}.seatsTotal`]: result.projection.seatsTotal,
        [`seats.project.${step.factKey}.heldSeatsNow`]: result.projection.heldSeatsNow,
        [`seats.project.${step.factKey}.plannedSeats`]: result.projection.plannedSeats,
        [`seats.project.${step.factKey}.projectedHeldSeats`]: result.projection.projectedHeldSeats,
        [`seats.project.${step.factKey}.utilizationBps`]: result.projection.utilizationBps,
        [`seats.project.${step.factKey}.overageSeats`]: result.projection.overageSeats,
        [`seats.project.${step.factKey}.projection`]: result.projection.projection,
        [`seats.project.${step.factKey}.assumptions`]: result.projection.assumptions,
      };
    }
  }
}
