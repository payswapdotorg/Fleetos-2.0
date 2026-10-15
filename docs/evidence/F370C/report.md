# F370C — the marketplace pilot's authoritative persistence + verified deployment: the evidence report

**Worker:** C (session w18x, Wave 18 lane C). **Base:** `b6747b3` (main
HEAD at clone — the F370C-packet baseline-correction commit; verified
`git log --oneline -1` immediately after clone, before
`git checkout -b work/f370c`). **Branch:** `work/f370c`.
**Binding law:** `docs/tech-lead/packets/f370c.md` (the full contract) +
`spec/ARCHITECTURE-LOCK.md` (A1 PostgreSQL authoritative; A8 tenant
context at the boundary, fail-closed; A19 append-only audit; A20
composition) + the F351A service laws (node:http only, write-before-ack,
verify-on-start, tenant fail-closed) composed with the F370A gate +
F370B keyring. All numbers below are machine-run at the lane tree
(commands recorded verbatim); nothing is projected.

## 1. What was delivered (the F370C packet, as REAL infrastructure)

1. **The PostgreSQL store** — `infrastructure/fleetos-marketplace/store.ts`
   (the PORT, 298 raw lines) + `schema.ts` (the DDL) + `pglite-tables.ts`
   + `pglite-store.ts` (the adapter). `MarketplaceStore`: the frozen
   operation set over the spine state — the EXACT F361A/B/C/F362 record
   shapes riding verbatim inside a `record JSONB` column (requests keyed
   tenant+natural key with the UNIQUE idempotency law made structural;
   offers; retained comparison sheets, content-addressed `mcs-` ids;
   orders; the provider-ack journal; receipts + their replay inputs;
   enrollments keyed tenant+serial — the REAL registry port's key;
   approvals; evidence with the tenant+provider-event UNIQUE dedup; the
   F361A authoritative registry: assets + device twins). The adapter is
   **@electric-sql/pglite 0.5.10 — the official WASM build of REAL
   PostgreSQL, in-process** (REAL Postgres WAL: a SIGKILL between
   requests loses nothing — machine-asserted in §3); the PORT stays
   swappable, a networked-PG adapter at the host boundary is the recorded
   follow-up, never pretended. Digest endpoints over every record set
   (sha-256 over canonical JSON in natural-key order — byte-stable across
   restarts and restore round-trips). `dumpStore()` → a single
   canonical-JSON file (format `fleetos-marketplace-dump/1`); the
   `--restore` boot = wipe + import (ONE transaction) + envelope
   re-verify (fail-closed: refuses to serve a dump whose envelope or
   record sets do not re-verify); both journaled as data.
