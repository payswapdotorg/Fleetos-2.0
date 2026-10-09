# F280C — Worker C (Work + Commerce) Commerce / SLA / Marketplace / Production-Economics Hardening Evidence

- **Work item:** F280C — Commerce, SLA, vendor marketplace, production economics (Wave 8 lane C; catalog: `spec/work-items/WORK-ITEM-CATALOG.md`)
- **Owner:** Worker C (work-and-commerce)
- **Base commit:** `fb13b94` ("TL: dispatch packets for Wave 8 — production hardening lanes F280A/B/C"); branch `work/f280c` created from `origin/main` HEAD (verified `git log --oneline -1` before checkout)
- **Branch:** `work/f280c`
- **Date:** 2026-10-09
- **Inherited WIP:** none — clean lane; all work below is net-new this session.

## 1. Owned paths touched

Per `spec/worker-ownership.yaml` (worker-c grants):

- `packages/vendors/**` — NEW `src/sla.ts` (SLA contract math), NEW `src/marketplace.ts` (listing publication/revocation cascade/search), `src/index.ts` (+2 export lines), NEW tests `tests/sla.test.ts`, `tests/marketplace.test.ts`.
- `packages/procurement/**` — NEW `src/sla-credit.ts` (SLA penalty credits on orders), NEW `src/cost-allocation.ts` (work-order cost allocation + partial-fulfillment sum laws), NEW `src/reconciliation-batch.ts` (batched reconciliation at volume), `src/index.ts` (+3 export lines), NEW tests `tests/economics.test.ts`, `tests/reconciliation-batch.test.ts`.
- `packages/model-gateway/**` — NEW `src/burn-projection.ts` (budget-burn projections), NEW `src/cost-comparison.ts` (provider cost-model comparison in bps), `src/index.ts` (+2 export lines), NEW test `tests/economics.test.ts`.
- `packages/software/**` — NEW `src/renewal-windows.ts` (renewal sweeps with grace + seat-burn projection), NEW `src/seat-allocation.ts` (batch seat-overage refusals), `src/index.ts` (+2 export lines), NEW test `tests/renewal-seat-hardening.test.ts`.
- `docs/evidence/F280C/**` (this report).

`git status` at commit time shows exactly these four package trees + this evidence path; `pnpm-lock.yaml` byte-identical to HEAD (install matched, left untouched). No spec edits, no other lane's path touched. No new runtime dependencies.

## 2. Baselines — machine-run BEFORE first edit, re-verified AFTER last edit

All fourteen suites (twelve lane packages + the two Wave-7 acceptance baselines), before any edit and again after the last edit. Untouched packages byte-identical counts; commerce 65 and adoption 90 (incl. the commerce corpus) GREEN both times — **no regressions**:

```text
BEFORE: work 72  projects 63  workloads 69  procurement 94  vendors 56  software 62
        agent-organizations 182  model-gateway 81  external-vendors 51  apify 68
        aurum 61  work-commerce 49  |  acceptance/commerce 65  acceptance/adoption 90
AFTER:  work 72  projects 63  workloads 69  procurement 123 vendors 94  software 79
        agent-organizations 182  model-gateway 98  external-vendors 51  apify 68
        aurum 61  work-commerce 49  |  acceptance/commerce 65  acceptance/adoption 90
```

## 3. Deliverables (all pure deterministic TS; logical `now`/caller-supplied inputs everywhere)

### 3.1 SLA contract math — `vendors/src/sla.ts` + `procurement/src/sla-credit.ts`

- **Definitions are DATA**: `SlaDefinition` = availability target (bps) + response-time bands (`{bandId, maxLatenessMs, penaltyBps}` strictly ascending) + credit cap (bps) + inclusive effective window — validated structurally (`validateSlaDefinition`, 11 reason codes), zero behavior.
- **Evaluation over the REAL fulfillment/order history**: `evaluateSla(tenant, definition, FulfillmentOutcomeRecord[], now)` — the same record the KPI rollups consume. Documented laws: AVAILABILITY = fill-rate (`floor(receivedTotal*10000/orderedTotal)` — deliberately distinct from response time: on-time-but-short-shipped is an availability miss, not a breach); a BREACH is `deliveredAt > promisedAt`, banded by the first band covering the lateness (terminal band is the catch-all); penalty = Σ breach penaltyBps capped at `creditCapBps` with `capApplied` recorded honestly; window filters by `promisedAt` inclusively. Every breach carries EXACT evidence: `{orderId, bandId, latenessMs, penaltyBps, promisedAt, deliveredAt}`. Tamper-evident FNV-1a evaluation digest.
- **Scorecards are never recomputed**: `buildSlaScorecard(tenant, evaluation)` accepts ONLY an `SlaEvaluation` value (no overload takes history — structurally impossible to recompute); every number copied verbatim; the breach evidence array reused **BY REFERENCE** (machine-tested with reference identity).
- **`applySlaPenaltyCredit`** (procurement): posts an evaluation's penalty to an order's economics — `min(floor(value×penaltyBps/10000), floor(value×capBps/10000))`, integer floor law documented; the credit traces to the evaluation digest; cross-tenant penalty application refused.

