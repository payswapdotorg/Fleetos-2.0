/**
 * @fleetos/acceptance-release — public entry.
 *
 * Wave 8 TL lane (F281): the production release gate over the REAL
 * hardened Wave-8 surfaces (F280A/B/C) and the REAL acceptance baselines
 * (field / security / commerce corpora + the F271 adoption layer):
 *
 *   - `./observability` — deterministic system-status rollups (per-lane
 *     records assembled from REAL package outputs, degraded reason codes
 *     surfaced verbatim, tenant fail-closed);
 *   - `./cost` — budget ceilings (allocation-derived or caller-declared)
 *     with over-ceiling REFUSALS, burn-rate rollups over the REAL
 *     projections, and the verbatim-by-reference cost posture view;
 *   - `./gate` — the boolean READY / NOT-READY release gate with named
 *     blockers, each naming its source record.
 *
 * This barrel additionally exposes the local digest convention.
 *
 * Pure deterministic TS: no clock, no randomness, no network, no timers.
 */

export const ACCEPTANCE_RELEASE_SCHEMA_VERSION = 1;

export * from "./observability.js";
export * from "./cost.js";
export * from "./release-gate.js";
export * from "./digest.js";
