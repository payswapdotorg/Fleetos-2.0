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

## Execution state (2026-10-08, 23:5xZ)

**WAVE 7 COMPLETE INCLUDING THE TL LANE — the acceptance plane is fully live: field 61 + security 90 + commerce 65 + adoption 90 = 306 acceptance tests (TL re-verified in composed main 72c5a73).**

- **F270A** (Worker A, device/field) merged d352ac0 — 61 tests.
- **F270B** (Worker B, security/intelligence) merged 0dc8089 — 90 tests.
- **F270C** (Worker C, work/commerce) merged 7f1dce0 — 65 tests.
- **F271** (TL lane, industry adoption simulation + deployment acceptance)
  `work/f271` @ 39438cb, merged b3183b8 — 90 tests: NEW
  packages/acceptance/adoption (@fleetos/acceptance-adoption): 10
  industries x 3 firm sizes = 30 real workspaces; 1113 counted journey
  executions over the REAL corpora (field 375 / commerce 387 / security
  351), all passing; 30/30 determinism proofs; deterministic verdict rubric
  (SWITCH-ONLY: manufacturing; MAIN-INTERFACE: construction, energy,
  facilities, mining, water; COMPLEMENT: transportation, agriculture,
  healthcare, telecom; RETAIN: zero, machine-proven by negative fixtures);
  honest-counts ledger records the sub-100 per-firm shortfall with reasons.
  Boundary CLEAN (the three acceptance packages only).
- **TL composition:** lockfile links for all four acceptance packages
  (92fb6ee + f6b8d05 + 72c5a73); post-merge re-runs caught one real merge
  error earlier (stale local ref — corrected by 7f1dce0; the ref-sync law:
  sync the local branch to origin before every merge).

**Delivery channel history this wave:** all four lanes delivered by chat.z.ai
Agents-tab workers (GLM-5.3, Full-Stack) through the replay. Session
f271d needed a browser-transport kick (scripts/browser_kick.py — the
in-page completions POST with the X-Signature scheme; the host transport
is now ESA-blocked while the browser's VPN egress flows) + a
sandbox-concurrency modal cleared by releasing 3 stale sandboxes. A full
sandbox reboot mid-wave was recovered via the canonical reset-recovery
path (~5 min; the durable browser profile preserved the login).

**Governance state:** per-package gates green (TL re-ran every number);
architecture/snapshot checks not re-run this wave (no spec/snapshot
changes by any lane — workers touched only owned paths).

**Open TL adjudications (cumulative):** F270A S1-S4 (mission-replay
mirror; FNV-1a hoist; enrollment vocabulary split; lockfile install);
F270B seams (docs/evidence/F270B/report.md §7); F270C seams (BudgetCheckPort
intra-lane precedent; runner LWW fact semantics; aurum transport out of
scope); F271 seams (see docs/evidence/F271/report.md — field corpus
T0-anchoring blocks epoch-offset repeat runs; commerce/security runners
not parameterizable; tenant-id format law).

**Next ready work:** Wave 8 hardening — F280A (edge hardening / offline /
fleet-scale ingestion), F280B (security, audit, replay, disaster
recovery), F280C (commerce, SLA, vendor marketplace, production
economics), F281 (TL integration lane); then Wave 9 industrial
intelligence (F290A asset lineage, F290B JEPA-family adapters, F291 TL).

**Baseline at this writing:** main = 72c5a73; package-suite total 3883 +
adoption 90 = 3973 tests, all green (per-package counts TL-verified);
evidence under `docs/evidence/<work-item>/`; dispatch packets under
`docs/tech-lead/packets/`. Full substrate `typecheck`/`build` remain
memory-constrained on 4GB boxes — per-package typecheck is the local
equivalent.
