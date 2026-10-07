/**
 * @fleetos/convergence — vitest configuration.
 *
 * SEAM-GAP BRIDGE (documented in docs/evidence/F231 §6): the Wave 1
 * packages `@fleetos/model-gateway` and `@fleetos/agent-organizations`
 * have no `exports` map in their package.json (no `main`/`types` either),
 * so node-style resolution cannot find their public entry. The SOURCE
 * imports in this package use the package-ROOT specifiers only (never
 * deep paths); this config aliases those two specifiers to the packages'
 * actual public entry sources for the TEST runtime, mirroring the tsconfig
 * `paths` bridge used for typechecking. When the TL adds `exports` maps to
 * those two packages at merge time (the same additive 2-line change every
 * other composed package already has), both bridges become redundant and
 * can be deleted without touching any import.
 */

import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@fleetos/model-gateway": fileURLToPath(
        new URL("./node_modules/@fleetos/model-gateway/src/index.ts", import.meta.url),
      ),
      "@fleetos/agent-organizations": fileURLToPath(
        new URL("./node_modules/@fleetos/agent-organizations/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
