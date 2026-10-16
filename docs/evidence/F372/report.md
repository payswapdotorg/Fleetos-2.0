# F372 — networked PostgreSQL at the host boundary: the evidence report

Worker lane w19a (Wave 19 lane A), branch `work/f372`, base `origin/main`
@ `76ddba0baef27460638c54415769ba9b460e1c80` (WAVE 19 OPEN). The packet:
`docs/tech-lead/packets/f372.md`. This report is the machine-verifiable
record: every number below was measured at the lane tree, not asserted.

**AMENDED at the TL gate** (the REQUIRE-CHANGES on e48692c: the
networked-server-crash journey was non-deterministic across environments
— reproduced 3x on the gate box, postgres 16.4 via `FLEETOS_PG_BINDIR`:
during the SIGKILL/restart window the post-restart digest read hit a
pre-crash pool client and surfaced the RAW `57P01 terminating connection
due to unexpected postmaster exit` as an API error instead of a controlled
verdict). The fix is BOTH prongs of the gate's prescription, machine-asserted:
the FROZEN crash-window verdict at the boundary (§1, §3a) AND the verified
reconnect sequencing (§3b) — see the finding record in §7.

## 1. What was delivered (the F372 packet, as REAL infrastructure)

The recorded standing qualification — *"pglite = the WASM in-process build
(networked-PG at the host boundary the recorded follow-up)"* — is CLOSED:

