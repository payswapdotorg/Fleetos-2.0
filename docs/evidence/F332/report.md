# F332 — Wave-13 counting-gate convergence (TL-delegated, two phases)

- **Work item:** F332 (`spec/work-items/WORK-ITEM-CATALOG.md`, Wave 13; the
  F330 §4 "F332 — TL convergence" contract, packet
  `docs/tech-lead/packets/f332.md`).
- **Worker:** F332 (TL-delegated grant). **Date:** 2026-10-13.
- **Base:** `e2103c6` (main HEAD at dispatch — the F332 combined packet on
  top of the F331A merge `34653b0` and the F331C merge `fdfed18`).
- **Branch:** `work/f332` (pushed). Phase-1 boundary `7471a9c` — ACCEPTED
  and merged by the TL at `d462dd0` (main; a clean merge, zero tree
  delta) while phase 2 was in flight; the D7 activation flip `889bb75`
  (its own commit); the phase-2 re-pins + this report on top (see the FINAL
  REPORT message for the exact tip SHA — the repository is the source of
  truth).
- **Canonical context read in order:** F330 report (D7–D13 binding), the
  f332 packet, F331A report (runJourneyEpochs + epoch-schedule + perEpoch
  schema), F331C report (commerce seam + census + the 2 certified
  responders), adoption-run.ts + firms.ts, F322 report (Wave-12 pins),
  FINAL-RELEASE-HANDOFF, spec/worker-ownership.yaml.

## 0. Delegation record (verbatim from the packet)

> D11 reserves `packages/acceptance/adoption/**` for the TL with "No path
> grant is issued" for the Wave-13 LANES. The operator's 2026-10-12
> directive (the TL orchestrates and dispatches workers; the TL does not
> self-implement) supersedes for F332's implementation. This grant is
> issued BY the TL for this packet only; you implement exactly the frozen
> F330 spec with zero discretion over values or semantics; the TL gates
> every line at merge.

The TL retains: the merge gates, the final verdict, and all browser
verification. Every D9 value, the D10 proof form and the D13 refusals are
implemented as frozen — never interpreted.

## 1. Two-phase design (WIP-push at each boundary)

**Phase 1 — the mechanism, landed INACTIVE (`7471a9c`, mergeable alone):**
the D9 schedule model in `firms.ts`; the counting gate as a new module
`epoch-gate.ts` (`EPOCH_COUNTING_ACTIVE = false` — D7's own words: "Until
the F332 convergence lands the counting gate, NO epoch variant counts");
both composition sites wired (field: `runJourneyCorpus` at the fixture
anchor while INACTIVE + the F331A `runJourneyEpochs` capability wired for
ACTIVE; commerce: the F331C seam at frozen anchors only; security: the
`TODO-F332-SECURITY` marker only); the gate battery `tests/f332.test.ts`;
and the documented Wave-13 transition re-pins (the F331A/F331C merges had
left the Wave-12 pins stale — 12 red adoption tests + 4 red release tests
at base, the F321A-precedent class; every re-pin value machine-measured by
the F332 probe on this tree, never copied).

**Phase 2 — activation + the honest ledger:** the flip as its own commit
(`889bb75`); the full 30-workspace simulation machine-run at ACTIVE; the
adoption + release expectations re-pinned to the ACTIVE machine-measured
numbers; this report + the one-line catalog append.

## 2. The D9 values as landed (F330 §2 — TL-owned, exact)

`firms.ts` `FIRM_EPOCH_SCHEDULES`: small `[T0]`; medium `[T0, T0+30d]`;
large `[T0, T0+30d, T0+90d]`; `T0 = ADOPTION_T0 = 1_774_000_000_000`;
`30d = EPOCH_30D_MS = 2_592_000_000`; `90d = EPOCH_90D_MS =
7_776_000_000`. Every pre-F332 export preserved (machine-checked in
`tests/firms.test.ts` + `tests/f332.test.ts` gate 2). Non-frozen anchors
are MISSING_EPOCH-style refusals at every composition site
(`assertFrozenEpochAnchor` — fail-closed, never a silent clamp) AND in the
REAL runners' own sentinels (commerce `MISSING_EPOCH`; the field
capability refuses non-D9 schedules) — machine-verified in
`tests/f332.test.ts` gate 3.

