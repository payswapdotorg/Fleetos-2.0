# F230C — Worker C (Work + Commerce) Wave 3 Completion Evidence

- **Work item:** F230C — Agent Organization + Model Gateway (Wave 3 lane C)
- **Owner:** Worker C (Work + Commerce)
- **Base commit:** `bb4ee6e` (dispatch tip — "TL: dispatch packets for F230B/F230C — Wave 3 lanes B/C dispatched to sandbox worker agents")
- **Branch:** `work/f230c` (worktree `/home/z/w-f230c`)
- **Date:** 2026-10-07
- **Packet:** `docs/tech-lead/packets/f230c.md`

## 1. Owned paths touched

Per `spec/worker-ownership.yaml` (worker-c), scoped to this work item's
two packages only:

- `packages/agent-organizations/**` — new `src/roles.ts`,
  `src/budgets.ts`, `src/org-config.ts`, `src/org-snapshots.ts`,
  `src/internal-digest.ts` (internal, not index-exported); new
  `tests/roles.test.ts`, `tests/budgets.test.ts`,
  `tests/org-config.test.ts`, `tests/org-snapshots.test.ts`;
  `src/index.ts` +4 export lines
- `packages/model-gateway/**` — new `src/registry.ts`, `src/routing.ts`,
  `src/providers.ts`, `src/usage.ts`, `src/quota.ts`,
  `src/internal-digest.ts` (internal, not index-exported); new
  `tests/registry-routing.test.ts`, `tests/providers.test.ts`,
  `tests/usage.test.ts`, `tests/quota.test.ts`; `src/index.ts` +5 export
  lines
- `docs/evidence/F230C/**` (granted carve-out)

No file outside the above paths was modified. `git status` at commit
time shows exactly 20 files under the two owned package paths plus this
evidence file. No spec edits, no snapshot regen, no root files, no
`pnpm-lock.yaml` mutation. All exports are ADDITIVE — every Wave 1
public shape is unchanged (the two `src/index.ts` files only gained
`export * from "./<new-module>.js"` lines); the three Wave 1 source
files (`contracts.ts`, `directory.ts`, `index.ts` bodies) are untouched.

## 2. What became operational-truth grade

Wave 1 (F210C) shipped the untrusted-actor kernel: budget ceilings with
AuthorizationRequest emission, provider-ordered fallback, quota
projection. F230C makes the two Intelligence-Plane contexts
ORGANIZATION-OPERATIONAL: full role-assignment lifecycles with the
N-concurrent-roles invariant, capability budgets with a
allocated→consumed→exhausted→replenished lifecycle and exact-overshoot
refusals, org configuration with team structure + policy CEILINGS
(ceilings, never authorizations — the AGENTS.md law), journal-folded
digest-stamped org snapshots, a validated model registry, deterministic
priority-ordered model routing with recorded tie-breaks, provider
fallback ladders with per-hop reason codes + degraded-mode
classification, an append-only chained usage ledger enforcing org
budgets through a TYPE seam, and logical-time quota windows. Every
module follows the F220C pattern: pure deterministic TypeScript, typed
refusal codes on every illegal path, fail-closed tenant scoping, time as
an explicit `number` input, integer minor units / bps.

### 2.1 `packages/agent-organizations` — the organization runtime

- **Agent roles** (`src/roles.ts`): role definitions carry capability
  ALLOW-LISTS + responsibility scopes with pure validation
  (`ROLE_ID_EMPTY`, `CAPABILITY_ALLOWLIST_EMPTY`, `CAPABILITY_DUPLICATED`
  with the duplicate as detail, `RESPONSIBILITY_DUPLICATED`). The
  role-assignment lifecycle is assigned → active → relieved with a
  machine-stable legal-transition table; relieved is TERMINAL
  (`TERMINAL_STATE`), illegal moves refuse (`ILLEGAL_TRANSITION`),
  relief requires a reason (`RELIEF_REASON_REQUIRED`), negative logical
  time refuses (`NEGATIVE_TIME`), transitions are pure (inputs never
  mutated) and digest-stamped (`assign_` FNV-1a). The INVARIANT "an
  agent holds at most N concurrent roles" is enforced at assignment with
  configurable ceiling and the exact counts on refusal
  (`MAX_CONCURRENT_ROLES_EXCEEDED`); relieved assignments do NOT count
  (the invariant recovers); a ceiling below 1 REFUSES rather than
  clamping; duplicate assignment ids and cross-tenant existing
  assignments refuse typed.