- **The networked adapter** (`infrastructure/fleetos-marketplace/pg-store.ts`):
  `NetworkedPgMarketplaceStore implements MarketplaceStore` — the FROZEN
  operation set (`store.ts:188`) over the `pg` (node-postgres) driver at a
  REAL postgres server reached over TCP (`postgres://` connection string).
  Schema parity is STRUCTURAL, not by copy: the DDL is expressed ONCE
  (`schema.ts:28`, `MARKETPLACE_SCHEMA_DDL` — consumed via the multi-statement
  simple query with `CREATE TABLE IF NOT EXISTS`) and the tenant-scoped table
  shapes (the `TableSpec` natural keys + the A8 leading `tenant_id`) come from
  the shared `pglite-tables.ts` — both adapters consume the same source, so
  the table shapes are IDENTICAL BY CONSTRUCTION. `pglite-store.ts` is
  byte-UNTOUCHED (zero behavior motion; its tests green UNCHANGED — the DDL
  refactor is consumption-only, on the networked side).
  - write-before-ack: every mutating statement is a committed transaction
    before the promise resolves (server-side WAL);
  - `transact()` (`pg-store.ts:109`): one request's multi-record writes in
    ONE transaction (BEGIN…COMMIT through a checked-out pool client);
  - A8 fail-closed through every business op (cross-tenant writes refuse,
    cross-tenant reads find nothing);
  - the pool attaches an `error` handler and later queries open FRESH
    connections — the transparent reconnect after a killed-and-restarted
    server (the journey's reconnect proof).
- **The server lifecycle harness**
  (`infrastructure/fleetos-marketplace/pg-server.ts`):
  `PostgresServerProcess.provision()` (`pg-server.ts:172`) runs `initdb` on a
  temp PGDATA (`-U fleetos --auth=trust -E UTF8 --locale=C`), starts the REAL
  `postgres` SERVER process on a kernel-assigned ephemeral port bound to
  127.0.0.1, probes TCP readiness (racing process death), and offers
  `kill()` (`pg-server.ts:214` — the REAL SIGKILL), `restart()`
  (`pg-server.ts:232` — same PGDATA + same port: REAL WAL crash recovery),
  and `teardown()`. Server discovery (`resolvePostgresBindir`,
  `pg-server.ts:57`): `FLEETOS_PG_BINDIR` → PATH → the Debian/Ubuntu system
  layout `/usr/lib/postgresql/<v>/bin` (newest first — the CI runner shape).
  NEVER an in-process library standing in for the server.
  - **The container law** (found the hard way, fixed structurally):
    `dynamic_shared_memory_type=mmap` is set at BOTH initdb (`--set`) and
    server start (`-c`). A SIGKILLed postmaster cannot clean up POSIX DSM
    files, so a crash-proof harness on the default 64MB container `/dev/shm`
    leaks itself to death (`FATAL: could not resize shared memory segment
    "/PostgreSQL.…" — No space left on device` in the sandbox reproduction).
    mmap DSM leaks NOTHING; DSM is ephemeral runtime state, never persisted —
    WAL recovery and the digest envelope are unaffected (the digest values
    are byte-identical across the DSM setting). This holds on any CI runner
    with a small `/dev/shm`, not just this sandbox.
- **The adapter selection in the deployment service**
  (`infrastructure/fleetos-marketplace/service.ts:92`, `openStore`):
  `FLEETOS_MARKETPLACE_STORE=pglite` (default — the F370C in-process mode,
  zero behavior motion) or `=networked` + `FLEETOS_MARKETPLACE_PG=<postgres://…>`
  (fail-closed refusal to boot when networked is selected without a
  connection string). The service laws UNCHANGED: node:http only,
  write-before-ack (one PG transaction per request), verify-on-start, A8
  tenant fail-closed — the same frozen port either way.
- **The frozen crash-window verdict at the boundary** (the gate-race
  amendment; `infrastructure/fleetos-marketplace/store-unreachable.ts` — a
  LEAF module, zero imports, composed by both TS projects): when the
  persistence plane's SERVER connection is lost, the service answers ONE
  deterministic verdict AS DATA — `503 { ok:false, refusedBy:"boundary",
  refusal:{ reason:"STORE_UNREACHABLE", detail:<frozen> } }` — wired into
  the single HTTP catch (`service.ts:227`). The classifier
  (`isStoreUnreachableError`, `store-unreachable.ts:83`) is deliberately
  NARROW: the SQL connection-lost family (57P01 — including the lingering
  backend's "unexpected postmaster exit" farewell, 57P02, 57P03 "the
  database system is starting up" — the WAL-replay window, the 08xxx class),
  the transport errnos (ECONNREFUSED — whose RAW message carries the PORT —
  ECONNRESET, EPIPE, …) and pg's bare messages ("Connection terminated
  unexpectedly", the pool connect timeout). Everything else keeps the
  fail-loud 500 internal path (a real defect is never masked as
  "unreachable"). The pglite in-process mode is UNAFFECTED by construction
  (an in-process store never raises the family — zero motion, its tests
  green UNCHANGED).
- **D14 journeys** (`packages/acceptance/commerce/src/journeys/f372-*.ts`):
  three census-certified journeys driving the REAL TCP server (the journey
  table in §4). The `npg-*` step family (`journey-contracts-f372.ts:36`,
  interpreted by `drivers-npg.ts:42`, dispatched through `runner.ts:226`)
  owns the server lifecycle; the spine verbs reuse the EXISTING `mps-*`
  family over the service's HTTP boundary — only the backing store differs.
- **Evidence**: this file.

## 2. The census (census-first, with grep proof at base `76ddba0`)

The F354 lesson, applied BEFORE implementation (greps at the base tree):

| pattern (at base 76ddba0) | hits | nature of every hit |
| --- | --- | --- |
| `networked` (in `*.ts`) | 8 lines, 5 files | ALL comment prose recording the follow-up ("a networked-PG adapter at the host boundary is the recorded follow-up") — zero code symbols |
| `npg-` | 1 (the f372 packet itself) | packet prose only |
| `pg-server` | 1 (the f372 packet itself) | packet prose only |
| `marketplace-networked-persistence` | 0 | the journey id is NEW |
| `marketplace-networked-server-crash` | 0 | the journey id is NEW |
| `marketplace-networked-adapter-parity` | 0 | the journey id is NEW |
| `NetworkedPg` / `PostgresServerProcess` / `FLEETOS_MARKETPLACE_STORE` / `FLEETOS_MARKETPLACE_PG` / `pg-store` / `drivers-npg` / `journey-contracts-f372` | 0 files each | every introduced symbol is NEW at this base |

The composition angle is in the ids (`marketplace-networked-*`, the
`npg-` op family) — never a mechanic a parallel corpus could claim; the
F362 spine verbs stay the EXISTING `mps-*` family. Zero collisions.

## 3. The server-crash proof (the machine facts, not prose)

From a real machine run of `marketplace-networked-server-crash` (TWO server
SIGKILLs + a service cold restart), the `mps.log` sequence and facts:

```
npg-server-boot:ok
digest:e69336c0ce62f82f4831609af15e5f22c9a472f3ab2f156e8bbf0dd93b734d24
npg-server-kill:sigkill                      <- SIGKILL #1 of the SERVER PROCESS
npg-server-restart:wal-recovered             <- same PGDATA + same port, REAL WAL recovery
digest:1205f31006caa9bb52cada9031bcb656d886c32675146ff96cf6cdd7d5406c24
                                             <- post-crash writes served by the RECOVERED server
npg-server-kill:sigkill                      <- SIGKILL #2 (a decided receipt + an enrolled asset on board)
npg-server-restart:wal-recovered
restart:kill:digests-identical               <- the SERVICE cold restart (verify-on-start replay)
digest:1205f31006caa9bb52cada9031bcb656d886c32675146ff96cf6cdd7d5406c24
```

Machine-checked facts (journey assertions, green):
- crash #1: `serviceAlive=true` (the service process SURVIVED the server's
  death), `storeUnreachable=true` (the boundary reported the persistence
  plane's death — the frozen STORE_UNREACHABLE refusal after the amendment,
  never a silent hang, never the raw error text in facts),
  `digestsIdentical=true` after WAL recovery;
- crash #2: `serviceAlive=true`, `digestsIdentical=true` (the harder WAL
  state: a decided receipt + an enrolled asset);
