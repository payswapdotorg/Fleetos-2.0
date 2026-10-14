# FleetOS product mission — the neutral operating network for company IT equipment

**Status:** Canonical product-intent brief for future product work.  
**Authority:** This document defines the intended product outcome; it does not mark any capability as implemented. Architecture, security, persistence, worker ownership, and evidence laws in the source-of-truth documents remain binding.

## 1. Product goal

Build FleetOS into the **neutral operating and transaction network for company IT equipment and its lifecycle** — an “Uber for company IT equipment” in the sense that an organization can state a need and FleetOS can connect it to qualified available supply or service, coordinate the transaction, and keep the equipment operational afterward.

The product must be more than an IT asset inventory dashboard or a managed-device reseller. It should connect companies, distributors, local suppliers, refurbishers, rental/leasing companies, repair technicians, logistics providers, and end-of-life/recovery partners through a provider-neutral workflow.

The customer should have one operational interface for:
- discovering, buying, renting, leasing, repairing, replacing, recovering, redeploying, reselling, or responsibly retiring equipment;
- comparing eligible supply against price, availability, lead time, condition, warranty, service coverage, quality, and SLA;
- governing consequential decisions according to company policy;
- recording what was requested, offered, approved, supplied, received, configured, serviced, returned, and retired;
- relating that lifecycle record to the actual managed asset/device and later health, maintenance, security, and workload decisions.

**No “Uber-scale” claim is permitted until live-marketplace and fulfilment evidence demonstrates it.** The phrase describes the destination, not the current product state.

## 2. Main participants and role lenses

Role-specific UI must be backed by shared business truth; changing roles changes permitted actions and views, not the underlying asset/order records.

- **Requester / employee:** request equipment or service, follow status, acknowledge receipt, report a problem, return equipment.
- **IT / fleet administrator:** define standards, assign assets, verify enrollment and posture, manage replacements and lifecycle.
- **Procurement:** collect and compare quotes, select approved offers, enforce purchasing limits, manage supplier relationships.
- **Finance / approver:** review total cost, budgets, purchase/rental/lease terms, invoices and reconciliation.
- **Security / compliance:** enforce policy, review data handling, approve consequential actions, verify sanitization and disposition.
- **Field technician / service operator:** diagnose, schedule and execute maintenance/repair, record parts, labour, evidence and outcome.
- **Supplier / reseller / lessor / repair partner:** maintain a verified profile, service area, catalogue, stock/availability, prices/terms, SLAs, quotes, order status, delivery and service evidence.
- **FleetOS operator / marketplace trust role:** verify providers and claims, investigate disputes or fraud, monitor service quality, manage capability and integration health.

The same user may hold multiple roles. Tenant isolation, authorization, audit, least privilege, and Guardian's authority rules apply throughout.

## 3. The core marketplace and lifecycle loop

The first end-to-end live pilot must prove this sequence, not just each page in isolation:

1. **Capture a real need.** Identify equipment/service category, quantity, destination, required-by date, minimum technical/security standards, budget, purchase vs rental/lease preference, and relevant existing assets.
2. **Resolve and verify supply.** Discover eligible providers and relevant offers. Record provider identity/status, geographic/service coverage, actual availability and its timestamp/source, item condition, full landed cost, taxes/fees, delivery estimate, warranty, returns, support, SLA, and quote expiration. Expired or unverified supply must not silently appear as current.
3. **Match and compare.** Explain which offers qualify and why. Rank using declared, auditable factors such as fit, total cost, availability, lead time, reliability, warranty and policy compliance. Distinguish hard eligibility constraints from preference scores; show trade-offs instead of hiding them behind an opaque score.
4. **Approve under policy.** Collect competing quotes where the market supports it; preserve the offers and selection rationale; apply budget, security, procurement and role rules. Agents/models may recommend or prepare an action, but cannot authorize their own consequential action or bypass Guardian.
5. **Place and track the transaction.** Record purchase, rental, lease, repair or service order; provider confirmation; agreed price/terms; due dates; shipment/dispatch milestones; exceptions; cancellation/return/refund/dispute states where supported. Never show “ordered”, “shipped”, “paid”, or “complete” without a source event or verified provider response.
6. **Receive and verify.** Record receiving evidence, serial number/asset tag, condition, accessories, destination, warranty, assigned user/site, and discrepancies. For devices, run the defined enrollment/setup checks. Only then link the fulfilled item to the authoritative FleetOS asset/device record.
7. **Operate and service.** Connect the asset to observation, health, maintenance, repair, recovery, security, software and workload fit flows as real inputs become available. Recommendations stay advisory until authorized and evidence-verified.
8. **Recover and recirculate.** Support return, retrieval, loaner/replacement, redeployment, refurbishment/resale, certified data sanitization and recycling/disposition. Keep a traceable custody/lifecycle history and update inventory/availability only when the corresponding event is verified.
9. **Learn from outcomes.** Measure delivery/repair SLA, quote responsiveness, accepted/rejected delivery, repeat service quality, cost vs baseline, exceptions and supplier reliability. Predictions may only be called accurate when evaluated against real, versioned outcomes.

