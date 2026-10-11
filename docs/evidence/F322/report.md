# F322 — TL convergence, count recomputation and disposition (Wave 12)

- **Work item:** F322 (`spec/work-items/WORK-ITEM-CATALOG.md`; procedure
  `docs/tech-lead/FINAL-RELEASE-HANDOFF.md` §5).
- **Owner:** TL. **Date:** 2026-10-11.
- **Convergence base:** `8344e71` (main HEAD at Wave-12 lane dispatch; F320
  frozen count law + F321B already merged at `1d1d67f`).
- **Frozen final candidate:** `5c3d18f` (main; the F322 convergence commits
  `16e35e8` + `5c3d18f` on top of the lane merges).

## 1. Lane deliveries, exact commits and machine verification

| Lane | Branch/tip | Deliverable | TL machine verification (16 GB builder) |
|---|---|---|---|
| F321A | `work/f321a` @ `ffb4119` | field corpus 20 → 30 (+10 journeys, 227 assertions; slot-21 adcos-session-trust EXCLUDED, replaced by `ingestion-limits-admission-discipline`) | run `38146799222`: B-1 typecheck SUCCESS, B-2 build SUCCESS, field 79/79, security 151/151, commerce 81/81, convergence 82/82 — adoption/release failures exactly the documented count-pin transition |
| F321B | `work/f321b` @ `2061a51` (merged `1d1d67f`) | security corpus 17 → 27 (+10 journeys, 431 assertions; slot-30 arena-evaluation-runs EXCLUDED, replaced by `posture-fold-determinism`) | Wave-12 lane record (delivered by the prior-era TL; the merge is in the convergence base) |
| F321C | `work/f321c` @ `2408201` | commerce corpus 31 → 34 (+3 journeys, 95 assertions; slot-12 aurum-delta-sync-session EXCLUDED, replaced by `vendor-directory-service-relationship`) | run `38160560665`: B-1 SUCCESS, B-2 SUCCESS, commerce 98/98, security 151/151, field 69/69, convergence 82/82 — same documented transition |

Ownership verification (`verify_lane.py`, machine): every changed path on
both branches lies in the lane's owned paths plus its evidence file —
F321A: 17 paths, all `packages/acceptance/field/**` +
`docs/evidence/F321A/report.md`; F321C: 13 paths, all
`packages/acceptance/commerce/**` + `docs/evidence/F321C/report.md`.
No TL-owned, sibling-lane or domain-package path touched by either lane.
Provider-boundary scans: zero `@fleetos/adcos` driver references in A's
journey code; zero `@fleetos/aurum` references anywhere in C's diff.

Journey adjudication (TL review against the F310C §3.2/§3.3 maps):
- A's ten journeys drive the exact F310C-proposed API families (store-forward
  sign/receive/report; offline-buffer capture/replay/sweep; diagnosis
  lifecycle; anomaly confidence; evidence-gated recovery; maintenance
  calendar scale; asset lineage/material lots; identity sessions; tenant
  lifecycle gating) plus the §3.6-named ingestion-limits replacement — all
  previously zero-corpus, all with real positive/negative/refusal/isolation
  assertions, logical-clock determinism, and per-journey digests.
- C's three journeys drive the F310C §3.2 rows 11 and 13
  (`publishListing`/`applyRevocationCascade`/`searchListings`;
  `failActorJob`/`expireActorJob`/`createActorJobIdempotent` —
  contract-level local lifecycle only) plus the VendorDirectory replacement
  (row-12, non-Aurum). The worker's rejected candidate
  (`allocateSeatsBatch`) and its mask-honesty rationale are accepted.
- No superficially renamed, duplicated, parameter-only or
  provider-dependent substitution was found. No epoch-parameterization
  exists (F320 D4/D6 upheld; raw field epoch re-runs 855, byte-identical,
  never counted).

## 2. Merge and convergence

- `7ea9b00` — F321A merge (merge commit, F321B precedent).
- `ceb55df` — F321C merge. Conflict-free (disjoint owned paths).
- `16e35e8` — the F322 TL convergence commit (mask + re-pins, §3–§4).
- `5c3d18f` — the B-2-caught type widening (LaneExtensionRecord.corpus
  gains "commerce"; no behavioral change — the six suites already passed
  at `16e35e8`).

## 3. TL-owned mask adjudication (F321C §7 proposal — ACCEPTED)

`actor-job-failure-expiry` is masked for the five industries that already
mask the `apify-actor-job` family, each mirroring its existing rationale
verbatim (industries.ts, +10 lines):

| industry | mirrored rationale |
|---|---|
| agriculture | "No external data-actor automation is operated in-house." |
| healthcare-facilities | "External data automation is not operated in-house; the integration office owns EDI." |
| facilities-management | "Supplier data automation is not operated in-house; the incumbent procurement network handles it." |
| telecommunications | "External data actor jobs are not operated in-house; incumbent OSS adapters own integrations." |
| water-waste | "Telemetry data automation is not operated in-house; SCADA integrators own it." |

Net effect: −15 counted executions (3 firms × 5 industries) versus the
unmasked tree. Zero other masks proposed by any lane (A: every industry
gained exactly +10, machine-evidenced; C's two vendor-family journeys are
unmasked everywhere).

## 4. The 30-workspace adoption recomputation (machine-run, pins now exact)

Values machine-verified twice: gates run `38164045093` at the merged tree
`ceb55df` (pre-pin, no-mask Received values: cap 91, counted 2538,
fieldExecutions 855) and the six-suites-green run `38165177822` at
`16e35e8` (post-pin, with mask — adoption and release suites GREEN with
the exact pins below).

