/**
 * @fleetos/experience-engineering-lab — public entry barrel.
 *
 * The lab product shell over the Wave-6 simulation/optimization lanes:
 * READ-MODEL views only — it never executes a run, never re-scores a
 * benchmark, never applies a proposal. Every artifact it presents stays
 * EXPERIMENTAL / advisory / proposal-only (Guardian path).
 */

export * from "./lab-core.js";
export * from "./lab-state.js";
export * from "./experiment-views.js";
export * from "./benchmark-views.js";
export * from "./optimization-views.js";
export * from "./command-intents.js";
