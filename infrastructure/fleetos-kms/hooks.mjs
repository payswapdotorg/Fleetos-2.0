/**
 * infrastructure/fleetos-kms/hooks.mjs — the ESM resolve hooks (F373).
 *
 * The FleetOS workspace packages ship raw TypeScript sources (their
 * package exports point at `./src/index.ts` — the repo's convention).
 * The KMS service runs on plain `node` (node:http builtins only — the
 * F351A service law), so it needs the same two resolution shims as the
 * durable and marketplace services (the F351A/F370C precedent):
 *
 *  1. `@fleetos/*` bare specifiers -> the workspace package source dirs;
 *  2. relative `.js` specifiers that have no `.js` file -> the sibling
 *     `.ts` (the domain sources use the `./x.js`-in-TS convention).
 *
 * Node's `--experimental-transform-types` (on the service command line)
 * handles the TypeScript itself. Nothing here transforms code.
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const REPO_ROOT = new URL("../..", import.meta.url).pathname;

/** Package name -> source directory (repo-relative) where the directory
 *  name is not simply `packages/<name>`. */
const RENAMES = new Map([
  ["@fleetos/experience-asset-field", "packages/experiences/asset-field"],
  ["@fleetos/experience-safety-intel", "packages/experiences/safety-intel"],
  ["@fleetos/experience-work-commerce", "packages/experiences/work-commerce"],
  ["@fleetos/experience-engineering-lab", "packages/experiences/engineering-lab"],
  ["@fleetos/control-tower", "packages/experiences/control-tower"],
  ["@fleetos/integration-health", "packages/integrations/health"],
  ["@fleetos/external-vendors", "packages/integrations/vendors"],
]);

function toFileUrl(p) {
  return new URL(`file://${p}`).href;
}

/** Resolve `@fleetos/<name>[/sub]` to a source file URL, or null. */
function resolveFleetos(specifier) {
  const rest = specifier.slice("@fleetos/".length);
  const slash = rest.indexOf("/");
  const pkg = slash === -1 ? specifier : `@fleetos/${rest.slice(0, slash)}`;
  const sub = slash === -1 ? null : rest.slice(slash + 1);
  const short = pkg.slice("@fleetos/".length);
  const renamed = RENAMES.get(pkg);
  const roots =
    renamed === undefined
      ? [`${REPO_ROOT}/packages/${short}`, `${REPO_ROOT}/packages/experiences/${short}`, `${REPO_ROOT}/packages/integrations/${short}`]
      : [`${REPO_ROOT}/${renamed}`];
  const targets = [];
  for (const root of roots) {
    if (sub === null) {
      for (const file of ["index.ts", "index.tsx", "index.js"]) {
        targets.push(`${root}/src/${file}`);
      }
    } else {
      targets.push(`${root}/src/${sub}.ts`, `${root}/src/${sub}.js`);
    }
  }
  for (const t of targets) {
    if (existsSync(t)) return toFileUrl(t);
  }
  return null;
}

export async function resolve(specifier, context, next) {
  if (specifier.startsWith("@fleetos/")) {
    const hit = resolveFleetos(specifier);
    if (hit !== null) return { url: hit, shortCircuit: true, format: "module-typescript" };
    try {
      return await next(specifier, context);
    } catch (error) {
      throw new Error(`[fleetos-kms/hooks] cannot resolve ${specifier} under ${REPO_ROOT}: ${error.message}`);
    }
  }
  if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    (specifier.endsWith(".js") || specifier.endsWith(".mjs"))
  ) {
    try {
      return await next(specifier, context);
    } catch (error) {
      const base = new URL(specifier, context.parentURL);
      const ts = new URL(base.href.replace(/\.m?js$/, ".ts"));
      if (existsSync(fileURLToPath(ts))) {
        return { url: ts.href, shortCircuit: true, format: "module-typescript" };
      }
      throw error;
    }
  }
  return next(specifier, context);
}
