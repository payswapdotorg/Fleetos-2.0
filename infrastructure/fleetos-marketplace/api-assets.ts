/**
 * infrastructure/fleetos-marketplace/api-assets.ts — the receipt/enrollment
 * verb families + the evidence endpoint (F370C, Wave 18 lane C; see api.ts
 * for the response convention). Composes the REAL F370A authenticated
 * verbs over the EXISTING F361A directory (ReceiptEnrollmentDirectory over
 * the PG-backed REAL ports — write-before-ack via the one flush per
 * request) and the F361B MarketplaceEvidenceStorePort over PostgreSQL.
 */

import type { MarketplaceEvidenceInput } from "@fleetos/evidence";
import { authenticatedCompleteEnrollment, authenticatedOpenEnrollment, authenticatedRecordReceipt, authenticatedVerifyReceipt } from "@fleetos/identity";
import type { ApiOutcome, Json, RequestLike, ServiceContext } from "./api.js";
import { EVIDENCE_KIND_ACTION, badRequest, bearerTokenOf, domainRefusal, gateRefusal, innerOk, num, numParam, okResult, refusalCode, refusalOf, str } from "./api.js";
import { beginVerb, callOf, callerOf, journalAttempt } from "./api-verbs.js";

export async function handleReceiptRecord(ctx: ServiceContext, token: string | null, body: Json): Promise<ApiOutcome> {
  const now = num(body["now"]) ?? 0;
  const receipt = (body["receipt"] ?? {}) as Json;
  const claimed = str(receipt["tenantId"]);
  const begun = await beginVerb(ctx, token, now, "receipt", "receipt.record", claimed);
  if (!begun.ok || begun.identity === undefined) return begun.outcome!;
  const caller = callerOf(begun.identity);
  const actorId = begun.identity.claims.actorId;
  const result = authenticatedRecordReceipt(callOf(begun.identity, now), ctx.directory, {
    evidenceRef: str(receipt["evidenceRef"]), tenantId: claimed, siteId: str(receipt["siteId"]),
    supplierOrderRef: str(receipt["supplierOrderRef"]), serial: str(receipt["serial"]),
    assetTag: str(receipt["assetTag"]), conditionOnArrival: str(receipt["conditionOnArrival"]) as never,
    warrantyRef: str(receipt["warrantyRef"]), capturedAt: num(receipt["capturedAt"]) ?? 0,
    recordedAt: num(receipt["recordedAt"]) ?? now,
  });
  if (result.ok) {
    const inner = innerOk(result);
    await ctx.store.transact(async (tx) => {
      await tx.saveReceipt(caller, { evidence: inner.evidence });
      await tx.appendAudit(caller, { at: now, actorId, tenantId: caller.tenantId, family: "receipt", op: "receipt.record", ok: true, duplicate: inner.duplicate, detail: inner.evidence.evidenceRef });
    });
  } else {
    await journalAttempt(ctx, caller, actorId, now, "receipt", "receipt.record", false, false, refusalCode(refusalOf(result)));
  }
  if (!result.ok && result.refusedBy === "gate") return gateRefusal(result.refusal);
  return { status: 200, body: result };
}

export async function handleReceiptVerify(ctx: ServiceContext, token: string | null, body: Json): Promise<ApiOutcome> {
  const now = num(body["now"]) ?? 0;
  const claimed = str(body["tenantId"]);
  const begun = await beginVerb(ctx, token, now, "receipt", "receipt.verify", claimed);
  if (!begun.ok || begun.identity === undefined) return begun.outcome!;
  const caller = callerOf(begun.identity);
  const actorId = begun.identity.claims.actorId;
  const expectation = (body["expectation"] ?? {}) as Json;
  const decidedAt = num(body["decidedAt"]) ?? now;
  const input = {
    tenantId: claimed,
    evidenceRef: str(body["evidenceRef"]),
    expectation: {
      supplierOrderRef: str(expectation["supplierOrderRef"]),
      expectedSerial: str(expectation["expectedSerial"]),
      expectedAssetTag: str(expectation["expectedAssetTag"]),
      expectedCondition: str(expectation["expectedCondition"]) as never,
    },
    decidedAt,
  };
  const result = authenticatedVerifyReceipt(callOf(begun.identity, now), ctx.directory, input);
  if (result.ok) {
    const inner = innerOk(result);
    await ctx.store.transact(async (tx) => {
      await tx.saveReceipt(caller, { evidence: inner.evidence, verify: { expectation: input.expectation, decidedAt } });
      await tx.appendAudit(caller, { at: now, actorId, tenantId: caller.tenantId, family: "receipt", op: "receipt.verify", ok: true, duplicate: false, detail: `${inner.evidence.evidenceRef}:${inner.evidence.state}` });
    });
  } else {
    await journalAttempt(ctx, caller, actorId, now, "receipt", "receipt.verify", false, false, refusalCode(refusalOf(result)));
  }
  if (!result.ok && result.refusedBy === "gate") return gateRefusal(result.refusal);
  return { status: 200, body: result };
}

