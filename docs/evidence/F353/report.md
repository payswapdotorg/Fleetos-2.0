# F353 — TL convergence after F351B (mining + construction), Wave-16 tranche 1

- **Work item:** F353 (`spec/work-items/WORK-ITEM-CATALOG.md`, Wave 16; contract
  `docs/tech-lead/packets/f353.md`; binding law `docs/evidence/F350/report.md` §4
  + F340 D14–D17 + F342 §1–2).
- **Owner:** TL (convergence; no worker lane).
- **Date:** 2026-10-14. **Converged candidate:** `5d74b5c` (main, this push).
- **Lane under convergence:** F351B (worker A / w16a) — WIP `5d048b5`,
  evidence+catalog `da6a8e9` (lane tip), base `4f59ffe`, merge `10de683`
  onto main `c7bb5b1` (29 main-side docs commits preserved: the standalone
  F353/F354/F360 packets, mission roadmap and handoff records; both Wave-16
  catalog rows retained — the merge was conflict-free, catalog hunks disjoint).

## 1. Remote-state capture (packet §2, machine-run)

```
origin/main      c7bb5b1509e1f7e6ee433f060510eee77196a7f7
origin/work/f351b da6a8e9e4efc5e0903304c9269394a359890c82b  (+2 / −30)
origin/work/f351c 0207559f0345c4755fba5b8e464d4e31e87ade9d  (+1 / −29; F354's lane)
merge-base(main, f351b) 4f59ffed4cf3299da6bbd99ae3b51a4988755ea8
```

## 2. TL lane gate at `da6a8e9` (worktree `/tmp/gate-f351b`, fresh install)

| Gate | Result |
|---|---|
| field acceptance | **107/107** (8 files) — green, grow-only 102 → 107 |
| corpus barrel | **40** machine-counted (`FIELD_JOURNEYS` array; 35 → 40, +5) |
| mask law | industries.ts diff = **0 removals / exactly 4 additions** — NEW `project-closeout-archival` entries (transportation + agriculture, field corpus, with rationales); every existing record byte-identical (machine-verified: zero `-`-prefixed content lines in the diff) |
| typecheck | exit 0 (field + adoption packages) |
| lint | oxlint **0w/0e** on 67 files |
| file law | max 245 lines ≤ 400 |
| determinism | rerun byte-identical 107/107 |
| boundary | 24 paths, ALL packet-owned (field journeys/ops/tests/contracts, industries.ts narrow grant, `docs/evidence/F351B/**`, catalog one-liner, lockfile/package.json); zero acceptance-pin files touched |

## 3. Independent recount at the integrated tree (packet §3)

