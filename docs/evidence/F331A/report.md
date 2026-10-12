# F331A — Field epoch parameterization + edge OTA campaigns (Wave 13 lane A)

- **Work item:** F331A (`spec/work-items/WORK-ITEM-CATALOG.md`, Wave 13; the
  F310C §3.5 row-36 field half + row 39).
- **Worker:** A (edge-and-asset). **Lane packet:** `docs/tech-lead/packets/f331a.md`
  (the contract); count law: `docs/evidence/F330/report.md` (D7–D13, binding).
- **Base:** `a215420` (main HEAD at dispatch — the F331 packets commit).
- **Lane tip:** `work/f331a` (this commit; see the exact SHA in the final
  report message — the repository is the source of truth).

## 1. What this lane delivers

1. **The field runner epoch-execution capability** (D10's proof form,
   mechanically enforced — §3).
2. **The 4 count-eligible journeys parameterized** with census citations
   (D8/D10 — §4).
3. **Both echo-class rewrites landed** per the D8 rewrite rule (§5) — no
   honest-failure was needed; every rewrite decision is documented for the
   TL's F332 adjudication.
4. **The exclusion + the 23 invariants declared** (D8 — §6).
5. **Row 39 — the edge firmware/OTA campaign capability** (a REAL
   `@fleetos/maintenance` module + its journey — §7).

The counting gate itself is TL-owned at F332 (D11); this lane delivers
capability + machine proofs, never counting changes.

## 2. Machine-run evidence (this tree, exact commands + numbers)

| gate | command | result |
|---|---|---|
| field suite (owned) | `pnpm --filter @fleetos/acceptance-field test` | **97 tests / 6 files, all green** (base at `a215420`: 79 / 5 — grow-only: +1 OTA journey test, +17 epoch-law tests, 2 count-pin tests edited in place 30→31) |
| OTA domain suite | `pnpm --filter @fleetos/maintenance test` | **99 tests / 5 files, all green** (base 77 — +22 firmware-campaign tests) |
| experience suite (timeline extension) | `pnpm --filter @fleetos/experience-asset-field test` | **88 tests / 5 files, all green** (unchanged count — the extension is backward-compatible at T0) |
| typecheck (owned) | `pnpm --filter @fleetos/acceptance-field --filter @fleetos/maintenance --filter @fleetos/experience-asset-field typecheck` | exit 0 |
| lint (owned) | same filter, `lint` | 0 warnings, 0 errors (file law ≤400 enforced by oxlint max-lines — all touched files pass) |
| corpus at T0 | inside the field suite | 31/31 journeys pass; every parameterized journey's T0 outcome digest equals its epoch-0 outcome digest (the parameterization changed nothing at T0) |
| corpus grow-only (machine-measured, both trees; step/assert counts cross-checked against `assembleAcceptanceReport` on the lane tree and the same grep-of-base-files on `main`) | base **30 journeys / 352 steps / 543 assertions** → lane **31 / 390 steps / 607 assertions** (+1 journey; +38 steps = +30 OTA-journey steps + 8 review/rollup steps across the reworked journeys; +64 assertions = +43 OTA journey + 21 across the 4 parameterized + 2 rewritten journeys; nothing removed) |
| adoption transition (TL-owned, read-only measurement) | `pnpm --filter @fleetos/acceptance-adoption test` | 84 pass / **11 count-pin failures** — exactly the documented transition (§8), same class as the F321A precedent; NO adoption/release file was touched by this lane |

## 3. The epoch-execution capability (D10, mechanical)

`packages/acceptance/field/src/epoch-schedule.ts` — the D9 frozen schedule
(TL-owned values, restated for machine enforcement): small `[T0]`, medium
`[T0, T0+30d]`, large `[T0, T0+30d, T0+90d]`; `T0 = 1_774_000_000_000`,
30d = `2_592_000_000`, 90d = `7_776_000_000`; plus the F330 §1.1 census
declarations as a machine-checkable table (30 rows: 4 count-eligible, 2
rewrite-eligible, 1 excluded, 23 invariant).

`packages/acceptance/field/src/journey-contracts.ts` — the schema (D10(1)):
`JourneyAssertion.perEpoch?: EpochExpectation[]` (one entry per declared
anchor) + `AcceptanceJourney.epochs { censusCitation, anchors }` (D10(3)).

`packages/acceptance/field/src/runner.ts`:

