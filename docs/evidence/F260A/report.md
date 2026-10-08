# F260A — Worker A (Edge + Asset) Simulation Worlds Lane Completion Evidence

- **Work item:** F260A — operational simulation worlds, deterministic fleet world engine (Wave 6 lane A)
- **Owner:** Worker A (edge-and-asset)
- **Base commit:** `987954f` (TL dispatch: Wave 6 packets; main = `e175f54`, Wave 5 complete, 3371 tests at dispatch)
- **Branch:** `work/f260a` (worktree `/home/z/w-f260a`)
- **Date:** 2026-10-09

## 1. Owned paths touched

Per `spec/worker-ownership.yaml` (worker-a, NEW GRANT `packages/sim-worlds/**`):

- `packages/sim-worlds/**` — NEW package `@fleetos/sim-worlds` (private, Apache-2.0, type: module,
  exports map `.` + one subpath per deliverable): `src/determinism.ts`, `src/world-definition.ts`,
  `src/world-journal.ts`, `src/world-engine.ts`, `src/fault-injection.ts`,
  `src/simulation-adapter.ts`, `src/index.ts` + 5 test files + tests/helpers.ts
- `docs/evidence/F260A/**` (granted carve-out)

`git status` shows exactly `packages/sim-worlds/` (new) + `pnpm-lock.yaml` (filtered-install mutation,
left UNCOMMITTED per packet). No pnpm-workspace.yaml mutation, no spec edits, no snapshot regen,
`packages/simulation/**` untouched (verified: its suite still passes untouched, §2), `main` untouched.

## 2. Baselines — machine-run BEFORE first edit, re-verified AFTER last edit

All nine lane packages at clean HEAD `987954f`, before any edit and again after the last edit
(identical counts — pre-existing suites untouched and green):

```text
identity 3 files/89 tests   tenancy 3/67    assets 3/99     observations 4/134
health 4/89                 recovery 3/60   maintenance 3/69
connectivity 7/120          integrations/adcos 8/143        (lane total 870)
simulation (B-owned interop dep, untouched): 2 files/20 tests
```

## 3. Deliverables (all pure deterministic TS; logical `now` + caller-supplied inputs everywhere)

### 3.1 `src/determinism.ts` (185 lines) — the entropy source

Counter-mode FNV-1a: `randomFromSeed(seed)` is a pure function of the address string
(FNV-1a hash → splitmix32 finalizer avalanche → uniform [0,1)); `nextRandom(state)` threads a
`(seed, counter)` state; derived samplers `bernoulliFromBps` (integer bps, out-of-bounds REFUSED),
`pickWeighted` (empty/negative/zero-total refused), `jitterInBounds` (integer offsets, inverted
bounds refused). Also carries the lane's FNV-1a digest convention as a LOCAL copy (`fnv1a32` over
unit-separator-joined parts + `canonicalJson`) — cross-owner import of tower-core is forbidden.
NO `Math.random`, NO `Date.now` — the counter-mode design is what makes checkpointed runs
byte-identical: a draw can be re-derived from WHERE it happened, never from hidden state.

### 3.2 `src/world-definition.ts` (315 lines) — the fleet world

`FleetWorld`: assets (id, class, `failureRateBps` — integer bps per logical step),
devices (per-asset binding, `dropoutBps`, `emitEverySteps`, jittered observation streams with
kind/unit/base/offsets — shaped like the observations lane's admission inputs as LOCAL structural
types), links (endpoints, `uptimeBps`), maintenance policies (window every/length, service level
basic|standard|expedited → repair steps 3|2|1, `mtbfSteps` preventive scheduling), initial health
postures (healthy|degraded start operational; critical|down start failed), world health policy
(down-after-steps, recovery-grace-steps), `seed` + `timeUnitMs`. `worldDigest` = FNV-1a over
canonical JSON (+`verifyWorldDigest`). `validateWorld` is fail-closed with 30+ reason codes:
missing tenant/worldId/seed refused; ALL bps rates must be integers in [1,10000] (zero/negative/
over-basis REFUSED); windows validated (length ≤ every, ≥1); references must resolve (device→asset,
link endpoints, posture/policy assets); one policy per asset; arrays must be id-SORTED
(`non-deterministic-*-order` — the digest is canonical by construction).

### 3.3 `src/world-journal.ts` (366) + `src/world-engine.ts` (297) — the step engine

