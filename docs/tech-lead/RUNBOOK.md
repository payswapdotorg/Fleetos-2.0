# FleetOS 2.0 — Operations Runbook

**Audience:** any future TL/operator continuing or operating this repository.

## Repository layout (the durable map)

| Path | What it is |
|---|---|
| `FLEETOS-SOURCE-OF-TRUTH.md` | The canonical product/architecture statement |
| `spec/ARCHITECTURE-LOCK.md` | Frozen architecture (version 2.0.0) |
| `spec/BOUNDED-CONTEXTS.md` | The bounded contexts and their boundaries |
| `spec/DEPENDENCY-GRAPH.md` + `spec/snapshots/fleetos-contracts.json` | The dependency graph + contract snapshot |
| `spec/worker-ownership.yaml` | Worker A/B/C/TL ownership grants (the ONLY legal edit paths) |
| `spec/work-items/WORK-ITEM-CATALOG.md` | The execution backlog (Waves 0–9) |
| `spec/ADR/` | Accepted architecture decision records (0001–0006) |
| `docs/tech-lead/` | FINAL-HANDOFF, CONCURRENCY-PROTOCOL, packets, this runbook |
| `docs/evidence/<work-item>/report.md` | Per-item delivery evidence (40 items) |
| `packages/<context>` | 33 domain packages (pure deterministic TS) |
| `packages/integrations/*`, `packages/experiences/*` | Adapter + experience packages |
| `packages/acceptance/{field,security,commerce,adoption,release,convergence}` | The machine-run acceptance plane |

## Build, test, gate

```bash
corepack pnpm install                      # workspace install (repo root)
cd packages/<name>
corepack pnpm run test                     # vitest suite
corepack pnpm run typecheck                # tsc --noEmit
corepack pnpm run lint                     # oxlint (0 warnings / 0 errors required)
```

- File law: every file ≤ 400 code lines (skipBlankLines/skipComments).
- Purity law: no `Date.now`, `Math.random`, timers, network, `new Date` in domain code.
- Full monorepo: `corepack pnpm -r test` (run at wave close; per-packet cost is too high).
- Acceptance baselines (re-run on every merge that touches a lane): field 61, security 90,
  commerce 65, adoption 90, release 88, convergence (see F291 evidence).

## Merging a worker delivery (the gate procedure)

