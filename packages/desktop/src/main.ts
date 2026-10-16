/**
 * packages/desktop/src/main.ts — the FleetOS Desktop main process (F375).
 *
 * THE COMPOSITION LAW (the packet): this main process NEVER reimplements the
 * durable deployment service's laws. It BOOTS the existing service
 * (`infrastructure/fleetos-durable`) as its own child process, using the
 * service's own runtime form verbatim — the exact argv its supervisor uses:
 *
 *   <node> --experimental-transform-types --no-warnings \
 *          --import <...>/runtime.mjs <...>/service.ts
 *
 * with the service's resolve hooks (hooks.mjs) resolving the REAL
 * `@fleetos/*` domain packages from the bundled source tree. The service
 * serves the shell (static.ts, hash routing + SPA fallback) AND the durable
 * API on the shell's frozen durable-mode port 127.0.0.1:3106; the product
 * window loads `/?mode=durable` from that origin, so the shell's
 * relative-path fetches hit the service that owns them — the F351A
 * composition, packaged, not rewritten.
 *
 * Lifecycle laws (the packet):
 *  - single-instance lock (a second launch exits; the first is focused);
 *  - port-conflict honesty: if :3106 cannot be bound (the service child
 *    exits before its listening line), show the honest error and exit
 *    nonzero — NEVER silently pick another port (the frozen-port law);
 *  - clean shutdown: SIGTERM/SIGINT/window-closed run the service's OWN
 *    shutdown path (child SIGTERM, the supervisor's own 3s SIGKILL
 *    escalation), then exit 0 — zero orphan processes, port released.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import * as path from "node:path";
import { app, BrowserWindow, dialog } from "electron";

const SERVICE_PORT = 3106;
const SHELL_URL = `http://127.0.0.1:${SERVICE_PORT}/?mode=durable`;
const WINDOW_TITLE = "FleetOS";
/** The service prints this FIXED line once its server listens (service.ts). */
const SERVICE_READY_LINE = "[fleetos-durable] listening on :3106";
/** The supervisor's own shutdown escalation numbers (supervisor.mjs). */
const SIGKILL_AFTER_MS = 3000;
/** Guard for a service child that neither listens nor exits in time. */
const BOOT_TIMEOUT_MS = 20000;

/** The bundled FleetOS tree (the service + the @fleetos packages + the
 *  shell) — `resources/fleetos` inside the packaged app; the repo itself
 *  in dev (its layout IS the service's own resolution contract: hooks.mjs
 *  and service.ts both walk `<root>/packages/...`). */
function fleetosRoot(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "fleetos");
  }
  // Dev: out/main.js → packages/desktop → packages → the repo root (whose
  // layout IS the service's own resolution contract).
  return path.resolve(import.meta.dirname, "..", "..", "..");
}

function serviceDir(root: string): string {
  return path.join(root, "infrastructure", "fleetos-durable");
}

/** The parent-death watchdog (watchdog/service-watchdog.mjs): machine-proven
 *  Electron fact — a SIGTERMed Linux Electron main exits 0 WITHOUT running
 *  JS teardown, so the app cannot itself reap the service child. The
 *  watchdog (plain Node under ELECTRON_RUN_AS_NODE) spawns the service and
 *  reaps it whenever the app is gone; the service's own shutdown path
 *  (SIGTERM → the supervisor's 3s SIGKILL escalation) runs either way. */
function watchdogPath(): string {
  return path.join(app.getAppPath(), "watchdog", "service-watchdog.mjs");
}

interface ServiceBoot {
  readonly child: ChildProcess;
}

/** Boot the durable deployment service — its own entry, its own argv form
 *  (carried verbatim by the watchdog), its own cwd contract — and resolve
 *  only once it prints its listening line. Any exit before that is the
 *  honest port-conflict/failure path. */
