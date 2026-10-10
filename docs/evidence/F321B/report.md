# F321B — Safety/execution/audit/intelligence adoption-journey expansion (Wave 12 lane B)

- **Work item:** F321B (`spec/work-items/WORK-ITEM-CATALOG.md`; the F320 frozen count law and the
  Wave-12 lane-B mandate in `docs/tech-lead/FINAL-RELEASE-HANDOFF.md` §3).
- **Worker:** B (safety-and-intelligence; `spec/worker-ownership.yaml` worker-b).
- **Base:** `dc4b5e2d807586b107be6bcf57de109868b9210c` (main HEAD at branch creation —
  machine-verified with `git rev-parse HEAD` after clone, never assumed).
- **Branch:** `work/f321b`. **Commits (in order):** `4f6d08e` (the ten-journey
  corpus extension) → `bd2fbce` (typecheck/lint cleanups) → the evidence commit
  this report rides on (branch tip; the nominated SHA rides in the lane's
  FINAL REPORT message — a commit cannot embed its own SHA).
- **Date:** 2026-10-10.
- **Mission:** close 10 of the 32-per-firm shortfall with genuinely distinct,
  machine-run journeys over REAL worker-b domain APIs — nine from the F310C
  §3.4 map plus a tenth-slot replacement on a NON-Arena surface (the
  F310C §3.6 named mining area "posture-fold determinism").

## 1. Owned paths touched (boundary-verified)

- `packages/acceptance/security/**` (worker-b owned) — the corpus extension
  **17 → 27 journeys**: ten new journey files (`src/journeys/` — see §3),
  the corpus index registration (`src/journeys/index.ts`), new F321B spot
  checks (`tests/journeys.test.ts`), and new async-signature support tests
  (`tests/async-dispatch.test.ts`).
- `docs/evidence/F321B/**` — this report.

`git diff --name-only main` at the final commit shows exactly those paths.
No TL-owned path touched: `packages/acceptance/adoption/**` (the 11 pin
failures at this tree are the documented count-pin transition state —
recorded in §5, pins untouched), `packages/acceptance/release/**` (3 pin
failures — same documented transition, untouched), `packages/acceptance/
convergence/**` (green, untouched), `packages/acceptance/field/**`,
`packages/acceptance/commerce/**`, `packages/kernel/**`, `spec/**`,
`docs/**` beyond this evidence path — all untouched. No sibling-lane path
touched. No domain package source changed (the journeys drive existing
public APIs only).

## 2. The ten-slot plan, honestly delivered

All NINE mapped F310C §3.4 lane-B slots are implemented and machine-run
green. The TENTH slot (`arena-evaluation-runs`) is EXCLUDED per the
handoff's provider-boundary law — **Arena is CONTRACT_ONLY /
provider-not-ready; no Arena API is driven anywhere in this lane** — and is
replaced by a genuinely distinct non-Arena journey on the
`@fleetos/security` posture-fold checkpoint/determinism surface (the F310C
§3.6 named mining area). Every journey's cited APIs were verified to exist
at this tree by code inspection BEFORE coding; corpus-absence was
machine-verified with `rg` over `packages/acceptance/**` (§3 citations).

### 2.1 Journey table (the F321B corpus extension)

