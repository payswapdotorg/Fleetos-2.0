/**
 * infrastructure/fleetos-marketplace/api-ops.ts — the tenant-scoped state
 * reads + the host-operator backup endpoint (F370C, Wave 18 lane C).
 *
 * GET /api/marketplace/state?family=X — AUTHENTICATED: the family's verb
 * authorizes the read (the fixed map); the records are the caller's OWN
 * (the session tenant — A8; cross-tenant reads find NOTHING, and there is
 * no tenant parameter to name another scope). The audit family is the
 * operator view — it requires ALL EIGHT verb scopes (the trail spans
 * every family; the gate runs once per kind and every verdict must
 * authorize).
 *
 * GET /api/admin/backup?now=N — the host-operator dump (dumpStore(): the
 * single-file canonical-JSON backup, journaled as data). UNAUTHENTICATED
 * BY DESIGN at the localhost boundary only (the sandbox law: the service
 * binds 127.0.0.1; a network-fronted deployment with an operator auth
 * channel is the networked-PG follow-up class — recorded honestly, never
 * pretended). The `now` is the caller's logical time (the fixture-clock
 * law — no wall clock in any journaled record).
 */

import type { ApiOutcome, RequestLike, ServiceContext } from "./api.js";
import { STATE_FAMILY_ACTION, badRequest, bearerTokenOf, gateRefusal, numParam, okResult } from "./api.js";
import { beginVerb, callOf, callerOf } from "./api-verbs.js";

const ALL_ACTION_KINDS: readonly string[] = [
  "request", "offer", "comparison", "order", "ack", "receipt", "enrollment", "approval",
];

export async function handleState(ctx: ServiceContext, req: RequestLike, query: URLSearchParams): Promise<ApiOutcome> {
  const now = numParam(query.get("now")) ?? 0;
  const claimed = query.get("tenantId") ?? "";
  const family = query.get("family") ?? "";
  const action = STATE_FAMILY_ACTION[family];
  const begun = await beginVerb(ctx, bearerTokenOf(req), now, family || "state", "state.read", claimed);
  if (!begun.ok || begun.identity === undefined) return begun.outcome!;
  if (action === undefined) {
    return badRequest(`unknown state family: ${family || "-"} (requests | offers | comparisonSheets | orders | providerAcks | receipts | enrollments | approvals | assets | twins | audit)`);
  }
  const caller = callerOf(begun.identity);
  if (action === "*") {
    // The audit family: ALL EIGHT verb scopes must authorize (the
    // operator view spans every family — the first refusal surfaces).
    for (const kind of ALL_ACTION_KINDS) {
      const gate = ctx.gate(callOf(begun.identity, now), { kind, tenantId: claimed });
      if (!gate.ok) return gateRefusal(gate);
    }
    const records = await ctx.store.listAudit(caller);
    return okResult({ ok: true, actorId: begun.identity.claims.actorId, tenantId: caller.tenantId, action: "audit", scope: "*" }, { family, count: records.length, records });
  }
  const gate = ctx.gate(callOf(begun.identity, now), { kind: action, tenantId: claimed });
  if (!gate.ok) return gateRefusal(gate);
  const records = await readFamily(ctx, caller, family);
  return okResult(gate, { family, count: records.length, records });
}

async function readFamily(ctx: ServiceContext, caller: { readonly tenantId: string }, family: string): Promise<readonly unknown[]> {
  switch (family) {
    case "requests": return ctx.store.listRequests(caller);
    case "offers": return ctx.store.listOffers(caller);
    case "comparisonSheets": return ctx.store.listComparisonSheets(caller);
    case "orders": return ctx.store.listOrders(caller);
    case "providerAcks": return ctx.store.listProviderAcks(caller);
    case "receipts": return ctx.store.listReceipts(caller);
    case "enrollments": return ctx.store.listEnrollments(caller);
    case "approvals": return ctx.store.listApprovals(caller);
    case "assets": return ctx.store.listAssets(caller);
    case "twins": {
      // Twins read through the enrollment machine's own port view (the
      // PG-backed TwinPort mirror — the same records the store holds).
      const enrollments = await ctx.store.listEnrollments(caller);
      const twins: unknown[] = [];
      for (const enrollment of enrollments) {
        if (enrollment.deviceId !== null) {
          const twin = await ctx.store.findTwin(caller, enrollment.deviceId);
          if (twin !== null) twins.push(twin);
        }
      }
      return twins;
    }
    default: return [];
  }
}

/** GET /api/admin/backup?now=N — the host-operator dump, journaled. */
export async function handleBackup(ctx: ServiceContext, query: URLSearchParams): Promise<ApiOutcome> {
  const now = numParam(query.get("now"));
  if (now === null) return badRequest("the backup requires a logical `now` (the fixture-clock law)");
  const dump = await ctx.store.dumpStore();
  const parsed = JSON.parse(dump) as { readonly envelope: { readonly counts: Record<string, number>; readonly digests: Record<string, string> } };
  await ctx.store.appendBackupJournal({ kind: "dump", at: now, recordCounts: parsed.envelope.counts, envelopeDigest: parsed.envelope.digests["total"] ?? "" });
  return { status: 200, body: { ok: true, dump, envelope: parsed.envelope } };
}

/** The restore boot path (the CLI's --restore flag): wipe + import +
 *  re-verify + journal the restore event, then serve. */
export async function restoreFromDump(ctx: ServiceContext, dump: string, at: number): Promise<{ ok: boolean; detail: string; digests?: Record<string, string>; counts?: Record<string, number> }> {
  const result = await ctx.store.restoreStore(dump);
  if (!result.ok) return { ok: false, detail: `${result.reason}: ${result.detail}` };
  const digest = result.report.digests["total"] ?? "";
  await ctx.store.appendBackupJournal({ kind: "restore", at, recordCounts: result.report.counts, envelopeDigest: digest });
  return { ok: true, detail: "restored", digests: result.report.digests as Record<string, string>, counts: result.report.counts as Record<string, number> };
}
