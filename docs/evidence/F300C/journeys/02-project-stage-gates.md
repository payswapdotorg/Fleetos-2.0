# 02 — Projects & Workloads (route `project-stage-gates`, path `/commerce/projects`)

**Machine-verified reference:** `stage-gated-project` and
`workload-allocation` journeys (corpus) plus the `host-surface` journey
(F300C corpus) — the readings below are their machine-verified actuals.

**Seeding (TL composition, real state only):** project `proj-h` "Depot
Winterization" (activated through the REAL project lifecycle), stage
`st-h1` "Preparation" with one MANDATORY open checkpoint `cp-h1`, started
(in_progress); work order `wo-h1` on the project in todo; workload
capacity `crew-a` 10 units with 5 units applied (demand key `wd-h`).

## Steps

| # | Action | Expected (machine-verified) |
| --- | --- | --- |
| 1 | Open `/commerce/projects` | The Projects & Workloads route renders with one stage-gate sheet for `proj-h` (projectId order) |
| 2 | Inspect the stage-gate sheet | Project status `active`; stage `st-h1` shows totalCheckpoints 1, completedCheckpoints 0, open mandatory `cp-h1` |
| 3 | Inspect the frontier | `frontierStageId` = `st-h1`; `nextUnlock` says exactly `close-mandatory-checkpoints` with the open checkpoint ids — not a vague "in progress" |
| 4 | Complete the mandatory checkpoint (via the composing command path) | The next view reports the unlock: no open mandatory checkpoints remain; closing the stage is now legal |
| 5 | Inspect the workload rollup | `crew-a`: usedUnits 5 / maxUnits 10, utilizationBps 5000, overAllocated false, remainingUnits 5 — integer bps, never floats |
| 6 | Over-allocate the workload (compose a demand application beyond capacity) | The REAL domain refuses `EXCEEDS_CAPACITY` with the exact overshoot units — the rollup never silently clamps (the corpus proves the invariant holds) |

## Refusals to verify (fail-closed)

- Closing the stage with the mandatory checkpoint open: the domain refuses
  `OPEN_MANDATORY_CHECKPOINTS` — the gate view reports what unlocks it,
  never a fake close.
- A cross-tenant project record in the slice: the stage-gate assembly
  refuses the WHOLE sheet with `TENANT_MISMATCH` naming the offender.

## Record

URL, deployed commit, screenshots of steps 2–6, refusal renderings.
