# FleetOS 2.0 — Agent/TL Continuation Pointer

This file exists only as a compact repository navigation pointer.

It is intentionally not a second source of truth.

Read the canonical files instead:

- `FLEETOS-SOURCE-OF-TRUTH.md`
- `AGENTS.md`
- `spec/ARCHITECTURE-LOCK.md`
- `spec/BOUNDED-CONTEXTS.md`
- `spec/DEPENDENCY-GRAPH.md`
- `spec/worker-ownership.yaml`
- `spec/work-items/WORK-ITEM-CATALOG.md`
- `docs/tech-lead/FINAL-HANDOFF.md`
- `docs/tech-lead/CONCURRENCY-PROTOCOL.md`

Never treat this file as authoritative if it conflicts with those files.

## Execution state (2026-10-09, 12:5xZ)

**ROADMAP COMPLETE (Waves 0–9, all 40 work items): main = b6413f6; 4742 package-suite tests, all green.**

- Wave 9 final state: **F290A** merged 84dd77c (assets 207/207; 108 net-new; lineage graph + tamper-evident chains + observation anchoring), **F290B** merged aee6e30 (world-model 147/147 + predictive 74/74; 105 net-new; JEPA family with composed widening law), **F290C** merged f5a1653 (agent-organizations 236/236 + model-gateway 107/107; 63 net-new; 18 industry archetypes + fit scoring + optimization policies + benchmark with pinned improvement proofs), **F291** merged b6413f6 (acceptance/convergence 82/82; per-industry convergence scenarios + intelligence rollups + boolean gate with named blockers).
- Acceptance plane: field 61 / security 90 / commerce 65 / adoption 90 / release 88 / convergence 82 — all machine-run at the exact merge commits, exact counts, zero regressions across every merge.
- Closeout docs committed at completion: ADRs 0002–0006, RUNBOOK, PRODUCT-ACCEPTANCE-REPORT (final ledger + counts), RESIDUAL-RISKS. Evidence: docs/evidence/<work-item>/ (40 reports).

**Replay (per-deployment, generic per payswapdotorg/replay2 §0):** the console is the replay2 repo's own app on :3000 (CONSOLE_LAUNCHER=launch_dev.py), supervisor/watcher/custodian ring kept alive as detached children of the durable next-server spawner (POST /api/replay, token tl-local — the exec-kill law: anything spawned from a shell dies at command end); replayd :3100, Chrome CDP :9222 on the durable profile (z.ai login). Worker dispatch ONLY via replay2's scripts/dispatch_worker.py (agents tab + GLM-5.3 + Full-Stack, hard-verified sends). Cure set: stop-API zombie cure + fresh-tab continuation (proven again 2026-10-09 on f290c3: 2h zombie healed in place, delivered 50 min later); WIP/recovery doctrine per AGENT_BOOT_PROMPT.md. Delivery watchers: scripts/local/f29*_watch.py via flags/local_services.json (supervisor-kept).

**Baseline at this writing:** main = b6413f6; 4742 package-suite tests green. This file is a pointer — the canonical record is the evidence tree + the closeout docs.
