# F220C — Worker C (Work + Commerce) Wave 2 Completion Evidence

- **Work item:** F220C — Workloads/Projects/Procurement/Vendors/Software composition (Wave 2 lane C)
- **Owner:** Worker C (Work + Commerce)
- **Base commit:** `2407ea1` (dispatch tip — Wave 2 remainder dispatch; main @ `279f176` merged Wave 0 + Wave 1 + F220A + F211 + F230A)
- **Branch:** `work/f220c`
- **Date:** 2026-10-07

## 1. Owned paths touched

Per `spec/worker-ownership.yaml` (worker-c) — scoped to this work item's
five packages only (`packages/work/**`, agent-organizations, model-gateway
and the integration adapters are later dispatches, per the packet's
non-goals):

- `packages/workloads/**` — new `src/allocation-lifecycle.ts`, new
  `tests/allocation-lifecycle.test.ts`, `src/index.ts` +1 export line
- `packages/projects/**` — new `src/stages.ts`, new `src/accounting.ts`,
  new `tests/stages-accounting.test.ts`, `src/index.ts` +2 export lines
- `packages/procurement/**` — new `src/flow.ts`, new
  `src/commerce-math.ts`, new `tests/flow-commerce.test.ts`,
  `src/index.ts` +2 export lines
- `packages/vendors/**` — new `src/vendor-lifecycle.ts`, new
  `src/capability-catalog.ts`, new `tests/vendor-lifecycle.test.ts`,
  `src/index.ts` +2 export lines
- `packages/software/**` — new `src/entitlement-grants.ts`, new
  `tests/entitlement-grants.test.ts`, `src/index.ts` +1 export line
- `docs/evidence/F220C/**` (granted carve-out)

No file outside the above paths was modified. `git status` at commit
time shows exactly 18 files (+4706/-0) plus this evidence file. No spec
edits, no snapshot regen, no root files, no `pnpm-lock.yaml` mutation
(verified clean in `git status` before commit). All exports are
ADDITIVE — every Wave 1 public shape is unchanged (the five
`src/index.ts` files only gained `export * from "./<new-module>.js"`
lines).

## 2. What became operational-truth grade

Wave 1 (F210C) shipped kernel-grade state machines, feasibility checks,
supersession discipline and in-memory directories. Wave 2 (F220C) makes
the commerce lane OPERATIONAL: end-to-end document flows with approval
gates at every consequential boundary, allocation lifecycles with
deterministic capacity accounting, append-only ledgers with chained
audit digests, integer basis-point decision math with recorded
tie-breaks, idempotency at document-creation boundaries, and honest
breach/compliance reporting. `docs/evidence/F220A/report.md` §2 was the
depth bar; every module below follows its pattern: pure deterministic
TypeScript, typed refusal codes on every illegal path, tenant
fail-closed reads, time as an explicit `number` input, integer money.

### 2.1 `packages/workloads` — the allocation engine at truth grade

- **Allocation lifecycle** (`src/allocation-lifecycle.ts`):
  proposed → committed → active → released/retired with a
  legal-transition table and machine-stable rejections
  (`ILLEGAL_TRANSITION`, `RELEASE_REASON_REQUIRED`,
  `RETIRE_REASON_REQUIRED`, `NEGATIVE_UNITS`, `TENANT_SCOPE_MISSING`).
  Transitions never mutate the input record; a stable FNV-1a digest
  (`computeAllocationDigest`) covers the record (law A19).
- **Deterministic capacity accounting**
  (`applyLifecycleToLedger`): commit reserves exactly the record's
  units; committed→active is reservation-neutral (no double counting);
  release/retire restores EXACTLY the reserved units (allocate/release
  round-trip invariant); over-commit is REFUSED with the exact
  overshoot — never clamped (`EXCEEDS_CAPACITY` + overshootUnits);
  releasing a reservation the ledger does not hold is refused
  (`NOT_RESERVED`); tenant/owner mismatches fail closed
  (`TENANT_MISMATCH` / `OWNER_MISMATCH`).
