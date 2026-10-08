# F251 — TL Lane (Integration Health / Convergence / Retry / Idempotency) Completion Evidence

- **Work item:** F251 (Wave 5 TL lane) — catalog `spec/work-items/WORK-ITEM-CATALOG.md`
- **Agent:** TL-dispatched worker (F251), worklog Task ID `2`
- **Branch:** `work/f251` at base `f132d91` (the dispatch-packet commit; Wave-5 post-merge main: F250A/B/C merged)
- **Worktree:** `/home/z/w-f251`
- **Inherited WIP:** a prior interrupted session left the package skeleton + a failing 21-test draft (fixtures broken: a missing import, readonly-state mutations, two ladder fixtures wrong). Every WIP file was machine-re-verified against the packet; the draft was completed, fixed and extended per this report.

## 1. Owned paths touched

- `packages/integrations/health/**` — NEW package `@fleetos/integration-health` (private, Apache-2.0, type: module; exports map `.` + one subpath per deliverable: `./health-assembly`, `./retry-law`, `./idempotency-law`, `./convergence`)
  - `src/health-core.ts` — shared vocabulary + the composition-local FNV-1a digest (32-bit, ␟-join, canonical JSON)
  - `src/health-sections.ts` — the seven per-adapter section views + the FIXED deterministic severity ladder + section/chained digests
  - `src/health-assembly.ts` — `assembleIntegrationHealth(state, options)` + `verifyIntegrationHealthDigest`
  - `src/retry-law.ts` — the unified retry law (ladder spec, transient/permanent vocabulary, per-adapter budget ledger, `proveRetryLawConsistency`)
  - `src/idempotency-law.ts` — the shared `IdempotencyLedger` + the four REAL lane binders + `proveIdempotencyLaw` + law digest/verify
  - `src/convergence.ts` — `assembleConvergenceView` + `convergenceVerdictOf` + `verifyConvergenceDigest` + the structural no-feedback law
  - `src/index.ts`, `package.json`, `tsconfig.json`, `vitest.config.ts`
  - `tests/helpers.ts` + 6 test files (66 tests)
- `docs/evidence/F251/report.md` — this file
- `pnpm-lock.yaml` — MUTATED (uncommitted per packet: the filtered install links the seven composed packages); **not committed**

## 2. Baselines machine-verified (worktree)

BEFORE the first edit (inherited WIP present but uncommitted; the seven lane packages were untouched by it):

| Package | Result |
| --- | --- |
| `@fleetos/adcos` | 8 files, **143/143 passed** |
| `@fleetos/connectivity` | 7 files, **120/120 passed** |
| `@fleetos/integrations/arena` | 7 files, **94/94 passed** |
| `@fleetos/learning` | 5 files, **78/78 passed** |
| `@fleetos/aurum` | 4 files, **61/61 passed** |
| `@fleetos/apify` | 4 files, **68/68 passed** |
| `@fleetos/external-vendors` | 4 files, **51/51 passed** |

Re-verified AFTER the last edit: **143 / 120 / 94 / 78 / 61 / 68 / 51 — all unchanged.**

## 3. Deliverables (all pure deterministic TS; logical `now`/caller-supplied inputs everywhere)

