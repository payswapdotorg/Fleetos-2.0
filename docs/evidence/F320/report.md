# F320 — TL Pre-Dispatch Decision: the Distinct-Journey Count Law (Wave 12)

Owner: TL. Status: **DECIDED AND FROZEN** — precedes all F321 lanes.
Source inspected at `dc4b5e2` (working tree clean; `main` HEAD = the operator's
Wave-12 handoff chain `05c74e4..dc4b5e2`, documentation-only relative to the
tested candidate `8c97ac8`).

## 1. The question

F310C §3.5 row 36 proposes "honest corpus time-parameterization" with a
theoretical ceiling of 170 counted journeys per firm. The handoff (F320)
requires the TL to define when two time/epoch executions are semantically
distinct journeys, freeze that law, and either activate it or rule the wave
non-parameterized — before any worker starts implementing.

## 2. Machine-verified source facts (this tree, inspected not assumed)

1. **Every declared epoch anchors at the same instant.**
   `packages/acceptance/adoption/src/firms.ts:88` constructs each firm's epoch
   schedule as `Array.from({ length: epochCount }, () => ADOPTION_T0)` with
   `ADOPTION_T0 = 1_774_000_000_000`. The per-size schedules (small 1, medium
   2, large 3) exist structurally, but every epoch carries the identical
   timestamp; epochs ≥ 2 execute byte-identically and are never counted
   (`adoption-run.ts:144-153`).
2. **The field runner is signature-parameterizable but expectation-frozen.**
   `runJourneyCorpus({ tenantId, startedAt })` accepts a start time, but the
   20 field journeys pin T0-calibrated literal expectations. Machine census
   (recorded in the module law, `adoption-run.ts:252`): a +1s `startedAt`
   offset fails 1 journey; +1h fails 3; multi-day offsets fail 12. This means
   at most 12-16 of 20 field journeys respond to time at all; the remainder
   are time-invariant, so additional epochs for them are byte-identical by
   construction and can never count.
3. **Commerce and security runners are not time-parameterizable.**
   `adoption-run.ts:253-254`: the commerce runner is not
   tenant/time-parameterizable; the security runner is single-parameter. The
   170-ceiling arithmetic (`20×3 + 31×3 + 17`) therefore assumes runner
   capability that does not exist.
4. **The count-honesty law is already in force** (`adoption-run.ts`):
   byte-identical re-runs never count (555 raw epoch re-runs executed and
   excluded at Wave 11).

## 3. The frozen Distinct-Journey Count Law

**D1 — Baseline (unchanged).** A counted journey is one unique corpus journey
ID, executed once per applicable workspace, satisfying the existing corpus
laws (unique ids, ≥5 meaningful assertions, vocabulary/step-kind law,
deterministic reproduction).

**D2 — Time/epoch distinctness criterion.** Two executions of the same journey
at different epochs may count as distinct journeys ONLY IF ALL FOUR hold:

- (a) **Real input:** the epoch reaches domain behavior through a
  parameterized runner seam (as field's `startedAt` does) — not a relabel, not
  a test-harness clock change.
- (b) **Divergent asserted outcome:** the journey declares a per-epoch
  expected-outcome set, and at least one **asserted** reading (a real
  assertion with an `expected` value, not a recorded observation) differs
  across the epochs because of a genuine time-driven domain transition —
  expiry, deadline breach/escalation, staleness-class transition, window
  boundary open/close, scheduled state transition, or grant/session/lease
  lifecycle.
- (c) **Machine-proven distinctness:** the runner proves epoch A's outcome ≠
  epoch B's outcome on the asserted reading, and each epoch variant
  reproduces byte-identically when re-run at the same epoch.
- (d) **Rerun supremacy:** any epoch whose full outcome is byte-identical to
  another epoch's NEVER counts, regardless of declared intent or differing
  inputs.

**D3 — Never-count list (restated, permanent).** Byte-identical re-runs,
synthetic telemetry, duplicated steps, altered labels, count-only parameter
variations, and any input change that does not alter an asserted outcome are
never distinct journeys.

**D4 — Wave-12 scope ruling: NON-PARAMETERIZED.** No epoch-variant journey
counts in Wave 12. Grounds: per-epoch distinct execution does not exist as
implemented behavior (fact 1); per-epoch expectation tables do not exist and
at most 12-16 of 20 field journeys are even time-responsive (fact 2); the
commerce/security parameterization required by the 170 arithmetic is absent
runner capability (fact 3). Forcing epoch variants now would violate D2(c) —
there is nothing to prove distinctness against. This is the handoff's item 6
outcome: the honest distinct cases cannot be proven this wave; the
non-parameterized journey plan proceeds.

**D5 — Worker boundary (this wave).** Workers A/B/C must not create
epoch-variant journeys as count-bearing, and must not modify the TL-owned
adoption ledger, `adoption-run.ts`, `firms.ts`, `convergence-delta.ts`, or
any release pin — **no path grant is issued**. Time-dependent domain behavior
exercised *within* a single journey's step sequence (an expiry sweep, a
deadline escalation, a staleness window) is normal single-journey behavior
and counts once, as Wave 11's `deadline-escalation` already does.

**D6 — Future activation path (row 36, post-Wave-12).** If F322 lands below
the 100 target, honest parameterization becomes a candidate TL-owned
capability wave with this required shape, in order:

1. Runner capability: per-epoch expectation tables in the field journey
   schema (`journey-contracts.ts` seam) — each responding journey declares
   epoch-specific `expected` values for the readings that genuinely change;
   time-invariant journeys declare no extra epochs (D2(d)).
2. Commerce/security runner parameterization (new capability, sized first).
3. Law integration: `adoption-run.ts` counts only D2-satisfying epoch
   variants; `firms.ts` declares real per-firm epoch schedules (distinct
   timestamps); the count-honesty law gains an epoch-distinctness gate.
4. Ceiling honesty: the reachable number is bounded by the responding-journey
   census (field ≤ 12-16 of 20; commerce/security unknown until the runners
   are parameterizable) — NOT the theoretical 170.

No Wave-12 worker may pre-implement any part of D6.

## 4. Contract to the lanes (frozen)

- A/B/C expand corpora per the handoff scopes; replacement slots must be
  genuinely distinct under D1-D3 (a "replacement" that is a timestamp/label
  variant of an existing journey is void).
- Applicability masks may only narrow, with per-journey rationale.
- All Wave-11 suite/grow-only, file (≤400 lines), boundary and purity laws
  carry over unchanged.
- Target: 100 per fully-applicable firm — retained, not lowered, not
  reachable via D3 items.

## 5. Testability of this decision

- D2(c) is machine-checkable today: re-run any journey at two declared
  epochs and diff the asserted readings — at `dc4b5e2` every such pair is
  byte-identical (fact 1), so D2 fails for all current corpus journeys; hence
  D4.
- D5 is boundary-checkable: `git diff --name-only main` per lane must not
  touch `packages/acceptance/adoption/src/{adoption-run,firms,convergence-delta}.ts`
  or the release suite.
- D6 activation is a separate work item requiring a new catalog entry and
  dispatch; it cannot occur inside F321 lanes.

**Verdict recorded: Wave 12 is NON-PARAMETERIZED; the count law above is
frozen for all three lanes; row 36 stays deferred as TL-owned capability
work with the D6 shape.**
