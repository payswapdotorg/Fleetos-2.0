# F330 — Wave-13 epoch-count law activation freeze (TL preflight)

- **Work item:** F330 (`spec/work-items/WORK-ITEM-CATALOG.md`, Wave 13; the
  F320 **D6 future-activation path** exercised at the F322 verdict: cap 91/100,
  B-3 OPEN, shortfall 9).
- **Owner:** TL. **Date:** 2026-10-11 (post-recycle session; base `31bfe69` =
  main HEAD, the F322 final-candidate amendment).
- **Mission:** freeze the Wave-13 counting law BEFORE any lane dispatch, so the
  epoch-parameterization work (F310C §3.5 row 36) and the capability rows
  (34–35, 39) execute against an unambiguous, machine-measured law — the same
  preflight discipline as F320.

## 1. Machine-measured facts (this freeze's ground truth)

All measurements run at the converged Wave-12 tree (main `31bfe69`,
corpora field 30 / commerce 34 / security 27; counted 2,523; cap 91/100).

### 1.1 Field census (corpus mode, handoff-threaded)

Method: `runJourneyCorpus(FIELD_JOURNEYS, { startedAt: T0 + Δ })` — the exact
execution path `adoption-run.ts:148` uses for firm epochs — at
`T0 = ADOPTION_T0 = 1_774_000_000_000`
(`packages/acceptance/adoption/src/firms.ts:44`), for
Δ ∈ {−1h, +1s, +1h, +1d, +30d, +90d, +365d}. A journey **responds at Δ** when
its corpus-mode pass/fail flips vs the T0 baseline (30/30 pass at T0). This is
a superset-of-divergence measurement: a pass-flip proves a real outcome
change against the T0-anchored expectation table.

Result — **7 of 30 field journeys respond to time; 23 are invariant**:

| journey | response class | flips at | domain family |
|---|---|---|---|
| `maintain-asset-schedule` | transition (forward) | +1d and beyond | maintenance window/deadline |
| `connectivity-postures` | transition (bidirectional) | ±1h and beyond | posture window transitions |
| `edge-command-lifecycle` | transition (bidirectional) | ±1h and beyond | command lifecycle |
| `host-maintenance-intent-to-verification` | transition (forward) | +1d and beyond | scheduled verification |
| `evidence-gated-recovery` | transition (**past-only**) | −1h only | evidence window |
| `recover-lost-device` | echo (strict T0 pin) | ALL Δ incl. ±1s | absolute timestamp pin |
| `host-health-evidence-timeline` | echo (strict T0 pin) | ALL Δ incl. ±1s | absolute timestamp pin |

The 23 invariant journeys (machine list): `enroll-new-asset`,
`trustworthy-state-recency`, `investigate-injected-fault`,
`field-mode-offline-tolerance`, `simulation-driven-experiment`,
`mission-replay-resume`, `handoff-field-to-operator-publish`,
`handoff-field-to-operator-consume`, `mobile-field-shape`,
`tenant-isolation-fail-closed`, `host-discovery-device-360`,
`host-recovery-intent-to-verification`, `host-field-workflow-mobile-offline`,
`host-role-lens-tenant-fail-closed`, `store-and-forward-redelivery`,
`offline-buffer-capture-replay`, `ingestion-limits-admission-discipline`,
`diagnosis-lifecycle-supersession`, `anomaly-confidence-triage`,
`evidence-gated-recovery` is listed above (past-only),
`maintenance-calendar-scale`, `asset-lineage-material-lots`,
`identity-session-lifecycle`, `tenant-lifecycle-gating`.

Class law (adjudication, binding for the lanes):

- **Transition-class** — the flip is caused by a genuine time-driven domain
  transition (the D2(b) family: expiry, deadline breach/escalation,
  staleness-class transition, window boundary open/close, scheduled state
  transition, grant/session/lease lifecycle).
- **Echo-class** — the flipped assertion is an absolute-timestamp equality pin
  (fails at ±1s); the domain merely propagates the epoch anchor into a stored
  reading. An echo pin across epochs is a **count-only parameter variation**
  (F320 D3) and NEVER earns epoch counts by itself.