- **Scheduling windows**: `validateWindow` enforces start < end
  (`START_NOT_BEFORE_END`); `detectWindowOverlaps` flags overlaps only
  within the same (tenant, owner), touching boundaries do NOT overlap,
  and identical ranges tie-break lexically by window id with the rule
  recorded on every overlap (`tieBreakRule: "window-id-lexical"`).
  Output is deterministically sorted regardless of input order.
- **Idempotent demand application** (`applyDemandIdempotent`): same
  demand key + same payload → unchanged ledger with `duplicate: true`
  (never double-commits); same key + different payload → typed
  `IDEMPOTENCY_KEY_CONFLICT`; new keys accumulate under the capacity
  invariant; over-capacity refuses with the exact overshoot.

### 2.2 `packages/projects` — project lifecycle + accounting at truth grade

- **Stage gates** (`src/stages.ts`): planned → in_progress → closed
  state machine. A stage CANNOT close with open mandatory checkpoints —
  the refusal carries the exact open checkpoint ids
  (`OPEN_MANDATORY_CHECKPOINTS`); optional checkpoints never block.
  `completeStageCheckpoint` refuses unknown checkpoints, double
  completion and mutation of closed stages. Transitions record
  `updatedAt` and never mutate inputs.
- **Budget envelope + actuals ledger** (`src/accounting.ts`): an
  append-only ledger with ledger-assigned sequence numbers and CHAINED
  audit digests (`computeEntryDigest` links each entry to its
  predecessor; `verifyLedgerChain` recomputes the chain and reports
  `CHAIN_BROKEN` with the earliest broken seq). Integer minor-unit
  money only (`ZERO_AMOUNT`, `NON_INTEGER_AMOUNT` refusals).
  `computeBudgetPosition` produces deterministic breach detection with
  severity: `warning` at ≥ 9000 bps utilization (integer, floored),
  `breach` with the exact breach amount above the limit. Tenant/project
  mismatches fail closed.
- **Archival rules + tenant fail-closed reads**: `archiveProject`
  refuses non-terminal projects (`PROJECT_NOT_TERMINAL`) and double
  archival (`ALREADY_ARCHIVED`) while remaining tenant-scoped;
  `readProjectForTenant` returns null for both unknown and
  other-tenant projects (no existence leak).

### 2.3 `packages/procurement` — the full procure-to-receive flow

- **Need → Demand → Quote → Order flow with approval gates**
  (`src/flow.ts`): `DemandFlowRecord` walks draft → solicited → awarded
  → closed/cancelled. The Demand→Quote boundary (solicit) and the
  Quote→Order boundary (award) are APPROVAL GATES requiring an external
  `GuardianDecisionRefLike` with `authorized=true` AND a same-tenant
  `EvidenceRefLike` (laws A5/A13 — procurement NEVER self-authorizes).
  Every refusal is typed: `AUTHORIZATION_REQUIRED`,
  `AUTHORIZATION_DENIED`, `EVIDENCE_REQUIRED`,
  `EVIDENCE_TENANT_MISMATCH`, `ILLEGAL_TRANSITION`,
  `CANCEL_REASON_REQUIRED`, `NEGATIVE_QUANTITY`.
- **Quote→Order gate** (`awardQuoteToOrder`): only a live SUBMITTED
  quote can be awarded; superseded quotes refuse with
  `QUOTE_SUPERSEDED`; draft/accepted/rejected/expired/withdrawn quotes
  refuse with `ILLEGAL_TRANSITION`. The created order carries the
  authorization (draft status, `fulfillmentVerified: false`).
