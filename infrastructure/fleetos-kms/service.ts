/**
 * infrastructure/fleetos-kms/service.ts — the FleetOS key-management service
 * (F373, Wave 19 lane B).
 *
 * ONE Node process, node:http only — no framework, no new dependencies
 * (node builtins + the REAL @fleetos/identity, composed through the resolve
 * hooks in hooks.mjs — the F351A/F370C service laws). This service gives
 * the keyring a REAL KMS-class trust boundary: it owns the key material at
 * rest (envelope-encrypted under a master key that exists only at THIS
 * process boundary — env/file AT THE KMS, plainly labelled), serves it
 * over an AUTHENTICATED API, rotates it through that API with a full audit
 * journal, and survives its own crash-restart.
 *
 * Environment (the deployment's wiring surface — all plainly labelled):
 *   - FLEETOS_KMS_PORT — the deployment port, FIXED at :3108 in production
 *     (the service-census law); `0` (the journeys' ephemeral instances) or
 *     any override exists solely for isolated test/corpus instances.
 *   FLEETOS_KMS_HOST — 127.0.0.1 by default (the sandbox localhost law).
 *   - FLEETOS_KMS_DATA — the data dir (kms-state.json + kms-audit.jsonl).
 *   - FLEETOS_KMS_MASTER_KEY / FLEETOS_KMS_MASTER_KEY_FILE — the master
 *     key AT THE SERVICE (hex, 32 bytes). Neither set => FAIL-CLOSED
 *     refusal to boot (a KMS without its master key is not a KMS).
 *   - FLEETOS_KMS_RANDOM_STREAM — a JSON array of hex draws for the
 *     SecureRandom port. TEST/CORPUS ONLY (plainly labelled; the health
 *     endpoint reports the active binding); absent => the production
 *     binding: node:crypto randomBytes (the F370B host-boundary recipe).
 *
 * API (all JSON; logical `now` carried by every request — query for GET,
 * body for POST; no wall clock ever enters a response or the journal):
 *   GET  /api/health                    liveness + the recovery report
 *   POST /api/admin/credentials         the journaled bootstrap seam (unauth)
 *   POST /api/session                   login => an admin session token
 *   GET  /api/keys/current              the current key id        (auth)
 *   GET  /api/keys                      the key ids, creation order (auth)
 *   POST /api/keys/resolve              key material over the authenticated
 *                                       channel — the ONLY place material
 *                                       leaves the KMS (the keyring adapter
 *                                       consumes it; never wrapped for
 *                                       caller-side unwrapping)   (auth)
 *   POST /api/keys/create               the first-key bootstrap draw (auth)
 *   POST /api/keys/rotate               the REAL F370B rotation kernel  (auth)
 *   GET  /api/audit                     the append-only journal     (auth)
 *
 * NO-LEAK LAW (grep-asserted by the journeys): key material, the master
 * key, admin secrets and admin session tokens NEVER appear in any
 * response except the authenticated resolve, never in logs, never in the
 * journal, never in health output. Refusals are frozen reason codes
 * (verdicts-as-data, never exception control flow).
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { SecureRandom } from "@fleetos/identity";
import { deterministicSecureRandom } from "@fleetos/identity";
import {
  adminCredentialDigest,
  fromStateFile,
  issueAdminSession,
  isValidMasterKeyHex,
  kmsCreateKey,
  kmsRotateKey,
  toStateFile,
  verifyAdminCredential,
  verifyAdminSession,
  type KmsMasterKeyHex,
  type KmsState,
} from "./kms-core.js";
import { KmsStore, type KmsRecoveryReport } from "./store.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.FLEETOS_KMS_PORT ?? 3108);
const HOST = process.env.FLEETOS_KMS_HOST ?? "127.0.0.1";
const DATA_DIR = process.env.FLEETOS_KMS_DATA ?? path.join(HERE, "data");

// ---------------------------------------------------------------------------
// The master key AT THE SERVICE (fail-closed boot without one)
// ---------------------------------------------------------------------------

function loadMasterKey(): { ok: true; masterKeyHex: KmsMasterKeyHex; source: "env" | "file" } | { ok: false; reason: string } {
  const fromEnv = process.env["FLEETOS_KMS_MASTER_KEY"];
  if (typeof fromEnv === "string" && fromEnv.length > 0) {
    if (!isValidMasterKeyHex(fromEnv)) return { ok: false, reason: "FLEETOS_KMS_MASTER_KEY must be 64 hex chars (32 bytes)" };
    return { ok: true, masterKeyHex: fromEnv.toLowerCase(), source: "env" };
  }
  const fromFile = process.env.FLEETOS_KMS_MASTER_KEY_FILE;
  if (typeof fromFile === "string" && fromFile.length > 0) {
    let text: string;
    try {
      text = readFileSync(fromFile, "utf8").trim();
    } catch {
      return { ok: false, reason: "FLEETOS_KMS_MASTER_KEY_FILE could not be read" };
    }
    if (!isValidMasterKeyHex(text)) return { ok: false, reason: "the master key file must contain 64 hex chars (32 bytes)" };
    return { ok: true, masterKeyHex: text.toLowerCase(), source: "file" };
  }
  return { ok: false, reason: "no master key configured (FLEETOS_KMS_MASTER_KEY or FLEETOS_KMS_MASTER_KEY_FILE) — refusing to boot (fail-closed)" };
}

/** Fail-closed boot helper: typed `never` so the call sites narrow. */
function die(reason: string): never {
  console.error(`[fleetos-kms] ${reason}`);
  process.exit(1);
}

