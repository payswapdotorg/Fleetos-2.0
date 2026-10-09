/**
 * FleetOS shell standalone build (F301) — `vite.fleetos.config.ts`.
 *
 * Builds ONLY the FleetOS console entry (fleetos.html): the ZCode app's
 * 8k-module graph is NOT part of this build (the shared full build OOMs the
 * 4GB box). The FleetOS shell has no ZCode boot, no OAuth, no server
 * dependency — it composes the REAL FleetOS domain packages in-browser.
 *
 * `node:crypto` is aliased to the verified pure-TS sha256 shim
 * (src/fleetos/crypto-shim.ts — byte-identical to Node's sha256, test
 * vectors checked) because the domain packages hash synchronously.
 *
 * Build:  npx vite build --config vite.fleetos.config.ts
 * Serve:   any static file server over dist-fleetos/ (hash routing — no
 *          server-side routes needed).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");

function headCommit(): string {
  try {
    const head = readFileSync(resolve(REPO_ROOT, ".git", "HEAD"), "utf-8").trim();
    if (head.startsWith("ref: ")) {
      const ref = head.slice(5);
      try {
        return readFileSync(resolve(REPO_ROOT, ".git", ref), "utf-8").trim();
      } catch {
        return head;
      }
    }
    return head;
  } catch {
    return "unknown";
  }
}

export default defineConfig(() => {
  const commit = process.env.FLEETOS_COMMIT || headCommit();
  return {
    plugins: [react()],
    resolve: {
      alias: {
        "node:crypto": resolve(HERE, "src/fleetos/crypto-shim.ts"),
      },
    },
    define: {
      __FLEETOS_COMMIT__: JSON.stringify(commit),
      __FLEETOS_BUILT_AT__: JSON.stringify(new Date().toISOString()),
    },
    build: {
      outDir: "dist-fleetos",
      sourcemap: false,
      rollupOptions: {
        input: resolve(HERE, "fleetos.html"),
      },
    },
  };
});
