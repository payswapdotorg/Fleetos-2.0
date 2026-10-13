# F342 — Wave-14 TL convergence: recount + re-pins + verdict inputs

- **Work item:** F342 (`spec/work-items/WORK-ITEM-CATALOG.md`, Wave 14; the F340 §4
  lane contract; packet `docs/tech-lead/packets/f342.md` — the binding
  contract for this delivery).
- **Worker:** C (the TL-delegated convergence runner). **Date:** 2026-10-13.
- **Base:** `1103acf` (main HEAD at clone — the post-F341B merge main,
  EXACTLY the packet's expected base; the pre-gate ref sync re-verified main
  unmoved at `1103acf` before every battery run below).
- **Branch:** `work/f342` (pushed to origin; the final tip SHA is in the
  FINAL REPORT message — the repository is the source of truth).
- **Canonical context read in order:** the F340 report (D14–D17 + §3
  arithmetic — the binding Wave-14 law), the f342 packet, the F332 report
  (the two-phase convergence precedent), the F341B report (the last lane's
  evidence — the converged tree this delivery recounts), the F341A report
  (the A-lane that delivered the D17 sixth slot).

## 0. Delegation record

D11 reserves `packages/acceptance/adoption/**` to the TL; per the operator's
standing directive (the TL orchestrates and dispatches; the TL does not
self-implement), this convergence is delegated to a worker session under
the packet — the F332 §0 precedent pattern. The TL retains the merge gates,
the final verdict, and all browser verification; this delivery implements
the recount + re-pins with zero discretion over values: every pinned number
was machine-measured by the F342 probe on THIS tree, never copied from the
packet (whose pre-measurements predate the F341B merge — see §6-L3).

## 1. The recount — the ACTIVE ledger at the converged tree

The full 30-workspace simulation over the REAL corpora
(10 industries × 3 firms, the F332 counting gate ACTIVE), machine-measured:

| measure | F332 pin (old) | **F342 measured (new)** | delta |
|---|---:|---:|---|
| journeyExecutions (COUNTED) | 2,847 | **3,027** | +180 = 6 Wave-14 journeys × 30 firms |
| fieldExecutions | 1,059 | **1,179** | +120 = 4 F341A journeys (incl. the D17 sixth slot) × 30 |
| commerceExecutions | 1,017 | **1,017** | 0 (no Wave-14 commerce journeys) |
| securityExecutions | 771 | **831** | +60 = 2 F341B journeys × 30 |
| uniqueApplicableJourneys | 871 | **931** | +60 = 6 journeys × 10 industries (all fully-applicable, D15, zero masks) |
| fieldEpochReRuns (raw, never counted) | 406 | **406** | 0 — the Wave-14 journeys declare no epochs |
| commerceEpochReRuns (raw, never counted) | 897 | **897** | 0 |
| aggregateShortfall (Σ max(0, 100−counted)) | 205 | **97** | −108 |
| determinismVerified | true | **true** | byte-identity holds on all 30 firms |
| allJourneysPassed | true | **false** | the ka6 tenant pin (§5 — the one defect this recount surfaces) |

The epoch-count ledger is UNCHANGED and machine-verified: exactly the 8
census-certified journey IDs (6 field + 2 commerce), 234 counted epoch
executions (edge-command-lifecycle 24 — masked in healthcare-facilities +
facilities-management; every other responder 30). The Wave-14 journeys are
single-epoch (T0) per the F340 carryover law — nothing outside the
D8/D12-certified sets may ever count, and nothing new did.

## 2. The per-firm closure table (which sizes closed where)

Every firm's counted total grew by exactly +6 (the Wave-14 journeys are
fleet-universal — no industry masks any of them; no mask was broadened or
narrowed). The F340 §3 B-3 arithmetic is machine-realized:

