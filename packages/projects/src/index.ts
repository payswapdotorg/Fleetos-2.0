/**
 * @fleetos/projects — Projects bounded context public contracts + kernel.
 *
 * Wave 1 lane C (F210C). Pure TypeScript domain package.
 *
 * Laws: A1, A4, A8, A19, A20.
 *
 * Wave 1 kernel-grade additions over Wave 0 (F200C):
 *   - milestone gating made REAL with honest blocking-item reports;
 *   - project lifecycle transitions with audit events;
 *   - portfolio read models (tenant-scoped);
 *   - ProjectDirectory over ProjectRepositoryPort + in-memory reference.
 *
 * Cross-worker seam rule: TenantScope, MissionRefLike, WorkflowRefLike,
 * GuardianDecisionRefLike, EvidenceRefLike, WorkItemStatusRefLike are
 * LOCAL structural types. Sibling-lane concepts are referenced via these
 * shapes, never imported at runtime.
 */

export * from "./contracts.js";
export * from "./audit.js";
export * from "./directory.js";
export * from "./in-memory.js";
