/**
 * @fleetos/agent-organizations — industry-specific machinery (F290C, Wave 9
 * lane C). Additive only: archetypes, fit scoring, per-industry
 * optimization policies + the org optimization benchmark. Every export feeds
 * the EXISTING kernel seams (prepareOptimizationInputs / allocateRoles /
 * optimizeRouting / rebalanceBudgets); nothing forks the machinery.
 */
export * from "./archetypes.js";
export * from "./fit.js";
export * from "./optimization.js";
export * from "./benchmark.js";
