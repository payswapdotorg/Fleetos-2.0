# F310B — Full monorepo build with the complete toolchain (Wave 11 lane B)

**Work item:** F310B (`spec/work-items/WORK-ITEM-CATALOG.md`, Wave 11) · **Worker:** B (verification lane)
**Packet:** `docs/tech-lead/packets/f310b.md` · **Blocker:** B-2
**Delivered on branch:** `work/f310b`

## Verdict

**B-2 is CLOSED at the tested SHA `da3f99ee1a3f4c85caa95297a29bd413470c5f39`.**

`corepack pnpm -r --no-bail build` exited **`BUILD_EXIT=0`** with **75/75 package
builds PASS** — including all four previously-failing substrate targets
(`@zcode/web`, `@zcode/desktop`, `@zcode/server`, `apps/zcode-cli`) — on the
TL-provided high-memory GitHub Actions builder with lifecycle scripts ENABLED.
No `--ignore-scripts`, no skipped targets, no redefinition of "build". Zero
code changes were needed in any path (worker-b or otherwise); this lane is a
pure verification, and this branch differs from `main` only by this evidence
file.

## 1. Exact tested SHA, branch, and run

| Fact | Value (machine-recorded) |
|---|---|
| Base (branch point) | `main` @ `48c167f1b5e872e6d5abeff54ba60161b45cd486` ("Wave 11 dispatch: high-memory CI builder + F310A/B/C packets") |
| Tested commit | `da3f99ee1a3f4c85caa95297a29bd413470c5f39` — evidence-only commit on top of base (this report's skeleton; **build tree identical to base**: diff vs `48c167f` is `docs/evidence/F310B/report.md` only) |
| Branch | `work/f310b` |
| Run | https://github.com/payswapdotorg/Fleetos-2.0/actions/runs/38014914587 (run `38014914587`, event **push** — triggered automatically by the push of `work/f310b` at this exact commit) |
| Job | "B-2: full monorepo build (scripts ON, --no-bail)" (job id `114102936072`) — **conclusion: success**, 01:53:37Z → 02:00:39Z (≈7m02s wall, build phase ≈6m11s) |
| Log artifact | `full-build-logs` (artifact id `11656235401`, sha256 `a57b5391ac27b842601ad572d7161a0743b4b8325787406b345be54dc3aeaf57`) — contains `builder-facts.txt`, `install.log`, `build.log` |

The TL's own reference dispatch at the base commit (run `38011137307` at
`48c167f`) had also passed all three jobs; this lane independently re-runs the
gate at the lane tip as required by the packet.

## 2. Builder facts (B-2 evidence block, quoted from the job log)

```
commit_sha=da3f99ee1a3f4c85caa95297a29bd413470c5f39
ref=refs/heads/work/f310b
runner=Linux runnervmmprz5 6.17.0-1022-azure #22-Ubuntu SMP Mon Jul 27 17:24:03 UTC 2026 x86_64 x86_64 x86_64 GNU/Linux
cpus=4
mem_total_kb=MemTotal:       16372436 kB
node=v24.21.0
pnpm=10.33.2
```

16,372,436 kB ≈ 15.6 GiB ≈ 16.4 GB total RAM — the required **≥8 GB class**
(4 vCPU GitHub-hosted ubuntu runner, runner version 2.337.0).

## 3. Commands and exit codes (machine output)

1. **Frozen install, lifecycle scripts ENABLED:**
   `corepack pnpm install --frozen-lockfile`
   → `Scope: all 82 workspace projects` · `Packages: +2171` ·
   `Done in 40.5s using pnpm v10.33.2` — **success**, and the log proves the
   previously-missing toolchain actually ran (quoted from install.log):

   ```
   node_modules/electron postinstall$ node install.js
   node_modules/electron postinstall: Done
   node_modules/esbuild postinstall$ node install.js
   node_modules/esbuild postinstall: Done
   node_modules/koffi install$ node src/cnoke/cnoke.js -P . -D src/koffi --prebuild
   node_modules/koffi install: Done
   node_modules/node-pty install$ node scripts/prebuild.js || node-gyp rebuild
   node_modules/node-pty install: gyp info ok
   node_modules/cpu-features install$ node buildcheck.js > buildcheck.gypi && node-gyp rebuild
   node_modules/cpu-features install: gyp info ok
   node_modules/ssh2 install$ node install.js
   node_modules/ssh2 install: gyp info ok
   node_modules/ssh2 install: Done
   node_modules/electron-winstaller install: Selecting 7-Zip for arch x64
   node_modules/electron-winstaller install: Done
   node_modules/protobufjs postinstall: Done
   packages/desktop postinstall: ✔ Rebuild Complete
   ```

