# F331B — Security corpus time seam + census + parameterization (Wave 13 lane B)

- **Work item:** F331B (`spec/work-items/WORK-ITEM-CATALOG.md`, Wave 13;
  `docs/tech-lead/packets/f331b.md` — the binding lane contract).
- **Worker:** B (safety-and-intelligence). **Date:** 2026-10-12.
- **Branch:** `work/f331b`. **Base:** `e2103c6` (main HEAD at session start —
  NEWER than the packet's reference `a215420`; recorded per the base-check
  law). The final nominated commit is the branch tip at delivery time
  (§7 records the exact SHAs).
- **Ownership:** every changed path lies in `packages/acceptance/security/**`
  (worker-B owned, `spec/worker-ownership.yaml`) plus this report file.
  `packages/acceptance/adoption/**` and `packages/acceptance/release/**`
  were NOT touched (TL-owned, no path grant — D11).

## 1. Mission and outcome (one paragraph)

The security corpus gained the honest time-parameterization foundation:
a behavior-preserving `startedAt`-class time seam on the security runner
(machine-proven byte-identical at the corpus's default anchor — the base
151 tests stay green with the base digests pinned), a machine-run D12
census of all 27 journeys across the frozen 7-Δ grid at
`T0 = ADOPTION_T0 = 1_774_000_000_000`, and the D10 parameterization
adjudication. The census machine-measured **exactly 2 responders, both
transition-class (D2(b) family), both at Δ=+365d ONLY** — their domain
transitions cross at Δ ≈ +206.4d, OUTSIDE the frozen D9 schedule
`[T0, T0+30d, T0+90d]` — so they are schedule-excluded and the
parameterization set is **EMPTY**: zero security journeys carry per-epoch
expectation tables this wave; all 27 stay single-counted, declared. Per
the lane law this is a valid and complete outcome: the census is the
delivery. No counting semantics changed (the TL adjudicates at F332).

## 2. The time seam (deliverable 1)

### 2.1 Design

- `src/journey-contracts.ts`: `JourneyStepContext extends JourneyRecorder`
  gains `startedAt: number` — the run's absolute epoch-ms logical anchor.
  `JourneyStep.run` is widened to `(ctx: JourneyStepContext) => void`
  (contravariant-compatible: journeys that ignore the anchor are
  unchanged by construction).
- `src/runner.ts`: `runJourney(journey, options?: SecurityRunOptions)` with
  `SecurityRunOptions = { startedAt?: number }`; `runAllJourneys(journeys,
  options?)` threads one anchor across the corpus. The **default anchor is
  `SECURITY_CORPUS_T0 = NOW_MS = 1_791_831_000_000`** (the corpus fixture's
  fixed logical now, `src/journeys/fixture-world.ts`) — the same semantic
  shape as the field corpus's `ctx.clock` seam (F330 §1.2): a run without
  options computes byte-identically to the pre-seam corpus.
- `src/journeys/**` (20 files): every `NOW_MS`/`NOW_ISO` consumption site —
  the corpus's ACTIVE clock (event times, "now"-style domain call
  parameters, ISO renderings) — now reads the runtime anchor
  (`ctx.startedAt` / `isoOfEpochMs(ctx.startedAt)`); shared composition
  helpers (`wave10-world.ts`: `e2eActionChain`, `missionLedger`,
  `missionAction`, `hostCtx`, `hostJourneySlice`, `e2eAuditEvents`) gained
  `nowMs` parameters (default `NOW_MS`). The fixture world's
  **BASE_MS-anchored reference data** (PUMP_OBSERVATIONS, journals,
  twin-state `asOfMs`, suppression boundary probes) stays FIXED — the
  anchor moves the run's active clock against a fixed reference universe,
  which is what makes the census a real measurement: the anchor genuinely
  flows into domain calls (`expireSuppressions(now)`, `dueCommands(state,
  now)`, `classifyStaleness(originMs, nowMs)`, `scoreBenchmarkSet({ nowMs })`,
  `buildPredictionAdvisoryCard({ nowMs })`, `verifyGrantChain(grants, id,
  now)`, …).

### 2.2 Zero-behavior-change proofs (machine)

1. **Base-digest byte-identity** (`tests/seam.test.ts`): the 27 journey
   digests harvested from the BASE tree (`e2103c6`, pre-seam) are pinned as
   `BASE_CORPUS_DIGESTS`; the post-seam default run reproduces every digest
   and the full pass vector exactly. This gate ran after EVERY threading
   batch — any value change anywhere would have moved a digest and failed
   the suite.
2. **Explicit-default identity**: `runJourney(j, { startedAt:
   SECURITY_CORPUS_T0 })` ≡ `runJourney(j)` (same digests).