- **Deterministic quote comparison** (`src/commerce-math.ts`,
  `compareQuotes`): integer basis-point scores on three axes — price
  (cheapest = 10000), terms/lead time (shortest = 10000), capability
  match (matched/required in bps) — combined with weights that MUST sum
  to exactly 10000 (`WEIGHTS_MUST_SUM_TO_10000`). NO FLOATS in decision
  outputs; all divisions floored. Tie-breaks are documented, applied in
  order, and RECORDED ON THE RANKED ENTRY: lower total cost → shorter
  lead time → earlier submission → vendor id lexical.
- **Order totals reconciliation** (`reconcileOrderTotals`): received vs
  ordered with multiple receipts summed, variance classified
  exact/short/over with the magnitude in integer bps of the ordered
  quantity; cross-tenant receipts and mismatched order ids fail closed.
- **Idempotent document creation** (`createDocumentIdempotent`):
  client-supplied request ids; same id + same digest returns the
  ORIGINAL document id with `duplicate: true`; same id + different
  digest refuses with `IDEMPOTENCY_KEY_CONFLICT`; empty ids/digests
  refuse with typed codes.

### 2.4 `packages/vendors` — vendor lifecycle + capability catalog

- **Vendor lifecycle with reinstatement rules**
  (`src/vendor-lifecycle.ts`): prospective → active → suspended →
  terminated. A suspended vendor may be REINSTATED to active with a
  reason (`reinstatementCount` increments); a TERMINATED vendor refuses
  every command with `TERMINAL_STATE` — no reinstatement from
  termination. Reason-required codes for suspend/terminate/reinstate.
- **Capability catalog** (`src/capability-catalog.ts`): declared vs
  verified capabilities — verification REQUIRES a same-tenant evidence
  ref (`VERIFICATION_EVIDENCE_REQUIRED`,
  `VERIFICATION_EVIDENCE_TENANT_MISMATCH`); a declaration is never
  silently promoted; double verification and unknown pairs refuse with
  typed codes. `capabilityCatalogSummary` is a deterministic
  tenant-scoped read model.
- **Performance KPI rollups**: `rollupVendorKpis` folds fulfillment
  outcomes into integer basis-point KPIs — on-time ratio
  (deliveredAt ≤ promisedAt) and fill rate — with
  `EMPTY_PERFORMANCE_HISTORY` and `NEGATIVE_QUANTITY` refusals, and
  tenant/vendor scoping.
- **Service relationships with exposure limits**: exposure may only be
  committed on an ACTIVE relationship (`RELATIONSHIP_NOT_ACTIVE`);
  over-limit commits refuse with the exact overshoot
  (`EXPOSURE_LIMIT_EXCEEDED`); releases restore exactly
  (`RELEASE_EXCEEDS_COMMITTED`).

### 2.5 `packages/software` — catalog + entitlements

- **Catalog version lifecycle** (`src/entitlement-grants.ts`):
  registered → deprecated → retired with `createCatalogEntry`
  validating MAJOR.MINOR.PATCH versions (`INVALID_VERSION`); retired is
  TERMINAL (`TERMINAL_STATE`); retiring from registered refuses
  (`ILLEGAL_TRANSITION` — must deprecate first).
- **Entitlement grant lifecycle**: granted → assigned → expired/revoked
  with the SEAT-COUNT INVARIANT enforced at the population level
  (`assignGrantWithinPopulation`): held seats (granted + assigned
  grants) may NEVER exceed seatsTotal — refusal carries the exact
  overshoot, never clamped (`SEATS_EXHAUSTED`). Expired/revoked grants
  release their seats (the invariant recovers). Assignment is refused
  on retired/deprecated catalog versions and on inactive/expired
  subscriptions. Revocation requires a reason.
- **License compliance checks** (`checkLicenseCompliance`):
  deterministic rule evaluation producing a violations list with typed
  codes — `CATALOG_RETIRED_IN_USE`, `CATALOG_DEPRECATED_IN_USE`,
  `SUBSCRIPTION_NOT_ACTIVE`, `SUBSCRIPTION_EXPIRED`,
  `OVER_ASSIGNED_SEATS` (exact overshoot in the detail) — plus exact
  seat counts. Pure projection; no input mutation.

