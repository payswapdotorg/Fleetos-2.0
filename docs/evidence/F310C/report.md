# F310C — Adoption coverage closure and decision packet (Wave 11 lane C)

- **Work item:** F310C — Wave 11 lane C (`spec/work-items/WORK-ITEM-CATALOG.md`);
  blocker **B-3** (`docs/tech-lead/FINAL-RELEASE-HANDOFF.md`).
- **Worker:** C (work-and-commerce; `spec/worker-ownership.yaml` worker-c) + the
  packet's scoped TL grant `packages/acceptance/adoption/**` (F310C only;
  adoption 95 stays 95, every counted total grows, nothing weakens).
- **Base:** `48c167f` (origin/main HEAD at branch creation — verified, not
  assumed: `git log --oneline -1 origin/main`).
- **Branch:** `work/f310c`. **Final commit:** the branch tip this report is
  committed on (a commit cannot embed its own sha; the nominated sha is
  reported in the lane's FINAL REPORT message and the TL gates at it).
- **Date:** 2026-10-10.
- **Mission:** resolve B-3 honestly — a defensible, machine-verifiable answer
  to "can the 100-counted-journeys-per-firm target be met with genuine product
  capability — and if not, what exactly is missing?" This is an ANALYSIS-FIRST
  lane: the mapping and the decision packet are the core deliverables.

## 1. Owned paths touched (boundary-verified)

- `packages/acceptance/commerce/**` (worker-c owned) — corpus extension
  **21 → 31 journeys**: new `src/journeys/lifecycle.ts` (225),
  `src/journeys/finance.ts` (302), `src/journeys/resilience.ts` (157),
  new step contracts `src/journey-contracts-f310c.ts` (196, split from
  `journey-contracts.ts` to hold the ≤400-line file law), new drivers
  `src/drivers-lifecycle.ts` (293), `src/drivers-finance.ts` (286),
  `src/drivers-resilience.ts` (128); extended `journey-contracts.ts`
  (+4 capabilities: 18 → 22; +3 step-family re-exports), `journeys/index.ts`
  (8 journey files), `runner.ts` (+3 kind-set dispatches: 23 new step kinds),
  `drivers-work.ts` (factKey namespacing + terminal-reason facts; 387 lines),
  `drivers-org.ts` (revokedCapabilities pass-through); tests `corpus.test.ts`
  (31 pinned), `report.test.ts` (22 capabilities).
- `packages/acceptance/adoption/**` (scoped TL grant) — the ledger recompute:
  `adoption-run.ts` (count-honesty law + structural reasons at the real tree
  counts), `convergence-delta.ts` (Wave 11 expectation: commerce 31, cap 68,
  shortfall 32), `industries.ts` (+9 honest masks for the new journeys in
  agriculture/healthcare/facilities/transportation, each rationale mirroring
  its family's existing rationale); 6 test files updated to the recomputed
  machine-run numbers.
- `docs/evidence/F310C/**` — this report.

`git status` at commit time shows exactly those paths. No TL-owned path
touched: `packages/acceptance/release/**` (3 count-pin failures at this tree
are the packet's documented transition state — recorded in §7, suite
untouched), `packages/acceptance/field/**`, `packages/acceptance/security/**`,
`packages/acceptance/convergence/**`, `spec/**`, other lanes' paths — all
untouched.

## 2. The count discrepancy, resolved (expected-21 vs real-31)

The packet's starting figures — commerce **21**, cap **58**, shortfall **42** —
are the Wave-10 converged `main` (`48c167f`, verified). This lane's own
extension (deliverable 2) grew the corpus **21 → 31 before the ledger
recompute**, so the tree's real commerce count at recompute time was **31**,
not 21. Machine verification, every step:

- `tests/corpus.test.ts` pins `JOURNEYS.length === 31` — green; the corpus is
  assembled from eight journey files without loss
  (5+6+5+3+2+4+4+2 = 31, unique ids enforced).
- `tests/journeys.test.ts` runs the per-journey dynamic loop over all 31 —
  green (41 tests); suite total 81 (was 71; +10 = the ten new journeys).
- The adoption machine-run counts `commerceExecutions 822 = 274 × 3 firms`,
  where `274 = 183` (Wave-10 per-industry applicable commerce journeys) `+ 91`
  (the ten new journeys across ten industries after **9 new honest masks**:
  100 − 9). The arithmetic closes exactly:
  `1848 = 555 + 822 + 471`; `616 = 525 + 91`; `68 = 20 + 31 + 17`;
  `1152 = 30 × 100 − 1848`.
- Every element of the 21→31 delta is enumerated in §4, drives REAL package
  public entry points (cited per journey), and is counted once per applicable
  workspace under the count-honesty law (identical reruns never count;
  555 raw field epoch re-runs executed, proven byte-identical, excluded).

**Conclusion:** the "discrepancy" is the extension itself — expected at
dispatch (21) vs real at delivery (31) — with zero unexplained delta. The
starting figures in the packet remain the honest Wave-10 baseline; this tree's
converged figures are commerce 31 / cap 68 / shortfall 32.

## 3. Deliverable 1 — the 42-slot journey-to-capability mapping

The 42 slots are the Wave-10 shortfall (100 − 58) for a fully-applicable firm.
Each slot is mapped to a CONCRETE journey (persona · capability · owning lane)
and classified: **(a)** supported by a real implementation today, **(b)** requires
genuine new capability work, **(c)** no honest proposal today. Every (a) row
cites the real API the journey would drive. No speculative capability
inflation.

### 3.1 (a) DELIVERED this wave — 10 slots (worker C, machine-run green at this tree)

| # | journey (id in corpus) | persona | capability | real API driven |
|---|---|---|---|---|
| 1 | `assignment-supersession` | operations-manager | work-assignment-management | `@fleetos/work` `directory.reassign` (append-only supersession), `removeAssignee`, `assignmentIntegrityHolds` — work/src/directory.ts:124, lifecycle.ts:199/275/316 |
| 2 | `deadline-escalation` | operations-manager | work-deadlines | `@fleetos/work` `evaluateDeadline`/`produceDeadlineEscalation`/`markDeadlineMet` — work/src/deadline.ts:44/103/133 |
| 3 | `workload-release-rebalance` | operations-manager | workload-allocation | `@fleetos/workloads` lifecycle (release restores reservations exactly), `proposeRebalance` — workloads/src/allocation-lifecycle.ts:191, contracts.ts:212 |
| 4 | `project-completion-portfolio` | project-manager | stage-gated-projects | `@fleetos/projects` ProjectDirectory: `transitionProject`, `verifyMilestoneGate` (named blocking items), `completeProject`, `readPortfolio` — projects/src/directory.ts:244/339, contracts.ts:138-143 |
| 5 | `sla-scorecard-credit` | vendor-manager | sla-management | `@fleetos/vendors` `evaluateSla`/`buildSlaScorecard` (vendors/src/sla.ts:204/382) + `@fleetos/procurement` `applySlaPenaltyCredit` (sla-credit.ts:81) — digest-traced credit |
| 6 | `batched-order-reconciliation` | finance-controller | order-reconciliation | `@fleetos/procurement` `reconcileOrdersBatched` — reconciliation-batch.ts:83 (lexical-batch law, whole-run refusal) |
| 7 | `cost-allocation-exact-sums` | finance-controller | cost-allocation | `@fleetos/procurement` `allocateCostAcrossWorkOrders`/`allocatePartialFulfillmentAmounts`/`verifyPartialFulfillmentSums` — cost-allocation.ts:81/196/277 |
| 8 | `renewal-window-sweep` | software-admin | software-entitlements | `@fleetos/software` `sweepRenewalWindows`/`projectSeatUtilization` — renewal-windows.ts:80/197 |
| 9 | `provider-fallback-ladder` | org-optimizer | model-gateway-routing | `@fleetos/model-gateway` `resolveFallbackLadder`/`classifyDegradedMode`/`validateProviderRecords` — providers.ts:106/192 (per-hop reason codes) |
| 10 | `budget-rebalance-proposal` | org-optimizer | optimization-review | `@fleetos/agent-organizations` `rebalanceBudgets`/`classifyBudgetUtilizationBand` — budget-rebalancer.ts:105, budgets.ts (proposal-only, never a mutation) |

These ten slots moved the fully-applicable cap **58 → 68** (machine-run, §5).

### 3.2 (a) AVAILABLE today, deferred to the next worker-C dispatch — 3 slots

Real, production-grade code exists now; not implemented this wave (bounded
delivery — the wave's mandate is analysis-first; each is +1 slot, none changes
the decision packet's conclusion). All three verified as ZERO references in
any acceptance corpus (`rg` over `packages/acceptance/**`):

| # | proposed journey | persona | capability | real API (verified present) | deferral note |
|---|---|---|---|---|---|
| 11 | marketplace-publication-lifecycle | vendor-manager | vendor-marketplace | `@fleetos/vendors` `publishListing`/`applyRevocationCascade`/`searchListings` — marketplace.ts:105/207/287 (publication gate, delisting cascade, deterministic search) | next C dispatch |
| 12 | aurum-delta-sync-session | finance-controller | external-catalog-sync | `@fleetos/aurum` `openSyncSession`/`applyFetchedBatch`/`commitSyncSession`/`verifySyncDigest` + `CURSOR_REGRESSION` — sync-session.ts:118/174/278/312 | resolves the Wave-11 brief's "already covered" claim: TRUE for the package's own unit tests (61 green), FALSE for any acceptance journey — no corpus drives it; next C dispatch |
| 13 | actor-job-failure-expiry | vendor-manager | actor-jobs | `@fleetos/apify` `failActorJob`/`expireActorJob` (wired at drivers-external.ts:243-244 but exercised by NO journey — only start/complete transitions used) + `createActorJobIdempotent` (job-lifecycle.ts:187, unreferenced) | next C dispatch |

### 3.3 (a) PROPOSED for lane A — 10 slots (worker C proposes; lane A owns the corpus; classification by code inspection, not machine-run)

| # | proposed journey | persona | capability | real API (verified present, zero corpus calls) |
|---|---|---|---|---|
| 14 | store-and-forward-redelivery | field-technician | offline-sync | observations `receiveBundle` + sign/verify/digest/gap family — store-forward.ts:184 (refusals :194-202) |
| 15 | offline-buffer-capture-replay | edge-operator | field-mode | connectivity `captureOfflineEntry`/`replayOfflineBuffer`/`sweepExpiredOfflineEntries` — offline-buffer.ts:146/261/330 (the flagship offline journey tests staleness at the experience layer only) |
| 16 | diagnosis-lifecycle | site-manager | investigation | health `proposeDiagnosis`/`applyDiagnosisCommand`/`supersedeDiagnosis` — kernel.ts:214/257/314 (only System-1 `triage` is exercised today) |
| 17 | anomaly-confidence-triage | site-manager | investigation | health `runAnomalyDetection`/`evaluateAnomaly`/`buildRollingWindowFromObservations`/`propagateConfidence` — kernel-signals.ts:161/122/80/211 |
| 18 | evidence-gated-recovery | recovery-coordinator | recovery | recovery `applyRecoveryCommandWithEvidenceChain`/`verifyCaseEvidenceChainPostMortem`/`paginateRecoveryCases` — kernel-evidence.ts:139/180, pagination.ts:97 (tenant-bound cursor) |
| 19 | maintenance-calendar-scale | maintenance-planner | maintenance | maintenance `buildMaintenanceCalendar`/`checkCalendarConflict`/`findNextFreeSlot`/`scheduleWindowsBatch` — scheduling-scale.ts:76/118/148/235 (only point scheduling is driven today) |
| 20 | asset-lineage-material-lots | site-manager | asset-lineage | assets `declareLineage`/`createMaterialLot`/`consumeMaterialLot`/`ancestry`/`verifyLineageChain` — twin-engine.ts:251, lineage/material.ts:144/204, queries.ts:178, graph.ts:243 (~50-export subsystem, zero corpus calls) |
| 21 | adcos-session-trust | edge-operator | edge-command | adcos `enrollSession`/`adjustSessionTrust`/`gateSessionCapability`/`revokeSession`/`expireSessions` — session-registry.ts:108/183/241/216, session-trust.ts:61 |
| 22 | identity-session-lifecycle | field-technician | enrollment | identity `issueSession`/`validateSession`/`sweepSessions`/`bindRole` — kernel.ts:138/188/244, kernel-operational.ts:52 |
| 23 | tenant-lifecycle-gating | site-manager | tenant-isolation | tenancy `establishTenant`/`evaluateTenantOperation` — kernel.ts:285/242 (tenant registry lifecycle has no coverage in EITHER corpus — verified) |

### 3.4 (a) PROPOSED for lane B — 10 slots (worker C proposes; lane B owns the corpus; classification by code inspection, not machine-run)

| # | proposed journey | persona | capability | real API (verified present, zero corpus calls) |
|---|---|---|---|---|
| 24 | tamper-evident-audit-ledger | compliance-auditor | decision-provenance | security `appendAuditEvent`/`verifyAuditLedger`/`sealAuditLedgerHead`/`verifyAuditLedgerAgainstAnchor` — audit-ledger.ts:163/220/279/289 (whole module zero-coverage) |
| 25 | finding-storm-triage | security-analyst | investigate-findings | security `runStormIntake`/`buildStormTriageQueue`/`dedupeFindingStorm`/`correlateFindingStorm` — finding-storms.ts:294/242/74/170 (normal-volume intake is driven; the storm path never) |
| 26 | finding-suppression-lifecycle | security-analyst | investigate-findings | security `suppressFinding`/`expireSuppressions`/`resolveFinding`/`isEffectivelyOpen` — lifecycle.ts:58/118/89/149 (honest return-to-open on expiry) |
| 27 | verified-execution-dispatch | site-reliability-engineer | execution-ledger | execution `executeWithVerification`/`dueCommands`/`drainQueue` + incident-audit sealers — verification.ts:54, command-queue.ts:299, queue.ts:91, incident-audit.ts:47/71/90 |
| 28 | action-compensation-rollback | remediation-engineer | action-plans | actions `buildCompensationContract`/`cancelAction`/`attemptCompensation` + `dispatchWithIdempotency` — compensation.ts:64/126/167, idempotency.ts:75 |
| 29 | capability-store-dr | tenant-operator | guardian-decision | policy `openCapabilityStore`/`issueCapabilityGrant`/`revokeCapabilityGrant`/`decideCapability` + DR snapshot/restore/verify — capability-store.ts:70/142/159/224, capability-store-dr.ts:89/126/202 |
| 30 | arena-evaluation-runs | ml-engineer | benchmark-trust | arena `stageRun`/`startRun`/`scoreRun`/`reportRun`/`abortRun` + certification chain — evaluation-runs.ts:147/231/244/214/221, certification.ts:115/193/227/262 |
| 31 | outcome-evaluation-adoption | ml-engineer | learning-from-outcomes | learning `intakeOutcomes`/`joinOutcomesWithPredictions`/`computeEvaluationSummary`/`generateAdoptionProposalFromEvaluation`/`rejectAdoption`/`withdrawAdoption` — outcome-intake.ts:112, join.ts:50/163/104, adoption-lifecycle.ts:266/317 |
| 32 | jepa-family-honesty | ml-engineer | predictive-honesty | world-model `makeJepaMaskedAdapter`/`makeJepaRolloutAdapter`/`latentCounterfactual`/`runJepaBenchmark` — jepa/index.ts:189/232, counterfactual.ts:80, benchmark.ts:121 (only the core family is driven today) |
| 33 | degradation-staleness-honesty | site-reliability-engineer | predictive-advice | predictive `predictWithDegradation`/`widenUncertainty`/`buildCounterfactualWithWidenedUncertainty`/`propagateStaleness`/`verifyStalenessPropagation` — feature-projection.ts:204/134/155, staleness-propagation.ts:91/142 |

### 3.5 (b) Requires genuine new capability work — 6 slots

| # | capability gap | owning lane | what exists today (honestly) |
|---|---|---|---|
| 34 | marketplace transaction flow (ordering/checkout over published listings) | C | `vendors/marketplace.ts` stops at publication + search; order semantics over listings do not exist |
| 35 | tenant billing & invoicing (seat/consumption billing from entitlements + gateway usage) | C | no billing package exists in the tree (verified absence) |
| 36 | honest corpus time-parameterization (per-epoch DISTINCT expectations — not byte-identical reruns) | TL + A/B/C | field journeys pin T0-anchored expectations (machine-verified: +1s offset fails 1 journey; epochs ≥2 byte-identical, never counted); commerce/security runners are not time-parameterizable. **Highest-leverage single item: at 20×3 + 31×3 + 17 = 170 it alone exceeds the 100 target** — but only if per-epoch executions are made genuinely distinct, which is real capability work in the runners and journey laws |
| 37 | predictive maintenance with a validated trained model | A | predictive outputs must remain deterministic structural references until a model is validated (FINAL-RELEASE-HANDOFF law) — a real validated model is new capability |
| 38 | live external connector integration (real endpoints + credential handling) | A/B/C adapters | the connector matrix is CONTRACT_ONLY (adcos/arena/aurum/apify); honest live-integration journeys become possible only after real bindings exist |
| 39 | edge firmware/OTA campaign management (staged waves, halt, rollback) | A | no such module exists under connectivity/adcos (verified absence) |

### 3.6 (c) No honest proposal today — 3 slots

| # | reason | equivalent scenario / note |
|---|---|---|
| 40 | rerun/telemetry inflation is prohibited forever by the count-honesty law | identical reruns (the 555 raw epoch re-runs), synthetic telemetry, dummy success, or broadened applicability masks NEVER count — no slot can ever be filled this way (adoption-run.ts count-honesty law) |
| 41 | agent-operation journeys are structurally inapplicable for OEM-autonomy industries | agriculture/healthcare/facilities mask the agent-operation family (no in-house agents; OEM-embedded machinery autonomy) — whatever the corpus size, those industries' honest ceiling is below 100; the mask rationales record the incumbent-path equivalents (industries.ts) |
| 42 | the honest remainder | beyond rows 1-39 no further concrete honest journey is nameable today without speculative capability inflation; deeper mining of the additionally-unexercised families (observations ingestion-limits/backpressure/retention, journal compaction, command storm guard, sim-worlds checkpoint/resume, evidence artifact store, posture-fold determinism, world-context windowing, simulation replay/benchmark) is lane-owner work to adjudicate — C does not speculate on their behalf |

### 3.7 Mapping summary (machine-checkable arithmetic)

- **33 of 42 slots** have real implementations today: 10 delivered (this wave) +
  3 deferred (C) + 10 proposed (A) + 10 proposed (B).
- **6 slots** need genuine new capability (§3.5); **3 slots** are the honest
  remainder (§3.6).
- Cap trajectory for a fully-applicable firm:
  `58` (Wave 10) → `68` (this wave, machine-run) → `71` (C's deferred 3) →
  `81` (A's proposed 10) → `91` (B's proposed 10) → `97` (the six (b)
  capabilities) — with 3 slots structurally open at **97/100**.
- Row 36 (time-parameterization) is the strategic exception: alone it lifts
  the ceiling to 170, but it is genuine capability work with counting-law
  semantics the TL must own.

## 4. Deliverable 2 — the additions (genuineness evidence)

Ten new journeys, all machine-run green (commerce suite 81 tests, §7).
Genuineness case per the packet's laws:

- **Real behavior, real APIs.** Every step of every new journey dispatches to
  a REAL public entry point of a worker-c-owned domain package (citations in
  §3.1; drivers-lifecycle/-finance/-resilience contain no business logic —
  they interpret typed steps against the domain packages and record facts).
- **Genuinely distinct.** Unique ids (corpus law, enforced by corpus.test.ts);
  ten distinct capability surfaces, four new vocabulary capabilities
  (18 → 22: work-assignment-management, work-deadlines, sla-management,
  cost-allocation); 23 new step kinds; no journey re-executes another's steps.
- **Honest refusal paths everywhere.** Each journey asserts the domain's
  refusals as first-class facts: `ALREADY_ASSIGNED` on supersession without a
  live assignee, `MILESTONES_NOT_ACHIEVED` with named blocking items and an
  audited refusal, `SHARES_MUST_SUM_TO_10000` (no silent normalization),
  `INVALID_VALID_UNTIL` refusing the whole sweep, `TENANT_MISMATCH`
  fail-closed in every finance seam, `NO_PROVIDER_CAN_SERVE`,
  `INSUFFICIENT_HEADROOM`, `CAPABILITY_REVOKED`, `ASSUMPTION_EMPTY`,
  exact signed drift `-2` never clamped, capApplied recorded when the SLA
  penalty cap binds. No dummy success anywhere.
- **No reruns counted.** The corpus runs ONCE per workspace
  (runAllJourneys); determinism machine-verified (adoption
  `determinismVerified: true`; byte-identical re-runs excluded by law).
- **No mask weakening.** Masks only ADDED (9, §5) — each new mask NARROWS a
  masked industry's count (the honest direction), with rationales mirroring
  their families' existing rationales; no existing mask was removed or
  broadened (industries.ts diff, boundary-verified).
- **≥5 assertions per journey** (27+17+19+32+27+21+14+23+23+18 = 221 new
  assertions; corpus law enforced by corpus.test.ts).

## 5. Deliverables 3+4 — the recomputed ledger (machine-run at this tree)

The full-industry adoption simulation (30 firm workspaces, REAL corpora,
deterministic, machine-run via the package's own runner):

- COUNTED journey executions: **1,848** (field 555 + commerce 822 +
  security 471) — was 1,575 (+273 = 91 new applicable × 3 firms).
- Raw epoch re-runs: 555 (executed, proven byte-identical, NEVER counted).
- Unique applicable journeys: **616** — was 525 (+91).
- Fully-applicable firm cap: **68** = field 20 + commerce 31 + security 17 —
  was 58. **Shortfall 32** per fully-applicable firm — was 42.
- Aggregate shortfall: **1,152** = 30 × 100 − 1,848 — was 1,425.
- New masks: **9** (agriculture +4: project-completion-portfolio,
  renewal-window-sweep, provider-fallback-ladder, budget-rebalance-proposal;
  healthcare-facilities +2 and facilities-management +2: provider-fallback-
  ladder, budget-rebalance-proposal; transportation-logistics +1:
  project-completion-portfolio) — every rationale mirrors its family's
  existing rationale (agent-operation/OEM-autonomy, stage-gated,
  software-entitlements).

Per-firm / per-industry honest-counts ledger (firms of an industry share
verdict inputs; every firm's shortfall carries the structural reasons):

| industry | counted/firm | shortfall/firm | note |
|---|---|---|---|
| manufacturing | 68 | 32 | fully applicable (cap) |
| energy-utilities | 68 | 32 | fully applicable (cap) |
| mining | 66 | 34 | |
| construction | 65 | 35 | |
| telecommunications | 64 | 36 | |
| water-waste | 64 | 36 | |
| transportation-logistics | 61 | 39 | |
| facilities-management | 55 | 45 | agent-operation masks |
| healthcare-facilities | 54 | 46 | agent-operation masks (regulated) |
| agriculture | 51 | 49 | deepest honest mask set (17 masked) |

The convergence expectation (`convergence-delta.ts`): the Wave 11 sibling
lanes (F310A root typecheck, F310B full build) are VERIFICATION lanes with no
corpus changes, so the converged cap at F311 is this tree's 68 — recorded for
the TL's recompute; the FINAL cross-lane convergence (release pins) is TL
work at F311, not pre-empted here.

## 6. Deliverable 5 — the decision packet

**The question on the table:** the 100-counted-journeys-per-firm target —
build toward it, hold it, or revise it (TL/user decision; Wave-10 precedent:
the worker cannot self-authorize a target change).

### Option 1 — build the genuine missing capability (the mapping IS the roadmap)

Dispatch shape grounded in §3, with effort estimates from this wave's actuals
(10 journeys + drivers + ledger recompute = one bounded lane wave):

- **Worker C, next wave:** rows 11-13 (+3 slots) — ≈ one-third of a wave
  (journey data + three driver extensions).
- **Worker A, one wave:** rows 14-23 (+10 slots) — one corpus wave over
  already-shipped package code (mirrors F300A's 14→20 field extension).
- **Worker B, one wave:** rows 24-33 (+10 slots) — one corpus wave (mirrors
  F300B's 13→17 security extension).
- **The (b) capabilities (rows 34-39):** row 36 (time-parameterization) is
  TL-owned law work and the single highest-leverage item (ceiling 170);
  rows 34/35 (C), 37 (A), 38 (adapters), 39 (A) are 1-2 waves each,
  partially parallelizable.

Trade-offs: honest and capability-first; realistically **2-4 waves** to a
100-cap depending on the parameterization decision; the verdict stays NOT
READY until the cap is machine-run at ≥ 100.

### Option 2 — retain the 100 target; remain NOT READY until the capability exists

The target stands unchanged; B-3 remains an explicit named blocker; this
report's ledger (cap 68, shortfall 32) is the honest interim state. No
padding, no mask weakening, no reruns. Trade-off: the release stays gated on
an aggressive bar for an alpha-stage product; the path to green is exactly
Option 1's roadmap.

### Option 3 — an explicit recorded TL/user decision revises the acceptance criterion

E.g. redefine to "distinct-journey coverage with documented per-industry
masks" (the honest-counts ledger already computes it), or a staged threshold
(91 = the concrete bar reachable from existing code; 97 = with the named (b)
capabilities). Only by recorded TL/user decision; nothing in this lane's
evidence justifies the worker proposing a specific lower number — the
mapping shows 100 is substantially reachable, which argues AGAINST revision.

### RECOMMENDED: **Option 2 now — retain the 100 target and remain NOT READY — with Option 1's Wave-12 shape attached as the standing roadmap** (C: rows 11-13; A: rows 14-23; B: rows 24-33; then the (b) capabilities, adjudicating row 36 parameterization FIRST at F311).

Reasoning:
1. The mapping machine-shows the target is **substantially reachable with
   genuine capability** (91/100 from existing code; 97/100 with the named
   (b) capabilities) — so revising the criterion now (Option 3) is premature:
   no honest evidence says 100 is wrong, only that it is not yet met.
2. No single wave closes it: the remaining 32 slots need per-lane dispatches
   plus capability builds — Option 1 is a standing roadmap, not a this-wave
   decision.
3. Row 36 (honest time-parameterization) changes the SHAPE of the target
   (ceiling 170) and its counting semantics belong to the TL — it should be
   adjudicated at F311 before further corpus waves are sized.
4. The worker cannot self-authorize a target change; the Wave-10 precedent
   stands. The verdict remains **NOT READY** at this tree; the ledger delta
   is recorded, never padded.

## 7. Quality gates at the final commit (machine-run)

| gate | result |
|---|---|
| commerce suite (`vitest run`) | **81/81 green** (corpus 12, journeys 41, runner 14, report 14) — was 71 (+10, grow-only) |
| adoption suite | **95/95 green** (8 files) — 95 stays 95; every counted total grows (grow-only law) |
| field suite | **69/69 exact** (untouched) |
| security suite | **103/103 exact** (untouched) |
| convergence suite | **82/82 exact** (untouched; consumes the corpus dynamically, no hardcoded counts) |
| release suite (TL-owned) | **85 pass / 3 fail** — the 3 failures are EXACTLY the packet's documented count-pin transition state: release-gate.test.ts commerce pin (31 ≠ 21, ×2 assertions) and integration.test.ts adoption pin (1848 ≠ 1575); suite untouched per the packet's law |
| monorepo acceptance total | 508 → **518** (grows only) |
| typecheck | `tsc --noEmit` clean in commerce AND adoption |
| lint | oxlint 0 warnings / 0 errors in both packages |
| file law (≤400 lines) | max touched: industries.ts 398, drivers-work.ts 387 — all ≤ 400 |
| boundary scan | `git diff --name-only main` = commerce/** + adoption/** only (+ this evidence path); no TL-owned or sibling-lane path touched |
| purity | new drivers use logical CLOCK only, WeakMap per-state seams, no clock/randomness/network/env — deterministic, machine-verified byte-identical re-runs |

## 8. Residuals / honest limitations

- **R-1:** release pins (commerce 21, adoption 1575) fail at this tree — the
  documented transition state; the TL updates them at F311 (untouched here,
  per the packet).
- **R-2:** rows 11-13 are real today but deferred — the next C dispatch owns
  them; not padding the wave with rushed driver surface.
- **R-3:** the A/B classifications (rows 14-33) are code-inspection proposals
  with citations, NOT machine-run journeys; lanes A and B own the adjudication
  and the corpus work. C proposes, never implements.
- **R-4:** the 9 new masks deepen the honest shortfall for the masked
  industries (agriculture 49/firm) — structural to those industries' incumbent
  profiles, recorded per masked journey.
- **R-5:** 3 slots (rows 40-42) remain honestly unfilled; the 100 target is
  97-reachable per §3.7 — the last 3 slots require lane-owner mining or the
  TL's parameterization adjudication, not this lane's speculation.
- **R-6:** the corpus count grew 21 → 31 in ONE lane wave; corpus-shape laws
  (unique ids, vocab, ≥5 assertions, ≥25 step kinds) are enforced by tests,
  but the REVIEW burden on the TL grows with the corpus — the mapping's A/B
  proposals deliberately cap at 10 per lane for reviewability.

## 9. FINAL REPORT data (for the lane message)

- Branch: `work/f310c`; base `48c167f`; nominated commit: the branch tip this
  report is committed on (sha in the lane's FINAL REPORT message).
- Per-suite counts: commerce **81** / adoption **95** / field **69** /
  security **103** / convergence **82** / release 85+3 (documented pins).
- Ledger delta: counted **1575 → 1848**; cap **58 → 68**; shortfall
  **42 → 32**/fully-applicable firm; aggregate shortfall 1425 → 1152;
  unique applicable 525 → 616; masks +9 (honest narrowing only).
- Recommended option: **Option 2 (retain 100, NOT READY) with Option 1's
  Wave-12 roadmap attached** (§6).
