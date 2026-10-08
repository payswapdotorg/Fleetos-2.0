/**
 * F261 lab test helpers — the composed `LabStateSlice` fixture over the
 * three lanes' REAL outputs (world run + two benchmark bundles + the
 * optimization stack). Logical `now`; fixed tenant; no clock, no
 * randomness.
 */

import type { LabStateSlice } from "../src/lab-state.js";
import { LAB_NOW, LAB_TENANT, makeWorldRun } from "./fixtures-sim.js";
import { cleanBenchmark, tightBenchmark } from "./fixtures-bench.js";
import { buildOptimizationStack } from "./fixtures-opt.js";

export { LAB_NOW, LAB_TENANT };

/** The full composed slice — every record REAL, tenant-uniform. */
export function makeLabState(tenantId: string = LAB_TENANT): LabStateSlice {
  const run = makeWorldRun(6, tenantId);
  const clean = cleanBenchmark();
  const tight = tightBenchmark();
  const opt = buildOptimizationStack();
  return {
    tenantId,
    now: LAB_NOW,
    worlds: [run.world],
    worldRuns: [{ scenario: run.scenario, output: run.output, events: run.events }],
    benchmarks: [clean, tight],
    optimizations: [
      {
        problem: opt.problem,
        roleAllocations: [opt.roleAllocation],
        budgetRebalances: [opt.budgetRebalance],
        routing: [opt.routing],
        whatIfs: [opt.whatIf],
      },
    ],
  };
}
