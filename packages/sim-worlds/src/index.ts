/**
 * @fleetos/sim-worlds — deterministic fleet-operational simulation worlds.
 *
 * Public entry: re-exports every deliverable subpath.
 *
 * Laws (AGENTS.md A5/A11 extended):
 *  - simulation NEVER self-executes and NEVER adopts — outputs are
 *    EXPERIMENTAL EVIDENCE ONLY (the kernel's `ExperimentalRunOutput`
 *    kind tag is machine-carried);
 *  - pure deterministic TS: no Date.now, no Math.random, no timers,
 *    no network, no new runtime deps — logical `now` + caller-supplied
 *    inputs everywhere; the entropy source is the seeded counter-mode
 *    FNV-1a generator in `determinism.ts`;
 *  - tenant fail-closed at every entry point.
 */

export * from "./determinism.js";
export * from "./world-definition.js";
export * from "./fault-injection.js";
export * from "./world-engine.js";
export * from "./simulation-adapter.js";
