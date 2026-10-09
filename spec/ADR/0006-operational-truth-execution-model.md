# ADR-0006 — The Operational-Truth Execution Model

## Status

ACCEPTED (Waves 0–9; the model that delivered the roadmap)

## Context

The roadmap (spec/work-items/WORK-ITEM-CATALOG.md, Waves 0–9, ~40 work items) had to
be executed by a Tech Lead with exactly three implementation workers (edge-and-asset,
safety-and-intelligence, work-and-commerce) under hard bounded-context ownership. The
failure modes to prevent: cross-lane code collisions, unverified worker claims,
integration drift between lanes, and lost work across session interruptions.

## Decision

- **Worker packets:** every work item is dispatched as a self-contained packet
  (`docs/tech-lead/packets/<item>.md`): identity, read-first list, owned paths (from
  `spec/worker-ownership.yaml`), deliverables, hard boundaries (imports, purity, file
  law, honesty law), exact gate commands, commit message, evidence-report structure,
  and the report-back contract.
- **Baseline law:** workers machine-verify lane baselines BEFORE the first edit and
  AFTER the last edit (before/after counts must match the packet).
- **TL gate at the exact commit:** acceptance is never a worker's word — the TL
  re-runs test/typecheck/lint in a clean worktree at the pushed delivery commit,
  checks boundaries, purity, file law, evidence, and re-runs every affected baseline.
- **Merge laws:** REF-SYNC (sync the local branch ref to origin before merging),
  lockfile conflicts resolved `--ours` + re-link, post-merge re-runs of every merged
  package's gates, then push; AI_CONTINUATION.md synced after each wave.
- **Evidence trail:** every item lands `docs/evidence/<item>/report.md` with owned
  paths, exact gate outputs, seam findings and honest residuals.
- **Inherited-WIP protocol:** interrupted sessions' uncommitted work is stashed,
  true baselines verified at the clean base, then the WIP is audited line-by-line
  against the packet before continuation.

## Consequences

- 40/40 work items delivered and merged with zero cross-lane collisions and zero
  unverified acceptances (every merge carries a TL machine re-run).
- Session interruptions (platform outages, sandbox resets) were survivable: WIP
  pushed to branches, packets + evidence + continuation pointer in-repo, worklog
  appended by every agent.
- Residual: root gates (`pnpm -r test`, architecture snapshot) were run per-worktree
  at wave close rather than per packet (per-packet cost too high) — the final
  closeout runs the full monorepo suite once.
