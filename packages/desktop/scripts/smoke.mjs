#!/usr/bin/env node
/**
 * scripts/smoke.mjs (F375) — THE SMOKE: the honest gate over the PACKAGED
 * artifact (never the dev tree).
 *
 *   a headless Xvfb display + the .deb's extracted binary (dpkg-deb -x) —
 *   (the packet names xvfb-run; this box's xvfb-run cannot run because the
 *   xauth binary is not installed and there is no root to add it, so the
 *   harness spawns the SAME Xvfb server xvfb-run would: the fixed screen
 *   geometry, -nolisten tcp, -ac — recorded as an environment fact):
 *     1. the window opens, native title "FleetOS" (read over the X11
 *        protocol — WM_NAME, the BrowserWindow title, not document.title);
 *     2. all SIX shell routes render (hash routing, fixed nav labels +
 *        per-route fixed facts — the F301 fixture composition);
 *     3. a durable command round-trips through the UI: submit → ENQUEUED
 *        ack (cmd_0000000001, duplicate=false — the per-tenant monotonic
 *        counter on a fresh data dir) → the queue record + the audit entry
 *        visible, the durable panel reporting service :3106;
 *     4. SIGTERM → exit 0, ZERO orphan processes (pgrep proof over the
 *        extraction path — Electron children and the durable service
 *        alike), port :3106 released (connection refused);
 *     5. restart with the same HOME → replay-on-start (1 command, 1 audit
 *        entry, 0 enrollments — the F351A law in the packaged form).
 *
 * Determinism culture: every assertion is a FIXED fact (labels, headings,
 * the ack shape, the replay counts). No wall-clock, no random ports in
 * assertions. The CDP port (9222) and the mktemp dir are harness plumbing
 * — recorded, never asserted as product behavior.
 */

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { x11Titles } from "./x11.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP = path.resolve(HERE, "..");
const REPO_ROOT = path.resolve(DESKTOP, "..", "..");
const DEB = process.argv[2] ?? path.join(DESKTOP, "release", "fleetos_2.0.0_amd64.deb");
/** The app's CDP port for this harness. 9333, NOT 9222: a fixed-port
 *  assumption on 9222 poisons any environment that already runs a
 *  CDP-browser on 9222 (the TL station's replay Chrome holds it — the
 *  gate run connected to the WRONG browser and never saw the app page).
 *  9333 is free on the operator desktop, the worker sandbox, and the
 *  station alike. */
const CDP_PORT = 9333;
const HEAD = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: REPO_ROOT,
  encoding: "utf-8",
}).trim();
/** The harness's own headless X displays, probed in this FIXED order (the
 *  box's xvfb-run cannot run — xauth is not installed — so the harness
 *  spawns the same Xvfb server xvfb-run would: -screen 0 1600x1000x24, no
 *  listening tcp, -ac access control off because no xauth exists here). */
const DISPLAY_CANDIDATES = [":99", ":98", ":97", ":96", ":95"];

const NAV = [
  {
    id: "tower",
    label: "Control Tower",
    blurb: "Cross-lane cockpit — fleet, findings, work, attention queue",
    fact: "Fleet (Lane A)",
  },
  {
    id: "field",
    label: "Device 360 / Field",
    blurb: "Assets, devices, observations, health timeline",
    fact: "Assets (real directory)",
  },
  {
    id: "safety",
    label: "Safety & Intelligence",
    blurb: "Findings, evidence, Guardian decisions, advisories",
    fact: "Security findings — posture",
  },
  {
    id: "commerce",
    label: "Work & Commerce",
    blurb: "Work board, procurement, budgets",
    fact: "Work board — tnt_acme-logistics",
  },
  {
    id: "lab",
    label: "Engineering Lab",
    blurb: "Simulation worlds, benchmarks, experiments",
    fact: "Engineering Lab — deterministic simulation run (experimental evidence only)",
  },
  {
    id: "commands",
    label: "Command Console",
    blurb: "Typed command path — submit, adjudicate, verify",
    fact: "Typed command path — tnt_acme-logistics / act_ada-operator",
  },
];