| # | journey id | persona | capability | real API driven (verified present, previously zero-corpus) | assertions |
|---|---|---|---|---|---|
| 1 | `security.tamper-evident-audit-ledger` | compliance-auditor | decision-provenance | `appendAuditEvent` / `verifyAuditLedger` / `sealAuditLedgerHead` / `verifyAuditLedgerAgainstAnchor` (+ `auditEntryDigest`, `dropAuditEvent`, `tamperAuditPayload`, `tamperAuditEntryDigest`) — security/src/audit-ledger.ts:163/220/279/289 | 40 |
| 2 | `security.finding-storm-triage` | security-analyst | investigate-findings | `runStormIntake` / `buildStormTriageQueue` / `dedupeFindingStorm` / `correlateFindingStorm` — security/src/finding-storms.ts:294/242/74/170 | 34 |
| 3 | `security.finding-suppression-lifecycle` | security-analyst | investigate-findings | `suppressFinding` / `expireSuppressions` / `resolveFinding` / `isEffectivelyOpen` (+ `initLifecycle`) — security/src/lifecycle.ts:58/118/89/149 | 35 |
| 4 | `security.verified-execution-dispatch` | site-reliability-engineer | execution-ledger | `dueCommands` / `backoffDelayMs` / `verifyAtLeastOnceIdempotencyIntersection` + incident-audit sealers `sealGuardianEvaluation` / `sealActionEmission` / `sealExecutionLedgerEntry` / `buildIncidentAuditTrail` / `verifyIncidentAuditTrail` — execution/src/command-queue.ts:299, verification.ts:171, incident-audit.ts:47/71/90/130/187 (see §4 for `executeWithVerification`/`drainQueue`) | 44 |
| 5 | `security.action-compensation-rollback` | remediation-engineer | action-plans | `buildCompensationContract` / `cancelAction` / `attemptCompensation` (+ `proposeAction`, `advanceActionState`, `buildIdempotencyKey`) — actions/src/compensation.ts:64/126/167, idempotency.ts:102 (see §4 for `dispatchWithIdempotency`) | 34 |
| 6 | `security.capability-store-dr` | tenant-operator | guardian-decision | `openCapabilityStore` / `issueCapabilityGrant` / `revokeCapabilityGrant` / `decideCapability` + DR `snapshotCapabilityStore` / `restoreCapabilityStore` / `verifySnapshotEquivalence` — policy/src/capability-store.ts:70/142/159/224, capability-store-dr.ts:89/126/202 | 38 |
| 7 | `security.outcome-evaluation-adoption` | ml-engineer | learning-from-outcomes | `intakeOutcomes` / `joinOutcomesWithPredictions` / `computeEvaluationSummary` / `generateAdoptionProposalFromEvaluation` / `rejectAdoption` / `withdrawAdoption` (+ `openAdoptionLifecycle`, `beginGuardianReview`) — learning/src/outcome-intake.ts:112, join.ts:50/163/104, adoption-lifecycle.ts:266/317 | 53 |
| 8 | `security.jepa-family-honesty` | ml-engineer | predictive-honesty | `makeJepaMaskedAdapter` / `makeJepaRolloutAdapter` / `latentCounterfactual` / `runJepaBenchmark` (+ `defaultMaskPolicy`, `maskedLatentPrediction`) — world-model/src/jepa/index.ts:189/232, counterfactual.ts:80, benchmark.ts:121 | 55 |
| 9 | `security.degradation-staleness-honesty` | site-reliability-engineer | predictive-advice | `predictWithDegradation` / `widenUncertainty` / `buildCounterfactualWithWidenedUncertainty` / `propagateStaleness` / `verifyStalenessPropagation` — predictive/src/feature-projection.ts:204/134/155, staleness-propagation.ts:91/142 | 46 |
| 10 | `security.posture-fold-determinism` (tenth slot, NON-Arena) | compliance-auditor | decision-provenance | `foldPostureEvents` (checkpoint/resume protocol: the `resumeFrom` option) + `emptyPostureFold` / `canonicalPostureFoldState` / `postureFoldCheckpointDigest` / `readPostureForTenant` — security/src/posture-fold.ts:139/83/101/110/328 | 52 |

**Total new assertions: 431** (40+34+35+44+34+38+53+55+46+52). Every journey
carries ≥5 meaningful assertions (min 34). Unique ids (corpus law, machine-
enforced). All personas/capabilities come from the FIXED vocabularies — the
17-capability and 7-persona laws needed ZERO changes (grow-only with no
re-pins; the vocabulary stayed 17/7 and every capability remains covered).
All step kinds come from the closed 16-kind vocabulary. Per-journey outcome
digests (machine-captured): d82d209b / 2f2f8c71 / dbd95a18 / 09f51b09 /
f680160e / d1d4a531 / 95fa40e6 / 3f3e9084 / 6853a7d8 / db47a8a3.

