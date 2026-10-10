# F310A — Full root typecheck on the TL-provided high-memory builder (Wave 11, lane A)

**Worker:** A (verification lane) · **Branch:** `work/f310a` · **Base:** `main` @ `48c167f1b5e872e6d5abeff54ba60161b45cd486` (actual HEAD recorded at dispatch; not assumed)
**Report SHA:** this file's commit on `work/f310a` (docs-only delta from the base — the typecheck-relevant tree is identical to `48c167f`).

## B-1 status: **OPEN** (the gate command FAILED with real TypeScript errors; the green job badge is a false green — see §5)

The OOM half of B-1 is **resolved and machine-confirmed**: the 16 GB runner completes the
command (no exit 137). What remains is 220 pre-existing cross-owner TypeScript errors that
were invisible to the recorded per-package equivalent, plus a gate-integrity defect in the
workflow that makes the `root-typecheck` job unable to report failure at all.

## 1. Builder (TL-provided, per packet)

Workflow `.github/workflows/release-gates.yml`, job `root-typecheck`
("B-1: root typecheck (tsc -b, 16GB runner)"), GitHub-hosted `ubuntu-latest`.

**Builder facts block (machine output, run log):**

```
commit_sha=48c167f1b5e872e6d5abeff54ba60161b45cd486
ref=refs/heads/work/f310a
runner=Linux runnervmmprz5 6.17.0-1022-azure #22-Ubuntu SMP Mon Jul 27 17:24:03 UTC 2026 x86_64 x86_64 x86_64 GNU/Linux
cpus=4
mem_total_kb=MemTotal:       16373452 kB
node=v24.21.0
pnpm=10.33.2
```

16,373,452 kB ≈ 16 GB RAM / 4 vCPU — the ≥8 GB class required by FINAL-RELEASE-HANDOFF §F310A-1.
Frozen install with lifecycle scripts ENABLED: `Done in 37.9s using pnpm v10.33.2`
(desktop postinstall rebuild completed: `✔ Rebuild Complete`).

## 2. The gate command and its REAL exit code

Command (job step "Root typecheck (the B-1 gate command)"):

```
corepack pnpm typecheck
```

= `tsc -b packages/rpc packages/provider packages/provider-node packages/shared
packages/services packages/client packages/server packages/zcode-server-cli
packages/ui packages/web packages/desktop/tsconfig.host.json` (root `package.json`).

**Real machine result: FAILED — pnpm exited 2.** Quoted tail of the step output
(run log, `2026-10-10T02:04:29Z`–`02:04:32Z`; 220 `##[error]` lines total):

```
##[error]packages/world-model/src/world-fold.ts(43,15): error TS5097: An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled.
##[error]packages/world-model/src/world-fold.ts(44,15): error TS5097: An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled.
##[error]packages/world-model/src/world-fold.ts(45,15): error TS5097: An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled.
##[error]packages/world-model/src/world/state.ts(27,34): error TS5097: An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled.
 ELIFECYCLE  Command failed with exit code 2.
TYPECHECK_EXIT=0
```

`ELIFECYCLE Command failed with exit code 2` is the authoritative exit status of
`corepack pnpm typecheck`. The `TYPECHECK_EXIT=0` line is the workflow's exit-capture
bug (§5) — it records `tee`'s status, not pnpm's. **The job badge "success" on this run
must not be read as gate passage.**

## 3. Run (public, permanent)

