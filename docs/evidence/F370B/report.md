# F370B — secret management: the rotating keyring, session revocation, host-boundary randomness: the evidence report

**Worker:** B (session w18b). **Base:** `42d3709` (the F370B freeze
commit, "F370B freeze: the Wave-18 secret-management lane packet"; full
SHA `42d37091d16d2a9e0a863333a4214df6638384ce`, verified
`git log --oneline -1` after `git checkout -b work/f370b 42d3709`).
**Branch:** `work/f370b`.
**Binding law:** `docs/tech-lead/packets/f370b.md` (the full contract) +
`spec/ARCHITECTURE-LOCK.md` (A1/A20 — NO new authoritative business
store; the keyring is configuration-class, the registry in-memory) +
`docs/evidence/F370A/report.md` §6 (the honest limitations this lane
closes: the fixture signing key, the caller-supplied salt, the missing
revocation surface). All numbers below are machine-run at the lane tree
(commands recorded verbatim); nothing is projected.

**Base-check discrepancy (recorded honestly):** at clone, `main` HEAD
was `3b1f2ce` (the F370C freeze — "dispatch pending F370B merge"), NOT
the packet's expected `42d3709`. The delta `42d3709..3b1f2ce` is
docs-only and disjoint from this lane's grant:
`docs/tech-lead/packets/f370c.md` (+108) and the F370C catalog row (+1)
— zero code, zero path overlap. `work/f370b` is therefore based on the
CONTRACTED F370B-freeze SHA `42d3709` exactly as the packet's base check
specifies; every verification below ran at that tree. The only
merge-time overlap with current `main` is the catalog EOF append (main
added the F370C DISPATCHED row after the F370B DISPATCHED row; this lane
appends the F370B DELIVERED row at the same anchor) — a trivial
TL-side resolution (keep both rows).

## 1. What was delivered (the F370B packet, as REAL public domain APIs)

1. **The rotating keyring** — `packages/identity/src/keyring.ts` (new,
   397 raw / 268 code lines; + barrel export in `src/index.ts`, subpath
   export `./keyring` in `package.json`). The `KeyringProvider` port
   (`currentKeyId()` / `resolveKeyMaterial(keyId)` / `listKeyIds()` —
   the packet's frozen three, plus the `source` label that makes the
   "plainly labelled" law structural); key material is HEX
   (`secretHex`, the F370A `SessionSigningKey` encoding — frozen in
   this contract). The rotating-keyring composition over the port:
   - `issueKeyedSession` binds the CURRENT key id INTO the token:
     the keyed envelope is `fsk1.<keyId>.<payload>.<sig>` where
     `fss1.<payload>.<sig>` is the UNTOUCHED F370A kernel token — the
     keyring WRAPS the kernel token verbatim (machine-asserted: the
     inner token is byte-identical to a direct kernel issue under the
     same key), so payload/signature mutations are detected by the
     kernel and keyId mutations by key resolution (unknown id =>
     `KEY_UNKNOWN`; substituted known id => wrong material =>
     `SIGNATURE_INVALID`).
   - `verifyKeyedSession` resolves material BY THE CARRIED KEY ID,
     machine-stable order: envelope shape => `MALFORMED_TOKEN`; unknown
     id => `KEY_UNKNOWN`; past the key's retire-at => `KEY_RETIRED`
     (inclusive grace: the boundary instant `now === retireAt` still
     verifies — machine-pinned); then the kernel verdict VERBATIM. A
     rotated-out key inside its grace window verifies with
     `keyStatus: "verify-grace"`; the current key `"current"`. TOTAL —
     never throws (machine-tested over the null/undefined/type-confused
     and 7-shape malformed battery).
   - `rotateKeyring` is PURE over the snapshot: the new key's id AND
     material are drawn through the injected SecureRandom — ID FIRST,
     THEN MATERIAL (the frozen draw order) — the old current key gets
     `retireAt = now + verifyGraceMs` (its verify-grace window), the
     new key becomes current. Fail-loud refusals:
     `invalid-grace-window` / `no-current-key` / `key-id-collision` /
     `key-material-invalid`. Retired keys are RETAINED (never deleted)
     so their tokens keep refusing `KEY_RETIRED`, never `KEY_UNKNOWN`
     (double-rotation machine-pinned: the first key's deadline is
     untouched, 3 keys, the second current key rotates out).
   - Providers (all plainly labelled configuration-class; a real KMS is
     honestly BLOCKED and recorded F370C-class — never pretended):
     `keyringProviderFromData` (in-memory over a snapshot; honest by
     construction — an incoherent `currentKeyId` reports null),
     `fixtureKeyringProvider` over the plainly-labelled
     `FIXTURE_KEYRING_DATA` (the pilot fixture, the F370A
     fixture-key precedent), `fileKeyringProvider` (host-supplied path,
     `readFileSync`; file CONTENTS never read into errors or logs —
     machine-asserted), `envKeyringProvider` (host-injected env record,
     default variable `FLEETOS_SESSION_KEYRING_JSON`; the VALUE never
     enters errors/logs), both over the shared pure TOTAL
     `parseKeyringJson` (10-shape malformed battery; duplicate-id,
     dangling-currentKeyId and wrong-algorithm refusals; the input text
     is never echoed).
