/**
 * @fleetos/experience-engineering-lab — vitest configuration.
 *
 * All composed packages resolve through the standard workspace entry
 * points (exports maps); no aliases, no bridges.
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
