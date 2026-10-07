/**
 * @fleetos/convergence — vitest configuration.
 *
 * The seam-gap bridges (tsconfig `paths` + vitest `resolve.alias` for
 * `@fleetos/model-gateway` and `@fleetos/agent-organizations`) were removed
 * by the TL at merge time after those two packages gained their additive
 * `exports` maps — package-root imports now resolve through the standard
 * workspace entry points.
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
