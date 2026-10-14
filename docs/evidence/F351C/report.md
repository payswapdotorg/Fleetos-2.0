# F351C — Masked-industry coverage tranche 2 (telecommunications + water-waste), commerce lane

- **Work item:** F351C (`spec/work-items/WORK-ITEM-CATALOG.md`, Wave 16; packet
  `docs/tech-lead/packets/f351c.md` — the binding contract).
- **Worker:** C (the commerce lane). **Date:** 2026-10-14 (corrected at F354 from a worker typo that read 2026-10-15; the lane commit timestamp 2026-10-14 06:43:52 +0000 is the evidence of record).
- **Base:** `cb572b8` (main HEAD at clone — EXACTLY the F351C freeze commit,
  the packet's expected base). Branch `work/f351c`; the pushed tip SHA is in
  the FINAL REPORT (the repository is the source of truth).
- **Parallel-lane note honored:** F351B (the FIELD corpus, mining +
  construction) runs in parallel on `work/f351b`; this lane touches ONLY
  `packages/acceptance/commerce/**` + this evidence dir + the catalog
  one-liner. NO field corpus, NO `industries.ts`, NO adoption/release pin
  files. Every closure number below is LANE-LOCAL (measured at THIS tree
  with only this lane's journeys); the TL computes the converged ledger at
  F354.

## 1. The census (machine-measured FIRST; grep proof over ALL THREE corpora)

Method: every exported function of the four packet-named packages
(`procurement`, `vendors`, `software`, `work`) was extracted and grepped
(`rg -l "\b<fn>\b"`) across `packages/acceptance/{commerce,field,security}/src`
— the three REAL corpora. Zero-coverage candidates with journey-grade
semantics:

| # | API (file:line) | zero-coverage proof | persona rationale | verdict |
|---|---|---|---|---|
| 1 | `createProcurementDirectory` + `ProcurementDirectory.createOrder` (procurement/directory.ts:216/301) | 0 files match either symbol (the existing procure-spine journeys drive the FLOW API `awardQuoteToOrder` in flow.ts — a DIFFERENT public entry point whose gate is a SUBMITTED quote; the directory's gate is an ACCEPTED quote + audit events + repository persistence) | procurement-lead: the repository-backed ordering discipline every industry runs | **DELIVERED** (journey 1) |
| 2 | `matchVendors` (procurement/matching.ts:47) | 0 files match (the F321C vendor-capability-feed step drives the DIFFERENT `capabilityMatchingFeed` API in vendors/contracts.ts — a filter feed, not a scored match set) | vendor-manager / procurement-lead: scored vendor matching with RECORDED tie-break rules | **DELIVERED** (journey 2) |
| 3 | `compareQuotes` (procurement/commerce-math.ts:96) | 0 files match (the existing quote-scoring journey drives the EXPERIENCE read model `buildQuoteScoreView` from `@fleetos/experience-work-commerce` — not the domain kernel) | procurement-lead: the domain quote-comparison kernel (integer bps + recorded tie-breaks + refusal codes) | **DELIVERED** (journey 3) |
| 4 | `rollupVendorKpis` (vendors/capability-catalog.ts:175) + `capabilityCatalogSummary` (capability-catalog.ts:108) | 0 files match either (the existing vendor-kpi-view step drives the DIFFERENT `buildVendorKpiRollup` in vendor-lifecycle.ts — quote-acceptance/exposure KPIs, not fulfillment-outcome KPIs) | vendor-manager: on-time ratio + fill rate from REAL delivery outcomes — universal vendor performance | **DELIVERED** (journey 4) |
| 5 | `createDocumentIdempotent` (procurement/flow.ts:284) + `computeRequestDigest` (flow.ts:312) | 0 files match either | operations-manager: idempotent document creation (request-id + digest discipline) — a fleet-universal platform mechanic | **DELIVERED** (journey 5) |
| 6 | `checkLicenseCompliance` + `expireGrant` + `transitionCatalogEntry` (software/entitlement-grants.ts:382/334/101) | 0 files match any | software-admin: license compliance + catalog lifecycle | **RECORDED, NOT DELIVERED** — honest applicability is NOT fleet-universal (agriculture masks the seat-heavy software-entitlements family with a recorded rationale; a proposal-table-only candidate per D15), and the 5 universal candidates above already close the lane's arithmetic. Recorded for the TL's F354 adjudication. |
| 7 | `allocateSeatsBatch` (software/seat-allocation.ts:85) | 0 files match | software-admin: batch seat allocation | RECORDED, NOT DELIVERED (same agriculture mask family as #6) |
| 8 | `sweepExpiredSubscriptions` + `computeSubscriptionCompliance` + `createSoftwareDirectory` (software/contracts.ts:176/234, directory.ts:246) | 0 files match | software-admin: expiry sweep + compliance read | RECORDED, NOT DELIVERED (semantically adjacent to the COVERED `renewal-window-sweep` journey's family — D16 risk; and the same agriculture mask family) |
| 9 | `validateSlaDefinition` + `slaEvaluationDigest` (vendors/sla.ts) | 0 files match | vendor-manager: SLA definition validation | RECORDED, NOT DELIVERED — the SLA family is COVERED territory (`sla-scorecard-credit` drives evaluateSla/buildSlaScorecard/applySlaPenaltyCredit); definition-validation is adjacent semantics (D16 honest screen) |
| 10 | `findLiveAssignmentRecord`, `isTerminalWorkItemStatus`, `progressKindForTransition` (work/lifecycle.ts, work/progress.ts) | 0 direct matches | — | NOT REMAINDER — thin helpers without refusal semantics; the work package's journey-grade surface (directory assign/reassign/transition, deadlines, integrity holds) is fully covered by the existing corpus |
| 11 | `vendorHasCapability` (vendors/contracts.ts:273) | 0 files match | — | NOT REMAINDER — a one-line predicate (no distinct journey semantics) |
| 12 | `contractsAreDistinct` (procurement/contracts.ts:203) | 0 files match | — | NOT REMAINDER — a compile-time-law helper, no journey semantics |

D16 screen (the covered-candidate check): `vendor-directory service
relationships` (a packet candidate family) is COVERED by the F321C
`vendor-directory-service-relationship` journey — recorded, not re-delivered.
The work package has NO journey-grade unexercised surface (row 10).

## 2. The five delivered journeys (D14 form; all fleet-universal)

| journey id | persona | capability | steps | assertions | refusal paths asserted |
|---|---|---|---:|---:|---|
| `procurement-quote-to-order-authorization` (renamed at F354 from `procurement-order-authorization` — the F351B field lane delivered the same id over the shared createOrder/A5 surface in parallel; see the F354 report adjudication) | procurement-lead | procurement-ordering | 12 | 24 | AUTHORIZATION_DENIED, ILLEGAL_TRANSITION (×2: early quote + terminal quote), cross-tenant order/quote reads return NOTHING |
| `vendor-matching-discipline` | vendor-manager | vendor-matching | 4 | 19 | TENANT_MISMATCH (foreign demand), zero-match + foreign-tenant vendors never enter the match set |
| `quote-comparison-discipline` | procurement-lead | quote-comparison | 9 | 19 | NO_QUOTES, WEIGHTS_MUST_SUM_TO_10000, INVALID_UNIT_COST, INVALID_LEAD_TIME, TENANT_MISMATCH |
| `vendor-fulfillment-kpi-rollup` | vendor-manager | vendor-performance | 5 | 14 | EMPTY_PERFORMANCE_HISTORY, NEGATIVE_QUANTITY, foreign-tenant outcomes/capabilities never counted |
| `procurement-idempotent-creation` | operations-manager | idempotent-creation | 8 | 20 | IDEMPOTENCY_KEY_CONFLICT, REQUEST_ID_REQUIRED, REQUEST_DIGEST_REQUIRED, DOCUMENT_ID_REQUIRED |

Machine-verified totals: **96 assertions / 38 steps** across the five; every
journey ≥5 assertions with ≥1 asserted refusal; unique ids; personas and
capabilities from the fixed vocabularies (the vocabulary gains 5 new
capability values, listed in `journey-contracts.ts`).

**Applicability position: all five journeys are FLEET-UNIVERSAL (D15-strict,
zero mask changes, zero declarative proposals).** Each is a genuinely
universal commerce mechanic every industry honestly runs — creating orders
from accepted quotes behind an authorization gate, matching vendors to
demands by capability, comparing quotes deterministically, measuring vendor
delivery performance, and creating documents idempotently. None re-litigates
a masked territory: the telecom/water-waste commerce masks name
`apify-actor-job`, `actor-job-failure-expiry`, `aurum-settlement-seam`, and
`org-optimization-review` — none of the five journeys touches those
mechanics (machine-checked: the F351C step kinds drive only
procurement-directory/matching/comparison/KPI/idempotency APIs, asserted in
`tests/f351c.test.ts`). The declarative-proposal mechanism was NOT needed;
the recorded-not-delivered candidates (#6–#9) are recorded in §1 for the
TL's information only.

**Determinism (D14):** every journey re-runs byte-identically (digest +
facts equality machine-verified in `tests/f351c.test.ts` and by the probe);
the full 41-journey corpus re-runs byte-identically; the full 30-workspace
adoption simulation re-runs byte-identically (canonical-JSON equality).
**Single-epoch law (D13):** no F351C journey carries an epoch table and none
consumes the run anchor — machine-verified invariant at every census offset
(−1h, +1s, +1h, +1d, +30d, +90d, +365d) by `tests/f351c.test.ts`; the
epoch-count ledger is unchanged (the 8 census-certified responders only —
this lane adds NO epoch-earning journey).

## 3. The measured lane-local closure arithmetic (the mission)

Machine-measured by the lane-local adoption probe (the F332 out-of-repo
pattern — untracked, deleted before commit) at THIS tree:

| measure | base (F352-locked, `cb572b8` pre-lane) | **measured (this lane)** | delta |
|---|---:|---:|---|
| journeyExecutions (COUNTED) | 3,027 | **3,177** | +150 = 5 journeys × 30 firms |
| fieldExecutions | 1,179 | **1,179** | 0 (field corpus untouched) |
| commerceExecutions | 1,017 | **1,167** | +150 |
| securityExecutions | 831 | **831** | 0 |
| uniqueApplicableJourneys | 931 | **981** | +50 = 5 journeys × 10 industries |
| aggregateShortfall | 97 | **44** | −53 (5 firms close fully, 8 reduce by 5) |
| commerceEpochReRuns (raw, never counted) | 897 | **1,047** | +150 (the D13 byte-identical epoch re-runs) |
| fieldEpochReRuns (raw) | 406 | **406** | 0 |
| determinismVerified | true | **true** | — |
| allJourneysPassed | true | **true** | — (the ka6 defect was fixed by F343 before this lane's base; nothing in this lane affects it) |
| firms at/above 100 | 17 | **23** | +6 (telecom ×3, water-waste ×3) |
| max executed | 116 | **121** | +5 |

The per-firm counted table (base → measured; every firm +5 — the journeys
are fleet-universal, grow-only):

| industry | small | medium | large |
|---|---|---|---|
| manufacturing | 100 → **105** | 108 → 113 | 116 → 121 |
| energy-utilities | 100 → **105** | 108 → 113 | 116 → 121 |
| construction | 97 → **102** | 105 → 110 | 113 → 118 |
| transportation-logistics | 93 → 98 | 101 → 106 | 109 → 114 |
| agriculture | 82 → 87 | 90 → 95 | 98 → 103 |
| healthcare-facilities | 85 → 90 | 92 → 97 | 99 → 104 |
| facilities-management | 86 → 91 | 93 → 98 | 100 → 105 |
| **telecommunications** | 95 → **100** ✅ | 103 → 108 | 111 → 116 |
| mining | 98 → **103** | 106 → 111 | 114 → 119 |
| **water-waste** | 95 → **100** ✅ | 103 → 108 | 111 → 116 |

**B-3 CLOSES for telecommunications and water-waste (lane-local):** both
industries' small firms reach exactly 100 counted journeys (95 + 5), with
medium/large already ≥ 100 (108/116). The five journeys executed 150/150
counted firm-executions with ZERO failures. The other industries' +5 per
firm is honest bonus from genuine universal applicability, never a target.

## 4. The verification battery (machine-run; exact numbers)

| gate | command | result |
|---|---|---|
| commerce suite | `pnpm --filter @fleetos/acceptance-commerce test` | **133/133 (7 files)** — base 115/115 (6 files) → +18 (5 auto journey tests + 13 `f351c.test.ts` tests); grow-only |
| commerce barrel | probe over `JOURNEYS` | **41** (base 36), unique ids, all five present — machine-verified |
| typecheck (owned) | `pnpm --filter @fleetos/acceptance-commerce typecheck` | exit 0 |
| lint (owned) | `pnpm --filter @fleetos/acceptance-commerce lint` | 0 warnings / 0 errors (52 files) |
| determinism | full-corpus + full-simulation canonical-JSON rerun | byte-identical (probe + suite) |
| file law | `wc -l` on the 8 new files | max 257 lines (contracts 225, drivers 224/76/120/98, journeys 257/160, test 203) — all ≤ 400 |
| field suite (untouched, regression) | `pnpm --filter @fleetos/acceptance-field test` | 102/102 |
| security suite (untouched) | `pnpm --filter @fleetos/acceptance-security test` | 179/179 |
| convergence suite (untouched) | `pnpm --filter @fleetos/acceptance-convergence test` | 82/82 |
| maintenance suite (untouched) | `pnpm --filter @fleetos/maintenance test` | 99/99 |
| adoption suite (TL-owned pins) | `pnpm --filter @fleetos/acceptance-adoption test` | 103/120 — 17 failures, ALL the documented pin-transition class (corpora counts 35+**41**+29, simulation 3177/1167/981, per-firm +5, verdict denominators 82→87 / 99→104 / 97→102 / 81→86 — every failing expectation differs from its pin by exactly this lane's arithmetic). Per the packet these pin files are OUTSIDE this lane's boundary; the TL re-pins at F354 |
| release suite (TL-owned pins) | `pnpm --filter @fleetos/acceptance-release test` | 85/88 — 3 failures, same class (commerce 36→41, journeyExecutions 3027→3177) |

## 5. Honest limitations

- **L-1 (lane-local arithmetic):** every closure number in §3 is measured at
  THIS tree with only this lane's journeys. The parallel F351B lane (field
  corpus) is NOT merged at this base; the TL computes the converged ledger at
  F354 and re-pins. The counts are recorded as MEASURED, never pinned in any
  file.
- **L-2 (the TL-owned pin trips):** the adoption (103/120) and release
  (85/88) suites trip on their count pins — the documented pin-transition
  class (F342 L-7). This lane is forbidden from touching those files; each
  failing expectation differs from its pin by exactly this lane's arithmetic
  (verified), so the trips are the pins working as designed.
- **L-3 (recorded, not delivered):** the software license-compliance family
  (`checkLicenseCompliance`, `expireGrant`, `transitionCatalogEntry`,
  `allocateSeatsBatch`, `sweepExpiredSubscriptions`) has genuine zero corpus
  coverage but honestly NOT fleet-universal applicability (agriculture's
  recorded seat-heavy-software mask family). It is RECORDED in §1 — a future
  lane may deliver it with a declarative proposal table; this lane did not
  need it for its arithmetic and the D15-prefer law favored five universal
  mechanics.
- **L-4 (float scores):** `vendor-matching-discipline` pins two exact IEEE754
  float scores (0.870990099009901 / 0.570990099009901) — deterministic in
  the same JS engine family and byte-identical on rerun (machine-verified),
  but they are the only float-equality pins in this lane's additions.
- **L-5 (the tie-break coverage):** `quote-comparison-discipline` exercises
  all four recorded tie-break rules (lower-total-cost, shorter-lead-time,
  earlier-submission, vendor-id-lexical) — the shorter-lead-time case
  requires a custom weight vector (terms weight 0) because with the default
  weights a lead-time difference always changes the total; the custom
  weights are a documented, validated domain input (the kernel accepts any
  10000-summing vector).
- **L-6 (sandbox scope):** all gates ran in this sandbox; the 16 GB builder
  full clean-checkout gates and browser verification remain TL-owned (the
  F322 §5 doctrine).

## 6. Boundary

`git diff --name-only main...HEAD` lists ONLY (the exact list is in the
FINAL REPORT):

- `packages/acceptance/commerce/src/journey-contracts-f351c.ts` (new),
  `packages/acceptance/commerce/src/drivers-procurement-directory.ts` (new),
  `packages/acceptance/commerce/src/drivers-quote-comparison.ts` (new),
  `packages/acceptance/commerce/src/drivers-vendor-kpis.ts` (new),
  `packages/acceptance/commerce/src/drivers-procurement-idempotency.ts` (new),
  `packages/acceptance/commerce/src/journeys/f351c-procurement.ts` (new),
  `packages/acceptance/commerce/src/journeys/f351c-vendors.ts` (new),
  `packages/acceptance/commerce/src/journeys/index.ts` (barrel),
  `packages/acceptance/commerce/src/journey-contracts.ts` (vocabulary + step union),
  `packages/acceptance/commerce/src/runner.ts` (step-kind dispatch),
  `packages/acceptance/commerce/tests/f351c.test.ts` (new),
  `packages/acceptance/commerce/tests/corpus.test.ts` (count 36→41),
  `packages/acceptance/commerce/tests/f331c.test.ts` (invariant-set count 34→39),
  `packages/acceptance/commerce/tests/report.test.ts` (capability count 25→30),
- `docs/evidence/F351C/report.md` (this file),
- the one-line catalog append to `spec/work-items/WORK-ITEM-CATALOG.md`.

NO domain package, NO adoption/release/convergence file, NO field/security
corpus, NO `industries.ts`. The measurement probes ran in-tree UNTRACKED and
were deleted before commit (the F332 out-of-repo probe pattern).