export async function handleEnrollmentOpen(ctx: ServiceContext, token: string | null, body: Json): Promise<ApiOutcome> {
  const now = num(body["now"]) ?? 0;
  const claimed = str(body["tenantId"]);
  const begun = await beginVerb(ctx, token, now, "enrollment", "enrollment.open", claimed);
  if (!begun.ok || begun.identity === undefined) return begun.outcome!;
  const caller = callerOf(begun.identity);
  const actorId = begun.identity.claims.actorId;
  const enrollment = (body["enrollment"] ?? {}) as Json;
  const input = {
    tenantId: claimed,
    evidenceRef: str(enrollment["evidenceRef"]),
    assetId: str(enrollment["assetId"]),
    displayName: str(enrollment["displayName"]),
    kind: str(enrollment["kind"]) as never,
    ...(str(enrollment["deviceId"]) !== "" ? { deviceId: str(enrollment["deviceId"]) } : {}),
    at: num(enrollment["at"]) ?? now,
    actor: actorId,
  };
  const result = authenticatedOpenEnrollment(callOf(begun.identity, now), ctx.directory, input);
  if (result.ok) {
    const inner = innerOk(result);
    // Write-before-ack: the ports' dirty records (the admitted asset + the
    // enrollment) commit in ONE PostgreSQL transaction before the response.
    await ctx.ports.flush();
    await ctx.store.transact(async (tx) => {
      await tx.appendAudit(caller, { at: now, actorId, tenantId: caller.tenantId, family: "enrollment", op: "enrollment.open", ok: true, duplicate: inner.duplicate, detail: inner.enrollment.enrollmentId });
    });
  } else {
    await journalAttempt(ctx, caller, actorId, now, "enrollment", "enrollment.open", false, false, refusalCode(refusalOf(result)));
  }
  if (!result.ok && result.refusedBy === "gate") return gateRefusal(result.refusal);
  return { status: 200, body: result };
}

export async function handleEnrollmentComplete(ctx: ServiceContext, token: string | null, body: Json): Promise<ApiOutcome> {
  const now = num(body["now"]) ?? 0;
  const claimed = str(body["tenantId"]);
  const begun = await beginVerb(ctx, token, now, "enrollment", "enrollment.complete", claimed);
  if (!begun.ok || begun.identity === undefined) return begun.outcome!;
  const caller = callerOf(begun.identity);
  const actorId = begun.identity.claims.actorId;
  const input = {
    tenantId: claimed,
    serial: str(body["serial"]),
    ...(str(body["deviceId"]) !== "" ? { deviceId: str(body["deviceId"]) } : {}),
    at: num(body["at"]) ?? now,
    actor: actorId,
  };
  const result = authenticatedCompleteEnrollment(callOf(begun.identity, now), ctx.directory, input);
  if (result.ok) {
    const inner = innerOk(result);
    // The activated asset + the twin revision + the enrollment record all
    // commit through the ports' flush (one transaction) before the ack.
    await ctx.ports.flush();
    await ctx.store.transact(async (tx) => {
      await tx.appendAudit(caller, { at: now, actorId, tenantId: caller.tenantId, family: "enrollment", op: "enrollment.complete", ok: true, duplicate: inner.duplicate, detail: `${inner.enrollment.enrollmentId}:${inner.enrollment.state}` });
    });
  } else {
    await journalAttempt(ctx, caller, actorId, now, "enrollment", "enrollment.complete", false, false, refusalCode(refusalOf(result)));
  }
  if (!result.ok && result.refusedBy === "gate") return gateRefusal(result.refusal);
  return { status: 200, body: result };
}

