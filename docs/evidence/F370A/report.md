# F370A — marketplace authentication + server-side tenant authorization: the evidence report

**Worker:** A (session w18a). **Base:** `c6fec46` (the F370A freeze commit,
"Wave-18 first lane packet"; full SHA `c6fec46a42f27f68e375600fd6200ae6d19d6439`,
verified `git log --oneline -1` at clone). **Branch:** `work/f370a`.
**Binding law:** `docs/tech-lead/packets/f370a.md` (the full contract) +
`spec/ARCHITECTURE-LOCK.md` (A5/A6/A8/A20 — persistence law UNCHANGED) +
`docs/product/MARKETPLACE-MVP-FREEZE.md` §4 (the standing laws this lane
implements: "real authentication is F370 work" — now delivered at the
boundary). All numbers below are machine-run at the lane tree (commands
recorded verbatim); nothing is projected.

## 1. What was delivered (the F370A packet, as REAL public domain APIs)

1. **Credential verification** — `packages/identity/src/credentials.ts`
   (+ barrel export in `src/index.ts`, subpath export in `package.json`).
   `issueCredential` / `verifyCredential` over the frozen credential
   record (actorId, tenantId, kind, saltHex, params, digestHex) with a
   salted scrypt digest via node:crypto `scryptSync` under ONE frozen
   deterministic parameter set (N=16384, r=8, p=1, keylen=32 — pinned by
   test). The plaintext is NEVER stored (machine-asserted: the
   serialized record does not contain it), NEVER logged (the module is
   pure — it cannot log), NEVER echoed in errors (the single verify
   refusal code carries no material). Comparison is `crypto.timingSafeEqual`
   over equal-length digests. **Enumeration resistance is structural:**
   unknown-actor (`record: null`), malformed-record (tampered digest,
   downgraded parameters, bad kind — all normalized to the burn target)
   and wrong-secret refusals return the byte-identical verdict
   `{ok: false, reason: "INVALID_CREDENTIAL"}` AND burn the same scrypt
   work over the plainly-labelled `CREDENTIAL_BURN_SALT_HEX` (the dummy
   digest is the scrypt of the empty string — unreachable by
   construction, since issuance refuses empty secrets).
2. **Signed session tokens** — `packages/identity/src/session.ts`
   (+ barrel + subpath). `issueSignedSession` / `verifySignedSession`:
   HMAC-SHA256 over the frozen claims (actorId, tenantId, scopes,
   issuedAt, expiresAt) with a caller-supplied key; the token is the
   versioned envelope `fss1.<base64url payload>.<base64url signature>`
   with the signature covering `fss1.<payload>` verbatim — any mutated
   claim, flipped signature character or wrong key refuses
   `SIGNATURE_INVALID` (constant-time compare; tamper and wrong-key are
   cryptographically indistinguishable BY DESIGN — machine-asserted as
   the same reason); an expired window refuses `SESSION_EXPIRED`
   (boundary inclusive: `now === expiresAt` still verifies — pinned);
   malformed envelopes refuse `MALFORMED_TOKEN`; an unusable key refuses
   `KEY_INVALID`. **Verify is TOTAL** — never throws, always a typed
   verdict (machine-tested over a 17-case adversarial battery incl.
   null/undefined/type-confused tokens). Scopes are canonicalized
   (deduplicated + sorted) at issue time so the signed bytes are
   deterministic.
3. **The authorization gate** — `packages/identity/src/marketplace-gate.ts`
   (+ barrel + subpath). `authorizeMarketplaceAction` composing
   `verifySignedSession` + the actor→tenant binding + the frozen
   action-scope table (`MARKETPLACE_ACTION_SCOPE_TABLE`: the eight
   F360 §3 verbs request/offer/comparison/order/ack/receipt/enrollment/
   approval → their one required scope each). Verdicts are DATA:
   `AUTHORIZED {actorId, tenantId, action, scope}` or
   `REFUSED {reason}` with the frozen reason codes — UNAUTHENTICATED /
   SESSION_EXPIRED / TENANT_MISMATCH / SCOPE_MISSING / MALFORMED — never
   exception control flow. **Fail-closed default:** an unknown verb, a
   malformed tenant scope, a missing token, a bad signature, a foreign
   tenant or a missing scope is refused — anything not EXACTLY authorized
   is refused. The check order is machine-stable and machine-tested
   (action shape → token presence → verify → tenant binding → scope:
   malformed-beats-missing-token; expiry-beats-tenant-mismatch).
