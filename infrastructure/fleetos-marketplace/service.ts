/**
 * infrastructure/fleetos-marketplace/service.ts — the marketplace pilot's
 * VERIFIED DEPLOYMENT SERVICE (F370C, Wave 18 lane C; F372 the adapter
 * selection).
 *
 * ONE Node process, node:http only — no framework, no new top-level
 * dependencies beyond @electric-sql/pglite (the official WASM build of
 * REAL PostgreSQL, in-process) and pg (node-postgres — the F372 networked
 * binding; the store PORT stays swappable):
 *   - FLEETOS_MARKETPLACE_STORE=pglite (default) — the in-process mode
 *     (pglite-store.ts; the F370C behavior, unchanged);
 *   - FLEETOS_MARKETPLACE_STORE=networked — REAL PostgreSQL as a separate
 *     SERVER PROCESS over TCP (pg-store.ts; the production shape; the
 *     connection string comes from FLEETOS_MARKETPLACE_PG).
 * The F351A service laws, composed with the REAL Wave-17 kernels behind
 * the F370A gate + F370B keyring:
 *
 *   - WRITE-BEFORE-ACK: every mutating handler commits its PostgreSQL
 *     transaction (the record + its journal entries, atomically) BEFORE
 *     the HTTP response.
 *   - VERIFY-ON-START: every boot rebuilds the F361A directory state from
 *     the store and verifies it byte-exactly (recovery.ts); any mismatch
 *     refuses to start (fail-closed).
 *   - TENANT FAIL-CLOSED (A8): the caller tenant is the VERIFIED
 *     session's; cross-tenant reads find nothing; cross-tenant writes
 *     refuse (the store throws).
 *   - The boundary: verify credential (F370A) → issue signed session
 *     (F370B keyring) → authorize per action (the F370A gate) → delegate
 *     to the EXISTING kernels → persist via the store. NEVER re-implement
 *     a domain behavior; a needed kernel edit is a FINDING.
 *
 * The deployment port is FIXED at :3107 (the runbook's law); the
 * FLEETOS_MARKETPLACE_PORT override exists solely for the journeys'
 * ephemeral isolated instances (the packet's law — ports never in journey
 * output). The service binds 127.0.0.1 (the sandbox localhost law).
 */