// --- evidence (the F361B MarketplaceEvidenceStorePort over PostgreSQL) ----

export async function handleEvidenceRetain(ctx: ServiceContext, token: string | null, body: Json): Promise<ApiOutcome> {
  const now = num(body["now"]) ?? 0;
  const input = (body["input"] ?? {}) as Json;
  const claimed = str(input["tenantId"]);
  const kind = str(input["kind"]);
  const actionKind = EVIDENCE_KIND_ACTION[kind];
  const begun = await beginVerb(ctx, token, now, "evidence", "evidence.retain", claimed);
  if (!begun.ok || begun.identity === undefined) return begun.outcome!;
  if (actionKind === undefined) {
    return badRequest(`unknown marketplace evidence kind (the four frozen kinds only): ${kind || "-"}`);
  }
  const gate = ctx.gate(callOf(begun.identity, now), { kind: actionKind, tenantId: claimed });
  if (!gate.ok) {
    await journalAttempt(ctx, { tenantId: claimed || "-" }, "-", now, "evidence", "evidence.retain", false, false, gate.reason);
    return gateRefusal(gate);
  }
  const caller = callerOf(begun.identity);
  const actorId = begun.identity.claims.actorId;
  const source = (input["source"] ?? {}) as Json;
  const evidenceInput = {
    tenantId: claimed, providerEventId: str(input["providerEventId"]), kind: kind as never,
    subjectRef: str(input["subjectRef"]),
    source: { system: str(source["system"]), reference: str(source["reference"]), retrievedVia: str(source["retrievedVia"]) as never },
    capturedAt: str(input["capturedAt"]),
    artifacts: (Array.isArray(input["artifacts"]) ? input["artifacts"] : []) as never,
  } satisfies MarketplaceEvidenceInput;
  const recorded = await ctx.evidenceStore.recordEvidence(caller, evidenceInput, str(body["recordedAt"]));
  if (recorded.ok) {
    await ctx.store.transact(async (tx) => {
      await tx.appendAudit(caller, { at: now, actorId, tenantId: caller.tenantId, family: "evidence", op: "evidence.retain", ok: true, duplicate: recorded.duplicate, detail: `${recorded.record.evidenceId}:${kind}` });
    });
  } else {
    await journalAttempt(ctx, caller, actorId, now, "evidence", "evidence.retain", false, false, recorded.reason);
  }
  return okResult(gate, recorded);
}

export async function handleEvidenceRead(ctx: ServiceContext, req: RequestLike, query: URLSearchParams): Promise<ApiOutcome> {
  const now = numParam(query.get("now")) ?? 0;
  const claimed = query.get("tenantId") ?? "";
  const kind = query.get("kind") ?? "";
  const actionKind = EVIDENCE_KIND_ACTION[kind];
  const begun = await beginVerb(ctx, bearerTokenOf(req), now, "evidence", "evidence.read", claimed);
  if (!begun.ok || begun.identity === undefined) return begun.outcome!;
  if (actionKind === undefined) return badRequest(`unknown marketplace evidence kind (the four frozen kinds only): ${kind || "-"}`);
  const gate = ctx.gate(callOf(begun.identity, now), { kind: actionKind, tenantId: claimed });
  if (!gate.ok) return gateRefusal(gate);
  const caller = callerOf(begun.identity);
  const providerEventId = query.get("providerEventId");
  const evidenceId = query.get("evidenceId");
  const subjectRef = query.get("subjectRef");
  let result: unknown = null;
  if (providerEventId !== null) result = await ctx.evidenceStore.findByProviderEvent(caller, providerEventId);
  else if (evidenceId !== null) result = await ctx.evidenceStore.readEvidence(caller, evidenceId);
  else if (subjectRef !== null) result = await ctx.evidenceStore.listBySubject(caller, subjectRef);
  else return badRequest("evidence read requires providerEventId, evidenceId or subjectRef");
  return okResult(gate, result);
}

export { domainRefusal };
