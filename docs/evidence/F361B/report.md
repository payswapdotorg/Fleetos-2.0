# F361B — marketplace trust/Guardian/evidence controls: the evidence report

**Worker:** B (session w17b). **Base:** `cefd588` (the F360 freeze commit;
verified `git log --oneline -1` at clone). **Branch:** `work/f361b`.
**Binding law:** `docs/product/MARKETPLACE-MVP-FREEZE.md` §3.6/§4/§5 +
`docs/tech-lead/packets/f361b.md`. All numbers below are machine-run at the
lane tree (commands recorded verbatim); nothing is projected.

## 1. What was delivered (the F360 §3.6 freeze, as REAL public domain APIs)

1. **The marketplace Guardian approval contract** —
   `packages/policy/src/marketplace-approval.ts` (+ barrel export in
   `src/index.ts`, subpath export in `package.json`). A typed request
   (`MarketplaceOrderApprovalRequest`) for consequential marketplace
   orders; ALL eight limit checks (transaction-kind-in-scope, currency,
   amount-within-ceiling, category, units, policy-references, supplier
   verification REFERENCE, offer-snapshot evidence reference) evaluated
   and reported on every decision; approval vs refusal with 14
   machine-stable reason codes; the advisory law as a REAL public API.
   **Zero new authority truth:** the single authorization path is the
   EXISTING `evaluateCapability` reference Guardian (guardian.ts, law A5)
   invoked over the canonical `cap.marketplace.order` Capability; the
   approval's `authorityTrace.source` is literally
   `"guardian.evaluateCapability"`. The advisory is EXCLUDED from the
   approval-digest inputs, so it can never alter verdict, reason, or
   digest — machine-asserted by `assertAdvisoryNeverAuthorizes` and by
   tests (approve-flavored advisories cannot rescue over-limit,
   self-authorization, or cross-tenant refusals; refuse-flavored advisories
   cannot veto in-limits approvals).