1. **health-assembly.ts** — tenant-scoped integration-plane health view composing the lanes' REAL health outputs: adcos `rollupAdapterHealth` over the REAL `evaluateAdapterCircuit` machine (status + circuit closed/open/half-open + reason codes verbatim), connectivity `rollupFleetPosture`, aurum `reconcileProjectionSet` (refusal = no assembly), apify `verifyRunJournalChain` + `foldRunJournal`, vendors `classifyVerificationExpiry` + `rollupVendorScorecards` (revoked count from the registry), arena `evaluateWithDegradation`, learning `summarizeCapabilityEvaluations`. Per-adapter sections with adapter-carried reason codes surfaced verbatim; global rollup over a FIXED severity ladder (critical: adcos unavailable/open circuit, connectivity divergence, arena `tenant_mismatch`, aurum `diverged`, vendors revoked; degraded: every other honest degraded signal); ONE chained FNV-1a digest over every section digest + rollup; fail-closed tenancy across the WHOLE assembly (missing tenant / adapter-slice tenant mismatch incl. per-record / any lane refusal → NO partial assembly, lane code surfaced verbatim).
2. **retry-law.ts** — the unified retry law: ONE deterministic backoff-ladder spec (integer-bps multipliers `>= 10000`, bounded attempts `>= 1`, monotonic non-decreasing delays, zero jitter, integer arithmetic only) with converters for the REAL lane policy shapes (adcos `EdgeAdcosRetryPolicy`, aurum/apify `RetryPolicy`); retry classification vocabulary `transient | permanent` aligned with the adcos `EdgeAdcosErrorClass` classifier (the lane's classifier is the authority for adcos codes; a shared operational table extends the vocabulary to the aurum/apify/vendors transport codes; unknown codes → `null`, never guessed); per-adapter retry-budget ledger (logical windows, integer-bps accounting, `ceiling-not-authorization` marker machine-carried on every accounting result); `proveRetryLawConsistency(policies)` machine-checks ladder monotonicity, cap bounds and attempt-count positivity and reports violations deterministically — negative fixtures are DETECTED (see tests).
3. **idempotency-law.ts** — the shared idempotency law: an `IdempotencyLedger` (tenant␟scope␟key) with duplicate-submission ACK semantics (ONE state mutation per key; the original `appliedAt` never moves) and typed key conflicts naming the offending adapter + key; binders extracting key records from the REAL lane dedup seams (adcos command-journal `byIdempotencyKey` index, aurum sync-session `appliedIdempotencyKeys`, apify `createActorJobIdempotent` manifests, vendors catalog import dedupe); `proveIdempotencyLaw` machine-proves at-least-once → exactly-once across ALL adapters from delivery traces; law digest + verify.
4. **convergence.ts** — the per-tenant convergence view over the two REAL reconciliation surfaces (adcos `computeReconciliationDiff` + `resolveReconciliation`, aurum `reconcileProjectionSet`): ONE verdict `converged | adapter-lagging | truth-lagging | diverged` over a FIXED classification ladder (conflict/divergence or BOTH lagging directions → diverged; twin-ahead/external-only → adapter-lagging; adapter-ahead/local-only → truth-lagging) with per-source counts and the lanes' own digests carried verbatim; repair queue as PURE PROPOSALS (kind marker + `note: "composition-never-executes"` + lane action/reason vocabulary verbatim — adapters never author domain truth); STRUCTURAL LAW: `AdapterProjectionEntry` cannot be assigned where a `DomainAuthoritativeRecord` is required (module-private authority brand, `@ts-expect-error`-pinned), mirroring the F240B advisory-cannot-feed-back proof; view digest + verify.
5. **index.ts** — public entry barrel (re-exports all deliverables).

## 4. Test themes (6 files, 66 tests — net-new, target ≥ 50)

- `health-assembly.test.ts` (11): sections == DIRECT lane calls (adcos rollup, connectivity posture, aurum reconciliation, apify fold, vendors expiry/exclusions, arena + learning — digests/counts/status equal the lane outputs computed independently); the fixed ladder (healthy fixture → all seven nominal + rollup healthy + digest verifies; adcos open circuit → critical; NO adcos observations → honest `no-observations` degraded, never healthy; revoked vendor + aurum divergence → critical; degraded signals: stale heartbeat, failed apify job, arena `empty_case_set`, degrading learning trend).
- `health-assembly-laws.test.ts` (10): fail-closed tenancy (missing tenant; invalid now; a foreign-tenant connectivity record refuses the WHOLE assembly — the lane itself would silently filter; foreign aurum store / apify journal / vendors catalog / arena request each refuse; lane refusal codes verbatim: aurum `SOURCE_MISMATCH`, learning `no-evaluations`; a tampered apify journal chain refuses); byte-identical determinism; input order-independence (reversed signals/snapshots/requests → same digest); digest verify + tamper (section field, top-level digest, rollup).
- `retry-law.test.ts` (14): the REAL lane defaults pass the law (adcos/aurum/apify with provenance); the adcos default ladder [100,200,400]; constant ladders flat + identical across calls (zero jitter); the cap bounds + monotonicity; NEGATIVE fixtures — shrinking multiplier (violations `multiplier-below-unity` + `delays-not-monotonic`), zero attempts (`attempts-not-positive`), cap below base, negative base; violations deterministically ordered; `adcosRetryClass` == the lane classifier (all seven codes); operational table known/unknown/cross-lane; retry-budget ledger lifecycle (integer-bps utilization, ceiling marker), exhaustion (`RETRY_BUDGET_EXCEEDED`), invalid opens/spends.
- `idempotency-law.test.ts` (6): THE cross-adapter machine proof — every REAL seam driven to duplicate submission (adcos duplicate issue acked, ONE journal record; aurum re-apply fully skipped, byte-identical store; apify duplicate create acked; vendors re-import deduped) → probes (1 mutation first, 0 on re-deliveries) → `proveIdempotencyLaw` ok; prove determinism; violation reports name adapter + key (`duplicate-mutated`, `key-conflict`, `first-delivery-no-effect`) with deterministic ordering.
- `idempotency-ledger.test.ts` (9): the shared ledger (first applies with ONE entry; duplicate ACKS, deliveries increment, original `appliedAt` preserved; key re-used for a different effect → typed conflict; missing tenant/key/effect-digest fail-closed; tenant-scoped ledger key); REAL binders (adcos journal, a committed aurum sync session driven through `openSyncSession → beginFetching → applyFetchedBatch`, apify jobs, vendors catalog); the cross-adapter merge (conflict names adapter + key); law digest + verify + tamper + map-order independence.
- `convergence.test.ts` (16): all four verdicts (converged; adapter-lagging via adcos twin-ahead AND aurum external-only; truth-lagging via adcos adapter-ahead AND aurum local-only; diverged via adcos conflict, aurum divergence, and both-directions lagging) with the lane repair vocabulary verbatim; counts + source digests == DIRECT lane calls; repair-queue purity (every proposal inert: kind marker + `composition-never-executes` + lane action vocabulary); the adcos plan carried verbatim from `resolveReconciliation`; the STRUCTURAL no-feedback proof (`@ts-expect-error` AdapterProjectionEntry → DomainAuthoritativeRecord); fail-closed (missing tenant, invalid now, foreign aurum store, foreign adcos record, aurum `SOURCE_MISMATCH` laneCode); determinism + input order-independence; digest verify + tamper (verdict, counts, top-level digest, repair queue); the `convergenceVerdictOf` ladder over counts alone.

All fixtures bind REAL implementations: the lanes' own builders/journals/stores (`foldAdapterCircuitAll`, `proposeIntent`/`transitionRegistryIntent`, `applyDeltaBatch`/`openSyncSession`, `openRunJournal`/`appendRunEvent`, `openVendorCatalog`/`importCatalogBatch`/`verifyCapability`/`revokeVerification`, `evaluateCapability`, `issueAdcosCommand`, `createActorJobIdempotent`). Domain record shapes are type-EXTRACTED from the composed packages' own signatures — no deep-path imports.

## 5. Exact gate outputs (package dir, per packet)

```
corepack pnpm run test
  Test Files  6 passed (6)
  Tests       66 passed (66)

corepack pnpm run typecheck
  tsc -p tsconfig.json --noEmit     (no output, exit 0 — clean)

corepack pnpm run lint
  Found 0 warnings and 0 errors. Finished in 11ms on 14 files using 2 threads.

boundary self-check (packet command, as written):
  19 matches — all of them the seven REAL package names; the packet's regex
  anticipated hyphenated names that do not exist in the repo (see seam S1).

boundary self-check (corrected for the REAL package.json names):
  grep -rEn "from ['\"]@fleetos/" src | grep -vE "@fleetos/(adcos|connectivity|integrations/arena|learning|aurum|apify|external-vendors)['\"]" || echo CLEAN
  → CLEAN (only the seven sanctioned @fleetos/* entry points appear in src)

purity grep (Date.now|Math.random|setTimeout|setInterval|fetch(|require():
  PURE (zero hits in src and tests)
```

File-size law: every source/test file ≤ 400 lines (max: `tests/convergence.test.ts` at 370; max source `src/health-sections.ts` at 331).

## 6. Seam findings for TL adjudication

- **(S1) Packet package names vs REAL package names.** The packet lists `@fleetos/integrations-adcos`, `@fleetos/connectivity`, `@fleetos/integrations-arena`, `@fleetos/learning`, `@fleetos/integrations-aurum`, `@fleetos/integrations-apify`, `@fleetos/integrations-vendors`; the package.json-confirmed names are `@fleetos/adcos`, `@fleetos/connectivity`, `@fleetos/integrations/arena`, `@fleetos/learning`, `@fleetos/aurum`, `@fleetos/apify`, `@fleetos/external-vendors`. Imports use the REAL names (public entry points only). Consequently: (a) the packet's literal boundary grep flags every import — the corrected grep is CLEAN; (b) `@fleetos/aurum`, `@fleetos/apify`, `@fleetos/external-vendors` carry NO `exports`/`main`, and `@fleetos/integrations/arena`'s two-slash name is not Node-ESM-resolvable — so `vitest.config.ts` (`resolve.alias`) + `tsconfig.json` (`paths`) map the four to their PUBLIC entry files inside this package only, exactly the `@fleetos/convergence` seam-gap-bridge precedent, to be removed by the TL when the lanes gain their additive exports maps.
- **(S2) Cross-plane idempotency (packet asks explicitly).** The shared `IdempotencyLedger` is integration-plane (adcos/aurum/apify/vendors seams). The F241 command-bus law (one shared queue, mission + tower commands, `missing-idempotency-key` at the seam) lives in the experience plane. Key formats also diverge: adcos's journal indexes `tenantId|key`, this ledger `tenantId␟scope␟key`. Unifying the idempotency-key LAW across planes is a TL adjudication, not a composition-package change.
- **(S3) Adapter-health vocabulary convergence (packet asks explicitly).** The seven lanes carry seven status vocabularies (adcos healthy/degraded/unavailable + circuit; connectivity honest posture + alignment; arena nine degraded states; learning band + trend; aurum four reconciliation classes; apify job statuses; vendors verification/expiry/exclusions). The assembly maps them onto a composition-local `critical | degraded | nominal` ladder; the rungs are documented in `health-sections.ts` and are TL-tunable. A canonical cross-lane health vocabulary would belong in a shared contract.
- **(S4) connectivity silently FILTERS foreign-tenant records** in `rollupFleetPosture` (fail-closed by omission, not refusal). The assembly refuses the whole view first on any tenant mismatch (F241 S4 precedent — tower-level narrowing is deliberate).
- **(S5) vendors metric↔catalog naming quirk:** `classifyQuarantine` matches a metric's `vendorExternalId` against the CATALOG ENTRY KEY (the entry's `externalId`), not the entry's `vendorExternalId` field. The fixtures follow the lane's own tests; flagged for a future contract clarification.
- **(S6) connectivity `authorize` requires BOTH a policy ceiling and an AuthorizationGrant** (ceiling necessary, never sufficient — the Guardian cannot be bypassed). The composition's fixtures carry both; worth carrying into any future shared authorization contract.
- **(S7) Redundant machine check (documented):** `delays-not-monotonic` in `proveRetryLawConsistency` cannot fire for a ladder that passes the other four checks (multiplier ≥ 10000 + cap ≥ base keep the ladder non-decreasing); it is defense-in-depth and is exercised through the shrinking-multiplier negative fixture (which trips it alongside `multiplier-below-unity`).
- **(S8) adcos already carries an in-lane `backoffLadder`** (command-lifecycle). The unified retry law subsumes it via `ladderFromAdcosPolicy`; whether the lane should consume the shared law instead is a TL choice.
- **(S9) `pnpm-lock.yaml` mutation uncommitted** (per packet): the filtered install links the seven composed packages into `packages/integrations/health/node_modules`.

