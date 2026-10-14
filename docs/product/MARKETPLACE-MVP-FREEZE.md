# Marketplace MVP Freeze — the F360 contract decision record

**Status:** FROZEN 2026-10-14 (F360, TL-owned). **Canonical mission:**
`docs/product/UBER-FOR-COMPANY-IT-EQUIPMENT.md`. This document freezes the
smallest real, auditable marketplace pilot and the F361 implementation
contracts. It marks nothing as implemented.

## 1. Pilot scope (the honest boundary)

- **Market intent:** Ghana (Accra metro first) — the operator's home market.
  **BLOCKED for live-pilot until substantiated:** no real business-customer
  or independently verifiable supplier access is evidenced in this
  repository today. Per the mission §4 and the F360 packet §3, the
  live-pilot gate is recorded as **BLOCKED on supplier/customer acquisition**
  (F369, below), not pretended by fixtures. The F361 lanes therefore deliver
  **contract-backed, locally machine-tested mechanics** — honestly labelled
  fixture/contract-tested, never "live".
- **Categories:** end-user computing (laptops) + one operational category
  (printers/photocopiers) per mission §4.
- **Transaction kinds in MVP:** purchase + repair-service (rental/lease
  recorded as follow-on states in the contract, not implemented in F361).
- **Money boundary:** order + invoice-record + manual-settlement marking
  ONLY. No payment, escrow, credit or financing simulation (mission §6).

## 2. Existing authoritative owners (reconciled — no duplicate truth)

| Concept | Authoritative owner (existing) | Marketplace use |
|---|---|---|
| Tenant/site/actor context | `packages/tenancy`, `packages/identity` | request context (unchanged) |
| Asset identity/serial/lifecycle | `packages/assets` (ManagedAsset/DeviceTwin) | receipt→asset enrollment (F361A extends, never duplicates) |
| Supplier profile | `packages/vendors` | verification states + service area (F361C extends) |
| Quote/order laws | `packages/procurement` (law-A5 createOrder, quote lifecycle) | RFQ→offer→order chain (F361C composes) |
| Guardian authority | `packages/policy`, `packages/actions`, `packages/execution` | approval of consequential orders (F361B) |
| Evidence/audit | `packages/evidence` | offer/fulfilment/receipt evidence retention (F361B) |
| Security/tenant isolation | `packages/security` | fail-closed tests (F361B) |

**No new bounded context is created.** The marketplace is a composition of
existing contexts; each extension lives in its owning package under
`spec/worker-ownership.yaml`.

## 3. Frozen state machines (typed, in the owning contexts)

### 3.1 Equipment request (F361C — `packages/procurement`)

```
EquipmentRequest: draft → submitted → resolving → offer_window_closed
  → comparing → selected → approval_requested → [approved | refused]
  → ordered → [fulfilled | cancelled | disputed]
```
- Typed transitions with reason codes; illegal-transition refusals are
  first-class (the F351C quote-lifecycle pattern).
- Idempotency: submit/create keyed by tenant+request natural key.

### 3.2 Offer/quote (F361C — `packages/procurement` + `vendors`)

```
Offer: draft → submitted → accepted(→order) | expired | withdrawn
```
- Schema: supplier id, SKU, unit+total cost, currency, tax/fees, delivery
  estimate, condition, warranty, validity window, **source reference +
  captured-at timestamp** (freshness law: expired offers never silently
  appear current — mission §3.2).
- Comparison: hard-eligibility constraints separated from preference
  weights; the comparison output carries an explainable per-offer
  rationale (the F351C `compareQuotes` pattern, extended).

### 3.3 Supplier verification (F361C — `packages/vendors`)

```
SupplierVerification: pending → verified | expired | suspended
```
- Verification evidence reference + verified-at + expires-at; verified-only
  suppliers enter offer matching. Pilot adapter: **manually-operated,
  operator-reviewed catalogue import** (plainly labelled, source/freshness
  tracked) — the mission §4 sanctioned first seam; NOT a live-API claim.

### 3.4 Order + fulfilment (F361C — `packages/procurement`/`work`)

