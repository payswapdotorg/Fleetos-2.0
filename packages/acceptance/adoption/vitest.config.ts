import { defineConfig } from "vitest/config";

// The F370C commerce journeys (driven per-firm by the adoption simulation
// since the Wave-18 convergence) boot the REAL marketplace deployment
// service as child processes — real PostgreSQL via pglite, ~3s per spawn,
// 90 lifecycle boots per full simulation. Multiple simulation-bearing
// test files MUST NOT run concurrently on one box: parallel full
// simulations exhaust sockets/memory and crash the service children
// (ErrnoError 51 observed live at the F370 re-pin) — a resource failure
// the journeys then honestly record as failing executions, breaking the
// determinism proofs. File parallelism OFF = one simulation at a time;
// the per-test timeout raised to the commerce-suite precedent (900s).
export default defineConfig({
  test: {
    fileParallelism: false,
    testTimeout: 900_000,
    hookTimeout: 900_000,
  },
});
