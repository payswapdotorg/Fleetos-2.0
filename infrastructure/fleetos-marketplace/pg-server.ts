/**
 * infrastructure/fleetos-marketplace/pg-server.ts — the postgres SERVER
 * lifecycle harness (F372, Wave 19 lane A).
 *
 * Provisions a REAL, SEPARATE postgres server PROCESS for the test/journey
 * lifecycle: `initdb` a temp PGDATA, start `postgres` on an ephemeral port
 * bound to 127.0.0.1, probe TCP readiness, run, SIGKILL (the server-crash
 * proof), restart (WAL recovery), stop, tear down. NEVER an in-process
 * library standing in for the server — a crashed-and-restarted server is
 * the whole point.
 *
 * Server discovery (the first hit wins):
 *   1. `FLEETOS_PG_BINDIR` — an explicit bindir (the self-contained
 *      distribution class, e.g. a user-local zonky/official extract in a
 *      rootless sandbox);
 *   2. `initdb`/`postgres` on the PATH;
 *   3. the Debian/Ubuntu system layout /usr/lib/postgresql/<version>/bin
 *      (newest version first — the CI runner shape).
 * Production host credentials / managed-PG are operator deployment class —
 * this harness is the TEST class only (localhost, trust auth, temp dirs).
 *
 * Determinism laws: the locale is pinned to C (`initdb --locale=C`) so the
 * networked cluster's collation matches the pglite build's semantics —
 * natural-key ORDER BY sequences are byte-stable and adapter-parity holds.
 * The ephemeral port, the temp paths and the server pid NEVER enter
 * journey facts — they live only in this harness's state.
 *
 * The container law: `dynamic_shared_memory_type=mmap` (anonymous mmap —
 * set at BOTH initdb and server start) keeps postgres's EPHEMERAL runtime
 * shared memory out of /dev/shm. A SIGKILLed postmaster cannot clean up
 * POSIX DSM files, so a crash-proof harness on the default 64MB container
 * /dev/shm would leak itself to death; mmap DSM leaks NOTHING (DSM is
 * never persisted — WAL recovery and the digest envelope are unaffected).
 * Provisions therefore stay repeatable under concurrency and across many
 * real SIGKILLs.
 *
 * Pure node builtins (node:child_process / node:fs / node:net / node:os /
 * node:path) — no driver dependency here; the ADAPTER (pg-store.ts) owns
 * the TCP client side.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import * as path from "node:path";

/** Where a usable postgres server distribution was found. */
export interface PostgresBindir {
  readonly bindir: string;
  readonly source: "env" | "path" | "system";
}

const SYSTEM_PG_ROOT = "/usr/lib/postgresql";

/** Resolve a postgres server bindir (env > PATH > system layout), or null. */
export function resolvePostgresBindir(): PostgresBindir | null {
  const fromEnv = process.env["FLEETOS_PG_BINDIR"];
  if (fromEnv !== undefined && fromEnv !== "") {
    if (existsSync(path.join(fromEnv, "initdb")) && existsSync(path.join(fromEnv, "postgres"))) {
      return { bindir: fromEnv, source: "env" };
    }
    return null;
  }
  for (const dir of (process.env["PATH"] ?? "").split(path.delimiter)) {
    if (dir !== "" && existsSync(path.join(dir, "initdb")) && existsSync(path.join(dir, "postgres"))) {
      return { bindir: dir, source: "path" };
    }
  }
  try {
    const versions = readdirSync(SYSTEM_PG_ROOT).filter((name) => /^\d+$/.test(name)).sort((a, b) => Number(b) - Number(a));
    for (const version of versions) {
      const bindir = path.join(SYSTEM_PG_ROOT, version, "bin");
      if (existsSync(path.join(bindir, "initdb")) && existsSync(path.join(bindir, "postgres"))) {
        return { bindir, source: "system" };
      }
    }
  } catch {
    // no system layout — fall through
  }
  return null;
}

/** Ask the kernel for a free ephemeral port on 127.0.0.1. */
function freeEphemeralPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      probe.close(() => (port > 0 ? resolve(port) : reject(new Error("no ephemeral port"))));
    });
  });
}

/** Resolve when a TCP endpoint accepts a CLIENT connection (bounded). */
function waitTcpReady(host: string, port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = connect({ port, host });
      const done = (failed: boolean) => {
        socket.removeAllListeners();
        socket.destroy();
        if (!failed) resolve();
        else if (Date.now() > deadline) reject(new Error("postgres server did not become ready in time"));
        else setTimeout(attempt, 50);
      };
      socket.once("connect", () => done(false));
      socket.once("error", () => done(true));
    };
    attempt();
  });
}

