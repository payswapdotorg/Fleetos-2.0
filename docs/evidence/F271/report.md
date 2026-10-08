# F271 — TL Lane — Full Industry Adoption Simulation + Deployment Acceptance Evidence

- **Work item:** F271 — full industry adoption simulation + deployment acceptance (Wave 7 TL lane; catalog: `spec/work-items/WORK-ITEM-CATALOG.md`)
- **Owner:** Worker F271 (executes under the TL grant — the F261 precedent; `spec/worker-ownership.yaml` tl section already carries `packages/acceptance/adoption/**` in the dispatch commit `1bbaef5`; worker-ownership.yaml NOT edited)
- **Base commit:** `1bbaef5` ("TL: dispatch packet F271")
- **Branch:** `work/f271`
- **Date:** 2026-10-09

## 1. Owned paths touched

Per `spec/worker-ownership.yaml` (tl, grant `packages/acceptance/adoption/**`):

- `packages/acceptance/adoption/**` — NEW package `@fleetos/acceptance-adoption` (private, Apache-2.0, type: module; exports map `.` + `./industries` + `./run` + `./report`): `src/industries.ts`, `src/firms.ts`, `src/incumbent.ts`, `src/adoption-run.ts`, `src/verdicts.ts`, `src/report.ts`, `src/digest.ts`, `src/index.ts` + 7 test files (`tests/industries.test.ts`, `tests/firms.test.ts`, `tests/incumbent.test.ts`, `tests/verdicts.test.ts`, `tests/adoption-run.test.ts`, `tests/report.test.ts`, `tests/simulation.test.ts`).
- `docs/evidence/F271/**` (this report).

`git status` at commit time shows exactly `packages/acceptance/adoption/` (new) + `docs/evidence/F271/` + `pnpm-lock.yaml` (filtered-install mutation, left UNCOMMITTED per packet). No spec edits, no other lane's path touched (verified: all three acceptance-package suites re-run green after the last edit, §2).

Dependencies (`workspace:*`, the three acceptance packages ONLY, public entry points only — main barrels + their `./journeys` subpath exports): `@fleetos/acceptance-field`, `@fleetos/acceptance-security`, `@fleetos/acceptance-commerce`. NO direct imports of the edge/asset, security, or commerce lane packages — the adoption layer drives the acceptance packages, not the raw lanes (import scan in §7).

## 2. Baselines — machine-run BEFORE first edit, re-verified AFTER last edit

The three driven acceptance corpora at clean `1bbaef5`, before any edit and again after the last edit (identical counts — pre-existing suites untouched and green):

```text
packages/acceptance/field     5 files / 61 tests
packages/acceptance/security 16 files / 90 tests
packages/acceptance/commerce  4 files / 65 tests
```

## 3. Deliverables (all pure deterministic TS; logical `now`/caller-supplied inputs everywhere)

### 3.1 `src/industries.ts` (358 lines) — TEN industries as DATA

`IndustryDefinition` = stable id + display name + asset-profile mix (heavy-equipment/vehicle/fixed-asset/instrument integer weights, sum 100) + posture emphasis (`connectivity-edge` / `security-intelligence` / `work-commerce`, all three exercised) + applicability masks over the three corpora' journey ids + incumbent profile key. The masks are EXPLICIT EXCLUSIONS with recorded rationale (§4.4): an industry never silently inherits a journey it cannot honestly run; masked journeys are excluded from that industry's coverage denominator (never counted as covered, never as failed).

| Industry | Field masks | Commerce masks | Security masks | Applicable (of 42) |
|---|---|---|---|---|
| manufacturing | 0 | 0 | 0 | 42 |
| construction | 1 | 0 | 2 | 39 |
| energy-utilities | 0 | 0 | 0 | 42 |
| transportation-logistics | 2 | 2 | 2 | 36 |
| agriculture | 2 | 6 | 3 | 31 |
| healthcare-facilities | 4 | 3 | 3 | 32 |
| facilities-management | 3 | 3 | 3 | 33 |
| telecommunications | 1 | 3 | 0 | 38 |
| mining | 1 | 1 | 0 | 40 |
| water-waste | 1 | 3 | 0 | 38 |

