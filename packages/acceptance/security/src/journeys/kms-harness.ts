/**
 * kms-harness.ts — the F373 journey harness (NOT a journey; the shared
 * child-process driver the three kms-* journey modules import).
 *
 * Spawns the REAL fleetos-kms service as a REAL child process (node + the
 * ESM resolve hooks, infrastructure/fleetos-kms/service.ts) on an
 * EPHEMERAL PORT over a fresh temp data dir, drives it over real HTTP
 * (fetch), kills it with REAL SIGKILLs, and re-boots it on the SAME data
 * dir for the crash-restart proof — the F370C deployment-harness pattern,
 * transplanted to the security corpus's module-evaluation law (the F341B
 * top-level-await precedent: the corpus runner executes synchronous steps,
 * so the REAL service is driven to completion at module evaluation time;
 * the resolved facts are frozen as module constants the sync steps
 * record).
 *
 * THE FIXTURES (plainly labelled, the F370A fixture-key precedent — never
 * production material): the master key hex, the admin secret and the
 * SecureRandom draws are FIXED test/corpus constants. The draws ride the
 * service's FLEETOS_KMS_RANDOM_STREAM injection (the REAL
 * `deterministicSecureRandom` fixed-stream impl at the service's host
 * boundary — plainly labelled test/corpus ONLY), so every key id and key
 * material the KMS generates is a known constant: that is what makes the
 * at-rest scan and the no-leak grep machine-assertable.
 *
 * THE OUTPUT LAW (the packet's fixture-clock law): the ephemeral port, the
 * data-dir path, child pids and every wall-clock value NEVER enter journey
 * facts. The harness holds them in this module's state; the journeys
 * surface only logical, deterministic response fields (fixed logical
 * `now` on every request; no wall clock anywhere).
 */

import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../../..");
const SERVICE_ENTRY = path.join(REPO_ROOT, "infrastructure", "fleetos-kms", "service.ts");
const SERVICE_RUNTIME = path.join(REPO_ROOT, "infrastructure", "fleetos-kms", "runtime.mjs");

// ---------------------------------------------------------------------------
// The plainly-labelled F373 test/corpus fixtures (never production material)
// ---------------------------------------------------------------------------

/** The fixture master key (64 hex = 32 bytes) — plainly labelled. */
export const KMS_F373_MASTER_KEY = "f373a1b2c3d4e5f60718293a4b5c6d7ef373a1b2c3d4e5f60718293a4b5c6d7e";
/** The fixture admin credential secret — plainly labelled. */
export const KMS_F373_ADMIN_SECRET = "f373-fixture-admin-secret";
/** The fixture admin token key draw (stream position 1 — first boot). */
export const KMS_F373_ADMIN_TK = "5f3730a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d";
/** The create draw (stream: id then material — the frozen order). */
export const KMS_F373_CREATE_KID = "f373c0ffee00f373";
export const KMS_F373_CREATE_MAT = "1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff";
/** The rotate draw (stream: id then material — the frozen order). */
export const KMS_F373_ROTATE_KID = "f373deadbeeff373";
export const KMS_F373_ROTATE_MAT = "ffffeeeeddddccccbbbbaaaa9999888877776666555544443333222211110000";

/** The rotation-shaped stream: admin token key, create (id+mat), rotate
 *  (id+mat) — consumed in EXACTLY this order by one process lifetime. */
export const KMS_F373_ROTATION_STREAM: readonly string[] = [
  KMS_F373_ADMIN_TK,
  KMS_F373_CREATE_KID,
  KMS_F373_CREATE_MAT,
  KMS_F373_ROTATE_KID,
  KMS_F373_ROTATE_MAT,
];

/** The boundary-shaped stream: admin token key + one create (id+mat). */
export const KMS_F373_BOUNDARY_STREAM: readonly string[] = [
  KMS_F373_ADMIN_TK,
  KMS_F373_CREATE_KID,
  KMS_F373_CREATE_MAT,
];

// ---------------------------------------------------------------------------
// The harness (per-journey dedicated instances; order-independent by
// construction — each journey module drives its own process)
// ---------------------------------------------------------------------------

/** One captured HTTP response (for the no-leak network-boundary scan). */
export interface CapturedCall {
  readonly label: string;
  readonly method: string;
  readonly path: string;
  readonly bodyText: string;
}

export interface KmsHarness {
  readonly calls: CapturedCall[];
  /** The transport base URL (never enters any journey fact). */
  baseUrl(): string;
  boot(): Promise<void>;
  call(input: { method: "GET" | "POST"; path: string; body?: unknown; token?: string | null; label: string }): Promise<{ status: number; json: Record<string, unknown> }>;
  login(input: { adminId: string; secret: string; now: number; ttlMs: number; jti: string }): Promise<string>;
  killAndAwait(): Promise<void>;
  restart(): Promise<void>;
  stateFileText(): string;
  auditFileText(): string;
  bootedCount(): number;
  dispose(): void;
}

