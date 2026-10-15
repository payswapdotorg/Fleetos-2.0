/**
 * @fleetos/acceptance-commerce — the F370C deployment-service harness
 * (drivers-mps-harness.ts).
 *
 * Spawns the REAL marketplace deployment service as a REAL child process
 * (node + the ESM resolve hooks, infrastructure/fleetos-marketplace/
 * service.ts) on an EPHEMERAL PORT over a fresh temp data dir, drives it
 * over real HTTP (fetch), kills it with REAL SIGKILLs (the crash-
 * durability assertion, not prose), and re-boots it — same data dir for a
 * crash restart, the --restore flag for the runbook's incident path.
 *
 * The KEYRING is the driver's plainly-labelled TWO-KEY fixture (the F370A
 * fixture-key precedent): the current key issues every service session;
 * the OLD key is retired at a fixed logical instant — the journeys mint
 * stale-holder tokens under it through the REAL F370B keyring APIs
 * (issueKeyedSession over keyringProviderFromData) to drive KEY_RETIRED /
 * verify-grace at the boundary.
 *
 * THE OUTPUT LAW: the ephemeral port, the data-dir path, child pids and
 * every wall-clock value NEVER enter journey facts — the harness state
 * holds them; the step interpreter surfaces only logical, deterministic
 * response fields (the fixture-clock law, byte-identical re-runs).
 */

import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { issueSignedSession, keyringProviderFromData } from "@fleetos/identity";
import type { KeyringData } from "@fleetos/identity";
import type { JourneyState } from "./journey-world.js";

const REPO_ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../..");
const SERVICE_ENTRY = path.join(REPO_ROOT, "infrastructure", "fleetos-marketplace", "service.ts");
const SERVICE_RUNTIME = path.join(REPO_ROOT, "infrastructure", "fleetos-marketplace", "runtime.mjs");

/** The pilot's plainly-labelled TWO-KEY fixture keyring (the F370A
 *  fixture-key precedent; never a production source). The old key retires
 *  at T0+10d — journeys drive the verify-grace window and KEY_RETIRED. */
export const MPS_KEYRING: KeyringData = {
  currentKeyId: "mps-fix-k2",
  keys: [
    { keyId: "mps-fix-k1", algorithm: "HMAC-SHA256", secretHex: "0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9", retireAt: 1774000000000 + 10 * 86_400_000 },
    { keyId: "mps-fix-k2", algorithm: "HMAC-SHA256", secretHex: "f9e8d7c6b5a4938271605f4e3d2c1b0a998877665544332211000918273645f0", retireAt: null },
  ],
};

export interface MpsService {
  child: ChildProcess | null;
  port: number;
  dataDir: string;
  dumpFile: string | null;
  /** sessionKey -> keyed token (never surfaced in facts). */
  readonly tokens: Map<string, string>;
  /** The last provider-ack evidence id (the ack seam's citation). */
  lastProviderAckEvidenceId: string | null;
  /** The last offer-snapshot evidence id (the approval seam's citation). */
  lastSnapshotEvidenceId: string | null;
  /** The last digest report (for restart/restore comparisons). */
  lastDigest: { total: string; counts: Record<string, number> } | null;
  booted: boolean;
}

const services = new WeakMap<JourneyState, MpsService>();

export function serviceOf(state: JourneyState): MpsService {
  let service = services.get(state);
  if (service === undefined) {
    service = {
      child: null,
      port: 0,
      dataDir: mkdtempSync(path.join(tmpdir(), "mps-journey-")),
      dumpFile: null,
      tokens: new Map(),
      lastProviderAckEvidenceId: null,
      lastSnapshotEvidenceId: null,
      lastDigest: null,
      booted: false,
    };
    services.set(state, service);
  }
  return service;
}

function bootChild(service: MpsService, extraArgs: readonly string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--experimental-transform-types", "--no-warnings", "--import", SERVICE_RUNTIME, SERVICE_ENTRY, ...extraArgs],
      {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          FLEETOS_MARKETPLACE_PORT: "0",
          FLEETOS_MARKETPLACE_DATA: service.dataDir,
          FLEETOS_SESSION_KEYRING_JSON: JSON.stringify(MPS_KEYRING),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let settled = false;
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += String(chunk);
      const match = stdout.match(/listening on :(\d+)/);
      if (match !== null && !settled) {
        settled = true;
        resolve(Number(match[1]));
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const text = String(chunk);
      if (text.includes("Error") || text.includes("error")) process.stderr.write(`[mps-service] ${text}`);
    });
    child.on("exit", (code) => {
      if (!settled) {
        settled = true;
        reject(new Error(`the marketplace service exited during boot (code ${code})`));
      }
      if (service.child === child) service.child = null;
    });
    service.child = child;
    setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error("the marketplace service did not boot in time"));
      }
    }, 60_000);
  });
}