2. **The A4 action composition** — `packages/actions/src/marketplace-action.ts`
   (+ barrel + subpath). `proposeMarketplaceOrderAction` enters the order
   into the EXISTING consequential-action protocol via `proposeAction`;
   `authorizeMarketplaceOrderAction` applies the approval via the EXISTING
   `advanceActionState` and REFUSES when the approval decision is `refuse`
   (reason `refused.execute_without_authorization`) or the tenants mismatch
   (`refused.tenant_mismatch`); `rejectMarketplaceOrderAction` records the
   refusal trail through the EXISTING `rejected` terminal state. A forged
   "approve" wrapper around a BLOCK GuardianDecision still cannot
   authorize (machine-tested — the existing machine's own law).
3. **The evidence-retention contract** —
   `packages/evidence/src/marketplace-evidence.ts` (+ barrel + subpath).
   The four frozen artifact kinds (offer snapshot, provider-ack reference,
   fulfilment evidence, receipt evidence) with `MarketplaceEvidenceSource`
   + `capturedAt` provenance REQUIRED at intake; tenant-scoped fail-closed
   reads (foreign tenant => null/[], indistinguishable from absence) and
   fail-closed writes (foreign tenant => `refused.tenant_mismatch`, store
   unchanged); **duplicate-event refusal** keyed on (tenantId,
   providerEventId): the same provider event id presented twice returns
   the ORIGINAL record — never a second conclusion — and a divergent
   re-presentation is flagged (`divergent: true`) while the original wins
   verbatim and the store never grows; future-dated capturedAt refused as
   untrusted (mission §6 external-events law);
   `classifyMarketplaceEvidenceFreshness` classifies fresh/stale against
   caller-supplied logical time (§3.2 law: stale evidence never silently
   appears current). Digests compose the EXISTING `sha256Hex`/`utf8Bytes`.
   Lane boundary kept: the receipt VERIFICATION state machine is A's
   `packages/assets` lane (the receipt-evidence reference is the frozen
   TYPE seam, not a shared file); supplier/order truth is C's lane — this
   contract only requires that references EXIST, never adjudicates them.
4. **Tenant-isolation security tests** —
   `packages/security/tests/marketplace-isolation.test.ts` (+ three
   test-only devDependencies in `packages/security/package.json`; the
   security package's RUNTIME surface stays dependency-free). Foreign
   tenant approval/authorization/read/write refusals, cross-tenant dedup
   isolation, and the advisory law crossing nothing — all fail-closed.
5. **Two security acceptance journeys (D14 form)** —
   `packages/acceptance/security/src/journeys/marketplace-order-approval.ts`
   and `marketplace-evidence-dedup.ts`, added to the corpus barrel
   (29 → 31), census table (29 → 31 rows), seam digest table (grow-only
   append), census machine-tests, and a focused spot-check file
   `tests/f361b.test.ts` (the F341B precedent). The evidence family is
   async-signature: driven to completion at module evaluation via
   top-level await over the deterministic in-memory store (the F341B
   artifact-store precedent, documented in the journey module).

## 2. The census (census-first, with grep proof at base `cefd588`)

The F354 lesson: journey ids name THIS lane's angle —
`marketplace-order-approval-discipline` (Guardian approval CONTRACT:
limit checks + reason codes + advisory non-authorization) and
`marketplace-evidence-dedup-discipline` (provider-EVENT dedup +
tenant fail-closed retention) — never a generic mechanic another corpus
could claim. Machine greps at the base tree:

- `git grep -n "marketplace-order-approval-discipline\|marketplace-evidence-dedup-discipline" cefd588`
  → ONLY `docs/tech-lead/packets/f361b.md:31-32` (the packet itself). Zero
  code, zero other docs.
- `git grep -n "approval-discipline\|dedup-discipline" cefd588` → same
  packet lines only. The angle names are new at this base.
- `git grep -cil "marketplace" cefd588 -- packages/policy/src
  packages/actions/src packages/evidence/src packages/security/src` →
  ZERO matches (no marketplace code existed in the owned packages).
- `git grep -n "InMemoryMarketplaceEvidenceStore\|MarketplaceEvidenceKind\|
  recordEvidence\|evaluateMarketplaceOrderApproval\|
  assertAdvisoryNeverAuthorizes" cefd588 -- packages/acceptance
  packages/policy packages/actions packages/evidence` → ZERO matches:
  every public API this lane ships is NEW at the base.
- Nearest neighboring claims (recorded, distinct angles):
  `marketplace-transaction-flow` (commerce/adoption corpora — Worker C's
  request→offer→order chain, F331C-era) and the security corpus's own
  `security.evidence-artifact-store-completeness` (F341B — the
  content-addressed ARTIFACT store: bytes-level dedup + bundle
  completeness, a different surface from provider-EVENT dedup). The
  field corpus's `procurement-order-authorization` (F351B) exercises
  procurement's createOrder/Guardian-A5 surface, not the marketplace
  approval contract (limit checks/reason codes/advisory law).

The census table additions (machine-verified in
`tests/census.test.ts` — both non-responders, both byte-identical across
the whole census grid, both passing at the T0 baseline):

| journey id | census class | citation (verbatim prefix) |
|---|---|---|
| `security.marketplace-order-approval-discipline` | non-responder / invariant | `F361B census: invariant — the approval-discipline family is pure fixture data over the sync policy/actions APIs with fixed logical ISO timestamps and never reads the run anchor...` |
| `security.marketplace-evidence-dedup-discipline` | non-responder / invariant | `F361B census: invariant — the evidence-dedup family is content-addressed with caller-supplied logical timestamps only (the F341B artifact-store precedent...` |

Journey-id note (honest): the packet's ids are carried verbatim as the
angle names; the corpus law (`tests/contracts.test.ts`) requires every
journey id to start with `security.`, so the corpus ids are
`security.marketplace-order-approval-discipline` and
`security.marketplace-evidence-dedup-discipline`.

## 3. The journey table (D14 form)

| id (corpus) | persona | capabilities | steps | assertions | refusals |
|---|---|---|---|---|---|
| `security.marketplace-order-approval-discipline` | tenant-operator | guardian-e2e-authorization, action-plans | 6 (propose / guardian-approval-in-limits / authorize-approved-order / refuse-over-limit / advisory-never-authorizes / refuse-cross-tenant) | 48 (ap-1..ap-48) | 6 refusal steps; 14 refusal assertions (ap-24..ap-33, ap-41..ap-48 incl. the never-authorize + tenant-mismatch laws) |
| `security.marketplace-evidence-dedup-discipline` | compliance-auditor | understand-evidence, tenant-isolation | 4 (retain-four-kinds / duplicate-provider-event / tenant-fail-closed / intake-refusals-and-freshness) | 41 (ev-1..ev-41) | 3 refusal steps; 12 refusal assertions (ev-12, ev-24..ev-28, ev-35..ev-38 incl. duplicate-event refusal + tenant fail-closed + untrusted-future intake) |

Both journeys: deterministic (byte-identical rerun machine-verified in-suite
and by the battery), REAL public entry points only, census citations
embedded in the journey modules (with the grep evidence above), ≥5
substantive assertions (48/41), ≥1 refusal each (6/3 refusal steps).

## 4. The contract surface (file:line at the lane tree)

**packages/policy/src/marketplace-approval.ts** (new, 308 code lines):
types `MarketplaceCategory` :46, `MarketplaceTransactionKind` :49,
`MARKETPLACE_PILOT_TRANSACTION_KINDS` :56, `MarketplacePolicyRef` :62,
`MarketplaceAdvisoryRecommendation` :76 (input data only — no authority
field), `MarketplaceOrder` :83, `MarketplaceApprovalLimits` :101,
`MarketplaceOrderApprovalRequest` :111, `MarketplaceLimitCheckId` :128,
`MarketplaceLimitFinding` :139, `MarketplaceApprovalReasonCode` :147,
`MarketplaceAuthorityTrace` :164 (source fixed to
`"guardian.evaluateCapability"`), `MarketplaceOrderApproval` :171; APIs
`marketplaceOrderCapability` :195, `evaluateMarketplaceOrderApproval`
:328, `assertAdvisoryNeverAuthorizes` :416; const
`MARKETPLACE_ORDER_CAPABILITY_ID` :43.

**packages/actions/src/marketplace-action.ts** (new, 67 code lines):
`proposeMarketplaceOrderAction` :50, `authorizeMarketplaceOrderAction`
:97, `rejectMarketplaceOrderAction` :128.

**packages/evidence/src/marketplace-evidence.ts** (new, 178 code lines):
types `MarketplaceEvidenceKind` :45 (the four frozen kinds),
`MarketplaceEvidenceSource` :52, `MarketplaceEvidenceInput` :62,
`MarketplaceEvidenceRecord` :76, `MarketplaceEvidenceRefusalReason` :85,
`MarketplaceEvidenceRecordOutcome` :93 (the duplicate branch returns the
ORIGINAL + `divergent` flag), `MarketplaceEvidenceCaller` :110,
`MarketplaceEvidenceStorePort` :119,
`MarketplaceEvidenceFreshnessThresholds` :258,
`MarketplaceEvidenceFreshnessClass` :263; APIs
`computeMarketplaceEvidenceDigest` :133, `marketplaceEvidenceId` :149,
`InMemoryMarketplaceEvidenceStore` :162 (recordEvidence/readEvidence/
findByProviderEvent/listBySubject),
`classifyMarketplaceEvidenceFreshness` :270.

**packages/security**: no new runtime API (by design — the deliverable is
the fail-closed VERIFICATION); `tests/marketplace-isolation.test.ts`
(new, 9 tests) + three test-only devDependencies.

**packages/acceptance/security**: two new journey modules (files above),
barrel + census + seam-table + census-test + `tests/f361b.test.ts` (new,
9 spot checks).

## 5. The machine-run battery (exact numbers, all at the lane tree)

| suite | before (base) | after | verdict |
|---|---|---|---|
| `pnpm --filter @fleetos/policy test` | 131 | **158** (+27) | green, grow-only (7 files) |
| `pnpm --filter @fleetos/actions test` | 73 | **86** (+13) | green, grow-only (5 files) |
| `pnpm --filter @fleetos/evidence test` | 82 | **105** (+23) | green, grow-only (4 files) |
| `pnpm --filter @fleetos/security test` | 147 | **156** (+9) | green, grow-only (8 files) |
| `pnpm --filter @fleetos/acceptance-security test` | **179** | **194** (+15) | green, grow-only (9 files) |

Security-suite +15 decomposition (machine-accountable): journeys.test.ts
it.each auto-growth +4 (2 journeys × 2 it.each blocks), census.test.ts
+2 (the F361B machine-verification block), f361b.test.ts +9 (focused
spot checks). Corpus barrel 29 → 31, machine-verified (census table
covers exactly the 31-journey corpus; T0 baseline 23/31 pass, 8 fail —
the 8 echo-family failures unchanged, grow-only; the 19 declared
F331B-invariant journeys unchanged; the two responders and their
out-of-schedule crossings unchanged).

- **Typecheck:** exit 0 on all five packages
  (`pnpm --filter <pkg> typecheck` each).
- **Lint:** exit 0, 0 warnings on all five package `lint` scripts; root
  `pnpm lint` = 68 warnings / 0 errors — byte-identical count to the base
  tree (this lane adds ZERO; the 68 are pre-existing elsewhere).
- **Determinism:** byte-identical rerun — the acceptance-security suite
  rerun produces identical file/test counts (9/194); both new journeys'
  full outcomes are byte-identical on rerun (8107 and 7053 bytes of
  canonical JSON); all 31 corpus journey digests byte-identical on rerun;
  the in-suite determinism tests (runner it.each + census determinism +
  seam same-anchor re-runs) all green.
- **File law (≤400 lines, skipBlank+skipComments per the oxlint rule):**
  marketplace-approval.ts 308, marketplace-action.ts 67,
  marketplace-evidence.ts 178, marketplace-order-approval.ts 245,
  marketplace-evidence-dedup.ts 244 (non-blank) / 194 code,
  marketplace-isolation.test.ts 151. Max 308 ≤ 400. oxlint max-lines: 0
  warnings on all new files.
- **Boundary:** `git diff --name-only main...HEAD` = 23 paths (after the
  evidence + catalog commit below), ALL inside the owned lanes:
  `packages/policy/**`, `packages/actions/**`, `packages/evidence/**`,
  `packages/security/**`, `packages/acceptance/security/**`,
  `docs/evidence/F361B/**`, the catalog one-liner
  (`spec/work-items/WORK-ITEM-CATALOG.md`), and `pnpm-lock.yaml` (the
  mechanical consequence of the three test-only devDependencies in
  packages/security — the F351B lane precedent: "lockfile/package.json"
  accompany a package.json change). ZERO procurement/vendors/assets
  edits, ZERO adoption/release pins, ZERO acceptance-pin files.

## 6. Honest limitations

- **Contract/fixture-tested, never live.** The F360 live-pilot gate stays
  BLOCKED on F369 (real customer/supplier acquisition). The journeys are
  fixture-labelled deterministic contract proofs — no live marketplace
  claim is made anywhere.
- **The marketplace request carries supplier/order REFERENCES, not
  truth.** Supplier verification states, offers and order state machines
  are Worker C's F361C lane; this contract checks that references EXIST
  (non-empty), never adjudicates them. The receipt VERIFICATION state
  machine is Worker A's F361A lane; the shared seam is the frozen
  receipt-evidence reference TYPE (F360 §5 correlation ordering).
- **Money boundary kept.** The approval contract encodes order +
  invoice-record + manual settlement only; no payment/escrow/credit
  simulation. Rental/lease are typed follow-on states that ALWAYS refuse
  with `refuse.kind_not_in_pilot_scope` (recorded in the contract, not
  implemented — F360 §1).
- **The evidence store ships the deterministic in-memory reference
  implementation only.** Production persistence (PostgreSQL/object store
  per the Architecture Lock) is F370 hardening; the port is the seam.
- **The `human.approval` composition is vocabulary reuse, not new
  authority.** When the Guardian answers REQUIRE_APPROVAL, the REQUEST
  itself satisfies approval only if the requesting actor already holds
  the EXISTING `human.approval` AuthorityKind; an actor lacking it is
  refused (`refuse.actor_missing_human_approval`). Real authentication
  is F370 — the actor convention is shape/scope-validated only.
- **Security-package devDependencies are test-only.** The security
  package's runtime surface remains dependency-free; the cross-package
  imports live only in the new test file.
- **Advisory law is enforced structurally + assertively at the contract
  level.** A runtime attacker who forges an approval wrapper around a
  BLOCK GuardianDecision is still refused (machine-tested), but full
  unforgeable wire-level authority is F370 authentication work.
- **Census is lane-local.** Per the F354 lesson, the TL re-runs the
  census/coverage proof at integration (F362) against the merged tree;
  cross-corpus API overlap between the parallel lanes is adjudicated by
  the TL, never silently counted.