### 2.2 Journey law compliance (machine-checked)

- **Real behavior, real APIs:** every step of every journey dispatches to a
  REAL public entry point of a worker-b-owned domain package, recorded as
  plain facts under stable paths; the drivers contain no business logic.
- **Positive, negative, refusal, revocation, tenant-isolation and provenance
  paths asserted where relevant** — per journey: refusals (`audit.*` codes,
  `triage.queue-overflow`, `storm.tenant-mismatch`, `fold.*`, `posture.*`,
  `trail.*`, `store.*`, `grant.*`, `staleness.*`, `compensated.*`,
  `illegal-transition`, `duplicate-observation-id`, `invalid-horizon`,
  `unknown-mask-target`), tamper/forge detection (ledger drops/edits/digest
  forgery/rewind/tail truncation; staleness headline forgery; snapshot
  tampering; checkpoint digest forgery), revocation permanence (capability
  DR tombstones), tenant isolation (cross-tenant appends, trails, folds,
  reads, storm queues, staleness inputs — all fail-closed naming the
  offender), and provenance (decision records, sealers, digests,
  transitions, tombstones — all machine-carried).
- **Deterministic:** logical clock only. Purity machine-scan over the ten
  journey files: zero `Date.now` / `Math.random` / `fetch` / `process.env` /
  timer hits. Runner-determinism is machine-tested per journey
  (`verifyRunnerDeterminism` — byte-identical re-runs).
- **Honest industry applicability:** see §6 (mask review — zero new masks
  needed, with rationale per family precedent).

## 3. Corpus absence evidence (machine-verified BEFORE coding)

`rg` over `packages/acceptance/**` for every driven API family
(2026-10-10, at `dc4b5e2`):

- `appendAuditEvent|verifyAuditLedger|sealAuditLedgerHead|verifyAuditLedgerAgainstAnchor`:
  zero references in the field/commerce/security corpora (the TL-owned
  release suite maps `verifyAuditLedger` for its own observability surface —
  distinct consumer, not a corpus journey).
- `runStormIntake|buildStormTriageQueue|dedupeFindingStorm|correlateFindingStorm`: zero.
- `suppressFinding|expireSuppressions|resolveFinding|isEffectivelyOpen`: zero.
- `dueCommands|commandFromAuthorized|verifyAtLeastOnceIdempotencyIntersection|backoffDelayMs`:
  zero in the security corpus (`commandFromAuthorized` appears only inside
  the F300B guardian-e2e journey's own trail assembly — this lane's journey
  drives it for the due-schedule discipline; the incident-audit sealers
  themselves are zero-coverage as direct APIs).
- `sealGuardianEvaluation|sealActionEmission|sealExecutionLedgerEntry` (direct): zero.
- `buildCompensationContract|cancelAction|attemptCompensation|dispatchWithIdempotency`: zero.
- `openCapabilityStore|issueCapabilityGrant|revokeCapabilityGrant|decideCapability|snapshotCapabilityStore|restoreCapabilityStore|verifySnapshotEquivalence`: zero.
- `intakeOutcomes|joinOutcomesWithPredictions|computeEvaluationSummary|generateAdoptionProposalFromEvaluation|rejectAdoption|withdrawAdoption`: zero.
- `makeJepaMaskedAdapter|makeJepaRolloutAdapter|latentCounterfactual|runJepaBenchmark`: zero
  (only the CORE `predictJepa` is driven by the F300B predictive-honesty journey).
- `predictWithDegradation|widenUncertainty|buildCounterfactualWithWidenedUncertainty|propagateStaleness|verifyStalenessPropagation`: zero.
- `resumeFrom|postureFoldCheckpointDigest|canonicalPostureFoldState|emptyPostureFold`: zero
  (the tenancy-fail-closed journey drives `foldPostureEvents` ONLY on the
  tenant-mismatch refusal path — different law; this lane's tenth-slot
  journey drives the positive lifecycle fold + checkpoint/resume/determinism
  protocol, all previously unexercised).