- the service cold restart over the network boundary: `verifyOk=true`,
  `receiptsReplayed=1` (byte-exact, fail-closed), `digestsIdentical=true`.
The F370C client-crash proof is thereby EXTENDED TO THE SERVER PROCESS.
The digest values above are stable across separate invocations (the
determinism battery re-runs the journeys and asserts canonical-JSON
equality of the FULL outcome + facts).

### 3a. The frozen boundary verdict (verdict-as-data; the gate-race fix, prong 1)

The crash window is inherently racy at the millisecond scale ON ANY REAL
POSTGRES: the killed postmaster's backends deliver their `57P01` FATAL
farewells asynchronously; the service's pool may hold pre-crash clients
whose failure surfaces late; the restarted server refuses startup packets
with `57P03` until WAL replay completes; a fresh connect while down raises
`ECONNREFUSED` (whose raw message carries the PORT). Before the amendment,
ALL of these crossed the boundary as an environment-dependent
`500 {error:"internal", detail:<raw text>}`. After: ONE frozen verdict —
`503 + STORE_UNREACHABLE` (§1) — machine-asserted by the battery: the
verdict shape is asserted exactly (status, `refusedBy`, the frozen reason),
the body is scanned to contain NO raw family text and NO port shape, and
the verdict is byte-STABLE across repeated reads in the window (whichever
family member fired underneath). The classifier's family coverage (every
SQLSTATE / errno / bare-message member) is unit-asserted; non-members
(unique violations, capacity, syntax errors, plain bugs) stay fail-loud
500 — a real defect is never masked as "unreachable".

### 3b. The verified reconnect (the gate-race fix, prong 2)

