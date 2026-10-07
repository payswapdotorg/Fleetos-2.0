/**
 * @fleetos/procurement — Procurement bounded context public contracts + kernel.
 *
 * Wave 1 lane C (F210C) kernel-grade.
 *
 * Law A16 — Exchange semantics. Laws A1, A4, A5 (no self-authorization),
 * A7, A8, A12, A16, A19, A20.
 *
 * Cross-worker seam rule: TenantScope, GuardianDecisionRefLike,
 * EvidenceRefLike, VendorCapabilityRefLike are LOCAL structural types.
 */

export * from "./contracts.js";
export * from "./matching.js";
export * from "./lifecycle.js";
export * from "./directory.js";
export * from "./in-memory.js";
export * from "./flow.js";
export * from "./commerce-math.js";