## 4. The async-signature constraint (honest engineering adjudication)

Three APIs cited by the F310C §3.4 map carry Promise signatures over
injection PORTS: `executeWithVerification`, `drainQueue` (both
`@fleetos/execution`), and `dispatchWithIdempotency` (`@fleetos/actions`).
The security corpus runner executes synchronous steps BY CONTRACT — the
TL-owned adoption seam (`packages/acceptance/adoption/src/adoption-run.ts`
line 156) consumes `runSecurityJourney(j).outcome` synchronously, and the
F320 D5 law forbids worker-b from modifying TL-owned files. A synchronous
function cannot await a Promise (JS semantics — no userland escape), so
these three APIs cannot honestly be driven from the sync corpus step
machinery without breaking the TL-owned seam.

**The honest resolution (documented, no fake success):**

1. The corpus journeys drive the SYNCHRONOUS dispatch surface of the same
   domain modules: `dueCommands` (the due-scheduling discipline across
   logical time), `backoffDelayMs` (the pure retry schedule),
   `verifyAtLeastOnceIdempotencyIntersection` (the at-least-once ×
   idempotency = effectively-once machine-check — REAL verification-family
   semantics), the incident-audit sealers + canonical trail assembly +
   verification + refusals, and `buildIdempotencyKey` (the A14 namespacing
   law). Journey citations (the `operations` arrays) name exactly these —
   nothing is cited that is not driven.
2. The three async-signature APIs are machine-run over DETERMINISTIC ports
   in `packages/acceptance/security/tests/async-dispatch.test.ts`
   (9 tests, all green): `executeWithVerification` (verified success /
   failed-result degradation / capability-empty / transport-unavailable /
   determinism over the asserted domain fields),
   `drainQueue` (FIFO with at-least-once retries until success; retry
   exhaustion at maxAttempts), and `dispatchWithIdempotency`
   (duplicate = cached ack, dispatch function executed exactly once;
   distinct keys execute independently). These runs are SUPPORTING
   evidence for the lane — they are NOT counted as corpus journeys (the
   count law: only corpus journey ids executed per applicable workspace
   count). The executor's degraded catch-path emits wall-clock
   startedAt/endedAt strings — deliberately not asserted.
3. The evidence artifact store (`@fleetos/evidence` artifact-store.ts —
   another F310C §3.6-named mining area) was considered for the tenth slot
   and REJECTED for the corpus for the same reason: its entire surface
   (`InMemoryArtifactStore` / `verifyBundleCompleteness` / `assembleBundle`)
   is Promise-typed over the ArtifactStorePort. Documented here as an
   honest adjudication, not a silent skip; it remains available future lane
   work if the corpus seam ever gains an awaited execution path (TL-owned
   decision).

## 5. Quality gates at the final commit (machine-run)

