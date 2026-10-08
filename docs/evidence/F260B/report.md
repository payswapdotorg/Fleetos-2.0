# F260B — Worker B (Safety + Intelligence) Wave 6 Completion Evidence

- **Work item:** F260B — Predictive evaluation/replay/safety benchmarks (Wave 6 lane B)
- **Owner:** Worker B (Safety + Intelligence)
- **Base commit:** `987954f` (branch `work/f260b`, the TL's Wave-6 dispatch commit)
- **Branch:** `work/f260b`
- **Date:** 2026-10-09
- **Session note:** CONTINUATION session (Task `3-b`, agent `Worker B (F260B)`).
  A prior interrupted session left UNCOMMITTED WIP in this worktree (5 new `src`
  modules + 5 new `tests` files + fixtures, with `package.json`/`src/index.ts`
  modified and `pnpm-lock.yaml` mutated). Per protocol this session ran
  `git status` + `git stash list` first, then MACHINE-VERIFIED the TRUE HEAD
  baseline from a clean state (`git stash push -u` → all six lane suites green
  at `987954f`, counts in §3 → `git stash pop`), reviewed EVERY WIP file
  against the packet, and completed/fixed what was unfinished before committing:

  1. **Replay harness `fromSeq` bug (src)** — the WIP set `fromSeq` to the
     genesis checkpoint's own seq (0) instead of the first REPLAYED journal
     seq; this cascaded into 10 spurious `replay-mismatch` scoring failures.
     Fixed (§2.2).
  2. **`ReplayStep.inputDigest` placement (src)** — the WIP declared the
     model's provenance digest inside the ok-outcome variant while the tests
     (and the natural reading of the packet's "collect per-step predictions
     with the model's own provenance digests") wanted it at step level.
     Restructured: top-level `inputDigest: string | null` (null honestly when
     the step's projection was rejected).
  3. **Calibration band test bug (tests)** — the WIP expected a +100 bps
     deviation to land in the (100,500] band, contradicting the src's
     edge-inclusive-upper bucketing (`findIndex(dev <= edge)`) that the SAME
     WIP file asserted elsewhere ("0 bps → (-100,100]"). Fixed the test to the
     src's (correct, documented, boundary-tested) semantics.
  4. **21 typecheck errors (tests)** — readonly-array/literal-tenant parameter
     types in WIP test helpers and un-narrowed `SafetyCheck` union accesses;
     all fixed with explicit `readonly WorldJournalEntry[]` /
     `{ tenantId: string }` helper signatures and checkId narrowing guards.
  5. **MISSING deliverable** — `tests/benchmark-report.test.ts` did not exist;
     written from scratch this session (18 tests over the full REAL pipeline).
  6. One comparator hardening in `benchmark-report.ts` (equal-caseId sort
     returned 1 instead of 0; caseIds are unique in a set so zero behavior
     change).

  Nothing below is claimed that was not run (HONESTY LAW).

## 1. Owned paths touched

Per `spec/worker-ownership.yaml` (worker-b):

- `packages/simulation/**`
- `docs/evidence/F260B/**` (this report)

Commit contents: 12 files under `packages/simulation` — 5 new `src` modules,
5 new `tests` files (incl. shared fixtures), and 2 additively-modified files
(`package.json`: 5 new `exports` subpaths + the three intra-lane workspace
dependencies the REAL-binding imports require; `src/index.ts`: additive
re-export tail) — plus this evidence directory. All pre-existing exports are
unchanged — Wave 6 additions are ADDITIVE only.

```text
packages/simulation/src/benchmark-definition.ts   (new, 388 lines)
packages/simulation/src/replay-harness.ts        (new, 238 lines)
packages/simulation/src/scoring.ts               (new, 389 lines)
packages/simulation/src/safety-benchmarks.ts     (new, 392 lines)
packages/simulation/src/benchmark-report.ts       (new, 318 lines)
packages/simulation/tests/{benchmark-definition,replay-harness,scoring,safety-benchmarks,benchmark-report}.test.ts (new)
packages/simulation/tests/benchmark-fixtures.ts  (new, shared REAL-machinery fixtures)
packages/simulation/{package.json,src/index.ts}  (modified, ADDITIVE)
```

Lint law: largest new src file 392 lines (limit 400). `oxlint src`: 0 warnings
/ 0 errors. `pnpm-lock.yaml` is dirty in the worktree (mutated by
`corepack pnpm install` when the workspace deps were added) and is NOT
committed, per the packet — see §6.1.

## 2. What was delivered

All five modules bind the intelligence plane's REAL public entry points
(`@fleetos/predictive` reference model + `ModelPort`, `@fleetos/world-model`
journal fold/checkpoints/staleness, `@fleetos/world-context` tenant-safe
assembly) — no stubs, no re-implementations. Pure deterministic TS: no clock,
no randomness, no I/O, no new runtime deps beyond the intra-lane workspace
links. Logical `now` is caller-supplied integer milliseconds everywhere.

### 2.1 `src/benchmark-definition.ts` — case + set definition

- **`BenchmarkCase`** binds the four packet parts: a world-model journal
  SEGMENT (digest-chained, single-tenant), `PredictiveInvocationParams`
  (pinned `modelPortName`/`modelVersion`/metric/horizon — the replay fails
  closed on a version mismatch), `ExpectedOutcomeRef[]` (realized values with
  authoritative observation refs, validated to sit exactly at
  `journal[replaySeq-1].atMs + step × stepMs`), and a `SafetyEnvelope`
  (declared `maxAbsValue` / `minConfidenceBps` / `maxBoundHalfWidth` /
  `maxCounterfactualDeltaBps` / `perturbationOffset`).
- `defineBenchmarkCase` — fail-closed validation of 15 rejection codes
  (missing-tenant/case-id/entity, invalid invocation/horizon, empty journal,
  journal-invalid via the REAL `foldWorldState`, tenant-mismatch,
  unknown-entity, empty-history, invalid context fields, invalid envelope,
  missing/invalid/duplicate/time-mismatched expected outcomes). The journal
  must fold cleanly through the REAL fold before the case exists.
- **`benchmarkCaseDigest`** — FNV-1a over a version-prefixed canonical
  (recursively key-sorted) serialization covering the journal HEAD digest +
  length, invocation, envelope, context fields and the order-normalized
  (sorted) expected outcomes. **`assembleBenchmarkSet`** — deterministic
  caseId-asc ordering (input order never leaks; reversed input → byte-identical
  set), sorted-unique `modelVersions`, `setDigest`, tenant fail-closed
  (missing-tenant / empty-set / cross-tenant-case with the offender named /
  duplicate-case-id / invalid-assembled-at). **`verifyBenchmarkSetDigest`** —
  TWO-LEVEL: recomputes each member's digest from stored content (case
  tampering) then the set digest (addition/removal/reorder/tenant/time edits).
- Exported shared conventions: `BENCHMARK_ADVISORY_NOTE` ("BENCHMARK EVIDENCE —
  EXPERIMENTAL, ADVISORY ONLY, NEVER OPERATIONAL TRUTH"), `fnv1a`,
  `canonicalJson`.

### 2.2 `src/replay-harness.ts` — deterministic replay

- **`replayJournal`** — drives the journal through the REAL reference model
  step-by-step: fold order = journal seq order. At every seq the harness
  resumes the REAL world fold from the previous checkpoint
  (`checkpointWorld`/`resumeWorld`), maps the entity's observation history
  into a `TwinStateInput` (asOfMs = the entry's `atMs` — the historical
  moment), and calls the REAL `ModelPort` (default
  `makeReferenceModelPort()`; a caller-supplied port is honored — the Wave-5
  JEPA seam). An honest per-step rejection (e.g. `empty-history` on the
  registration-only prefix) is recorded, never fabricated over.
- Each `ReplayStep` carries the model's OWN provenance `inputDigest`
  (top-level; `null` on rejected steps) + the full advisory `Prediction`
  (bounds + integer-bps confidence), observation count, last-observed time.
  The run carries `kind: "REPLAY"`, machine-carried `experimental: true`, the
  advisory note, `fromSeq`/`toSeq` (first/last REPLAYED seq), journal head
  digest, `journalLength`, and a `replayDigest` over the whole run.
  Re-replay is byte-identical (JSON.stringify equality, machine-tested).
- **`resumeReplay`** — checkpoint resume at ANY journal seq picks up
  identically (machine-tested at every boundary 0..n: suffix steps
  byte-identical to the full replay's corresponding slice); a seq-0
  checkpoint validates the full suffix through the REAL fold and
  cross-checks the incremental path against it (fail-closed
  `replay-state-error` on divergence). Rejections: missing-tenant (incl.
  another tenant's checkpoint), missing-entity, invalid-invocation,
  journal-invalid, model-version-mismatch (pinned vs port),
  replay-state-error (broken suffix chain).
- `isReplayRun` runtime guard verifies the REPLAY + EXPERIMENTAL markers
  survive transit (rejects stripped copies).

### 2.3 `src/scoring.ts` — deterministic scoring

- **`scoreBenchmarkCase`** — pairs each expected outcome with the replay's
  prediction at (replaySeq, step): hit = realized within the prediction's
  bounds INCLUSIVE (boundary machine-tested both edges); integer-bps signed
  deviation (null at zero baseline — counted honestly in
  `zeroBaselinePairs`); per-pair staleness class via the REAL
  `classifyStaleness(lastObservedAtMs, atMs, thresholds)`.
- **Calibration bands** — fixed exported edges `[-5000,-2000,-1000,-500,-100,
  100,500,1000,2000,5000]` bps + an open (+inf) band; edge-inclusive upper
  (machine-tested at exact boundaries incl. -1000, -5000, +100).
- **Staleness-sensitivity** — per-class (fresh/stale/unknown) pair + hit
  counts with honest `null` hit-rates for empty classes;
  `degradationBps = fresh − stale` (null honestly when either class is
  empty); `stalenessFallback` + `stalenessScoreBps = fresh ?? hit-rate` when
  nothing is fresh (documented fallback, never fabricated).
- **Aggregate** — FIXED deterministic weighting, exported constants, NO
  learned weights: `aggregateBps = (hit×5000 + calibration×3000 +
  staleness×2000)/10000`. Calibration = `10000 − mean|deviation|` (integer
  bps, clamped), falling back to the hit-rate (flagged) when all deviations
  are null.
- Fail-closed: `tenant-mismatch` (case vs replay), `replay-mismatch`
  (entity/metric/head/from/to), `invalid-thresholds`, `invalid-now`
  (non-integer logical now), `now-before-realized` (scoring before the
  realized outcome exists is dishonest). Unscoreable outcomes are NAMED in
  `unscoreableOutcomes` (never silent). Empty matched pairs → honest
  `insufficient-evidence`.
- **`scoreBenchmarkSet`** — aggregates across cases (per-case caseId-asc;
  input order never leaks; byte-identical on reversed input), honest
  `partial-case-set` with named unscored members + a partial aggregate when
  any case fails, `insufficient-evidence` on empty set/tenant. Every scoring
  carries `kind: "BENCHMARK_SCORING"`, `experimental: true`, the advisory
  note and a `scoringDigest`.

### 2.4 `src/safety-benchmarks.ts` — the four-check battery

- **(a) advisory-envelope** — counts every replayed prediction point whose
  |value| exceeds `maxAbsValue`, half-width exceeds `maxBoundHalfWidth`, or
  confidence is below `minConfidenceBps`, as a named `EnvelopeViolation`
  (caseId/seq/step/kind/value/limit). A deliberately envelope-violating
  fixture (steep-drift case under a tight envelope) MUST be counted — 22
  violations machine-verified (5 value, 9 bound-width, 8 confidence).
- **(b) counterfactual safety margin** — through the REAL
  `runCounterfactual`, computes the divergence between the +budget and
  −budget counterfactual worlds per case (integer bps of the baseline,
  honest nulls on zero-baseline steps), checked against the declared
  `maxCounterfactualDeltaBps`; out-of-budget cases are named
  (`outOfBudgetCases`), rejections named.
- **(c) predictive-cannot-write-state LAW (machine check)** —
  `checkReplayEmitsNoStateRecords` structurally scans replay emissions for
  journal-entry-shaped records, world-event records (all four kinds),
  OBSERVED-claiming records and marker-stripped predictions: the REAL replay
  emits ZERO (positive control); forged/stripped negatives ARE counted and
  named (negative control). `assertNoStateWriteFunctions` additionally
  machine-checks the MODULE SURFACE of all five F260B modules (no
  append/write/emit/record/publish/commit functions exist).
- **(d) redaction integrity** — over tenant-crossing assemblies: the REAL
  `assembleContext` is run for every default purpose; asserts the declared
  default-policy fields are redacted (`missingRedactions` empty), no redacted
  raw value leaks into the serialized features (`leaks` empty), the
  assembled digest verifies, and a tenant-crossing assembly FAILS CLOSED
  (`cross-tenant-ref`).
- **`runSafetyBattery`** assembles the fixed-order four checks into a
  `SafetyReport` (`kind: "SAFETY_REPORT"`, `experimental: true`, advisory
  note, `passed`, `violationCount`, `safetyDigest`); `verifySafetyReport`
  recomputes the digest (detects check flips + violation-count edits);
  `isSafetyReport` runtime guard. Fail-closed on missing/tenant-mismatched
  members, empty members, model-version and replay mismatches. NO silent
  passes: every check is boolean + evidence refs.

### 2.5 `src/benchmark-report.ts` — report assembly + comparisons

- **`assembleBenchmarkReport`** — per-case entries (case + case digest, replay
  run id + digest, score digest, matchedPairs/hitRateBps/aggregateBps,
  per-case envelope violation count), the full scoring, the full safety
  report, `setDigest`, `modelVersions`, per-case journal head digests,
  caller-supplied `nowMs`/`computedAt`; `reportDigest` over it all. Fail-closed:
  missing-tenant, tenant-mismatch (set/scoring/safety/replays),
  empty-set, invalid-now, now-before-scoring, replay-mismatch (count +
  foreign replays), scoring-mismatch (coverage ≠ set), safety-mismatch
  (first check not advisory-envelope), invalid-computed-at. A FAILING safety
  report is carried honestly (machine-tested) — never dropped.
- **`verifyBenchmarkReport`** — recomputes report/safety/scoring digests,
  totals consistency, and (when evidence is supplied) the set digest and
  every replay digest; every boolean named; optional checks honestly `null`
  when no evidence was given.
- **`compareBenchmarkRuns`** — cross-run comparison EXTENDING the existing
  `buildComparison` kernel convention (comparisonId derived through the REAL
  export): deterministic runId-asc entries, value-desc ranking (runId-asc
  tie-break), `bestRunId`, digest; three metrics map to the aggregate
  (`aggregate-bps`/`hit-rate-bps`/`calibration-score-bps`). Fail-closed:
  empty-reports, tenant-mismatch, duplicate-run-id, invalid-computed-at.
- Runtime guards `isBenchmarkReport` / `isBenchmarkComparison` verify the
  EXPERIMENTAL markers survive transit.

## 3. Tests

Baselines MACHINE-RE-VERIFIED in this worktree BEFORE any edit (from a clean
state via `git stash push -u` of the inherited WIP; established law:
baseline before edit) at base `987954f`:

```text
packages/simulation     20 tests (2 files) — all green
packages/predictive     61 tests (3 files) — all green
packages/world-model    42 tests (3 files) — all green
packages/world-context  34 tests (3 files) — all green
packages/integrations/arena  94 tests (7 files) — all green
packages/learning       78 tests (5 files) — all green
```

After F260B (all run in this session, all green):

```text
packages/simulation     20 -> 91   (+71 net-new; packet target >= 50)
lane siblings unchanged (predictive 61, world-model 42, world-context 34,
                         arena 94, learning 78 — re-verified green AFTER
                         the last edit, §4.2)
```

### Test themes covered (meaningful, not shape-only)

- **benchmark-definition** (14): case shape + digest + head provenance;
  byte-identical determinism; expected-outcome input order never changes the
  case digest; all 15 rejection codes incl. tampered chain (journal-invalid
  via the REAL fold), foreign-tenant journal, no-observation entity; set
  assembly (caseId ordering, digests, model versions, reversed input
  byte-identical); set rejections (empty/cross-tenant/duplicate/bad time);
  TWO-LEVEL set-digest tamper detection (member envelope edit, case removal,
  forged set digest, assembly-time edit); `benchmarkCaseDigest` recompute;
  the kernel `buildComparison` convention unchanged.
- **replay-harness** (14): every seq replayed in order through the REAL
  model; per-step provenance `inputDigest` + advisory predictions (3 points,
  bounds, integer-bps confidence); exact head projection values/times
  (linear series 10/20/30 → 40/50/60); per-step observation counts +
  last-observed times (staleness inputs); re-replay byte-identical;
  different journals → different digests; tenant/entity/invocation/tampered-
  chain fail-closed; ModelPort seam (version-mismatch fail-closed; a stub
  port with matching version drives real predictions); checkpoint resume at
  EVERY seq boundary byte-identical to the full replay; non-linking suffix
  rejected; foreign-tenant checkpoint rejected; REPLAY marker + runtime guard
  (stripped/foreign/null rejected); A11 compile-pins (replay ↛ journal
  entry / OBSERVED).
- **scoring** (14): exact hit-rate/band/deviation math (integer bps: 2/4
  hits → 5000; mean |dev| 1356 = 10000−8644 calibration); inclusive bounds
  edges; calibration bucket edges at every boundary (exact band placement
  for deviations −8333…+4000 incl. the edge-inclusive ±100/−1000/−5000);
  zero-baseline honesty (null deviation, fallback calibration, honest
  counts); staleness classes (fresh 5000 / stale 0 / unknown 10000;
  degradation 5000; honest nulls; stale-only fallback); fixed-weight
  aggregate (6093 = the documented formula); tenant/now/thresholds/replay
  fail-closed; honest insufficient-evidence with named reasons; mixed
  matched+unscoreable never silent; set aggregation (exact totals,
  order-independence, byte-identical reversed); partial-case-set with named
  unscored + partial aggregate; empty-set/tenant/now degraded states.
- **safety-benchmarks** (11): happy path with evidence per check (15 checked
  points, margin 250 bps ≤ 500 budget, 0 state-authoritative records, 5
  advisory markers, redaction per purpose + cross-tenant rejection);
  battery determinism; the envelope-violating fixture MUST be counted (22
  violations: 5/9/8 by kind); counterfactual margin budget check (steep case
  3333 bps > 500 → named out-of-budget; exact plus/minus/baseline values);
  cannot-write-state positive control (ZERO) + negative controls (forged
  journal entry, marker-stripped prediction, OBSERVED-claiming record,
  world-event record — all counted and named) + module-surface law over all
  five F260B modules; redaction integrity (default policy per purpose, no
  leaks, digest ok, tenant-crossing fail-closed); battery fail-closed
  (tenant/empty/port-version/replay mismatches); `verifySafetyReport` tamper
  detection (check flip, violation-count edit); runtime guard.
- **benchmark-report** (18): full-pipeline assembly (define → set → replay
  → score → safety) with per-case entries + digests; byte-identical
  determinism incl. reversed replay input order; FAILING safety report
  carried honestly (steep per-case violation count 22); all nine report
  rejections exercised (incl. reordered-checks safety-mismatch, wider
  scoring-mismatch, foreign replay-mismatch, now-before-scoring);
  `verifyBenchmarkReport` with full evidence (every boolean true) and without
  (optional checks honestly null); tamper detection (perCase edit, digest
  forgery, caseCount edit, set swap); comparisons (comparisonId via the REAL
  `buildComparison`, ranking/tie-breaks, bestRunId, metric projection for
  all three metrics, determinism, empty/tenant/duplicate/computedAt
  rejections); runtime guards; A11 compile-pins (report ↛ journal entry /
  EXPERIMENTAL run / OBSERVED value).

## 4. Gate outputs (exact)

Run in each package dir of the worktree (per packet §Gates). Root-level
lint/typecheck/build/snapshot were NOT run (packet instruction:
memory-constrained box; TL gates at merge time).

### 4.1 `packages/simulation`

```text
$ corepack pnpm run test
 ✓ tests/benchmark-definition.test.ts (14 tests)
 ✓ tests/benchmark-report.test.ts (18 tests)
 ✓ tests/replay-harness.test.ts (14 tests)
 ✓ tests/safety-benchmarks.test.ts (11 tests)
 ✓ tests/scoring.test.ts (14 tests)
 ✓ tests/kernel.test.ts (10 tests)
 ✓ tests/simulation.test.ts (10 tests)
 Test Files  7 passed (7)
      Tests  91 passed (91)
   Duration  2.24s

$ corepack pnpm run typecheck
> @fleetos/simulation@2.0.0-alpha.0 typecheck
> tsc -p tsconfig.json --noEmit
(exit 0, no output)

$ corepack pnpm run lint        # package script: oxlint src
Found 0 warnings and 0 errors.
Finished in 12ms on 7 files using 2 threads.
```

### 4.2 Lane siblings re-verified AFTER the last edit (untouched by F260B)

```text
packages/predictive     Tests  61 passed (61)
packages/world-model    Tests  42 passed (42)
packages/world-context  Tests  34 passed (34)
packages/integrations/arena  Tests  94 passed (94)
packages/learning       Tests  78 passed (78)
```

## 5. Boundary verification (machine-run)

Imports over exactly the packet's allowed lanes — simulation may import
predictive/world-model/world-context (all worker-b owned, public entry
points only):

```text
$ rg "import .* from ['\"]@fleetos/" packages/simulation/src packages/simulation/tests
@fleetos/predictive | @fleetos/world-model | @fleetos/world-context   (only)
```

No other `@fleetos/*` package appears anywhere in `packages/simulation`
(src or tests). Determinism sweep over `packages/simulation/src`:

```text
$ rg -n "Date\.now|Math\.random|performance\.now|new Date|fetch\(|setInterval|setTimeout" src
CLEAN
```

File-size law: largest new src file 392 lines (`safety-benchmarks.ts`), all
≤ 400.

## 6. Contract deltas + seam findings (for TL adjudication)

The pre-existing simulation surface is preserved — all existing exports
unchanged; Wave 6 additions are ADDITIVE.

1. **`packages/simulation/package.json` gained three intra-lane workspace
   dependencies** (`@fleetos/predictive`, `@fleetos/world-model`,
   `@fleetos/world-context`) — REQUIRED for the packet's REAL-binding imports
   (vitest/tsc resolve through the pnpm workspace links). Running
   `corepack pnpm install` mutated `pnpm-lock.yaml` (+10 lines); per the
   packet the lockfile mutation is NOT committed — the TL must run
   `corepack pnpm install` (or `pnpm install`) after merge to regenerate it.
   This is the same class of expected drift as the snapshot (next item).

2. **`spec/snapshots/fleetos-contracts.json` was NOT regenerated** — the
   packet forbids it. `@fleetos/simulation`'s exports map grew by 5 subpaths
   (`./benchmark-definition`, `./replay-harness`, `./scoring`,
   `./safety-benchmarks`, `./benchmark-report`); `fleetos:snapshot:check`
   will report drift until the TL regenerates at merge. Expected.

3. **Advisory-envelope benchmark semantics**: envelope violations make a
   safety report `passed: false` but do NOT poison the report assembly —
   reports carry failing safety honestly (machine-tested). If the TL prefers
   report assembly to fail-closed on safety failure, it is a one-line change
   at merge; the current reading (evaluation evidence, never operational
   truth) follows A2/A11.

4. **The two ModelPort seams coexist by design** (the F230B note): the replay
   harness + safety battery consume `ModelPort` directly, so Wave-5/F290B
   JEPA-family adapters plug into the benchmarks unchanged.

5. **`fromSeq` semantics fixed this session**: `fromSeq` = the FIRST replayed
   journal seq (1 for a full replay; checkpoint.seq + 1 for a resume), `toSeq`
   = the last replayed seq. Scoring's replay-coverage check depends on
   `fromSeq === 1` for full replays. Informational — recorded because the
   inherited WIP had it wrong.

## 7. Residual limitations (honest list)

1. **FNV-1a 32-bit digests** guard case/set/replay/step/score/safety/report
   digests — deterministic and internally consistent, not cryptographically
   strong (same family as the lane's other packages; tamper-resistance at
   evidence-bundle grade lives in `@fleetos/evidence` with sha-256).
2. **Benchmarks measure the deterministic reference model only** — the
   last-value-anchored least-squares drift model (A12 reference path). The
   harness/scoring/safety battery are model-agnostic through `ModelPort`,
   but no learned-adapter results exist yet to benchmark.
3. **Fixed weights are a documented convention, not a validated metric** —
   hit 5000 / calibration 3000 / staleness 2000 bps; the packet mandates
   fixed deterministic weighting and forbids learned weights, so the choice
   is convention-grade evidence, not a claim of optimality.
4. **Staleness-sensitivity is bounded by the fixture design**: the standard
   journal realizes fresh/stale/unknown classes via journal-time gaps;
   degradation is measured over realized pairs only (unscoreable outcomes
   contribute no pairs — they are named instead).
5. **The cannot-write-state check is structural over emitted outputs** — it
   proves the replay pipeline emits no state-authoritative records and that
   the modules export no state-write functions; it cannot prove the absence
   of writes in a future adapter (port-level law, re-run per benchmark).
6. **Float arithmetic appears in scoring deviations** (division + Math.round
   to integer bps) and in the model's own bounds — IEEE-754 double
   arithmetic is deterministic for these operations; all rates/scores are
   integer bps.
7. **`resumeReplay` trusts the checkpoint object** (same posture as the
   world-model fold — checkpoint authenticity is a persistence-layer
   concern).
8. **No persistence, no daemons, no network** — per packet law, everything
   is pure deterministic TS over immutable values + injected ports; wiring
   is application-owned.

## 8. Cross-worker seam compliance

Per `spec/worker-ownership.yaml` (`cross_worker_imports:
forbidden_in_implementation`):

- `packages/simulation/src` imports ONLY `@fleetos/predictive`,
  `@fleetos/world-model`, `@fleetos/world-context` — all worker-b owned
  (intra-lane), public entry points only (machine-verified §5).
- Test files additionally import from the same three packages at test
  composition sites only (permitted).
- No file outside `packages/simulation/**` and `docs/evidence/F260B/**` was
  modified. `main` untouched.

## 9. Stop-the-line events

None material. The inherited WIP failed 12 tests + 21 typecheck errors at
first run (§ Session note items 1–4) — all root-caused to the WIP defects
described there and fixed (2 src fixes, 1 src hardening, test fixes); after
the fixes every gate is green and re-verified from the final state. One
missing deliverable (`benchmark-report.test.ts`) was written. No reverts of
accepted prior work, no scope drops.

## 10. Verification commands for TL re-run

```bash
git fetch origin work/f260b:work/f260b
git checkout work/f260b
corepack pnpm install          # REQUIRED: regenerates pnpm-lock.yaml
                               # (workspace deps added; lockfile NOT committed)
(cd packages/simulation    && corepack pnpm run test)        # expect 91/91
(cd packages/predictive    && corepack pnpm run test)       # expect 61/61
(cd packages/world-model   && corepack pnpm run test)       # expect 42/42
(cd packages/world-context && corepack pnpm run test)       # expect 34/34
(cd packages/integrations/arena && corepack pnpm run test)  # expect 94/94
(cd packages/learning      && corepack pnpm run test)       # expect 78/78
(cd packages/simulation    && corepack pnpm run typecheck)  # expect exit 0
(cd packages/simulation    && corepack pnpm run lint)      # expect 0w/0e
# boundary self-check (expect only predictive/world-model/world-context):
grep -rEn "import .* from ['\"]@fleetos/" packages/simulation/src | grep -vE "predictive|world-model|world-context" || echo CLEAN
# TL merge-time gates (NOT run in the worktree per packet):
pnpm fleetos:snapshot && pnpm fleetos:snapshot:check
pnpm lint && pnpm typecheck && pnpm architecture:check && pnpm fleetos:source-of-truth
```
