import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * LOCAL bridge (the F231 precedent): six Wave-1 lane-C domain packages
 * (work/projects/workloads/procurement/vendors/software) have no
 * package.json entry points, so package-root imports cannot resolve under
 * nodenext. Aliases point the package names at their REAL public entry
 * sources. The TL adds the additive exports maps at merge and deletes this
 * bridge — see docs/evidence/F240C/report.md §6.
 */
const laneRoot = fileURLToPath(new URL("../../", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: "@fleetos/work", replacement: `${laneRoot}work/src/index.ts` },
      { find: "@fleetos/projects", replacement: `${laneRoot}projects/src/index.ts` },
      { find: "@fleetos/workloads", replacement: `${laneRoot}workloads/src/index.ts` },
      { find: "@fleetos/procurement", replacement: `${laneRoot}procurement/src/index.ts` },
      { find: "@fleetos/vendors", replacement: `${laneRoot}vendors/src/index.ts` },
      { find: "@fleetos/software", replacement: `${laneRoot}software/src/index.ts` },
      { find: "@fleetos/agent-organizations", replacement: `${laneRoot}agent-organizations/src/index.ts` },
      { find: "@fleetos/model-gateway", replacement: `${laneRoot}model-gateway/src/index.ts` },
    ],
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