4. **The authenticated marketplace composition** —
   `packages/identity/src/marketplace-authenticated.ts` (+ barrel +
   subpath). The REAL public APIs of the Wave-17 lanes COMPOSED behind
   the gate — eleven thin verbs, each `gate(...) → delegate to the
   EXISTING kernel verbatim`: the F361C request/offer/comparison/order/
   ack surfaces (`authenticatedSubmitEquipmentRequest`,
   `authenticatedCaptureMarketplaceOffer`,
   `authenticatedCompareMarketplaceOffers`,
   `authenticatedDraftEquipmentMarketplaceOrder`,
   `authenticatedPlaceEquipmentMarketplaceOrder`,
   `authenticatedAcknowledgeProviderOrder` over the EXISTING
   submitEquipmentRequest / captureMarketplaceOffer /
   compareMarketplaceOffers / draftEquipmentMarketplaceOrder /
   transitionEquipmentMarketplaceOrder / acknowledgeProviderOrder), the
   F361A receipt/enrollment surfaces (`authenticatedRecordReceipt`,
   `authenticatedVerifyReceipt`, `authenticatedOpenEnrollment`,
   `authenticatedCompleteEnrollment` over the EXISTING
   ReceiptEnrollmentDirectory methods on the REAL AssetDirectory +
   InMemoryAssetRepository), and the F361B Guardian approval surface
   (`authenticatedEvaluateMarketplaceOrderApproval` over the EXISTING
   evaluateMarketplaceOrderApproval — zero new authority truth; the
   approval is exempted from the domain-ok predicate because the
   Guardian decision — approve OR refuse — is evaluated DATA, never an
   operational failure). The composed result union carries the gate
   verdict as data (`refusedBy: "gate"`) or the kernel's own result
   VERBATIM (`refusedBy: "domain"`, `domainRefusal` — reason codes never
   re-mapped; machine-asserted with the kernel's TOTAL_MISMATCH money
   law). **NEVER re-implemented, NEVER edited the domain packages** —
   zero edits outside the owned paths (§5 boundary), and no FINDING
   arose: every composition needed was exactly the existing public API.
