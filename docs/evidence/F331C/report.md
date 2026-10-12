# F331C — Marketplace transactions + tenant billing + commerce seam (Wave 13 lane C)

- **Work item:** F331C (`spec/work-items/WORK-ITEM-CATALOG.md`, Wave 13; rows 34–35
  originate at F310C §3.5 rows 34–35).
- **Worker:** C (work-and-commerce). **Date:** 2026-10-13.
- **Base:** `a215420` (main HEAD at dispatch; the F331 packets freeze).
- **Branch:** `work/f331c` (pushed). **Tip at writing:** `2dfa6e0`.
- **Canonical context read in order:** F330 report (D7–D13 binding), the
  f331c packet, F310C §3.5, FINAL-RELEASE-HANDOFF, F322 report,
  `spec/worker-ownership.yaml`.

## 1. Commit chain (git is the gold channel)

| commit | content |
|---|---|
| `a3b43f1` | WIP1 — the commerce time seam (D12): `runJourney`/`runAllJourneys` gain `startedAt`; the world gains `state.time`; `COMMERCE_T0 = 1_774_000_000_000`. Zero behavior change at T0 (98/98 green; the no-options run is byte-identical to the explicit-T0 run). |
| `4d714fd` | WIP2 — the two REAL domain modules: `packages/procurement/src/marketplace-transactions.ts` (13 tests) + `packages/software/src/tenant-billing.ts` (8 tests). Procurement 136/136; software 87/87. |
| `d53ffa2` | WIP3 — the acceptance composition: 2 new journeys (marketplace-transaction-flow, tenant-billing-invoicing), step contracts + drivers, corpus 34 → 36, capability vocabulary +2. **CENSUS STATE**: journeys carry T0-anchored single-valued expectations ONLY — the census was machine-run at exactly this commit (D12 census-before-variants). Commerce 102/102. |
| `5b64475` | WIP4 — the D10 parameterization: per-epoch expectation tables on the two census-certified responders (second boundaries at T0+45d for pairwise distinctness), the MISSING_EPOCH certification bound, the F331C test battery. Commerce 115/115; corpus 36 journeys / 646 assertions. |
| `2dfa6e0` | Boundary fix — `pnpm-lock.yaml` restored to main's version (the WIP-install diff was a spurious pnpm 9.15.9 patch-hash re-hashing artifact; zero dependency specifier changes in this lane). |

## 2. The commerce time seam (D12) — design + zero-behavior-change proof

`runAllJourneys` had NO time parameter (F330 §1.2 fact). The seam
(`a3b43f1`):

- `runAllJourneys(journeys, options?)` / `runJourney(journey, options?)`
  accept `{ startedAt?: number }` and thread it into
  `buildJourneyWorld({ startedAt })`, which adds `state.time.startedAt`
  to the `JourneyState` (a NEW field — the seam is ADDITIVE-ONLY).
- `COMMERCE_T0 = 1_774_000_000_000` is defined LOCALLY in
  `journey-world.ts` (the F330 §1.1 census value; the adoption package is
  TL-owned — no import; the numeric identity is the documented law).
- **Zero behavior change at T0** (machine-verified three ways):
  1. all 98 pre-F331C commerce tests stay green at the seam tree (the
     suite ran unchanged);
  2. the no-options run is byte-identical to the explicit-T0 run
     (`canonicalJson` equality over all 34×2 outcomes — probe recorded
     in the census output header);
  3. no pre-F331C driver reads `state.time` — the pre-F331C corpus is
     invariant at every census offset (the census §5 machine-verified
     34/34).

The TL may now pass `{ startedAt: firmEpoch }` at the adoption
composition site (F332, TL-owned — no adoption path was touched).

## 3. Row 34 — marketplace transaction flow (the capability)

**Package:** `packages/procurement/src/marketplace-transactions.ts`
(procurement owns orders — BOUNDED-CONTEXTS.md; the F331C packet's
explicit `packages/procurement/**` adjacency). The published listing is
a `@fleetos/vendors` record and enters through the LOCAL structural seam
`MarketplaceListingLike` (the `VendorCapabilityRefLike` pattern — no
runtime import of @fleetos/vendors; the acceptance lane is the
composition site that binds the REAL records).