2. **The B-2 gate command:**
   `corepack pnpm -r --no-bail build`
   → **`BUILD_EXIT=0`** (quoted from the job log, final line of the build
   step). `--no-bail` ran the full pass; zero packages failed.

## 4. The four previously-failing substrate targets (the F302 B-2 record)

| Target | F302 recorded failure (4 GB box, `--ignore-scripts`) | This run — machine output | Outcome |
|---|---|---|---|
| `@zcode/web` (`packages/web`) | exit 137 OOM at ~2.3 GB available | `packages/web build$ vite build` → vite v8.0.8 … `✓ built in 17.04s` … `packages/web build: Done` | **PASS** |
| `@zcode/desktop` (`packages/desktop`) | tooling ENOENT (electron not installed) | `prepare:runtime-assets` downloaded node v22.16.0 tarballs for linux-arm64/linux-x64/darwin-arm64/darwin-x64 into the mock CDN, built the server bundle, then `✓ built in 15.71s` … `packages/desktop build: Done` | **PASS** |
| `@zcode/server` (`packages/server`) | tooling ENOENT (tsup tooling not installed) | `tsup v8.5.1` → `⚡️ Build success in 2131ms`, then `build:remote` (`tsx build-remote.ts`) → `Built dist/remote/zcode-server.cjs` … `packages/server build: Done` | **PASS** |
| `apps/zcode-cli` (`zcode-cli`) | SEA tooling failure | `apps/zcode-cli build$ turbo run build` → `Tasks: 16 successful, 16 total` … `apps/zcode-cli build: Done`; includes `@zcode/cli` → `dist/zcode.cjs 29.7mb` … `⚡ Done in 2190ms` | **PASS** |

Honest scoping note on SEA: the gate command is the recursive `build` graph;
the dedicated SEA binary packaging (root scripts `build:sea` /
`build:sea:all`, postject into per-platform node binaries) is **not** part of
any package's `build` script and therefore not exercised by this gate. The
packet's focus ("Node 24 + full install should provide [the tooling]") is
satisfied: the toolchain is installed and the CLI workspace's full build
(16/16 turbo tasks, including the `@zcode/cli` esbuild bundle that SEA wraps)
passes. If the TL additionally wants the SEA packaging itself exercised, that
is a separate command (`corepack pnpm build:sea`) outside this gate's
definition.

## 5. Per-package outcome table (ALL packages with a build script)

75 of the 82 scoped workspace projects define a `build` script; all 75 were
invoked and all 75 printed `build: Done`. The remaining 6 projects
(`@zcode/client`, `@zcode/services`, `@zcode/shared`, `@zcode/ui`,
`@zcode/zcode-cua`, `@zcode/prompt-trajectory`) define no `build` script and
are skipped by `pnpm -r build` (not failures). Log-wide scan for `ERR!`,
`ELIFECYCLE`, non-zero exit codes and `failed`: **0 matches**.

