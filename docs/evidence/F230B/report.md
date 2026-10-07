# F230B — Worker B (Safety + Intelligence) Wave 3 Completion Evidence

- **Work item:** F230B — Predictive Twin + World Model (Wave 3 lane B)
- **Owner:** Worker B (Safety + Intelligence)
- **Base commit:** `bb4ee6e` (branch `work/f230b`, the TL's Wave-3 dispatch commit)
- **Branch:** `work/f230b`
- **Date:** 2026-10-07
- **Session note:** single agent session (Task `6-a`, agent `fleetos-worker-b-w3`).
  Everything below was implemented, run and verified in this session. Nothing
  was claimed that was not run (HONESTY LAW).

## 1. Owned paths touched

Per `spec/worker-ownership.yaml` (worker-b), the F230B-relevant owned paths:

- `packages/predictive/**`
- `packages/world-model/**`
- `packages/world-context/**`
- `docs/evidence/F230B/**` (this report)

No file outside the above paths was modified. `pnpm-lock.yaml` is NOT dirty
(no dependency changes were made — only `exports` map additions, which do not
touch the lockfile) and is NOT committed. 12 files changed (6 modified
additively, 6 new), `+2551` lines in the six new files plus small additive
edits to the three `src/index.ts` re-export tails and three `package.json`
exports maps:

```text
packages/predictive/src/reference-model.ts            (new, 641 lines)
packages/predictive/tests/reference-model.test.ts     (new, 424 lines)
packages/world-model/src/world-fold.ts                (new, 547 lines)
packages/world-model/tests/world-fold.test.ts         (new, 441 lines)
packages/world-context/src/assembly.ts                (new, 261 lines)
packages/world-context/tests/assembly.test.ts         (new, 237 lines)
packages/predictive/{src/index.ts,package.json}       (modified, additive: re-export + exports entry)
packages/world-model/{src/index.ts,package.json}      (modified, additive: re-export + exports entry + predictive type re-exports)
packages/world-context/{src/index.ts,package.json}    (modified, additive: re-export + exports entry)
```

All pre-existing exports are unchanged — Wave 3 additions are ADDITIVE only.

## 2. What was delivered

### 2.1 `packages/predictive` — the deterministic reference twin model

New module `src/reference-model.ts` (exported as `./reference-model` and
through the package root):

- **Reference projection model** — `projectReferenceTwin(twinState, horizon)`:
  a pure function projecting a twin state (structurally-typed
  `TwinStateInput`: tenant/asset/metric + observation history + integer-ms
  `asOfMs`) forward over an integer `ProjectionHorizon` (`steps` x `stepMs`).
  Deterministic math: last-value anchor + least-squares drift; bounds widen
  with `sqrt(step)`; integer-bps confidence decays with the horizon. No clock,
  no randomness, no I/O. (The packet's "seeded LCG keyed by input digest"
  allowance was NOT needed — the drift model requires no pseudo-randomness;
  noted honestly rather than adding an unused generator.)
- **Provenance** — every `Prediction` carries `PredictionProvenance`:
  `observationRefs` (every input observation id, law A3), `modelVersion`
  (`REFERENCE_MODEL_VERSION`), `method`, and an `inputDigest` (FNV-1a over a
  versioned canonical serialization of the full input incl. horizon) —
  predictions are replayable and auditable (same input => same digest =>
  same prediction).
- **Uncertainty** — `ProjectedPoint.bounds` (float bounds rounded to 1e-6,
  floor half-width 0.5) + `confidenceBps` (INTEGER basis points 0..10000,
  count-scaled base, 250 bps/step decay, floor 500). All float use
  (division for the drift, `Math.sqrt` for widening) is documented at its
  site and rounded to fixed decimal scales.
- **Counterfactuals** — `runReferenceCounterfactual(CounterfactualInput)`:
  structured what-if interventions (`offset` / `scale` / `hold` / `set-drift`
  / `truncate-history`) over a baseline history produce a
  `HypotheticalProjection` with full **divergence accounting**
  (`DivergenceEntry[]`: baseline value, counterfactual value, `delta`,
  integer `deltaBpsOfBaseline` — null when baseline is 0 — plus
  `changedSteps`). Law A11 enforced structurally: the result is
  `kind: "HYPOTHETICAL"` + machine-carried `hypothetical: true`, its bounds
  are 2x-widened and its confidence halved (integer floor) vs the baseline at
  every step.
- **Advisory envelope** — `Prediction` carries `kind: "PREDICTION"` +
  machine-carried `advisory: true`; `TwinStateInput` (the authoritative side)
  requires an observation history with observation refs, so advisory values
  can never be fed back as authoritative state — enforced by type shape and
  machine-tested with `@ts-expect-error` assignments plus the
  `isAdvisoryPrediction` runtime guard (verifies the marker survives
  untrusted JSON; rejects stripped copies).
- **Model adapter seam** — `ModelPort` TYPE (`name` / `modelVersion` /
  `project` / `runCounterfactual`) with the in-memory deterministic reference
  adapter `makeReferenceModelPort()` implementing it; the reference model
  itself sits behind the port. A test-local stub port proves the seam is
  structural (Wave 5 / F290B JEPA-family adapters plug in here without
  touching callers).

Honest rejections (`ProjectionRejection`, each code test-covered):
`missing-tenant`, `empty-history`, `invalid-observation-ref`,
`non-monotonic-times`, `invalid-horizon`, `horizon-too-large`
(`MAX_PROJECTION_STEPS = 1000`), `unknown-intervention`,
`invalid-intervention`.

### 2.2 `packages/world-model` — the deterministic world state model

New module `src/world-fold.ts` (exported as `./world-fold` and through the
package root), mirroring the journal-fold pattern from `packages/mission`
(read as the exemplar per the packet):

- **World state fold** — world state is a PURE FOLD over an append-only,
  digest-CHAINED world-event journal (`WorldJournalEntry` with `seq` /
  `digest` / `prevDigest`, genesis digest per tenant,
  `nextWorldEntry` builder, `worldEntryDigest`). `foldWorldState` sorts by
  seq (input order is irrelevant — machine-tested), validates seq
  contiguity, single-tenancy and the digest chain, and folds
  `entity-registered` / `observation-recorded` / `entity-tagged` /
  `entity-retired` events into a `WorldStateView` (entities sorted by
  entityId, deterministic). Rejections: `mixed-tenant`, `seq-gap`,
  `bad-digest`, `invalid-event-payload` — all test-covered, including
  tampered digests and broken chain links.
- **Checkpoint support** — `checkpointWorld(entries, uptoSeq)` folds a
  prefix into a `WorldCheckpoint` (`seq`, folded `state`, `stateDigest`,
  `lastEntryDigest`); `resumeWorld(checkpoint, suffix)` continues the fold
  over a suffix WITHOUT re-folding the prefix, rejecting
  `suffix-seq-mismatch`, `suffix-tenant-mismatch`, `bad-digest`,
  `invalid-event-payload`. Machine-tested: checkpoint+resume === full fold,
  and the checkpoint state is never mutated by resuming.
- **Entity projections** — `WorldEntityView` (assets/agents/orgs as OPAQUE
  refs: entityId + entityType only, never domain truth) with
  last-observation-driven state, observation log, tags, lifecycle;
  `classifyStaleness` + `projectEntity` classify `fresh` / `stale` /
  `unknown` by INTEGER-ms age thresholds (never-observed => unknown; age
  beyond the staleness window => unknown), rejecting `invalid-thresholds`
  (non-integer, negative, inverted).
- **Predictive integration** — TYPE-ONLY imports from
  `@fleetos/predictive` (the established intra-lane seam):
  `askWorldProjection` maps a world entity's observation log into a
  `TwinStateInput` and hands it to a caller-supplied `ModelPort`. The
  advisory law is structural: the result carries `advisory: true`, and
  machine-tested `@ts-expect-error` proofs show a `Prediction` can never
  become a `WorldEvent` (never enters the journal) nor a `TwinStateInput`.

### 2.3 `packages/world-context` — tenant-scoped context assembly

New module `src/assembly.ts` (exported as `./assembly` and through the
package root):

- **Context assembly** — `assembleContext({ focus, rules?, computedAt })`:
  given a world-state slice (LOCAL structural `WorldEntitySnapshot` shapes —
  this package imports NO `@fleetos/*` package, per the lane's
  self-containment rule) + a query focus (tenant, entity refs, purpose),
  assembles an `AssembledContext`: a namespaced feature snapshot
  (`${entityId}#${field}`), per-entity provenance refs (observationRef /
  observedAtMs, null-honest when never observed), the applied redact-list,
  and an audit digest. Deterministic: entities are folded in entityId order
  (input order irrelevant — machine-tested), fields in sorted key order,
  `computedAt` is caller-supplied.
- **Privacy enforcement (tenant/privacy law)** — assembly is TENANT
  FAIL-CLOSED: `missing-tenant` (empty focus tenant), `no-entities`,
  `cross-tenant-ref` (any snapshot from another tenant is rejected with a
  detail naming the offending entity — never silently filtered),
  `unknown-purpose` (no rule covers the purpose). Every code test-covered.
- **Field-level redaction** — DECLARATIVE redact-list per purpose
  (`RedactionRule[]`, with `DEFAULT_REDACTION_RULES` as the reference
  policy): redacted fields are replaced with the `"[REDACTED]"` sentinel and
  their names recorded in `redactedFields` (what was hidden is visible; the
  value never leaks — machine-tested via JSON serialization). Duplicate
  rules for a purpose union their redact-lists deterministically.
- **Context digests** — every assembled context is digest-stamped (FNV-1a
  over a versioned canonical serialization of the assembled/redacted
  content); `verifyAssembledContextDigest` recomputes for audit and detects
  tampering with features, redacted lists, provenance, tenant, purpose or
  computedAt (all machine-tested).

## 3. Tests

Baseline (TL-measured, re-verified at dispatch in this session): predictive
32, world-model 19, world-context 19 — 70 total, all green before any edit.

After F230B (all run, all green):

```text
packages/predictive    32 -> 61   (+29 net-new)
packages/world-model   19 -> 42   (+23 net-new)
packages/world-context 19 -> 34   (+15 net-new)
lane total             70 -> 137  (+67 net-new; packet target >= 45)
```

### Test themes covered (meaningful, not shape-only)

- **predictive**: determinism (byte-identical repeat runs); exact drift math
  (linear history => exact projected values/atMs/steps); single-observation
  flat projection; bounds widen monotonically + exact step-1 bounds;
  integer-bps confidence in [0,10000] decaying monotonically with exact
  base; provenance refs in order, model version/method, inputDigest
  replay-stable and horizon-sensitive; advisory markers + runtime guard
  (stripped copies rejected); compile-time advisory law (`@ts-expect-error`:
  Prediction ↛ TwinStateInput / ObservedValue); ALL 8 rejection codes incl.
  duplicate/decreasing atMs, fractional/zero steps and stepMs, steps >
  MAX_PROJECTION_STEPS; ModelPort seam (reference adapter determinism +
  custom stub port satisfying the TYPE); counterfactuals: exact offset/scale/
  hold/set-drift/truncate-history values, exact deltas + integer bps,
  changedSteps, no-op divergence (empty), deltaBps null at zero baseline,
  A11 widened bounds + halved confidence at every step, baselineProvenance
  linkage, unknown/invalid interventions, baseline-rejection propagation.
- **world-model**: fold determinism (twice + reversed input); entity
  registration/observations/tags-dedupe/retire semantics incl. the
  mechanical "observation after retire" case and unknown-entity
  auto-registration; idempotent re-registration; ALL 4 fold rejections
  (mixed-tenant via a chained foreign entry, seq gap + duplicate seq,
  tampered digest, broken prevDigest link, malformed payloads: empty
  observationRef / empty tag); nextWorldEntry chain + determinism; genesis
  digest per tenant; staleness fresh/stale/unknown/never-observed +
  invalid-thresholds (non-integer/negative/inverted); projectEntity staleness
  + ageMs + rejection propagation; checkpoint == prefix fold, deterministic
  stateDigest, invalid-checkpoint-seq; resume == full fold (twice — purity),
  suffix-seq-mismatch / suffix-tenant-mismatch / bad-digest; predictive
  integration through the real reference port (exact values, advisory
  marker, provenance refs), empty-history + missing-tenant honest
  rejections, compile-time advisory law (`@ts-expect-error`: Prediction ↛
  WorldEvent / TwinStateInput).
- **world-context**: namespaced features + provenance refs + digest shape +
  schemaVersion guard; determinism (identical inputs, reversed entity
  order); default redact-list for security-review (values replaced, names
  recorded, values ABSENT from the serialized context) and the narrower
  operational-monitoring rule; caller-supplied rules replacing defaults;
  duplicate-rule union; all 4 purposes covered by defaults; ALL 4 rejection
  codes (missing-tenant, no-entities, cross-tenant-ref with offender named
  in the detail, unknown-purpose); digest verification (untampered ok;
  tampered feature / redacted list / provenance / tenant all detected);
  purpose-sensitive digests.

## 4. Gate outputs (exact)

Per packet §Gates — run in each package dir of the worktree. Root-level
lint/typecheck/build/snapshot were NOT run (packet instruction:
memory-constrained box; TL gates at merge time).

### 4.1 `packages/predictive`

```text
$ corepack pnpm run test
 ✓ tests/reference-model.test.ts (29 tests) 11ms
 ✓ tests/kernel.test.ts (20 tests) 7ms
 ✓ tests/predictive.test.ts (12 tests) 6ms
 Test Files  3 passed (3)
      Tests  61 passed (61)

$ corepack pnpm run typecheck
> @fleetos/predictive@2.0.0-alpha.0 typecheck
> tsc -p tsconfig.json --noEmit
(exit 0, no output)
```

### 4.2 `packages/world-model`

```text
$ corepack pnpm run test
 ✓ tests/world-fold.test.ts (23 tests) 13ms
 ✓ tests/world-model.test.ts (11 tests) 5ms
 ✓ tests/kernel.test.ts (8 tests) 4ms
 Test Files  3 passed (3)
      Tests  42 passed (42)

$ corepack pnpm run typecheck
> @fleetos/world-model@2.0.0-alpha.0 typecheck
> tsc -p tsconfig.json --noEmit
(exit 0, no output)
```

### 4.3 `packages/world-context`

```text
$ corepack pnpm run test
 ✓ tests/assembly.test.ts (15 tests) 6ms
 ✓ tests/kernel.test.ts (10 tests) 5ms
 ✓ tests/projections.test.ts (9 tests) 4ms
 Test Files  3 passed (3)
      Tests  34 passed (34)

$ corepack pnpm run typecheck
> @fleetos/world-context@2.0.0-alpha.0 typecheck
> tsc -p tsconfig.json --noEmit
(exit 0, no output)
```

## 5. Boundary verification (machine-tested)

The packet's self-check (run with `rg`, the sandbox's grep-equivalent, over
exactly the packet's three package `src` trees):

```text
$ rg "import .* from ['\"]@fleetos/" packages/predictive/src packages/world-model/src packages/world-context/src | rg -v "@fleetos/predictive" || echo CLEAN
CLEAN
```

The only `@fleetos/*` imports in the lane's `src` are the permitted
intra-lane TYPE-ONLY `@fleetos/predictive` imports, both in
`packages/world-model` (the pre-existing `src/index.ts` seam, plus the new
`src/world-fold.ts`):

```text
packages/world-model/src/index.ts:     import type { ... } from "@fleetos/predictive"
packages/world-model/src/world-fold.ts: import type { ... } from "@fleetos/predictive"
```

`packages/predictive/src` and `packages/world-context/src` import NO
`@fleetos/*` package at all. The world-model TESTS import
`makeReferenceModelPort` (a runtime value) from `@fleetos/predictive` at the
test composition site only — permitted (intra-lane; test composition sites
may bind real implementations per `spec/worker-ownership.yaml`).

Determinism sweep (run over all three packages' `src`):

```text
$ rg -n "Date\.now|Math\.random|performance\.now|fetch\(|setInterval|setTimeout" packages/{predictive,world-model,world-context}/src
packages/predictive/src/reference-model.ts:21:  * GPU, no provider, no I/O, no wall clock, no Math.random.   # doc comment only
(no other matches)
```

`new Date(...)` appears only in the PRE-EXISTING Wave-1 file
`packages/world-context/src/windowing.ts` (lines 116–117: parses two
caller-supplied timestamp strings for horizon maturity — deterministic, no
wall clock; NOT touched by F230B, empty diff vs base `bb4ee6e`). No wall
clock, no randomness, no network, no timers, no new runtime deps anywhere in
F230B code.

## 6. Contract deltas requested (for TL adjudication)

**The pre-existing contract surface is preserved — all existing exports
unchanged. All Wave 3 additions are ADDITIVE.** The three `exports` maps
gained:

- `@fleetos/predictive`: `+ ./reference-model`
- `@fleetos/world-model`: `+ ./world-fold`
- `@fleetos/world-context`: `+ ./assembly`

1. **`spec/snapshots/fleetos-contracts.json` was NOT regenerated** — the
   packet forbids it (TL gate at merge time). The exported surface grew by
   the 3 new module exports above; `fleetos:snapshot:check` will report
   drift until the TL regenerates at merge. Expected, not an error.

2. **Two adapter seams now coexist in the lane**: the pre-existing
   `WorldModelAdapter` (world-model Wave 1: represent/predict/counterfactual
   over `WorldModelRepresentation`) and the new `ModelPort` (predictive
   F230B: project/runCounterfactual over `TwinStateInput`, the seam the
   packet specified for the Wave-5/F290B JEPA family). Both are additive and
   independent. TL adjudication candidate: converge or formally bless both
   (I did NOT touch `WorldModelAdapter` — additive-only rule).

3. **`packages/world-model/src/index.ts` re-exports additional
   `@fleetos/predictive` types** (`ModelPort`, `Prediction`,
   `TwinStateInput`, `ProjectionHorizon`, `ProjectionResult`) so consumers
   of the world-model root need no direct predictive import. Additive;
   follows the file's pre-existing re-export pattern.

4. **world-context consumes world state as LOCAL structural shapes**
   (`WorldEntitySnapshot`) rather than importing `@fleetos/world-model`
   types — the packet permits only `@fleetos/predictive` intra-lane imports
   and world-context has no workspace dependency on any @fleetos package
   (adding one would have required a lockfile touch, which is forbidden).
   Mapping folded `WorldStateView` entities → snapshots is a composition
   step the TL owns at integration time. The shapes are structurally
   compatible by design.

5. **Staleness semantics choice**: `classifyStaleness` returns `"unknown"`
   both for never-observed entities AND for ages beyond the staleness
   window (data too old to trust). The three-class model
   (fresh/stale/unknown) with beyond-window => unknown is documented in the
   module; if the TL prefers a fourth class ("expired"), it is a one-line
   union extension at merge time.

6. **Canonical digest serializations are version-prefixed** (`v1|`, `ctx|v1`,
   `world|`, `world-genesis|`) so future shape changes can bump the prefix
   without silent digest collisions. Informational.

## 7. Residual limitations (honest list)

1. **The reference model is deliberately simple** — last-value-anchored
   least-squares drift with sqrt-widening bounds. It is the A12
   deterministic reference path, not a learned model; seasonal/multi-metric
   interactions are out of scope until real adapters arrive via `ModelPort`
   (Wave 5 / F290B). The packet's seeded-LCG allowance was not needed and
   was not added (no unused surface).

2. **Float use is bounded but real**: the drift (division), bound widening
   (`Math.sqrt`) and divergence bps (division + `Math.round`) use float
   arithmetic rounded to fixed decimal scales (1e-6 values/bounds, 1e-9
   drift, integer bps). IEEE-754 double arithmetic is deterministic for
   these operations; the rounding guards output stability. All confidences
   are integer bps per the packet.

3. **FNV-1a 32-bit digests** guard provenance input digests, the world
   journal chain, checkpoint state digests and context audit digests —
   deterministic and internally consistent, but not
   cryptographically strong (same family as the lane's Wave-1/2 packages;
   tamper-resistance at evidence-bundle grade lives in `@fleetos/evidence`
   with sha-256).

4. **Pre-existing `new Date(...)` in
   `packages/world-context/src/windowing.ts`** (Wave 1 baseline; parses
   caller-supplied strings — no wall clock). Present at base `bb4ee6e`,
   NOT touched by F230B (empty diff vs base).

5. **The world fold is mechanical** — legality beyond payload shape (e.g.
   whether an observation MAY be recorded for a retired entity) is
   append-side responsibility; the fold records what the journal says.
   `nextWorldEntry` does not validate payloads (it is a builder; the fold
   validates). Documented in the module header.

6. **`resumeWorld` trusts the checkpoint object** — a forged checkpoint
   (hand-built state + matching `lastEntryDigest`) would resume cleanly;
   checkpoint authenticity is a persistence-layer concern (out of scope for
   pure values; the same posture as the mission journal's replay trust
   model).

7. **Redaction defaults are a reference policy** (`DEFAULT_REDACTION_RULES`)
   — production field-level privacy policy belongs to the policy/Guardian
   lane; assembly applies caller-supplied rules deterministically and never
   invents rules.

8. **No persistence, no daemons, no network** — per packet law, all three
   modules are pure deterministic TS over immutable values + injected
   ports. Wiring (journal store, model adapters, assembly call sites) is
   application-owned.

9. **Root-level gates not run here** (packet instruction): root
   lint/typecheck/build, `architecture:check`, `source-of-truth`,
   `snapshot:check` are TL merge-time gates. Lane-local `oxlint` was also
   not run (packet gates list only test + typecheck per package; both green
   above).

## 8. Cross-worker seam compliance

Per `spec/worker-ownership.yaml` (`cross_worker_imports:
forbidden_in_implementation`) and the packet's boundary rule:

- **No cross-lane `@fleetos/*` imports** — machine-verified CLEAN (§5).
- **Intra-lane imports are type-only `@fleetos/predictive`** in world-model
  `src` (the packet's explicit allowance; the pre-existing seam plus
  `world-fold.ts`).
- **predictive and world-context import NO `@fleetos/*` package at all.**
- Cross-context concepts remain LOCAL structural interfaces (opaque entity
  refs, integer-ms times, string digests) — the Wave 0/1 pattern.
- Nothing under `packages/mission` (the fold exemplar) was modified — only
  read.

## 9. Stop-the-line events

None material. One test failed during development
(`world-fold.test.ts` "rejects mixed-tenant journals"): the test's foreign
entry was constructed with a duplicate `seq`, so the fold correctly reported
`seq-gap` before reaching the tenant check. Fixed by rebuilding the test
fixture as a properly-chained seq-9 entry stamped with tenant `t2` — a test
construction fix, not a production-code change. No reverts, no scope drops,
no failed gate after that point.

## 10. Verification commands for TL re-run

```bash
git fetch origin work/f230b:work/f230b
git checkout work/f230b
corepack pnpm install                             # if needed; lockfile unchanged by this branch
(cd packages/predictive     && corepack pnpm run test)  # expect 61/61
(cd packages/world-model    && corepack pnpm run test)  # expect 42/42
(cd packages/world-context  && corepack pnpm run test)  # expect 34/34
# lane total: 137/137 (70 baseline + 67 net-new)
(cd packages/predictive     && corepack pnpm run typecheck)  # expect exit 0
(cd packages/world-model    && corepack pnpm run typecheck)  # expect exit 0
(cd packages/world-context  && corepack pnpm run typecheck)  # expect exit 0
# boundary self-check (expect CLEAN):
grep -rEn "import .* from ['\"]@fleetos/" packages/{predictive,world-model,world-context}/src | grep -v "@fleetos/predictive" || echo CLEAN
# TL merge-time gates (NOT run in the worktree per packet):
pnpm fleetos:snapshot      # regenerate — 3 new export subpaths (see §6.1)
pnpm fleetos:snapshot:check
pnpm lint && pnpm typecheck && pnpm architecture:check && pnpm fleetos:source-of-truth
```