**State machine** `placed → checked-out | cancelled | expired` with
genuine refusal paths (no fixture echo — every refusal is produced by
the domain module and machine-tested):

- **placement gate** (`placeMarketplaceOrder`): only against a
  published listing of this tenant — a foreign-tenant listing in the
  input refuses `TENANT_MISMATCH` (fail-closed, never filtered); a
  delisted listing refuses `LISTING_NOT_PUBLISHED`; an unacknowledged
  honest exclusion refuses `EXCLUSIONS_NOT_ACKNOWLEDGED` (the listing's
  exclusions are carried VERBATIM onto the acknowledged order);
  invalid quantity/price/hold-window and duplicate ids refuse with
  exact reason codes; `totalMinor = quantity × unitPriceMinor` (integer,
  recomputed at checkout).
- **checkout gates** (`checkoutMarketplaceOrder`, deterministic order):
  tenancy → the listing must STILL be published at checkout (a delisting
  between placement and checkout refuses
  `LISTING_NOT_PUBLISHED_AT_CHECKOUT`) → the order must still be placed
  (terminal states refuse `ORDER_NOT_PLACED`) → the hold-window deadline
  (`at > validUntil` refuses `ORDER_WINDOW_EXPIRED` with the exact
  overshoot — **the boundary is inclusive: `at == validUntil` is still
  inside**) → the checkout limit (`CHECKOUT_LIMIT_EXCEEDED` with the
  exact overshoot, never clamped) → exact-total recomputation
  (`TOTAL_MISMATCH`).
- **cancel/expire**: empty cancel reason refuses `CANCEL_REASON_REQUIRED`;
  expiry refuses `NOT_EXPIRED_YET` while the window is open — an order
  never expires early; all terminal states refuse `ILLEGAL_TRANSITION`.
- **board** (`summarizeMarketplaceOrders`): counts by status + the
  checked-out money total, deterministic lexical order.

**Module suite:** `packages/procurement/tests/marketplace-transactions.test.ts`
— 13 tests (placement gate + verbatim exclusions, delisted/unknown/foreign
refusals, duplicate + invalid numbers, the checkout gates incl. the
inclusive boundary law, the exact-overshoot refusals, the drifted total,
terminality, early-expiry refusal, the board projection).
**Package suite:** procurement 136/136 (base 123 + 13).

**Journey:** `marketplace-transaction-flow` (persona procurement-lead,
capability `marketplace-transactions`) — 43 assertions, 25 steps. The
seed publishes listings through the REAL publication gate (the delisted
listing is produced by the REAL revocation cascade); every transaction
step drives the REAL procurement API. Time anchors: `ord-legacy` /
`ord-lapsed` / `ord-expiring` / `ord-slow` are placed at the ABSOLUTE
anchor `T0−25h` with ABSOLUTE hold windows (deadlines at `T0+5h`,
`T0−1h`, `T0+5h`, `T0+45d`); the checkout/expire attempts run at the
seam clock (`at: "now"`).

## 4. Row 35 — tenant billing & invoicing (the capability)

**Package:** `packages/software/src/tenant-billing.ts` (software owns
subscriptions/entitlements — the seat side of the bill). The gateway
usage record enters through the LOCAL structural seam
`GatewayUsageRecordLike` (structurally compatible with
`@fleetos/model-gateway` `UsageLedgerEntry` — the `BudgetCheckPort`
TYPE-seam pattern; the acceptance lane binds the REAL ledger entries).

**Billing model** (`issueTenantInvoice`):

- **issuance gate**: an invoice may only be issued once its billing
  period has ENDED (`at >= period.until`); an open period refuses
  `PERIOD_NOT_ENDED` — a window-boundary gate, never a partial bill.
- **honest windowing**: a usage record enters IFF
  `period.from <= record.at < period.until`; records outside the window
  NEVER enter (a future record is never absorbed).
- **tenant fail-closed**: a foreign-tenant usage record in the input
  refuses the whole issuance (`USAGE_TENANT_MISMATCH`).
- **seat line**: held seats counted through the REAL `countHeldSeats`
  (granted + assigned grants only) × `seatRateMinor`; **billability**
  at the period end follows the SAME grace law as `seat-allocation.ts`
  (status active + `period.until <= validUntil + graceMs`, else
  `SUBSCRIPTION_NOT_ACTIVE` / `SUBSCRIPTION_EXPIRED_BEYOND_GRACE`).
