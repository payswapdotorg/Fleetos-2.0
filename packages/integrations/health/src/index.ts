/**
 * @fleetos/integration-health — public entry barrel (F251, Wave 5 TL lane).
 *
 * The integration-plane composition package over the seven Wave-5 adapter
 * lanes (`@fleetos/adcos`, `@fleetos/connectivity`,
 * `@fleetos/arena`, `@fleetos/learning`, `@fleetos/aurum`,
 * `@fleetos/apify`, `@fleetos/external-vendors`):
 *
 *   - `health-assembly` — the tenant-scoped integration-plane health view
 *     (per-adapter sections over the lanes' REAL outputs, fixed severity
 *     ladder, ONE chained FNV-1a digest, fail-closed tenancy);
 *   - `retry-law` — the unified deterministic backoff-ladder law, the
 *     transient/permanent classification vocabulary, per-adapter retry-budget
 *     ledgers, and the `proveRetryLawConsistency` machine proof;
 *   - `idempotency-law` — the shared idempotency law (at-least-once delivery
 *     → exactly-once applied effect) binding the REAL lane dedup seams, with
 *     the `proveIdempotencyLaw` machine proof across all adapters;
 *   - `convergence` — the per-tenant convergence verdict over the adcos +
 *     aurum reconciliation surfaces, with a pure-proposal repair queue and
 *     the structural projections-never-feed-back law.
 *
 * READ-ONLY composition: no command emission, no state mutation, no
 * Guardian bypass. Pure deterministic TypeScript throughout.
 */

export * from "./health-core.js";
export * from "./health-sections.js";
export * from "./health-assembly.js";
export * from "./retry-law.js";
export * from "./idempotency-law.js";
export * from "./convergence.js";