- `resolveAssertionForAnchor` — a responding assertion resolves its table
  entry whose `at` equals the execution anchor; a missing entry FAILS the
  runner (an epoch without an expectation is not an executable epoch).
- `runJourneyEpochs(journeys, { schedule })` — runs every journey that
  declares `epochs` at every schedule anchor and mechanically enforces:
  1. per-epoch table evaluation (via the resolution above);
  2. the journey PASSES at every anchor (steps + assertions);
  3. D2(c): a same-anchor re-run is byte-identical (digest comparison);
  4. D2(d): for EVERY pair of anchors the ASSERTED readings (assertion
     actual vectors) differ on ≥1 assertion — two epochs agreeing on every
     asserted value is an ERROR (a byte-identical re-run is never a distinct
     journey, D13);
  5. D10(1) consistency: every per-epoch table's anchor-0 entry equals the
     single-valued `expected`;
  6. census certification: only count-eligible/rewrite-eligible journeys may
     declare epochs (a rogue or invariant journey declaring epochs is
     refused), and only D9 anchors may be executed.

`tests/epochs.test.ts` (17 tests) pins all of the above plus the D13
never-count laws: the past-only exclusion is machine-verified (the excluded
journey is byte-identical across the frozen forward schedule), invariant
journeys are byte-identical across the schedule, and a lane-chosen anchor
outside D9 is refused.

## 4. The 4 count-eligible parameterizations (census citations in-code)

All six parameterized journeys declare
`anchors = [T0, T0+30d, T0+90d]` (the large-firm schedule; medium's is a
prefix) with the F330 §1.1 row verbatim as the census citation.