export async function spawnKmsHarness(stream: readonly string[]): Promise<KmsHarness> {
  const dataDir = mkdtempSync(path.join(tmpdir(), "kms-journey-"));
  const calls: CapturedCall[] = [];
  let child: ChildProcess | null = null;
  let port = 0;
  let boots = 0;

  function bootChild(): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(
        process.execPath,
        ["--experimental-transform-types", "--no-warnings", "--import", SERVICE_RUNTIME, SERVICE_ENTRY],
        {
          cwd: REPO_ROOT,
          env: {
            ...process.env,
            FLEETOS_KMS_PORT: "0",
            FLEETOS_KMS_DATA: dataDir,
            FLEETOS_KMS_MASTER_KEY: KMS_F373_MASTER_KEY,
            FLEETOS_KMS_RANDOM_STREAM: JSON.stringify(stream),
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let stdout = "";
      let settled = false;
      proc.stdout!.on("data", (chunk: Buffer) => {
        stdout += String(chunk);
        const match = stdout.match(/listening on :(\d+)/);
        if (match !== null && !settled) {
          settled = true;
          port = Number(match[1]);
          resolve();
        }
      });
      proc.stderr!.on("data", (chunk: Buffer) => {
        process.stderr.write(`[kms-harness:child-stderr] ${String(chunk)}`);
      });
      proc.on("exit", (code) => {
        if (!settled) {
          settled = true;
          process.stderr.write(`[kms-harness] boot failure; captured stdout: ${JSON.stringify(stdout)}\n`);
          reject(new Error(`the KMS service exited during boot (code ${code})`));
        }
        if (child === proc) child = null;
      });
      child = proc;
      boots += 1;
      setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error("the KMS service did not boot in time"));
        }
      }, 60_000);
    });
  }

  const harness: KmsHarness = {
    calls,
    baseUrl() {
      return `http://127.0.0.1:${port}`;
    },
    async boot() {
      await bootChild();
    },
    async call({ method, path: route, body, token, label }) {
      const res = await fetch(`http://127.0.0.1:${port}${route}`, {
        method,
        headers: {
          "content-type": "application/json",
          ...(token === undefined || token === null ? {} : { authorization: `Bearer ${token}` }),
        },
        ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}),
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const bodyText = JSON.stringify(json);
      calls.push({ label, method, path: route, bodyText });
      return { status: res.status, json };
    },
    async login({ adminId, secret, now, ttlMs, jti }) {
      const res = await harness.call({
        method: "POST",
        path: "/api/session",
        body: { adminId, secret, now, ttlMs, jti },
        label: "session-login",
      });
      const token = res.json["token"];
      if (res.status !== 200 || typeof token !== "string") {
        throw new Error(`kms login failed (status ${res.status}) — the harness refuses to continue`);
      }
      return token;
    },
    killAndAwait() {
      return new Promise<void>((resolve) => {
        const proc = child;
        if (proc === null) {
          resolve();
          return;
        }
        proc.on("exit", () => resolve());
        proc.kill("SIGKILL");
      });
    },
    async restart() {
      await bootChild();
    },
    stateFileText() {
      return readFileSync(path.join(dataDir, "kms-state.json"), "utf8");
    },
    auditFileText() {
      return readFileSync(path.join(dataDir, "kms-audit.jsonl"), "utf8");
    },
    bootedCount() {
      return boots;
    },
    dispose() {
      try {
        child?.kill("SIGKILL");
      } catch {
        // best effort
      }
      try {
        rmSync(dataDir, { recursive: true, force: true });
      } catch {
        // best-effort temp cleanup; the OS reaps tmp on teardown
      }
    },
  };
  await harness.boot();
  return harness;
}


// ---------------------------------------------------------------------------
// Typed fact accessors (the raw json is Record<string, unknown>; the
// recorder requires JourneyFactValue — these keep the run bodies honest)
// ---------------------------------------------------------------------------

export interface KmsCallResult {
  readonly status: number;
  readonly json: Record<string, unknown>;
}

/** True iff the call succeeded (200 + ok:true). */
export function okOf(call: KmsCallResult): boolean {
  return call.status === 200 && call.json["ok"] === true;
}

/** A string field ("" when absent — a fact, never a crash). */
export function strOf(json: Record<string, unknown>, key: string): string {
  const v = json[key];
  return typeof v === "string" ? v : "";
}

/** A number field (-1 when absent — a fact, never a crash). */
export function numOf(json: Record<string, unknown>, key: string): number {
  const v = json[key];
  return typeof v === "number" && Number.isFinite(v) ? v : -1;
}

/** A string-array field ([] when malformed — a fact, never a crash). */
export function listOf(json: Record<string, unknown>, key: string): readonly string[] {
  const v = json[key];
  return Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as readonly string[]) : [];
}

/** The frozen refusal reason of a refused call ("" when absent). */
export function refusalReasonOf(call: KmsCallResult): string {
  const refusal = call.json["refusal"];
  if (refusal !== null && typeof refusal === "object" && !Array.isArray(refusal)) {
    const reason = (refusal as Record<string, unknown>)["reason"];
    if (typeof reason === "string") return reason;
  }
  return "";
}

/** String surgery on an fka1/fsk1-style token: flip the LAST payload/sig
 *  character (a deterministic single-character tamper — never in facts). */
export function tamperToken(token: string): string {
  const parts = token.split(".");
  const last = parts.length - 1;
  const seg = parts[last] ?? "";
  const flipped = seg.startsWith("A") ? `B${seg.slice(1)}` : `A${seg.slice(1)}`;
  parts[last] = flipped;
  return parts.join(".");
}

/** Swap the carried key id segment of an fsk1 keyed token (KEY_UNKNOWN /
 *  wrong-material surgery at the keyring layer — F370B's token tools). */
export function swapKeyedTokenKeyId(token: string, keyId: string): string {
  const parts = token.split(".");
  return `${parts[0]}.${keyId}.${parts[2]}.${parts[3]}`;
}