const masterKey = loadMasterKey();
if (!masterKey.ok) die(masterKey.reason);
const MASTER_KEY: KmsMasterKeyHex = masterKey.masterKeyHex;
/** The active master-key source label ("env" | "file") — captured at the
 *  narrowed module scope so handlers can read it without re-narrowing. */
const MASTER_KEY_SOURCE: "env" | "file" = masterKey.source;

// ---------------------------------------------------------------------------
// The SecureRandom binding (host entropy in production; fixed stream for
// test/corpus instances — plainly labelled, reported by /api/health)
// ---------------------------------------------------------------------------

function bindSecureRandom(): { binding: SecureRandom; label: "host-entropy" | "deterministic-stream" } {
  const streamSpec = process.env.FLEETOS_KMS_RANDOM_STREAM;
  if (typeof streamSpec === "string" && streamSpec.length > 0) {
    let draws: unknown;
    try {
      draws = JSON.parse(streamSpec);
    } catch {
      console.error("[fleetos-kms] FLEETOS_KMS_RANDOM_STREAM is not valid JSON — refusing to boot (fail-closed)");
      process.exit(1);
    }
    if (!Array.isArray(draws) || !draws.every((d) => typeof d === "string" && /^[0-9a-fA-F]+$/.test(d))) {
      console.error("[fleetos-kms] FLEETOS_KMS_RANDOM_STREAM must be a JSON array of hex strings — refusing to boot (fail-closed)");
      process.exit(1);
    }
    return { binding: deterministicSecureRandom(draws as readonly string[]), label: "deterministic-stream" };
  }
  return {
    binding: {
      randomHex: (n) => randomBytes(n).toString("hex"),
      credentialSalt: () => randomBytes(16).toString("hex"),
    },
    label: "host-entropy",
  };
}

const secureRandom = bindSecureRandom();

// ---------------------------------------------------------------------------
// Boot: recovery from the at-rest envelope (fail-closed), then the
// first-boot admin token key draw if the envelope has none.
// ---------------------------------------------------------------------------

const store = new KmsStore(DATA_DIR);

interface Live {
  state: KmsState;
}
// Definite-assignment: assigned during the boot IIFE below before the
// server starts listening (fail-closed exits happen inside it).
let live!: Live;

function persistAndJournal(next: KmsState, audit: Parameters<KmsStore["appendAudit"]>[0]): void {
  // WRITE-BEFORE-ACK discipline: state file first (atomic), then the audit
  // line, then the caller responds. See store.ts for the crash-window note.
  store.persistStateFile(toStateFile(MASTER_KEY, next));
  store.appendAudit(audit);
  live = { state: next };
}

