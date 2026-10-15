/**
 * @fleetos/acceptance-commerce — the F370C deployment-service step drivers,
 * the lifecycle/auth/ops families (drivers-mps-ops.ts).
 *
 * The service lifecycle (boot, the REAL SIGKILL restarts, shutdown), the
 * security plane (credential provisioning, logins, the stale-holder mint,
 * token surgery, revocations), and the proof surface (the digest report,
 * the backup, the tenant-scoped state reads) — every step against the
 * REAL service over HTTP. The shared response-fact helpers (baseFacts /
 * reasonOf / fieldOf) live here and are shared with the verb families
 * (drivers-marketplace-service.ts).
 */

import type { FactValue } from "./journey-contracts.js";
import type { MpsStep } from "./journey-contracts-f370c.js";
import type { JourneyState } from "./journey-world.js";
import { logPush } from "./journey-world.js";
import {
  bootService,
  killService,
  mintKeyedToken,
  mpsCall,
  persistDump,
  serviceOf,
  shutdownService,
  tamperToken,
  unknownKeyToken,
  type MpsResponse,
} from "./drivers-mps-harness.js";

export type DriverFacts = Record<string, FactValue>;

/** The machine-stable refusal reason of any service response (or null). */
export function reasonOf(json: Record<string, unknown>): string | null {
  if (json["ok"] === true) {
    const result = json["result"] as Record<string, unknown> | undefined;
    if (result !== undefined && result["ok"] === false) {
      return String(result["reasonCode"] ?? result["reason"] ?? "-");
    }
    return null;
  }
  const refusedBy = json["refusedBy"];
  if (refusedBy === "domain") {
    const refusal = json["domainRefusal"] as Record<string, unknown> | undefined;
    return String(refusal?.["reasonCode"] ?? refusal?.["reason"] ?? "-");
  }
  const refusal = json["refusal"] as Record<string, unknown> | undefined;
  return String(refusal?.["reason"] ?? refusal?.["reasonCode"] ?? "-");
}

/** The uniform per-step fact quad: ok / httpStatus / refusedBy / reason. */
export function baseFacts(prefix: string, res: MpsResponse): DriverFacts {
  const json = res.json;
  const inner = json["result"] as Record<string, unknown> | undefined;
  return {
    [`${prefix}.ok`]: json["ok"] === true && (inner === undefined || inner["ok"] !== false),
    [`${prefix}.httpStatus`]: res.status,
    [`${prefix}.refusedBy`]: json["ok"] === true ? null : String(json["refusedBy"] ?? "-"),
    [`${prefix}.reason`]: reasonOf(json),
  };
}