| industry | small | medium | large | shortfall vs 100 (structural) |
|---|---:|---:|---:|---|
| manufacturing | **100** | 108 | 116 | **B-3 CLOSED — small AT 100** (94+6); all sizes ≥ 100 |
| energy-utilities | **100** | 108 | 116 | **B-3 CLOSED — small AT 100**; all sizes ≥ 100 |
| construction | 97 | 105 | 113 | small −3 (1 field + 2 security masks); medium/large ≥ 100 |
| transportation-logistics | 93 | 101 | 109 | small −7 (2 field + 3 commerce + 2 security masks); medium/large ≥ 100 |
| agriculture | 82 | 90 | 98 | all sizes below (18 masked: 2 field + 13 commerce + 3 security) |
| healthcare-facilities | 85 | 92 | 99 | all sizes below (15 masked: 4 field + 8 commerce + 3 security; 5 field responders) |
| facilities-management | 86 | 93 | **100** | small −14, medium −7 (14 masked: 3 field + 8 commerce + 3 security); large AT 100 |
| telecommunications | 95 | 103 | 111 | small −5 (1 field + 4 commerce masks); medium/large ≥ 100 |
| mining | 98 | 106 | 114 | small −2 (1 field + 1 commerce mask); medium/large ≥ 100 |
| water-waste | 95 | 103 | 111 | small −5 (1 field + 4 commerce masks); medium/large ≥ 100 |

Firms at/above 100: **17** (was 10 at F332) — manufacturing ×3,
energy-utilities ×3, construction medium+large, transportation-logistics
medium+large, facilities-management large, telecommunications medium+large,
mining medium+large, water-waste medium+large. Shortfall accounting (exact):
small 69 + medium 25 + large 3 = **97**. Max executed: **116**
(manufacturing/energy large = 100 applicable + 12 field epochs + 4 commerce
epochs). Grow-only + never-weaken hold on every counted number; the 100
target is untouched; every mask is byte-identical to the F332 tree.

## 3. The re-pin table (file → old → new; every value machine-measured)

