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

## Execution state (2026-10-07)

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
  (32 packages / 500 exported symbols) + `fleetos:verify` chain.

**Baseline at Wave 0 closure**: `pnpm -r test` = 478 tests passing across
32 FleetOS packages; `architecture:check` = OK / 0 violations; lint =
70 warnings / 0 errors (inherited substrate); `fleetos:source-of-truth`
PASS; contract snapshot stable. Full substrate `typecheck`/`build` are
memory-constrained on 4GB boxes while other stacks run — run them in
quiet windows or CI; per-package typecheck is the local equivalent.

**Next ready work**: Wave 1 — F210A/F210B/F210C run concurrently on the
merged tree; F211 (transactional persistence + outbox + repository ports)
follows. Evidence lives under `docs/evidence/<work-item>/`.
