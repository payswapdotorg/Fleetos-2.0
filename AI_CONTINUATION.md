# FleetOS 2.0 — Agent/TL Continuation Pointer

This file is a compact repository navigation pointer, not a second source of truth. The repository is canonical; do not rely on conversation history.

## Read in this order
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
- `docs/tech-lead/RESIDUAL-RISKS.md`

## Execution state (2026-10-10 — Wave 12 handoff recorded)

**Current disposition: NOT READY.** Last tested Wave-11 source candidate: `8c97ac8a08faa735dae1bbb3c638dfba44ec9470`. Latest Wave-11 documentation closeout: `1cc99703aaa706dedc5ad8c6f06ac3c642d6d33d`. Inspect current `main` before dispatch and bind any new gate evidence to the exact tested SHA.

- **B-1 CLOSED**: full root typecheck captured with exit 0 on the 16 GB builder.
- **B-2 CLOSED**: full monorepo build passed, 75/75 packages, lifecycle scripts on.
- **B-3 OPEN**: 1,848 counted executions; 30 workspaces; fully applicable cap 68/100; shortfall 32 per fully applicable firm. Retain 100; no duplicate-run counting or unjustified mask broadening.
- Wave-11 green baseline at candidate `8c97ac8`: 4,872 monorepo tests; field 69, security 103, commerce 81, adoption 95, release 88, convergence 82. Re-run affected and final gates after Wave-12 changes.
- **Aurum, ADCOS and Arena are not provider-ready.** Keep them CONTRACT_ONLY; no live/sandbox claim from local adapter or contract tests. Wave 12 deliberately continues using genuine, local domain behavior and defers provider binding.
- Current shell evidence is sandbox-hosted/static with fixture-composed state, not a demonstrated public production deployment or durable operational persistence. Predictive output remains a deterministic structural reference unless validated trained-model evidence is added.
- **Wave 12 sequence:** F320 (TL-owned meaningful time-parameterization/count-law decision) → F321A/B/C concurrently → F322 TL convergence/recount/full gates. F323 Aurum/ADCOS/Arena readiness and end-to-end binding is DEFERRED until upstream readiness criteria are met.

**Canonical handoff:** `docs/tech-lead/FINAL-RELEASE-HANDOFF.md`.