- Run: https://github.com/payswapdotorg/Fleetos-2.0/actions/runs/38015480251 (ID `38015480251`)
- Job `root-typecheck`: ID `114104672523`, every step green **because of §5**, real gate result FAIL (exit 2)
- Artifacts on the run: `root-typecheck-logs` (`builder-facts.txt`, `install.log`, `typecheck.log`)
- Also green in the same run (not this lane's scope, noted for completeness): `full-build`
  (B-2 job; exit capture there is correct — PIPESTATUS) and `acceptance-gates`.

## 4. Error census (220 errors, machine-counted from the run log)

By code: **131 × TS5097** (`.ts`-extension imports without `allowImportingTsExtensions`)
· **27 × TS2591** (`node:crypto`/`require`/`Buffer` unresolved — no Node types in the
checking project) · 19 × TS18048 · 18 × TS2532 · 14 × TS2345 · 8 × TS2339 · 2 × TS2322 · 1 × TS2416
(the last six families are strict-null/compat errors, all in `packages/web/src/fleetos/*`).

By owner (per `spec/worker-ownership.yaml`):

| Owner | Errors | Where |
|---|---|---|
| TL / substrate | **65** | `packages/web/src/fleetos/` 62 (`crypto-shim.ts` 41, `commandPath.ts` 8, `main.tsx` 7, `world.ts` 6) · `packages/kernel/src/audit.ts` 1 · `packages/control-plane/src/digest.ts` 1 · `packages/mission/src/digest.ts` 1 |
| Worker B | **134** | world-model 33 · experiences/safety-intel 26 · policy 19 · simulation 14 · security 10 · execution 10 · predictive 7 · evidence 7 · world-context 4 · actions 4 — all TS5097 except 3 × TS2591 (`policy/src/ledger.ts` 2, `evidence/src/index.ts` 1) |
| Worker A | **21** | connectivity 6 · observations 5 · recovery 4 · assets 2 · tenancy 1 · maintenance 1 · identity 1 · health 1 — all TS2591 (`node:crypto` 19, `Buffer` 2) |

## 5. Gate-integrity defect (found by this lane; TL-owned; CRITICAL)

`release-gates.yml`, `root-typecheck` job, step "Root typecheck (the B-1 gate command)":

```yaml
run: |
  corepack pnpm typecheck 2>&1 | tee typecheck.log
  echo "TYPECHECK_EXIT=$?"
```

`$?` after a pipeline is the status of the LAST pipeline element (`tee`), not pnpm.
The step (and therefore the job and the run) **cannot fail on a typecheck failure** —
this run's "success" badge with `ELIFECYCLE ... exit code 2` in the same log proves it
live. The sibling `full-build` job already uses the correct pattern. Proposed repair
(TL-owned path `.github/**`, so this lane does not apply it):

```yaml
run: |
  set +e
  corepack pnpm typecheck 2>&1 | tee typecheck.log
  rc=${PIPESTATUS[0]}
  echo "TYPECHECK_EXIT=$rc" | tee -a typecheck.log
  exit $rc
```

Until this lands, every green `root-typecheck` badge is unproven by construction.

## 6. Root cause analysis (why the root gate fails while 47/47 per-package gates pass)

The substrate `tsc -b` set includes `packages/web`, whose tsconfig is a browser project
(`lib: ["es2025","dom","dom.iterable"]`, no Node types, no `allowImportingTsExtensions`).
The TL-owned FleetOS shell sources at `packages/web/src/fleetos/*` import `@fleetos/*`
domain packages by name; those domain sources then enter the `packages/web` program and
are checked under ITS compiler context, not their own per-package context
(`packages/identity/tsconfig.json` e.g. sets `types: ["node"]`; B packages rely on
`.ts`-suffixed imports). Result: three error families —

1. **TS2591** — domain files legitimately using `node:crypto`/`Buffer`/`require` fail
   under the DOM-lib project without `@types/node` (21 of these sit in Worker-A files;
   see §7);
2. **TS5097** — Worker-B domain files' `.ts`-suffixed imports fail under the base config;
3. **strict-null/compat errors (62)** — real errors in the TL-owned shell code itself.

The 4 GB OOM previously masked all of this; the per-package equivalent could never see
it because each package is checked under its own correct settings.

## 7. Worker-A owned errors: zero code edits — justification (verification-lane law)

This lane's 21 errors are in Worker-A files, but their root cause is the checking-context
composition in §6, which is TL-owned. The files are correct under their own gates:

- e.g. `packages/identity/src/kernel-audit.ts` imports `{ createHash } from "node:crypto"`
  for a synchronous sha256 `digestOf()` audit helper; `packages/identity/tsconfig.json`
  declares `types: ["node"]`; F302 machine-recorded 47/47 domain packages green per-package.

No truthful in-file repair exists that does not either (a) change runtime behavior
(synchronous `createHash` → asynchronous WebCrypto `crypto.subtle.digest` would ripple
through every kernel audit emitter's signature), or (b) add suppression-shaped ambient
module declarations (weakens type-checking even in the correct per-package context).
Both are forbidden ("never add suppressions", minimal truthful repairs only). The
truthful repair for these 21 is the TL-side context fix in §8-P2. Accordingly this lane
makes **zero code edits** — the only commit on `work/f310a` beyond the base is this
report (grow-only respected: no tests added or removed anywhere).

## 8. Scoped repair proposals (not owned by this lane — proposals only)

- **P1 (TL, `.github/workflows/release-gates.yml`)** — fix the exit-capture as in §5.
  Gate integrity must land before any B-1 closure can be trusted.
- **P2 (TL, `packages/web` project composition)** — options, in preference order:
  (a) give the FleetOS shell its own typed project (dedicated tsconfig with the domain
  context: Node types where needed, `allowImportingTsExtensions` if `.ts` imports are
  kept) — matches the already-recorded architecture decision that the FleetOS surface
  builds via its standalone `vite.fleetos.config.ts` rather than the substrate build;
  (b) add `@types/node` (+ `types`) to the `packages/web` project so pulled-in domain
  sources resolve Node APIs — quickest, but mixes Node+DOM libs in one project;
  (c) have the shell import built `.d.ts`/dist outputs instead of domain sources.
  P2(a) resolves Worker-A's 21 TS2591 and the TS5097 family for the shell's program.
- **P3 (TL, `packages/web/src/fleetos/*`)** — repair the 62 real strict errors
  (`crypto-shim.ts` 41, `commandPath.ts` 8, `main.tsx` 7, `world.ts` 6).
- **P4 (Worker B, 134 errors)** — replace `.ts`-suffixed imports with `.js`-suffixed
  ESM imports (the convention Worker-A packages already follow — zero TS5097 in any
  A-owned file under the same program), or adopt P2(a)'s dedicated project settings.
  Worker-B dispatch recommended.
- **P5 (sequence to close B-1):** P1 → P2(a) → P3 + P4 in parallel → re-push `work/f310a`
  (or TL dispatch at the converged SHA) → root gate must show `TYPECHECK_EXIT=0` captured
  via PIPESTATUS with a red job on any failure. B-1 closes only on that machine output.

## 9. Reproduction (public, no secrets)

```
# list runs on the lane branch
curl -s "https://api.github.com/repos/payswapdotorg/Fleetos-2.0/actions/runs?branch=work/f310a"
# job detail + logs (public web page works without auth)
https://github.com/payswapdotorg/Fleetos-2.0/actions/runs/38015480251
# or dispatch at any ref (TL PAT):
POST /repos/payswapdotorg/Fleetos-2.0/actions/workflows/release-gates.yml/dispatches {"ref":"work/f310a"}
```

Local reproduction of the error population (any machine, clean checkout at `48c167f`):
`corepack pnpm install --frozen-lockfile && corepack pnpm typecheck` → exit 2 with the
census of §4 (memory permitting; the 16 GB CI run is the authoritative record — this run
is linked in §3).

## 10. Evidence integrity

- No compiler options changed; no suppressions added; no tests added/removed; no files
  outside `docs/evidence/F310A/**` touched by this lane.
- The token used for push/API access is not stored in any file, commit, or log.
- Machine evidence: the public run page + run log + artifacts (§3), quoted verbatim in
  §§1–2.