Machine-run TL probe over the REAL 30-workspace simulation at the merge
`10de683` (the numbers below are the probe's own output, never copied from the
worker report; they reproduce the worker's lane-local report exactly):

| Measure | F342 baseline | F353 measured | Law |
|---|---|---|---|
| journeyExecutions | 3027 | **3171** (+144) | grow-only ✓ |
| fieldExecutions | 1179 | **1323** | grow-only ✓ |
| commerceExecutions | 1017 | **1017** | unchanged ✓ |
| securityExecutions | 831 | **831** | unchanged ✓ |
| uniqueApplicableJourneys | 931 | **979** | grow-only ✓ |
| fieldEpochReRuns | 406 | **406** | unchanged ✓ |
| commerceEpochReRuns | 897 | **897** | unchanged ✓ |
| determinismVerified | true | **true** | ✓ |
| allJourneysPassed | true | **true** | ✓ |
| firms ≥ 100 | 17 | **23** | ✓ |
| aggregateShortfall | 97 | **47** | honest narrowing ✓ |

+144 = the 5 F351B journeys × the 28 firms where they apply (transportation +
agriculture mask `project-closeout-archival` per D15-strict — the lane's
recorded rationales). uniqueApplicable +48 = 4 universal journeys × 10
industries + the closeout journey × 8 industries.

### The 30-firm measured table (industry | small/medium/large counted)

manufacturing 105/113/121 · construction **102**/110/118 · energy-utilities
105/113/121 · transportation-logistics 97/105/113 · agriculture 86/94/102 ·
healthcare-facilities 90/97/104 · facilities-management 91/98/105 ·
telecommunications **100**/108/116 · mining **103**/111/119 · water-waste
**100**/108/116

**B-3 CLOSES for mining (98 → 103) and construction (97 → 102)** — the lane's
mission arithmetic. Honest bonus: telecommunications + water-waste small firms
land AT 100 (they carry no mask on the new journey ids) and agriculture large
crosses at 102. Remaining below-100 firms (the honest residual): agriculture
small 86 (−14) / medium 94 (−6), healthcare-facilities small 90 (−10) / medium
97 (−3), facilities-management small 91 (−9) / medium 98 (−2),
transportation-logistics small 97 (−3) — aggregate 47.

## 4. The re-pin at `5d74b5c` (TL-owned paths only)

- `packages/acceptance/adoption/src/convergence-delta.ts`:
  `CURRENT_TREE_COUNTS`/`CONVERGENCE_EXPECTATION` field 35 → 40, cap 100 → 105
  (= 40+36+29); the **LANE_EXTENSIONS F351B record** (work/f351b @ da6a8e9,
  journeysInThisTree 35, journeysAtTip 40, delta 5) appended; the
  **anti-inflation tripwire honestly evolved for the post-closure world**: the
  F342 check ("negative shortfall = count inflation — the B-3 closure lands at
  EXACTLY 100") becomes "**the cap may never REGRESS below the 100 target**"
  (grow-only corpus expansion above the closed target is the F350 §4
  sanctioned path). The cap == corpus-sum check and the shortfall-formula
  consistency check are preserved verbatim; fake-journey inflation remains
  impossible because corpus admission is D14 census-certified (the suites
  machine-verify every member).
- adoption suite pins: f332 `ACTIVE_PER_FIRM` (all 30 rows, measured above) +
  aggregates; simulation aggregates + honest-counts (23 at-or-above, max 121,
  aggregateShortfall 47, agriculture 19-masked reason); industries corpora
  40+36+29 with the at-or-above-100 honest-subset law (was `=== 100`); verdicts
  coverage denominators (manufacturing 105, agriculture 86 = 105 − 19 masked,
  construction 102); report max 121 / manufacturing medium 113; adoption-run
  construction+mining 663 aggregate + 205 unique (journey × industry pairs) +
  water-waste [100, 108, 116] + epoch-0 100; the agriculture honest-counts test
  restructured honestly (small/medium below 100 with the 5 structural reasons,
  large AT 102 with zero shortfall).
- release suite pins: integration ledger 3171; gate baselines field 40; the
  short-field-corpus TAMPER TRIPWIRE rebased to expected-40 (the tripwire
  itself preserved — a 29-journey subset must still be rejected with
  ACCEPTANCE_COUNT_MISMATCH).

## 5. The battery at the exact converged tree `5d74b5c` (machine-run)

| Gate | Result |
|---|---|
| field acceptance | **107/107** — green (post-merge re-run; runbook §"post-merge re-runs are mandatory") |
| security acceptance | **179/179** — green |
| commerce acceptance | **115/115** — green |
| convergence acceptance | **82/82** — green |
| maintenance acceptance | **99/99** — green |
| adoption acceptance | **120/120** — green (re-pinned from measured values; was 104/120 with the 16 F342-era stale pins, exactly as the lane predicted) |
| release gate | **88/88** — green |
| typecheck | exit 0 on all root substrate projects (rpc, provider, provider-node, shared, services, client, server, zcode-server-cli, ui, web, web/tsconfig.fleetos.json, desktop/tsconfig.host.json — run sequentially under the 4 GB ceiling) + the durable service `tsc -p` exit 0 + the three changed acceptance packages exit 0 |
| lint | oxlint **0w/0e** on adoption (19 files) + release (10 files) |
| determinism | byte-identical reruns (the suite's internal determinism proofs: determinismVerified=true × 30 workspaces) |
| boundary | `git diff 4f59ffe..5d74b5c` = lane paths + the 10 TL-owned re-pin files listed above; zero worker-owned path edits by the TL |
| root gates (B-1/B-2 + monorepo) | dispatched on the GitHub Actions high-memory builder at this push (workflow `release-gates.yml`); results recorded on the run pages for the exact SHA |

## 6. Disposition update

- The F352 READY disposition does NOT carry forward automatically: F351B is an
  implementation delta and this convergence re-ran the full battery at the new
  exact tree — all seven suites green, counts re-locked at the measured values
  above. The standing qualifications are unchanged in kind: sandbox-hosted
  single port; operational-plane-only durability; fixture-composed WORLD
  inputs; shape/scope-validated (not authenticated) actor identity;
  Aurum/ADCOS/Arena CONTRACT_ONLY; masked industries NARROWED (this lane) but
  not eliminated — see the residual table in §3.
- Residual masked-industry shortfalls (the honest remainder for future
  tranches): agriculture −20 (14+6), healthcare-facilities −13 (10+3),
  facilities-management −11 (9+2), transportation-logistics −3 — aggregate 47.
- F351C (work/f351c @ 0207559) remains unmerged and is the F354 lane; its
  telecom/water-waste arithmetic is already superseded by this convergence's
  measured bonus (both at 100) — F354 must recount with BOTH lanes present and
  adjudicate the proposal tables against the real integrated tree.

## 7. Deviations and honest notes

- The convergence-expectation test title changed ("MEETS … exactly" →
  "EXCEEDS the closed 100/firm target via sanctioned grow-only corpus
  growth") — the assertion set is stronger (cap ≥ 100 never-regress + cap ==
  corpus sum + formula consistency), not weaker.
- The `shortfallPerFullyApplicableFirm` value is now −5 by its preserved
  formula (target − cap); its semantics comment documents the post-closure
  reading. The B-3 target itself (100) is untouched — no target lowering.
- The agriculture honest-counts test now asserts the measured split
  (small/medium below with reasons; large at 102) instead of the obsolete
  "all three below 100".
- No mask was removed, weakened or re-litigated; the only industries.ts
  motion is the lane's +4 NEW entries under the F350-pattern grant, verified
  byte-identical for every pre-existing record.