### 3.2 Vendor marketplace hardening — `vendors/src/marketplace.ts`

- **Publication gate**: a listing publishes ONLY when EVERY claimed tag is a `verified` capability record of this vendor+tenant; claimed-but-unverified refuses the ENTIRE publication with a per-claim report (`CAPABILITY_UNVERIFIED` / `CAPABILITY_UNKNOWN`) — never a partial publish. Honest exclusions carried verbatim.
- **Delisting cascade (machine-checked)**: `applyRevocationCascade` delists EXACTLY the published listings whose claims intersect the revoked set — set-equality tested both directions (revoking an unclaimed tag delists nothing); delist reason records the revoked tags sorted; already-delisted listings keep their reason.
- **Search determinism**: results ordered by (vendorId, listingId) lexical — the recorded total order; permuted input → identical output (tested); delisted listings NEVER match.

### 3.3 Production economics — `model-gateway/src/burn-projection.ts`, `model-gateway/src/cost-comparison.ts`, `procurement/src/cost-allocation.ts`

- **Budget-burn projections**: `projectBudgetBurn(tenantId, REAL usage ledger, burn schedule, {ceiling, threshold})` — actuals are the ledger's own sums WITH entry-seq refs (traceable); projections add schedule points with running cumulative totals; every point MUST carry a non-empty assumption (`ASSUMPTION_EMPTY` refusal — uncertainty is mandatory, never hidden); output marked `projection: true` with assumptions verbatim; severity law (none/warning/breach vs ceiling + threshold bps) documented and boundary-tested.
- **Cost allocation across work orders**: `allocateCostAcrossWorkOrders` — integer bps weights MUST sum to exactly 10000 (never normalized); largest-remainder allocation law with lexical tie-break recorded in the output; Σ allocations == total EXACTLY (tested on awkward thirds). Partial-fulfillment law: `allocatePartialFulfillmentAmounts` rows sum EXACTLY to the order total; `verifyPartialFulfillmentSums` refuses ANY drift with the exact signed drift.
- **Provider cost-model comparisons in bps**: `compareProviderCosts(tenantId, quotes, REAL usage ledger)` — presents BOTH sources verbatim: the quotes as passed (`quotesVerbatim`) and real per-provider usage sums with entry seqs; `deltaBps = floor((usageCost−quoteCost)×10000/quoteCost)` (quote-zero case flagged honestly, no division by zero); ledger providers without a quote listed as `unquotedProviders` — never silently dropped; deterministic providerId-lexical ordering.

### 3.4 Reconciliation at volume — `procurement/src/reconciliation-batch.ts`

`reconcileOrdersBatched` — orders processed in orderId LEXICAL order (input order never leaks — permuted-input test), receipts grouped per order, contiguous bounded batches (batchSize ∈ [1,500], documented bound), each order reconciled by the REAL `reconcileOrderTotals` law — machine-tested that batched output is IDENTICAL to order-by-order application; a receipt for an unknown order refuses the whole run (`RECEIPT_ORDER_MISMATCH`); per-order refusals propagate (`RECONCILIATION_REFUSED`) — partial results never returned.

### 3.5 Entitlement compliance hardening — `software/src/renewal-windows.ts`, `software/src/seat-allocation.ts`

- **Renewal windows**: documented grace law — active while `now <= validUntil`; inGrace while `validUntil < now <= validUntil+graceMs`; expired after (aligned with `sweepExpiredSubscriptions`: expiry strictly after validUntil). Boundaries pinned by tests at exactly V, V+1, V+grace, V+grace+1. Unparseable dates refuse the sweep (never a guessed classification). `projectSeatUtilization`: seat-burn projection with EXACT overage (never clamped) + mandatory assumptions.
- **Seat-overage refusal semantics**: `allocateSeatsBatch` is ALL-OR-NOTHING — requests processed in requestId lexical order; the FIRST request whose running total exceeds `seatsTotal` refuses the ENTIRE batch with `SEAT_LIMIT_EXCEEDED` + exact `{capacitySeats, heldBefore, requestedTotal, overshootSeats, firstRefusedRequestId}`; the function applies no state, so nothing can ever be silently overbooked. Allocation respects the renewal window (`now > validUntil+graceMs` → `SUBSCRIPTION_EXPIRED`).

### 3.6 Tenant isolation hardening

Every NEW code path fails closed with explicit refusals (never silent filtering): foreign-tenant outcome/capability record/listing/share/partial row/receipt/ledger entry/grant/subscription → `TENANT_MISMATCH`; the scorecard reader, batch reconciliation run, burn projection, cost comparison, renewal sweep, and seat batch each refuse as a WHOLE. One or more cross-tenant probes per module — 14 dedicated tenant tests across the four new test files.

## 4. Machine-verified results (honest numbers)

