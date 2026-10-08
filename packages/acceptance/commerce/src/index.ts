/**
 * @fleetos/acceptance-commerce — public entry.
 *
 * Wave 7 acceptance lane C: machine-run work/commerce/project journeys
 * over the REAL worker-C lane packages' public entry points. A journey is
 * DATA + assertions; the runner interprets the steps against the REAL
 * packages and a FAILING assertion fails the journey (no soft passes).
 *
 * Pure deterministic TS: no clock, no randomness, no network, no timers.
 */

export const ACCEPTANCE_COMMERCE_SCHEMA_VERSION = 1;

export * from "./journey-contracts.js";
export * from "./journey-world.js";
export * from "./runner.js";
export * from "./report.js";
