# F374 — Wave-19 TL convergence runbook

The mechanical procedure for closing Wave 19 after the F372 + F373 lanes
land. Execute in order; never skip a verification step; record every number
from the machine, never from prose.

## 0. Preconditions

- `work/f372` and/or `work/f373` pushed to origin (the workers' FINAL
  REPORTs name their HEAD SHAs).
- The box is simulation-empty before any gate launch (the run-7 doctrine:
  verify no vitest/service processes first).
- Gate worktree: `/home/z/gate-f372` (staged, detached @ 76ddba0).

## 1. Per-lane exact-tree gate (one lane at a time)

For each landed lane (F372 first — it owns the lockfile motion; then F373):

1. `git -C /home/z/fleetos fetch origin`
2. Boundary check: `git diff --name-only origin/main...origin/work/f372`
   — ONLY the packet's owned paths (+ the sanctioned `pg`/`@types/pg`
   lockfile/package.json motion for F372; ZERO lockfile motion for F373).
   Anything else = FINDING, adjudicate before proceeding.
3. Checkout the lane tip in the gate worktree:
   `git -C /home/z/gate-f372 checkout --detach origin/work/f372`
   (NEVER checkout a RUNNING gate's worktree.)
4. Install: `corepack pnpm@10.33.2 install --frozen-lockfile` (F372: after
   adding its lockfile, verify the frozen install passes — the 386404b
   lockfile-form law).
5. Run the lane battery (record exact numbers):
   - F372: commerce `pnpm test` (expect 183+N green), `pnpm typecheck`,
     `pnpm lint`; `infrastructure/fleetos-marketplace` typecheck + lint;
     cross-lane read-only: security 237 + identity 191 green UNCHANGED.
   - F373: identity `pnpm test` (191+N) + security `pnpm test` (237+N) +
     typecheck + lint both; `infrastructure/fleetos-kms` typecheck + lint;
     cross-lane: commerce 183 green UNCHANGED.
6. Determinism: the FULL corpus double-run — byte-identical output
   (ports/timestamps never in journey output).
7. File law: no file > 400 code lines (block-comment-aware).
8. Architecture check + the evidence report read (the worker's claimed
   numbers must match the machine's).

## 2. Sequential integration

1. Merge F372 into main (a normal merge commit, the F370-era message
   format: "F372 ACCEPTED+MERGED <sha> (TL gate at lane tip <sha>: ...)"
   with the measured gate numbers). Push.
2. Re-run the post-merge spot battery (commerce + marketplace + the
   cross-lane suites) at the merged tree.
3. Merge F373 into main (it shares no paths with F372; the only adjacency
   is the lockfile — F373 has zero lockfile motion by design). Push.
4. Full battery at the converged tree: every suite, cross-lane read-only
   included.

## 3. The Wave-19 re-pin (machine-measured, never pre-derived)

At the converged tree, measure and re-pin (the F370 procedure, the
run-4/7/8 lessons all apply):

- journeyExecutions / commerceExecutions / securityExecutions /
  commerceEpochReRuns / uniqueApplicable / cap (field + commerce +
  security corpora) / ACTIVE_PER_FIRM rows / the LANE_EXTENSIONS records
  (+F372/F373) / the industries corpora / verdicts denominators / report
  maxima / release tamper-tripwires (the corpus barrels grow: commerce
  49→49+J_f372, security 39→39+J_f373).
- The serialization law + the 900s timeouts already in place — do not
  regress them.
- Adoption + release gates: single clean run each (the box
  simulation-empty first). On green:

## 4. Records + close

1. Catalog: F372/F373 ACCEPTED+MERGED lines + F374 DONE + WAVE 19 CLOSED
   + the standing-qualifications ledger update (which follow-ups closed:
   networked-PG, real KMS; what remains operator-gated: F369/F371,
   cloud/HSM KMS adapters, production host deployment).
2. `AI_CONTINUATION.md` Wave-19 final state.
3. Evidence `docs/evidence/F374/report.md` (the re-pin table, gates,
   incidents — including tonight's capacity fight + the sentinel record).
4. `RESIDUAL-RISKS` update if the qualifications change in kind.
5. Issue #3 disposition comment + CI dispatch on the records tree
   (workflow_dispatch, 'main').
6. Board (mission-state.json) → WAVE 19 CLOSED, timeline entries, the
   three locations + the per-station mirror key.

## Incident notes for this wave (carry into the report)

- The w19b dead-ticket (stale Wave-18 sandbox slots) + the w19b2 recovery.
- The w19a §8 wedge + stop-cure + the capacity-gated resume (the
  w19a_resume_sentinel fights it autonomously, 10-min gentle cadence).
- CI 38794728196 SUCCESS (the Wave-18 close fully verified, 22:21Z).