let failures = 0;
function check(name, ok, detail = "") {
  console.log(
    `${ok ? "[SMOKE] PASS" : "[SMOKE] FAIL"} ${name}${detail === "" ? "" : ` — ${detail}`}`,
  );
  if (!ok) failures += 1;
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function textOf(page, selector) {
  // (page, selector) — the helper's original single-locator signature was
  // never exercised (every caller passes page + selector; the F1 block hid
  // this file's whole execution path).
  return (await page.locator(selector).first().innerText({ timeout: 10000 })).trim();
}

/** Launch the packaged app on a fresh headless X display; resolves
 *  { xvfb, app, display, log } — the app is a DIRECT child so its exit
 *  code is observed without indirection. */
async function launchApp(extractDir, home) {
  const binary = path.join(extractDir, "opt", "FleetOS", "fleetos");
  const display = DISPLAY_CANDIDATES.find(
    (d) => !existsSync(`/tmp/.X11-unix/X${d.slice(1)}`) && !existsSync(`/tmp/.X${d.slice(1)}-lock`),
  );
  if (display === undefined) throw new Error("no free X display among the fixed candidates");
  const xvfb = spawn("Xvfb", [display, "-screen", "0", "1600x1000x24", "-nolisten", "tcp", "-ac"], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  const xvfbErrors = [];
  xvfb.stderr.on("data", (c) => xvfbErrors.push(String(c)));
  await waitFor(`the ${display} X socket`, 10000, () =>
    existsSync(`/tmp/.X11-unix/X${display.slice(1)}`) ? display : null,
  );
  const log = [];
  const app = spawn(
    binary,
    ["--no-sandbox", "--disable-gpu", `--remote-debugging-port=${CDP_PORT}`],
    { env: { ...process.env, HOME: home, DISPLAY: display }, stdio: ["ignore", "pipe", "pipe"] },
  );
  app.stdout.on("data", (c) => log.push(String(c)));
  app.stderr.on("data", (c) => log.push(String(c)));
  return { xvfb, app, display, log, xvfbErrors };
}

async function waitFor(what, timeoutMs, probe) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const hit = probe();
    if (hit !== null && hit !== undefined) return hit;
    if (Date.now() > deadline) throw new Error(`${what} never appeared`);
    await sleep(150);
  }
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pgrepExtract(extractDir) {
  try {
    return execFileSync("pgrep", ["-af", escapeRegExp(extractDir)], { encoding: "utf-8" }).trim();
  } catch {
    return "";
  }
}

async function cdpPage() {
  // Connect WITH RETRY: the app's CDP endpoint opens ~1-2s after process
  // spawn (Electron boot). A single connectOverCDP races it and dies on
  // ECONNREFUSED — connect until the deadline, then poll for the page.
  let browser = null;
  const connectDeadline = Date.now() + 30000;
  for (;;) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
      break;
    } catch {
      if (Date.now() > connectDeadline) {
        throw new Error("the app's CDP endpoint never appeared (is the app running?)");
      }
      await sleep(250);
    }
  }
  const deadline = Date.now() + 30000;
  for (;;) {
    const context = browser.contexts()[0];
    const page = context?.pages().find((p) => p.url().startsWith("http://127.0.0.1:3106"));
    if (page !== undefined) return { browser, page };
    if (Date.now() > deadline) throw new Error("the FleetOS shell page never appeared over CDP");
    await sleep(250);
  }
}

async function portRefused() {
  try {
    await fetch("http://127.0.0.1:3106/api/health", { signal: AbortSignal.timeout(2000) });
    return false;
  } catch {
    return true;
  }
}