| Package | Path | Build command | Outcome |
|---|---|---|---|
| `@fleetos/acceptance-adoption` | `packages/acceptance/adoption` | `tsc --noEmit` | PASS (Done) |
| `@fleetos/acceptance-commerce` | `packages/acceptance/commerce` | `tsc --noEmit` | PASS (Done) |
| `@fleetos/acceptance-convergence` | `packages/acceptance/convergence` | `tsc --noEmit` | PASS (Done) |
| `@fleetos/acceptance-field` | `packages/acceptance/field` | `tsc --noEmit` | PASS (Done) |
| `@fleetos/acceptance-release` | `packages/acceptance/release` | `tsc --noEmit` | PASS (Done) |
| `@fleetos/acceptance-security` | `packages/acceptance/security` | `tsc -p tsconfig.json --noEmit` | PASS (Done) |
| `@fleetos/actions` | `packages/actions` | `tsc -p tsconfig.json --noEmit` | PASS (Done) |
| `@fleetos/agent` | `apps/agent` | `tsc --noEmit` | PASS (Done) |
| `@fleetos/agent-organizations` | `packages/agent-organizations` | `tsc -p tsconfig.json --noEmit` | PASS (Done) |
| `@fleetos/assets` | `packages/assets` | `tsc --noEmit` | PASS (Done) |
| `@fleetos/connectivity` | `packages/connectivity` | `tsc --noEmit` | PASS (Done) |
| `@fleetos/control-plane` | `packages/control-plane` | `tsc -p tsconfig.json --noEmit` | PASS (Done) |
| `@fleetos/control-tower` | `packages/experiences/control-tower` | `tsc -p tsconfig.json --noEmit` | PASS (Done) |
| `@fleetos/convergence` | `packages/integrations/convergence` | `tsc -p tsconfig.json --noEmit` | PASS (Done) |
| `@fleetos/evidence` | `packages/evidence` | `tsc -p tsconfig.json --noEmit` | PASS (Done) |
| `@fleetos/execution` | `packages/execution` | `tsc -p tsconfig.json --noEmit` | PASS (Done) |
| `@fleetos/experience-asset-field` | `packages/experiences/asset-field` | `tsc -p tsconfig.json --noEmit` | PASS (Done) |
| `@fleetos/experience-engineering-lab` | `packages/experiences/engineering-lab` | `tsc -p tsconfig.json --noEmit` | PASS (Done) |
| `@fleetos/experience-safety-intel` | `packages/experiences/safety-intel` | `tsc -p tsconfig.json --noEmit` | PASS (Done) |
| `@fleetos/experience-work-commerce` | `packages/experiences/work-commerce` | `tsc -p tsconfig.json --noEmit` | PASS (Done) |
| `@fleetos/health` | `packages/health` | `tsc --noEmit` | PASS (Done) |
| `@fleetos/identity` | `packages/identity` | `tsc --noEmit` | PASS (Done) |
| `@fleetos/integration-health` | `packages/integrations/health` | `tsc -p tsconfig.json --noEmit` | PASS (Done) |
| `@fleetos/kernel` | `packages/kernel` | `tsc --noEmit` | PASS (Done) |
| `@fleetos/learning` | `packages/learning` | `tsc -p tsconfig.json --noEmit` | PASS (Done) |
| `@fleetos/maintenance` | `packages/maintenance` | `tsc --noEmit` | PASS (Done) |
| `@fleetos/mission` | `packages/mission` | `tsc -p tsconfig.json --noEmit` | PASS (Done) |
| `@fleetos/model-gateway` | `packages/model-gateway` | `tsc -p tsconfig.json --noEmit` | PASS (Done) |
| `@fleetos/observations` | `packages/observations` | `tsc --noEmit` | PASS (Done) |
| `@fleetos/policy` | `packages/policy` | `tsc -p tsconfig.json --noEmit` | PASS (Done) |
| `@fleetos/predictive` | `packages/predictive` | `tsc -p tsconfig.json --noEmit` | PASS (Done) |
| `@fleetos/procurement` | `packages/procurement` | `tsc -p tsconfig.json --noEmit` | PASS (Done) |
| `@fleetos/projects` | `packages/projects` | `tsc -p tsconfig.json --noEmit` | PASS (Done) |
| `@fleetos/recovery` | `packages/recovery` | `tsc --noEmit` | PASS (Done) |
| `@fleetos/security` | `packages/security` | `tsc -p tsconfig.json --noEmit` | PASS (Done) |
| `@fleetos/sim-worlds` | `packages/sim-worlds` | `tsc --noEmit` | PASS (Done) |
| `@fleetos/simulation` | `packages/simulation` | `tsc -p tsconfig.json --noEmit` | PASS (Done) |
| `@fleetos/software` | `packages/software` | `tsc -p tsconfig.json --noEmit` | PASS (Done) |
| `@fleetos/tenancy` | `packages/tenancy` | `tsc --noEmit` | PASS (Done) |
| `@fleetos/vendors` | `packages/vendors` | `tsc -p tsconfig.json --noEmit` | PASS (Done) |
| `@fleetos/work` | `packages/work` | `tsc -p tsconfig.json --noEmit` | PASS (Done) |
| `@fleetos/workloads` | `packages/workloads` | `tsc -p tsconfig.json --noEmit` | PASS (Done) |
| `@fleetos/world-context` | `packages/world-context` | `tsc -p tsconfig.json --noEmit` | PASS (Done) |
| `@fleetos/world-model` | `packages/world-model` | `tsc -p tsconfig.json --noEmit` | PASS (Done) |
| `@fleetos/adcos` | `packages/integrations/adcos` | `tsc --noEmit` | PASS (Done) |
| `@fleetos/apify` | `packages/integrations/apify` | `tsc -p tsconfig.json --noEmit` | PASS (Done) |
| `@fleetos/arena` | `packages/integrations/arena` | `tsc -p tsconfig.json --noEmit` | PASS (Done) |
| `@fleetos/aurum` | `packages/integrations/aurum` | `tsc -p tsconfig.json --noEmit` | PASS (Done) |
| `@fleetos/external-vendors` | `packages/integrations/vendors` | `tsc -p tsconfig.json --noEmit` | PASS (Done) |
| `@zcode/adapters` | `apps/zcode-cli/packages/adapters` | `tsc` | PASS (Done) |
| `@zcode/bootstrap` | `apps/zcode-cli/packages/bootstrap` | `tsc` | PASS (Done) |
| `@zcode/browser-use-plugin` | `apps/zcode-cli/packages/browser-use-plugin` | `tsc && node scripts/build.mjs` | PASS (Done) |
| `@zcode/cli` | `apps/zcode-cli/packages/cli` | `node scripts/build.mjs` | PASS (Done) |
| `@zcode/contracts` | `apps/zcode-cli/packages/contracts` | `tsc` | PASS (Done) |
| `@zcode/core` | `apps/zcode-cli/packages/core` | `tsc` | PASS (Done) |
| `debug` | `apps/zcode-cli/packages/debug` | `tsc -p tsconfig.server.json && vite build` | PASS (Done) |
| `@zcode/dynamic-workflow` | `apps/zcode-cli/packages/dynamic-workflow` | `node scripts/generate-libs.mjs && tsc` | PASS (Done) |
| `@zcode/dynamic-workflow-runtime` | `apps/zcode-cli/packages/dynamic-workflow-runtime` | `tsc` | PASS (Done) |
| `@zcode/i18n` | `apps/zcode-cli/packages/i18n` | `tsc` | PASS (Done) |
| `@zcode/node-repl-host` | `apps/zcode-cli/packages/node-repl-host` | `tsc && node scripts/build.mjs` | PASS (Done) |
| `@zcode/shared-types` | `apps/zcode-cli/packages/shared-types` | `tsc` | PASS (Done) |
| `@zcode/swift-bridge` | `apps/zcode-cli/packages/swift-bridge` | `tsc` | PASS (Done) |
| `@zcode/telemetry` | `apps/zcode-cli/packages/telemetry` | `tsc` | PASS (Done) |
| `@zcode/tui` | `apps/zcode-cli/packages/tui` | `tsc && node scripts/build.mjs` | PASS (Done) |
| `@zcode/typescript` | `apps/zcode-cli/tools/typescript` | `echo 'Shared TypeScript config - no compilation needed'` | PASS (Done) |
| `@zcode/formal-proof` | `packages/formal-proof` | `vite build` | PASS (Done) |
| `@zcode/model-option-map` | `packages/model-option-map` | `tsc` | PASS (Done) |
| `@zcode/provider` | `packages/provider` | `tsc` | PASS (Done) |
| `@zcode/provider-node` | `packages/provider-node` | `tsc` | PASS (Done) |
| `@zcode/rpc` | `packages/rpc` | `tsc` | PASS (Done) |
| `@zcode/server-cli` | `packages/zcode-server-cli` | `tsup` | PASS (Done) |
| `zcode-cli` **[substrate]** | `apps/zcode-cli` | `turbo run build` | **PASS (Done)** — `Tasks: 16 successful, 16 total` |
| `@zcode/web` **[substrate]** | `packages/web` | `vite build` | **PASS (Done)** — `✓ built in 17.04s` |
| `@zcode/desktop` **[substrate]** | `packages/desktop` | `pnpm prepare:runtime-assets && pnpm run build:no-runtime-assets` | **PASS (Done)** — `✓ built in 15.71s` |
| `@zcode/server` **[substrate]** | `packages/server` | `tsup && pnpm run build:remote` | **PASS (Done)** — `⚡️ Build success in 2131ms` |