```
MarketplaceOrder: draft → placed(provider-ack pending) → acknowledged
  → shipped → received → accepted | discrepancy → [disputed | returned]
```
- Provider ack: manual-verification seam records the acknowledgement
  evidence reference (screenshot/export/invoice number) — idempotent,
  duplicate-event-refusing (mission §6: external events untrusted until
  validated and reconciled).

### 3.5 Receipt → asset enrollment (F361A — `packages/assets`)

```
ReceiptEvidence: recorded → verified | discrepancy
AssetEnrollment: candidate → enrolled (links serial/tag + custody + warranty)
```
- Duplicate serial/asset guard (idempotent enrollment); the authoritative
  asset record updates ONLY on verified receipt (mission §3.6).

### 3.6 Approval + evidence controls (F361B — `policy`/`actions`/`evidence`/`security`)

- Guardian request for consequential orders with limit checks; advisory
  recommendations never self-authorize (existing law).
- Evidence retention for offer/ack/fulfilment/receipt artifacts with
  tenant-scoped, fail-closed reads; duplicate provider events refused.

## 4. Persistence, identity, security (the standing laws restated)

- PostgreSQL/domain persistence remains the authoritative business store
  (Architecture Lock). F361 adds **types + deterministic domain logic +
  tests** in the owning packages; no new persistence system, no JSONL
  marketplace store.
- Real authentication is F370 work; F361 keeps the shape/scope-validated
  actor convention and labels it honestly.
- Tenant isolation at domain boundaries (fail-closed reads); provider
  credentials never in bundles/logs; Aurum/ADCOS/Arena stay CONTRACT_ONLY.

## 5. F361 dispatch plan (three disjoint lanes + the F354 lesson)

| Lane | Owner | Owned paths (frozen) | Deliverable |
|---|---|---|---|
| F361A | Worker A | `packages/assets/**`, `packages/acceptance/field/**` (new journey files only), `docs/evidence/F361A/**` | receipt→enrollment contract + duplicate guard + field journeys |
| F361B | Worker B | `packages/policy/**`, `packages/actions/**`, `packages/evidence/**`, `packages/security/**`, `packages/acceptance/security/**`, `docs/evidence/F361B/**` | marketplace approval/evidence/trust controls + security journeys |
| F361C | Worker C | `packages/procurement/**`, `packages/vendors/**`, `packages/work/**`, `packages/acceptance/commerce/**`, `docs/evidence/F361C/**` | request/offer/order/supplier contracts + commerce journeys |

- Packets: `docs/tech-lead/packets/f361a.md`, `f361b.md`, `f361c.md`.
- **The F354 lesson is binding:** census/coverage proof re-runs at
  INTEGRATION against the merged tree; cross-corpus API overlap between
  parallel lanes is adjudicated by the TL at F362, never silently counted.
- Correlation ordering: A and C both touch the receipt chain through
  DIFFERENT packages (A: assets enrollment; C: order receipt state) — the
  shared seam (the receipt-evidence reference id) is a frozen TYPE in this
  document, not a shared file.

## 6. Acceptance design (the deterministic journey + the live protocol)

- **Deterministic local journey (F362 TL gate):** real need → seeded
  supplier catalogue → two offers → explainable comparison → Guardian
  approval → order placement (manual-ack seam) → receipt evidence → asset
  enrollment, all through REAL public domain APIs, fixture-labelled.
- **Live pilot protocol:** mission §8 verbatim (real customer request,
  source-verified offers, permitted-user approval, real order + provider
  ack evidence, delivery + acceptance, asset enrollment, restart-surviving
  audit, role-aware UI states, exact-SHA deployment, measured outcomes).
  **Gate status: BLOCKED** on F369 supplier/customer acquisition — honestly
  recorded, not simulated.

## 7. Wave 17 catalog (added by this freeze)

F360 (this freeze), F361A, F361B, F361C, F362 (TL convergence), F369
(supplier/customer acquisition — the live-pilot unblocker), F370
(hardening), F371 (live pilot acceptance).

## 8. Excluded from MVP (recorded, not judged impossible)

Payments/escrow/financing; rental/lease implementation (contract states
only); multi-region claims; automated supplier APIs; predictive
optimization claims; authenticated identity (F370); any "live" label
without independent evidence.