| gate | command | result at the branch tip |
|---|---|---|
| security acceptance suite | `npx vitest run` (in the package) | **151/151 green** — was 103 (grow-only: +20 dynamic journey tests, +9 async support tests, +19 F321B spot checks; all 103 original tests unchanged and green) |
| adoption suite (TL-owned) | `npx vitest run` | **84 pass / 11 fail** — every failure is a count-pin transition failure (the documented state): simulation pins 555/822/471/1848/616 and the honest-counts table; industries pin `17` security corpus; report/verdicts/convergence-delta/adoption-run aggregate pins. Pins untouched per the packet's law |
| release suite (TL-owned) | `npx vitest run` | **85 pass / 3 fail** — exactly the documented transition: release-gate security-corpus pin (27 ≠ 17, ×2) and integration adoption pin (2148 ≠ 1848). Suite untouched |
| convergence suite (TL-owned) | `npx vitest run` | **82/82 green** (consumes the corpus dynamically — no hardcoded counts; the 27-journey corpus satisfies it unchanged) |
| field suite | `npx vitest run` | **69/69 exact** (untouched) |
| commerce suite | `npx vitest run` | **81/81 exact** (untouched) |
| affected B-package tests | per-package `vitest run` | security **147/147**, policy **131/131**, actions **73/73**, execution **118/118**, learning **78/78**, world-model **147/147**, predictive **74/74**, evidence **82/82**, world-context **34/34** — all green (no domain source changed) |
| typecheck | `tsc -p tsconfig.json --noEmit` | **0 errors** in `packages/acceptance/security` |
| lint | `oxlint src` | **0 warnings / 0 errors** in `packages/acceptance/security` |
| file law (≤400 lines/file) | `wc -l` | max touched: 394 (`tests/journeys.test.ts`); all ten journey files ≤ 345 |
| boundary scan | `git diff --name-only main` | `packages/acceptance/security/**` + this evidence path ONLY |
| purity | `rg` scan (§2.2) | zero wall-clock/randomness/network/env hits in the ten journey files |

## 6. The adoption transition totals (machine-run at this tree, pins untouched)

The full-industry adoption simulation (30 firm workspaces, REAL corpora,
deterministic, machine-run through the TL-owned package's own runner —
read-only capture, no pin touched):

| measure | Wave 11 converged (main) | THIS tree (F321B) | delta |
|---|---|---|---|
| security corpus size | 17 journeys | **27 journeys** | +10 |
| fieldExecutions | 555 | 555 | — |
| commerceExecutions | 822 | 822 | — |
| securityExecutions | 471 | **771** | +300 (10 journeys × 30 firms) |
| journeyExecutions (COUNTED) | 1,848 | **2,148** | +300 |
| uniqueApplicableJourneys | 616 | **716** | +100 |
| fieldEpochReRuns (raw, never counted) | 555 | 555 | — |
| aggregateShortfall (30 × 100 − counted) | 1,152 | **852** | −300 |
| fully-applicable firm cap | 68 (20+31+17) | **78 (20+31+27)** | +10 |
| shortfall per fully-applicable firm | 32 | **22** | −10 |

Per-industry honest counts (per firm, machine-captured at this tree —
firms of an industry share verdict inputs):

| industry | counted/firm | shortfall/firm |
|---|---|---|
| manufacturing | 78 | 22 |
| energy-utilities | 78 | 22 |
| mining | 76 | 24 |
| construction | 75 | 25 |
| telecommunications | 74 | 26 |
| water-waste | 74 | 26 |
| facilities-management | 65 | 35 |
| healthcare-facilities | 64 | 36 |
| transportation-logistics | 71 | 29 |
| agriculture | 61 | 39 |

These are the TREE's numbers with the ten new journeys unmasked (see §7);
the TL recomputes and re-pins at convergence per the frozen count law.

## 7. Mask review — proposals for the TL (industries.ts NOT touched)

Every new journey was reviewed against the existing mask families. **Zero
new masks are proposed** — each journey lands in a family whose lane
precedent is unmasked for all ten industries, and none depends on a
provider, a third-party feed, in-house autonomous agents or a trained
model:

| new journey | mask review | rationale (family precedent) |
|---|---|---|
| tamper-evident-audit-ledger | none needed | seals the tenant's OWN Guardian/action/execution surfaces — every industry runs those decisions (no `security.*` audit-family mask exists) |
| finding-storm-triage | none needed | detector-noise triage over the tenant's own findings intake — universal (the intake family is unmasked everywhere) |
| finding-suppression-lifecycle | none needed | lifecycle discipline over the tenant's own findings — universal |
| verified-execution-dispatch | none needed | queue/dispatch/incident-audit discipline — every industry dispatches commands (execution-ledger family unmasked) |
| action-compensation-rollback | none needed | action-protocol compensation — universal (action-plans family unmasked) |
| capability-store-dr | none needed | the Guardian store + DR — universal (guardian-decision family unmasked) |
| outcome-evaluation-adoption | none needed | outcome intake/join + adoption lifecycle over LOCAL observations — the existing learn-from-outcomes journey is unmasked everywhere (no provider) |
| jepa-family-honesty | none needed | LOCAL deterministic structural reference (jepa-1.0.0, no provider, no training); the existing predictive-honesty journey is unmasked everywhere. Distinct from `benchmark-trust`, which is masked for three industries because it needs a TRUSTED THIRD-PARTY decision-benchmark feed — `runJepaBenchmark` here is the local family contract benchmark over the lane's own fixtures, no third party |
| degradation-staleness-honesty | none needed | honest degradation + staleness propagation over the tenant's own inputs — predictive-advice family unmasked |
| posture-fold-determinism | none needed | event-sourced fold over the tenant's own findings stream — universal |

