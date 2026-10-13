/**
 * infrastructure/fleetos-durable/proof-restart.mjs — the Q2 machine proof:
 * SIGKILL restart-recovery, byte-exact.
 *
 * Steps (F350 §2 Q2 / the F351A packet):
 *  1. start the service (fresh isolated data dir), wait for /api/health;
 *  2. drive the seed sequence through the REAL API:
 *       - enroll 2 devices across 2 tenants (assets.jsonl),
 *       - submit 3 commands: one clean enqueue, one idempotent duplicate
 *         (same logical intent → duplicate=true, same commandId, NEVER a
 *         second enqueue), one refused (out-of-vocabulary reason);
 *  3. capture the full record-set digest (sha256 over the canonical JSON of
 *     all records, per segment and total) + the raw segment file sha256s +
 *     the tenant-scoped /api/state reads;
 *  4. kill -9 (SIGKILL — not a graceful shutdown), restart the service;
 *  5. re-read through the API and re-digest — EVERY digest must match
 *     byte-exactly;
 *  6. exit 0 only on full match; print every digest either way.
 *
 * The drafts are built with the REAL lane builder (the same
 * buildEnrollAssetIntent the browser shell uses — deterministic idempotency
 * keys), imported through the same resolve hooks the service uses.
 *
 * Usage: node --experimental-transform-types --no-warnings \
 *          --import ./runtime.mjs proof-restart.mjs
 * Requires :3106 to be free (the service's fixed port).
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { buildEnrollAssetIntent } from "@fleetos/experience-asset-field";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVICE = path.join(HERE, "service.ts");
const RUNTIME = path.join(HERE, "runtime.mjs");
const PORT = 3106;
const BASE = `http://localhost:${PORT}`;

const T1 = "tnt_acme-logistics";
const T2 = "tnt_meridian-health";
const A1 = "act_ada-operator";
const A2 = "act_maya-operator";

function fail(message) {
  console.error(`PROOF FAILED: ${message}`);
  process.exitCode = 1;
}

function sha256File(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

let serviceProc = null;

function startService(dataDir) {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      process.execPath,
      ["--experimental-transform-types", "--no-warnings", "--import", RUNTIME, SERVICE],
      {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, FLEETOS_DURABLE_DATA: dataDir },
        cwd: HERE,
      },
    );
    serviceProc = proc;
    const say = (stream, tag) =>
      stream.on("data", (d) => console.log(`  [svc] ${tag}: ${String(d).trim()}`));
    say(proc.stdout, "out");
    say(proc.stderr, "err");
    proc.on("error", reject);
    resolve(proc);
  });
}

async function waitHealthy(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return (await r.json());
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`service did not become healthy within ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function post(pathname, body) {
  const r = await fetch(`${BASE}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await r.json());
}

async function getState(tenantId, actorId) {
  const r = await fetch(`${BASE}/api/state?tenantId=${encodeURIComponent(tenantId)}&actorId=${encodeURIComponent(actorId)}`);
  return (await r.json());
}

function kill9() {
  return new Promise((resolve) => {
    if (serviceProc === null || serviceProc.pid === undefined) throw new Error("no service process to kill");
    serviceProc.on("exit", (code, signal) => resolve({ code, signal }));
    process.kill(serviceProc.pid, "SIGKILL");
  });
}

function rawSegmentDigests(dataDir) {
  const out = {};
  for (const f of ["commands.jsonl", "audit.jsonl", "assets.jsonl"]) {
    const p = path.join(dataDir, f);
    out[f] = existsSync(p) ? sha256File(p) : "(absent)";
  }
  return out;
}

async function main() {
  // --- preconditions ---
  try {
    await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(500) });
    console.error(`port :${PORT} is already serving — stop the running instance before the proof`);
    process.exit(1);
  } catch {
    /* good: port free */
  }
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "fleetos-proof-"));
  console.log(`PROOF F351A/Q2 — restart-recovery (SIGKILL), byte-exact record-set comparison`);
  console.log(`data dir: ${dataDir}`);

  // --- 1. start + health ---
  await startService(dataDir);
  const health1 = await waitHealthy(20000);
  console.log(`\n[1] service healthy: commit=${health1.commit} replay=${health1.replay.commands}c/${health1.replay.audit}a/${health1.replay.assets}s`);

  // --- 2. seed through the API ---
  const dev1 = "dev_proof-acme-r1";
  const dev2 = "dev_proof-mer-r1";
  const e1 = await post("/api/enrollments", { tenantId: T1, actorId: A1, deviceId: dev1 });
  const e2 = await post("/api/enrollments", { tenantId: T2, actorId: A2, deviceId: dev2 });
  if (!e1.ok || !e2.ok) return fail(`seed enrollments refused: ${JSON.stringify(e1)} / ${JSON.stringify(e2)}`);
  console.log(`[2] enrolled ${dev1} (${T1}) and ${dev2} (${T2})`);

  const cleanDraft = buildEnrollAssetIntent({
    tenantId: T1,
    actorId: A1,
    assetId: "ast_proof-asset-01",
    deviceId: "dev_proof-acme-r1",
    serial: "SN-PROOF-0001",
    issuedAt: Date.now(),
    reason: "onboarding",
  });
  if (!cleanDraft.ok) return fail(`clean draft refused: ${cleanDraft.detail}`);
  const dupDraft = buildEnrollAssetIntent({
    tenantId: T1,
    actorId: A1,
    assetId: "ast_proof-asset-01",
    deviceId: "dev_proof-acme-r1",
    serial: "SN-PROOF-0001",
    issuedAt: Date.now(),
    reason: "onboarding",
  });
  if (!dupDraft.ok) return fail(`duplicate draft refused: ${dupDraft.detail}`);
  if (dupDraft.draft.idempotencyKey !== cleanDraft.draft.idempotencyKey) {
    return fail("the two logical intents did not derive the same idempotency key");
  }
  const refusedDraftR = buildEnrollAssetIntent({
    tenantId: T1,
    actorId: A1,
    assetId: "ast_proof-asset-02",
    deviceId: "dev_proof-acme-r2",
    serial: "SN-PROOF-0002",
    issuedAt: Date.now(),
    reason: "bogus-reason-out-of-vocabulary",
  });
  if (!refusedDraftR.ok) return fail(`refusal draft refused: ${refusedDraftR.detail}`);

  const c1 = await post("/api/commands", { tenantId: T1, actorId: A1, draft: cleanDraft.draft });
  const c2 = await post("/api/commands", { tenantId: T1, actorId: A1, draft: dupDraft.draft });
  const c3 = await post("/api/commands", { tenantId: T1, actorId: A1, draft: refusedDraftR.draft });
  if (!c1.ok || c1.ack.duplicate) return fail(`clean submit not a fresh enqueue: ${JSON.stringify(c1)}`);
  if (!c2.ok || !c2.ack.duplicate || c2.ack.commandId !== c1.ack.commandId) {
    return fail(`duplicate submit did not return the ORIGINAL ack: ${JSON.stringify(c2)} vs ${JSON.stringify(c1)}`);
  }
  if (c3.ok || c3.refused !== "reason-not-in-vocabulary") {
    return fail(`out-of-vocabulary submit was not refused as expected: ${JSON.stringify(c3)}`);
  }
  console.log(`[3] commands: clean=${c1.ack.commandId} duplicate=true(same id, no second enqueue) refused=${c3.refused}`);

  // --- 3. capture digests ---
  const digestsBefore = (await (await fetch(`${BASE}/api/digest`)).json());
  const state1T1 = await getState(T1, A1);
  const state1T2 = await getState(T2, A2);
  const rawBefore = rawSegmentDigests(dataDir);
  console.log(`\n[4] BEFORE kill — record-set digests (canonical JSON, sha256):`);
  for (const [k, v] of Object.entries(digestsBefore.digests)) console.log(`    ${k.padEnd(8)} ${v}`);
  console.log(`    counts: ${JSON.stringify(digestsBefore.counts)}`);
  console.log(`    raw segment files: ${JSON.stringify(rawBefore)}`);

  // --- 4. SIGKILL + restart ---
  const killInfo = await kill9();
  console.log(`\n[5] SIGKILL delivered (exit code=${killInfo.code} signal=${killInfo.signal})`);
  await new Promise((r) => setTimeout(r, 300));
  await startService(dataDir);
  const health2 = await waitHealthy(20000);
  console.log(`[6] restarted: replay=${health2.replay.commands}c/${health2.replay.audit}a/${health2.replay.assets}s (must equal the pre-kill record set)`);

  // --- 5. re-digest + compare ---
  const digestsAfter = (await (await fetch(`${BASE}/api/digest`)).json());
  const state2T1 = await getState(T1, A1);
  const state2T2 = await getState(T2, A2);
  const rawAfter = rawSegmentDigests(dataDir);

  console.log(`\n[7] AFTER restart — record-set digests:`);
  for (const [k, v] of Object.entries(digestsAfter.digests)) console.log(`    ${k.padEnd(8)} ${v}`);
  console.log(`    counts: ${JSON.stringify(digestsAfter.counts)}`);

  let ok = true;
  for (const k of ["commands", "audit", "assets", "total"]) {
    const match = digestsBefore.digests[k] === digestsAfter.digests[k];
    console.log(`    ${k.padEnd(8)} ${match ? "MATCH (byte-exact)" : `MISMATCH: ${digestsBefore.digests[k]} -> ${digestsAfter.digests[k]}`}`);
    if (!match) ok = false;
  }
  for (const [f, h] of Object.entries(rawBefore)) {
    const match = rawAfter[f] === h;
    console.log(`    raw ${f}: ${match ? "unchanged" : `CHANGED: ${h} -> ${rawAfter[f]}`}`);
    if (!match) ok = false;
  }
  const stateMatch =
    canonicalJson(state1T1.commands) === canonicalJson(state2T1.commands) &&
    canonicalJson(state1T1.submissions) === canonicalJson(state2T1.submissions) &&
    canonicalJson(state1T1.enrollments) === canonicalJson(state2T1.enrollments) &&
    canonicalJson(state1T2.enrollments) === canonicalJson(state2T2.enrollments) &&
    canonicalJson(state1T2.commands) === canonicalJson(state2T2.commands) &&
    canonicalJson(state1T2.submissions) === canonicalJson(state2T2.submissions);
  console.log(`    tenant-scoped /api/state reads: ${stateMatch ? "identical (commands + submissions + enrollments, both tenants)" : "DIFFER"}`);
  if (!stateMatch) ok = false;

  // restart evidence: leave the service running? No — proof cleans up.
  if (serviceProc !== null && serviceProc.exitCode === null) serviceProc.kill("SIGKILL");

  console.log(`\nPROOF ${ok ? "PASSED (exit 0): every operational record survived the SIGKILL restart byte-exactly" : "FAILED (exit 1)"}`);
  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error(`PROOF FAILED: ${error && error.stack ? error.stack : String(error)}`);
  if (serviceProc !== null && serviceProc.exitCode === null) serviceProc.kill("SIGKILL");
  process.exit(1);
});