| journey | census row (F330 §1.1) | responding assertions (per-epoch actuals) | transition family |
|---|---|---|---|
| `maintain-asset-schedule` | transition (forward) \| +1d and beyond \| maintenance window/deadline | `m1` plan.nextRunAt = [T0+1d, T0+31d, T0+91d] | the REAL `nextRun(schedule, now)`: pre-start → in-cycle (the daily plan's next boundary — the census-certified flip) |
| `connectivity-postures` | transition (bidirectional) \| ±1h and beyond \| posture window transitions | `c11` observedOnline [2,0,0], `c11b` observedDegraded [0,2,2] (default 30s/120s TTL); `c19` observedOnline [1,1,0], `c20` observedDegraded [0,0,1] (quarterly-audit TTL 45d/120d) | honest-posture staleness classes: the SAME absolute heartbeat calendar classified against each epoch clock; the +30d epoch is still fresh under the 45d policy while +90d has crossed the stale boundary |
| `edge-command-lifecycle` | transition (bidirectional) \| ±1h and beyond \| command lifecycle | `a11` windowed total [1,0,0], `a13` status [healthy,degraded,degraded] (T0+60s audit); `a23` status [degraded,healthy,degraded], `a24` total [0,1,0] (month-later audit at T0+30d+60s) | the adapter-health evidence windows: command outcomes stamped at the epoch anchor, audited at fixed calendar moments |
| `host-maintenance-intent-to-verification` | transition (forward) \| +1d and beyond \| scheduled verification | `w5` plan.nextRunAt = [T0+1d, T0+31d, T0+91d] | same `nextRun` scheduled-verification family through the host intent path |

Journey-fact adjustments (documented for F332 adjudication, both required
for the journey to execute green at every anchor):

- **connectivity-postures grants:** the two authorization grants'
  `expiresAt` moved from `T0+1h` to `T0+90d+1h`. The grants are auxiliary
  domain facts (the census-certified responding family is the posture
  windows, not the grant lifecycle); at the frozen schedule's later anchors
  a T0-expiring grant would refuse the `authorize` step and the journey
  could not execute at all. No grant reading is an asserted responder.
- **edge-command-lifecycle reboot deadline:** `expiresAt` moved from
  `T0+10s` to `T0+90d+10s` and the expiry sweep's `now` from `T0+20s` to
  `T0+90d+20s` (the deadline spans every anchor; the sweep still terminates
  the overdue reboot at every epoch — `a17` stays invariantly 1). The
  responding readings remain the health evidence windows.

New REAL API parameters threaded through (no behavior change at defaults):
`connectivity.rollup-posture { ttl }` (the `rollupFleetPosture` TTL policy —
the quarterly-audit policy 45d/120d is how the +30d/+90d epochs land in
distinct staleness classes; the lane default 30s/120s saturates both at
"degraded") and the month-later audit step (`adcos.health-rollup` at
`T0+30d+60s`).

## 5. The 2 echo-class rewrites (D8 rewrite rule)

**Verdict: both rewrites LANDED.** The absolute-timestamp pins (the `ageMs
== 20_000` arithmetic echoes at ±1s) are replaced by genuine D2(b)-family
transition expectations on the SAME domain API surface, with every non-time
assertion intact. No table entry is a timestamp-equality pin (the asserted
readings are classification enums, counts and case ids).

The mechanism (both journeys, mirrored):

- **As-of window membership** (`packages/experiences/asset-field/src/ops/recovery-timeline.ts`,
  worker-A owned): the open-recovery board is AS-OF its `now` — a case
  whose `openedAt` lies in the future of `now` is not on the board (window
  boundary open/close). At the journeys' fixed T0+10s/20s/30s review
  moments, the epoch's case appears only once its existence window has
  opened: `r3` open [1,0,0], `r8` case0.state [investigating,null,null],
  `r9` stepCommands [[investigate],[],[]] (and `e6/e7/e8` on the host
  route).
- **Case staleness classification** (same file): every on-board case
  carries its staleness class against the view's thresholds (the
  established fresh/stale/unknown vocabulary — `CaseTimeline.staleness`).
  The REPLACED pins: `r10` and `e9` now assert the case's staleness class
  (fresh at T0; absent at the later anchors' fixed review moments).
- **The late-quarter review** (new steps): at `T0+60d` (the midpoint of the
  +30d/+90d anchors) under the case-SLA policy thresholds (fresh ≤15d open,
  stale ≤45d — a REAL read-model parameter: `view.recovery-timeline
  { thresholds }` / `host.build-view-models { caseStalenessThresholds }`,
  the latter a backward-compatible host-surface build option), a second
  still-open tracking case (the recurring battery degradation — a real
  fleet-ops scenario) classifies: `r21`/`e18` staleness **[unknown, stale,
  null]** — 60d-old at T0, 30d-old at +30d, not-yet-open at +90d: three
  distinct D2(b) classes; `r19`/`e17` open [1,1,0]; `r20`/`e19` caseId
  [rc-…-0002, rc-…-0002, null].

Honesty notes for the TL's F332 adjudication: (1) the rewrites extend the
worker-A-owned recovery timeline read-model with as-of semantics + the
staleness classification (the read-model previously had neither — only the
raw `ageMs`); the D8 rule explicitly frames the rewrite as lane work on the
same domain API surface; (2) the case-SLA thresholds (15d/45d) and the
T0+60d review moment are policy parameters sized to land the frozen epochs
in distinct classes — the schedule spacing itself is untouched (D9); (3)
the mid-journey review moments remain the original absolute T0-calendar
times; only the late review is new. If the TL adjudicates any rewrite as
not genuinely transition-class, the journeys revert to single-counted by
removing their `epochs` declaration — the runner's census gate refuses
nothing else.

## 6. The exclusion + the invariants (D8)

- **Excluded:** `evidence-gated-recovery` — past-only response (F330 §1.1);
  NO epochs declared. Machine-verified: the journey is byte-identical
  (same outcome digest) across the whole frozen forward schedule.
- **23 invariant journeys:** NO epochs declared (the census list is
  machine-checked against the corpus in `tests/epochs.test.ts`; three
  invariants are spot-verified byte-identical across the schedule).

## 7. Row 39 — the edge firmware/OTA campaign capability

**Domain module (REAL, worker-A owned):**
`packages/maintenance/src/firmware-campaign{,-journal,-progress}.ts`
(split for the ≤400-line file law) + 22 domain tests. Pure deterministic
TypeScript, logical time, tenant fail-closed, no new package dependencies:

- **Staged campaign waves** — explicit device cohorts, waves strictly in
  order (`wave-out-of-order`), one deploying at a time, a wave auto-verifies
  when every cohort device reported, the last verified wave completes the
  campaign; declaration refuses version regressions, malformed versions,
  duplicate wave ids, empty waves, a device in two waves.
- **Halt** — reason required (`halt-reason-required`), freezes the campaign
  (`campaign-halted` for wave starts/outcomes); **resume** restores the
  pre-halt sub-state; **rollback** — only after a halt (`halt-first`),
  only over devices that actually applied (`no-applied-devices`), the
  rollback wave reports per device (`unknown-device-ref` for
  never-applied, `duplicate-device-outcome` for repeats) and terminates the
  campaign `rolled-back`.
- **Journal** — append-only, hash-chained (FNV-1a 32, the lane convention),
  machine-verifiable; **progress read model** — per-wave
  targeted/applied/failed/pending + campaign totals + digest.

**Journey:** `edge-firmware-ota-campaign` (persona `edge-operator`,
capability `maintenance` — the frozen 14-capability vocabulary's
maintenance family; no vocabulary change, F321A precedent). 30 steps (10
refusal paths), **43 assertions**: staged waves, halt/resume, mid-wave
halt, rollback over applied devices, every illegal move refused, journal
tamper-evidence, progress digest. Corpus 30 → 31 journeys.

## 8. The adoption count-pin transition (TL-owned — measured, not modified)

`pnpm --filter @fleetos/acceptance-adoption test` at this tree: **84 pass /
11 count-pin failures** (the F321A precedent class; the TL re-pins at
F332). Machine-measured transition vs the Wave-12 pins:

| measure | Wave 12 (pins) | this lane tree |
|---|---:|---:|
| field corpus | 30 journeys | **31** |
| fieldExecutions | 855 | **885** (+30) |
| journeyExecutions (COUNTED) | 2,523 | **2,553** (+30) |
| uniqueApplicableJourneys | 841 | **851** (+10 = +1 unmasked journey × 10 industries) |
| fieldEpochReRuns (raw, never counted) | 855 | **885** |
| fully-applicable firm cap | 91 | **92** (+1, F330 §3's row-39 arithmetic) |

No `packages/acceptance/adoption/**` or `packages/acceptance/release/**`
file was touched (D11 — no path grant). The release suite is expected to
show the analogous pin transition (not run — TL-owned).

## 9. Boundary + laws

- `git diff --name-only main...HEAD` (after `git fetch origin main:main`):
  26 paths + this report — all under `packages/acceptance/field/**`,
  `packages/experiences/asset-field/**`, `packages/maintenance/**`
  (worker-A owned per `spec/worker-ownership.yaml`). No TL-owned, no
  sibling-lane path touched.
- File law: every touched/created file ≤400 lines (oxlint max-lines with
  skipBlankLines/skipComments — 0 errors).
- Vocabulary law: no PERSONAS/CAPABILITIES change; the new journey lands on
  the frozen vocabulary.
- Providers: CONTRACT_ONLY upheld — no provider API is driven anywhere.
- D13: no byte-identical re-run is counted (the epoch runner errors on
  epoch-pair agreement); no synthetic telemetry; no echo pins in any
  per-epoch table.

## 10. Honest limitations

- **L-1:** the epoch tables' values are hand-derived from the domain
  semantics and then machine-verified by the runner at every anchor (the
  tables cannot silently disagree with the REAL outputs — a wrong entry
  fails the suite). The derivation is documented per journey in §4/§5.
- **L-2:** the echo rewrites extend the recovery-timeline read-model (as-of
  membership + staleness classification). The F330 census measured the
  pre-extension surface; the D8 rewrite rule frames the rewrite as lane
  work, but whether each rewritten journey's per-epoch variants COUNT is
  the TL's F332 adjudication against D2+D8–D13 — this lane claims the
  capability and the proofs, never the counting.
- **L-3:** the connectivity grants' windows and the reboot's ack deadline
  were sized to span the frozen schedule (§4) so the journeys execute green
  at every anchor; both are auxiliary facts outside the census-certified
  responding families. Recorded for adjudication.
- **L-4:** the quarterly-audit TTL (45d/120d), the case-SLA thresholds
  (15d/45d) and the T0+60d late-review moment are REAL read-model policy
  parameters chosen so the frozen epochs land in distinct staleness classes
  (the defaults saturate). They are journey/domain facts, not schedule
  changes — but the choice is documented as an honesty note, not hidden.
- **L-5:** the adoption/release pin transition (§8) is measured read-only;
  the sandbox did not run the release suite or the full monorepo gates
  (TL-owned; the 16 GB builder remains the gate of record).
- **L-6:** the OTA campaign module is exercised by its domain tests + the
  acceptance journey at logical time only — no live device fleet, no real
  firmware artifacts (consistent with the CONTRACT_ONLY provider boundary).