The drivers SEQUENCE through the window deterministically-in-outcome
(`drivers-npg.ts`):
- the kill PROBE (`:134`) retries (deadline-bounded, per-read timeout)
  until the store's death has SURFACED at the boundary — a lingering
  pre-crash backend may answer one transient 200 first on some
  environments; that is never mistaken for "still healthy";
- the post-restart digest (`:169`) is taken only after a VERIFIED
  RECONNECT: retry while the answer is the frozen refusal (each refused
  read also purges one pre-crash pool client; the 57P03 WAL-replay window
  expires); a NON-connection failure fails the step immediately
  (fail-closed); the first 200 IS the comparison point — byte-identical
  to the pre-kill baseline or honest failure, never a blind single read
  (the gate-box race: one read hitting a poisoned pre-crash client).

The wall-clock budgets (30s probe / 60s reconnect / 15s per read) are
BOUNDS only — they never enter facts; the happy path converges in
milliseconds and the journey outputs are byte-identical to the
pre-amendment form on boxes where the race never fired (verified: 6/6
stress runs of the crash journey byte-identical; the adversarial
harness — 4 pool clients, kill, immediate restart, the gate's BLIND
single read — answers 200-or-frozen-503 8/8, never a raw 500, and the
reconnect loop always converges with digests identical).

## 4. The journey table (D14 form; census-certified — table-less, single-epoch T0, invariant at every census offset)

| journey id | capability | assertions | asserted refusal paths |
| --- | --- | --- | --- |
| `marketplace-networked-persistence` | `marketplace-networked-persistence` | 29 | `NATURAL_KEY_CONFLICT` (divergent natural-key content), `ILLEGAL_TRANSITION` (early order), `ALREADY_ACKNOWLEDGED` (a different provider event), over-limit approval → `refuse` |
| `marketplace-networked-server-crash` | `marketplace-networked-server-crash` | 21 | `NATURAL_KEY_CONFLICT` |
| `marketplace-networked-adapter-parity` | `marketplace-networked-adapter-parity` | 19 | `NATURAL_KEY_CONFLICT` (asserted identically in BOTH adapter phases) |

