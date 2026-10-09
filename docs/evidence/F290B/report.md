# F290B — Worker B (Safety + Intelligence) JEPA-Family World-Model Adapters Evidence

- **Work item:** F290B — Advanced world models / JEPA-family adapter implementations (Wave 9 lane B; catalog: `spec/work-items/WORK-ITEM-CATALOG.md`)
- **Owner:** Worker B (safety-and-intelligence; `spec/worker-ownership.yaml` worker-b grants)
- **Base commit:** `c0229dc` ("TL: Wave 9 dispatch packets — F290A/B/C + F291", origin/main HEAD — verified with `git log --oneline -1` before branching)
- **Branch:** `work/f290b` (created from origin/main HEAD)
- **Date:** 2026-10-09
- **Task ID:** `10-b`
- **Session note:** a prior interrupted session (platform capacity event) left the 7 source modules + the 3 integration edits uncommitted with an EMPTY `tests/jepa/` directory; per the inherited-WIP protocol (the F270B precedent) the true baseline was machine-verified at the clean base commit before proceeding (`git stash -u` → full gate run → `git stash pop`), every in-flight file was audited against the packet, the missing test suite (105 tests) was written, one lint-conformance pass (`no-new-array` / spread-fallback — 6 warnings → 0) and one missing dependency install (`@fleetos/world-context` devDep link) were fixed, and everything was re-gated before committing.

## 1. Owned paths touched

Per `spec/worker-ownership.yaml` (worker-b grants) — ONLY lane packages + this evidence dir:

