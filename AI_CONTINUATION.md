# FleetOS 2.0 — Agent/TL Continuation Pointer

This is a compact navigation/status pointer, not a second source of truth. The repository is canonical; do not rely on conversation history.

## Read first
- `FLEETOS-SOURCE-OF-TRUTH.md`
- `AGENTS.md`
- `spec/ARCHITECTURE-LOCK.md`
- `spec/BOUNDED-CONTEXTS.md`
- `spec/DEPENDENCY-GRAPH.md`
- `spec/worker-ownership.yaml`
- `spec/work-items/WORK-ITEM-CATALOG.md`
- `docs/tech-lead/FINAL-HANDOFF.md`
- `docs/tech-lead/CONCURRENCY-PROTOCOL.md`
- `docs/tech-lead/FINAL-RELEASE-HANDOFF.md`
- `docs/evidence/F302/report.md`
- `docs/evidence/F310C/report.md`
- `docs/evidence/F320/report.md`
- `docs/evidence/F321B/report.md`
- `docs/tech-lead/RESIDUAL-RISKS.md`

## Execution state — post Wave-12 F322 convergence (2026-10-11)

**Release disposition: NOT READY.** Always inspect actual main HEAD and bind new tests to the exact candidate SHA. Do not transfer old green checks automatically to new source.

### Wave-12 final state
- **F320 DONE:** Distinct-Journey Count Law D1–D6 frozen; Wave 12 NON-PARAMETERIZED (no epoch variant counts this wave).
- **F321A DELIVERED + CONVERGED:** lane tip `ffb4119`, merged `7ea9b00`; field corpus 20 → 30 (+227 assertions); slot-21 (adcos) replaced by the non-ADCOS `ingestion-limits-admission-discipline`. Evidence: `docs/evidence/F321A/report.md`; gates run `38146799222`.
- **F321B DELIVERED + CONVERGED:** merged `1d1d67f`; security corpus 17 → 27 (+431 assertions); slot-30 (arena) replaced by `posture-fold-determinism`. Evidence: `docs/evidence/F321B/report.md`.
- **F321C DELIVERED + CONVERGED:** lane tip `2408201`, merged `ceb55df`; commerce corpus 31 → 34 (+95 assertions); slot-12 (aurum) replaced by the non-Aurum `vendor-directory-service-relationship`. Evidence: `docs/evidence/F321C/report.md`; gates run `38160560665`.
- **F322 DONE — verdict NOT READY:** converged corpora field 30 / commerce 34 / security 27; counted executions 2,523; unique applicable 841; fully-applicable cap **91/100** (shortfall 9). TL mask adjudication: `actor-job-failure-expiry` masked in the five `apify-actor-job`-masking industries. Adoption/release pins re-pinned from machine values; six suites GREEN at `16e35e8` (run `38165177822`). Code-frozen candidate `5c3d18f` (run `38165903409` ALL GREEN); final candidate `e0d5f5e` (definitive run `38167030941` ALL GREEN — code + docs + shell fixture + browser evidence). Evidence: `docs/evidence/F322/report.md`.
- **B-3 OPEN at 91/100:** the target is unchanged. Next-wave capability plan: F310C §3.5 rows 34–39 (row 36 honest time-parameterization under the D2 epoch-distinctness law is the highest-leverage path; rows 34–35 worker-C new packages; rows 37–39 worker-A, connectors gated on F323).
- **F323 DEFERRED:** Aurum, ADCOS and Arena remain CONTRACT_ONLY; no live/sandbox claims from local adapters or tests. `actor-job-failure-expiry` is local contract-level lifecycle only (no Apify claim).
- Product shell still has only sandbox/static + fixture-composed evidence; public production deployment and durable operational persistence are not demonstrated. Predictive outputs remain deterministic structural references unless validated-model evidence is added.

### Next steps
1. Open the next work item for the §3.5 capability plan (TL-owned law work for row 36; scoped worker items for rows 34–35/37–39).
2. Any new journeys must follow the frozen count law: genuinely distinct, machine-run, provider-independent unless F323 unblocks; adoption ledger and release pins stay TL-owned.
3. Re-run the full gates at any new frozen candidate before verdict changes; keep the NOT READY disposition until the cap honestly reaches 100 and deployment/persistence evidence exists.

**Canonical current handoff:** `docs/tech-lead/FINAL-RELEASE-HANDOFF.md`.
