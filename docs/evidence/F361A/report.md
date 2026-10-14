# F361A — Wave-17 lane A: the marketplace receipt→asset enrollment contract

- **Work item:** F361A (`spec/work-items/WORK-ITEM-CATALOG.md`, Wave 17; the
  f361a packet `docs/tech-lead/packets/f361a.md` is the binding contract;
  the F360 freeze `docs/product/MARKETPLACE-MVP-FREEZE.md` §3.5 + §5 is
  the binding law).
- **Worker:** A. **Date:** 2026-10-14.
- **Base:** `cefd588` (main HEAD at clone — the F360 freeze commit,
  EXACTLY the packet's expectation).
- **Branch:** `work/f361a` (pushed to origin; the final tip SHA is in the
  FINAL REPORT message — the repository is the source of truth).
- **Binding law read in order:** the f361a packet, MARKETPLACE-MVP-FREEZE
  §3.5 (the two frozen state machines) + §5 (the lane contract + the F354
  lesson), mission §3.6/§8, the F340 corpus laws D14–D17 carryover.

## 1. The census (machine-measured FIRST, at base `cefd588`; grep proof)

The F354 lesson applied: the ids and the op family name THIS lane's angle
(receipt→enrollment), never a generic mechanic the parallel lanes (B:
trust/Guardian/evidence; C: request/offer/order) could claim. Every row
below was grepped at the base tree BEFORE any implementation:

| surface | grep at base `cefd588` (field + security + commerce corpora, src + tests) | verdict |
|---|---|---|
| journey id `marketplace-receipt-enrollment` | 0 matches (the only repo-wide hit: the f361a packet itself) | NEW — this lane owns it |
| journey id `marketplace-receipt-discrepancy` | 0 matches (same) | NEW — this lane owns it |
| op prefix `mre.*` (`"mre.` over all journey-contracts files) | 0 matches (existing prefixes: ar/wo/pj/pr/hx/bp/ret/kern/world + the Wave-0 families) | NEW — this lane owns it |
| symbols `ReceiptEvidence` / `AssetEnrollment` (packages/** + apps/**) | 0 matches | NEW surface — this lane creates it |
| `recordReceiptEvidence` / `verifyReceiptEvidence` / `ReceiptEnrollmentDirectory` | 0 matches | NEW surface |
| `admitAsset` / `transitionAsset` / `listAssets` / `lookupAsset` (the EXISTING registry) | exercised (field asset-ops + convergence scenario-fleet) | CONSUMED as the existing truth — the receipt→enrollment CONTRACT on top is the new angle; no second registry is created |

Post-work grep (the ownership proof at the final tree): the two journey
ids appear in exactly three files, ALL inside this lane's owned paths —
`packages/acceptance/field/src/journeys/f361a-marketplace.ts` (the
journeys + their census citations),
`packages/acceptance/field/tests/f361a-marketplace.test.ts` (the lane
tests), `packages/acceptance/field/tests/epochs.test.ts` (the
post-census additions list — the F331A/F341A/F351B precedent).

**Correlation-ordering note (freeze §5):** lane C's MarketplaceOrder
state machine ends `received → accepted | discrepancy` in
`packages/procurement` — a DIFFERENT package from this lane's receipt
EVIDENCE in `packages/assets`. The shared seam (the receipt-evidence
reference id) is a frozen TYPE (`ReceiptEvidence.evidenceRef`, carried
verbatim onto `AssetEnrollmentRecord.receiptEvidenceRef` and the twin
link attributes), never a shared file. My ids name the enrollment
angle; C's packet instructs C to name the marketplace-order angle — no
collision exists at my base (grep-proven above), and the F362 TL
adjudication re-runs the census at the merged tree.

## 2. The contract surface (REAL public APIs, all in `packages/assets`)

New module `packages/assets/src/receipt-evidence.ts` (216 lines) — the
frozen §3.5 first machine:

| export | file:line | law |
|---|---|---|
| `ReceiptEvidenceState` = recorded \| verified \| discrepancy | receipt-evidence.ts:38 | the frozen state machine |
| `ReceiptEvidence` (the frozen fields: serial/asset tag, tenant/site, supplier order ref, condition-on-arrival, warranty ref, captured-at + evidence ref) | receipt-evidence.ts:40 | §3.5 frozen fields, verbatim |
| `ReceiptConditionOnArrival` = new \| good \| damaged (+ `RECEIPT_CONDITIONS`) | receipt-evidence.ts:28 | the pilot condition vocabulary |
| `recordReceiptEvidence(input)` | receipt-evidence.ts:99 | pure recorder; 10 machine-stable field-validation refusal codes |
| `ReceiptExpectation` (the order-line seam TYPE) | receipt-evidence.ts:158 | the frozen seam with the F361C lane |
| `ReceiptDiscrepancyReason` (4 codes, fixed vocabulary order) | receipt-evidence.ts:173 | supplier-order / serial / asset-tag / condition mismatch |
| `verifyReceiptEvidence(evidence, expectation, decidedAt)` | receipt-evidence.ts:179 | recorded → verified \| discrepancy; terminal states refuse re-decision (`illegal-transition` — append-only) |
| `isVerifiedReceipt(evidence)` | receipt-evidence.ts:210 | the ONLY state enrollment accepts |

New module `packages/assets/src/receipt-enrollment.ts` (324 lines) — the
frozen §3.5 second machine, consuming the EXISTING registry:

| export | file:line | law |
|---|---|---|
| `AssetEnrollmentState` = candidate \| enrolled | receipt-enrollment.ts:56 | the frozen state machine |
| `AssetEnrollmentRecord` (the typed LINK: receipt evidence ref + assetId + deviceId + serial/tag + custody site + warranty ref) | receipt-enrollment.ts:58 | links serial/tag + custody + warranty (§3.5); the asset truth stays in the registry |
| `ReceiptEnrollmentRegistryPort` + `InMemoryReceiptEnrollmentRegistry` | receipt-enrollment.ts:83/88 | structural seam, keyed tenant+serial (the idempotency key) |
| `TwinPort` | receipt-enrollment.ts:100 | structurally satisfied by the SAME repository backing the AssetDirectory |
| `ReceiptEnrollmentRejectionCode` | receipt-enrollment.ts:109 | this lane's codes + the REAL registry's codes propagated verbatim |
| `ReceiptEnrollmentDirectory.recordReceipt` | receipt-enrollment.ts:170 | identical re-record = idempotent duplicate (F351A pattern); conflicting re-record refused |
| `.verifyReceipt` | receipt-enrollment.ts:186 | tenant-scoped; foreign tenant → `unknown-receipt` (no existence leak) |
| `.getReceipt` | receipt-enrollment.ts:201 | tenant fail-closed read (foreign → null, NOTHING) |
| `.openEnrollment` | receipt-enrollment.ts:214 | requires VERIFIED (`receipt-not-verified` / `receipt-discrepancy`); duplicate guard: same tenant+serial+tag → the ORIGINAL record with `duplicate=true` (registry untouched); same serial different tag → `serial-tag-conflict`; first opening consumes the REAL `AssetDirectory.admitAsset` (kernel-directory.ts:101) |
| `.completeEnrollment` | receipt-enrollment.ts:269 | candidate → enrolled via the REAL `AssetDirectory.transitionAsset(activate)` (kernel-directory.ts:140); the twin link via the REAL `applyTwinRevision` (assets.ts:169) carrying serial/tag + custody + warranty; idempotent on enrolled (audit honestly null) |
| `.findEnrollment` | receipt-enrollment.ts:321 | tenant fail-closed read (foreign → null, NOTHING) |

Both modules exported from `packages/assets/src/index.ts` (the package's
public root; +2 export lines, nothing removed).

**No second asset truth:** the enrollment record carries NO lifecycle of
its own — the asset's identity/lifecycle/enrolledAt live exclusively in
the EXISTING `ManagedAssetRecord` (admitted → active), and the twin link
is a REAL `applyTwinRevision` append through the registry's own twin
persistence. The journeys prove this by reading the registry's OWN view
(`mre.asset-lifecycle` / `mre.registry-count` over
`AssetDirectory.lookupAsset` / `.listAssets`).

## 3. The field journeys (D14 form; census citations in the module doc)

Added to the field corpus barrel (40 → 42, grow-only, declared order at
the tail; nothing removed, nothing renamed):

| id | persona / capability | steps | assertions | refusal steps | the law it proves |
|---|---|---:|---:|---|---|
| `marketplace-receipt-enrollment` | fleet-operator / enrollment | 15 | 23 | 3 (a3 unverified-refusal, a14/a15 foreign-tenant reads) | a verified receipt enrolls through the REAL registry (candidate → enrolled, admitted → active, twin linked); the duplicate-serial guard returns the ORIGINAL (duplicate=true, same enrollmentId) while `registry-count` stays 1; foreign tenants see NOTHING |
| `marketplace-receipt-discrepancy` | fleet-operator / enrollment | 13 | 18 | 2 (b4 discrepancy-refusal, b6 terminal re-decision) | a mismatched receipt records a DISCREPANCY with the machine-stable reasons (fixed vocabulary order); enrollment refuses; the registry stays at 0; the terminal state is never re-decided; only the corrected verified re-record enrolls (exactly 1 asset) |

Both journeys: pure data (`mre.*` op family only — machine-asserted in
the lane test), deterministic (byte-identical re-run, D2(c) form —
per-journey in the lane test + the whole-corpus rerun law in
runner.test.ts), no epochs declared (D14's single-epoch default; the
F330 census set is closed; added to `POST_CENSUS_ADDITIONS` per the
F331A/F341A/F351B precedent).

## 4. The verification battery (machine-run at the final tree)

| suite | before (at `cefd588`) | after | verdict |
|---|---:|---:|---|
| `pnpm --filter @fleetos/assets test` | 207 (9 files) | **221** (11 files) | green, grow-only (+14: 5 pure-machine + 9 directory/tenant) |
| `pnpm --filter @fleetos/assets typecheck` | exit 0 | exit 0 | clean |
| `pnpm --filter @fleetos/assets lint` (oxlint) | 0w/0e | **0 warnings, 0 errors** | clean |
| `pnpm --filter @fleetos/acceptance-field test` | 107 (8 files) | **111** (9 files) | green, grow-only (+4: 2 journey laws + determinism + the F354 id-uniqueness law) |
| `pnpm --filter @fleetos/acceptance-field typecheck` | exit 0 | exit 0 | clean |
| `pnpm --filter @fleetos/acceptance-field lint` (oxlint) | 0w/0e | **0 warnings, 0 errors** | clean |
| corpus barrel count | 40 | **42** | machine-verified (journeys.test.ts corpus-shape + report.test.ts aggregate, both updated in place) |
| determinism | byte-identical | byte-identical | whole-corpus rerun digest-equal (runner.test.ts) + per-F361A-journey re-run digest-equal (f361a-marketplace.test.ts) |
| tenant fail-closed | — | asserted | foreign tenant sees NOTHING: enrollment lookup + receipt lookup (journey a14/a15, r22/r23) + verify/open/complete refusals (unit battery) — no existence leak |
| file law (≤400 lines/new file) | — | max 369 | receipt-evidence.ts 216, receipt-enrollment.ts 324, receipt-evidence.test.ts 132, receipt-enrollment.test.ts 369, journey-contracts-f361a.ts 139, f361a-marketplace-ops.ts 169, f361a-marketplace.ts 132, f361a-marketplace.test.ts 124 |

Cross-lane corpora (read-only verification, not this lane's battery):
security 179/179 and commerce 133/133 remain GREEN at this tree (my
assets-package export additions are purely additive).

## 5. Boundary (the changed-path list, `git diff --name-only main...HEAD`)

16 code paths + this evidence directory + the one-line catalog append —
every one inside the packet's owned paths (`packages/assets/**`,
`packages/acceptance/field/**`, `docs/evidence/F361A/**`, the catalog
one-liner):

```
packages/acceptance/field/src/context.ts          (F361A directory wiring; shared repo retained)
packages/acceptance/field/src/journey-contracts-f361a.ts   (NEW — the mre.* op types)
packages/acceptance/field/src/journey-contracts.ts (+1 union member, comment)
packages/acceptance/field/src/journeys/f361a-marketplace.ts (NEW — the two journeys)
packages/acceptance/field/src/journeys/index.ts   (barrel 40 → 42, grow-only)
packages/acceptance/field/src/ops/f361a-marketplace-ops.ts (NEW — the executors)
packages/acceptance/field/src/runner.ts           (+1 dispatch line, comment)
packages/acceptance/field/tests/epochs.test.ts    (+2 post-census additions)
packages/acceptance/field/tests/f361a-marketplace.test.ts (NEW — the lane tests)
packages/acceptance/field/tests/journeys.test.ts  (corpus pin 40 → 42, in place)
packages/acceptance/field/tests/report.test.ts    (aggregate pin 40 → 42, in place)
packages/assets/src/index.ts                      (+2 export lines, comment)
packages/assets/src/receipt-evidence.test.ts      (NEW)
packages/assets/src/receipt-enrollment.test.ts    (NEW)
packages/assets/src/receipt-evidence.ts           (NEW)
packages/assets/src/receipt-enrollment.ts         (NEW)
docs/evidence/F361A/report.md                     (this file)
spec/work-items/WORK-ITEM-CATALOG.md              (the one-line DELIVERED append)
```

NO procurement order-state edits (C's lane), NO policy/actions/evidence
package edits (B's lane), NO adoption/release pin files, NO
industries.ts motion (both journeys are universal field journeys), NO
`pnpm-lock.yaml` motion (restored after install).

## 6. Honest limitations

- **Persistence:** types + deterministic domain logic + tests only, per
  the F360 §4 standing law — no new persistence system; PostgreSQL
  persistence remains the authoritative store (TL lane, F370
  productionization). The in-memory ports are the deterministic
  reference implementations.
- **Adoption/release pins are honestly stale at this tree:** the
  TL-owned adoption/convergence/release suites pin the field corpus at
  its pre-F361A shape (40 journeys); my two universal journeys grow the
  per-firm applicable counts (+2 per firm) when the TL re-pins at F362.
  Touching those pin files is explicitly outside this lane's owned
  paths (the F351B/F351C precedent — "adoption pins honestly stale for
  the TL re-pin").
- **The expectation input is caller-supplied:** the order-line
  expectation (`ReceiptExpectation`) is the frozen TYPE seam with the
  F361C lane — this lane does not read the order truth (C's package);
  the journeys feed it as journey data, honestly labelled.
- **Fixture/contract-tested, never "live":** per the F360 freeze §1, the
  live-pilot gate is BLOCKED on F369 supplier/customer acquisition; the
  Ghana/Accra scenario data is deterministic fixture data, and nothing
  here claims live operation.
- **The condition vocabulary is minimal by design:** new | good |
  damaged (the pilot's end-user computing + printer categories); richer
  grading is F370+ work if the pilot demands it.
- **No UI/host integration:** the receipt→enrollment surface is domain
  contract only; the F362 TL convergence composes it into the live-pilot
  spine (web UI, control plane, persistence).
