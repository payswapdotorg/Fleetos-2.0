#!/usr/bin/env node
/**
 * scripts/build-fleetos-resources.mjs (F375) — stage `resources/fleetos/`:
 * the bundled FleetOS world the packaged app boots the durable service
 * from. It is the service's OWN resolution contract, reproduced as data:
 *
 *   resources/fleetos/
 *     infrastructure/fleetos-durable/   the service's own sources, verbatim
 *     packages/<name>/src/...          every @fleetos/* domain package src
 *     packages/web/dist-fleetos/       the built shell (from build:shell)
 *
 * service.ts resolves REPO_ROOT two levels up from its own file and serves
 * `<root>/packages/web/dist-fleetos`; hooks.mjs resolves `@fleetos/*` under
 * `<root>/packages/...` (with its RENAMES). Copying the canonical repo
 * layout verbatim into that root keeps BOTH laws true unmodified — this is
 * composition by data placement, never a rewrite of the service.
 *
 * The icon is regenerated deterministically (make-icon.mjs) for
 * electron-builder. Nothing here is committed (all gitignored build output).
 */

import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP = path.resolve(HERE, "..");
const REPO_ROOT = path.resolve(DESKTOP, "..", "..");
const STAGE = path.join(DESKTOP, "resources", "fleetos");
const DURABLE = path.join(REPO_ROOT, "infrastructure", "fleetos-durable");
const SHELL_STAGE = path.join(DESKTOP, "resources", "shell");

function fail(message) {
  console.error(`[f375:resources] FAIL: ${message}`);
  process.exit(1);
}

function packageName(dir) {
  const pkgJson = path.join(dir, "package.json");
  if (!existsSync(pkgJson)) return null;
  try {
    const parsed = JSON.parse(readFileSync(pkgJson, "utf-8"));
    return typeof parsed.name === "string" ? parsed.name : null;
  } catch {
    return null;
  }
}

// 1. The service's own sources — every .ts/.mjs in infrastructure/fleetos-durable.
if (!existsSync(path.join(DURABLE, "service.ts")))
  fail("infrastructure/fleetos-durable/service.ts not found");
const durableOut = path.join(STAGE, "infrastructure", "fleetos-durable");
rmSync(STAGE, { recursive: true, force: true });
mkdirSync(durableOut, { recursive: true });
let serviceFiles = 0;
for (const entry of readdirSync(DURABLE, { withFileTypes: true })) {
  if (!entry.isFile() || !/\.(ts|mjs)$/.test(entry.name)) continue;
  cpSync(path.join(DURABLE, entry.name), path.join(durableOut, entry.name));
  serviceFiles += 1;
}
console.log(`[f375:resources] staged the durable service (${serviceFiles} files)`);

// 2. Every @fleetos/* workspace package's src tree, at its canonical path —
//    the exact roots hooks.mjs probes (packages/<dir>, packages/experiences/<dir>,
//    packages/integrations/<dir>, plus its RENAMES map, which these
//    canonical paths already satisfy).
const packageRoots = ["packages", "packages/experiences", "packages/integrations"];
let packages = 0;
for (const root of packageRoots) {
  for (const entry of readdirSync(path.join(REPO_ROOT, root), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(REPO_ROOT, root, entry.name);
    const name = packageName(dir);
    if (name === null || !name.startsWith("@fleetos/")) continue;
    const src = path.join(dir, "src");
    if (!existsSync(src)) continue;
    cpSync(src, path.join(STAGE, root, entry.name, "src"), { recursive: true });
    packages += 1;
  }
}
console.log(`[f375:resources] staged ${packages} @fleetos package source trees`);

// 3. The built shell — packages/web/dist-fleetos is the service's own
//    SHELL_DIR. Staged first by build:shell into resources/shell.
if (!existsSync(path.join(SHELL_STAGE, "fleetos.html"))) {
  fail("resources/shell/fleetos.html missing — run `pnpm run build:shell` first");
}
mkdirSync(path.join(STAGE, "packages", "web"), { recursive: true });
cpSync(SHELL_STAGE, path.join(STAGE, "packages", "web", "dist-fleetos"), { recursive: true });
console.log("[f375:resources] staged the built shell at packages/web/dist-fleetos");

// 4. A stamped manifest of what was staged (build provenance for the report).
const head = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: REPO_ROOT,
  encoding: "utf-8",
}).trim();
writeFileSync(
  path.join(STAGE, "FLEETOS-DESKTOP-CONTENTS.txt"),
  [
    "FleetOS Desktop bundled world — staged by packages/desktop/scripts/build-fleetos-resources.mjs",
    `repo commit: ${head}`,
    `durable service files: ${serviceFiles}`,
    `@fleetos package src trees: ${packages}`,
    "shell: packages/web/dist-fleetos (the F301 standalone build, __FLEETOS_COMMIT__ stamped)",
    "The bundled world is the F351A fixture-labelled demo composition — never live-pilot evidence.",
    "",
  ].join("\n"),
);
console.log(`[f375:resources] staged (commit ${head})`);