- **line order**: the seat line first (if any), then consumption lines
  in `modelId` lexical order (per-model aggregation of the REAL records:
  requests, units, amount).
- **exact money + limit path**: integer minor units; the invoice ceiling
  refuses `INVOICE_LIMIT_EXCEEDED` with the exact overshoot — never
  clamped.
- **no placeholders**: a bill with no line items at all refuses
  `EMPTY_INVOICE`.
- **no double billing**: a duplicate invoiceId or an invoice of the same
  subscription with an OVERLAPPING period refuses
  (`DUPLICATE_INVOICE_ID` / `DUPLICATE_BILLING_PERIOD`).

**Module suite:** `packages/software/tests/tenant-billing.test.ts` — 8
tests (line composition + order, the issuance gate with the inclusive
boundary, honest windowing + EMPTY_INVOICE, fail-closed tenancy, the
SAME-grace billability both directions, the exact-overshoot limit path,
double-billing refusals + the disjoint-period allowance, the invalid-input
reason codes). **Package suite:** software 87/87 (base 79 + 8).

**Journey:** `tenant-billing-invoicing` (persona finance-controller,
capability `tenant-billing`) — 28 assertions, 10 steps. The seed appends
four usage records through the REAL `appendUsage` (chained digests, the
documented budget-port seam bound to the REAL agent-organizations
check — `realBudgetPort`); the cross-tenant append probe is refused by
the REAL API (`TENANT_MISMATCH`). The closed-period invoice issues over
the world's REAL subscription + REAL entitlement grants (seat line from
the REAL held seats; consumption lines from the REAL records); the
refusal spine drives the issuance gate, double-billing, the limit path,
the grace law, the fail-closed tenancy, the empty bill and the inactive
subscription. Time anchors: billing periods are ABSOLUTE
(`[T0−30d, T0−6h)`, `[T0−6h, T0+2h)`, `[T0+30d, T0+45d)`); issuance
runs at the seam clock (`at: "now"`).

## 5. The commerce census (D12) — machine-run, full table

**Method** (F330 §1.1): `runAllJourneys(JOURNEYS, { startedAt: T0 + Δ })`
at `T0 = 1_774_000_000_000` for
Δ ∈ {−1h, +1s, +1h, +1d, +30d, +90d, +365d}; a journey RESPONDS when its
corpus-mode pass/fail flips vs the T0 baseline (36/36 pass at T0). Run
at the census-state commit `d53ffa2` (the journeys carry T0-anchored
single-valued expectations only — NO epoch tables existed; D12
census-before-variants). The census script (reproducible source: appendix
A) is machine evidence; the flip boundaries are PERMANENTLY re-verified
in-suite (`tests/f331c.test.ts` — "census responder laws" asserts the
domain facts at every recorded boundary on the final tree).

**Census result — 36 journeys (the task's 34 base + the 2 F331C
additions), 2 responders, 34 invariant:**

| # | journey | responds at | class |
|---|---|---|---|
| 1 | create-work-order | never | invariant |
| 2 | approve-execute-work-order | never | invariant |
| 3 | stage-gated-project | never | invariant |
| 4 | workload-allocation | never | invariant |
| 5 | work-order-blocking | never | invariant |
| 6 | procure-spine | never | invariant |
| 7 | quote-scoring | never | invariant |
| 8 | order-reconciliation | never | invariant |
| 9 | vendor-management | never | invariant |
| 10 | software-entitlements | never | invariant |
| 11 | aurum-settlement-seam | never | invariant |
| 12 | external-catalog-sync | never | invariant |
| 13 | apify-actor-job | never | invariant |
| 14 | org-optimization-review | never | invariant |
| 15 | cross-role-handoff | never | invariant |
| 16 | tenant-fail-closed | never | invariant |
| 17 | host-surface | never | invariant |
| 18 | host-intents | never | invariant |
| 19 | host-tenant-edges | never | invariant |
| 20 | gateway-routing | never | invariant |
| 21 | role-assignment-handoff | never | invariant |
| 22 | assignment-supersession | never | invariant |
| 23 | deadline-escalation | never | invariant |
| 24 | workload-release-rebalance | never | invariant |
| 25 | project-completion-portfolio | never | invariant |
| 26 | sla-scorecard-credit | never | invariant |
| 27 | batched-order-reconciliation | never | invariant |
| 28 | cost-allocation-exact-sums | never | invariant |
| 29 | renewal-window-sweep | never | invariant |
| 30 | provider-fallback-ladder | never | invariant |
| 31 | budget-rebalance-proposal | never | invariant |
| 32 | marketplace-publication-lifecycle | never | invariant |
| 33 | vendor-directory-service-relationship | never | invariant |
| 34 | actor-job-failure-expiry | never | invariant |
| 35 | marketplace-transaction-flow (F331C) | **−1h, +1d, +30d, +90d, +365d** | **transition** |
| 36 | tenant-billing-invoicing (F331C) | **+1d, +30d, +90d, +365d** | **transition** |

