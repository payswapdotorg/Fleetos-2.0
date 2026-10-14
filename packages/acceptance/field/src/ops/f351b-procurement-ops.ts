/**
 * @fleetos/acceptance-field — F351B operation executors: the procurement
 * ordering discipline (procurement package; census §1 rows M1 + O1, zero
 * corpus coverage at base `4f59ffe`).
 *
 * Every executor drives a REAL public API of @fleetos/procurement
 * (matchVendors — the deterministic scoring/tie-break engine;
 * createOrder — the Guardian-authorization law A5; transitionOrder as
 * the commerce-covered lifecycle substrate) and records readings from
 * the REAL outputs — never re-derived. A refused creation/transition is
 * the REAL machine-stable reason code; foreign-tenant vendors are
 * fail-closed filtered by the REAL matcher.
 */

import {
  createOrder,
  matchVendors,
  transitionOrder,
  type GuardianDecisionRefLike,
  type Order,
  type OrderTransitionCommand,
  type ProcurementDemand,
  type VendorCapabilityRefLike,
} from "@fleetos/procurement";
import type { JourneyOperation } from "../journey-contracts.js";
import type { JourneyContext } from "../context.js";
import { opOk, opRefused, type OpExecution } from "./common.js";

function orderOf(ctx: JourneyContext, orderId: string): Order | undefined {
  return ctx.f351bOrders.get(orderId);
}

function orderCommandOf(op: Extract<JourneyOperation, { kind: "pr.order-transition" }>): OrderTransitionCommand {
  switch (op.command) {
    case "confirm":
      return { type: "confirm" };
    case "ship":
      return { type: "ship" };
    case "receive":
      return { type: "receive" };
    case "cancel":
      return { type: "cancel" };
  }
}

export function executeF351BProcurementOperation(op: JourneyOperation, ctx: JourneyContext): OpExecution {
  switch (op.kind) {
    case "pr.match": {
      const demand: ProcurementDemand = {
        id: { kind: "procurement-demand", value: `dem_${op.needId}` },
        tenant: { tenantId: ctx.tenantId },
        needId: { kind: "need", value: op.needId },
        quantity: op.quantity,
        requiredBy: op.requiredBy,
        capabilityTags: [...op.capabilityTags],
      };
      const vendors: VendorCapabilityRefLike[] = op.vendors.map((v) => ({
        vendorId: v.vendorId,
        tenant: { tenantId: v.tenantId ?? ctx.tenantId },
        capabilityTags: [...v.capabilityTags],
        serviceLevel: v.serviceLevel,
        unitCost: v.unitCost,
      }));
      const matches = matchVendors(demand, vendors);
      const tieBreaks = matches.slice(1).map((m) => m.tieBreakRule).filter((t): t is NonNullable<typeof t> => t !== null);
      return opOk({
        "pr.matchCount": matches.length,
        "pr.topVendorId": matches.length > 0 ? matches[0]!.vendorId : null,
        "pr.topMatchedTags": matches.length > 0 ? [...matches[0]!.matchedTags] : [],
        "pr.tieBreaks": tieBreaks,
        "pr.vendorIds": matches.map((m) => m.vendorId),
      });
    }
    case "pr.order-create": {
      const guardian = (op.guardian ?? undefined) as GuardianDecisionRefLike | undefined;
      const result = createOrder(
        { kind: "order", value: op.orderId },
        { tenantId: ctx.tenantId },
        { kind: "quote", value: op.quoteId },
        guardian as unknown as GuardianDecisionRefLike,
      );
      if (!result.ok) {
        return opRefused(result.reasonCode, {
          "pr.reasonCode": result.reasonCode,
          "pr.orderStatus": null,
        });
      }
      ctx.f351bOrders.set(op.orderId, result.next);
      return opOk({
        "pr.reasonCode": null,
        "pr.orderStatus": result.next.status,
        "pr.orderQuoteId": result.next.quoteId.value,
      });
    }
    case "pr.order-transition": {
      const current = orderOf(ctx, op.orderId);
      if (current === undefined) return opRefused("unknown-order", { "pr.reasonCode": "UNKNOWN_ORDER" });
      const result = transitionOrder(current, orderCommandOf(op));
      if (!result.ok) {
        return opRefused(result.reasonCode, {
          "pr.reasonCode": result.reasonCode,
          "pr.orderStatus": current.status,
        });
      }
      ctx.f351bOrders.set(op.orderId, result.next);
      return opOk({ "pr.reasonCode": null, "pr.orderStatus": result.next.status });
    }
    default:
      return opRefused("unknown-operation");
  }
}