## 3. Tests

| Package | Test files | Tests (total / new) | Status |
|---------|------------|---------------------|--------|
| `@fleetos/workloads` | `tests/workloads.test.ts`, `tests/allocation-lifecycle.test.ts` | 69 (27 + 42) | all passing |
| `@fleetos/projects` | `tests/projects.test.ts`, `tests/stages-accounting.test.ts` | 63 (30 + 33) | all passing |
| `@fleetos/procurement` | `tests/procurement.test.ts`, `tests/flow-commerce.test.ts` | 94 (44 + 50) | all passing |
| `@fleetos/vendors` | `tests/vendors.test.ts`, `tests/vendor-lifecycle.test.ts` | 56 (26 + 30) | all passing |
| `@fleetos/software` | `tests/software.test.ts`, `tests/entitlement-grants.test.ts` | 62 (24 + 38) | all passing |
| **Lane total** | | **344 (151 + 193)** | all passing |

Baseline (TL-measured at dispatch, machine-re-verified by me before any
edit): workloads 27 / projects 30 / procurement 44 / vendors 26 /
software 24 = 151. Net-new: **193 tests**, far above the ~70 target.
Every test asserts BEHAVIOR (rejection codes, transition legality,
accounting invariants, idempotency, determinism) — no shape-only tests.

### Test themes covered

- **Lifecycle legality + refusal codes**: every state machine
  (allocation, stage, demand-flow, vendor, catalog, grant) has its full
  legal path test plus parametrized illegal-transition tables asserting
  the exact reason code, including the richer terminal-state codes
  (`TERMINAL_STATE` for terminated vendors, retired catalog entries,
  expired/revoked grants — not a generic illegal-transition).
- **Approval gates**: the solicitation and award gates each refuse
  null/denied authorization, missing evidence, and cross-tenant
  evidence; the Quote→Order gate additionally refuses superseded and
  non-submitted quotes.
- **Accounting invariants**: allocate/release round-trip restores the
  ledger exactly; over-commit/over-assign/over-exposure refusals carry
  the exact overshoot (never clamped); ledger entries chain digests and
  tampering is detected at the earliest broken seq; credits reduce
  spend; breach severity thresholds are integer bps.
- **Idempotency**: same demand key → same ledger, no double-commit;
  same request id + digest → same document id (`duplicate: true`);
  conflicting payloads → typed conflicts. A property-style seeded loop
  (deterministic cycling units/keys, no randomness) asserts
  allocatedUnits always equals the sum of distinct applications and
  never exceeds capacity.
- **Determinism**: identical inputs → byte-identical outputs asserted
  for digests, rankings, reconciliation, KPI rollups, compliance
  reports, and overlap detection under input reordering.
- **Integer decision math**: bps scores/utilizations/variances asserted
  to be integers with exact floored values (e.g. 3333 for 1/3, 6666 for
  2/3); non-integer money amounts refused.
- **Tie-break recording**: quote ranking ties resolved by documented
  rules recorded on the ranked entry (lower-total-cost,
  shorter-lead-time, earlier-submission, vendor-id-lexical), including a
  constructed exact total-score tie between heterogeneous quotes.
- **Tenant fail-closed**: cross-tenant evidence, receipts, quotes,
  catalog entries, archival records and reads refuse or return null
  with no existence leaks.

## 4. Gate outputs (exact)

Per the packet, gates are `corepack pnpm run test` and
`corepack pnpm run typecheck` inside each package directory (the
root-level lint/typecheck/build/snapshot are TL gates — NOT run here).
Per-package `lint` (oxlint) was additionally run as a self-check.

### 4.1 `corepack pnpm run test` — PASS (344 lane tests)

