# F362 — the deterministic E2E transaction-spine journey (the TL-delegated worker lane)

- **Work item:** F362 §2 (the Wave-17 close composition). The binding packet
  `docs/tech-lead/packets/f362.md` (§2 is the full contract); the frozen law
  `docs/product/MARKETPLACE-MVP-FREEZE.md` §6 (the acceptance design) + D14–D17.
- **Worker:** the E2E worker (session w17l, branch `work/f362e2e`). **Date:**
  2026-10-14. **Base:** `d714616` (main HEAD at clone — the F361C-merge
  record carrying F361A + F361B + F361C all merged, EXACTLY the packet's
  expectation; SHA recorded by `git log --oneline -1` at clone).
- **Owned paths (the recorded F362 worker grant, held strictly):**
  `packages/acceptance/commerce/**` (the journey file + contracts + drivers
  + barrel + runner dispatch + vocab), `docs/evidence/F362/**`, the one-line
  catalog append. NO domain-package source edits, NO industries.ts, NO
  adoption/release pins (the TL re-pins at F362 final), NO field/security
  corpora.

## 1. The census (machine-measured FIRST at base `d714616`; grep proof)

The F354 lesson applied — the ids and the op family name THIS lane's
COMPOSITION angle (the transaction spine across all three lanes), never a
mechanic a parallel corpus could claim. Every candidate was grepped at the
base tree BEFORE any implementation:

| surface | grep at base `d714616` | verdict |
|---|---|---|
| journey id `marketplace-transaction-spine` (`packages/**`) | 0 matches (the only repo-wide hits: the f362 packet prose + the TL catalog row, both outside packages) | NEW — this lane owns it |
| op prefix `spn-` (`packages/acceptance/**`) | 0 matches (existing prefixes: wo/pj/bp/hx/pr/quote/mtx/mre/pdir/qcmp/vkpi/pidem/mreq/moff/mver/mord + the Wave-0 families) | NEW — this lane owns it |
| `evaluateMarketplaceOrderApproval` / `assertAdvisoryNeverAuthorizes` / `InMemoryMarketplaceEvidenceStore` / `buildArtifact` in `packages/acceptance/commerce/**` | 0 matches — the F361B surfaces existed ONLY in B's own lane (policy/evidence packages + the security corpus) | COMPOSED — driven from the commerce corpus for the first time at the documented composition site (law A20); never re-claimed as new domain surface |
| `ReceiptEnrollmentDirectory` / `AssetDirectory` / `InMemoryAssetRepository` / `applyTwinRevision` in `packages/acceptance/commerce/**` | 0 matches — the F361A surfaces existed ONLY in A's own lane (the assets package + the field corpus) | COMPOSED — same law |
| the F361C chain kinds `mreq-*` / `moff-*` / `mver-*` / `mord-*` | covered by the four census-certified F361C journeys | COMPOSED VERBATIM through the existing drivers — the spine reuses the exact public-API step interpreters; the F361C census bound is untouched (the f361c census test constrains only its own four journeys) |

Post-work ownership proof (grep at the final tree): the journey id appears
in `src/journeys/f362-spine.ts` + `tests/f362.test.ts` + the
corpus/report/contracts pin lines; the `spn-` prefix appears in exactly the
six files that define/interpret/pin it (contracts, two drivers, runner,
journey, test). ZERO matches outside `packages/acceptance/commerce/**`.

## 2. The journey (D14 form; the packet §2 chain, verbatim)

ONE journey — `marketplace-transaction-spine` (persona procurement-lead;
the new corpus capability `marketplace-transaction-spine`, vocab 34 → 35)
— through the REAL public APIs of ALL THREE Wave-17 lanes:

```
real need (F361C §3.1 submitEquipmentRequest — idempotent natural-key law)
  → seeded supplier catalogue (F361C §3.3 — verified suppliers, the
     plainly-labelled manual import, the verified-only matching gate)
  → two offers (F361C §3.2 captureMarketplaceOffer — THE FRESHNESS LAW)
  → explainable comparison (compareMarketplaceOffers over the EXISTING
     compareQuotes + matchVendors kernels — hard constraints vs
     preference weights, per-offer rationale)
  → Guardian approval (F361B evaluateMarketplaceOrderApproval over the
     EXISTING evaluateCapability + assertAdvisoryNeverAuthorizes, with the
     frozen offer snapshot retained first through the REAL evidence
     contract — the approval's offerSnapshotRef IS the retained record's
     evidence id)
  → order placement (F361C §3.4) + the manual provider-ack seam
     (acknowledgeProviderOrder idempotent + the store-side retention
     dedup — both sides name the SAME invoice reference)
  → receipt evidence (F361A recordReceipt → verifyReceipt, recorded →
     verified against the caller-supplied order-line expectation)
  → asset enrollment (F361A openEnrollment → completeEnrollment over the
     REAL AssetDirectory + applyTwinRevision — the authoritative record)
```

