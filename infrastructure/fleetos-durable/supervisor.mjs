/**
 * infrastructure/fleetos-durable/supervisor.mjs — the supervisor-keep loop
 * (F351A, Q1: "restart-survival is a property of the deployment, not a
 * one-off demo").
 *
 * Runs the durable service on :3106 and restarts it whenever it exits —
 * including a SIGKILL — after a short backoff. Forwards the service's
 * stdout/stderr (prefix `svc`). SIGTERM/SIGINT shut the supervisor (and the
 * service) down cleanly.
 *
 * Usage:  node infrastructure/fleetos-durable/supervisor.mjs
 * (run it under nohup/setsid or a process manager of your choice; logs to
 *  stdout/stderr — redirect to a file for a persistent record.)
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVICE = path.join(HERE, "service.ts");
const RUNTIME = path.join(HERE, "runtime.mjs");
const RESTART_BACKOFF_MS = 1000;

let shuttingDown = false;
let generation = 0;
let child = null;

function log(message) {
  console.log(`[supervisor ${new Date().toISOString()}] ${message}`);
}

function startService() {
  generation += 1;
  const proc = spawn(
    process.execPath,
    ["--experimental-transform-types", "--no-warnings", "--import", RUNTIME, SERVICE],
    { stdio: ["ignore", "inherit", "inherit"], cwd: HERE },
  );
  child = proc;
  log(`started service generation ${generation} (pid ${proc.pid}) on :3106`);
  proc.on("exit", (code, signal) => {
    if (shuttingDown) {
      log(`service generation ${generation} exited during shutdown (code=${code} signal=${signal})`);
      return;
    }
    log(`service generation ${generation} EXITED (code=${code} signal=${signal}) — restarting in ${RESTART_BACKOFF_MS}ms`);
    setTimeout(startService, RESTART_BACKOFF_MS);
  });
}

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`${signal} received — stopping supervisor`);
  if (child !== null && child.exitCode === null) {
    child.kill("SIGTERM");
    const pid = child.pid;
    setTimeout(() => {
      try {
        if (pid !== undefined) process.kill(pid, "SIGKILL");
      } catch {
        /* already gone */
      }
    }, 3000);
  }
  setTimeout(() => process.exit(0), 3200);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

startService();
