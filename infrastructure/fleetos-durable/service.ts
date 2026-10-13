/**
 * infrastructure/fleetos-durable/service.ts — the FleetOS durable deployment
 * service (F351A, Q1).
 *
 * ONE Node process, ONE fixed port (:3106), node:http only — no framework,
 * no new top-level dependencies (node: builtins + the REAL @fleetos domain
 * packages, composed through the resolve hooks in hooks.mjs). It serves:
 *
 *  1. the static shell — packages/web/dist-fleetos/ (built with
 *     vite.fleetos.config.ts at the lane-tip SHA; the footer carries
 *     __FLEETOS_COMMIT__), hash routing with an SPA fallback;
 *  2. the durable API — the operational plane, append-only JSONL segments
 *     under data/ (see store.ts):
 *       GET  /api/health                    liveness + replay report
 *       GET  /api/digest                    full record-set digests (proof)
 *       GET  /api/state?tenantId&actorId    tenant-scoped records + digests
 *       POST /api/commands                  submit a lane CommandDraft
 *       POST /api/enrollments               enroll a device (REAL directory)
 *
 * Laws (F350 §2 Q1): write-before-ack (fsync before the response), replay-on-
 * start (recovery.ts), idempotency exactly as the in-process contract (the
 * REAL queue: a duplicate returns the ORIGINAL ack with duplicate=true and
 * never enqueues twice), tenant-scoping fail-closed (kernel-validated
 * contexts; cross-tenant reads find nothing; tenant mismatch refuses).
 *
 * The fixture WORLD (observations, sim-worlds) is NOT this service's concern
 * — it stays the domain-input convention, composed in-browser (Q4).
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { makeTenantContext, type TenantContext } from "@fleetos/kernel";
import {
  TowerCommandBus,
  type TowerCommandDraft,
  type TowerSubmitResult,
} from "@fleetos/control-tower";
import {
  EnrollmentDirectory,
  type DeviceId,
  type EnrollmentDirectoryResult,
  type EnrollmentRegistryPort,
  type EnrollmentRecord,
  type TenantIdLike,
} from "@fleetos/assets";
import { verifyCommandDraftDigest } from "@fleetos/experience-asset-field";
import { DurableStore, type DurableSubmissionRecord } from "./store.js";
import { replaySegments } from "./recovery.js";
import { serveStatic } from "./static.js";

const PORT = 3106;
const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../..");
const SHELL_DIR = path.resolve(REPO_ROOT, "packages/web/dist-fleetos");
const DATA_DIR = process.env.FLEETOS_DURABLE_DATA ?? path.join(HERE, "data");

// ---------------------------------------------------------------------------
// The durable plane's REAL domain objects
// ---------------------------------------------------------------------------

/** The enrollment registry port the EnrollmentDirectory persists through.
 *  Memory + a per-tenant index; the assets.jsonl segment (written by the
 *  service after each successful enroll, before the ack) is the source of
 *  truth replayed on start. */
class DurableRegistryPort implements EnrollmentRegistryPort {
  private readonly byKey = new Map<string, EnrollmentRecord>();
  save(record: EnrollmentRecord): void {
    this.byKey.set(`${record.tenantId}:${record.deviceId}`, record);
  }
  find(tenantId: TenantIdLike, deviceId: DeviceId): EnrollmentRecord | null {
    return this.byKey.get(`${String(tenantId)}:${String(deviceId)}`) ?? null;
  }
}

const store = new DurableStore(DATA_DIR);
const registryPort = new DurableRegistryPort();
const enrollmentDirectory = new EnrollmentDirectory(registryPort);
const bus = new TowerCommandBus();

// ---------------------------------------------------------------------------
// Boot: replay-on-start (Q2) — fail-closed on any inconsistency
// ---------------------------------------------------------------------------

const startedAt = new Date().toISOString();
const replayStarted = Date.now();
const replay = replaySegments(store, bus.queueOf(), enrollmentDirectory);
const replayMs = Date.now() - replayStarted;

function headCommit(): string {
  try {
    const head = readFileSync(path.join(REPO_ROOT, ".git", "HEAD"), "utf-8").trim();
    if (head.startsWith("ref: ")) {
      return readFileSync(path.join(REPO_ROOT, ".git", head.slice(5)), "utf-8").trim();
    }
    return head;
  } catch {
    return "unknown";
  }
}

const COMMIT = headCommit();
console.log(
  `[fleetos-durable] replayed ${replay.commands} command(s), ${replay.audit} audit entrie(s), ${replay.assets} enrollment(s) in ${replayMs}ms (torn lines dropped: ${replay.droppedTornLines})`,
);

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(text);
}

