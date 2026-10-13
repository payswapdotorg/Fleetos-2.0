# F351A — deployment + durable-persistence qualification (the w15a lane)

- **Work item:** F351A (`spec/work-items/WORK-ITEM-CATALOG.md`, Wave 15).
- **Owner:** worker A under the F350 §3 grant (deployment + composition are
  TL-owned; this packet is the explicit D11-analog grant). **Date:**
  2026-10-13.
- **Base:** `761161b391071aa4fdf67d7db6440a26bed85a9c` (the post-F343 merge,
  exactly the packet's expectation). **Branch:** `work/f351a`.
- **Code commit (the candidate the shell was built at):**
  `ab3a85dfe650eefdc1055cd7231b9d1d352ea9bf` — the footer of every rendered
  page carries it (injected by `vite.fleetos.config.ts` `__FLEETOS_COMMIT__`).
- **Binding law:** `docs/evidence/F350/report.md` §2 (Q1–Q5).

## 1. What was built

### 1.1 The service (Q1) — `infrastructure/fleetos-durable/`

One Node process, fixed port **:3106**, `node:http` only — no framework, no
new top-level dependencies (node: builtins + the REAL `@fleetos` domain
packages, loaded through two small ESM resolve hooks because the workspace
ships raw TypeScript sources through its exports maps):

| File | Lines | Role |
| --- | --- | --- |
| `service.ts` | 381 | node:http server: static shell + the durable API |
| `store.ts` | 256 | append-only JSONL segments; write+fsync-before-ack; canonical-JSON sha256 digests |
| `recovery.ts` | 163 | replay-on-start: re-drive every segment through the REAL queue/directory, byte-exact verification, fail-closed |
| `static.ts` | 55 | static shell serving (hash routing, SPA fallback, traversal-refusing) |
| `hooks.mjs` / `runtime.mjs` | 101 / 14 | `@fleetos/*` + `.js`→`.ts` ESM resolve shims (node:module register) |
| `supervisor.mjs` | 73 | the supervisor-keep loop (restart on ANY exit incl. SIGKILL, 1s backoff) |
| `proof-restart.mjs` | 263 | the Q2 machine proof (below) |
| `tsconfig.json`, `.gitignore`, `README.md` | — | typecheck project; `data/` gitignored; the run book |

It serves BOTH the static shell (`packages/web/dist-fleetos/`, built with
`npx vite build --config vite.fleetos.config.ts` at the candidate SHA — 296
modules, 354.47 kB / 103.74 kB gzip) and the durable API over three
append-only JSONL segments under `infrastructure/fleetos-durable/data/`
(gitignored):

- `commands.jsonl` — the REAL control-plane `CommandRecord`s (one line per
  UNIQUE enqueue; duplicates never enqueue so they never append; refusals
  are audit facts, not queue state);
- `audit.jsonl` — one line per command-submission ATTEMPT (ack, duplicate,
  refusal alike): the durable analog of the in-process submission log
  (`commandPath.ts`), extended with `tenantId` for fail-closed scoped reads;
- `assets.jsonl` — one line per successful enrollment: the REAL
  `EnrollmentRecord` + the kernel `AuditEventRef` the `EnrollmentDirectory`
  emitted.

**The laws, where they live:** write-before-ack is `store.append` (single
`writeSync` + `fsyncSync` before the handler responds). Replay-on-start is
`recovery.ts`: every persisted envelope is re-submitted through the same
`CommandQueue` (same counter order ⇒ same `cmd_…` ids, same inputs ⇒ same
sha256 audit digests) and every re-enrollment through the same
`EnrollmentDirectory`, each compared canonical-JSON-byte-exactly against the
persisted record — any mismatch is a hard refusal to start. Idempotency is
the REAL queue's law unmodified (duplicate logical intent → the ORIGINAL
ack with `duplicate=true`, never a second enqueue; verified live in §3).
Tenant-scoping is fail-closed end to end: kernel-validated contexts
(malformed ids → 400), strictly ctx-scoped reads (other tenants' records are
absent), draft-tenant ≠ context-tenant → the tower's `tenant-mismatch`
refusal (audited). Tampered asset-field drafts are additionally refused by
the REAL `verifyCommandDraftDigest`.

