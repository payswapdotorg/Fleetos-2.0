/**
 * @fleetos/acceptance-commerce — procurement/vendor/software step drivers.
 *
 * Interprets typed journey steps against the REAL public entry points of
 * @fleetos/procurement, @fleetos/vendors, @fleetos/software and the
 * commerce views of @fleetos/experience-work-commerce. Facts are verbatim
 * REAL outputs; refusals carry the domain's reason codes.
 */

import type { FactValue, CommerceStep } from "./journey-contracts.js";
import type { JourneyState } from "./journey-world.js";
import { CLOCK, logPush } from "./journey-world.js";
import type { Quote, Fulfillment } from "@fleetos/procurement";
import {
  transitionDemandFlow,
  transitionQuote,
  supersedeQuote,
  awardQuoteToOrder,
  transitionOrder,
  transitionFulfillment,
  reconcileOrderTotals,
} from "@fleetos/procurement";
import { buildSpineBoard, buildQuoteScoreView, buildVendorKpiRollup, buildSeatView } from "@fleetos/experience-work-commerce";
import { transitionVendorLifecycle, verifyCapability as verifyVendorCapability, commitServiceExposure, releaseServiceExposure } from "@fleetos/vendors";
import { checkEntitlement, assignGrantWithinPopulation, revokeGrant, countHeldSeats } from "@fleetos/software";
import { runExternalStep } from "./drivers-external.js";

export type DriverFacts = Record<string, FactValue>;

const guardianRef = (authorized: boolean) => ({
  decisionId: authorized ? "gd-allow-1" : "gd-deny-1",
  authorized,
  reasonCode: authorized ? "within-policy" : "exceeds-policy",
});