- `packages/world-model/**` — NEW `src/jepa/embedding.ts` (294 lines), `src/jepa/predictor.ts` (266), `src/jepa/masked.ts` (180), `src/jepa/rollout.ts` (236), `src/jepa/counterfactual.ts` (193), `src/jepa/index.ts` (310 — barrel + family adapters + registry), `src/jepa/benchmark.ts` (195); `src/index.ts` (+5: the F290B barrel re-export); `package.json` (+ jepa subpath export + NEW devDep `@fleetos/world-context` — the test-composition binding, public entry point `@fleetos/world-context/windowing` only); NEW tests `tests/jepa/embedding.test.ts` (27 tests), `predictor.test.ts` (21), `masked.test.ts` (11), `rollout.test.ts` (15), `counterfactual.test.ts` (13), `benchmark.test.ts` (18).
- `packages/predictive/**` — `src/index.ts` (+1 line): `UncertaintyInterval.method` union gains the honest label `"jepa.latent-sqrt"` (the composed widening law's name). No behavior change; the package's own suite re-run green at the unchanged count.
- `docs/evidence/F290B/**` (this report).
- `pnpm-lock.yaml` — COMMITTED: the diff is exactly the 3-line `@fleetos/world-context` workspace devDep link for world-model (the F280B semantic-lockfile-change precedent; no other churn).

Untouched: security, policy, actions, execution, evidence, world-context, learning, simulation, integrations/arena, experiences/safety-intel (all re-run green after the last edit, §2). No spec edits, no other lane's paths, no new top-level packages, no new runtime deps (world-context is a devDep, public entry point only, and is a lane sibling).

## 2. Baselines — machine-run BEFORE first edit, re-verified AFTER last edit

BEFORE (at `c0229dc`, clean tree via `git stash -u`; identical counts to F280B §2 + the F281 release gate):

```text
security 5/147   policy 5/131   actions 4/73    execution 6/118
evidence 3/82    predictive 4/74  world-model 3/42  world-context 3/34
learning 5/78    simulation 7/103  arena 7/94     safety-intel 5/113
acceptance/field 5/61   acceptance/security 4/90   acceptance/commerce 4/65
acceptance/adoption 7/90   acceptance/release 4/88
```

AFTER (last edit; full test+typecheck+lint per touched package, test re-runs per untouched lane package, all green):

```text
security 5/147   policy 5/131   actions 4/73    execution 6/118
evidence 3/82    predictive 4/74  world-model 9/147  world-context 3/34
learning 5/78    simulation 7/103  arena 7/94     safety-intel 5/113
acceptance/field 5/61   acceptance/security 4/90   acceptance/commerce 4/65
acceptance/adoption 7/90   acceptance/release 4/88
```

**Wave-8 baselines preserved: security 90, adoption 90, release 88 — all green BEFORE AND AFTER.** Lane total 1092 → 1197 (+105).

## 3. Deliverables (all pure deterministic TS; law A12 throughout)

"JEPA" everywhere means the DETERMINISTIC STRUCTURAL ANALOGUE of a Joint Embedding Predictive Architecture — latent-space prediction with hash-derived projections. NOT learned weights; no GPU, no provider, no I/O, no wall clock, no Math.random (purity scan in §5).

### 3.1 D1 — `src/jepa/embedding.ts` — the deterministic latent space

- Fixed documented dimensionality `LATENT_DIM = 32`; space version `jepa-1.0.0` (provenance-carried).
- **Weight derivation (no giant precomputed table, no Math.random):** seed = the lane's FNV-1a-family hash of `${namespace}#feature#${name}`, expanded by a documented xorshift32 integer stream mapped to [-1,1), then L2-normalized. Rows are derived AT CONSTRUCTION from the hash family alone; memoized per name. Known answers pinned: `fnv1a32("") = 0x811c9dc5` (the FNV offset basis), `fnv1a32("a") = 3826002220`, `jepaDigest("benchmark-premise") = "e941dff6"`.
- **Float determinism:** embeddings accumulate in SORTED feature-key order (float + is not associative — the summation order is part of the contract); all arithmetic is IEEE-754 correctly-rounded, so outputs are byte-identical across re-runs AND re-constructions (machine-tested both ways).
- **Distance semantics, both with known-answer tests:** `latentL2` (3-4-5 triangle pinned), `latentCosine` (parallel 1 / anti -1 / orthogonal 0 pinned) with the documented ZERO-VECTOR CONVENTION cosine(0, x) = 0 — never NaN.
- **Latent dynamics `A` = R/√dim with unit-norm hash-derived rows — NON-EXPANSION PROOF (Cauchy–Schwarz):** |(Az)_i| ≤ ‖z‖/√dim ⇒ ‖Az‖² ≤ ‖z‖². Machine-tested (‖Az‖ ≤ ‖z‖ over fixtures); this single law underwrites the rollout radius bound (D4).
- Fail-loud construction validation (dim ∉ [2,1024] or non-integer; empty namespace → RangeError). Non-finite feature values are EXCLUDED from embeddings (documented honesty: a NaN never poisons the latent).

### 3.2 D2 — `src/jepa/predictor.ts` — the joint-embedding predictor

- Prediction happens in LATENT space: premise = base embedding + premise-delta embedding (the latent shift), advanced by the dynamics operator to the horizon, then DECODED to a seam-shaped `PredictedValue<number>` with per-feature readouts. Known answer pinned: `{temperature: 42}` at h=1 decodes to `-0.174765`; the delta-shifted premise `{temperature: 7}` decodes to `-0.203892` (the latent intervention is visible in the decode).
- **UNCERTAINTY WIDENING LAW — composed from the lane's REAL laws, never a local copy:** `halfWidth(h) = MIN_BOUND_HALF_WIDTH * (1 + √h)` where `MIN_BOUND_HALF_WIDTH = 0.5` is IMPORTED from `@fleetos/predictive` (the reference twin model's constant; machine-tested that the composed law equals the real-constant formula at h ∈ {1,2,4,9,16}). Width at h=1 is exactly 2.0 — the reference adapter's constant interval width — so the JEPA interval is **NEVER narrower than the reference adapter's at equal horizon** (equal at h=1, wider beyond; machine-tested h=1..50). Confidence: 0.5 at h=1, −250 bps/step, floored at 500 bps (the reference model's `stepConfidenceBps` law shape, anchored at the reference adapter's 0.5) — further horizons are honestly LESS certain, never more.
- **Method label:** `"jepa.latent-sqrt"` — the honest name for the composed law, added to `@fleetos/predictive`'s `UncertaintyInterval.method` union (+1 line; the seam's own vocabulary).
- **Reserved-key controls** (the seam passes a single feature map, so controls travel in reserved keys — one discipline, no dual behavior): `jepa.horizon` (malformed → documented default 1, with the horizon actually used carried in the provenance inputsDigest — nothing silently hidden), `jepa.delta.<feature>` (premise deltas), `jepa.prev.<feature>` (rollout velocity seeds). Reserved keys are never embedded as features (machine-tested). Strict module surface: invalid horizon / non-finite delta → named rejections.
- Empty payload: the honest zero-mass prediction (value 0, empty readouts) — never a refusal, never a fabricated value.

