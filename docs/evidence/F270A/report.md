# F270A — Worker A (Edge + Asset) Device/Field Acceptance Journeys Evidence

- **Work item:** F270A — device/field acceptance journeys, A (Wave 7 lane A; catalog: `spec/work-items/WORK-ITEM-CATALOG.md`)
- **Owner:** Worker A (edge-and-asset)
- **Base commit:** `3c199ac` (TL dispatch: Wave 7 packets; main = `cf3f68b`, Wave 6 complete, full suite 3667/0 at dispatch)
- **Branch:** `work/f270a` (worktree `/home/z/w-f270a`)
- **Date:** 2026-10-09
- **Inherited WIP:** a prior interrupted session left uncommitted early-stage WIP under `packages/acceptance/field/` on top of `3c199ac` (src skeleton, NO tests, 2 lint warnings, 7 of 14 journeys failing against the REAL APIs). Per the inherited-WIP protocol I machine-verified the TRUE baseline of every lane package BEFORE the first edit, reviewed the WIP against the packet, completed/fixed it, and made it all work before committing.

## 1. Owned paths touched

Per `spec/worker-ownership.yaml` (worker-a, NEW GRANT `packages/acceptance/field/**`):

- `packages/acceptance/field/**` — NEW package `@fleetos/acceptance-field` (private, Apache-2.0, type: module,
  exports map `.` + `./journeys` + `./runner` + `./report`): `src/journey-contracts.ts`, `src/determinism.ts`,
  `src/fixtures.ts`, `src/context.ts`, `src/handoff.ts`, `src/mission-mirror.ts`, `src/runner.ts`, `src/report.ts`,
  `src/index.ts`, `src/journeys/{enrollment,care,field,cross,index}.ts`, `src/ops/{common,asset-ops,care-ops,edge-ops,view-ops,mission-ops}.ts`
  + 5 test files (`tests/journeys.test.ts`, `tests/runner.test.ts`, `tests/report.test.ts`, `tests/negative.test.ts`, `tests/contracts.test.ts`)
- `docs/evidence/F270A/**` (this report)

`git status` shows exactly `packages/acceptance/field/` (new) + `pnpm-lock.yaml` (filtered-install mutation, left
UNCOMMITTED per packet). No spec edits, no snapshot regen, no other lane's path touched (verified: all eleven lane
package suites re-run green after the last edit, §2).

Dependencies (`workspace:*`, own lane only, public entry points only): `@fleetos/identity`, `@fleetos/tenancy`,
`@fleetos/assets`, `@fleetos/observations`, `@fleetos/health`, `@fleetos/recovery`, `@fleetos/maintenance`,
`@fleetos/connectivity`, `@fleetos/adcos`, `@fleetos/sim-worlds`, `@fleetos/experience-asset-field`.

## 2. Baselines — machine-run BEFORE first edit, re-verified AFTER last edit

All eleven lane packages at clean `3c199ac`, before any edit and again after the last edit (identical counts —
pre-existing suites untouched and green; total 1023 tests):

```text
identity 3 files/89 tests   tenancy 3/67    assets 3/99     observations 4/134
health 4/89                 recovery 3/60   maintenance 3/69
connectivity 7/120          integrations/adcos 8/143
sim-worlds 5/84             experiences/asset-field 4/69
```

## 3. Deliverables (all pure deterministic TS; logical `now` + caller-supplied inputs everywhere)

### 3.1 `src/journey-contracts.ts` (320 lines) — journeys are DATA

`AcceptanceJourney` = fixed persona (7-persona vocabulary) + goal + steps as TYPED domain operations
(`JourneyOperation` union: 45+ operation kinds across assets/enrollment/twins/observations/triage/recovery/
maintenance/connectivity/ADOS/sim-worlds/experience-intents/views/handoff/mission/tenancy probes) + declarative
read-model `JourneyAssertion`s (9 operators incl. `reading-equals` cross-reading comparison). `JourneyOutcome`
carries per-step ok + per-assertion pass with ACTUAL vs EXPECTED values; digest + `verifyJourneyOutcome`;
`toJourneyReport` double-digest form. Steps may declare `expectRefusal` (pass ONLY when the REAL API refuses).
No journey code executes anything — the runner does; no assertion can hide a failure.

### 3.2 `src/journeys/` — the 14-journey corpus (one per capability)

