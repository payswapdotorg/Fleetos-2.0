# F270B — Worker B (Safety + Intelligence) Security/Action/Intelligence Acceptance Journeys Evidence

- **Work item:** F270B — security/action/intelligence acceptance journeys, B (Wave 7 lane B; catalog: `spec/work-items/WORK-ITEM-CATALOG.md`)
- **Owner:** Worker B (safety-and-intelligence)
- **Base commit:** `a7edf88` (inherited WIP: full package scaffold, 84/84 tests green as re-verified below; branch base `3c199ac`, main = `cf3f68b`, Wave 6 complete, full suite 3667/0 at dispatch)
- **Branch:** `work/f270b` (sandbox clone at `/home/z/fleetos-2.0`; TL re-run: any clean checkout of the branch)
- **Date:** 2026-10-12
- **Inherited WIP:** a prior interrupted session left committed WIP at `a7edf88` (`packages/acceptance/security/` full scaffold: contracts, 13 journeys, runner, report, 4 test files, 84/84 tests passing). Per the inherited-WIP protocol I machine-verified the TRUE baseline of every lane package BEFORE the first edit, audited every file against the packet, fixed what was broken/missing, and re-gated everything before committing.

## 1. Owned paths touched

Per `spec/worker-ownership.yaml` (worker-b, grant `packages/acceptance/security/**`):

- `packages/acceptance/security/**` — NEW package `@fleetos/acceptance-security` (private, Apache-2.0, type: module,
  exports map `.` + `./journeys` + `./runner` + `./report`): `src/journey-contracts.ts` (275 lines),
  `src/journeys/{fixture-world,investigate-finding,understand-evidence,guardian-decision,action-plan,execution-ledger,reasoning,predictive-advice,counterfactual,inspect-why,learning,benchmark-trust,agent-safety,tenancy-fail-closed,index}.ts`,
  `src/runner.ts`, `src/report.ts`, `src/index.ts` + 4 test files
  (`tests/journeys.test.ts`, `tests/runner.test.ts`, `tests/report.test.ts`, `tests/contracts.test.ts`)
- `docs/evidence/F270B/**` (this report)

`git status` shows only this package + this evidence dir (plus `pnpm-lock.yaml` filtered-install mutation, left
UNCOMMITTED per packet). No spec edits, no snapshot regen, no other lane's path touched (verified: all twelve lane
package suites re-run green after the last edit, §2).

Dependencies (`workspace:*`, own lane only, public entry points only — machine-verified by import scan + the
boundary self-check test): `@fleetos/security`, `@fleetos/policy`, `@fleetos/actions`, `@fleetos/execution`,
`@fleetos/evidence`, `@fleetos/predictive`, `@fleetos/world-model`, `@fleetos/world-context`, `@fleetos/learning`,
`@fleetos/arena`, `@fleetos/simulation`, `@fleetos/experience-safety-intel`.

## 2. Baselines — machine-run BEFORE first edit, re-verified AFTER last edit

All twelve lane packages at `a7edf88`, before any edit and again after the last edit (identical counts —
pre-existing suites untouched and green; total 977 tests):

```text
security 5 files/116 tests   policy 5/112       actions 4/73       execution 6/90
evidence 3/82                predictive 3/61    world-model 3/42   world-context 3/34
learning 5/78                simulation 7/91    integrations/arena 7/94
experiences/safety-intel 5/104
```

## 3. Deliverables (all pure deterministic TS; logical `now` + caller-supplied inputs everywhere)

### 3.1 `src/journey-contracts.ts` (275 lines) — journeys are DATA + declarative assertions

