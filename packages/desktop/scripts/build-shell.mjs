#!/usr/bin/env node
/**
 * scripts/build-shell.mjs (F375) — build the FleetOS shell (the F301
 * standalone build) and stage it into packages/desktop/resources/shell/.
 *
 * The build is the packages/web fleetos build the packet names:
 *   npx vite build --config vite.fleetos.config.ts   (run in packages/web)
 * FLEETOS_COMMIT is passed explicitly (the config prefers it) so the
 * footer's `__FLEETOS_COMMIT__` is the lane HEAD by construction — and the
 * script FAILS if the built output does not carry that exact commit.
 */

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP = path.resolve(HERE, "..");
const REPO_ROOT = path.resolve(DESKTOP, "..", "..");
const WEB = path.join(REPO_ROOT, "packages", "web");
const DIST = path.join(WEB, "dist-fleetos");
const STAGE = path.join(DESKTOP, "resources", "shell");

function headCommit() {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf-8" }).trim();
}

const commit = process.env.FLEETOS_COMMIT || headCommit();

console.log(`[f375:build-shell] building the FleetOS shell at commit ${commit}`);
execFileSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["vite", "build", "--config", "vite.fleetos.config.ts"],
  { cwd: WEB, env: { ...process.env, FLEETOS_COMMIT: commit }, stdio: "inherit" },
);

if (!existsSync(DIST) || !existsSync(path.join(DIST, "fleetos.html"))) {
  console.error(
    "[f375:build-shell] FAIL: packages/web/dist-fleetos/fleetos.html missing after build",
  );
  process.exit(1);
}

// The commit proof: __FLEETOS_COMMIT__ must appear in the built assets.
const assets = [];
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.endsWith(".map")) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else assets.push(p);
  }
}
walk(DIST);
const proof = assets.some((file) => readFileSync(file, "utf-8").includes(commit));
if (!proof) {
  console.error(`[f375:build-shell] FAIL: commit ${commit} not found in the built shell assets`);
  process.exit(1);
}
console.log(
  `[f375:build-shell] commit ${commit} proven in the built output (${assets.length} assets)`,
);

rmSync(STAGE, { recursive: true, force: true });
mkdirSync(path.dirname(STAGE), { recursive: true });
cpSync(DIST, STAGE, { recursive: true });
console.log(`[f375:build-shell] staged ${STAGE}`);
