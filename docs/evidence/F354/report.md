# F354 — TL convergence after F351C (telecommunications + water-waste), Wave-16 CLOSE

- **Work item:** F354 (`spec/work-items/WORK-ITEM-CATALOG.md`, Wave 16; contract
  `docs/tech-lead/packets/f354.md`).
- **Owner:** TL (convergence; no worker lane).
- **Date:** 2026-10-14. **Converged candidate:** `1033be5` (main, this push).
- **Lane under convergence:** F351C (worker C / w16b) — single commit
  `0207559` (lane tip, 2026-10-14 06:43:52 +0000), base `cb572b8`, merge
  `678c7bf` onto the F353-accepted tree `673cdaa` (all F353 re-pins + Wave-16
  records preserved; catalog hunks disjoint).

## 1. Remote-state + date-integrity (packet §2)

```
origin/main       673cdaa (F353-accepted, pre-merge)
origin/work/f351c 0207559 (+1 / −29; merge base cb572b8)
```

**Date integrity RESOLVED:** the branch report said `Date: 2026-10-15`; the
actual lane commit is `2026-10-14 06:43:52 +0000` — a worker typo, corrected
transparently in the report (this records commit) with the commit timestamp
named as the evidence of record. No backdating.

## 2. TL lane gate at `0207559` (worktree `/tmp/gate-f351c`, fresh install)

| Gate | Result |
|---|---|
| commerce acceptance | **133/133** (7 files) — green, grow-only 115 → 133 |
| corpus barrel | **41** (36 → 41, +5 fleet-universal D14 journeys) |
| industries.ts | **ZERO motion** (the lane's 16 paths contain no industries.ts — the packet's path-disjointness law held) |
| typecheck / lint | exit 0 / oxlint **0w/0e** on 52 files |
| file law | max 384 ≤ 400 |
| determinism | byte-identical (journey + 41-corpus + 30-workspace reruns, machine-verified in-suite) |
| boundary | 16 paths, ALL packet-owned (commerce journeys/drivers/contracts/tests + evidence + catalog one-liner) |

## 3. The combined recount (packet §3) — both lanes present

Machine-run TL probe over the REAL 30-workspace simulation at the merge
`678c7bf` (probe output, never copied):

| Measure | F353 | F354 measured | Packet projection |
|---|---|---|---|
| journeyExecutions | 3171 | **3321** | 3321 ✓ |
| fieldExecutions | 1323 | **1323** | 1323 ✓ |
| commerceExecutions | 1017 | **1167** | 1167 ✓ |
| securityExecutions | 831 | **831** | 831 ✓ |
| uniqueApplicableJourneys | 979 | **1029** | 1029 ✓ |
| fieldEpochReRuns | 406 | **406** | — |
| commerceEpochReRuns | 897 | **1047** | — (raw transparency metric: +150 = the 5 new journeys' epoch-dimension re-runs, never counted) |
| firms ≥ 100 | 23 | **26** | — |
| aggregateShortfall | 47 | **19** | **18 — corrected by measurement** |
| determinismVerified / allJourneysPassed | true/true | **true/true** | — |

**The projection correction:** agriculture MEDIUM lands at **99** (shortfall
1) — the packet's projection listed agriculture's shortfall as small-only
(9). Measured wins per the packet's own law ("independently measure them and
explain any difference"). Remaining below-100 firms: agriculture small 91
(−9) / medium 99 (−1), healthcare-facilities small 95 (−5),
facilities-management small 96 (−4) — aggregate **19**.

### The 30-firm measured table (industry | small/medium/large)

manufacturing 110/118/126 · construction 107/115/123 · energy-utilities
110/118/126 · transportation-logistics 102/110/118 · agriculture 91/99/107 ·
healthcare-facilities 95/102/109 · facilities-management 96/103/110 ·
telecommunications 105/113/121 · mining 108/116/124 · water-waste 105/113/121

**B-3 holds for all four Wave-16 target industries** (mining 108, construction
107, telecommunications 105, water-waste 105 — all smalls ≥ 100). 26/30 firms
at/above 100.

## 4. Adjudication + the parallel-lane id collision (packet §3 gates)

- **Applicability proposals: ZERO to apply.** The F351C position is honestly
  all-universal (5/5 journeys) — the declarative-proposal mechanism was not
  used; the recorded-not-delivered candidates (#6–#9) are information-only.
  No industries.ts edit by the TL.
- **Existing masks byte-identical** — no motion anywhere in Wave 16 beyond
  F351B's +4 NEW entries (verified at F353; F351C touched nothing).
- **PARALLEL-LANE ID COLLISION (found + resolved):** both lanes
  independently delivered the journey id `procurement-order-authorization`
  over the shared `createOrder`/Guardian-A5 procurement surface — each
  census-certified at its own base (the other lane's coverage did not exist
  there). The concurrency protocol's path-disjointness does NOT imply
  census-disjointness across corpora (field `pr.*` ops and commerce `pdir-*`
  ops reach the same procurement package public APIs). Symptom at
  integration: `computeCoverage` dedupes by journey id globally →
  manufacturing coverage 109 vs the applicable 110. **Resolution:** the
  COMMERCE journey renamed to `procurement-quote-to-order-authorization` —
  its distinct angle is the quote-ACCEPTANCE prerequisite
  (ILLEGAL_TRANSITION off a submitted quote), the audit-event authorization
  decision id, and cross-tenant fail-closed order/quote reads; the FIELD
  journey keeps the original id with its vendor-matching, full order
  lifecycle and no-decision (AUTHORIZATION_REQUIRED) refusals. Both suites
  re-green post-rename (commerce 133/133, adoption 120/120). Recorded as a
  protocol lesson for future parallel lanes: census proof must re-run at
  INTEGRATION against the merged tree.

## 5. The battery at the exact converged tree `1033be5` (machine-run)

| Gate | Result |
|---|---|
| field | **107/107** |
| security | **179/179** |
| commerce | **133/133** (grow-only; rename verified) |
| convergence | **82/82** |
| maintenance | **99/99** |
| adoption | **120/120** (re-pinned from the combined measured values) |
| release | **88/88** (gate baselines 40/29/41; the short-commerce tamper tripwire rebased to expected-41) |
| typecheck | exit 0 on the three changed acceptance packages (root substrate unchanged from F353's sequential exit-0 run; the Actions builder re-runs B-1/B-2 at the pushed SHA) |
| lint | oxlint **0w/0e** on commerce (52) + adoption (19) + release (10) files |
| determinism | byte-identical (in-suite proofs, determinismVerified=true × 30) |

## 6. Wave-16 close disposition

- Wave 16 **CONVERGED**: F351B + F351C accepted and merged; counts re-locked
  at 3321/1323/1167/831/1029; 26/30 firms ≥ 100; aggregate shortfall 19.
- Honest residuals: agriculture (−10 across small+medium),
  healthcare-facilities small (−5), facilities-management small (−4),
  and the structural standing qualifications (sandbox-hosted single port;
  operational-plane durability; fixture WORLD; unauthenticated actor
  identity; providers CONTRACT_ONLY) are unchanged.
- Next per the handoff roadmap: **F360** (TL-owned product/transaction
  contract freeze for the equipment marketplace) before any F361 dispatch.
