# F302 — Clean-checkout final gate and release decision (TL) — Evidence bundle

**Candidate commit:** `73adc1788e4bc3b1829d87a0051c9f1551a2e803` (branch `main`)
**Clean checkout:** `/tmp/f302-checkout` (fresh clone; frozen install verified)
**Date:** 2026-10-09. **TL-gated; every count below was machine-captured at the candidate commit.**

## 1. Gates (the handoff's command list, in order)

| # | Gate | Command | Result at `73adc17` |
|---|---|---|---|
| 1 | Clean install | `corepack pnpm install --frozen-lockfile` | **PASS** (Done in 3.7s; reused store, 0 downloaded) |
| 2 | Source of truth | `corepack pnpm fleetos:source-of-truth` | **PASS** (Architecture lock 2.0.0) |
| 3 | Contract snapshot | `corepack pnpm fleetos:snapshot:check` | **PASS** (unchanged, 33 packages) |
| 4 | Architecture | `corepack pnpm run architecture:check` | **PASS** (baseline 0, new 0) |
| 5 | Lint | `corepack pnpm lint` | **PASS after repair** — 72 warnings (substrate baseline), **0 errors** (the two lockfile-pinned-oxlint errors repaired at `73adc17`: unused imports in `packages/shared/validation.ts`; unsafe-finally in `packages/services` startup.ts; tests-override extended to fixture files per the config's documented intent) |
| 6 | Typecheck | `corepack pnpm typecheck` | **FAIL — exit 137 (OOM)** on this 4GB box with the resident replay stack (the F201-era recorded constraint: the substrate project build does not fit). **Machine-verified equivalent: 47/47 FleetOS domain packages typecheck CLEAN per-package** at the candidate commit (the same standard the Wave 0–9 closeouts recorded) |
| 7 | Monorepo tests | `corepack pnpm -r --no-bail test` | **PASS — 4,862 passed / 0 failed** (was 4,742; +120 net-new from Wave 10 lanes; grow-only held) |
| 8 | Six acceptance suites | per-suite `vitest run` | **PASS — field 69 · security 103 · commerce 71 · adoption 95 · release 88 · convergence 82** (all six green at the candidate commit; baselines grew-only from 61/90/65/90/88/82) |
| 9 | Build | `corepack pnpm -r --no-bail build` | **PARTIAL — 71 packages built; 4 substrate packages failed** (`@zcode/web` exit 137 OOM — the same 4GB constraint, the reason the FleetOS shell has its own standalone build; `@zcode/desktop` + `@zcode/server` spawn ENOENT — electron/tsup tooling not installed under `--ignore-scripts`; `apps/zcode-cli` sea tooling). All 47 FleetOS domain packages build clean (tsc --noEmit); the FleetOS product surface builds via its standalone config (236 modules, verified below) |

## 2. Deployed build = tested commit (browser evidence)

The FleetOS application shell is deployed from `packages/web/dist-fleetos/` (static, hash
routing — no private services; served on `:3105` in this sandbox). The build carries the
exact candidate commit in its footer badge:

- `commit 73adc1788e4bc3b1829d87a0051c9f1551a2e803 · built 2026-10-09T21:50:48.677Z`
- Screenshots at the tested build: `docs/evidence/F301/screens/*-final.png`
- All six routes render with REAL package outputs (tower digest, host bundle digests
  `dae96c97`/`wchost_87047877`, lab state digest); zero unexpected refusals.
- E2E command journeys at the tested build: `asset.enroll` → `cmd_0000000001` ENQUEUED
  (lane A); `security.remediation.request` → `cmd_0000000002` ENQUEUED (lane B);
  idempotent resubmit → `duplicate=true` (the real queue's dedup law through the UI);
  out-of-vocabulary reasons REFUSED honestly + audit-logged.

## 3. Merged worker commits and owned paths

| Lane | Commit | Owned paths (verified) |
|---|---|---|
| F300A | `e221c07` → merged `a0904b3` | experiences/asset-field + acceptance/field + docs/evidence/F300A |
| F300B | `b5be8e4` → merged `643c575` | experiences/safety-intel + acceptance/security + docs/evidence/F300B |
| F300C | `65ede72` → merged `b6ea2a3` | experiences/work-commerce + acceptance/commerce + acceptance/adoption (scoped grant) + docs/evidence/F300C |
| TL F301 | `cf513f5`, `65e9250`, `a1d94d8`, `5ad0c67`, `cbb367c` | packages/web/src/fleetos + fleetos.html + vite.fleetos.config.ts + docs/evidence/F301 |
| TL convergence | `09b8d33`, `8390314`, `73adc17` | acceptance/release + adoption re-pins + snapshot + lint repairs |

## 4. Integration status matrix (full repo)

| Connector | Owner lane | Status | Evidence |
|---|---|---|---|
| ADCOS | A | **CONTRACT_ONLY** | F300A lane evidence (deterministic adapter; no live endpoint) |
| Arena | B | **CONTRACT_ONLY** | F300B lane evidence |
| Aurum settlement | C | **CONTRACT_ONLY** | F300C §4: 61 tests, idempotency/outage/delta-sync — no endpoint/credentials exist |
| Apify actor jobs | C | **CONTRACT_ONLY** | F300C §4: 68 tests, rate-budget/quota/evidence quarantine — no token exists |
| External vendor catalog | C | **CONTRACT_ONLY** | F300C §4: 51 tests, dedupe/quarantine/revocation |
| Model-gateway providers | C | **CONTRACT_ONLY** | metadata-only provider records; routing is deterministic policy evaluation |

No connector is LIVE_VERIFIED or SANDBOX_VERIFIED: no credentials/endpoints exist in the
environment (machine-audited: zero network/fetch/env hits in all adapter src).

## 5. Adoption ledger (converged, machine-run)

- COUNTED journey executions: **1,575** (field 555 + commerce 549 + security 471) —
  was 1,113; identical reruns never counted (555 raw epoch re-runs executed, proven
  byte-identical, excluded from totals).
- Fully-applicable firm cap: **58** (field 20 + commerce 21 + security 17) — was 42.
- Target: 100 counted per firm — **structurally short by 42 per fully-applicable firm**;
  every firm's exact shortfall recorded with structural reasons; the threshold was never
  weakened. The F271 documented TL/user decision stands (see RESIDUAL-RISKS).

## 6. Residual risks / limitations

Updated in `docs/tech-lead/RESIDUAL-RISKS.md` (Wave 10 additions: the two environment
blockers below, the CONTRACT_ONLY integration reality, the adoption shortfall, the demo
world's fixture-input composition).

## 7. VERDICT

**NOT READY — named blockers (none hidden, none relabeled):**

1. **B-1: substrate root typecheck OOMs on this box** (exit 137; reproduction: `corepack pnpm typecheck` in the clean checkout at `73adc17` with the resident stack). Owner: environment/substrate. Repair: run the root gate on a ≥8GB builder. The machine-verified equivalent at the candidate commit: 47/47 FleetOS packages typecheck clean per-package.
2. **B-2: substrate full build fails on 4 packages** (`@zcode/web` OOM 137; `@zcode/desktop` + `@zcode/server` tooling ENOENT under `--ignore-scripts`; `apps/zcode-cli` sea). Owner: environment/substrate. Repair: same builder + full toolchain install (no `--ignore-scripts`). The FleetOS product surface itself builds and deploys (standalone config, verified at the tested commit).
3. **B-3: the 100-counted-journeys-per-firm adoption target is structurally unreachable at the current corpus** (58/100 fully-applicable). Owner: TL/user decision required per the F271 record — the shortfall is preserved, never silently weakened; extending further requires genuinely new product capability (new journey families), not reruns.

Everything else the handoff demands is machine-evidenced at `73adc17`: the deployed
FleetOS application (browser-verified, commit-bound), real command path with Guardian
adjudication semantics, honest refusals/empties, all six acceptance suites green, 4,862
monorepo tests green, architecture/snapshot/source-of-truth green, lint 0 errors after
repair, and the honest integration + adoption ledgers.
