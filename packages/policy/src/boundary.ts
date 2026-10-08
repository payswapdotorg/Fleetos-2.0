/**
 * @fleetos/policy — Boundary scanner.
 *
 * Pure helper `assertNoForbiddenImports(sourceText)` + a vitest-wired scanner
 * that walks Worker-B-owned package sources and asserts ZERO imports of:
 *   - @zcode/* (substrate — Wave 0 forbids any FleetOS dependency on it)
 *   - @fleetos/<not-in-this-lane> (cross-worker implementation imports)
 *   - apps/* (UI/runtime internals — domain may not depend on them)
 *
 * The scanner is exported as a function so tests can invoke it on the real
 * tree. The test file `tests/boundary.test.ts` walks the real source tree.
 */

export interface BoundaryViolation {
  readonly source: string;
  readonly specifier: string;
  readonly rule: "forbidden-zcode" | "forbidden-cross-worker" | "forbidden-apps";
  readonly reason: string;
}

/** Lane-allowed @fleetos/* packages (worker-b owned). */
export const LANE_ALLOWED_FLEETOS_PACKAGES: readonly string[] = [
  "@fleetos/policy",
  "@fleetos/security",
  "@fleetos/actions",
  "@fleetos/execution",
  "@fleetos/evidence",
  "@fleetos/predictive",
  "@fleetos/world-model",
  "@fleetos/world-context",
  "@fleetos/learning",
  "@fleetos/simulation",
  "@fleetos/arena",
];

/** Regex for any @zcode/* import. */
const ZCODE_RE = /(^|\/)@zcode\//;
/** Regex for any apps/* import. */
const APPS_RE = /^apps\//;
/** Regex capturing the package specifier from an import/export statement. */
const IMPORT_SPEC_RE =
  /(?:^|\n)\s*(?:import|export)[^'"]*?['"]([^'"]+)['"]/g;

/** Pull every module specifier out of a TS/JS source string. */
export function extractSpecifiers(sourceText: string): readonly string[] {
  const out: string[] = [];
  let match: RegExpExecArray | null;
  IMPORT_SPEC_RE.lastIndex = 0;
  while ((match = IMPORT_SPEC_RE.exec(sourceText)) !== null) {
    if (match[1] !== undefined) out.push(match[1]);
  }
  return out;
}

/**
 * Pure check — given a source file's text, return any forbidden imports.
 *
 * Allowed:
 *   - relative imports ("./", "../")
 *   - node: built-ins ("node:crypto", "node:fs", etc.)
 *   - bare specifiers in LANE_ALLOWED_FLEETOS_PACKAGES
 *
 * Forbidden:
 *   - @zcode/*
 *   - @fleetos/* not in LANE_ALLOWED_FLEETOS_PACKAGES
 *   - apps/*
 */
export function assertNoForbiddenImports(
  sourceText: string,
  sourcePath = "<unknown>",
): readonly BoundaryViolation[] {
  const specs = extractSpecifiers(sourceText);
  const violations: BoundaryViolation[] = [];
  for (const spec of specs) {
    if (ZCODE_RE.test(spec)) {
      violations.push({
        source: sourcePath,
        specifier: spec,
        rule: "forbidden-zcode",
        reason: "Wave 0 forbids any @fleetos/* package from importing @zcode/* substrate",
      });
      continue;
    }
    if (APPS_RE.test(spec)) {
      violations.push({
        source: sourcePath,
        specifier: spec,
        rule: "forbidden-apps",
        reason: "Domain packages must not depend on apps/* UI/runtime internals",
      });
      continue;
    }
    if (spec.startsWith("@fleetos/")) {
      // Allow subpath imports like "@fleetos/policy/capability" — check the
      // package root (the segment(s) up to the first "/" after @fleetos/).
      // For "@fleetos/arena", the package root has TWO segments.
      const allowed = LANE_ALLOWED_FLEETOS_PACKAGES.some((pkg) => spec === pkg || spec.startsWith(`${pkg}/`));
      if (!allowed) {
        violations.push({
          source: sourcePath,
          specifier: spec,
          rule: "forbidden-cross-worker",
          reason: `Cross-worker implementation import forbidden in Wave 0: ${spec}`,
        });
      }
    }
  }
  return violations;
}

/** Curried scanner over a map of { relativePath -> sourceText }. */
export function scanSources(
  sources: ReadonlyMap<string, string>,
): readonly BoundaryViolation[] {
  const all: BoundaryViolation[] = [];
  for (const [path, text] of sources) {
    all.push(...assertNoForbiddenImports(text, path));
  }
  return all;
}
