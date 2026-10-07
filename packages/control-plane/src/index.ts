/**
 * @fleetos/control-plane — public entry.
 *
 * The Control Plane (ARCHITECTURE-LOCK §2) sits between Experience and
 * Application Services: it owns missions, work orders, approvals,
 * automation, scheduling, assignments, handoffs, notifications and
 * SLA/deadline coordination. This package ships the command bus half:
 * the tenant-scoped command queue with idempotency, deterministic retry
 * and dead-lettering; the hash-chained execution ledger; the SLA
 * deadline tracker with its severity ladder; assignment + handoff
 * records; and the reference transport modeling ack/timeout paths.
 *
 * Pure deterministic TypeScript. `@fleetos/kernel` is consumed through
 * TYPE imports only (TenantContext and friends); every function takes
 * `now` as an explicit input. No imports from any worker-lane package.
 */

// ---- contracts + reference implementations ----
export * from "./result.js";
export * from "./digest.js";
export * from "./ids.js";
export * from "./retry.js";
export * from "./queue.js";
export * from "./ledger.js";
export * from "./sla.js";
export * from "./assignment.js";
export * from "./transport.js";