2. **The deployment service** — `infrastructure/fleetos-marketplace/
   service.ts` + `api*.ts` + `auth.ts` + `ports.ts` + `evidence-store.ts`
   + `recovery.ts` (+ `hooks.mjs`/`runtime.mjs`, the F351A resolve-hooks
   precedent). ONE Node process, node:http only, the deployment port
   fixed at **:3107** bound to 127.0.0.1 (the sandbox localhost law; the
   env override exists solely for the journeys' ephemeral isolated
   instances — the packet's law). The boundary: **verify credential
   (F370A scrypt, enumeration-resistant) → issue keyed session (the F370B
   keyring: `fsk1` wrapping the untouched F370A kernel token; jti ALWAYS
   present — caller-supplied or host-generated entropy) → authenticate
   per request (`verifyKeyedSessionWithRevocation`, the FULL F370B stack)
   → authorize per action (the F370A gate — INSIDE the REAL
   `marketplace-authenticated` composed verbs for the 11 operations F370A
   wrapped; directly for the rest) → delegate to the EXISTING Wave-17
   kernels → persist via the store (write-before-ack: one PostgreSQL
   transaction per request — the record + its journal entries commit
   together)**. The F361A enrollment machine runs over the REAL
   `AssetRepositoryPort` / `ReceiptEnrollmentRegistryPort` / `TwinPort`
   implemented against PostgreSQL (`ports.ts` — a write-back mirror
   staged per request and flushed in ONE transaction before the response;
   born empty, loaded FROM the store at boot: A1 — the database is the
   truth). The F361B evidence port over PG (`evidence-store.ts` — the
   port's own header is the mandate: "production injects the durable
   PostgreSQL repository"). Verify-on-start (`recovery.ts`): every boot
   replays each persisted receipt through the REAL
   `ReceiptEnrollmentDirectory` and verifies the regenerated record
   BYTE-EXACT (canonical JSON) against the persisted one — any mismatch
   refuses to start; the revocation journal replays into the F370B
   registry (**the F370B "persistent revocation is F370C/server-wiring
   class" limitation — closed here: revocations survive restarts**). A8:
   the caller tenant is the VERIFIED session's; the body's `tenantId`
   names the action's tenant scope (the F370A gate input) — the gate
   binds them (a foreign session ⇒ TENANT_MISMATCH); every store
   operation carries the session tenant; cross-tenant reads find NOTHING
   (scoped queries); id-addressed resources of another tenant are
   indistinguishable from absence (404 NOT_FOUND). Endpoints: the eight
   verb families + `GET /api/health` (liveness + the verify-on-start
   report + counters — observability as data) + `GET /api/digest` (the
   full digest envelope, the F351A operator-proof precedent) +
   authenticated tenant-scoped state reads + the auth plane
   (credentials/login/revocations) + the localhost admin backup.
   **ZERO kernel edits — zero FINDINGS requiring one**: every composition
   was exactly the existing public APIs (see §2 for the recorded
   design findings, none of which touch a domain package).
3. **The incident/rollback runbook** — `infrastructure/fleetos-marketplace/RUNBOOK.md`:
   the restart procedure (stop + start — the store IS the state; the
   health/digest verification), the backup procedure (the single-file
   dump + the operator's envelope-digest ledger), THE ROLLBACK LAW
   (**`--restore` is the recorded incident path, never ad-hoc SQL** —
   fail-closed on any envelope/record-set mismatch), key rotation +
   revocation at the boundary, and the honest scope. **The backup/restore
   journey's steps ARE the runbook's procedure** (§3 — the doc and the
   test can never drift).
4. **Three census-certified D14 journeys** — §3: the persistence +
   crash-restart journey, the authorization journey (every F370A gate
   reason at the HTTP boundary + the F370B keyring/revocation surfaces +
   the two-layer law), and the backup/restore journey (the runbook's
   procedure as the journey's steps). All drive the REAL service spawned
   as a REAL child process on an ephemeral port over a fresh temp data
   dir — real HTTP, real PostgreSQL, real SIGKILLs — with
   **ports/timestamps/paths NEVER in journey output** (machine-scanned;
   the fixture-clock law: every request carries logical `now`; no wall
   clock, no randomness enters any persisted record).
5. **Evidence** — this file + the one-line catalog append.

## 2. The census (census-first, with grep proof at base `b6747b3`)

The F354 lesson: journey ids + the op family name THIS lane's
authoritative-persistence angle, never a mechanic a parallel corpus could
claim. Machine greps at the base tree:

- `git grep -n "marketplace-persistence" b6747b3` → ONLY the packet prose
  (`docs/tech-lead/packets/f370c.md:87`). Zero matches in packages/.
- `git grep -n "marketplace-boundary-authorization" b6747b3` → **zero
  matches anywhere**. `git grep -n "marketplace-backup-restore" b6747b3`
  → **zero matches anywhere**.
- Op prefix `mps-`: the packet prose + ONE incidental word-internal
  match (`packages/predictive/src/staleness-propagation.ts:11`
  "timestamps-vs-now" — prose inside a word, not an op prefix; recorded,
  never claimed). Zero matches in acceptance corpora.
- `git grep -n "fleetos-marketplace\|MarketplaceStore\|dumpStore\|restoreStore\|pglite\|electric-sql" b6747b3 -- packages` →
  **zero matches** (the only `MarketplaceStore`-shaped identifier at base
  is `addMarketplaceStore`/`updateMarketplaceStore` in
  `packages/ui/src/hooks/usePlugins.ts` — a zustand plugin-store React
  hook, a DIFFERENT namespace; recorded here, never claimed).
- Nearest neighboring claims (recorded, distinct angles): the F362
  `marketplace-transaction-spine` (the unauthenticated in-process E2E
  chain — this lane's journeys drive the SAME spine shape through the
  service's HTTP boundary over PostgreSQL, never in-process); the F370A
  security journeys (the gate in-process; this lane surfaces the gate's
  refusals AT THE BOUNDARY); the F351A durable service (the operational
  plane over JSONL — explicitly NOT used for marketplace transaction
  state here, per the catalog's standing warning).

Post-work ownership proof: the three ids appear in exactly their journey
modules, the barrel, the census/test files and this report; the `mps-`
kinds in exactly the contracts file, the two driver modules, the runner
dispatch, the journeys and the battery — zero matches outside
`packages/acceptance/commerce/**` + `infrastructure/fleetos-marketplace/**`.

**Recorded design findings (store/boundary design, ZERO domain-package
edits):**
- **The approvals natural-key finding:** the F361B kernel's `approvalId`
  is `mpa-` + the FIRST 12 CHARACTERS of the pipe-joined digest-input
  string (`mpa-request=appr…`) — deterministic stability, but NEVER
  uniqueness (two different approval requests share the prefix). The
  store therefore keys the approvals record set by the approval REQUEST
  id (the semantic identity of one evaluation); the kernel record rides
  verbatim inside, never re-shaped. Recorded in `pglite-tables.ts` +
  `schema.ts`.
- **The jti law at login:** the F370B revocation composition refuses
  jti-less tokens (`JTI_MISSING`, fail-closed), so the service ALWAYS
  issues with a jti — caller-supplied (the idempotency-key convention,
  the journeys' fixed jtis keep the digest envelope deterministic) or
  drawn from the host boundary's real entropy when absent (the exact
  `secure-random.ts` header recipe — the F370B "NOTE" becomes wiring).
- **The composed-verb coverage:** F370A wrapped 11 operations; the
  request/order transitions, the offer sheet and the reads drive the gate
  (`authorizeMarketplaceAction`) + the pure kernels directly — both REAL
  public APIs, composed at the server boundary exactly as the F370B
  report prescribed ("composing the gate with the keyring provider (and
  with revocation) at the HTTP boundary is the F370C deployment-service
  composition"). The keyed-envelope unwrap handed to the gate is 6 lines
  of boundary wiring AFTER the F370B verify already ran — never a
  re-implementation.
- **The evidence-kind → action-kind map:** the frozen F370A action-scope
  table has no evidence verb (freeze law — extending it is a freeze-law
  change, never a lane edit), so evidence retention/read is authorized
  under the verb that CONSUMES the kind (offer-snapshot→approval,
  provider-ack→ack, fulfilment→order, receipt→receipt — the fixed map in
  `api.ts`). The audit state read requires ALL EIGHT scopes (the
  operator view spans every family; the gate runs once per kind).
- **The digest envelope's deliberate exclusions:** the credentials table
  (host-generated scrypt salts — real entropy, the F370B host-boundary
  law) and the backups ledger (metadata ABOUT the envelope) are persisted
  and dumped but NOT part of the digest envelope — everything in the
  envelope is logical-clocked and byte-stable; the exclusions are
  recorded here and in `store.ts`'s header.

## 3. The journey table (D14 form; all census-certified — table-less,
## single-epoch T0, invariant at every census offset)

| id (corpus) | persona | capability | steps | assertions | refusals |
|---|---|---|---|---|---|
| `marketplace-persistence-spine` | procurement-lead | marketplace-persistence | 40 (boot → provision → login → the full F362 spine shape → digest → SIGKILL-crash → the receipt machine → the enrollment → a SECOND SIGKILL-crash → state reads → digest → shutdown) | 37 (mps-p1..p37) | 3 refusal surfaces: NATURAL_KEY_CONFLICT (the divergent natural-key replay), ILLEGAL_TRANSITION (the early order), ALREADY_ACKNOWLEDGED (the different provider event) |
| `marketplace-boundary-authorization` | operations-manager | marketplace-boundary-authorization | 34 (boot → 3 provisions → 5 logins → token surgery + the stale-holder mint → the refusal battery → the two-layer approvals → the jti revocation → crash-restart → the actor sweep → the audit read) | 30 (mps-a1..a30) | the FULL refusal battery: UNAUTHENTICATED ×5 (no token, tampered payload, unknown key id, retired key, revoked jti — + still-refused after the crash), SESSION_EXPIRED, TENANT_MISMATCH, SCOPE_MISSING, MALFORMED, NOT_FOUND, the Guardian's over-limit refuse (data) |
| `marketplace-backup-restore` | software-admin | marketplace-backup-restore | 37 (the full spine seeded → digest → THE DUMP → the SIGKILL incident → the `--restore` boot → the family state reads → the post-restore write → digest → shutdown) | 20 (mps-r1..r20) | 1 asserted refusal surface: the over-limit Guardian REFUSE (evaluated data, the two-layer law riding IN the backup set — both decisions retained through the round-trip); the journey's own form law (>=1 refusal) is met by mps-r6 |

All three: deterministic (byte-identical reruns — machine-pinned by the
battery's double-run, the census 8-anchor invariance and the f362 full
corpus double-run), REAL entry points only (the REAL service over real
HTTP — every step names the service surface), census citations embedded
in the journey modules, >=5 substantive assertions (37/30/20), >=1
refusal each.

**The crash-restart proof (assertions, not prose):** the persistence
journey SIGKILLs the service mid-spine and asserts
`mps.restart.crash.digestsIdentical: true`; after the receipt is decided
and the enrollment completed it SIGKILLs AGAIN and asserts
`digestsIdentical: true` + `receiptsReplayed: 1` (the boot's byte-exact
replay through the REAL directory) + the record sets intact (the state
reads). The authorization journey asserts the revocation replay
(`revocationsReplayed: 1`) and that the revoked token is STILL refused
after the crash. The backup journey asserts the `--restore` round-trip:
`digestsIdentical: true`, every family intact, the credential directory
alive, and the restored service serving writes (the order's final
`accepted` transition).

**The output law (machine-scanned in the battery):** after a real run of
the persistence journey, EVERY fact + log entry is scanned — no
ephemeral-port shape (`:<4-5 digits>`), no `/tmp/` path, no data-dir
name, and no wall-clock ISO timestamp (the only ISO strings are the
fixed 2026-10 evidence fixtures) ever appears.

## 4. The contract surface (file:line at the lane tree)

**infrastructure/fleetos-marketplace/** (18 files): `store.ts` — the
`MarketplaceStore` PORT + the persisted wrappers
(`RetainedComparisonSheet`, `ProviderAckJournalEntry`, `PersistedReceipt`,
`MarketplaceAuditEntry`, `RevocationJournalEntry`, `BackupJournalEntry`)
+ `DIGEST_RECORD_SETS`/`digestsOfRecordSets` + `DUMP_FORMAT` +
`canonicalJson`/`sha256Hex`; `schema.ts` — `MARKETPLACE_SCHEMA_DDL` (15
tenant-scoped tables); `pglite-tables.ts` — the TableSpecs +
`parseRecord`; `pglite-store.ts` — `PgMarketplaceStore` (upserts, scoped
reads, `transact`, `digestReport`, `dumpStore`, `restoreStore`) +
`comparisonSheetId`; `ports.ts` — `PgRegistryPorts` (the REAL F361A
ports over PG: load/flush write-back); `evidence-store.ts` —
`PgMarketplaceEvidenceStore implements MarketplaceEvidenceStorePort`;
`auth.ts` — `authenticateAtBoundary` + `innerTokenOfKeyed`;
`recovery.ts` — `verifyOnStart`; `api.ts` — the response convention +
`ServiceContext`/`makeContext` + the kind maps; `api-auth.ts` /
`api-verbs.ts` / `api-orders.ts` / `api-assets.ts` / `api-ops.ts` — the
handlers; `service.ts` — the composition root + routing + the
`--restore` CLI; `hooks.mjs`/`runtime.mjs`; `tsconfig.json`; `README.md`;
`RUNBOOK.md`; `proof-smoke.mjs` (the one-shot end-to-end proof);
`.gitignore` (the data dir).

**packages/acceptance/commerce**: `src/journey-contracts-f370c.ts` (the
MpsStep families), `src/drivers-mps-harness.ts` (the child-process
harness: spawn/kill/restore-boot/HTTP + the two-key fixture keyring +
the stale-holder mint through the REAL `issueSignedSession` + the token
surgery), `src/drivers-mps-ops.ts` (the lifecycle/auth/ops steps + the
shared fact helpers), `src/drivers-marketplace-service.ts` (the verb
steps), the three journey modules, the barrel append (46 → 49), the
JourneyStep union + the three capability extensions
(`journey-contracts.ts`), the runner dispatch (`runner.ts`),
`vitest.config.ts` (the suite timeout — real PG boots), `package.json`
(+`@fleetos/identity` — the drivers' REAL F370B composition dep, the
F370A security-corpus precedent), and `tests/f370c.test.ts` (the
9-test battery) + the count/census updates in `tests/corpus.test.ts`,
`f331c.test.ts`, `f351c.test.ts`, `f361c.test.ts`, `f362.test.ts`,
`report.test.ts`.

## 5. The machine-run battery (exact numbers, all at the lane tree)

| suite | before (base) | after | verdict |
|---|---:|---:|---|
| `pnpm --filter @fleetos/acceptance-commerce test` | **171** (9 files) | **183** (+12, 10 files) | green, grow-only |
| commerce corpus barrel | **46** | **49** | machine-counted (unique ids = 49; census table covers the corpus) |
| `pnpm --filter @fleetos/acceptance-security test` | 237 (the post-F370B count) | **237/237** | re-verified UNCHANGED green |
| `pnpm --filter @fleetos/identity test` | 191 (the post-F370B count) | **191/191** | re-verified UNCHANGED green |

Commerce +12 decomposition (machine-accountable): `tests/f370c.test.ts`
+9 (the focused battery: census bound, D14 form, the three machine-run
journeys, the output law, the determinism double-run) +
`tests/journeys.test.ts` it.each auto-growth +3 (49 journeys × the
corpus loop). The census invariance set grew 44 → 47 table-less
journeys (all three F370C journeys invariant at every one of the 8
census anchors — machine-run in `f331c.test.ts`).

- **Typecheck:** exit 0 on `@fleetos/acceptance-commerce`
  (`tsc --noEmit`) AND on the service (its dedicated
  `infrastructure/fleetos-marketplace/tsconfig.json` project — the F351A
  precedent: infrastructure is not a workspace package, so the project
  pins `@fleetos/*` paths to the same sources the resolve hooks load).
- **Lint:** oxlint **0 warnings / 0 errors** on both — commerce (74
  files src+tests) and the service directory (18 files).
- **File law (≤400 code lines, block-comment-aware per the oxlint
  `max-lines` rule, error-level):** max **396** (`pglite-store.ts`);
  then `journey-contracts-f370c.ts` 290, `drivers-marketplace-service.ts`
  238, `drivers-mps-ops.ts` 194, `drivers-mps-harness.ts` 188,
  `api-assets.ts` 181, `service.ts`/`api-verbs.ts` 173 — every lane file
  ≤ 400 (the oxlint rule reports 0w/0e; the new test file is exempt per
  the repo's override).
- **Determinism:** byte-identical — four machine forms: (1) the battery
  runs each of the three journeys TWICE and compares the FULL outcome +
  facts arrays (`JSON.stringify` equality — real re-spawns, real
  SIGKILLs, real restores, stable digest values); (2) `f362.test.ts`
  re-runs the FULL 49-journey corpus twice (byte-identical); (3) the
  census invariance test runs the 47 table-less journeys at the T0
  baseline + 7 offsets (all green, all invariant); (4) the journeys'
  own crash-restart digest-identity assertions (within-run byte
  equality across real process deaths).
- **Boundary:** `git status` at the lane tree = ONLY the owned paths +
  the sanctioned consequences: `infrastructure/fleetos-marketplace/**`
  (18 files, new), `packages/acceptance/commerce/**` (14 files: 9 new +
  the barrel/contracts/runner/package.json/vitest.config + 6 test
  updates), `docs/evidence/F370C/report.md` (this file), the catalog
  one-liner, and the ROOT `package.json` + `pnpm-lock.yaml` (the
  `@electric-sql/pglite` dependency's mechanically-required home — the
  service resolves it from the repo root node_modules; the packet's
  sanctioned consequence, recorded). **ZERO domain-package edits**
  (policy/procurement/assets/evidence/identity/vendors untouched),
  ZERO F351A durable-service edits, **industries.ts ZERO motion**
  (machine-checked: the diff is empty), ZERO adoption/release pin files
  touched (machine-checked).
- **Cross-lane read-only verification** (nothing pre-existing disturbed —
  all green at identical counts to the F370A/F370B-merged tree): policy
  158/158, procurement 171/171, assets 221/221, evidence 105/105,
  vendors 108/108, field 111/111 (+ security 237 + identity 191 above).
- **Architecture:** `pnpm run architecture:check` = OK, 0 violations at
  the lane tree (infrastructure is outside the package graph; commerce's
  new `@fleetos/identity` dependency is the F370A security-corpus
  precedent direction — acceptance → domain, no cycle).
- **The deployment evidence (machine-run):** the service spawns on an
  ephemeral port (the harness parses the bound port from the boot line —
  never in output), `/api/health` reports the verify-on-start receipts
  replayed + byte-verified, the crash-restart digests are byte-identical
  (twice per persistence run), and the dump/restore round-trip carries
  the same envelope digest across a real SIGKILL + `--restore` boot.
  The one-shot `proof-smoke.mjs` prints the whole chain for operators.
- **Suite runtime (recorded honestly):** the commerce suite now takes
  ~10 minutes (615–620s measured) — the census/determinism batteries
  re-run the full corpus many times, and every F370C execution boots
  real PostgreSQL (a pglite WASM boot is ~2.7s; the three journeys
  spawn 5 service boots per corpus pass). This is the measured cost of
  real-database evidence; the fast journeys are unaffected.

## 6. Honest limitations

- **pglite is the WASM build of PostgreSQL, in-process.** REAL
  PostgreSQL (the same WAL, the same SQL engine, the same crash
  recovery — the SIGKILL proofs above), but embedded: a NETWORKED
  PostgreSQL at the host boundary is the recorded follow-up. The
  `MarketplaceStore` PORT is the seam (a networked adapter implements
  the same frozen operation set); the pglite data-dir durability
  guarantee beyond process-kill is pglite's own envelope (the Node FS
  path; browser-IndexedDB concerns do not apply here).
- **Sandbox localhost only.** The service binds 127.0.0.1; the admin
  backup endpoint trusts that boundary (the F351A trust model). A
  network-fronted deployment needs an operator auth channel on the admin
  plane — networked-PG-class, recorded.
- **Single process, single connection, single writer.** Concurrent
  mutating requests serialize on one promise chain (PGlite is
  single-connection; the pilot deployment is one process).
  Multi-replica/networked is the recorded follow-up.
- **The manual provider seams are unchanged** (the offer source kinds,
  the provider-ack channels, the catalogue import — all still
  plainly-labelled manual; the freeze §1/§3 law).
- **The pilot keyring in the journeys is a plainly-labelled TWO-KEY
  FIXTURE** (the F370A fixture-key precedent) — carried through the REAL
  F370B env provider; a real KMS remains F370C-class follow-on work
  (recorded at F370B, unchanged here). The credential→scope grant is
  CALLER-DECLARED at login (the F370A fixture convention — a real
  credential→scope RBAC binding is host-deployment class); credential
  provisioning is the UNAUTHENTICATED, JOURNALED bootstrap seam
  (operator-channel hardening is host-deployment class). Credential
  salts + absent-jti token ids use REAL node:crypto entropy (the F370B
  host-boundary binding — closed here; deterministic in journey facts
  because journeys always supply fixed jtis and never surface salts).
- **The digest envelope deliberately excludes the credentials table and
  the backups ledger** (§2's finding) — they are persisted and dumped
  but not byte-stability-claimed.
- **Adoption/release pins are honestly stale at this tree** (the
  F361A/B/C + F362 + F370A/B precedent — recorded, never touched): the
  TL-owned suites still pin the security corpus at 31/36-era counts
  while this tree carries 39, and the commerce-corpus count pins the TL
  re-pins at F370 convergence. Touching those pins is explicitly outside
  this lane's grant.
- **The state twins read** enumerates twins through the enrollments'
  device links (a pragmatic tenant-scoped read model over `findTwin` —
  a twins-by-tenant listing port is a store growth decision for the TL).
- **Nothing here is live.** The F369/F371 live-pilot gate stays BLOCKED
  (the F362 standing qualification, unchanged). The journeys are
  fixture-labelled deterministic proofs through the REAL deployment
  service over REAL PostgreSQL — the Wave-17 blocker "production
  deployment + persistence undemonstrated" is closed at the sandbox
  boundary this lane was granted; the networked/host-boundary class
  remains the recorded follow-up.
