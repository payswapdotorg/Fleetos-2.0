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

## Execution state (2026-10-07, 14:20Z)

**WAVE 0 COMPLETE** — all four lanes accepted + merged:

- F200A (Worker A, Edge + Asset): `work/f200a` @ c6e4bf4, merged `--no-ff`
  cdecf80. 10 packages + apps/agent + evidence. TL gates at the exact
  commit: 184 tests passing, typecheck clean, boundary clean.
- F200B (Worker B, Safety + Intelligence): `work/f200b` @ bbaa8f1, merged
  `--no-ff` dbf56b0. 11 packages + evidence. TL gates: 148 tests passing,
  typecheck clean, boundary clean (the canonical Capability vocabulary +
  deterministic reference Guardian live in `packages/policy`).
- F200C (Worker C, Work + Commerce): `work/f200c` @ 9df43f9, merged
  `--no-ff` 30446fd. 11 packages + evidence. TL gates: 146 tests passing,
  typecheck clean, boundary clean.
- F201 (TL, architecture-governance harness): policy `version: 1` fix
  (the inherited checker/policy mismatch — architecture:check now runs),
  32 fleetos modules registered (transitional unmanaged; adoption to
  managed follows the module.ts/contract.ts convention in later waves),
  pnpm workspace globs extended (`packages/integrations/*`, `apps/agent`),
  root `test` aggregation + `fleetos:snapshot[:check]` contract snapshot
  + `fleetos:verify` chain.

**WAVE 1 COMPLETE** — all four lanes accepted + merged (main @ d87a3cc,
1116 tests): F210A @ 0b86974 merged 84b8cf9 (466 lane tests, kernel-grade
state machines); F210B @ 196b6c9 merged 905be41 (354 lane tests, Guardian/
Capability/Action/Evidence kernel); F210C @ 2dbffa6 merged d87a3cc (296
lane tests, Work/Project application kernel). Zero cross-worker imports;
snapshot-pinned shapes.

**WAVE 2 / WAVE 3 IN FLIGHT** — F220A @ 6ada3dd merged 3ec83cb (722 lane
tests: staged observation ingestion + event-sourced twin fold); F211 (TL
grant, transactional kernel) @ 0bda4a5 merged 8e92c36 — UnitOfWork +
TransactionalSession + OutboxPort, dual-write-gap impossibility, 76 kernel
tests; **F230A @ 24f9dbd merged 279f176** (Wave 3 lane A, FleetOS Edge
Agent: enrollment handshake, trust ladder, telemetry queue, evidence
bundles, command inbox lifecycle, reconciliation diff, posture machine,
ADCOS edge adapter, kernel diagnostics — 587 lane tests / 249 net-new;
merged-main expected suite ~1697). In flight at time of writing: F220B
(safety composition), F220C (commerce spine), F221 (TL grant: control-
plane command bus + durable mission runtime, dispatched to Worker A).
Snapshot: 33 packages / 1382 exported symbols.

**Baseline at this writing**: merged main 279f176; branch suites verified
at exact commits on clean worktrees (never trust reported numbers);
`architecture:check` 0 violations; lint 70w/0e; `fleetos:source-of-truth`
PASS. Full substrate `typecheck`/`build` are memory-constrained on 4GB
boxes while other stacks run — run them in quiet windows or CI;
per-package typecheck is the local equivalent.

**Next ready work**: F230B (Predictive Twin + World Model — Worker B),
F230C (Agent Organization + Model Gateway — Worker C) dispatch when their
workers free; F231 (intelligence convergence — TL grant) after Wave 3
lanes; Wave 4 experience lanes scaffold next. Evidence lives under
`docs/evidence/<work-item>/`.