function bootService(root: string): Promise<ServiceBoot> {
  const dir = serviceDir(root);
  const entry = path.join(dir, "service.ts");
  const runtime = path.join(dir, "runtime.mjs");
  const watchdog = watchdogPath();
  if (!existsSync(entry) || !existsSync(runtime) || !existsSync(watchdog)) {
    return Promise.reject(new Error(`durable service not found at ${dir} (watchdog: ${watchdog})`));
  }
  const child = spawn(process.execPath, [watchdog, runtime, entry], {
    cwd: dir,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      FLEETOS_DURABLE_DATA: path.join(app.getPath("userData"), "durable-data"),
    },
  });
  const ready = new Promise<ServiceBoot>((resolve, reject) => {
    let settled = false;
    let stdout = "";
    const fail = (message: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(message));
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      fail(`the durable service did not listen on :${SERVICE_PORT} within ${BOOT_TIMEOUT_MS}ms`);
    }, BOOT_TIMEOUT_MS);
    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      stdout += text;
      process.stdout.write(`[fleetos-durable] ${text}`);
      if (stdout.includes(SERVICE_READY_LINE)) {
        settled = true;
        clearTimeout(timer);
        resolve({ child });
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      process.stderr.write(`[fleetos-durable] ${chunk.toString("utf-8")}`);
    });
    child.on("error", (error) => {
      fail(`spawning the durable service failed: ${String(error)}`);
    });
    child.on("exit", (code, signal) => {
      fail(
        `the durable service exited before listening on :${SERVICE_PORT} ` +
          `(code=${String(code)} signal=${String(signal)}) — the port is held by ` +
          `another process, or the service could not start`,
      );
    });
  });
  return ready;
}

/** The service's own shutdown path, through the watchdog: SIGTERM, wait
 *  for its exit, escalate to SIGKILL after the supervisor's own window.
 *  Idempotent. (When the app itself was SIGTERMed — no JS teardown runs,
 *  the Electron law — the watchdog's parent-death poll performs exactly
 *  this same sequence on its own.) */
async function stopService(state: ServiceBoot | null): Promise<void> {
  if (state === null) return;
  const child = state.child;
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const kill = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    }, SIGKILL_AFTER_MS);
    child.on("exit", () => {
      clearTimeout(kill);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

let mainWindow: BrowserWindow | null = null;

function createWindow(iconPath: string): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    title: WINDOW_TITLE,
    icon: iconPath,
    autoHideMenuBar: true,
    backgroundColor: "#0b0f14",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // The product name is the window title — a FIXED fact, not the page's
  // document title (the shell's <title> carries the console descriptor).
  mainWindow.on("page-title-updated", (event) => {
    event.preventDefault();
  });
  void mainWindow.loadURL(SHELL_URL);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

let service: ServiceBoot | null = null;
let quitting = false;

/** One shutdown path for every exit trigger: the window down, then the
 *  service down (its own SIGTERM path), then exit 0. Idempotent. */
async function shutdown(): Promise<void> {
  if (quitting) return;
  quitting = true;
  if (mainWindow !== null && !mainWindow.isDestroyed()) {
    // Destroying the window closes the renderer's keep-alive sockets so the
    // service's own server.close() completes promptly.
    mainWindow.destroy();
    mainWindow = null;
  }
  await stopService(service);
  service = null;
}

app.whenReady().then(() => {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    // A second FleetOS instance never opens a window nor binds anything.
    app.exit(0);
    return;
  }
  app.on("second-instance", () => {
    if (mainWindow !== null) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  const iconPath = path.join(app.getAppPath(), "branding", "icon.png");
  bootService(fleetosRoot())
    .then((booted) => {
      service = booted;
      createWindow(iconPath);
    })
    .catch(async (error: unknown) => {
      const detail =
        `The FleetOS durable deployment service could not listen on 127.0.0.1:${SERVICE_PORT}.\n\n` +
        `${error instanceof Error ? error.message : String(error)}\n\n` +
        "FleetOS never silently picks another port. Free the port (or close the other " +
        "FleetOS/durable service holding it) and start FleetOS again.";
      console.error(`[fleetos-desktop] ${detail}`);
      await dialog
        .showMessageBox({
          type: "error",
          title: "FleetOS could not start",
          message: "FleetOS could not start",
          detail,
        })
        .catch(() => undefined);
      app.exit(1);
    });
});

app.on("window-all-closed", () => {
  void shutdown().finally(() => app.exit(0));
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    void shutdown().finally(() => app.exit(0));
  });
}