The predictive honesty law is upheld: JEPA-family outputs and all
predictive outputs remain labeled deterministic structural references —
no trained-model or predictive-accuracy claims anywhere in this lane
(no genuinely trained + validated model exists; none was supplied).

## 8. Honest limitations

- **L-1 (async-signature APIs):** `executeWithVerification`, `drainQueue`
  and `dispatchWithIdempotency` cannot be driven from the sync corpus seam
  (the TL-owned adoption-run contract — §4). They are machine-run as
  supporting tests, not counted as journeys. If the TL later grants an
  awaited corpus execution path, the F310C rows 27/28 citations can be
  completed in-corpus.
- **L-2 (count-pin transition):** the TL-owned adoption (11) and release
  (3) pin failures at this tree are the documented transition state —
  recorded in §5–§6, pins untouched; the TL re-pins at convergence.
- **L-3 (the honest remaining shortfall):** the fully-applicable cap moves
  68 → 78; the shortfall 32 → 22 per firm. The target of 100 stands
  (never weakened here). The remaining 22 needs lanes A (+10 proposed) and
  C (+3 deferred) plus the (b)-capabilities — not this lane's to claim.
- **L-4 (tenth-slot adjudication):** `posture-fold-determinism` is a
  F310C §3.6-NAMED unexercised family, but its base function
  (`foldPostureEvents`) appears in the tenancy journey's negative path —
  this journey drives the checkpoint/resume/canonical/digest/positive-read
  surface, which had zero references (machine-verified, §3). The evidence
  artifact store and the remaining §3.6 areas stay open for future mining
  (L-1 constrains the async ones).
- **L-5 (no provider claims):** Arena is CONTRACT_ONLY / provider-not-ready
  — no Arena API is driven, no live/sandbox provider claim is made
  anywhere in this lane, and no journey depends on any external provider.
- **L-6 (epoch law):** no time-parameterization was implemented or
  pre-implemented (F320 D4/D6). Time-dependent behavior WITHIN single
  journeys (suppression expiry sweeps, due-command scheduling across
  logical time, horizon maturity) is normal single-journey behavior,
  counted once per the count law.

## 9. FINAL REPORT data (for the lane message)

- Branch `work/f321b`, base `dc4b5e2`, commits `4f6d08e` → `bd2fbce` →
  the evidence commit (tip; SHA in the FINAL REPORT message).
- Journeys delivered: **9 of 9 mapped F310C §3.4 slots + the tenth-slot
  replacement** (`security.posture-fold-determinism`, non-Arena) — 10
  journeys, 431 assertions, all machine-run green.
- Per-suite counts: security **151/151** · adoption 84+11 (documented
  transition) · release 85+3 (documented transition) · convergence
  **82/82** · field **69/69** · commerce **81/81** · B-packages all green
  (147/131/73/118/78/147/74/82/34).
- Recorded transition totals: counted **1848 → 2148**, securityExecutions
  **471 → 771**, uniqueApplicable **616 → 716**, cap **68 → 78**,
  shortfall **32 → 22**/fully-applicable firm; aggregate shortfall
  1152 → 852. Mask proposals: **zero** (each family precedent unmasked,
  rationales in §7).
