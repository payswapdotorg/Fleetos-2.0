# 03 — Procurement Spine (route `procurement-spine`, path `/commerce/procurement`)

**Machine-verified reference:** `procure-spine`, `quote-scoring`,
`vendor-management` and `tenant-fail-closed` journeys (corpus) plus the
`host-surface` journey (F300C corpus) — the readings below are their
machine-verified actuals.

**Seeding (TL composition, real state only):** need `need-1`
("Temperature-logged transport for depot rotation", tags cold-chain +
gps) → demand `demand-1` (solicited with acme-owned evidence) → quote
`q-h1` from vendor `ven-1` (10_00 unit / 100_00 total, submitted); vendor
lifecycle record `ven-1` (Northwind Logistics) with exposure ledger
(limit 500_000, committed 0); composed quote-scoring inputs for demand-1
(one quote at 1_000 unit / 10_000 total minor, lead time 3 days).

## Steps

| # | Action | Expected (machine-verified) |
| --- | --- | --- |
| 1 | Open `/commerce/procurement` | The Procurement Spine renders the lineage board: need → demand → quote cards with parent links (demand→need-1, quote→demand-1) |
| 2 | Inspect the spine counts | quote status line `submitted:1`; superseded quotes list is empty (no revision yet) |
| 3 | Inspect the vendor KPI rollup | `ven-1`: quotesSubmitted 1, acceptanceBps 0 (no decided outcome yet — honest zero, not an error), exposure limit 500_000 minor with committed 0 |
| 4 | Inspect quote scoring | The composed sheet ranks `q-h1` rank 1 with the domain's deterministic scoring + recorded tie-break rules; when the TL composed NO scoring inputs the bundle carries `quote-scoring:caller-composed` (an explicit not-composed marker, never a fabricated ranking) |
| 5 | Look for the honest limitation markers | The route declares `read-as-of:logical-time`, `intent-execution:not-at-lane`, `quote-scoring:caller-composed` AND `external-adapters:contract-only` — the lane's external connectors are deterministic reference adapters, NOT live connectivity |
| 6 | Trigger "Approve quote" as procurement-lead | An inert `CommandDraft` of kind `procurement.approve-quote`, capability REQUEST `procurement.quote.approve`, idempotency key `host:procurement.approve-quote:q-h1` (subject-derived) — Guardian adjudicates, nothing self-authorizes |
| 7 | Trigger "Place order" as procurement-lead | An inert `CommandDraft` of kind `procurement.place-order` with the vendor + integer minor-unit total — same laws |

## Refusals to verify (fail-closed)

- Awarding with cross-tenant evidence: the domain refuses
  `EVIDENCE_TENANT_MISMATCH` — visible refusal, never a silent award.
- A foreign-tenant quote inside the slice: the spine AND vendor-KPI
  assemblies refuse with `TENANT_MISMATCH` naming the record
  (`q-foreign` in the machine-run) while the bundle context itself stays
  owned — per-assembly verbatim refusals.
- Non-integer money at the view boundary: the spine refuses
  `MONEY_MUST_BE_INTEGER_MINOR` — never rounds.
- The "Place order" affordance for a finance-controller role lens: not
  offered (`intent-not-offered-to-role`).

## Record

URL, deployed commit, screenshots of steps 2–7, refusal renderings.
