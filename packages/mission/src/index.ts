/**
 * @fleetos/mission — public entry.
 *
 * The durable mission runtime of the Control Plane's mission half
 * (ARCHITECTURE-LOCK §2, law A10): missions whose state survives any
 * process lifetime — event-sourced journals with chained digests, a pure
 * fold as the state function, checkpointed suspend/resume that never
 * re-executes completed stages, work-order issuance through the
 * CommandSubmitPort TYPE seam, and outbox publication through the
 * kernel's OutboxPort TYPE with an in-memory reference adapter.
 *
 * Pure deterministic TypeScript. `@fleetos/kernel` is consumed through
 * TYPE imports only. No runtime imports from @fleetos/control-plane or
 * any worker-lane package.
 */

// ---- contracts + reference implementations ----
export * from "./result.js";
export * from "./digest.js";
export * from "./ids.js";
export * from "./definition.js";
export * from "./journal.js";
export * from "./outbox.js";
export * from "./runtime.js";
