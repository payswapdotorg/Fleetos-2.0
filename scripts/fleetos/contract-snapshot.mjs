#!/usr/bin/env node
// contract-snapshot.mjs — F201: executable contract snapshot for FleetOS packages.
//
// Usage:
//   node scripts/fleetos/contract-snapshot.mjs            -> write spec/snapshots/fleetos-contracts.json
//   node scripts/fleetos/contract-snapshot.mjs --check    -> compare against the snapshot, exit 1 on drift
//
// Walks every @fleetos/* package registered in architecture-policy.yaml,
// extracts the exported symbol surface (via the TypeScript compiler API),
// and records it with the current git HEAD. The --check mode is the gate:
// an accepted lane's contract additions are intentional (snapshot updated
// in the same commit); silent drift fails the build.
import { promises as fs, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import ts from "typescript";
import { parse as parseYaml } from "yaml";

const cwd = process.cwd();
const MODE = process.argv.includes("--check") ? "check" : "write";
const SNAPSHOT = path.join(cwd, "spec/snapshots/fleetos-contracts.json");

function gitHead() {
  try { return execSync("git rev-parse HEAD", { cwd, encoding: "utf8" }).trim(); }
  catch { return null; }
}

async function listSourceFiles(root) {
  const out = [];
  async function walk(dir) {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (["node_modules", "dist", "coverage"].includes(entry.name)) continue;
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(target);
      else if (/\.(ts|tsx|mts|cts)$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(target);
    }
  }
  await walk(root);
  return out.sort();
}

function exportedSymbols(files) {
  const symbols = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    for (const statement of sf.statements) {
      const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
      const exported = (modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      if (!exported) continue;
      let name = null;
      if (statement.name && ts.isIdentifier(statement.name)) name = statement.name.text;
      else if (ts.isVariableStatement(statement)) {
        for (const decl of statement.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) symbols.push(`${decl.name.text}:variable`);
        }
        continue;
      } else if (statement.expression && ts.isIdentifier(statement.expression)) {
        name = statement.expression.text;
      }
      if (name) {
        const kind = ts.isInterfaceDeclaration(statement) ? "interface"
          : ts.isTypeAliasDeclaration(statement) ? "type"
          : ts.isClassDeclaration(statement) ? "class"
          : ts.isEnumDeclaration(statement) ? "enum"
          : ts.isFunctionDeclaration(statement) ? "function"
          : "other";
        symbols.push(`${name}:${kind}`);
      }
    }
  }
  return [...new Set(symbols)].sort();
}

async function main() {
  const policy = parseYaml(await fs.readFile(path.join(cwd, "architecture-policy.yaml"), "utf8"));
  const fleetosModules = (policy.modules ?? []).filter((m) => String(m.id).startsWith("fleetos-"));
  const packages = {};
  for (const module of fleetosModules) {
    const root = path.join(cwd, module.roots[0]);
    const files = await listSourceFiles(root);
    packages[module.id] = {
      owner: module.owner ?? null,
      files: files.map((f) => path.relative(cwd, f)),
      exports: exportedSymbols(files),
    };
  }
  const snapshot = { version: 1, head: gitHead(), generatedAt: new Date().toISOString(), packages };
  const json = JSON.stringify(snapshot, null, 2) + "\n";

  if (MODE === "write") {
    await fs.mkdir(path.dirname(SNAPSHOT), { recursive: true });
    await fs.writeFile(SNAPSHOT, json);
    let total = 0;
    for (const id of Object.keys(packages)) total += packages[id].exports.length;
    console.log(`contract snapshot written: ${Object.keys(packages).length} packages, ${total} exported symbols`);
    return;
  }
  let existing;
  try { existing = JSON.parse(await fs.readFile(SNAPSHOT, "utf8")); } catch {
    console.error("contract snapshot MISSING — run: pnpm fleetos:snapshot");
    process.exit(1);
  }
  // Compare STRUCTURE ONLY: head/generatedAt are metadata that legitimately
  // move between the write and any later check.
  const structure = (snap) => JSON.stringify({ version: snap.version, packages: snap.packages });
  if (structure(existing) !== structure(snapshot)) {
    console.error("contract snapshot DRIFT — exported surfaces changed without a snapshot update");
    console.error("intentional change: run `pnpm fleetos:snapshot` and commit it with your lane");
    process.exit(1);
  }
  console.log(`contract snapshot unchanged (${Object.keys(packages).length} packages)`);
}

main().catch((error) => { console.error(error); process.exit(1); });