| file | pin | old | **new** |
|---|---|---:|---:|
| `adoption/src/convergence-delta.ts` | LANE_EXTENSIONS | 7 records (…F331C) | **9 records** (+F341A field 31→35 @ `e954ec8`; +F341B security 27→29 @ `46e948c`) |
| 〃 | CURRENT_TREE_COUNTS | field 31 / security 27 / cap 94 | **field 35 / security 29 / cap 100** |
| 〃 | CONVERGENCE_EXPECTATION | cap 94, shortfall 6 | **cap 100, shortfall 0** (the B-3 closure) |
| 〃 | verify() invariant | "shortfall vanished" (≤0 fails) | **"cap exceeded target" (<0 fails)** — anti-inflation, same never-weaken law |
| `adoption/src/adoption-run.ts` | STRUCTURAL_REASONS | "the 6-journey remainder is the honest post-Wave-13 gap" / "epoch-earning medium/large" | **the Wave-14 closure text / "17 at this tree"** (5 reasons preserved) |
| `adoption/tests/simulation.test.ts` | aggregate counts | 2847 / 1059 / 1017 / 771 / 871 | **3027 / 1179 / 1017 / 831 / 931** (406 + 897 unchanged) |
| 〃 | all-passed | `allJourneysPassed === true` | **`false` + the exact 30-failing-facts pin** (§5) |
| 〃 | verdict table | SWITCH-ONLY 1 / MAIN 5 / COMPL 4; ratio 1 | **MAIN 6 / COMPL 4** (manufacturing MAIN-INTERFACE, ratio (n−1)/n per industry) |
| 〃 | honest counts | atOrAbove 10 / max 110 / shortfall 205 | **17 / 116 / 97** |
| `adoption/tests/f332.test.ts` | ACTIVE_PER_FIRM (30 values) | e.g. manufacturing [94,102,110] | **[100,108,116]** (every firm +6; §2 table) |
| 〃 | ACTIVE aggregate | 2847 / 1059 / 771 / 871 | **3027 / 1179 / 831 / 931**; `allJourneysPassed false` |
| 〃 | INACTIVE records | Wave-13 values | **untouched** — labeled the frozen Wave-13 corpora record (unreachable while the gate is ACTIVE) |
| `adoption/tests/adoption-run.test.ts` | construction+mining subset | 597 / 183 / allPassed true | **633 (315+318) / 195 / false** (the ka6 pins) |
| 〃 | water-waste sizes | [89, 89+8, 89+16] | **[95, 95+8, 95+16]** + the ka6 failure pin |
| 〃 | healthcare single-firm | all facts passed | **exactly 1 failing fact, note pinned verbatim** (§5) |
| `adoption/tests/report.test.ts` | manufacturing verdict | SWITCH-ONLY, 94/94, ratio 1 | **MAIN-INTERFACE, 99/100, ratio 0.99, failingJourneys [ka6]** |
| 〃 | honest counts | mfg-medium 102; ≤110 | **108; ≤116** |
| `adoption/tests/industries.test.ts` | corpora | 31+36+27; full-94 count | **35+36+29; full-100 count = 2 industries** |
| `adoption/tests/verdicts.test.ts` | coverage denominators | 94 / 76 / 93 / 91 / 75 | **100 / 82 / 99 / 97 / 81** |
| `adoption/tests/convergence.test.ts` | expectation | cap 94, shortfall 6 (>0) | **cap 100, shortfall 0 (≥0, anti-inflation)** |
| `release/tests/release-gate.test.ts` | REAL-stack verdict | READY, blockers [] | **NOT-READY, exactly [ACCEPTANCE_FAILED / acceptance.adoption / allJourneysPassed=false … journeyExecutions=3027]** |
| 〃 | corpora counts | field 31, security 27 | **35 / 29**; `adoptionReport.allJourneysPassed false` |
| 〃 | lane/warning mechanics | READY paths | **NOT-READY with ONLY the adoption blocker** (no phantom LANE_MISSING; zero CEILING_BREACHED — the mechanics laws still proven) |
| 〃 | tamper fixtures | forged false / forged NOT-READY | **forged true / forged READY** (the honest tamper directions at this tree) |
| 〃 | short-corpora pins | "expected 31" / "expected 27" | **"expected 35" / "expected 29"** |
| 〃 | multi-degradation codes | 5 codes | **6 codes** (+ACCEPTANCE_FAILED from the REAL adoption baseline) |
| `release/tests/integration.test.ts` | REAL-stack verdict | READY, blockers [] | **NOT-READY, exactly the adoption blocker** |
| 〃 | adoption baseline | allJourneysPassed true; 2847 | **false; 3027** |
| 〃 | warning posture | READY | **NOT-READY with ONLY the adoption blocker** |

Expectation values only — no gate logic, no rubric threshold, no runner
semantics was changed anywhere; the two tamper-fixture direction flips are
value flips that keep each fixture's purpose (a digest-mismatched report /
a digest-mismatched verdict) intact at the tree where the REAL report
already carries the recorded failure.

## 4. The full battery at the converged tree (machine-run, all green)

