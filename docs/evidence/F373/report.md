# F373 — real KMS for the keyring: the evidence report

**Worker:** B (session w19b, Wave 19 lane B). **Base:** `76ddba0` (main
HEAD at clone — the Wave-19 open commit; verified `git log --oneline -1`
after clone, before `git checkout -b work/f373`). **Branch:** `work/f373`.
**Binding law:** `docs/tech-lead/packets/f373.md` (the full contract) +
the F351A service laws (node:http only, write-before-ack, fail-closed) +
the F370B rotation laws VERBATIM (the `rotateKeyring` kernel is what the
service runs — compose, never re-implement). All numbers below are
machine-run at the lane tree (commands recorded verbatim); nothing is
projected.

## 1. What was delivered (the F373 packet, as REAL code)

1. **The KMS service** — `infrastructure/fleetos-kms/` (10 files, new).
   ONE Node process, node:http only (node:crypto + node:http — ZERO new
   dependencies; zero root lockfile motion by design, the F370B
   precedent — the parallel F372 lane owns the lockfile this wave):
   - `kms-core.ts` (260 code lines): the at-rest **envelope**
     (AES-256-GCM under the master key; `wrapped` = b64(iv|ct|tag); fresh
     random IV per wrap — the wrapped bytes are never journey facts, so
     real-crypto variance stays outside all output); the in-process state
     model (plaintext material ONLY inside the process + the envelope);
     the fail-closed `fromStateFile` recovery (any shape violation or
     GCM unwrap failure — tampered at rest / wrong master key — refuses
     to boot); the **admin credential digest** (HMAC-SHA256 under the
     admin token key; the secret is consumed and never persisted —
     only the digest is); the **fka1 admin session token**
     (HMAC-SHA256, canonical claims, b64url, constant-time compare,
     expiry; tampered => SIGNATURE_INVALID, expired => SESSION_EXPIRED —
     F370A-style at the KMS host boundary, a wiring decision recorded
     in §6); the **create** bootstrap draw (id first, then material —
     the frozen F370B order, through the injected SecureRandom port);
     and **rotate = the REAL F370B `rotateKeyring` kernel** over the
     unwrapped state, its refusal codes propagated verbatim (§4 the
     file:line map).
   - `store.ts`: the at-rest store — `kms-state.json` (atomic
     tmp+fsync+rename per mutation, write-before-ack) + `kms-audit.jsonl`
     (append + fsync per op; torn trailing line dropped on replay, the
     F351A precedent; anything else fail-closed). **Every mutation
     journaled** (append-only: who/what/when-as-op-seq — never a wall
     clock; no secrets in the journal, machine-scanned).
   - `service.ts` (node:http, port **:3108** fixed in production — the
     service-census ports 3106/3107/3108; ephemeral `port 0` exists
     solely for the journeys' isolated instances): the master key from
     env/file AT THE SERVICE, plainly labelled — **fail-closed refusal
     to boot without one**; the SecureRandom binding (production =
     node:crypto randomBytes, the F370B host-boundary recipe;
     `FLEETOS_KMS_RANDOM_STREAM` = the REAL `deterministicSecureRandom`
     fixed-stream impl, plainly labelled TEST/CORPUS ONLY, reported by
     `/api/health`); the authenticated API: `GET /api/health` (liveness
     + recovery as data — no secrets), `POST /api/admin/credentials`
     (the journaled bootstrap seam, the F370C precedent),
     `POST /api/session` (login — byte-identical
     `ADMIN_CREDENTIAL_INVALID` for unknown admin / wrong secret /
     malformed, enumeration-resistant), `GET /api/keys/current`,
     `GET /api/keys`, `POST /api/keys/resolve` (key material served ONLY
     over this authenticated channel — never wrapped for caller-side
     unwrapping), `POST /api/keys/create`, `POST /api/keys/rotate`,
     `GET /api/audit`. Frozen reason codes, verdicts-as-data, never
     exception control flow.
   - `hooks.mjs` / `runtime.mjs` (the F351A/F370C resolve-hooks
     precedent), `tsconfig.json` (the dedicated infrastructure project,
     `@fleetos/identity` paths pinned), `package.json` (a LOCAL one —
     `pnpm typecheck` / `pnpm lint` from the directory, scripts
     referencing the repo-pinned toolchain from the root
     node_modules; **zero root lockfile motion**), `README.md` (the
     trust boundary + the crash-window note), `.gitignore` (`data/`),
     `proof-smoke.sh` (the operator one-shot: boot -> API -> SIGKILL ->
     restart).
2. **The keyring adapter** — `packages/identity/src/keyring-kms.ts` (89
   code lines) + the grow-only `"kms"` member on
   `KeyringProviderSource` (keyring.ts:100) + the honest prose updates
   in keyring.ts (the F370B-era "real KMS is F370C-class, recorded"
   standing qualification is now closed at the label level: file/env
   stay configuration-class fallbacks, `kms` is the KMS class).
   `loadKmsKeyringProvider({ baseUrl, token, now, fetchImpl? })` — the
   SNAPSHOT loader: current -> list -> resolve-every-id over the
   authenticated API, then a synchronous provider over the snapshot at
   the EXISTING port (the F370B contract VERBATIM; the composition
   issue+verify+rotate unchanged — the journeys drive
   `issueKeyedSession`/`verifyKeyedSession` over the kms-sourced
   provider exactly as over file/env). Fixed-string refusals (response
   bodies NEVER echoed — the no-leak law); the `fetchImpl` seam keeps
   the domain package deterministic-under-injection (identity tests use
   a scripted fake transport; NO network in the identity suite).
3. **Three census-certified D14 journeys** — §3: the rotation lifecycle
   across the process boundary, the trust boundary (auth refusals +
   at-rest scan + no-leak at the network boundary), and the
   crash-restart proof. All drive the REAL service as a REAL child
   process (ephemeral port, fresh temp data dir, fixed injected stream)
   at module evaluation (the F341B top-level-await law), all
   anchor-invariant by construction.
4. **Evidence** — this file. NO catalog edit (the Wave-19 parallel-lane
   law — the TL records the lane state at F374), NO industries.ts, NO
   adoption/release pins, NO commerce/marketplace edits (the F372
   grant), ZERO root lockfile/package.json motion.

## 2. The census (census-first, with grep proof at base `76ddba0`)

The F354 lesson: journey ids + the op-family prefixes name THIS lane's
REAL-KMS angle. Machine greps at the base tree:

- `git grep -n "kms-rotation\|kms-boundary\|kms-crash-restart" 76ddba0 -- packages`
  → **ZERO matches** (the three journey ids did not exist).
- `git grep -in "\bkms\b" 76ddba0 -- packages` (word matches) → **ZERO**
  code identifiers. The case-insensitive substring sweep hits only
  false positives in foreign namespaces, recorded here, never claimed:
  `unackMsg`/`*Ms` telemetry/clock identifiers in `packages/desktop` +
  `packages/rpc`, and the keyring.ts PROSE ("a real KMS stays honestly
  BLOCKED" — the standing qualification THIS lane closes). The
  zcode-cli generated bash-command-registry contains an unrelated
  e-commerce CLI tooling match for the `kms-` substring (a generated
  file, a different namespace — recorded, never touched).
- `git grep -n "loadKmsKeyringProvider\|KmsKeyringInput\|keyring-kms\|FLEETOS_KMS\|KmsMasterKey\|fka1" 76ddba0 -- packages`
  → **ZERO matches**: every public API this lane ships is NEW at base.
- Op prefixes `kmr-` / `kmb-` / `kmx-` (quoted step/assertion/fact ids)
  in `packages/acceptance/**` → **ZERO matches** at base.
- Nearest neighboring claims (recorded, distinct angles): the F370B
  `security.keyring-rotation` family (the IN-PROCESS pure rotation over
  a fixture snapshot — THIS lane drives the SAME laws across a REAL
  separate-process KMS), the F370C marketplace boundary journeys (the
  F370A gate at an HTTP boundary over the keyring FIXTURE — this lane
  gives the keyring its own REAL service), and the F370C real-PG
  crash-restart proofs (this lane kills the KMS itself — the process
  that owns the key material).

Post-work ownership proof (grep at the lane tree, staged): the three
journey ids appear in exactly their journey modules, the barrel
(`src/journeys/index.ts`), the census table (`src/census.ts`) and the
four test files that pin them (census/f370b/f373/seam); the `kmr-` /
`kmb-` / `kmx-` prefixes appear in EXACTLY the three F373 journey
modules (40/32/40 occurrences; zero at base); the API names appear in
exactly the identity modules + their tests + the journeys/harness —
zero matches outside `packages/acceptance/security/**` +
`packages/identity/**` (+ `infrastructure/fleetos-kms/**`, the owner by
the grant).

The census table additions (machine-verified in `tests/census.test.ts`
— all three non-responders, all byte-identical across the whole census
grid, all passing at the T0 baseline):

| journey id | census class | citation (verbatim prefix) |
|---|---|---|
| `security.kms-rotation` | non-responder / invariant | `F373 census: invariant — the kms-rotation family drives the REAL fleetos-kms service (a REAL child process) over fixed logical epochs with a fixed injected SecureRandom stream at the service boundary, so every key id, verdict and audit line is a pure function of the fixtures and never reads the run anchor...` |
| `security.kms-boundary` | non-responder / invariant | `F373 census: invariant — the kms-boundary family drives the REAL service's authentication plane and the at-rest scan over fixed logical epochs; every refusal is a frozen code and every scan a fixed-constant boolean...` |
| `security.kms-crash-restart` | non-responder / invariant | `F373 census: invariant — the kms-crash-restart family SIGKILLs the REAL service mid-rotation-sequence and restarts it on the same data dir; the digests and verdicts are computed over logical metadata only (ids + deadlines, never material)...` |

## 3. The journey table (D14 form)

| id (corpus) | persona | capability | steps | assertions | refusals |
|---|---|---|---|---|---|
| `security.kms-rotation` | site-reliability-engineer | kms-key-management | 6 (kmr-boot-provision-login / kmr-create-and-adapter / kmr-rotate / kmr-grace-and-retirement / kmr-refusals / kmr-audit-and-noleak) | 34 (kmr-1..kmr-34) | 3 refusal steps; refusal assertions: KEY_RETIRED (kmr-24), KEY_UNKNOWN at the API boundary (kmr-26), the known-id substitution SIGNATURE_INVALID (kmr-27), the tampered signature SIGNATURE_INVALID (kmr-28), the 7-shape malformed family + null token (kmr-29/30), the journal's no-secrets law (kmr-33), the no-leak law over every verdict (kmr-34) |
| `security.kms-boundary` | security-analyst | kms-key-management | 7 (kmb-boot-and-health / kmb-auth-refusals / kmb-credential-plane / kmb-key-plane-refusals / kmb-adapter-refusal / kmb-at-rest-scan / kmb-network-noleak) | 25 (kmb-1..kmb-25) | 4 refusal steps; refusal assertions: UNAUTHENTICATED (kmb-4/7), SIGNATURE_INVALID (kmb-5), SESSION_EXPIRED (kmb-6), the byte-identical ADMIN_CREDENTIAL_INVALID family (kmb-8/9), ADMIN_EXISTS (kmb-10), KEY_EXISTS (kmb-13), KEY_UNKNOWN (kmb-14), the adapter's fixed-string refusal (kmb-15..17), the AT-REST scans (kmb-18..20), the no-leak law at the network boundary (kmb-23..25) |
| `security.kms-crash-restart` | compliance-auditor | kms-key-management | 5 (kmx-boot-create-issue / kmx-rotate-then-crash / kmx-restart-recovery / kmx-digests-and-verdicts / kmx-at-rest-noleak) | 35 (kmx-1..kmx-35) | 2 refusal surfaces inside the verdict steps; THE LAW assertions: key-set digest identical (kmx-26), audit digest identical (kmx-27), resolve verdicts identical (kmx-29), grace verdict identical (kmx-31), KEY_RETIRED past the deadline after the crash (kmx-33), the at-rest scan (kmx-35) |

All three: deterministic (byte-identical re-runs — machine-pinned by the
runner it.each, the census 8-anchor grid, the seam same-anchor law, AND
the explicit full-corpus double-run in `tests/f373.test.ts`; the digests
are also reproduced across every separate test-file process — 12 fresh
spawns per suite run), REAL entry points only (every step names the
service surface and/or the REAL `@fleetos/identity` APIs), census
citations embedded, >= 25 assertions each (34/25/35), >= 1 refusal each.

**The crash-restart proof (assertions, not prose):** the journey
SIGKILLs the KMS process after the rotate ack, before the plan's
remaining steps (mid-rotation-sequence — the honest deterministic form;
a crash between the state write and the journal append is the
microsecond window recorded in store.ts's header, never claimed as
driven). The exit is OBSERVED (`kmx.crash.exitObserved`), the restart
boots the SAME data dir, and the machine asserts: the key-set digest
IDENTICAL (`0a9e8e8c`, pinned as a literal — logical metadata only:
ids + deadlines, never material), the audit digest IDENTICAL
(`efa98bd3`, pinned literal), the resolve verdicts IDENTICAL pre/post
(JSON equality, never surfaced), the recovered material MATCHES the
stream draws (recovery, never re-creation — if the restart drew, the
ids would change and the digests would diverge, which is exactly what
these assertions detect), the pre-crash-issued admin token still
authenticates every post-crash call (the admin token key was recovered
from the envelope), the grace verdict IDENTICAL pre/post, and the
refusal ladder completes after the crash (KEY_RETIRED past the
deadline). The recovery report (`freshBoot: false`, `keys: 2`,
`admins: 1`, `adminTokenKeyRecovered: true`, `auditEntries: 4`) is
asserted from `/api/health`.

**The output law (machine-scanned in `tests/f373.test.ts`):** after a
real run of the three journeys, EVERY fact is scanned — no ephemeral
port shape (`:(\d{4,5})(?!\d)`), no `/tmp/` path, no data-dir name
(`kms-journey-`), no wall-clock ISO timestamp. Ports/paths/pids never
enter journey output; the harness holds them.

**The no-leak law (grep-asserted):** the lane's five known secret
constants (the fixture master key, the fixture admin secret, the admin
token key draw, both drawn key materials) appear in NO journey fact and
NO journey outcome across the WHOLE 42-journey corpus
(`tests/f373.test.ts`); the boundary journey additionally scans every
captured HTTP response EXCEPT the material channel (the authenticated
resolve — the only route that ever serves material, by design) and the
at-rest state + audit files (machine-scanned: CLEAN).

## 4. The contract surface (file:line at the lane tree)

**infrastructure/fleetos-kms/** (10 files): `kms-core.ts` —
`KmsMasterKeyHex` :64, `MASTER_KEY_BYTES` :66, `isValidMasterKeyHex`
:69, `wrapWithMasterKey` :80, `unwrapWithMasterKey` :91, `KmsAdminRecord`
:112, `KmsKeyEntry` :118, `KmsState` :127, `WrappedKeySlot` :140,
`KmsStateFile` :148, `toStateFile` :163, `fromStateFile` :182,
`adminCredentialDigest` :235, `verifyAdminCredential` :243,
`AdminSessionRefusal` :259, `issueAdminSession` :270, `verifyAdminSession`
:291, `KmsAuditOp` :333, `KmsAuditEntry` :337, `kmsCreateKey` :356,
`kmsRotateKey` :381. `store.ts` — `KmsRecoveryReport` :19, `KmsStore`
:26 (readStateFile/persistStateFile/appendAudit/readAuditJournal).
`service.ts` — `loadMasterKey` :82 (fail-closed), `bindSecureRandom`
:120, the boot IIFE with recovery + the first-boot admin-token-key draw
:166, `requireAdmin` :274 (the frozen auth refusals), the API routes
:289+, `server.listen` :478. `hooks.mjs`/`runtime.mjs` (the F351A
resolve hooks), `tsconfig.json`, `package.json` (local scripts),
`README.md`, `.gitignore`, `proof-smoke.sh`.

**packages/identity**: `keyring.ts` — the grow-only source union
`KeyringProviderSource` :100 (`"kms"` appended; the file/env/data/fixture
sources unchanged), the honest prose updates :4-13, :91-104, :222-227.
`keyring-kms.ts` (new, 89 code lines) — `KmsFetch` :41 (the transport
seam), `KmsKeyringInput` :46, `loadKmsKeyringProvider` :63. Barrel
append `src/index.ts`; subpath `./keyring-kms` in package.json; tests
`keyring-kms.test.ts` (16 tests, the scripted fake transport — NO
network in the identity suite).

**packages/acceptance/security**: `src/journeys/kms-harness.ts` (the
child-process driver + the plainly-labelled fixtures + typed fact
accessors), the three journey modules, the barrel 39 → 42 (grow-only
append), `src/census.ts` 39 → 42 (grow-only append), the capability
vocabulary 23 → 24 (`kms-key-management`), the census/contracts/report/
seam/f370b test pin updates, and `tests/f373.test.ts` (new, 11 tests
incl. the four machine laws).

## 5. The machine-run battery (exact numbers, all at the lane tree)

| suite | before (base) | after | verdict |
|---|---:|---:|---|
| `pnpm --filter @fleetos/identity test` | **191** (10 files) | **207** (+16, 11 files) | green, grow-only |
| `pnpm --filter @fleetos/acceptance-security test` | **237** (11 files) | **256** (+19, 12 files) | green, grow-only |
| security corpus barrel | **39** | **42** | machine-counted (`SECURITY_JOURNEYS.length` = 42, unique ids = 42, `SECURITY_CENSUS.length` = 42, census covers the corpus exactly) |
| commerce suite (cross-lane) | **183** | **183** | re-verified UNCHANGED green at this tree — the completed machine run: 101 (7 files) + 82 (3 files) = 183 in two foreground vitest invocations (the sandbox reaps background processes; the form recorded in §5) — the F372 lane moves it on ITS branch |

Identity +16 decomposition (machine-accountable): keyring-kms.test.ts
+16 (the new file; the 10 base files untouched — 191 base tests all
still green).

Security +19 decomposition (machine-accountable): journeys.test.ts
it.each auto-growth +6 (3 journeys × 2 it.each blocks), census.test.ts
+2 (the F373 machine-verification block), f373.test.ts +11 (the focused
battery). The T0 census pin moved 31/39 → 34/42 (the three F373
additions pass at T0); the capability pins 23 → 24 (contracts + report
tests); the seam digest list 39 → 42 (grow-only append:
`ce94d673` / `ba99789d` / `21a42a8e`, harvested on this lane tree).

- **Typecheck:** exit 0 on all three — identity (`tsc --noEmit`),
  security (`tsc -p tsconfig.json --noEmit`), and the service
  (`cd infrastructure/fleetos-kms && pnpm typecheck` — its dedicated
  tsconfig project with `@fleetos/identity` paths pinned, the
  F351A/F370C precedent).
- **Lint:** oxlint **0 warnings / 0 errors** on all three (identity 25
  files, security 51 files, the service 5 files) — `pnpm lint` in the
  service directory works through its local package.json (scripts
  referencing the repo-pinned toolchain from the root node_modules;
  ZERO root lockfile motion — no local install).
- **File law (<=400 code lines, block-comment-aware per the oxlint
  `max-lines` rule, error-level):** every lane file reports 0w/0e —
  the machine verdict. The largest: `service.ts` 367, `kms-core.ts`
  260, `keyring.ts` (edited) 268, the journeys 243/229/177, the
  harness 211, `keyring-kms.ts` 89. Recorded for completeness: raw
  `wc -l` counts are service.ts 491 / kms-core.ts 410 / journeys
  296-218 / harness 296 — the enforced law is the oxlint rule (the
  repo's informational script flags pre-existing files above 400 raw
  lines at base; test files are exempt per the repo's override).
- **Determinism:** byte-identical — four machine forms: (1) the runner
  it.each pins all 42 journeys; (2) the census grid runs the FULL
  corpus at 8 anchors — the three F373 journeys byte-identical across
  the grid (all facts are module-evaluation constants over fixed
  logical epochs); (3) the seam test reproduces all 42 digests
  byte-for-byte across a FRESH process (a fresh spawn + drive per test
  file — 12 spawns per suite run, identical digests every time);
  (4) `tests/f373.test.ts` runs the FULL corpus twice — byte-identical
  digest arrays AND full outcome arrays (`JSON.stringify` equality).
  Ports/timestamps/paths never appear in journey output (the OUTPUT
  law scan: port shape, /tmp/, data-dir name, wall-clock ISO — all
  asserted absent).
- **The at-rest scan:** the state file + the audit journal contain NO
  plaintext key material — machine-scanned in the boundary journey
  (`kmb.atrest.stateFileClean` / `kmb.atrest.auditFileClean`) over the
  five lane secrets, AND the positive side (`hasWrappedEnvelope`: the
  wrapped slots are non-empty). Repeated after the crash-restart cycle
  (`kmx.atrest.clean`).
- **Boundary:** `git status` (staged) = **28 paths + this report** —
  10 inside `infrastructure/fleetos-kms/**` (new), 13 inside
  `packages/acceptance/security/**` (5 new + 8 updated pins), 5 inside
  `packages/identity/**` (2 new + 3 grow-only edits). **ZERO lockfile
  motion** (machine-checked: no `pnpm-lock.yaml`, no ROOT
  `package.json` in the diff), ZERO domain-package edits outside
  identity, **industries.ts ZERO motion** (machine-checked: the diff
  is empty), ZERO adoption/release pin files touched, ZERO catalog
  edits (the Wave-19 parallel-lane law), ZERO commerce/marketplace
  edits (the F372 grant — commerce re-verified green at 183 UNCHANGED
  at this tree).
- **Suite runtime (recorded honestly):** the security suite now takes
  ~34s on this 2-vCPU sandbox (the module-evaluation drives spawn real
  KMS child processes — 3 boots per test-file process, 12 files; the
  census/determinism batteries re-run the corpus in-memory). The
  commerce suite re-verification ran to completion as TWO foreground
  vitest invocations (this sandbox reaps background processes — the
  resumed session's first background attempt was killed mid-run and is
  honestly recorded here, never counted): batch 1 the seven fast files
  101 tests / 348.9s, batch 2 the three pglite-heavy files
  (f370c/journeys/report) 82 tests / 266.8s — 183 green, ~616s total
  (the F370C measured cost class: real PostgreSQL boots).
- **Architecture:** `pnpm run architecture:check` = OK, 0 violations at
  the lane tree (infrastructure is outside the package graph; the
  identity edits add no new dependency direction — keyring-kms.ts
  imports only keyring.js + the fetch seam).

## 6. Honest limitations

- **The honest label for this service is a SELF-HOSTED KMS DAEMON.**
  REAL in process boundary, at-rest envelope encryption, authenticated
  API discipline, append-only audit and crash-restart — but it runs on
  the host's own disk. Cloud/HSM KMS adapters (AWS KMS, GCP KMS,
  HashiCorp Vault) stay operator-credential-gated seams — recorded,
  never pretended here. The `KmsStore`/envelope seam is where such an
  adapter would land.
- **The master key at the KMS boundary is env/file configuration AT THE
  SERVICE** — that IS the trust boundary by design (the packet's law),
  plainly labelled: whoever controls the KMS process environment
  controls the master key. A KMS-rooted master key (an HSM or an
  external KMS holding it) is the cloud/HSM class above.
- **The admin session token is F370A-STYLE, KMS-owned.** The F370A
  kernel's frozen claim vocabulary is marketplace-session-specific, so
  composing it for KMS-admin sessions would be a semantic lie; the fka1
  envelope follows the F370A discipline exactly (HMAC-SHA256, canonical
  claims, expiry, constant-time compare, frozen refusals) at the host
  boundary. A boundary-wiring decision, recorded here and in
  kms-core.ts's header — never a silent re-implementation.
- **The admin bootstrap seam is UNAUTHENTICATED but JOURNALED** (the
  F370C marketplace precedent). Rate limiting / an operator
  auth channel on provisioning is host-deployment class, recorded.
- **The adapter is a SNAPSHOT loader** (boot-time prefetch over the
  authenticated API; cached per the port's semantics — a snapshot is a
  snapshot). A refresh/poll class adapter that re-loads on rotation
  awareness is server-wiring follow-up work, recorded — the journeys
  drive the honest RELOAD explicitly.
- **The crash window between the state write and the journal append**
  is real (microseconds; store.ts's header records it): the state file
  is the recovery truth; the journal is the audit trail. A crash there
  leaves the journal one entry behind the state (an unacknowledged op).
  The journeys crash only at post-ack points, where both writes are
  complete — the honest deterministic form; the racy in-flight case is
  not claimed as driven.
- **The journeys' SecureRandom is the fixed-stream injection**
  (`FLEETOS_KMS_RANDOM_STREAM`) — plainly labelled TEST/CORPUS ONLY and
  reported by `/api/health`; production binds node:crypto randomBytes.
  Every key id/material the journeys see is therefore a known constant
  — which is exactly what makes the at-rest scan and the no-leak grep
  machine-assertable.
- **Retired keys are retained forever in the KMS state** (the F370B
  KEY_RETIRED-never-decays law). Physical pruning of long-retired keys
  is a host operational choice with audit implications — recorded
  (F370B precedent, unchanged).
- **Adoption/release pins are honestly stale at this tree** (the
  F370B/F370C precedent — recorded, never touched): the TL-owned suites
  pin the security corpus at 31/36-era counts while this tree carries
  42; the TL re-pins at F374 convergence. Touching those pins is
  explicitly outside this lane's grant.
- **Nothing here is live.** The F369/F371 live-pilot gate stays BLOCKED
  (the standing qualification, unchanged). The journeys are
  fixture-labelled deterministic contract proofs through a REAL
  deployment service — the process boundary, at-rest encryption, API
  discipline and crash-restart are REAL at the sandbox boundary this
  lane was granted; the cloud/HSM class above remains the recorded
  follow-up.