- **Capability budgets** (`src/budgets.ts`): per-role AND per-agent
  budget records (usage units + spend in integer minor units) with the
  lifecycle classified deterministically — `allocated` / `consumed` /
  `exhausted` (either axis at ceiling). Invariants: budgets are never
  negative-allocated, consumption NEVER exceeds allocation (record
  validation refuses `CONSUMPTION_EXCEEDS_ALLOCATION`), over-consumption
  refuses with the EXACT overshoot (`BUDGET_EXHAUSTED_UNITS` /
  `BUDGET_EXHAUSTED_SPEND` — never clamped, law A4). Replenishment
  RAISES the ceiling and bumps a generation while PRESERVING consumption
  (never a stealth reset); negative/non-integer replenishment refuses.
  `checkAgentBudget` is the cross-package seam (below). `budget_digest`
  + integer-bps utilization (floored) complete the module.
- **Organization configuration** (`src/org-config.ts`): org → teams →
  agents records with deterministic validation and reason codes —
  unique agents/teams/roles, team members must be declared agents
  (`UNKNOWN_TEAM_AGENT`), team size bounded by the org ceiling with the
  exact overshoot (`TEAM_SIZE_CEILING_EXCEEDED`), policy ceilings must
  be positive integers (`POLICY_MAX_CONCURRENT_ROLES_BELOW_ONE`,
  `POLICY_NEGATIVE_CEILING`, `NON_INTEGER_CEILING`). The membership
  lifecycle is pending → active → removed (removed terminal). Ceiling
  enforcement (`enforceMaxConcurrentRoles`, `enforceRoleBudgetCeiling`)
  answers successes with the explicit note
  `ceiling-satisfied-not-authorization` — the AGENTS.md law encoded in
  the return vocabulary: these functions VALIDATE or REFUSE, none
  GRANT; Guardian (worker B) remains the sole authority (A5/A6).
- **Org snapshots** (`src/org-snapshots.ts`): the org journal-fold
  pattern mirrored from `packages/mission/src/journal.ts` (the packet's
  exemplar): append-only entries with chained digests
  (`orgevt_` + `org_` genesis), `nextOrgEntry` builds the chain,
  `verifyOrgJournalChain` detects tampering/gaps/cross-tenant entries at
  the EARLIEST broken seq, and `foldOrgSnapshot` is a PURE fold —
  identical entries (in any array order; seq-sorted inside) produce a
  byte-identical snapshot including its `orgsnap_` digest. The snapshot
  folds teams (sorted deterministically), enrollment/removal,
  per-agent concurrent roles (activation is concurrency-neutral,
  relief decrements), relief counts and budget totals
  (allocated+replenished vs consumed).
  `readOrgSnapshotForTenant` is fail-closed (broken chain or other
  tenant → null, no existence leak).

### 2.2 `packages/model-gateway` — the routing + fallback runtime

- **Model registry** (`src/registry.ts`): model descriptors (id,
  providerId, capability tags, cost per unit in INTEGER minor units,
  context limit) with deterministic validation
  (`REGISTRY_EMPTY`, `MODEL_ID_DUPLICATED`, `CAPABILITY_TAGS_EMPTY`,
  `CAPABILITY_TAG_DUPLICATED`, `NEGATIVE_COST`, `NON_INTEGER_COST`,
  `NEGATIVE_CONTEXT`, `NON_INTEGER_CONTEXT`, `PROVIDER_ID_EMPTY`,
  `MODEL_ID_EMPTY`) and a deterministically sorted capability query.