| gate | command | result |
|---|---|---|
| adoption (new pins) | `pnpm --filter @fleetos/acceptance-adoption test` | **120/120 (9 files)** |
| field | `pnpm --filter @fleetos/acceptance-field test` | **102/102 (7 files)** |
| security | `pnpm --filter @fleetos/acceptance-security test` | **179/179 (8 files)** — the packet's stale 168 corrected (§6-L3) |
| commerce | `pnpm --filter @fleetos/acceptance-commerce test` | **115/115 (6 files)** |
| release (new pins) | `pnpm --filter @fleetos/acceptance-release test` | **88/88 (4 files)** |
| convergence | `pnpm --filter @fleetos/acceptance-convergence test` | **82/82 (4 files)** |
| maintenance | `pnpm --filter @fleetos/maintenance test` | **99/99 (5 files)** |
| typecheck | `tsc --noEmit` (adoption + release) | exit 0, both |
| lint | `oxlint src tests` (adoption + release) | 0 warnings / 0 errors (19 + 10 files) |
| file law | oxlint max-lines (400, skipBlank/skipComments; test files exempt per the repo's own override) | every touched file passes (lint green; no new file was created) |
| boundary | `git diff --name-only main...HEAD` | §8 — CLEAN |
| PRE-GATE REF SYNC | `git fetch origin main:main` | main unchanged at `1103acf` |

## 5. The ka6 record — the one defect this recount surfaces (measured, pinned, not fixed)

**The fact:** the A-lane D17 sixth-slot journey
`field/observations-kernel-immutability-audit` (delivered by F341A,
TL-adjudicated) asserts `ka6: the audit ref carries the admitting tenant`
with `expected: TENANT` — the field fixture constant
`tnt_field-accept-01` (`f341a-kernel.ts:85`). The adoption driver threads
each firm's REAL tenant (`tnt_<industry>-<size>` — the tenant dimension is
REAL by law), so ka6 fails in EVERY one of the 30 workspaces:
machine-measured **30 failing execution facts, one per firm, all this one
journey**, note `assertion ka6 failed: expected "tnt_field-accept-01",
actual "tnt_<industry>-<size>"`.

**The honest classification (F341B §6-L4, re-verified here):** pre-existing
at base (fail-identical at `5c2ba68` and at the F341B lane per that lane's
diff-verified evidence); regime-specific — the field suite itself is green
(102/102) because in the field fixture regime the runner's tenant IS
`tnt_field-accept-01`; the pin fails only in the adoption-composition
regime. NOT a critical failure: the journey sits in no incumbent capability
family, so no RETAIN is triggered and no core capability degrades.

**The measured consequences, all pinned (never hidden):**
`allJourneysPassed=false`; every industry's coverage = (applicable−1)/
applicable with `failingJourneys=[this journey]`; manufacturing drops
SWITCH-ONLY→MAIN-INTERFACE (ratio 0.99 < 1.0 — the distribution is now
0 SWITCH-ONLY / 6 MAIN-INTERFACE / 4 COMPLEMENT / 0 RETAIN); the release
gate's REAL-stack verdict is **NOT-READY with the NAMED blocker**
`ACCEPTANCE_FAILED / acceptance.adoption / allJourneysPassed=false
determinismVerified=true journeyExecutions=3027`.