- **Past-only** — flips only for Δ<0; the frozen forward schedule (D9) can
  never exercise it, so it is **not parameterizable**.

### 1.2 Runner capability facts (unchanged from F320, re-verified)

- Field: `runJourneyCorpus({ tenantId, startedAt })` seam exists
  (`packages/acceptance/field/src/runner.ts:154-169`) — journeys are
  expectation-frozen (single T0-anchored table per journey).
- Commerce: `runAllJourneys` has **no time parameter**.
- Security: `runSecurityJourney` has **no time parameter**.
- `firms.ts:88` — every declared epoch carries the identical `ADOPTION_T0`;
  `FIRM_EPOCH_COUNTS` = small 1 / medium 2 / large 3
  (`packages/acceptance/adoption/src/firms.ts:47-51`).

## 2. The frozen Wave-13 count law (D7–D12)

**D7 — Activation.** Wave 13 activates the F320 D6 path: per-epoch distinct
journeys may count when ALL of D2(a)–(d) hold AND the Wave-13 conditions
below hold. Until the F332 convergence lands the counting gate, NO epoch
variant counts (the Wave-12 state persists: epoch 1 counted, later epochs
byte-identical re-runs).

**D8 — Census bound (field).** Only census-certified responding journeys may
carry per-epoch expectation tables. The field parameterization set:

- **Count-eligible now (4):** `maintain-asset-schedule`,
  `connectivity-postures`, `edge-command-lifecycle`,
  `host-maintenance-intent-to-verification`.
- **Rewrite-eligible (2):** `recover-lost-device`,
  `host-health-evidence-timeline` — eligible ONLY after the lane replaces the
  absolute-timestamp pin with a genuine transition-class expectation
  (D2(b) family) that differs across the frozen schedule; the rewrite must be
  asserted against the same domain API surface and keep all non-time
  assertions intact. A rewritten journey that still flips only via timestamp
  equality stays uncounted.
- **Excluded (1):** `evidence-gated-recovery` (past-only response; the frozen
  forward schedule cannot produce a distinct forward outcome — recorded
  honestly, no slot filled).
- The 23 invariant journeys declare NO epochs (D2(d) rerun supremacy).

**D9 — Frozen epoch schedule (TL-owned values).** `firms.ts` real schedules
landing at F332: medium firms `[T0, T0 + 30d]`, large firms
`[T0, T0 + 30d, T0 + 90d]` (30d = 2_592_000_000 ms; 90d = 7_776_000_000 ms;
small firms stay `[T0]`). The spacing is frozen NOW so lane expectation tables
are built against exact values; no lane may choose its own spacing.

**D10 — Proof form (per parameterized journey, machine evidence).**
1. A per-epoch expectation table in the corpus schema (each responding
   assertion declares its per-epoch `expected` values; non-responding
   assertions stay single-valued).
2. Runner-executed distinctness proof: at the frozen schedule, epoch outcomes
   differ on ≥1 **asserted** reading (the runner fails if two epochs agree on
   every asserted value — D2(d) enforced positively), and a same-epoch re-run
   is byte-identical (D2(c)).
