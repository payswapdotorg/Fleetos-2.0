import { defineConfig } from "vitest/config";

// The release integration + release-gate tests each build a FULL adoption
// report over the REAL corpora (module-scope runAdoptionSimulation), and
// the F370C commerce journeys inside that simulation boot the REAL
// marketplace deployment service as child processes (real PostgreSQL via
// pglite). Two concurrent full simulations exhaust sockets/memory and
// crash the service children (ErrnoError 51 observed live at the F370
// re-pin) — the adoption-package precedent applies here identically:
// file parallelism OFF, timeouts raised to 900s.
export default defineConfig({
  test: {
    fileParallelism: false,
    testTimeout: 900_000,
    hookTimeout: 900_000,
  },
});
