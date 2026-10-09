/**
 * @fleetos/acceptance-convergence — public entry.
 *
 * Wave 9 TL lane (F291): industrial intelligence convergence over the REAL
 * Wave-9 surfaces — F290A asset lineage (material lots, versioned methods,
 * the tamper-evident chain, observation anchoring), the F290B JEPA family
 * (embedding, predictor, masked, rollout — driven through the adapters'
 * public represent/predict seam) and the F290C industry machinery
 * (archetypes, fit scoring, optimization policies, the benchmark with
 * improvement proofs, gateway capability matching):
 *
 *   - `./scenarios` — deterministic per-industry convergence scenarios
 *     (REAL archetype orgs, REAL lineage fleets, REAL JEPA forecasts,
 *     REAL acceptance-family journey applicability; artifacts carried by
 *     reference + digest);
 *   - `./intelligence` — deterministic intelligence rollups per scenario
 *     (lineage coverage from REAL graph queries, optimization posture
 *     with the benchmark delta verbatim, forecast utilization with
 *     intervals as-is, capability matching with honest refusals);
 *   - `./gate` — the boolean CONVERGED / NOT-CONVERGED verdict with named
 *     blockers, each naming its source record (NO weighted scores, NO
 *     partial convergence).
 *
 * Pure deterministic TS: no clock, no randomness, no network, no timers.
 */

export const ACCEPTANCE_CONVERGENCE_SCHEMA_VERSION = 1;

export * from "./scenarios.js";
export * from "./intelligence.js";
export * from "./convergence-gate.js";
export * from "./digest.js";
