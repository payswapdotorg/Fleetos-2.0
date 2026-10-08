# F270C — Worker C (Work + Commerce) Work/Commerce/Project Acceptance Journeys Evidence

- **Work item:** F270C — work/commerce/project acceptance journeys, C (Wave 7 lane C; catalog: `spec/work-items/WORK-ITEM-CATALOG.md`)
- **Owner:** Worker C (work-and-commerce)
- **Base commit:** `926c03e` (the inherited WIP commit on top of the dispatch tip `3c199ac`; main = `cf3f68b`, Wave 6 complete, full suite 3667/0 at dispatch)
- **Branch:** `work/f270c`
- **Date:** 2026-10-09
- **Inherited WIP:** a prior interrupted session left a substantial on-branch WIP (full package scaffold: journey contracts, 14 journeys, runner, report, 4 test files, 63 tests — TL's local re-run found 59/63 with 4 failures). Per the continuation protocol I machine-verified the TRUE baseline of every lane package BEFORE the first edit, audited every WIP file against the packet, diagnosed each of the 4 failures against the REAL lane-package behavior, fixed the drivers/assertions at the root (never weakening an assertion), closed one coverage gap (the Aurum adapter), and re-gated everything.

## 1. Owned paths touched

Per `spec/worker-ownership.yaml` (worker-c, grant `packages/acceptance/commerce/**`):

- `packages/acceptance/commerce/**` — `@fleetos/acceptance-commerce` (private, Apache-2.0, type: module; exports map `.` + `./journeys` + `./runner` + `./report`): `src/journey-contracts.ts`, `src/journey-world.ts`, `src/runner.ts`, `src/report.ts`, `src/index.ts`, `src/drivers-{work,procurement,vendors,external,aurum,org}.ts`, `src/journeys/{work,commerce,org,index}.ts`, 4 test files (`tests/journeys.test.ts`, `tests/runner.test.ts`, `tests/report.test.ts`, `tests/corpus.test.ts`).
- `docs/evidence/F270C/**` (this report).

`git status` at commit time shows exactly `packages/acceptance/commerce/` + this evidence path; `pnpm-lock.yaml` NOT mutated this session (workspace install matched HEAD's lockfile byte-for-byte — left untouched, nothing to leave uncommitted). No spec edits, no snapshot regen, no other lane's path touched (verified: all twelve lane package suites re-run green after the last edit, §2).

Dependencies (`workspace:*`, own lane only, public entry points only — package-root imports, no deep paths): `@fleetos/work`, `@fleetos/projects`, `@fleetos/workloads`, `@fleetos/procurement`, `@fleetos/vendors`, `@fleetos/software`, `@fleetos/agent-organizations`, `@fleetos/model-gateway`, `@fleetos/experience-work-commerce`, `@fleetos/external-vendors`, `@fleetos/apify`, `@fleetos/aurum` — all twelve, all now actually driven (the WIP declared `@fleetos/aurum` but never imported it; §5.6).

## 2. Baselines — machine-run BEFORE first edit, re-verified AFTER last edit

All twelve lane packages at the inherited WIP commit `926c03e`, before any edit and again after the last edit (identical counts — pre-existing suites untouched and green; 907 domain tests):

```text
work 3 files/72 tests    projects 2/63    workloads 2/69    procurement 2/94
vendors 2/56             software 2/62    agent-organizations 10/182
model-gateway 5/81       integrations/vendors (external-vendors) 4/51
integrations/apify 4/68  integrations/aurum 4/61
experiences/work-commerce 4/49
```

## 3. Deliverables (all pure deterministic TS; logical `now`/caller-supplied inputs everywhere)

### 3.1 `src/journey-contracts.ts` (246 lines) — journeys are DATA

`AcceptanceJourney` = fixed 7-persona vocabulary (operations-manager, procurement-lead, project-manager, vendor-manager, software-admin, org-optimizer, finance-controller) + goal + capability (15-entry vocabulary) + typed domain-operation steps (`JourneyStep` union: 47 step kinds across work/projects/workloads/procurement/vendors/software/external-catalog/apify/aurum/org) + declarative `JourneyAssertion`s (7 operators). `JourneyOutcome` carries per-step ok + per-assertion pass with ACTUAL vs EXPECTED values; FNV-1a journey digest. No journey code executes anything — the runner does; no assertion can hide a failure.

### 3.2 `src/journeys/` — the 15-journey corpus

| # | Journey | Persona / Capability | Steps / Assertions | Drives (REAL public APIs) |
|---|---------|----------------------|--------------------|---------------------------|
| 1 | create-work-order | operations-manager / create-work | 2 / 6 | WorkRepository store + WorkItemDirectory → `buildWorkBoard` (todo column, card id, digest) |
| 2 | approve-execute-work-order | operations-manager / approve-execute-work | 9 / 16 | assign + start + complete through the REAL directory; `postLedgerEntry` actuals; `computeBudgetPosition` severity warning→breach (12000 bps, negative remaining, exact overshoot); `verifyLedgerChain`; final board |
| 3 | stage-gated-project | project-manager / stage-gated-projects | 18 / 11 | `transitionProject` activate; `transitionStage` (close refused with `OPEN_MANDATORY_CHECKPOINTS`); `completeStageCheckpoint` (double-complete refused `CHECKPOINT_ALREADY_COMPLETE`); `checkMilestoneGate` (`WORK_ITEMS_NOT_TERMINAL` → achieved); `buildProjectStageGateView` frontier + unlock |
| 4 | workload-allocation | operations-manager / workload-allocation | 8 / 14 | `applyDemandIdempotent` (apply → duplicate → `EXCEEDS_CAPACITY:2` → apply); `applyLifecycleToLedger` commit→activate; `validateWindow` + `detectWindowOverlaps` (lexical pair + tie-break rule); `buildWorkloadRollup` (10000 bps, 0 remaining, never over-allocated) |
| 5 | procure-spine | procurement-lead / procurement-spine | 16 / 20 | `transitionDemandFlow` (unauthorized solicit refused `AUTHORIZATION_DENIED`); quote submit; `buildQuoteScoreView` (rank-1 9333 bps decomposition); authorized award → draft order with Guardian ref; order confirmed→shipped→received; fulfillment in_transit→delivered→verified with evidence; `buildSpineBoard` (6 cards, lineage parents, per-status counts) |
| 6 | quote-scoring | procurement-lead / quote-scoring | 2 / 5 | `buildQuoteScoreView` twice with permuted input: deterministic tie-break `lower-total-cost`, rank order, byte-identical digest |
| 7 | order-reconciliation | finance-controller / order-reconciliation | 4 / 6 | `reconcileOrderTotals`: short 2000 bps / exact / over 1000 bps / empty-receipts fully short with exact variance |
| 8 | vendor-management | vendor-manager / vendor-management | 12 / 11 | `transitionVendorLifecycle` (active→suspended→reinstated→terminated→`TERMINAL_STATE`); `verifyCapability` (evidence required, `ALREADY_VERIFIED`); exposure commits to ceiling with exact overshoot; `buildVendorKpiRollup` (terminated status, 8000 bps, acceptance 0 bps honestly) |
| 9 | software-entitlements | software-admin / software-entitlements | 6 / 13 | `checkEntitlement` (1 fits, 3 refused `OVER_ALLOCATION` with overshoot 1); `assignGrantWithinPopulation`; `revokeGrant` + `countHeldSeats`; `buildSeatView` (3/5 seats, 6000 bps, not expired) |
| 10 | aurum-settlement-seam | finance-controller / settlement-adapter | 9 / 7 | REAL deterministic `createDeterministicAurumAdapter` ports: fresh→cached idempotency, unknown intent `AURUM_DEGRADED` after 3 attempts, empty key `IDEMPOTENCY_KEY_EMPTY`, SAME key under foreign tenant = separate cache entry (tenant-scoped idempotency), outage `AURUM_UNAVAILABLE`; `isAurumProjection` + `aurumDoesNotOwnDomainTruth` boundary (a domain kind FAILS — the check catches violations) |
| 11 | external-catalog-sync | vendor-manager / external-catalog-sync | 8 / 21 | `importCatalogBatch` (within-batch dedupe; LWW: identical re-import = duplicate, older = stale); `verifyCapability` (gps verified; never-claimed cold-chain `CAPABILITY_NOT_CLAIMED`); `ingestVendorMetrics` (1 admitted, m-2 `CAPABILITY_NOT_VERIFIED` + m-3 `VENDOR_UNKNOWN` quarantined); `rollupVendorScorecards` before/after revocation (9000 bps → honest 0); `revokeVerification` + `applyRevocationToMetrics` (m-1 `CAPABILITY_REVOKED`); `verifyCatalogDigest` |
| 12 | apify-actor-job | vendor-manager / actor-jobs | 13 / 12 | `createActorJob` (manifest verified); `authorizeActorJob` (deny then allow); `scheduleActorJob` under a 10-unit rate budget (job-1 8 units ok; job-2 +5 refused `RATE_BUDGET_EXCEEDED` overshoot 3 — the ledger accounting stays honestly 8000 bps, ceiling-not-authorization); start→complete; `ingestJobResult` (structured quarantined `EVIDENCE_NOT_ATTACHED`; malformed quarantined `PAYLOAD_MALFORMED`); `attachEvidenceBundle` (structured→usable; malformed refused `RESULT_NOT_QUARANTINED` — evidence cannot launder); `partitionByState` |
| 13 | org-optimization-review | org-optimizer / optimization-review | 8 / 21 | `nextOrgEntry` journal chain (5 events); `appendUsage` through the REAL `checkAgentBudget` port (first commits, second refused `BUDGET_REFUSED_BY_ORG:UNITS_EXHAUSTED`); `buildModelUsageRollup` (chain verifies); `prepareOptimizationInputs` + `allocateRoles` (proposal-only, full scoring trace, 5000 bps fit) + `projectWhatIf` (experimental, org digest UNCHANGED — nothing applied); `buildCapabilityBudgetBoard` (8333 bps, ceiling note) |
| 14 | cross-role-handoff | procurement-lead / cross-role-handoff | 23 / 12 | Full chain: solicit→quote→award→confirm→ship→deliver→verify→receive (procurement lead) THEN project + work order + milestone gate + workload allocation (operations manager) → spine board + work board both show the closed chain |
| 15 | tenant-fail-closed | procurement-lead / tenant-isolation | 14 / 5 | Cross-tenant evidence refused at solicit (`EVIDENCE_TENANT_MISMATCH`), award, and fulfillment verify; cross-tenant quote makes the WHOLE spine board refuse `TENANT_MISMATCH` (never silently filtered); the in-tenant chain still completes |

### 3.3 `src/runner.ts` (188 lines) — the deterministic executor

Dispatches typed steps to six driver modules (work/procurement/vendors/external/aurum/org) over kind sets; executes in declared order against the caller-threaded `JourneyState` (the world owns NO domain truth — every record is built through REAL constructors); records every fact `<stepId>`-namespaced with latest-write-wins plus named sequence logs; a thrown/unknown step marks not-executed and FAILS the journey; a failing assertion fails the journey — no soft passes. Re-runs byte-identical (machine-tested).

### 3.4 `src/report.ts` (107 lines) — acceptance reports

Per-journey outcomes + totals + the persona × capability coverage matrix (7 × 15 = 105 cells) with HONEST ZERO-INFLATION: a cell is `covered` ONLY when at least one PASSING journey claims it. Report digest + `verifyJourneyReport` tamper detection + deterministic canonical JSON rendering.

### 3.5 Tests — 65 net-new, 4 files

`tests/journeys.test.ts` (25: every journey as a test + per-view digest shapes + step-order + the aurum seam idempotency), `tests/runner.test.ts` (14: determinism byte-identical, broken-journey failure with ACTUAL vs EXPECTED, MISSING_FACT sentinel, throwing steps, tenancy fail-closed probes, isolation equivalence), `tests/report.test.ts` (14: totals, 105-cell grid, zero-inflation both directions, digest/tamper ×3, deterministic rendering), `tests/corpus.test.ts` (12: ≥12 journeys, unique ids, vocabulary membership, packet-required capability set, persona spread).

## 4. Machine-verified corpus result (the honest numbers)

```text
{"journeyCount":15,"passed":15,"failed":0,"assertionCount":180,"failedAssertions":0}
steps executed: 152/152   failed steps: 0
report digest: report_b95c3a28 (verifyJourneyReport: true)
```

Coverage matrix: 105 cells; 15 covered (one passing journey each); ALL 15 capabilities covered; all 7 personas exercised: procurement-lead ×4, operations-manager ×3, vendor-manager ×3, finance-controller ×2, project-manager ×1, software-admin ×1, org-optimizer ×1.

## 5. Inherited-WIP completion log (what the prior session got wrong, machine-fixed)

1. **workload-allocation a8 (operator misuse):** the assertion used `op: "eq"` (reference equality) with an ARRAY expected — two distinct `["w-1&w-2"]` instances can never be `===`, so it failed despite identical rendering. Fixed to `op: "deepEq"`; the expected value is unchanged (the REAL `detectWindowOverlaps` output). No weakening — the expected value is identical.
2. **external-catalog-sync (stale-fact expectations, 7 assertions):** the WIP asserted values that were TRUE of intermediate steps but written against fact keys the LATER steps overwrite (runner semantics: latest write wins). Diagnosed against the REAL `importCatalogBatch`/`verifyCapability`/`rollupVendorScorecards` and fixed at the root:
   - a2 `catalog.imported`: REAL second batch imports exactly ONE entry (x-ven-3) — identical-content re-import at equal logicalTime is an idempotent duplicate skip, older logicalTime is stale. Re-derived 3 → 1.
   - a3/a4: replaced the impossible accumulated-id expectations with a NEW sequence log `catalog.importLog` (driver now records `imported:duplicates:stale` per batch) asserting BOTH batches' full REAL outcomes — strictly stronger than the WIP intent. a4 duplicates re-derived `["x-ven-1","x-ven-1"]` → `["x-ven-1"]`; NEW assertion a21 pins `catalog.stale = ["x-ven-2"]` (LWW), which the WIP never asserted.
   - a7 `xverify.ok`: the LAST verify step (cold-chain, never claimed) refuses `CAPABILITY_NOT_CLAIMED`, so the final fact is honestly `false`; replaced with the NEW `xverify.log` sequence assertion `["true:verified","false:CAPABILITY_NOT_CLAIMED"]` — asserts BOTH the gps success and the refusal.
   - a14 `scorecards.vendors`: REAL rollups exist for every vendor WITH METRICS — `["x-ven-1","x-ven-2","x-ven-9"]` (the unknown vendor is visible with a quarantined metric; x-ven-3 has no metrics). Re-derived.
   - a15: the WIP asserted the PRE-revocation bps on a fact key the POST-revocation call overwrites (it could never pass). Replaced with the NEW `scorecards.bpsLog` asserting BOTH calls: `["0,9000,0","0,0,0"]`.
   - a16 `scorecards.exclusionLines`: re-derived post-revocation: `["m-2:CAPABILITY_NOT_VERIFIED","m-1:CAPABILITY_REVOKED",""]` (the W1-only metric of the unknown vendor does not surface in the W2 rollup — REAL `aggregate` reads current-window exclusions only).
3. **apify-actor-job a5/a6/a11 (driver swallowed REAL outputs):**
   - a5/a6: the WIP driver returned `-1`/`null` for budget facts when the reservation is refused, hiding the REAL ledger accounting. Root fix in the driver: surface `accountRateBudget(state.apify.rateLedger)` (the REAL public API) over the ledger AS IT STANDS after the step — a refused reservation leaves the ledger untouched, so the honest utilization (8000 bps), spent units (8) and the `ceiling-not-authorization` note are the REAL outputs and are now asserted as such, together with the overshoot (3).
   - a11: the refused evidence-attach branch returned early without partition facts, so `quarantinedCount` was stale from the earlier successful attach. Root fix: the refused branch also surfaces `partitionByState` over the current REAL result set — the malformed result stays quarantined (1) and cannot be laundered, which is exactly what a11/a12 now assert.
4. **report.test.ts (1 failure):** downstream of the three failing journeys — passes unchanged after the journey fixes (no test edit needed).
5. **File-law violation:** the WIP `src/drivers-commerce.ts` was 427 lines (> 400, oxlint max-lines error). Split by domain into `src/drivers-procurement.ts` (spine steps) + `src/drivers-vendors.ts` (vendor/software steps) with explicit runner dispatch; also fixed the `./journeys` export-map entry from `index.js` to `index.ts` (the F270A/F270B convention).
6. **Coverage gap closed — the Aurum adapter was declared but never driven:** the packet lists `@fleetos/aurum` among the lane entry points to drive; the WIP declared the dependency and imported nothing from it. Added journey #10 (aurum-settlement-seam) + the `AurumStep` contract + REAL deterministic adapter ports in the world + `drivers-aurum.ts`, asserting idempotency dedupe, honest degraded/unavailable states, tenant-scoped idempotency separation, and the never-owns-domain-truth boundary — all through the REAL public API.

## 6. Machine-verified gates (exact, in the package dir)

```text
corepack pnpm run test
  Test Files  4 passed (4)      Tests  65 passed (65)          # PASS (≥ 60 net-new)
corepack pnpm run typecheck
  # no output, exit 0                                          # PASS
corepack pnpm run lint
  Found 0 warnings and 0 errors. Finished in 12ms on 19 files using 2 threads.   # PASS
```

## 7. Boundary verification (machine-tested)

- Import scan over src+tests → own-lane package roots ONLY (`@fleetos/{work,projects,workloads,procurement,vendors,software,agent-organizations,model-gateway,experience-work-commerce,external-vendors,apify,aurum}`), no deep paths, no cross-lane imports.
- Determinism sweep → CLEAN (no `Date.now`, `Math.random`, `new Date`, timers, `fetch`); logical `now`/`computedAt`/`verifiedAt`/`ingestedAt` caller-supplied throughout; the only `Date.now` occurrence is a doc comment saying it is never used.
- File law → largest source file 370 lines (`src/journey-world.ts`); all ≤ 400.
- `git status` → exactly `packages/acceptance/commerce/**` + `docs/evidence/F270C/**`; `pnpm-lock.yaml` byte-identical to HEAD this session; no spec edits, no snapshot regen.

## 8. Contract deltas / seams for TL adjudication

1. **model-gateway ↔ agent-organizations budget port (inherited WIP design, kept):** the journey world binds the gateway's `BudgetCheckPort.check` to the REAL `checkAgentBudget` — both are worker-C lane packages and the shapes are the documented seam (same intra-lane composition precedent as F260C's adjudicated boundary). Composition site: `src/journey-world.ts` `realBudgetPort`.
2. **Runner fact semantics (latest-write-wins + named sequence logs):** per-step scalar facts overwrite; multi-step behaviors are asserted through driver-maintained sequence logs (`catalog.importLog`, `xverify.log`, `scorecards.bpsLog`, `apify.statusLog`, `aurum.kindLog`, …). This is the acceptance-lane convention that makes "the whole journey" assertable; any future driver MUST log multi-call sequences or assertions will silently pin only the last call's state.
3. **Aurum responses are fixture-shaped through the REAL adapter:** the world configures `createDeterministicAurumAdapter` with two intents (`settle-invoice`, `fetch-balance`) — the response payloads are caller-supplied adapter configuration (the adapter is transport-agnostic by design); only adapter-computed behavior (cache, retries, reason codes, boundary checks) is asserted.
4. **No new shared contracts proposed** — the journey contract mirrors F270A/F270B's shape verbatim; capability/persona vocabularies are lane-local.

## 9. Residual limitations (honest list)

1. The aurum journey drives the deterministic reference adapter, not a live payment provider — the REAL adapter contract (idempotency, honest degradation, boundary) is fully exercised; transport is out of scope by law A7.
2. Views are computed per journey over caller-built worlds — no persistence, no pagination (presentation plane only).
3. `buildQuoteScoreView` is driven with journey-supplied quote inputs (the REAL comparison runs over them); the spine-board quotes come from the REAL procurement transitions — both are REAL outputs, but the corpus does not run every view over every possible record shape.
4. The tenant-fail-closed journey exercises cross-tenant refusals in the procurement/vendors seam surfaces driven here; the deeper per-package tenant isolation batteries remain those packages' own suites (907 tests re-verified).
5. Digests are FNV-1a 32-bit (the lane convention, evidence-grade — not crypto).
6. Root gates (full `pnpm -r test`, snapshot:check, architecture:check) NOT run — per packet, TL merge-time.
7. `tests/corpus.test.ts` re-exports `AcceptanceJourney` (type-only, harmless) — inherited WIP shape, left as-is to avoid churn.

## 10. Verification commands for TL re-run

```bash
cd <repo checkout> && git checkout work/f270c
corepack pnpm install --prefer-offline --ignore-scripts
cd packages/acceptance/commerce
corepack pnpm run test        # 4 files / 65 tests
corepack pnpm run typecheck   # exit 0
corepack pnpm run lint        # 0 warnings, 0 errors
grep -rEn "from ['\"]@fleetos/" src tests | grep -vE "@fleetos/(work|projects|workloads|procurement|vendors|software|agent-organizations|model-gateway|experience-work-commerce|external-vendors|apify|aurum)['\"]" || echo CLEAN
# baseline spot-check (unmodified lane suites):
cd ../../work && corepack pnpm run test        # 72/72
cd ../integrations/aurum && corepack pnpm run test   # 61/61
```