| # | Journey | Persona / Capability | Steps / Assertions | Drives (REAL public APIs) |
|---|---------|----------------------|--------------------|---------------------------|
| 1 | enroll-new-asset | fleet-operator / enrollment | 7 / 20 | AssetDirectory admit+activate, EnrollmentDirectory, runPipeline, admitTwinRevision → `assembleFleetOverview` (status, identity refs, staleness, redaction, digest) |
| 2 | trustworthy-state-recency | field-technician / trustworthy-state | 10 / 19 | observation ingestion + duplicate ack + non-monotonic/out-of-vocabulary REFUSALS → `assembleAssetDetail` (fresh→stale→unknown windows, exact ages, twin provenance) |
| 3 | investigate-injected-fault | site-manager / investigation | 8 / 16 | `runWorld` with `FaultScenario` (pump failure + link outage) → emissions ingested through the REAL pipeline → `triage` → `assembleFieldView` priority queue |
| 4 | recover-lost-device | recovery-coordinator / recovery | 13 / 18 | `openRecoveryCase` + `applyRecoveryCommand` (investigate→propose→resolve-with-evidence→close, refusal codes) → `assembleRecoveryTimeline` while open + after completion |
| 5 | maintain-asset-schedule | maintenance-planner / maintenance | 12 / 17 | `createMaintenanceOrder` + `applyMaintenanceCommand` + `nextRun` → `assembleMaintenanceBoard` columns |
| 6 | field-mode-offline-tolerance | field-technician / field-mode | 9 / 13 | `assembleFieldView` 5 min offline with phone limits: last-known sections, stale-not-fresh provenance, bounded sections, priority order |
| 7 | connectivity-postures | edge-operator / connectivity | 16 / 18 | `proposeIntent` + `transitionRegistryIntent` (no-grant REFUSAL, deny-ceiling REFUSAL, grant+allow) + `rollupFleetPosture` (aligned/divergent/unknown, never guessed) |
| 8 | edge-command-lifecycle | edge-operator / edge-command | 14 / 22 | full ADCOS lifecycle (issue→dedup→dispatch→ack→result→reconcile; failure backoff; expiry sweep) + `verifyCommandJournal` + `rollupAdapterHealth` honest degradation |
| 9 | simulation-driven-experiment | sim-engineer / simulation | 3 / 10 | `runWorld` + `runFleetWorldSimulation` + `canonicalRunOutput`: EXPERIMENTAL markers, world+scenario digests, byte-identical replay |
| 10 | mission-replay-resume | fleet-operator / mission-replay | 6 / 20 | LOCAL structural mirror of the tower's mission contract over REAL observation-batch stages: suspend after stage 2, resume re-issues ONLY stages 3-4 with the SAME idempotency keys, completed stages never re-executed (12/12 observations, 12 twin revisions) |
| 11 | handoff-field-to-operator-publish | field-technician / handoff | 8 / 11 | REAL command-intent builder + `assembleFieldView` digest + `openRecoveryCase` → digest-covered handoff carrier |
| 12 | handoff-field-to-operator-consume | fleet-operator / handoff | 3 / 10 | carrier verification against the SAME threaded context (field digest re-derivation, findings/cases/intent-key match) + acting on the case |
| 13 | mobile-field-shape | field-technician / mobile | 8 / 11 | `assembleFieldView` machine-checked phone shape: every section within limits, attribute excerpts bounded, severity-first ordering |
| 14 | tenant-isolation-fail-closed | site-manager / tenant-isolation | 8 / 15 | injected foreign-tenant record REFUSES every view (`cross-tenant-ref`); `listAssets`/`check`/`checkEnrollment`/`assertSameTenant`/`makeTenantContext` fail-closed probes; tenant-scoped idempotency separation |

### 3.3 `src/runner.ts` (157 lines) — the deterministic executor