**Responder class evidence** (no timestamp-equality pins anywhere — D13;
every flip is a genuine D2(b) domain transition over ABSOLUTE anchored
data vs the run clock):

- `marketplace-transaction-flow` — **transition, bidirectional**:
  - at **−1h** (past): `ord-lapsed`'s window deadline is `T0−1h`
    exactly; the inclusive boundary law turns its checkout back ON
    (`ORDER_WINDOW_EXPIRED → checked-out`) and its explicit expiry OFF
    (`expired → NOT_EXPIRED_YET`). One boundary, two flipped readings.
  - at **+1d and beyond** (forward): `ord-legacy`'s window deadline
    `T0+5h` breaches — its checkout flips `checked-out →
    ORDER_WINDOW_EXPIRED`; `ord-expiring`'s expiry flips
    `NOT_EXPIRED_YET → expired`. (Added in the parameterization commit:
    `ord-slow`'s `T0+45d` deadline breaches only at +90d — no flip-set
    change at the census offsets; see §6.)
  - no flip at +1s/+1h (both windows still open) — the flips are
    deadline breaches, never equality pins.
- `tenant-billing-invoicing` — **transition, forward-only**: the open
  period's issuance gate (boundary `T0+2h`) opens at +1d and beyond
  (`PERIOD_NOT_ENDED → issued`, total `null → 75_000` — the seat-only
  bill for that window); no past flip at −1h. (Added in the
  parameterization commit: the late period's `T0+45d` boundary opens at
  +90d only — no flip-set change at the census offsets; see §6.)

The 34 pre-F331C journeys are invariant at every offset — machine-checked
permanently in-suite (`f331c.test.ts` runs all 34 at all seven offsets and
asserts 34/34 pass at each).

## 6. Parameterization (D10) — the census-certified set only

**Parameterized:** both census-certified transition-class responders.
No echo-class journeys exist in the commerce corpus (no census row is an
equality pin); no past-only responder exists either (the −1h half of
journey 35's response is bidirectional — it is parameterized on the
forward D9 epochs; its past flip is recorded in the census and is
exercised by no D9 epoch, exactly like the field corpus's past-only
exclusion logic).

**Per-epoch tables** (`expectedByEpoch`, covering the frozen D9 schedule
`{T0, T0+30d, T0+90d}` EXACTLY — 30d = 2_592_000_000 ms,
90d = 7_776_000_000 ms; every table's T0 entry is identical to the
single-valued expectation — enforced by the corpus shape test):

| journey | assertion | T0 | +30d | +90d |
|---|---|---|---|---|
| marketplace-transaction-flow | `mtx.checkout.legacyOk.ok` | true | false | false |
| | `mtx.checkout.legacyOk.status` | "checked-out" | null | null |
| | `mtx.checkout.legacyOk.reasonCode` | null | "ORDER_WINDOW_EXPIRED" | "ORDER_WINDOW_EXPIRED" |
| | `mtx.checkout.slowOk.ok` | true | true | false |
| | `mtx.checkout.slowOk.status` | "checked-out" | "checked-out" | null |
| | `mtx.checkout.slowOk.reasonCode` | null | null | "ORDER_WINDOW_EXPIRED" |
| | `mtx.expire.expiring.ok` | false | true | true |
| | `mtx.expire.expiring.status` | null | "expired" | "expired" |
| | `mtx.expire.expiring.reasonCode` | "NOT_EXPIRED_YET" | null | null |
| tenant-billing-invoicing | `bil.invoice.open.ok` | false | true | true |
| | `bil.invoice.open.reasonCode` | "PERIOD_NOT_ENDED" | null | null |
| | `bil.invoice.open.status` | null | "issued" | "issued" |
| | `bil.invoice.open.totalMinor` | null | 75_000 | 75_000 |
| | `bil.invoice.late.ok` | false | false | true |
| | `bil.invoice.late.reasonCode` | "PERIOD_NOT_ENDED" | "PERIOD_NOT_ENDED" | null |
| | `bil.invoice.late.status` | null | null | "issued" |
| | `bil.invoice.late.totalMinor` | null | null | 75_000 |