API: `GET /api/health` (commit + replay report), `GET /api/digest` (full
record-set digests — the operator proof surface, digests only, no records),
`GET /api/state?tenantId&actorId` (tenant-scoped records + per-tenant
digests), `POST /api/commands` `{tenantId, actorId, draft}` (returns the
`TowerSubmitResult` verbatim), `POST /api/enrollments`
`{tenantId, actorId, deviceId}` (returns the `EnrollmentDirectoryResult`
verbatim).

### 1.2 The shell durable mode (Q1 continued) — `packages/web/src/fleetos/`

| File | Lines | Role |
| --- | --- | --- |
| `port.ts` | 95 | the command-path port (`FleetCommandPort`) + the Promise-wrapped in-process adapter — the F301 composition unchanged |
| `durable.ts` | 203 | the fetch-backed adapter: SAME port contracts; the browser builds the REAL lane drafts (the identical code path) and POSTs them; `service-unreachable` is an honest transport failure, never a fake tower refusal |
| `durable-panel.tsx` | 113 | service health/replay card, the durable enrollment registry, the per-tenant record digests |
| `main.tsx` / `pages-commands.tsx` | 153 / 198 | `?mode=durable` toggle (default in-process), the plane named in the footer and the page header, one async code path for both modes |
| `pages.tsx` / `styles.ts` | 394 / 50 | 4 dead imports dropped (scoped-lint hygiene); the mode-switch link style |

The in-process mode keeps working unchanged (§4 regression). The fixture
WORLD is untouched (Q4): observations/sim-worlds stay fixture-composed
in-browser; only the OPERATIONAL plane (commands, audit, enrollments) is
durable. `world.ts`, `commandPath.ts`, `crypto-shim.ts`, `work-items.ts`,
`fleetos.html`, `vite.fleetos.config.ts` are byte-identical to main.

## 2. The restart-recovery proof (Q2 — machine-run, exit 0)

`node --experimental-transform-types --no-warnings --import
./infrastructure/fleetos-durable/runtime.mjs
infrastructure/fleetos-durable/proof-restart.mjs` (isolated temp data dir,
service spawned/killed by the script; port 3106 free):

1. start → healthy (replay 0/0/0);
2. seed through the REAL API: enroll `dev_proof-acme-r1` (tnt_acme-logistics)
   + `dev_proof-mer-r1` (tnt_meridian-health); submit 3 commands — clean
   `asset.enroll` → `cmd_0000000001` (duplicate=false), the SAME logical
   intent again → **duplicate=true, the SAME commandId, no second enqueue**,
   and an out-of-vocabulary reason → **refused `reason-not-in-vocabulary`**;
3. capture digests; 4. **`kill -9`** (exit signal SIGKILL, not graceful);
   restart; 5. re-read + re-digest; 6. exit 0 only on full match.

```
            BEFORE kill                                AFTER restart
commands    b525423f2619713989de69d305afd02c9ee07c16f43314b9cd1ed40599726d0b    MATCH (byte-exact)
audit       bfd3e5cfddf100fbff7ec88720a3b31b640abd22f86b57a0b6e10f8f5d39536f    MATCH (byte-exact)
assets      3c53205ffd6715696234baea38a6780968432e28ad29021ff73248ab2b45510a    MATCH (byte-exact)
total       51136351a56f62b8ba34107cc87fffce6b2ccd390f4d29e9703e3a37afad71fb    MATCH (byte-exact)
counts      {commands:1, audit:3, assets:2}                                     identical
raw files   commands 02ef52a6… audit 2444f3a2… assets 15b47adb…               unchanged
/api/state  both tenants, commands+submissions+enrollments                      identical
```

`PROOF PASSED (exit 0): every operational record survived the SIGKILL
restart byte-exactly.` (Digests are sha256 over the canonical JSON of the
records, per segment and total; the raw-file sha256s additionally prove the
restart never touched the segments.)

## 3. Browser evidence (Q3 — at the candidate `ab3a85d…`)

Deployment: the supervisor-kept service on :3106 serving the shell built at
`ab3a85dfe650eefdc1055cd7231b9d1d352ea9bf` (the footer of every screenshot
carries it). Screenshots in `screens/`:

- **All six routes render in durable mode, zero unexpected refusals:**
  `01-tower`, `02-field`, `03-safety`, `04-commerce`, `05-lab`,
  `06-commands-durable-empty` (honest empty queue/audit/digests before the
  journey). Real in-page digests observed: tower `tower_40567aaf`, lab state
  `3976fcd4` (the F301 values — the fixture world unchanged).
- **The E2E journey through the DURABLE service via the UI**
  (`07`–`11`): enroll `dev_browser-e2e-01` into the durable registry →
  `ENROLLED … (audit digest d7c11336…)`; submit `asset.enroll` →
  `ENQUEUED cmd_0000000001 (duplicate=false)`; resubmit the same logical
  intent → `ENQUEUED cmd_0000000001 (duplicate=true)` — the ORIGINAL ack,
  never a second enqueue; out-of-vocabulary reason →
  `REFUSED reason-not-in-vocabulary: reason 'bogus-reason-not-in-vocabulary'
  is not in the vocabulary for tower.cmd.asset-field.asset-enroll` rendered
  verbatim and audit-logged.
- **Tenant/role switching re-composes from durable state** (`12`): Acme →
  Meridian Health re-reads per-tenant state (Meridian: the empty-set
  digests `4f53cda1…` for commands/audit/assets — no Acme record leaks);
  enrolling `dev_browser-mer-01` under Maya re-composes Meridian's table;
  switching back to Acme re-renders the SAME Acme digests; the Role switch
  re-composes the header (`act_tom-technician`).
- **Restart-survival in the browser** (`13`/`14`): with the page open,
  `kill -9` the service — the supervisor restarts it (log: `generation 1
  EXITED (code=null signal=SIGKILL)` → `generation 2 … replayed 1 command(s),
  3 audit entrie(s), 2 enrollment(s) in 2ms`) — then a plain browser refresh:

```
tnt_acme-logistics digests   BEFORE kill (13)                         AFTER restart + refresh (14)
commands                     4bd00f7644bce264d2b7190325cd07971ad06295ef19af7629f3c37a9a54baf2   identical
audit                        3b9ee2b50226d86586fb669b22c0b662ef9decfc26b13c5c605d0dfaa4eed0f4   identical
assets                       9bcb16690e1d601391908c238eb55cfaada78ebfc7522df31ccfe6e99b11a0b7   identical
total                        ad7c11fea197e15e5537bd9e863a9194fb4f9264b5c8a48f047b70193ff67534   identical
```

  The enrollment table still renders `dev_browser-e2e-01` at its original
  timestamp, the submission log still renders all three attempts, and the
  service card shows the NEW `startedAt` with the replay report — the state
  is the service's disk, not the browser's memory. **Zero console errors**
  across the session.

## 4. Verification battery (machine-run, 2026-10-13)

