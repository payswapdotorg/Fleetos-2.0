/**
 * @fleetos/integration-health — vitest configuration.
 *
 * SEAM-GAP BRIDGES (the @fleetos/convergence precedent): four of the seven
 * Wave-5 lane packages are not resolvable as bare specifiers yet —
 * `@fleetos/aurum`, `@fleetos/apify` and `@fleetos/external-vendors` carry no
 * `exports`/`main` in their package.json, and `@fleetos/integrations/arena`
 * has a two-slash package name that Node-ESM (and therefore tsc `nodenext`
 * and vite) cannot resolve as a package specifier. The source still imports
 * the REAL public package names; these aliases map them to their public
 * entry files only inside THIS package. The TL removes them at merge time
 * once the lanes gain their additive `exports` maps (exactly as was done for
 * `@fleetos/model-gateway` / `@fleetos/agent-organizations` in convergence).
 */

import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@fleetos/aurum": resolve(__dirname, "../aurum/src/index.ts"),
      "@fleetos/apify": resolve(__dirname, "../apify/src/index.ts"),
      "@fleetos/external-vendors": resolve(__dirname, "../vendors/src/index.ts"),
      "@fleetos/integrations/arena": resolve(__dirname, "../arena/src/index.ts"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
