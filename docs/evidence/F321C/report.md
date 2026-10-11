# F321C — Work/commerce adoption-journey expansion (Wave 12 lane C)

- **Work item:** F321C (`spec/work-items/WORK-ITEM-CATALOG.md`; the F320 frozen count law and the
  Wave-12 lane-C mandate in `docs/tech-lead/FINAL-RELEASE-HANDOFF.md` §3–4).
- **Worker:** C (work-and-commerce; `spec/worker-ownership.yaml` worker-c).
- **Base:** `8344e7159a13a1dcd3d31d90c435490c2adde08` short `8344e71` (main HEAD at branch
  creation — machine-verified with `git rev-parse HEAD` after clone, never assumed).
- **Branch:** `work/f321c`. **Commits (in order):** the corpus extension commit → the evidence
  commit this report rides on (branch tip; the nominated SHA rides in the lane's FINAL REPORT
  message — a commit cannot embed its own SHA).
- **Date:** 2026-10-11.
- **Mission:** deliver the three F310C §3.2 deferred coverage slots as genuine, machine-run
  journeys over REAL worker-c public APIs — with the `aurum-delta-sync-session` slot EXCLUDED
  (Aurum is CONTRACT_ONLY / provider not ready) and replaced by a distinct non-Aurum
  work/commerce journey discovered by code inspection.

## 1. Owned paths touched (boundary-verified)

- `packages/acceptance/commerce/**` (worker-c owned) — the corpus extension
  **31 → 34 journeys**:
  - new step contracts `src/journey-contracts-f321c.ts` (148 — three step families,
    split from `journey-contracts.ts` to hold the ≤400-line file law);
  - new drivers `src/drivers-marketplace.ts` (184),
    `src/drivers-vendor-directory.ts` (178), `src/drivers-actor-jobs.ts` (123) —
    WeakMap per-state seams, logical `CLOCK` only;
  - new journey files `src/journeys/marketplace.ts` (189 — the two vendor-family
    journeys) and `src/journeys/actor-jobs.ts` (108);
  - extended `src/journey-contracts.ts` (368 → 377: +1 capability
    `vendor-marketplace`, the F321C step types in the `JourneyStep` union, re-exports),
    `src/runner.ts` (219 → 239: three new kind sets + dispatch), `src/journeys/index.ts`
    (45 → 52: two new corpus arrays);
  - tests: `tests/corpus.test.ts` (corpus pin 31 → 34, ten-file assembly sum, required
    capability set + `vendor-marketplace`), `tests/report.test.ts` (capability
    vocabulary pin 22 → 23 — grow-only, mirroring the F300C/F310C precedent), new
    `tests/f321c.test.ts` (135 — 14 F321C spot checks).
- `docs/evidence/F321C/**` — this report.

`git status` at commit time shows exactly those paths; `git diff --name-only origin/main`
plus the untracked list is exactly `packages/acceptance/commerce/**` + this evidence path.
No TL-owned path touched: `packages/acceptance/adoption/**` (12 pin failures at this tree
are the documented count-pin transition state — recorded in §6, pins untouched),
`packages/acceptance/release/**` (4 pin failures — same documented transition, untouched),
`packages/acceptance/convergence/**` (green, untouched), `packages/acceptance/field/**`,
`packages/acceptance/security/**`, `spec/**`, `docs/**` beyond this evidence path — all
untouched. No sibling-lane path touched. **No domain package source changed** — the
journeys drive existing public APIs only (`vendors`, `apify`, `software` package tests
re-run green: §5).

## 2. The three-slot plan, honestly delivered

All three F310C §3.2 deferred slots are delivered. Row 12 (`aurum-delta-sync-session`) is
**EXCLUDED per the handoff's provider-boundary law — Aurum is CONTRACT_ONLY /
provider-not-ready; NO Aurum API is driven anywhere in this lane** — and replaced by a
genuinely distinct non-Aurum journey on the `@fleetos/vendors` VendorDirectory surface
(discovered by code inspection: real public API, zero acceptance-corpus references —
machine-verified with rg BEFORE coding, §3). Every journey's cited APIs were re-verified
to exist at THIS tree's main HEAD (`8344e71`) before coding — the F310C row numbers
(checked at `dc4b5e2`) still hold exactly: `marketplace.ts:105/207/287`,
`job-lifecycle.ts:187` (`createActorJobIdempotent`) and the fail/expire wiring at
`drivers-external.ts:243-244`.