### 3.3 D3 — `src/jepa/masked.ts` — the I-JEPA analogue

- Caller-chosen mask subset; the variant embeds the UNMASKED context, advances it ONE step with the SAME dynamics operator, and decodes the masked features from the context-only latent.
- **HONEST masked-vs-full divergence accounting — recorded, never hidden:** every masked feature carries BOTH the masked prediction and the full prediction (same operator on the full set), plus per-feature delta, |delta|, signed bps of the full value, and the total. Known answer pinned: masking `temperature` over `{humidity: 11, pressure: 3.5, temperature: 42}` records masked `-0.018891` vs full `-0.193655`, delta `0.174764`, `-9025 bps`. Accounting law machine-tested: divergence = |delta|, total = Σ divergences, empty mask ⇒ zero divergence (masked === full).
- Masked decode is LESS certain: the seam-shaped decode widens the composed h=1 law by the EXISTING `widenUncertaintyForCounterfactual` (../widening.ts, factor 2 — the lane's A11 "less evidence, wider interval" discipline): width 4, confidence 0.25 (machine-tested).
- Strict surface: unknown mask target → rejection naming it; reserved `jepa.*` keys cannot be masked (machine-tested).

### 3.4 D4 — `src/jepa/rollout.ts` — the V-JEPA analogue

- **Seeding from the world-context window:** `z0 = embedding(last frame)`; latent velocity `v = last − previous frame embedding` (finite difference in latent space); a single-frame window honestly uses `v = 0` (documented, machine-tested: zero vector, radius NON-INCREASING across steps).
- **Rollout law:** `z_k = A z_{k−1} + v`, A non-expanding (D1's proof).
- **CROSS-STEP DIVERGENCE LAW — stated and proved, machine-tested (both clauses):**
  1. ACCUMULATED truth divergence is **MONOTONE NON-DECREASING** in k by construction (running sum of non-negative norms). State: MONOTONE.
  2. The latent RADIUS is **EXPLICITLY BOUNDED:** `‖z_k‖ ≤ ‖z_0‖ + k·‖v‖` — non-expansion + triangle inequality, by induction. State: BOUNDED. Machine-tested at EVERY step (`radius ≤ seedNorm + k·velocityNorm`), with the explicit bound surfaced on the result as `radiusBoundAtFinal`.
- Truth frames (exactly H, steps 1..H — strictly validated): every per-step record carries the truth latent, the per-step truth divergence, and the running total; without truth, the records carry radius + step-to-step delta norms (the self-divergence view). Nothing hidden: every number is on the step records.
- Strict validation: empty window / non-monotonic steps / invalid horizon / wrong truth count or step numbering → named rejections (machine-tested each).
- **REAL-surface composition binding (test site):** `tests/jepa/rollout.test.ts` binds the REAL `@fleetos/world-context` public windowing surface — `projectWindowedWorkload` builds two REAL windowed projections (integrity verified via `verifyWindowIntegrity`), and the frames are derived from the REAL outputs (utilization, per-window observation count) — the module itself consumes a LOCAL structural shape, keeping src free of cross-context runtime imports.

### 3.5 D5 — `src/jepa/counterfactual.ts` — latent counterfactuals

- **Intervene in latent space → shifted embedding → decode:** two documented intervention kinds — `feature-shift` (premise deltas' embedding added to the base) and `premise-direction` (the premise string deterministically selects the latent direction `row(premise#<premise>)`, scaled). The result is a full `CounterfactualScenario<number>`.
- **Law A11 (machine-carried, type-enforced):** the value is an `HypotheticalValue` with `hypothetical: true` — built through the EXISTING HYPOTHETICAL brand re-exported by the world-model seam. Machine-tested: `assertHypotheticalMarker` true; the REAL predictive type guards never confuse it (`isHypothetical` true, `isPredicted`/`isObserved` false).
- **Uncertainty amplified per the composed law:** the sqrt-law interval at the horizon widened by the EXISTING A11 law (factor 2) — wider bounds (known answer: width 5.4641 = 2 × 2 × halfWidth(3)), HALVED confidence (0.225 at h=3).
- Divergence accounting mirrors the lane's discipline: every payload feature carries baseline vs counterfactual decoded values, delta, signed bps (known answers pinned: 0.036398 → 0.037016, +170 bps). `premise-direction scale 0` ⇒ counterfactual equals the baseline exactly (all divergences 0 — machine-tested).

### 3.6 D6 — `src/jepa/index.ts` + `src/jepa/benchmark.ts` — family registry + contract benchmark

- **Registry:** `JEPA_FAMILY_REGISTRY` = `jepa.core` (joint-embedding predictor), `jepa.masked` (I-JEPA analogue), `jepa.rollout` (V-JEPA analogue). Every member is a FULL `WorldModelAdapter` over the EXISTING seam (`name` / `represent` / `predict` / `counterfactual` — no seam edits).
- **Adapter-level laws (machine-tested per member):** predict is TOTAL (never throws over a malformed-input battery: NaN/Infinity features, malformed reserved keys, empty maps) and deterministic (byte-identical); counterfactual enforces A11 — an interval NOT wider than the baseline's is widened 2x by the EXISTING law (a narrow provided interval exactly doubles; an already-wider one is kept verbatim); **world-model CANNOT authorize or execute actions** — the adapter surface is structurally exactly the four seam members (machine-checked), no `ActionIntent`/`GuardianDecision` anywhere.
- Variant defaults (documented): the masked adapter masks the lexicographically later ⌈n/2⌉ payload keys (`defaultMaskPolicy` known answers pinned: [] → [], [a] → [a], [a,b] → [b], [a,b,c] → [b,c], [a,b,c,d] → [c,d]); the rollout adapter seeds a 2-frame window from `jepa.prev.*` keys (absent ⇒ single-frame, zero velocity — honest).
- **The deterministic contract benchmark:** `runJepaBenchmark()` runs every family adapter through the FULL seam contract over 5 documented fixtures (mirrors of the seam tests' literals + JEPA-extended reserved-key controls), canonically serializes every output (rep + prediction + counterfactual), and digests per-row / per-adapter / aggregate with the lane's FNV-1a family.
- **BYTE-IDENTICAL DETERMINISM PROOF (machine-tested three ways):** (1) two runs over the same space produce byte-identical canonical serializations AND equal digests at every level; (2) a third run on a FRESHLY-CONSTRUCTED space is byte-identical (construction determinism — the hash-derived weights re-derive identically); (3) sensitivity: a different namespace changes the aggregate digest.

## 4. Tests — 105 net-new (6 files), against the packet's ≥ 60 floor

```text
world-model tests/jepa/  embedding 27 + predictor 21 + masked 11
                        + rollout 15 + counterfactual 13 + benchmark 18 = 105 net-new
                        (world-model 42 → 147; every test run and passed this session)
```

Every known-answer value above was verified against the implementation BEFORE being pinned (scratch verification run, then deleted); every claimed law has a machine test in §3.

## 5. Gates (exact commands + outputs, in each touched package dir)

```text
cd packages/world-model
  corepack pnpm run test        # Test Files  9 passed (9)    Tests  147 passed (147)
  corepack pnpm run typecheck   # exit 0 (tsc --noEmit, no output)
  corepack pnpm run lint        # "Found 0 warnings and 0 errors." (14 files)
cd packages/predictive
  corepack pnpm run test        # Test Files  4 passed (4)    Tests  74 passed (74)
  corepack pnpm run typecheck   # exit 0
  corepack pnpm run lint        # "Found 0 warnings and 0 errors." (6 files)
```

All ten untouched lane packages + all five acceptance packages re-run green AFTER the last edit (§2). Purity scan clean — no `Date.now` / `Math.random` / timers / network anywhere in the new modules or tests (the only textual matches are the doc comments BANNING them). File law: largest new file 310 raw lines (src/jepa/index.ts; all 13 new files ≤ 310 raw AND ≤ 400 lint-effective). Import law: the one new cross-package edge is `world-model → @fleetos/world-context` (devDependency, lane sibling, public entry point `@fleetos/world-context/windowing` only, TEST-SITE only — src has no cross-context import); `MIN_BOUND_HALF_WIDTH` is imported from `@fleetos/predictive`'s public root (a runtime dep that already existed).

## 6. Decisions + seam findings (TL-relevant)

- **D-1 (devDep edge `world-model → world-context`):** the rollout (V-JEPA) variant's window seeding composes with the REAL world-context windowing surface at the TEST site (public subpath export only). The src keeps a LOCAL structural `LatentWindowFrame` shape — zero runtime coupling; the composition binding is machine-tested. Flagged for TL awareness since the edge is new (though dev-scope and intra-lane).
- **D-2 (lockfile):** the 3-line `@fleetos/world-context` link addition committed with the work (the F280B semantic-change precedent; F270B's filtered-install mutation precedent does not apply — this diff IS the dependency edge).
- **S1 — reserved-key control channel:** the `WorldModelAdapter` seam passes a single feature map, so JEPA prediction controls (horizon, premise deltas, prev-frame seeds) travel in reserved `jepa.*` feature keys — documented convention, one discipline (the module APIs interpret the same keys identically), malformed values degrade to documented defaults with the values actually used carried in provenance. A future seam widening (explicit controls parameter) is TL composition; the reserved-key channel is the no-seam-edit path.
- **S2 — primary-feature decode convention:** the seam's `predict` returns ONE scalar value; the JEPA decodes the PRIMARY feature (lexicographically smallest payload key) and carries ALL per-feature readouts on the module-level `JepaPrediction.readouts`. Multi-target seam prediction is TL composition if needed.
- **S3 — the uncertainty vocabulary extension:** `"jepa.latent-sqrt"` joined `@fleetos/predictive`'s `UncertaintyInterval.method` union (1 line, additive; every existing method string untouched). This is the first lane-authored method label outside the Wave-1 vocabulary — TL may want the vocabulary ownership adjudicated.
- **S4 — FNV-1a digest strength:** the JEPA digests use the lane's established 32-bit FNV-1a-family convention (provenance + benchmark determinism proofs). Determinism-proving, not collision-resistant — same family as the S1 finding in F280B (the TL hoisting question stands).

## 7. Honest residuals

- The latent space is a DETERMINISTIC STRUCTURAL ANALOGUE — a fixed hash-derived projection, not learned weights. It demonstrates the JEPA family's STRUCTURE (latent prediction, masking, rollout, intervention) with provable determinism; predictive ACCURACY is not claimed anywhere and would require the learned path the law currently forbids (A12 reference-first).
- The dynamics operator is a single shared linear non-expanding map; richer latent dynamics (per-feature operators, non-linear maps that preserve the radius bound) are future lanes' work.
- The masked adapter's default mask policy (later ⌈n/2⌉ keys) is a documented DEFAULT; callers with semantic feature-importance knowledge should choose masks explicitly via the module surface.
- Truth-frame divergence accounting requires the caller to supply actual future frames; the accounting is honest but only as good as the supplied truth (garbage truth frames still produce recorded divergences — recorded, never validated semantically).
- `pnpm -r test` (full monorepo) NOT run — TL merge-time gate per packet; the twelve lane packages + five acceptance packages were machine re-run instead (§2/§5).
- The worklog entry for Task ID 10-b is appended to the session worklog (`/home/z/my-project/worklog.md`).

## 8. TL re-run commands

```bash
git checkout work/f290b   # at the pushed commit
corepack pnpm install --filter @fleetos/world-model... --prefer-offline --ignore-scripts  # only if needed
cd packages/world-model   && corepack pnpm run test && corepack pnpm run typecheck && corepack pnpm run lint
cd ../predictive          && corepack pnpm run test && corepack pnpm run typecheck && corepack pnpm run lint
cd ../acceptance/security && corepack pnpm run test   # 90 — Wave-8 baseline
cd ../adoption            && corepack pnpm run test   # 90 — Wave-8 baseline
cd ../release             && corepack pnpm run test   # 88 — Wave-8 baseline
# untouched lane packages re-verified this session: security 147, policy 131, actions 73,
# execution 118, evidence 82, world-context 34, learning 78, simulation 103, arena 94,
# safety-intel 113, acceptance/field 61, acceptance/commerce 65 — all passed.
```