3. The census citation (this report's table row) in the journey's
   declaration comment.

**D11 — Worker boundary (Wave 13).** Lanes own their corpus packages
(journeys, runner seams, expectation tables, corpus tests) and their evidence
paths. The TL owns `packages/acceptance/adoption/**`
(`adoption-run.ts`, `firms.ts`, `convergence-delta.ts`, `industries.ts`,
`verdicts.ts`, `report.ts`), `packages/acceptance/release/**`, and every pin.
**No path grant is issued.** The counting gate, the D9 schedule values, the
count-honesty law and all re-pins land only at F332 by the TL.

**D12 — Commerce/security census-before-variants.** Each of those corpora
gains a time seam and a census (same method as §1.1, recorded in the lane
report with the full per-journey table) BEFORE any epoch variant is proposed.
No census row ⇒ no variant. Commerce/security variants are bounded by their
own measured responding sets — never assumed.

**D13 — Never-count restated for Wave 13.** Byte-identical re-runs, synthetic
telemetry, duplicated steps, altered labels, timestamp-echo pins across
epochs, and any input change that does not alter an asserted outcome are
never distinct journeys (F320 D3, restated; echo-class pins explicitly named).

## 3. Honest cap arithmetic (the reachable numbers)

Single-journey base first (all fully-applicable, unmasked):

- Wave-12 base: 91 (field 30 + commerce 34 + security 27).
- F331C rows 34–35 (marketplace transaction flow; tenant billing/invoicing):
  **+2 → 93**.
- F331A row 39 (edge firmware/OTA campaign management): **+1 → 94**.

Epoch dimension (per firm size, at the frozen schedule, max honest field
parameterization = 4 count-eligible + 2 rewrite-eligible = 6):

- small (1 epoch): cap stays **94** — epochs cannot help 1-epoch firms; the
  residual to 100 is **6 single journeys** (§3.6-c remainder mining — named
  as the post-Wave-13 gap; do NOT fabricate).
- medium (2 epochs): 94 + 6 = **100** iff both echo-class rewrites land
  (4 guaranteed → 98).
- large (3 epochs): 94 + 12 = **106** (guaranteed floor 102).

Commerce/security epoch variants (F331B/F331C censuses) can only ADD to
medium/large; small firms are bounded by single journeys alone.

**B-3 closure condition (restated, unlowered):** every fully-applicable firm
reaches 100 counted. This wave can close medium/large firms if the arithmetic
above holds; small firms need the 6-journey remainder — the honest wave
verdict at F332 will state exactly which sizes closed and which did not.

## 4. Wave-13 lane contracts (frozen)

### F331A — field epoch parameterization + edge OTA campaigns (worker A)
1. Implement D8's field set: per-epoch expectation tables + distinctness
   proofs for the 4 count-eligible journeys; rewrite the 2 echo-class
   journeys per D8's rewrite rule (or record an honest failure to rewrite —
   an unrewritten echo journey simply stays single-counted).
2. Field runner: the epoch-execution capability (run the corpus at a schedule
   array; enforce D10's proof form — per-epoch table evaluation, distinctness
   assertion, same-epoch byte-identity).
3. Row 39: the edge firmware/OTA campaign module (staged waves, halt,
   rollback) under worker-A-owned domain paths + its new journey(s) per the
   corpus laws (≥5 assertions, refusals, determinism, vocabulary law).
4. Machine-run the field suite + owned gates; lane report with the census
   citations, per-journey epoch tables, exact SHAs, and honest limitations.

### F331B — security corpus time seam + census + parameterization (worker B)
1. Add the `startedAt`-class seam to the security runner (no behavior change
   at T0; all 151 tests stay green).
2. Run and record the security census (§1.1 method, full per-journey table in
   the lane report).
3. Parameterize the census-certified responding set per D10 (if any); every
   non-responder stays single-counted.
4. Machine-run the security suite + owned gates; lane report.

### F331C — marketplace transactions + tenant billing + commerce seam (worker C)
1. Row 34: marketplace transaction flow (ordering/checkout over published
   listings) as a new commerce-domain capability package.
2. Row 35: tenant billing & invoicing (seat/consumption billing from
   entitlements + gateway usage) as a new package.
3. The commerce time seam + census (D12), then parameterize responders.
4. New journeys for the two capabilities per the corpus laws; machine-run the
   commerce suite + owned gates; lane report.

### F332 — TL convergence (after all three lane reports)
Verify ownership/exact commits; adjudicate every epoch variant against
D2+D8–D13; merge; land the counting gate (`adoption-run.ts`) + the D9
schedules (`firms.ts`); recompute the 30-workspace ledger; re-pin; run the
full clean-checkout gates on the frozen candidate; browser-verify; verdict
per §3's closure condition. NOT READY unless every fully-applicable firm
honestly reaches 100.

## 5. Boundary and standing laws carried forward

- Providers stay CONTRACT_ONLY (F323 DEFERRED; no lane drives any provider
  API; row 38 connector work is out of scope this wave).
- Row 37 (validated predictive model) is deferred to Wave 14 (wave focus is
  rows 34–36 + 39).
- File law ≤400 lines/journey-family file; vocabulary laws unchanged; masks
  TL-owned; no rerun inflation; no target lowering.