Split out of one deliverable file to respect the 400-line law. The journal: 11 typed event kinds
(step-advanced, link-up/down, asset-failed, posture-changed, device-up/down, observation-emitted,
maintenance-due/started/completed/skipped), strictly increasing `seq`, CHAINED digests (each digest
covers the previous digest + the full event identity — tamper-evident); state is a PURE FOLD over
(world genesis, events) — every runtime field is written by some event; checkpoints
(`checkpointWorldRun`/`resumeWorldRun`) fold the suffix only. `verifyWorldJournal` replays seq order,
step discipline (exactly one marker per step, events carry the current step), target existence and
the digest chain. The engine advances N steps, per step in fixed order: links (uptime draws,
scenario outage windows override) → asset failures (rate draws, scenario faults override; assets in
service cannot fail) → maintenance (completions at `start+repairSteps`, MTBF preventive due at
`step - lastService ≥ mtbfSteps`, window opens at `step % every < length`, corrective before
preventive, skip faults defer to the next window) → devices (desired up = operational ∧ not in
service; transient dropout draws) → postures (in-service→degraded; failed→critical then down after
`downAfterSteps`; repair grace→degraded; dropout→degraded) → observations (per stream, on
`step % emitEverySteps === 0`, `observedAt = step × timeUnitMs`, per-device monotonic
`observationSeq`, payload digest). `advanceWorldSteps` validates the world + scenario + state
identity (world/tenant fail-closed) before stepping.

### 3.4 `src/fault-injection.ts` (186 lines) — scripted faults

`FaultScenario` (scenarioId, worldId, tenantId, faults): asset-failure at an exact step,
link-outage over [fromStep, untilStep), maintenance-skip at an exact step. Scenario digest + verify;
`validateFaultScenario` refuses cross-tenant (`tenant-mismatch`) and cross-world (`world-id-mismatch`)
application, unknown assets/links, bad steps/windows, unsorted faults (ordered by
(atStep, kind, target)) and duplicates. `scenarioAppliesTo` is the fail-closed gate the engine AND
adapter consult before every application.

### 3.5 `src/simulation-adapter.ts` (193 lines) — the kernel bridge

`toSimulationWorld` (world → `SimulationWorld`, canonical initialState) + `toSimulationScenario`
(one `SimulationStep` per logical step, fault kinds carried in step inputs) map onto the EXISTING
`@fleetos/simulation` public entry; `runFleetWorldSimulation` runs the engine through
`runSimulation` → `ExperimentalRunOutput<FleetWorldRunSummary>` where the summary carries
`evidenceKind: "EXPERIMENTAL"`, the world digest + scenario digest, event counts by kind and the
final runtime snapshot. A5 law: NO adopt/execute/activate/install/selfAdopt export exists
(kernel-`assertNoAdoptFunction`-checked in tests); adoption stays in @fleetos/simulation's
proposal path. A11 law: outputs are experimental evidence only, never operational truth.

## 4. Tests (5 files, 84 net-new — packet floor ≥ 50)

| File | Tests | Themes |
| --- | --- | --- |
| `determinism.test.ts` | 18 | same seed → byte-identical sequences (lengths 1..1000); purity (saved-state replay); [0,1) bounds; address decorrelation; bps certainty/impossibility; out-of-bounds refusals; 3000bps within statistical bounds (2000 draws); weighted picks + refusals; jitter bounds + refusals |
| `world-definition.test.ts` | 16 | digest stability + canonical key-order independence + tamper (any field); valid accept; missing tenant/worldId/seed/version/timeUnit; zero/negative/over-bounds failure rates refused with codes; dropout/uptime bounds; empty-assets; unknown refs (device/link/posture); unsorted arrays; duplicates (asset/policy-asset); window/mtbf/emit/health-policy bounds |
| `world-engine.test.ts` | 25 | byte-identical journals at lengths 1/7/50; different seed differs; resumed runs == full run (split points 5+7/3+9/11+1); fold == engine state; checkpoint+suffix resume; out-of-order fold ignored; journal verify clean / seq-gap / tampered field; one marker per step + strict seq; 10000bps fails at step 1 and stays failed; posture trajectory critical→down; links 10000bps never drop / 3000bps transitions in bounds; fail+repair cycles recur; observation shapes (observedAt, bounds, monotonic seq, emitEverySteps, service suppression); 10000bps dropout (device down, no observations, degraded posture); MTBF preventive due→started→completed at exact steps; out-of-service posture/device events; service level → repair steps; corrective lifecycle at next window; invalid world/steps/state-world/state-tenant/cross-tenant-scenario refusals |
| `fault-injection.test.ts` | 13 | scenario digest stability + tamper; world-id/tenant refusals; scenarioAppliesTo gate; unknown asset/link; invalid step/window; unsorted + duplicate faults; injected failure fires at exactly its step; link outage exact window + helper agreement; maintenance-skip defers repair to the next window (exact lifecycle); same scenario twice identical journals; lookup helpers exact |
| `simulation-adapter.test.ts` | 12 | SimulationWorld mapping; SimulationScenario step/fault mapping; ExperimentalRunOutput carries kind EXPERIMENTAL + both digests + runId + deterministic flag; summary facts; byte-identical replay; caller-supplied logical timestamps; refusals (invalid world / cross-tenant / cross-world / invalid scenario / bad steps); steps=0 no-op; A5 no-adopt self-check via kernel `assertNoAdoptFunction` |