### 2.1 Journey table (the F321C corpus extension)

| # | journey id | persona | capability | real API driven (verified present, previously zero-corpus) | assertions |
|---|---|---|---|---|---|
| 11 | `marketplace-publication-lifecycle` | vendor-manager | vendor-marketplace (NEW vocabulary entry, 22 → 23) | `@fleetos/vendors` `publishListing` / `applyRevocationCascade` / `searchListings` — marketplace.ts:105/207/287 (publication gate with verbatim per-claim report, delisting cascade with original-reason preservation, deterministic search; TENANT_MISMATCH / VENDOR_MISMATCH / CAPABILITY_UNVERIFIED / CAPABILITY_UNKNOWN / NO_CLAIMED_CAPABILITIES / NO_REVOKED_TAGS refusals) | 28 |
| 12 | `vendor-directory-service-relationship` (row-12 REPLACEMENT, NON-Aurum) | vendor-manager | vendor-management | `@fleetos/vendors` `createVendorDirectory` / `transitionServiceRelationship` / `aggregateScorecard` / `capabilityMatchingFeed` / `getVendor` + `createInMemoryVendorRepository` / `makeAuditEvent` (via the directory) — directory.ts:235/244/271/295/320/115, contracts.ts:108/177/235 (audit events with FNV-1a digests, worst-wins scorecards, deterministic tenant-scoped feed, fail-closed cross-tenant reads; ILLEGAL_TRANSITION / TERMINATE_REASON_REQUIRED / SERVICE_RELATIONSHIP_NOT_FOUND / EMPTY_SCORECARD / SCORE_OUT_OF_RANGE refusals) | 35 |
| 13 | `actor-job-failure-expiry` | vendor-manager | actor-jobs | `@fleetos/apify` `failActorJob` / `expireActorJob` (job-lifecycle.ts:357/368 — wired at drivers-external.ts:243-244 but exercised by NO journey) + `createActorJobIdempotent` (job-lifecycle.ts:187, previously zero references anywhere) — CONTRACT-LEVEL LOCAL LIFECYCLE ONLY | 32 |