| measure | number |
|---|---:|
| steps | 66 (s1–s66) |
| assertions | 116 (sp1–sp116) |
| refusal-marked assertions | 21 (11 hard `REFUSAL` + 10 `REFUSAL-class`), ≥1 at EVERY segment gate (machine-checked in `tests/f362.test.ts`) |
| assertions per segment | need 12 / catalogue 9 / offers+freshness 9 / comparison 10 / approval 24 / order+ack 23 / receipt 7 / enrollment+closure 22 (all ≥5, D14) |

The packet's refusal list, all asserted: **illegal transition** (sp7
order-before-approval; sp93 the terminal receipt re-decision);
**authorization denial** (sp53 over-ceiling `refuse.amount_over_limit`;
sp58 `refuse.actor_missing_human_approval`; sp60-class the
advisory-never-authorizes law machine-asserted by the REAL
`assertAdvisoryNeverAuthorizes`); **expired offer** (sp29+sp30 the
post-lapse sheet EMPTY with both verdicts `expired`; sp38 the post-lapse
comparison refuses `NO_ELIGIBLE_OFFERS` — no weight rescues a failed hard
constraint); **duplicate serial** (sp105-class the duplicate guard returns
the ORIGINAL with the registry untouched; sp107 the same-serial
different-tag `serial-tag-conflict`); **foreign-tenant read** (sp12, sp85,
sp94, sp108, sp109, sp114 — request, evidence, receipt, enrollment,
registry and order reads all see NOTHING).

Determinism: byte-identical same-journey re-runs (digest + facts), the
FULL 46-journey corpus re-runs byte-identically, D13 invariance at all
seven census offsets — all machine-pinned in `tests/f362.test.ts`.
Single-epoch (T0): no step consumes the run anchor; every timestamp is
literal journey data or a fixed ISO fixture string (the F361B corpus
convention).

## 3. The contract surface (REAL public APIs composed; zero new domain surface)

- **F361C (composed verbatim through the existing census-certified
  drivers):** `submitEquipmentRequest`, `transitionEquipmentRequest`,
  `findEquipmentRequest`, `buildEquipmentRequestBoard`;
  `captureMarketplaceOffer`, `buildCurrentOfferSheet`,
  `compareMarketplaceOffers` (composing the EXISTING `compareQuotes` +
  `matchVendors`); `openSupplierVerification`,
  `transitionSupplierVerification`, `supplierVerificationGate`,
  `importCatalogueBatch`; `draftEquipmentMarketplaceOrder`,
  `transitionEquipmentMarketplaceOrder`, `acknowledgeProviderOrder`,
  `findEquipmentMarketplaceOrder`, `buildEquipmentMarketplaceOrderBoard`.
- **F361B (NEW to this corpus — `src/drivers-spine-guardian.ts`):**
  `InMemoryMarketplaceEvidenceStore.recordEvidence/readEvidence/
  findByProviderEvent` + `buildArtifact`/`utf8Bytes` (the offer-snapshot
  and provider-ack retention, duplicate-event refusal, future-dated
  capture refusal); `evaluateMarketplaceOrderApproval` +
  `assertAdvisoryNeverAuthorizes` (the Guardian approval contract over the
  EXISTING `evaluateCapability`; ALL eight limit checks; the advisory
  excluded from every digest).
- **F361A (NEW to this corpus — `src/drivers-spine-receipt.ts`):**
  `ReceiptEnrollmentDirectory.recordReceipt/verifyReceipt/getReceipt/
  openEnrollment/completeEnrollment/findEnrollment` over the REAL
  `AssetDirectory.admitAsset/transitionAsset/lookupAsset/listAssets` and
  the REAL `applyTwinRevision` — ONE `InMemoryAssetRepository` backs the
  directory, the registry and the twin port (the F361A field-context
  wiring verbatim; never a second asset truth).
- **The cross-lane bindings are machine-proved as facts** (the frozen TYPE
  seams, asserted in the journey + pinned in the test): the approval's
  `offerSnapshotRef` IS the retained snapshot's evidence id; the approval's
  `verificationRef` IS the §3.3 verification evidence id (`mver.verify.beta.
  evidenceId`); the order-side ack cites the SAME invoice reference as the
  retained provider-ack record (`mord.ack.ack.evidenceId === spn.evidence.
  providerAck.sourceReference`); the receipt names the supplier order and
  the enrollment names the receipt.

## 4. The verification battery (machine-run at this tree; exact numbers)

| suite | before (base) | after | verdict |
|---|---:|---:|---|
| `pnpm --filter @fleetos/acceptance-commerce test` | 153 (8 files) | **171** (9 files) | green, grow-only (+18: +1 journeys.test.ts auto-growth, +17 the new f362 battery) |
| commerce corpus barrel | 45 | **46** | machine-counted (corpus.test.ts count + assembly + required capability; report.test.ts capability pin 34 → 35) |
| `typecheck` (tsc --noEmit) | exit 0 | exit 0 | clean |
| `lint` (oxlint) | 0w/0e | **0 warnings, 0 errors** | clean |
| determinism | byte-identical | byte-identical | same-journey + FULL 46-corpus reruns + 7 census offsets, all machine-pinned |
| file law (≤400 code lines, block-comment-aware) | — | max **294** | contracts-f362 112, drivers-spine-guardian 240, drivers-spine-receipt 218, journeys/f362-spine 294; oxlint max-lines 0 warnings |