```
=== workloads ===
 Test Files  2 passed (2)
      Tests  69 passed (69)
=== projects ===
 Test Files  2 passed (2)
      Tests  63 passed (63)
=== procurement ===
 Test Files  2 passed (2)
      Tests  94 passed (94)
=== vendors ===
 Test Files  2 passed (2)
      Tests  56 passed (56)
=== software ===
 Test Files  2 passed (2)
      Tests  62 passed (62)
```

### 4.2 `corepack pnpm run typecheck` — PASS (5/5, exit 0 each)

```
workloads TYPECHECK exit=0
projects TYPECHECK exit=0
procurement TYPECHECK exit=0
vendors TYPECHECK exit=0
software TYPECHECK exit=0
```

(`tsc -p tsconfig.json --noEmit` — no diagnostics emitted.)

### 4.3 Per-package `corepack pnpm run lint` (self-check) — 0 warnings / 0 errors in all five

```
=== workloads ===    Found 0 warnings and 0 errors.  (6 files)
=== projects ===     Found 0 warnings and 0 errors.  (9 files)
=== procurement ===  Found 0 warnings and 0 errors.  (10 files)
=== vendors ===      Found 0 warnings and 0 errors.  (7 files)
=== software ===     Found 0 warnings and 0 errors.  (6 files)
```

Four transient warnings introduced during implementation (unused
`QuoteId`/`Entitlement` imports, unused `at` parameters in
`transitionStage`/`expireGrant`) were fixed before commit by removing
the unused imports and recording transition timestamps
(`ProjectStage.updatedAt`, `EntitlementGrant.expiresAt` on expiry).

## 5. Boundary verification (machine-tested)

```text
$ grep -rEn "import .* from ['\"]@fleetos/" packages/{workloads,projects,procurement,vendors,software}/src
(no matches)  -> CLEAN: no @fleetos imports
$ grep -rEn "import .* from ['\"]@zcode/" packages/{workloads,projects,procurement,vendors,software}/src
(no matches)  -> CLEAN: no @zcode imports
```

Zero cross-worker `@fleetos/*` imports and zero `@zcode/*` substrate
imports across all five packages. Cross-context concepts remain LOCAL
structural types (`TenantScope`, `GuardianDecisionRefLike`,
`EvidenceRefLike`, `ServiceRelationshipStatus` references) — the frozen
Wave 0/1 seam pattern. `pnpm-lock.yaml` untouched (not in `git status`).

Scope check: `git status --short` at commit time lists exactly the 18
files under the five owned package paths (+4706/-0) plus
`docs/evidence/F220C/report.md`. No spec/, snapshot, root, or other
workers' paths touched.

## 6. Contract deltas / seams for TL adjudication

The Wave 1 contract surface is preserved — all Wave 1 exports are
unchanged; the additions are purely additive (new types, functions, and
one new local structural seam). No existing snapshot symbol was altered
(snapshot regen is a TL merge-time gate and was deliberately NOT run
here, per the packet).

1. **New local structural seam `EvidenceRefLike` in `@fleetos/vendors`
   and `@fleetos/software`** (`{ evidenceId, tenantId }` — same minimal
   shape as procurement/projects). These join the F210C seam inventory;
   the TL may converge all `EvidenceRefLike` definitions into the
   shared contracts at the next composition point, as already
   requested for the Wave 1 seams.

2. **Time representation duality (informational)**: the new Wave 2
   code takes time as an explicit epoch-`number` input per the
   work-item law. Two Wave 1 types that the new modules must consume
   carry ISO-string timestamps (`Subscription.validUntil`,
   `Quote.submittedAt`). The new code bridges deterministically
   (`Date.parse` on the existing fields — no wall clock, still
   replay-safe), but the TL may wish to schedule a string→number
   migration of those fields for uniformity.

3. **`ServiceRelationshipStatus` reuse**: the vendor exposure ledger
   keys its `RELATIONSHIP_NOT_ACTIVE` gate on the Wave 1
   `ServiceRelationshipStatus` type from `@fleetos/vendors`
   `contracts.ts` (in-package, no cross-import). If the TL formalizes a
   combined vendor-lifecycle + service-relationship record at F211+,
   the exposure ledger should attach to that unified record.