69 new assertions total. Every journey: >= 5 substantive assertions, >= 1
asserted refusal, no epoch tables (D13 single-epoch T0 by construction),
ports/timestamps/paths never in output. The adapter-parity journey is the
PORT CONTRACT as a machine fact: the SAME record set through the pglite
adapter and the networked adapter — the digest envelope BYTE-IDENTICAL —
then dump → wipe (a FRESH cluster) → restore over the network boundary →
the same envelope, and the restored service serves reads AND writes (the
order's final `accept` transition).

## 5. The contract surface (file:line at the lane tree)

- `store.ts:188` — `MarketplaceStore` (the FROZEN port; unchanged)
- `schema.ts:28` — `MARKETPLACE_SCHEMA_DDL` (the DDL expressed ONCE)
- `pglite-tables.ts:15/49-95` — the shared `TableSpec` set (unchanged)
- `pglite-store.ts` — the pglite adapter (BYTE-UNCHANGED at this lane)
- `pg-store.ts:79` — `NetworkedPgMarketplaceStore`; `:92` `open()` (the
  pool + the shared DDL); `:109` `transact()` (the atomic boundary)
- `pg-server.ts:57` `resolvePostgresBindir`; `:151`
  `PostgresServerProcess`; `:162` `connectionString`; `:172` `provision()`
  (initdb + ephemeral port + readiness); `:214` `kill()` (the REAL SIGKILL);
  `:232` `restart()` (same PGDATA + port — WAL recovery); `:243` `teardown()`
- `service.ts:64/68/92` — `STORE_KIND` / `PG_CONNECTION` / `openStore()`
  (the adapter selection, fail-closed); `:227` the single HTTP catch —
  the frozen store-unreachable verdict wiring
- `store-unreachable.ts:45/83/99` — `STORE_UNREACHABLE_REASON` /
  `isStoreUnreachableError()` (the narrow connection-lost classifier) /
  `storeUnreachableOutcome()` (the frozen 503 verdict; a LEAF module —
  zero imports, composed by both TS projects)
- `journey-contracts-f372.ts:36` — `NpgStep` (the six npg-* step kinds)
- `drivers-npg.ts:91` `readDigest` (the bounded, refusal-classified read);
  `:120` `runNpgStep` (the interpreter; sanitized facts only); `:134` the
  kill probe (retry-until-surfaced); `:169` the verified reconnect
- `runner.ts:226` — `NPG_KINDS` (the dispatch); `journeys/index.ts` — the
  barrel (49 → 52); `journey-contracts.ts` — the capability vocabulary
  (38 → 41) + the `NpgStep` union member

## 6. The machine-run battery (exact numbers, all at the lane tree — re-run IN FULL at the amendment)

- **Commerce suite: 183 → 196 → 198 GREEN** (grow-only; the lane's original
  +10 battery tests + 3 `it.each` auto-growth in `tests/journeys.test.ts` at
  52 journeys, then the amendment's +2 crash-window-verdict-law tests in
  `tests/f372.test.ts`: the classifier-family unit test + the real-server
  boundary-verdict/verified-reconnect test). The amended suite ran as 6
  sequential vitest invocations (a sandbox session-tool timeout constraint —
  never a repo property; all 11 test files, ZERO skips, `F372_SKIP_SLOW`
  never set): 12 + 16 + 13 + 62 + 26 + 69 = **198/198** (f372 12, f361c 16,
  f331c 13, journeys 62, f362+f370c 26, corpus+report+runner+f321c+f351c 69).
  The two GATE-FAILING batteries re-verified green first: `f361c.test.ts`
  16/16 (the full-corpus byte-identical double-run) and `f331c.test.ts`
  13/13 (the T0-seam + invariants + the 400-journey-run census battery).
- **Commerce corpus barrel: 49 → 52** (machine-asserted: `corpus.test.ts`
  + `f372.test.ts` + the per-lane grow-only counters 46→49→52).
- **Cross-lane unchanged at this base:** security **237/237 GREEN**,
  identity **191/191 GREEN** (the parallel F373 lane owns their motion on
  ITS branch — untouched here).
- **The pglite adapter's existing tests green UNCHANGED:**
  `pglite-store.ts` has ZERO diff at this lane; the F370C battery
  (`f370c.test.ts` 4/4) + the `it.each` corpus loop (52 journeys) + the
  full-corpus determinism re-runs all pass on the byte-identical adapter.
- **Typecheck exit 0:** `@fleetos/acceptance-commerce` (`tsc --noEmit`) AND
  the service's dedicated `infrastructure/fleetos-marketplace/tsconfig.json`
  project (the F351A precedent; the project now includes `pg-store.ts` +
  `pg-server.ts` + `store-unreachable.ts`). **oxlint 0w/0e** on both
  (commerce 80 files src+tests; the service directory 21 files, the
  `max-lines` error rule among them).
- **File law (≤ 400 code lines, skipBlankLines/skipComments — the oxlint
  `max-lines` error rule):** max **400** (`pg-store.ts`, byte-unchanged at
  the amendment); then `journey-contracts.ts` 356, `runner.ts` 336,
  `journey-contracts-f370c.ts` 291, `drivers-npg.ts` 240, `drivers-mps-ops.ts`
  195, `service.ts` 187, `pg-server.ts` 164, `store-unreachable.ts` 115 —
  every lane file ≤ 400 (machine-enforced 0w/0e; test files exempt per the
  repo's override).
- **Determinism, byte-identical (re-verified IN FULL at the amendment):**
  (1) the F372 battery re-runs each of the three journeys TWICE and
  compares canonical JSON of the FULL outcome + facts — equal (real
  re-provisions, real SIGKILLs, real WAL recoveries, real restores, stable
  digest values); (2) `f362.test.ts` and `f361c.test.ts` re-run the FULL
  52-journey corpus twice each — byte-identical both times; (3)
  `f331c.test.ts` runs the 50 table-less journeys at the T0 baseline + 7
  census offsets (400 journey runs) — all green, all invariant; (4) the
  crash journey STRESS loop — 6 consecutive full runs (two SIGKILLs each;
  12 real postmaster kills) — all passed, all byte-identical to each other;
  (5) the adversarial harness (§3b): the gate's blind-single-read shape,
  8 iterations with a 4-client pool — every answer 200-or-frozen-503,
  never a raw leak, the reconnect always converging with digests
  identical. The output law is machine-scanned: no ephemeral-port shape,
  no `/tmp/` path, no `mps-journey-`/`pgdata` prefix, no `postgres://`
  string, no wall-clock ISO timestamp in any fact or log — and (the
  amendment's own law) no raw connection-lost text can cross the boundary
  at all.
- **The lockfile law:** root `package.json` + `pnpm-lock.yaml` motion is
  EXACTLY the sanctioned `pg@^8.23.1` + `@types/pg@^8.23.1` consequence
  (pure additions to the lockfile — pg, pg-connection-string, pg-pool,
  pg-protocol, pg-types, pg-int8, pg-cloudflare, pgpass, split2, xtend,
  postgres-array/bytea/date/interval, @types/pg — zero churn to any
  pre-existing entry), regenerated and verified with the REPO-PINNED
  `corepack pnpm@10.33.2 install --frozen-lockfile` → **exit 0**. The
  amendment adds NO dependency motion (the fix is pure code) — the frozen
  install re-verified exit 0 at the amended tree ("Done in 3.7s using pnpm
  v10.33.2").
- **Boundary (at the amended tree):** `git status` = ONLY the owned paths:
  `infrastructure/fleetos-marketplace/**` (service.ts + tsconfig include
  modified + `store-unreachable.ts` NEW — on top of the lane's original
  8-file motion), `packages/acceptance/commerce/**` (drivers-npg.ts,
  drivers-mps-harness.ts, the crash journey's one amended assertion
  description, tests/f372.test.ts — on top of the lane's original motion),
  `docs/evidence/F372/report.md` (this file). Root `package.json` +
  `pnpm-lock.yaml` carry the lane's ORIGINAL sanctioned motion, unchanged
  by the amendment. **ZERO domain-package edits; ZERO catalog edits;
  industries.ts ZERO motion; adoption/release pins honestly stale (the TL
  re-pins at F374); identity/security/kms untouched (the F373 lane).**

## 7. Honest limitations + findings

- **The networked server in this sandbox is localhost-only**: the harness
  provisions trust-auth clusters on 127.0.0.1 with ephemeral ports.
  Production host credentials / managed-PG (TLS, secrets, replication,
  failover, connection pooling at fleet scale) are **operator deployment
  class** — never claimed here.
- **The sandbox's postgres server is a self-contained distribution**
  (the zonky embedded-postgres extract, PostgreSQL **17.11**, at
  `/home/z/pg-dist`), reached through the harness's documented
  `FLEETOS_PG_BINDIR` env discovery (the "user-local zonky/official extract
  in a rootless sandbox" class — the packet's explicitly-sanctioned
  alternative to a system package; `apt-get` is unavailable rootless here).
  CI's system layout `/usr/lib/postgresql/<v>/bin` is the other documented
  discovery path; the harness tries env → PATH → system in order. The
  verification runs therefore carried `FLEETOS_PG_BINDIR=/home/z/pg-dist/
  dist/bin` — provisioning configuration, never test data.
- **FINDING (sandbox, fixed structurally in-lane): the 64MB `/dev/shm`
  container law** — SIGKILLed postmasters leak POSIX DSM segments
  (`/dev/shm/PostgreSQL.*`) until `initdb`/server starts fail with "No
  space left on device" (reproduced under concurrency BEFORE the fix).
  Fixed by `dynamic_shared_memory_type=mmap` at both initdb and server
  start (in-lane, `pg-server.ts`): after the fix, a full crash battery
  leaves **0** files in `/dev/shm` and digest values are byte-identical to
  the pre-fix runs. Recorded as a real robustness property for CI runners
  with small `/dev/shm`, not a sandbox hack.
- **FINDING (the TL gate, fixed in-lane at the amendment): the crash-window
  race** — the gate reproduced 3x on its box (postgres 16.4 via
  `FLEETOS_PG_BINDIR`, clean single-run): during the SIGKILL/restart window
  the post-restart digest read surfaced the RAW pool error `57P01
  terminating connection due to unexpected postmaster exit` as an API error
  (the old driver's ONE blind read after `restart()` could hit a pre-crash
  pool client — the failure is offset/timing-dependent, which is why the
  lane's own PG 17.11 runs passed 10/10 while the gate's 16.4 runs failed
  3/3). Root cause class: the crash window's error family is
  environment-dependent AS DATA (57P01 vs ECONNREFUSED-with-port vs 57P03
  mid-recovery), and a single blind read can land inside it. Fix: BOTH
  prongs — the frozen 503 `STORE_UNREACHABLE` verdict at the boundary
  (store-unreachable.ts + service.ts; the raw family never crosses) AND
  the verified-reconnect sequencing (drivers-npg.ts; the kill probe retries
  until the death surfaces, the post-restart digest retries through the
  frozen refusals — each also purging one dead pool client — with
  non-connection failures failing the step immediately). The mechanism was
  reproduced locally at the store level BEFORE the fix (the raw 57P01 and
  the ECONNREFUSED-with-port both observed in the down window); after the
  fix the blind-read answer is ALWAYS 200-or-frozen-503 (8/8 adversarial
  iterations) and the reconnect always converges with digests identical.
  The frozen verdict also closes a latent output-law hazard: the
  ECONNREFUSED raw text carries `127.0.0.1:<port>` — that string could
  previously cross the boundary in the 500 detail (it never entered
  journey facts; now it cannot cross at all).
- **The single-writer law stands**: the deployment service is ONE process;
  the networked pool's `max: 4` keeps the connection footprint explicit.
  Multi-replica concurrency against one networked server is a follow-up
  class (the store port already supports it; the service's serialization
  chain is the current law).
- **The commerce suite was executed as 6 sequential vitest invocations**
  (the sandbox session's per-command timeout, not a repo property): every
  test file and test ran, zero skips — but no single uninterrupted
  `pnpm test` wall-clock number is recorded for the whole suite here. The
  amendment re-run group timings: 41s (f372) / 61s (f361c) / 415s (f331c) /
  31s (journeys) / 116s (f362+f370c) / 385s (corpus+report+runner+f321c+
  f351c).
- **F369/F371 live-pilot gate stays BLOCKED**; providers stay
  CONTRACT_ONLY; journeys stay fixture-labelled, never live; the pglite
  in-process mode stays the DEFAULT (zero motion for existing deployments).

## 8. How to re-verify (the machine path)

```
cd Fleetos-2.0 && corepack pnpm@10.33.2 install --frozen-lockfile
cd packages/acceptance/commerce && pnpm typecheck && pnpm lint
FLEETOS_PG_BINDIR=<a postgres server bindir> pnpm exec vitest run
cd ../../infrastructure/fleetos-marketplace && ../../node_modules/.bin/tsc --noEmit \
  && ../../node_modules/.bin/oxlint .
cd ../../packages/acceptance/security && pnpm test   # 237
cd ../../identity && pnpm test                       # 191
```

(On a CI image with the system layout, `FLEETOS_PG_BINDIR` is unnecessary —
the system-layout discovery finds `initdb`/`postgres`.)