const recovery: KmsRecoveryReport = (() => {
  const stateFile = store.readStateFile();
  const journal = store.readAuditJournal();
  if (!journal.ok) {
    console.error(`[fleetos-kms] ${journal.reason}`);
    process.exit(1);
  }
  if (stateFile.ok) {
    const recovered = fromStateFile(MASTER_KEY, stateFile.file);
    if (!recovered.ok) {
      console.error(`[fleetos-kms] fail-closed: ${recovered.reason}`);
      process.exit(1);
    }
    live = { state: recovered.state };
    return {
      recovered: true,
      keys: recovered.state.keys.length,
      admins: recovered.state.admins.length,
      adminTokenKeyRecovered: true,
      auditEntries: journal.entries.length,
      droppedTornAuditLines: journal.droppedTorn,
      freshBoot: false,
    };
  }
  if (stateFile.reason === "corrupt") {
    console.error("[fleetos-kms] fail-closed: the state file is present but corrupt — refusing to boot");
    process.exit(1);
  }
  // Fresh boot: draw the admin token key (the FIRST data key at the KMS —
  // it signs the admin session tokens); journaled + persisted pre-listen.
  const adminTokenKeyHex = secureRandom.binding.randomHex(32);
  const opSeq = 1;
  const initial: KmsState = { currentKeyId: "", keys: [], adminTokenKeyHex, admins: [], opSeq };
  live = { state: initial };
  store.persistStateFile(toStateFile(MASTER_KEY, initial));
  store.appendAudit({ opSeq, op: "kms.admin-token-key", actor: "system", detail: "drew the admin token key at first boot (wrapped at rest)" });
  return {
    recovered: false,
    keys: 0,
    admins: 0,
    adminTokenKeyRecovered: true,
    auditEntries: journal.entries.length,
    droppedTornAuditLines: journal.droppedTorn,
    freshBoot: true,
  };
})();