function badRequest(res: ServerResponse, detail: string): void {
  sendJson(res, 400, { ok: false, error: "bad-request", detail });
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      chunks.push(c);
      if (chunks.reduce((n, b) => n + b.length, 0) > 1_000_000) {
        reject(new Error("body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

/** Build the kernel TenantContext from request fields — the fail-closed
 *  boundary (malformed ids never pass; scope is never cross-tenant). */
function contextFrom(fields: { tenantId?: unknown; actorId?: unknown }): { ok: true; ctx: TenantContext } | { ok: false; detail: string } {
  const tenantId = typeof fields.tenantId === "string" ? fields.tenantId : "";
  const actorId = typeof fields.actorId === "string" ? fields.actorId : "";
  const r = makeTenantContext({
    tenantId,
    actorId,
    sessionId: "sess_fleetos-durable",
    establishedAt: Date.now(),
  });
  if (!r.ok) return { ok: false, detail: `tenant context refused: ${r.reason}` };
  return { ok: true, ctx: r.context };
}

/** The lane-draft shape guards — the tower's own structural detection. */
function looksLikeAssetFieldDraft(draft: object): boolean {
  return "intentDigest" in draft && "capabilityRequirement" in draft;
}
function looksLikeDraft(draft: unknown): draft is object {
  if (draft === null || typeof draft !== "object") return false;
  const d = draft as Record<string, unknown>;
  return (
    (looksLikeAssetFieldDraft(d) && typeof d.kind === "string") ||
    ("intent" in d && d.intent !== null && typeof d.intent === "object") ||
    d.recordType === "command-draft"
  );
}

// ---------------------------------------------------------------------------
// API handlers
// ---------------------------------------------------------------------------

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const route = `${req.method} ${url.pathname}`;

  if (route === "GET /api/health") {
    sendJson(res, 200, {
      ok: true,
      service: "fleetos-durable",
      port: PORT,
      commit: COMMIT,
      startedAt,
      replay: { ...replay, replayMs },
      dataDir: DATA_DIR,
    });
    return;
  }

  if (route === "GET /api/digest") {
    const digests = store.digestsAll();
    sendJson(res, 200, { ok: true, digests, counts: store.countsAll() });
    return;
  }

  if (route === "GET /api/state") {
    const ctxR = contextFrom({ tenantId: url.searchParams.get("tenantId"), actorId: url.searchParams.get("actorId") });
    if (!ctxR.ok) {
      badRequest(res, ctxR.detail);
      return;
    }
    const tenantId = String(ctxR.ctx.tenantId);
    // Reads are strictly ctx-scoped (fail-closed: other tenants' records are
    // simply not in the response). Submission log renders newest-first, the
    // in-process convention; digests are over segment (append) order.
    const submissions = [...store.auditByTenant(tenantId)].reverse();
    sendJson(res, 200, {
      ok: true,
      mode: "durable",
      tenantId,
      commands: store.commandsByTenant(tenantId),
      submissions,
      enrollments: store.assetsByTenant(tenantId).map((a) => a.enrollment),
      digests: store.digestsByTenant(tenantId),
      counts: {
        commands: store.commandsByTenant(tenantId).length,
        submissions: submissions.length,
        enrollments: store.assetsByTenant(tenantId).length,
      },
    });
    return;
  }

  if (route === "POST /api/commands") {
    let body: unknown;
    try {
      body = JSON.parse(await readBody(req)) as unknown;
    } catch {
      badRequest(res, "body is not valid JSON");
      return;
    }
    const fields = (body ?? {}) as { tenantId?: unknown; actorId?: unknown; draft?: unknown };
    const ctxR = contextFrom(fields);
    if (!ctxR.ok) {
      badRequest(res, ctxR.detail);
      return;
    }
    const ctx = ctxR.ctx;
    if (!looksLikeDraft(fields.draft)) {
      badRequest(res, "draft is not one of the three lane CommandDraft shapes");
      return;
    }
    const draft = fields.draft as TowerCommandDraft;
    // Tamper evidence for asset-field drafts: the REAL digest verifier.
    if (looksLikeAssetFieldDraft(draft) && !verifyCommandDraftDigest(draft as Parameters<typeof verifyCommandDraftDigest>[0])) {
      badRequest(res, "asset-field draft failed its intentDigest verification (tampered draft content)");
      return;
    }
    const result: TowerSubmitResult = bus.submit({ ctx, draft });
    const commandMeta = draftCommandMeta(draft);
    if (result.ok && !result.ack.duplicate) {
      // Write-before-ack: the REAL queue record hits commands.jsonl (fsync)
      // BEFORE the response. Duplicates never append (never a second enqueue);
      // refusals never append (they are audit facts, not queue state).
      const record = bus.queueOf().findById(ctx, result.ack.commandId);
      if (!record.ok) throw new Error(`enqueued command ${result.ack.commandId} not found in queue`);
      store.appendCommand(record.value);
    }
    store.appendAudit(auditEntryOf(String(ctx.tenantId), String(ctx.actorId), commandMeta, result));
    sendJson(res, 200, result);
    return;
  }

  if (route === "POST /api/enrollments") {
    let body: unknown;
    try {
      body = JSON.parse(await readBody(req)) as unknown;
    } catch {
      badRequest(res, "body is not valid JSON");
      return;
    }
    const fields = (body ?? {}) as { tenantId?: unknown; actorId?: unknown; deviceId?: unknown };
    const ctxR = contextFrom(fields);
    if (!ctxR.ok) {
      badRequest(res, ctxR.detail);
      return;
    }
    const ctx = ctxR.ctx;
    const tenantId = String(ctx.tenantId);
    const deviceId = typeof fields.deviceId === "string" ? fields.deviceId : "";
    if (deviceId === "") {
      badRequest(res, "deviceId is required");
      return;
    }
    const result: EnrollmentDirectoryResult = enrollmentDirectory.enroll({
      deviceId,
      tenantId,
      enrolledAt: Date.now(),
      actor: String(ctx.actorId),
    });
    if (result.ok) {
      // Write-before-ack: the REAL enrollment record + its kernel audit ref
      // hit assets.jsonl (fsync) BEFORE the response.
      store.appendAsset({ enrollment: result.enrollment, audit: result.audit });
    }
    sendJson(res, 200, result);
    return;
  }

  sendJson(res, 404, { ok: false, error: "not-found", detail: `no such API route: ${route}` });
}

/** The audit-log projection of a draft — the same submit-contract fields the
 *  in-process audit records (commandPath.ts). */
function draftCommandMeta(draft: TowerCommandDraft): { kind: string; idempotencyKey: string } {
  const d = draft as unknown as Record<string, unknown>;
  if (d.recordType === "command-draft") {
    const command = d.command as { kind?: unknown; idempotencyKey?: unknown } | undefined;
    return { kind: String(command?.kind ?? "unknown"), idempotencyKey: String(command?.idempotencyKey ?? "-") };
  }
  return { kind: String(d.kind ?? "unknown"), idempotencyKey: String(d.idempotencyKey ?? "-") };
}

function auditEntryOf(
  tenantId: string,
  actorId: string,
  meta: { kind: string; idempotencyKey: string },
  result: TowerSubmitResult,
): DurableSubmissionRecord {
  const at = Date.now();
  if (result.ok) {
    return {
      at,
      kind: meta.kind,
      actor: actorId,
      ok: true,
      detail: `enqueued for Guardian adjudication (capability REQUEST: ${result.ack.capabilityRequirement}; ceilings are not authorizations)`,
      commandId: result.ack.commandId,
      duplicate: result.ack.duplicate,
      idempotencyKey: meta.idempotencyKey,
      tenantId,
    };
  }
  return {
    at,
    kind: meta.kind,
    actor: actorId,
    ok: false,
    detail: `${result.refused}: ${result.detail}`,
    commandId: null,
    duplicate: false,
    idempotencyKey: meta.idempotencyKey,
    tenantId,
  };
}

// ---------------------------------------------------------------------------
// The server
// ---------------------------------------------------------------------------

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
    handleApi(req, res, url).catch((error: unknown) => {
      console.error("[fleetos-durable] API error:", error);
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: "internal", detail: String(error) });
      else res.end();
    });
    return;
  }
  if (req.method === "GET" || req.method === "HEAD") {
    serveStatic(res, SHELL_DIR, decodeURIComponent(url.pathname));
    return;
  }
  res.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
  res.end("method not allowed");
});

server.listen(PORT, () => {
  console.log(
    `[fleetos-durable] listening on :${PORT} (shell: ${SHELL_DIR}; data: ${DATA_DIR}; commit ${COMMIT})`,
  );
});

process.on("SIGTERM", () => {
  console.log("[fleetos-durable] SIGTERM — closing");
  server.close(() => process.exit(0));
});
process.on("SIGINT", () => {
  console.log("[fleetos-durable] SIGINT — closing");
  server.close(() => process.exit(0));
});