## 4. Initial market scope

Start with **one named geographic market and a deliberately small, verifiable pilot**, not a global-coverage claim. The TL must select the first market and categories based on access to real customers and suppliers, ability to fulfil, regulatory/tax/logistics realities, and available integration methods; document the rationale in the F360 product freeze packet.

Pilot categories should cover at least:
- end-user computing (laptops/desktops and/or phones); and
- one operational equipment category such as printers/photocopiers or networking equipment.

The pilot must include at least one real business customer and real, independently verifiable suppliers. Where feasible, collect at least two competing offers per request; where not feasible, show that only one qualified offer exists and do not invent competition. The pilot may use manual supplier operations or operator-reviewed catalogue imports as an explicitly labelled first adapter, but must preserve source, freshness, audit and reconciliation rules.

Do not block this provider-neutral pilot on Aurum, ADCOS, or Arena: those integrations remain `CONTRACT_ONLY` until independent readiness evidence exists. Do not claim a supplier integration, payment, shipping event, telemetry feed, authentication scheme or external provider is live based on fixtures, local contract tests or architecture alone.

## 5. Required business objects and audit trail

F360 must reconcile these concepts against existing bounded contexts before adding new contracts or duplicate state:
- organization/tenant, sites/locations, actors, roles and policy;
- equipment taxonomy, specifications/compatibility requirements, asset identity/serials and lifecycle;
- supplier profile, verification status, service area, catalogue item/SKU, stock/availability snapshot and freshness;
- request/demand, RFQ, offer/quote, comparison and selection rationale;
- approval decision and policy/evidence references;
- purchase/rental/lease/service/repair order, agreed line items/terms, state transitions, provider references and idempotency keys;
- shipment/dispatch, delivery/receipt, acceptance/discrepancy, return/refund/dispute where the chosen pilot supports them;
- invoice/payment status only to the level supported by the selected payment/accounting integration;
- warranty, support/repair case, loaner, retrieval, sanitization, reuse, resale and disposition;
- immutable lifecycle events, evidence/artifacts, audit trail, integration health and reconciliation status.

Do not automatically create a second source of business truth. PostgreSQL/domain persistence remains the intended authoritative business store under the Architecture Lock. The current F351A JSONL service is a scoped release qualification for command/audit/enrollment records; it is not blanket approval to use JSONL files as the marketplace's production transaction database. Any new authoritative persistence or payment/settlement design must follow the repository's explicit decision gate and architecture laws.

## 6. Trust, privacy, and transaction laws

- Verify suppliers and claims to a level appropriate for the pilot; distinguish verified, pending, expired and suspended states.
- Tenant isolation must be enforced at server/domain boundaries, never only by filtering the UI.
- Provider credentials/secrets never enter browser bundles or logs.
- Every write and consequential state transition is authenticated, authorized, idempotent, auditable, tenant-scoped and traceable to a source/evidence reference.
- Model/agent recommendations are advisory. Guardian remains the sole consequential-action authority; require confirmation where the risk policy says so.
- Prices, currency, tax/fees, shipping, condition, stock freshness, quote expiry, delivery/service dates, warranties and limitations are explicit. No silent omission or invented values.
- External events are untrusted until validated and reconciled. Retries and duplicate webhooks must not duplicate orders, charges, assets or audit conclusions.
- Payment collection, escrow, credit, financing and regulated services are out of scope until the TL chooses a compliant real provider and records the required risk/legal review. A prototype must not simulate money movement as if it happened.
- A delivery, repair, recovery or sanitization outcome needs evidence; dispatching a command or updating a UI status is not proof of fulfilment.

