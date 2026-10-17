/**
 * packages/desktop/watchdog/service-watchdog.mjs (F375) — the parent-death
 * watchdog for the composed durable service child.
 *
 * WHY THIS EXISTS (a machine-proven Electron fact, not a guess): Electron's
 * Linux main process does NOT deliver SIGTERM to Node-level handlers
 * (Chromium terminates the process directly — exit code 0, no JS teardown,
 * no 'will-quit'). The product app therefore cannot itself reap the durable
 * service child when it is SIGTERMed. This watchdog is a plain Node process
 * (the same Electron binary under ELECTRON_RUN_AS_NODE, which IS plain Node)
 * that:
 *
 *   1. spawns the service — the VERBATIM argv the supervisor uses;
 *   2. polls its parent (the app) every 250ms — when the parent is gone
 *      (SIGTERM, SIGKILL, crash — any death), it runs the service's OWN
 *      shutdown path: SIGTERM, then the supervisor's 3s SIGKILL
 *      escalation, then exits. ZERO orphan processes, port released;
 *   3. forwards its own SIGTERM/SIGINT the same way (the graceful path the
 *      app's teardown uses when it CAN run);
 *   4. exits with the service's exit code (a boot failure — e.g. the
 *      :3106 port conflict — reaches the app's honest-error path).
 *
 * Usage: <node> service-watchdog.mjs <runtime.mjs> <service.ts>
 * (cwd: the service's own directory; FLEETOS_DURABLE_DATA: the caller's).
 */

import { spawn } from "node:child_process";

const WATCHDOG_POLL_MS = 250;
const SIGKILL_AFTER_MS = 3000;
const [runtime, entry] = process.argv.slice(2);
if (runtime === undefined || entry === undefined) {
  console.error("[fleetos-watchdog] usage: service-watchdog.mjs <runtime.mjs> <service.ts>");
  process.exit(2);
}

const parent = process.ppid;
const service = spawn(
  process.execPath,
  ["--experimental-transform-types", "--no-warnings", "--import", runtime, entry],
  { stdio: "inherit" },
);

let stopping = false;
async function stopService(signal) {
  if (stopping) return;
  stopping = true;
  clearInterval(poll);
  if (service.exitCode !== null) return;
  service.kill(signal);
  await new Promise((resolve) => {
    const kill = setTimeout(() => {
      try {
        service.kill("SIGKILL");
      } catch {
        /* already gone */
      }
      resolve();
    }, SIGKILL_AFTER_MS);
    service.once("exit", () => {
      clearTimeout(kill);
      resolve();
    });
  });
}

// The parent-death poll: reap the service whenever the app is gone.
const poll = setInterval(() => {
  try {
    process.kill(parent, 0);
  } catch {
    stopService("SIGTERM").finally(() => process.exit(0));
  }
}, WATCHDOG_POLL_MS);

process.on("SIGTERM", () => {
  stopService("SIGTERM").finally(() => process.exit(0));
});
process.on("SIGINT", () => {
  stopService("SIGINT").finally(() => process.exit(0));
});

service.on("exit", (code) => {
  clearInterval(poll);
  process.exit(code === null ? 1 : code);
});
