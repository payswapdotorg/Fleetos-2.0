import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertNoForbiddenImports,
  extractSpecifiers,
  LANE_ALLOWED_FLEETOS_PACKAGES,
  scanSources,
} from "../src/boundary.ts";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..");
const LANE_PACKAGE_DIRS = [
  "packages/policy",
  "packages/security",
  "packages/actions",
  "packages/execution",
  "packages/evidence",
  "packages/predictive",
  "packages/world-model",
  "packages/world-context",
  "packages/learning",
  "packages/simulation",
  "packages/integrations/arena",
];

function walkTs(root: string, out: string[] = []): string[] {
  for (const entry of readdirSync(root)) {
    if (entry === "node_modules" || entry === "dist" || entry === ".git") continue;
    const full = join(root, entry);
    const st = statSync(full);
    if (st.isDirectory()) walkTs(full, out);
    else if (st.isFile() && /\.(ts|tsx|mts|cts)$/.test(entry)) out.push(full);
  }
  return out;
}

/** Walk only the `src/` production source of a package — tests legitimately
 * contain forbidden-specifier string fixtures for the scanner unit tests. */
function walkSrcOnly(pkgRoot: string): string[] {
  const srcDir = join(pkgRoot, "src");
  let st;
  try { st = statSync(srcDir); } catch { return []; }
  if (!st.isDirectory()) return [];
  return walkTs(srcDir);
}

describe("boundary scanner: pure unit behavior", () => {
  it("extracts module specifiers from import and export statements", () => {
    const src = `
import { foo } from "./local.ts";
import "@zcode/something";
import { x } from "@fleetos/policy";
export { y } from "@fleetos/security";
export * from "node:crypto";
import { z } from "apps/web/thing";
`;
    const specs = extractSpecifiers(src);
    expect(specs).toEqual([
      "./local.ts",
      "@zcode/something",
      "@fleetos/policy",
      "@fleetos/security",
      "node:crypto",
      "apps/web/thing",
    ]);
  });

  it("flags @zcode/* imports", () => {
    const violations = assertNoForbiddenImports('import { x } from "@zcode/shared";', "x.ts");
    expect(violations).toHaveLength(1);
    expect(violations[0]?.rule).toBe("forbidden-zcode");
  });

  it("flags apps/* imports", () => {
    const violations = assertNoForbiddenImports('import { y } from "apps/web/foo";', "y.ts");
    expect(violations).toHaveLength(1);
    expect(violations[0]?.rule).toBe("forbidden-apps");
  });

  it("flags cross-worker @fleetos/* imports not in the lane allowlist", () => {
    const violations = assertNoForbiddenImports(
      'import { z } from "@fleetos/work";',
      "z.ts",
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.rule).toBe("forbidden-cross-worker");
  });

  it("allows lane-approved @fleetos/* imports", () => {
    const v1 = assertNoForbiddenImports(
      'import { x } from "@fleetos/policy";',
      "x.ts",
    );
    expect(v1).toHaveLength(0);
    const v2 = assertNoForbiddenImports(
      'import { y } from "@fleetos/evidence";',
      "y.ts",
    );
    expect(v2).toHaveLength(0);
  });

  it("allows lane-approved subpath imports like @fleetos/policy/capability", () => {
    const v1 = assertNoForbiddenImports(
      'import { x } from "@fleetos/policy/capability";',
      "x.ts",
    );
    expect(v1).toHaveLength(0);
    const v2 = assertNoForbiddenImports(
      'import { y } from "@fleetos/integrations/arena";',
      "y.ts",
    );
    expect(v2).toHaveLength(0);
  });

  it("allows relative imports and node: built-ins", () => {
    const v = assertNoForbiddenImports(
      'import { foo } from "./local.ts";\nimport { bar } from "../up.ts";\nimport { createHash } from "node:crypto";',
      "x.ts",
    );
    expect(v).toHaveLength(0);
  });

  it("scanSources aggregates violations across multiple files", () => {
    const sources = new Map<string, string>([
      ["a.ts", 'import "@zcode/shared";'],
      ["b.ts", 'import "./local";'],
      ["c.ts", 'import "@fleetos/work";'],
    ]);
    const all = scanSources(sources);
    expect(all).toHaveLength(2);
    expect(all.map((v) => v.source).sort()).toEqual(["a.ts", "c.ts"]);
  });

  it("the lane allowlist contains exactly the 11 worker-b packages", () => {
    expect(LANE_ALLOWED_FLEETOS_PACKAGES).toHaveLength(11);
    expect(LANE_ALLOWED_FLEETOS_PACKAGES).toContain("@fleetos/integrations/arena");
  });
});

describe("boundary scanner: real source tree", () => {
  it("walks every Worker-B package and finds ZERO forbidden imports", () => {
    const sources = new Map<string, string>();
    for (const dir of LANE_PACKAGE_DIRS) {
      const abs = join(REPO_ROOT, dir);
      let st;
      try { st = statSync(abs); } catch { /* directory may not exist yet */ continue; }
      if (!st.isDirectory()) continue;
      for (const file of walkSrcOnly(abs)) {
        const rel = relative(REPO_ROOT, file).split(sep).join("/");
        sources.set(rel, readFileSync(file, "utf8"));
      }
    }
    const violations = scanSources(sources);
    if (violations.length > 0) {
      console.error("BOUNDARY VIOLATIONS:", JSON.stringify(violations, null, 2));
    }
    expect(violations).toHaveLength(0);
  });
});