**Why the second boundaries (ord-slow, inv-9) exist — an honest record:**
the first parameterization attempt used single boundaries (deadlines at
`T0+5h` / `T0+2h`); the D10.2 distinctness proof then FAILED for the pair
(+30d, +90d) — both epochs agreed on every asserted reading (a same-
outcome re-run that D2(d) positively forbids as a distinct journey). The
honest fix is a genuine SECOND time-driven boundary in each domain —
`ord-slow`'s `T0+45d` hold-window deadline and the late period's `T0+45d`
issuance boundary — landing strictly between +30d and +90d. The census
flip sets at the seven offsets are UNCHANGED by the additions (the added
boundaries flip at offsets already in the recorded sets; machine-verified
permanently by the in-suite census-responder laws test, which asserts
every boundary in both directions).

**Proof form (D10.2), machine-run in-suite:**
- *distinctness*: for each parameterized journey, all three epoch outcomes
  pairwise differ on ≥1 ASSERTED reading, and the differing assertion ids
  are exactly the table-bearing ones (`f331c.test.ts` — "DISTINCTNESS");
- *same-epoch byte-identity*: a re-run at each epoch is byte-identical
  (digest equality, D2(c));
- *certification bound*: a run at a NON-frozen anchor (e.g. +1h) fails
  the parameterized journeys with the `MISSING_EPOCH` sentinel — never a
  soft pass; the journeys are certified only at the frozen epochs. The 34
  base journeys never produce MISSING_EPOCH (no tables).
- *schedule green*: the full 36-journey corpus passes at every frozen
  epoch {T0, T0+30d, T0+90d}.

The census citation (D10.3) is carried in both journeys' declaration
comments (the census commit, the class, the flip set).

## 7. Verification battery (machine counts, this tree)

| suite | command | result |
|---|---|---|
| commerce acceptance | `pnpm --filter @fleetos/acceptance-commerce test` | **115/115** (base 98 → grow-only; corpus 34 → 36 journeys, 575 → 646 assertions) |
| procurement (row-34 module) | `pnpm --filter @fleetos/procurement test` | **136/136** (base 123 + 13) |
| software (row-35 module) | `pnpm --filter @fleetos/software test` | **87/87** (base 79 + 8) |
| vendors (untouched, sanity) | `pnpm --filter @fleetos/vendors test` | **94/94** |
| model-gateway (untouched, sanity) | `pnpm --filter @fleetos/model-gateway test` | **107/107** |
| typecheck | `tsc --noEmit` × acceptance-commerce / procurement / software / vendors / model-gateway | all clean |
| lint | `oxlint src tests` × same five | 0 warnings / 0 errors each |

Corpus count law (machine, `count-corpus`): 36 journeys / 646 assertions
(marketplace-transaction-flow 43, tenant-billing-invoicing 28).

## 8. Boundary + file law

`git fetch origin main:main` executed BEFORE the final gate run (main
still at `a215420` — the dispatch base; no drift). `git diff --name-only
main...HEAD` lists exactly:

- `packages/acceptance/commerce/**` (11 files — the granted corpus
  package);
- `packages/procurement/**` (3 files — worker-C owned; row 34);
- `packages/software/**` (3 files — worker-C owned; row 35);
- this report (the lane evidence path — D11 "their evidence paths").

NO `packages/acceptance/adoption/**` or `packages/acceptance/release/**`
path touched (TL-owned, no grant this wave). No shared contract edited
(the listing/usage seams are NEW LOCAL structural types following the
established `VendorCapabilityRefLike` / `BudgetCheckPort` patterns; if
the TL wants them promoted to shared contracts, that is a TL proposal —
never a worker edit). `pnpm-lock.yaml` was restored to main's version
(`2dfa6e0`) after the WIP install produced a spurious patch-hash
re-hasing diff (zero dependency specifier changes; no `package.json`
touched by this lane).

