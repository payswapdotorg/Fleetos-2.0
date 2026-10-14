# F360 — TL equipment-marketplace product/transaction contract freeze

- **Work item:** F360 (packet `docs/tech-lead/packets/f360.md`; Wave-17 opener).
- **Owner:** TL. **Date:** 2026-10-14. **Candidate:** this push's HEAD
  (docs-only tree over the F354 battery tree `1033be5`).
- **Prerequisite met:** F354 Wave-16 convergence complete (`1033be5`;
  records `a039b26`; CI green at `673cdaa`, F354 run dispatched).

## 1. Decisions (the freeze record)

- **Freeze document:** `docs/product/MARKETPLACE-MVP-FREEZE.md` — pilot
  scope, existing-owner reconciliation (NO new bounded context), the six
  frozen state machines (request/offer/supplier-verification/order/
  receipt→enrollment/approval+evidence), persistence/identity/money laws,
  the F361 dispatch plan with frozen owned paths, the acceptance design,
  and the exclusions.
- **Market intent:** Ghana (Accra metro). **Live-pilot gate honestly
  BLOCKED** — no real business-customer or independently verifiable
  supplier access is evidenced in the repository; per the packet §3 and
  mission §4 this is recorded as the blocker (F369 acquisition work in
  the catalog) rather than pretended by fixtures.
- **Categories:** laptops (end-user computing) + printers (operational).
- **Money boundary:** order + invoice-record + manual-settlement marking
  only; no payment/escrow simulation.
- **Persistence:** PostgreSQL/domain per Architecture Lock — F361 adds
  types + deterministic domain logic + tests only; no new store.
- **Provider seams:** manually-operated, plainly-labelled catalogue import
  + manual provider-ack evidence — never claimed as live APIs.

## 2. Files inspected (the reconciliation basis)

`spec/worker-ownership.yaml` (the ownership grants), the bounded contexts
(`packages/{assets,identity,tenancy,security,policy,actions,evidence,
control-plane,work,projects,workloads,procurement,vendors}` contract
surfaces), `spec/ARCHITECTURE-LOCK.md`, `spec/BOUNDED-CONTEXTS.md`,
`spec/DEPENDENCY-GRAPH.md`, the F351B/F351C lane surfaces (the
pr.match/pr.order-create + pdir-quote/order-create public APIs — the
shared procurement surface the F354 collision adjudicated), and the
Wave-14/16 corpus laws (D14–D17).

## 3. Worker packets authored (standalone, disjoint)

- `docs/tech-lead/packets/f361a.md` — Worker A: receipt→enrollment
  contract + duplicate serial guard (assets + field corpus).
- `docs/tech-lead/packets/f361b.md` — Worker B: Guardian approval +
  evidence retention + fail-closed security (policy/actions/evidence/
  security + security corpus).
- `docs/tech-lead/packets/f361c.md` — Worker C: request/offer/supplier/
  order chain + the manual seams (procurement/vendors/work + commerce
  corpus).
- The F354 lesson is embedded in all three packets: journey ids must name
  the lane's angle; census proof re-runs at integration against the
  merged tree.

## 4. Rejected alternatives

- A new `marketplace` bounded context — rejected: duplicate truth risk;
  the existing owners (§2 of the freeze) cover every concept.
- JSONL marketplace transaction store (extending F351A's service) —
  rejected: the Architecture Lock names PostgreSQL/domain persistence;
  F351A is a scoped operational qualification only.
- Rental/lease implementation in F361 — rejected: contract states
  recorded, implementation deferred (smallest-pilot law).
- Waiting for real supplier access before any F361 work — rejected: the
  contract freeze + locally-tested mechanics are independently valuable
  and unblock instant pilot execution the moment access is evidenced;
  the live-pilot gate itself stays BLOCKED and honestly labelled.

## 5. Honest blockers

- **F369 (new):** real business-customer + independently verifiable
  supplier acquisition in the Ghana market — the live-pilot unblocker.
  Until then every F361/F362 result is fixture/contract-tested, never
  "live". No partner names, availability or commercial terms invented.
