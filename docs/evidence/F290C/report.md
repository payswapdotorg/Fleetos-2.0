# F290C — Worker C (Work + Commerce) Industry-Specific Agent Organizations Evidence

- **Work item:** F290C — industry-specific agent organizations and optimization, C (Wave 9 lane C; catalog: `spec/work-items/WORK-ITEM-CATALOG.md`)
- **Owner:** Worker C (work-and-commerce)
- **Base commit:** `84dd77c` (`merge work/f290a: F290A ACCEPTED — Wave 9 lane A`, origin/main HEAD — verified with `git log --oneline -1` before branching)
- **Branch:** `work/f290c`
- **Date:** 2026-10-09
- **Task ID:** `10-c`

## 1. Owned paths touched

Per `spec/worker-ownership.yaml` (worker-c grants `packages/agent-organizations/**` + `packages/model-gateway/**`):

- `packages/agent-organizations/src/industries/**` — NEW `industries/` module: `archetypes.ts`, `fit.ts`, `optimization.ts`, `benchmark.ts`, `index.ts` (barrel).
- `packages/agent-organizations/src/index.ts` — additive `export * from "./industries/index.js";` (one line; every Wave 1/3/6 export unchanged).
- `packages/agent-organizations/tests/industries-*.test.ts` — 4 new test files.
- `packages/model-gateway/src/industry-capability-match.ts` — NEW small extension.
- `packages/model-gateway/src/index.ts` — additive `export * from "./industry-capability-match.js";` (one line).
- `packages/model-gateway/tests/industry-capability-match.test.ts` — NEW test file.
- `docs/evidence/F290C/**` (this report).

`git status` at commit time shows exactly the above + `pnpm-lock.yaml` (the workspace-install mutation, left UNCOMMITTED per the F281 precedent — TL decides at merge; no new package.json, no new runtime deps). No spec edits, no other lane's path, no `spec/worker-ownership.yaml` edit. The new `industries/` machinery extends the EXISTING `agent-organizations` seams (roles, budgets, optimization-inputs, role-allocator, routing-optimizer, budget-rebalancer) — it forks nothing.