3. **D2(c) discipline**: same-anchor re-runs are byte-identical at any
   anchor (tested at the fixture clock and at two adoption anchors).
4. **Seam reality**: a probe journey records `ctx.startedAt` verbatim
   (fail-loud if the anchor could not reach a step).
5. **Cross-suite parity**: the TL-owned adoption suite (which consumes the
   security corpus through `runSecurityJourney`) is IDENTICAL at the base
   tree and this branch: 83 pass / 12 fail at both (the 12 are the
   documented, pre-existing Wave-13 count-pin transition at this base —
   re-pins are TL-owned at F332). Field 97/97, commerce 115/115,
   convergence 82/82 green and unaffected; release shows the identical
   pre-existing 4 pin failures at both trees (field 31 vs 30, commerce 36
   vs 34 — the F331A/F331C-era transition; nothing security-related).

The seam is drop-in compatible with the F332 phase-2 wiring: main's
`adoption-run.ts` imports `runJourney as runSecurityJourney` from
`@fleetos/acceptance-security` and its `TODO-F332-SECURITY` marker awaits
exactly this optional `{ startedAt }` option (the commerce composition-site
shape).

## 3. The census (deliverable 2 — D12, census-before-variants)

Method (F330 §1.1, binding): run the corpus through the seam at
`T0 = ADOPTION_T0 = 1_774_000_000_000` for
Δ ∈ {−1h, +1s, +1h, +1d, +30d, +90d, +365d}; a journey RESPONDS at Δ when
its corpus-mode pass/fail flips vs the T0 baseline. Machine-measured by
`runSecurityCensus()` (`src/census.ts`); every number below is asserted by
`tests/census.test.ts` (the declared table is pinned to the measurement —
this report cannot lie).

### 3.1 Structural preface (honest framing of the regime)

The security corpus's fixture clock is anchored at
`BASE_MS = 1_791_830_400_000` (2026-10-12); the adoption clock is anchored
at `ADOPTION_T0 = 1_774_000_000_000` (2026-04). The census measures the
corpus AT THE ADOPTION ANCHORS — the D9-schedule regime in which firm
epochs would execute — so the run's active clock sits ~206 days away from
the fixture reference universe at Δ=0. The T0 baseline is therefore NOT
27/27 green: **19/27 pass; 8 fail** — the 8 failures are
absolute-timestamp equality pins (the D13 echo family) on anchor-derived
readings, which fail uniformly in the displaced regime.

### 3.2 The full machine table (27 journeys × 8 anchors)

| journey | T0 | −1h | +1s | +1h | +1d | +30d | +90d | +365d | census result |
|---|---|---|---|---|---|---|---|---|---|
| security.investigate-finding | pass | pass | pass | pass | pass | pass | pass | pass | invariant (byte-identical) |
| security.understand-evidence | pass | pass | pass | pass | pass | pass | pass | pass | invariant (byte-identical) |
| security.guardian-decision | fail | fail | fail | fail | fail | fail | fail | fail | non-responder (echo-uniform) |
| security.action-plan | pass | pass | pass | pass | pass | pass | pass | pass | invariant (byte-identical) |
| security.execution-ledger | fail | fail | fail | fail | fail | fail | fail | fail | non-responder (echo-uniform) |
| security.reasoning-context | pass | pass | pass | pass | pass | pass | pass | pass | invariant (byte-identical) |
| security.predictive-advice | fail | fail | fail | fail | fail | fail | fail | **PASS↑** | RESPONDER — transition |
| security.counterfactual-reasoning | pass | pass | pass | pass | pass | pass | pass | pass | invariant (byte-identical) |
| security.inspect-why | pass | pass | pass | pass | pass | pass | pass | pass | invariant (byte-identical) |
| security.learn-from-outcomes | pass | pass | pass | pass | pass | pass | pass | pass | invariant (byte-identical) |
| security.benchmark-trust | fail | fail | fail | fail | fail | fail | fail | **PASS↑** | RESPONDER — transition |
| security.agent-safety | pass | pass | pass | pass | pass | pass | pass | pass | invariant (byte-identical) |
| security.tenant-fail-closed | pass | pass | pass | pass | pass | pass | pass | pass | invariant (byte-identical) |
| security.guardian-e2e | fail | fail | fail | fail | fail | fail | fail | fail | non-responder (echo-uniform) |
| security.mission-replay | pass | pass | pass | pass | pass | pass | pass | pass | invariant (byte-identical) |
| security.predictive-honesty | pass | pass | pass | pass | pass | pass | pass | pass | invariant (byte-identical) |
| security.host-surface | pass | pass | pass | pass | pass | pass | pass | pass | invariant (byte-identical) |
| security.tamper-evident-audit-ledger | pass | pass | pass | pass | pass | pass | pass | pass | invariant (byte-identical) |
| security.finding-storm-triage | pass | pass | pass | pass | pass | pass | pass | pass | invariant (byte-identical) |
| security.finding-suppression-lifecycle | pass | pass | pass | pass | pass | pass | pass | pass | invariant (byte-identical) |
| security.verified-execution-dispatch | fail | fail | fail | fail | fail | fail | fail | fail | non-responder (echo-uniform) |
| security.action-compensation-rollback | fail | fail | fail | fail | fail | fail | fail | fail | non-responder (echo-uniform) |
| security.capability-store-dr | pass | pass | pass | pass | pass | pass | pass | pass | invariant (byte-identical) |
| security.outcome-evaluation-adoption | pass | pass | pass | pass | pass | pass | pass | pass | invariant (byte-identical) |
| security.jepa-family-honesty | fail | fail | fail | fail | fail | fail | fail | fail | non-responder (echo-uniform) |
| security.degradation-staleness-honesty | pass | pass | pass | pass | pass | pass | pass | pass | invariant (byte-identical) |
| security.posture-fold-determinism | pass | pass | pass | pass | pass | pass | pass | pass | invariant (byte-identical) |