5. **Five census-certified D14 security journeys** — §3 below: the
   credential discipline, the signed-session discipline, the gated
   request/offer/order chain, the gated receipt→enrollment chain, and
   the gated Guardian approval (the two-layer law: the GATE authorizes
   the caller, the GUARDIAN still decides the order). **>=1 refusal at
   EVERY gate reason** across the battery (machine-checked by
   `tests/f370a.test.ts`'s GATE-COVERAGE law) + the credential
   verification failure with enumeration-resistance asserted.
6. **Evidence** — this file + the one-line catalog append.

## 2. The census (census-first, with grep proof at base `c6fec46`)

The F354 lesson: journey ids + the op family name THIS lane's
AUTHENTICATION angle, never a mechanic a parallel corpus could claim.
Machine greps at the base tree:

- `git grep -n "authenticated-marketplace" c6fec46` → ONLY
  `docs/tech-lead/packets/f370a.md:76` (the packet prose itself). Zero
  matches in packages/, zero in any other doc.
- The five journey ids (`authenticated-marketplace-credentials` /
  `-sessions` / `-request-order` / `-receipt-enrollment` / `-approval`):
  zero matches at the base tree (covered by the grep above — the ids
  did not exist).
- Op prefixes `ama-` / `ses-` / `cre-` as quoted step/op-id literals in
  `packages/acceptance/**`: **zero matches** at base. (The only `ama`
  strings anywhere in acceptance corpora are the commerce corpus's
  ACTOR fixture names `act_operator-ama-01` / `act_proc-ama-01` —
  F362's operator ids, a different namespace; recorded here, never
  claimed.)
- `git grep -n "verifyCredential\|scryptSync\|timingSafeEqual\|createHmac\|authorizeMarketplaceAction\|AuthenticatedMarketplaceResult" c6fec46 -- packages`
  → **ZERO matches**: every public API this lane ships is NEW at the base.
- **THE NAME COLLISION FINDING (recorded, never edited):** the packet's
  literal name `issueSession` is ALREADY the Wave-1 identity
  session-lifecycle kernel public API (`packages/identity/src/kernel.ts:138`,
  depended on by the field corpus since F321A — the grow-only law
  forbids touching it). The signed-token surface therefore ships as
  `issueSignedSession` / `verifySignedSession` — a documented adaptation
  in `session.ts`'s header, NOT an edit of the existing API.
- Nearest neighboring claims (recorded, distinct angles): the F361B
  `security.marketplace-order-approval-discipline` (the SAME Guardian
  approval contract but driven UNAUTHENTICATED — the actor convention)
  and `security.marketplace-evidence-dedup-discipline` (provider-event
  dedup); the F361A field journeys `marketplace-receipt-enrollment` /
  `marketplace-receipt-discrepancy` (the receipt state machines,
  unauthenticated); the commerce corpus's `marketplace-transaction-spine`
  (the unauthenticated E2E chain); and the security corpus's own
  `security.tenant-fail-closed` (the F270B domain-read cross-cut).
  NONE drives the marketplace spine through the AUTHENTICATION boundary
  (credentials → signed tokens → the gate) — this lane's angle.

The census table additions (machine-verified in `tests/census.test.ts` —
all five non-responders, all byte-identical across the whole census
grid, all passing at the T0 baseline):

| journey id | census class | citation (verbatim prefix) |
|---|---|---|
| `security.authenticated-marketplace-credentials` | non-responder / invariant | `F370A census: invariant — the credentials family is pure fixture data over the sync identity scrypt APIs with the frozen deterministic parameter set...` |
| `security.authenticated-marketplace-sessions` | non-responder / invariant | `F370A census: invariant — the signed-session family mints HMAC-SHA256 tokens over fixed logical epochs with fixed keys...` |
| `security.authenticated-marketplace-request-order` | non-responder / invariant | `F370A census: invariant — the authenticated request/offer/order family drives the composed Wave-17 kernels behind the gate with fixed logical timestamps...` |
| `security.authenticated-marketplace-receipt-enrollment` | non-responder / invariant | `F370A census: invariant — the authenticated receipt/enrollment family drives the REAL F361A directory over one in-memory registry...` |
| `security.authenticated-marketplace-approval` | non-responder / invariant | `F370A census: invariant — the authenticated Guardian-approval family evaluates the EXISTING approval contract over fixed logical fixtures...` |

Post-work ownership proof (grep at the lane tree): the five ids appear
in exactly their journey modules, the barrel, the census table, the
seam digest list and `tests/f370a.test.ts` — zero matches outside
`packages/acceptance/security/**` (plus the identity modules they
drive). The `ama-` step-id prefix appears in exactly the three journeys
that use it; `cre-` / `ses-` in exactly one journey each.

## 3. The journey table (D14 form)

| id (corpus) | persona | capabilities | steps | assertions | refusals |
|---|---|---|---|---|---|
| `security.authenticated-marketplace-credentials` | security-analyst | credential-verification | 3 (cre-issue / cre-verify-ok / cre-verify-refusals) | 26 (cre-1..cre-26) | 1 refusal step; 8 refusal assertions (cre-19..cre-23 the five INVALID_CREDENTIAL refusals + cre-24..cre-26 the enumeration-resistance laws) |
| `security.authenticated-marketplace-sessions` | tenant-operator | session-authorization | 5 (ses-issue / ses-verify-ok / ses-tamper-refusal / ses-wrongkey-expiry-refusal / ses-malformed-refusal) | 24 (ses-1..ses-24) | 3 refusal steps; 9 refusal assertions (ses-16..ses-24: claim-tamper, sig-flip, wrong-key, expiry, the 7-case malformed battery, null-token) |
| `security.authenticated-marketplace-request-order` | tenant-operator | authenticated-marketplace-access, session-authorization | 6 (ama-request-happy / ama-request-gate-refusals / ama-offer-comparison-happy / ama-offer-gate-refusals / ama-order-ack-happy / ama-order-domain-and-auth-refusals) | 31 (ama-1..ama-31) | 3 refusal steps; 8 refusal assertions (ama-9/10/11 UNAUTHENTICATED + SESSION_EXPIRED + MALFORMED, ama-19/20 SCOPE_MISSING + TENANT_MISMATCH, ama-29/30 the domain-refusal law, ama-31 UNAUTHENTICATED ack) |
| `security.authenticated-marketplace-receipt-enrollment` | remediation-engineer | authenticated-marketplace-access | 3 (ama-receipt-chain / ama-receipt-gate-refusals / ama-enrollment-gate-refusals) | 19 (amr-1..amr-19) | 2 refusal steps; 6 refusal assertions (amr-13/14/15 UNAUTHENTICATED + store-untouched + SESSION_EXPIRED, amr-16/17/18 SCOPE_MISSING + TENANT_MISMATCH + UNAUTHENTICATED) |
| `security.authenticated-marketplace-approval` | compliance-auditor | authenticated-marketplace-access, guardian-e2e-authorization | 3 (ama-approval-authorized / ama-approval-two-layer-law / ama-approval-gate-refusals) | 19 (amp-1..amp-19) | 1 refusal step + the two-layer step; 8 refusal assertions (amp-11..amp-15 the Guardian's over-limit refusal as authorized DATA, amp-16..amp-19 the four gate reasons) |

All five: deterministic (byte-identical reruns — machine-pinned by the
runner it.each, the census determinism test, the seam same-anchor law
and an explicit full-corpus double-run at the lane tree), REAL public
entry points only (every step names package + operations), census
citations embedded in the journey modules (with the grep evidence
above), >=5 substantive assertions (26/24/31/19/19), >=1 refusal each.

**Gate coverage (the packet law, machine-checked in
`tests/f370a.test.ts` "the GATE-COVERAGE law"):**
- **UNAUTHENTICATED** — ama-9 (request, no token), ama-31 (ack, no
  token), amr-13 (record, no token — and the store records NOTHING:
  amr-14), amr-18 (complete, no token), amp-16 (approval, no token).
- **SESSION_EXPIRED** — ama-10 (request), amr-15 (verify), amp-17
  (approval) + ses-20 (the session-level expiry refusal).
- **TENANT_MISMATCH** — ama-20 (offer, foreign session), amr-17
  (enrollment, foreign session), amp-19 (approval, foreign-tenant
  request).
- **SCOPE_MISSING** — ama-19 (offer, request-only session), amr-16
  (enrollment, receipt-only session), amp-18 (approval, request-only
  session).
- **MALFORMED** — ama-11 (a malformed action tenant scope at the
  request verb).
- **Credential verification failure with enumeration resistance** —
  cre-19..cre-26 (wrong secret, unknown actor, malformed record, empty
  presentation, foreign record — all byte-identical INVALID_CREDENTIAL).
- **Tamper** — ses-16 (mutated tenant claim, no re-sign) + ses-17
  (flipped signature character); **wrong key** — ses-19 (+ ses-21 the
  indistinguishability law); **expiry** — ses-20; **malformed** —
  ses-22..ses-24.

Cross-tenant read coverage (the packet's "cross-tenant read on >=3
surfaces"): the foreign-tenant session is refused at the OFFER capture
(ama-20), the ENROLLMENT open (amr-17) and the APPROVAL evaluation
(amp-19) — three distinct composed surfaces, plus the F361A store
isolation (amr-14: the unauthenticated record left the store empty)
and the credential isolation (cre-23: the right secret against a
foreign principal's record refuses).

## 4. The contract surface (file:line at the lane tree)

**packages/identity/src/credentials.ts** (new, 131 code lines):
types `CredentialScryptParameters` :46, `CredentialKind` :62,
`CredentialRecord` :71, `CredentialVerifyRefusalReason` :119 (exactly
ONE code — the enumeration law), `CredentialVerifyResult` :121,
`CredentialIssueRefusalReason` :126, `CredentialIssueResult` :138;
consts `CREDENTIAL_SCRYPT_PARAMETERS` :54 (the frozen N=16384/r=8/p=1/
keylen=32), `CREDENTIAL_BURN_SALT_HEX` :93 (the plainly-labelled burn
target); APIs `issueCredential` :155, `verifyCredential` :236.

**packages/identity/src/session.ts** (new, 174 code lines): types
`MarketplaceSessionScope` :42 (the eight frozen scopes), const
`MARKETPLACE_SESSION_SCOPES` :53; `SessionSigningKey` :76,
`SignedSessionClaims` :82 (exactly five fields), `SignedSessionToken`
:91, `SignedSessionIssueRefusalReason` :93, `SignedSessionIssueResult`
:103, `SignedSessionVerifyRefusalReason` :182 (MALFORMED_TOKEN /
KEY_INVALID / SIGNATURE_INVALID / SESSION_EXPIRED),
`SignedSessionVerifyResult` :188; APIs `issueSignedSession` :136,
`verifySignedSession` :225.

**packages/identity/src/marketplace-gate.ts** (new, 134 code lines):
types `MarketplaceActionKind` :42 (the eight F360 §3 verbs), const
`MARKETPLACE_ACTION_SCOPE_TABLE` :56 (the frozen action→scope table),
`MarketplaceGateReason` :74 (the five frozen reason codes),
`AuthorizedMarketplaceAction` :81, `RefusedMarketplaceAction` :89,
`MarketplaceAuthorization` :98, `MarketplaceActionRequest` :101,
`AuthorizeMarketplaceActionInput` :106; API
`authorizeMarketplaceAction` :133.

**packages/identity/src/marketplace-authenticated.ts** (new, 177 code
lines): `AuthenticatedMarketplaceCall` :84,
`AuthenticatedMarketplaceResult<R>` :97 (gate-verdict-as-data | domain
result verbatim); the eleven composed verbs
`authenticatedSubmitEquipmentRequest` :138,
`authenticatedCaptureMarketplaceOffer` :149,
`authenticatedCompareMarketplaceOffers` :159,
`authenticatedDraftEquipmentMarketplaceOrder` :175,
`authenticatedPlaceEquipmentMarketplaceOrder` :185,
`authenticatedAcknowledgeProviderOrder` :195,
`authenticatedRecordReceipt` :209, `authenticatedVerifyReceipt` :219,
`authenticatedOpenEnrollment` :234, `authenticatedCompleteEnrollment`
:244, `authenticatedEvaluateMarketplaceOrderApproval` :261.

**packages/identity**: four new test files (53 tests, §5) + the barrel
append (`src/index.ts`) + package.json (three composition workspace
deps + the four subpath exports) + tsconfig.json (the
`allowImportingTsExtensions` alignment with every other cross-package
composing package — the mechanical consequence of composing packages
that use `.ts` import extensions; actions/acceptance-security use the
identical block).

**packages/acceptance/security**: five new journey modules (files
above), barrel 31 → 36 (grow-only), census table 31 → 36 (grow-only),
journey-contracts vocabulary extensions (capabilities 17 → 20 with
credential-verification / session-authorization /
authenticated-marketplace-access; allowed packages +
@fleetos/identity / @fleetos/procurement / @fleetos/assets), census
test T0-baseline pin 23/31 → 28/36 + the F370A machine-verification
block, contracts/report capability pins 17 → 20, seam digest list
31 → 36 (grow-only append, the F341B/F361B precedent), package.json
(+@fleetos/identity +@fleetos/assets), and `tests/f370a.test.ts` (new,
11 spot checks incl. the GATE-COVERAGE law).

## 5. The machine-run battery (exact numbers, all at the lane tree)

| suite | before (base) | after | verdict |
|---|---:|---:|---|
| `pnpm --filter @fleetos/identity test` | **89** (3 files) | **142** (+53, 7 files) | green, grow-only |
| `pnpm --filter @fleetos/acceptance-security test` | **194** (9 files) | **217** (+23, 10 files) | green, grow-only |
| security corpus barrel | **31** | **36** | machine-counted (census table covers exactly the 36-journey corpus, no duplicates; seam list length === corpus length) |

Identity +53 decomposition (machine-accountable): credentials.test.ts
+13, session.test.ts +13, marketplace-gate.test.ts +11,
marketplace-authenticated.test.ts +16 (the four new files; the three
base files untouched — 17+39+33 = 89 base tests all still green).

Security +23 decomposition (machine-accountable): journeys.test.ts
it.each auto-growth +10 (5 journeys × 2 it.each blocks), census.test.ts
+2 (the F370A machine-verification block), f370a.test.ts +11 (the new
focused battery; the F341B/F361B precedent — journeys.test.ts's own
spot-check blocks stay untouched).

- **Typecheck:** exit 0 on both packages (`pnpm --filter <pkg>
  typecheck` each).
- **Lint:** oxlint **0 warnings / 0 errors** on both packages
  (`pnpm --filter <pkg> lint` each).
- **File law (≤400 code lines, skipBlank+skipComments per the oxlint
  rule):** credentials.ts 131, session.ts 174, marketplace-gate.ts 134,
  marketplace-authenticated.ts 177, f370a-credentials.ts 141,
  f370a-sessions.ts 165, f370a-request-order.ts 249,
  f370a-receipt-enrollment.ts 189, f370a-approval.ts 167. Max 249 ≤ 400.
  The new test files are exempt per the repo's oxlint override
  (`max-lines: off` for `**/*.test.ts` / `**/tests/**`); the F361B
  precedent recorded the same shape.
- **Determinism:** byte-identical reruns — the runner it.each pins all
  36 journeys; the census determinism test runs the FULL census twice;
  the seam test pins same-anchor re-runs at three anchors; and an
  explicit lane-tree double-run of the FULL 36-journey corpus produced
  byte-identical digest arrays AND byte-identical full outcome arrays
  (`JSON.stringify` equality, machine-checked).
- **Boundary:** `git diff --name-only main...HEAD` = 28 paths — 11
  inside `packages/identity/**`, 14 inside
  `packages/acceptance/security/**`, `docs/evidence/F370A/report.md`
  (this file), the catalog one-liner
  (`spec/work-items/WORK-ITEM-CATALOG.md`), and `pnpm-lock.yaml` (the
  mechanical consequence of the two package.json dependency motions —
  the F351B/F361B/F362 precedent, recorded). ZERO domain-package
  source edits, ZERO industries.ts motion (machine-checked: the
  industries diff is empty), ZERO adoption/release pin files touched,
  ZERO infrastructure edits.
- **Cross-lane read-only verification** (nothing pre-existing
  disturbed — all green at identical counts to the F362 re-pinned
  tree): policy 158/158, actions 86/86, evidence 105/105, assets
  221/221, procurement 171/171, vendors 108/108, work 80/80, field
  111/111, commerce 171/171.
- **Architecture:** `pnpm run architecture:check` = OK, 0 violations at
  the lane tree (the identity→domain composition direction is legal —
  only `packages/web` depends on identity; procurement/policy/assets
  have no identity dependency, so no cycle is possible; the FleetOS
  modules are registered-transitional/unmanaged in
  architecture-policy.yaml, so deep-import/layer enforcement is not
  tripped).

## 6. Honest limitations

- **The pilot signing key is a plainly-labelled FIXTURE.** Every key in
  the journeys/tests is a fixed hex constant. Real secret management
  (key rotation, KMS/secret storage, key derivation at the host
  boundary) is F370B-class work, recorded here — never pretended.
- **The credential salt is CALLER-SUPPLIED.** The domain function is
  pure/deterministic (no randomness — the repo law); production must
  generate cryptographically random salts at the host boundary. This is
  the same honest seam as the key limitation above (F370B).
- **The actor convention is retired ONLY at the authenticated
  boundary.** The pure domain kernels (policy/procurement/assets/
  actions/evidence) keep their tested shape/scope-validated actor
  inputs — the F361B/F361C/F362 journeys and their pins are untouched
  and green. The F370A gate composes AROUND them; it does not rewrite
  them (A20 — composition at the boundary, never a second domain
  truth).
- **The name adaptation (a FINDING, recorded in §2):** the packet's
  literal `issueSession` is the existing Wave-1 kernel API; the
  signed-token surface ships as `issueSignedSession` /
  `verifySignedSession`. No existing API was edited (grow-only).
- **Tenant-id formats compose at their own seams (recorded):** session
  claims + credentials validate actorId against identity's Actor law
  (`act_…`) and tenantId against the MARKETPLACE TenantScope law
  (`[A-Za-z0-9_-]{1,128}`, procurement/src/contracts.ts — the format of
  the composed surfaces). Identity's internal branded `tnt_…` TenantId
  is a different surface and stays untouched (never conflated).
- **Adoption/release pins are honestly stale at this tree** (the
  F361A/B/C + F362 precedent — recorded, never touched): the TL-owned
  suites pin the security corpus at 31 (adoption
  tests/industries.test.ts "42+46+31", release release-gate.test.ts
  "security 31") and the F362-counted journey executions; at this tree
  the corpus is 36, so adoption runs 105/120 (15 failed — all
  count-pin class) and release 85/88 (3 failed — the same class).
  Touching those pins is explicitly outside this lane's grant — the TL
  re-pins at F370 convergence.
- **Nothing here is live.** The F369/F371 live-pilot gate stays BLOCKED
  (the F362 standing qualification, unchanged). The journeys are
  fixture-labelled deterministic contract proofs through REAL public
  APIs; the provider-ack and catalogue-import seams remain manual and
  plainly labelled (the freeze §1/§3.3/§3.4 law).
- **Session revocation is NOT in this lane.** The signed token carries
  no revocation surface (the existing kernel session lifecycle —
  `evaluateSessionTransition` revoke — remains the state machine it
  always was); a revocation/rotation composition over signed tokens is
  F370B-class hardening, recorded honestly.
- **No persistence, no UI/host integration** (the freeze §4 standing
  law): F370A delivers types + deterministic domain logic + tests; the
  server wiring (HTTP boundary, cookie/header transport, token storage)
  is F370B/C-class productionization.
