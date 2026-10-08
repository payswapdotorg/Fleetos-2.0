/**
 * @fleetos/integration-health — vitest configuration.
 *
 * All seven Wave-5 lane packages resolve via their package.json exports maps
 * (TL composition after F251 merge — the convergence precedent). No alias
 * bridges remain.
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