/** SIGTERM the app, resolve its exit code; then stop the harness Xvfb. */
async function stopApp(launched) {
  if (launched === null) return -1;
  const { app, xvfb } = launched;
  try {
    app.kill("SIGTERM");
  } catch {
    /* already gone */
  }
  const code = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      app.kill("SIGKILL");
      resolve(-1);
    }, 25000);
    if (app.exitCode !== null) {
      clearTimeout(timer);
      resolve(app.exitCode);
      return;
    }
    app.once("exit", (c) => {
      clearTimeout(timer);
      resolve(c === null ? -1 : c);
    });
  });
  try {
    xvfb.kill("SIGTERM");
  } catch {
    /* already gone */
  }
  const xvfbDown = new Promise((resolve) => {
    const timer = setTimeout(() => {
      xvfb.kill("SIGKILL");
      resolve();
    }, 10000);
    if (xvfb.exitCode !== null) {
      clearTimeout(timer);
      resolve();
      return;
    }
    xvfb.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  await xvfbDown;
  return code;
}

async function main() {
  console.log(`[SMOKE] F375 — artifact ${DEB}`);
  console.log(`[SMOKE] lane HEAD ${HEAD}`);
  if (!existsSync(DEB)) throw new Error(`artifact missing: ${DEB}`);
  const work = mkdtempSync(path.join(os.tmpdir(), "f375-smoke-"));
  const extractDir = path.join(work, "extract");
  const home = path.join(work, "home");
  mkdirSync(extractDir);
  mkdirSync(home);
  execFileSync("dpkg-deb", ["-x", DEB, extractDir], { stdio: "inherit" });

  // Preflight: the frozen port must be FREE (another durable service holding
  // :3106 would poison every downstream assertion) + the packaged layout.
  if (!(await portRefused())) {
    throw new Error(
      "port :3106 is already held — free it (or stop the other durable service) before smoking",
    );
  }
  for (const rel of [
    "opt/FleetOS/fleetos",
    "opt/FleetOS/resources/fleetos/infrastructure/fleetos-durable/service.ts",
    "opt/FleetOS/resources/fleetos/infrastructure/fleetos-durable/runtime.mjs",
    "opt/FleetOS/resources/fleetos/packages/web/dist-fleetos/fleetos.html",
  ]) {
    check(`packaged file ${rel}`, existsSync(path.join(extractDir, rel)));
  }
  const contents = execFileSync("dpkg-deb", ["-c", DEB], { encoding: "utf-8" });
  check("deb contents: /opt/FleetOS present", contents.includes("opt/FleetOS"));
  check("deb contents: the .desktop entry", contents.includes("usr/share/applications/"));

  // ---- Run 1: the window, the six routes, the durable round-trip. ----
  let launched = null;
  try {
    launched = await launchApp(extractDir, home);
    const { page } = await cdpPage();
    await page.locator(".fos-commit").first().waitFor({ timeout: 20000 });
    console.log(
      `[SMOKE] app pid ${launched.app.pid} · display ${launched.display} · shell ${page.url()}`,
    );

    // 1. The native window title, read over X11 (WM_NAME).
    const titles = await x11Titles(launched.display);
    console.log(`[SMOKE] X11 top-level window titles: ${JSON.stringify(titles)}`);
    check('window titled "FleetOS"', titles.includes("FleetOS"));
    const docTitle = await page.title();
    check(
      "document.title is the shell's",
      docTitle === "FleetOS — Operational Truth Console",
      docTitle,
    );
    check("durable mode in the URL", page.url().endsWith("?mode=durable"));
    check(
      "footer declares the durable plane",
      (await textOf(page, ".fos-mode")).startsWith("operational plane: DURABLE — service :3106"),
    );
    const commit = (await page.locator(".fos-commit code").first().innerText()).trim();
    check(`footer commit = HEAD (${HEAD})`, commit === HEAD, commit);

    // 2. All six routes render (fixed labels + fixed per-route facts).
    const buttons = page.locator(".fos-nav-btn");
    check("six nav buttons", (await buttons.count()) === 6);
    for (let i = 0; i < NAV.length; i += 1) {
      const route = NAV[i];
      check(`nav[${i}] label "${route.label}"`, (await buttons.nth(i).innerText()) === route.label);
      await buttons.nth(i).click();
      await page.locator(".fos-blurb").first().waitFor({ timeout: 5000 });
      check(`route ${route.id} hash`, page.url().includes(`#/${route.id}`));
      check(`route ${route.id} blurb`, (await textOf(page, ".fos-blurb")) === route.blurb);
      const bodyText = await page.locator("main").first().innerText();
      check(`route ${route.id} renders its fixed fact`, bodyText.includes(route.fact), route.fact);
    }

    // 3. The durable round-trip through the UI.
    check(
      "durable badge in the command path",
      (await textOf(page, "h2 .fos-badge")) === "DURABLE · service :3106",
    );
    await page.getByRole("button", { name: "Submit asset.enroll" }).click();
    await page.locator(".fos-result").first().waitFor({ timeout: 10000 });
    const ack = await textOf(page, ".fos-result");
    check(
      "ack ENQUEUED cmd_0000000001 duplicate=false",
      ack === "ENQUEUED cmd_0000000001 (duplicate=false)",
      ack,
    );
    const queueCard = page.locator('section:has(h2:text("Queue (1 records"))');
    await queueCard.waitFor({ timeout: 10000 });
    const queueText = await queueCard.first().innerText();
    check("queue record asset.enroll — queued", queueText.includes("asset.enroll — queued"));
    const auditCard = page.locator(
      'section:has(h2:text("Submission log (audit trail, verbatim)"))',
    );
    const auditText = await auditCard.first().innerText();
    const auditLines = auditText
      .split("\n")
      .filter((l) => l.includes("asset.enroll by act_ada-operator"));
    check(
      "submission log: exactly 1 audit entry",
      auditLines.length === 1,
      `${auditLines.length} line(s)`,
    );
    check(
      "audit entry OK — enqueued for Guardian adjudication",
      auditLines.length === 1 &&
        /: OK — enqueued for Guardian adjudication/.test(auditLines[0] ?? ""),
    );
    const panel = page.locator('section:has(h2:text("Durable operational plane"))');
    const panelText = await panel.first().innerText();
    check(
      "durable panel: service :3106",
      panelText.includes("service fleetos-durable · port 3106"),
    );
    check(
      "durable panel: replay 0 on fresh data",
      /replay-on-start: 0 command\(s\), 0 audit entrie\(s\), 0 enrollment\(s\)/.test(panelText),
    );

    // 4. SIGTERM → exit 0, zero orphans, port released.
    await page.context().browser().close();
    const code = await stopApp(launched);
    check("SIGTERM → app exits 0", code === 0, `exit=${String(code)}`);
    await sleep(500);
    const orphans = pgrepExtract(extractDir);
    check(
      "ZERO orphan processes (pgrep over the extraction path)",
      orphans === "",
      orphans.split("\n")[0] ?? "",
    );
    check("port :3106 released (connection refused)", await portRefused());

    // 5. Restart with the same HOME → replay-on-start (the F351A law, packaged).
    launched = await launchApp(extractDir, home);
    const page2 = (await cdpPage()).page;
    await page2.locator(".fos-commit").first().waitFor({ timeout: 20000 });
    const health = await page2.evaluate(() => fetch("/api/health").then((r) => r.json()));
    check("restart replays 1 command", health.replay.commands === 1, JSON.stringify(health.replay));
    check("restart replays 1 audit entry", health.replay.audit === 1);
    check("restart replays 0 enrollments", health.replay.assets === 0);
    await page2.locator(".fos-nav-btn").nth(5).click();
    await page2.locator('section:has(h2:text("Queue (1 records"))').waitFor({ timeout: 10000 });
    const queue2 = await page2
      .locator('section:has(h2:text("Queue (1 records"))')
      .first()
      .innerText();
    check("restarted UI shows the replayed queue record", queue2.includes("asset.enroll — queued"));
    const code2 = await stopApp(launched);
    check("second run: SIGTERM → exits 0", code2 === 0, `exit=${String(code2)}`);
    await sleep(500);
    check("second run: ZERO orphans", pgrepExtract(extractDir) === "");
    check("second run: port released", await portRefused());
  } finally {
    await stopApp(launched).catch(() => {});
  }
  console.log(`[SMOKE] ${failures === 0 ? "ALL ASSERTIONS GREEN" : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`[SMOKE] FATAL ${error instanceof Error ? error.stack : String(error)}`);
  process.exit(2);
});