Fixed 7-persona vocabulary (`security-analyst`, `remediation-engineer`, `tenant-operator`, `automation-agent`,
`site-reliability-engineer`, `compliance-auditor`, `ml-engineer`) + fixed 13-capability vocabulary mirroring the
F270B deliverable list + `JOURNEY_ALLOWED_PACKAGES` (the twelve lane packages — machine-checked in tests).
Typed steps (`JourneyStepKind` + step records naming the REAL packages/operations they drive) record plain JSON
facts under stable dotted paths; declarative `JourneyAssertion`s (path + expected) are evaluated ONLY by the
runner. `JourneyOutcome` carries per-step ok + per-assertion pass with ACTUAL vs EXPECTED; `journeyOutcomeDigest`
+ `verifyJourneyOutcome`; **`JourneyReport` double-digest form** (`toJourneyReport` + `verifyJourneyReport` —
outer report digest covers the whole outcome including the inner digest; both must hold). FNV-1a + canonical
JSON helpers (local copy of the lane's presentation convention — seam S2).

### 3.2 `src/journeys/` — the 13-journey corpus (one per capability)

| # | Journey | Persona / Capability | Steps / Assertions | Drives (REAL public APIs) |
|---|---------|----------------------|--------------------|---------------------------|
| 1 | investigate-finding | security-analyst / investigate-findings | 2 / 19 | `runFindingIntake` (validate→dedupe→correlate→escalate; A8 + duplicate refusals) → `buildFindingViews` (severity rollup, triage queue ordering, digest) |
| 2 | understand-evidence | compliance-auditor / understand-evidence | 2 / 15 | `buildCanonicalEntry` + `sealCanonicalBundle` + `verifyCanonicalBundle` (sha-256-shaped digests; tamper → `integrity.bundle-digest-mismatch`) + `verifyBundleAndRecord` + `computeEntryDigest` + `buildTraceabilityChain`/`verifyTraceabilityChain` (A13) |
| 3 | guardian-decision | tenant-operator / guardian-decision | 3 / 33 | `evaluateCapability` (ALLOW/REQUIRE_APPROVAL/BLOCK × self-auth/cross-tenant/irreversible), `evaluateRulesOrdered` (trace + resolution), `buildDecisionAuditRef`, `issueGrant` → `buildCapabilityCeilingBoard` (ceiling-not-authorization marker structural) |
| 4 | action-plan | remediation-engineer / action-plans | 2 / 27 | `validatePlan` + `emitPlanCommands` (all-or-nothing blocked emission, idempotency keys `plan\|step\|nonce`), `initPlanLifecycle`/`advancePlanLifecycle` (premature/partial refusals) → `createCommandQueue`/`submitCommand` (duplicate ack) → `buildActionPlanBoard` |
| 5 | execution-ledger | site-reliability-engineer / execution-ledger | 2 / 26 | full queue lifecycle (submit→ack→complete; ack→fail ×3 → dead-letter, `transport error 3` preserved; duplicate idempotent) + `appendExecutionLedger`/`verifyExecutionLedger`/`replayExecutionLedger` (append-only indexes, byte-identical re-replay, `tamperExecutionEntry` → `ledger.entry_digest_mismatch` at index 2) |
| 6 | reasoning-context | site-reliability-engineer / reasoning-context | 3 / 27 | `assembleContext` (security-review redaction with `REDACTED` sentinel + no-leak serialization check + digest verify; cross-tenant/empty-tenant refusals with offender named) + `foldWorldState`/`classifyStaleness` (fresh/stale/unknown honesty) |
| 7 | predictive-advice | site-reliability-engineer / predictive-advice | 2 / 27 | `makeReferenceModelPort().project` (advisory marker, min-bps confidence, provenance + input digest) + `isAdvisoryPrediction` (marker-stripped REJECTED) → `buildPredictionAdvisoryCard`/`buildWorldContextAdvisoryCard`/`buildAdvisoryBoard` (honest `confidenceBps: null` world-context card) |
| 8 | counterfactual-reasoning | ml-engineer / counterfactual-reasoning | 2 / 22 | `port.runCounterfactual` (HYPOTHETICAL marker, premise, per-step divergence accounting baseline vs CF with bps-of-baseline, BOTH branch provenance digests distinct, halved confidence, widened bounds) + baseline REAL advisory card |
| 9 | inspect-why | compliance-auditor / decision-provenance | 2 / 25 | FULL A4 chain `proposeAction`→`advanceActionState` ×7 (authorized…recorded, premature refusal) → `buildDecisionProvenance` (guardian block + reason chain + grants + journal slice + evidence refs, chain digest, tamper breaks it, unauthorized → `authorizationPending` + null guardian, cross-tenant read refused) |
| 10 | learn-from-outcomes | ml-engineer / learning-from-outcomes | 2 / 31 | `intakeCases` (digest dedupe) + `assembleCaseSet`/`verifyCaseSetDigest` + `makeReferenceArenaAdapter().evaluate` (ARENA_PROPOSAL, no submit/adopt method) + learning `evaluateCapability` → `proposeAdoption` (stays pending) → `openAdoptionLifecycle`/`beginGuardianReview`/`authorizeAdoption`/`completeAdoption` (evidence-gated) + `cascadeCertificationRevocation` (adopted skipped, dependent rejected `certification-revoked`) |
| 11 | benchmark-trust | ml-engineer / benchmark-trust | 2 / 29 | `defineBenchmarkCase`/`assembleBenchmarkSet`/`replayJournal`/`scoreBenchmarkSet`/`runSafetyBattery`/`assembleBenchmarkReport`/`verifyBenchmarkReport` (REAL hit rates verbatim 5000/10000 bps, fixed-weight aggregate 7599, four-check safety battery, report verify) + NEGATIVE: TIGHT envelope → safety FAILS with 23 violations visible (kinds + case + limit named) |
| 12 | agent-safety | automation-agent / agent-safety | 2 / 20 | `issueGrant` (root + derived) + `verifyGrantChain` (depth 2) + `revokeGrant` (PROPAGATES: child `revoked` with `propagated:grant-agent-root`; active grants → 0) + `activeGrantsForActor` (foreign grant never leaks) + expired-grant refusal + Guardian A5 self-authorization BLOCK vs with-approval escalation |
| 13 | tenant-fail-closed | security-analyst / tenant-isolation | 2 / 23 | cross-tenant refusals with offender named across SEVEN surfaces: findings view (`views.cross-tenant-finding`), posture read + fold, queue submit, ledger append, action advance, adoption lifecycle open, arena case set — plus same-tenant control probes |

### 3.3 `src/runner.ts` (132 lines) — the deterministic executor

Executes steps in order against a fresh per-run recorder; a step that throws FAILS the journey (message captured);
duplicate/empty fact paths are fail-loud authoring errors; assertions are evaluated against recorded facts with
MISSING facts as honest failures (distinct from recorded `null`); a failing step OR assertion fails the journey —
no soft passes. Re-runs byte-identical (machine-tested per journey AND canonically).

### 3.4 `src/report.ts` (147 lines) — acceptance reports

Per-journey summaries (failed assertion ids + failed step ids + digest), aggregates, persona × capability
coverage matrix (7 × 13 = 91 cells) with HONEST ZERO-INFLATION: cells count ONLY passing journeys;
`uncoveredCapabilities`/`uncoveredPersonas` honest gap lists; report digest + `verifyAcceptanceReport`;
`coverageCellsBackedByPassingJourneys` EXACT-accounting check (every cell must EQUAL the number of passing
journeys claiming it, and every counted pair must have a cell).

### 3.5 Tests — 90 net-new, 4 files

`tests/journeys.test.ts` (46: every journey as an `it.each` test ×2 — full-chain pass + runner determinism —
plus corpus shape + facts-for-assertions + 18 REAL-behavior spot checks), `tests/runner.test.ts` (11:
determinism, NEGATIVE FIXTURE broken-journey MUST fail with actual-vs-expected, throwing step, missing-path
honest failure, duplicate/empty fact paths, no short-circuit hiding, tenancy-inside-journeys probe),
`tests/report.test.ts` (13: aggregates, matrix shape, zero-inflation incl. failing-journey-contributes-nothing,
digest verify + three tamper forms, deterministic re-assembly, honest gap lists), `tests/contracts.test.ts`
(20: vocabularies fixed, corpus invariants, lane-package boundary declarations, deterministic helpers
(`isoOfEpochMs`, `fnv1a`, `canonicalJson`), + 6 NEW JourneyReport double-digest tests incl. inner-digest tamper).

## 4. Machine-verified corpus result (the honest numbers)

```text
{"journeys":13,"passed":13,"failed":0,"steps":28,"failedSteps":0,
 "assertions":327,"passedAssertions":327,"failedAssertions":0}
report digest: 84858703 (verifyAcceptanceReport: true)
```

Coverage matrix: 91 cells; 13 covered (one passing journey each); ALL 13 capabilities covered; all 7 personas
exercised: site-reliability-engineer ×3, ml-engineer ×3, security-analyst ×2, compliance-auditor ×2,
tenant-operator ×1, remediation-engineer ×1, automation-agent ×1.

## 5. Inherited-WIP completion log (what I verified, fixed, added — with reasons)

The WIP was substantially complete and 84/84 green (re-verified BEFORE any edit). Audit findings and fixes:

1. **Missing packet deliverable — `JourneyReport` double-digest form.** The packet requires the contract to carry
   "JourneyReport digest + verify" (same shape as F270A). The WIP had only the outcome-level digest. ADDED
   `JourneyReport` + `toJourneyReport` + `verifyJourneyReport` (outer digest covers the whole outcome including
   the inner digest; verify requires BOTH to hold) + 6 tests (genuine accepts, every-corpus-outcome converts and
   verifies, field tamper, inner-digest tamper, forged digest). 84 → 90 tests.
2. **Stale header comments contradicting pinned REAL behavior (doc-honesty).** (a) `guardian-decision.ts` header
   claimed "irreversible → REQUIRE_APPROVAL (operator authority)" while the assertions (and the REAL engine)
   yield BLOCK: the tenant policy's `rule.block_irreversible_without_operator` (priority 90) matches the risk
   range AND the operator's authority, and its verdict is BLOCK — authority presence gates rule MATCHING, never
   the verdict. Header re-derived from `packages/policy/src/guardian.ts` (re-verified by reading the engine).
   (b) `agent-safety.ts` header claimed `verifyGrantChain` refuses the revoked child with `grant.ancestor-revoked`;
   the REAL `revokeGrant` PROPAGATES (child status `revoked`, reason `propagated:grant-agent-root`), so the child
   refuses as `grant.revoked` — `grant.ancestor-revoked` is only reachable for an ancestor revoked WITHOUT
   propagation, a state `revokeGrant` never produces (re-derived from `packages/policy/src/grant-chain.ts`;
   the WIP's own test comment already documented this correctly). No assertion was weakened in either fix —
   the assertions were already correct; only the prose was wrong.
3. **Zero-inflation check strengthened.** `coverageCellsBackedByPassingJourneys` previously only checked that a
   nonzero cell had SOME backing passing journey (with a redundant `byId` lookup). Replaced with EXACT
   accounting: every cell must EQUAL the number of passing journeys claiming that (persona, capability) pair,
   and every counted pair must have a matrix cell. Still passes (the matrix was honest); the check is now
   strictly stronger.
4. **Verified the rest against the packet line-by-line**: 13 journeys match the deliverable list exactly
   (investigate finding, understand evidence, guardian decision, action plan, execution + ledger, reason,
   predictive advice, counterfactual, inspect why, learn from outcomes, benchmark trust, agent safety +
   tenancy fail-closed); every journey asserts REAL package outputs (no fabricated numbers — spot-verified
   hit rates 5000/10000/7599 bps, tight-envelope 23 violations, escalation occurrences 3, dead-letter attempts 3
   against the REAL engines); refusals pinned to REAL reason codes throughout; digests tamper-evident (bundle,
   ledger, context, decision, report, outcome, journey-report — each with a machine-tested tamper case);
   purity scan clean (no `Date.now`/`Math.random`/network/timers — only doc-comment mentions); file law clean
   (largest file 275 lines); boundary law clean (import scan: twelve lane packages, root entry points only).

## 6. Gates (exact commands + outputs, in `packages/acceptance/security/`)

```text
corepack pnpm run test        # Test Files 4 passed (4)    Tests 90 passed (90)
corepack pnpm run typecheck   # tsc -p tsconfig.json --noEmit — clean (no output, exit 0)
corepack pnpm run lint        # Found 0 warnings and 0 errors. Finished in 48ms on 19 files using 2 threads.
```

All files ≤ 400 lines (largest: `src/journey-contracts.ts` at 275). No `Date.now`, no `Math.random`, no network,
no timers, no new runtime deps (vitest/typescript devDeps match the lane convention).

## 7. Seam findings (TL-relevant)

- **S1 — closure-steps vs F270A's typed-op-union (documented shape seam):** the packet says "same
  journey-contract shape as F270A". The inherited WIP's steps are typed records carrying a `run(recorder)`
  closure instead of F270A's pure-data `JourneyOperation` union interpreted by the runner. The honesty core is
  preserved (steps only record facts; assertions are declarative data evaluated exclusively by the runner;
  per-assertion actual-vs-expected; digests tamper-evident), and refusals are pinned declaratively rather than
  via F270A's `expectRefusal` flag. A full rewrite to the op-union was judged not worth breaking a verified
  327-assertion corpus inside the continuation budget; unifying the two contract shapes is TL composition (the
  packet itself notes a shared contract is TL-composed later). Flagging for adjudication.
- **S2 — FNV-1a digest convention local copy** (`fnv1a`/`canonicalJson` in `journey-contracts.ts`): same
  decision as F250A/F260A/F270A — the canonical home is TL-owned; hoisting into a shared contract is a TL
  decision.
- **S3 — counterfactual VIEW gap (honest):** the experience plane has no counterfactual view yet; journey 8
  asserts the DOMAIN provenance surfaces (both branches carry full `PredictionProvenance` digests) + the
  baseline branch's REAL advisory card. The counterfactual-card gap is reported, not papered over.
- **S4 — revocation-propagation semantics:** `revokeGrant` propagates and directly revokes descendants
  (`grant.revoked`), so `grant.ancestor-revoked` is unreachable through the public API today. Worth the TL's
  attention when adjudicating A15 grant-chain guarantees (the distinction matters for hand-built grant sets).

## 8. Honest residuals

- All journey state is caller-threaded in-memory; binding the runner to persisted stores/scheduler-driven runs
  and a live UI is TL composition (this package is the machine-run acceptance harness, per the Wave 7 packet).
- Journeys re-run intake/Guardian calls inside later steps rather than threading a shared context (each journey
  is intentionally stateless; identical inputs → identical outputs, machine-verified by the determinism tests).
- The action-plan journey simulates the Guardian authorizing both steps via the lifecycle's `authorizedStepCount`
  field before asserting the REAL advance/lifecycle/queue/board behavior (the Guardian's per-step decisions are
  asserted directly in the same journey).
- `pnpm -r test` (full monorepo) NOT run — TL merge-time gate per packet; the twelve lane packages' suites were
  machine re-run instead (§2).

## 9. TL re-run commands

```bash
git checkout work/f270b   # at the pushed commit
cd packages/acceptance/security
corepack pnpm install --filter @fleetos/acceptance-security --prefer-offline --ignore-scripts  # only if needed
corepack pnpm run test && corepack pnpm run typecheck && corepack pnpm run lint
```