2. **Host-boundary randomness** — `packages/identity/src/secure-random.ts`
   (new, 140 raw / 52 code lines; + barrel + subpath `./secure-random`).
   The `SecureRandom` port: `randomHex(byteCount)` + `credentialSalt()`
   (16 bytes = 32 hex — the F370A credential floor,
   `CREDENTIAL_SALT_BYTES`); `SIGNING_KEY_BYTES` = 32 (the rotation
   draw). `deterministicSecureRandom(stream)` — the plainly-labelled
   fixed-stream test impl (the determinism battery): consumes the
   caller's hex draws in order, validates every draw, and FAILS LOUD on
   exhaustion, non-hex or wrong-length draws (never a silent repeat,
   never a fabricated fallback). `generateSigningKey` (key material via
   the port). `issueCredentialWithGeneratedSalt` — the authenticated
   composition: the salt is GENERATED through the port while the PURE
   F370A `issueCredential` kernel keeps its caller-supplied contract
   UNCHANGED (zero edits to credentials.ts; the composition calls it
   verbatim and propagates its refusal codes verbatim —
   machine-asserted). **The production binding is a NOTE, not shipped
   entropy:** the domain package deliberately contains NO entropy
   source (the repo determinism law); the host (F370C/server-wiring
   class) binds node:crypto `randomBytes` at its own boundary — the
   exact recipe is in the module header. The F370A honest limitation
   "the credential salt is caller-supplied" is therefore closed AT THE
   COMPOSITION LEVEL without touching the kernel.
