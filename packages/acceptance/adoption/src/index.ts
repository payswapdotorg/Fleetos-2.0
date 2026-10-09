/**
 * @fleetos/acceptance-adoption — public entry.
 *
 * Wave 7 TL lane (F271): the full industry adoption simulation + deployment
 * acceptance layer. TEN industries, 30 firm workspaces, deterministic
 * SWITCH-ONLY / MAIN-INTERFACE / COMPLEMENT / RETAIN verdicts computed from
 * the REAL outcomes of the three acceptance corpora
 * (`@fleetos/acceptance-field`, `@fleetos/acceptance-security`,
 * `@fleetos/acceptance-commerce`) plus the incumbent capability baselines.
 *
 * Subpath exports: `./industries` (the ten industry definitions), `./run`
 * (the deterministic adoption driver), `./report` (report assembly). This
 * barrel additionally exposes the firm population, the incumbent baselines,
 * the verdict rubric, and the local digest convention.
 *
 * Pure deterministic TS: no clock, no randomness, no network, no timers.
 */

export const ACCEPTANCE_ADOPTION_SCHEMA_VERSION = 1;

export * from "./industries.js";
export * from "./firms.js";
export * from "./incumbent.js";
export * from "./verdicts.js";
export * from "./adoption-run.js";
export * from "./report.js";
export * from "./digest.js";
export * from "./convergence-delta.js";
