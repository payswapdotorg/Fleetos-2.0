# F281 — TL Lane — Production Release Gate / Observability / Cost Controls Evidence

- **Work item:** F281 — production release gate / observability / cost controls (Wave 8 TL lane; catalog: `spec/work-items/WORK-ITEM-CATALOG.md`)
- **Owner:** Worker F281 (executes under the TL grant — the F261/F271 precedent; `spec/worker-ownership.yaml` tl section; worker-ownership.yaml NOT edited)
- **Base commit:** `8bcb92e` ("TL: dispatch packet F281 — production release gate / observability / cost controls (Wave 8 TL lane)", origin/main HEAD — verified with `git log --oneline -1` before branching)
- **Branch:** `work/f281`
- **Date:** 2026-10-09
- **Task ID:** `9-tl`

## 1. Owned paths touched

Per the packet's hard boundary (TL acceptance lane, the F271 precedent):

- `packages/acceptance/release/**` — NEW package `@fleetos/acceptance-release` (private, Apache-2.0, type: module; exports map `.` + `./observability` + `./cost` + `./gate`): `src/observability.ts`, `src/cost.ts`, `src/release-gate.ts`, `src/digest.ts`, `src/index.ts` + 5 test files (`tests/fixtures.ts` REAL-output builders, `tests/observability.test.ts`, `tests/cost.test.ts`, `tests/release-gate.test.ts`, `tests/integration.test.ts`).
- `docs/evidence/F281/**` (this report).

`git status` at commit time shows exactly `packages/acceptance/release/` (new) + `docs/evidence/F281/` + `pnpm-lock.yaml` (filtered-install mutation, left UNCOMMITTED per packet). No spec edits, no other lane's path, no `spec/worker-ownership.yaml` edit.