## 6. Standalone FleetOS shell build — reported SEPARATELY (not a substitute)

Executed at the same tested commit `da3f99ee` in the lane's verification
sandbox (recorded honestly: **not** the 16 GB builder — Linux sandbox,
4 GB RAM class, node `v24.21.0`, corepack-activated pnpm `10.33.2`, same
node/pnpm pair as CI):

```bash
# filtered frozen install (scripts ON) for the shell's build inputs
corepack pnpm install --frozen-lockfile --filter @zcode/web...
# → Done in 48.9s using pnpm v10.33.2 (ssh2 optional crypto binding built: gyp info ok)

# the standalone FleetOS shell build (F301's config; the recorded command)
cd packages/web && npx vite build --config vite.fleetos.config.ts
# executed as: corepack pnpm exec vite build --config vite.fleetos.config.ts
# → vite v8.0.8 · ✓ 288 modules transformed · ✓ built in 666ms · exit 0
# → dist-fleetos/fleetos.html  0.40 kB │ gzip: 0.26 kB
# → dist-fleetos/assets/fleetos-B-XDm1Y7.js  345.51 kB │ gzip: 101.49 kB
```

Commit-binding verified: the produced bundle embeds
`da3f99ee1a3f4c85caa95297a29bd413470c5f39` (the config injects
`__FLEETOS_COMMIT__` from git HEAD; grepped from the built asset).