Laws machine-tested: masks reference REAL journey ids; every masked journey carries a non-empty rationale; the handoff pair travels together (consume only with publish); the mobile-shape journey is applicable for EVERY industry; tenant-isolation journeys are never masked; honest subset (2 industries legitimately span the full 42, 8 do not).

### 3.2 `src/firms.ts` (117 lines) — the 30-workspace population

`FirmSize` = small | medium | large (typed). For EACH industry exactly 3 firms = 30 `FirmWorkspace`s, each with: stable id (`firm-<industry>-<size>`), industry id, size, a REAL per-firm tenant id, a logical-time epoch schedule (small 1 / medium 2 / large 3), and a device-population scale (25 / 350 / 4,200 devices — informational record fields, never fake telemetry). Unique ids, unique tenancy-scoped tenant ids, deterministic derivations — all machine-tested.

**Two REAL constraints discovered by machine experiment shape this population (seam findings §8):**

1. **Tenant format law:** the identity package's validator accepts only `^tnt_[A-Za-z0-9_-]{4,128}$`. The packet's example shape `tenant-<industry>-<size>` FAILS that REAL validator (`malformed-tenant-id` refusals — the fail-closed boundary working as designed). Per-firm tenant ids therefore use the REAL format: **`tnt_<industry>-<size>`** (e.g. `tnt_manufacturing-small`). The tenant dimension is REAL: machine-verified, the field corpus's edge-command-lifecycle and handoff-pair outcome digests are tenant-scoped (different firms produce different REAL digests).
2. **Epoch anchor law:** the F270A field corpus pins T0-anchored expectations (schedule next-runs, connectivity grants with fixed `grantedAt`/`expiresAt`, ADCOS command deadlines, staleness baselines). Machine-verified with the REAL runner: a **+1s** `startedAt` offset fails 1 journey (`recover-lost-device`), **+1h** fails 3 (`recover-lost-device`, `connectivity-postures`, `edge-command-lifecycle` — honest refusals `stale-authorization`/`invalid-deadline` plus time-shifted assertion mismatches), and **multi-day** offsets fail 12 of 14. The single machine-verified-supported logical epoch is the corpora's fixture epoch **T0 = 1_774_000_000_000** — so every declared epoch ANCHORS there (the declared epoch COUNT 1/2/3 is real data; the driver executes every declared epoch and proves the later ones byte-identical).

### 3.3 `src/incumbent.ts` (220 lines) — incumbent capability baselines as DATA

A 38-entry capability catalog (what each incumbent capability DOES + what it does NOT do — honest gaps) + per-industry incumbent stacks of NAMED GENERIC PROFILES (`incumbent-erp-suite`, `incumbent-cmam`, `incumbent-fsm`, `incumbent-scada-historian`, `incumbent-oss-bss`, `incumbent-agronomy-platform`, `incumbent-ehr-suite`, `incumbent-mine-planning-suite`, …). No vendor trademarks — archetypes only. Each capability carries a `replacementJourneyFamily` (journey ids whose PASSING would replace it); 10 catalog entries are honest incumbent MOATS (empty family: `bid-exchange`, `energy-market-trading`, `dispatch-routing-optimization`, `agronomy-prescriptive-analytics`, `clinical-workflow-integration`, `service-orchestration-inventory`, `space-and-workplace-management`, `building-plant-command`, `mine-planning-haul-optimization`, `network-hydraulic-modeling`) — FleetOS honestly claims no replacement for them. Exactly the 9 moat-bound industries carry ≥1 moat; manufacturing carries none (the SWITCH-ONLY inputs).

### 3.4 `src/adoption-run.ts` (359 lines) — the deterministic adoption driver

For each firm workspace, runs the industry-applicable corpus subsets through the REAL runners:

- **FIELD:** `runJourneyCorpus(applicable, { tenantId: firm.tenantId, startedAt: epoch anchor })` — one corpus pass per DECLARED epoch (1/2/3). Only epoch 1 is COUNTED; epochs ≥ 2 execute and are asserted byte-identical (per-firm repeatability evidence), never counted.
- **COMMERCE:** `runAllJourneys(applicable)` — the corpus-family runner (the packet's "`runJourneyCorpus(...)`-family"). NOT tenant/time-parameterizable (fixed deterministic world), so it runs ONCE per workspace; re-runs would be byte-identical and are never counted.
- **SECURITY:** `runJourney(journey)` per journey — single-parameter by design (packet law: once-per-workspace runs), never counted twice.

**Repeatability:** every firm's declared epochs ≥ 2 are asserted byte-identical to epoch 1; for ONE firm per industry (the large one) the FULL applicable set (field + commerce + security) is re-run and asserted byte-identical (the packet's determinism proof). Re-runs are NEVER counted in the journey-execution totals. Per-firm outcome sets are kept as REAL runner outputs (field/commerce/security outcome arrays + normalized execution facts with the runners' own digests — never re-computed, never summarized away).

**Count honesty law ("100+ repeatable journeys per firm where supported"):** a fully-applicable firm's COUNTED executions cap at 14 + 15 + 13 = **42 < 100** — every firm's exact shortfall is recorded in the honest-counts ledger with structural reasons (§4.3). NEVER inflated by counting re-runs.

### 3.5 `src/verdicts.ts` (230 lines) — the verdict rubric, DETERMINISTIC from REAL outcomes + incumbent baseline

`coverageRatio` = industry-applicable journeys PASSED / industry-applicable TOTAL (masked/unsupported journeys excluded from BOTH sides; a journey is PASSED iff ≥1 execution and zero failing executions). Documented thresholds (never tuned to flatter a result):

```text
RETAIN         — coverageRatio < 0.30 OR any CRITICAL journey fails honestly
                  (critical = a journey in a CORE incumbent capability's family;
                   a never-executed critical journey is fail-closed RETAIN too)
SWITCH-ONLY    — coverageRatio = 1.00 AND every incumbent capability (core+adjunct)
                  is "replaced" (full replacement)
MAIN-INTERFACE — coverageRatio ≥ 0.70 AND every CORE capability is "replaced"
COMPLEMENT     — coverageRatio ≥ 0.30 (runs alongside the incumbent)
```

Capability mapping status: `replaced` (≥1 applicable family journey AND all applicable family journeys passing) / `partial` (≥1 applicable but some failed or were never executed — listed) / `unmapped` (empty family = moat, or fully masked = out of scope). RETAIN is evaluated FIRST (fail-closed). A single honest failure is visible in the verdict inputs (`coverage.failing[]` carries the journey id + the REAL outcome's first failure note) — never hidden.

### 3.6 `src/report.ts` (297 lines) — adoption report assembly + digest + verify + tamper detection

Per-industry verdicts with exact inputs (ratios, failing journeys, unmapped capabilities), the 30-workspace population table with per-firm execution counts + per-firm verdicts, the honest-counts ledger, mobile validation per industry, cross-role-handoff results per industry, incumbent-vs-FleetOS capability comparison per industry, aggregate block, FNV-1a-family digest (local copy of the sibling packages' convention — `src/digest.ts`), `verifyAdoptionReport` recomputation, and canonical-JSON rendering.

### 3.7 Tests — 90 net-new, 7 files

`tests/industries.test.ts` (13), `tests/firms.test.ts` (12), `tests/incumbent.test.ts` (9), `tests/verdicts.test.ts` (26: every verdict computation path with fixture outcome sets, exact threshold boundaries 1.00/0.70/0.30/0.69/0.29, negative fixtures — a failing critical journey produces RETAIN with the failure visible, a failing adjunct journey stays visible without forcing RETAIN, a never-executed core journey is fail-closed RETAIN, determinism), `tests/adoption-run.test.ts` (10: counted-execution formulas, re-runs never counted, determinism proofs, honest shortfalls, REAL tenant threading), `tests/report.test.ts` (10: structure, mobile/handoff rows, incumbent comparison, digest + tamper ×5, deterministic rendering), `tests/simulation.test.ts` (10: THE REAL-RUN integration — full simulation over the REAL corpora once, aggregate assertions, verdict table, mobile/handoff validation, population mirror, ledger exactness, report verify).

## 4. Machine-verified simulation result (the honest numbers)

### 4.1 Aggregate

```text
industries: 10   workspaces: 30
COUNTED journey executions: 1113  (field 375 + commerce 387 + security 351)
raw field epoch re-runs executed but NOT counted: 375 (byte-identical, proven)
unique industry-applicable journeys: 371 (of 420 corpus-journey slots; 49 masked)
determinism proofs: 30/30 verified (every firm's re-runs byte-identical)
all counted executions PASSED: true (zero failures — honestly zero)
report digest: e1e86d4e (verifyAdoptionReport: true)
```

### 4.2 The per-industry verdict table (exact inputs)

| Industry | Verdict | Coverage | Unmapped capabilities (the verdict drivers) |
|---|---|---|---|
| manufacturing | **SWITCH-ONLY** | 42/42 = 1.00 | — (every incumbent capability mapped to passing families) |
| construction | **MAIN-INTERFACE** | 39/39 = 1.00 | bid-exchange (adjunct), mission-continuity (adjunct, masked family) |
| energy-utilities | **MAIN-INTERFACE** | 42/42 = 1.00 | energy-market-trading (adjunct moat) |
| transportation-logistics | **COMPLEMENT** | 36/36 = 1.00 | dispatch-routing-optimization (CORE moat), project-portfolio (adjunct, masked) |
| agriculture | **COMPLEMENT** | 31/31 = 1.00 | agronomy-prescriptive-analytics (CORE moat) |
| healthcare-facilities | **COMPLEMENT** | 32/32 = 1.00 | clinical-workflow-integration (CORE moat) |
| facilities-management | **MAIN-INTERFACE** | 33/33 = 1.00 | building-plant-command, space-and-workplace-management, settlement, org-analytics (all adjunct) |
| telecommunications | **COMPLEMENT** | 38/38 = 1.00 | service-orchestration-inventory (CORE moat) |
| mining | **MAIN-INTERFACE** | 40/40 = 1.00 | mine-planning-haul-optimization, asset-simulation, org-analytics (all adjunct) |
| water-waste | **MAIN-INTERFACE** | 38/38 = 1.00 | network-hydraulic-modeling, asset-simulation, settlement, org-analytics (all adjunct) |

Distribution: 1 SWITCH-ONLY, 5 MAIN-INTERFACE, 4 COMPLEMENT, **0 RETAIN** — honestly zero, because zero REAL journey executions failed on the corpora (every counted execution passed); RETAIN is machine-proven by the negative fixtures (a failing critical journey forces RETAIN with the failure visible; a never-executed core journey is fail-closed RETAIN). Every industry's coverage ratio is 1.00 because every applicable journey passed in every firm — the verdict DIFFERENTIATION comes from the incumbent baseline mapping, which is exactly the packet's rubric.

### 4.3 The honest-counts ledger (TL-critical)

Target: 100 counted journeys per firm. **No firm reaches it — the exact shortfall per firm is recorded, never inflated:**

| Firm | Counted executions | Shortfall |
|---|---|---|
| manufacturing ×3 | 42 | 58 |
| construction ×3 | 39 | 61 |
| energy-utilities ×3 | 42 | 58 |
| transportation-logistics ×3 | 36 | 64 |
| agriculture ×3 | 31 | 69 |
| healthcare-facilities ×3 | 32 | 68 |
| facilities-management ×3 | 33 | 67 |
| telecommunications ×3 | 38 | 62 |
| mining ×3 | 40 | 60 |
| water-waste ×3 | 38 | 62 |

Aggregate shortfall: 1887 (30 × 100 − 1113). Structural reasons recorded verbatim in every ledger entry:

1. **Field corpus (F270A) is the only parameterizable runner** (`runJourneyCorpus` takes tenantId + startedAt), but its journeys pin T0-anchored expectations — machine-verified: +1s offset fails 1 journey, +1h fails 3, multi-day fails 12 — so every declared epoch executes at the corpus fixture epoch `1774000000000` and only epoch 1 is counted (epochs ≥ 2 are byte-identical re-runs, proven per firm, never counted).
2. **Commerce corpus runner (`runAllJourneys`) is not tenant/time-parameterizable** — the corpus runs ONCE per workspace; re-runs are byte-identical and counting them would inflate (count-honesty law).
3. **Security corpus runner (`runJourney`) is single-parameter** (journey only) — once-per-workspace per the packet; re-runs are byte-identical and are not counted.
4. **Even under the packet's assumed full parameterization** (field + commerce × 3 epochs + security), a fully-applicable large firm would reach 14×3 + 15×3 + 13 = 126 counted executions; the REAL corpora support 14 + 15 + 13 = 42 — the shortfall is STRUCTURAL (runner/corpus shape), not a coverage gap.
5. Per-firm masked-journey count (industry applicability masks, rationale recorded — §4.4).

### 4.4 Applicability-mask rationales (per masked journey, as recorded in `src/industries.ts`)

49 masked entries across the 10 industries. Full rationale per masked journey (machine-verified non-empty):

- **construction** — field `mission-replay-resume`: construction work is project-scoped and stage-gated, not a recurring multi-stage mission campaign; the incumbent PMO tooling owns program scheduling. security `counterfactual-reasoning`: site analytics maturity targets incident investigation and corrective action; counterfactual replay of safety decisions is not a construction practice. security `benchmark-trust`: no third-party decision-benchmark feed is trusted on site.
- **transportation-logistics** — field `simulation-driven-experiment`: network simulation and route modeling live in the incumbent TMS planning suite; FleetOS is not the dispatch-planning system. field `mission-replay-resume`: transport operations are real-time dispatch, not durable multi-stage missions. commerce `stage-gated-project`: capital projects run in the incumbent PMO; logistics operations are continuous. commerce `org-optimization-review`: org-level analytics live in the incumbent BI stack. security `counterfactual-reasoning` / `benchmark-trust`: not fleet-operations practices.
- **agriculture** — field `simulation-driven-experiment`: crop/field modeling lives in the incumbent agronomy platform. field `mission-replay-resume`: operations are seasonal and episodic. commerce `stage-gated-project`, `software-entitlements`, `aurum-settlement-seam`, `external-catalog-sync`, `apify-actor-job`, `org-optimization-review`: small-farm orgs run these through the incumbent co-op/dealer/accounting network. security `counterfactual-reasoning` (the packet's worked example — agronomy what-if is the incumbent platform's domain), `benchmark-trust` (no trusted benchmark feed for field decisions), `agent-safety` (no in-house autonomous agents; machinery autonomy is OEM-embedded).
- **healthcare-facilities** — field `field-mode-offline-tolerance`: hospital campuses provide managed indoor connectivity; the incumbent CMAM is certified connected-only. field `edge-command-lifecycle`: remote command of networked medical devices is regulatorily excluded — FleetOS observes and triages only. field `simulation-driven-experiment` / `mission-replay-resume`: incumbent clinical-engineering tooling. commerce `aurum-settlement-seam` (EDI clearinghouse), `apify-actor-job`, `org-optimization-review`. security `counterfactual-reasoning`, `benchmark-trust`, `agent-safety`: not practiced in regulated clinical environments.
- **facilities-management** — field `edge-command-lifecycle`: building-equipment command paths belong to the incumbent BAS; FleetOS advises and records, never commands building plant. field `simulation-driven-experiment`, `mission-replay-resume`. commerce `apify-actor-job`, `org-optimization-review`, `aurum-settlement-seam`. security `counterfactual-reasoning`, `benchmark-trust`, `agent-safety`.
- **telecommunications** — field `simulation-driven-experiment`: network planning simulation lives in the incumbent OSS planning suite. commerce `apify-actor-job`, `aurum-settlement-seam` (interconnect settlement in the incumbent BSS), `org-optimization-review`.
- **mining** — field `simulation-driven-experiment`: haul and mine simulation live in the incumbent mine-planning suite. commerce `org-optimization-review`.
- **water-waste** — field `simulation-driven-experiment`: hydraulic/network modeling lives in the incumbent modeling suite. commerce `apify-actor-job`, `org-optimization-review`, `aurum-settlement-seam` (billing in the incumbent CIS).

### 4.5 The 30-workspace population table (per-firm execution counts)

| Firm | Size | Tenant (REAL) | Devices | Epochs | Field | Commerce | Security | Total | Verdict | Shortfall |
|---|---|---|---|---|---|---|---|---|---|---|
| firm-manufacturing-small | small | tnt_manufacturing-small | 25 | 1 | 14 | 15 | 13 | 42 | SWITCH-ONLY | 58 |
| firm-manufacturing-medium | medium | tnt_manufacturing-medium | 350 | 2 | 14 | 15 | 13 | 42 | SWITCH-ONLY | 58 |
| firm-manufacturing-large | large | tnt_manufacturing-large | 4200 | 3 | 14 | 15 | 13 | 42 | SWITCH-ONLY | 58 |
| firm-construction-small | small | tnt_construction-small | 25 | 1 | 13 | 15 | 11 | 39 | MAIN-INTERFACE | 61 |
| firm-construction-medium | medium | tnt_construction-medium | 350 | 2 | 13 | 15 | 11 | 39 | MAIN-INTERFACE | 61 |
| firm-construction-large | large | tnt_construction-large | 4200 | 3 | 13 | 15 | 11 | 39 | MAIN-INTERFACE | 61 |
| firm-energy-utilities-small | small | tnt_energy-utilities-small | 25 | 1 | 14 | 15 | 13 | 42 | MAIN-INTERFACE | 58 |
| firm-energy-utilities-medium | medium | tnt_energy-utilities-medium | 350 | 2 | 14 | 15 | 13 | 42 | MAIN-INTERFACE | 58 |
| firm-energy-utilities-large | large | tnt_energy-utilities-large | 4200 | 3 | 14 | 15 | 13 | 42 | MAIN-INTERFACE | 58 |
| firm-transportation-logistics-small | small | tnt_transportation-logistics-small | 25 | 1 | 12 | 13 | 11 | 36 | COMPLEMENT | 64 |
| firm-transportation-logistics-medium | medium | tnt_transportation-logistics-medium | 350 | 2 | 12 | 13 | 11 | 36 | COMPLEMENT | 64 |
| firm-transportation-logistics-large | large | tnt_transportation-logistics-large | 4200 | 3 | 12 | 13 | 11 | 36 | COMPLEMENT | 64 |
| firm-agriculture-small | small | tnt_agriculture-small | 25 | 1 | 12 | 9 | 10 | 31 | COMPLEMENT | 69 |
| firm-agriculture-medium | medium | tnt_agriculture-medium | 350 | 2 | 12 | 9 | 10 | 31 | COMPLEMENT | 69 |
| firm-agriculture-large | large | tnt_agriculture-large | 4200 | 3 | 12 | 9 | 10 | 31 | COMPLEMENT | 69 |
| firm-healthcare-facilities-small | small | tnt_healthcare-facilities-small | 25 | 1 | 10 | 12 | 10 | 32 | COMPLEMENT | 68 |
| firm-healthcare-facilities-medium | medium | tnt_healthcare-facilities-medium | 350 | 2 | 10 | 12 | 10 | 32 | COMPLEMENT | 68 |
| firm-healthcare-facilities-large | large | tnt_healthcare-facilities-large | 4200 | 3 | 10 | 12 | 10 | 32 | COMPLEMENT | 68 |
| firm-facilities-management-small | small | tnt_facilities-management-small | 25 | 1 | 11 | 12 | 10 | 33 | MAIN-INTERFACE | 67 |
| firm-facilities-management-medium | medium | tnt_facilities-management-medium | 350 | 2 | 11 | 12 | 10 | 33 | MAIN-INTERFACE | 67 |
| firm-facilities-management-large | large | tnt_facilities-management-large | 4200 | 3 | 11 | 12 | 10 | 33 | MAIN-INTERFACE | 67 |
| firm-telecommunications-small | small | tnt_telecommunications-small | 25 | 1 | 13 | 12 | 13 | 38 | COMPLEMENT | 62 |
| firm-telecommunications-medium | medium | tnt_telecommunications-medium | 350 | 2 | 13 | 12 | 13 | 38 | COMPLEMENT | 62 |
| firm-telecommunications-large | large | tnt_telecommunications-large | 4200 | 3 | 13 | 12 | 13 | 38 | COMPLEMENT | 62 |
| firm-mining-small | small | tnt_mining-small | 25 | 1 | 13 | 14 | 13 | 40 | MAIN-INTERFACE | 60 |
| firm-mining-medium | medium | tnt_mining-medium | 350 | 2 | 13 | 14 | 13 | 40 | MAIN-INTERFACE | 60 |
| firm-mining-large | large | tnt_mining-large | 4200 | 3 | 13 | 14 | 13 | 40 | MAIN-INTERFACE | 60 |
| firm-water-waste-small | small | tnt_water-waste-small | 25 | 1 | 13 | 12 | 13 | 38 | MAIN-INTERFACE | 62 |
| firm-water-waste-medium | medium | tnt_water-waste-medium | 350 | 2 | 13 | 12 | 13 | 38 | MAIN-INTERFACE | 62 |
| firm-water-waste-large | large | tnt_water-waste-large | 4200 | 3 | 13 | 12 | 13 | 38 | MAIN-INTERFACE | 62 |

### 4.6 Mobile validation (per industry)

All 10 industries have field applicability, and the field corpus's mobile-shape journey (`mobile-field-shape`) is applicable + PASSING for every one of them (3 counted executions each — one per firm): manufacturing ✓, construction ✓, energy-utilities ✓, transportation-logistics ✓, agriculture ✓, healthcare-facilities ✓, facilities-management ✓, telecommunications ✓, mining ✓, water-waste ✓. Zero industries lacked field applicability (the honest recorder for that case exists and is exercised by the report shape — `hasFieldApplicability: false` rows would record it, never silently skipping).

### 4.7 Cross-role handoff validation (per industry)

The handoff family per industry — `handoff-field-to-operator-publish` + `handoff-field-to-operator-consume` (the field chain, runner-threaded) + `cross-role-handoff` (commerce) — is applicable + PASSING for all 10 industries, 3 counted executions each. The mask law that consume only travels with publish is machine-tested; no industry masks any handoff journey.

### 4.8 Incumbent-vs-FleetOS capability comparison

Per industry, the report carries every incumbent capability with (a) what the incumbent DOES, (b) what it does NOT do, (c) the FleetOS mapping status (`replaced`/`partial`/`unmapped`), and (d) its journey family. Example (agriculture): `agronomy-prescriptive-analytics` — incumbent does crop modeling and prescriptive agronomy, does not cover machinery-level evidence chains, FleetOS `unmapped` (empty family, CORE moat → COMPLEMENT verdict driver); `maintenance-planning` — FleetOS `replaced` via `maintain-asset-schedule` + `workload-allocation`.

## 5. Machine-verified gates (exact, in the package dir)

```text
corepack pnpm run test
  Test Files  7 passed (7)      Tests  90 passed (90)          # PASS (≥ 50 net-new)
corepack pnpm run typecheck
  # no output, exit 0                                          # PASS
corepack pnpm run lint
  Found 0 warnings and 0 errors. Finished in 11ms on 15 files using 2 threads.   # PASS
```

## 6. Boundary verification (machine-tested)

- Import scan over src+tests → ONLY `@fleetos/acceptance-field`, `@fleetos/acceptance-security`, `@fleetos/acceptance-commerce` (main barrels + their public `./journeys` subpath exports). NO direct imports of any lane package; no deep paths.
- Determinism sweep → CLEAN (no `Date.now`, `Math.random`, `new Date`, timers, `fetch` in src+tests); logical `now` caller-supplied throughout (the epoch anchor and all fixture times are constants).
- File law → largest source file 359 lines (`src/adoption-run.ts`); all src+tests ≤ 400.
- `git status` → exactly `packages/acceptance/adoption/**` + `docs/evidence/F271/**` + `pnpm-lock.yaml` (uncommitted per packet).

## 7. Test-count accounting

90 net-new tests (7 files), against the packet's ≥ 50 floor: industries 13, firms 12, incumbent 9, verdicts 26 (incl. 5 negative fixtures), adoption-run 10, report 10, simulation (the REAL-run integration) 10.

## 8. Seam findings (TL-relevant)

1. **Tenant-id format law vs the packet's example:** the packet's `tenant-<industry>-<size>` shape fails the identity package's REAL `^tnt_...` validator (`malformed-tenant-id` — the fail-closed boundary). The adoption layer derives per-firm tenant ids as `tnt_<industry>-<size>`; the deviation is documented + machine-tested. The corpus runs clean under every such tenant.
2. **The field corpus is T0-calibrated, not offset-portable:** `runJourneyCorpus`'s `startedAt` parameter exists, but the journeys' pinned expectations (schedules, grants, deadlines, staleness baselines) hold ONLY at the fixture epoch T0. Machine evidence: +1s → 1 failing journey; +1h → 3; multi-day → 12 (honest refusals `stale-authorization`, `invalid-deadline`, and time-shifted assertion mismatches). Consequence: the epoch dimension executes as byte-identical re-runs (counted once), and the honest-counts ledger records the structural shortfall. If the TL wants TRUE multi-epoch corpora, the F270A journeys need relative-time assertions — a Worker-A work item, not an adoption-layer fix.
3. **Commerce runner is not parameterizable:** `runAllJourneys`/`runJourney` build a fixed deterministic world (fixed tenant `acme`, fixed logical clock) — no tenant/time surface. The adoption layer runs it once per workspace and records the shortfall honestly. A `runJourneyCorpus(journeys, {tenantId, startedAt})`-shaped commerce runner would be the seam to adjudicate.
4. **Security runner is single-parameter** (journey only) — per the packet, once-per-workspace; recorded as shortfall, never re-counted.
5. **Digest conventions differ across the corpora** (field: 8-hex; security/commerce: `journey_`-prefixed hex) — the adoption report digests with the FNV-1a family convention copied locally (same seam decision as F270A/B/C).

## 9. Honest residuals

1. **No firm reaches 100 counted journey executions** (max 42) — structural, machine-recorded (§4.3). The packet's "100+ where supported" is satisfied honestly: it is NOT supported by the REAL corpora's shapes.
2. **Verdict differentiation rests on the incumbent baseline DATA** (which capabilities each industry's incumbent stack claims, and which are moats). The masks + moats are authored industry reasoning, documented per entry and machine-tested for well-formedness — but they are judgments, and TL may re-adjudicate any of them by editing DATA (no logic change).
3. RETAIN never appears in the REAL run (zero real failures) — machine-proven only via negative fixtures. If a real journey ever fails on these corpora, the verdict computation surfaces it (failing journey + REAL failure note in the verdict inputs).
4. Device-population fields are informational records (25/350/4200) — never fake telemetry; the corpora have no device-count parameterization.
5. Digests are FNV-1a 32-bit (the acceptance-family convention — evidence-grade, not crypto).
6. Root gates (full `pnpm -r test`, snapshot:check, architecture:check) NOT run — per packet, TL merge-time.
7. `pnpm-lock.yaml` carries the filtered-install entry for the new package — left UNCOMMITTED per packet (TL decides at merge, same as F270A).

## 10. Verification commands for TL re-run

```bash
cd <repo checkout> && git checkout work/f271
corepack pnpm install --filter @fleetos/acceptance-adoption --prefer-offline --ignore-scripts
cd packages/acceptance/adoption
corepack pnpm run test        # 7 files / 90 tests (includes the REAL full-corpus simulation)
corepack pnpm run typecheck   # exit 0
corepack pnpm run lint        # 0 warnings, 0 errors
grep -rEn "from ['\"]@fleetos/" src tests | grep -vE "@fleetos/acceptance-(field|security|commerce)" || echo CLEAN
# baseline spot-check (unmodified corpora):
cd ../field && corepack pnpm run test        # 61/61
cd ../security && corepack pnpm run test     # 90/90
cd ../commerce && corepack pnpm run test     # 65/65
```
