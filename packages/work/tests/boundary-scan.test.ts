/**
 * Lane-C boundary scan test (machine-checked acceptance clause).
 *
 * Law A20 / dependency graph rule: a domain context may NOT depend on the
 * ZCode runtime substrate, and may NOT import sibling-lane FleetOS package
 * implementations. This file scans every source file owned by worker C
 * (per spec/worker-ownership.yaml) and asserts:
 *
 *   1. ZERO imports of any `@zcode/*` specifier (ZCode runtime substrate).
 *   2. ZERO imports of any `@fleetos/*` specifier EXCEPT the small allowlist
 *      of packages that live inside this lane (worker-c ownership).
 *
 * The allowlist is intentionally narrow: it lists ONLY the 11 packages this
 * lane owns. If a future cross-lane dependency becomes necessary it MUST be
 * surfaced as a contract delta for TL adjudication, never silently introduced
 * by importing another worker's package.
 *
 * This test makes the "no business truth in ZCode runtime packages"
 * acceptance clause of F200C machine-checked.
 */
import { describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..", "..");
const LANE_ROOTS = [
  "packages/work",
  "packages/projects",
  "packages/workloads",
  "packages/procurement",
  "packages/vendors",
  "packages/software",
  "packages/agent-organizations",
  "packages/model-gateway",
  "packages/integrations/aurum",
  "packages/integrations/apify",
  "packages/integrations/vendors",
] as const;

// The ONLY @fleetos/* packages this lane may import from. Wave 0 kept this
// empty: each worker-c package was a self-contained bounded-context
// skeleton. F260C (TL packet, Wave 6 lane C) explicitly authorizes
// `@fleetos/agent-organizations` to build on the REAL model-gateway
// implementations (usage-ledger excerpt verification + registry/routing/
// fallback-ladder reuse through the PUBLIC entry point). This allowlist
// entry is that authorization made machine-checked — it is the ONLY
// intra-lane runtime dependency and is surfaced as a contract delta for
// TL adjudication in docs/evidence/F260C/report.md. Every other lane
// package remains self-contained.
const FLEETOS_ALLOWLIST: readonly string[] = ["@fleetos/model-gateway"];

const FORBIDDEN_PREFIXES = ["@zcode/"];

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"] as const;

async function walk(root: string, files: string[] = []): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") continue;
    const target = join(root, entry.name);
    if (entry.isDirectory()) await walk(target, files);
    else if (SOURCE_EXTENSIONS.some((ext) => target.endsWith(ext))) files.push(target);
  }
  return files;
}

async function collectImports(filePath: string): Promise<string[]> {
  const source = await readFile(filePath, "utf8");
  const matches = source.matchAll(
    /(?:import|export)\s+(?:[\s\S]*?)\s+from\s+["']([^"']+)["']/g,
  );
  const out: string[] = [];
  for (const m of matches) {
    const spec = m[1];
    if (typeof spec === "string") out.push(spec);
  }
  return out;
}

describe("lane C boundary scan", () => {
  it("has zero @zcode/* imports across all worker-c package sources", async () => {
    const violations: string[] = [];
    for (const laneRoot of LANE_ROOTS) {
      const absRoot = join(REPO_ROOT, laneRoot);
      const files = await walk(absRoot);
      for (const file of files) {
        const imports = await collectImports(file);
        for (const specifier of imports) {
          if (FORBIDDEN_PREFIXES.some((p) => specifier.startsWith(p))) {
            violations.push(`${relative(REPO_ROOT, file)} -> ${specifier}`);
          }
        }
      }
    }
    expect(violations, `forbidden @zcode/* imports:\n${violations.join("\n")}`).toEqual([]);
  });

  it("has zero @fleetos/* imports outside the lane allowlist", async () => {
    const violations: string[] = [];
    for (const laneRoot of LANE_ROOTS) {
      const absRoot = join(REPO_ROOT, laneRoot);
      const files = await walk(absRoot);
      for (const file of files) {
        const imports = await collectImports(file);
        for (const specifier of imports) {
          if (!specifier.startsWith("@fleetos/")) continue;
          if (FLEETOS_ALLOWLIST.includes(specifier)) continue;
          violations.push(`${relative(REPO_ROOT, file)} -> ${specifier}`);
        }
      }
    }
    expect(
      violations,
      `forbidden cross-lane @fleetos/* imports:\n${violations.join("\n")}`,
    ).toEqual([]);
  });

  it("declares the expected 11 lane packages with @fleetos/ scoping", async () => {
    const expected = [
      "@fleetos/work",
      "@fleetos/projects",
      "@fleetos/workloads",
      "@fleetos/procurement",
      "@fleetos/vendors",
      "@fleetos/software",
      "@fleetos/agent-organizations",
      "@fleetos/model-gateway",
      "@fleetos/aurum",
      "@fleetos/apify",
      "@fleetos/external-vendors",
    ];
    const declared: string[] = [];
    for (const laneRoot of LANE_ROOTS) {
      const pkgPath = join(REPO_ROOT, laneRoot, "package.json");
      const raw = await readFile(pkgPath, "utf8").catch(() => null);
      if (raw === null) continue;
      const manifest = JSON.parse(raw) as { name?: string };
      if (typeof manifest.name === "string") declared.push(manifest.name);
    }
    expect(declared.sort()).toEqual(expected.sort());
  });

  it("scopes the model-gateway seam to agent-organizations only", async () => {
    // F260C authorization narrowed to a machine check: ONLY
    // packages/agent-organizations may import @fleetos/model-gateway.
    const violators: string[] = [];
    for (const laneRoot of LANE_ROOTS) {
      if (laneRoot === "packages/agent-organizations") continue;
      const files = await walk(join(REPO_ROOT, laneRoot));
      for (const file of files) {
        const imports = await collectImports(file);
        if (imports.includes("@fleetos/model-gateway")) {
          violators.push(relative(REPO_ROOT, file));
        }
      }
    }
    expect(violators, `model-gateway imports outside agent-organizations:\n${violators.join("\n")}`).toEqual([]);
  });
});