Executes steps in order against the caller-threaded `JourneyContext` (wired to REAL directories/stores/journals/
registries — the context owns NO domain truth), records every reading as `<stepId>.<name>`, evaluates assertions
afterwards, stamps outcome digests. A failing step OR a failing assertion fails the journey — no soft passes.
`runJourneyCorpus` threads the handoff chain (a `consumesHandoff` journey runs on the publishing journey's context).
Re-runs are byte-identical (machine-tested).

### 3.4 `src/report.ts` (121 lines) — acceptance reports

Per-journey outcomes + aggregate (journeys/passed/failed/steps/failedSteps/assertions/passed+failed) + the
persona × capability coverage matrix (7 × 13 = 91 cells) with HONEST ZERO-INFLATION: a cell is `covered` ONLY
when at least one PASSING journey claims it; `coveredCapabilities` omits any capability with no passing journey.
Report digest + `verifyAcceptanceReport`.

### 3.5 Tests — 61 net-new, 5 files

`tests/journeys.test.ts` (17: every journey runs as a test + corpus shape + full-chain depth ≥ 10 assertions),
`tests/runner.test.ts` (10: determinism, handoff threading + no-carrier failure, refusal semantics, digest stamping,
tenant threading), `tests/report.test.ts` (8: aggregates, full coverage grid, zero-inflation, digest/tamper,
deterministic re-assembly), `tests/negative.test.ts` (7: deliberately-broken journeys MUST fail — wrong expected,
missing reading, unmarked refusal, fake-refusal detection, tampered digests, foreign-taint refusal, carrier
tamper), `tests/contracts.test.ts` (19: FNV-1a vectors, canonical JSON, all assertion operators, mission-mirror
resume policy).

## 4. Machine-verified corpus result (the honest numbers)

```text
{"journeys":14,"passed":14,"failed":0,"steps":125,"failedSteps":0,
 "assertions":220,"passedAssertions":220,"failedAssertions":0}
report digest: 652e8e14 (verifyAcceptanceReport: true)
```

Coverage matrix: 91 cells; 14 covered (one passing journey each); ALL 13 capabilities covered;
all 7 personas exercised: field-technician ×4, fleet-operator ×3, edge-operator ×2, site-manager ×2,
maintenance-planner ×1, recovery-coordinator ×1, sim-engineer ×1.

## 5. WIP completion log (what the inherited session got wrong, machine-fixed)

1. **sim-worlds world fixture invalid** (`invalid-world`): `FIELD_LAB_WORLD.devices` was not id-sorted —
   `validateWorld` enforces deterministic array ordering. Reordered (flow-b2 before thermo-a1); the world now
   validates and both sim journeys run end-to-end.
2. **mission-mirror digest bug (real bug, my fix):** `appendMirrorEntries`/`resumeMirrorMission` spread
   `...journal` including the STALE digest into the canonical form, so `verifyMirrorJournal` always failed after
   the first append. Rebuilt the next journal from explicit fields; journals now verify through suspend+resume.
3. **future-dated Guardian grant:** the connectivity journey's second grant had `grantedAt = T0+4s` while the
   logical clock was still `T0` — the REAL intent lifecycle correctly refuses (`invalid-grant`). Grant re-dated
   to `T0`; the refusal path itself stays asserted (t7/t8 no-grant + deny-ceiling).
4. **recovery refusal code order:** re-resolving a resolved case WITHOUT evidence refuses with
   `missing-evidence` (the evidence law precedes the state law in `applyRecoveryCommand`) — expectation re-bound
   to the REAL code; the step remains `expectRefusal` (the API does refuse).
5. **enrollment cross-tenant probe vocabulary:** the tenant-scoped `EnrollmentDirectory.check(foreignTenant, …)`
   registry is keyed `tenant:device`, so it fails closed with `device-not-enrolled`; the
   `device-tenant-mismatch` code lives on the REAL record-level `checkEnrollment` boundary. The journey now
   probes BOTH (assertions o7/o7b/o7c) — no weakening, both refusals pinned.
6. **2 lint warnings** (unused imports in `view-ops.ts`) removed; `dist/tsconfig.tsbuildinfo` build artifact
   deleted (gitignored anyway).

## 6. Gates (exact commands + outputs, in `packages/acceptance/field/`)

```text
corepack pnpm run test        # Test Files 5 passed (5)    Tests 61 passed (61)
corepack pnpm run typecheck   # tsc --noEmit — clean (no output)
corepack pnpm run lint        # Found 0 warnings and 0 errors. Finished in 15ms on 25 files using 2 threads.
```

All files ≤ 400 lines (largest: `src/ops/edge-ops.ts` at 326). No `Date.now`, no `Math.random`, no network, no
timers, no new runtime deps (vitest/typescript devDeps match the lane convention).

## 7. Seam findings (TL-relevant)

- **S1 — mission-replay mirror (documented seam):** cross-lane imports are forbidden, so the mission-replay
  journey binds a LOCAL structural mirror of the tower's `@fleetos/mission` contract (event kinds, view shapes,
  `wo:mission:stage` idempotency-key convention) driven over THIS lane's REAL state (each stage = one REAL
  observation batch through the pipeline + twin admission). Symbol-level equivalence with the real mission fold
  is a TL test-time composition, NOT claimed here. The mirror fixed in §5.2 had a real digest bug — worth the
  TL's attention when adjudicating the seam.
- **S2 — FNV-1a digest convention local copy** (`src/determinism.ts`): same decision as F250A/F260A — the
  canonical home is TL-owned; hoisting into a shared contract is a TL decision.
- **S3 — enrollment refusal vocabulary split:** tenant-scoped registry lookups fail with `device-not-enrolled`
  while record-level `checkEnrollment` names `device-tenant-mismatch`. Both are honest fail-closed refusals;
  consumers should not assume one specific code across both boundaries.

## 8. Honest residuals

- All journey state is caller-threaded in-memory; binding the runner to persisted stores/scheduler-driven runs
  and a live UI is TL composition (this package is the machine-run acceptance harness, per the Wave 7 packet).
- The handoff chain is intra-corpus (publish→consume on one threaded context); cross-process or cross-session
  handoff durability is not exercised here.
- Mission-replay semantics are asserted against the LOCAL structural mirror (S1), not the tower's live mission
  package; adjudication of the mirror's equivalence belongs to the TL.
- The corpus asserts the lane's REAL packages at their public entry points only; no attempt is made to test
  other lanes' behavior (per boundaries).
- `pnpm -r test` (full monorepo) NOT run — TL merge-time gate per packet; the eleven lane packages' suites were
  machine re-run instead (§2).

## 9. TL re-run commands

```bash
cd /home/z/w-f270a
corepack pnpm install --filter @fleetos/acceptance-field --prefer-offline --ignore-scripts  # only if needed
cd packages/acceptance/field && corepack pnpm run test && corepack pnpm run typecheck && corepack pnpm run lint
```
