/**
 * infrastructure/fleetos-marketplace/api-orders.ts — the order/ack/approval
 * verb families (F370C, Wave 18 lane C; see api.ts for the response
 * convention). Composes the REAL F370A authenticated verbs over the
 * EXISTING F361C order lifecycle + the F361B Guardian approval contract —
 * the two-layer law surfaces here: the GATE authorizes the caller, the
 * GUARDIAN still decides the order (an over-limit approval is evaluated
 * DATA — a refusal decision, never a transport failure).
 */

import { authenticatedAcknowledgeProviderOrder, authenticatedDraftEquipmentMarketplaceOrder, authenticatedEvaluateMarketplaceOrderApproval, authenticatedPlaceEquipmentMarketplaceOrder } from "@fleetos/identity";
import type { MarketplaceOrderApprovalRequest, Policy } from "@fleetos/policy";
import { transitionEquipmentMarketplaceOrder } from "@fleetos/procurement";
import type { ApiOutcome, Json, ServiceContext } from "./api.js";
import { domainRefusal, gateRefusal, innerOk, notFound, num, okResult, refusalCode, refusalOf, str } from "./api.js";
import { beginVerb, callOf, callerOf, journalAttempt } from "./api-verbs.js";

export async function handleOrderDraft(ctx: ServiceContext, token: string | null, body: Json): Promise<ApiOutcome> {
  const now = num(body["now"]) ?? 0;
  const claimed = str(body["tenantId"]);
  const begun = await beginVerb(ctx, token, now, "order", "order.draft", claimed);
  if (!begun.ok || begun.identity === undefined) return begun.outcome!;
  const caller = callerOf(begun.identity);
  const actorId = begun.identity.claims.actorId;
  const order = (body["order"] ?? {}) as Json;
  const result = authenticatedDraftEquipmentMarketplaceOrder(callOf(begun.identity, now), { tenantId: claimed }, {
    orderId: str(order["orderId"]), requestId: str(order["requestId"]), offerId: str(order["offerId"]),
    supplierId: str(order["supplierId"]), sku: str(order["sku"]), quantity: num(order["quantity"]) ?? 0,
    unitCostMinor: num(order["unitCostMinor"]) ?? 0, totalCostMinor: num(order["totalCostMinor"]) ?? 0,
    currency: str(order["currency"]),
  });
  if (result.ok) {
    const inner = innerOk(result);
    await ctx.store.transact(async (tx) => {
      await tx.saveOrder(caller, inner.order);
      await tx.appendAudit(caller, { at: now, actorId, tenantId: caller.tenantId, family: "order", op: "order.draft", ok: true, duplicate: false, detail: inner.order.orderId });
    });
  } else {
    await journalAttempt(ctx, caller, actorId, now, "order", "order.draft", false, false, refusalCode(refusalOf(result)));
  }
  if (!result.ok && result.refusedBy === "gate") return gateRefusal(result.refusal);
  return { status: 200, body: result };
}

export async function handleOrderPlace(ctx: ServiceContext, token: string | null, body: Json): Promise<ApiOutcome> {
  const now = num(body["now"]) ?? 0;
  const claimed = str(body["tenantId"]);
  const begun = await beginVerb(ctx, token, now, "order", "order.place", claimed);
  if (!begun.ok || begun.identity === undefined) return begun.outcome!;
  const caller = callerOf(begun.identity);
  const actorId = begun.identity.claims.actorId;
  const current = await ctx.store.findOrder(caller, str(body["orderId"]));
  if (current === null) return notFound("order");
  const result = authenticatedPlaceEquipmentMarketplaceOrder(callOf(begun.identity, now), current, num(body["at"]) ?? now);
  if (result.ok) {
    const inner = innerOk(result);
    await ctx.store.transact(async (tx) => {
      await tx.saveOrder(caller, inner.order);
      await tx.appendAudit(caller, { at: now, actorId, tenantId: caller.tenantId, family: "order", op: "order.place", ok: true, duplicate: false, detail: inner.order.orderId });
    });
  } else {
    await journalAttempt(ctx, caller, actorId, now, "order", "order.place", false, false, refusalCode(refusalOf(result)));
  }
  if (!result.ok && result.refusedBy === "gate") return gateRefusal(result.refusal);
  return { status: 200, body: result };
}

export async function handleOrderTransition(ctx: ServiceContext, token: string | null, body: Json): Promise<ApiOutcome> {
  const now = num(body["now"]) ?? 0;
  const claimed = str(body["tenantId"]);
  const begun = await beginVerb(ctx, token, now, "order", "order.transition", claimed);
  if (!begun.ok || begun.identity === undefined) return begun.outcome!;
  const gate = ctx.gate(callOf(begun.identity, now), { kind: "order", tenantId: claimed });
  if (!gate.ok) {
    await journalAttempt(ctx, { tenantId: claimed || "-" }, "-", now, "order", "order.transition", false, false, gate.reason);
    return gateRefusal(gate);
  }
  const caller = callerOf(begun.identity);
  const actorId = begun.identity.claims.actorId;
  const command = (body["command"] ?? {}) as Json;
  const current = await ctx.store.findOrder(caller, str(body["orderId"]));
  if (current === null) return notFound("order");
  const result = transitionEquipmentMarketplaceOrder(current, {
    type: str(command["type"]) as never,
    at: num(command["at"]) ?? now,
    ...(str(command["reason"]) !== "" ? { reason: str(command["reason"]) } : {}),
  });
  if (result.ok) {
    await ctx.store.transact(async (tx) => {
      await tx.saveOrder(caller, result.order);
      await tx.appendAudit(caller, { at: now, actorId, tenantId: caller.tenantId, family: "order", op: "order.transition", ok: true, duplicate: false, detail: result.order.status });
    });
    return okResult(gate, result);
  }
  await journalAttempt(ctx, caller, actorId, now, "order", "order.transition", false, false, result.reasonCode);
  return domainRefusal({ ok: false, reasonCode: result.reasonCode });
}