**Why F342 does not fix it:** the fix is a one-line change in
`packages/acceptance/field/**` (assert the run-context tenant, or a
fixture-tenant-relative pin) — OUTSIDE the F342 boundary (the packet's
strict law: adoption/** + release test expectations + evidence + catalog
only; no domain-package changes; the field corpus is worker-A owned).
Recorded here for the TL's adjudication per the F341B L-4 hand-off. The
re-pinned expectations are deliberate tripwires: the moment the fix lands,
these pins go red and the next convergence re-measures (back to
allJourneysPassed=true, manufacturing SWITCH-ONLY, gate READY-with-zero-
blockers) — nothing silently flips.

## 6. Verdict inputs (measured facts for the TL — the TL states the verdict)

- **All 6 Wave-14 journeys landed and are machine-counted:** field corpus
  31→35 (F341A @ `e954ec8`: A1 backpressure + A2 retention + A3 checkpoint
  determinism + the TL-adjudicated D17 kernel-immutability-audit), security
  27→29 (F341B @ `46e948c`: B1 artifact-store-completeness + B2
  world-context-windowing). Nothing else moved.
- **The F340 §3 B-3 arithmetic, machine-realized:** manufacturing +
  energy-utilities SMALL firms at **exactly 100** (94+6) — the inputs for
  "B-3 closes for fully-applicable firms"; medium/large already closed
  since F332, now 108–116. 17/30 firms ≥ 100; aggregate shortfall 205→97;
  every remaining shortfall is mask-structural with per-journey rationales
  in the honest-counts ledger.
- **The release side, machine-measured:** the gate's verdict over the full
  REAL stack is **NOT-READY** — the named blocker being the ka6 adoption
  failure (§5). The TL's standing qualifications are untouched by this
  wave: masked industries remain structural (§2 table), production
  deployment + durable persistence remain undemonstrated, and model
  providers remain CONTRACT_ONLY. Per the packet's own §6 conditional, the
  measured inputs support: B-3 CLOSED for fully-applicable firms; release
  NOT READY. **This delivery states the inputs; the final verdict is the
  TL's alone.**

## 7. Honest limitations

- **L-1 (the delegated verdict):** this delivery implements the frozen F342
  packet under the TL's delegation; the TL gates every line at merge and
  owns the final verdict. The ka6 adjudication note (§5) is a record for
  that gate, not a self-verdict.
- **L-2 (the ka6 defect stands):** 30 failing adoption-composition
  executions (§5) are pinned as the measured state of THIS tree. The
  recount, the B-3 closure, and every count are unaffected (the journey
  still executes and still counts); the pass-state pins, the manufacturing
  verdict, and the release-gate blocker carry the defect visibly until the
  TL adjudicates the field-side fix.
- **L-3 (the packet's stale pre-measurements, recorded per the honesty
  law):** the packet's battery list says "security 168" — machine-measured
  **179** at the converged tree (the F341B merge's own grow-only +13 over
  base 166); its simulation/security pre-measurements (2847→3027, 771→831)
  were VERIFIED to match exactly, as did field 1059→1179 and small
  fully-applicable 94→100. Every pin carries the measured number.
- **L-4 (masked industries remain structural):** the Wave-14 journeys claim
  no mask narrowing (D15 — fleet-universal mechanics only); agriculture/
  healthcare-facilities/facilities-management/telecommunications/mining/
  water-waste/construction/transportation-logistics shortfalls are exactly
  their mask counts, byte-identical rationales to the F332 tree.
- **L-5 (the standing release qualifications):** production deployment and
  durable persistence remain undemonstrated in this substrate; model
  providers remain CONTRACT_ONLY. The machine gate would be blocked by the
  ka6 adoption failure even absent these — both facts are recorded, neither
  is traded against the other.
- **L-6 (sandbox scope):** all gates ran in this sandbox (the battery of
  §4); the 16 GB builder full clean-checkout gates (root typecheck/build,
  the monorepo test plane) and browser verification remain TL-owned (the
  F322 §5 doctrine).
- **L-7 (pins are tree-scoped):** the F332 L-5 doctrine carries forward —
  every re-pinned expectation is exact for THIS tree (`1103acf` + this
  delivery); any corpus change (including the ka6 fix) re-triggers the
  documented pin-transition class, re-pinned only from machine-measured
  runs.

## 8. Boundary

`git diff --name-only main...HEAD` lists ONLY (11 code paths + 2 doc paths):

- `packages/acceptance/adoption/src/convergence-delta.ts`,
  `packages/acceptance/adoption/src/adoption-run.ts`
- `packages/acceptance/adoption/tests/{adoption-run,convergence,f332,
  industries,report,simulation,verdicts}.test.ts`
- `packages/acceptance/release/tests/{release-gate,integration}.test.ts`
- `docs/evidence/F342/report.md` (this file)
- the one-line catalog append to
  `spec/work-items/WORK-ITEM-CATALOG.md`

No field/security/commerce corpus package, no domain package, no release
source file, no shared contract, no verdict constant outside the measured
numbers. The measurement probe ran in-tree UNTRACKED and was deleted
before commit (the F332 out-of-repo probe pattern).