| measure | Wave 11 (pins) | Wave 12 converged | delta |
|---|---:|---:|---|
| field corpus | 20 journeys | **30** | +10 (F321A) |
| commerce corpus | 31 journeys | **34** | +3 (F321C) |
| security corpus | 17 journeys | **27** | +10 (F321B) |
| fieldExecutions | 555 | **855** | +300 |
| commerceExecutions | 822 | **897** | +75 (90 − 15 masked) |
| securityExecutions | 471 | **771** | +300 |
| journeyExecutions (COUNTED) | 1,848 | **2,523** | +675 |
| uniqueApplicableJourneys | 616 | **841** | +225 |
| fieldEpochReRuns (raw, never counted) | 555 | **855** | +300 (byte-identical) |
| aggregateShortfall (30 × 100 − counted) | 1,152 | **477** | −675 |
| fully-applicable firm cap | 68 | **91** | +23 |
| shortfall per fully-applicable firm | 32 | **9** | −23 |

Per-industry honest counts (per firm, machine-pinned via the verdict/report
fixtures and the honest-counts ledger):

| industry | counted/firm | shortfall/firm |
|---|---:|---:|
| manufacturing | 91 | 9 |
| energy-utilities | 91 | 9 |
| mining | 89 | 11 |
| construction | 88 | 12 |
| telecommunications | 86 | 14 |
| water-waste | 86 | 14 |
| transportation-logistics | 84 | 16 |
| facilities-management | 77 | 23 |
| healthcare-facilities | 76 | 24 |
| agriculture | 73 | 27 |

Distinct journey IDs added this wave (exact list):
- F321A: `store-and-forward-redelivery`, `offline-buffer-capture-replay`,
  `ingestion-limits-admission-discipline` (slot-21 replacement),
  `diagnosis-lifecycle-supersession`, `anomaly-confidence-triage`,
  `evidence-gated-recovery`, `maintenance-calendar-scale`,
  `asset-lineage-material-lots`, `identity-session-lifecycle`,
  `tenant-lifecycle-gating`.
- F321B (merged earlier): `security.tamper-evident-audit-ledger`,
  `security.finding-storm-triage`, `security.finding-suppression-lifecycle`,
  `security.verified-execution-dispatch`, `security.action-compensation-rollback`,
  `security.capability-store-dr`, `security.outcome-evaluation-adoption`,
  `security.jepa-family-honesty`, `security.degradation-staleness-honesty`,
  `security.posture-fold-determinism` (slot-30 replacement).
- F321C: `marketplace-publication-lifecycle`,
  `vendor-directory-service-relationship` (slot-12 replacement),
  `actor-job-failure-expiry`.

## 5. Full clean-checkout gates (16 GB builder, frozen candidate)

- Frozen candidate: **`5c3d18f`** (main). Run at this exact ref:
  `38165903409` (see §7 for the final per-gate table — filled from the
  completed run).
- Intermediate machine evidence: `38146799222` (A-lane tip), `38160560665`
  (C-lane tip), `38164045093` (merged tree, no-mask harvest),
  `38165177822` (re-pin tree `16e35e8`: B-1 SUCCESS, acceptance-gates
  SUCCESS — six suites green; B-2 caught the corpus-type widening, fixed
  in `5c3d18f`).

## 6. Provider and product-readiness boundary (unchanged)

- ADCOS, Aurum, Arena: **CONTRACT_ONLY / provider not ready** (F323
  DEFERRED). No lane drives any provider API; `actor-job-failure-expiry`
  is local contract-level lifecycle only.
- Apify remains contract-level (no live/sandbox claim anywhere).

## 7. Final release decision

**NOT READY.** B-3 remains OPEN: the honest converged cap is **91 of the
100** genuinely distinct counted journeys per fully-applicable firm
(shortfall 9). The target is not lowered and no mask is broadened. The
next capability plan (F310C §3.5 rows 34–39, TL-owned):

1. **Row 36 — honest corpus time-parameterization** (highest leverage: the
   170-journey ceiling — 20×3 field epochs + 31×3 commerce + 17 security
   at Wave-11 shapes; at the converged corpora 30×3 + 34 + 27 = 151 plus
   per-epoch distinct expectations) requires real runner/journey-law
   capability work under the F320 D2 four-condition epoch-distinctness
   test. TL + A/B/C ownership.
2. Rows 34–35 (marketplace transaction flow; tenant billing/invoicing) —
   worker-C new-package capability work.
3. Rows 37–39 (validated predictive model; live connector integration
   gated on F323 provider readiness; edge firmware/OTA campaigns) —
   worker-A capability work, the connector rows deferred with the
   providers.

## 8. Documentation updates (this commit)

- `spec/work-items/WORK-ITEM-CATALOG.md` — Wave-12 status rows (F321A/C
  DELIVERED+CONVERGED, F322 DONE, verdict NOT READY at 91/100).
- `AI_CONTINUATION.md` — next-session state.
- `docs/tech-lead/RESIDUAL-RISKS.md` — B-3 updated to 91/100.
- This report (`docs/evidence/F322/report.md`).

## 9. Honest limitations

- **L-1:** the per-firm chat-side FINAL REPORT messages from workers A and
  C were not harvested verbatim (the platform's DOM rendering of the
  multi-hour agent sessions wedged; lane A's final message was read in
  substance and lane C's is superseded by its pushed evidence). The
  repository — the sole source of truth — carries both lanes' full
  evidence reports; the TL's independent 16 GB builder runs are the
  machine verification of record.
- **L-2:** browser verification of the built shell at the frozen candidate
  is performed in this sandbox (static hosting, fixture-composed state —
  the F301/F312 deployment scoping stands; no public production
  deployment exists).
- **L-3:** the sandbox TL environment cannot run the root typecheck/full
  build locally (4 GB); the 16 GB GitHub-hosted builder is the gate of
  record (runs cited above), consistent with the B-1/B-2 doctrine.