Dependencies (`workspace:*`, public entry points only — root barrels + the acceptance packages' public `./journeys` subpath exports; import scan in §6): the four acceptance packages (`@fleetos/acceptance-field`, `@fleetos/acceptance-security`, `@fleetos/acceptance-commerce`, `@fleetos/acceptance-adoption`) + the seven hardened lane packages the evidence reports gate over (`@fleetos/security`, `@fleetos/execution`, `@fleetos/vendors`, `@fleetos/observations`, `@fleetos/connectivity`, `@fleetos/model-gateway`, `@fleetos/procurement`). NO new runtime deps; devDeps typescript + vitest only. Install-order note (the F280A artifact): the packet's `--filter @fleetos/acceptance-release` (without `...`) does not link transitive workspace deps — the recursive `--filter @fleetos/acceptance-release...` form links the full closure (dependency-linking artifact, not a code failure; documented honestly).

## 2. Baselines — machine-run BEFORE first edit (recorded) and re-verified AFTER last edit

The new package touches NO existing suite (a pure addition — the before-state is the recorded green of the Wave-7/8 evidence). All four acceptance baselines were machine re-run AFTER the last edit on this branch — identical counts, no regressions:

```text
packages/acceptance/field     5 files / 61 tests   ✓ held (61 passed)
packages/acceptance/security 16 files / 90 tests  ✓ held (90 passed)
packages/acceptance/commerce  4 files / 65 tests  ✓ held (65 passed)
packages/acceptance/adoption  7 files / 90 tests  ✓ held (90 passed — includes the REAL full-corpus simulation)
```

## 3. Deliverables (all pure deterministic TS; logical `now`/caller-supplied inputs everywhere)

### 3.1 `src/observability.ts` (443 raw / 332 counted lines) — deterministic system-status rollups over the REAL hardened surfaces

- **Per-lane status records assembled from REAL package outputs** — each `LaneSignal` IS a REAL output of the owning F280A/B/C module; the rollup never re-runs, re-scores or re-computes a lane's numbers:
  - `audit-ledger` — `AuditVerification` (`@fleetos/security verifyAuditLedger`, F280B D1);
  - `incident-replay` — `IncidentReplayResult` (`@fleetos/execution replayIncident`, F280B D2) + `ReplayDivergence` (`diffIncidentReplays` — the equivalence outcome);
  - `sla-scorecard` — `SlaScorecardResult` (`@fleetos/vendors buildSlaScorecard`, F280C 3.1);
  - `ingestion-admission` — `AdmissionCapDecision` (`@fleetos/observations checkTenantAdmission`, F280A 3.1);
  - `offline-replay` — `OfflineReplayReport` (`@fleetos/connectivity replayOfflineBuffer`, F280A 3.2).
- **Every field traces to a REAL output** — each `LaneStatusField` carries the exact source field it was copied from (`AuditVerification.checkedEntries`, `SlaScorecard.availabilityBps`, `OfflineReplayReport.replayDigest`, …), and each record's `source` names the REAL module + function + output type. The only derived numbers are the documented COUNTS (`healthyLaneCount` / `degradedLaneCount` — counts of REAL records).
- **Degraded reason codes surface VERBATIM**: `audit.gap` / `audit.payload_digest_mismatch` (REAL AuditBreakReason), `replay.tenant-mismatch` / `replay.ledger-refused` (REAL ReplayRefusalCode), `penalty` / `availability-breach` (REAL SlaScorecardStatus), `tenant-cap-exceeded` (REAL AdmissionCapDecision reason), `posture-changed-while-offline` (REAL OfflineDivergenceRecord reason); a divergent equivalence outcome surfaces the REAL `DivergenceField` class with expected/actual pinned.
- **Tenant fail-closed (A8)**: empty view tenant, zero lanes, duplicate lane kind, a lane paired to a foreign tenant, or a REAL output's own tenant disagreeing with its pairing → the WHOLE rollup refuses (`TENANT_ID_EMPTY` / `NO_LANES` / `DUPLICATE_LANE` / `LANE_TENANT_MISMATCH`) naming the offender — never a silently filtered lane.
- **Canonical lane order** (the `LANE_IDS` vocabulary order — input order never leaks; machine-tested with permuted input), FNV-1a status digest + `verifySystemStatus` tamper detection.

### 3.2 `src/cost.ts` (350 raw / 224 counted lines) — cost controls over the REAL usage ledgers

- **Budget ceilings per the F280C cost-allocation outputs** — `deriveCeilingFromAllocation(CostAllocationResult)`: the ceiling is the allocation's REAL exact-sum total (`totalAllocatedMinorUnits`); a REFUSED allocation refuses the derivation with the REAL procurement reasonCode verbatim (`ALLOCATION_REFUSED` — a ceiling is never invented from a failed allocation). Caller-declared ceilings carry their own provenance (`BudgetCeiling.source` / `sourceRef`).
- **Deterministic enforcement** — `enforceBudgetCeiling({tenantId, actuals, ceiling})` where `actuals` is the REAL `BurnActuals` (the usage ledger's own sums with entry-seq refs — `projectBudgetBurn(...).projection.actuals`): OVER-CEILING IS A REFUSAL (`reasonCode: "OVER_CEILING"`) carrying the full check record with the REAL numbers (ceiling, actual, over-by, entry-seq count) — `remainingMinor` is NEGATIVE when over, never clamped, never silent. Boundary: `actual == ceiling` is WITHIN (tested at the exact edge). Validation refusals for non-integer/negative ceilings and amounts.
- **Burn-rate rollups from the REAL budget-burn projections** — `rollUpBudgetBurns`: every number is a Σ or count of REAL `BudgetBurnProjection` fields (documented per field): Σ actuals, Σ projected, Σ projectedRemaining (negative allowed), breach/warning counts, worst REAL severity, assumption count. Foreign-tenant projections refuse naming the offender index.
- **Cost posture view (presented verbatim BY REFERENCE — never recomputed)** — `buildCostPosture` presents the REAL projections array BY REFERENCE (machine-tested with reference identity; post-hoc mutation of a referenced projection is DETECTED by the digest recompute). Health law (documented): `ceiling-breached` iff any enforcement check is over-ceiling OR any REAL projection severity is "breach"; else `warning`; else `within-budget`. Fail-closed on empty tenant / no budgets / no checks / foreign budgets or checks. FNV-1a cost digest + `verifyCostPosture`.

### 3.3 `src/release-gate.ts` (411 raw / 313 counted lines) — the production release gate

- **A boolean gate with named blockers — NO weighted scores, NO partial readiness**: `evaluateReleaseGate` returns `READY` iff `blockers.length === 0`; otherwise `NOT-READY` with the exact blocking reasons. Every blocker NAMES ITS SOURCE RECORD (`system-status.lanes[audit-ledger]`, `cost-posture.checks[0] (cost-allocation)`, `cost-posture.budgets[1]`, `acceptance.field`, …) and carries the REAL reason code / numbers verbatim in `detail`.
- **READY requires ALL of**: every required lane present (default: all five hardened lanes) AND healthy; every acceptance baseline count present and green AND untampered AND count-exact; no budget ceiling breached (over-ceiling enforcement checks and REAL projection severity `breach` both block; warnings do NOT — documented). The cost/observability views must be digest-verified and tenant-matched to the gate (`STATUS_TAMPERED` / `COST_TAMPERED` / `STATUS_TENANT_MISMATCH` / `COST_TENANT_MISMATCH`).
- **Acceptance baselines = the REAL corpora reports** — the gate consumes the REAL report values (`AcceptanceReport` field / security, `JourneyReport` commerce, `AdoptionReport` adoption-F271) and re-verifies each with the OWNING package's REAL digest verify function. The EXPECTED counts are the REAL exported corpus lengths (`FIELD_JOURNEYS` 14 / `SECURITY_JOURNEYS` 13 / `JOURNEYS` 15 / `WORKSPACE_POPULATION` 30) — imported from the packages, never hardcoded; a short corpus reports `ACCEPTANCE_COUNT_MISMATCH` with expected vs carried counts.
- **Tamper detection on the gate inputs — a tampered record fails loudly**: tampered status view → `STATUS_TAMPERED`; tampered posture → `COST_TAMPERED`; tampered corpus report → `ACCEPTANCE_TAMPERED` (each named). A tampered REAL lane output (mutated audit event) propagates end-to-end to a `LANE_DEGRADED` blocker carrying the REAL break reason (machine-tested).
- **Total + deterministic** (never throws): every failure mode is a blocker; empty tenant short-circuits to exactly one `TENANT_ID_EMPTY` blocker (fail-closed — no signal evaluated without a tenant scope). Documented evaluation order: tenant → status → cost → acceptance (field, security, commerce, adoption); per corpus: missing → tampered → count → failed. FNV-1a gate digest + `verifyReleaseGateVerdict`.

### 3.4 `src/index.ts` (barrel) + `src/digest.ts` (local FNV-1a / canonical-JSON copy — the acceptance-family seam decision, same as F271)

### 3.5 Tests — 88 net-new (4 files + fixtures), against the packet's ≥ 50 floor

`tests/observability.test.ts` (22): healthy per-lane assembly with VERBATIM field tracing (one test per lane — every field asserted equal to the REAL output value it names), degraded propagation with the reason code VERBATIM (audit gap / payload tamper, replay refusal / divergence, SLA penalty, admission over-cap, offline divergence — each asserting the REAL code), degraded count propagation, tenant fail-closed ×3 (paired foreign, carried-vs-paired disagreement, empty), duplicate lane, no lanes, canonical order (permuted input → byte-identical), digest + tamper, byte-identical re-runs.
`tests/cost.test.ts` (21): within/over/boundary-exact enforcement with REAL numbers, OVER_CEILING refusal form, validation codes, allocation-derived ceiling (REAL total + REFUSED allocation with the REAL procurement code), the REAL exact-sum law on awkward thirds, rollup Σ/counts exact over REAL projections, worst-severity escalation, tenant fail-closed (budgets + checks), posture BY REFERENCE (identity), post-hoc reference-mutation detection, health transitions, digest + tamper, determinism, usage-ledger provenance (entry seqs traceable).
`tests/release-gate.test.ts` (35): the all-green READY over the REAL corpora (run once at module scope: field 14 / security 13 / commerce 15 + the FULL F271 adoption simulation), determinism; EACH single lane degradation → NOT-READY with the NAMED blocker (5 tests), missing lane, custom requiredLanes (presence-only relaxation; a degraded present lane still blocks), status refused / tampered / tenant-mismatch, cost refused / tampered / tenant-mismatch, ceiling breach by enforcement check AND by REAL projection severity (REAL numbers in detail), warning does NOT breach, acceptance missing ×4 (each corpus), tampered ×2 (field, adoption), digest-consistent FAILING reports ×3 (field, security, adoption — mutated content RESEALED with the owning package's own digest primitive, honestly carrying failures), count mismatch ×4 (field 13/14, security 12/13, commerce 14/15, adoption 29/30), multi-degradation blocker completeness, empty-tenant short-circuit, verdict tamper.
`tests/integration.test.ts` (10): THE REAL-RUN — every lane signal and cost input is a REAL output over REAL records (REAL audit ledger via `appendAuditEvent`; REAL execution ledger via `appendExecutionLedger` + REAL `replayIncident` re-replay + `diffIncidentReplays`; REAL `evaluateSla` → `buildSlaScorecard`; REAL admission caps; REAL offline-buffer capture/replay; REAL usage ledger via `appendUsage` → REAL `projectBudgetBurn`; REAL `allocateCostAcrossWorkOrders` → derived ceiling → enforcement) + the four REAL acceptance reports → gate verdict READY, every digest verifies, byte-identical re-evaluation, honest-field spot-proof (lane field values equal the REAL outputs they name), end-to-end tamper propagation to a named blocker, warning-band READY, digest-convention parity with the adoption family.

## 4. Machine-verified gate outputs (exact, in the package dir)

```text
corepack pnpm run test
  Test Files  4 passed (4)      Tests  88 passed (88)          # PASS (≥ 50 net-new required)
  Duration  5.33s (includes TWO full F271 adoption simulations, one per gate/integration file)
corepack pnpm run typecheck
  # no output, exit 0                                          # PASS
corepack pnpm run lint
  Found 0 warnings and 0 errors. Finished in 13ms on 10 files using 2 threads.   # PASS
```

## 5. Test-count accounting

```text
observability 22 + cost 21 + release-gate 35 + integration 10  = 88 net-new (floor ≥ 50)
  (+ tests/fixtures.ts — REAL-output builders, not a test file; 371 counted lines, lint-green)
```

## 6. Boundary verification (machine-tested)

- **Import scan** over src+tests → ONLY the eleven declared packages, public entry points only: the four acceptance roots + `@fleetos/acceptance-{field,security,commerce}/journeys` (public subpath exports) + the seven lane-package root barrels. NO deep paths, NO other lane package, NO @fleetos/actions import (see §7-S4).
- **Determinism sweep** → CLEAN (no `Date.now`, `Math.random`, `new Date(`, timers, `fetch` in src+tests; logical times are constants — T0 = 1_774_000_000_000, the corpora fixture epoch).
- **File law** → all files pass oxlint `max-lines 400` (skipBlankLines+skipComments — the green lint gate proves it): observability.ts 443 raw / 332 counted; release-gate.ts 411 raw / 313 counted; cost.ts 350 raw / 224 counted. Test files exempt per the repo's `.oxlintrc.json` override (fixtures.ts 371 counted — under 400 even unexempt).
- **`git status`** → exactly `packages/acceptance/release/**` (new) + `docs/evidence/F281/**` + `pnpm-lock.yaml` (UNCOMMITTED per packet). No spec edits; `spec/worker-ownership.yaml` untouched.
- **Baselines** → all four acceptance suites re-run green AFTER the last edit (§2).

## 7. Seam findings (TL-relevant)

1. **Tenant-less REAL outputs need a caller-recorded pairing**: `AuditVerification` and `AdmissionCapDecision` carry no tenant field (their owning modules scope tenants at the INPUT level). The lane signal therefore records the caller's tenant pairing; where a REAL output DOES carry its own tenant (scorecard, offline report, successful replay), the rollup cross-checks pairing vs the carried tenant and refuses on disagreement (`LANE_TENANT_MISMATCH`) — the pairing can never lie about a self-scoped output.
2. **Divergent-replay degraded reason**: `ReplayDivergence` has no reason code (it is a field-class pin). The rollup surfaces the REAL `DivergenceField` class verbatim as the degraded reason with `expected`/`actual`/`stepIndex` in the fields. If the TL prefers a dedicated reason vocabulary for equivalence failures, the change is one line in `replayLane`.
3. **Expected acceptance counts are the packages' own exported corpus lengths** (`FIELD_JOURNEYS.length` etc.) — never hardcoded numbers, so corpora growth tracks automatically. The adoption baseline's "count" is the REAL workspace population (30) with `journeyExecutions > 0`; its green law additionally requires `allJourneysPassed` + `determinismVerified` (REAL aggregate booleans). Adoption VERDICTS (RETAIN etc.) are deliberately NOT gate inputs — the F271 rubric is the adoption layer's; the release gate gates deployment readiness.
4. **Journal events for the incident-replay surface are test-literals, not @fleetos/actions emissions**: the packet's import boundary lists the acceptance packages + the hardened lane packages; `@fleetos/execution`'s replay requires journal events whose REAL emitter lives in `@fleetos/actions` (a lane-B dependency, not in my declared closure). Tests construct structurally-compatible records; the replay itself is executed by the REAL `replayIncident` either way. If the TL prefers REAL `emitAuditEvent` records, adding `@fleetos/actions` to devDeps is mechanical.
5. **Projection-breach blocks the gate** (documented decision): a REAL burn projection with `severity: "breach"` blocks as `CEILING_BREACHED` alongside enforcement-check breaches (the F280C severity law means projectedCost > ceiling); warnings do NOT block (under-ceiling by the projection's own law). Conservative reading of the packet's "no budget ceiling is breached".
6. **Digest convention**: local FNV-1a copy (`src/digest.ts`) — the same TL-hoisting seam as F270A/B/C and F271 (canonical home remains TL-owned tower-core).
7. **Corpus reports are corpus-level, not tenant-scoped** (the acceptance corpora run fixed deterministic worlds — the F271 finding). The gate's tenant scope therefore applies to the status + cost views (cross-checked: `STATUS_TENANT_MISMATCH` / `COST_TENANT_MISMATCH`), while acceptance baselines are global corpus gates. Documented in the gate header.

## 8. Honest residuals

1. The gate consumes ASSEMBLED views — pure reference-path functions (no persistence, no I/O); record retrieval, persistence and pipeline wiring (e.g. sealing the audit head anchor, persisting the F271 report) belong to the composing application.
2. The adoption baseline for READY requires the F271 report — the full simulation costs ~3–6 s per run; a deployment pipeline should assemble it once and feed the report value (the gate NEVER re-runs the simulation itself).
3. The audit lane inherits F280B's documented tail-truncation blind spot: an unanchored ledger verifies after tail truncation. Anchoring (`sealAuditLedgerHead` + `verifyAuditLedgerAgainstAnchor`) is caller composition; the rollup surfaces `verifyAuditLedger` results as-is.
4. Digests are FNV-1a 32-bit (the acceptance-family convention — evidence-grade, not crypto).
5. Root gates (full `pnpm -r test`, `architecture:check`, `snapshot:check`) NOT run — TL merge-time per packet; the four acceptance baselines were machine re-run instead (§2).
6. `pnpm-lock.yaml` carries the filtered-install entries for the new package — left UNCOMMITTED per packet (TL decides at merge, same as F270A/F271).
7. The worklog entry for Task ID 9-tl is appended to the session worklog (`/home/z/my-project/worklog.md`).

## 9. Verification commands for TL re-run

```bash
cd <repo checkout> && git checkout work/f281
corepack pnpm install --filter @fleetos/acceptance-release... --prefer-offline --ignore-scripts
cd packages/acceptance/release
corepack pnpm run test        # 4 files / 88 tests (includes TWO full F271 adoption simulations)
corepack pnpm run typecheck   # exit 0
corepack pnpm run lint        # 0 warnings, 0 errors
# baselines (unmodified corpora):
cd ../field     && corepack pnpm run test   # 61/61
cd ../security  && corepack pnpm run test   # 90/90
cd ../commerce  && corepack pnpm run test   # 65/65
cd ../adoption  && corepack pnpm run test   # 90/90
# boundary checks:
rg -o "from \"@fleetos/[a-z-]+[a-z/-]*\"" packages/acceptance/release/src packages/acceptance/release/tests | sort -u
rg -n "Date\.now|Math\.random|new Date\(|setInterval|setTimeout|fetch\(" packages/acceptance/release/src packages/acceptance/release/tests || echo CLEAN
cd <repo> && git status --short   # exactly release/** + evidence/F281/** + pnpm-lock.yaml (uncommitted)
```
