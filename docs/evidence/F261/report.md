# F261 — TL Lane (FleetOS Engineering Lab Product Shell) Completion Evidence

- **Work item:** F261 (Wave 6 TL lane) — catalog `spec/work-items/WORK-ITEM-CATALOG.md` — "FleetOS Engineering Lab product shell, TL"
- **Agent:** TL-dispatched worker (F261), worklog Task ID `4`
- **Branch:** `work/f261` at base `34fb101` (the Wave-6 TL dispatch packet commit; main = `3ed3c8c` — Wave 6 lanes merged, full suite 3602/0 TL-verified)
- **Worktree:** `/home/z/w-f261`

## 1. Owned paths touched

- `packages/experiences/engineering-lab/**` — NEW package `@fleetos/experience-engineering-lab` (private, Apache-2.0, type: module; conventions from `packages/experiences/control-tower`; `exports` map: `.` + one subpath per deliverable: `./lab-state`, `./experiment-views`, `./benchmark-views`, `./optimization-views`, `./command-intents`)
  - `src/lab-core.ts` — lab-local FNV-1a digest (32-bit, ␟-join convention, identical to tower-core) + canonical JSON + the four machine-carried law markers (EXPERIMENTAL-evidence-only / advisory-only / proposals-only-Guardian-path / ceiling-not-authorization)
  - `src/lab-state.ts` — `LabStateSlice` (tenant-scoped composition of the three lanes' REAL outputs: `FleetWorld`s + world run journals + `ExperimentalRunOutput<FleetWorldRunSummary>`s, benchmark sets/replays/scoring/safety/reports, optimization problems + the three proposal kinds + what-if analyses) + `guardLabState` + `labStateDigestOf`/`verifyLabStateDigest`
  - `src/experiment-views.ts` — experiment console read-models: `buildExperimentSetupView` (world summary + scenario script + seed + planned steps via the REAL `toSimulationScenario`), `buildRunMonitorView` (journal timeline, event-kind counts VERBATIM from the REAL output, checkpoint visibility via the lane's OWN fold/checkpoint/resume machinery), `buildRunOutcomeView` (EXPERIMENTAL markers structural) + `verifyExperimentViewDigest`
  - `src/benchmark-views.ts` — `buildBenchmarkScorecard` (per-case table, aggregate scores verbatim, four-check safety section, envelope violations surfaced PROMINENTLY at top level) + `buildBenchmarkComparisonView` (extends the lane's `compareBenchmarkRuns` convention) + `verifyBenchmarkViewDigest`
  - `src/optimization-views.ts` — `buildOptimizationReviewQueue` (role-allocation proposals with scoring-trace counts, budget rebalancing utilization deltas, routing frontier + ladder reorders, what-if before/after bps deltas — all REVIEW-READY, Guardian-path markers, proposal digests surfaced) + `verifyOptimizationQueueDigest`
  - `src/command-intents.ts` — typed intent builders (`lab.experiment.launch`, `lab.benchmark.run-request`, `lab.optimization.submit-proposal`) producing frozen inert `LabCommandDraft` records via a LOCAL STRUCTURAL mirror of the control-plane submit contract (`CommandSubmitInputMirror`, F240/F240A precedent — NO `@fleetos/control-plane` import) + `toSubmitInput`/`validateLabCommandDraft`/`verifyLabCommandDraftDigest`
  - `src/index.ts`, `package.json`, `tsconfig.json`, `vitest.config.ts`
  - `tests/fixtures-sim.ts` + `tests/fixtures-bench.ts` + `tests/fixtures-opt.ts` + `tests/helpers.ts` + 5 test files (65 tests)
- `docs/evidence/F261/report.md` — this file
- `pnpm-lock.yaml` — MUTATED (uncommitted per packet: the filtered install links the three composed lane packages); **not committed**

## 2. Baselines re-verified BEFORE the first edit (machine-run, worktree)

| Package | Result |
| --- | --- |
| `@fleetos/sim-worlds` | 5 files, **84/84 passed** |
| `@fleetos/simulation` | 7 files, **91/91 passed** |
| `@fleetos/agent-organizations` | 10 files, **182/182 passed** |

Re-verified AFTER the last edit: 84/84, 91/91, 182/182 — unchanged (no source outside the lab package was touched).

## 3. Deliverables (all pure deterministic TS; logical `now`/caller-supplied inputs everywhere)

1. **lab-state.ts** — `LabStateSlice` + `guardLabState`: TENANT FAIL-CLOSED over the whole slice — missing tenant, invalid-now, cross-tenant world / run output / scenario / benchmark set / report / scoring / safety / replay / proposal / what-if (each naming the offender in the refusal detail), unknown-world refs (run worldId not in worlds, scenario↔output world mismatch), unknown-benchmark refs (report setDigest not resolving to its set), unknown-organization refs (role/budget/what-if org mismatch), duplicate world/run/report/org, and journal integrity via the lane's OWN `verifyWorldJournal` (a tampered chain refuses `journal-invalid`). Accepted slices are NORMALIZED to deterministic ordering (worldId/runId/report-runId/organizationId/proposal-digest asc) so input array order never leaks into `labStateDigestOf`.
2. **experiment-views.ts** — three console read-models, each running `guardLabState` first and surfacing the guard's own code verbatim in `guardCode` (views only render GUARDED state — no partial views). Setup view: world identity/seed/timeUnit + counts equal the definition, scenario script (all scripted faults with step windows), planned steps equal the REAL `toSimulationScenario` projection. Monitor view: timeline rows equal the REAL journal (seq/step/kind/digest), event-kind counts VERBATIM from the REAL output (equal a direct `summarizeRun` call), checkpoint visibility with the lane's resume-equivalence law machine-checked at presentation, journal head digest. Outcome view: the EXPERIMENTAL output presented verbatim with `kind: "EXPERIMENTAL"` + `experimental: true` + `evidenceKind` STRUCTURAL (test-pinned at the type level: an `"OBSERVED"` claim does not typecheck).
3. **benchmark-views.ts** — scorecard: per-case rows VERBATIM from the REAL report, the whole aggregate (calibration bands, staleness classes, degradationBps) presented BY REFERENCE (a source edit surfaces — never recomputed), the four-check safety battery in the lane's fixed order with per-check counts, envelope violations surfaced PROMINENTLY at the top level (equal the lane's own check), advisory-only markers structural (`kind: "BENCHMARK_REPORT"`, `experimental: true`, the lane's own `advisoryNote` verbatim). Comparison view: ranking/entries/comparisonId equal the REAL `compareBenchmarkRuns` over the slice's reports.
4. **optimization-views.ts** — the review queue: one section per organization (problem digest surfaced), role-allocation entries (REAL proposal totals + scoring-trace/swap/excluded counts), budget entries (adjustment deltas + bands verbatim), routing entries (per-class current vs proposed + ladder reorders), what-if entries (before/after deltas incl. `deltaBps` verbatim) — every entry carries `proposal: true` + the Guardian-path marker structurally; nothing is applied.
5. **command-intents.ts** — three typed builders producing frozen inert drafts with capability REQUIREMENT + mandatory audit reason + the `capability-ceiling-not-authorization` marker; subject-keyed deterministic idempotency keys (FNV-1a over tenant+kind+subject — never random); `validateLabCommandDraft` mirrors the queue's submit rejection vocabulary; `toSubmitInput` emits the exact submit-boundary shape.

## 4. Test themes (5 files, 65 tests — net-new, target ≥50)

- `lab-state.test.ts` (16): guard acceptance over the composed REAL slice; deterministic normalization (input order-independence — reversed arrays → identical slice digest); byte-identical determinism; exact refusals: missing-tenant, invalid-now (0 + 1.5), cross-tenant world/run-output/report/role-proposal (each naming the offender), unknown-world-ref, unknown-benchmark-ref, unknown-organization-ref (role + what-if), journal-invalid via the lane's OWN verifier on a tampered digest, duplicate-world, duplicate-report; slice digest verify + tamper.
- `experiment-views.test.ts` (13): world summary counts equal the definition; scenario script (3 faults with windows); planned steps equal the REAL `toSimulationScenario`; timeline + counts equal the REAL journal/output AND a direct `summarizeRun` call; checkpoint resume-equivalence; EXPERIMENTAL markers structural (+ `@ts-expect-error` type-level proof); unknown-world/scenario/run/invalid-planned-steps/invalid-checkpoint-interval; cross-tenant slice surfaces the guard code; digest verify + tamper; determinism.
- `benchmark-views.test.ts` (11): per-case rows verbatim; aggregate verbatim (bands + staleness classes + degradationBps); numbers presented BY REFERENCE (never recomputed); four checks in fixed order with counts; envelope violations surfaced prominently on the tight report (equal the lane's check, non-empty); advisory markers structural + `@ts-expect-error` proof; unknown-report + guard-code surfacing; digest verify + tamper + determinism; comparison ranking equal the REAL `compareBenchmarkRuns` on two metrics; empty computedAt refusal.
- `optimization-views.test.ts` (10): problem digest; role totals + trace counts equal the REAL proposal; budget adjustment deltas verbatim; routing current-vs-proposed + ladder; what-if bps deltas verbatim; Guardian-path markers structural on every entry (+ `@ts-expect-error` proof); queue totals; cross-tenant guard-code surfacing; digest verify + tamper; byte-identical determinism.
- `command-intents.test.ts` (15): frozen drafts with capability + reason + ceiling marker; exact refusal codes per builder (missing-world-id/scenario-id, invalid-step-count, missing-set-digest, missing-metric, missing-organization-id, missing-proposal-digest, invalid-proposal-kind, missing-tenant/actor/reason, invalid-issued-at/not-before); subject-keyed idempotency (same subject → same key incl. across actors; different subject → different); `toSubmitInput` exact key set (notBefore presence/absence); mirrored queue rejection vocabulary; digest verify + tamper; inertness (no execute/submit key, frozen).

All fixtures bind REAL implementations: `validateWorld`/`runWorld`/`runFleetWorldSimulation`/`summarizeRun`/`toSimulationScenario`/`verifyWorldJournal` (sim-worlds), `defineBenchmarkCase`/`assembleBenchmarkSet`/`replayJournal`/`scoreBenchmarkSet`/`runSafetyBattery`/`assembleBenchmarkReport`/`compareBenchmarkRuns` (simulation), `nextOrgEntry`/`prepareOptimizationInputs`/`allocateRoles`/`rebalanceBudgets`/`optimizeRouting`/`projectWhatIf` (agent-organizations). Domain record shapes are type-EXTRACTED from the lanes' own contracts (`OptimizationInputs["usageExcerpt"][number]`, `BenchmarkCase["journal"][number]`) — no deep-path imports. Two digest conventions are replicated LOCALLY in fixtures (the world-model journal entry digest; the model-gateway usage-ledger entry digest) because the lab may only import the three Wave-6 lane packages — both replicas are machine-verified by the REAL `foldWorldState` (inside `defineBenchmarkCase`) and the REAL `verifyUsageLedgerChain` (inside `prepareOptimizationInputs`) on every fixture build.

## 5. Exact gate outputs (package dir, per packet)

```
corepack pnpm run test
  Test Files  5 passed (5)
  Tests       65 passed (65)

corepack pnpm run typecheck
  tsc -p tsconfig.json --noEmit     (no output, exit 0 — clean)

corepack pnpm run lint
  Found 0 warnings and 0 errors. Finished in 12ms on 16 files using 2 threads.

boundary self-check (packet command):
  CLEAN (only the three sanctioned @fleetos/* entry points appear in src)

purity grep (Date.now|Math.random|setTimeout|setInterval|fetch(|new Date|require():
  only a documentation comment; no code hits
```

File-size law: every source/test file ≤ 400 lines (max: `src/experiment-views.ts` at 363).

## 6. Seam findings for TL adjudication

- **(S1) The CommandDraft seam diverges AGAIN, by design.** The lab's `LabCommandDraft` mirrors the F240A shape (flat draft + `toSubmitInput()` projection + mirrored rejection vocabulary) rather than the F240B/F240C lane shapes (submit-fields-at-top-level + `intent` metadata; nested `command` envelope). The F241 tower already binds all three Wave-4 shapes through local guards; the lab adds a FOURTH flat shape. The CommandDraft↔SubmitCommandInput contract unification (flagged F240A S2, F241 S1) now spans five packages — recommend adjudicating a single canonical draft contract at the control plane.
- **(S2) Routing proposals carry NO organizationId.** `RoutingOptimizationProposal` has tenantId but no organization linkage, so `guardLabState` cannot prove a routing proposal belongs to the slice's organization (only tenancy). Documented in-code as a seam note; the lane may want to add organizationId (or a problem-digest reference) for provenance parity with role/budget proposals.
- **(S3) `OptimizationProblem` is the only org linkage for what-if analyses at guard time.** `WhatIfAnalysis` carries organizationId + tenantId (sufficient), but nothing binds a what-if to the SPECIFIC proposals it projects (digests are not carried). The queue presents them side by side; if the product needs proposal→what-if traceability, the lane should carry the proposal digests into the analysis.
- **(S4) Benchmark aggregate is presented BY REFERENCE (aliasing).** The scorecard's `aggregate` field is the report's own aggregate object — deliberate (verbatim presentation, never recomputed; a post-build source edit surfaces in the view and breaks view-digest verification). per-case rows are shallow copies. If the TL prefers full defensive copies for `aggregate` too, it is a one-line change.
- **(S5) Local digest replicas in test fixtures.** The world-model `worldEntryDigest` and model-gateway `usageEntryDigest` formulas are replicated in `tests/fixtures-bench.ts` / `tests/fixtures-opt.ts` because the deps law forbids importing those packages. Both are machine-verified end-to-end by the REAL lane folds on every fixture build, but if either lane ever changes its digest convention the lab fixtures break loudly (acceptable: fail-closed).
- **(S6) `REFERENCE_MODEL_VERSION` mirrored as a string constant** ("reference-twin-1.0.0") since `@fleetos/predictive` cannot be imported. The REAL replay harness fail-closes on model-version mismatch, so a drift is caught at fixture-build time (loudly), not silently.
- **(S7) `pnpm-lock.yaml` mutation uncommitted** (per packet): the filtered install links the three composed lane packages. A clean-checkout root install regenerates it.

## 7. Honest residuals

- Read-model shell only — no persistence, adapters, or UI; the store→slice mapping (loading the lanes' outputs) is application composition below this package.
- `verify*Digest` functions recompute digests from presented view fields (tamper-evident), not a full re-derivation from source state — the established lane convention (F240A/F241).
- FNV-1a 32-bit digests (lane convention), not sha256.
- The monitor view recomputes checkpoints by re-folding the journal at presentation time (O(n²) in events for checkpoint computation with the default `checkpointEvery: 10`); fine for lab-scale journals, worth revisiting for long runs (the state itself is never recomputed from scratch — only prefix folds).
- Views validate the slice via the guard on EVERY call (defense in depth) — a caller composing many views may prefer to guard once and pass a pre-guarded slice; the API accepts the same type either way.
- Root gates (`pnpm -r test`, architecture snapshot) NOT run — TL merge-time per packet; the package is unregistered in `architecture-policy.yaml`, so the snapshot is unaffected.
- The comparison view requires ≥ 2 reports to rank meaningfully (a single report still works — ranking of one); empty-report slices refuse through the REAL `compareBenchmarkRuns` (`empty-reports`), surfaced as `invalid-metric`.

## 8. TL re-run commands

```bash
cd /home/z/w-f261/packages/experiences/engineering-lab
corepack pnpm install --filter @fleetos/experience-engineering-lab --prefer-offline --ignore-scripts
corepack pnpm run test        # 65/65
corepack pnpm run typecheck   # clean
corepack pnpm run lint        # 0 warnings, 0 errors
grep -rEn "from ['\"]@fleetos/" src | grep -vE "@fleetos/(sim-worlds|simulation|agent-organizations)['\"]" || echo CLEAN
```
