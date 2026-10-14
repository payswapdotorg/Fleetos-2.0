# F361C — the marketplace supplier/catalogue/request/order contract (Worker C)

- **Work item:** F361C (`spec/work-items/WORK-ITEM-CATALOG.md`, Wave 17; the
  binding packet `docs/tech-lead/packets/f361c.md`; the frozen law
  `docs/product/MARKETPLACE-MVP-FREEZE.md` §1, §3.1–§3.4, §4, §5).
- **Worker:** C (session w17c). **Date:** 2026-10-14.
- **Base:** `203f077` (main HEAD at clone — the F362 packet commit on top of
  the F362-partial A+B convergence; the packet's expected base `cefd588` or
  newer, exactly as instructed). Branch `work/f361c`; the pushed tip SHA is
  in the FINAL REPORT (the repository is the source of truth).
- **Parallel-lane note honored:** F361A (assets receipt→enrollment) and
  F361B (policy/actions/evidence/security controls) are MERGED at this
  base; this lane touches ONLY `packages/procurement/**`,
  `packages/vendors/**`, `packages/work/**`,
  `packages/acceptance/commerce/**`, `docs/evidence/F361C/**` and the
  one-line catalog append. NO assets edits, NO policy/actions/evidence/
  security edits, NO industries.ts, NO adoption/release pins, NO
  field/security corpora.

## 1. The census (machine-measured FIRST at base `203f077`; grep proof)

The F354 lesson applied — the ids and op prefixes name THIS lane's
MARKETPLACE angle, and every candidate below was grepped at the base tree
BEFORE implementation (`rg` over the commerce/field/security corpora,
src + tests; the commands and the zero-match outputs are the proof):

| surface | grep at base `203f077` (all three corpora) | verdict |
|---|---|---|
| journey id `marketplace-request-lifecycle` | 0 matches (the only repo-wide hit: the f361c packet itself) | NEW — this lane owns it |
| journey id `marketplace-offer-freshness-discipline` | 0 matches (same) | NEW — this lane owns it |
| journey id `marketplace-supplier-verification-gate` | 0 matches (same) | NEW — this lane owns it |
| journey id `marketplace-order-ack-discipline` | 0 matches (same) | NEW — this lane owns it |
| op prefixes `mreq-` / `moff-` / `mver-` / `mord-` | 0 matches across `packages/acceptance/**` (existing prefixes: wo/pj/bp/hx/pr/quote/mtx/mre/pdir/qcmp/vkpi/pidem + the Wave-0 families) | NEW — this lane owns all four |
| symbols `EquipmentRequest` / `MarketplaceOffer` / `SupplierVerification` / `MarketplaceEquipmentOrder` / `MarketplaceOrderWorkLink` / `CatalogueEntry` (acceptance corpora AND the three domain packages' src) | 0 matches — the surface did not exist | NEW surface — this lane creates it |
| `submitEquipmentRequest` / `captureMarketplaceOffer` / `compareMarketplaceOffers` / `acknowledgeProviderOrder` / `supplierVerificationGate` / `importCatalogueBatch` / `linkMarketplaceOrderWork` / `serviceWorkAcceptanceGate` | 0 matches anywhere outside the packet | NEW surface |
| the string `provider-ack` (the shared B-lane seam vocabulary) | matches ONLY in B's owned lane: `packages/evidence/src/marketplace-evidence.ts` (B's artifact KIND `marketplace.provider-ack`) + B's security journey/tests | CONSUMED as the frozen reference vocabulary — this lane records the ack EVIDENCE REFERENCE on the ORDER side (a frozen TYPE, the existing `EvidenceRefLike`), never a shared file; the F362 adjudication re-runs the census at the merged tree |
| `compareQuotes` / `matchVendors` (the EXISTING kernels this lane composes) | already COVERED by the F351C journeys (qcmp-compare / pdir-match-vendors) | COMPOSED, never re-claimed: the F361C comparison drives them THROUGH the new `compareMarketplaceOffers` entry point with a different contract (hard-constraint vs preference separation + per-offer rationale) |

