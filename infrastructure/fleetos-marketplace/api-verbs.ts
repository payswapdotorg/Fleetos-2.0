/**
 * infrastructure/fleetos-marketplace/api-verbs.ts — the request/offer/
 * comparison verb families (F370C, Wave 18 lane C; see api.ts for the
 * response convention). Composes the REAL F370A authenticated verbs
 * (the gate runs INSIDE them) over the EXISTING F361C kernels, persisting
 * through the PostgreSQL store — write-before-ack, one transaction per
 * request. The comparison reads the caller's offers FROM THE STORE (A1:
 * the authoritative set, not a caller-supplied list).
 */

import { authenticatedCaptureMarketplaceOffer, authenticatedCompareMarketplaceOffers, authenticatedSubmitEquipmentRequest } from "@fleetos/identity";
import type { EquipmentRequest, MarketplaceOfferDemand, SupplierVerificationLike } from "@fleetos/procurement";
import { buildCurrentOfferSheet, transitionEquipmentRequest } from "@fleetos/procurement";
import type { ApiOutcome, Json, ServiceContext } from "./api.js";
import { badRequest, boundaryRefusal, domainRefusal, gateRefusal, innerOk, notFound, num, numParam, okResult, refusalCode, refusalOf, str } from "./api.js";
import { comparisonSheetId } from "./pglite-store.js";
import type { MarketplaceStoreCaller, RetainedComparisonSheet } from "./store.js";

/** The authenticated call for the composed verbs (the inner fss1 token +
 *  the resolved key — the F370A gate runs INSIDE the composed verb). */
export function callOf(identity: { readonly innerToken: string; readonly key: { readonly algorithm: "HMAC-SHA256"; readonly secretHex: string } }, now: number): { readonly token: string; readonly key: { readonly algorithm: "HMAC-SHA256"; readonly secretHex: string }; readonly now: number } {
  return { token: identity.innerToken, key: identity.key, now };
}

/** The authenticated caller (the session tenant — A8). */
export function callerOf(identity: { readonly claims: { readonly tenantId: string } }): MarketplaceStoreCaller {
  return { tenantId: identity.claims.tenantId };
}

export interface Begun {
  readonly ok: boolean;
  readonly outcome?: ApiOutcome;
  readonly identity?: { readonly claims: { readonly actorId: string; readonly tenantId: string }; readonly innerToken: string; readonly key: { readonly algorithm: "HMAC-SHA256"; readonly secretHex: string } };
  readonly now: number;
}

/** The shared verb prologue: authenticate (the F370B stack); journal the
 *  boundary refusal (attempt data — the fixed reason code only). */
export async function beginVerb(ctx: ServiceContext, token: string | null, now: number, family: string, op: string, claimedTenant: string): Promise<Begun> {
  const auth = ctx.authenticate({ token, now });
  if (!auth.ok) {
    await ctx.store.appendAudit({ tenantId: claimedTenant || "-" }, { at: now, actorId: "-", tenantId: claimedTenant || "-", family, op, ok: false, duplicate: false, detail: auth.reason });
    return { ok: false, outcome: boundaryRefusal({ reason: auth.reason, detail: auth.detail }), now };
  }
  return { ok: true, identity: auth.identity, now };
}

/** Journal one mutating attempt (the A19 record — acks, duplicates and
 *  refusals alike; fixed reason codes, never token/key material). */
export async function journalAttempt(ctx: ServiceContext, caller: MarketplaceStoreCaller, actorId: string, at: number, family: string, op: string, ok: boolean, duplicate: boolean, detail: string): Promise<void> {
  await ctx.store.appendAudit(caller, { at, actorId, tenantId: caller.tenantId, family, op, ok, duplicate, detail });
}

// --- F361C requests ---------------------------------------------------------