4. **`assignGrantWithinPopulation` vs `assignGrant`**: the single-grant
   variant enforces the trivial bound (a grant alone exceeding
   seatsTotal); the population variant enforces the real invariant with
   the exact overshoot. The composing application should prefer the
   population variant; if the TL prefers a single entry point, the
   single-grant variant can be deprecated at the next wave.

## 7. Residual limitations (honest list)

1. **No persistence, I/O, servers or daemons.** All new modules are
   pure functions over value types — the operational-truth grade here
   means complete typed flows + invariants + digests, not a running
   service. PostgreSQL adapters and the transactional outbox remain the
   TL's F211+ integration lane; the in-memory Wave 1 directories are
   untouched and still the only stateful reference adapters.

2. **Approval gates validate authorization refs structurally.** The
   gates enforce "an external `GuardianDecisionRefLike` with
   `authorized=true` + same-tenant evidence MUST be presented", but the
   authenticity of the referenced decision is Worker B's Guardian
   context — the seam pattern is identical to Wave 1 and converges at
   the TL's composition point. The kernel cannot and must not verify
   Guardian decisions itself.

3. **Digests are FNV-1a 32-bit, matching the repo's existing Wave 0/1
   convention** (`audit_`, `rebalance_`, `ledger_`, `alloc_`, `demand_`,
   `req_` prefixes). This is the established in-repo pattern (deterministic,
   no crypto dependency); a stronger hash would be a cross-cutting swap
   the TL would own.

4. **Quote scoring axes are price / lead time / capability-match** with
   fixed default weights (5000/2000/3000 bps). Richer vendor-risk or
   compliance-weighted scoring (e.g. consuming `rollupVendorKpis`
   output) is a natural Wave 3+ deepening; the seam is the
   `QuoteScoreInput` the application fills.

5. **Reconciliation covers quantity, not value.** `reconcileOrderTotals`
   classifies quantity variance with bps magnitude; value-based variance
   (quantity × unit cost, partial-credit rules) is not yet modeled.

6. **Wave 1 `transitionOrder`'s `AUTHORIZATION_TENANT_MISMATCH` code
   remains defined but unreachable in the Wave 1 function** (pre-existing
   — the code exists in the union type but no branch emits it). Not
   touched to avoid a non-additive change; flagged for the TL.

7. **`pnpm -r test` (full-suite) was NOT run** — per the packet's
   memory-constrained-box rule, gates were run per-package only
   (10 vitest invocations across 5 packages). The five packages are
   fully self-contained (zero cross-imports), so cross-package breakage
   is not possible from this change set, but the full-suite number is
   the TL's merge-time verification, not mine to claim.

## 8. Stop-the-line events

None. All five packages' test + typecheck gates passed on the first
final run; the only iteration was fixing 4 lint warnings and 2 test
assertions (a single-quote scoring self-referential mistake and a
mis-constructed tie-break case) during development, before any commit.

## 9. Verification commands for TL re-run

```bash
git fetch origin work/f220c:work/f220c
git checkout work/f220c
# boundary:
grep -rEn "import .* from ['\"]@fleetos/" packages/{workloads,projects,procurement,vendors,software}/src   # expect no matches
grep -rEn "import .* from ['\"]@zcode/"   packages/{workloads,projects,procurement,vendors,software}/src   # expect no matches
# gates (per package, per packet):
for p in workloads projects procurement vendors software; do
  (cd packages/$p && corepack pnpm run test && corepack pnpm run typecheck)
done
# expect: 69 / 63 / 94 / 56 / 62 tests (344 lane total), typecheck exit 0 x5
# optional self-check:
for p in workloads projects procurement vendors software; do
  (cd packages/$p && corepack pnpm run lint)   # expect 0 warnings / 0 errors each
done
```
