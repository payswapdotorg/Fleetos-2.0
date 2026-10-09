# F291 — TL Lane — Industrial Intelligence Convergence Evidence

- **Work item:** F291 — Industrial intelligence convergence (Wave 9 TL lane; catalog: `spec/work-items/WORK-ITEM-CATALOG.md` — "Industrial intelligence convergence, TL")
- **Owner:** Worker F291 (executes under the TL grant — the F261/F271/F281 precedent; `spec/worker-ownership.yaml` tl section carries `packages/acceptance/convergence/**`; worker-ownership.yaml NOT edited)
- **Base commit:** `f5a1653` ("merge work/f290c: F290C ACCEPTED — Wave 9 lane C …", origin/main HEAD — verified with `git log --oneline -1` before branching; Wave 9 lanes A + B + C merged at base)
- **Branch:** `work/f291` (created from origin/main HEAD)
- **Date:** 2026-10-09
- **Task ID:** `11-tl`

## 1. Owned paths touched

Per the packet's hard boundary (TL acceptance lane, the F281 precedent):

- `packages/acceptance/convergence/**` — NEW package `@fleetos/acceptance-convergence` (private, Apache-2.0, type: module; exports map `.` + `./scenarios` + `./intelligence` + `./gate`): `src/digest.ts` (76 raw), `src/scenario-data.ts` (208), `src/scenario-fleet.ts` (307), `src/scenario-org.ts` (162), `src/scenario-acceptance.ts` (98), `src/scenarios.ts` (359), `src/intelligence.ts` (341), `src/convergence-gate.ts` (266), `src/index.ts` (32); tests `tests/fixtures.ts` (REAL-output builders, not a test file), `tests/scenarios.test.ts` (21 tests), `tests/intelligence.test.ts` (25), `tests/convergence-gate.test.ts` (26), `tests/integration.test.ts` (10).
- `docs/evidence/F291/**` (this report).
- `pnpm-lock.yaml` — left UNCOMMITTED per packet (the diff is exactly the 46-line workspace link block for the new package; TL decides at merge).

`git status` at commit time shows exactly `packages/acceptance/convergence/` (new) + `docs/evidence/F291/` + `pnpm-lock.yaml` (uncommitted). No spec edits, no other lane's path, no `spec/worker-ownership.yaml` edit, no new top-level packages, no new runtime deps.

Dependencies (`workspace:*`, public entry points only — import scan in §6): the five acceptance packages + `@fleetos/assets` + `@fleetos/world-model` + `@fleetos/agent-organizations` + `@fleetos/model-gateway` (the lane package whose REAL surface is driven: capability matching, journal/usage chains). devDeps: `@fleetos/observations` + `@fleetos/world-context` (the TEST-composition bindings — the F290A/F290B precedents; src never imports them) + typescript + vitest.

## 2. Baselines — machine-run BEFORE first edit, re-verified AFTER last edit

BEFORE (at `f5a1653`, clean tree; the F290C §2 state):

```text
acceptance/field 61   acceptance/security 90   acceptance/commerce 65
acceptance/adoption 90   acceptance/release 88
```

AFTER (last edit; all five re-run green, identical counts):

```text
acceptance/field 61   acceptance/security 90   acceptance/commerce 65
acceptance/adoption 90   acceptance/release 88
```

**All five baselines held EXACT, BEFORE AND AFTER.** The new package touches no existing suite (a pure addition — 82 net-new tests, floor ≥ 50).

## 3. Deliverables (all pure deterministic TS; logical `now`/caller-supplied inputs everywhere)

### 3.1 `src/scenarios.ts` (public `./scenarios`) — per-industry convergence scenarios

For the six REAL F290C industries (`manufacturing`, `logistics`, `energy-utilities`, `facilities`, `field-services`, `construction`; tier `medium` by default, any of the 18 registry archetypes selectable), `assembleScenario`/`assembleDefaultScenarios` assemble:

- **The REAL archetype org** — the archetype record itself + `computeArchetypeDigest` (the lane's own digest), the REAL policy via `policyForArchetype`, and the org proven through the REAL optimization policy path: a REAL journal (`nextOrgEntry` chain, machine-verified by `verifyOrgJournalChain`), a REAL usage excerpt (`appendUsage` ledger chain, verified by `verifyUsageLedgerChain`), REAL budget records, and `applyPolicyWithGuard` → the REAL `OptimizationProblem` carrying the kernel's own digest (A19) with the policy's goals/ceilings/floors overlaid (machine-tested: `problem.goals === archetype.goals`, ceilings + floors equal).
- **A scenario asset fleet carrying REAL lineage** — 3 assets via the REAL `AssetDirectory` over `InMemoryAssetRepository` (admitted + activated); 3 versioned methods via `registerMethod`/`deprecateMethod` (an active inspection + an active maintenance + a deliberately deprecated legacy — the deprecated application attempt is REFUSED by the REAL surface with `method-deprecated` and RECORDED as an honest shortfall, never hidden); 3 material lots via `createMaterialLot`/`consumeMaterialLot` (a partially consumed lubricant + a coolant base transformed into a blend); 5 lineage edges via `appendLineageEdge` (all 4 edge kinds, the tamper-evident chain); REAL observation anchoring via `validateObservationAnchor` over a caller-supplied `ObservationLookupPort` (tests bind the REAL `admitToLog` log — the F290A pattern).
- **REAL JEPA forecasts over caller-supplied world-context windows** — every family member (`jepa.core`, `jepa.masked`, `jepa.rollout`) driven through the public `represent`/`predict` seam over each window (2 windows × 3 adapters = 6 REAL `PredictedValue` outputs with their uncertainty intervals, carried by reference).
- **The acceptance-family context** — the industry's REAL journey applicability over the three REAL corpora (`FIELD_JOURNEYS`/`SECURITY_JOURNEYS`/`COMMERCE_JOURNEYS` lengths imported, never hardcoded) via the F271 adoption masks; `field-services` is HONESTLY unmapped (no adoption counterpart — §7-S2). The composition lineage carries the REAL `ACCEPTANCE_RELEASE_SCHEMA_VERSION` (F281).
- **Every REAL artifact is carried BY REFERENCE + digest** — `scenarioDigest` digests the referenced records' CANONICAL CONTENT (the F281 convention: post-hoc mutation of a referenced lot/forecast/edge is DETECTED by `verifyScenarioDigest`; machine-tested ×3), citing the owning lanes' own digests where they exist (`computeArchetypeDigest`, `materialLotDigest`, the kernel problem digest, the chain head) as fields. The scenario NEVER recomputes a lane's output.

### 3.2 `src/intelligence.ts` (public `./intelligence`) — deterministic intelligence rollups

Per scenario (`buildScenarioIntelligence`), every field names its REAL source record:

- **Lineage coverage** — the REAL `ancestry` traversal per fleet asset (per-asset `ok`/`depth`/`edgeCount`/`refusal` from the REAL result; `assetsWithAncestry` is the count of results with depth ≥ 1; `coverageBps` is the documented derived fraction). The default fleet cites 2-of-3 (6666 bps) — the successor + the inspected asset carry ancestry; the predecessor seed does not (honest, machine-tested).
- **Optimization posture** — the REAL `runIndustryBenchmark(archetype)` record BY REFERENCE with the objective, industry score, generic score and improvement delta VERBATIM; objective follows the envelope kind (specialist-heavy → `maximize-fit`, cost-controlled → `minimize-spend`); all six scenario benchmarks improve (the F290C pinned law; asserted per scenario).
- **Forecast utilization** — the REAL predictions' values verbatim and their uncertainty intervals carried AS-IS (the REAL interval object BY REFERENCE — identity machine-tested); only the width is a documented derived number. Core + rollout widths equal `2 × jepaHalfWidthAt(h)` (the composed widening law); the masked adapter is A11-widened (width 4, never narrower).
- **Capability matching** — the REAL `matchIndustryCapabilities(registry, archetype.skillRequirements)` result BY REFERENCE; five industries fully matched, `energy-utilities`'s `grid-balance` is UNMATCHED — the honest REAL refusal (`NO_MODEL_MATCHES_REQUIREMENT`) recorded with partial matches preserved, never an invented match. A caller-supplied registry widens the honest-refusal record (machine-tested).
- **The shortfall ledger** — every honest refusal across the surfaces (capability-unmatched + assembly-refusal + anchor-refusal), each carrying its REAL reason code (the gate's condition (e) input).
- `intelligenceDigest` over the referenced REAL outputs (canonical content, including the posture record the gate reads); `verifyIntelligenceDigest` detects post-hoc mutation of the posture delta, the benchmark record, and the referenced forecast intervals (machine-tested ×3). Tenant fail-closed (`TENANT_ID_EMPTY`) + empty-fleet refusal (`EMPTY_FLEET` — a fraction over nothing would be invented).

### 3.3 `src/convergence-gate.ts` (public `./gate`) — the convergence verdict

A deterministic BOOLEAN gate (the F281 discipline — NO weighted scores, NO partial convergence): `CONVERGED` iff `blockers.length === 0`, requiring ALL of:

- **(a) fit rank** — the archetype is TOP-RANKED for the scenario profile by the REAL `rankIndustryFit` (the documented tie rule: score desc, industry asc, tier asc); the blocker names the top archetype + the scenario archetype's own rank;
- **(b) lineage chain** — `verifyLineageChain` passes; a tampered EDIT or REORDERED edge fails LOUDLY with the REAL reason (`edge-digest-mismatch` / `out-of-order-sequence`) + failing sequence + expected/actual (mutation fixtures machine-tested);
- **(c) benchmark delta** — the REAL improvement delta beats the generic baseline (`> 0` VERBATIM from the rollup's referenced benchmark record);
- **(d) widening law** — every JEPA forecast interval is never narrower than the REAL reference adapter's interval at equal horizon: the gate DRIVES `makeReferenceWorldModelAdapter` (the REAL output is the comparison) and emits one blocker per failing forecast, each naming its record (machine-tested with a re-sealed too-narrow interval fixture);
- **(e) shortfalls explained** — every honest-refusal shortfall carries a non-empty REAL reason code; an unexplained one blocks naming the record.

Otherwise `NOT-CONVERGED` with the exact blocking reasons, each naming its source record. Evaluation order (documented): tenant scope (empty → a single `TENANT_ID_EMPTY`; foreign-tenant or mis-paired records are never evaluated) → digest tamper checks (`SCENARIO_TAMPERED` / `INTELLIGENCE_TAMPERED`) → (a)..(e) ALL evaluated — no short-circuit between conditions; every failing condition contributes its named blocker (multi-degradation completeness machine-tested). Total (never throws); `gateDigest` + `verifyConvergenceGateVerdict` (verdict tamper machine-tested).

### 3.4 `src/index.ts` (barrel) + `src/digest.ts` (local FNV-1a / canonical-JSON copy — the acceptance-family seam decision, same as F271/F281) + internal modules `src/scenario-{data,fleet,org,acceptance}.ts` (reachable through the `./scenarios` entry)

### 3.5 Tests — 82 net-new (4 files + fixtures), against the packet's ≥ 50 floor

```text
scenarios.test.ts        21  (per-industry ×6 + defaults + fail-closed ×4 + world validation ×3
                              + windows override + determinism + digest tamper ×3 + journey
                              applicability ×2 + honest refusal + parameter coercion)
intelligence.test.ts     25  (coverage spot-proof + cited counts + source; posture verbatim ×4;
                              utilization identity + composed law + masked A11 + method label
                              + independent re-drive; capability matching ×4; shortfall ledger
                              ×3; fail-closed ×2 + digest tamper ×3 + determinism)
convergence-gate.test.ts 26  (all-green ×6 + explained-shortfalls-pass; tenant fail-closed ×4;
                              (a) ×2; (b) ×3 (EDIT + REORDER + end-to-end); (c) ×2; (d) ×3;
                              (e) ×1; multi-degradation + rollup tamper + determinism + verdict tamper)
integration.test.ts      10  (THE REAL-RUN ×2 + cross-tenant anchoring + cross-tenant traversal
                              + determinism + widening law + tamper propagation + world-context
                              REAL binding + release-family parity + composition lineage)
                                  ----
                                   82  net-new (floor ≥ 50)
```

## 4. Machine-verified gate outputs (exact, in the package dir)

```text
cd packages/acceptance/convergence
  corepack pnpm run test
    Test Files  4 passed (4)      Tests  82 passed (82)          # PASS (≥ 50 net-new required)
    Duration  4.08s
  corepack pnpm run typecheck
    # no output, exit 0                                          # PASS
  corepack pnpm run lint
    Found 0 warnings and 0 errors. Finished in 12ms on 14 files using 2 threads.   # PASS
```

## 5. Test-count accounting

```text
scenarios 21 + intelligence 25 + convergence-gate 26 + integration 10 = 82 net-new (floor ≥ 50)
  (+ tests/fixtures.ts — REAL-output builders, not a test file; 111 raw lines, lint-green)
```

## 6. Boundary verification (machine-tested)

- **Import scan** over src+tests → ONLY the declared packages, public entry points only:
  - src: the five acceptance packages (`@fleetos/acceptance-adoption/industries`, `@fleetos/acceptance-{field,security,commerce}/journeys` — public subpath exports; `@fleetos/acceptance-release` root) + the Wave-9 lane packages (`@fleetos/assets`, `@fleetos/world-model`, `@fleetos/agent-organizations`, `@fleetos/model-gateway` — public roots only).
  - tests: + `@fleetos/world-context/windowing` (public subpath) + `@fleetos/observations` (public root) — devDeps, TEST-SITE only (the F290A/F290B composition-binding precedents).
  - NO deep paths outside the public exports maps, NO other lane package.
- **Determinism sweep** → CLEAN (no `Date.now`, `Math.random`, `new Date(`, timers, `fetch` in src+tests). Logical times are constants (`NOW_0 = 1_774_000_000_000`, `FORECAST_COMPUTED_AT = "2026-10-01T00:00:00.000Z"`).
- **File law** → all 9 source files pass oxlint `max-lines 400` (skipBlankLines+skipComments — the green lint gate proves it): largest `scenarios.ts` 359 raw / lint-effective under 400. Test files exempt per the repo's `.oxlintrc.json` override (largest `convergence-gate.test.ts`).
- **`git status`** → exactly `packages/acceptance/convergence/**` (new) + `docs/evidence/F291/**` + `pnpm-lock.yaml` (UNCOMMITTED per packet). No spec edits; `spec/worker-ownership.yaml` untouched.
- **Baselines** → all five acceptance suites re-run green AFTER the last edit (§2).

## 7. Seam findings (TL-relevant)

1. **The scenario digest must digest the referenced records' CANONICAL CONTENT, not the lanes' stored digests.** Citing a stored digest string (an `applicationDigest`, the kernel problem digest, the chain head) does NOT detect post-hoc runtime mutation of the referenced record (the stored string rides along unchanged) — the F290A chain catches edge-content tampering only because `verifyLineageChain` RECOMPUTES. The convergence scenario digest therefore digests the referenced records canonically (the F281 cost-posture convention) while still citing the lane digests as fields; post-hoc mutation of a lot, a forecast, or a lineage edge is machine-tested as DETECTED. Same law applied to the intelligence digest: the POSTURE wrapper (whose `improvementDelta` the gate reads) is digested, not just the referenced benchmark record.
2. **The adoption taxonomy has NO field-services counterpart.** The F290C industries and the F271 adoption industries overlap for five of six (`facilities` ↔ `facilities-management`, `logistics` ↔ `transportation-logistics` — lexical mismatch handled by an explicit mapping, not by fuzzy matching); `field-services` is UNMAPPED and reported honestly (`status: "unmapped"`, corpora totals only, NO applicable/masked split claimed — an unmapped industry is never silently treated as covered or masked). If the TL wants a field-services adoption industry, that is an F271-layer change.
3. **Sector-signal coupling between the two industry taxonomies**: the F290C `rankIndustryFit` sector match is exact/normalized-string (`facilities-management` does NOT match `facilities`), so the scenario profile's sector signal is the F290C industry id; the adoption id is carried separately in the journey-applicability record. Feeding adoption ids directly as sector signals would silently zero the sector component — the mapping is explicit and machine-tested.
4. **The masked adapter's interval is horizon-INDEPENDENT (width 4.0)** — `decodeMaskedPrimary` widens `jepaUncertaintyAt(1, value)` by the A11 factor 2 (the "less evidence, wider interval" law), so the masked prediction's width does NOT follow `2 × jepaHalfWidthAt(h)`. The gate's widening check compares against the REAL reference adapter (the packet's law) which the masked width satisfies for every horizon; the composed-law equality is asserted only for core + rollout. Documented, not silently widened.
5. **Sparse-array mutation is invisible to canonical JSON** (`[empty]` serializes as `[]` in the local convention because `Array.map` skips holes): verdict-tamper fixtures must PUSH content, not set `.length`. Cosmetic (all production arrays are dense), recorded for the next lane that reuses the digest convention.
6. **The five acceptance packages are genuinely driven, not declared**: the three corpora lengths are imported from the REAL packages (the F281 never-hardcode convention), the adoption masks/rationales from the REAL `./industries` subpath, and the release package's REAL `ACCEPTANCE_RELEASE_SCHEMA_VERSION` is carried in every scenario's `compositionLineage` + the digest convention parity is machine-tested against the release package's own `fnv1a`/`canonicalJson`.
7. **The benchmark + corpora surfaces are industry/corpus-level, not tenant-scoped** (the F290C/F271 fixed deterministic worlds). The gate's tenant scope therefore applies to the scenario + intelligence records (pairing + digests), while the benchmark delta and journey applicability are industry-level baselines — the same discipline F281 documented for corpus-level acceptance reports.
8. **Install-order note (inherited from F281)**: the packet's `--filter @fleetos/acceptance-convergence` (without `...`) does not link the transitive workspace deps; the recursive `--filter @fleetos/acceptance-convergence...` form links the full closure. Used the recursive form (§9).

## 8. Honest residuals

1. The convergence package is a PURE REFERENCE-PATH acceptance composition — no persistence, no I/O, no pipeline wiring; the scenario assembly, rollups and gate are library functions the composing application (TL composition) drives. The gate NEVER re-runs the adoption simulation or the acceptance corpora — it consumes assembled records.
2. The scenario's per-industry workload mix, telemetry windows, fleet composition and the default model registry are deterministic CALLER-SUPPLIED data (the scenario IS the caller — the same discipline as F290C's benchmark loads). They are calibrated so the REAL fit ranking, benchmark and matcher behave honestly; the numbers are never presented as lane outputs.
3. The `energy-utilities` `grid-balance` unmatched capability is a DELIBERATE honest fixture of the documented default registry (the packet's "unmatched = recorded honest refusals" law made concrete): the refusal is recorded with the REAL reason code and does NOT block convergence (explained shortfalls pass condition (e) — machine-tested). A fuller registry is TL composition.
4. The capability-match rollup's `matched`/`unmatched` lists are informational views of the REAL result (the gate never reads them — it reads the shortfall ledger); their mutation is not separately digest-covered (the underlying result record and the shortfalls are).
5. `pnpm -r test` (full monorepo) NOT run — TL merge-time gate per packet; the five acceptance baselines were machine re-run instead (§2), plus the convergence gates (§4).
6. `pnpm-lock.yaml` carries the 46-line workspace link block for the new package — left UNCOMMITTED per packet. TL decides at merge.
7. The worklog entry for Task ID 11-tl is appended to the session worklog (`/home/z/my-project/worklog.md`).

## 9. Verification commands for TL re-run

```bash
cd <repo checkout> && git checkout work/f291
corepack pnpm install --filter @fleetos/acceptance-convergence... --prefer-offline --ignore-scripts
cd packages/acceptance/convergence
corepack pnpm run test        # 4 files / 82 tests (floor ≥ 50)
corepack pnpm run typecheck   # exit 0
corepack pnpm run lint        # 0 warnings, 0 errors
# baselines (unmodified corpora — must hold):
cd ../field     && corepack pnpm run test   # 61/61
cd ../security  && corepack pnpm run test   # 90/90
cd ../commerce  && corepack pnpm run test   # 65/65
cd ../adoption  && corepack pnpm run test   # 90/90
cd ../release   && corepack pnpm run test   # 88/88
# boundary checks:
rg -o 'from "@fleetos/[a-z-]+[a-z/-]*"' packages/acceptance/convergence/src packages/acceptance/convergence/tests | sort -u
rg -n 'Date\.now|Math\.random|new Date\(|setInterval|setTimeout|fetch\(' packages/acceptance/convergence/src packages/acceptance/convergence/tests || echo CLEAN
cd <repo> && git status --short   # exactly convergence/** + evidence/F291/** + pnpm-lock.yaml (uncommitted)
```