export async function handleRequestSubmit(ctx: ServiceContext, token: string | null, body: Json): Promise<ApiOutcome> {
  const now = num(body["now"]) ?? 0;
  const claimed = str(body["tenantId"]);
  const begun = await beginVerb(ctx, token, now, "request", "request.submit", claimed);
  if (!begun.ok || begun.identity === undefined) return begun.outcome!;
  const caller = callerOf(begun.identity);
  const actorId = begun.identity.claims.actorId;
  const existing = await ctx.store.listRequests(caller);
  const result = authenticatedSubmitEquipmentRequest(callOf(begun.identity, now), { tenantId: claimed }, {
    requestId: str(body["requestId"]), naturalKey: str(body["naturalKey"]), sku: str(body["sku"]),
    quantity: num(body["quantity"]) ?? 0, requiredBy: str(body["requiredBy"]), at: num(body["at"]) ?? now,
  }, existing);
  if (result.ok) {
    const inner = innerOk(result);
    if (!inner.duplicate) {
      await ctx.store.transact(async (tx) => {
        await tx.saveRequest(caller, inner.request);
        await tx.appendAudit(caller, { at: now, actorId, tenantId: caller.tenantId, family: "request", op: "request.submit", ok: true, duplicate: false, detail: inner.request.requestId });
      });
    } else {
      await journalAttempt(ctx, caller, actorId, now, "request", "request.submit", true, true, inner.request.requestId);
    }
  } else {
    await journalAttempt(ctx, caller, actorId, now, "request", "request.submit", false, false, refusalCode(refusalOf(result)));
  }
  if (!result.ok && result.refusedBy === "gate") return gateRefusal(result.refusal);
  return { status: 200, body: result };
}

export async function handleRequestTransition(ctx: ServiceContext, token: string | null, body: Json): Promise<ApiOutcome> {
  const now = num(body["now"]) ?? 0;
  const claimed = str(body["tenantId"]);
  const begun = await beginVerb(ctx, token, now, "request", "request.transition", claimed);
  if (!begun.ok || begun.identity === undefined) return begun.outcome!;
  const gate = ctx.gate(callOf(begun.identity, now), { kind: "request", tenantId: claimed });
  if (!gate.ok) {
    await journalAttempt(ctx, { tenantId: claimed || "-" }, "-", now, "request", "request.transition", false, false, gate.reason);
    return gateRefusal(gate);
  }
  const caller = callerOf(begun.identity);
  const actorId = begun.identity.claims.actorId;
  const command = (body["command"] ?? {}) as Json;
  const current = (await ctx.store.listRequests(caller)).find((r: EquipmentRequest) => r.requestId === str(body["requestId"])) ?? null;
  if (current === null) return notFound("request");
  const result = transitionEquipmentRequest(current, {
    type: str(command["type"]) as never,
    at: num(command["at"]) ?? now,
    ...(str(command["reason"]) !== "" ? { reason: str(command["reason"]) } : {}),
    ...(str(command["offerId"]) !== "" ? { offerId: str(command["offerId"]) } : {}),
  });
  if (result.ok) {
    await ctx.store.transact(async (tx) => {
      await tx.saveRequest(caller, result.next);
      await tx.appendAudit(caller, { at: now, actorId, tenantId: caller.tenantId, family: "request", op: "request.transition", ok: true, duplicate: false, detail: result.next.status });
    });
    return okResult(gate, result);
  }
  await journalAttempt(ctx, caller, actorId, now, "request", "request.transition", false, false, result.reasonCode);
  return domainRefusal({ ok: false, reasonCode: result.reasonCode });
}

// --- F361C offers + comparison ---------------------------------------------

export async function handleOfferCapture(ctx: ServiceContext, token: string | null, body: Json): Promise<ApiOutcome> {
  const now = num(body["now"]) ?? 0;
  const claimed = str(body["tenantId"]);
  const begun = await beginVerb(ctx, token, now, "offer", "offer.capture", claimed);
  if (!begun.ok || begun.identity === undefined) return begun.outcome!;
  const caller = callerOf(begun.identity);
  const actorId = begun.identity.claims.actorId;
  const offer = (body["offer"] ?? {}) as Json;
  const source = (offer["source"] ?? {}) as Json;
  const result = authenticatedCaptureMarketplaceOffer(callOf(begun.identity, now), { tenantId: claimed }, {
    offerId: str(offer["offerId"]), supplierId: str(offer["supplierId"]), sku: str(offer["sku"]),
    quantity: num(offer["quantity"]) ?? 0, unitCostMinor: num(offer["unitCostMinor"]) ?? 0,
    totalCostMinor: num(offer["totalCostMinor"]) ?? 0, currency: str(offer["currency"]),
    taxMinor: num(offer["taxMinor"]) ?? 0, feesMinor: num(offer["feesMinor"]) ?? 0,
    deliveryEstimateDays: num(offer["deliveryEstimateDays"]) ?? 0,
    condition: str(offer["condition"]) as never, warrantyMonths: num(offer["warrantyMonths"]) ?? 0,
    validFrom: num(offer["validFrom"]) ?? 0, validUntil: num(offer["validUntil"]) ?? 0,
    source: { kind: str(source["kind"]) as never, reference: str(source["reference"]) },
    capturedAt: num(offer["capturedAt"]) ?? now,
  });
  if (result.ok) {
    const inner = innerOk(result);
    await ctx.store.transact(async (tx) => {
      await tx.saveOffer(caller, inner.offer);
      await tx.appendAudit(caller, { at: now, actorId, tenantId: caller.tenantId, family: "offer", op: "offer.capture", ok: true, duplicate: false, detail: inner.offer.offerId });
    });
  } else {
    await journalAttempt(ctx, caller, actorId, now, "offer", "offer.capture", false, false, refusalCode(refusalOf(result)));
  }
  if (!result.ok && result.refusedBy === "gate") return gateRefusal(result.refusal);
  return { status: 200, body: result };
}