/** Dig a nested field out of a response (normalized to a FactValue). */
export function fieldOf(json: Record<string, unknown>, keys: readonly string[]): FactValue {
  let current: unknown = json;
  for (const key of keys) {
    if (current === null || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[key];
  }
  if (current === undefined || current === null) return null;
  if (typeof current === "string" || typeof current === "number" || typeof current === "boolean") return current;
  if (Array.isArray(current)) return current.map((v) => String(v));
  return null;
}

/** Interpret the lifecycle/auth/ops steps against the REAL service. */
export async function runMpsOpsStep(step: MpsStep, state: JourneyState): Promise<DriverFacts> {
  const service = serviceOf(state);
  switch (step.kind) {
    case "mps-boot": {
      await bootService(service);
      logPush(state, "mps.log", "boot:ok");
      return { [`mps.boot.${step.factKey}.ok`]: true, [`mps.boot.${step.factKey}.keyringSource`]: "env" };
    }
    case "mps-shutdown": {
      await shutdownService(service);
      logPush(state, "mps.log", "shutdown:ok");
      return { [`mps.shutdown.${step.factKey}.ok`]: true };
    }
    case "mps-restart": {
      // The pre-kill digest (fresh — the write state since the last
      // mps-digest step is included; the crash must not change it).
      const beforeJson = (await mpsCall(service, "GET", "/api/digest")).json;
      const before = String(((beforeJson["digests"] ?? {}) as Record<string, unknown>)["total"] ?? "-");
      await killService(service);
      if (step.mode === "restore") {
        if (service.dumpFile === null) throw new Error("mps-restart restore: no dump file retained (run mps-backup first)");
        await bootService(service, ["--restore", service.dumpFile, "--at", String(step.at)]);
      } else {
        await bootService(service);
      }
      const health = (await mpsCall(service, "GET", "/api/health")).json;
      const verify = (health["verify"] ?? {}) as Record<string, unknown>;
      const afterJson = (await mpsCall(service, "GET", "/api/digest")).json;
      const after = String(((afterJson["digests"] ?? {}) as Record<string, unknown>)["total"] ?? "-");
      const counts = (afterJson["counts"] ?? {}) as Record<string, number>;
      service.lastDigest = { total: after, counts };
      logPush(state, "mps.log", `restart:${step.mode}:${before === after ? "digests-identical" : "digests-DIFFER"}`);
      return {
        [`mps.restart.${step.factKey}.ok`]: true,
        [`mps.restart.${step.factKey}.mode`]: step.mode,
        [`mps.restart.${step.factKey}.verifyOk`]: verify["ok"] === true,
        [`mps.restart.${step.factKey}.receiptsReplayed`]: Number(verify["receiptsReplayed"] ?? -1),
        [`mps.restart.${step.factKey}.revocationsReplayed`]: Number(verify["revocationsReplayed"] ?? -1),
        [`mps.restart.${step.factKey}.digestsIdentical`]: before === after,
      };
    }
    case "mps-provision": {
      const res = await mpsCall(service, "POST", "/api/auth/credentials", {
        credentialId: step.credentialId, actorId: step.actorId, tenantId: step.tenantId, kind: "human", secret: step.secret,
      });
      logPush(state, "mps.log", `provision:${res.status}:${String(fieldOf(res.json, ["credentialId"]))}`);
      return { [`mps.provision.${step.factKey}.ok`]: res.json["ok"] === true, [`mps.provision.${step.factKey}.credentialId`]: fieldOf(res.json, ["credentialId"]) };
    }
    case "mps-login": {
      const res = await mpsCall(service, "POST", "/api/auth/login", {
        credentialId: step.credentialId, secret: step.secret, scopes: step.scopes, ttlMs: step.ttlMs, jti: step.jti, now: step.now,
      });
      const token = fieldOf(res.json, ["token"]);
      if (typeof token === "string") service.tokens.set(step.sessionKey, token);
      logPush(state, "mps.log", `login:${res.status}:${String(fieldOf(res.json, ["keyId"]))}`);
      return {
        [`mps.login.${step.factKey}.ok`]: res.json["ok"] === true,
        [`mps.login.${step.factKey}.keyId`]: fieldOf(res.json, ["keyId"]),
        [`mps.login.${step.factKey}.actorId`]: fieldOf(res.json, ["claims", "actorId"]),
        [`mps.login.${step.factKey}.tenantId`]: fieldOf(res.json, ["claims", "tenantId"]),
        [`mps.login.${step.factKey}.scopeCount`]: (fieldOf(res.json, ["claims", "scopes"]) as readonly string[] | null)?.length ?? 0,
      };
    }
    case "mps-mint-keyed-token": {
      const minted = mintKeyedToken({
        keyId: step.keyId, actorId: step.actorId, tenantId: step.tenantId, scopes: step.scopes,
        issuedAt: step.issuedAt, expiresAt: step.expiresAt, jti: step.jti,
      });
      if (minted.token !== undefined) service.tokens.set(step.sessionKey, minted.token);
      logPush(state, "mps.log", `mint:${step.keyId}:${minted.ok ? "ok" : "refused"}`);
      return { [`mps.mint.${step.factKey}.ok`]: minted.ok, [`mps.mint.${step.factKey}.keyId`]: step.keyId };
    }
    case "mps-token-surgery": {
      const base = service.tokens.get(step.sourceSessionKey);
      if (base === undefined) throw new Error(`unknown source session ${step.sourceSessionKey}`);
      const derived = step.mode === "tamper-payload" ? tamperToken(base) : unknownKeyToken(base);
      service.tokens.set(step.sessionKey, derived);
      logPush(state, "mps.log", `surgery:${step.mode}`);
      return { [`mps.surgery.${step.factKey}.ok`]: true, [`mps.surgery.${step.factKey}.mode`]: step.mode };
    }
    case "mps-revoke": {
      const res = await mpsCall(service, "POST", "/api/auth/revocations", {
        ...(step.mode === "actor" ? { allActor: true } : {}), now: step.now,
      }, step.sessionKey);
      logPush(state, "mps.log", `revoke:${res.status}:${String(reasonOf(res.json) ?? "ok")}`);
      return { [`mps.revoke.${step.factKey}.ok`]: res.json["ok"] === true, [`mps.revoke.${step.factKey}.revoked`]: fieldOf(res.json, ["revoked"]) };
    }
    case "mps-digest": {
      const res = await mpsCall(service, "GET", "/api/digest");
      const digests = (res.json["digests"] ?? {}) as Record<string, unknown>;
      const counts = (res.json["counts"] ?? {}) as Record<string, unknown>;
      service.lastDigest = { total: String(digests["total"] ?? "-"), counts: counts as Record<string, number> };
      logPush(state, "mps.log", `digest:${String(digests["total"] ?? "-")}`);
      return {
        [`mps.digest.${step.factKey}.total`]: String(digests["total"] ?? "-"),
        [`mps.digest.${step.factKey}.requests`]: String(digests["requests"] ?? "-"),
        [`mps.digest.${step.factKey}.orders`]: String(digests["orders"] ?? "-"),
        [`mps.digest.${step.factKey}.audit`]: String(digests["audit"] ?? "-"),
        [`mps.digest.${step.factKey}.countRequests`]: Number(counts["requests"] ?? -1),
        [`mps.digest.${step.factKey}.countOffers`]: Number(counts["offers"] ?? -1),
        [`mps.digest.${step.factKey}.countOrders`]: Number(counts["orders"] ?? -1),
        [`mps.digest.${step.factKey}.countReceipts`]: Number(counts["receipts"] ?? -1),
        [`mps.digest.${step.factKey}.countEnrollments`]: Number(counts["enrollments"] ?? -1),
        [`mps.digest.${step.factKey}.countEvidence`]: Number(counts["evidence"] ?? -1),
        [`mps.digest.${step.factKey}.countApprovals`]: Number(counts["approvals"] ?? -1),
        [`mps.digest.${step.factKey}.countAudit`]: Number(counts["audit"] ?? -1),
      };
    }
    case "mps-backup": {
      const res = await mpsCall(service, "GET", `/api/admin/backup?now=${step.now}`);
      const envelope = (res.json["envelope"] ?? {}) as Record<string, unknown>;
      const digests = (envelope["digests"] ?? {}) as Record<string, unknown>;
      const counts = (envelope["counts"] ?? {}) as Record<string, unknown>;
      const dump = res.json["dump"];
      if (typeof dump === "string") persistDump(service, dump);
      logPush(state, "mps.log", `backup:${res.status}:${String(digests["total"] ?? "-")}`);
      return {
        [`mps.backup.${step.factKey}.ok`]: res.json["ok"] === true,
        [`mps.backup.${step.factKey}.envelopeTotal`]: String(digests["total"] ?? "-"),
        [`mps.backup.${step.factKey}.countAudit`]: Number(counts["audit"] ?? -1),
        [`mps.backup.${step.factKey}.countRequests`]: Number(counts["requests"] ?? -1),
        [`mps.backup.${step.factKey}.countEnrollments`]: Number(counts["enrollments"] ?? -1),
      };
    }
    case "mps-state": {
      const res = await mpsCall(service, "GET", `/api/marketplace/state?family=${encodeURIComponent(step.family)}&tenantId=${encodeURIComponent(step.tenantId)}&now=${step.now}`, undefined, step.sessionKey);
      const recordsRaw = (res.json["result"] as Record<string, unknown> | undefined)?.["records"];
      const records: readonly Record<string, unknown>[] = Array.isArray(recordsRaw) ? (recordsRaw as readonly Record<string, unknown>[]) : [];
      logPush(state, "mps.log", `state:${step.family}:${res.status}:${records.length}`);
      const facts = baseFacts(`mps.state.${step.factKey}`, res);
      facts[`mps.state.${step.factKey}.count`] = fieldOf(res.json, ["result", "count"]);
      const statuses = (mapper: (r: Record<string, unknown>) => string): readonly string[] => records.map((r) => mapper(r));
      if (step.family === "requests") facts[`mps.state.${step.factKey}.statuses`] = statuses((r) => `${String(r["requestId"])}:${String(r["status"])}`);
      if (step.family === "orders") facts[`mps.state.${step.factKey}.statuses`] = statuses((r) => `${String(r["orderId"])}:${String(r["status"])}`);
      if (step.family === "enrollments") facts[`mps.state.${step.factKey}.statuses`] = statuses((r) => `${String(r["serial"])}:${String(r["state"])}`);
      if (step.family === "receipts") facts[`mps.state.${step.factKey}.statuses`] = statuses((r) => `${String((r["evidence"] as Record<string, unknown>)["evidenceRef"])}:${String((r["evidence"] as Record<string, unknown>)["state"])}`);
      if (step.family === "audit") facts[`mps.state.${step.factKey}.ops`] = statuses((r) => `${String(r["op"])}:${String(r["ok"])}`);
      return facts;
    }
  }
  throw new Error(`unknown mps ops step kind: ${step.kind}`);
}
