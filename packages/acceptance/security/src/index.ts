/**
 * @fleetos/acceptance-security — machine-run security/action/intelligence
 * acceptance journeys (Wave 7 lane B, F270B).
 *
 * Public surface:
 *   - `./journey-contracts` — the journey contract (fixed 7-persona +
 *     13-capability vocabularies, typed steps, declarative read-model
 *     assertions, JourneyOutcome with per-assertion actual-vs-expected,
 *     digest + verify);
 *   - `./journeys` — the 13-journey corpus driving the REAL public entry
 *     points of this lane's packages;
 *   - `./runner` — the deterministic journey runner;
 *   - `./report` — acceptance report assembly (coverage matrix persona x
 *     capability, honest zero-inflation, digest + verify).
 *
 * Determinism laws: no Date.now(), no Math.random(), no network, no timers.
 * Logical `now` is caller-supplied everywhere. Tenant fail-closed (A8) is
 * asserted inside journeys, not assumed.
 */

export * from "./journey-contracts.ts";
export * from "./journeys/index.ts";
export * from "./runner.ts";
export * from "./report.ts";