1. `git fetch origin` — then `git branch -f work/<item> <delivery-commit>` (REF-SYNC law:
   the local branch ref can lag the worker's push).
2. Clean worktree at the exact commit: `git worktree add /tmp/gate-<item> <commit>`.
3. In the worktree: per touched package — test / typecheck / lint; boundary grep
   (own-lane imports only); purity sweep; file law; evidence report review.
4. Re-run every affected baseline (machine-verified counts must match the packet).
5. Merge `--no-ff` with a message that records the gate numbers; resolve any lockfile
   conflict with `--ours` and RE-LINK (`corepack pnpm install`); **post-merge re-runs are
   mandatory** (they have caught a real integration error before).
6. Push main; sync `AI_CONTINUATION.md`; append the worklog.

## The delivery channel (chat.z.ai workers via CDP)

Workers are dispatched as chat.z.ai **Agents-tab** sessions (type `general_agent`,
Full-Stack agent type, GLM-5.3 when available) driven over Chrome DevTools Protocol:

- Chrome runs headless via Xvfb (`:99`) with `--remote-debugging-port=9222
  --remote-allow-origins=*` (Chrome 155+ requires the origins flag) on the persistent
  browser profile (login `ali20`).
- Dispatch: Agent tab → New Task → (model GLM-5.3) → Full-Stack → arm `#chat-input`
  with the packet text (React native value setter + input event; base64 transport for
  large text) → submit → verify the record (`GET /api/v1/chats/<id>` via in-page fetch,
  msg1 length == packet length).
- The record API path is `/api/v1/chats/<id>`; messages live under
  `chat.history.messages` (a message-id map, sort by timestamp).
- A chat whose turn never spawned shows a bouncing `/c/<id>` → home redirect in the UI —
  that session is a draft; re-dispatch fresh.
- Sandbox limits: stale Full-Stack sandboxes block new spawns (banner: "active sandboxes
  exceed the limit"). Release stale rows (keep live ids) and re-dispatch/nudge. The
  banner can be STALE UI — reload the page before trusting it.
- Work orders carry the push URL with the operator PAT substituted (the record API
  redacts nothing; platform tool output does).

## Sandbox/platform operational laws (this environment)

- **Exec-session teardown:** every process spawned from a shell command dies when the
  command ends. Long-lived daemons must be **double-forked** (grandchild reparents to
  init before the parent returns) or spawned as detached children of the boot-owned
  Next.js dev server via `POST /api/replay` (route `src/app/api/replay/route.ts`,
  header `x-replay-token`).
- Finite heavy tasks (installs, suites) must complete inside one command (≤10 min) or
  run as a daemon writing to a log.
- **Workspace placement:** never clone this repo inside a directory that has its own
  `node_modules` (the ancestor poisons vitest's vite resolution). Clone to `/home/z/fleetos`.
- Durability: everything that matters is pushed to the remote (branches + main + docs);
  the local clone is disposable.
- z.ai network: the sandbox's datacenter exit IP may be ESA-blocked (405 HTML on
  completions POST). The classic fix was the TurboVPN extension (a dropped VPN = a 405
  storm = empty generations). A stale proxy config in the profile ALSO blocks all
  navigation (purge `extensions.settings.<id>.preferences.proxy` from `Preferences`).
  Check connectivity first; the current environment connects directly.

## Watch loop (the TL's resident duty)

1. Monitor: `/home/z/my-project/fleetos-replay/monitor.py` (registry + watcher log +
   remote branches); the resident watcher daemon polls sessions every 60 s and logs
   delivery events.
2. Harvest: on `work/<item>` push or the worker's final report, collect the delivery
   commit.
3. Review: the gate procedure above.
4. Approve/require-changes: merge + push, or send the fix list to the worker session.
5. Dispatch next: packets live in `docs/tech-lead/packets/`; new packets follow the
   catalog + FINAL-HANDOFF rubric; keep ≤3 concurrent workers.

## Release gates on the high-memory builder (Wave 11+)

The root gates that OOM the 4 GB sandbox run on **GitHub Actions** — this repo is
public, so ubuntu runners (4 vCPU / 16 GB) are free:

- Workflow: `.github/workflows/release-gates.yml`. Jobs: `root-typecheck` (B-1),
  `full-build` (B-2), `acceptance-gates` (F312 preview: verify + monorepo tests +
  the six suites).
- Triggers: pushes to `work/f31*` lanes run automatically at the pushed commit; the
  TL dispatches at any ref via the API (`POST .../actions/workflows/release-gates.yml/dispatches`).
- Evidence: the run pages are public and permanent; each job's builder-facts block
  records RAM/CPU/node/pnpm/SHA; artifacts carry install/typecheck/build/tests logs.
- **Exit-capture law:** every gated command piped through `tee` MUST capture
  `PIPESTATUS[0]` and `exit $rc` (the 2026-10-10 F310A finding: a tee'd step exits
  with tee's 0 — a false green).
- The FleetOS shell type-checks through its dedicated project
  (`packages/web/tsconfig.fleetos.json`, included in the root `typecheck` list) —
  do not re-include `src/fleetos` in the substrate web project.

## Sandbox redeploy (after a reset)

1. Clone `payswapdotorg/fleetos-2.0` + `payswapdotorg/replay2`; the durable browser
   profile (`/home/z/my-project/browser-profile`) and ops vault survive resets.
2. Replay stack: `cd replay2 && bun install && NEXT_DIST_DIR=.next-prod bun run build &&
   CONSOLE_LAUNCHER=scripts/launch_prod.py ./deploy.sh` (PORT GUARD evicts the
   template squatter on :3000).
3. FleetOS product: `cd fleetos && corepack pnpm install --frozen-lockfile
   --ignore-scripts` (the 4 GB box cannot run the native postinstalls; the product
   surface needs none of them) then `cd packages/web && npx vite build --config
   vite.fleetos.config.ts`; serve `dist-fleetos/` via the supervisor-kept
   `scripts/local/fleetos_server.py` (:3105, registered in
   `scripts/flags/local_services.json`).
4. The monorepo install on the 4 GB box: `--ignore-scripts` is mandatory (three
   silent OOM deaths at native-compile phases otherwise); the full-toolchain install
   and the root gates run on the CI builder, not this box.