async function waitHealthy(port: number): Promise<void> {
  for (let attempt = 0; attempt < 240; attempt++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) return;
    } catch {
      // retry until the service is up
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("the marketplace service never became healthy");
}

/** Boot (first start or a fresh restore boot). Returns the bound port. */
export async function bootService(service: MpsService, extraArgs: readonly string[] = []): Promise<number> {
  const port = await bootChild(service, extraArgs);
  await waitHealthy(port);
  service.port = port;
  service.booted = true;
  return port;
}

/** SIGKILL the service and wait for the process to die (the crash). */
export function killService(service: MpsService): Promise<void> {
  return new Promise((resolve) => {
    const child = service.child;
    if (child === null) {
      resolve();
      return;
    }
    child.on("exit", () => resolve());
    child.kill("SIGKILL");
  });
}

export async function shutdownService(service: MpsService): Promise<void> {
  await killService(service);
  try {
    rmSync(service.dataDir, { recursive: true, force: true });
  } catch {
    // best-effort temp cleanup; the OS reaps tmp on teardown
  }
  service.booted = false;
}

// ---------------------------------------------------------------------------
// The HTTP client (real fetch; the port never leaves this module)
// ---------------------------------------------------------------------------

export interface MpsResponse {
  readonly status: number;
  readonly json: Record<string, unknown>;
}

export async function mpsCall(service: MpsService, method: "GET" | "POST", route: string, body?: unknown, sessionKey?: string | null): Promise<MpsResponse> {
  const token = sessionKey === undefined || sessionKey === null ? undefined : service.tokens.get(sessionKey);
  const res = await fetch(`http://127.0.0.1:${service.port}${route}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token !== undefined ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

/** Mint a keyed token under a SPECIFIC key of the fixture keyring (the
 *  stale-holder composition: the F370B module issues only under the
 *  CURRENT key, so a retired-key holder is client-side — the REAL F370A
 *  kernel `issueSignedSession` under the named key's material, wrapped in
 *  the documented fsk1 envelope form exactly as keyring.ts wraps it). */
export function mintKeyedToken(input: {
  readonly keyId: string;
  readonly actorId: string;
  readonly tenantId: string;
  readonly scopes: readonly string[];
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly jti: string;
}): { ok: boolean; token?: string } {
  const provider = keyringProviderFromData(MPS_KEYRING);
  const material = provider.resolveKeyMaterial(input.keyId);
  if (material === null) return { ok: false };
  const issued = issueSignedSession({
    actorId: input.actorId,
    tenantId: input.tenantId,
    scopes: input.scopes as never,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
    jti: input.jti,
    key: { algorithm: material.algorithm, secretHex: material.secretHex },
  });
  if (!issued.ok) return { ok: false };
  return { ok: true, token: `fsk1.${input.keyId}.${issued.token.slice("fss1.".length)}` };
}

/** String surgery on a token (the tamper surfaces): flip one payload char. */
export function tamperToken(token: string): string {
  const parts = token.split(".");
  const payload = parts[2] ?? "";
  const flip = payload.includes("A") ? payload.replace("A", "B") : `X${payload.slice(1)}`;
  return `${parts[0]}.${parts[1]}.${flip}.${parts[3]}`;
}

/** Swap the carried key id (the KEY_UNKNOWN surface). */
export function unknownKeyToken(token: string): string {
  const parts = token.split(".");
  return `${parts[0]}.mps-fix-nope.${parts[2]}.${parts[3]}`;
}

/** Write the dump to the service's temp dir (the runbook's file step). */
export function persistDump(service: MpsService, dump: string): string {
  const file = path.join(service.dataDir, `backup-${service.dumpFile === null ? 1 : 2}.json`);
  writeFileSync(file, dump);
  service.dumpFile = file;
  return file;
}