// ---------------------------------------------------------------------------
// HTTP plumbing (the F351A/F370C conventions)
// ---------------------------------------------------------------------------

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function refusal(res: ServerResponse, status: number, reason: string, detail: string): void {
  sendJson(res, status, { ok: false, refusedBy: "kms", refusal: { reason, detail } });
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      chunks.push(c);
      if (chunks.reduce((n, b) => n + b.length, 0) > 100_000) {
        reject(new Error("body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(await readBody(req)) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function logicalNow(raw: unknown): number {
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : 0;
}

function logicalNowQuery(url: URL): number {
  const raw = url.searchParams.get("now");
  if (raw === null) return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function bearerTokenOf(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (typeof header !== "string") return null;
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

/** The authentication guard: frozen refusal codes, verdicts-as-data. */
function requireAdmin(req: IncomingMessage, now: number): { ok: true } | { ok: false; reason: "UNAUTHENTICATED" | "SIGNATURE_INVALID" | "SESSION_EXPIRED"; detail: string } {
  const token = bearerTokenOf(req);
  if (token === null) return { ok: false, reason: "UNAUTHENTICATED", detail: "no admin session token presented" };
  const verified = verifyAdminSession(token, { adminTokenKeyHex: live.state.adminTokenKeyHex, now });
  if (verified.ok) return { ok: true };
  if (verified.refusal === "SIGNATURE_INVALID") return { ok: false, reason: "SIGNATURE_INVALID", detail: "admin session token failed its signature (tampered)" };
  if (verified.refusal === "SESSION_EXPIRED") return { ok: false, reason: "SESSION_EXPIRED", detail: "admin session window has expired" };
  return { ok: false, reason: "UNAUTHENTICATED", detail: "admin session token did not verify" };
}

// ---------------------------------------------------------------------------
// The API handlers
// ---------------------------------------------------------------------------

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const route = `${req.method} ${url.pathname}`;

  if (route === "GET /api/health") {
    sendJson(res, 200, {
      ok: true,
      service: "fleetos-kms",
      bindings: { random: secureRandom.label, masterKey: MASTER_KEY_SOURCE },
      recovery,
    });
    return;
  }

  if (route === "POST /api/admin/credentials") {
    const body = await readJson(req);
    const adminId = typeof body["adminId"] === "string" ? body["adminId"] : "";
    const secret = typeof body["secret"] === "string" ? body["secret"] : "";
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(adminId) || secret.length < 8 || secret.length > 256) {
      refusal(res, 400, "MALFORMED", "adminId (1-64 [A-Za-z0-9_-]) and secret (8-256 chars) are required");
      return;
    }
    if (live.state.admins.some((a) => a.adminId === adminId)) {
      refusal(res, 409, "ADMIN_EXISTS", "an admin with this id is already provisioned");
      return;
    }
    const digestHex = adminCredentialDigest(live.state.adminTokenKeyHex, adminId, secret);
    const opSeq = live.state.opSeq + 1;
    const next: KmsState = { ...live.state, admins: [...live.state.admins, { adminId, digestHex }], opSeq };
    persistAndJournal(next, { opSeq, op: "kms.admin-provision", actor: adminId, detail: `admin ${adminId} provisioned (digest only; the secret is never stored)` });
    sendJson(res, 200, { ok: true, adminId });
    return;
  }

  if (route === "POST /api/session") {
    const body = await readJson(req);
    const now = logicalNow(body["now"]);
    const ttlMs = typeof body["ttlMs"] === "number" && Number.isFinite(body["ttlMs"]) && body["ttlMs"] > 0 ? body["ttlMs"] : 0;
    const adminId = typeof body["adminId"] === "string" ? body["adminId"] : "";
    const secret = typeof body["secret"] === "string" ? body["secret"] : "";
    const stored = live.state.admins.find((a) => a.adminId === adminId) ?? null;
    const verified = verifyAdminCredential({ presentedSecret: secret, stored, adminTokenKeyHex: live.state.adminTokenKeyHex, adminId });
    if (ttlMs <= 0 || !verified) {
      // Enumeration-resistant: unknown admin, wrong secret and malformed
      // input are byte-identical (one fixed line, never the secret).
      refusal(res, 401, "ADMIN_CREDENTIAL_INVALID", "admin credential did not verify");
      return;
    }
    const jti = typeof body["jti"] === "string" && body["jti"].length > 0 ? body["jti"] : secureRandom.binding.randomHex(16);
    const issued = issueAdminSession({ adminId, issuedAt: now, expiresAt: now + ttlMs, jti, adminTokenKeyHex: live.state.adminTokenKeyHex });
    if (!issued.ok) {
      refusal(res, 400, "MALFORMED", "admin session could not be issued");
      return;
    }
    sendJson(res, 200, { ok: true, token: issued.token, expiresAt: now + ttlMs });
    return;
  }

  if (route === "GET /api/keys/current") {
    const now = logicalNowQuery(url);
    const auth = requireAdmin(req, now);
    if (!auth.ok) {
      refusal(res, 401, auth.reason, auth.detail);
      return;
    }
    sendJson(res, 200, { ok: true, keyId: live.state.currentKeyId === "" ? null : live.state.currentKeyId });
    return;
  }

  if (route === "GET /api/keys") {
    const now = logicalNowQuery(url);
    const auth = requireAdmin(req, now);
    if (!auth.ok) {
      refusal(res, 401, auth.reason, auth.detail);
      return;
    }
    sendJson(res, 200, { ok: true, keyIds: live.state.keys.map((k) => k.keyId) });
    return;
  }

  if (route === "GET /api/audit") {
    const now = logicalNowQuery(url);
    const auth = requireAdmin(req, now);
    if (!auth.ok) {
      refusal(res, 401, auth.reason, auth.detail);
      return;
    }
    const journal = store.readAuditJournal();
    if (!journal.ok) {
      refusal(res, 500, "JOURNAL_UNREADABLE", journal.reason);
      return;
    }
    sendJson(res, 200, { ok: true, entries: journal.entries });
    return;
  }

  if (route === "POST /api/keys/resolve") {
    const body = await readJson(req);
    const now = logicalNow(body["now"]);
    const auth = requireAdmin(req, now);
    if (!auth.ok) {
      refusal(res, 401, auth.reason, auth.detail);
      return;
    }
    const keyId = typeof body["keyId"] === "string" ? body["keyId"] : "";
    const entry = live.state.keys.find((k) => k.keyId === keyId) ?? null;
    if (entry === null) {
      refusal(res, 404, "KEY_UNKNOWN", "no such key id at this KMS");
      return;
    }
    // The ONLY channel key material ever leaves the KMS: the authenticated
    // resolve, consumed by the keyring adapter. Never logged, never echoed
    // in any other response, never wrapped for caller-side unwrapping.
    sendJson(res, 200, { ok: true, keyId: entry.keyId, algorithm: entry.algorithm, secretHex: entry.secretHex, retireAt: entry.retireAt });
    return;
  }

  if (route === "POST /api/keys/create") {
    const body = await readJson(req);
    const now = logicalNow(body["now"]);
    const auth = requireAdmin(req, now);
    if (!auth.ok) {
      refusal(res, 401, auth.reason, auth.detail);
      return;
    }
    const created = kmsCreateKey({ state: live.state, secureRandom: secureRandom.binding });
    if (!created.ok) {
      if (created.refusal === "KEY_EXISTS") {
        refusal(res, 409, "KEY_EXISTS", "a data key already exists — rotate instead");
        return;
      }
      refusal(res, 500, "KEY_ID_INVALID", "the bootstrap draw failed validation");
      return;
    }
    persistAndJournal(created.state, created.audit);
    sendJson(res, 200, { ok: true, keyId: created.keyId });
    return;
  }

  if (route === "POST /api/keys/rotate") {
    const body = await readJson(req);
    const now = logicalNow(body["now"]);
    const auth = requireAdmin(req, now);
    if (!auth.ok) {
      refusal(res, 401, auth.reason, auth.detail);
      return;
    }
    const verifyGraceMs = typeof body["verifyGraceMs"] === "number" && Number.isFinite(body["verifyGraceMs"]) ? body["verifyGraceMs"] : 0;
    const rotated = kmsRotateKey({ state: live.state, now, verifyGraceMs, secureRandom: secureRandom.binding });
    if (!rotated.ok) {
      if (rotated.refusal === "INVALID_GRACE_WINDOW") {
        refusal(res, 400, "INVALID_GRACE_WINDOW", "verifyGraceMs must be a positive duration");
        return;
      }
      if (rotated.refusal === "NO_CURRENT_KEY") {
        refusal(res, 409, "NO_CURRENT_KEY", "no current key to rotate — create first");
        return;
      }
      if (rotated.refusal === "KEY_ID_COLLISION") {
        refusal(res, 409, "KEY_ID_COLLISION", "the drawn key id collided with an existing id");
        return;
      }
      refusal(res, 500, "KEY_MATERIAL_INVALID", "the rotation draw failed validation");
      return;
    }
    persistAndJournal(rotated.state, rotated.audit);
    sendJson(res, 200, { ok: true, newKeyId: rotated.newKeyId, rotatedOutKeyId: rotated.rotatedOutKeyId, retireAt: rotated.retireAt });
    return;
  }

  refusal(res, 404, "NOT_FOUND", `no such API route: ${route}`);
}

// ---------------------------------------------------------------------------
// The server
// ---------------------------------------------------------------------------

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost`);
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
    handleApi(req, res, url).catch((error: unknown) => {
      console.error("[fleetos-kms] API error:", error);
      if (!res.headersSent) sendJson(res, 500, { ok: false, refusedBy: "kms", refusal: { reason: "INTERNAL", detail: String(error) } });
      else res.end();
    });
    return;
  }
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("not found");
});

server.listen(PORT, HOST, () => {
  const address = server.address();
  const boundPort = typeof address === "object" && address !== null ? address.port : PORT;
  console.log(`[fleetos-kms] listening on :${boundPort} (data: ${DATA_DIR}; random: ${secureRandom.label}; master key: ${MASTER_KEY_SOURCE})`);
});

process.on("SIGTERM", () => {
  console.log("[fleetos-kms] SIGTERM — closing");
  server.close(() => process.exit(0));
});
process.on("SIGINT", () => {
  console.log("[fleetos-kms] SIGINT — closing");
  server.close(() => process.exit(0));
});