Dependencies (`workspace:*`, own lane only, public entry points only): `@fleetos/model-gateway` (the single pre-existing cross-package dep, already declared; the new `industries/benchmark.ts` reuses its `appendUsage` / `UsageLedgerEntry` / `ModelDescriptor` / `ProviderRecord` / `BudgetCheckPort`; `industry-capability-match.ts` reuses the gateway's OWN `validateModelRegistry` + `findModelsByCapabilities`). NO new `@fleetos/*` dependency, NO new runtime dep, NO import of the TL-owned adoption-suite industry taxonomy (the in-lane taxonomy is self-contained).

## 2. Baselines — machine-run BEFORE first edit (recorded) and re-verified AFTER last edit

All baselines machine re-run AFTER the last edit on this branch — identical counts, no regressions:

```text
packages/agent-organizations  10 files / 182 tests  →  14 files / 236 tests   ✓ held + 54 net-new (F290C)
packages/model-gateway         6 files /  98 tests  →   7 files / 107 tests   ✓ held +  9 net-new (F290C)
packages/acceptance/commerce   4 files /  65 tests  ✓ held (65 passed)        # commerce baseline
packages/acceptance/release   4 files /  88 tests  ✓ held (88 passed)        # release baseline
packages/acceptance/adoption   7 files /  90 tests  ✓ held (90 passed)        # adoption baseline
```

## 3. Deliverables (all pure deterministic TS; logical `now`/caller-supplied inputs everywhere)

### 3.1 `src/industries/archetypes.ts` (308 counted lines) — industry archetype registry

- **6 industries × 3 tiers = 18 archetypes** (`manufacturing`, `logistics`, `energy-utilities`, `facilities`, `field-services`, `construction` × `small`/`medium`/`large`). Each is DATA over the EXISTING contracts: a REAL `AgentRoleDefinition[]` topology sized by tier (small = core roles; medium adds a specialist; large adds a coordinator), a capability budget ENVELOPE (`OrganizationPolicyCeilings` + `BudgetFloor[]`), routing OBJECTIVE weights (`OptimizationGoals` — cost vs latency vs capability-fit as explicit integer bps summing to 10000), a ladder preference, the industry's required skill tags, an HONEST `industryAssumptions` note, and an `envelopeKind` (`specialist-heavy` | `cost-controlled`).
- **`validateArchetype` runs the EXISTING kernel validators**: every role passes the REAL `validateRoleDefinition`; goal weights pass `goalWeightSumBps` (non-negative integers, sum 1..10000); ceilings are positive integers; floors are valid (non-empty capability, non-negative integers, no duplicates); skill requirements non-empty; assumptions non-empty. Machine-tested: all 18 archetypes pass; refusal reason codes (`ROLES_EMPTY`/`GOALS_INVALID`/`CEILINGS_INVALID`/`FLOORS_INVALID`/`SKILL_REQUIREMENTS_EMPTY`/`ASSUMPTIONS_EMPTY`) tested.
- **Tier scaling + envelope divergence**: spend ceiling grows with tier (small→medium→large) AND diverges by envelope kind — specialist-heavy industries (manufacturing, energy-utilities, field-services) afford a HIGHER spend ceiling (×1.6 over the neutral generic baseline); cost-controlled industries (logistics, facilities, construction) enforce a TIGHTER one (×0.6). This divergence is the durable driver of the benchmark improvement (§3.4).
- Lookups (`getArchetype`/`listArchetypes`/`listIndustries`/`listTiers`) + `computeArchetypeDigest` (`indarch_<8hex>`).

### 3.2 `src/industries/fit.ts` (118 counted lines) — deterministic, explainable industry fit scoring

- A rubric scoring a caller-supplied `TenantProfile` (sector signal, fleet size, workload mix, optional tier hint — caller-supplied data, NO imports outside the lane) against each archetype. The score is the SUM of three integer-bps components, each surfaced in the result (`IndustryFitComponents`): `sectorMatchBps` (4000 on exact/normalized sector match, else 0), `fleetTierBps` (3000 exact tier, 1500 adjacent, 0 far; `orgSizeHint` overrides the fleet-size→tier mapping), `workloadAlignmentBps` (≤3000, proportional to skill-requirement + role-capability coverage of the workload mix).
- `rankIndustryFit` orders by (score desc, industry asc, tier asc) — DETERMINISTIC tie-break; input order never leaks (machine-tested with a reversed-input tie fixture). `computeIndustryFitDigest` (`indfit_<8hex>`).

### 3.3 `src/industries/optimization.ts` (81 counted lines) — per-industry optimization policies

- `IndustryOptimizationPolicy` = DATA derived from an archetype (`policyForArchetype`) that feeds the EXISTING seams: `goals` → `allocateRoles` + `optimizeRouting`; `policyCeilings` + `budgetFloors` → `prepareOptimizationInputs` constraints → `rebalanceBudgets` + `allocateRoles`; `ladderPreference` guides consumer ladder construction. It is NOT a replacement for any optimizer.
- `applyIndustryPolicy` overlays goals + ceilings + floors onto an `OptimizationInputs` PURELY (no mutation; preserves tenant/journal/usage/roles/budgets/revocations).
- **Industry MISMATCH is REFUSED (the chosen discipline, not a warning)**: `applyPolicyWithGuard` refuses an energy-utilities policy applied to a manufacturing org with `INDUSTRY_MISMATCH` (detail `policy:energy-utilities org:manufacturing`); a tier mismatch with `TIER_MISMATCH`; a kernel-validation failure surfaces as `PROBLEM_INVALID` carrying the REAL `prepareOptimizationInputs` reason code verbatim. Tested + documented.

### 3.4 `src/industries/benchmark.ts` (197 counted lines) — org optimization benchmark with improvement proofs + determinism

- Instantiates each archetype org, runs it through the REAL `allocateRoles` → `optimizeRouting` → `rebalanceBudgets` over scenario loads (6 industries × 3 tiers = 18 scenarios), reports per-industry scores with **improvement-vs-generic-baseline assertions** + a **byte-identical determinism proof**.
- **The generic baseline** = the package's established default goals (`{cost 3000, capFit 6000, latency 1000}`) + a NEUTRAL tier-scaled envelope (no floors) — the "no industry tuning" config. The industry policy DIVERGES (goals + envelope + floors).
- **The improvement is HONEST and PROVABLE, not circular**: the archetype's primary role (roles[0]) is calibrated so its projected spend falls BETWEEN the generic and industry spend ceilings. A specialist-heavy industry's HIGHER ceiling AFFORDS the specialist role the generic baseline REFUSES → higher `totalFitBps` (+10000). A cost-controlled industry's TIGHTER ceiling REFUSES the specialist role the generic baseline affords → lower `totalProjectedSpendMinor`. The fit-repair local search CANNOT erase the difference because a role refused by greedy is in `refusedPairs` and is never swapped in — so the ceiling-driven difference SURVIVES (the documented seam finding, §7.1). Goal-only improvements are erased by local search; the durable driver is the budget-ENVELOPE (ceiling) component of the policy.
- All 18 scenarios IMPROVE (`improvedCount === 18`), each with `improvementDelta > 0` pinned (specialist-heavy: maximize-fit delta +10000; cost-controlled: minimize-spend delta = the avoided specialist spend). Routing + rebalancing legs RUN for completeness (honest residuals, §8).
- **Determinism**: `runBenchmarkSuite` re-run is byte-identical (`JSON.stringify` equal) + same `bench_<8hex>` digest; `computeBenchmarkDigest` is tamper-distinct across scenario-set mutation.

### 3.5 `packages/model-gateway/src/industry-capability-match.ts` (94 counted lines) — model-gateway capability matching (small extension)

- `matchIndustryCapabilities(registry, requiredCapabilities)` maps industry skill requirements (the archetype's `skillRequirements`, caller-supplied plain data — the archetype is NEVER imported here, preserving the one-way `agent-organizations → model-gateway` dependency) to model-option capability tags through the gateway's EXISTING public surfaces: `validateModelRegistry` (REAL) + `findModelsByCapabilities` (REAL, lexical by id).
- **Unmatched requirements are an HONEST REFUSAL**: `NO_MODEL_MATCHES_REQUIREMENT` names every capability the registry cannot cover (in `detail` + `unmatchedCapabilities`), while still carrying `partialMatches` so the caller sees what WAS satisfiable. Refusal reason codes: `REGISTRY_INVALID` (surfaces the REAL registry reason), `REQUIREMENTS_EMPTY`, `REQUIREMENT_CAPABILITY_EMPTY`, `REQUIREMENT_CAPABILITY_DUPLICATED`. `computeCapabilityMatchDigest` (`indcap_<8hex>`).

### 3.6 Tests — 63 net-new (5 files), against the packet's ≥ 60 floor

```text
industries-archetypes.test.ts        18  (registry shape 4 + validators 4 + tier scaling 3 + digest 2 + refusals 5)
industries-fit.test.ts               11  (fleet mapping 2 + components 6 + ranking/ties 3)
industries-optimization.test.ts      10  (policy+purity 3 + mismatch refusal 4 + allocator feed 3)
industries-benchmark.test.ts         15  (shape 3 + per-industry improvement 6 + objective 2 + determinism 2 + seams 2)
industry-capability-match.test.ts     9  (full coverage 3 + refusals 5 + digest 1)
                                   ----
                                     63  net-new (floor ≥ 60)
```

## 4. Machine-verified gate outputs (exact, in the package dir)

```text
# packages/agent-organizations
corepack pnpm run test
  Test Files  14 passed (14)      Tests  236 passed (236)        # PASS (182 baseline + 54 net-new)
corepack pnpm run typecheck
  # no output, exit 0                                          # PASS
corepack pnpm run lint
  Found 0 warnings and 0 errors. Finished in 16ms on 34 files using 2 threads.   # PASS

# packages/model-gateway
corepack pnpm run test
  Test Files  7 passed (7)        Tests  107 passed (107)        # PASS (98 baseline + 9 net-new)
corepack pnpm run typecheck
  # no output, exit 0                                          # PASS
corepack pnpm run lint
  Found 0 warnings and 0 errors. Finished in 15ms on 19 files using 2 threads.    # PASS
```

## 5. Baselines re-verified (no regressions)

```text
packages/acceptance/commerce  corepack pnpm run test   65 passed (65)   # commerce baseline — held
packages/acceptance/release   corepack pnpm run test   88 passed (88)   # release baseline — held
packages/acceptance/adoption  corepack pnpm run test   90 passed (90)   # adoption baseline — held
```

## 6. Boundary verification (machine-tested)

- **Import scan** over new src → ONLY `@fleetos/model-gateway` (own lane, public entry), in `industries/benchmark.ts`. The `industry-capability-match.ts` module imports ONLY its own package's `./registry.js` + `./internal-digest.js` (NO `@fleetos/agent-organizations` import → no cycle; the archetype arrives as caller-supplied plain data). NO deep paths, NO other lane package, NO import of the TL-owned adoption-suite industry taxonomy.
- **Determinism sweep** → CLEAN: no `Date.now`/`Math.random`/`new Date(`/timers/`fetch` in new src (the only textual matches are doc-comment disclaimers saying these are never used — the lane convention). Logical `at` ticks are caller-supplied throughout.
- **File law** → all new src ≤ 400 code lines (skipBlankLines+skipComments — the green oxlint `max-lines` gate proves it): archetypes 308, benchmark 197, fit 118, optimization 81, index 4, industry-capability-match 94. Test files exempt per `.oxlintrc.json`.
- **`git status`** → exactly `packages/agent-organizations/{src/industries/**, src/index.ts, tests/industries-*.test.ts}` + `packages/model-gateway/{src/industry-capability-match.ts, src/index.ts, tests/industry-capability-match.test.ts}` + `docs/evidence/F290C/**` + `pnpm-lock.yaml` (UNCOMMITTED install artifact, per the F281 precedent). No spec edits; `spec/worker-ownership.yaml` untouched.

## 7. Seam findings (TL-relevant)

1. **Local search erases goal-only allocation improvements — the durable driver is the budget-ENVELOPE (ceiling)**: the role allocator's fit-repair local search swaps to STRICTLY higher-fit candidates and ignores cost, so under a LOOSE ceiling it converges every policy toward the max-fit assignment — goal-weight differences alone do NOT survive. The durable, provable improvement is driven by the policy's `policyCeilings.maxRoleBudgetSpendMinor` (specialist-heavy affords a role the generic ceiling refuses; cost-controlled refuses a role the generic affords), because a greedy-refused role is in `refusedPairs` and is NEVER swapped in by local search. If the TL prefers goal-weight-driven improvements to be durable, the local search would need a cost-aware tie-break (a kernel change in `role-allocator-search.ts`, out of this work item's scope).
2. **Archetype roles share `model_invoke`** — the global per-capability `meanSpendMinorPerEntry` couples roles that share a capability, so the benchmark uses the archetype's PRIMARY role (roles[0]) per scenario to keep the projected-spend calibration clean. A multi-role benchmark would need per-role capability isolation or a per-agent cost model (a deeper kernel seam).
3. **Routing selection is urgency-driven, not goal-driven**: `optimizeRouting`'s frontier ordering is `(priority→costBps|richnessBps)` primary with `scoreBps` (which uses the goals) only as a 3rd tie-breaker — so industry goal-weights barely move routing selection. The benchmark RUNS routing (completeness) but the improvement assertion is on the allocation objective (honest residual, §8.2). A goal-sensitive routing frontier would be a kernel change.
4. **The one-way `agent-organizations → model-gateway` dependency is preserved**: the capability-matching extension lives in `model-gateway` and takes skill requirements as plain `readonly string[]` — it never imports the archetype type, so no cycle is introduced. The archetype's `skillRequirements` flow as caller-supplied data through the benchmark.
5. **Digest-prefix reservation** (FNV-1a 32-bit, the lane convention): `indarch_` (archetype), `indfit_` (fit), `indcap_` (capability match), `bench_` (benchmark suite). No collision with the existing prefix table.
6. **Mismatch discipline = REFUSE** (chosen over WARN): `applyPolicyWithGuard` refuses industry/tier-mismatched policies with REAL reason codes (`INDUSTRY_MISMATCH`/`TIER_MISMATCH`) rather than warning + proceeding. Documented + tested. A WARN variant would be a one-line change if the TL prefers advisory application.

## 8. Honest residuals

1. The benchmark's improvement is driven by the budget-ENVELOPE (ceiling) component of the policy, not the goal-weights in isolation (§7.1). This is honest: the policy IS the bundle (goals + envelope + floors), and the bundle measurably beats the generic bundle on the industry's objective — but a goal-weights-only claim would NOT survive local search and is therefore NOT made.
2. The routing leg is RUN for completeness (every scenario `routingRan === true`) but carries NO improvement assertion: routing selection is urgency-driven (gateway semantics, §7.3), so industry goal-weights do not measurably move it. Recorded honestly.
3. The rebalancing leg is RUN for completeness (`rebalanceRan === true`) but carries no improvement assertion: the benchmark's single budget is healthy (skipped), so the policy's floors do not bind in this scenario. A floor-binding rebalance scenario is a follow-up.
4. The "0 holders" outcome for the refused role (specialist-heavy generic run / cost-controlled industry run) is honest: the generic baseline's neutral ceiling genuinely cannot budget for the specialist role, and the cost-controlled industry deliberately refuses it — the delta is the real, pinned improvement.
5. Digests are FNV-1a 32-bit (the lane convention — evidence-grade, not crypto).
6. Root gates (full `pnpm -r test`, `architecture:check`, `snapshot:check`) NOT run — per packet, TL merge-time; the two touched packages + the three named acceptance baselines were machine re-run instead (§5).
7. `pnpm-lock.yaml` carries the workspace-install mutation — left UNCOMMITTED per the F281 precedent (TL decides at merge; no new package.json, no new runtime deps).
8. The worklog entry for Task ID 10-c is appended to the session worklog (`/home/z/my-project/worklog.md`).

## 9. Verification commands for TL re-run

```bash
cd <repo checkout> && git checkout work/f290c
corepack pnpm install --prefer-offline --ignore-scripts
cd packages/agent-organizations
corepack pnpm run test        # 14 files / 236 tests (182 baseline + 54 net-new)
corepack pnpm run typecheck   # exit 0
corepack pnpm run lint        # 0 warnings, 0 errors
cd ../model-gateway
corepack pnpm run test        # 7 files / 107 tests (98 baseline + 9 net-new)
corepack pnpm run typecheck   # exit 0
corepack pnpm run lint        # 0 warnings, 0 errors
# baselines (unmodified corpora — must hold):
cd ../acceptance/commerce && corepack pnpm run test   # 65/65
cd ../release  && corepack pnpm run test             # 88/88
cd ../adoption && corepack pnpm run test             # 90/90
# boundary checks:
rg -o 'from "@fleetos/[a-z-]+"' packages/agent-organizations/src/industries packages/model-gateway/src/industry-capability-match.ts | sort -u   # only @fleetos/model-gateway
rg -n 'Date\.now|Math\.random|new Date\(|setInterval|setTimeout|fetch\(' packages/agent-organizations/src/industries packages/model-gateway/src/industry-capability-match.ts || echo CLEAN
cd <repo> && git status --short   # exactly agent-organizations/{industries,index.ts,tests} + model-gateway/{industry-capability-match,index.ts,tests} + docs/evidence/F290C + pnpm-lock.yaml (uncommitted)
```