Machine facts pinned by the census tests:

- **19 invariant journeys**: byte-identical (SAME digest) at T0 and every
  Δ — anchor-insensitive at the reading level, not merely non-flipping.
- **6 echo-uniform non-responders**: `guardian-decision` (pin `gd-22` =
  1791831000000), `execution-ledger` (`ex-9` = 1791831002000),
  `guardian-e2e` (`ge-26`, `ge-35`), `verified-execution-dispatch`
  (`vd-8` = 1791831004000, `vd-24` = 1791831000000),
  `action-compensation-rollback` (`cr-12` = "2026-10-12T18:51:00.000Z"),
  `jepa-family-honesty` (`jf-4` = "2026-10-12T18:50:00.000Z") —
  absolute-timestamp equality pins that fail with the SAME assertion set
  at every anchor (uniform) while their digests MOVE with the anchor
  (machine-evidenced: the readings move, pass/fail never flips). Per the
  census's flip definition they are non-responders; per D13 their pins are
  echo-class count-only variations that NEVER earn epoch counts.
- **2 responders — both transition-class (D2(b) family), both +365d only:**

| responder | domain family | mechanism (machine-probed) | crossing |
|---|---|---|---|
| security.predictive-advice | staleness-class transition | `classifyStaleness(originMs = fixture BASE_MS+3s, nowMs = anchor)`: "fresh" while the anchor is inverted-past the fixture universe; the pinned "unknown" returns once the anchor passes the staleness window (60s over the origin) | anchor > BASE_MS+63_000 ⇒ Δ = +17_830_463_001 ms ≈ +206.4d |
| security.benchmark-trust | realized-outcome window boundary | `scoreBenchmarkSet` REFUSES `now-before-realized` while the anchor precedes the fixture journals' realized outcomes (BASE_MS+5s) — "scoring degraded: partial-case-set (2 of 2 cases unscoreable)"; inclusive boundary | anchor ≥ BASE_MS+5_000 ⇒ Δ = +17_830_405_000 ms ≈ +206.4d |

Both crossings were machine-probed to the exact millisecond (asserted in
`tests/census.test.ts`): `benchmark-trust` fails at `BASE_MS+4_999` and
passes at `BASE_MS+5_000`; `predictive-advice` fails at `BASE_MS+63_000`
and passes at `BASE_MS+63_001`. Both crossings lie strictly between +90d
and +365d.

## 4. Parameterization (deliverable 3 — D10 adjudication)

**The parameterization set is EMPTY** (`PARAMETERIZED_SECURITY_JOURNEYS =
[]`, machine-enforced). The two census-certified transition-class
responders are **schedule-excluded**: their flips occur only at Δ=+365d,
while the frozen D9 schedule is `[T0, T0+30d, T0+90d]` (TL-owned spacing;
no lane may choose its own). Within the frozen schedule:

- both responders FAIL at all three anchors identically (the inverted
  regime persists through +90d), so D10(2) "every epoch passes" is
  impossible, and
- no journey produces pairwise-distinct asserted readings on the schedule
  (machine-checked: every journey either fails uniformly at the three
  anchors or is byte-identical across them).

This is the F330 `evidence-gated-recovery` precedent applied forward:
out-of-schedule response is recorded honestly, no slot filled. All 27
security journeys stay single-counted — declared, not silently dropped.
An echo-class or past-only responder would likewise have earned nothing
(D13); none was measured (zero flips at ±1s; zero flips at −1h).

## 5. Machine-run evidence (verification battery)