export async function handleOfferSheet(ctx: ServiceContext, token: string | null, query: URLSearchParams): Promise<ApiOutcome> {
  const now = numParam(query.get("now")) ?? 0;
  const claimed = query.get("tenantId") ?? "";
  const at = numParam(query.get("at"));
  const begun = await beginVerb(ctx, token, now, "offer", "offer.sheet", claimed);
  if (!begun.ok || begun.identity === undefined) return begun.outcome!;
  const gate = ctx.gate(callOf(begun.identity, now), { kind: "offer", tenantId: claimed });
  if (!gate.ok) return gateRefusal(gate);
  if (at === null) return badRequest("the offer sheet requires a logical `at` (the fixture-clock law)");
  const caller = callerOf(begun.identity);
  const sheet = buildCurrentOfferSheet({ tenantId: claimed }, await ctx.store.listOffers(caller), at);
  return okResult(gate, sheet);
}

export async function handleComparison(ctx: ServiceContext, token: string | null, body: Json): Promise<ApiOutcome> {
  const now = num(body["now"]) ?? 0;
  const claimed = str(body["tenantId"]);
  const begun = await beginVerb(ctx, token, now, "comparison", "comparison.compare", claimed);
  if (!begun.ok || begun.identity === undefined) return begun.outcome!;
  const caller = callerOf(begun.identity);
  const actorId = begun.identity.claims.actorId;
  const demandBody = (body["demand"] ?? {}) as Json;
  const at = num(body["at"]) ?? now;
  const demand: MarketplaceOfferDemand = {
    tenant: { tenantId: claimed },
    sku: str(demandBody["sku"]),
    currency: str(demandBody["currency"]),
    acceptableConditions: (Array.isArray(demandBody["acceptableConditions"]) ? demandBody["acceptableConditions"] : []) as never,
  };
  const verifications = (Array.isArray(body["supplierVerifications"]) ? body["supplierVerifications"] : []) as readonly SupplierVerificationLike[];
  const weights = body["weights"] === undefined ? undefined : (body["weights"] as never);
  const offers = await ctx.store.listOffers(caller);
  const result = authenticatedCompareMarketplaceOffers(callOf(begun.identity, now), demand, offers, verifications, { at, ...(weights !== undefined ? { weights } : {}) });
  if (result.ok) {
    const inner = innerOk(result);
    const base = {
      tenantId: caller.tenantId,
      demand: { sku: demand.sku, currency: demand.currency, acceptableConditions: [...demand.acceptableConditions] },
      comparedAt: at,
      rankedOfferIds: inner.ranked.map((r) => r.quoteId),
      eligibleCount: inner.eligibleCount,
      ineligibleCount: inner.ineligibleCount,
      topOfferId: inner.ranked[0]?.quoteId ?? null,
    };
    const sheet: RetainedComparisonSheet = { sheetId: comparisonSheetId(base), ...base };
    const appended = await ctx.store.appendComparisonSheet(caller, sheet);
    await journalAttempt(ctx, caller, actorId, now, "comparison", "comparison.compare", true, appended.duplicate, sheet.sheetId);
  } else {
    await journalAttempt(ctx, caller, actorId, now, "comparison", "comparison.compare", false, false, refusalCode(refusalOf(result)));
  }
  if (!result.ok && result.refusedBy === "gate") return gateRefusal(result.refusal);
  return { status: 200, body: result };
}
