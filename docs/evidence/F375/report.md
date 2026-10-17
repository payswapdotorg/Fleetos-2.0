# F375 — FleetOS Desktop for Ubuntu — evidence report

Lane: w20a · base `a38c0db` (origin/main) · branch `work/f375`

## 0. Status — the honest top line

| Verification step (the packet's six) | Status |
| --- | --- |
| 1. `corepack pnpm@10.33.2 install --frozen-lockfile` | **GREEN** (§3.1) |
| 2. `packages/desktop` typecheck + lint + the 400-line file law | **GREEN** (§3.2) |
| 3. `build:shell` (`npx vite build --config vite.fleetos.config.ts`) | **BLOCKED AT BASE** — a pre-existing cross-lane collision, machine-proven at clean `a38c0db` (§4) |
| 4. `dist:deb` + `dist:appimage` (sha256 + dpkg-deb) | **BLOCKED** — downstream of step 3 |
| 5. the packaged smoke (xvfb + six routes + round-trip + shutdown) | **BLOCKED in packaged form** — downstream of step 3; the two machine-proof halves that do not need the shell are GREEN and recorded (§3.5) |
| 6. determinism culture (fixed facts, no wall-clock in assertions) | **GREEN** (§3.6) |

Everything F375 owns is complete and green: the desktop package (sources,
watchdog, build/packaging scripts, electron-builder config, icon), the
workspace registration, the lockfile motion, and machine proofs of the
composition contract at BOTH levels (the service half and the Electron
half). The single blocker — the base's broken shell build — is a
cross-lane collision outside every F375 grant, recorded as Finding F1
with its clean-base machine proof and the exact fix shape for TL
adjudication.

## 1. The census (at base `a38c0db`)

```
$ git ls-tree -r origin/main --name-only packages/desktop | wc -l
1480
$ git show origin/main:packages/desktop/package.json | grep '"name"'
  "name": "@zcode/desktop",
```

The packet's census claim ("the `packages/desktop` path is NEW — zero
prior art") was written against *FleetOS* desktop prior art. In reality
the path at base held the **`@zcode/desktop`** package — the ZCode agent
desktop (macOS dmg assets, `native/macos-window-bounds/main.swift`,
`native/windows-browser-import-helper/Program.cs`, a tsup/vite dev
stack, 1480 files). The operator's live word governs — *"the app should
be the product we're building and not zcode"* — together with the
owned-path grant (`packages/desktop/**`): **F375 replaces the zcode
desktop wholesale.** The old content remains in git history (and on
`origin/main`); nothing is lost, and the branch diff records the
replacement.

Zero zcode/agent tooling ships in the new desktop:

```
$ rg -ci "zcode" packages/desktop/src packages/desktop/scripts \
      packages/desktop/watchdog packages/desktop/electron-builder.yml \
      packages/desktop/package.json
(no matches — ZERO zcode references in the new desktop sources)
```

## 2. Architecture — the composition (never a reimplementation)

**The main process** (`packages/desktop/src/main.ts`, 253 lines):

- **Boots the durable service by composition** — `main.ts:80-135`
  (`bootService`): spawns
  `packages/desktop/watchdog/service-watchdog.mjs` with the service's
  own entry form, `spawn(process.execPath, [watchdog, runtime, entry])`
  (`main.ts:88`) — `ELECTRON_RUN_AS_NODE=1` (the Electron binary as
  plain Node), `cwd` = the service's own directory, the service's
  verbatim runtime argv carried through:
  `node --experimental-transform-types --no-warnings --import runtime.mjs
  service.ts` (watchdog `service-watchdog.mjs:38-42`). The service's own
  resolve hooks (`hooks.mjs`) resolve the REAL `@fleetos/*` domain
  packages. **No service law is reimplemented anywhere in the desktop
  package.**
- **Boot resolution is the service's own listening line** — the FIXED
  string `"[fleetos-durable] listening on :3106"` printed by
  `service.ts:370`. A child that exits before that line is the honest
  port-conflict/failure path: error dialog + `app.exit(1)` — NEVER a
  different port (the frozen-port law, `main.ts:226-242`).
- **The parent-death watchdog** (`watchdog/service-watchdog.mjs`, 86
  lines): a machine-proven Electron fact — a SIGTERMed Linux Electron
  main exits 0 WITHOUT running JS teardown (no `will-quit`, no Node
  signal handlers; Chromium terminates directly), so the app cannot
  itself reap the service child. The watchdog is a plain Node process
  that polls its parent every 250ms and, whenever the app is gone
  (SIGTERM, SIGKILL, crash — any death), runs the service's OWN
  shutdown path: SIGTERM, then the supervisor's own 3s SIGKILL
  escalation, then exit with the service's code. The app's graceful
  teardown (`main.ts:142-160`, `shutdown` `main.ts:194-205`) forwards
  through the same path when it CAN run.
- **The window** (`createWindow`, `main.ts:164-187`): `BrowserWindow`
  1440×900, `title: "FleetOS"` with `page-title-updated` prevented (the
  product name is the native window title, not the page's
  `document.title`), `autoHideMenuBar`, `backgroundColor #0b0f14`
  (the console's deep navy), `contextIsolation: true`,
  `nodeIntegration: false`, `sandbox: true`. It loads
  `http://127.0.0.1:3106/?mode=durable` — the shell served by the
  durable service itself (the F351A composition, packaged).
- **Single-instance lock** (`main.ts:207-219`): a second launch exits 0
  and focuses the first window.

**The packaging** (`electron-builder.yml`):

- Linux targets `deb` + `AppImage`, arch `x64`, `executableName:
  fleetos`, `artifactName` templates exactly
  `fleetos_${version}_amd64.deb` and `FleetOS-${version}.AppImage`;
  the XDG desktop entry `Name: FleetOS`, `Categories:
  Office;Utility`, `Terminal: false`; install root `/opt/FleetOS`
  (electron-builder's deb layout) with the `/usr/bin/fleetos` command.
- `asar: false` — the app is one small ESM main file; the FleetOS world
  must be readable by a plain Node child process (the service's loader).
- `files`: `out/**`, `package.json`, `branding/icon.png`, `watchdog/**`
  — ZERO node_modules, ZERO replay/console/agent tooling. The app IS the
  product surface.
- `extraResources`: `resources/fleetos` → the bundled FleetOS world:
  the service's own sources verbatim, every `@fleetos/*` package's src
  tree at its canonical path, and the built shell at
  `packages/web/dist-fleetos` (staged by
  `scripts/build-fleetos-resources.mjs`). This is the service's own
  resolution contract satisfied **by data placement**:
  `service.ts` resolves `REPO_ROOT` two levels up from its own file and
  serves `<root>/packages/web/dist-fleetos`; `hooks.mjs` resolves
  `@fleetos/*` under `<root>/packages/...` (with its RENAMES). Zero
  service code rewritten; `FLEETOS-DESKTOP-CONTENTS.txt` stamps the
  staged provenance (repo commit, file counts, the fixture-label
  honesty line).
- The icon: `branding/fleetos-mark.svg` (the committed source mark —
  the shell's own ◈ brand glyph) rendered to PNGs by
  `scripts/make-icon.mjs` — deterministic, zero dependencies (hand-packed
  PNG chunks + exact box-filter scaling), 512 master + the 16..512
  hicolor set.

**Build scripts** (`packages/desktop/package.json`): `build:shell`
(builds the F301 shell via the pinned command, FAILS unless
`__FLEETOS_COMMIT__` = HEAD appears in the built assets, stages to
`resources/shell/`), `build:resources` (stages the FleetOS world),
`icon`, `dist`/`dist:deb`/`dist:appimage` (self-contained:
build → icon → shell → resources → electron-builder), `smoke` (the
packaged-artifact gate).

## 3. The verification battery — exact outputs

### 3.1 Frozen install (step 1) — GREEN

```
$ corepack pnpm@10.33.2 install --frozen-lockfile
apps/zcode-cli  |  WARN  Unsupported engine: wanted: {"node":"24.14.0"} (current: {"node":"v24.21.0","pnpm":"10.33.2"})
Scope: all 82 workspace projects
Lockfile is up to date, resolution step is skipped
Packages: -265
. prepare$ husky
. prepare: Done
Done in 3.5s using pnpm v10.33.2
```

(The engine warning is `apps/zcode-cli`'s pre-existing pin — not the
desktop package. The `-265` is the removal of the old `@zcode/desktop`
dependency tree; the lockfile diff is surgically scoped to the
`packages/desktop` importer + the `@arms/rum-electron` patch entry the
old package required — `packages/web`'s importer is untouched.)

### 3.2 Typecheck + lint + the file law (step 2) — GREEN

```
$ corepack pnpm@10.33.2 run typecheck    # packages/desktop
> tsc -b tsconfig.host.json
(clean)

$ corepack pnpm@10.33.2 run lint         # packages/desktop
> oxlint
Found 0 warnings and 0 errors.
Finished in 10ms on 7 files using 2 threads.

$ corepack pnpm@10.33.2 run typecheck    # the repo root gate
> tsc -b packages/rpc ... packages/web packages/web/tsconfig.fleetos.json packages/desktop/tsconfig.host.json
(exit 0)
```

The file law (no source file over 400 code lines):

| file | total | code (non-comment/non-blank) |
| --- | --- | --- |
| `src/main.ts` | 253 | ~178 |
| `watchdog/service-watchdog.mjs` | 86 | ~52 |
| `scripts/build-shell.mjs` | 68 | ~49 |
| `scripts/build-fleetos-resources.mjs` | 118 | ~83 |
| `scripts/make-icon.mjs` | 193 | ~156 |
| `scripts/smoke.mjs` | 385 | ~318 |
| `scripts/x11.mjs` | 165 | ~125 |

### 3.3 `build:shell` (step 3) — BLOCKED AT BASE

```
$ pnpm -C packages/desktop run build:shell
  (→ cd packages/web && npx vite build --config vite.fleetos.config.ts)
vite v8.0.8 building client environment for production...
✓ 328 modules transformed.
✗ Build failed in 348ms
error during build: Build failed with 4 errors:

[MISSING_EXPORT] Error: "scryptSync" is not exported by "src/fleetos/crypto-shim.ts".
    ╭─  ../identity/src/credentials.ts:37:10
[MISSING_EXPORT] Error: "timingSafeEqual" is not exported by "src/fleetos/crypto-shim.ts".
    ╭─  ../identity/src/credentials.ts:37:22
[MISSING_EXPORT] Error: "createHmac" is not exported by "src/fleetos/crypto-shim.ts".
    ╭─  ../identity/src/session.ts:45:10
[MISSING_EXPORT] Error: "timingSafeEqual" is not exported by "src/fleetos/crypto-shim.ts".
    ╭─  ../identity/src/session.ts:45:22
```

The cause, the clean-base machine proof, and the adjudication ask are
§4 (Finding F1). Nothing in F375's tree touches `packages/web` or
`packages/identity` (`git diff --name-only HEAD -- packages/web/` is
empty).

### 3.4 `dist:deb` + `dist:appimage` (step 4) — BLOCKED

Both run `build:resources`, which fails fast and honestly without the
shell:

```
[f375:resources] FAIL: resources/shell/fleetos.html missing — run `pnpm run build:shell` first
```

No artifact was built; no sha256/`dpkg-deb` output exists to record.
Electron itself IS installed and verified in the sandbox (the official
registry download was NOT blocked):

```
$ node_modules/electron/dist/electron --version
v41.0.3
```

### 3.5 The smoke (step 5) — packaged form BLOCKED; both shell-free halves GREEN

The packaged smoke cannot run without the .deb. The two machine proofs
below cover every smoke assertion that does not depend on the shell's
DOM — the composition contract end-to-end.

#### 3.5.1 The service-level composition proof (the Electron main's exact boot form)

Boot via `packages/desktop/watchdog/service-watchdog.mjs` + the
service's verbatim argv, fresh `FLEETOS_DURABLE_DATA`, the UI's own
draft values (`pages-commands.tsx:38-41`), built by the REAL
`buildEnrollAssetIntent`:

```
=== BOOT (run 1, via watchdog) ===
[fleetos-durable] replayed 0 command(s), 0 audit entrie(s), 0 enrollment(s) in 1ms (torn lines dropped: 0)
[fleetos-durable] listening on :3106 (shell: /home/z/Fleetos-2.0/packages/web/dist-fleetos; data: …/data-run1; commit a38c0dba6c4f43a51082cc54da4b176aa0970f07)

=== ROUND-TRIP (the UI's own asset.enroll draft) ===
ACK: {"ok":true,"ack":{"commandId":"cmd_0000000001","duplicate":false,…}}
   (write-before-ack; the exact shape the smoke's UI assertion expects)

=== SIGTERM the watchdog ===
watchdog exit: 0
ZERO orphans (pgrep fleetos-durable: none)
port :3106 released (connection refused)

=== RESTART (same data dir — replay-on-start, the F351A law) ===
[fleetos-durable] replayed 1 command(s), 1 audit entrie(s), 0 enrollment(s) in 1ms (torn lines dropped: 0)
{"ok":true,"service":"fleetos-durable","port":3106,"commit":"a38c0dba…","replay":{"commands":1,"audit":1,"assets":0,…}}
watchdog exit (run 2): 0
ZERO orphans after run 2
port :3106 released after run 2
```

#### 3.5.2 The Electron main proof (dev form, under Xvfb)

```
=== APP LOG ===
[fleetos-durable] [fleetos-durable] listening on :3106 (shell: …/packages/web/dist-fleetos; data: …/.config/@fleetos/desktop/durable-data; commit a38c0dba6c4f43a51082cc54da4b176aa0970f07)

=== X11 WINDOW TITLES (WM_NAME/_NET_WM_NAME, read over the X11 protocol) ===
["Chromium clipboard","electron","FleetOS"]     ← the window titled "FleetOS"

=== SIGTERM the app ===
app exit: 0
ZERO orphans
port :3106 released (connection refused)
```

The window CONTENT in this dev-form run honestly showed the service's
own 503 page (`static.ts`): *"FleetOS shell not built. Run: cd
packages/web && npx vite build --config vite.fleetos.config.ts"* — the
collision again. (dbus errors in the app log are the sandbox's missing
system bus — environmental, not app errors.)

### 3.6 Determinism culture (step 6) — GREEN

Every smoke assertion is a FIXED fact (the six route labels + blurbs +
per-route facts, the window title, the ack shape
`ENQUEUED cmd_0000000001 (duplicate=false)`, the replay counts
0/0/0 → 1/1/0); no wall-clock, no random ports in assertions. The
harness's CDP port (9222) and fixed X display candidates are plumbing,
recorded in the smoke's header. The icon generator is byte-identical
across regenerations:

```
$ node scripts/make-icon.mjs   (twice; sha256 compared)
ICON DETERMINISM: IDENTICAL across regenerations
c9fa495fb10a5c2af62a074b987e68db8ba17cdbb0598c60c2552db4118de61b  branding/icon.png   (512)
c9fa495f…  branding/icons/512x512.png (identical to the master)
40aea186…  128 · 5d550a20…  16 · 32542164…  24 · 49ad7812…  256 ·
05014863…  32 · eeebbbbb…  48 · 9e223a5e…  64
```

## 4. Finding F1 (HEADLINE — the blocker): the base's shell build is broken by the F370A/F370B/F373 identity work

**What.** `npx vite build --config vite.fleetos.config.ts` (the pinned
F301/F351A shell build command, unmodified by F375) fails at base
`a38c0db` with the 4 `MISSING_EXPORT` errors of §3.3.

**Why.** The shell's browser build aliases `node:crypto` to
`packages/web/src/fleetos/crypto-shim.ts` (a pure-TS sha256 — the F301
browser boundary, last touched F311). Waves 18–19 then added REAL
`node:crypto` auth to the identity package and its barrel
(`packages/identity/src/index.ts:5-13`: `export * from
"./credentials.js"` / `"./session.js"` / `"./keyring.js"` / …) —
`credentials.ts:37` imports `scryptSync, timingSafeEqual`;
`session.ts:45` imports `createHmac, timingSafeEqual`. The shell imports
`makeTenantContext` from `@fleetos/identity` (`pages.tsx:15`), so the
browser graph now links those modules against the sha256-only shim.

**Why nobody noticed.** The root gate's shell TYPECHECK
(`packages/web/tsconfig.fleetos.json`) resolves `node:crypto` to the
REAL `@types/node` — green — while only the browser BUILD aliases it to
the shim. The last green shell build was F351A (Wave 13-era); the
F370A/F370B/F373 lanes tested their work server-side (real node:crypto)
and never ran the browser build; no F370-era evidence mentions
`dist-fleetos`.

**Machine proof (clean base).** A worktree at clean `a38c0db`
(fresh `corepack pnpm@10.33.2 install --frozen-lockfile`):
the same command fails with the identical 4 errors, byte-for-byte
(§3.3's transcript). F375's tree is irrelevant to the failure.

**Why F375 cannot fix it.** `crypto-shim.ts` is outside every F375
grant: the owned paths are `packages/desktop/**`,
`docs/evidence/F375/**`, the root `package.json`/`pnpm-lock.yaml`
workspace+electron motion, and — only if needed — the
`base`/asset-path lines of `vite.fleetos.config.ts` + `fleetos.html`
(no such motion was needed: the app loads the shell from the durable
service's HTTP origin, so F375 touches `packages/web` NOT AT ALL).
"The services' source … everything else" is findings-never-edits.

**The fix shape (for TL adjudication — a ~15-line motion).** Extend
`crypto-shim.ts` with the three link-time exports the browser build
needs — `scryptSync`, `createHmac`, `timingSafeEqual` — as HONEST
browser refusals (throw "not available in the browser shell"): the
shell's operational path goes through the durable service (real
`node:crypto` server-side, where the marketplace auth actually runs);
the browser never calls them, it only links them. (A real-TS scrypt/
HMAC implementation is possible later if a browser surface ever needs
it — nothing today does.) With that motion granted, F375's remaining
battery (`build:shell` → `dist:deb`/`dist:appimage` → the packaged
smoke) runs end-to-end as built.

## 5. Other findings

- **F2 — the `@zcode/desktop` replacement.** The path held the zcode
  agent desktop at base (1480 files — §1). F375 replaced it wholesale
  under the owned-path grant + the operator's live word. Side effect:
  the root scripts `scripts/dev-desktop-env.mjs` and
  `scripts/dev-desktop-remote-prod.mjs` remain on the tree, now
  unreferenced (F375 removed their `package.json` entries — the
  sanctioned root motion — but cannot delete files outside its grant).
  Dead-but-harmless; a future zcode lane or the TL may retire them.
- **F3 — the root `package.json` motion, precisely.** Beyond the
  workspace registration + electron/electron-builder resolution, the
  replacement forced removing the `@zcode/desktop`-referencing script
  entries (`dev:desktop*`, `prepare:desktop-runtime`,
  `build:bootstrap`'s desktop arm, `bundle:desktop`,
  `prepare:remote-assets`) and the `@arms/rum-electron` patch pin (its
  only consumer was the old desktop). The `typecheck` script gained
  `packages/desktop/tsconfig.host.json` (the new project joins the
  root gate — green, §3.2). Recorded for ratification with the
  lockfile diff (`packages/desktop` importer + the patch entry; nothing
  else).
- **F4 — the shell serves `dist-fleetos` from the service, not from the
  app bundle.** The packet's `app://`-protocol concern did not arise:
  the app loads `http://127.0.0.1:3106/?mode=durable` — the shell is
  served by the durable service it composes (the F351A form). The
  sanctioned web motion was therefore NOT used; F375's diff touches
  `packages/web` zero times.

## 6. Honest limits

- The bundled world is the **F351A fixture-labelled demo composition** —
  the desktop app is the product's honest demonstrator, NEVER
  live-pilot evidence (the F369/F371 gate stays BLOCKED).
- Services bind localhost only; single-user desktop form.
- Ubuntu amd64 is the target (the operator's desktop); other distros
  untested.
- Electron 41.0.3 + electron-builder 26.8.1 from the official npm
  registry (download verified in-sandbox, §3.4).
- The packaged artifact + its smoke are NOT yet produced — blocked by
  Finding F1 at base, not by any F375-owned defect. The smoke script
  (`scripts/smoke.mjs`) is complete and waits on the same adjudication;
  its assertions were re-verified against the shell sources at HEAD
  (labels, blurbs, per-route facts, the command console's ack/queue/
  audit/DurablePanel shapes, `/api/health`'s replay fields).
- The GitHub Release is the TL's step at the gate — the worker never
  publishes releases.

## 7. The TL gate record (2026-10-17, gate worktree /home/z/gate-f375)

The gate machine-ran the full battery at the lane tip + the adjudication
motions (commit 1bc49b0 on work/f375):

| Check | Result |
| --- | --- |
| frozen install (corepack pnpm@10.33.2) | GREEN |
| desktop typecheck + lint | GREEN (file law max 364 ≤ 400) |
| root typecheck gate | GREEN |
| F1 reproduced at the gate tree BEFORE the fix | the exact 4 MISSING_EXPORT errors |
| identity suite after the BURN_DIGEST lazy motion | 207/207 GREEN |
| web fleetos typecheck after the shim motion | GREEN |
| `build:shell` | GREEN — `__FLEETOS_COMMIT__` = HEAD proven (1149 assets) |
| `dist:deb` → `fleetos_2.0.0_amd64.deb` | BUILT |
| `dist:appimage` → `FleetOS-2.0.0.AppImage` | BUILT |
| the packaged smoke | **ALL ASSERTIONS GREEN** (full transcript below) |

**The F1 adjudication (GRANTED, with a live-caught revision).** The shim
gained the three honest-refusal exports; but the worker's "the browser
never calls them" proved WRONG for `scryptSync` — `credentials.ts:101`
computed `BURN_DIGEST` at module scope, so the browser graph CALLED it at
import time and the refusal threw, killing the shell render (the silent
app death the first smoke round surfaced). The revision: `BURN_DIGEST` is
now lazily memoized (same value, computed once on first use — the
documented deterministic-pure contract preserved; the browser never reaches
the burn path). Identity 207/207 re-verified GREEN at the fixed tree.

**The latent defects the F1 block hid** (fixed by the TL at the gate,
commit 1bc49b0): the electron-builder per-target keys belong at the config
root (`appImage`, camelCase — W038-RC-2's class; `arch` is not a valid
`linux:` key), the deb's required maintainer fields (author email +
homepage), and three smoke defects (CDP_PORT hardcoded 9222 — poisoned by
the TL station's own CDP Chrome on 9222, now 9333; the single
connectOverCDP racing the app's CDP boot, now retried under the deadline;
`textOf`'s locator-vs-(page,selector) signature mismatch).

**The artifact sha256s (built at the gate tree, 1bc49b0):**

```
fleetos_2.0.0_amd64.deb   94,625,932 bytes
  sha256 0c50d8460c9e3bcf5f9aca8d5ee9d3334bcc303c5b97d736362e30d8a85649c5
FleetOS-2.0.0.AppImage  120,762,558 bytes
  sha256 b35992cf5d0349f367767d3c7cf76cee15f95b918d04024dd9b3c4069c1405ba
```

(The operator-facing Release artifacts are REBUILT at the converged main
merge SHA — the footer-proven release tree, per the F352 precedent; those
sha256s are recorded in the Release notes.)

**The packaged smoke transcript (the honest gate, abridged to the
assertion lines):**

```
[SMOKE] app pid 10036 · display :98 · shell http://127.0.0.1:3106/?mode=durable
[SMOKE] X11 top-level window titles: ["Chromium clipboard","fleetos","FleetOS"]
[SMOKE] PASS window titled "FleetOS"
[SMOKE] PASS document.title is the shell's — FleetOS — Operational Truth Console
[SMOKE] PASS durable mode in the URL
[SMOKE] PASS footer declares the durable plane
[SMOKE] PASS footer commit = HEAD — 6e7c76d… (the gate-tree HEAD)
[SMOKE] PASS six nav buttons
[SMOKE] PASS nav[0..5] labels + route hashes + blurbs + fixed facts (all six)
[SMOKE] PASS durable badge in the command path
[SMOKE] PASS ack ENQUEUED cmd_0000000001 duplicate=false
[SMOKE] PASS queue record asset.enroll — queued
[SMOKE] PASS submission log: exactly 1 audit entry — OK — enqueued for Guardian adjudication
[SMOKE] PASS durable panel: service :3106
[SMOKE] PASS durable panel: replay 0 on fresh data
[SMOKE] PASS SIGTERM → app exits 0 — exit=0
[SMOKE] PASS ZERO orphan processes (pgrep over the extraction path)
[SMOKE] PASS port :3106 released (connection refused)
[SMOKE] PASS restart replays 1 command — {"commands":1,"audit":1,"assets":0,…}
[SMOKE] PASS restarted UI shows the replayed queue record
[SMOKE] PASS second run: SIGTERM → exits 0 / ZERO orphans / port released
[SMOKE] ALL ASSERTIONS GREEN
```

Standing limits unchanged: the bundled world is the fixture-labelled demo
composition; localhost single-user; Ubuntu amd64; F369/F371 live-pilot gate
BLOCKED as ever.
