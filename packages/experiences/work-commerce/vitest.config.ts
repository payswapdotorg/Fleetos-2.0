/**
 * @fleetos/experience-work-commerce — vitest configuration.
 *
 * The seam-gap bridge (resolve.alias for the six Wave-1 lane-C domain
 * packages) was removed by the TL at merge time after those packages
 * gained their additive `exports` maps — package-root imports now resolve
 * through the standard workspace entry points.
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