This standalone result corroborates the F301/F302 record that the FleetOS
product surface builds independently of the substrate web build. It is
explicitly **NOT** the B-2 gate and plays no part in the verdict above; the
gate is §3's `corepack pnpm -r --no-bail build` → `BUILD_EXIT=0`.

## 7. Non-fatal warnings observed (recorded for honesty; none affect the gate)

- `apps/zcode-cli` engine advisory: `wanted: {"node":"24.14.0"} (current:
  {"node":"v24.21.0"})` — pnpm engine-range warning, non-blocking.
- turbo ran from a global install (2.9.14; repo pins `^2.4.0`) — advisory only;
  all 16 tasks executed fresh (`cache miss, executing …`).
- turbo advisory: `no output files found for task @zcode/browser-use-plugin#build`
  and `@zcode/typescript#build` (outputs-key hint; both tasks succeeded).
- `@zcode/desktop` chunk-size >500 kB minification advisory; vite plugin
  timing breakdown (vite:asset 38% / worker 32% / css-post 20%).

## 8. B-2 status

**CLOSED at `da3f99ee1a3f4c85caa95297a29bd413470c5f39`** (branch
`work/f310b`, run `38014914587`, `BUILD_EXIT=0`, 75/75 packages, no
toolchain shortcuts). The recorded four substrate failures were
environmental (4 GB RAM / `--ignore-scripts` install), not code defects; on
the TL-provided builder with the complete toolchain they all build clean, so
no repairs — worker-b owned or proposed — were required. Final disposition
of B-2 remains with the TL per AGENTS.md (worker reports are never
self-accepting).