Commands and exact results (this lane's owned suites + cross-suite
parity; all at the branch tip):

| gate | command | result |
|---|---|---|
| security suite | `pnpm --filter @fleetos/acceptance-security test` | **166/166 green** (base 151 + 15 new: 5 seam + 10 census), 7 test files (base 5 + 2 new), grow-only — nothing removed or renamed |
| typecheck | `pnpm --filter @fleetos/acceptance-security typecheck` | exit 0 |
| lint | `pnpm --filter @fleetos/acceptance-security lint` | 0 warnings, 0 errors (35 files) |
| pre-gate ref sync | `git fetch origin main:main` | main advanced `e2103c6 → d462dd0` (F332 phase-1 merged) — boundary re-checked against the fresh ref |
| boundary | `git diff --name-only main...HEAD` | 30 paths incl. this report, ALL `packages/acceptance/security/**` + `docs/evidence/F331B/report.md` — no TL-owned suite path, no sibling-lane path |
| file law | max journey-family file | 367 lines (`guardian-e2e.ts`) — ≤400 ✓ |
| adoption parity (TL-owned suite, evidence only) | `pnpm --filter @fleetos/acceptance-adoption test` | 83 pass / 12 fail — IDENTICAL to the base tree `e2103c6` (the 12 are the documented pre-existing pin transition; re-pins TL-owned at F332) |
| field / commerce / convergence | `pnpm --filter … test` | 97/97, 115/115, 82/82 — green, unaffected |
| release (TL-owned, evidence only) | `pnpm --filter @fleetos/acceptance-release test` | identical pre-existing 4 pin failures at base and this tree (field 31/30, commerce 36/34, 2613/2523 — the F331A/F331C-era transition; nothing security-related) |

Corpus shape (unchanged, grow-only in tests only): 27 journeys,
933 assertions, 66 steps. No journey was added, removed or renamed; no
assertion was altered (the base-digest proof pins them all).

## 6. Honest limitations

- **L-1 (the displaced regime is structural):** the security corpus's
  fixture clock (BASE_MS, 2026-10-12) predates and differs from the
  adoption clock (ADOPTION_T0, 2026-04). The census therefore measures the
  corpus in a regime ~206d displaced from its fixture universe: the 8
  echo-pin journeys fail uniformly there, and the two genuine transitions
  cross only at ≈ +206.4d. This is an honest property of the corpus as
  built, NOT remediated this wave: re-pinning the 8 journeys' absolute
  pins to adoption-anchored values would change counted behavior and is
  TL-adjudicated territory (it would also change nothing about
  parameterization — D13 excludes echo pins regardless).
- **L-2 (baseline quality):** the census's T0 baseline is 19/27 green —
  unlike the field census's 30/30 — for the L-1 reason. Flip measurement
  against a partially-failing baseline is still exact (a flip is a flip),
  but echo-movers are invisible by construction (fail→fail). The census
  records them as echo-uniform non-responders with machine evidence that
  their digests move; whether the TL counts "readings move but pins fail
  uniformly" as response for any purpose is F332 adjudication, not mine.
- **L-3 (grid granularity):** the census grid is the frozen 7-Δ set; the
  +206.4d crossings are inferred from the grid plus exact boundary probes
  (machine-asserted). No claim is made about behavior between grid points
  beyond the probed boundaries.
- **L-4 (sandbox):** all gates ran in this sandbox (single package suites
  + cross-suite parity runs); the 16 GB builder full-gate re-run is the
  TL's F332 convergence step, per the standing doctrine.
- **L-5 (Amendment A context):** main's F332 phase-1 records this lane as
  "platform-blocked at packet freeze (3 dispatch attempts evidenced)".
  This delivery un-blocks the security side: the seam shape
  (`runJourney(j, { startedAt })`, optional, default = fixture clock) is
  drop-in for the `TODO-F332-SECURITY` composition site. Whether F332
  phase-2 wires security epochs at the frozen anchors is TL-owned; the
  census says what they would find (see L-1/L-2: uniform failure or
  byte-identity — zero countable security epochs at the D9 schedule).

## 7. Delivery record

- Branch `work/f331b`, base `e2103c6`, WIP pushes at `5ba8462` (seam core
  + byte-identity proof), `878cd82` (full anchor threading), `0bbadb7`
  (census + declared table + tests), plus this report commit (the final
  nominated tip).
- The census table, the declared classes, the crossing boundaries and the
  empty parameterization set are machine-enforced by
  `packages/acceptance/security/tests/census.test.ts`; the zero-behavior-
  change law by `packages/acceptance/security/tests/seam.test.ts`
  (`BASE_CORPUS_DIGESTS` pinned from `e2103c6`).