/** Run a provisioning binary to completion; sanitized errors (never paths). */
function runTool(bindir: string, tool: string, args: readonly string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(path.join(bindir, tool), args, { stdio: ["ignore", "pipe", "pipe"] });
    let drained = false;
    const drain = (stream: NodeJS.ReadableStream | null) => {
      if (stream !== null) stream.resume();
    };
    drain(child.stdout);
    drain(child.stderr);
    const timer = setTimeout(() => {
      drained = true;
      child.kill("SIGKILL");
      reject(new Error(`postgres ${tool} timed out`));
    }, timeoutMs);
    child.on("error", () => {
      clearTimeout(timer);
      reject(new Error(`postgres ${tool} could not be started`));
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (drained) return;
      if (code === 0) resolve();
      else reject(new Error(`postgres ${tool} failed (exit ${code ?? "signal"})`));
    });
  });
}

/**
 * A provisioned postgres SERVER process — one temp PGDATA cluster on an
 * ephemeral port. `kill()` is the REAL SIGKILL (the crash proof);
 * `restart()` respawns over the SAME PGDATA and port (WAL recovery runs);
 * `teardown()` stops the process and removes the temp dirs.
 */
export class PostgresServerProcess {
  private child: ChildProcess | null = null;
  private exiting = false;

  private constructor(
    private readonly bindir: PostgresBindir,
    private readonly baseDir: string,
    readonly port: number,
  ) {}

  /** The TCP connection string for the networked adapter (pg-store.ts). */
  get connectionString(): string {
    return `postgres://fleetos@127.0.0.1:${this.port}/postgres`;
  }

  /** The server's PGDATA root (temp; never surfaced in journey facts). */
  get pgdata(): string {
    return path.join(this.baseDir, "pgdata");
  }

  /** initdb + start a REAL postgres server process on an ephemeral port. */
  static async provision(): Promise<PostgresServerProcess> {
    const bindir = resolvePostgresBindir();
    if (bindir === null) {
      throw new Error("no postgres server distribution found — set FLEETOS_PG_BINDIR, put initdb/postgres on PATH, or install the system layout");
    }
    const baseDir = mkdtempSync(path.join(tmpdir(), "npg-server-"));
    const server = new PostgresServerProcess(bindir, baseDir, await freeEphemeralPort());
    // Locale pinned to C: the networked cluster's collation matches the
    // pglite build's semantics (deterministic ORDER BY; adapter parity).
    // DSM via anonymous mmap: a SIGKILLed server leaks no /dev/shm files
    // (the container law in the header) — initdb's bootstrap postmaster
    // and the provisioned server both run under it.
    await runTool(bindir.bindir, "initdb", ["-D", server.pgdata, "-U", "fleetos", "--auth=trust", "-E", "UTF8", "--locale=C", "--set", "dynamic_shared_memory_type=mmap"], 120_000);
    await server.spawnServer();
    return server;
  }

  /** Spawn the postgres process (fresh boot or crash-restart). */
  private async spawnServer(): Promise<void> {
    if (this.child !== null) throw new Error("postgres server already running");
    this.exiting = false;
    const child = spawn(path.join(this.bindir.bindir, "postgres"), [
      "-D", this.pgdata,
      "-p", String(this.port),
      "-k", this.baseDir,
      "-c", "listen_addresses=127.0.0.1",
      "-c", "dynamic_shared_memory_type=mmap",
    ], { stdio: "ignore" });
    const exited = new Promise<number | null>((resolve) => {
      child.on("exit", (code) => resolve(code));
    });
    this.child = child;
    // If the process dies immediately, waitTcpReady would hang — race the
    // exit against the readiness probe (sanitized error, never the port).
    const ready = waitTcpReady("127.0.0.1", this.port, 60_000);
    const died = exited.then((code) => {
      throw new Error(`postgres server exited during start (code ${code ?? "signal"})`);
    });
    await Promise.race([ready, died]);
  }

  /** SIGKILL the REAL postgres server process and wait for its death. */
  async kill(): Promise<void> {
    const child = this.child;
    if (child === null) return;
    this.exiting = true;
    if (child.exitCode !== null || child.signalCode !== null) {
      // Already dead on its own (never spawned or crashed outside the
      // harness's own kills) — the exit event already fired; no hang.
      this.child = null;
      return;
    }
    await new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      child.kill("SIGKILL");
    });
    this.child = null;
  }

  /** Respawn postgres over the SAME PGDATA and port — REAL WAL recovery. */
  async restart(): Promise<void> {
    await this.kill();
    await this.spawnServer();
  }

  /** True while a server process is running under this handle. */
  get running(): boolean {
    return this.child !== null;
  }

  /** Stop + remove the temp cluster (the harness teardown). */
  async teardown(): Promise<void> {
    await this.kill();
    try {
      rmSync(this.baseDir, { recursive: true, force: true });
    } catch {
      // best-effort temp cleanup; the OS reaps tmp on teardown
    }
  }
}