- **Model routing** (`src/routing.ts`): pure `selectModel` over the
  registry — capability match filter (ALL required tags) → context
  filter → cost/budget filter (estimatedUnits × costPerUnitMinor ≤
  budget ceiling) → priority ordering. Ordering is deterministic and
  RECORDED: urgency ≤ 2 prefers capability-rich models
  (`urgency-richness-first`), urgency ≥ 3 prefers cheap
  (`urgency-cost-first`); ties break by model-id lexical and the rule is
  stamped on every decision. Refusals are typed with context:
  `NO_MODEL_WITH_CAPABILITIES` (+ the uncovered tags),
  `MODEL_CONTEXT_EXCEEDED` (+ smallest shortfall),
  `BUDGET_CEILING_EXCEEDED` (+ cheapest candidate and exact overshoot),
  plus precheck codes (`TENANT_ID_EMPTY`, `REQUIRED_CAPABILITIES_EMPTY`,
  `PRIORITY_OUT_OF_RANGE`, `BUDGET_CEILING_NEGATIVE`,
  `NON_INTEGER_AMOUNT`, `ESTIMATED_UNITS_NEGATIVE`) and
  `REGISTRY_INVALID` (with the registry's own code as detail). EVERY
  decision — success or refusal — carries an `mroute_` digest.
- **Provider fallback chains** (`src/providers.ts`): provider records
  (declared models + health) with typed validation; fallback ladder
  resolution over the declared chain order records a reason code at
  EVERY hop — `SELECTED`, `PROVIDER_DOWN`, `PROVIDER_MISSING_MODEL`,
  `UNKNOWN_PROVIDER`, `NOT_ATTEMPTED` (post-selection hops) — with
  `LADDER_EMPTY` / `NO_PROVIDER_CAN_SERVE` terminal refusals and an
  `mladder_` digest. Degraded mode is classified deterministically:
  `full` (all healthy) / `partial` (≥1 healthy, ≥1 not) /
  `emergency-only` (no healthy; `servingProviders` may honestly be 0
  when everything is down) with an `mdegrade_` digest.
- **Usage accounting** (`src/usage.ts`): an append-only usage ledger
  (request ref, model, provider, capability, units, integer minor-unit
  cost, timestamp as number input) with ledger-assigned seqs and
  CHAINED `usage_` digests; `verifyUsageLedgerChain` detects tampering
  at the earliest broken seq; `sumUsageLedger` totals deterministically.
  Budget enforcement against agent-organization budgets goes through
  `BudgetCheckPort` — a LOCAL structural TYPE seam (no runtime
  @fleetos import; the TL composes; see §6). Rules: the port's refusal
  propagates as `BUDGET_REFUSED_BY_ORG` with the org's reason code
  (never a silent drop, law A4); a duplicate requestRef refuses
  `DUPLICATE_REQUEST_REF` with the conflicting seq (retries never
  double-charge); cross-tenant appends refuse `TENANT_MISMATCH`;
  malformed entries refuse typed; the input ledger is never mutated.
- **Quota/rate enforcement** (`src/quota.ts`): deterministic quota
  windows on logical-time inputs — half-open `[start, end)` windows,
  request-count and unit quotas; exhaustion REFUSES with typed codes and
  the exact overshoot (`QUOTA_REQUESTS_EXHAUSTED`,
  `QUOTA_UNITS_EXHAUSTED`) and a refused request consumes NOTHING;
  out-of-window requests refuse `REQUEST_OUTSIDE_WINDOW`; window and
  policy validity refuse typed; `openQuotaWindow` / `nextWindowStart`
  are pure arithmetic; `quotaUtilizationBps` is integer bps, floored.

## 3. Tests

| Package | Test files | Tests (total / new) | Status |
|---------|------------|---------------------|--------|
| `@fleetos/agent-organizations` | `tests/agent-organizations.test.ts` (Wave 1), `tests/roles.test.ts`, `tests/budgets.test.ts`, `tests/org-config.test.ts`, `tests/org-snapshots.test.ts` | 107 (17 + 90) | all passing |
| `@fleetos/model-gateway` | `tests/model-gateway.test.ts` (Wave 1), `tests/registry-routing.test.ts`, `tests/providers.test.ts`, `tests/usage.test.ts`, `tests/quota.test.ts` | 81 (20 + 61) | all passing |
| **Lane total** | | **188 (37 + 151)** | all passing |

Baseline (TL-measured at dispatch, machine-re-verified by me before any
edit): agent-organizations 17 / model-gateway 20 = 37. Net-new:
**151 tests**, far above the ≥45 target. Every test asserts BEHAVIOR
(rejection codes, transition legality, invariants, idempotency,
determinism, exact overshoots) — no shape-only tests.

### Test themes covered

- **Lifecycle legality + refusal codes**: role assignments (assigned →
  active → relieved; TERMINAL_STATE on relieved; RELIEF_REASON_REQUIRED)
  and team memberships (pending → active → removed) each test the full
  legal path plus illegal-transition tables asserting the exact code;
  the legal-transition tables themselves are asserted exactly.
- **Invariants with exact overshoots**: the N-concurrent-roles invariant
  (refuses the N+1-th with current count + ceiling + "exact-overshoot-1";
  relieved assignments recover the budget; ceiling-below-1 refuses);
  consumption never exceeds allocation (record validation AND live
  consumption); quota request/unit exhaustion; budget ceiling / team
  size / role budget ceilings — all with the exact overshoot, never
  clamped.
- **Budget lifecycle**: allocated/consumed/exhausted classification on
  both axes; replenishment preserves consumption, bumps generation, and
  recovers an exhausted budget; negative replenishment refuses (never a
  stealth reset).
- **Ceilings are not authorizations**: both ceiling enforcers return
  the explicit `ceiling-satisfied-not-authorization` note on success —
  the AGENTS.md law is asserted in the tests, not just documented.
- **Journal fold + chain**: pristine chains verify; tampering detected
  at the EARLIEST broken seq (org journal AND usage ledger); seq gaps,
  cross-tenant entries, empty chains refuse typed; the fold is pure and
  order-insensitive (reversed input array → identical snapshot+digest);
  genesis/entry/snapshot digests are deterministic and sensitive.
- **Routing determinism**: capability→context→budget filter pipeline
  with typed refusals carrying missing capabilities, smallest context
  shortfall, cheapest candidate + overshoot; urgency-richness vs
  urgency-cost ordering; lexical tie-break recorded; identical inputs →
  byte-identical decisions; digests differ across outcomes.
- **Fallback ladder determinism**: primary-selected + NOT_ATTEMPTED
  tail; down→secondary with PROVIDER_DOWN at hop 1; missing-model and
  unknown-provider hops; all-fail refusal with per-hop reasons; degraded
  providers still serve; degraded-mode classification full / partial /
  emergency-only (including the honest all-down and empty cases).
- **Seam + idempotency + fail-closed**: the BudgetCheckPort test double
  proves refusal propagation (`BUDGET_REFUSED_BY_ORG` + the org's
  reason code); duplicate requestRefs refuse with the conflicting seq;
  cross-tenant ledger appends and snapshot reads refuse/return null with
  no existence leaks; `checkAgentBudget` refuses closed on absent AND
  ambiguous duplicate budgets (never a silent merge).
- **Integer math**: costs in minor units, utilization in floored bps
  (3333 for 1/3, 6666 for 2/3 asserted), non-integer amounts refused
  everywhere.

## 4. Gate outputs (exact)

Per the packet, gates are `corepack pnpm run test` and
`corepack pnpm run typecheck` inside each package directory (root-level
gates are TL gates — NOT run here, per the memory-constrained-box rule).
Per-package `lint` (oxlint) was additionally run as a self-check.

### 4.1 `corepack pnpm run test` — PASS (188 lane tests)

```
=== agent-organizations TEST ===
 Test Files  5 passed (5)
      Tests  107 passed (107)
=== model-gateway TEST ===
 Test Files  5 passed (5)
      Tests  81 passed (81)
```

### 4.2 `corepack pnpm run typecheck` — PASS (2/2, exit 0 each)

```
=== agent-organizations TYPECHECK ===
exit=0
=== model-gateway TYPECHECK ===
exit=0
```

(`tsc -p tsconfig.json --noEmit` — no diagnostics emitted.)

### 4.3 Per-package `corepack pnpm run lint` (self-check) — 0 warnings / 0 errors in both

```
=== agent-organizations ===  Found 0 warnings and 0 errors.  (13 files)
=== model-gateway ===        Found 0 warnings and 0 errors.  (14 files)
```

## 5. Boundary verification (machine-tested)

```text
$ rg -n "import .* from ['\"]@fleetos/" packages/agent-organizations/src packages/model-gateway/src
(no matches)  -> CLEAN: no @fleetos imports
$ rg -n "Date\.now\(|Math\.random\(|setInterval|setTimeout\(|fetch\(" packages/agent-organizations/src packages/model-gateway/src
(no matches)  -> CLEAN: no nondeterminism / network / timers in src
```

Zero cross-worker `@fleetos/*` imports (and zero `@zcode/*`) across both
packages. Cross-context concepts remain LOCAL structural types
(`TenantScope` per package as in Wave 1; the new `BudgetCheckPort` seam —
§6). `pnpm-lock.yaml` untouched (not in `git status`). Scope check:
`git status --short` at commit time lists exactly the 20 files under the
two owned package paths plus `docs/evidence/F230C/report.md`.

Known pre-existing (untouched, NOT introduced by this change): Wave 1
`packages/model-gateway/src/directory.ts` uses `new Date(0).toISOString()`
as a fixed epoch placeholder in two audit events — deterministic but
string-typed; flagged for the TL (same class as the F220C §6.2 note).

## 6. Contract deltas / seams for TL adjudication

The Wave 1 contract surface is preserved — all Wave 1 exports unchanged;
additions are purely additive (new modules + `export *` lines). No
existing snapshot symbol was altered (snapshot regen is a TL merge-time
gate and was deliberately NOT run here, per the packet).

1. **The `BudgetCheckPort` TYPE seam (model-gateway) ↔
   `checkAgentBudget` (agent-organizations).** The gateway's
   `BudgetCheckPort` declares the minimal structural shape
   `check({tenantId, agentId, capability, unitsRequested,
   spendRequestedMinor}) → {ok:true, remainingUnits,
   remainingSpendMinor} | {ok:false, reasonCode:string}`; the org
   package's `checkAgentBudget(records, query)` is structurally
   assignable to it (its refusal carries extra diagnostic fields +
   string-literal reason codes — assignable, not identical). This is the
   packet-specified composition point: the TL binds
   `checkAgentBudget` (or a persistence-backed adapter) to the port at
   the application composition site. The reason-code VOCABULARIES
   differ by design (org-side: `UNITS_EXHAUSTED`/`SPEND_EXHAUSTED`;
   gateway-side: opaque `string`) — the gateway propagates them
   verbatim in `budgetReasonCode`.

2. **Time representation duality (informational)**: all F230C code
   takes time as explicit epoch-`number` logical inputs. Wave 1 types
   still carry ISO-string timestamps (`proposedAt`, `occurredAt`,
   `hourStartedAt`). The new modules do NOT consume the Wave 1
   directory path, so no bridge was needed — but the TL may wish to
   schedule a string→number unification across the lane's Wave 1
   surface (same class as F220C §6.2).

3. **FNV-1a 32-bit digests (`assign_`, `budget_`, `orgevt_`, `orgsnap_`,
   `mroute_`, `mladder_`, `mdegrade_`, `usage_`)** follow the lane's
   established Wave 0/1 convention. The org journal-fold mirrors
   `packages/mission`'s journal PATTERN but cannot reuse its
   `digestOf` (kernel import forbidden in-lane) — the mission journal
   uses the kernel's digest, this lane uses FNV-1a. If the TL wants one
   hash convention for journals, that is a cross-cutting swap the TL
   owns.

4. **Priority ordering policy**: `selectModel`'s urgency threshold
   (≤2 richness-first, ≥3 cost-first) and the 1–5 integer priority range
   are F230C decisions recorded here per AGENTS.md's decision rule
   (smallest compliant decision, recorded). If the TL prefers a
   typed priority enum in shared contracts, `ModelSelectionRequest`
   is the seam to converge.

5. **Degraded-mode vocabulary**: three modes only (full / partial /
   emergency-only) per the packet; "all providers down" classifies as
   `emergency-only` with `servingProviders: 0` rather than inventing a
   fourth mode. If the TL wants an explicit `unavailable` mode, the
   `DegradedMode` union in `src/providers.ts` is the single point to
   extend.

## 7. Residual limitations (honest list)

1. **No persistence, I/O, servers or daemons.** All new modules are
   pure functions over value types — operational-truth grade here means
   complete typed flows + invariants + digests, not a running service.
   PostgreSQL adapters, the transactional outbox, and binding the
   BudgetCheckPort to a real org-budget store remain the TL's
   integration lane. The Wave 1 in-memory repository/directory adapters
   are untouched and still the only stateful reference adapters in both
   packages.

2. **The BudgetCheckPort is enforced with a test double in-lane.** The
   structural compatibility of `checkAgentBudget` with the port is
   proven by shape + in-package tests, but a REAL cross-context
   composition test (binding the actual org implementation) belongs to
   the TL's composition site — workers cannot import across contexts
   (A20 + worker-ownership rules).

3. **Role assignment / membership / journal writers are fold-adjacent,
   not yet a runtime.** The org journal fold consumes events, and
   `nextOrgEntry` builds chains, but there is no in-lane runtime that
   enforces transition legality BEFORE appending (the mission package's
   runtime plays that role there). The lifecycles in `roles.ts` /
   `org-config.ts` are the enforcement points today; wiring them into a
   journal-writing runtime is a natural TL/next-wave composition.

4. **Digests are FNV-1a 32-bit** (lane convention, see §6.3) —
   deterministic and dependency-free, not cryptographic. Cross-cutting
   hash strength is a TL decision.

5. **Quota windows are single-window states.** `applyQuotaRequest`
   enforces one window; multi-window rolling quotas and window
   auto-rotation on exhaustion are arithmetic on top
   (`nextWindowStart`) but not assembled here.

6. **Routing scores are cost/richness only.** No provider-health input
   in `selectModel` itself — health-aware selection is the composing
   application combining `selectModel` (model choice) with
   `resolveFallbackLadder` (provider choice), which is how the packet
   splits the two responsibilities.

7. **`pnpm -r test` (full-suite) was NOT run** — per the packet's
   memory-constrained-box rule, gates ran per-package only. Both
   packages are fully self-contained (zero cross-imports), so
   cross-package breakage is not possible from this change set, but the
   full-suite number is the TL's merge-time verification, not mine to
   claim.

## 8. Stop-the-line events

None. Both packages' test + typecheck + lint gates passed; the only
iteration during development was cosmetic (fixing an awkward comment
block in `budgets.ts` and simplifying a test helper's typing) before
any commit.

## 9. Verification commands for TL re-run

```bash
git fetch origin work/f230c:work/f230c
git checkout work/f230c
# boundary:
rg -n "import .* from ['\"]@fleetos/" packages/agent-organizations/src packages/model-gateway/src   # expect no matches
rg -n "import .* from ['\"]@zcode/"   packages/agent-organizations/src packages/model-gateway/src   # expect no matches
# gates (per package, per packet):
for p in agent-organizations model-gateway; do
  (cd packages/$p && corepack pnpm run test && corepack pnpm run typecheck)
done
# expect: 107 / 81 tests (188 lane total), typecheck exit 0 x2
# optional self-check:
for p in agent-organizations model-gateway; do
  (cd packages/$p && corepack pnpm run lint)   # expect 0 warnings / 0 errors each
done
```