export async function runCommerceStep(step: CommerceStep, state: JourneyState): Promise<DriverFacts> {
  switch (step.kind) {
    case "demand-flow": {
      const command =
        step.command === "solicit"
          ? {
              type: "solicit" as const,
              authorization: guardianRef(step.authorized),
              evidence: { evidenceId: step.evidenceId, tenantId: step.evidenceTenantId },
            }
          : step.command === "award"
            ? {
                type: "award" as const,
                authorization: guardianRef(step.authorized),
                evidence: { evidenceId: step.evidenceId, tenantId: step.evidenceTenantId },
              }
            : step.command === "cancel"
              ? { type: "cancel" as const, reason: step.reason ?? "no longer required" }
              : { type: "close" as const };
      const result = transitionDemandFlow(state.commerce.flow, command);
      if (result.ok) state.commerce.flow = result.next;
      logPush(state, "flow.log", `${result.ok}:${result.ok ? result.next.status : result.reasonCode}`);
      return {
        "flow.ok": result.ok,
        "flow.status": result.ok ? result.next.status : null,
        "flow.reasonCode": result.ok ? null : result.reasonCode,
      };
    }
    case "quote-create": {
      const quote: Quote = {
        id: { kind: "quote", value: step.quoteId },
        tenant: step.tenantId === undefined ? state.tenant : { tenantId: step.tenantId },
        demandId: state.commerce.demand.id,
        vendorId: step.vendorId,
        unitCost: step.unitCost,
        totalCost: step.totalCost,
        status: "draft",
        submittedAt: null,
        expiresAt: null,
        supersedes: null,
        superseded: false,
      };
      state.commerce.quotes.set(step.quoteId, quote);
      return { "quote.create.ok": true, [`quote.create.${step.quoteId}.status`]: "draft" };
    }
    case "quote-transition": {
      const quote = state.commerce.quotes.get(step.quoteId);
      if (quote === undefined) return { "quote.transition.ok": false, "quote.transition.reasonCode": "QUOTE_NOT_FOUND" };
      const command =
        step.command === "submit"
          ? { type: "submit" as const, submittedAt: CLOCK.iso1, expiresAt: CLOCK.later }
          : { type: step.command };
      const result = transitionQuote(quote, command);
      if (result.ok) state.commerce.quotes.set(step.quoteId, result.next);
      logPush(state, "quote.transition.log", `${result.ok}:${result.ok ? result.next.status : result.reasonCode}`);
      return {
        "quote.transition.ok": result.ok,
        "quote.transition.status": result.ok ? result.next.status : null,
        "quote.transition.reasonCode": result.ok ? null : result.reasonCode,
      };
    }
    case "quote-supersede": {
      const previous = state.commerce.quotes.get(step.previousQuoteId);
      if (previous === undefined) return { "quote.supersede.ok": false, "quote.supersede.reasonCode": "QUOTE_NOT_FOUND" };
      const result = supersedeQuote(
        previous,
        { kind: "quote", value: step.newQuoteId },
        state.tenant,
        state.commerce.demand.id,
        previous.vendorId,
        step.unitCost,
        step.totalCost,
        CLOCK.iso1,
        CLOCK.later,
      );
      if (result.ok) {
        state.commerce.quotes.set(step.previousQuoteId, result.previousWithdrew);
        state.commerce.quotes.set(step.newQuoteId, result.next);
      }
      return {
        "quote.supersede.ok": result.ok,
        "quote.supersede.previousStatus": result.ok ? result.previousWithdrew.status : null,
        "quote.supersede.previousSuperseded": result.ok ? result.previousWithdrew.superseded : false,
        "quote.supersede.newSupersedes": result.ok ? result.next.supersedes : null,
        "quote.supersede.reasonCode": result.ok ? null : result.reasonCode,
      };
    }
    case "quote-score-view": {
      const result = buildQuoteScoreView({
        tenant: state.tenant,
        demand: { requiredCapabilityTags: state.commerce.demand.capabilityTags },
        quotes: step.quotes.map((q) => ({
          quoteId: q.quoteId,
          vendorId: q.vendorId,
          tenant: state.tenant,
          unitCostMinor: q.unitCostMinor,
          totalCostMinor: q.totalCostMinor,
          leadTimeDays: q.leadTimeDays,
          capabilityTags: q.capabilityTags,
          submittedAtEpoch: q.submittedAtEpoch,
        })),
        computedAt: step.computedAt,
      });
      if (!result.ok) return { "quotes.ok": false, "quotes.reasonCode": result.reasonCode };
      logPush(state, "quotes.digestLog", result.view.digest);
      const digestLog = state.logs["quotes.digestLog"] ?? [];
      const first = result.view.ranked[0];
      return {
        "quotes.ok": true,
        "quotes.rankOrder": result.view.ranked.map((r) => r.quoteId),
        "quotes.rank1QuoteId": first?.quoteId ?? null,
        "quotes.rank1VendorId": first?.vendorId ?? null,
        "quotes.rank1ScoreBps": first?.totalScoreBps ?? -1,
        "quotes.rank2TieBreak": result.view.ranked[1]?.tieBreakRule ?? null,
        "quotes.digest": result.view.digest,
        "quotes.digestUniform": digestLog.length >= 2 && digestLog.every((d) => d === digestLog[0]),
      };
    }
    case "award-quote": {
      const quote = state.commerce.quotes.get(step.quoteId);
      if (quote === undefined) return { "award.ok": false, "award.reasonCode": "QUOTE_NOT_FOUND" };
      const orderId = { kind: "order" as const, value: "order-1" };
      const result = awardQuoteToOrder(
        quote,
        orderId,
        guardianRef(step.authorized),
        { evidenceId: step.evidenceId, tenantId: step.evidenceTenantId ?? state.tenant.tenantId },
      );
      if (result.ok) state.commerce.orders.set("order-1", result.order);
      logPush(state, "award.log", `${result.ok}:${result.ok ? result.order.status : result.reasonCode}`);
      return {
        "award.ok": result.ok,
        "award.reasonCode": result.ok ? null : result.reasonCode,
        "award.orderStatus": result.ok ? result.order.status : null,
        "award.orderId": result.ok ? result.order.id.value : null,
        "award.authorizationId": result.ok ? result.order.authorization.decisionId : null,
      };
    }
    case "order-transition": {
      const order = state.commerce.orders.get("order-1");
      if (order === undefined) return { "order.ok": false, "order.reasonCode": "ORDER_NOT_FOUND" };
      const result = transitionOrder(order, { type: step.command });
      if (result.ok) state.commerce.orders.set("order-1", result.next);
      logPush(state, "order.log", `${result.ok}:${result.ok ? result.next.status : result.reasonCode}`);
      return {
        "order.ok": result.ok,
        "order.status": result.ok ? result.next.status : null,
        "order.reasonCode": result.ok ? null : result.reasonCode,
      };
    }
    case "fulfillment-transition": {
      if (state.commerce.fulfillment === null) {
        const order = state.commerce.orders.get("order-1");
        if (order === undefined) return { "fulfillment.ok": false, "fulfillment.reasonCode": "ORDER_NOT_FOUND" };
        const pending: Fulfillment = {
          id: { kind: "fulfillment", value: "fulfillment-1" },
          tenant: state.tenant,
          orderId: order.id,
          status: "pending",
          verificationEvidence: null,
        };
        state.commerce.fulfillment = pending;
      }
      const command =
        step.command === "verify"
          ? {
              type: "verify" as const,
              evidence: {
                evidenceId: step.evidenceId ?? "ev-verify-1",
                tenantId: step.evidenceTenantId ?? state.tenant.tenantId,
              },
            }
          : { type: step.command };
      const result = transitionFulfillment(state.commerce.fulfillment, command);
      if (result.ok) state.commerce.fulfillment = result.next;
      logPush(state, "fulfillment.log", `${result.ok}:${result.ok ? result.next.status : result.reasonCode}`);
      return {
        "fulfillment.ok": result.ok,
        "fulfillment.status": result.ok ? result.next.status : null,
        "fulfillment.reasonCode": result.ok ? null : result.reasonCode,
        "fulfillment.evidenceId": result.ok ? (result.next.verificationEvidence?.evidenceId ?? null) : null,
      };
    }
    case "spine-board": {
      const quotes = [...state.commerce.quotes.values()];
      const orders = [...state.commerce.orders.values()];
      const fulfillments = state.commerce.fulfillment === null ? [] : [state.commerce.fulfillment];
      const result = buildSpineBoard({
        tenant: state.tenant,
        needs: [state.commerce.need],
        demands: [state.commerce.demand],
        quotes,
        orders,
        fulfillments,
        computedAt: step.computedAt,
      });
      if (!result.ok) return { "spine.ok": false, "spine.reasonCode": result.reasonCode, "spine.detail": result.detail };
      const orderCard = result.board.cards.find((c) => c.stage === "order");
      const fulfillmentCard = result.board.cards.find((c) => c.stage === "fulfillment");
      return {
        "spine.ok": true,
        "spine.needCount": result.board.counts.find((c) => c.stage === "need")?.count ?? -1,
        "spine.demandCount": result.board.counts.find((c) => c.stage === "demand")?.count ?? -1,
        "spine.quoteCountLines": result.board.counts.filter((c) => c.stage === "quote").map((c) => `${c.key}:${c.count}`),
        "spine.orderCountLines": result.board.counts.filter((c) => c.stage === "order").map((c) => `${c.key}:${c.count}`),
        "spine.fulfillmentCountLines": result.board.counts.filter((c) => c.stage === "fulfillment").map((c) => `${c.key}:${c.count}`),
        "spine.orderParent": orderCard?.parentId ?? null,
        "spine.fulfillmentParent": fulfillmentCard?.parentId ?? null,
        "spine.supersededQuotes": result.board.supersededQuotes,
        "spine.cardCount": result.board.cards.length,
        "spine.digest": result.board.digest,
      };
    }
    case "reconcile": {
      const result = reconcileOrderTotals(
        { orderId: "order-1", tenant: state.tenant, orderedQuantity: step.orderedQuantity, unitCostMinor: 120_00 },
        step.receipts.map((qty, i) => ({
          orderId: "order-1",
          tenant: state.tenant,
          receivedQuantity: qty,
          receivedAt: CLOCK.t3 + i,
        })),
      );
      if (!result.ok) return { "recon.ok": false, "recon.reasonCode": result.reasonCode };
      logPush(
        state,
        "recon.classificationLog",
        `${result.reconciliation.classification}:${result.reconciliation.varianceBps}`,
      );
      return {
        "recon.ok": true,
        "recon.classification": result.reconciliation.classification,
        "recon.varianceBps": result.reconciliation.varianceBps,
        "recon.receivedQuantity": result.reconciliation.receivedQuantity,
        "recon.receiptCount": result.reconciliation.receiptCount,
        "recon.varianceQuantity": result.reconciliation.varianceQuantity,
      };
    }
    case "vendor-lifecycle": {
      const command =
        step.command === "suspend"
          ? { type: "suspend" as const, reason: step.reason ?? "sla breach" }
          : step.command === "reinstate"
            ? { type: "reinstate" as const, reason: step.reason ?? "remediation accepted" }
            : step.command === "terminate"
              ? { type: "terminate" as const, reason: step.reason ?? "contract ended", at: CLOCK.t3 }
              : { type: "activate" as const };
      const result = transitionVendorLifecycle(state.vendor.record, command);
      if (result.ok) state.vendor.record = result.next;
      logPush(
        state,
        "vendor.log",
        `${result.ok}:${result.ok ? result.next.status : result.reasonCode}`,
      );
      return {
        "vendor.ok": result.ok,
        "vendor.status": state.vendor.record.status,
        "vendor.reasonCode": result.ok ? null : result.reasonCode,
        "vendor.reinstatementCount": state.vendor.record.reinstatementCount,
      };
    }
    case "vendor-verify-capability": {
      const result = verifyVendorCapability(
        state.vendor.capabilities,
        state.vendor.record.vendorId,
        step.tag,
        step.evidenceId === null ? null : { evidenceId: step.evidenceId, tenantId: state.tenant.tenantId },
        CLOCK.t2,
      );
      if (result.ok) state.vendor.capabilities = [...result.records];
      logPush(state, "vendorVerify.log", `${result.ok}:${result.ok ? null : result.reasonCode}`);
      return {
        "vendorVerify.ok": result.ok,
        "vendorVerify.reasonCode": result.ok ? null : result.reasonCode,
        "vendorVerify.tag": step.tag,
      };
    }
    case "vendor-exposure": {
      const result =
        step.op === "commit"
          ? commitServiceExposure(state.vendor.exposure, step.amountMinorUnits)
          : releaseServiceExposure(state.vendor.exposure, step.amountMinorUnits);
      if (result.ok) state.vendor.exposure = result.ledger;
      logPush(
        state,
        "exposure.log",
        `${result.ok}:${result.ok ? result.ledger.committedMinorUnits : result.overshootMinorUnits}`,
      );
      return {
        "exposure.ok": result.ok,
        "exposure.committedMinorUnits": result.ok ? result.ledger.committedMinorUnits : -1,
        "exposure.reasonCode": result.ok ? null : result.reasonCode,
        "exposure.overshootMinorUnits": result.ok ? null : result.overshootMinorUnits,
      };
    }
    case "vendor-kpi-view": {
      const result = buildVendorKpiRollup({
        tenant: state.tenant,
        vendors: [state.vendor.record],
        quotes: [...state.commerce.quotes.values()],
        exposures: [state.vendor.exposure],
        computedAt: step.computedAt,
      });
      if (!result.ok) return { "kpi.ok": false, "kpi.reasonCode": result.reasonCode, "kpi.detail": result.detail };
      const row = result.rows.find((r) => r.vendorId === "ven-1");
      return {
        "kpi.ok": true,
        "kpi.status": row?.status ?? null,
        "kpi.acceptanceBps": row?.acceptanceBps ?? -1,
        "kpi.quotesAccepted": row?.quotesAccepted ?? -1,
        "kpi.quotesRejected": row?.quotesRejected ?? -1,
        "kpi.quotesSuperseded": row?.quotesSuperseded ?? -1,
        "kpi.exposureUtilizationBps": row?.exposure?.utilizationBps ?? -1,
        "kpi.exposureRemaining": row?.exposure?.remainingMinorUnits ?? -1,
        "kpi.digest": result.digest,
      };
    }
    case "entitlement-check": {
      const result = checkEntitlement(state.software.subscription, state.software.entitlements, {
        tenant: state.tenant,
        subscriptionId: state.software.subscription.id,
        requestedSeats: step.requestedSeats,
      });
      logPush(state, "entitlement.log", `${result.ok}:${result.ok ? result.remainingSeats : result.reasonCode}`);
      return {
        "entitlement.ok": result.ok,
        "entitlement.remainingSeats": result.ok ? result.remainingSeats : -1,
        "entitlement.reasonCode": result.ok ? null : result.reasonCode,
        "entitlement.overshootSeats": result.ok ? null : result.overshootSeats,
      };
    }
    case "grant-assign": {
      const grant = state.software.grants.find((g) => g.id === step.grantId);
      if (grant === undefined) return { "grant.ok": false, "grant.reasonCode": "GRANT_NOT_FOUND" };
      const result = assignGrantWithinPopulation(
        grant,
        state.software.grants,
        state.software.catalogEntry,
        state.software.subscription,
        step.assigneeId,
        CLOCK.t2,
      );
      if (result.ok) {
        state.software.grants = state.software.grants.map((g) => (g.id === step.grantId ? result.next : g));
      }
      return {
        "grant.ok": result.ok,
        "grant.reasonCode": result.ok ? null : result.reasonCode,
        "grant.overshootSeats": result.ok ? null : result.overshootSeats,
        "grant.heldSeatsAfter": result.ok ? result.heldSeatsAfter : -1,
        "grant.status": result.ok ? result.next.status : null,
      };
    }
    case "grant-revoke": {
      const grant = state.software.grants.find((g) => g.id === step.grantId);
      if (grant === undefined) return { "grantRevoke.ok": false, "grantRevoke.reasonCode": "GRANT_NOT_FOUND" };
      const result = revokeGrant(grant, step.reason, CLOCK.t3);
      if (result.ok) {
        state.software.grants = state.software.grants.map((g) => (g.id === step.grantId ? result.next : g));
      }
      return {
        "grantRevoke.ok": result.ok,
        "grantRevoke.reasonCode": result.ok ? null : result.reasonCode,
        "grantRevoke.heldSeatsAfter": countHeldSeats("sub-1", state.software.grants),
        "grantRevoke.status": result.ok ? result.next.status : null,
      };
    }
    case "seat-view": {
      const result = buildSeatView({
        tenant: state.tenant,
        subscriptions: [state.software.subscription],
        entitlements: state.software.entitlements,
        now: step.now,
        computedAt: step.computedAt,
      });
      if (!result.ok) return { "seats.ok": false, "seats.reasonCode": result.reasonCode, "seats.detail": result.detail };
      const row = result.rows.find((r) => r.subscriptionId === "sub-1");
      return {
        "seats.ok": true,
        "seats.allocated": row?.seatsAllocated ?? -1,
        "seats.total": row?.seatsTotal ?? -1,
        "seats.revoked": row?.seatsRevoked ?? -1,
        "seats.overAllocated": row?.seatsOverAllocated ?? -1,
        "seats.utilizationBps": row?.utilizationBps ?? -1,
        "seats.expired": row?.expired ?? false,
        "seats.digest": result.digest,
      };
    }
    default:
      return runExternalStep(step, state);
  }
}