```text
net-new tests: 101 (vendors +38 [sla 23, marketplace 15]; procurement +29 [economics 18, reconciliation-batch 11];
               model-gateway +17; software +17) — ≥ 60 required
touched-package totals: vendors 94/94  procurement 123/123  model-gateway 98/98  software 79/79
acceptance baselines re-verified: commerce 65/65, adoption 90/90 (incl. commerce corpus)
```

## 5. Machine-verified gates (exact, in each touched package dir)

```text
vendors:          test 4 files/94 tests passed | typecheck exit 0 | lint "Found 0 warnings and 0 errors"
procurement:      test 4 files/123 tests passed | typecheck exit 0 | lint "Found 0 warnings and 0 errors"
model-gateway:    test 6 files/98 tests passed | typecheck exit 0 | lint "Found 0 warnings and 0 errors"
software:         test 3 files/79 tests passed | typecheck exit 0 | lint "Found 0 warnings and 0 errors"
```

## 6. Boundary verification (machine-tested)

- **Import scan** over all new files → local module imports only (`./…js`); zero cross-package runtime imports in implementation — cross-context data crosses only as LOCAL structural seams (`SlaPenaltyRefLike` in procurement; `ProviderCostQuoteLike` in model-gateway), per the repo's seam convention.
- **Determinism sweep** → CLEAN (no `Date.now`, `Math.random`, `new Date(`, timers, `fetch`); logical `now`/`publishedAt`/`sweptAt`/`evaluatedAt` caller-supplied; the only date parsing is `Date.parse` of caller-supplied ISO strings (the existing package convention).
- **File law** → all new source files pass oxlint `max-lines 400` (skipBlankLines+skipComments); largest raw file `sla.ts` 417 lines incl. 60+ doc lines.
- **`git status`** → exactly the four owned package trees + `docs/evidence/F280C/**`; `pnpm-lock.yaml` byte-identical to HEAD; no spec edits.

## 7. Contract deltas / seams for TL adjudication

1. **SLA history seam**: `evaluateSla` consumes `FulfillmentOutcomeRecord` (the vendors-side fulfillment history — the same record the KPI rollups and acceptance journeys drive). The procurement→vendors outcome projection today lives at composition sites (acceptance/commerce drivers); if SLA evaluation is wired into an experience, TL should adjudicate a canonical projection seam.
2. **Structural seams (cross-context law)**: `SlaPenaltyRefLike` (procurement) and `ProviderCostQuoteLike` (model-gateway) are LOCAL structural shapes — the TL binds REAL vendors SLA evaluations / REAL vendor quotes at composition sites; neither package imports the other at runtime.
3. **Renewal grace law**: the grace window `(validUntil, validUntil+graceMs]` is NEW documented semantics aligned with the existing sweep (expiry strictly after validUntil); `allocateSeatsBatch` shares the same law via its `graceMs` parameter. Decision recorded in-module headers per the decision protocol.
4. **Availability definition**: fill-rate (documented in `sla.ts`) — chosen so availability misses are distinct from response-time breaches; recorded as an in-module decision.
5. No shared contracts modified; all additions are additive exports in worker-c-owned packages.

## 8. Residual limitations (honest list)

1. SLA evaluation, burn projections, and comparisons run over caller-supplied REAL records (pure functions, no persistence) — the composing application owns record retrieval.
2. Provider comparison models quotes as flat per-unit rates (no tiered/committed-volume pricing) — the quote-implied cost of consumed units vs actual spend; documented in the module law.
3. Batch reconciliation is bounded [1,500] with contiguous batches; no pagination (pure projection over the input slice).
4. `allocateSeatsBatch` returns the allocation DECISION (deterministic steps); grant construction stays with the caller — the function cannot partially apply, which is the no-silent-overbook proof.
5. Digests are FNV-1a 32-bit (the lane convention, evidence-grade — not crypto).
6. Root gates (full `pnpm -r test`, `architecture:check`, `snapshot:check`) NOT run — per packet, TL merge-time.
7. `sla.ts` is 417 raw lines but ≤ 400 counted lines under the configured oxlint rule (lint green proves it); noted for the file-law record.

## 9. Verification commands for TL re-run

```bash
cd <repo checkout> && git checkout work/f280c
corepack pnpm install --prefer-offline --ignore-scripts
for p in vendors procurement model-gateway software; do (cd packages/$p && corepack pnpm run test && corepack pnpm run typecheck && corepack pnpm run lint); done
# baselines (unmodified + acceptance):
for p in work projects workloads agent-organizations integrations/vendors integrations/apify integrations/aurum experiences/work-commerce acceptance/commerce acceptance/adoption; do (cd packages/$p && corepack pnpm run test); done
rg -n "Date\.now|Math\.random|new Date\(|fetch\(" packages/vendors/src/sla.ts packages/vendors/src/marketplace.ts packages/procurement/src/sla-credit.ts packages/procurement/src/cost-allocation.ts packages/procurement/src/reconciliation-batch.ts packages/model-gateway/src/burn-projection.ts packages/model-gateway/src/cost-comparison.ts packages/software/src/renewal-windows.ts packages/software/src/seat-allocation.ts || echo CLEAN
```