Cross-lane read-only verification (not this lane's battery — nothing
pre-existing disturbed): field **111/111**, security **194/194**, policy
**158/158**, evidence **105/105**, assets **221/221**, procurement
**171/171**, vendors **108/108**, work **80/80** — all green at identical
counts.

## 5. Boundary (the changed-path list, `git diff --name-only main...HEAD`)

15 paths + the evidence dir + the catalog one-liner — every one inside
the recorded grant (`packages/acceptance/commerce/**`,
`docs/evidence/F362/**`, the catalog append):

```
packages/acceptance/commerce/package.json          (+3 workspace deps: policy, evidence, assets)
packages/acceptance/commerce/src/journey-contracts.ts        (vocab +1, union +4, re-export)
packages/acceptance/commerce/src/journey-contracts-f362.ts   (NEW — the spn-* step types)
packages/acceptance/commerce/src/drivers-spine-guardian.ts   (NEW — the F361B segment)
packages/acceptance/commerce/src/drivers-spine-receipt.ts    (NEW — the F361A segment)
packages/acceptance/commerce/src/journeys/f362-spine.ts      (NEW — the journey)
packages/acceptance/commerce/src/journeys/index.ts           (barrel 45 → 46, grow-only)
packages/acceptance/commerce/src/runner.ts                   (+2 dispatch sets, comment)
packages/acceptance/commerce/tests/corpus.test.ts            (count/assembly/required-capability pins, in place)
packages/acceptance/commerce/tests/f331c.test.ts             (BASE_34 pin 43 → 44, in place)
packages/acceptance/commerce/tests/f351c.test.ts             (corpus pin, in place)
packages/acceptance/commerce/tests/f361c.test.ts             (corpus pins 45 → 46, in place)
packages/acceptance/commerce/tests/report.test.ts            (capability pin 34 → 35, in place)
packages/acceptance/commerce/tests/f362.test.ts              (NEW — the machine battery)
pnpm-lock.yaml                                    (+9 lines — the mechanical consequence of the three workspace deps; the F351B/F361B precedent)
docs/evidence/F362/report.md                      (this file)
spec/work-items/WORK-ITEM-CATALOG.md              (the one-line DELIVERED append)
```

ZERO domain-package edits, ZERO industries.ts, ZERO adoption/release pin
files, ZERO field/security corpus files.

## 6. Honest limitations

- **Nothing here is live.** The journey is fixture-labelled deterministic
  contract proof through REAL public APIs. The live-pilot gate stays
  BLOCKED on F369 (real supplier/customer acquisition) per the freeze §1
  and the packet §3; the catalogue import and the provider-ack remain
  plainly-labelled manual seams (a live-API source kind is
  unrepresentable in the types).
- **The three workspace dependencies are this lane's one package.json
  motion** (policy + evidence + assets into acceptance-commerce): the
  composition happens at the ACCEPTANCE composition site only (law A20) —
  no domain package was edited, and the lockfile motion is the mechanical
  consequence (the F351B/F361B precedent), recorded above.
- **Adoption/release pins are honestly stale at this tree:** the TL-owned
  suites pin the commerce corpus at 45 (adoption industries.test.ts:105,
  adoption convergence.test.ts:55, release release-gate.test.ts:187/190).
  At this tree the corpus is 46. Touching those pins is explicitly outside
  this lane's grant — the TL re-pins at F362 final (the F361A/B/C
  precedent: "adoption pins honestly stale for the TL re-pin").
- **The task summary's "corpus count: 44+1" is stale against the tree:**
  the machine count is **45+1=46** (F361C had already grown the barrel to
  45 at its merge; the TL's d714616 record names "commerce baseline 45").
  The machine-counted number is the source of truth.
- **The approval policy/limits fixtures are caller-supplied journey
  data** (the F361B corpus convention, documented in the driver): the
  two-tier rule fixture reproduces the F361B unit-battery pattern so the
  `refuse.actor_missing_human_approval` vocabulary-reuse law is exercised
  on the spine; real authentication is F370 — the actor convention is
  shape/scope-validated only.
- **The expectation input remains caller-supplied** (the frozen
  `ReceiptExpectation` TYPE seam): the spine feeds the order-line
  expectation as journey data matching the chain values — A's lane does
  not read C's order truth (law A20), and the binding is asserted as
  facts on both sides.
- **The comparison's rank-1 is the domain's verdict, not the author's:**
  with the default preference weights the faster-delivery offer
  (off-spine-b, sup-beta) ranks 1; the chain (selection, snapshot,
  approval, order, receipt) flows through the observed winner and every
  cross-segment value is pinned from the machine output.
- **No persistence, no UI/host integration:** per the freeze §4 standing
  law, F361/F362 deliver types + deterministic domain logic + tests; the
  web UI/control-plane/PostgreSQL productionization is F370 work. The
  F362 §1 items that remain TL-owned (the combined recount, the re-pin,
  the seven-suite root battery, the records) are NOT claimed here.
