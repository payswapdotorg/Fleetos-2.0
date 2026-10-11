# F321A — Field/edge/asset adoption-journey expansion (Wave 12 lane A)

- **Work item:** F321A (`spec/work-items/WORK-ITEM-CATALOG.md`; the F320 frozen count law and the
  Wave-12 lane-A mandate in `docs/tech-lead/FINAL-RELEASE-HANDOFF.md` §4).
- **Worker:** A (edge-and-asset; `spec/worker-ownership.yaml` worker-a).
- **Base:** `8344e7140f8c5f8556137d6193d37432721fe601` (main HEAD at branch creation —
  machine-verified with `git rev-parse main`, never assumed).
- **Branch:** `work/f321a`. **Commits (in order):** the ten-journey corpus extension →
  the evidence commit this report rides on (branch tip; the nominated SHA rides in the
  lane's FINAL REPORT message — a commit cannot embed its own SHA).
- **Date:** 2026-10-11.
- **Mission:** close 10 of the remaining per-firm shortfall with genuinely distinct,
  machine-run journeys over REAL worker-a domain APIs — nine from the F310C §3.3 map
  plus a tenth-slot replacement on a NON-ADCOS surface (the F310C §3.6-named mining
  area "observations ingestion-limits/backpressure/retention").

## 1. Owned paths touched (boundary-verified)

- `packages/acceptance/field/**` (worker-a owned) — the corpus extension
  **20 → 30 journeys**: three new journey files (`src/journeys/f321a-ingestion.ts`
  212, `f321a-operations.ts` 371, `f321a-governance.ts` 311), the corpus index
  registration (`src/journeys/index.ts`), new typed operation contracts split per
  family to hold the ≤400-line file law (`src/journey-contracts-f321a.ts` 93 +
  `journey-contracts-f321a-edge.ts` 156 + `journey-contracts-f321a-care.ts` 170 +
  `journey-contracts-f321a-asset-core.ts` 157, aggregated through
  `JourneyOperation` in `journey-contracts.ts`), three new op executors
  (`src/ops/f321a-edge.ts` 338, `f321a-care.ts` 396, `f321a-asset-core.ts` 318),
  caller-threaded REAL state structures (`src/context.ts`), the runner dispatch
  (`src/runner.ts`), and the F321A spot checks + grow-only count-pin update
  (`tests/journeys.test.ts`, `tests/report.test.ts`).
- `docs/evidence/F321A/**` — this report (the granted exception path).

`git diff --name-only main` at the final commit shows exactly those paths. No
TL-owned path touched: `packages/acceptance/adoption/**` (the 11 pin failures at
this tree are the documented count-pin transition state — recorded in §5–§6, pins
untouched), `packages/acceptance/release/**` (4 pin failures — same documented
transition, untouched), `packages/acceptance/convergence/**` (green, untouched),
`packages/acceptance/security/**`, `packages/acceptance/commerce/**`, every domain
package (`packages/{identity,tenancy,assets,observations,health,recovery,maintenance,connectivity,sim-worlds}/**`,
`packages/integrations/adcos/**`, `packages/experiences/asset-field/**`), `spec/**`,
`docs/**` beyond this evidence path — all untouched. No sibling-lane path touched.
No domain package source changed (the journeys drive existing public APIs only).

## 2. The ten-slot plan, honestly delivered

All NINE mapped F310C §3.3 lane-A slots are implemented and machine-run green.
The TENTH mapped slot (`adcos-session-trust`, row 21) is EXCLUDED per the
handoff's provider-boundary law — **ADCOS is CONTRACT_ONLY /
provider-not-ready; no ADCOS API is driven anywhere in this lane** (the
pre-existing `edge-command-lifecycle` journey drives the LOCAL in-memory ADCOS
kernel only, as it already did at Wave 7) — and is replaced by a genuinely
distinct non-ADCOS journey on the `@fleetos/observations` ingestion-limits
admission surface (the F310C §3.6-named mining area). Every journey's cited
APIs were verified to exist at this tree by code inspection BEFORE coding
(§2.1 citations); corpus-absence was machine-verified with `git grep` over
the `main` tree (§3).

### 2.1 Journey table (the F321A corpus extension)

| # | journey id | persona | capability | real API driven (verified present, previously zero-corpus) | assertions |
|---|---|---|---|---|---|
| 14 | `store-and-forward-redelivery` | field-technician | connectivity | `signBundle` / `receiveBundle` / `buildSequenceReport` (+ `verifyBundleSignature`, `verifyBundleIntegrity`, `runPipeline` re-feed) — observations/src/store-forward.ts:80/184/302 | 19 |
| 15 | `offline-buffer-capture-replay` | edge-operator | field-mode | `captureOfflineEntry` / `replayOfflineBuffer` / `sweepExpiredOfflineEntries` / `stampPostureTransition` (+ `emptyOfflineBuffer`) — connectivity/src/offline-buffer.ts:146/261/330 | 21 |
| 21R | `ingestion-limits-admission-discipline` (tenth slot, NON-ADCOS) | edge-operator | connectivity | `withTenantCap` / `checkTenantAdmission` / `admitBatchWithLimits` / `emptyIngestionBuffer` / `bufferIngestionEntry` — observations/src/ingestion-limits.ts:215/234/322/114/129 | 22 |
| 16 | `diagnosis-lifecycle-supersession` | site-manager | investigation | `proposeDiagnosis` / `applyDiagnosisCommand` / `supersedeDiagnosis` — health/src/kernel.ts:214/257/314 | 19 |
| 17 | `anomaly-confidence-triage` | site-manager | investigation | `buildRollingWindowFromObservations` / `runAnomalyDetection` / `evaluateAnomaly` / `propagateConfidence` (+ `emptyAnomalyState`, `defaultConfidenceRules`) — health/src/kernel-signals.ts:80/161/122/211 | 23 |
| 18 | `evidence-gated-recovery` | recovery-coordinator | recovery | `applyRecoveryCommandWithEvidenceChain` / `verifyCaseEvidenceChainPostMortem` / `paginateRecoveryCases` / `encodeRecoveryCaseCursor` / `paginateCasesForTenant` — recovery/src/kernel-evidence.ts:139/180, pagination.ts:97/58/150 | 23 |
| 19 | `maintenance-calendar-scale` | maintenance-planner | maintenance | `buildMaintenanceCalendar` / `checkCalendarConflict` / `findNextFreeSlot` / `scheduleWindowsBatch` — maintenance/src/scheduling-scale.ts:76/118/148/235 | 24 |
| 20 | `asset-lineage-material-lots` | site-manager | trustworthy-state | `declareLineage` — assets/src/twin-engine.ts:251, `createMaterialLot` / `consumeMaterialLot` / `materialLotLifecycleState` — lineage/material.ts:144/204/107, `ancestry` — lineage/queries.ts:178, `appendLineageEdge` / `verifyLineageChain` — lineage/graph.ts:188/243 | 26 |
| 22 | `identity-session-lifecycle` | field-technician | enrollment | `issueSession` / `validateSession` / `bindRole` / `evaluateSessionTransition` — identity/src/kernel.ts:138/188/244/71, `sweepSessions` — kernel-operational.ts:52 | 24 |
| 23 | `tenant-lifecycle-gating` | site-manager | tenant-isolation | `establishTenant` / `evaluateTenantOperation` — tenancy/src/kernel.ts:285/242 (+ the `TenantRegistry`/`InMemoryTenantRegistry` public port pair) | 26 |

**Total new assertions: 227** (19+21+22+19+23+23+24+26+24+26). Every journey
carries ≥5 meaningful assertions (min 19 — the corpus's own ≥10 law, machine-
enforced by `tests/journeys.test.ts`, also holds for all ten). Unique ids
(corpus law, machine-enforced). All personas/capabilities come from the FIXED
vocabularies — the 7-persona/14-capability laws needed ZERO changes. Note on
slot 20: F310C §3.3 proposed capability `asset-lineage`, which is not in the
frozen 14-capability vocabulary; the journey lands on `trustworthy-state`
(the vocabulary's provenance/trust family — the F310C column is a proposal,
the vocabulary is law; no vocabulary change was made). Per-journey outcome
digests (machine-captured): a0ae783b / 3a59b287 / 482912ad / 6c4a17e8 /
54897d32 / 56efa679 / c9dab1a2 / e6bcc900 / 8a34328f / 51db1c77.

### 2.2 Journey law compliance (machine-checked)

- **Real behavior, real APIs:** every step of every journey dispatches to a
  REAL public entry point of a worker-a-owned domain package, recorded as
  plain facts under stable paths; the executors contain no business logic
  (they map typed data onto real calls and record real outputs).
- **Positive, negative, refusal, tenant-isolation and provenance paths
  asserted where relevant** — per journey: refusals (`signature-invalid`,
  `integrity-invalid`, `duplicate-entry-id`, `tenant-mismatch`,
  `tenant-cap-exceeded`, `batch-too-large`, `payload-too-large`,
  `buffer-full`, `missing-reason`, `missing-evidence`,
  `insufficient-evidence-count`, `illegal-transition`, `lot-exhausted`,
  `invalid-quantity`, `non-monotonic-consume-seq`, `duplicate-lineage`,
  `self-reference`, `malformed-lineage-id`, `edge-digest-mismatch`,
  `not-yet-active`, `already-in-target-state`, `orphan-actor`,
  `malformed-actor-id`, `actor-mismatch`, `duplicate-binding`,
  `no-free-slot-in-horizon`, `invalid-limit`, `cursor-tenant-mismatch`,
  `window-in-past`, `tenant-provisioning-no-writes`,
  `tenant-suspended-read-only`, `tenant-closing-no-new-writes`,
  `tenant-closed-no-operations`, `unknown-tenant`, `duplicate-tenant`,
  `malformed-tenant-id`), forgery/tamper detection (forged agent KEY at
  reception; tampered payload digest; tampered lineage edge breaking the
  chain digest), tenant isolation (foreign-tenant offline capture,
  material-lot consumption, cross-tenant recovery cursor, foreign-tenant
  calendar window — all fail-closed naming the offender), and provenance
  (evidence chains, digests, supersession pointers, lifecycle state
  machines — all machine-carried from real outputs).
- **Deterministic:** logical clock only. Purity machine-scan over the ten
  journey files + contracts + executors + context extensions: zero
  `Date.now` / `Math.random` / `fetch` / `process.env` / timer hits.
  Runner-determinism is machine-tested per journey (byte-identical re-runs,
  `tests/runner.test.ts`) and per workspace (30/30 determinism proofs in the
  adoption simulation, §6).
- **Tenant-anchoring law (this lane's honest fix, machine-caught):** the
  first draft of `maintenance-calendar-scale` pinned the tenant-scoped
  calendar key as a fixture literal (`tnt_field-accept-01|ast_mill-press-01`).
  The read-only adoption run at a REAL firm tenant failed that assertion —
  machine-caught BEFORE delivery. The fix records the REAL stored window's
  tenant id and the executing tenant as readings and asserts them
  real-vs-real (`reading-equals`), so the journey holds under ANY workspace
  tenant; all ten journeys were then machine-verified green across all 30
  firm workspaces (§6). No other assertion pins a runtime-tenant literal
  (machine-scanned; the `tenancy.provision-tenant` journey's tenant ids are
  journey-declared inputs, not runtime anchors).

## 3. Corpus absence evidence (machine-verified BEFORE coding)

`git grep -E '<family>' main -- packages/acceptance` at `8344e71`
(2026-10-11, run against the main tree before any F321A file existed):

- `signBundle|verifyBundleSignature|verifyBundleIntegrity|receiveBundle|buildSequenceReport`:
  zero in `packages/acceptance`.
- `emptyOfflineBuffer|captureOfflineEntry|stampPostureTransition|replayOfflineBuffer|sweepExpiredOfflineEntries`:
  zero in the three journey corpora (field/commerce/security). The TL-owned
  release suite maps `replayOfflineBuffer`/`captureOfflineEntry` for its own
  observability surface (`release/src/observability.ts`) — a distinct
  consumer, not a corpus journey; the corpus journeys drive the full
  capture/replay/sweep/stamp lifecycle.
- `emptyIngestionBuffer|bufferIngestionEntry|withTenantCap|checkTenantAdmission|admitBatchWithLimits`:
  zero in the three journey corpora (the TL-owned release observability maps
  `checkTenantAdmission`/`withTenantCap` — distinct consumer, same note as
  above; `admitBatchWithLimits`/`bufferIngestionEntry`/`emptyIngestionBuffer`
  are zero in all of `packages/acceptance`).
- `proposeDiagnosis|applyDiagnosisCommand|supersedeDiagnosis`: zero.
- `buildRollingWindowFromObservations|runAnomalyDetection|evaluateAnomaly|propagateConfidence`: zero.
- `applyRecoveryCommandWithEvidenceChain|verifyCaseEvidenceChainPostMortem|paginateRecoveryCases|encodeRecoveryCaseCursor|paginateCasesForTenant`: zero.
- `buildMaintenanceCalendar|checkCalendarConflict|findNextFreeSlot|scheduleWindowsBatch`: zero.
- `declareLineage|createMaterialLot|consumeMaterialLot|appendLineageEdge|materialLotLifecycleState|ancestry|verifyLineageChain`:
  zero in the three journey corpora. The TL-owned convergence suite drives
  `createMaterialLot`/`consumeMaterialLot`/`appendLineageEdge`/
  `verifyLineageChain`/`ancestry` inside its gate SCENARIO
  (`convergence/src/scenario-fleet.ts`) — a distinct TL-owned consumer, not a
  corpus journey. `declareLineage` and `materialLotLifecycleState` are zero
  in all of `packages/acceptance`.
- `issueSession|validateSession|sweepSessions|bindRole|evaluateSessionTransition`:
  zero in all of `packages/acceptance` (`makeTenantContext` is the standard
  context helper the existing corpus already uses — the session-lifecycle
  family itself had zero coverage; F310C's "no coverage in EITHER corpus"
  verification holds).
- `establishTenant|evaluateTenantOperation`: zero.

Every driven API's existence was ALSO machine-verified at this tree
(`rg 'export function <name>'` — the §2.1 file:line citations are that
output; all match the F310C §3.3 map).

## 4. The tenth-slot adjudication (honest engineering notes)

1. **Slot 21 (`adcos-session-trust`) is EXCLUDED as provider-ready work** per
   the handoff law. The replacement (`ingestion-limits-admission-discipline`)
   drives a REAL, previously-zero-corpus public API family
   (`@fleetos/observations` ingestion-limits) that exists, is not covered by
   any other corpus journey, and is exercised entirely without ADCOS — the
   handoff's three replacement conditions, each machine-evidenced in §2.1/§3.
   It is the F310C §3.6 row-42-named mining area
   ("observations ingestion-limits/backpressure/retention").
2. **`runPipeline` re-feed (slot 14):** the store-and-forward executor
   re-feeds admitted observations through the REAL observations pipeline
   (`runPipeline`) to prove real admission — `runPipeline` is already driven
   by the flagship trustworthy-state journey for its own ingestion law; this
   lane's distinct surface is the bundle sign/verify/receive/gap/report
   family (§3), with `runPipeline` as the real admission substrate.
3. **Async-signature APIs:** none were required — every driven API in this
   lane is synchronous (unlike lane B's §4 adjudication). No supporting
   out-of-corpus test file was needed; all ten journeys are corpus journeys.

## 5. Quality gates at the final commit (machine-run)

| gate | command | result at the branch tip |
|---|---|---|
| field acceptance suite | `npx vitest run` (in the package) | **79/79 green** — was 69 (grow-only: +10 F321A spot checks; the corpus-shape pin updated 20 → 30 in place; all 69 original tests green) |
| security suite (worker-b, read-only) | `npx vitest run` | **151/151 exact** (untouched) |
| commerce suite (worker-c, read-only) | `npx vitest run` | **81/81 exact** (untouched) |
| convergence suite (TL-owned, read-only) | `npx vitest run` | **82/82 green** (consumes the corpus dynamically — the 30-journey corpus satisfies it unchanged) |
| adoption suite (TL-owned, read-only) | `npx vitest run` | **84 pass / 11 fail** — every failure is a count-pin transition failure (Wave-11 pins: 1848/555/471/822/616, the honest-counts table, industries' `20+31+17` corpus pins; field corpus pin `20`). Pins untouched per the F320 D5 law |
| release suite (TL-owned, read-only) | `npx vitest run` | **84 pass / 4 fail** — exactly the documented transition: the Wave-11 corpus-count pins (field `20`, security `17`) and the integration adoption-count pin. The "gate verdict READY with zero blockers over the full REAL stack" test PASSES at this tree (all corpora green) |
| affected A-package tests | per-package `vitest run` | identity **89/89**, tenancy **67/67**, assets **207/207**, observations **157/157**, health **89/89**, recovery **77/77**, maintenance **86/86**, connectivity **138/138**, adcos **178/178**, sim-worlds **84/84**, experience-asset-field **88/88** — all green (no domain source changed) |
| typecheck | `npx tsc --noEmit` | **0 errors** in `packages/acceptance/field` |
| lint | `npx oxlint` | **0 warnings / 0 errors** in `packages/acceptance/field` |
| file law (≤400 lines/file) | `wc -l` | max touched: 396 (`src/ops/f321a-care.ts`); all journey files ≤ 371; the 473-line first-draft contracts file was split into four (§1) to hold the law |
| boundary scan | `git diff --name-only main` | `packages/acceptance/field/**` + this evidence path ONLY |
| purity | `rg` scan (§2.2) | zero wall-clock/randomness/network/env hits in the ten journey files, contracts, executors and context extensions |
| adoption execution honesty | full simulation, read-only | **all 30 firm workspaces: every counted execution PASSED** (`allJourneysPassed=true`), 30/30 determinism proofs — machine-caught the §2.2 tenant-anchor defect pre-delivery and re-verified green after the fix |

## 6. The adoption transition totals (machine-run at this tree, pins untouched)

The full-industry adoption simulation (30 firm workspaces, REAL corpora,
deterministic, machine-run through the TL-owned package's own runner —
read-only capture, no pin touched):

| measure | Wave 11 (suite pins) | F321B lane tree (their report) | THIS tree (F321A) | delta |
|---|---|---|---|---|
| field corpus size | 20 journeys | 20 | **30 journeys** | +10 |
| fieldExecutions | 555 | 555 | **855** | +300 (10 × 30 workspaces) |
| commerceExecutions | 822 | 822 | 822 | — |
| securityExecutions | 471 | 771 | 771 | — |
| journeyExecutions (COUNTED) | 1,848 | 2,148 | **2,448** | +300 |
| uniqueApplicableJourneys | 616 | 716 | **816** | +100 |
| fieldEpochReRuns (raw, never counted) | 555 | 555 | 855 | +300 (all byte-identical, never counted) |
| aggregateShortfall (30 × 100 − counted) | 1,152 | 852 | **552** | −300 |
| fully-applicable firm cap | 68 (20+31+17) | 78 (20+31+27) | **88 (30+31+27)** | +10 |
| shortfall per fully-applicable firm | 32 | 22 | **12** | −10 |

Per-industry honest counts (per firm, machine-captured at this tree):

| industry | counted/firm | shortfall/firm | (F321B tree) |
|---|---|---|---|
| manufacturing | 88 | 12 | 78 |
| energy-utilities | 88 | 12 | 78 |
| mining | 86 | 14 | 76 |
| construction | 85 | 15 | 75 |
| telecommunications | 84 | 16 | 74 |
| water-waste | 84 | 16 | 74 |
| facilities-management | 75 | 25 | 65 |
| healthcare-facilities | 74 | 26 | 64 |
| transportation-logistics | 81 | 19 | 71 |
| agriculture | 71 | 29 | 61 |

Every industry gained **exactly +10** — machine evidence that none of the ten
new journeys is masked anywhere (§7). These are the TREE's numbers; the TL
recomputes and re-pins at convergence per the frozen count law.

## 7. Mask review — proposals for the TL (industries.ts NOT touched)

**Zero new masks are proposed** — machine evidence: every one of the ten
industries gained exactly +10 counted journeys per firm (§6), i.e. no new
journey is masked for any industry. Rationale per family (all family
precedents are unmasked everywhere; none depends on a provider, a third-party
feed, in-house autonomous agents or a trained model):

| new journey | mask review | rationale (family precedent) |
|---|---|---|
| store-and-forward-redelivery | none needed | the tenant's own edge agents re-delivering signed observation bundles — the connectivity family is unmasked everywhere |
| offline-buffer-capture-replay | none needed | offline capture/replay discipline on the tenant's own devices — the field-mode family is unmasked everywhere |
| ingestion-limits-admission-discipline | none needed | the tenant's own ingestion guardrails — local admission control, no provider |
| diagnosis-lifecycle-supersession | none needed | diagnosis discipline over the tenant's own findings — the investigation family is unmasked everywhere |
| anomaly-confidence-triage | none needed | deterministic statistical triage over the tenant's own observations — local, no trained model (predictive-honesty law upheld: structural reference only) |
| evidence-gated-recovery | none needed | recovery-command gating on the tenant's own evidence — the recovery family is unmasked everywhere |
| maintenance-calendar-scale | none needed | scheduling discipline on the tenant's own assets — the maintenance family is unmasked everywhere |
| asset-lineage-material-lots | none needed | tamper-evident lineage over the tenant's own assets/materials — the trustworthy-state family is unmasked everywhere |
| identity-session-lifecycle | none needed | the tenant's own identity/session/role discipline — the enrollment family is unmasked everywhere |
| tenant-lifecycle-gating | none needed | the tenant's own registry lifecycle gating — the tenant-isolation family is unmasked everywhere |

## 8. Honest limitations

- **L-1 (count-pin transition):** the TL-owned adoption (11) and release (4)
  pin failures at this tree are the documented transition state — recorded
  in §5–§6, pins untouched; the TL re-pins at F322 convergence. The Wave-11
  pins still describe the pre-F321B corpus (they were never re-pinned after
  F321B either); this lane's numbers are in §6.
- **L-2 (the honest remaining shortfall):** the fully-applicable cap moves
  78 → 88; the shortfall 22 → 12 per firm. The target of 100 stands (never
  weakened here). The remaining 12 needs lane C's +3 deferred slots plus the
  F310C §3.5 (b)-capabilities — not this lane's to claim. With A (+10) and
  B (+10) delivered, the corpus-arithmetic ceiling is 30+31+27 = 88 unless
  the (b)-capabilities or row-36 activation land.
- **L-3 (slot-20 capability mapping):** F310C proposed capability
  `asset-lineage` for row 20; the frozen 14-capability vocabulary has no such
  member, so the journey lands on `trustworthy-state` (§2.1). If the TL ever
  extends the vocabulary (a shared-contract change, TL-owned), the mapping
  can be re-expressed; no vocabulary change was made by this lane.
- **L-4 (distinct TL-owned consumers):** the release observability suite and
  the convergence gate scenario already exercise slices of the
  offline-buffer/ingestion-limits/lineage families for their own purposes
  (§3). Those are distinct consumers, not corpus journeys; this lane's
  journeys are the first CORPUS coverage of these families. The TL may
  adjudicate family-level overlap differently at F322 review.
- **L-5 (no provider claims):** ADCOS is CONTRACT_ONLY / provider-not-ready
  — no ADCOS API is driven by this lane, no live/sandbox provider claim is
  made anywhere, and no journey depends on any external provider. The
  pre-existing local ADCOS-kernel journey is untouched.
- **L-6 (epoch law):** no time-parameterization was implemented or
  pre-implemented (F320 D4/D6). Time-dependent behavior WITHIN single
  journeys (offline TTL sweeps, session expiry, calendar windows) is normal
  single-journey behavior, counted once per the count law. The raw
  fieldEpochReRuns grew 555 → 855 (30 journeys × declared epochs) — all
  byte-identical, never counted, per the count-honesty law.
- **L-7 (base-branch note):** this lane branched from main at `8344e71`,
  which contains F321B's delivered-but-unconverged commits; the §6 "F321B
  lane tree" column is quoted from the F321B report (their machine-run), and
  the Wave-11 column is the suite pins' — only the THIS-tree column was
  machine-run by this lane.

## 9. FINAL REPORT data (for the lane message)

- Branch `work/f321a`, base `8344e71`, commits: the ten-journey corpus
  extension → the evidence commit (tip; SHA in the FINAL REPORT message).
- Journeys delivered: **9 of 9 mapped F310C §3.3 slots + the tenth-slot
  replacement** (`ingestion-limits-admission-discipline`, non-ADCOS) — 10
  journeys, **227 assertions**, all machine-run green across all 30 firm
  workspaces.
- Per-suite counts: field **79/79** · security **151/151** · commerce
  **81/81** · convergence **82/82** · adoption 84 pass + 11 pin-fails
  (documented transition) · release 84 pass + 4 pin-fails (documented
  transition) · A-packages all green
  (89/67/207/157/89/77/86/138/178/84/88).
- Recorded transition totals: counted **2148 → 2448** (Wave-11 pin 1848),
  fieldExecutions **555 → 855**, uniqueApplicable **716 → 816**, cap
  **78 → 88**, shortfall **22 → 12**/fully-applicable firm; aggregate
  shortfall 852 → 552. Mask proposals: **zero** (every industry +10,
  machine-evidenced §6–§7).