## 7. Honest residuals

- Per-call assemblies (no caching/persistence); loading lane slices into `IntegrationHealthState` is application composition below this package.
- Health is READ-ONLY composition: no command emission, no state mutation, no Guardian bypass (all repair entries are inert proposals).
- Verify functions recompute digests from presented fields, not full re-derivation (established lane convention).
- FNV-1a digests (lane convention), not sha256 — consistent with all Wave-4/5 lanes.
- The severity ladder and the convergence classification ladder are composition-local policy; values are documented and deterministic, but TL-tunable.
- `proveIdempotencyLaw` proves over caller-supplied delivery traces (the tests derive them from the REAL seams); the ledger does not intercept lane internals by construction — it binds them through the lane-published records.
- Cross-plane (kernel/control-plane/mission) laws deliberately untouched: zero imports from them (boundary CLEAN).
- Root gates (`pnpm -r test`, architecture snapshot, contract-snapshot regen) NOT run — TL merge-time per packet; the package is unregistered in `architecture-policy.yaml` so the snapshot is unaffected.
- The prior session's broken draft is fully superseded: its 21 failing tests were fixed and subsumed into the 66-test suite (nothing of the draft was deleted, everything was machine-re-verified).

## 8. TL re-run commands

```bash
cd /home/z/w-f251/packages/integrations/health
corepack pnpm install --filter @fleetos/integration-health... --prefer-offline --ignore-scripts
corepack pnpm run test        # 66/66 (6 files)
corepack pnpm run typecheck   # clean
corepack pnpm run lint        # 0 warnings, 0 errors
grep -rEn "from ['\"]@fleetos/" src | grep -vE "@fleetos/(adcos|connectivity|integrations/arena|learning|aurum|apify|external-vendors)['\"]" || echo CLEAN

# the seven composed baselines (worktree):
for p in packages/integrations/adcos packages/connectivity packages/integrations/arena \
         packages/learning packages/integrations/aurum packages/integrations/apify \
         packages/integrations/vendors; do (cd $p && corepack pnpm run test); done
# 143 / 120 / 94 / 78 / 61 / 68 / 51
```
