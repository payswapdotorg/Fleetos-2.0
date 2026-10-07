/**
 * @fleetos/experience-asset-field — vitest configuration.
 *
 * Tests import the modules under `src/` relatively; cross-package imports
 * resolve through the standard workspace entry points (every consumed
 * @fleetos package ships an `exports` map pointing at its public entry).
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