Post-work ownership proof (grep at the final tree): the four journey ids
appear in exactly three files each, ALL inside this lane's owned paths
(the f361c journey modules, `tests/f361c.test.ts`, plus the packet and
this evidence dir); each op prefix appears in exactly five commerce
files (contracts / driver / journey / runner / test). ZERO matches in
the field or security corpora.

## 2. The contract surface (REAL public domain APIs; file:line)

All new modules are exported through the owning packages' barrels
(one-line appends to `src/index.ts`); every function is pure,
deterministic (time is an explicit `number` input), tenant-scoped and
fail-closed, with machine-stable reason codes on every refusal.

### §3.1 The equipment request — `packages/procurement/src/marketplace-request.ts`

- `EquipmentRequestStatus` — the frozen 13-state machine: draft →
  submitted → resolving → offer_window_closed → comparing → selected →
  approval_requested → [approved | refused] → ordered →
  [fulfilled | cancelled | disputed] (`EQUIPMENT_REQUEST_ALLOWED` is the
  exported transition matrix; refused/fulfilled/cancelled/disputed are
  terminal).
- `submitEquipmentRequest` (:254) — the IDEMPOTENT create+submit keyed
  tenant+natural key: a content-identical replay returns the ORIGINAL
  request with `duplicate: true` (even when the replay names a different
  requestId); the same natural key with different content refuses
  `NATURAL_KEY_CONFLICT`.
- `transitionEquipmentRequest` (:146) — typed transitions with reason
  codes (`ILLEGAL_TRANSITION`, `REFUSE/CANCEL/DISPUTE_REASON_REQUIRED`,
  `SELECT_OFFER_ID_REQUIRED`); each accepted transition emits a typed
  append-only `EquipmentRequestEvent` (law A19).
- `findEquipmentRequest` (:306) — tenant fail-closed read;
  `buildEquipmentRequestBoard` (:327) — deterministic per-tenant summary.

### §3.2 The offer/quote — `packages/procurement/src/marketplace-offer.ts` + `marketplace-offer-comparison.ts`

- `MarketplaceOffer` — the full frozen schema: supplier id, SKU,
  quantity, unit+total cost (exact integer law), currency, tax, fees,
  delivery estimate, condition (`new | certified-refurbished | used`),
  warranty months, validity window (validFrom/validUntil), and **source
  reference + captured-at** — the source kinds are MANUAL-only
  (`operator-entered | manual-catalogue-export |
  supplier-message-reference`); a "live API" source kind is
  UNREPRESENTABLE in the type.
- `captureMarketplaceOffer` (offer.ts:138) — the full-schema validation
  battery (16 reason codes; the capture must sit INSIDE the validity
  window — `CAPTURE_AFTER_WINDOW_END` refuses a stale-on-arrival offer).