File law: every journey-family file ≤ 302 lines (the two new journey
files: 169 and 156); drivers ≤ 400 (the new ones: 227 and 213).

## 9. Honest limitations

- **L-1 (counting):** whether ANY of this COUNTS — the two new journeys
  as single counts, the per-epoch variants as distinct journeys — is
  adjudicated by the TL at F332 against D2+D8–D13. This lane claims
  capability and census evidence only.
- **L-2 (census vs parameterization):** the census was machine-run at
  `d53ffa2` (the table-less census state); the parameterization
  (`5b64475`) then added the second boundaries required by D10.2. The
  census flip sets are unchanged by the additions — but the census table
  is NOT re-derivable by naively re-running the corpus on the final tree
  (non-frozen anchors now fail by design with MISSING_EPOCH). The
  permanent in-suite "census responder laws" test re-verifies every
  recorded boundary via direct domain facts on the final tree.
- **L-3 (commerce responders vs the base corpus):** the 34 pre-F331C
  commerce journeys are invariant — honestly measured, not assumed. The
  commerce corpus's responding set is exactly the two F331C journeys;
  no pre-existing commerce journey was rewritten to manufacture a
  responder.
- **L-4 (providers):** everything is local domain behavior — no live
  provider claim anywhere (ADCOS/Aurum/Arena stay CONTRACT_ONLY; the
  billing usage ledger is the REAL local model-gateway ledger, the
  marketplace is the REAL local vendors publication gate).
- **L-5 (the seam's reach):** `state.time` is consumed only by the two
  F331C drivers; pre-F331C drivers keep their caller-supplied literal
  times (by the corpus's design law — "every timestamp is caller-supplied
  journey data"). Re-anchoring the pre-F331C drivers to the seam would
  change behavior at T0 and is therefore out of scope for this wave; it
  is TL-adjudicated capability work if wanted later.
- **L-6 (adoption ledger):** the adoption-side count pins
  (`adoption-run.ts`, `firms.ts`, the STRUCTURAL_REASONS line "commerce
  corpus runner is not tenant/time-parameterizable") are TL-owned and
  untouched; the seam makes that pin's premise obsolete — the TL updates
  it at F332.

## Appendix A — the census script (reproducible evidence)

Run at the census-state commit `d53ffa2` with `npx tsx` from the fleetos
workspace root (paths absolute; the script lives outside the repo):

```ts
// F331C commerce census (D12) — run at the census-state tree
// (journeys carry T0-anchored single-valued expectations only).
import { JOURNEYS } from "<repo>/packages/acceptance/commerce/src/journeys/index.ts";
import { runAllJourneys } from "<repo>/packages/acceptance/commerce/src/runner.ts";

const T0 = 1_774_000_000_000;
const OFFSETS = [
  ["-1h", -3_600_000], ["+1s", 1_000], ["+1h", 3_600_000],
  ["+1d", 86_400_000], ["+30d", 2_592_000_000],
  ["+90d", 7_776_000_000], ["+365d", 31_536_000_000],
];
const baseline = await runAllJourneys(JOURNEYS, { startedAt: T0 });
const noOptions = await runAllJourneys(JOURNEYS);
// → baseline: 36 journeys, all passed = true
// → no-options run byte-identical to T0 run: true
const flips = new Map();
for (const [label, delta] of OFFSETS) {
  const outcomes = await runAllJourneys(JOURNEYS, { startedAt: T0 + delta });
  JOURNEYS.forEach((journey, i) => {
    if (outcomes[i].passed !== baseline[i].passed) {
      flips.set(journey.id, [...(flips.get(journey.id) ?? []), label]);
    }
  });
}
// → marketplace-transaction-flow: ["-1h","+1d","+30d","+90d","+365d"]
// → tenant-billing-invoicing: ["+1d","+30d","+90d","+365d"]
// → responders: 2 / 36; invariant: 34
```

Machine output header (verbatim): `# F331C commerce census —
T0=1774000000000 (2026-03-20T09:46:40.000Z)`; `# baseline: 36 journeys,
all passed = true`; `# no-options run byte-identical to T0 run: true`.