## 5. Exact gate outputs (package dir, per packet)

```text
corepack pnpm run test        → Test Files 5 passed (5) / Tests 84 passed (84)
corepack pnpm run typecheck   → exit code 0 (no diagnostics)
corepack pnpm run lint        → Found 0 warnings and 0 errors (13 files)
```

Determinism sweep (ripgrep): no `Date.now` / `Math.random` / `setTimeout` / `setInterval` /
`fetch(` / `new Date` / `performance.now` in src or tests (matches were doc-comment mentions only).
Line-count law: max src file 366 lines ≤ 400 (all others ≤ 315). `corepack pnpm install --filter
@fleetos/sim-worlds --prefer-offline --ignore-scripts` run once; pnpm-lock.yaml mutation left
uncommitted. Workspace deps: `@fleetos/simulation` only (own-lane structural mirrors need no
runtime imports).

## 6. Contract deltas + seam findings for TL adjudication

- **S1 — FNV-1a digest convention duplication:** `fnv1a32`/`canonicalJson` are LOCAL copies of the
  control-tower lane convention (TL-owned; cross-owner imports forbidden). Same as F250A's
  structural-mirror pattern; hoisting to a shared digest contract is a TL decision.
- **S2 — lane input shapes are structural mirrors:** observation streams mirror
  `AdmissionInput`/`ObservationLike` (tenant/device/seq/observedAt/kind/digest), postures mirror the
  health severity vocabulary, maintenance windows/MTBF mirror the maintenance `Schedule` concepts —
  LOCAL structural types only (packet-sanctioned); symbol-level equivalence is TL test-time
  composition, not done here.
- **S3 — rate-parameter law reading:** "zero/negative rates refused" is applied to ALL bps rates
  (failure, dropout, uptime must be integers in [1,10000]) — a perfectly-reliable device is not
  expressible (minimum 1 bp). If the TL wants 0 allowed for non-hazard rates (dropout/uptime),
  it is a one-line validation split.
- **S4 — maintenance-skip granularity:** a skip fault cancels the start due at exactly its step;
  a multi-step window can still start service on its LATER steps (a full-window skip needs one
  fault per step). Tested; alternative semantics (skip consumes the window) is a one-line change.
- **S5 — draw addressing:** every draw is keyed `(seed, step, domain, entityId)` — entity-keyed,
  not array-indexed, so adding/removing an entity does not shift other entities' draws; changing
  the world seed or any entity id changes trajectories (the seed is part of the world digest).
- **S6 — kernel `SimulationStep.expected` unused:** the adapter maps one kernel step per logical
  step with `expected: null` (expected-value assertions would be a B-side kernel extension).
- **S7 — link model:** `uptimeBps` is per-step independent Bernoulli availability (no persistence
  hysteresis); a Markov stay-up/stay-down model would need extra world parameters — flagged, not
  invented.
- **S8 — preventive MTBF clock:** any completed service (corrective included) resets the
  steps-since-service counter — documented semantics; a corrective-only clock is a one-line change.

## 7. Honest residuals

- All state is caller-threaded pure values; no persistence, no runtime wiring — binding worlds to
  stores/real telemetry and scheduling runs is TL composition.
- Rate-driven count tests assert SEEDED BOUNDS (statistical windows), not hand-derived exact
  sequences; determinism itself is byte-exact and machine-tested. Exact-step tests use
  construction-forced outcomes (10000 bps rates, injected faults).
- `verifyWorldJournal` replays ordering/step/target discipline + the digest chain; full
  re-derivation (genesis+fold == engine state) is a separate tested property, not part of verify.
- Posture vocabulary (`healthy|degraded|critical|down`) is a local extension of the health lane's
  severity vocabulary with operational states; convergence is TL.
- The simulation kernel is imported via its public entry only (`runSimulation`,
  `isExperimental`, `assertNoAdoptFunction`); its degraded-state wrapper
  (`runSimulationWithDegradation`) is not used by the adapter — adapter refusals use their own
  reason-coded result type mirroring the lane convention.
- Root gates + full-suite `pnpm -r test` NOT run (TL merge-time gate per packet).

## 8. TL re-run commands

```bash
cd /home/z/w-f260a
corepack pnpm install --filter @fleetos/sim-worlds --prefer-offline --ignore-scripts  # only if needed
cd packages/sim-worlds && corepack pnpm run test && corepack pnpm run typecheck && corepack pnpm run lint
```
