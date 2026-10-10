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

---

# Wave 11 — Final release-blocker closure (F312 disposition)

**Final candidate:** `8c97ac8` (main; the Wave 11 converged tree: lanes F310A/B/C merged
at `3dee6d1`/`1d840e2`/`6455526`, TL convergence `886cefa`, shell ledger-display
convergence `8c97ac8`). **TL-gated; every count below is machine-captured at the named
commit on the canonical high-memory builder** (`.github/workflows/release-gates.yml`,
GitHub Actions, public-repo free tier, ubuntu 4 vCPU / 16 GB, Node 24, pnpm 10.33.2).

## 8. The three Wave-10 blockers, resolved status

### B-1 — root typecheck: **CLOSED**

- The recorded 4 GB OOM is dead: the 16 GB builder completes the command (no exit 137).
- The REAL state surfaced at `48c167f` once memory sufficed: **220 type errors** — the
  substrate `packages/web` browser project pulled `@fleetos/*` domain sources through
  the shell's imports and checked them under its context (no Node types, no
  `allowImportingTsExtensions`). Census by owner: TL 65 / Worker B 134 / Worker A 21
  (`docs/evidence/F310A/report.md` §4; the probe run's "green" badge was a workflow
  exit-capture defect, fixed at `7065542` — F310A's lane finding).
- TL repairs: **P2(a)** the dedicated FleetOS shell typecheck project
  (`packages/web/tsconfig.fleetos.json`, domain context; substrate web project excludes
  `src/fleetos`; root list extended — the `tsconfig.host.json` precedent) + **P3** the
  62 real shell errors fixed truthfully (bounds-asserting reads, registry projections,
  explicit guards, the REAL FindingKind vocabulary; digests byte-identical where the
  crypto path is unchanged).
- **Closing machine output** (run `38018805250` at `f0c0921`, re-validated at the
  converged tree by the F312 runs at `886cefa`/`8c97ac8`):
  `TYPECHECK_EXIT=0` — PIPESTATUS-captured, 0 type errors, root `tsc -b` over all
  12 substrate configs + the dedicated shell project.

### B-2 — full build: **CLOSED**

- At `da3f99ee` (lane F310B, run `38014914587`): `BUILD_EXIT=0`, **75/75 package builds
  PASS** with lifecycle scripts ENABLED (electron/koffi/node-pty/cpu-features/ssh2
  postinstalls machine-logged); all four previously-failing substrate targets green
  (`@zcode/web` vite 17.04s, `@zcode/desktop` rolldown, `@zcode/server` tsup+remote,
  `apps/zcode-cli` turbo 16/16). Per-package table: `docs/evidence/F310B/report.md` §5.
- Honest scoping (lane-recorded): SEA binary packaging is a separate root script
  (`build:sea`), not part of `-r build`; the toolchain is installed and the CLI
  workspace builds 16/16.
- Re-validated green at the converged tree by the F312 runs.

### B-3 — adoption coverage: **PARTIALLY RESOLVED; the target decision stands open (TL accepts the lane's recommendation: retain the 100 target)**

- The F310C delivery (`f1d7515`, TL-gated): commerce corpus 21 → **31** genuinely
  distinct journeys (real worker-c package APIs, honest refusal paths, 221 new
  assertions); the honest-counts ledger recomputed: counted **1,848** executions (was
  1,575), fully-applicable cap **68** (was 58), shortfall **32** (was 42) — the 100
  target never weakened, 9 honest masks ADDED (each narrows, none broadens).
- The 42-slot journey-to-capability mapping (machine-grounded, real-API-cited):
  **33 slots real-implementable today** (10 delivered + 3 deferred C + 10 proposed A +
  10 proposed B), **6 slots genuine new-capability work** (incl. the highest-leverage
  item: honest per-epoch time-parameterization, ceiling 170), **3 slots the honest
  remainder**. Cap trajectory: 58 → 68 (now) → 71 → 81 → 91 → 97 + row-36 parameterization.
- **Decision packet** (`docs/evidence/F310C/report.md` §6): Option 1 (build the roadmap),
  Option 2 (retain 100, stay NOT READY), Option 3 (recorded TL/user revision). The lane
  RECOMMENDS Option 2 with Option 1 attached as the standing Wave-12 roadmap. The TL
  accepts: **the 100 target stands; B-3 remains the sole substantive release blocker**
  until the capability exists or the user records a different decision.

## 9. F312 gates at the final candidate

- Clean-checkout gates run by `release-gates.yml` at `8c97ac8` (and `886cefa`):
  frozen install (scripts ON), source-of-truth, contract snapshot, architecture,
  lint (0 errors), **root typecheck TYPECHECK_EXIT=0**, monorepo tests (grow-only from
  4,862: the F310C extension adds commerce +10 → 81, adoption recomputes), the six
  acceptance suites (**field 69 · security 103 · commerce 81 · adoption 95 · release 88 ·
  convergence 82** — all green at the converged tree; the release re-pin commit
  `886cefa` closes the documented lane-tree count-pin transition), full build
  BUILD_EXIT=0. Run IDs recorded in the workflow history; artifacts attached.
- Browser-verified deployed build at the final tree: the standalone shell rebuilt at
  `886cefa`/`8c97ac8` (commit badge in-bundle), served on `:3105` (this sandbox's
  supervisor-kept static server); all six routes render REAL package outputs with
  deterministic digests (fleet `3f8cced3`, findings `04472c56`, workboard
  `workboard_5a994900`, tower `tower_214e3804`, host bundles `dae96c97`/`wchost_87047877`);
  `asset.enroll` → ENQUEUED `cmd_0000000001`; the adoption ledger display converged
  (1,848 / cap 68 / shortfall 32).

## 10. Deployment/persistence qualification (F311 §4 — honest scoping)

The deployed FleetOS application is **this sandbox's static hosting** over
`packages/web/dist-fleetos/` (hash routing, no private services). Operational state is
**fixture-composed in-browser** (the F301 composition): it is NOT a publicly accessible
production system and does NOT have durable operational persistence. No claim of public
deployment or durable persistence is made. All external connectors remain
**CONTRACT_ONLY** (no credentials exist; machine-audited). Predictive outputs remain
labeled deterministic structural references.

## 11. FINAL VERDICT (Wave 11)

**NOT READY — one substantive blocker remains, none hidden:**

1. **B-3: adoption 100-counted-journeys-per-firm target not yet met** — cap **68/100**
   (shortfall 32), machine-run at the final tree. The roadmap to ≥100 exists and is
   machine-grounded (`docs/evidence/F310C/report.md` §3): the deferred C slots (+3), the
   proposed A (+10) and B (+10) corpus waves over already-shipped package code, then the
   named (b)-capabilities — with the row-36 time-parameterization decision (ceiling 170)
   as the highest-leverage single item, TL-owned counting-law semantics. The target is
   retained per the F271/Wave-10 decision line; only an explicit user decision can
   revise it.

B-1 and B-2 are **CLOSED** with machine evidence at the final candidate. Everything else
the handoff demands is green at `8c97ac8`: all six acceptance suites, the monorepo test
plane (grow-only), architecture/snapshot/source-of-truth, lint 0 errors, the honest
integration + adoption ledgers, and the commit-bound browser-verified application.