3. **Session revocation** — `packages/identity/src/session-revocation.ts`
   (new, 222 raw / 112 code lines; + barrel + subpath
   `./session-revocation`) + **THE SANCTIONED GROW-ONLY jti EXTENSION**
   in `packages/identity/src/session.ts` (the ONE edit to the frozen
   F370A kernel this lane's grant allows): `SignedSessionClaims` gains
   the OPTIONAL `jti` (token id; charset `[A-Za-z0-9_-]{1,128}`;
   malformed refuses `malformed-jti` at issue and `MALFORMED_TOKEN` at
   verify — never silently dropped), and the canonical-JSON order
   STAYS FIXED — jti joins LAST, only when present, so jti-less tokens
   serialize BYTE-IDENTICALLY to the frozen F370A form (machine-pinned:
   the exact F370A field order `v,actorId,tenantId,scopes,issuedAt,
   expiresAt` is asserted on every jti-less issue; all 142 base
   identity tests green and untouched; the 36 base journey digests
   byte-identical — the seam test). The registry port
   `SessionRevocationRegistry`: `revoke(jti, at)` / `isRevoked(jti)` /
   `revokeActor(actorId, at)` per the packet, plus the symmetric
   evidence queries `revocationOf` / `isActorRevoked` /
   `actorRevocationOf`; revocation is MONOTONE and idempotent (the
   FIRST record is retained — machine-pinned). The in-memory impl
   `InMemorySessionRevocationRegistry` is PLAINLY LABELLED: process
   lifetime only. The compositions:
   `verifySessionWithRevocation` (the packet's name —
   `verifySignedSession` FIRST, then the registry) and
   `verifyKeyedSessionWithRevocation` (the full F370B stack —
   `verifyKeyedSession` first, then the same shared registry check, so
   the precedence law is STRUCTURAL: one private `applyRevocation`
   helper both compositions call). Verdicts are DATA, verify stays
   TOTAL: the kernel refusals propagate VERBATIM, then `JTI_MISSING`
   (the fail-closed default — a jti-less token cannot be individually
   revoked, so the composition refuses it rather than silently treating
   it as unrevocable), then `REVOKED` with `cause: "jti" | "actor"`
   (the most specific cause wins — machine-pinned).
   **THE PRECEDENCE LAW (machine-asserted at the exact seams):**
   signature/expiry precede revocation — a tampered token refuses
   `SIGNATURE_INVALID` even when its jti is revoked; an expired token
   refuses `SESSION_EXPIRED` even when its jti is revoked; at the
   inclusive expiry boundary instant the token is NOT expired so the
   REGISTRY is what refuses (`REVOKED`), and one instant past it the
   expiry verdict takes over — the handover seam pinned from both
   sides; in the keyed stack key retirement precedes revocation
   (`KEY_RETIRED` beats `REVOKED`; in grace the registry refuses).
4. **Three census-certified D14 journeys** — §3 below: the keyring
   rotation lifecycle, the revocation discipline, and the randomness +
   no-leak law. All census-invariant (byte-identical across the whole
   census grid — machine-measured), all >= 25 assertions, all with
   refusal steps, all driving ONLY the REAL public entry points.
5. **Evidence** — this file + the one-line catalog append.

## 2. The census (census-first, with grep proof at base `42d3709`)

The F354 lesson: journey ids + the op family name THIS lane's
SECRET-MANAGEMENT angle, never a mechanic a parallel corpus could
claim. Machine greps at the base tree:

- `git grep -n "keyring-rotation\|session-revocation\|secure-random-no-leak" -- packages`
  → **ZERO matches** (the three journey ids did not exist).
- `git grep -in "keyring" -- packages` → only
  `packages/desktop/src/main/chromeCookieManager.ts:292,303`
  (`"linux-keyring-v11"` — the desktop cookie-manager's reason codes,
  a different namespace; recorded here, never claimed). No identity,
  acceptance or marketplace surface carries the word.
- `git grep -n "jti" -- packages` → **ZERO matches** (the claim itself
  is this lane's sanctioned extension).
- `git grep -n "fsk1\|fsk2" -- packages` → **ZERO matches** (the keyed
  envelope is new).
- Op prefixes `kr-` / `rev-` / `sr-` as quoted step/assertion-id
  literals in `packages/acceptance/**`: **ZERO matches** at base.
- `git grep -n "KeyringProvider\|rotateKeyring\|issueKeyedSession\|verifyKeyedSession\|SecureRandom\|verifySessionWithRevocation\|SessionRevocationRegistry\|deterministicSecureRandom\|issueCredentialWithGeneratedSalt\|KeyringData" -- packages`
  → **ZERO matches**: every public API this lane ships is NEW at the
  base.
- Nearest neighboring claims (recorded, distinct angles): the F370A
  signed-session family (a SINGLE fixture key, no lifecycle, no
  revocation surface), the F370A credentials family (CALLER-supplied
  salts — the honest limitation this lane closes), and the Wave-1
  identity kernel session lifecycle (`evaluateSessionTransition`
  revoke — a DIFFERENT surface: the session STATE MACHINE, not signed
  marketplace tokens). NONE drives key rotation, revocation-composed
  verification, or port-injected randomness — this lane's angle.

The census table additions (machine-verified in `tests/census.test.ts`
— all three non-responders, all byte-identical across the whole census
grid, all passing at the T0 baseline):

| journey id | census class | citation (verbatim prefix) |
|---|---|---|
| `security.keyring-rotation` | non-responder / invariant | `F370B census: invariant — the keyring-rotation family drives the rotating keyring over fixed logical epochs with a fixed injected SecureRandom stream (id first, then material — the frozen draw order)...` |
| `security.session-revocation` | non-responder / invariant | `F370B census: invariant — the session-revocation family mints jti-carrying tokens over fixed logical epochs and one in-memory registry driven in a fixed order...` |
| `security.secure-random-no-leak` | non-responder / invariant | `F370B census: invariant — the randomness/no-leak family draws salts and key material from fixed injected streams and asserts equality/length/no-leak booleans only...` |

Post-work ownership proof (grep at the lane tree): the three journey
ids appear in exactly their journey modules, the barrel, the census
table, the census/contracts/seam/f370b tests — zero matches outside
`packages/acceptance/security/**` except the identity modules'
self-references (the `./session-revocation` subpath and the session.ts
doc note). The `kr-` / `rev-` / `sr-` quoted prefixes appear in EXACTLY
the three F370B journey modules (35/35/29 occurrences; zero at base).
The API names appear in exactly the identity modules + their tests +
the three journeys.

## 3. The journey table (D14 form)

| id (corpus) | persona | capabilities | steps | assertions | refusals |
|---|---|---|---|---|---|
| `security.keyring-rotation` | site-reliability-engineer | rotating-keyring | 5 (kr-issue-under-current / kr-rotate / kr-verify-grace-retirement / kr-unknown-wrong-material / kr-malformed-refusals) | 30 (kr-1..kr-30) | 3 refusal steps; refusal assertions: KEY_RETIRED (kr-22), KEY_UNKNOWN (kr-25), wrong-material SIGNATURE_INVALID (kr-26), the 7-shape malformed family + null token (kr-27..kr-29), the no-leak law (kr-30) |
| `security.session-revocation` | security-analyst | session-revocation | 5 (rev-issue-verify / rev-jti-revocation / rev-actor-sweep / rev-precedence / rev-keyed-composition) | 30 (rev-1..rev-30) | 4 refusal steps; refusal assertions: REVOKED-by-jti (rev-7/8), the sweep REVOKED-by-actor (rev-12/13), the precedence family (rev-16..rev-24: tamper, malformed, expired-before, expired-after-revocation, the expiry-boundary seam both sides, JTI_MISSING), the keyed stack (rev-27..rev-30: REVOKED, KEY_RETIRED-beats-REVOKED, grace-REVOKED) |
| `security.secure-random-no-leak` | compliance-auditor | host-boundary-randomness | 4 (sr-deterministic-stream / sr-generated-salt-credentials / sr-key-material-via-port / sr-no-leak) | 25 (sr-1..sr-25) | 2 refusal steps; refusal assertions: wrong-secret + unknown-actor INVALID_CREDENTIAL byte-identical (sr-9..sr-11 — enumeration resistance under GENERATED salts), the no-leak family (sr-22..sr-25: verdicts clean, salt only in the stored record, rotation metadata clean, plaintext absent) |

All three: deterministic (byte-identical reruns — machine-pinned by the
runner it.each, the census determinism test, the seam same-anchor law,
the explicit full-corpus double-run in `tests/f370b.test.ts`, AND the
anchor-invariance across the whole census grid), REAL public entry
points only (every step names package + operations), census citations
embedded in the journey modules (with the grep evidence above), >= 5
substantive assertions (30/30/25), >= 1 refusal each. The env-backed
provider load is driven REAL inside the keyring journey (the same
parser path as the file provider); the file provider's own surface —
including the never-echo law over unreadable and malformed files — is
machine-covered by the identity suite (a composition decision recorded
here: no filesystem I/O inside journeys, preserving the corpus's
determinism hygiene).

**Machine laws inside `tests/f370b.test.ts` (12 tests):** the KEY-LAW
COVERAGE law (every keyring refusal family asserted across the
battery), the NO-SECRET-LEAK law (the corpus-wide grep: the lane's
seven known secret constants — the pilot fixture material, the
revocation-journey signing key, both generated key materials, both
generated salts, the credential plaintext — appear in NO journey fact
and NO journey outcome across the WHOLE 39-journey corpus), the
DETERMINISM law (the full corpus double-run, digest arrays AND full
outcome arrays byte-identical), and the D14 floor + grow-only barrel
checks (39 unique ids; the 36 base journeys still pass).

## 4. The contract surface (file:line at the lane tree)

**packages/identity/src/session.ts** (the sanctioned grow-only jti
extension — the ONLY kernel edit): claims field `jti?` :103, refusal
code `malformed-jti` :118, charset law `SESSION_JTI_PATTERN` :129, the
canonical-JSON grow-only slot :152 (`jti` LAST, only when present),
issue input `jti?` :171, issue validation :192-193, claims
construction :201, parse-side jti law :243-251. F370A APIs unchanged:
`issueSignedSession` / `verifySignedSession` signatures are pure
supersets (optional field only).

**packages/identity/src/keyring.ts** (new, 397 raw / 268 code lines):
types `KeyringKeyEntry` :67, `KeyringData` :77, `KeyringKeyMaterial`
:83, `KeyringProviderSource` :92, `KeyringProvider` :99,
`KeyringLoadRefusalReason` :145, `KeyringLoadResult` :147,
`KeyringProviderLoadResult` :153, `RotateKeyringRefusalReason` :248,
`RotateKeyringResult` :254, `KeyedSessionToken` :300,
`KeyedSessionIssueRefusalReason` :302, `KeyedSessionIssueResult` :307,
`KeyedSessionVerifyRefusalReason` :351, `KeyedSessionVerifyResult`
:356; consts `FIXTURE_KEYRING_DATA` :127 (the labelled pilot fixture),
`KEYRING_ENV_VARIABLE` :228; APIs `keyringProviderFromData` :109,
`fixtureKeyringProvider` :140, `parseKeyringJson` :163,
`fileKeyringProvider` :215, `envKeyringProvider` :233, `rotateKeyring`
:270, `issueKeyedSession` :315, `verifyKeyedSession` :365.

**packages/identity/src/secure-random.ts** (new, 140 raw / 52 code
lines): port `SecureRandom` :52; consts `CREDENTIAL_SALT_BYTES` :60,
`SIGNING_KEY_BYTES` :63; APIs `deterministicSecureRandom` :83,
`generateSigningKey` :119, `issueCredentialWithGeneratedSalt` :130.

**packages/identity/src/session-revocation.ts** (new, 222 raw / 112
code lines): types `SessionRevocation` :48, `ActorRevocation` :55,
`SessionRevocationRegistry` :72 (the port),
`SessionRevocationVerifyRefusalReason` :138,
`SessionRevocationVerifyResult` :143,
`KeyedSessionRevocationVerifyRefusalReason` :147,
`KeyedSessionRevocationVerifyResult` :152; the labelled in-memory impl
`InMemorySessionRevocationRegistry` :97; APIs
`verifySessionWithRevocation` :183, `verifyKeyedSessionWithRevocation`
:205 (both total; the shared `applyRevocation` :168 makes the
precedence law structural).

**packages/identity**: three new test files + the jti block appended to
`session.test.ts` (49 new tests, §5) + the barrel append (`src/index.ts`)
+ package.json (three subpath exports; ZERO dependency changes — no
lockfile motion, unlike the F370A precedent).

**packages/acceptance/security**: three new journey modules, barrel
36 → 39 (grow-only), census table 36 → 39 (grow-only append),
journey-contracts vocabulary extensions (capabilities 20 → 23 with
rotating-keyring / session-revocation / host-boundary-randomness),
census test T0-baseline pin 28/36 → 31/39 + the F370B
machine-verification block (+2), contracts/report capability pins
20 → 23, seam digest list 36 → 39 (grow-only append, the F341B/F361B/
F370A precedent), and `tests/f370b.test.ts` (new, 12 tests incl. the
four machine laws).

## 5. The machine-run battery (exact numbers, all at the lane tree)

| suite | before (base) | after | verdict |
|---|---:|---:|---|
| `pnpm --filter @fleetos/identity test` | **142** (7 files) | **191** (+49, 10 files) | green, grow-only |
| `pnpm --filter @fleetos/acceptance-security test` | **217** (10 files) | **237** (+20, 11 files) | green, grow-only |
| security corpus barrel | **36** | **39** | machine-counted (`SECURITY_JOURNEYS.length` = 39, unique ids = 39, `SECURITY_CENSUS.length` = 39, census covers the corpus exactly — no duplicates) |

Identity +49 decomposition (machine-accountable): session.test.ts +6
(the jti block; the 13 F370A tests untouched), secure-random.test.ts
+12, keyring.test.ts +18, session-revocation.test.ts +13 (the three
new files; the six base files untouched — 47+25+13+11+16+17+13 = 142
base tests all still green).

Security +20 decomposition (machine-accountable): journeys.test.ts
it.each auto-growth +6 (3 journeys × 2 it.each blocks, 116 → 122),
census.test.ts +2 (the F370B machine-verification block, 16 → 18),
f370b.test.ts +12 (the new focused battery; the F341B/F361B/F370A
precedent — journeys.test.ts's own spot-check blocks stay untouched).

- **Typecheck:** exit 0 on both packages (`pnpm --filter <pkg>
  typecheck` each — identity `tsc --noEmit`, security
  `tsc -p tsconfig.json --noEmit`).
- **Lint:** oxlint **0 warnings / 0 errors** on both packages
  (`pnpm --filter <pkg> lint` each — 23 files identity, 47 files
  acceptance-security src).
- **File law (≤400 code lines, block-comment-aware per the oxlint
  `max-lines` rule with skipBlankLines+skipComments):** keyring.ts 268,
  session-revocation.ts 112, secure-random.ts 52, the jti-extended
  session.ts 190, f370b-keyring-rotation.ts 207,
  f370b-session-revocation.ts 233, f370b-secure-random-no-leak.ts 189.
  Max 268 ≤ 400 (machine verdict: the oxlint rule is error-level and
  reports 0w/0e). Recorded for completeness: raw `wc -l` counts are
  keyring.ts 397 / session-revocation.ts 222 / secure-random.ts 140 /
  journeys 260/284/242 (rotation/revocation/randomness) — every lane file is under 400 RAW lines too
  (the repo's informational `scripts/count-lines.sh` flags 426
  pre-existing files above 400 raw lines at base, including F370A's
  own test files; the enforced law is the oxlint rule).
- **Determinism:** byte-identical re-runs — four machine forms: (1)
  the runner it.each pins all 39 journeys runner-deterministic; (2)
  the census determinism test runs the FULL census (39 journeys × 8
  anchors) twice with identical tables; (3) the seam test pins
  same-anchor re-runs at three anchors AND the 36 base-tree digests
  byte-for-byte (the three F370B digests appended grow-only:
  `5b3ffa22` / `17dfb058` / `e87b694c`); (4) `tests/f370b.test.ts`
  runs the FULL 39-journey corpus twice — byte-identical digest
  arrays AND byte-identical full outcome arrays (`JSON.stringify`
  equality, machine-checked).
- **Boundary:** `git diff --name-only 42d3709` (staged) = **23 paths**
  — 10 inside `packages/identity/**` (package.json, src/index.ts,
  session.ts + its test, the three new modules + their three test
  files), 12 inside `packages/acceptance/security/**` (the three
  journey modules, the barrel, census.ts, journey-contracts.ts, and
  the five touched test files incl. the new f370b.test.ts),
  `docs/evidence/F370B/report.md` (this file), and the catalog
  one-liner (`spec/work-items/WORK-ITEM-CATALOG.md`). **ZERO lockfile
  motion** (no dependency changes — every new module composes existing
  workspace deps + node builtins only), ZERO domain-package edits
  (policy/procurement/assets/actions/evidence untouched), ZERO
  industries.ts motion (machine-checked: the industries diff is
  empty), ZERO adoption/release pin files touched, ZERO
  infrastructure edits.
- **Cross-lane read-only verification** (nothing pre-existing
  disturbed — all green at identical counts to the F370A-merged tree):
  policy 158/158, actions 86/86, evidence 105/105, assets 221/221,
  procurement 171/171, vendors 108/108, work 80/80, field 111/111,
  commerce 171/171.
- **Architecture:** `pnpm run architecture:check` = OK, 0 violations
  at the lane tree (identity's new modules import only
  session/credentials/identity + node:crypto/node:fs — no new
  dependency direction; acceptance-security already depends on
  @fleetos/identity).
- **The F370A kernels:** `verifySignedSession` /
  `issueCredential` / `authorizeMarketplaceAction` /
  `marketplace-authenticated` — ZERO semantic edits (session.ts's only
  motion is the sanctioned optional-jti growth, machine-pinned
  byte-identical for jti-less tokens; credentials.ts, marketplace-gate
  .ts and marketplace-authenticated.ts are untouched files).

## 6. Honest limitations

- **The keyring providers are CONFIGURATION-CLASS.** The file/env
  providers load a JSON snapshot (dev/staging operational shape), and
  the pilot fixture is a fixed hex constant. A REAL KMS (HSM or cloud
  secret manager, custodian workflows, envelope encryption, key
  access auditing) is F370C-class work — honestly BLOCKED and recorded
  here, never pretended. The provider PORT is the seam a KMS adapter
  would implement.
- **The revocation registry is IN-MEMORY / NON-PERSISTENT.**
  `InMemorySessionRevocationRegistry` lives for the process lifetime —
  a restart forgets every revocation, and multi-replica deployments
  would need a shared registry. Persistent revocation is
  F370C/server-wiring class, recorded — never pretended.
- **The SecureRandom production binding is a NOTE, not shipped
  entropy.** The domain package deliberately contains no entropy
  source (the repo determinism law); the host binds node:crypto
  `randomBytes` at its own boundary (the exact recipe is in
  secure-random.ts's header). F370C wires that binding into the
  deployment service. Everything this lane proves about randomness is
  proven deterministic-under-injection (the fixed-stream impl) — which
  is the port's whole point.
- **The gate is not yet keyring-aware.** `authorizeMarketplaceAction`
  still takes a single `SessionSigningKey`; composing the gate with
  the keyring provider (and with revocation) at the HTTP boundary is
  the F370C deployment-service composition ("the F370A gate + F370B
  keyring" per the F370C packet) — compose never re-implement, so this
  lane ships the pieces and does not guess the wiring.
- **Retired keys are retained forever in the snapshot** (the
  KEY_RETIRED-never-decays-into-KEY_UNKNOWN law). Physical pruning of
  long-retired keys is a host operational choice with audit
  implications — F370C-class, recorded.
- **The file provider reads synchronously at construction**
  (`readFileSync`, host-supplied path, contents never echoed). Async
  loading and hot-reload of rotated snapshots are server-wiring
  concerns (F370C-class).
- **Adoption/release pins are honestly stale at this tree** (the
  F361A/B/C + F362 + F370A precedent — recorded, never touched): the
  TL-owned suites pin the security corpus at 31 and the F362-counted
  journey executions (3591) while this tree carries 39 — adoption runs
  **105/120** (15 failed — all count-pin class) and release **85/88**
  (3 failed — the same class: the "security 31" baseline pin and the
  tamper tripwire's expected count). Touching those pins is explicitly
  outside this lane's grant — the TL re-pins at F370 convergence.
- **The base-check discrepancy** (§ header): main had advanced to the
  F370C freeze (docs-only, disjoint) at clone; this branch is based on
  the contracted F370B-freeze SHA. The TL's merge resolves the catalog
  EOF append trivially (keep both rows).
- **Nothing here is live.** The F369/F371 live-pilot gate stays BLOCKED
  (the F362 standing qualification, unchanged). The journeys are
  fixture-labelled deterministic contract proofs through REAL public
  APIs with fixed injected streams; no entropy, no wall clock, no
  network, no filesystem inside the corpus.