## 3. INACTIVE-parity proof (phase 1's core invariant — machine)

Method: the F332 probe (`scripts/f332-probe.mts`, outside the repo) ran
the full 30-workspace simulation on the PRISTINE base `e2103c6` and on the
phase-1 tree `7471a9c`, then field-compared the artifacts
(`scripts/f332-parity.mts`). Result: **PARITY OK — byte-identical on every
measured artifact**: the aggregate (journeyExecutions 2613, field 885,
commerce 957, security 771, fieldEpochReRuns 885, uniqueApplicable 871),
all 30 firms' counted executions, per-firm determinism runDigests, the
per-epoch digest vectors, and the honest-counts ledger. The ONLY
difference: each firm's declared `epochs` array changed from `[T0, T0,
T0]` to the D9 schedule — the deliverable itself. The mechanism moved
NOTHING while INACTIVE (D7's Wave-12 persistence holds byte-identically);
no pin moved except the already-documented transition re-pins to
machine-measured INACTIVE values.

## 4. The ACTIVE ledger (machine-measured at the frozen candidate)

Full simulation, 10 industries × 3 firms, the gate ACTIVE:

| measure | INACTIVE (base pins) | ACTIVE (measured) | delta |
|---|---:|---:|---|
| journeyExecutions (COUNTED) | 2,613 | **2,847** | +234 |
| fieldExecutions | 885 | **1,059** | +174 |
| commerceExecutions | 957 | **1,017** | +60 |
| securityExecutions | 771 | **771** | 0 (TODO-F332-SECURITY) |
| uniqueApplicableJourneys | 871 | **871** | 0 (journey-level) |
| fieldEpochReRuns (raw, never counted) | 885 | **406** | transparency metric, mode semantics (see §7-L4) |
| commerceEpochReRuns (raw, never counted) | 0 | **897** | the invariant journeys' epoch runs, D13-refused |
| determinismVerified / allJourneysPassed | true | **true / true** | the ACTIVE laws hold on all 30 firms |
| aggregateShortfall (Σ per-firm max(0, 100−counted)) | 387 | **205** | −182 |

Grow-only + never-weaken: every counted number only grew (2613→2847;
885→1059; 957→1017; 771→771 unchanged; 871→871 unchanged — epochs add
executions, never journeys); the 100 target is untouched; no mask
broadened (masks are byte-identical to base).

Per-firm counted numbers (base = the industry's applicable set; the
epoch counts are the census-certified responders' D9 epochs — +6/+12 field
and +2/+4 commerce for medium/large where all 6 field responders apply;
healthcare/facilities have 5 — `edge-command-lifecycle` masked):

| industry | small | medium | large | shortfall vs 100 (structural) |
|---|---:|---:|---:|---|
| manufacturing | 94 | 102 | 110 | small 94 (−6): single-journey remainder |
| construction | 91 | 99 | 107 | small −9 (1 field + 2 security masks); medium −1 |
| energy-utilities | 94 | 102 | 110 | small −6 |
| transportation-logistics | 87 | 95 | 103 | small −13 (2 field + 3 commerce + 2 security masks); medium −5 |
| agriculture | 76 | 84 | 92 | all sizes: 18 masked (2 field + 13 commerce + 3 security) |
| healthcare-facilities | 79 | 86 | 93 | 15 masked (4 field + 8 commerce + 3 security); 5 field responders |
| facilities-management | 80 | 87 | 94 | 14 masked (3 field + 8 commerce + 3 security); 5 field responders |
| telecommunications | 89 | 97 | 105 | small −11 (1 field + 4 commerce masks); medium −3 |
| mining | 92 | 100 | 108 | small −8 (1 field + 1 commerce mask); medium AT 100 |
| water-waste | 89 | 97 | 105 | small −11 (1 field + 4 commerce masks); medium −3 |

Firms at/above 100: **10** (the epoch-earning medium/large of the
fully-applicable industries). Every firm below 100 carries its exact
shortfall in the honest-counts ledger with the ACTIVE structural reasons
(per-industry masks + the size-bounded epoch arithmetic — small firms gain
NOTHING from epochs; their residual is single journeys alone, the honest
6-journey remainder named by F330 §3.6-c; NOT fabricated).

## 5. The census citation map (the exact journey IDs earning epoch counts)

8 journey IDs earn counted epochs (234 total counted epoch executions);
nothing outside the census-certified sets ever counts (D8/D12 closed
boundaries — machine-enforced by the gate):

| corpus | journey | counted epochs | D8 census citation (verbatim row of record) |
|---|---|---:|---|
| field | maintain-asset-schedule | 30 | F330 §1.1: transition (forward) \| +1d and beyond \| maintenance window/deadline |
| field | connectivity-postures | 30 | F330 §1.1: transition (bidirectional) \| ±1h and beyond \| posture window transitions |
| field | edge-command-lifecycle | 24 | F330 §1.1: transition (bidirectional) \| ±1h and beyond \| command lifecycle — masked in healthcare-facilities + facilities-management (24 = 8 industries × 3) |
| field | host-maintenance-intent-to-verification | 30 | F330 §1.1: transition (forward) \| +1d and beyond \| scheduled verification |
| field | recover-lost-device | 30 | F330 §1.1: echo (strict T0 pin) \| ALL Δ incl. ±1s \| absolute timestamp pin — REWRITTEN per the D8 rule (as-of window boundary + case staleness class) |
| field | host-health-evidence-timeline | 30 | F330 §1.1: echo (strict T0 pin) \| ALL Δ incl. ±1s \| absolute timestamp pin — REWRITTEN per the D8 rule (as-of window boundary + case staleness class through the host route) |
| commerce | marketplace-transaction-flow | 30 | F331C §5 census row 35: −1h, +1d, +30d, +90d, +365d \| transition (bidirectional) |
| commerce | tenant-billing-invoicing | 30 | F331C §5 census row 36: +1d, +30d, +90d, +365d \| transition (forward-only) |

The echo-class rewrite adjudication (D8's rewrite rule): both F331A
rewrites are consumed as delivered — the asserted readings are
classification enums/counts/case ids (no timestamp-equality pins), the
same-epoch byte-identity and pairwise asserted-reading distinctness are
machine-proven by the F331A capability at every counted anchor, and the
gate re-verifies both before counting. The rewrites'
journey-fact adjustments (grant windows, reboot deadline, quarterly-audit
TTL, case-SLA thresholds) were recorded by the lane (F331A §4-5,
limitations L-1..L-4) and stand for the TL's merge adjudication.

## 6. The F331B blockage record (the conditional section)

The security lane is **platform-blocked** (capacity crunch; 3 dispatch
attempts evidenced at packet freeze). No Amendment A section was added
in-tree by the TL before this delivery, so the marker stands: the security
composition site carries the precise `TODO-F332-SECURITY` marker
(adoption-run.ts module doc + the security site comment + epoch-gate.ts
module doc), security executes once per workspace through its
single-parameter REAL runner, stays single-counted at exactly its
applicable set (771 executions — machine-checked per firm in
`tests/f332.test.ts`), and NO security responder is ever assumed. Security
epoch variants are future capability work (a seam + census per D12) —
never counted here.

## 7. Honest limitations

- **L-1 (the delegated boundary):** this delivery implements the frozen
  F330 law under the TL's packet-scoped grant; the TL gates every line at
  merge and owns the verdict. The echo-rewrite adjudication notes above
  are records for that gate, not self-verdicts.
- **L-2 (latent corpus divergence — discovered and recorded):** during
  phase 2, the driver's first ACTIVE design executed the full field
  corpus at every D9 anchor; that run surfaced a REAL divergence the
  F330 census (measured pre-F331A) had classified as invariant: the
  handoff pair (`handoff-field-to-operator-publish`/`-consume`) is
  anchor-sensitive on the post-F331A tree (the consume journey's
  `k9` assertion — a T0-anchored single-valued expectation — fails at
  T0+30d; the publish journey's handoff carrier digest varies). Per D8
  rerun supremacy (the closed census set + F330 §1.2's
  expectation-frozen corpus law), non-certified journeys have NO epoch
  dimension: the packet-conformant design (the field composition site is
  `runJourneyEpochs` at the firm's schedule — declaring journeys only)
  never executes them out of their certified domain. The divergence is
  recorded here for the TL's corpus adjudication (an F331A-adjacent
  finding; the lane's in-suite invariant spot-checks covered only three
  journeys).
- **L-3 (transparency-metric semantics):** `fieldEpochReRuns` changed
  meaning at activation (885 → 406): INACTIVE reports the full corpus's
  fixture-anchor re-runs; ACTIVE reports the epoch-dimension executions
  that are not counted (the D2(c) same-epoch re-runs + the anchor-0
  re-executions). Both are raw, never counted; the counted numbers
  themselves only grew (grow-only held).
- **L-4 (the sandbox scope):** all gates ran in this sandbox (adoption
  120/120, commerce 115/115, field 97/97, security 151/151, convergence
  82/82, release 88/88, typecheck + lint clean on owned packages); the
  16 GB builder full clean-checkout gates (B-1/B-2 root typecheck/build,
  the monorepo test plane) and browser verification remain TL-owned (the
  F322 §5 doctrine — the sandbox TL environment cannot run them).
- **L-5 (pins are tree-scoped):** the re-pinned expectations are exact for
  THIS tree (the frozen candidate); any corpus change re-triggers the
  documented transition class (the F321A precedent), re-pinned only from
  machine-measured runs.

## 8. Verification battery (machine-run, exact numbers)

| gate | command | result |
|---|---|---|
| adoption suite (phase 2, NEW pins) | `pnpm --filter @fleetos/acceptance-adoption test` | **120/120** (9 files; incl. the 25-test f332 battery) |
| commerce | `pnpm --filter @fleetos/acceptance-commerce test` | **115/115** |
| field | `pnpm --filter @fleetos/acceptance-field test` | **97/97** |
| security | `pnpm --filter @fleetos/acceptance-security test` | **151/151** |
| convergence | `pnpm --filter @fleetos/acceptance-convergence test` | **82/82** |
| release (after re-pins) | `pnpm --filter @fleetos/acceptance-release test` | **88/88** |
| typecheck | `tsc --noEmit` (adoption + release) | exit 0 |
| lint | `oxlint src tests` (adoption) | 0 warnings / 0 errors |
| boundary | `git diff --name-only main...HEAD` | adoption/** + docs/evidence/F332/** + the one-line catalog append + the release test pins (§9) |
| file law | oxlint max-lines (400, skipBlank/skipComments) | every touched file passes; f332.test.ts ≤ 400 raw |

PRE-GATE REF SYNC (`git fetch origin main:main`) executed before each gate
run. The phase-2 battery's sync caught main advancing `e2103c6 →
d462dd0` — the TL's ACCEPT-merge of this delivery's own phase-1 boundary
(zero tree delta; no corpus or packet change; Amendment A NOT added — the
F331B blockage stands). All phase-2 gates above ran on the post-sync tree.

## 9. Boundary

`git diff --name-only main...HEAD` lists ONLY:
`packages/acceptance/adoption/**` (the delegated grant: firms.ts,
epoch-gate.ts NEW, adoption-run.ts, convergence-delta.ts, index.ts + the
test re-pins + tests/f332.test.ts NEW),
`packages/acceptance/release/tests/{release-gate,integration}.test.ts`
(the packet's explicit carve-out — "the re-pinned expectations in the
adoption/release test files"; expectation values only, never logic),
`docs/evidence/F332/report.md`, and the one-line catalog append in
`spec/work-items/WORK-ITEM-CATALOG.md`. No corpus package, no domain
package, no shared contract, no verdict constant outside the measured
numbers.