## 7. Product differentiation to test, not assume

The intended advantage is a **neutral, multi-supplier equipment-and-service operating layer** with:
- competition and transparent trade-offs across providers instead of dependence on a single managed reseller;
- purchase, rental, lease, repair, replacement, reuse and resale in the same lifecycle record;
- integration of procurement decisions with real asset identity, health, maintenance, security and workload needs;
- supplier-neutral public contracts/adapters and explainable policy-governed automation;
- local supply and service coverage, including smaller suppliers, proven market by market;
- evidence-backed decisions and measurable outcomes instead of opaque automation.

Competitors already offer substantial procurement and lifecycle services. Similar screens, contracts or local simulations are not sufficient differentiation. The pilot must demonstrate at least one customer outcome that matters: faster fulfilment, lower total cost, more qualified supply, better service SLA, less equipment idle time, greater reuse/recovery, or less administrative work.

## 8. Pilot acceptance gate

The initial live-marketplace milestone is not complete until the TL can link evidence proving the following on one exact candidate deployment:
1. A real customer creates a request through the product.
2. At least one real supplier offer is source-verified; competition is collected when available and a single-offer exception is honestly represented.
3. A permitted user reviews the trade-offs and approval/policy path.
4. A real order or service commitment is placed with a supplier outside the local fixture-only domain; actual provider acknowledgement or direct, independently verified fulfilment evidence is captured.
5. Delivery/service is fulfilled and accepted or a real failure/exception is traced through the product.
6. For equipment, receiving evidence creates or updates the authoritative asset record without duplicate enrollment; serial/tag and custody are verified.
7. Audit/evidence survives restart and tenant-scope tests; the deployment has real authentication and server-side authorization (unlike the current demo actor-shape validation).
8. The main UI supports the complete role-specific journey, including loading, empty, stale, refused, unavailable, duplicate, failed and recovery states.
9. A clean deployment/build plus architecture, typecheck, lint, relevant and full acceptance tests pass at the exact SHA; secret handling and operational recovery are checked.
10. The report includes real measured values: quote response time, request-to-decision time, fill rate, on-time delivery or repair completion, price/cost baseline, exception/dispute rate and user/supplier feedback. Mark any unavailable metric as not yet measured.

Evidence must distinguish **fixture**, **contract-tested**, **sandbox-connected**, and **live verified**. A work item is not complete on code existence, an all-green local test, a mocked provider, or a screenshot alone.

## 9. Roadmap order

1. Finish Wave 16 honestly: integrate and TL-converge F351B then F353; integrate and TL-converge F351C then F354. Maintain grow-only journey counts and existing-mask integrity; preserve known standing release qualifications.
2. F360: TL-owned product/transaction contract freeze. Reconcile this mission with existing bounded contexts and dependency graph; choose pilot market/categories/customer/supplier access; define typed state transitions, ownership, storage, idempotency, role/Guardian rules, provider contract and end-to-end acceptance. No speculative implementation before contracts freeze.
3. F361A/B/C: three disjoint worker lanes under frozen contracts — A asset/device receiving and lifecycle link; B Guardian/security/evidence/trust controls; C supplier, catalogue, availability, RFQ/quote, procurement and fulfilment domain. TL owns shared contracts, UI shell, infrastructure and cross-lane composition.
4. F362: TL convergence of the real-request → offer(s) → approved commitment/order → fulfilment/receipt → asset enrollment path, including provider-neutral integration seams and exact-tree acceptance. Update architecture/dependency snapshots if needed.
5. F370: production pilot hardening — authoritative persistent transaction state, authentication/tenant authorization, supplier verification and operational procedures, secrets, observability, incident/reconciliation handling, deployment and rollback.
6. F371: live pilot acceptance with a real customer and suppliers, measurable outcomes, and a release disposition. Do not make multi-region or global claims until each market's supply/fulfilment coverage is evidenced.

These are roadmap identifiers and exit conditions; F360 must create the detailed, scoped worker packets and freeze provider/storage/security decisions before F361 dispatch. Future item numbers do not imply implementation has started.