| Check | Command | Result |
| --- | --- | --- |
| field | `pnpm --filter @fleetos/acceptance-field test` | **102/102 (7 files)** |
| security | `pnpm --filter @fleetos/acceptance-security test` | **179/179 (8 files)** |
| commerce | `pnpm --filter @fleetos/acceptance-commerce test` | **115/115 (6 files)** |
| convergence | `pnpm --filter @fleetos/acceptance-convergence test` | **82/82 (4 files)** |
| maintenance | `pnpm --filter @fleetos/maintenance test` | **99/99 (5 files)** |
| adoption | `pnpm --filter @fleetos/acceptance-adoption test` | **120/120 (9 files)** |
| release (the gate) | `pnpm --filter @fleetos/acceptance-release test` | **88/88 (4 files)** |
| counts (Q5) | the adoption pins, untouched | **3027 / 1179 / 1017 / 831 / 931 — unchanged** (`simulation.test.ts` lines 30–34 all green; zero acceptance paths in the diff) |
| restart proof (Q2) | `proof-restart.mjs` | **exit 0** (§2) |
| typecheck | `pnpm run typecheck` (root chain incl. `packages/web` + `tsconfig.fleetos.json`) | **exit 0** |
| typecheck (service) | `tsc -p infrastructure/fleetos-durable/tsconfig.json` | **exit 0** |
| lint | `oxlint infrastructure/fleetos-durable packages/web/src/fleetos` | **0 warnings / 0 errors** (repo-wide: 72 warnings, 0 errors — none in this lane's paths; the lane REMOVED 6 pre-existing dead-import warnings) |
| in-process regression | browser, `#/commands` without the flag | **works unchanged**: `ENQUEUED cmd_0000000001 (duplicate=false)` → resubmit → `(duplicate=true)` in browser memory (`15-in-process-regression.png`) |
| file law | `wc -l` | every new file ≤ 381 lines (max: `service.ts` 381; oxlint `max-lines 400` green) |
| boundary | `git diff --name-only main...HEAD` | ONLY the owned paths (§6) |

## 5. Honest limitations (Q4 — mandatory)

- **Sandbox-hosted.** The sandbox exposes one external port, occupied by the
  resident console; the service binds localhost:3106 inside the sandbox. NO
  public-internet exposure is claimed. Durability is process-crash
  durability (write+fsync per record; a SIGKILL leaves every ACKED record
  intact, and an unacked torn trailing line is dropped at replay with a
  logged warning) — power-loss/media-level durability is not claimed.
- **Providers stay CONTRACT_ONLY** (Aurum/ADCOS/Arena/model-gateway) —
  unchanged, upstream-gated.
- **The fixture WORLD remains the domain-input convention:** observations and
  sim-worlds are still fixture-composed in-browser per the acceptance-suite
  law. What is durable is the OPERATIONAL plane only: command-queue records,
  the submission audit log, and device enrollments. The fixture tenants,
  actors and demo assets are inputs, not durable state.
- **Scoping notes on the durable plane itself:** actor identity is validated
  for shape/scope, not authenticated (the same trust model as the shell
  demo — no sessions exist); a draft the lane builder refuses locally is
  returned exactly as the in-process path returns it and is not durably
  audited (the service was never asked); `GET /api/digest` exposes only
  sha256 digests over the global record set (the operator proof surface),
  never record contents; the durable audit log is not capped at the
  in-process 50-entry presentation cap (durable means nothing dropped —
  recorded here as a deliberate difference); the in-process mode's
  `submissionsOf()` is context-free by contract and returns `[]` on the
  durable adapter (the page reads the tenant-scoped `stateOf`).
- **The evidence SHA vs the tip:** the shell was built and browser-verified
  at the code commit `ab3a85d…` (the footer proves it); this report and the
  catalog line are committed after, so the pushed branch tip is a later SHA
  on the same branch. The candidate code is byte-identical.

## 6. Boundary (the strict owned-path law)

`git diff --name-only main...HEAD` — exactly the packet's owned paths:

```
docs/evidence/F351A/report.md                                  (this file)
docs/evidence/F351A/screens/01-tower-durable.png               … 15 screenshots
infrastructure/fleetos-durable/.gitignore
infrastructure/fleetos-durable/README.md
infrastructure/fleetos-durable/hooks.mjs
infrastructure/fleetos-durable/proof-restart.mjs
infrastructure/fleetos-durable/recovery.ts
infrastructure/fleetos-durable/runtime.mjs
infrastructure/fleetos-durable/service.ts
infrastructure/fleetos-durable/static.ts
infrastructure/fleetos-durable/store.ts
infrastructure/fleetos-durable/supervisor.mjs
infrastructure/fleetos-durable/tsconfig.json
packages/web/src/fleetos/durable-panel.tsx
packages/web/src/fleetos/durable.ts
packages/web/src/fleetos/port.ts
packages/web/src/fleetos/main.tsx
packages/web/src/fleetos/pages-commands.tsx
packages/web/src/fleetos/pages.tsx
packages/web/src/fleetos/styles.ts
spec/work-items/WORK-ITEM-CATALOG.md                           (the one-liner)
```

No domain packages, no acceptance packages, no new top-level dependencies,
`pnpm-lock.yaml` untouched, `data/` and `dist-fleetos/` gitignored.

## 7. TL re-run commands

```bash
cd packages/web && npx vite build --config vite.fleetos.config.ts && cd ../..
node infrastructure/fleetos-durable/supervisor.mjs   # :3106, supervisor-kept
# shell: http://localhost:3106/?mode=durable#/commands  (in-process: no query param)
node --experimental-transform-types --no-warnings \
  --import ./infrastructure/fleetos-durable/runtime.mjs \
  infrastructure/fleetos-durable/proof-restart.mjs    # Q2 — expects exit 0
```