- `assessOfferFreshness` (:206) — **THE FRESHNESS LAW**: pure verdict
  over the validity window (`fresh | expired | not-yet-valid`; the
  boundary instant is inside, the repo's WINDOW LAW convention).
- `buildCurrentOfferSheet` (:243) — the freshness read model: ONLY fresh
  offers appear current; every exclusion is reported with its verdict;
  foreign-tenant offers refuse the whole sheet fail-closed.
- `compareMarketplaceOffers` (comparison.ts:176) — the composition of
  the EXISTING `compareQuotes` (commerce-math.ts) + `matchVendors`
  (matching.ts) kernels with HARD-CONSTRAINT vs PREFERENCE-WEIGHT
  separation: the five hard constraints (supplier verification, SKU,
  freshness, currency, condition) gate ELIGIBILITY ONLY — a weight can
  never rescue a failed hard constraint; the preference weights rank
  only the eligible set; every offer carries a per-offer explainable
  `MarketplaceOfferRationale` (hard-constraint report + rank +
  integer-bps decomposition + recorded tie-break + supplier match score
  + matched tags). The supplier verification records enter through the
  LOCAL structural `SupplierVerificationLike` seam (law A20 — the
  acceptance lane binds the REAL vendors records at the documented
  composition site). The warranty→service-level proxy
  (`SERVICE_WARRANTY_CAP_MONTHS = 36`) is the documented deterministic
  mapping.

### §3.3 Supplier verification — `packages/vendors/src/supplier-verification.ts` + `catalogue-import.ts`

- `SupplierVerificationStatus` — pending → verified | expired |
  suspended (`SUPPLIER_VERIFICATION_ALLOWED` exported; expired and
  suspended terminal).
- `transitionSupplierVerification` (:122) — verify REQUIRES same-tenant
  evidence + verified-at + a strictly-later expires-at
  (`VERIFICATION_EVIDENCE_REQUIRED`,
  `VERIFICATION_EVIDENCE_TENANT_MISMATCH`,
  `EXPIRY_BEFORE_VERIFICATION`); suspend requires a reason; the explicit
  expire refuses `NOT_EXPIRED_YET` before the lapse (never early).
- `supplierVerificationGate` (:225) + `isSupplierVerificationCurrent`
  (:211) — **VERIFIED-ONLY ENTER MATCHING**: only verified-AND-current
  suppliers are admitted; pending/suspended/lapsed suppliers are
  excluded WITH per-supplier reason codes; a foreign-tenant record
  refuses the whole gate fail-closed.
- `importCatalogueBatch` (catalogue-import.ts:144) — **the
  manually-operated, operator-reviewed catalogue import seam, PLAINLY
  LABELLED**: `MANUAL_CATALOGUE_IMPORT_LABEL` (:39) travels verbatim on
  every result and reads `"manual-operator-catalogue-import (NOT a live
  supplier API; source and freshness tracked per entry)"`; the source
  kinds are MANUAL-only (a live-API kind is UNREPRESENTABLE); every
  entry carries its import source (operator id + export id) and
  captured-at (operator-auditable provenance); one malformed or
  duplicate entry refuses the WHOLE batch with the per-entry report
  (never a partial import); entries are returned in deterministic
  supplier-then-SKU order.

### §3.4 The marketplace order — `packages/procurement/src/marketplace-equipment-order.ts` + `packages/work/src/marketplace-order-work.ts`

- `MarketplaceEquipmentOrderStatus` — the frozen 9-state machine: draft
  → placed (provider-ack pending) → acknowledged → shipped → received →
  accepted | discrepancy → disputed | returned
  (`EQUIPMENT_ORDER_ALLOWED` exported; accepted/disputed/returned
  terminal). Named to stay distinct from the F331C
  `MarketplaceOrder` listing-checkout machine (same package, different
  contract identity — law A16).
- `draftEquipmentMarketplaceOrder` (:139) — drafts from the §3.1
  approved request + §3.2 selected offer references with the exact
  integer money law (`TOTAL_MISMATCH`).
- `acknowledgeProviderOrder` (:309) — **the manual provider-ack seam**:
  the ack evidence reference (the frozen `EvidenceRefLike` type —
  screenshot/export/invoice number) is recorded through a MANUAL-only
  channel vocabulary (`manual-portal-export |
  manual-email-confirmation | manual-invoice-reference`; a live-API
  channel is UNREPRESENTABLE). IDEMPOTENT: re-presenting the SAME
  provider event id returns the acknowledged order with `duplicate:
  true` and the ORIGINAL evidence (never a second conclusion); a
  DIFFERENT provider event on an acknowledged order REFUSES
  `ALREADY_ACKNOWLEDGED` (duplicate provider events refused — mission
  §6); missing evidence or a foreign evidence tenant refuses with the
  exact codes.
- `transitionEquipmentMarketplaceOrder` (:230) — the non-ack §3.4
  transitions with reason codes; `findEquipmentMarketplaceOrder`
  (:357) fail-closed read; `buildEquipmentMarketplaceOrderBoard`
  (:380) deterministic summary with the ack-pending set.
- `linkMarketplaceOrderWork` (work.ts:95) / `detachMarketplaceOrderWork`
  (:148) — the order→work link over the REAL work items (LOCAL
  structural `MarketplaceOrderRefLike` seam): one live link per order,
  non-terminal same-tenant work items only, detach requires a reason.
- `serviceWorkAcceptanceGate` (work.ts:186) — **the §3.4 accept
  composition**: for a repair-service link the marketplace order may be
  accepted ONLY when the linked work item is `done`
  (`WORK_NOT_COMPLETED` otherwise) — the acceptance lane composes BOTH
  REAL packages through this gate (the documented composition site);
  `buildMarketplaceOrderWorkBoard` (:229) — the deterministic
  projection carrying the accept-gate verdict per order.

## 3. The four commerce journeys (D14 form; the packet's named ids)

| journey id | persona | capability | steps | assertions | refusal paths asserted |
|---|---|---:|---:|---:|---|
| `marketplace-request-lifecycle` | procurement-lead | marketplace-requests | 18 | 27 | NATURAL_KEY_CONFLICT (drifted natural-key content), ILLEGAL_TRANSITION ×2 (order-before-approval, terminal re-transition), REFUSE_REASON_REQUIRED, CANCEL_REASON_REQUIRED, cross-tenant read returns NOTHING |
| `marketplace-offer-freshness-discipline` | procurement-lead | marketplace-offers | 15 | 29 | CAPTURE_AFTER_WINDOW_END, SOURCE_REFERENCE_REQUIRED, TOTAL_MISMATCH, TENANT_MISMATCH ×2 (foreign verification record refuses the comparison; foreign offer refuses the sheet — fail-closed), WEIGHTS_MUST_SUM_TO_10000; THE FRESHNESS LAW asserted (the lapsed sheet is EMPTY; the expired offer is a hard-constraint failure no weight rescues) |
| `marketplace-supplier-verification-gate` | vendor-manager | marketplace-suppliers | 20 | 29 | VERIFICATION_EVIDENCE_REQUIRED, VERIFICATION_EVIDENCE_TENANT_MISMATCH, SUSPEND_REASON_REQUIRED, NOT_EXPIRED_YET, ILLEGAL_TRANSITION (expired is terminal), DUPLICATE_CATALOGUE_ENTRY, ENTRY_VALIDATION_FAILED, OPERATOR_ID_REQUIRED, cross-tenant read returns NOTHING |
| `marketplace-order-ack-discipline` | operations-manager | marketplace-fulfilment | 25 | 39 | ILLEGAL_TRANSITION ×3 (ship from draft, ship before ack, terminal after accepted), ACK_EVIDENCE_REFERENCE_REQUIRED, ACK_EVIDENCE_TENANT_MISMATCH, ALREADY_ACKNOWLEDGED (the different provider event), WORK_NOT_COMPLETED (the composed accept gate, then the gate opens and the accept passes), cross-tenant read returns NOTHING |

Machine-verified totals: **78 steps / 124 assertions** across the four;
every journey ≥5 assertions with ≥1 asserted refusal (the refusal
counts above are the assertions whose descriptions carry the refusal
law; the logs pin every refusal verbatim). All ids unique; personas
from the fixed 7-persona vocabulary; the capability vocabulary gains 4
new values (`marketplace-requests`, `marketplace-offers`,
`marketplace-suppliers`, `marketplace-fulfilment`,
journey-contracts.ts).

**Corpus growth (grow-only):** the commerce barrel 41 → 45
(`journeys/index.ts`, machine-counted by `tests/corpus.test.ts` and
`tests/f361c.test.ts`); the corpus-shape laws, the assembly check, the
required-capability set and the report capability-count pin all updated
in place (the F351C/F331C precedent for grow-only count pins). The
pre-existing 41 journeys re-run byte-identically (the full-corpus
canonical-JSON rerun is pinned in `tests/f361c.test.ts`).

## 4. The verification battery (machine-run at this tree; exact numbers)

| suite | base | delivered | delta |
|---|---:|---:|---:|
| `pnpm --filter @fleetos/procurement test` | 136 | **171** | +35 (three new test files) |
| `pnpm --filter @fleetos/vendors test` | 94 | **108** | +14 |
| `pnpm --filter @fleetos/work test` | 72 | **80** | +8 |
| `pnpm --filter @fleetos/acceptance-commerce test` | 133 | **153** | +20 (the `tests/f361c.test.ts` battery; 8 files green) |

- `typecheck` (tsc --noEmit) **exit 0** on all four packages; `oxlint`
  **0 warnings / 0 errors** on all four packages.
- **Determinism:** same-journey reruns byte-identical (digest + facts
  canonical-JSON equality); the four-journey set reruns byte-identical;
  the FULL 45-journey corpus reruns byte-identically — all machine-pinned
  in `tests/f361c.test.ts`. Single-epoch law (D13): no F361C journey
  carries an epoch table and none consumes the run anchor — invariant
  at every census offset (−1h, +1s, +1h, +1d, +30d, +90d, +365d); the
  epoch-count ledger is unchanged (the 2 census-certified responders
  only).
- **Tenant fail-closed reads** asserted in every journey that reads
  (`mreq.read.foreign`, `mver.read.foreign`, `mord.read.foreign` →
  NOTHING; the foreign-input sheet/comparison refusals → TENANT_MISMATCH).
- **File law:** every NEW file ≤ 400 lines (max 398 —
  marketplace-equipment-order.ts; measured with `wc -l`, the
  block-comment-aware `scripts/count-lines.sh` convention).
- **Boundary:** `git diff --name-only main...HEAD` lists exactly 31
  paths, ALL inside `packages/procurement/**`,
  `packages/vendors/**`, `packages/work/**`,
  `packages/acceptance/commerce/**` (+ the evidence dir and the catalog
  one-liner on the records commit) — NO industries.ts, NO assets, NO
  policy/actions/evidence/security, NO field/security corpora, NO
  adoption/release pins, NO lockfile motion (zero new dependencies).

## 5. Honest limitations

- **Nothing here is live.** The catalogue import and the provider-ack
  are MANUALLY-OPERATED, operator-reviewed seams, PLAINLY LABELLED —
  the label travels verbatim on every catalogue result and the ack
  channel vocabulary makes a live-API kind unrepresentable. The
  live-pilot gate stays BLOCKED on F369 (real supplier/customer
  acquisition) per the freeze §1; this lane delivers contract-backed,
  locally machine-tested mechanics only.
- **The F361B composition is structural, not runtime.** The provider-ack
  evidence reference and the supplier verification records use the
  frozen LOCAL structural types (`EvidenceRefLike` /
  `SupplierVerificationLike`); B's evidence-retention package and this
  lane's order/verification machines bind at the acceptance composition
  site (the journeys), never by cross-package imports (law A20). The
  F362 TL convergence adjudicates the merged-tree census.
- **The warranty→service-level proxy is a documented approximation.**
  The frozen offer schema carries no service metric, so the composed
  `matchVendors` service level is `min(warrantyMonths, 36) / 36` —
  deterministic and recorded, but a proxy nonetheless.
- **No persistence.** Per the freeze §4, F361 delivers types +
  deterministic domain logic + tests only; PostgreSQL persistence is
  F362+ work. The in-memory populations live in the acceptance drivers'
  per-run WeakMaps (never authoritative truth, law A1).
- **Rental/lease and payments are NOT implemented** (contract states
  only, per the freeze §1/§8); the money boundary stays order +
  invoice-record + manual settlement marking.
- **Adoption/release pins are honestly stale for the F362 TL re-pin**
  (the packet forbids worker re-pins); the commerce corpus arithmetic
  (41 → 45) is the lane-local grow-only number — the TL computes the
  converged ledger at F362.