export async function handleOrderAck(ctx: ServiceContext, token: string | null, body: Json): Promise<ApiOutcome> {
  const now = num(body["now"]) ?? 0;
  const claimed = str(body["tenantId"]);
  const begun = await beginVerb(ctx, token, now, "ack", "order.ack", claimed);
  if (!begun.ok || begun.identity === undefined) return begun.outcome!;
  const caller = callerOf(begun.identity);
  const actorId = begun.identity.claims.actorId;
  const current = await ctx.store.findOrder(caller, str(body["orderId"]));
  if (current === null) return notFound("order");
  const ack = (body["ack"] ?? {}) as Json;
  const evidence = (ack["evidence"] ?? {}) as Json;
  const providerEventId = str(ack["providerEventId"]);
  const evidenceId = str(evidence["evidenceId"]);
  const channel = str(ack["channel"]);
  const acknowledgedAt = num(ack["acknowledgedAt"]) ?? now;
  const result = authenticatedAcknowledgeProviderOrder(callOf(begun.identity, now), current, {
    providerEventId,
    evidence: { evidenceId, tenantId: str(evidence["tenantId"]) },
    channel: channel as never,
    acknowledgedAt,
  });
  if (result.ok) {
    const inner = innerOk(result);
    await ctx.store.transact(async (tx) => {
      await tx.saveOrder(caller, inner.order);
      await tx.appendProviderAck(caller, {
        tenantId: caller.tenantId, orderId: inner.order.orderId, providerEventId,
        evidenceId, channel, acknowledgedAt, duplicate: inner.duplicate,
      });
      await tx.appendAudit(caller, { at: now, actorId, tenantId: caller.tenantId, family: "ack", op: "order.ack", ok: true, duplicate: inner.duplicate, detail: `${inner.order.orderId}:${providerEventId}` });
    });
  } else {
    await journalAttempt(ctx, caller, actorId, now, "ack", "order.ack", false, false, refusalCode(refusalOf(result)));
  }
  if (!result.ok && result.refusedBy === "gate") return gateRefusal(result.refusal);
  return { status: 200, body: result };
}

export async function handleApproval(ctx: ServiceContext, token: string | null, body: Json): Promise<ApiOutcome> {
  const now = num(body["now"]) ?? 0;
  const claimed = str(body["tenantId"]);
  const begun = await beginVerb(ctx, token, now, "approval", "approval.evaluate", claimed);
  if (!begun.ok || begun.identity === undefined) return begun.outcome!;
  const caller = callerOf(begun.identity);
  const actorId = begun.identity.claims.actorId;
  const policy = (body["policy"] ?? null) as Policy | null;
  if (policy === null) return domainRefusal({ ok: false, reasonCode: "POLICY_REQUIRED" });
  const request: MarketplaceOrderApprovalRequest = {
    requestId: str(body["requestId"]),
    tenant: { tenantId: claimed },
    actor: {
      actorId,
      authority: (Array.isArray(body["actorAuthority"]) ? body["actorAuthority"] : []) as never,
      isAutonomous: body["actorAutonomous"] === true,
    },
    order: (body["order"] ?? {}) as never,
    limits: (body["limits"] ?? {}) as never,
    policyRefs: (Array.isArray(body["policyRefs"]) ? body["policyRefs"] : []) as never,
    ...(body["advisory"] !== undefined ? { advisory: body["advisory"] as never } : {}),
  };
  const result = authenticatedEvaluateMarketplaceOrderApproval(callOf(begun.identity, now), policy, request);
  if (result.ok) {
    // The Guardian decision — approve OR refuse — is evaluated DATA; both
    // are retained (appendApproval, idempotent by the deterministic id).
    const approval = result.result;
    await ctx.store.transact(async (tx) => {
      await tx.appendApproval(caller, approval);
      await tx.appendAudit(caller, { at: now, actorId, tenantId: caller.tenantId, family: "approval", op: "approval.evaluate", ok: true, duplicate: false, detail: `${approval.decision}:${approval.reasonCode}` });
    });
  } else {
    await journalAttempt(ctx, caller, actorId, now, "approval", "approval.evaluate", false, false, refusalCode(refusalOf(result)));
  }
  if (!result.ok && result.refusedBy === "gate") return gateRefusal(result.refusal);
  return { status: 200, body: result };
}