**Total new assertions: 95** (28+35+32). Every journey carries ≥5 meaningful assertions.
Unique ids (corpus law, machine-enforced). All personas/capabilities come from the FIXED
vocabularies — the 7-persona law needed ZERO changes; the capability vocabulary grew
22 → 23 (`vendor-marketplace`, grow-only, mirroring the F300C +3 / F310C +4 precedents;
`tests/report.test.ts` pin updated 22 → 23 in this lane's own package). All step kinds
come from the closed families (`journey-contracts-f321c.ts`: 4 marketplace + 5
vendor-directory + 3 actor-job kinds). Per-journey outcome digests (machine-captured):
`journey_6104aba0` / `journey_aa2a58d0` / `journey_0e5146e0`.

### 2.2 Journey law compliance (machine-checked)

- **Real behavior, real APIs:** every step of every journey dispatches to a REAL public
  entry point of a worker-c-owned domain package (`@fleetos/vendors`, `@fleetos/apify`),
  recorded as plain facts under stable per-`factKey` namespaces; the drivers contain no
  business logic (WeakMap per-state seams, logical `CLOCK` only).
- **Positive, negative, refusal, tenant-isolation and provenance paths asserted** —
  per journey: publication refusals with verbatim per-claim reports
  (`CAPABILITY_UNVERIFIED`, `CAPABILITY_UNKNOWN`, `NO_CLAIMED_CAPABILITIES`,
  `TENANT_MISMATCH`), cascade fail-closed on a foreign-vendor listing
  (`VENDOR_MISMATCH`) and `NO_REVOKED_TAGS`, delisted-never-matches search,
  already-delisted original-reason preservation, the documented
  `vendor-id-lexical-then-listing-id-lexical` ordering law; directory
  `ILLEGAL_TRANSITION` (double-suspend, terminated-is-terminal),
  `TERMINATE_REASON_REQUIRED`, `SERVICE_RELATIONSHIP_NOT_FOUND`, `EMPTY_SCORECARD`,
  `SCORE_OUT_OF_RANGE` (never clamped), audit events with FNV-1a digests carrying
  from/to statuses, worst-wins aggregation with the 0.5 honest default,
  fail-closed cross-tenant reads (foreign caller sees NOTHING); actor-job
  `ILLEGAL_TRANSITION` (fail from proposed/authorized/scheduled; running jobs are
  NEVER expired), `FAILURE_REASON_REQUIRED` (empty reason refused),
  `TERMINAL_STATE` (failed/expired finality), `NOT_DUE_FOR_EXPIRY` (the window is
  respected), `IDEMPOTENCY_KEY_CONFLICT` (same key, different draft), duplicate
  creation returning the ORIGINAL job, and the tenant-distinctness of idempotency
  keys (a foreign-tenant job with the same key never collides).
- **Deterministic:** logical clock only. Purity machine-scan over the six new
  src files: zero `Date.now` / `Math.random` / `fetch(` / `process.env` / timer hits.
  Byte-identical re-runs machine-tested per new journey (`tests/f321c.test.ts`).
- **No reruns counted:** the corpus runs ONCE per workspace (runAllJourneys);
  the 555 raw field epoch re-runs remain reported separately and never counted.
- **Honest industry applicability:** §7 (mask review — one REQUIRED TL proposal for
  `actor-job-failure-expiry`, zero needed for the two vendor-family journeys).

## 3. Corpus absence evidence (machine-verified BEFORE coding)

`rg` over `packages/acceptance/**` (2026-10-11, at `8344e71`, before any lane file was
written):

- `publishListing|applyRevocationCascade|searchListings`: **zero references** in any
  acceptance package.
- `createActorJobIdempotent`: **zero references** anywhere. `failActorJob|expireActorJob`:
  present ONLY as driver wiring — `drivers-external.ts:28-29` (imports) and `:243-244`
  (the dispatch arms) — with zero journey steps using the `fail`/`expire` commands
  (verified: `rg 'command: "(fail|expire)"' packages/acceptance/commerce/src/journeys/`
  → exit 1; the only `apify-job-transition` journey steps are `start`/`complete` in
  `org.ts:80-81`). This is exactly the F310C row-13 record.
- `createVendorDirectory|makeAuditEvent|computeAuditDigest|transitionServiceRelationship|aggregateScorecard|capabilityMatchingFeed|createInMemoryVendorRepository`:
  **zero references** in any acceptance package (the whole VendorDirectory surface was
  unexercised; `capabilityMatchingFeed` also has a distinct consumer inside
  `@fleetos/procurement`'s `matchVendors` — a package seam, not a corpus journey).

## 4. The row-12 adjudication (honest engineering decision, recorded)

`aurum-delta-sync-session` is excluded: F320 D4/D5 and the Wave-12 handoff §3 forbid
counting provider-dependent work while Aurum is CONTRACT_ONLY. The replacement was
selected by code inspection under the handoff's rule — "an API that exists, is not
already covered as a distinct journey, and can be exercised without Aurum":

- Candidate `allocateSeatsBatch` (`@fleetos/software` seat-allocation.ts:85, zero corpus
  references) was considered and REJECTED for mask honesty: its capability family
  (`software-entitlements`) is masked for agriculture (`industries.ts`), a TL-owned file
  this lane cannot touch (F320 D5), so landing it unmasked would over-count a masked
  industry without the required family-mirroring mask.
- Selected: the `@fleetos/vendors` **VendorDirectory** surface — an entire unexercised
  public module (zero references machine-verified, §3) in the `vendor-management`
  capability family, which is unmasked for every industry (verified against all
  commerce mask keys in `industries.ts`: no vendor-management-family journey is masked
  anywhere). Distinct from the existing `vendor-management` journey (which drives the
  vendor LIFECYCLE record surface `vendor-lifecycle.ts`): this journey drives the
  directory/repository/audit-event surface — a different subsystem, different state
  machine, different laws.

## 5. Quality gates at the final commit (machine-run)

| gate | command | result at the branch tip |
|---|---|---|
| commerce acceptance suite | `npx vitest run` (in the package) | **98/98 green** — was 81 (grow-only: all 81 original tests unchanged and green; +3 dynamic journey-loop tests for the three new journeys, +14 F321C spot checks; files: corpus 12, journeys 44, runner 14, report 14, f321c 14) |
| security acceptance suite (read-only) | `npx vitest run` | **151/151 exact** (untouched) |
| field acceptance suite (read-only) | `npx vitest run` | **69/69 exact** (untouched) |
| convergence acceptance suite (read-only) | `npx vitest run` | **82/82 exact** (untouched; consumes the corpus dynamically — the 34-journey corpus satisfies it unchanged) |
| release suite (TL-owned, read-only) | `npx vitest run` | **84 pass / 4 fail** — main baseline 85/3 machine-verified at `8344e71` via stash; the ONE new failure is `release-gate.test.ts > short commerce corpus → ACCEPTANCE_COUNT_MISMATCH` (commerce pin 31 ≠ 34) — the documented count-pin transition state, exactly the class F310C recorded; suite untouched |
| adoption suite (TL-owned, read-only) | `npx vitest run` | **83 pass / 12 fail** — main baseline 84/11 machine-verified at `8344e71` via stash; the ONE new failure is `convergence.test.ts > the commerce corpus in this tree is the F310C extension (31 …)` (31 ≠ 34); all other failures unchanged from main's documented transition set; pins untouched |
| affected C-package tests | per-package `vitest run` | vendors **94/94**, apify **68/68**, software **79/79** — all green (no domain source changed) |
| typecheck | `tsc --noEmit` | **0 errors** in `packages/acceptance/commerce` (also clean in `vendors` and `apify`) |
| lint | `oxlint src tests` | **0 warnings / 0 errors** in `packages/acceptance/commerce` (38 files) |
| file law (≤400 lines/file) | `wc -l` | max touched: 377 (`journey-contracts.ts`); all six new files ≤ 189 |
| boundary scan | `git status --short` + `git diff --name-only origin/main` | `packages/acceptance/commerce/**` + this evidence path ONLY (12 files: 5 modified, 7 new) |
| purity | `rg` scan (§2.2) | zero wall-clock/randomness/network/env hits in the new src files |

## 6. The adoption transition totals (machine-run at this tree, pins untouched)

The full-industry adoption simulation (30 firm workspaces, REAL corpora, deterministic,
machine-run through the TL-owned package's own runner — read-only capture, no pin
touched):

| measure | Wave 11 converged (main `8344e71`) | THIS tree (F321C) | delta |
|---|---:|---:|---|
| commerce corpus size | 31 journeys | **34 journeys** | +3 |
| fieldExecutions | 555 | 555 | — |
| commerceExecutions | 822 | **912** | +90 (3 journeys × 30 firms — all three currently applicable in every industry, §7) |
| securityExecutions | 771 (F321B in main) | 771 | — |
| journeyExecutions (COUNTED) | 2,148 | **2,238** | +90 |
| uniqueApplicableJourneys | 716 | **746** | +30 |
| fieldEpochReRuns (raw, never counted) | 555 | 555 | — |
| aggregateShortfall (30 × 100 − counted) | 852 | **762** | −90 |
| fully-applicable firm cap | 78 (20+31+27) | **81 (20+34+27)** | +3 |
| shortfall per fully-applicable firm | 22 | **19** | −3 |

Per-industry honest counts (per firm, machine-captured at this tree — firms of an
industry share verdict inputs; every industry gains exactly +3 under the CURRENT mask
table):

| industry | counted/firm | shortfall/firm |
|---|---:|---:|
| manufacturing | 81 | 19 |
| construction | 78 | 22 |
| energy-utilities | 81 | 19 |
| transportation-logistics | 74 | 26 |
| agriculture | 64 | 36 |
| healthcare-facilities | 67 | 33 |
| facilities-management | 68 | 32 |
| telecommunications | 77 | 23 |
| mining | 79 | 21 |
| water-waste | 77 | 23 |

These are the TREE's numbers; the TL recomputes and re-pins at F322 convergence per the
frozen count law. Post-mask expectation if §7's proposal is accepted: −15 executions
(see §7) → commerceExecutions 897, journeyExecutions 2,223, aggregateShortfall 777, and
the five masked industries −3 each.

## 7. Mask review — proposals for the TL (industries.ts NOT touched)

| new journey | mask review | rationale (family precedent) |
|---|---|---|
| marketplace-publication-lifecycle | **none needed** | vendor-marketplace publication over the tenant's OWN vendor capability records — the vendor-management family is unmasked for every industry (no commerce mask key names a vendor-family journey; verified against all mask entries in industries.ts) |
| vendor-directory-service-relationship | **none needed** | the VendorDirectory over the tenant's OWN vendors/relationships/scorecards — same unmasked vendor-management family |
| actor-job-failure-expiry | **REQUIRED TL PROPOSAL** — add this journey id to the commerce masks of the FIVE industries that already mask `apify-actor-job` (agriculture, healthcare-facilities, facilities-management, telecommunications, water-waste), each mirroring its existing family rationale verbatim (e.g. agriculture: "No external data-actor automation is operated in-house."). F320 D5 forbids this lane from editing `industries.ts`, so the machine-run numbers in §6 currently count this journey for those five industries (3 firms × 5 industries = 15 executions); the TL adjudicates at F322. This is the same class of documented transition as the count pins — never a silent over-count claim |

The predictive/provider honesty laws are upheld: no Aurum/ADCOS/Arena API is driven
anywhere; `actor-job-failure-expiry` is contract-level local lifecycle behavior over the
LOCAL job-record state machine — the lane makes NO live, sandbox or connected-provider
claim for Apify (it remains CONTRACT_ONLY until its own provider-readiness evidence
passes, per F323).

## 8. Honest limitations

- **L-1 (row 12 excluded, replaced):** `aurum-delta-sync-session` is NOT delivered —
  Aurum is CONTRACT_ONLY / provider-not-ready (F323). The slot is filled by
  `vendor-directory-service-relationship` (a genuinely distinct, provider-independent
  journey over an unexercised real public API). The Aurum sync-session APIs
  (`openSyncSession`/`applyFetchedBatch`/`commitSyncSession`/`verifySyncDigest`) remain
  covered only by the package's own unit tests — no acceptance journey drives them, by
  design, until the provider is ready.
- **L-2 (row 13 is contract-level):** `actor-job-failure-expiry` drives the LOCAL actor-job
  state machine. It does not and must not establish any Apify live binding; no remote
  call, provider connection or external data claim exists anywhere in the lane.
- **L-3 (count-pin transition):** the TL-owned adoption (12) and release (4) pin failures
  at this tree are the documented transition state — recorded in §5–§6 with the exact
  one-test deltas against the machine-verified main baseline; pins untouched; the TL
  re-pins at F322.
- **L-4 (mask adjudication pending):** §7's `actor-job-failure-expiry` mask proposal
  (5 industries) is TL-owned work at F322; until then the tree's simulation counts it
  for those industries (recorded honestly in §6, never claimed as the converged ledger).
- **L-5 (the honest remaining shortfall):** the fully-applicable cap moves 78 → 81;
  shortfall 22 → 19 per firm. The target of 100 stands (never weakened here). The
  remaining 19 needs lane A's F321A delivery (+10 proposed), further capability work
  (the F310C §3.5 (b) rows incl. row 36 time-parameterization — TL-owned law work), and
  the residual (c) rows — not this lane's to claim.
- **L-6 (epoch law):** no time-parameterization was implemented or pre-implemented
  (F320 D4/D6). Time-dependent behavior WITHIN single journeys (the expiry window
  `NOT_DUE_FOR_EXPIRY` boundary at now = 5,000 < expiresAt = 6,000, the at-deadline
  expiry, the relationship `endedAt`) is normal single-journey behavior, counted once.

## 9. FINAL REPORT data (for the lane message)

- Branch `work/f321c`, base `8344e71`, the corpus extension commit → the evidence
  commit (tip; SHA in the FINAL REPORT message).
- Journeys delivered: **2 of 2 remaining F310C §3.2 slots (rows 11 and 13) + the row-12
  replacement** (`vendor-directory-service-relationship`, non-Aurum) — 3 journeys, 95
  assertions, all machine-run green.
- Per-suite counts: commerce **98/98** (was 81; grow-only) · security **151/151** ·
  field **69/69** · convergence **82/82** · release 84+4 (documented transition; main
  baseline 85+3 machine-verified) · adoption 83+12 (documented transition; main
  baseline 84+11 machine-verified) · C-packages green (vendors 94, apify 68, software 79).
- Recorded transition totals: counted **2148 → 2238**, commerceExecutions **822 → 912**,
  uniqueApplicable **716 → 746**, cap **78 → 81**, shortfall **22 → 19**/fully-applicable
  firm; aggregate shortfall 852 → 762. Capability vocabulary 22 → 23
  (`vendor-marketplace`). Mask proposals: **one** (`actor-job-failure-expiry`, 5
  industries, TL adjudication; rationale in §7).