import { createServer, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { AssetDirectory, ReceiptEnrollmentDirectory } from "@fleetos/assets";
import { InMemorySessionRevocationRegistry, envKeyringProvider, fileKeyringProvider, type KeyringProvider } from "@fleetos/identity";
import { makeContext, bearerTokenOf, readJson, type ApiOutcome, type ServiceContext } from "./api.js";
import { handleLogin, handleProvision, handleRevoke } from "./api-auth.js";
import { handleEnrollmentComplete, handleEnrollmentOpen, handleEvidenceRead, handleEvidenceRetain, handleReceiptRecord, handleReceiptVerify } from "./api-assets.js";
import { handleApproval, handleOrderAck, handleOrderDraft, handleOrderPlace, handleOrderTransition } from "./api-orders.js";
import { handleBackup, handleState, restoreFromDump } from "./api-ops.js";
import { handleComparison, handleOfferCapture, handleOfferSheet, handleRequestSubmit, handleRequestTransition } from "./api-verbs.js";
import { PgMarketplaceEvidenceStore } from "./evidence-store.js";
import { PgMarketplaceStore } from "./pglite-store.js";
import { NetworkedPgMarketplaceStore } from "./pg-store.js";
import { PgRegistryPorts } from "./ports.js";
import { verifyOnStart } from "./recovery.js";
import { isStoreUnreachableError, storeUnreachableOutcome } from "./store-unreachable.js";
import type { MarketplaceStore } from "./store.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.FLEETOS_MARKETPLACE_PORT ?? 3107);
const HOST = process.env.FLEETOS_MARKETPLACE_HOST ?? "127.0.0.1";
const DATA_DIR = process.env.FLEETOS_MARKETPLACE_DATA ?? path.join(HERE, "data");
/** The adapter selection (F372): "pglite" (default — the in-process mode,
 *  zero behavior motion) or "networked" (the REAL server process over TCP). */
const STORE_KIND = process.env.FLEETOS_MARKETPLACE_STORE ?? "pglite";
/** The networked adapter's postgres:// connection string (fail-closed when
 *  the networked mode is selected without one — a deployment MUST name its
 *  database; the test/journey harness provisions the server). */
const PG_CONNECTION = process.env.FLEETOS_MARKETPLACE_PG ?? "";

/** The keyring: the REAL F370B providers (env first, then file). Neither
 *  configured => fail-closed refusal to boot (a deployment MUST carry its
 *  keyring; the plainly-labelled fixture is a test/corpus concern — the
 *  journeys inject it through the env provider). */
function loadKeyring(): KeyringProvider {
  const fromEnv = envKeyringProvider({ env: process.env });
  if (fromEnv.ok) return fromEnv.provider;
  const file = process.env["FLEETOS_SESSION_KEYRING_FILE"];
  if (file !== undefined && file !== "") {
    const fromFile = fileKeyringProvider({ path: file });
    if (fromFile.ok) return fromFile.provider;
    console.error(`[fleetos-marketplace] keyring file refused: ${fromFile.detail}`);
    process.exit(2);
  }
  console.error(`[fleetos-marketplace] no keyring configured — set FLEETOS_SESSION_KEYRING_JSON (the F370B env provider) or FLEETOS_SESSION_KEYRING_FILE. Refusing to boot (fail-closed).`);
  process.exit(2);
}

/** The MarketplaceStore adapter selection (F372): the default pglite
 *  in-process mode (F370C behavior, UNCHANGED) or the networked-pg mode
 *  (a REAL postgres server process over TCP — the production shape). The
 *  service laws are identical through the frozen port either way. */
async function openStore(): Promise<MarketplaceStore> {
  if (STORE_KIND === "networked") {
    if (PG_CONNECTION === "") {
      console.error("[fleetos-marketplace] networked store selected but FLEETOS_MARKETPLACE_PG is unset — refusing to boot (fail-closed).");
      process.exit(2);
    }
    return NetworkedPgMarketplaceStore.open(PG_CONNECTION);
  }
  return PgMarketplaceStore.open(DATA_DIR);
}

export async function buildService(): Promise<{ ctx: ServiceContext; close: () => Promise<void> }> {
  const provider = loadKeyring();
  const store = await openStore();
  const ports = new PgRegistryPorts(store);
  const assets = new AssetDirectory(ports);
  const directory = new ReceiptEnrollmentDirectory(assets, ports, ports);
  const evidenceStore = new PgMarketplaceEvidenceStore(store);
  const registry = new InMemorySessionRevocationRegistry();
  const verify = await verifyOnStart({ store, ports, directory, registry });
  const ctx = makeContext({ store, ports, directory, assets, evidenceStore, provider, registry, verifyReport: verify });
  return { ctx, close: () => store.close() };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const restoreIndex = args.indexOf("--restore");
  const atIndex = args.indexOf("--at");
  const { ctx, close } = await buildService();

  if (restoreIndex !== -1) {
    const file = args[restoreIndex + 1] ?? "";
    const at = atIndex !== -1 ? Number(args[atIndex + 1] ?? 0) : 0;
    let dump = "";
    try {
      dump = readFileSync(file, "utf-8");
    } catch {
      console.error(`[fleetos-marketplace] --restore: dump file could not be read (path: ${file}; contents never echoed)`);
      process.exit(2);
    }
    const restored = await restoreFromDump(ctx, dump, at);
    if (!restored.ok) {
      console.error(`[fleetos-marketplace] --restore REFUSED (fail-closed): ${restored.detail}`);
      await close();
      process.exit(2);
    }
    console.log(`[fleetos-marketplace] restore complete: ${Object.keys(restored.digests ?? {}).length} digest set(s) verified against the dump envelope`);
  }

  // The single-writer discipline: mutating handlers serialize on one
  // promise chain (PGlite is single-connection; the pilot deployment is
  // one process — multi-replica is the networked-PG follow-up class).
  let writeChain: Promise<void> = Promise.resolve();
  const serialized = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = writeChain.then(fn, fn);
    writeChain = next.then(() => undefined, () => undefined);
    return next;
  };

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
      const route = `${req.method} ${url.pathname}`;
      const token = bearerTokenOf(req);
      const respond = (outcome: ApiOutcome) => sendJson(res, outcome.status, outcome.body);
      try {
        if (route === "GET /api/health") {
          const report = await ctx.store.digestReport();
          sendJson(res, 200, {
            ok: true, service: "fleetos-marketplace", port: PORT, host: HOST, dataDir: DATA_DIR,
            keyringSource: ctx.provider.source, startedAt: new Date().toISOString(),
            verify: ctx.verifyReport, counts: report.counts, digests: report.digests,
          });
          return;
        }
        if (route === "GET /api/digest") {
          const report = await ctx.store.digestReport();
          sendJson(res, 200, { ok: true, digests: report.digests, counts: report.counts });
          return;
        }
        if (route === "GET /api/admin/backup") {
          respond(await serialized(() => handleBackup(ctx, url.searchParams)));
          return;
        }
        if (route === "POST /api/auth/credentials") {
          respond(await serialized(async () => handleProvision(ctx, await readJson(req))));
          return;
        }
        if (route === "POST /api/auth/login") {
          respond(await serialized(async () => handleLogin(ctx, await readJson(req))));
          return;
        }
        if (route === "POST /api/auth/revocations") {
          respond(await serialized(async () => handleRevoke(ctx, req, await readJson(req))));
          return;
        }
        if (route === "GET /api/marketplace/state") {
          respond(await handleState(ctx, req, url.searchParams));
          return;
        }
        if (route === "GET /api/marketplace/offers/sheet") {
          respond(await handleOfferSheet(ctx, token, url.searchParams));
          return;
        }
        if (route === "GET /api/marketplace/evidence") {
          respond(await handleEvidenceRead(ctx, req, url.searchParams));
          return;
        }
        const post: Readonly<Record<string, (body: Record<string, unknown>) => Promise<ApiOutcome>>> = {
          "POST /api/marketplace/requests": (body) => handleRequestSubmit(ctx, token, body),
          "POST /api/marketplace/request-transitions": (body) => handleRequestTransition(ctx, token, body),
          "POST /api/marketplace/offers": (body) => handleOfferCapture(ctx, token, body),
          "POST /api/marketplace/comparisons": (body) => handleComparison(ctx, token, body),
          "POST /api/marketplace/orders": (body) => handleOrderDraft(ctx, token, body),
          "POST /api/marketplace/order-transitions": (body) => handleOrderTransition(ctx, token, body),
          "POST /api/marketplace/order-places": (body) => handleOrderPlace(ctx, token, body),
          "POST /api/marketplace/order-acks": (body) => handleOrderAck(ctx, token, body),
          "POST /api/marketplace/approvals": (body) => handleApproval(ctx, token, body),
          "POST /api/marketplace/receipts": (body) => handleReceiptRecord(ctx, token, body),
          "POST /api/marketplace/receipt-verifications": (body) => handleReceiptVerify(ctx, token, body),
          "POST /api/marketplace/enrollments": (body) => handleEnrollmentOpen(ctx, token, body),
          "POST /api/marketplace/enrollment-completions": (body) => handleEnrollmentComplete(ctx, token, body),
          "POST /api/marketplace/evidence": (body) => handleEvidenceRetain(ctx, token, body),
        };
        const handler = post[route];
        if (handler !== undefined) {
          respond(await serialized(async () => handler(await readJson(req))));
          return;
        }
        sendJson(res, 404, { ok: false, error: "not-found", detail: `no such API route: ${route}` });
      } catch (error) {
        // The F372 determinism law at the boundary: the crash-window pool
        // error (the killed server's 57P01 / ECONNREFUSED / recovery class)
        // NEVER crosses as a raw 500 — the verdict is FROZEN data (503 +
        // STORE_UNREACHABLE, the same answer on any postgres version, any
        // OS, any interleaving; the ECONNREFUSED text would even carry the
        // port). Everything else keeps the fail-loud 500 internal path.
        if (isStoreUnreachableError(error)) {
          console.error("[fleetos-marketplace] store unreachable (STORE_UNREACHABLE — frozen verdict)");
          const verdict = storeUnreachableOutcome();
          if (!res.headersSent) sendJson(res, verdict.status, verdict.body);
          else res.end();
          return;
        }
        console.error("[fleetos-marketplace] API error:", error);
        if (!res.headersSent) sendJson(res, 500, { ok: false, error: "internal", detail: String(error) });
        else res.end();
      }
    })();
  });

  server.listen(PORT, HOST, () => {
    const address = server.address();
    const boundPort = typeof address === "object" && address !== null ? address.port : PORT;
    console.log(
      `[fleetos-marketplace] listening on :${boundPort} (data: ${DATA_DIR}; keyring: ${ctx.provider.source}; verify-on-start: receipts=${ctx.verifyReport.receiptsReplayed} revocations=${ctx.verifyReport.revocationsReplayed} records=${ctx.verifyReport.recordsLoaded})`,
    );
  });

  const shutdown = (signal: string) => {
    console.log(`[fleetos-marketplace] ${signal} — closing`);
    server.close(() => {
      void close().then(() => process.exit(0));
    });
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

await main();
