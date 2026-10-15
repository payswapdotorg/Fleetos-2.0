import { defineConfig } from "vitest/config";

// The F370C journeys drive the REAL marketplace deployment service as
// child processes (real PostgreSQL via pglite boots ~3s per spawn; the
// census + determinism batteries re-run the full corpus many times), so
// the suite's per-test timeout is raised accordingly. Fast journeys are
// unaffected (a timeout is an upper bound, never a delay).
export default defineConfig({
  test: {
    testTimeout: 900_000,
    hookTimeout: 900_000,
  },
});
