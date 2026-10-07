/**
 * @fleetos/work — Work bounded context public contracts + application
 * kernel (Wave 1 lane C, F210C).
 *
 * Pure TypeScript domain package: types + pure functions + a
 * structural repository port + an in-memory reference adapter. No I/O
 * except through the port. No servers, no databases, no network, no
 * providers in the kernel itself.
 *
 * Laws satisfied here (see spec/ARCHITECTURE-LOCK.md):
 *   A1  — one source of business truth (the in-memory store is NOT
 *         authoritative; the composing application attaches PostgreSQL
 *         at F211).
 *   A4  — consequential action protocol; every consequential operation
 *         is explicit with machine-stable reason codes; illegal
 *         transitions refused, never silently coerced.
 *   A6  — agent trust boundary (no agent can write work truth here).
 *   A8  — tenant isolation; TenantScope is fail-closed; cross-tenant
 *         reads/writes fail closed.
 *   A10 — durable missions; work items reference missions via the
 *         MissionRefLike seam and emit typed progress events a mission
 *         runtime can subscribe to.
 *   A12 — deterministic reference path; no clock, no random, no I/O in
 *         the kernel functions themselves.
 *   A19 — audit; every consequential operation emits an AuditEvent
 *         contract with a stable digest.
 *   A20 — no cross-boundary implementation imports.
 *
 * Cross-worker seam rule: this lane never imports @fleetos/* packages
 * owned by worker A or B. Sibling-lane concepts are referenced through
 * LOCAL structural interfaces (TenantScopeLike, GuardianDecisionRefLike,
 * EvidenceRefLike, MissionRefLike, WorkflowRefLike) plus structural-
 * compatibility tests in tests/.
 *
 * Wave 1 kernel-grade additions over Wave 0 (F200C):
 *   - assignment lifecycle with SUPERSESSION discipline (reassignTo);
 *   - deadline contracts with deterministic escalation surface;
 *   - WorkItemDirectory over WorkRepositoryPort + in-memory reference;
 *   - MissionRefLike + WorkflowRefLike seams (frozen for F211 composition);
 *   - typed ProgressEvents for mission-runtime subscription;
 *   - AuditEvent contract on every consequential operation;
 *   - assignmentIntegrityHolds predicate (machine-checked invariant).
 */

export * from "./tenant.js";
export * from "./contracts.js";
export * from "./lifecycle.js";
export * from "./deadline.js";
export * from "./progress.js";
export * from "./audit.js";
export * from "./directory.js";
export * from "./in-memory.js";
